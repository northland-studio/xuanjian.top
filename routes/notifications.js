const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

// 获取用户通知列表
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const notifications = await db.all(
            `SELECT n.*, 
                    p.title as post_title, p.type as post_type,
                    c.content as comment_content,
                    u.nickname as actor_nickname, u.avatar as actor_avatar
             FROM notifications n
             LEFT JOIN posts p ON n.post_id = p.id
             LEFT JOIN comments c ON n.comment_id = c.id
             LEFT JOIN users u ON n.actor_id = u.id
             WHERE n.user_id = ?
             ORDER BY n.created_at DESC
             LIMIT ? OFFSET ?`,
            [req.userId, parseInt(limit), parseInt(offset)]
        );

        // 获取未读通知数量
        const unreadCount = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.userId]
        );

        res.json({
            notifications,
            unreadCount: unreadCount.count,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('获取通知错误:', error);
        res.status(500).json({ error: '获取通知失败' });
    }
});

// 标记通知为已读
router.put('/:id/read', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.run(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
            [id, req.userId]
        );
        
        res.json({ message: '已标记为已读' });
    } catch (error) {
        console.error('标记通知已读错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 标记所有通知为已读
router.put('/read-all', authMiddleware, async (req, res) => {
    try {
        await db.run(
            'UPDATE notifications SET is_read = 1 WHERE user_id = ?',
            [req.userId]
        );
        
        res.json({ message: '已全部标记为已读' });
    } catch (error) {
        console.error('标记所有通知已读错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 删除通知
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.run(
            'DELETE FROM notifications WHERE id = ? AND user_id = ?',
            [id, req.userId]
        );
        
        res.json({ message: '删除成功' });
    } catch (error) {
        console.error('删除通知错误:', error);
        res.status(500).json({ error: '删除失败' });
    }
});

// 创建通知的辅助函数（供其他路由调用）
async function createNotification({ userId, type, title, content, postId, commentId, actorId }) {
    try {
        await db.run(
            `INSERT INTO notifications (user_id, type, title, content, post_id, comment_id, actor_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, type, title, content, postId, commentId, actorId]
        );
    } catch (error) {
        console.error('创建通知错误:', error);
    }
}

module.exports = { router, createNotification };
