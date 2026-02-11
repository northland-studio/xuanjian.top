const express = require('express');
const db = require('../database');
const router = express.Router();

// 获取当前弹窗公告
router.get('/popup', async (req, res) => {
    try {
        const announcement = await db.get(
            `SELECT * FROM announcements 
             WHERE is_popup = 1 AND is_active = 1
             ORDER BY created_at DESC
             LIMIT 1`
        );
        
        res.json(announcement || null);
    } catch (error) {
        console.error('获取公告错误:', error);
        res.status(500).json({ error: '获取公告失败' });
    }
});

// 获取所有活跃公告
router.get('/', async (req, res) => {
    try {
        const announcements = await db.all(
            `SELECT * FROM announcements 
             WHERE is_active = 1
             ORDER BY created_at DESC`
        );
        
        res.json(announcements);
    } catch (error) {
        console.error('获取公告列表错误:', error);
        res.status(500).json({ error: '获取公告列表失败' });
    }
});

module.exports = router;
