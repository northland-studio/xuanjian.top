const express = require('express');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const titles = await db.all(
            'SELECT * FROM titles WHERE is_active = 1 ORDER BY is_preset DESC, price ASC'
        );
        res.json({ titles });
    } catch (error) {
        console.error('获取称号列表错误:', error);
        res.status(500).json({ error: '获取称号列表失败' });
    }
});

router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const titles = await db.all(
            'SELECT * FROM titles ORDER BY is_preset DESC, created_at DESC'
        );
        res.json({ titles });
    } catch (error) {
        console.error('获取称号列表错误:', error);
        res.status(500).json({ error: '获取称号列表失败' });
    }
});

router.get('/my', authMiddleware, async (req, res) => {
    try {
        const titles = await db.all(
            `SELECT t.*, ut.purchased_at 
             FROM titles t
             JOIN user_titles ut ON t.id = ut.title_id
             WHERE ut.user_id = ?
             ORDER BY ut.purchased_at DESC`,
            [req.userId]
        );
        
        const user = await db.get('SELECT equipped_title FROM users WHERE id = ?', [req.userId]);
        
        res.json({ 
            titles, 
            equippedTitle: user.equipped_title 
        });
    } catch (error) {
        console.error('获取我的称号错误:', error);
        res.status(500).json({ error: '获取我的称号失败' });
    }
});

router.post('/:id/buy', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        const title = await db.get('SELECT * FROM titles WHERE id = ? AND is_active = 1', [id]);
        if (!title) {
            return res.status(404).json({ error: '称号不存在' });
        }
        
        const existing = await db.get(
            'SELECT * FROM user_titles WHERE user_id = ? AND title_id = ?',
            [req.userId, id]
        );
        if (existing) {
            return res.status(400).json({ error: '您已拥有该称号' });
        }
        
        const user = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        if (user.contribution < title.price) {
            return res.status(400).json({ error: '贡献点不足' });
        }
        
        await db.run(
            'UPDATE users SET contribution = contribution - ? WHERE id = ?',
            [title.price, req.userId]
        );
        
        await db.run(
            'INSERT INTO user_titles (user_id, title_id) VALUES (?, ?)',
            [req.userId, id]
        );
        
        res.json({ message: '购买成功', title });
    } catch (error) {
        console.error('购买称号错误:', error);
        res.status(500).json({ error: '购买失败' });
    }
});

router.put('/equip', authMiddleware, async (req, res) => {
    try {
        const { titleId } = req.body;
        
        if (titleId !== null) {
            const owned = await db.get(
                'SELECT * FROM user_titles WHERE user_id = ? AND title_id = ?',
                [req.userId, titleId]
            );
            if (!owned) {
                return res.status(400).json({ error: '您未拥有该称号' });
            }
        }
        
        await db.run(
            'UPDATE users SET equipped_title = ? WHERE id = ?',
            [titleId, req.userId]
        );
        
        res.json({ message: titleId ? '装备成功' : '已卸下称号' });
    } catch (error) {
        console.error('装备称号错误:', error);
        res.status(500).json({ error: '装备失败' });
    }
});

router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, description, color, price, is_preset, in_shop } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: '称号名称不能为空' });
        }
        
        const result = await db.run(
            'INSERT INTO titles (name, description, color, price, is_preset, in_shop) VALUES (?, ?, ?, ?, ?, ?)',
            [name, description || '', color || '#6366f1', price || 0, is_preset ? 1 : 0, in_shop ? 1 : 0]
        );
        
        res.status(201).json({ message: '创建成功', titleId: result.id });
    } catch (error) {
        console.error('创建称号错误:', error);
        res.status(500).json({ error: '创建失败' });
    }
});

router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, color, price, is_active, in_shop } = req.body;
        
        await db.run(
            'UPDATE titles SET name = ?, description = ?, color = ?, price = ?, is_active = ?, in_shop = ?, updated_at = ? WHERE id = ?',
            [name, description, color, price, is_active ? 1 : 0, in_shop ? 1 : 0, getLocalTimestamp(), id]
        );
        
        res.json({ message: '更新成功' });
    } catch (error) {
        console.error('更新称号错误:', error);
        res.status(500).json({ error: '更新失败' });
    }
});

router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.run('DELETE FROM user_titles WHERE title_id = ?', [id]);
        await db.run('DELETE FROM titles WHERE id = ?', [id]);
        
        res.json({ message: '删除成功' });
    } catch (error) {
        console.error('删除称号错误:', error);
        res.status(500).json({ error: '删除失败' });
    }
});

module.exports = router;
