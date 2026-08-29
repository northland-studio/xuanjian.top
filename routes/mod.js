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

/* ============ 中间件：玩家 uuid 绑定校验（客户端模组通道） ============ */
async function playerAuth(req, res, next) {
    try {
        // 兼容两种传参：通用 uuid / 转账接口的 fromUuid（模组 ContributionManager 发 fromUuid）
        const uuid = req.query.uuid || req.body.uuid || req.body.fromUuid || req.headers['x-player-uuid'];
        if (!uuid || typeof uuid !== 'string' || uuid.length > 64) {
            return res.status(400).json({ error: '缺少或非法的 uuid' });
        }
        const user = await resolveUserByUuid(uuid);
        if (!user) {
            return res.status(401).json({ error: '该游戏角色未绑定官网账号' });
        }
        req.modUser = user;
        req.modUuid = uuid;
        next();
    } catch (e) {
        logger.error('玩家鉴权错误:', e);
        res.status(500).json({ error: '鉴权失败' });
    }
}

/* ============ 功能2：绑定 ============ */

// 发起绑定：向官网账号邮箱发送确认邮件（公开：需邮箱确认后才生效）
router.post('/bind/request', async (req, res) => {
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

// 查询绑定状态（公开：仅按 uuid 返回其绑定状态）
router.get('/bind/status', async (req, res) => {
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

// 签到（模组登录后自动调用，玩家级：uuid 须已绑定）
router.post('/checkin', playerAuth, async (req, res) => {
    try {
        const { uuid } = req.body;
        if (!uuid) return res.status(400).json({ error: '缺少 uuid' });

        const user = await resolveUserByUuid(uuid);
        if (!user) {
            return res.status(400).json({ error: '该游戏角色未绑定官网账号' });
        }

        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const existing = await db.get(
            'SELECT * FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [user.id, today]
        );
        if (existing) {
            return res.status(400).json({ error: '今日已签到' });
        }

        // 连续签到天数：昨天已签到则 +1，否则重置为 1（与官网 /api/checkin 逻辑一致）
        const yesterdayCheckin = await db.get(
            'SELECT continuous_days FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [user.id, yesterday]
        );
        const continuousDays = yesterdayCheckin ? (yesterdayCheckin.continuous_days + 1) : 1;

        const rewardPoints = 2; // 固定签到奖励
        await db.transaction(async () => {
            const result = await db.run(
                'INSERT INTO checkins (user_id, checkin_date, continuous_days, reward_points, created_at) VALUES (?, ?, ?, ?, ?)',
                [user.id, today, continuousDays, rewardPoints, getLocalTimestamp()]
            );
            await db.run(
                'UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?',
                [rewardPoints, user.id]
            );
            await addContributionLog(user.id, rewardPoints, 'reward', result.id, `模组自动签到，连续${continuousDays}天`);
        });

        const fresh = await db.get('SELECT contribution FROM users WHERE id = ?', [user.id]);
        res.json({
            message: '签到成功',
            rewardPoints,
            totalContribution: fresh.contribution || 0,
            continuousDays
        });
    } catch (e) {
        logger.error('模组签到错误:', e);
        res.status(500).json({ error: '签到失败' });
    }
});

// 签到状态（今日是否已签）
router.get('/checkin/status', playerAuth, async (req, res) => {
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
router.get('/tasks', playerAuth, async (req, res) => {
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
router.get('/tasks/my', playerAuth, async (req, res) => {
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
router.post('/tasks/:id/claim', playerAuth, async (req, res) => {
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
router.post('/tasks/:id/complete', playerAuth, async (req, res) => {
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
router.get('/balance', playerAuth, async (req, res) => {
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

// 转账（玩家级：fromUuid 须已绑定）
router.post('/transfer', playerAuth, async (req, res) => {
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
router.post('/claims', playerAuth, async (req, res) => {
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
// 两种调用通道：
//  - 服务器模组：带 X-Server-Key，返回 claims + adminUuids（全部管理员已绑定的游戏角色）
//  - 客户端模组（管理员玩家）：带 uuid，非管理员返回 403
router.get('/admin/claims', async (req, res) => {
    try {
        const since = parseInt(req.query.since) || 0;

        // 服务器通道
        let isServer = false;
        const key = req.headers['x-server-key'];
        if (key) {
            const server = await db.get('SELECT * FROM mod_servers WHERE server_key = ?', [key]);
            if (server) isServer = true;
        }

        // 玩家通道（uuid 对应官网账号 level >= 1）
        let isAdminPlayer = false;
        const uuid = req.query.uuid;
        if (!isServer && uuid) {
            const user = await resolveUserByUuid(uuid);
            if (user && user.level >= 1) isAdminPlayer = true;
        }

        if (!isServer && !isAdminPlayer) {
            return res.status(403).json({ error: '无权限：仅官网管理员可查看待审申报' });
        }

        const claims = await db.all(
            `SELECT cc.id, cc.amount, cc.reason, cc.created_at, u.nickname, u.username
             FROM contribution_claims cc
             JOIN users u ON cc.user_id = u.id
             WHERE cc.id > ? AND cc.status = 'pending'
             ORDER BY cc.id ASC`,
            [since]
        );

        let adminUuids = [];
        if (isServer) {
            const rows = await db.all(
                `SELECT b.uuid FROM mod_bindings b
                 JOIN users u ON b.user_id = u.id
                 WHERE u.level >= 1 AND b.status = 'confirmed'`
            );
            adminUuids = rows.map(r => r.uuid);
        }

        res.json({ claims, adminUuids });
    } catch (e) {
        logger.error('模组申报提醒轮询错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

/* ============ 功能5：日报/决策更新同步 ============ */

// 增量拉取日报/决策（公开：官网帖子本就公开）
router.get('/updates', async (req, res) => {
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

// 客户端上线上报（玩家级：uuid 须已绑定；server 须匹配管理后台配置的白名单 server_ip）
router.post('/online/join', playerAuth, async (req, res) => {
    try {
        const { server } = req.body;
        if (!server || typeof server !== 'string') {
            return res.status(400).json({ error: '缺少服务器地址' });
        }
        const matched = await matchWhiteList(server);
        if (!matched) {
            return res.json({ ignored: true, message: '服务器不在白名单，未记录在线' });
        }
        const user = req.modUser;
        const name = user.game_id || user.nickname || user.username || '';
        await db.run(
            'INSERT OR REPLACE INTO mod_online (server_ip, uuid, player_name, updated_at) VALUES (?, ?, ?, ?)',
            [matched, req.modUuid, name, getLocalTimestamp()]
        );
        await accumulateOnlineTime(req.modUuid, user); // 累计上线时长
        res.json({ message: '已上线', server: matched });
    } catch (e) {
        logger.error('客户端上线上报错误:', e);
        res.status(500).json({ error: '上报失败' });
    }
});

// 客户端下线上报
router.post('/online/leave', playerAuth, async (req, res) => {
    try {
        const { server } = req.body;
        if (!server) return res.status(400).json({ error: '缺少服务器地址' });
        const matched = await matchWhiteList(server);
        if (!matched) return res.json({ message: '未匹配白名单，无需处理' });
        await db.run('DELETE FROM mod_online WHERE server_ip = ? AND uuid = ?', [matched, req.modUuid]);
        await accumulateOnlineTime(req.modUuid, req.modUser, true); // 下线：累计并清空会话
        res.json({ message: '已下线' });
    } catch (e) {
        logger.error('客户端下线上报错误:', e);
        res.status(500).json({ error: '上报失败' });
    }
});

/** 白名单匹配：server 与 mod_servers.server_ip 去掉端口后相等即命中，返回存储的 server_ip；否则返回空 */
async function matchWhiteList(server) {
    const base = String(server).split(':')[0];
    if (!base) return '';
    const servers = await db.all('SELECT server_ip FROM mod_servers WHERE server_ip IS NOT NULL AND server_ip != ?', ['']);
    for (const s of servers) {
        const sBase = String(s.server_ip || '').split(':')[0];
        if (sBase && sBase === base) return s.server_ip;
    }
    return '';
}

/* ============ 上线时长累计（在线时长排行榜） ============ */

/**
 * 累计玩家在线时长到 online_time 表。
 * 策略：记录最近一次"在线确认"时间 last_seen_at；每次确认在线（join 续报 / leave / 心跳）时，
 * 累加 上次确认到本次确认 的时间差（秒），再刷新 last_seen_at。
 * 为避免掉线后未上报导致的虚高，单次累加上限为 90 分钟（5400 秒），超出按新会话处理。
 * @param {string} uuid 玩家游戏 uuid
 * @param {object} user 官网用户（含 id/nickname/game_id/username），可为 null
 * @param {boolean} isLeave 是否下线（下线后清空 last_seen_at）
 */
async function accumulateOnlineTime(uuid, user, isLeave = false) {
    try {
        const now = Date.now();
        const nowStr = getLocalTimestamp();
        const row = await db.get('SELECT id, total_seconds, last_seen_at FROM online_time WHERE uuid = ?', [uuid]);
        let total = row ? (row.total_seconds || 0) : 0;
        let lastTs = null;

        if (row && row.last_seen_at) {
            // last_seen_at 是本地时间字符串（getLocalTimestamp 返回本地时间），用本地时区解析还原时间戳
            lastTs = Date.parse(String(row.last_seen_at).replace(' ', 'T'));
            if (!isNaN(lastTs)) {
                let delta = Math.floor((now - lastTs) / 1000);
                const MAX_SESSION = 5400; // 90 分钟
                if (delta > 0 && delta < MAX_SESSION) {
                    total += delta;
                }
            }
        }

        await db.run(
            `INSERT INTO online_time (uuid, user_id, player_name, total_seconds, last_seen_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(uuid) DO UPDATE SET
                user_id = excluded.user_id,
                player_name = excluded.player_name,
                total_seconds = excluded.total_seconds,
                last_seen_at = excluded.last_seen_at,
                updated_at = excluded.updated_at`,
            [uuid, user ? user.id : null, user ? (user.game_id || user.nickname || user.username || '') : '',
             total, isLeave ? null : nowStr, nowStr]
        );
    } catch (e) {
        logger.error('上线时长累计错误:', e.message);
    }
}

// 查询在线玩家（仅返回已绑定官网账号的玄剑玩家，且记录在 TTL 内未过期）
// serverIp 可选：带则查指定服务器，不带则查全网各服务器
router.get('/online', async (req, res) => {
    try {
        const { serverIp } = req.query;
        const ttl = '-60 minutes'; // 在线记录 60 分钟未续报视为离线（由客户端心跳/续报刷新）
        let players;
        if (serverIp) {
            players = await db.all(
                `SELECT o.uuid, o.player_name AS name
                 FROM mod_online o
                 JOIN mod_bindings b ON o.uuid = b.uuid AND b.status = 'confirmed'
                 WHERE o.server_ip = ? AND o.updated_at >= datetime('now', 'localtime', ?)
                 ORDER BY o.player_name`,
                [serverIp, ttl]
            );
        } else {
            players = await db.all(
                `SELECT o.uuid, o.player_name AS name
                 FROM mod_online o
                 JOIN mod_bindings b ON o.uuid = b.uuid AND b.status = 'confirmed'
                 WHERE o.updated_at >= datetime('now', 'localtime', ?)
                 ORDER BY o.player_name`,
                [ttl]
            );
        }
        res.json({ players });
    } catch (e) {
        logger.error('模组在线查询错误:', e);
        res.status(500).json({ error: '查询失败' });
    }
});

/* ============ 功能7：活跃心跳 ============ */

// 活跃心跳上报（玩家级：仅记录已绑定官网账号的活跃 uuid，防伪造）
router.post('/heartbeat', async (req, res) => {
    try {
        const { players } = req.body;
        const now = getLocalTimestamp();
        let recorded = 0;
        if (Array.isArray(players)) {
            for (const u of players) {
                const user = await resolveUserByUuid(u);
                if (!user) continue; // 未绑定的 uuid 不参与活跃统计
                const name = user.game_id || user.nickname || user.username || '';
                await db.run(
                    'INSERT INTO mod_active (uuid, player_name, last_active_at) VALUES (?, ?, ?) ON CONFLICT(uuid) DO UPDATE SET player_name = ?, last_active_at = ?',
                    [u, name, now, name, now]
                );
                await accumulateOnlineTime(u, user); // 心跳同时累计上线时长
                recorded++;
            }
        }
        res.json({ message: '心跳已记录', activeCount: recorded });
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
