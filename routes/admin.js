const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');
const router = express.Router();

// 获取所有用户（管理员）
router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (search) {
            whereClause += ' AND (username LIKE ? OR nickname LIKE ? OR email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        const users = await db.all(
            `SELECT id, username, nickname, email, level, contribution, avatar, created_at 
             FROM users ${whereClause} 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );
        
        const countResult = await db.get(
            `SELECT COUNT(*) as total FROM users ${whereClause}`,
            params
        );
        
        res.json({
            users,
            total: countResult.total,
            page: parseInt(page),
            totalPages: Math.ceil(countResult.total / limit)
        });
    } catch (error) {
        console.error('获取用户列表错误:', error);
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

// 更新用户信息（管理员）
router.put('/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { nickname, email, password } = req.body;
        
        let updates = [];
        let params = [];
        
        if (nickname) {
            updates.push('nickname = ?');
            params.push(nickname);
        }
        
        if (email) {
            updates.push('email = ?');
            params.push(email);
        }
        
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updates.push('password = ?');
            params.push(hashedPassword);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: '没有要更新的字段' });
        }
        
        params.push(id);
        
        await db.run(
            `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            params
        );
        
        res.json({ message: '用户信息更新成功' });
    } catch (error) {
        console.error('更新用户信息错误:', error);
        res.status(500).json({ error: '更新用户信息失败' });
    }
});

// 设置用户等级（超级管理员）
router.put('/users/:id/level', authMiddleware, superAdminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { level } = req.body;
        
        if (level === undefined || level < 0 || level > 2) {
            return res.status(400).json({ error: '无效的用户等级' });
        }
        
        await db.run(
            'UPDATE users SET level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [level, id]
        );
        
        res.json({ message: '用户等级设置成功' });
    } catch (error) {
        console.error('设置用户等级错误:', error);
        res.status(500).json({ error: '设置用户等级失败' });
    }
});

// 获取所有内容（管理员）
router.get('/posts', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 20, type, status } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (type) {
            whereClause += ' AND p.type = ?';
            params.push(type);
        }
        
        if (status) {
            whereClause += ' AND p.status = ?';
            params.push(status);
        }
        
        const posts = await db.all(
            `SELECT p.*, u.nickname as author_nickname 
             FROM posts p
             LEFT JOIN users u ON p.author_id = u.id
             ${whereClause}
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );
        
        const countResult = await db.get(
            `SELECT COUNT(*) as total FROM posts p ${whereClause}`,
            params
        );
        
        res.json({
            posts,
            total: countResult.total,
            page: parseInt(page),
            totalPages: Math.ceil(countResult.total / limit)
        });
    } catch (error) {
        console.error('获取内容列表错误:', error);
        res.status(500).json({ error: '获取内容列表失败' });
    }
});

// 置顶/取消置顶内容
router.put('/posts/:id/pin', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { isPinned } = req.body;
        
        await db.run(
            'UPDATE posts SET is_pinned = ? WHERE id = ?',
            [isPinned ? 1 : 0, id]
        );
        
        res.json({ message: isPinned ? '置顶成功' : '取消置顶成功' });
    } catch (error) {
        console.error('置顶操作错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 获取公告列表
router.get('/announcements', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const announcements = await db.all(
            `SELECT a.*, u.nickname as creator_nickname 
             FROM announcements a
             LEFT JOIN users u ON a.created_by = u.id
             ORDER BY a.created_at DESC`
        );
        
        res.json(announcements);
    } catch (error) {
        console.error('获取公告列表错误:', error);
        res.status(500).json({ error: '获取公告列表失败' });
    }
});

// 创建公告
router.post('/announcements', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { title, content, isPopup, isActive } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({ error: '标题和内容不能为空' });
        }
        
        const result = await db.run(
            'INSERT INTO announcements (title, content, is_popup, is_active, created_by) VALUES (?, ?, ?, ?, ?)',
            [title, content, isPopup ? 1 : 0, isActive ? 1 : 0, req.userId]
        );
        
        res.status(201).json({
            message: '公告创建成功',
            announcementId: result.id
        });
    } catch (error) {
        console.error('创建公告错误:', error);
        res.status(500).json({ error: '创建公告失败' });
    }
});

// 更新公告
router.put('/announcements/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, isPopup, isActive } = req.body;
        
        await db.run(
            'UPDATE announcements SET title = ?, content = ?, is_popup = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [title, content, isPopup ? 1 : 0, isActive ? 1 : 0, id]
        );
        
        res.json({ message: '公告更新成功' });
    } catch (error) {
        console.error('更新公告错误:', error);
        res.status(500).json({ error: '更新公告失败' });
    }
});

// 删除公告
router.delete('/announcements/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.run('DELETE FROM announcements WHERE id = ?', [id]);
        
        res.json({ message: '公告删除成功' });
    } catch (error) {
        console.error('删除公告错误:', error);
        res.status(500).json({ error: '删除公告失败' });
    }
});

// 获取统计数据
router.get('/statistics', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        const postCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE status = "active"');
        const commentCount = await db.get('SELECT COUNT(*) as count FROM comments WHERE status = "active"');
        const dailyCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE type = "daily" AND status = "active"');
        const decisionCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE type = "decision" AND status = "active"');
        const forumCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE type = "forum" AND status = "active"');
        
        // 获取最近7天的发布统计
        const recentPosts = await db.all(
            `SELECT DATE(created_at) as date, COUNT(*) as count 
             FROM posts 
             WHERE created_at >= DATE('now', '-7 days')
             GROUP BY DATE(created_at)
             ORDER BY date`
        );
        
        res.json({
            users: userCount.count,
            posts: postCount.count,
            comments: commentCount.count,
            daily: dailyCount.count,
            decisions: decisionCount.count,
            forums: forumCount.count,
            recentPosts
        });
    } catch (error) {
        console.error('获取统计数据错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

module.exports = router;
