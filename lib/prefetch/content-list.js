/**
 * 内容/说明类页面的预取 Provider（SSG）
 *
 * 覆盖 4 条路由：
 *   /daily        公会日报   —— 无参数第一页（最新排序，与 SPA 首屏完全一致）
 *   /decision     决策公示   —— 无参数第一页（最新排序）
 *   /mods         游戏模组   —— 纯静态说明页（功能特性 / 指令表 / 安装说明，不依赖数据库）
 *   /projections  投影仓库   —— 无参数第一页（最新 12 条）
 *
 * 带参数形态（/daily?page=2、搜索词、最热排序）不做 SSG：中间件按 pathname 命中本 Provider 后
 * 返回的是「无参数首屏」产物，首屏之后的翻页/搜索由客户端接管，
 * 见 frontend/src/pages/ContentList.jsx 与 Projections.jsx 里的 useServerData 分支。
 *
 * 数据 key 与页面 useServerData(...) 参数一一对应：
 *   contentList  → ContentList.jsx（type / posts / total / totalPages）
 *   projections  → Projections.jsx（projections / total）
 *   modsInfo     → Mods.jsx（纯静态页，仅作为 __SSR_DATA__ 的页面标识）
 *
 * 注意：下面的 SQL 与 routes/posts.js、routes/projections.js 的公开列表接口保持一致
 * （字段名必须一致，否则 hydrate 出来的首屏与客户端请求结果不同）。
 */
const db = require('../../database');

const POST_LIMIT = 10;            // 与 ContentList.jsx 的 limit 一致
const PROJECTION_LIMIT = 12;      // 与 Projections.jsx 的 limit 一致

const SSG = [
    /^\/daily$/,
    /^\/decision$/,
    /^\/mods$/,
    /^\/projections$/
];

/** 每页专属 head（默认标题是「我的世界玄剑公会」，这里四页都要有自己的标题） */
const HEAD = {
    '/daily': {
        title: '公会日报 · 我的世界玄剑公会',
        description: '玄剑公会日报：服务器动态、活动预告与重要通知的官方发布渠道，按时间倒序持续更新。'
    },
    '/decision': {
        title: '决策公示 · 我的世界玄剑公会',
        description: '玄剑公会重大决策与管理制度公示：所有已生效的决策都留有公开记录，供成员查证。'
    },
    '/mods': {
        title: '游戏模组 xuanjianmod · 我的世界玄剑公会',
        description: '玄剑公会联动模组 xuanjianmod：在 Minecraft 游戏内完成签到、任务、贡献点操作，与官网数据实时同步。'
    },
    '/projections': {
        title: '投影仓库 · 我的世界玄剑公会',
        description: '玄剑公会投影仓库：上传、分享与在线 3D 预览 Minecraft Litematica 投影文件。'
    }
};

/** 与 routes/posts.js 的 processImages 保持一致：补全相对路径 */
function processImages(images) {
    if (!images || !Array.isArray(images)) return [];
    return images.map(img => {
        if (typeof img !== 'string') return img;
        if (img.startsWith('data:') || img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/')) return img;
        return `/${img}`;
    });
}

/** 与 routes/projections.js 的 parseTags 保持一致 */
function parseTags(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags.filter(Boolean);
    return String(tags).split(/[,，]/).map(t => t.trim()).filter(Boolean);
}

/** 日报/决策列表：等价于 GET /api/posts?type=daily|decision&page=1&limit=10&sort=latest */
async function loadPosts(type) {
    const where = "p.status = 'active' AND p.type = ?";

    const countRow = await db.get(
        `SELECT COUNT(*) as total FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE ${where}`,
        [type]
    );

    const posts = await db.all(
        `SELECT p.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username,
                t.name as author_title_name, t.color as author_title_color
         FROM posts p
         LEFT JOIN users u ON p.author_id = u.id
         LEFT JOIN titles t ON u.equipped_title = t.id
         WHERE ${where}
         ORDER BY p.is_pinned DESC, p.created_at DESC
         LIMIT ? OFFSET ?`,
        [type, POST_LIMIT, 0]
    );
    posts.forEach(post => {
        try {
            post.images = typeof post.images === 'string' ? processImages(JSON.parse(post.images)) : processImages(post.images);
        } catch (e) {
            post.images = [];
        }
    });

    const total = (countRow && countRow.total) || 0;
    return {
        type,
        sort: 'latest',
        page: 1,
        limit: POST_LIMIT,
        posts,
        total,
        totalPages: Math.ceil(total / POST_LIMIT)
    };
}

/** 投影列表：等价于 GET /api/projections?page=1&limit=12 */
async function loadProjections() {
    const totalRow = await db.get('SELECT COUNT(*) AS count FROM projections');

    const rows = await db.all(
        `SELECT p.*, u.nickname AS author_nickname, u.username AS author_username, u.avatar AS author_avatar
         FROM projections p
         JOIN users u ON p.author_id = u.id
         ORDER BY p.id DESC
         LIMIT ? OFFSET ?`,
        [PROJECTION_LIMIT, 0]
    );
    rows.forEach(row => { row.tags = parseTags(row.tags); });

    const total = (totalRow && totalRow.count) || 0;
    return {
        projections: rows,
        total,
        page: 1,
        limit: PROJECTION_LIMIT,
        totalPages: Math.ceil(total / PROJECTION_LIMIT)
    };
}

/**
 * 取数：返回 { [key]: data }，会合并进 __SSR_DATA__。
 * 返回 null 表示「这个页面服务端不渲染」，交给 SPA 回退。
 */
async function load(pathname) {
    const clean = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/';

    if (clean === '/daily') return { contentList: await loadPosts('daily') };
    if (clean === '/decision') return { contentList: await loadPosts('decision') };
    if (clean === '/projections') return { projections: await loadProjections() };
    // 纯静态说明页：没有数据库依赖，占位对象保证中间件不会把它当成「页面不存在」
    if (clean === '/mods') return { modsInfo: { static: true, path: '/mods' } };

    return null;
}

/** SSG 需要生成的完整路径列表（全部是固定路径） */
async function enumerate() {
    return ['/daily', '/decision', '/mods', '/projections'];
}

/** 每页专属 head */
function head(data, pathname) {
    const clean = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
    const h = HEAD[clean];
    if (h) return h;

    // 兜底：带上内容类型，避免退化成站点默认标题
    const list = data && data.contentList;
    if (list) {
        return {
            title: `${list.type === 'decision' ? '决策公示' : '公会日报'} · 我的世界玄剑公会`,
            description: `玄剑公会${list.type === 'decision' ? '决策公示' : '日报'}，共 ${list.total || 0} 条。`
        };
    }
    return { title: '内容 · 我的世界玄剑公会' };
}

module.exports = {
    name: 'contentList',
    ssg: SSG,
    ssr: [],
    load,
    enumerate,
    head
};
