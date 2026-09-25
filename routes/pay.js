/**
 * 贡献点扫码支付（玄剑版「微信支付」）
 * 设计文档：docs/PAY-QR-DESIGN.md
 *
 * 本文件阶段 2 范围：收款码「主扫」闭环
 *   POST /api/pay/receive-code            生成我的收款码（登录即可，限时 90s）
 *   GET  /api/pay/intents/:token          扫码后查看付款信息
 *   POST /api/pay/intents/:token/confirm  付款人本人在线确认 → 资金划转
 *   GET  /api/pay/records                 我的收付款记录
 *   GET  /api/pay/admin/settings          风控阈值（管理员）
 *   PUT  /api/pay/admin/settings          风控阈值（管理员，可编辑）
 *
 * 冻结决策（7 条）：收款主体三类（个人 / 活动摊位 / 系统金库「玄剑财政」）；
 * 无免密支付，必须付款人本人登录确认；单笔 ≤500，日累计 ≤2000，>200 需管理员审批；
 * 全额流水 + 对账；不收手续费；不设退款/提现。金额一律两位小数（REAL + ROUND）。
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const { addContributionLog } = require('../lib/contribution');
const router = express.Router();

/** 付款意图有效期（决策：90 秒） */
const INTENT_TTL_MS = 90 * 1000;
/** 风控默认阈值（可在 settings 表覆盖，管理员可改） */
const DEFAULTS = { pay_single_limit: 500, pay_daily_limit: 2000, pay_approval_threshold: 200 };

const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function settingNum(key) {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    const v = row ? Number(row.value) : NaN;
    return Number.isFinite(v) && v >= 0 ? v : DEFAULTS[key];
}

async function thresholds() {
    return {
        single: await settingNum('pay_single_limit'),
        daily: await settingNum('pay_daily_limit'),
        approval: await settingNum('pay_approval_threshold')
    };
}

/** 解析并校验金额（两位小数） */
function parseAmount(input) {
    const n = Number(input);
    if (!Number.isFinite(n)) return null;
    const a = round2(n);
    if (a <= 0) return null;
    return a;
}

/** 收款主体 → 实际入账用户 ID */
function payeeUserId(payee) {
    if (payee.type === 'event') return payee.owner_user_id;
    return payee.user_id;
}

/** 取（必要时创建）某用户的个人收款主体 */
async function ensureUserPayee(user) {
    let payee = await db.get("SELECT * FROM pay_payees WHERE type = 'user' AND user_id = ?", [user.id]);
    if (!payee) {
        const name = user.nickname || user.username || `用户${user.id}`;
        const r = await db.run(
            `INSERT INTO pay_payees (type, user_id, system_key, display_name, owner_user_id, status, created_at)
             VALUES ('user', ?, NULL, ?, ?, 'active', ?)`,
            [user.id, name, user.id, getLocalTimestamp()]
        );
        payee = await db.get('SELECT * FROM pay_payees WHERE id = ?', [r.id]);
    }
    return payee;
}

/** 过期清扫：把超时的 created/scanned 意图标记为 expired */
async function sweepExpired() {
    try {
        await db.run(
            `UPDATE pay_intents SET status = 'expired'
             WHERE status IN ('created', 'scanned') AND expires_at < ?`,
            [getLocalTimestamp()]
        );
    } catch (e) { logger.warn('pay 过期清扫失败:', e.message); }
}

/** 查询意图并附带收款主体（过期即时归位） */
async function loadIntent(token) {
    const intent = await db.get('SELECT * FROM pay_intents WHERE token = ?', [token]);
    if (!intent) return null;
    const payee = await db.get('SELECT * FROM pay_payees WHERE id = ?', [intent.payee_id]);
    if (['created', 'scanned'].includes(intent.status) && intent.expires_at < getLocalTimestamp()) {
        await db.run("UPDATE pay_intents SET status = 'expired' WHERE id = ?", [intent.id]);
        intent.status = 'expired';
    }
    return { intent, payee };
}

/** 今日已成功付出的金额 */
async function todayPaid(userId) {
    const row = await db.get(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM pay_transactions
         WHERE from_user_id = ? AND status = 'success' AND date(created_at) = date('now','localtime')`,
        [userId]
    );
    return round2(row ? row.s : 0);
}

/** 创建付款意图 */
async function createIntent({ kind, payeeId, amount, note, createdBy, payerUserId = null, meta = null }) {
    const token = crypto.randomBytes(16).toString('base64url');
    const now = Date.now();
    const expiresAt = new Date(now + INTENT_TTL_MS);
    const fmt = (d) => {
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    const r = await db.run(
        `INSERT INTO pay_intents (token, kind, payee_id, payer_user_id, amount, note, expires_at, status, created_by, created_at, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?)`,
        [token, kind, payeeId, payerUserId, amount, note || '', fmt(expiresAt), createdBy, getLocalTimestamp(), meta ? JSON.stringify(meta) : null]
    );
    return { id: r.id, token, expiresAt: fmt(expiresAt) };
}

/**
 * 生成我的收款码（主扫第一步：收款方出示，付款方扫码）
 * body: { amount?: number, note?: string }
 */
router.post('/receive-code', authMiddleware, async (req, res) => {
    try {
        const user = await db.get('SELECT id, username, nickname FROM users WHERE id = ?', [req.userId]);
        if (!user) return res.status(404).json({ error: '用户不存在' });

        let amount = null;
        if (req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== '') {
            amount = parseAmount(req.body.amount);
            if (amount === null) return res.status(400).json({ error: '金额格式不正确（需大于 0，最多两位小数）' });
            const t = await thresholds();
            if (amount > t.single) return res.status(400).json({ error: `单笔金额不得超过 ${t.single} 贡献点` });
        }

        const payee = await ensureUserPayee(user);
        const intent = await createIntent({
            kind: 'receive',
            payeeId: payee.id,
            amount,
            note: (req.body.note || '').slice(0, 100),
            createdBy: user.id
        });
        await sweepExpired();

        logger.info(`pay: 生成收款码 user=${user.id} amount=${amount === null ? '由付款方填写' : amount} token=${intent.token.slice(0, 8)}…`);
        res.json({
            token: intent.token,
            url: `/pay/${intent.token}`,
            expiresAt: intent.expiresAt,
            ttlSeconds: INTENT_TTL_MS / 1000,
            payee: { id: payee.id, type: payee.type, name: payee.display_name },
            amount
        });
    } catch (error) {
        logger.error('生成收款码错误:', error);
        res.status(500).json({ error: '生成收款码失败' });
    }
});

/**
 * 扫码后读取付款信息（主扫第二步）
 * 不暴露付款方隐私；付款人需登录（决策：必须本人登录确认）
 */
router.get('/intents/:token', authMiddleware, async (req, res) => {
    try {
        const found = await loadIntent(String(req.params.token));
        if (!found) return res.status(404).json({ error: '二维码无效或已被使用' });
        const { intent, payee } = found;

        const me = await db.get('SELECT id, username, nickname, contribution FROM users WHERE id = ?', [req.userId]);
        const t = await thresholds();
        res.json({
            intent: {
                token: intent.token,
                kind: intent.kind,
                status: intent.status,
                amount: intent.amount,
                note: intent.note,
                expiresAt: intent.expires_at,
                createdAt: intent.created_at
            },
            payee: { id: payee.id, type: payee.type, name: payee.display_name },
            me: me ? { id: me.id, nickname: me.nickname || me.username, balance: round2(me.contribution || 0) } : null,
            isSelf: payeeUserId(payee) === req.userId,
            limits: { single: t.single, daily: t.daily, approval: t.approval },
            todayPaid: await todayPaid(req.userId)
        });
    } catch (error) {
        logger.error('读取付款信息错误:', error);
        res.status(500).json({ error: '读取付款信息失败' });
    }
});

/**
 * 付款人本人确认支付（主扫第三步）
 * body: { amount?: number, note?: string }  —— 收款码未定金额时由付款方填写
 */
router.post('/intents/:token/confirm', authMiddleware, async (req, res) => {
    let inTx = false;
    try {
        const found = await loadIntent(String(req.params.token));
        if (!found) return res.status(404).json({ error: '二维码无效或已被使用' });
        const { intent, payee } = found;

        if (intent.status === 'paid') return res.status(409).json({ error: '该二维码已支付完成，不可重复使用' });
        if (intent.status === 'expired') return res.status(410).json({ error: '二维码已过期，请让对方重新生成' });
        if (intent.status === 'awaiting_approval') return res.status(409).json({ error: '该笔支付正在等待管理员审批' });
        if (intent.status !== 'created' && intent.status !== 'scanned') {
            return res.status(409).json({ error: `当前状态（${intent.status}）不可支付` });
        }

        const payerId = req.userId;
        const recipientId = payeeUserId(payee);
        if (!recipientId) return res.status(400).json({ error: '收款主体异常，无法入账' });
        if (recipientId === payerId) return res.status(400).json({ error: '不能向自己付款' });
        if (payee.status !== 'active') return res.status(400).json({ error: '收款主体已停用' });

        const payer = await db.get('SELECT id, username, nickname, COALESCE(contribution,0) AS contribution FROM users WHERE id = ?', [payerId]);
        if (!payer) return res.status(404).json({ error: '用户不存在' });

        // 金额：收款码预设优先，否则用付款方填写值
        const amount = intent.amount !== null && intent.amount !== undefined
            ? round2(intent.amount)
            : parseAmount(req.body.amount);
        if (amount === null) return res.status(400).json({ error: '请填写支付金额（大于 0，最多两位小数）' });

        const t = await thresholds();
        if (amount > t.single) return res.status(400).json({ error: `单笔金额不得超过 ${t.single} 贡献点` });
        const paid = await todayPaid(payerId);
        if (round2(paid + amount) > t.daily) {
            return res.status(400).json({ error: `今日支付额度不足：已付 ${paid}，单日上限 ${t.daily} 贡献点` });
        }

        const note = (req.body.note || intent.note || '').slice(0, 100);
        const ip = req.ip || req.connection?.remoteAddress || '';
        const ua = (req.headers['user-agent'] || '').slice(0, 200);

        // 大额：只挂审批，不动余额（决策：>200 需管理员审批）
        if (amount > t.approval) {
            const r = await db.run(
                `INSERT INTO pay_transactions (intent_id, from_user_id, to_payee_id, amount, note, status, ip, user_agent, created_at)
                 VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?)`,
                [intent.id, payerId, payee.id, amount, note, ip, ua, getLocalTimestamp()]
            );
            await db.run("UPDATE pay_intents SET status = 'awaiting_approval', payer_user_id = ? WHERE id = ?", [payerId, intent.id]);
            logger.info(`pay: 大额待审批 tx=${r.id} payer=${payerId} amount=${amount} payee=${payee.display_name}`);
            return res.json({
                ok: true,
                status: 'pending_approval',
                transactionId: r.id,
                amount,
                message: `金额超过 ${t.approval} 贡献点，已提交管理员审批，审批通过后到账`
            });
        }

        if (round2(payer.contribution) < amount) {
            return res.status(400).json({ error: `余额不足：当前 ${round2(payer.contribution)} 贡献点` });
        }

        // 事务：扣款 + 入账 + 流水 + 意图归位（全部成功或全部回滚）
        await db.run('BEGIN IMMEDIATE');
        inTx = true;
        try {
            const debit = await db.run(
                `UPDATE users SET contribution = ROUND(COALESCE(contribution,0) - ?, 2) WHERE id = ? AND ROUND(COALESCE(contribution,0),2) >= ?`,
                [amount, payerId, amount]
            );
            if (!debit || debit.changes === 0) throw new Error('INSUFFICIENT');

            const credit = await db.run(
                `UPDATE users SET contribution = ROUND(COALESCE(contribution,0) + ?, 2) WHERE id = ?`,
                [amount, recipientId]
            );
            if (!credit || credit.changes === 0) throw new Error('NO_RECIPIENT');

            const tx = await db.run(
                `INSERT INTO pay_transactions (intent_id, from_user_id, to_payee_id, amount, note, status, ip, user_agent, created_at, settled_at)
                 VALUES (?, ?, ?, ?, ?, 'success', ?, ?, ?, ?)`,
                [intent.id, payerId, payee.id, amount, note, ip, ua, getLocalTimestamp(), getLocalTimestamp()]
            );
            await db.run(
                `UPDATE pay_intents SET status = 'paid', payer_user_id = ?, paid_at = ?, paid_tx_id = ? WHERE id = ?`,
                [payerId, getLocalTimestamp(), tx.id, intent.id]
            );
            await db.run('COMMIT');
            inTx = false;

            // 日志与通知（事务外，失败不影响资金结果）
            try {
                await addContributionLog(payerId, -amount, 'pay_out', tx.id, `扫码支付给 ${payee.display_name}${note ? ' · ' + note : ''}`);
                await addContributionLog(recipientId, amount, 'pay_in', tx.id, `收到 ${payer.nickname || payer.username} 的扫码支付${note ? ' · ' + note : ''}`);
            } catch (e) { logger.warn('pay: 贡献点日志写入失败:', e.message); }
            try {
                await createNotification({
                    userId: recipientId,
                    type: 'pay',
                    title: '收到一笔扫码支付',
                    content: `${payer.nickname || payer.username} 向你支付了 ${amount} 贡献点${note ? '（' + note + '）' : ''}`,
                    actorId: payerId,
                    url: '/pay/records'
                });
            } catch (e) { logger.warn('pay: 通知发送失败:', e.message); }

            const after = await db.get('SELECT ROUND(COALESCE(contribution,0),2) AS b FROM users WHERE id = ?', [payerId]);
            logger.info(`pay: 支付成功 tx=${tx.id} ${payerId} → ${recipientId} ${amount} 点`);
            res.json({
                ok: true,
                status: 'success',
                transactionId: tx.id,
                amount,
                payee: { id: payee.id, type: payee.type, name: payee.display_name },
                balance: after ? after.b : null,
                message: `已支付 ${amount} 贡献点给 ${payee.display_name}`
            });
        } catch (e) {
            if (inTx) { try { await db.run('ROLLBACK'); } catch (_) { } inTx = false; }
            if (e.message === 'INSUFFICIENT') return res.status(400).json({ error: '余额不足，支付失败' });
            if (e.message === 'NO_RECIPIENT') return res.status(400).json({ error: '收款账户异常，支付失败' });
            throw e;
        }
    } catch (error) {
        if (inTx) { try { await db.run('ROLLBACK'); } catch (_) { } }
        logger.error('扫码支付错误:', error);
        res.status(500).json({ error: '支付失败，请稍后重试' });
    }
});

/** 我的收付款记录 */
router.get('/records', authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const rows = await db.all(
            `SELECT t.*, p.display_name AS payee_name, p.type AS payee_type,
                    u.username AS from_username, u.nickname AS from_nickname,
                    i.token AS intent_token, i.kind AS intent_kind
             FROM pay_transactions t
             LEFT JOIN pay_payees p ON p.id = t.to_payee_id
             LEFT JOIN users u ON u.id = t.from_user_id
             LEFT JOIN pay_intents i ON i.id = t.intent_id
             WHERE t.from_user_id = ? OR p.user_id = ? OR p.owner_user_id = ?
             ORDER BY t.id DESC LIMIT ?`,
            [req.userId, req.userId, req.userId, limit]
        );
        res.json({
            records: rows.map(r => ({
                id: r.id,
                direction: r.from_user_id === req.userId ? 'out' : 'in',
                amount: round2(r.amount),
                status: r.status,
                note: r.note,
                payeeName: r.payee_name,
                fromName: r.from_nickname || r.from_username,
                kind: r.intent_kind,
                createdAt: r.created_at,
                settledAt: r.settled_at
            })),
            todayPaid: await todayPaid(req.userId)
        });
    } catch (error) {
        logger.error('获取支付记录错误:', error);
        res.status(500).json({ error: '获取支付记录失败' });
    }
});

/** 风控阈值（管理员） */
router.get('/admin/settings', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const t = await thresholds();
        res.json({ single: t.single, daily: t.daily, approval: t.approval });
    } catch (error) {
        logger.error('读取支付阈值错误:', error);
        res.status(500).json({ error: '读取阈值失败' });
    }
});

router.put('/admin/settings', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const map = { single: 'pay_single_limit', daily: 'pay_daily_limit', approval: 'pay_approval_threshold' };
        const saved = {};
        for (const [field, key] of Object.entries(map)) {
            if (req.body[field] === undefined) continue;
            const v = Number(req.body[field]);
            if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${field} 必须是不小于 0 的数字` });
            const exists = await db.get('SELECT key FROM settings WHERE key = ?', [key]);
            if (exists) await db.run('UPDATE settings SET value = ? WHERE key = ?', [String(v), key]);
            else await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, String(v)]);
            saved[field] = v;
        }
        logger.info(`pay: 管理员 ${req.userId} 更新支付阈值 ${JSON.stringify(saved)}`);
        const t = await thresholds();
        res.json({ ok: true, single: t.single, daily: t.daily, approval: t.approval });
    } catch (error) {
        logger.error('更新支付阈值错误:', error);
        res.status(500).json({ error: '更新阈值失败' });
    }
});

module.exports = router;
