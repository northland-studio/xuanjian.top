const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const router = express.Router();

// 获取启用的轮播图（公开）
router.get('/', async (req, res) => {
    try {
        const banners = await db.all(
            'SELECT id, title, subtitle, image, link FROM banners WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
        );
        res.json({ banners });
    } catch (error) {
        logger.error('获取轮播图错误:', error);
        res.status(500).json({ error: '获取轮播图失败' });
    }
});

// 获取全部轮播图（管理员）
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const banners = await db.all('SELECT * FROM banners ORDER BY sort_order ASC, id ASC');
        res.json({ banners });
    } catch (error) {
        logger.error('获取全部轮播图错误:', error);
        res.status(500).json({ error: '获取轮播图失败' });
    }
});

// 创建轮播图（管理员）
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { title, subtitle, image, link, sort_order, is_active } = req.body;

        if (!image) {
            return res.status(400).json({ error: '轮播图片不能为空' });
        }

        const result = await db.run(
            'INSERT INTO banners (title, subtitle, image, link, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [title || '', subtitle || '', image, link || '', sort_order || 0, is_active === false ? 0 : 1, getLocalTimestamp(), getLocalTimestamp()]
        );

        res.status(201).json({ message: '轮播图创建成功', bannerId: result.id });
    } catch (error) {
        logger.error('创建轮播图错误:', error);
        res.status(500).json({ error: '创建轮播图失败' });
    }
});

// 更新轮播图（管理员）
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, subtitle, image, link, sort_order, is_active } = req.body;

        const existing = await db.get('SELECT id FROM banners WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ error: '轮播图不存在' });
        }

        await db.run(
            'UPDATE banners SET title = ?, subtitle = ?, image = ?, link = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?',
            [title !== undefined ? title : '', subtitle !== undefined ? subtitle : '', image || '', link !== undefined ? link : '', sort_order !== undefined ? sort_order : 0, is_active === false ? 0 : 1, getLocalTimestamp(), id]
        );

        res.json({ message: '轮播图更新成功' });
    } catch (error) {
        logger.error('更新轮播图错误:', error);
        res.status(500).json({ error: '更新轮播图失败' });
    }
});

// 删除轮播图（管理员）
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await db.run('DELETE FROM banners WHERE id = ?', [id]);
        res.json({ message: '轮播图删除成功' });
    } catch (error) {
        logger.error('删除轮播图错误:', error);
        res.status(500).json({ error: '删除轮播图失败' });
    }
});

module.exports = router;
