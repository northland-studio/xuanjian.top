/**
 * 成员类页面的预取 Provider（SSR 按请求渲染）
 *
 * 覆盖四条路由（都只预取「无查询参数的默认首屏」）：
 *   /gmirs     成员档案信息查询管理系统（GMIRS） → 成员名册 + 首位成员的完整档案
 *   /gdars     成员处分信息查询管理系统（GDARS） → 处分公示名册（成员 + 其处分记录）
 *   /rankings  成员排行榜                        → 默认页签「贡献点排行」
 *   /donation  捐赠墙                            → 公账汇总 + 捐赠者第 1 页 + 出入账明细第 1 页
 *
 * 返回的 key 与前端 useServerData(...) 的参数一一对应：
 *   gmirsHome    ← Gmirs.jsx     形如 { users, selectedId, archive }
 *                                  users 同 GET /api/gmirs/query 的结果形状，
 *                                  archive 同 GET /api/gmirs/user/:id 的 archive 形状
 *   gdarsHome    ← Gdars.jsx     形如 { results }     同 GET /api/discipline/query 的结果形状
 *   rankingsHome ← Rankings.jsx  形如 { rankings }    同 GET /api/rankings/contribution 的结果形状
 *   donationHome ← Donation.jsx  形如 { summary, qrUrl, donors, donorTotal, ledger, ledgerTotal }
 *                                  分别对应 GET /api/donation/summary|donors?page=1|ledger?page=1
 *
 * 取数直接走服务层/数据库（**不发 HTTP 自请求**）。SQL 与 routes/gmirs.js、routes/discipline.js、
 * routes/rankings.js 对齐，字段名必须一致，否则 SSR 首屏的数据形状会和客户端请求回来的对不上。
 *
 * 带查询参数（?keyword= / ?type= / ?page= …）的形态一律返回 null，交回 SPA 由客户端接管：
 * 注意 lib/ssr.js 会先把 url 的 query 去掉、只把 pathname 传进来，所以这里既看 pathname 本身
 * 是否带 query，也看生产中间件传入的 ctx.req.originalUrl（server.js 里 ssr.middleware() 传的是 { req }）。
 *
 * 刻意不做的事：
 *   1) 不写库（浏览量/统计一律只读），SSR 有 60 秒进程内缓存，读路径不产生副作用；
 *   2) 不判断登录态：捐赠墙按游客渲染（未公示材料不下发），管理员由客户端重新拉取；
 *   3) 数据为空（例如还没有捐赠记录）仍照常渲染页面骨架，只有「资源不存在」才返回 null。
 *
 * 注意：routes/gmirs.js 里的档案构建逻辑（贡献点分组 / 处分记录 / 防伪验证码）在本文件里
 * 复刻了一份 —— 路由文件只导出 express.Router()，无法复用；两边改动时必须同步。
 * 验证码的 secret 用 process.env.JWT_SECRET 兜底（**不能 require middleware/auth**：那里在
 * 缺少 JWT_SECRET 时会 process.exit(1)，会拖垮不含 .env 的独立渲染/测试进程）。
 */
const crypto = require('crypto');
const db = require('../../database');
const donation = require('../donation');
const { resolveGeneration } = require('../generation');

/* ==================== 路由 ==================== */

const SSR = [
    /^\/gmirs$/,
    /^\/gdars$/,
    /^\/rankings$/,
    /^\/donation$/
];

const SITE = '我的世界玄剑公会';
const SITE_DESC = '玄剑公会官网：公会日报、决策公示、成员档案、贡献点经济与 Minecraft 服务器资料。';

// 与前端页面里的分页/名册常量保持一致（Donation.jsx 的 PAGE_SIZE / LEDGER_SIZE）
const GMIRS_ROSTER_LIMIT = 30;          // 同 GET /api/gmirs/query 的 LIMIT 30
const GDARS_ROSTER_LIMIT = 20;          // 同 GET /api/discipline/query 的 LIMIT 20
const RANKINGS_LIMIT = 20;              // 同 GET /api/rankings/* 的默认 limit
const DONATION_DONOR_PAGE_SIZE = 12;
const DONATION_LEDGER_PAGE_SIZE = 20;

/* ==================== 查询参数规约 ==================== */

function cleanPath(pathname) {
    const clean = String(pathname || '').split('?')[0].replace(/\/+$/, '');
    return clean || '/';
}

/** 取本次请求的 query 串（pathname 里带 ? 时直接用；否则读 ctx.req / ctx.url / ctx.search） */
function queryStringOf(pathname, ctx) {
    const raw = String(pathname || '');
    const at = raw.indexOf('?');
    if (at >= 0) return raw.slice(at + 1);

    const req = ctx && ctx.req;
    for (const candidate of [req && (req.originalUrl || req.url), ctx && (ctx.url || ctx.search)]) {
        const s = String(candidate || '');
        const i = s.indexOf('?');
        if (i >= 0 && s.slice(i + 1)) return s.slice(i + 1);
    }
    if (req && req.query && Object.keys(req.query).length) {
        try { return new URLSearchParams(req.query).toString(); } catch (e) { return ''; }
    }
    return '';
}

/* ==================== GMIRS：档案构建（与 routes/gmirs.js 同步） ==================== */

const TYPE_LABELS = {
    claim: '贡献点申报', task: '官方任务', player_task: '玩家任务',
    transfer_in: '贡献点转入', transfer_out: '贡献点转出',
    purchase: '贡献点消费', title: '称号购买', reward: '签到奖励',
    admin: '管理调整', discipline: '处分扣点', post: '发帖奖励',
    exchange: '外站兑换', payment: '缴费单',
    donation: '捐赠奖励', bubble: '聊天气泡'
};
const GROUP_ORDER = ['task', 'player_task', 'claim', 'transfer_in', 'transfer_out', 'purchase', 'exchange', 'payment', 'donation', 'title', 'bubble', 'reward', 'discipline', 'post', 'admin'];
const DISCIPLINE_LEVEL_TEXT = { 1: '全会通报批评', 2: '全会通报批评+扣除贡献点', 3: '开除会籍（冻结账号）' };

/** 防伪验证码：与 routes/gmirs.js 的 generateVerifyCode 完全一致（同一 secret 才能算出同一个码） */
function generateVerifyCode(userId) {
    const secret = process.env.GMIRS_VERIFY_SECRET || process.env.JWT_SECRET || 'xuanjian-gmirs';
    const digest = crypto.createHmac('sha256', secret).update(`GMIRS:${userId}`).digest('hex').toUpperCase();
    return `XJ-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`;
}

function decorateDiscipline(row) {
    if (!row) return row;
    row.level_text = DISCIPLINE_LEVEL_TEXT[row.level] || '未知';
    row.is_active = !row.revoked_at;
    return row;
}

/** 某成员的全部处分记录 */
async function getDiscipline(userId) {
    const rows = await db.all(
        `SELECT g.*, a.username AS admin_name, r.username AS revoked_by_name
         FROM guild_disciplinary_actions g
         LEFT JOIN users a ON g.admin_id = a.id
         LEFT JOIN users r ON g.revoked_by = r.id
         WHERE g.user_id = ? ORDER BY g.created_at DESC, g.id DESC`,
        [userId]
    );
    return rows.map(decorateDiscipline);
}

/** 某成员的全部贡献点流水，按类型分组并补详情（与 routes/gmirs.js 的 getContributionGroups 一致） */
async function getContributionGroups(userId) {
    const logs = await db.all(
        'SELECT * FROM contribution_logs WHERE user_id = ? ORDER BY id DESC',
        [userId]
    );

    const claimIds = [], taskIds = [], ptIds = [], titleIds = [], postIds = [], shopIds = [];
    logs.forEach(l => {
        if (l.type === 'claim' && l.ref_id) claimIds.push(l.ref_id);
        else if (l.type === 'task' && l.ref_id) taskIds.push(l.ref_id);
        else if (l.type === 'player_task' && l.ref_id) ptIds.push(l.ref_id);
        else if (l.type === 'title' && l.ref_id) titleIds.push(l.ref_id);
        else if (l.type === 'post' && l.ref_id) postIds.push(l.ref_id);
        else if (l.type === 'purchase' && l.ref_id) shopIds.push(l.ref_id);
    });

    const orZero = (arr) => (arr.length ? arr : [0]);
    const claims = claimIds.length ? await db.all(`SELECT id, reason, review_note, amount FROM contribution_claims WHERE id IN (${claimIds.map(() => '?').join(',')})`, orZero(claimIds)) : [];
    const tasks = taskIds.length ? await db.all(`SELECT id, title FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`, orZero(taskIds)) : [];
    const pts = ptIds.length ? await db.all(`SELECT id, title, reward FROM player_tasks WHERE id IN (${ptIds.map(() => '?').join(',')})`, orZero(ptIds)) : [];
    const titles = titleIds.length ? await db.all(`SELECT id, name FROM titles WHERE id IN (${titleIds.map(() => '?').join(',')})`, orZero(titleIds)) : [];
    const posts = postIds.length ? await db.all(`SELECT id, title, content FROM posts WHERE id IN (${postIds.map(() => '?').join(',')})`, orZero(postIds)) : [];
    const shops = shopIds.length ? await db.all(`SELECT id, name FROM shop_items WHERE id IN (${shopIds.map(() => '?').join(',')})`, orZero(shopIds)) : [];

    const map = (arr) => arr.reduce((m, r) => { m[r.id] = r; return m; }, {});
    const claimMap = map(claims), taskMap = map(tasks), ptMap = map(pts), titleMap = map(titles), postMap = map(posts), shopMap = map(shops);

    const groups = {};
    logs.forEach(l => {
        let detail = l.note || '';
        let reply = '';
        if (l.type === 'claim') {
            const c = claimMap[l.ref_id];
            if (c) { detail = c.reason || detail; reply = c.review_note || ''; }
        } else if (l.type === 'task') {
            const t = taskMap[l.ref_id];
            if (t) detail = t.title || detail;
        } else if (l.type === 'player_task') {
            const t = ptMap[l.ref_id];
            if (t) detail = t.title || detail;
        } else if (l.type === 'title') {
            const t = titleMap[l.ref_id];
            if (t) detail = t.name || detail;
        } else if (l.type === 'post') {
            const p = postMap[l.ref_id];
            if (p) detail = p.title || detail;
        } else if (l.type === 'purchase') {
            const s = shopMap[l.ref_id];
            if (s) detail = s.name || detail;
        }

        const type = l.type;
        if (!groups[type]) groups[type] = { type, type_label: TYPE_LABELS[type] || type, items: [] };
        groups[type].items.push({
            id: l.id,
            amount: l.amount,
            detail,
            reply,
            note: l.note || '',
            balance_after: l.balance_after,
            created_at: l.created_at
        });
    });

    const ordered = [];
    GROUP_ORDER.forEach(t => { if (groups[t]) ordered.push(groups[t]); });
    Object.keys(groups).forEach(t => { if (!GROUP_ORDER.includes(t)) ordered.push(groups[t]); });

    const balance = (await db.get('SELECT COALESCE(contribution, 0) AS c FROM users WHERE id = ?', [userId]))?.c ?? 0;
    return { balance, groups: ordered };
}

/** 单个成员档案（基本信息 + 贡献点分组 + 处分记录 + 防伪验证码）；成员不存在返回 null */
async function buildArchive(userId) {
    const user = await db.get(
        `SELECT id, username, nickname, avatar, game_id, email, contribution,
                skin_path, created_at, is_frozen, generation
         FROM users WHERE id = ?`,
        [userId]
    );
    if (!user) return null;

    const contribution = await getContributionGroups(userId);
    const discipline = await getDiscipline(userId);

    let generation = null;
    try {
        const g = await resolveGeneration(user);
        if (g) {
            generation = {
                name: g.name,
                color: g.color,
                manual: !!g.manual,
                start_date: g.start_date || null,
                end_date: g.end_date || null,
                range: g.range || ''
            };
        }
    } catch (e) { /* 代系解析失败不影响档案 */ }

    return {
        user: { ...user, generation },
        contribution,
        discipline,
        verify_code: generateVerifyCode(userId)
    };
}

/**
 * GMIRS 默认首屏：成员名册（按贡献点倒序，同 /api/gmirs/query 的字段与排序）
 * + 名册第一位成员的完整档案（页面右侧详情区默认展开，首屏即有真实的档案字段与流水）。
 */
async function loadGmirsHome() {
    const users = await db.all(
        `SELECT id, username, nickname, avatar, game_id, contribution, is_frozen
         FROM users
         ORDER BY contribution DESC, id ASC
         LIMIT ?`,
        [GMIRS_ROSTER_LIMIT]
    );

    if (!users.length) return { users, selectedId: null, archive: null };

    const selectedId = users[0].id;
    const archive = await buildArchive(selectedId);
    if (!archive) return { users, selectedId: null, archive: null };
    return { users, selectedId, archive };
}

/* ==================== GDARS：处分公示名册 ==================== */

/**
 * GDARS 默认首屏：有处分记录的成员（含各自的全部处分记录）。
 * 形状与 GET /api/discipline/query 的 results 一致：[{ user, actions }]，
 * 前端 Gdars.jsx 直接 results.map(({ user, actions }) => ...) 渲染。
 */
async function loadDisciplineRoster() {
    const users = await db.all(
        `SELECT id, username, nickname, avatar, is_frozen, contribution
         FROM users
         WHERE id IN (SELECT DISTINCT user_id FROM guild_disciplinary_actions)
         ORDER BY contribution DESC, id ASC
         LIMIT ?`,
        [GDARS_ROSTER_LIMIT]
    );
    if (!users.length) return [];

    const ids = users.map(u => u.id);
    const rows = await db.all(
        `SELECT g.*, a.username AS admin_name
         FROM guild_disciplinary_actions g
         LEFT JOIN users a ON g.admin_id = a.id
         WHERE g.user_id IN (${ids.map(() => '?').join(',')})
         ORDER BY g.created_at DESC, g.id DESC`,
        ids
    );

    const byUser = new Map();
    for (const row of rows) {
        decorateDiscipline(row);
        if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
        byUser.get(row.user_id).push(row);
    }

    return users.map(u => ({ user: u, actions: byUser.get(u.id) || [] }));
}

/* ==================== Rankings：贡献点排行（页面默认页签） ==================== */

/** 与 GET /api/rankings/contribution 完全一致的字段与数值处理 */
async function loadContributionRankings() {
    const users = await db.all(
        `SELECT id, username, nickname, avatar, contribution, equipped_title,
                (SELECT name FROM titles WHERE id = equipped_title) as title_name,
                (SELECT color FROM titles WHERE id = equipped_title) as title_color
         FROM users
         WHERE contribution > 0
         ORDER BY contribution DESC, id ASC
         LIMIT ?`,
        [RANKINGS_LIMIT]
    );

    return users.map((u, i) => ({
        ...u,
        contribution: Math.round(u.contribution * 100) / 100,
        rank: i + 1
    }));
}

/* ==================== Donation：公账汇总 + 捐赠者 + 明细 ==================== */

/** 与 Donation.jsx 首次挂载时的三个请求等价（汇总 / 捐赠者第 1 页 / 明细第 1 页） */
async function loadDonationHome() {
    const [summary, qrUrl, donors, ledger] = await Promise.all([
        donation.summary(),
        donation.getQrUrl(),
        donation.listDonors({ page: 1, limit: DONATION_DONOR_PAGE_SIZE }),
        // 服务端按游客渲染：includePrivate=false 时未公示的材料不下发（管理员登录后由客户端重新拉取）
        donation.listLedger({ page: 1, limit: DONATION_LEDGER_PAGE_SIZE, includePrivate: false })
    ]);

    return {
        summary: summary || null,
        qrUrl: qrUrl || '',
        donors: (donors && donors.list) || [],
        donorTotal: (donors && donors.total) || 0,
        ledger: (ledger && ledger.list) || [],
        ledgerTotal: (ledger && ledger.total) || 0
    };
}

/* ==================== Provider 接口 ==================== */

async function load(pathname, ctx) {
    // 带查询参数的形态（?keyword= / ?type= / ?page= …）不做服务端渲染，交回 SPA 由客户端请求
    if (queryStringOf(pathname, ctx)) return null;

    const clean = cleanPath(pathname);

    if (clean === '/gmirs') return { gmirsHome: await loadGmirsHome() };
    if (clean === '/gdars') return { gdarsHome: { results: await loadDisciplineRoster() } };
    if (clean === '/rankings') return { rankingsHome: { rankings: await loadContributionRankings() } };
    if (clean === '/donation') return { donationHome: await loadDonationHome() };

    return null;
}

/** 每页专属 head（title / description / OG 图） */
function head(data, pathname) {
    const clean = cleanPath(pathname);

    if (clean === '/gmirs') {
        const home = (data && data.gmirsHome) || {};
        const n = (home.users || []).length;
        const who = home.archive && home.archive.user
            ? (home.archive.user.nickname || home.archive.user.username)
            : '';
        return {
            title: `玄剑公会成员档案信息查询管理系统 GMIRS · ${SITE}`,
            description: n
                ? `玄剑公会成员档案信息查询系统（GMIRS）：已收录 ${n} 位成员档案，可按用户名/昵称/ID 查询贡献点明细分组、处分记录与防伪验证码${who ? `，当前展示 ${who} 的完整档案` : ''}。`
                : '玄剑公会成员档案信息查询系统（GMIRS）：按用户名/昵称/ID 查询成员档案，含贡献点明细、处分记录与防伪验证码。'
        };
    }

    if (clean === '/gdars') {
        const results = (data && data.gdarsHome && data.gdarsHome.results) || [];
        const actionCount = results.reduce((sum, r) => sum + ((r.actions || []).length), 0);
        return {
            title: `玄剑公会成员处分信息查询管理系统 GDARS · ${SITE}`,
            description: actionCount
                ? `玄剑公会处分信息查询系统（GDARS）：公示 ${results.length} 位受处分成员、共 ${actionCount} 条处分记录（处分级别、理由、扣点、处分人与生效状态），支持按用户名/昵称/ID 查询。`
                : '玄剑公会处分信息查询系统（GDARS）：查询成员处分记录（级别、理由、扣点、处分人、生效状态），公开公示、可追溯。'
        };
    }

    if (clean === '/rankings') {
        const rankings = (data && data.rankingsHome && data.rankingsHome.rankings) || [];
        const top = rankings[0];
        return {
            title: `成员排行榜 · ${SITE}`,
            description: top
                ? `玄剑公会成员排行榜：贡献点、在线时长、内容热度、点赞与签到排行，实时统计。当前贡献点榜首为 ${top.nickname || top.username}（${top.contribution} 点）。`
                : '玄剑公会成员排行榜：贡献点、在线时长、内容热度、点赞与签到排行，实时统计。'
        };
    }

    if (clean === '/donation') {
        const home = (data && data.donationHome) || {};
        const s = home.summary;
        return {
            title: `捐赠墙 · 公账公示 · ${SITE}`,
            description: s
                ? `玄剑公会捐赠墙：公账累计收入 ${s.income} 元、支出 ${s.expense} 元、余额 ${s.balance} 元，${home.donorTotal || 0} 位捐赠者、${home.ledgerTotal || 0} 条出入账明细公开可查。`
                : '玄剑公会捐赠墙：公账收入、支出与余额公示，捐赠者名单与每一笔出入账明细公开透明。'
        };
    }

    return { title: SITE, description: SITE_DESC };
}

module.exports = {
    name: 'members',
    ssg: [],
    ssr: SSR,
    load,
    head
};
