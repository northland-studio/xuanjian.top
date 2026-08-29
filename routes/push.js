/**
 * Web Push 订阅管理路由
 * - GET  /api/push/vapid-public-key  前端获取 VAPID 公钥（用于 PushManager.subscribe）
 * - POST /api/push/subscribe         保存用户订阅
 * - POST /api/push/unsubscribe       删除用户订阅
 * - GET  /api/push/status            查询当前用户是否已订阅
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { getPublicKey, isEnabled } = require('../lib/push');
const router = express.Router();

// VAPID 公钥
router.get('/vapid-public-key', async (req, res) => {
    res.json({ publicKey: getPublicKey(), enabled: isEnabled() });
});

// 保存订阅
router.post('/subscribe', authMiddleware, async (req, res) => {
    try {
        const { subscription } = req.body;
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ error: '无效的订阅信息' });
        }
        await db.run(
            `INSERT INTO push_subscriptions (user_id, endpoint, subscription_json)
             VALUES (?, ?, ?)
             ON CONFLICT(endpoint) DO UPDATE SET subscription_json = excluded.subscription_json`,
            [req.userId, subscription.endpoint, JSON.stringify(subscription)]
        );
        res.json({ success: true });
    } catch (error) {
        logger.error('保存 Web Push 订阅错误:', error);
        res.status(500).json({ error: '订阅失败' });
    }
});

// 取消订阅
router.post('/unsubscribe', authMiddleware, async (req, res) => {
    try {
        const { endpoint } = req.body;
        if (endpoint) {
            await db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [req.userId, endpoint]);
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('取消 Web Push 订阅错误:', error);
        res.status(500).json({ error: '取消订阅失败' });
    }
});

// 查询当前用户订阅状态
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const count = await db.get('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?', [req.userId]);
        res.json({ subscribed: (count?.c || 0) > 0, enabled: isEnabled() });
    } catch (error) {
        logger.error('查询订阅状态错误:', error);
        res.status(500).json({ error: '查询失败' });
    }
});

module.exports = router;
