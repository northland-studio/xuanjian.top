const express = require('express');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { sendClaimNotification, sendClaimResult } = require('../config/mail');
const { createNotification } = require('./notifications');
const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
    try {
        const { status, limit = 20, offset = 0 } = req.query;
        
        let sql = `
            SELECT cc.*, u.username, u.nickname, u.avatar,
                   ru.username as reviewer_name
            FROM contribution_claims cc
            JOIN users u ON cc.user_id = u.id
            LEFT JOIN users ru ON cc.reviewed_by = ru.id
        `;
        let params = [];
        
        const isAdmin = req.userLevel >= 1;
        
        if (!isAdmin) {
            sql += ' WHERE cc.user_id = ?';
            params.push(req.userId);
        } else if (status) {
            sql += ' WHERE cc.status = ?';
            params.push(status);
        }
        
        sql += ' ORDER BY cc.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const claims = await db.all(sql, params);
        
        res.json({ claims });
    } catch (error) {
        console.error('获取申报列表错误:', error);
        res.status(500).json({ error: '获取申报列表失败' });
    }
});

router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        const claim = await db.get(
            `SELECT cc.*, u.username, u.nickname, u.avatar, u.email,
                    ru.username as reviewer_name
             FROM contribution_claims cc
             JOIN users u ON cc.user_id = u.id
             LEFT JOIN users ru ON cc.reviewed_by = ru.id
             WHERE cc.id = ?`,
            [id]
        );
        
        if (!claim) {
            return res.status(404).json({ error: '申报不存在' });
        }
        
        const isAdmin = req.userLevel >= 1;
        if (!isAdmin && claim.user_id !== req.userId) {
            return res.status(403).json({ error: '无权查看此申报' });
        }
        
        res.json({ claim });
    } catch (error) {
        console.error('获取申报详情错误:', error);
        res.status(500).json({ error: '获取申报详情失败' });
    }
});

router.post('/', authMiddleware, async (req, res) => {
    try {
        const { amount, reason, evidence } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: '申报数量必须大于0' });
        }
        
        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({ error: '申报原因至少10个字符' });
        }
        
        const result = await db.run(
            'INSERT INTO contribution_claims (user_id, amount, reason, evidence) VALUES (?, ?, ?, ?)',
            [req.userId, amount, reason.trim(), evidence || '']
        );
        
        const user = await db.get('SELECT nickname, username FROM users WHERE id = ?', [req.userId]);
        
        const admins = await db.all(
            'SELECT email FROM users WHERE level >= 1 AND email IS NOT NULL AND email != ""'
        );
        
        console.log(`找到 ${admins.length} 位管理员需要通知`);
        
        for (const admin of admins) {
            if (admin.email) {
                try {
                    await sendClaimNotification(admin.email, {
                        nickname: user.nickname || user.username,
                        amount,
                        reason
                    });
                    console.log(`已发送通知邮件到: ${admin.email}`);
                } catch (emailErr) {
                    console.error(`发送邮件到 ${admin.email} 失败:`, emailErr.message);
                }
            }
        }
        
        res.status(201).json({ message: '申报提交成功，请等待管理员审核', claimId: result.id });
    } catch (error) {
        console.error('提交申报错误:', error);
        res.status(500).json({ error: '提交申报失败' });
    }
});

router.put('/:id/review', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reviewNote } = req.body;
        
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: '无效的审核状态' });
        }
        
        const claim = await db.get(
            `SELECT cc.*, u.nickname, u.username, u.email 
             FROM contribution_claims cc 
             JOIN users u ON cc.user_id = u.id 
             WHERE cc.id = ?`,
            [id]
        );
        
        if (!claim) {
            return res.status(404).json({ error: '申报不存在' });
        }
        
        if (claim.status !== 'pending') {
            return res.status(400).json({ error: '该申报已被审核' });
        }
        
        await db.run(
            `UPDATE contribution_claims 
             SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = ? 
             WHERE id = ?`,
            [status, req.userId, reviewNote || '', getLocalTimestamp(), id]
        );
        
        if (status === 'approved') {
            await db.run(
                'UPDATE users SET contribution = contribution + ? WHERE id = ?',
                [claim.amount, claim.user_id]
            );
        }
        
        const statusText = status === 'approved' ? '已通过' : '已拒绝';
        
        if (claim.email) {
            try {
                await sendClaimResult(claim.email, claim, status, reviewNote);
                console.log(`已发送审核结果邮件到: ${claim.email}`);
            } catch (emailErr) {
                console.error(`发送审核结果邮件失败:`, emailErr.message);
            }
        }
        
        try {
            await createNotification({
                userId: claim.user_id,
                type: 'claim_result',
                title: `贡献点申报${statusText}`,
                content: `您申报的 ${claim.amount} 贡献点${statusText}${reviewNote ? `，原因：${reviewNote}` : ''}`
            });
        } catch (notifErr) {
            console.error('创建通知失败:', notifErr.message);
        }
        
        res.json({ success: true, message: '审核完成' });
    } catch (error) {
        console.error('审核申报错误:', error);
        res.status(500).json({ error: '审核失败' });
    }
});

module.exports = router;
