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

module.exports = router;
