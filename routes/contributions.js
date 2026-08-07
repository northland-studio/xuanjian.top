/**
 * 贡献点系统：互转 / 审计日志 / 管理调整
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');
const { addContributionLog } = require('../lib/contribution');
const { createNotification } = require('./notifications');
const router = express.Router();

// 单日转出上限（防刷）
const DAILY_TRANSFER_LIMIT = 1000;

// 贡献点互转
router.post('/transfer', authMiddleware, async (req, res) => {
    try {
        const { toUserId, amount, note } = req.body;
        const toId = parseInt(toUserId);

        if (!toId || toId === req.userId) {
            return res.status(400).json({ error: '目标用户无效' });
        }
        const amt = parseInt(amount);
        if (!amt || amt <= 0) {
            return res.status(400).json({ error: '转账数量必须大于0' });
        }
        if (amt > DAILY_TRANSFER_LIMIT) {
            return res.status(400).json({ error: `单次转账不能超过 ${DAILY_TRANSFER_LIMIT}` });
        }

        const target = await db.get('SELECT id, nickname, username FROM users WHERE id = ?', [toId]);
        if (!target) {
            return res.status(404).json({ error: '目标用户不存在' });
        }

        // 当日已转出统计
        const todaySum = await db.get(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM transfers
             WHERE from_user = ? AND DATE(created_at) = DATE('now', 'localtime')`,
            [req.userId]
        );
        if ((todaySum.total + amt) > DAILY_TRANSFER_LIMIT) {
            return res.status(400).json({ error: `今日转出已达上限 ${DAILY_TRANSFER_LIMIT}` });
        }

        const user = await db.get('SELECT contribution, nickname, username FROM users WHERE id = ?', [req.userId]);
        if ((user.contribution ?? 0) < amt) {
            return res.status(400).json({ error: '贡献点不足' });
        }

        await db.transaction(async () => {
            // 扣款
            await db.run('UPDATE users SET contribution = COALESCE(contribution, 0) - ? WHERE id = ?', [amt, req.userId]);
            // 入账
            await db.run('UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?', [amt, toId]);
            // 转账记录
            const result = await db.run(
                'INSERT INTO transfers (from_user, to_user, amount, note) VALUES (?, ?, ?, ?)',
                [req.userId, toId, amt, note?.trim() || '']
            );
            // 双方流水
            await addContributionLog(req.userId, -amt, 'transfer_out', result.id, `转给 ${target.nickname || target.username}`);
            await addContributionLog(toId, amt, 'transfer_in', result.id, `来自 ${user.nickname || user.username}`);
        });

        try {
            await createNotification({
                userId: toId,
                type: 'transfer',
                title: '收到贡献点',
                content: `${user.nickname || user.username} 向您转账了 ${amt} 贡献点${note ? `，备注：${note}` : ''}`,
                actorId: req.userId
            });
        } catch (e) {
            logger.error('转账通知失败:', e.message);
        }

        res.json({ message: '转账成功', amount: amt });
    } catch (error) {
        logger.error('贡献点互转错误:', error);
        res.status(500).json({ error: '转账失败' });
    }
});

// 我的贡献点流水
router.get('/logs', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 30, type } = req.query;
        const offset = (page - 1) * limit;

        let sql = 'SELECT * FROM contribution_logs WHERE user_id = ?';
        const params = [req.userId];
        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }
        sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const logs = await db.all(sql, params);
        res.json({ logs });
    } catch (error) {
        logger.error('获取贡献点流水错误:', error);
        res.status(500).json({ error: '获取流水失败' });
    }
});

// 管理端：全部贡献点流水（可筛选用户/类型）
router.get('/all-logs', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 30, userId, type } = req.query;
        const offset = (page - 1) * limit;

        let sql = `SELECT cl.*, u.nickname, u.username
                   FROM contribution_logs cl
                   JOIN users u ON cl.user_id = u.id
                   WHERE 1=1`;
        const params = [];
        if (userId) {
            sql += ' AND cl.user_id = ?';
            params.push(parseInt(userId));
        }
        if (type) {
            sql += ' AND cl.type = ?';
            params.push(type);
        }
        sql += ' ORDER BY cl.id DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const logs = await db.all(sql, params);
        res.json({ logs });
    } catch (error) {
        logger.error('获取全部贡献点流水错误:', error);
        res.status(500).json({ error: '获取流水失败' });
    }
});

// 管理端：全部转账记录
router.get('/all-transfers', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 30 } = req.query;
        const offset = (page - 1) * limit;

        const transfers = await db.all(
            `SELECT t.*, fu.nickname AS from_nickname, fu.username AS from_username,
                    tu.nickname AS to_nickname, tu.username AS to_username
             FROM transfers t
             JOIN users fu ON t.from_user = fu.id
             JOIN users tu ON t.to_user = tu.id
             ORDER BY t.id DESC LIMIT ? OFFSET ?`,
            [parseInt(limit), parseInt(offset)]
        );
        res.json({ transfers });
    } catch (error) {
        logger.error('获取转账记录错误:', error);
        res.status(500).json({ error: '获取转账记录失败' });
    }
});

// 管理端：手动调整用户贡献点（正负均可，记 admin 流水）
router.put('/admin/:userId', authMiddleware, superAdminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const { amount, note } = req.body;
        const amt = parseInt(amount);

        if (!amt || amt === 0) {
            return res.status(400).json({ error: '调整数量不能为0' });
        }

        const target = await db.get('SELECT id, nickname, username FROM users WHERE id = ?', [userId]);
        if (!target) {
            return res.status(404).json({ error: '用户不存在' });
        }

        await db.transaction(async () => {
            if (amt > 0) {
                await db.run('UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?', [amt, userId]);
            } else {
                const u = await db.get('SELECT COALESCE(contribution, 0) AS c FROM users WHERE id = ?', [userId]);
                if (u.c + amt < 0) {
                    throw new Error('调整后贡献点为负数，操作取消');
                }
                await db.run('UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?', [amt, userId]);
            }
            await addContributionLog(userId, amt, 'admin', req.userId, note?.trim() || '管理员调整');
        });

        res.json({ message: '贡献点调整成功' });
    } catch (error) {
        if (error.message.includes('负数')) {
            return res.status(400).json({ error: error.message });
        }
        logger.error('管理调整贡献点错误:', error);
        res.status(500).json({ error: '调整失败' });
    }
});

module.exports = router;
