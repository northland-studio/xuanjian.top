/**
 * 人员代系管理路由
 * - GET  /api/generations           公开：获取所有代系配置
 * - POST /api/generations           管理员：新增代系
 * - PUT  /api/generations/:id       管理员：修改代系
 * - DELETE /api/generations/:id     管理员：删除代系
 * - PUT  /api/generations/user/:userId  管理员：手动设置某用户代系（可清空恢复自动）
 * - GET  /api/generations/user/:userId  获取某用户代系
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { listGenerations, resolveGeneration } = require('../lib/generation');
const router = express.Router();

// 获取所有代系配置（公开）
router.get('/', async (req, res) => {
    try {
        res.json({ generations: await listGenerations() });
    } catch (e) {
        logger.error('获取代系列表错误:', e);
        res.status(500).json({ error: '获取失败' });
    }
});

// 获取某用户代系（公开，用于档案/主页展示）
router.get('/user/:userId', async (req, res) => {
    try {
        const user = await db.get('SELECT id, username, nickname, created_at, generation FROM users WHERE id = ?', [req.params.userId]);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        const gen = await resolveGeneration(user);
        res.json({ generation: gen });
    } catch (e) {
        logger.error('获取用户代系错误:', e);
        res.status(500).json({ error: '获取失败' });
    }
});

// 管理员：新增代系
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, start_date, end_date, color, sort_order } = req.body;
        if (!name) return res.status(400).json({ error: '代系名称不能为空' });
        await db.run(
            'INSERT INTO generations (name, start_date, end_date, color, sort_order) VALUES (?, ?, ?, ?, ?)',
            [name, start_date || null, end_date || null, color || '#004AAD', parseInt(sort_order) || 0]
        );
        res.status(201).json({ message: '代系已创建' });
    } catch (e) {
        logger.error('创建代系错误:', e);
        res.status(500).json({ error: '创建失败' });
    }
});

// 管理员：修改代系
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, start_date, end_date, color, sort_order } = req.body;
        await db.run(
            'UPDATE generations SET name = ?, start_date = ?, end_date = ?, color = ?, sort_order = ?, updated_at = ? WHERE id = ?',
            [name, start_date || null, end_date || null, color || '#004AAD', parseInt(sort_order) || 0, getLocalTimestamp(), req.params.id]
        );
        res.json({ message: '代系已更新' });
    } catch (e) {
        logger.error('更新代系错误:', e);
        res.status(500).json({ error: '更新失败' });
    }
});

// 管理员：删除代系
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        await db.run('DELETE FROM generations WHERE id = ?', [req.params.id]);
        res.json({ message: '代系已删除' });
    } catch (e) {
        logger.error('删除代系错误:', e);
        res.status(500).json({ error: '删除失败' });
    }
});

// 管理员：手动设置某用户代系（传 null/空 则清空恢复自动判定）
router.put('/user/:userId', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { generation } = req.body;
        const gen = generation ? String(generation).trim() : null;
        await db.run('UPDATE users SET generation = ?, updated_at = ? WHERE id = ?', [gen, getLocalTimestamp(), req.params.userId]);
        res.json({ message: gen ? `已手动设为「${gen}」` : '已恢复自动判定', generation: gen });
    } catch (e) {
        logger.error('设置用户代系错误:', e);
        res.status(500).json({ error: '设置失败' });
    }
});

module.exports = router;
