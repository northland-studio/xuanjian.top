/**
 * 投影仓库：上传/浏览/下载 Minecraft .litematic 投影文件
 * 文件本体存七牛云（/api/upload/projection-token 直传），本模块只维护元数据
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

// 解析标签（逗号分隔）为数组
function parseTags(tags) {
    if (!tags) return [];
    return String(tags).split(/[,，]/).map(t => t.trim()).filter(Boolean);
}

// 投影列表（公开：标题/标签搜索，含作者信息与下载量）
router.get('/', async (req, res) => {
    try {
        const { q, page = 1, limit = 12 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        let where = '1=1';
        const params = [];
        if (q) {
            where += ' AND (p.title LIKE ? OR p.description LIKE ? OR p.tags LIKE ?)';
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }

        const total = await db.get(`SELECT COUNT(*) AS count FROM projections p WHERE ${where}`, params);
        const rows = await db.all(
            `SELECT p.*, u.nickname AS author_nickname, u.username AS author_username, u.avatar AS author_avatar
             FROM projections p
             JOIN users u ON p.author_id = u.id
             WHERE ${where}
             ORDER BY p.id DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );
        rows.forEach(r => { r.tags = parseTags(r.tags); });

        res.json({ projections: rows, total: total.count, page: parseInt(page), totalPages: Math.ceil(total.count / parseInt(limit)) });
    } catch (error) {
        logger.error('获取投影列表错误:', error);
        res.status(500).json({ error: '获取投影列表失败' });
    }
});

// 投影详情
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const row = await db.get(
            `SELECT p.*, u.nickname AS author_nickname, u.username AS author_username, u.avatar AS author_avatar
             FROM projections p
             JOIN users u ON p.author_id = u.id
             WHERE p.id = ?`,
            [id]
        );
        if (!row) return res.status(404).json({ error: '投影不存在' });
        row.tags = parseTags(row.tags);
        res.json({ projection: row });
    } catch (error) {
        logger.error('获取投影详情错误:', error);
        res.status(500).json({ error: '获取投影失败' });
    }
});

// 发布投影（需登录）
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { title, description, fileUrl, fileSize, tags } = req.body;

        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: '投影标题不能为空' });
        }
        if (!fileUrl || !String(fileUrl).trim()) {
            return res.status(400).json({ error: '请先上传投影文件' });
        }

        const result = await db.run(
            'INSERT INTO projections (title, description, file_url, file_size, tags, author_id) VALUES (?, ?, ?, ?, ?, ?)',
            [
                String(title).trim(),
                String(description || '').trim(),
                String(fileUrl).trim(),
                parseInt(fileSize) || 0,
                parseTags(tags).join(','),
                req.userId
            ]
        );
        res.status(201).json({ message: '投影发布成功', projectionId: result.id });
    } catch (error) {
        logger.error('发布投影错误:', error);
        res.status(500).json({ error: '发布失败' });
    }
});

// 下载计数（公开，返回文件直链）
router.post('/:id/download', async (req, res) => {
    try {
        const { id } = req.params;
        const row = await db.get('SELECT file_url FROM projections WHERE id = ?', [id]);
        if (!row) return res.status(404).json({ error: '投影不存在' });
        await db.run('UPDATE projections SET downloads = downloads + 1 WHERE id = ?', [id]);
        res.json({ url: row.file_url });
    } catch (error) {
        logger.error('投影下载计数错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 删除投影（作者或管理员）
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const row = await db.get('SELECT author_id FROM projections WHERE id = ?', [id]);
        if (!row) return res.status(404).json({ error: '投影不存在' });
        if (row.author_id !== req.userId && req.userLevel < 1) {
            return res.status(403).json({ error: '只有作者或管理员可以删除' });
        }
        await db.run('DELETE FROM projections WHERE id = ?', [id]);
        res.json({ message: '投影已删除' });
    } catch (error) {
        logger.error('删除投影错误:', error);
        res.status(500).json({ error: '删除失败' });
    }
});

module.exports = router;
