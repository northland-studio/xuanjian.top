/**
 * 玄剑公会成员档案信息查询管理系统（GMIRS）
 * Xuanjian Guild Member Information Retrieval System
 *
 * 面向全体用户，独立前端 /gmirs，不加入主站导航栏。
 * 提供：模糊查询成员、查看单个成员档案（基本信息、贡献点明细按类分组、处分记录）、
 *       档案内验证码查伪、一键导出所有成员档案。
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../lib/logger');
const db = require('../database');
const { JWT_SECRET } = require('../middleware/auth');
const router = express.Router();

// 贡献点流水类型的中文标签与分组顺序
const TYPE_LABELS = {
    claim: '贡献点申报',
    task: '官方任务',
    player_task: '玩家任务',
    transfer_in: '贡献点转入',
    transfer_out: '贡献点转出',
    purchase: '贡献点消费',
    title: '称号购买',
    reward: '签到奖励',
    admin: '管理调整',
    discipline: '处分扣点',
    post: '发帖奖励',
    exchange: '外站兑换'
};
// 展示顺序（未列出的类型排最后）
const GROUP_ORDER = ['task', 'player_task', 'claim', 'transfer_in', 'transfer_out', 'purchase', 'exchange', 'title', 'reward', 'discipline', 'post', 'admin'];

const DISCIPLINE_LEVEL_TEXT = { 1: '全会通报批评', 2: '全会通报批评+扣除贡献点', 3: '开除会籍（冻结账号）' };

// 生成防伪验证码：基于用户ID的确定性签名，可随时在官网复算校验
function generateVerifyCode(userId) {
    const secret = process.env.GMIRS_VERIFY_SECRET || JWT_SECRET || 'xuanjian-gmirs';
    const digest = crypto.createHmac('sha256', secret).update(`GMIRS:${userId}`).digest('hex').toUpperCase();
    return `XJ-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`;
}

// 校验验证码是否与目标用户档案匹配
function verifyCodeForUser(code, userId) {
    if (!code || !userId) return false;
    return code.trim().toUpperCase() === generateVerifyCode(userId);
}

// 处分数值装饰
function decorateDiscipline(row) {
    if (!row) return row;
    row.level_text = DISCIPLINE_LEVEL_TEXT[row.level] || '未知';
    row.is_active = !row.revoked_at;
    return row;
}

// 拉取某用户的全部处分记录
async function getDiscipline(userId) {
    const rows = await db.all(
        `SELECT g.*, a.username AS admin_name, r.username AS revoked_by_name
         FROM guild_disciplinary_actions g
         LEFT JOIN users a ON g.admin_id = a.id
         LEFT JOIN users r ON g.revoked_by = r.id
         WHERE g.user_id = ? ORDER BY g.created_at DESC`,
        [userId]
    );
    return rows.map(decorateDiscipline);
}

// 拉取某用户的全部贡献点流水，并按类型分组、补充详情
async function getContributionGroups(userId) {
    const logs = await db.all(
        'SELECT * FROM contribution_logs WHERE user_id = ? ORDER BY id DESC',
        [userId]
    );

    // 收集需联表补充详情的关键字
    const claimIds = [], taskIds = [], ptIds = [], titleIds = [], postIds = [], shopIds = [];
    logs.forEach(l => {
        if (l.type === 'claim' && l.ref_id) claimIds.push(l.ref_id);
        else if (l.type === 'task' && l.ref_id) taskIds.push(l.ref_id);
        else if (l.type === 'player_task' && l.ref_id) ptIds.push(l.ref_id);
        else if (l.type === 'title' && l.ref_id) titleIds.push(l.ref_id);
        else if (l.type === 'post' && l.ref_id) postIds.push(l.ref_id);
        else if (l.type === 'purchase' && l.ref_id) shopIds.push(l.ref_id);
    });

    const orZero = (arr) => arr.length ? arr : [0];
    const claims = claimIds.length ? await db.all(`SELECT id, reason, review_note, amount FROM contribution_claims WHERE id IN (${claimIds.map(() => '?').join(',')})`, orZero(claimIds)) : [];
    const tasks = taskIds.length ? await db.all(`SELECT id, title FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`, orZero(taskIds)) : [];
    const pts = ptIds.length ? await db.all(`SELECT id, title, reward FROM player_tasks WHERE id IN (${ptIds.map(() => '?').join(',')})`, orZero(ptIds)) : [];
    const titles = titleIds.length ? await db.all(`SELECT id, name FROM titles WHERE id IN (${titleIds.map(() => '?').join(',')})`, orZero(titleIds)) : [];
    const posts = postIds.length ? await db.all(`SELECT id, title, content FROM posts WHERE id IN (${postIds.map(() => '?').join(',')})`, orZero(postIds)) : [];
    const shops = shopIds.length ? await db.all(`SELECT id, name FROM shop_items WHERE id IN (${shopIds.map(() => '?').join(',')})`, orZero(shopIds)) : [];

    const map = (arr) => arr.reduce((m, r) => { m[r.id] = r; return m; }, {});
    const claimMap = map(claims), taskMap = map(tasks), ptMap = map(pts), titleMap = map(titles), postMap = map(posts), shopMap = map(shops);

    // 按用户类型分组（caller 传入的 userId 可能是被查询人，非登录者；流水本身已定位到 user）
    const groups = {};
    const order = [...GROUP_ORDER];
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
        if (!groups[type]) {
            groups[type] = { type, type_label: TYPE_LABELS[type] || type, items: [] };
            order.push(type);
        }
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

    // 按预设顺序整理
    const ordered = [];
    GROUP_ORDER.forEach(t => { if (groups[t]) ordered.push(groups[t]); });
    Object.keys(groups).forEach(t => { if (!GROUP_ORDER.includes(t)) ordered.push(groups[t]); });

    return { balance: (await db.get('SELECT COALESCE(contribution, 0) AS c FROM users WHERE id = ?', [userId]))?.c ?? 0, groups: ordered };
}

// 构建单个成员档案
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

    // 解析代系（手动优先，否则按 created_at 自动判定）
    let generation = null;
    try {
        const { resolveGeneration } = require('../lib/generation');
        const g = await resolveGeneration(user);
        if (g) generation = { name: g.name, color: g.color, manual: !!g.manual };
    } catch (e) { /* 代系解析失败不影响档案 */ }

    return {
        user: { ...user, generation },
        contribution,
        discipline,
        verify_code: generateVerifyCode(userId)
    };
}

// ===== 模糊查询成员（返回结果列表，供前端展示） =====
router.get('/query', async (req, res) => {
    try {
        const keyword = (req.query.keyword || '').trim();
        if (!keyword) {
            return res.status(400).json({ error: '请输入查询关键词' });
        }
        const like = `%${keyword}%`;
        const users = await db.all(
            `SELECT id, username, nickname, avatar, game_id, contribution, is_frozen
             FROM users
             WHERE username LIKE ? OR nickname LIKE ? OR CAST(id AS TEXT) = ?
             ORDER BY contribution DESC LIMIT 30`,
            [like, like, keyword]
        );
        res.json({ users });
    } catch (error) {
        logger.error('GMIRS 查询错误:', error);
        res.status(500).json({ error: '查询失败' });
    }
});

// ===== 单成员档案（贡献点明细分组 + 处分记录 + 防伪验证码） =====
router.get('/user/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (!id) return res.status(400).json({ error: '成员ID无效' });

        const archive = await buildArchive(id);
        if (!archive) return res.status(404).json({ error: '成员不存在' });

        res.json({ archive });
    } catch (error) {
        logger.error('GMIRS 档案错误:', error);
        res.status(500).json({ error: '获取档案失败' });
    }
});

// ===== 验证码查伪：校验某档案上的验证码是否真实有效 =====
router.get('/verify', async (req, res) => {
    try {
        const { code, userId } = req.query;
        if (!code) return res.status(400).json({ error: '请输入验证码' });

        if (userId) {
            const uid = parseInt(userId);
            const user = await db.get('SELECT id, username, nickname FROM users WHERE id = ?', [uid]);
            if (!user) return res.status(404).json({ error: '成员不存在' });
            return res.json({ valid: verifyCodeForUser(code, uid), user: { id: user.id, username: user.username, nickname: user.nickname } });
        }

        // 未指定 userId：扫描全部用户比对（用户量小，仅查询场景）
        const all = await db.all('SELECT id, username, nickname FROM users');
        const target = all.find(u => verifyCodeForUser(code, u.id));
        if (target) {
            return res.json({ valid: true, user: target });
        }
        res.json({ valid: false });
    } catch (error) {
        logger.error('GMIRS 验证码查伪错误:', error);
        res.status(500).json({ error: '查伪失败' });
    }
});

// ===== 一键导出所有成员档案（供前端批量生成 PDF/docx） =====
router.get('/export', async (req, res) => {
    try {
        const users = await db.all(
            'SELECT id FROM users ORDER BY id ASC'
        );
        const archives = [];
        for (const u of users) {
            const a = await buildArchive(u.id);
            if (a) archives.push(a);
        }
        res.json({ archives, exported_at: db.getLocalTimestamp() });
    } catch (error) {
        logger.error('GMIRS 导出错误:', error);
        res.status(500).json({ error: '导出失败' });
    }
});

// ===== 图片代理：将 CDN 头像转同源，绕过浏览器 CORS 限制（仅允许七牛 CDN） =====
router.get('/proxy-image', async (req, res) => {
    try {
        const url = String(req.query.url || '');
        // 仅允许白名单域名：七牛 CDN 与 QQ 头像（QQ 登录用户的头像存于 thirdqq.qlogo.cn）
        if (!/^https?:\/\/(cdn\.xuanjian\.top|thirdqq\.qlogo\.cn)\//.test(url)) {
            return res.status(400).json({ error: '不支持的图片地址' });
        }
        const resp = await fetch(url, { redirect: 'follow' });
        if (!resp.ok) {
            return res.status(404).json({ error: '图片不存在' });
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        res.set('Content-Type', resp.headers.get('content-type') || 'image/png');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(buf);
    } catch (error) {
        logger.error('GMIRS 图片代理错误:', error);
        res.status(500).json({ error: '获取图片失败' });
    }
});

module.exports = router;
