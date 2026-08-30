/**
 * 玩家任务：玩家发布悬赏任务（消耗自己贡献点），其他玩家接取，
 * 完成后凭发布者提供的验证码核实，贡献点转账到账。与管理员发布的官方任务（/api/tasks）区分。
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { addContributionLog } = require('../lib/contribution');
const { createNotification } = require('./notifications');
const { sendGenericNotification } = require('../config/mail');
const router = express.Router();

// 生成完成验证码（发布时生成，仅发布者可查看并线下告知接取者）
function generateTaskCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'PT';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(crypto.randomInt(chars.length));
    }
    return code;
}

// 任务状态文案
const STATUS_TEXT = { open: '待接取', accepted: '进行中', completed: '已完成', cancelled: '已取消' };

// 任务列表（公开任务不含验证码；作者/管理员可见自己任务的 code）
router.get('/', authMiddleware, async (req, res) => {
    try {
        const tasks = await db.all(
            `SELECT pt.*,
                    au.nickname AS author_nickname, au.username AS author_username,
                    (SELECT COUNT(*) FROM player_task_claims pc WHERE pc.task_id = pt.id) AS claim_count,
                    (SELECT COUNT(*) FROM player_task_claims pc WHERE pc.task_id = pt.id AND pc.status = 'completed') AS completed_count
             FROM player_tasks pt
             JOIN users au ON pt.author_id = au.id
             WHERE pt.status IN ('open', 'accepted')
             ORDER BY pt.id DESC`
        );
        const isAdmin = req.userLevel >= 1;

        // 当前用户接取状态
        const myClaims = await db.all(
            'SELECT task_id, status FROM player_task_claims WHERE user_id = ?',
            [req.userId]
        );
        const myMap = {};
        myClaims.forEach(c => { myMap[c.task_id] = c.status; });

        const result = tasks.map(t => {
            const { code, ...rest } = t;
            return {
                ...rest,
                code: (isAdmin || t.author_id === req.userId) ? code : undefined,
                status_text: STATUS_TEXT[t.status] || t.status,
                my_status: myMap[t.id] || null
            };
        });
        res.json({ tasks: result });
    } catch (error) {
        logger.error('获取玩家任务列表错误:', error);
        res.status(500).json({ error: '获取任务失败' });
    }
});

// 我的玩家任务：我发布的 + 我接取的（含 code、操作入口）
router.get('/mine', authMiddleware, async (req, res) => {
    try {
        const published = await db.all(
            `SELECT pt.*, cu.nickname AS acceptor_nickname
             FROM player_tasks pt
             LEFT JOIN users cu ON pt.acceptor_id = cu.id
             WHERE pt.author_id = ? ORDER BY pt.id DESC`,
            [req.userId]
        );
        // 我接取的：从 claims 查
        const accepted = await db.all(
            `SELECT pt.*, au.nickname AS author_nickname, au.username AS author_username,
                    pc.status AS my_status, pc.created_at AS my_created_at, pc.completed_at AS my_completed_at
             FROM player_task_claims pc
             JOIN player_tasks pt ON pt.id = pc.task_id
             JOIN users au ON pt.author_id = au.id
             WHERE pc.user_id = ? ORDER BY pc.id DESC`,
            [req.userId]
        );
        published.forEach(t => { t.status_text = STATUS_TEXT[t.status] || t.status; });
        accepted.forEach(t => { t.status_text = STATUS_TEXT[t.status] || t.status; });
        res.json({ published, accepted });
    } catch (error) {
        logger.error('获取我的玩家任务错误:', error);
        res.status(500).json({ error: '获取任务失败' });
    }
});

// 发布玩家任务：校验贡献点足够 → 生成验证码 → 扣除贡献点 → 创建任务
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { title, description, images, projection, reward, maxPeople } = req.body;

        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: '任务标题不能为空' });
        }
        const rw = parseInt(reward);
        if (!rw || rw <= 0) {
            return res.status(400).json({ error: '悬赏贡献点必须大于0' });
        }
        // maxPeople：-1 无限人数，>=1 限量，默认 1
        const mp = parseInt(maxPeople);
        const maxPeopleVal = Number.isNaN(mp) || mp <= 0 ? (mp === -1 ? -1 : 1) : mp;

        // 校验并扣除贡献点（原子操作）
        const deduct = await db.run(
            'UPDATE users SET contribution = contribution - ?, updated_at = ? WHERE id = ? AND contribution >= ?',
            [rw, getLocalTimestamp(), req.userId, rw]
        );
        if (!deduct.changes) {
            return res.status(400).json({ error: '贡献点不足，无法发布任务' });
        }

        const code = generateTaskCode();
        const imagesStr = Array.isArray(images) ? JSON.stringify(images) : (images || '');

        let taskId;
        await db.transaction(async () => {
            const result = await db.run(
                'INSERT INTO player_tasks (author_id, title, description, images, projection, reward, code, status, max_people, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [req.userId, String(title).trim(), String(description || '').trim(), imagesStr, projection || '', rw, code, 'open', maxPeopleVal, getLocalTimestamp(), getLocalTimestamp()]
            );
            taskId = result.id;
        });

        await addContributionLog(req.userId, -rw, 'player_task', taskId, `发布任务：${String(title).trim()}`);

        res.status(201).json({ message: '任务发布成功，已扣除悬赏贡献点', taskId, code });
    } catch (error) {
        logger.error('发布玩家任务错误:', error);
        res.status(500).json({ error: '发布失败' });
    }
});

// 接取任务（作者不可接取自己的任务；多人可接取，受 max_people 限制）
router.post('/:id/accept', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const task = await db.get('SELECT * FROM player_tasks WHERE id = ?', [id]);
        if (!task) return res.status(404).json({ error: '任务不存在' });
        if (task.status !== 'open') return res.status(400).json({ error: '该任务已不可接取' });
        if (task.author_id === req.userId) return res.status(400).json({ error: '不能接取自己发布的任务' });

        // 已接取过则拒绝
        const existing = await db.get(
            'SELECT id FROM player_task_claims WHERE task_id = ? AND user_id = ?',
            [id, req.userId]
        );
        if (existing) return res.status(400).json({ error: '您已接取该任务' });

        // 人数限制：max_people >= 1 时已达上限则拒绝
        if (task.max_people >= 1) {
            const cnt = await db.get(
                'SELECT COUNT(*) AS c FROM player_task_claims WHERE task_id = ?',
                [id]
            );
            if ((cnt?.c || 0) >= task.max_people) {
                return res.status(400).json({ error: `该任务人数已满（${task.max_people} 人）` });
            }
        }

        // 插入接取记录
        const insert = await db.run(
            'INSERT INTO player_task_claims (task_id, user_id, status) VALUES (?, ?, ?)',
            [id, req.userId, 'pending']
        );
        if (!insert.changes) return res.status(400).json({ error: '接取失败，请重试' });
        // 任务从未接取变为已被接取，状态更新为 accepted（仍有空位则保持可接取）
        await db.run(
            "UPDATE player_tasks SET status = 'accepted', updated_at = ? WHERE id = ?",
            [getLocalTimestamp(), id]
        );

        try {
            await createNotification({
                userId: task.author_id,
                type: 'player_task',
                title: '任务被接取',
                content: `您的玩家任务「${task.title}」有新成员接取，请线下核对完成情况后提供验证码`
            });
        } catch (e) { /* 忽略 */ }

        res.json({ message: '任务接取成功' });
    } catch (error) {
        logger.error('接取玩家任务错误:', error);
        res.status(500).json({ error: '接取失败' });
    }
});

// 完成核实：接取者提交发布者提供的验证码 → 贡献点转账到账
router.post('/:id/complete', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { code } = req.body;
        if (!code || !String(code).trim()) {
            return res.status(400).json({ error: '请输入完成验证码' });
        }

        const task = await db.get('SELECT * FROM player_tasks WHERE id = ?', [id]);
        if (!task) return res.status(404).json({ error: '任务不存在' });

        const claim = await db.get(
            'SELECT * FROM player_task_claims WHERE task_id = ? AND user_id = ?',
            [id, req.userId]
        );
        if (!claim) return res.status(400).json({ error: '只有接取者才能提交验证码' });
        if (claim.status === 'completed') return res.status(400).json({ error: '您已完成该任务' });
        if (String(code).trim().toUpperCase() !== task.code.toUpperCase()) {
            return res.status(400).json({ error: '验证码错误' });
        }

        await db.transaction(async () => {
            await db.run(
                'UPDATE player_task_claims SET status = ?, code = ?, completed_at = ? WHERE id = ?',
                ['completed', String(code).trim().toUpperCase(), getLocalTimestamp(), claim.id]
            );
            await db.run(
                'UPDATE users SET contribution = contribution + ?, updated_at = ? WHERE id = ?',
                [task.reward, getLocalTimestamp(), req.userId]
            );
        });

        await addContributionLog(req.userId, task.reward, 'player_task', task.id, `完成玩家任务：${task.title}`);

        try {
            await createNotification({
                userId: task.author_id,
                type: 'player_task',
                title: '任务有人完成',
                content: `您的玩家任务「${task.title}」有成员完成，${task.reward} 贡献点已发放`
            });
        } catch (e) { /* 忽略 */ }

        res.json({ message: '任务完成，贡献点已到账', reward: task.reward });
    } catch (error) {
        logger.error('完成玩家任务错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 取消任务（发布者可取消待接取或进行中任务，退回贡献点）
router.post('/:id/cancel', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const task = await db.get('SELECT * FROM player_tasks WHERE id = ?', [id]);
        if (!task) return res.status(404).json({ error: '任务不存在' });
        if (task.author_id !== req.userId) return res.status(403).json({ error: '只有发布者可以取消任务' });
        if (task.status !== 'open' && task.status !== 'accepted') return res.status(400).json({ error: '该任务不可取消' });

        await db.transaction(async () => {
            await db.run(
                "UPDATE player_tasks SET status = 'cancelled', updated_at = ? WHERE id = ?",
                [getLocalTimestamp(), id]
            );
            await db.run(
                'UPDATE users SET contribution = contribution + ?, updated_at = ? WHERE id = ?',
                [task.reward, getLocalTimestamp(), req.userId]
            );
        });

        await addContributionLog(req.userId, task.reward, 'player_task', task.id, `取消玩家任务退回：${task.title}`);

        res.json({ message: '任务已取消，悬赏贡献点已退回' });
    } catch (error) {
        logger.error('取消玩家任务错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

module.exports = router;
