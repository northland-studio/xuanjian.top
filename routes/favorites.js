/**
 * 收藏帖子 / 关注用户动态
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const router = express.Router();

/* ============ 收藏 ============ */

// 收藏 / 取消收藏（toggle）
router.post('/posts/:postId', authMiddleware, async (req, res) => {
    try {
        const { postId } = req.params;
        const post = await db.get('SELECT id FROM posts WHERE id = ? AND status = "active"', [postId]);
        if (!post) return res.status(404).json({ error: '帖子不存在' });

        const existing = await db.get(
            'SELECT id FROM favorites WHERE user_id = ? AND post_id = ?',
            [req.userId, postId]
        );

        if (existing) {
            await db.run('DELETE FROM favorites WHERE id = ?', [existing.id]);
            return res.json({ message: '已取消收藏', favorited: false });
        }

        await db.run(
            'INSERT INTO favorites (user_id, post_id) VALUES (?, ?)',
            [req.userId, postId]
        );
        res.json({ message: '收藏成功', favorited: true });
    } catch (error) {
        logger.error('收藏操作错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 我的收藏列表（含帖子信息）
router.get('/posts', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const favorites = await db.all(
            `SELECT f.id AS favorite_id, f.created_at AS favorited_at,
                    p.id, p.title, p.type, p.likes, p.views, p.created_at,
                    u.nickname AS author_nickname, u.username AS author_username
             FROM favorites f
             JOIN posts p ON f.post_id = p.id AND p.status = 'active'
             JOIN users u ON p.author_id = u.id
             WHERE f.user_id = ?
             ORDER BY f.id DESC LIMIT ? OFFSET ?`,
            [req.userId, parseInt(limit), parseInt(offset)]
        );
        res.json({ favorites });
    } catch (error) {
        logger.error('获取收藏列表错误:', error);
        res.status(500).json({ error: '获取收藏失败' });
    }
});

// 检查是否已收藏（帖子详情页用）
router.get('/posts/:postId/check', authMiddleware, async (req, res) => {
    try {
        const existing = await db.get(
            'SELECT id FROM favorites WHERE user_id = ? AND post_id = ?',
            [req.userId, req.params.postId]
        );
        res.json({ favorited: !!existing });
    } catch (error) {
        logger.error('检查收藏状态错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

/* ============ 关注 ============ */

// 关注 / 取关（toggle）
router.post('/users/:userId', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const toId = parseInt(userId);

        if (toId === req.userId) {
            return res.status(400).json({ error: '不能关注自己' });
        }
        const target = await db.get('SELECT id, nickname, username FROM users WHERE id = ?', [toId]);
        if (!target) return res.status(404).json({ error: '用户不存在' });

        const existing = await db.get(
            'SELECT id FROM follows WHERE follower_id = ? AND followee_id = ?',
            [req.userId, toId]
        );

        if (existing) {
            await db.run('DELETE FROM follows WHERE id = ?', [existing.id]);
            return res.json({ message: '已取消关注', following: false });
        }

        await db.run(
            'INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)',
            [req.userId, toId]
        );

        try {
            const me = await db.get('SELECT nickname, username FROM users WHERE id = ?', [req.userId]);
            await createNotification({
                userId: toId,
                type: 'follow',
                title: '新的关注',
                content: `${me.nickname || me.username} 关注了你`,
                actorId: req.userId
            });
        } catch (e) {
            logger.error('关注通知失败:', e.message);
        }

        res.json({ message: '关注成功', following: true });
    } catch (error) {
        logger.error('关注操作错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 我关注的人
router.get('/users', authMiddleware, async (req, res) => {
    try {
        const follows = await db.all(
            `SELECT f.id AS follow_id, f.created_at AS followed_at,
                    u.id, u.nickname, u.username, u.avatar, u.level, u.contribution
             FROM follows f
             JOIN users u ON f.followee_id = u.id
             WHERE f.follower_id = ?
             ORDER BY f.id DESC`,
            [req.userId]
        );
        res.json({ follows });
    } catch (error) {
        logger.error('获取关注列表错误:', error);
        res.status(500).json({ error: '获取关注失败' });
    }
});

// 查看某用户：我是否关注 + 粉丝/关注数（个人主页用）
router.get('/users/:userId/status', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const following = await db.get(
            'SELECT id FROM follows WHERE follower_id = ? AND followee_id = ?',
            [req.userId, parseInt(userId)]
        );
        const followers = await db.get(
            'SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?',
            [userId]
        );
        const followingCount = await db.get(
            'SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?',
            [userId]
        );
        res.json({
            following: !!following,
            followers: followers.c,
            followingCount: followingCount.c
        });
    } catch (error) {
        logger.error('获取关注状态错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 关注动态流：我关注的人发布的帖子
router.get('/feed', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const posts = await db.all(
            `SELECT p.*, u.nickname AS author_nickname, u.username AS author_username, u.avatar AS author_avatar
             FROM posts p
             JOIN follows f ON p.author_id = f.followee_id
             JOIN users u ON p.author_id = u.id
             WHERE f.follower_id = ? AND p.status = 'active'
             ORDER BY p.id DESC LIMIT ? OFFSET ?`,
            [req.userId, parseInt(limit), parseInt(offset)]
        );
        res.json({ posts });
    } catch (error) {
        logger.error('获取关注动态错误:', error);
        res.status(500).json({ error: '获取动态失败' });
    }
});

module.exports = router;
