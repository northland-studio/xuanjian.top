/**
 * 聊天相关 REST 接口
 *  - GET  /api/chat/bubbles            气泡列表（含是否已拥有）
 *  - POST /api/chat/bubbles/:id/buy    购买气泡（消耗贡献点）
 *  - GET  /api/chat/history/public     公屏历史
 *  - GET  /api/chat/history/dm/:id     与某用户私聊历史
 *  - GET  /api/chat/online             在线人数
 *  - 管理端 /api/chat/admin/bubbles    气泡增删改（管理员）
 */
const express = require('express');
const db = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const logger = require('../lib/logger');
const chat = require('../lib/chat');

const router = express.Router();

// ============ 用户端 ============

// 气泡列表（标记是否已拥有）
router.get('/bubbles', authMiddleware, async (req, res) => {
    try {
        const bubbles = await db.all(
            'SELECT id, name, bg_color, text_color, border_color, price, sort_order FROM chat_bubbles WHERE is_active=1 ORDER BY sort_order, id'
        );
        const owned = await db.all('SELECT bubble_id FROM user_bubbles WHERE user_id=?', [req.userId]);
        const ownedSet = new Set(owned.map(o => o.bubble_id));
        res.json({
            bubbles: bubbles.map(b => ({
                id: b.id, name: b.name,
                bgColor: b.bg_color, textColor: b.text_color, borderColor: b.border_color || '',
                price: b.price, owned: ownedSet.has(b.id),
            })),
        });
    } catch (e) {
        logger.error('获取气泡列表失败:', e.message);
        res.status(500).json({ error: '获取气泡列表失败' });
    }
});

// 购买气泡
router.post('/bubbles/:id/buy', authMiddleware, async (req, res) => {
    try {
        const bubbleId = parseInt(req.params.id);
        const b = await db.get('SELECT * FROM chat_bubbles WHERE id=? AND is_active=1', [bubbleId]);
        if (!b) return res.status(404).json({ error: '气泡不存在或已下架' });

        const has = await db.get('SELECT id FROM user_bubbles WHERE user_id=? AND bubble_id=?', [req.userId, bubbleId]);
        if (has) return res.status(409).json({ error: '你已拥有该气泡' });

        const user = await db.get('SELECT id, contribution FROM users WHERE id=?', [req.userId]);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        if ((user.contribution || 0) < b.price) {
            return res.status(400).json({ error: `贡献点不足，需要 ${b.price}（当前 ${Math.floor(user.contribution || 0)}）` });
        }

        await db.transaction(async () => {
            if (b.price > 0) {
                await db.run('UPDATE users SET contribution = contribution - ? WHERE id=?', [b.price, req.userId]);
                const after = await db.get('SELECT contribution FROM users WHERE id=?', [req.userId]);
                await db.run(
                    'INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after) VALUES (?,?,?,?,?,?)',
                    [req.userId, -b.price, 'bubble', bubbleId, `购买聊天气泡「${b.name}」`, after ? after.contribution : null]
                );
            }
            await db.run('INSERT INTO user_bubbles (user_id, bubble_id) VALUES (?,?)', [req.userId, bubbleId]);
        });

        const upd = await db.get('SELECT contribution FROM users WHERE id=?', [req.userId]);
        logger.info(`气泡购买成功: user=${req.userId} bubble=${bubbleId} price=${b.price}`);
        res.json({ success: true, bubbleId, contribution: upd.contribution });
    } catch (e) {
        logger.error('购买气泡失败:', e.message);
        res.status(500).json({ error: '购买失败' });
    }
});

// 已拥有的气泡
router.get('/bubbles/mine', authMiddleware, async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT b.id, b.name, b.bg_color, b.text_color, b.border_color FROM user_bubbles ub
             JOIN chat_bubbles b ON b.id = ub.bubble_id WHERE ub.user_id=? ORDER BY b.sort_order, b.id`,
            [req.userId]
        );
        res.json({
            bubbles: rows.map(b => ({
                id: b.id, name: b.name, bgColor: b.bg_color, textColor: b.text_color, borderColor: b.border_color || '',
            })),
        });
    } catch (e) {
        res.status(500).json({ error: '获取失败' });
    }
});

// 公屏历史
router.get('/history/public', authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const messages = await chat.publicHistory(limit);
        res.json({ messages });
    } catch (e) {
        logger.error('读取公屏历史失败:', e.message);
        res.status(500).json({ error: '读取失败' });
    }
});

// 私聊历史
router.get('/history/dm/:id', authMiddleware, async (req, res) => {
    try {
        const other = parseInt(req.params.id);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const messages = await chat.dmHistory(req.userId, other, limit);
        res.json({ messages });
    } catch (e) {
        logger.error('读取私聊历史失败:', e.message);
        res.status(500).json({ error: '读取失败' });
    }
});

// 在线人数
router.get('/online', authMiddleware, (req, res) => {
    res.json({ online: chat.onlineCount() });
});

// ============ 管理端：气泡管理 ============

router.get('/admin/bubbles', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const bubbles = await db.all('SELECT * FROM chat_bubbles ORDER BY sort_order, id');
        res.json({ bubbles });
    } catch (e) {
        res.status(500).json({ error: '获取失败' });
    }
});

router.post('/admin/bubbles', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, bg_color, text_color, border_color, price, is_active, sort_order } = req.body;
        if (!name || !String(name).trim()) return res.status(400).json({ error: '气泡名称必填' });
        const r = await db.run(
            'INSERT INTO chat_bubbles (name, bg_color, text_color, border_color, price, is_active, sort_order) VALUES (?,?,?,?,?,?,?)',
            [String(name).trim(), bg_color || '#e8f0fe', text_color || '#1a3d7c', border_color || '',
             parseInt(price) || 0, is_active === false ? 0 : 1, parseInt(sort_order) || 0]
        );
        logger.info(`新增气泡: id=${r.id} name=${name}`);
        res.status(201).json({ success: true, id: r.id });
    } catch (e) {
        logger.error('新增气泡失败:', e.message);
        res.status(500).json({ error: '新增失败' });
    }
});

router.put('/admin/bubbles/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, bg_color, text_color, border_color, price, is_active, sort_order } = req.body;
        await db.run(
            `UPDATE chat_bubbles SET name=?, bg_color=?, text_color=?, border_color=?, price=?, is_active=?, sort_order=? WHERE id=?`,
            [String(name || '').trim(), bg_color || '#e8f0fe', text_color || '#1a3d7c', border_color || '',
             parseInt(price) || 0, is_active === false ? 0 : 1, parseInt(sort_order) || 0, req.params.id]
        );
        logger.info(`修改气泡: id=${req.params.id} price=${price}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('修改气泡失败:', e.message);
        res.status(500).json({ error: '修改失败' });
    }
});

router.delete('/admin/bubbles/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        await db.run('DELETE FROM chat_bubbles WHERE id=?', [req.params.id]);
        logger.info(`删除气泡: id=${req.params.id}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '删除失败' });
    }
});

// 管理端：公屏消息删除（治理用）
router.delete('/admin/messages/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        await db.run('DELETE FROM chat_messages WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '删除失败' });
    }
});

module.exports = router;
