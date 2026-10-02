/**
 * 内容页预取 Provider（SSR 按请求渲染）
 *
 * 覆盖四条内容路由：
 *   /                    → 首页（统计数据）
 *   /post/:id、/posts/:id → 帖子详情（帖子 + 评论树）
 *   /profile/:username   → 公开成员主页（成员资料 + 最近发布）
 *
 * 返回的 key 与前端 useServerData(...) 的参数一一对应：
 *   homeStats    ← Home.jsx
 *   postDetail   ← PostDetail.jsx   形如 { post, comments }        （同 GET /api/posts/:id）
 *   profileUser  ← Profile.jsx      形如 { user }                  （同 GET /api/auth/user/:username）
 *   profilePosts ← Profile.jsx      帖子数组                        （同 GET /api/posts?author=x&limit=5）
 *
 * 取数直接走 database（**不发 HTTP 自请求**）。SQL 与 routes/posts.js、routes/auth.js 保持一致，
 * 否则 SSR 首屏的数据形状会和客户端 hydrate 时用到的形状对不上。
 *
 * 刻意不做的事：
 *   1) 不累加 posts.views —— 原 GET /api/posts/:id 会 views+1，但 SSR 有 60 秒进程内缓存，
 *      在这里 +1 会把浏览量按「每分钟最多一次」严重少计，而且读路径不应写库；
 *      浏览量补偿方案（例如单独的埋点接口）留给上层决定。
 *   2) 不判断登录态 —— 服务端一律按游客渲染（收藏/关注/编辑删除按钮等由客户端 useEffect 接管）。
 *   3) 被封禁（users.is_frozen=1）成员、不存在/已删除内容 → 返回 null，由 lib/ssr.js 交给 SPA 回退。
 */
const db = require('../../database');

/* ==================== 路由与站点文案 ==================== */

const SSR = [
    /^\/$/,
    /^\/post\/\d+$/,
    /^\/posts\/\d+$/,          // 兼容旧分享链接
    /^\/profile\/[^/]+$/
];

const TYPE_LABEL = { daily: '公会日报', decision: '决策公示', forum: '公会贴吧' };

const SITE_TITLE = '我的世界玄剑公会 · 官网';
const SITE_DESC = '玄剑公会官网：公会日报、决策公示、成员档案、贡献点经济与 Minecraft 服务器资料。';

/* ==================== 与 routes/posts.js 对齐的查询 ==================== */

/** 图片字段归一化：与 routes/posts.js 的 processImages 完全一致 */
function processImages(images) {
    if (!images || !Array.isArray(images)) return [];
    return images.map(img => {
        if (img.startsWith('data:') || img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/')) {
            return img;
        }
        return `/${img}`;
    });
}

function parsePostImages(post) {
    if (post.images) {
        try {
            post.images = processImages(JSON.parse(post.images));
        } catch {
            post.images = [];
        }
    } else {
        post.images = [];
    }
    return post;
}

const POST_LIST_SELECT = `SELECT p.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username,
            t.name as author_title_name, t.color as author_title_color
     FROM posts p
     LEFT JOIN users u ON p.author_id = u.id
     LEFT JOIN titles t ON u.equipped_title = t.id`;

const POST_DETAIL_SELECT = `SELECT p.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username, u.contribution as author_contribution,
            t.name as author_title_name, t.color as author_title_color
     FROM posts p
     LEFT JOIN users u ON p.author_id = u.id
     LEFT JOIN titles t ON u.equipped_title = t.id`;

const COMMENT_SELECT = `SELECT c.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username,
            t.name as author_title_name, t.color as author_title_color
     FROM comments c
     LEFT JOIN users u ON c.author_id = u.id
     LEFT JOIN titles t ON u.equipped_title = t.id`;

/** 评论回复树（最多 3 层，与 routes/posts.js 的 getReplies 一致，含 reply_to 引用信息） */
async function loadReplies(parentId, depth = 0) {
    if (depth > 2) return [];
    const replies = await db.all(
        `${COMMENT_SELECT}
         WHERE c.parent_id = ? AND c.status = 'active'
         ORDER BY c.created_at ASC`,
        [parentId]
    );
    for (const reply of replies) {
        const parentComment = await db.get(
            `SELECT u.nickname, u.username
             FROM comments c
             JOIN users u ON c.author_id = u.id
             WHERE c.id = ?`,
            [reply.parent_id]
        );
        if (parentComment) reply.reply_to = parentComment;
        reply.replies = await loadReplies(reply.id, depth + 1);
    }
    return replies;
}

/* ==================== 各页数据 ==================== */

/** 首页：注册成员 / 发布内容 / 互动交流（GET /api/posts/public-stats） */
async function loadHomeStats() {
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    const postCount = await db.get("SELECT COUNT(*) as count FROM posts WHERE status = 'active'");
    const commentCount = await db.get("SELECT COUNT(*) as count FROM comments WHERE status = 'active'");
    return {
        users: userCount.count || 0,
        posts: postCount.count || 0,
        comments: commentCount.count || 0
    };
}

/** 帖子详情：不存在/已删除（status != active）返回 null */
async function loadPostDetail(id) {
    const post = await db.get(
        `${POST_DETAIL_SELECT}
         WHERE p.id = ? AND p.status = 'active'`,
        [id]
    );
    if (!post) return null;
    parsePostImages(post);

    const comments = await db.all(
        `${COMMENT_SELECT}
         WHERE c.post_id = ? AND c.status = 'active' AND c.parent_id IS NULL
         ORDER BY c.created_at DESC`,
        [id]
    );
    for (const comment of comments) {
        comment.replies = await loadReplies(comment.id);
    }
    return { post, comments };
}

/** 成员主页资料：不存在或被封禁返回 null（GET /api/auth/user/:username） */
async function loadProfileUser(username) {
    const user = await db.get(
        `SELECT u.id, u.username, u.nickname, u.email, u.avatar, u.cover, u.level, u.contribution, u.skin_path, u.game_id, u.created_at, u.is_frozen,
                t.name as title_name, t.color as title_color
         FROM users u
         LEFT JOIN titles t ON u.equipped_title = t.id
         WHERE u.username = ?`,
        [username]
    );
    if (!user) return null;
    if (user.is_frozen) return null;                 // 被封禁成员不做 SSR，交给 SPA
    delete user.is_frozen;                           // 公开接口不返回该字段，保持形状一致

    const postCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE author_id = ? AND status = "active"', [user.id]);
    const commentCount = await db.get('SELECT COUNT(*) as count FROM comments WHERE author_id = ? AND status = "active"', [user.id]);
    const likesCount = await db.get('SELECT SUM(CAST(likes AS INTEGER)) as total FROM posts WHERE author_id = ? AND status = "active"', [user.id]);

    return {
        user: {
            ...user,
            posts_count: postCount.count || 0,
            comments_count: commentCount.count || 0,
            likes_count: likesCount.total || 0
        }
    };
}

/** 成员主页的最近发布（GET /api/posts?author=<username>&limit=5） */
async function loadProfilePosts(username) {
    const posts = await db.all(
        `${POST_LIST_SELECT}
         WHERE p.status = "active" AND u.username = ?
         ORDER BY p.is_pinned DESC, p.created_at DESC
         LIMIT ? OFFSET ?`,
        [username, 5, 0]
    );
    posts.forEach(parsePostImages);
    return posts;
}

/* ==================== Provider 接口 ==================== */

async function load(pathname) {
    const clean = pathname.split('?')[0];

    // 首页
    if (clean === '/') {
        return { homeStats: await loadHomeStats() };
    }

    // 帖子详情：/post/:id 与 /posts/:id
    const mPost = clean.match(/^\/posts?\/(\d+)$/);
    if (mPost) {
        const detail = await loadPostDetail(Number(mPost[1]));
        return detail ? { postDetail: detail } : null;
    }

    // 公开成员主页
    const mProfile = clean.match(/^\/profile\/([^/]+)$/);
    if (mProfile) {
        let username;
        try {
            username = decodeURIComponent(mProfile[1]);
        } catch {
            return null;                             // 非法转义，交给 SPA
        }
        const profileUser = await loadProfileUser(username);
        if (!profileUser) return null;
        const profilePosts = await loadProfilePosts(username);
        return { profileUser, profilePosts };
    }

    return null;
}

/** HTML → 纯文本（摘要用；与前端 utils.stripHtml 的语义一致） */
function plainText(html, max = 160) {
    const text = String(html || '')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 每页动态 head（title / description / OG 图） */
function head(data) {
    // 帖子详情
    const post = data && data.postDetail && data.postDetail.post;
    if (post) {
        const label = TYPE_LABEL[post.type] || '内容';
        const excerpt = plainText(post.content, 130);
        return {
            title: `${post.title} · 玄剑公会`,
            description: excerpt || `${post.author_nickname || post.author_username || '公会成员'} 发布的${label}`,
            image: (post.images && post.images[0]) || undefined
        };
    }

    // 成员主页
    const user = data && data.profileUser && data.profileUser.user;
    if (user) {
        const name = user.nickname || user.username;
        const parts = [`@${user.username}`];
        if (user.posts_count) parts.push(`${user.posts_count} 篇发布`);
        if (user.comments_count) parts.push(`${user.comments_count} 条评论`);
        return {
            title: `${name} 的成员主页 · 玄剑公会`,
            description: `玄剑公会成员 ${name}（${parts.join(' · ')}）的个人主页：贡献点、发布内容与互动数据。`,
            image: user.avatar || undefined
        };
    }

    // 首页（站点标题 + 简介）
    return { title: SITE_TITLE, description: SITE_DESC };
}

module.exports = {
    name: 'content',
    ssg: [],
    ssr: SSR,
    load,
    head
};
