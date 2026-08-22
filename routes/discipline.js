const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { addContributionLog } = require('../lib/contribution');
const router = express.Router();

const LEVEL_TEXT = { 1: '全会通报批评', 2: '全会通报批评+扣除贡献点', 3: '开除会籍（冻结账号）' };

// 校验收款对象是否为有效成员
async function getUserByFuzzy(keyword) {
    if (!keyword) return null;
    const like = `%${keyword}%`;
    return await db.get(
        'SELECT id, username, nickname, is_frozen, contribution FROM users WHERE username = ? OR nickname = ? LIMIT 1',
        [keyword, keyword]
    );
}

// 处理一条处分记录（含关联用户信息）
function decorate(row) {
    if (!row) return row;
    row.level_text = LEVEL_TEXT[row.level] || '未知';
    row.is_active = !row.revoked_at;
    return row;
}

// ===== 管理员：新增处分 =====
router.post('/', adminMiddleware, async (req, res) => {
    try {
        const { userId, username, level, reason, extra_penalty, deduct_points } = req.body;
        const lv = parseInt(level);

        if (![1, 2, 3].includes(lv)) {
            return res.status(400).json({ error: '处分级别无效' });
        }
        if (!reason || reason.trim().length < 2) {
            return res.status(400).json({ error: '请填写处分理由（至少2个字符）' });
        }

        // 通过 userId 或 username 定位目标用户
        let target = null;
        if (userId) {
            target = await db.get('SELECT id, username, nickname, is_frozen, contribution FROM users WHERE id = ?', [userId]);
        } else if (username) {
            target = await getUserByFuzzy(username);
            // 精确匹配优先：若模糊命中多个需引导精确
            if (target) {
                const exact = await db.get('SELECT id, username, nickname, is_frozen, contribution FROM users WHERE username = ?', [username]);
                if (exact) target = exact;
            }
        }
        if (!target) {
            return res.status(404).json({ error: '目标用户不存在' });
        }

        // level2 必须扣点；level3 扣点可选
        let actualDeduct = 0;
        if (lv === 2) {
            actualDeduct = parseInt(deduct_points);
            if (!(actualDeduct >= 1)) {
                return res.status(400).json({ error: '级别②必须填写扣除的贡献点数量（≥1）' });
            }
        } else if (lv === 3) {
            actualDeduct = parseInt(deduct_points) || 0;
            if (actualDeduct < 0) actualDeduct = 0;
        }

        const created = await db.transaction(async () => {
            const result = await db.run(
                `INSERT INTO guild_disciplinary_actions (user_id, level, reason, extra_penalty, deduct_points, admin_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [target.id, lv, reason.trim(), (extra_penalty || '').trim(), actualDeduct, req.userId, getLocalTimestamp()]
            );
            const actionId = result.id;

            if (actualDeduct > 0) {
                // 实际扣除 = min(请求扣点, 当前余额)，保证余额不会为负
                const balance = target.contribution || 0;
                const toDeduct = Math.min(actualDeduct, balance);
                await db.run('UPDATE users SET contribution = COALESCE(contribution, 0) - ? WHERE id = ?', [toDeduct, target.id]);
                await addContributionLog(target.id, -toDeduct, 'discipline', actionId, `处分：${LEVEL_TEXT[lv]}，${reason.trim()}`);
                // 记录实际扣除额，便于撤销时精确返还
                await db.run('UPDATE guild_disciplinary_actions SET deduct_points = ? WHERE id = ?', [toDeduct, actionId]);
            }

            // 其他处分级别先行解除旧的开除冻结记录？
            if (lv === 3) {
                await db.run('UPDATE users SET is_frozen = 1 WHERE id = ?', [target.id]);
            }

            return actionId;
        });

        res.status(201).json({ success: true, actionId: created, deducted: actualDeduct });
    } catch (error) {
        logger.error('新增处分错误:', error);
        res.status(500).json({ error: '处分失败', detail: error.message });
    }
});

// ===== 管理员：撤销/解除处分 =====
router.post('/:id/revoke', adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const action = await db.get('SELECT * FROM guild_disciplinary_actions WHERE id = ?', [id]);
        if (!action) {
            return res.status(404).json({ error: '处分记录不存在' });
        }
        if (action.revoked_at) {
            return res.status(400).json({ error: '该处分已撤销' });
        }

        await db.transaction(async () => {
            await db.run(
                'UPDATE guild_disciplinary_actions SET revoked_at = ?, revoked_by = ?, revoked_reason = ? WHERE id = ?',
                [getLocalTimestamp(), req.userId, (reason || '').trim(), id]
            );
            // 撤销扣分处分 → 返还贡献点
            if (action.deduct_points > 0) {
                await db.run('UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?', [action.deduct_points, action.user_id]);
                await addContributionLog(action.user_id, action.deduct_points, 'discipline', id, '撤销处分，返还贡献点');
            }
            // 撤销开除 → 若无其他生效中的开除处分，则解除冻结
            if (action.level === 3) {
                const others = await db.get(
                    'SELECT COUNT(*) AS c FROM guild_disciplinary_actions WHERE user_id = ? AND level = 3 AND revoked_at IS NULL AND id != ?',
                    [action.user_id, id]
                );
                if (!others || others.c === 0) {
                    await db.run('UPDATE users SET is_frozen = 0 WHERE id = ?', [action.user_id]);
                }
            }
        });

        res.json({ success: true, message: '处分已撤销' });
    } catch (error) {
        logger.error('撤销处分错误:', error);
        res.status(500).json({ error: '撤销失败', detail: error.message });
    }
});

// ===== 管理员：处分列表（可筛选） =====
router.get('/list', adminMiddleware, async (req, res) => {
    try {
        const { status, level, userId } = req.query;
        let sql = `
            SELECT g.*, u.username, u.nickname, u.avatar, u.is_frozen,
                   a.username AS admin_name
            FROM guild_disciplinary_actions g
            JOIN users u ON g.user_id = u.id
            LEFT JOIN users a ON g.admin_id = a.id
            WHERE 1=1
        `;
        const params = [];
        if (status === 'active') sql += ' AND g.revoked_at IS NULL';
        else if (status === 'revoked') sql += ' AND g.revoked_at IS NOT NULL';
        if (level) { sql += ' AND g.level = ?'; params.push(parseInt(level)); }
        if (userId) { sql += ' AND g.user_id = ?'; params.push(parseInt(userId)); }
        sql += ' ORDER BY g.created_at DESC LIMIT 100';

        const rows = await db.all(sql, params);
        rows.forEach(decorate);
        res.json({ actions: rows });
    } catch (error) {
        logger.error('获取处分列表错误:', error);
        res.status(500).json({ error: '获取处分列表失败' });
    }
});

// ===== 面向用户：按用户名/昵称模糊查询处分记录（GDARS 前端，公开接口） =====
router.get('/query', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username || !username.trim()) {
            return res.status(400).json({ error: '请输入查询关键词' });
        }
        const keyword = username.trim();
        const like = `%${keyword}%`;
        const users = await db.all(
            'SELECT id, username, nickname, avatar, is_frozen, contribution FROM users WHERE username LIKE ? OR nickname LIKE ? OR CAST(id AS TEXT) = ? ORDER BY contribution DESC LIMIT 20',
            [like, like, keyword]
        );

        const results = [];
        for (const u of users) {
            const actions = await db.all(
                `SELECT g.*, a.username AS admin_name
                 FROM guild_disciplinary_actions g
                 LEFT JOIN users a ON g.admin_id = a.id
                 WHERE g.user_id = ? ORDER BY g.created_at DESC`,
                [u.id]
            );
            results.push({ user: u, actions: actions.map(decorate) });
        }

        res.json({ results });
    } catch (error) {
        logger.error('GDARS 查询错误:', error);
        res.status(500).json({ error: '查询失败' });
    }
});

// ===== 单个用户的处分记录（GMIRS 档案用，公开） =====
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const actions = await db.all(
            `SELECT g.*, a.username AS admin_name
             FROM guild_disciplinary_actions g
             LEFT JOIN users a ON g.admin_id = a.id
             WHERE g.user_id = ? ORDER BY g.created_at DESC`,
            [parseInt(userId)]
        );
        res.json({ actions: actions.map(decorate) });
    } catch (error) {
        logger.error('获取用户处分记录错误:', error);
        res.status(500).json({ error: '获取处分记录失败' });
    }
});

module.exports = router;
