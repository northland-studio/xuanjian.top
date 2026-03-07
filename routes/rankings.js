const express = require('express');
const db = require('../database');
const router = express.Router();

router.get('/contribution', async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        
        const users = await db.all(
            `SELECT id, username, nickname, avatar, contribution, equipped_title,
                    (SELECT name FROM titles WHERE id = equipped_title) as title_name,
                    (SELECT color FROM titles WHERE id = equipped_title) as title_color
             FROM users 
             WHERE contribution > 0
             ORDER BY contribution DESC 
             LIMIT ?`,
            [parseInt(limit)]
        );
        
        res.json({ 
            rankings: users.map((u, i) => ({
                ...u,
                contribution: Math.round(u.contribution * 100) / 100,
                rank: i + 1
            }))
        });
    } catch (error) {
        console.error('获取贡献点排行榜错误:', error);
        res.status(500).json({ error: '获取排行榜失败' });
    }
});

router.get('/posts-views', async (req, res) => {
    try {
        const { limit = 20, type } = req.query;
        
        let sql = `
            SELECT p.id, p.title, p.views, p.likes, p.comments_count, p.type, p.created_at,
                   u.id as author_id, u.username, u.nickname, u.avatar, u.equipped_title,
                   (SELECT name FROM titles WHERE id = u.equipped_title) as title_name,
                   (SELECT color FROM titles WHERE id = u.equipped_title) as title_color
            FROM posts p
            JOIN users u ON p.author_id = u.id
            WHERE p.status = 'active'
        `;
        let params = [];
        
        if (type) {
            sql += ' AND p.type = ?';
            params.push(type);
        }
        
        sql += ' ORDER BY p.views DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const posts = await db.all(sql, params);
        
        res.json({ 
            rankings: posts.map((p, i) => ({
                ...p,
                rank: i + 1
            }))
        });
    } catch (error) {
        console.error('获取帖子排行榜错误:', error);
        res.status(500).json({ error: '获取排行榜失败' });
    }
});

router.get('/posts-likes', async (req, res) => {
    try {
        const { limit = 20, type } = req.query;
        
        let sql = `
            SELECT p.id, p.title, p.views, p.likes, p.comments_count, p.type, p.created_at,
                   u.id as author_id, u.username, u.nickname, u.avatar, u.equipped_title,
                   (SELECT name FROM titles WHERE id = u.equipped_title) as title_name,
                   (SELECT color FROM titles WHERE id = u.equipped_title) as title_color
            FROM posts p
            JOIN users u ON p.author_id = u.id
            WHERE p.status = 'active'
        `;
        let params = [];
        
        if (type) {
            sql += ' AND p.type = ?';
            params.push(type);
        }
        
        sql += ' ORDER BY p.likes DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const posts = await db.all(sql, params);
        
        res.json({ 
            rankings: posts.map((p, i) => ({
                ...p,
                rank: i + 1
            }))
        });
    } catch (error) {
        console.error('获取点赞排行榜错误:', error);
        res.status(500).json({ error: '获取排行榜失败' });
    }
});

router.get('/checkin', async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        
        const users = await db.all(
            `SELECT u.id, u.username, u.nickname, u.avatar, u.equipped_title,
                    (SELECT name FROM titles WHERE id = u.equipped_title) as title_name,
                    (SELECT color FROM titles WHERE id = u.equipped_title) as title_color,
                    MAX(c.continuous_days) as max_continuous_days,
                    COUNT(c.id) as total_checkins
             FROM users u
             LEFT JOIN checkins c ON u.id = c.user_id
             GROUP BY u.id
             HAVING total_checkins > 0
             ORDER BY max_continuous_days DESC, total_checkins DESC
             LIMIT ?`,
            [parseInt(limit)]
        );
        
        res.json({ 
            rankings: users.map((u, i) => ({
                ...u,
                rank: i + 1
            }))
        });
    } catch (error) {
        console.error('获取签到排行榜错误:', error);
        res.status(500).json({ error: '获取排行榜失败' });
    }
});

router.get('/stock', async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        
        const users = await db.all(
            `SELECT u.id, u.username, u.nickname, u.avatar, u.equipped_title,
                    (SELECT name FROM titles WHERE id = u.equipped_title) as title_name,
                    (SELECT color FROM titles WHERE id = u.equipped_title) as title_color,
                    SUM(us.shares * s.current_price) as stock_value,
                    SUM(us.shares * s.current_price - us.shares * us.avg_cost) as profit_loss
             FROM users u
             JOIN user_stocks us ON u.id = us.user_id
             JOIN stocks s ON us.stock_id = s.id
             WHERE us.shares > 0
             GROUP BY u.id
             ORDER BY profit_loss DESC
             LIMIT ?`,
            [parseInt(limit)]
        );
        
        res.json({ 
            rankings: users.map((u, i) => ({
                ...u,
                stock_value: Math.round(u.stock_value * 100) / 100,
                profit_loss: Math.round(u.profit_loss * 100) / 100,
                rank: i + 1
            }))
        });
    } catch (error) {
        console.error('获取股票排行榜错误:', error);
        res.status(500).json({ error: '获取排行榜失败' });
    }
});

module.exports = router;
