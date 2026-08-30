/**
 * QQ 群机器人绑定接口（供 xuanjian-group-bot 子项目调用）
 *
 * 安全设计：
 *  - bot 侧写操作（发起绑定）需携带 X-Bot-Token 请求头，与官网 .env 中 QQBOT_TOKEN 一致。
 *  - 用户确认绑定需走官网登录态（JWT），bot 无法替用户确认。
 *  - 一次性绑定码短时效（10 分钟）、幂等、可重复发起。
 *
 * 绑定流程：
 *  1. 群内发 `#绑定 <用户名>` → bot 调 POST /api/qqbot/bind {qq, username}
 *     → 官网定位账号，生成一次性码（过期旧码），返回 code
 *  2. 用户到官网个人设置页输入码 → POST /api/qqbot/confirm {code}
 *     → 校验码 + 过期时间 + 未使用 → 写 users.qq = 该 qq，码置 confirmed
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { addContributionLog } = require('../lib/contribution');
const { createNotification } = require('./notifications');
const router = express.Router();

const BOT_TOKEN = process.env.QQBOT_TOKEN || '';
const CODE_TTL_MIN = 10; // 绑定码有效期（分钟）

/** 校验 bot token */
function botTokenAuth(req, res, next) {
    const token = req.headers['x-bot-token'];
    if (!BOT_TOKEN || token !== BOT_TOKEN) {
        return res.status(401).json({ error: 'bot token 无效' });
    }
    next();
}

// ===== 机器人：发起绑定（生成一次性码） =====
router.post('/bind', botTokenAuth, async (req, res) => {
    try {
        const qq = String(req.body.qq || '').trim();
        const username = String(req.body.username || '').trim();
        if (!qq || !/^\d{5,12}$/.test(qq)) {
            return res.status(400).json({ error: 'QQ 号无效' });
        }
        if (!username) {
            return res.status(400).json({ error: '用户名无效' });
        }

        // 定位账号（用户名或昵称精确匹配优先）
        let user = await db.get('SELECT id, username, nickname, qq FROM users WHERE username = ?', [username]);
        if (!user) user = await db.get('SELECT id, username, nickname, qq FROM users WHERE nickname = ?', [username]);
        if (!user) {
            return res.status(404).json({ error: '官网账号不存在' });
        }
        // 若该账号已绑定其他 QQ，拒绝
        if (user.qq && user.qq !== qq) {
            return res.status(409).json({ error: `该账号已绑定 QQ ${user.qq}，如需更换请先解绑` });
        }
        // 若该 QQ 已被其他账号绑定，拒绝
        const qqOwner = await db.get('SELECT id, username FROM users WHERE qq = ? AND id != ?', [qq, user.id]);
        if (qqOwner) {
            return res.status(409).json({ error: `该 QQ 已绑定账号「${qqOwner.username}」` });
        }

        // 使旧绑定码失效，生成新码
        const code = crypto.randomInt(100000, 1000000).toString(); // 6 位
        await db.run(
            "UPDATE qq_bindings SET status = 'expired' WHERE qq = ? AND status = 'pending'",
            [qq]
        );
        await db.run(
            'INSERT INTO qq_bindings (qq, user_id, code, status, created_at) VALUES (?, ?, ?, ?, ?)',
            [qq, user.id, code, 'pending', getLocalTimestamp()]
        );

        logger.info(`[qqbot] 发起绑定: qq=${qq} -> user=${user.username} (id=${user.id})`);
        res.json({ success: true, code, username: user.username, nickname: user.nickname, expireMinutes: CODE_TTL_MIN });
    } catch (e) {
        logger.error('QQ 绑定发起错误:', e);
        res.status(500).json({ error: '发起绑定失败' });
    }
});

// ===== 用户：确认绑定（登录态，输入一次性码） =====
router.post('/confirm', authMiddleware, async (req, res) => {
    try {
        const code = String(req.body.code || '').trim();
        const qq = String(req.body.qq || '').trim();
        if (!code || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ error: '请输入 6 位绑定码' });
        }
        if (!qq || !/^\d{5,12}$/.test(qq)) {
            return res.status(400).json({ error: 'QQ 号无效' });
        }

        const binding = await db.get(
            'SELECT * FROM qq_bindings WHERE code = ? AND qq = ? AND status = ?',
            [code, qq, 'pending']
        );
        if (!binding) {
            return res.status(404).json({ error: '绑定码无效或已过期，请重新在群里发起绑定' });
        }
        if (binding.user_id !== req.userId) {
            return res.status(403).json({ error: '该绑定码不属于当前账号' });
        }
        // 校验过期时间
        const created = Date.parse(String(binding.created_at).replace(' ', 'T'));
        if (!isNaN(created) && (Date.now() - created) > CODE_TTL_MIN * 60 * 1000) {
            await db.run("UPDATE qq_bindings SET status = 'expired' WHERE id = ?", [binding.id]);
            return res.status(400).json({ error: '绑定码已过期，请重新在群里发起绑定' });
        }

        await db.transaction(async () => {
            await db.run('UPDATE users SET qq = ? WHERE id = ?', [qq, req.userId]);
            await db.run(
                "UPDATE qq_bindings SET status = 'confirmed', confirmed_at = ? WHERE id = ?",
                [getLocalTimestamp(), binding.id]
            );
        });

        const u = await db.get('SELECT username, nickname FROM users WHERE id = ?', [req.userId]);
        logger.info(`[qqbot] 确认绑定: user=${u?.username} (id=${req.userId}) <-> qq=${qq}`);
        res.json({ success: true, message: '绑定成功', qq, username: u?.username, nickname: u?.nickname });
    } catch (e) {
        logger.error('QQ 绑定确认错误:', e);
        res.status(500).json({ error: '确认绑定失败' });
    }
});

// ===== 用户：查询当前账号绑定状态（登录态） =====
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await db.get('SELECT id, username, nickname, qq FROM users WHERE id = ?', [req.userId]);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        res.json({ bound: !!user.qq, qq: user.qq || null, username: user.username, nickname: user.nickname });
    } catch (e) {
        logger.error('QQ 绑定状态查询错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

// ===== 机器人：按 QQ 查绑定用户（供 #查自己） =====
router.get('/user', botTokenAuth, async (req, res) => {
    try {
        const qq = String(req.query.qq || '').trim();
        if (!qq) return res.status(400).json({ error: '缺少 qq 参数' });
        const user = await db.get('SELECT id, username, nickname, qq FROM users WHERE qq = ?', [qq]);
        if (!user) return res.json({ bound: false });
        res.json({ bound: true, user });
    } catch (e) {
        logger.error('QQ 绑定用户查询错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

// ===== 机器人：核销码验证（群内普通成员可查，bot token） =====
router.post('/verify-code', botTokenAuth, async (req, res) => {
    try {
        const code = String(req.body.code || '').trim().toUpperCase();
        if (!code) return res.status(400).json({ error: '请输入核销码' });

        // 核销码本身绑定消费用户，持码即可查询核销信息与状态，无需身份验证
        const item = await db.get(
            `SELECT ui.*, si.name, si.description, si.type, u.username, u.nickname
             FROM user_items ui
             JOIN shop_items si ON ui.item_id = si.id
             JOIN users u ON ui.user_id = u.id
             WHERE ui.verification_code = ?`,
            [code]
        );
        if (!item) return res.status(404).json({ error: '核销码无效' });

        const batch = await db.get(
            `SELECT COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN verified_at IS NULL THEN 1 ELSE 0 END), 0) AS remaining
             FROM user_items WHERE verification_code = ?`,
            [code]
        );

        if (item.verified_at) {
            return res.json({
                valid: true, already: true,
                total: batch?.total || 1, remaining: batch?.remaining || 0,
                verifiedAt: item.verified_at,
                item: { id: item.id, name: item.name, description: item.description, type: item.type,
                        buyer: item.nickname || item.username, purchasedAt: item.purchased_at }
            });
        }
        res.json({
            valid: true, quantity: batch?.remaining || 1, total: batch?.total || 1, remaining: batch?.remaining || 0,
            item: { id: item.id, name: item.name, description: item.description, type: item.type,
                    buyer: item.nickname || item.username, purchasedAt: item.purchased_at }
        });
    } catch (e) {
        logger.error('QQ 机器人核销验证错误:', e);
        res.status(500).json({ error: '核销验证失败' });
    }
});

// ===== 机器人：核销确认（管理员私聊操作，bot token） =====
router.post('/confirm-code', botTokenAuth, async (req, res) => {
    try {
        const code = String(req.body.code || '').trim().toUpperCase();
        const qq = String(req.body.qq || '').trim();
        if (!code) return res.status(400).json({ error: '请输入核销码' });
        if (!qq) return res.status(400).json({ error: '缺少操作者 QQ' });

        const op = await db.get('SELECT id, level FROM users WHERE qq = ?', [qq]);
        if (!op || (op.level || 0) < 1) return res.status(403).json({ error: '权限不足：仅管理员可核销' });

        const item = await db.get(
            `SELECT ui.*, si.name, si.type FROM user_items ui
             JOIN shop_items si ON ui.item_id = si.id
             WHERE ui.verification_code = ?`,
            [code]
        );
        if (!item) return res.status(404).json({ error: '核销码无效' });

        const pending = await db.get(
            'SELECT COUNT(*) AS c FROM user_items WHERE verification_code = ? AND verified_at IS NULL',
            [code]
        );
        if (!pending?.c) {
            const done = await db.get(
                'SELECT verified_at FROM user_items WHERE verification_code = ? AND verified_at IS NOT NULL LIMIT 1',
                [code]
            );
            return res.json({ message: '该核销码已核销', itemName: item.name, already: true, verifiedAt: done?.verified_at || null });
        }

        await db.run(
            'UPDATE user_items SET verified_at = ?, verified_by = ? WHERE verification_code = ? AND verified_at IS NULL',
            [getLocalTimestamp(), op.id, code]
        );

        try {
            await createNotification({
                userId: item.user_id, type: 'purchase', title: '商品已核销',
                content: `您的「${item.name}」已由管理员核销（共 ${pending.c} 件）。`
            });
        } catch (ne) { /* 忽略 */ }

        logger.info(`[qqbot] 核销: code=${code} by user=${op.id}(${qq})`);
        res.json({ message: '核销成功', itemName: item.name, quantity: pending.c });
    } catch (e) {
        logger.error('QQ 机器人核销确认错误:', e);
        res.status(500).json({ error: '核销失败' });
    }
});

// ===== 机器人：玩家任务完成验证码（接取者私聊提交，bot token） =====
router.post('/task-complete', botTokenAuth, async (req, res) => {
    try {
        const taskId = parseInt(req.body.taskId);
        const code = String(req.body.code || '').trim();
        const qq = String(req.body.qq || '').trim();
        if (!taskId || !code) return res.status(400).json({ error: '参数不完整' });
        if (!qq) return res.status(400).json({ error: '缺少提交者 QQ' });

        const user = await db.get('SELECT id, username, nickname FROM users WHERE qq = ?', [qq]);
        if (!user) return res.status(404).json({ error: '该 QQ 未绑定官网账号' });

        const task = await db.get('SELECT * FROM player_tasks WHERE id = ?', [taskId]);
        if (!task) return res.status(404).json({ error: '任务不存在' });

        // 校验该用户是否接取该玩家任务（多人接取模型）
        const claim = await db.get(
            'SELECT * FROM player_task_claims WHERE task_id = ? AND user_id = ?',
            [taskId, user.id]
        );
        if (!claim) return res.status(400).json({ error: '请先接取该任务' });
        if (claim.status === 'completed') return res.status(400).json({ error: '您已完成该任务' });
        if (task.status === 'cancelled') return res.status(400).json({ error: '任务已取消' });
        if (String(code).trim().toUpperCase() !== task.code.toUpperCase()) {
            return res.status(400).json({ error: '验证码错误' });
        }

        await db.transaction(async () => {
            await db.run(
                'UPDATE player_task_claims SET status = ?, code = ?, completed_at = ? WHERE id = ?',
                ['completed', String(code).trim().toUpperCase(), getLocalTimestamp(), claim.id]
            );
            await db.run(
                'UPDATE users SET contribution = contribution + ?, updated_at = ? WHERE id = ?',
                [task.reward, getLocalTimestamp(), user.id]
            );
        });
        await addContributionLog(user.id, task.reward, 'player_task', task.id, `完成玩家任务：${task.title}`);

        try {
            await createNotification({
                userId: task.author_id, type: 'player_task', title: '任务有人完成',
                content: `您的玩家任务「${task.title}」有成员完成，${task.reward} 贡献点已发放`
            });
        } catch (ne) { /* 忽略 */ }

        logger.info(`[qqbot] 任务完成: task=${taskId} by user=${user.id}(${qq})`);
        res.json({ message: '任务完成，贡献点已到账', reward: task.reward });
    } catch (e) {
        logger.error('QQ 机器人任务完成错误:', e);
        res.status(500).json({ error: '操作失败' });
    }
});

module.exports = router;
