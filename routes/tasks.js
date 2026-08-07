/**
 * 任务系统：管理员派发任务（可配图），成员接取并通过完成验证码完成任务获得贡献点
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { addContributionLog } = require('../lib/contribution');
const { createNotification } = require('./notifications');
const { sendTaskResult } = require('../config/mail');
const router = express.Router();

// 生成完成验证码（发布任务时生成，仅 1/2 级可见）
function generateTaskCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'RW';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(crypto.randomInt(chars.length));
    }
    return code;
}

// 任务列表（普通用户看不到 code；1/2 级可见 code 以便核验）
router.get('/', authMiddleware, async (req, res) => {
    try {
        const tasks = await db.all(
            `SELECT t.*, u.nickname AS creator_nickname,
                    (SELECT COUNT(*) FROM task_claims tc WHERE tc.task_id = t.id) AS claim_count
             FROM tasks t
             JOIN users u ON t.created_by = u.id
             WHERE t.is_active = 1
             ORDER BY t.id DESC`
        );
        const isAdmin = req.userLevel >= 1;

        // 附带当前用户对每个任务的接取状态
        const myClaims = await db.all(
            'SELECT task_id, status FROM task_claims WHERE user_id = ?',
            [req.userId]
        );
        const myMap = {};
        myClaims.forEach(c => { myMap[c.task_id] = c.status; });

        const result = tasks.map(t => {
            const { code, ...rest } = t;
            return {
                ...rest,
                code: isAdmin ? code : undefined,
                myStatus: myMap[t.id] || null
            };
        });

        res.json({ tasks: result });
    } catch (error) {
        logger.error('获取任务列表错误:', error);
        res.status(500).json({ error: '获取任务失败' });
    }
});

// 任务详情
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const task = await db.get(
            `SELECT t.*, u.nickname AS creator_nickname FROM tasks t
             JOIN users u ON t.created_by = u.id
             WHERE t.id = ?`,
            [id]
        );
        if (!task) return res.status(404).json({ error: '任务不存在' });

        const isAdmin = req.userLevel >= 1;
        const myClaim = await db.get(
            'SELECT status FROM task_claims WHERE task_id = ? AND user_id = ?',
            [id, req.userId]
        );

        if (!isAdmin) delete task.code;
        res.json({ task: { ...task, myStatus: myClaim?.status || null } });
    } catch (error) {
        logger.error('获取任务详情错误:', error);
        res.status(500).json({ error: '获取任务失败' });
    }
});

// 我接取的任务
router.get('/my/all', authMiddleware, async (req, res) => {
    try {
        const claims = await db.all(
            `SELECT tc.*, t.title, t.description, t.image, t.reward
             FROM task_claims tc
             JOIN tasks t ON tc.task_id = t.id
             WHERE tc.user_id = ?
             ORDER BY tc.id DESC`,
            [req.userId]
        );
        res.json({ claims });
    } catch (error) {
        logger.error('获取我的任务错误:', error);
        res.status(500).json({ error: '获取任务失败' });
    }
});

// 接取任务
router.post('/:id/claim', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const task = await db.get('SELECT * FROM tasks WHERE id = ? AND is_active = 1', [id]);
        if (!task) return res.status(404).json({ error: '任务不存在或已下线' });

        const existing = await db.get(
            'SELECT id, status FROM task_claims WHERE task_id = ? AND user_id = ?',
            [id, req.userId]
        );
        if (existing) {
            return res.status(400).json({ error: existing.status === 'completed' ? '您已完成该任务' : '您已接取该任务' });
        }

        await db.run(
            'INSERT INTO task_claims (task_id, user_id, status) VALUES (?, ?, ?)',
            [id, req.userId, 'pending']
        );
        res.json({ message: '任务接取成功' });
    } catch (error) {
        logger.error('接取任务错误:', error);
        res.status(500).json({ error: '接取失败' });
    }
});

// 提交完成验证码 → 完成任务并发放贡献点
router.post('/:id/complete', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { code } = req.body;

        if (!code || !code.trim()) {
            return res.status(400).json({ error: '请输入完成验证码' });
        }

        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
        if (!task) return res.status(404).json({ error: '任务不存在' });

        const claim = await db.get(
            'SELECT * FROM task_claims WHERE task_id = ? AND user_id = ?',
            [id, req.userId]
        );
        if (!claim) {
            return res.status(400).json({ error: '请先接取任务' });
        }
        if (claim.status === 'completed') {
            return res.status(400).json({ error: '该任务已完成' });
        }

        // 核验验证码
        if (code.trim().toUpperCase() !== task.code.toUpperCase()) {
            return res.status(400).json({ error: '验证码错误' });
        }

        await db.transaction(async () => {
            await db.run(
                'UPDATE task_claims SET status = ?, code = ?, completed_at = ? WHERE id = ?',
                ['completed', code.trim().toUpperCase(), getLocalTimestamp(), claim.id]
            );
            await db.run(
                'UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?',
                [task.reward, req.userId]
            );
            await addContributionLog(req.userId, task.reward, 'task', task.id, task.title);
        });

        // 站内通知
        try {
            await createNotification({
                userId: req.userId,
                type: 'task_reward',
                title: '任务完成奖励',
                content: `任务「${task.title}」已完成，获得 ${task.reward} 贡献点`
            });
        } catch (e) {
            logger.error('任务通知失败:', e.message);
        }

        // 邮箱通知
        try {
            const user = await db.get('SELECT email, nickname, username FROM users WHERE id = ?', [req.userId]);
            if (user?.email) {
                await sendTaskResult(user.email, task, user);
            }
        } catch (emailErr) {
            logger.error('任务奖励邮件失败:', emailErr.message);
        }

        res.json({ message: '任务完成，贡献点已发放', reward: task.reward });
    } catch (error) {
        logger.error('完成任务错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

/* ============ 管理端 ============ */

// 创建任务（生成完成验证码，仅 1/2 级可见）
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { title, description, image, reward } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ error: '任务标题不能为空' });
        }
        const rw = parseInt(reward);
        if (!rw || rw <= 0) {
            return res.status(400).json({ error: '任务奖励必须大于0' });
        }

        const code = generateTaskCode();
        const result = await db.run(
            'INSERT INTO tasks (title, description, image, reward, code, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [title.trim(), description?.trim() || '', image || '', rw, code, req.userId]
        );

        res.status(201).json({ message: '任务创建成功', taskId: result.id, code });
    } catch (error) {
        logger.error('创建任务错误:', error);
        res.status(500).json({ error: '创建失败' });
    }
});

// 管理端：全部任务（含停用，1/2 级可见 code）
router.get('/admin/list', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const tasks = await db.all(
            `SELECT t.*, u.nickname AS creator_nickname,
                    (SELECT COUNT(*) FROM task_claims tc WHERE tc.task_id = t.id) AS claim_count,
                    (SELECT COUNT(*) FROM task_claims tc WHERE tc.task_id = t.id AND tc.status = 'completed') AS completed_count
             FROM tasks t
             JOIN users u ON t.created_by = u.id
             ORDER BY t.id DESC`
        );
        res.json({ tasks });
    } catch (error) {
        logger.error('获取任务管理列表错误:', error);
        res.status(500).json({ error: '获取任务失败' });
    }
});

// 管理端：编辑任务（标题/描述/奖励/上下线）
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, image, reward, isActive } = req.body;

        await db.run(
            'UPDATE tasks SET title = ?, description = ?, image = ?, reward = ?, is_active = ?, updated_at = ? WHERE id = ?',
            [title?.trim() || '', description?.trim() || '', image || '', parseInt(reward) || 0, isActive ? 1 : 0, getLocalTimestamp(), id]
        );
        res.json({ message: '任务更新成功' });
    } catch (error) {
        logger.error('更新任务错误:', error);
        res.status(500).json({ error: '更新失败' });
    }
});

// 管理端：任务领取/完成记录
router.get('/:id/claims', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const claims = await db.all(
            `SELECT tc.*, u.nickname, u.username, u.email
             FROM task_claims tc
             JOIN users u ON tc.user_id = u.id
             WHERE tc.task_id = ?
             ORDER BY tc.id DESC`,
            [id]
        );
        res.json({ claims });
    } catch (error) {
        logger.error('获取任务领取记录错误:', error);
        res.status(500).json({ error: '获取记录失败' });
    }
});

module.exports = router;
