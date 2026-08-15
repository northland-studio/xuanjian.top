const express = require('express');
const logger = require('../lib/logger');
const crypto = require('crypto');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { addContributionLog } = require('../lib/contribution');
const router = express.Router();

const generateVerificationCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'XJ';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(crypto.randomInt(chars.length));
    }
    return code;
};

// 本地时间 + N 天（权限有效期计算）
function addDaysLocal(days) {
    const now = new Date();
    now.setDate(now.getDate() + (parseInt(days) || 0));
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now - offset).toISOString().slice(0, 19).replace('T', ' ');
}

router.get('/items', async (req, res) => {
    try {
        const { type } = req.query;
        
        let sql = 'SELECT * FROM shop_items WHERE is_active = 1';
        let params = [];
        
        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }
        
        sql += ' ORDER BY created_at DESC';
        
        const items = await db.all(sql, params);
        res.json({ items });
    } catch (error) {
        logger.error('获取商品列表错误:', error);
        res.status(500).json({ error: '获取商品列表失败' });
    }
});

router.get('/items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const item = await db.get('SELECT * FROM shop_items WHERE id = ? AND is_active = 1', [id]);
        
        if (!item) {
            return res.status(404).json({ error: '商品不存在' });
        }
        
        res.json({ item });
    } catch (error) {
        logger.error('获取商品详情错误:', error);
        res.status(500).json({ error: '获取商品详情失败' });
    }
});

// 管理端：获取全部商品（含停用）
router.get('/admin/items', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const items = await db.all('SELECT * FROM shop_items ORDER BY created_at DESC');
        res.json({ items });
    } catch (error) {
        logger.error('获取全部商品错误:', error);
        res.status(500).json({ error: '获取商品列表失败' });
    }
});

router.post('/items/:id/buy', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity = 1 } = req.body;
        
        const item = await db.get('SELECT * FROM shop_items WHERE id = ? AND is_active = 1', [id]);
        
        if (!item) {
            return res.status(404).json({ error: '商品不存在' });
        }
        
        if (item.stock !== -1 && item.stock < quantity) {
            return res.status(400).json({ error: '库存不足' });
        }
        
        const totalPrice = item.price * quantity;
        
        const user = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        if (user.contribution < totalPrice) {
            return res.status(400).json({ error: '贡献点不足' });
        }
        
        const purchasedItems = [];
        
        await db.transaction(async () => {
            await db.run(
                'UPDATE users SET contribution = COALESCE(contribution, 0) - ? WHERE id = ?',
                [totalPrice, req.userId]
            );
            
            if (item.stock !== -1) {
                await db.run(
                    'UPDATE shop_items SET stock = stock - ? WHERE id = ?',
                    [quantity, id]
                );
            }
            
            // 权限类商品：购买即开通权限，记录有效期，无需核销码
            if (item.type === 'permission') {
                const expiresAt = item.duration_days > 0 ? addDaysLocal(item.duration_days) : null;
                const result = await db.run(
                    'INSERT INTO user_items (user_id, item_id, verification_code, expires_at) VALUES (?, ?, NULL, ?)',
                    [req.userId, id, expiresAt]
                );
                purchasedItems.push({
                    id: result.id,
                    type: 'permission',
                    expiresAt
                });
            } else {
                // 普通商品：整批共用一个核销码（一次购买 N 件 = 一个码，线下一次核销整批）
                const verificationCode = generateVerificationCode();
                for (let i = 0; i < quantity; i++) {
                    const result = await db.run(
                        'INSERT INTO user_items (user_id, item_id, verification_code) VALUES (?, ?, ?)',
                        [req.userId, id, verificationCode]
                    );
                    
                    purchasedItems.push({
                        id: result.id,
                        verificationCode
                    });
                    
                    if (item.type === 'title' && item.ref_id) {
                        await db.run(
                            'INSERT OR IGNORE INTO user_titles (user_id, title_id) VALUES (?, ?)',
                            [req.userId, item.ref_id]
                        );
                    }
                }
            }
        });
        
        await addContributionLog(req.userId, -totalPrice, 'purchase', item.id, item.name);

        res.json({ message: '购买成功', totalPrice, quantity, purchasedItems });
    } catch (error) {
        logger.error('购买商品错误:', error);
        res.status(500).json({ error: '购买失败' });
    }
});

router.get('/my-items', authMiddleware, async (req, res) => {
    try {
        // 同核销码商品堆叠：普通商品按核销码聚合（quantity=件数），权限/无码记录各自独立
        const items = await db.all(
            `SELECT ui.*, si.name, si.description, si.type, si.image,
                    COUNT(*) AS quantity
             FROM user_items ui
             JOIN shop_items si ON ui.item_id = si.id
             WHERE ui.user_id = ?
             GROUP BY CASE WHEN ui.verification_code IS NULL OR ui.verification_code = '' THEN ui.id ELSE ui.verification_code END
             ORDER BY ui.purchased_at DESC`,
            [req.userId]
        );
        
        res.json({ items });
    } catch (error) {
        logger.error('获取我的商品错误:', error);
        res.status(500).json({ error: '获取我的商品失败' });
    }
});

// 我的有效权限（兑换的仓库/机器使用权限）
router.get('/my-permissions', authMiddleware, async (req, res) => {
    try {
        const items = await db.all(
            `SELECT ui.*, si.name, si.description, si.type, si.image, si.duration_days
             FROM user_items ui
             JOIN shop_items si ON ui.item_id = si.id
             WHERE ui.user_id = ? AND si.type = 'permission'
               AND (ui.expires_at IS NULL OR ui.expires_at > datetime('now', 'localtime'))
             ORDER BY ui.expires_at ASC`,
            [req.userId]
        );
        res.json({ items });
    } catch (error) {
        logger.error('获取我的权限错误:', error);
        res.status(500).json({ error: '获取我的权限失败' });
    }
});

router.get('/my-titles', authMiddleware, async (req, res) => {
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
        logger.error('获取我的称号错误:', error);
        res.status(500).json({ error: '获取我的称号失败' });
    }
});

router.post('/verify', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code) {
            return res.status(400).json({ error: '请输入核销码' });
        }
        
        const item = await db.get(
            `SELECT ui.*, si.name, si.description, si.type, u.username, u.nickname
             FROM user_items ui
             JOIN shop_items si ON ui.item_id = si.id
             JOIN users u ON ui.user_id = u.id
             WHERE ui.verification_code = ?`,
            [code.toUpperCase()]
        );
        
        if (!item) {
            return res.status(404).json({ error: '核销码无效' });
        }
        
        if (item.verified_at) {
            // 幂等：已核销时返回已核销信息（前端友好提示，非失败）
            return res.json({
                valid: true,
                already: true,
                verifiedAt: item.verified_at,
                verifiedBy: item.verified_by,
                item: {
                    id: item.id,
                    name: item.name,
                    description: item.description,
                    type: item.type,
                    buyer: item.nickname || item.username,
                    purchasedAt: item.purchased_at
                }
            });
        }
        
        // 该核销码对应的剩余待核销数量（整批共用一个码）
        const batch = await db.get(
            'SELECT COUNT(*) AS remaining FROM user_items WHERE verification_code = ? AND verified_at IS NULL',
            [code.toUpperCase()]
        );
        
        res.json({ 
            valid: true,
            quantity: batch?.remaining || 1,
            item: {
                id: item.id,
                name: item.name,
                description: item.description,
                type: item.type,
                buyer: item.nickname || item.username,
                purchasedAt: item.purchased_at
            }
        });
    } catch (error) {
        logger.error('验证核销码错误:', error);
        res.status(500).json({ error: '验证失败' });
    }
});

router.post('/confirm', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code) {
            return res.status(400).json({ error: '请输入核销码' });
        }
        
        const item = await db.get(
            `SELECT ui.*, si.name, si.type
             FROM user_items ui
             JOIN shop_items si ON ui.item_id = si.id
             WHERE ui.verification_code = ?`,
            [code.toUpperCase()]
        );
        
        if (!item) {
            return res.status(404).json({ error: '核销码无效' });
        }
        
        // 检查该核销码是否仍有未核销记录（整批共用一个码，核销时整批一次完成）
        const pending = await db.get(
            'SELECT COUNT(*) AS c FROM user_items WHERE verification_code = ? AND verified_at IS NULL',
            [code.toUpperCase()]
        );
        if (!pending?.c) {
            // 幂等：已全部核销时返回成功提示（避免网络重试/重复核销被误判为失败）
            const done = await db.get(
                'SELECT verified_at FROM user_items WHERE verification_code = ? AND verified_at IS NOT NULL LIMIT 1',
                [code.toUpperCase()]
            );
            return res.json({ message: '该核销码已核销', itemName: item.name, already: true, verifiedAt: done?.verified_at || null });
        }
        
        await db.run(
            'UPDATE user_items SET verified_at = ?, verified_by = ? WHERE verification_code = ? AND verified_at IS NULL',
            [getLocalTimestamp(), req.userId, code.toUpperCase()]
        );
        
        res.json({ message: '核销成功', itemName: item.name, quantity: pending.c });
    } catch (error) {
        logger.error('核销错误:', error);
        res.status(500).json({ error: '核销失败' });
    }
});

router.post('/items', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, description, type, ref_id, price, image, stock, duration_days } = req.body;
        
        if (!name || !type || price === undefined) {
            return res.status(400).json({ error: '商品名称、类型和价格不能为空' });
        }
        
        const result = await db.run(
            'INSERT INTO shop_items (name, description, type, ref_id, price, image, stock, duration_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, description || '', type, ref_id || null, price, image || '', stock !== undefined ? stock : -1, parseInt(duration_days) || 0]
        );
        
        res.status(201).json({ message: '商品创建成功', itemId: result.id });
    } catch (error) {
        logger.error('创建商品错误:', error);
        res.status(500).json({ error: '创建商品失败' });
    }
});

router.put('/items/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, image, stock, is_active, duration_days } = req.body;
        
        await db.run(
            'UPDATE shop_items SET name = ?, description = ?, price = ?, image = ?, stock = ?, duration_days = ?, is_active = ?, updated_at = ? WHERE id = ?',
            [name, description, price, image, stock, parseInt(duration_days) || 0, is_active ? 1 : 0, getLocalTimestamp(), id]
        );
        
        res.json({ message: '商品更新成功' });
    } catch (error) {
        logger.error('更新商品错误:', error);
        res.status(500).json({ error: '更新商品失败' });
    }
});

router.delete('/items/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.run('DELETE FROM shop_items WHERE id = ?', [id]);
        
        res.json({ message: '商品删除成功' });
    } catch (error) {
        logger.error('删除商品错误:', error);
        res.status(500).json({ error: '删除商品失败' });
    }
});

// 商品营业额统计（管理端）：总营业额 + 近7天每日 + 按商品聚合
router.get('/admin/sales', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const total = await db.get(
            `SELECT COALESCE(-SUM(amount), 0) AS revenue,
                    COUNT(*) AS transactions
             FROM contribution_logs WHERE type = 'purchase'`
        );

        const daily = await db.all(
            `SELECT date(created_at) AS d, COALESCE(-SUM(amount), 0) AS revenue
             FROM contribution_logs
             WHERE type = 'purchase' AND created_at >= datetime('now','localtime','-6 day')
             GROUP BY d ORDER BY d`
        );

        const byItem = await db.all(
            `SELECT COALESCE(si.name, '（已删除商品#' || cl.ref_id || '）') AS item_name,
                    cl.ref_id AS item_id,
                    COALESCE((SELECT COUNT(*) FROM user_items ui WHERE ui.item_id = cl.ref_id), 0) AS sold,
                    COALESCE(-SUM(cl.amount), 0) AS revenue
             FROM contribution_logs cl
             LEFT JOIN shop_items si ON cl.ref_id = si.id
             WHERE cl.type = 'purchase'
             GROUP BY cl.ref_id
             ORDER BY revenue DESC`
        );

        res.json({ total, daily, byItem });
    } catch (error) {
        logger.error('获取商品营业额错误:', error);
        res.status(500).json({ error: '获取营业额失败' });
    }
});

module.exports = router;
