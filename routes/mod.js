/**
 * 模组联动接口：供 Fabric 模组（xuanjianmod）调用
 * 认证：X-Server-Key 请求头（服务器密钥，见 mod_servers 表）
 * 玩家身份：通过 uuid 在 mod_bindings 表解析为官网用户
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { addContributionLog } = require('../lib/contribution');
const { createNotification } = require('./notifications');
const { sendBindConfirm } = require('../config/mail');
const router = express.Router();

const SITE_URL = process.env.SITE_URL || 'https://xuanjian.top';

/* ============ 中间件：服务器密钥鉴权 ============ */
async function modAuth(req, res, next) {
    try {
        const key = req.headers['x-server-key'];
        if (!key) {
            return res.status(401).json({ error: '缺少服务器密钥 (X-Server-Key)' });
        }
        const server = await db.get('SELECT * FROM mod_servers WHERE server_key = ?', [key]);
        if (!server) {
            return res.status(401).json({ error: '服务器密钥无效' });
        }
        req.modServer = server;
        await db.run('UPDATE mod_servers SET last_seen_at = ? WHERE id = ?', [getLocalTimestamp(), server.id]);
        next();
    } catch (e) {
        logger.error('模组鉴权错误:', e);
        res.status(500).json({ error: '鉴权失败' });
    }
}

/* ============ 工具：uuid → 官网用户 ============ */
async function resolveUserByUuid(uuid) {
    const binding = await db.get('SELECT * FROM mod_bindings WHERE uuid = ? AND status = ?', [uuid, 'confirmed']);
    if (!binding) return null;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [binding.user_id]);
    return user;
}

/* ============ 功能2：绑定 ============ */

// 发起绑定：向官网账号邮箱发送确认邮件
router.post('/bind/request', modAuth, async (req, res) => {
    try {
        const { uuid, playerName, accountId } = req.body;
        if (!uuid || !playerName || !accountId) {
            return res.status(400).json({ error: '参数不完整' });
        }

        // 查找官网账号（用户名或昵称）
        const user = await db.get(
            'SELECT * FROM users WHERE username = ? OR nickname = ? LIMIT 1',
            [accountId, accountId]
        );
        if (!user) {
            return res.status(404).json({ error: '官网账号不存在' });
        }
        if (!user.email || !user.email_verified) {
            return res.status(400).json({ error: '该账号未绑定邮箱，请先在官网个人设置中绑定并验证邮箱' });
        }

        // 若该 uuid 已绑定，拒绝重复绑定
        const existing = await db.get('SELECT * FROM mod_bindings WHERE uuid = ?', [uuid]);
        if (existing && existing.status === 'confirmed') {
            return res.status(400).json({ error: '该游戏角色已绑定官网账号' });
        }

        const bindCode = crypto.randomBytes(8).toString('hex');
        if (existing) {
            await db.run(
                'UPDATE mod_bindings SET user_id = ?, player_name = ?, bind_code = ?, status = ?, created_at = ? WHERE uuid = ?',
                [user.id, playerName, bindCode, 'pending', getLocalTimestamp(), uuid]
            );
        } else {
            await db.run(
                'INSERT INTO mod_bindings (uuid, user_id, player_name, bind_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [uuid, user.id, playerName, bindCode, 'pending', getLocalTimestamp()]
            );
        }

        // 发送确认邮件（含确认链接）
        const confirmUrl = `${SITE_URL}/api/mod/bind/confirm?code=${bindCode}&uuid=${uuid}`;
        try {
            await sendBindConfirm(user.email, { playerName, confirmUrl });
        } catch (e) {
            logger.error('绑定确认邮件发送失败:', e.message);
            return res.status(500).json({ error: '确认邮件发送失败，请稍后重试' });
        }

        res.json({ message: '确认邮件已发送', email: user.email });
    } catch (e) {
        logger.error('发起绑定错误:', e);
        res.status(500).json({ error: '绑定请求失败' });
    }
});

// 邮件确认链接（浏览器访问）
router.get('/bind/confirm', async (req, res) => {
    try {
        const { code, uuid } = req.query;
        const binding = await db.get(
            'SELECT b.*, u.nickname, u.username FROM mod_bindings b JOIN users u ON b.user_id = u.id WHERE b.uuid = ? AND b.bind_code = ?',
            [uuid, code]
        );
        if (!binding) {
            return res.status(400).send('<h3>绑定确认链接无效或已过期，请重新在游戏内执行 /xj bind</h3>');
        }
        if (binding.status === 'confirmed') {
            return res.send(`<h3>该游戏角色已绑定官网账号「${binding.nickname || binding.username}」</h3><p><a href="${SITE_URL}">返回官网</a></p>`);
        }
        await db.run(
            'UPDATE mod_bindings SET status = ?, confirmed_at = ? WHERE uuid = ?',
            ['confirmed', getLocalTimestamp(), uuid]
        );
        // game_id 直接取游戏内名字
        await db.run('UPDATE users SET game_id = ? WHERE id = ?', [binding.player_name, binding.user_id]);
        await db.run(
            "UPDATE users SET updated_at = ? WHERE id = ?",
            [getLocalTimestamp(), binding.user_id]
        );
        res.send(`<h3>绑定成功！游戏角色「${binding.player_name}」已绑定官网账号「${binding.nickname || binding.username}」</h3><p><a href="${SITE_URL}">返回官网</a></p>`);
    } catch (e) {
        logger.error('绑定确认错误:', e);
        res.status(500).send('<h3>绑定确认失败，请稍后重试</h3>');
    }
});

// 查询绑定状态
router.get('/bind/status', modAuth, async (req, res) => {
    try {
        const { uuid } = req.query;
        if (!uuid) return res.status(400).json({ error: '缺少 uuid' });
        const binding = await db.get('SELECT * FROM mod_bindings WHERE uuid = ?', [uuid]);
        if (!binding) {
            return res.json({ bound: false });
        }
        res.json({
            bound: binding.status === 'confirmed',
            status: binding.status,
            accountId: binding.status === 'confirmed' ? binding.user_id : null,
            playerName: binding.player_name
        });
    } catch (e) {
        logger.error('查询绑定状态错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

/* ============ 功能1：自动签到 ============ */

// 签到（模组登录后自动调用）
router.post('/checkin', modAuth, async (req, res) => {
    try {
        const { uuid } = req.body;
        if (!uuid) return res.status(400).json({ error: '缺少 uuid' });

        const user = await resolveUserByUuid(uuid);
        if (!user) {
            return res.status(400).json({ error: '该游戏角色未绑定官网账号' });
        }

        const today = new Date().toISOString().split('T')[0];
        const existing = await db.get(
            'SELECT * FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [user.id, today]
        );
        if (existing) {
            return res.status(400).json({ error: '今日已签到' });
        }

        const rewardPoints = 2; // 固定签到奖励
        await db.transaction(async () => {
            const result = await db.run(
                'INSERT INTO checkins (user_id, checkin_date, continuous_days, reward_points, created_at) VALUES (?, ?, ?, ?, ?)',
                [user.id, today, 1, rewardPoints, getLocalTimestamp()]
            );
            await db.run(
                'UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?',
                [rewardPoints, user.id]
            );
            await addContributionLog(user.id, rewardPoints, 'reward', result.id, '模组自动签到');
        });

        const fresh = await db.get('SELECT contribution FROM users WHERE id = ?', [user.id]);
        res.json({
            message: '签到成功',
            rewardPoints,
            totalContribution: fresh.contribution || 0,
            continuousDays: 1
        });
    } catch (e) {
        logger.error('模组签到错误:', e);
        res.status(500).json({ error: '签到失败' });
    }
});

// 签到状态（今日是否已签）
router.get('/checkin/status', modAuth, async (req, res) => {
    try {
        const { uuid } = req.query;
        if (!uuid) return res.status(400).json({ error: '缺少 uuid' });
        const user = await resolveUserByUuid(uuid);
        if (!user) return res.json({ checkedIn: false });
        const today = new Date().toISOString().split('T')[0];
        const existing = await db.get(
            'SELECT * FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [user.id, today]
        );
        res.json({ checkedIn: !!existing });
    } catch (e) {
        logger.error('查询签到状态错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

/* ============ 功能4：任务 ============ */

// 任务列表
router.get('/tasks', modAuth, async (req, res) => {
    try {
        const { uuid } = req.query;
        if (!uuid) return res.status(400).json({ error: '缺少 uuid' });
        const user = await resolveUserByUuid(uuid);
        if (!user) return res.status(400).json({ error: '该游戏角色未绑定官网账号' });

        const tasks = await db.all(
            `SELECT t.*, u.nickname AS creator_nickname
             FROM tasks t
             JOIN users u ON t.created_by = u.id
             WHERE t.is_active = 1
             ORDER BY t.id DESC`
        );
        const myClaims = await db.all('SELECT task_id, status FROM task_claims WHERE user_id = ?', [user.id]);
        const myMap = {};
        myClaims.forEach(c => { myMap[c.task_id] = c.status; });

        const result = tasks.map(t => {
            const { code, ...rest } = t;
            return { ...rest, myStatus: myMap[t.id] || null };
        });
        res.json({ tasks: result });
    } catch (e) {
        logger.error('模组任务列表错误:', e);
        res.status(500).json({ error: '获取任务失败' });
    }
});

// 我的任务
router.get('/tasks/my', modAuth, async (req, res) => {
    try {
        const { uuid } = req.query;
        if (!uuid) return res.status(400).json({ error: '缺少 uuid' });
        const user = await resolveUserByUuid(uuid);
        if (!user) return res.status(400).json({ error: '该游戏角色未绑定官网账号' });

        const claims = await db.all(
            `SELECT tc.*, t.title, t.reward FROM task_claims tc
             JOIN tasks t ON tc.task_id = t.id
             WHERE tc.user_id = ? ORDER BY tc.id DESC`,
            [user.id]
        );
        res.json({ claims });
    } catch (e) {
        logger.error('模组我的任务错误:', e);
        res.status(500).json({ error: '获取任务失败' });
    }
});

// 接取任务
router.post('/tasks/:id/claim', modAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { uuid } = req.body;
        const user = await resolveUserByUuid(uuid);
        if (!user) return res.status(400).json({ error: '该游戏角色未绑定官网账号' });

        const task = await db.get('SELECT * FROM tasks WHERE id = ? AND is_active = 1', [id]);
        if (!task) return res.status(404).json({ error: '任务不存在或已下线' });

        const existing = await db.get('SELECT id, status FROM task_claims WHERE task_id = ? AND user_id = ?', [id, user.id]);
        if (existing) {
            return res.status(400).json({ error: existing.status === 'completed' ? '您已完成该任务' : '您已接取该任务' });
        }
        await db.run('INSERT INTO task_claims (task_id, user_id, status) VALUES (?, ?, ?)', [id, user.id, 'pending']);
        res.json({ message: '任务接取成功' });
    } catch (e) {
        logger.error('模组接取任务错误:', e);
        res.status(500).json({ error: '接取失败' });
    }
});

// 提交验证码完成任务
router.post('/tasks/:id/complete', modAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { uuid, code } = req.body;
        if (!code || !code.trim()) return res.status(400).json({ error: '请输入完成验证码' });

        const user = await resolveUserByUuid(uuid);
        if (!user) return res.status(400).json({ error: '该游戏角色未绑定官网账号' });

        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
        if (!task) return res.status(404).json({ error: '任务不存在' });

        const claim = await db.get('SELECT * FROM task_claims WHERE task_id = ? AND user_id = ?', [id, user.id]);
        if (!claim) return res.status(400).json({ error: '请先接取任务' });
        if (claim.status === 'completed') return res.status(400).json({ error: '该任务已完成' });

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
                [task.reward, user.id]
            );
            await addContributionLog(user.id, task.reward, 'task', task.id, task.title);
        });

        try {
            await createNotification({
                userId: user.id,
                type: 'task_reward',
                title: '任务完成奖励',
                content: `任务「${task.title}」已完成，获得 ${task.reward} 贡献点`
            });
        } catch (ne) { /* 忽略 */ }

        res.json({ message: '任务完成，贡献点已发放', reward: task.reward });
    } catch (e) {
        logger.error('模组完成任务错误:', e);
        res.status(500).json({ error: '操作失败' });
    }
});

/* ============ 功能6：贡献点余额 / 转账 ============ */

// 余额查询
router.get('/balance', modAuth, async (req, res) => {
    try {
        const { uuid } = req.query;
        if (!uuid) return res.status(400).json({ error: '缺少 uuid' });
        const user = await resolveUserByUuid(uuid);
        if (!user) return res.status(400).json({ error: '该游戏角色未绑定官网账号' });
        res.json({ balance: user.contribution || 0 });
    } catch (e) {
        logger.error('模组余额查询错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

// 转账（模组侧已二次确认）
router.post('/transfer', modAuth, async (req, res) => {
    try {
        const { fromUuid, toPlayer, amount } = req.body;
        const amt = parseInt(amount);
        if (!fromUuid || !toPlayer || !amt || amt <= 0) {
            return res.status(400).json({ error: '参数不合法' });
        }

        const fromUser = await resolveUserByUuid(fromUuid);
        if (!fromUser) return res.status(400).json({ error: '该游戏角色未绑定官网账号' });

        // 目标：优先按 game_id 匹配游戏名，再按用户名/昵称
        const toUser = await db.get(
            'SELECT * FROM users WHERE game_id = ? OR username = ? OR nickname = ? LIMIT 1',
            [toPlayer, toPlayer, toPlayer]
        );
        if (!toUser) return res.status(404).json({ error: '目标玩家不存在' });
        if (toUser.id === fromUser.id) return res.status(400).json({ error: '不能向自己转账' });
        if ((fromUser.contribution || 0) < amt) return res.status(400).json({ error: '贡献点不足' });

        await db.transaction(async () => {
            await db.run(
                'UPDATE users SET contribution = COALESCE(contribution, 0) - ? WHERE id = ?',
                [amt, fromUser.id]
            );
            await db.run(
                'UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?',
                [amt, toUser.id]
            );
            await addContributionLog(fromUser.id, -amt, 'transfer', toUser.id, `转账给 ${toPlayer}`);
            await addContributionLog(toUser.id, amt, 'transfer', fromUser.id, `收到 ${fromUser.nickname || fromUser.username} 转账`);
        });

        try {
            await createNotification({
                userId: toUser.id,
                type: 'claim_result',
                title: '收到贡献点转账',
                content: `您收到来自 ${fromUser.nickname || fromUser.username} 的 ${amt} 贡献点`
            });
        } catch (ne) { /* 忽略 */ }

        res.json({ message: '转账成功', amount: amt });
    } catch (e) {
        logger.error('模组转账错误:', e);
        res.status(500).json({ error: '转账失败' });
    }
});

/* ============ 功能8：申报 ============ */

// 提交申报
router.post('/claims', modAuth, async (req, res) => {
    try {
        const { uuid, amount, reason } = req.body;
        if (!uuid || !amount || amount <= 0) return res.status(400).json({ error: '申报数量必须大于0' });
        if (!reason || reason.trim().length < 10) return res.status(400).json({ error: '申报原因至少10个字符' });

        const user = await resolveUserByUuid(uuid);
        if (!user) return res.status(400).json({ error: '该游戏角色未绑定官网账号' });

        const result = await db.run(
            'INSERT INTO contribution_claims (user_id, amount, reason) VALUES (?, ?, ?)',
            [user.id, amount, reason.trim()]
        );
        res.status(201).json({ message: '申报提交成功，请等待管理员审核', claimId: result.id });
    } catch (e) {
        logger.error('模组申报错误:', e);
        res.status(500).json({ error: '提交申报失败' });
    }
});

// 新申报轮询（功能10：管理员提醒）
router.get('/admin/claims', modAuth, async (req, res) => {
    try {
        const since = parseInt(req.query.since) || 0;
        const claims = await db.all(
            `SELECT cc.id, cc.amount, cc.reason, cc.created_at, u.nickname, u.username
             FROM contribution_claims cc
             JOIN users u ON cc.user_id = u.id
             WHERE cc.id > ? AND cc.status = 'pending'
             ORDER BY cc.id ASC`,
            [since]
        );
        res.json({ claims });
    } catch (e) {
        logger.error('模组申报提醒轮询错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

/* ============ 功能5：日报/决策更新同步 ============ */

// 增量拉取日报/决策
router.get('/updates', modAuth, async (req, res) => {
    try {
        const since = parseInt(req.query.since) || 0;
        const posts = await db.all(
            `SELECT id, title, type, created_at FROM posts
             WHERE id > ? AND type IN ('daily', 'decision') AND status = 'active'
             ORDER BY id ASC`,
            [since]
        );
        res.json({ updates: posts });
    } catch (e) {
        logger.error('模组日报同步错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

/* ============ 功能3+9：在线玩家 ============ */

// 上报本服务器在线玩家
router.post('/online/report', modAuth, async (req, res) => {
    try {
        const { serverIp, players } = req.body;
        if (!serverIp || !Array.isArray(players)) {
            return res.status(400).json({ error: '参数不完整' });
        }
        await db.transaction(async () => {
            await db.run('DELETE FROM mod_online WHERE server_ip = ?', [serverIp]);
            for (const p of players) {
                if (!p.uuid || !p.name) continue;
                await db.run(
                    'INSERT OR REPLACE INTO mod_online (server_ip, uuid, player_name, updated_at) VALUES (?, ?, ?, ?)',
                    [serverIp, p.uuid, p.name, getLocalTimestamp()]
                );
            }
        });
        res.json({ message: '已上报', count: players.length });
    } catch (e) {
        logger.error('模组在线上报错误:', e);
        res.status(500).json({ error: '上报失败' });
    }
});

// 查询指定服务器在线玩家
router.get('/online', modAuth, async (req, res) => {
    try {
        const { serverIp } = req.query;
        if (!serverIp) return res.status(400).json({ error: '缺少 serverIp' });
        const players = await db.all(
            'SELECT uuid, player_name AS name FROM mod_online WHERE server_ip = ? ORDER BY player_name',
            [serverIp]
        );
        res.json({ players });
    } catch (e) {
        logger.error('模组在线查询错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

/* ============ 功能7：活跃心跳 ============ */

// 活跃心跳上报
router.post('/heartbeat', modAuth, async (req, res) => {
    try {
        const { players, onlineCount } = req.body;
        const now = getLocalTimestamp();
        if (Array.isArray(players)) {
            for (const u of players) {
                const user = await resolveUserByUuid(u);
                const name = user ? (user.game_id || user.nickname || user.username) : '';
                await db.run(
                    'INSERT INTO mod_active (uuid, player_name, last_active_at) VALUES (?, ?, ?) ON CONFLICT(uuid) DO UPDATE SET player_name = ?, last_active_at = ?',
                    [u, name, now, name, now]
                );
            }
        }
        res.json({ message: '心跳已记录', activeCount: Array.isArray(players) ? players.length : 0 });
    } catch (e) {
        logger.error('模组心跳错误:', e);
        res.status(500).json({ error: '心跳上报失败' });
    }
});

/* ============ 管理端：服务器管理 ============ */

// 服务器列表
router.get('/servers', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const servers = await db.all('SELECT id, server_key, name, server_ip, last_seen_at, created_at FROM mod_servers ORDER BY id');
        res.json({ servers });
    } catch (e) {
        logger.error('服务器列表错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

// 新增服务器
router.post('/servers', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, serverIp } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: '服务器名称不能为空' });
        const serverKey = 'xjk_' + crypto.randomBytes(16).toString('hex');
        const result = await db.run(
            'INSERT INTO mod_servers (server_key, name, server_ip) VALUES (?, ?, ?)',
            [serverKey, name.trim(), serverIp?.trim() || '']
        );
        res.status(201).json({ message: '服务器添加成功', serverId: result.id, serverKey });
    } catch (e) {
        logger.error('新增服务器错误:', e);
        res.status(500).json({ error: '添加失败' });
    }
});

// 更新服务器（名称/IP）
router.put('/servers/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, serverIp } = req.body;
        await db.run(
            'UPDATE mod_servers SET name = ?, server_ip = ? WHERE id = ?',
            [name?.trim() || '', serverIp?.trim() || '', id]
        );
        res.json({ message: '服务器更新成功' });
    } catch (e) {
        logger.error('更新服务器错误:', e);
        res.status(500).json({ error: '更新失败' });
    }
});

// 删除服务器
router.delete('/servers/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await db.run('DELETE FROM mod_servers WHERE id = ?', [id]);
        res.json({ message: '服务器删除成功' });
    } catch (e) {
        logger.error('删除服务器错误:', e);
        res.status(500).json({ error: '删除失败' });
    }
});

// 活跃总人数统计（官网看板用）
router.get('/active-count', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const count = await db.get(
            "SELECT COUNT(*) AS cnt FROM mod_active WHERE date(last_active_at) = ?",
            [today]
        );
        res.json({ activeCount: count.cnt || 0 });
    } catch (e) {
        logger.error('活跃人数统计错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

module.exports = router;
