/**
 * 贡献点扫码支付（玄剑版「微信支付」）
 * 设计文档：docs/PAY-QR-DESIGN.md
 *
 * 三种码（决策 2）+ 风控与对账（决策 4）+ 两入口（决策 6）
 *   收款码（主扫）：收款方出码 → 付款方扫码 → 付款方本人确认
 *   付款码（反扫）：付款方出码（60 秒刷新）→ 收款方扫码输入金额 → 付款方本人确认
 *   缴费单码（一码多人）：管理员/认证成员开单出码 → 名单内成员各自支付自己的份额
 * 决策 3：扫码 ≠ 授权，任何扣款都必须付款方在**自己已登录的会话**里确认。
 * 金额口径：REAL 两位小数（ROUND + 触发器 trg_users_contribution_2dp），接口以「元」收发。
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware, fetchLatestLevel } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const { addContributionLog } = require('../lib/contribution');
const router = express.Router();

/** 付款意图有效期：收款码 90 秒（决策 5） */
const INTENT_TTL_MS = 90 * 1000;
/** 付款码刷新周期：60 秒（决策 2） */
const PAYER_CODE_TTL_MS = 60 * 1000;
/** 缴费单默认截止：7 天 */
const CHARGE_DEFAULT_DAYS = 7;
/** 风控默认阈值（settings 表可覆盖，管理员可改） */
const DEFAULTS = { pay_single_limit: 500, pay_daily_limit: 2000, pay_approval_threshold: 200 };

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/* ---------------------------------------------------------------- 基础工具 */

function fmtLocal(d) {
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

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
    if (!payee) return null;
    if (payee.type === 'event') return payee.owner_user_id;
    return payee.user_id;
}

function basicName(u) {
    return (u && (u.nickname || u.username)) || '未知用户';
}

/**
 * 服务端剩余秒数
 * 说明：库里的时间是服务端本地时间（HK 为 UTC），客户端时区不同会把「未过期」误判为「已过期」，
 * 因此所有倒计时一律以服务端算好的剩余秒数为准，前端不得自行解析 expiresAt 与本地时钟比较。
 */
function remainSecOf(expiresAt) {
    if (!expiresAt) return 0;
    const t = new Date(String(expiresAt).replace(' ', 'T')).getTime();
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.round((t - Date.now()) / 1000));
}

/** 取（必要时创建）某用户的个人收款主体 */
async function ensureUserPayee(user) {
    let payee = await db.get("SELECT * FROM pay_payees WHERE type = 'user' AND user_id = ?", [user.id]);
    if (!payee) {
        const r = await db.run(
            `INSERT INTO pay_payees (type, user_id, system_key, display_name, owner_user_id, status, created_at)
             VALUES ('user', ?, NULL, ?, ?, 'active', ?)`,
            [user.id, basicName(user), user.id, getLocalTimestamp()]
        );
        payee = await db.get('SELECT * FROM pay_payees WHERE id = ?', [r.id]);
    }
    return payee;
}

/** 系统金库收款主体 */
async function vaultPayee() {
    return db.get("SELECT * FROM pay_payees WHERE type = 'system' AND system_key = 'guild_treasury'");
}

/** 过期清扫：超时的 created/scanned 意图归位 */
async function sweepExpired() {
    try {
        const r = await db.run(
            `UPDATE pay_intents SET status = 'expired'
             WHERE status IN ('created', 'scanned') AND expires_at < ?`,
            [getLocalTimestamp()]
        );
        if (r && r.changes) logger.info(`pay: 清扫过期二维码 ${r.changes} 个`);
    } catch (e) { logger.warn('pay 过期清扫失败:', e.message); }
}

/** 查询意图并附带收款主体（过期即时归位） */
async function loadIntent(token) {
    const intent = await db.get('SELECT * FROM pay_intents WHERE token = ?', [String(token)]);
    if (!intent) return null;
    const payee = await db.get('SELECT * FROM pay_payees WHERE id = ?', [intent.payee_id]);
    if (['created', 'scanned'].includes(intent.status) && intent.expires_at < getLocalTimestamp()) {
        await db.run("UPDATE pay_intents SET status = 'expired' WHERE id = ?", [intent.id]);
        intent.status = 'expired';
    }
    return { intent, payee };
}

/** 今日已成功付出的金额（按付款方自然日聚合，决策 4） */
async function todayPaid(userId) {
    const row = await db.get(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM pay_transactions
         WHERE from_user_id = ? AND status = 'success' AND date(created_at) = date('now','localtime')`,
        [userId]
    );
    return round2(row ? row.s : 0);
}

/** 创建付款意图 */
async function createIntent({ kind, payeeId, amount = null, note = '', createdBy, payerUserId = null, ttlMs = INTENT_TTL_MS, expiresAt = null, meta = null }) {
    const token = crypto.randomBytes(16).toString('base64url');
    const exp = expiresAt || fmtLocal(new Date(Date.now() + ttlMs));
    const r = await db.run(
        `INSERT INTO pay_intents (token, kind, payee_id, payer_user_id, amount, note, expires_at, status, created_by, created_at, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?)`,
        [token, kind, payeeId, payerUserId, amount, note || '', exp, createdBy, getLocalTimestamp(), meta ? JSON.stringify(meta) : null]
    );
    return { id: r.id, token, expiresAt: exp };
}

/** 落一条流水的公共片段（事务内插入；审批通过时改更新已有 pending 行） */
async function insertTransaction({ intentId, fromUserId, payeeId, amount, note, status, ip, ua, settled }) {
    const r = await db.run(
        `INSERT INTO pay_transactions (intent_id, from_user_id, to_payee_id, amount, note, status, ip, user_agent, created_at, settled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [intentId, fromUserId, payeeId, amount, note || '', status, ip || '', ua || '', getLocalTimestamp(), settled ? getLocalTimestamp() : null]
    );
    return r.id;
}

/* ------------------------------------------------- 核心：一次性资金划转 */

/**
 * 扣款 + 入账 + 流水 + 意图归位（同一 SQLite 事务）
 * @param {object} p
 * @param {object} p.intent     付款意图（已加载）
 * @param {object} p.payee      收款主体
 * @param {number} p.payerId    付款人
 * @param {number} p.amount     金额（两位小数）
 * @param {boolean} p.forceSettle true=跳过审批线直接结算（管理员审批通过时使用）
 * @param {number} p.existingTxId 已有 pending_approval 流水 ID（审批通过时复用该行）
 * @returns {{status:string, transactionId?:number, balance?:number, error?:string, httpStatus?:number, message?:string}}
 */
async function executeTransfer({ intent, payee, payerId, amount, note, ip, ua, forceSettle = false, existingTxId = null }) {
    const recipientId = payeeUserId(payee);
    if (!recipientId) return { status: 'error', error: '收款主体异常，无法入账', httpStatus: 400 };
    if (payee.status !== 'active') return { status: 'error', error: '收款主体已停用', httpStatus: 400 };
    if (recipientId === payerId) return { status: 'error', error: '不能向自己付款', httpStatus: 400 };

    const payer = await db.get('SELECT id, username, nickname, COALESCE(contribution,0) AS contribution FROM users WHERE id = ?', [payerId]);
    if (!payer) return { status: 'error', error: '用户不存在', httpStatus: 404 };

    const t = await thresholds();
    if (amount > t.single) return { status: 'error', error: `单笔金额不得超过 ${t.single} 贡献点`, httpStatus: 400 };
    const paid = await todayPaid(payerId);
    if (round2(paid + amount) > t.daily) {
        return { status: 'error', error: `今日支付额度不足：已付 ${paid}，单日上限 ${t.daily} 贡献点`, httpStatus: 400 };
    }

    // 大额：登记待审批流水，不动余额（决策 4）
    if (!forceSettle && amount > t.approval) {
        const txId = existingTxId || await insertTransaction({
            intentId: intent.id, fromUserId: payerId, payeeId: payee.id, amount, note,
            status: 'pending_approval', ip, ua
        });
        await db.run("UPDATE pay_intents SET status = 'awaiting_approval', payer_user_id = ? WHERE id = ?", [payerId, intent.id]);
        try {
            const admins = await db.all('SELECT id FROM users WHERE level >= 1');
            for (const a of admins) {
                await createNotification({
                    userId: a.id, type: 'pay', title: '有待审批的大额支付',
                    content: `${basicName(payer)} 向 ${payee.display_name} 支付 ${amount} 贡献点，超过 ${t.approval} 需审批`,
                    actorId: payerId, url: '/pay/admin'
                });
            }
        } catch (e) { logger.warn('pay: 审批通知失败:', e.message); }
        logger.info(`pay: 大额待审批 tx=${txId} payer=${payerId} amount=${amount} payee=${payee.display_name}`);
        return {
            status: 'pending_approval', transactionId: txId, amount, payer,
            message: `金额超过 ${t.approval} 贡献点，已提交管理员审批，审批通过后到账`
        };
    }

    if (round2(payer.contribution) < amount) {
        return { status: 'error', error: `余额不足：当前 ${round2(payer.contribution)} 贡献点`, httpStatus: 400 };
    }

    let inTx = false;
    await db.run('BEGIN IMMEDIATE');
    inTx = true;
    let txId = existingTxId;
    try {
        const debit = await db.run(
            `UPDATE users SET contribution = ROUND(COALESCE(contribution,0) - ?, 2)
             WHERE id = ? AND ROUND(COALESCE(contribution,0),2) >= ?`,
            [amount, payerId, amount]
        );
        if (!debit || debit.changes === 0) throw new Error('INSUFFICIENT');

        const credit = await db.run(
            'UPDATE users SET contribution = ROUND(COALESCE(contribution,0) + ?, 2) WHERE id = ?',
            [amount, recipientId]
        );
        if (!credit || credit.changes === 0) throw new Error('NO_RECIPIENT');

        if (txId) {
            await db.run(
                `UPDATE pay_transactions SET status = 'success', settled_at = ?, note = COALESCE(NULLIF(?,''), note) WHERE id = ?`,
                [getLocalTimestamp(), note || '', txId]
            );
        } else {
            txId = await insertTransaction({
                intentId: intent.id, fromUserId: payerId, payeeId: payee.id, amount, note,
                status: 'success', ip, ua, settled: true
            });
        }
        await db.run(
            `UPDATE pay_intents SET status = 'paid', payer_user_id = ?, paid_at = ?, paid_tx_id = ? WHERE id = ?`,
            [payerId, getLocalTimestamp(), txId, intent.id]
        );
        await db.run('COMMIT');
        inTx = false;
    } catch (e) {
        if (inTx) { try { await db.run('ROLLBACK'); } catch (_) { } }
        if (e.message === 'INSUFFICIENT') return { status: 'error', error: '余额不足，支付失败', httpStatus: 400 };
        if (e.message === 'NO_RECIPIENT') return { status: 'error', error: '收款账户异常，支付失败', httpStatus: 400 };
        throw e;
    }

    // 事务外：审计流水 + 通知（失败不影响资金结果）
    try {
        await addContributionLog(payerId, -amount, 'pay_out', txId, `扫码支付给 ${payee.display_name}${note ? ' · ' + note : ''}`);
        await addContributionLog(recipientId, amount, 'pay_in', txId, `收到 ${basicName(payer)} 的扫码支付${note ? ' · ' + note : ''}`);
    } catch (e) { logger.warn('pay: 贡献点日志写入失败:', e.message); }
    try {
        await createNotification({
            userId: recipientId, type: 'pay', title: '收到一笔扫码支付',
            content: `${basicName(payer)} 向你支付了 ${amount} 贡献点${note ? '（' + note + '）' : ''}`,
            actorId: payerId, url: '/pay/records'
        });
    } catch (e) { logger.warn('pay: 通知发送失败:', e.message); }

    const after = await db.get('SELECT ROUND(COALESCE(contribution,0),2) AS b FROM users WHERE id = ?', [payerId]);
    logger.info(`pay: 支付成功 tx=${txId} ${payerId} → ${recipientId} ${amount} 点（${payee.display_name}）`);
    return {
        status: 'success', transactionId: txId, amount, payer,
        recipientId, balance: after ? after.b : null,
        message: `已支付 ${amount} 贡献点给 ${payee.display_name}`
    };
}

/* ------------------------------------------------------------ 收款码（主扫） */

/**
 * 【服务层】为某个用户生成收款码（网页与 QQ 机器人共用同一份逻辑）
 * @param {object} p
 * @param {object} p.user   用户行（需含 id/username/nickname）
 * @param {*} p.amount      金额（可空，留空由付款方填写）
 * @param {string} p.note   备注
 * @param {string} p.via    来源标记（web / qqbot），仅写入 intent.meta 便于排查
 * @returns {{status:number,error:string}|{ok:true,token:string,url:string,expiresAt:string,ttlSeconds:number,payee:object,amount:number|null}}
 */
async function createReceiveCode({ user, amount: rawAmount, note = '', via = 'web' }) {
    let amount = null;
    if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
        amount = parseAmount(rawAmount);
        if (amount === null) return { status: 400, error: '金额格式不正确（需大于 0，最多两位小数）' };
        const t = await thresholds();
        if (amount > t.single) return { status: 400, error: `单笔金额不得超过 ${t.single} 贡献点` };
    }

    const payee = await ensureUserPayee(user);
    const intent = await createIntent({
        kind: 'receive', payeeId: payee.id, amount,
        note: String(note || '').slice(0, 100), createdBy: user.id,
        meta: via && via !== 'web' ? { via } : null
    });
    await sweepExpired();

    return {
        ok: true, token: intent.token, url: `/pay/${intent.token}`, expiresAt: intent.expiresAt,
        ttlSeconds: INTENT_TTL_MS / 1000,
        payee: { id: payee.id, type: payee.type, name: payee.display_name },
        amount, note: String(note || '').slice(0, 100)
    };
}

/**
 * 生成我的收款码（收款方出示，付款方扫码）
 * body: { amount?: number, note?: string }
 */
router.post('/receive-code', authMiddleware, async (req, res) => {
    try {
        const user = await db.get('SELECT id, username, nickname FROM users WHERE id = ?', [req.userId]);
        if (!user) return res.status(404).json({ error: '用户不存在' });

        const r = await createReceiveCode({ user, amount: req.body.amount, note: req.body.note });
        if (r.error) return res.status(r.status || 400).json({ error: r.error });

        logger.info(`pay: 生成收款码 user=${user.id} amount=${r.amount === null ? '由付款方填写' : r.amount} token=${r.token.slice(0, 8)}…`);
        res.json({
            token: r.token, url: r.url, expiresAt: r.expiresAt,
            ttlSeconds: r.ttlSeconds, payee: r.payee, amount: r.amount
        });
    } catch (error) {
        logger.error('生成收款码错误:', error);
        res.status(500).json({ error: '生成收款码失败' });
    }
});

/**
 * 扫码后读取付款信息（扫码 ≠ 授权，此处只读）
 * kind: receive / charge / payer_code 三类码统一入口，前端据此分流
 */
router.get('/intents/:token', authMiddleware, async (req, res) => {
    try {
        const found = await loadIntent(req.params.token);
        if (!found) return res.status(404).json({ error: '二维码无效或已被使用' });
        const { intent, payee } = found;

        const me = await db.get('SELECT id, username, nickname, COALESCE(contribution,0) AS contribution FROM users WHERE id = ?', [req.userId]);
        const t = await thresholds();

        // 缴费单：附上我的份额
        let myCharge = null;
        if (intent.kind === 'charge') {
            myCharge = await db.get(
                `SELECT id, amount, status FROM pay_charges WHERE intent_id = ? AND (user_id = ? OR user_id IS NULL) ORDER BY (user_id IS NULL) LIMIT 1`,
                [intent.id, req.userId]
            );
        }

        res.json({
            intent: {
                token: intent.token, kind: intent.kind, status: intent.status,
                amount: intent.amount, note: intent.note,
                expiresAt: intent.expires_at, createdAt: intent.created_at,
                // 服务端剩余秒数：客户端时区/时钟与服务端不一致时，前端必须以它为准倒计时
                remainSeconds: remainSecOf(intent.expires_at),
                // 付款码被别人扫过并已生成待确认付款时，回传子单 token 供付款方确认
                pendingToken: intent.kind === 'payer_code' ? await pendingTokenOfPayerCode(intent) : null
            },
            payee: { id: payee ? payee.id : null, type: payee ? payee.type : null, name: payee ? payee.display_name : '未知' },
            me: me ? { id: me.id, nickname: basicName(me), balance: round2(me.contribution || 0) } : null,
            isSelf: payeeUserId(payee) === req.userId,
            myCharge: myCharge ? { id: myCharge.id, amount: round2(myCharge.amount), status: myCharge.status } : null,
            limits: { single: t.single, daily: t.daily, approval: t.approval },
            todayPaid: await todayPaid(req.userId)
        });
    } catch (error) {
        logger.error('读取付款信息错误:', error);
        res.status(500).json({ error: '读取付款信息失败' });
    }
});

/**
 * 付款人本人确认支付（收款码主扫闭环）
 * body: { amount?: number, note?: string } —— 收款码未定金额时由付款方填写
 */
router.post('/intents/:token/confirm', authMiddleware, async (req, res) => {
    try {
        const found = await loadIntent(req.params.token);
        if (!found) return res.status(404).json({ error: '二维码无效或已被使用' });
        const { intent, payee } = found;

        if (intent.status === 'paid') return res.status(409).json({ error: '该二维码已支付完成，不可重复使用' });
        if (intent.status === 'expired') return res.status(410).json({ error: '二维码已过期，请让对方重新生成' });
        if (intent.status === 'awaiting_approval') return res.status(409).json({ error: '该笔支付正在等待管理员审批' });
        if (intent.status === 'rejected') return res.status(409).json({ error: '该笔支付已被取消' });
        if (intent.kind === 'charge') return res.status(400).json({ error: '这是缴费单码，请使用缴费单页面支付', url: `/pay/charge/${intent.token}` });
        if (intent.kind === 'payer_code') return res.status(400).json({ error: '这是付款码，需由收款方扫码发起' });
        if (intent.status !== 'created' && intent.status !== 'scanned') {
            return res.status(409).json({ error: `当前状态（${intent.status}）不可支付` });
        }
        // 已被他人扫码占用：避免多人同时付款造成困惑
        if (intent.payer_user_id && intent.payer_user_id !== req.userId) {
            return res.status(409).json({ error: '该二维码已被他人扫码占用，请让收款方重新生成' });
        }

        const amount = intent.amount !== null && intent.amount !== undefined
            ? round2(intent.amount)
            : parseAmount(req.body.amount);
        if (amount === null) return res.status(400).json({ error: '请填写支付金额（大于 0，最多两位小数）' });

        const note = (req.body.note || intent.note || '').slice(0, 100);
        const result = await executeTransfer({
            intent, payee, payerId: req.userId, amount, note,
            ip: req.ip || req.connection?.remoteAddress || '',
            ua: (req.headers['user-agent'] || '').slice(0, 200)
        });
        if (result.status === 'error') return res.status(result.httpStatus || 400).json({ error: result.error });
        res.json({
            ok: true, status: result.status, transactionId: result.transactionId, amount,
            payee: { id: payee.id, type: payee.type, name: payee.display_name },
            balance: result.balance, message: result.message
        });
    } catch (error) {
        logger.error('扫码支付错误:', error);
        res.status(500).json({ error: '支付失败，请稍后重试' });
    }
});

/** 付款方取消（只有已锁定到本人的二维码可取消） */
router.post('/intents/:token/reject', authMiddleware, async (req, res) => {
    try {
        const found = await loadIntent(req.params.token);
        if (!found) return res.status(404).json({ error: '二维码无效或已被使用' });
        const { intent } = found;
        if (intent.status === 'paid') return res.status(409).json({ error: '已支付，无法取消' });
        if (intent.payer_user_id !== req.userId) return res.status(403).json({ error: '只有扫码本人可以取消该笔付款待确认' });
        await db.run("UPDATE pay_intents SET status = 'rejected' WHERE id = ?", [intent.id]);
        logger.info(`pay: 付款方取消 intent=${intent.id} payer=${req.userId}`);
        res.json({ ok: true, status: 'rejected' });
    } catch (error) {
        logger.error('取消付款错误:', error);
        res.status(500).json({ error: '取消失败' });
    }
});

/* ------------------------------------------------------------ 付款码（反扫） */

/** 付款码对应的待确认子单 token（收款方扫码后生成的收款意图） */
async function pendingTokenOfPayerCode(payerCodeIntent) {
    if (payerCodeIntent.status !== 'scanned') return null;
    const child = await db.get(
        `SELECT token, status FROM pay_intents
         WHERE kind = 'receive' AND payer_user_id = ? AND status IN ('created','scanned')
           AND expires_at >= ? ORDER BY id DESC LIMIT 1`,
        [payerCodeIntent.payer_user_id, getLocalTimestamp()]
    );
    return child ? child.token : null;
}

/**
 * 【服务层】取（必要时创建）某用户的付款码（60 秒刷新，决策 2）
 * 网页 `/payer-code/current` 与 QQ 机器人 `/api/qqbot/pay/payer-code` 共用同一份逻辑。
 * @returns {{status:number,error:string}|{ok:true,token:string,url:string,kind:string,expiresAt:string,ttlSeconds:number,remainSeconds:number,pendingToken:string|null}}
 */
async function currentPayerCode(userId) {
    await sweepExpired();
    let intent = await db.get(
        `SELECT * FROM pay_intents WHERE kind = 'payer_code' AND payer_user_id = ? AND status = 'created'
           AND expires_at > ? ORDER BY id DESC LIMIT 1`,
        [userId, getLocalTimestamp()]
    );
    let token, expiresAt;
    if (intent) {
        token = intent.token; expiresAt = intent.expires_at;
    } else {
        const user = await db.get('SELECT id, username, nickname FROM users WHERE id = ?', [userId]);
        if (!user) return { status: 404, error: '用户不存在' };
        const payee = await ensureUserPayee(user);
        const created = await createIntent({
            kind: 'payer_code', payeeId: payee.id, amount: null, note: '',
            createdBy: user.id, payerUserId: user.id, ttlMs: PAYER_CODE_TTL_MS,
            meta: { purpose: 'payer_code' }
        });
        token = created.token; expiresAt = created.expiresAt;
    }
    const remainSec = Math.max(0, Math.round((new Date(expiresAt.replace(' ', 'T')).getTime() - Date.now()) / 1000));
    return {
        ok: true, token, url: `/pay/${token}`, kind: 'payer_code',
        expiresAt, ttlSeconds: PAYER_CODE_TTL_MS / 1000, remainSeconds: remainSec,
        pendingToken: await pendingTokenOfPayerCode({ payer_user_id: userId, status: intent ? intent.status : 'created' })
    };
}

/**
 * 我的付款码（60 秒刷新，决策 2）
 * 剩余不足 10 秒时自动续期；返回 token + 剩余秒数
 */
router.get('/payer-code/current', authMiddleware, async (req, res) => {
    try {
        const r = await currentPayerCode(req.userId);
        if (r.error) return res.status(r.status || 400).json({ error: r.error });
        res.json({
            token: r.token, url: r.url, kind: r.kind,
            expiresAt: r.expiresAt, ttlSeconds: r.ttlSeconds, remainSeconds: r.remainSeconds,
            pendingToken: r.pendingToken
        });
    } catch (error) {
        logger.error('获取付款码错误:', error);
        res.status(500).json({ error: '获取付款码失败' });
    }
});

/**
 * 收款方扫付款码并输入金额 → 生成「待付款方确认」的收款意图（反扫）
 * body: { code: '<token | 链接 | 整段二维码文本>', amount: number, note?: string }
 */
router.post('/scan', authMiddleware, async (req, res) => {
    try {
        const token = extractToken(req.body.code);
        if (!token) return res.status(400).json({ error: '请提供二维码内容或链接' });
        const found = await loadIntent(token);
        if (!found) return res.status(404).json({ error: '二维码无效或已被使用' });
        const { intent, payee } = found;

        // 扫到收款码 / 缴费单码：直接把 intent 交给前端，由扫码方作为付款方确认
        if (intent.kind !== 'payer_code') {
            if (['expired', 'paid', 'rejected'].includes(intent.status)) {
                return res.status(409).json({ error: `二维码当前状态为 ${intent.status}，无法支付` });
            }
            if (payeeUserId(payee) === req.userId) return res.status(400).json({ error: '不能向自己付款' });
            if (intent.payer_user_id && intent.payer_user_id !== req.userId) {
                return res.status(409).json({ error: '该二维码已被他人扫码占用' });
            }
            if (!intent.payer_user_id) {
                await db.run("UPDATE pay_intents SET payer_user_id = ?, status = CASE WHEN status = 'created' THEN 'scanned' ELSE status END WHERE id = ?", [req.userId, intent.id]);
            }
            return res.json({
                mode: 'direct', kind: intent.kind, token: intent.token,
                payee: { id: payee.id, type: payee.type, name: payee.display_name },
                amount: intent.amount === null ? null : round2(intent.amount),
                note: intent.note, expiresAt: intent.expires_at,
                message: intent.kind === 'charge' ? '这是缴费单，请在缴费单页面支付' : '请在下方确认金额后支付'
            });
        }

        // 扫到付款码：收款方发起，付款方稍后确认
        if (intent.status !== 'created') {
            return res.status(409).json({ error: intent.status === 'scanned' ? '该付款码刚刚已被扫描，请让付款方刷新后重试' : `付款码已 ${intent.status}` });
        }
        const payerId = intent.payer_user_id;
        if (payerId === req.userId) return res.status(400).json({ error: '不能扫自己的付款码' });

        const amount = parseAmount(req.body.amount);
        if (amount === null) return res.status(400).json({ error: '请填写收款金额（大于 0，最多两位小数）' });

        const me = await db.get('SELECT id, username, nickname FROM users WHERE id = ?', [req.userId]);
        if (!me) return res.status(404).json({ error: '用户不存在' });
        const myPayee = await ensureUserPayee(me);
        const note = (req.body.note || '').slice(0, 100);

        const child = await createIntent({
            kind: 'receive', payeeId: myPayee.id, amount, note,
            createdBy: req.userId, payerUserId: payerId,
            meta: { via: 'payer_code', payerCodeToken: intent.token }
        });
        await db.run("UPDATE pay_intents SET status = 'scanned' WHERE id = ?", [intent.id]);

        try {
            await createNotification({
                userId: payerId, type: 'pay', title: '有一笔待确认付款',
                content: `${basicName(me)} 扫了你的付款码，请求收款 ${amount} 贡献点${note ? '（' + note + '）' : ''}，请在你的付款码页面确认`,
                actorId: req.userId, url: '/pay'
            });
        } catch (e) { logger.warn('pay: 反扫通知失败:', e.message); }

        logger.info(`pay: 反扫发起 payer=${payerId} payee=${me.id} amount=${amount} child=${child.token.slice(0, 8)}…`);
        res.json({
            ok: true, mode: 'payer_code', token: child.token, amount, note,
            payer: { id: payerId }, expiresAt: child.expiresAt,
            message: `已向对方发起收款请求 ${amount} 贡献点，等待对方确认`
        });
    } catch (error) {
        logger.error('扫码发起收款错误:', error);
        res.status(500).json({ error: '扫码失败，请稍后重试' });
    }
});

/** 付款方轮询：我的付款码被人扫后产生的待确认付款 */
router.get('/payer-code/pending', authMiddleware, async (req, res) => {
    try {
        await sweepExpired();
        const child = await db.get(
            `SELECT i.*, p.display_name AS payee_name, p.type AS payee_type
             FROM pay_intents i LEFT JOIN pay_payees p ON p.id = i.payee_id
             WHERE i.kind = 'receive' AND i.payer_user_id = ? AND i.status IN ('created','scanned')
               AND i.expires_at >= ? AND i.meta LIKE '%"via":"payer_code"%'
             ORDER BY i.id DESC LIMIT 1`,
            [req.userId, getLocalTimestamp()]
        );
        if (!child) return res.json({ pending: null });
        res.json({
            pending: {
                token: child.token, amount: round2(child.amount), note: child.note,
                payeeName: child.payee_name, payeeType: child.payee_type,
                expiresAt: child.expires_at, createdAt: child.created_at
            }
        });
    } catch (error) {
        logger.error('查询待确认付款错误:', error);
        res.status(500).json({ error: '查询待确认付款失败' });
    }
});

/**
 * 子单（缴费单支付 charge_pay）→ 主缴费单 → 我的名单行
 * 用于审批通过/驳回时同步缴费单状态
 */
async function chargeRowOfIntent(intent, txId, userId) {
    if (!intent || !intent.meta) return null;
    let parentToken = null;
    try { parentToken = JSON.parse(intent.meta).parentChargeToken || null; } catch (_) { }
    if (!parentToken) return null;
    const parent = await db.get('SELECT * FROM pay_intents WHERE token = ?', [parentToken]);
    if (!parent) return null;
    const row = await db.get(
        `SELECT * FROM pay_charges WHERE intent_id = ? AND (paid_tx_id = ? OR user_id = ?) ORDER BY (paid_tx_id = ?) DESC LIMIT 1`,
        [parent.id, txId || -1, userId || -1, txId || -1]
    );
    return { parent, row };
}

/** 从扫码/粘贴内容里提取 token（兼容纯 token、/pay/<token> 链接、带 query 的完整 URL） */
function extractToken(input) {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    const m = s.match(/\/pay\/([A-Za-z0-9_-]{16,})/) || s.match(/^([A-Za-z0-9_-]{16,})$/);
    return m ? m[1] : null;
}

/* --------------------------------------------------------- 缴费单码（多人） */

/**
 * 【服务层】创建缴费单（管理员 / 认证成员，决策 1 + 2）
 * 网页 `/charge` 与 QQ 机器人 `/api/qqbot/pay/charge` 共用同一份校验与落库逻辑，
 * 权限校验（level >= 1 或认证成员）只在此处实现一次。
 * @param {object} p
 * @param {object} p.actor      操作者用户行（含 id/username/nickname）
 * @param {string} p.title      标题
 * @param {*} p.amount          统一金额（可空 = 按人填）
 * @param {*} p.deadline        截止时间（可空，默认 7 天）
 * @param {string} p.note       备注
 * @param {Array} p.targets     名单：[{ userId? | qq? | username? | playerName? | amount? }]
 * @param {boolean} p.openAll   是否开放缴纳（不限名单）
 * @param {string} p.payeeType  event（创建者收款，默认）/ system（进公会金库）
 */
async function createCharge({
    actor, title: rawTitle, amount: rawAmount, deadline: rawDeadline,
    note = '', targets: rawTargets = [], openAll = false, payeeType = 'event'
}) {
    if (!actor) return { status: 404, error: '用户不存在' };
    const level = await fetchLatestLevel(actor.id);
    if (level < 1 && !actor.email_verified) {
        return { status: 403, error: '只有管理员或认证成员可以创建缴费单' };
    }

    const title = String(rawTitle || '').trim().slice(0, 40);
    if (!title) return { status: 400, error: '请填写缴费单标题' };

    let amount = null;
    if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
        amount = parseAmount(rawAmount);
        if (amount === null) return { status: 400, error: '金额格式不正确（需大于 0，最多两位小数）' };
        const t = await thresholds();
        if (amount > t.single) return { status: 400, error: `单人金额不得超过 ${t.single} 贡献点（单笔上限）` };
    }

    let deadline = null;
    if (rawDeadline) {
        const d = new Date(String(rawDeadline).replace(' ', 'T'));
        if (isNaN(d.getTime())) return { status: 400, error: '截止时间格式不正确' };
        if (d.getTime() <= Date.now()) return { status: 400, error: '截止时间必须晚于当前时间' };
        deadline = fmtLocal(d);
    } else {
        deadline = fmtLocal(new Date(Date.now() + CHARGE_DEFAULT_DAYS * 24 * 3600 * 1000));
    }

    // 收款主体：默认活动摊位（创建者收款），可指定进入公会金库
    let payee;
    if (payeeType === 'system') {
        payee = await vaultPayee();
        if (!payee) return { status: 500, error: '金库账户未初始化，请先执行 scripts/migrate-pay.js' };
    } else {
        const r = await db.run(
            `INSERT INTO pay_payees (type, user_id, system_key, display_name, owner_user_id, status, created_at)
             VALUES ('event', NULL, NULL, ?, ?, 'active', ?)`,
            [title, actor.id, getLocalTimestamp()]
        );
        payee = await db.get('SELECT * FROM pay_payees WHERE id = ?', [r.id]);
    }

    const intent = await createIntent({
        kind: 'charge', payeeId: payee.id, amount,
        note: String(note || '').slice(0, 100), createdBy: actor.id, expiresAt: deadline,
        meta: { title, openAll: !!openAll }
    });

    // 名单
    const targets = Array.isArray(rawTargets) ? rawTargets.slice(0, 500) : [];
    const unmatchedQq = [];
    let added = 0;
    for (const tg of targets) {
        let userId = tg.userId ? parseInt(tg.userId) : null;
        // QQ 机器人场景：按 QQ 号定位绑定用户（未绑定则记入 player_name 备查）
        if (!userId && tg.qq) {
            const u = await db.get('SELECT id FROM users WHERE qq = ?', [String(tg.qq)]);
            if (u) userId = u.id;
            else unmatchedQq.push({ qq: String(tg.qq), playerName: tg.playerName || String(tg.qq) });
        }
        if (!userId && tg.username) {
            const u = await db.get('SELECT id FROM users WHERE username = ? OR nickname = ?', [String(tg.username), String(tg.username)]);
            if (u) userId = u.id;
        }
        const rowAmount = tg.amount !== undefined && tg.amount !== null && tg.amount !== ''
            ? parseAmount(tg.amount) : amount;
        if (rowAmount === null) continue;
        await db.run(
            `INSERT INTO pay_charges (intent_id, user_id, player_name, amount, status, updated_at)
             VALUES (?, ?, ?, ?, 'unpaid', ?)`,
            [intent.id, userId, userId ? null : (tg.playerName || tg.username || '未绑定玩家'), rowAmount, getLocalTimestamp()]
        );
        added++;
    }
    if (openAll) {
        await db.run(
            `INSERT INTO pay_charges (intent_id, user_id, player_name, amount, status, updated_at)
             VALUES (?, NULL, NULL, ?, 'unpaid', ?)`,
            [intent.id, amount, getLocalTimestamp()]
        );
        added++;
    }
    if (added === 0 && amount === null) {
        return { status: 400, error: '请填写统一金额，或提供名单/开放缴纳' };
    }

    return {
        ok: true, intentId: intent.id, token: intent.token, url: `/pay/charge/${intent.token}`,
        title, amount, deadline, expiresAt: deadline, targetCount: added,
        payee: { id: payee.id, type: payee.type, name: payee.display_name },
        unmatchedQq, message: '缴费单已创建'
    };
}

/**
 * 创建缴费单（管理员 / 认证成员，决策 1 + 2）
 * body: { title, amount?, deadline?, note?, targets?: [{userId?|playerName?|amount?}], openAll?: boolean, payeeType?: 'event'|'system' }
 */
router.post('/charge', authMiddleware, async (req, res) => {
    try {
        const me = await db.get('SELECT id, username, nickname, level, email_verified FROM users WHERE id = ?', [req.userId]);
        if (!me) return res.status(404).json({ error: '用户不存在' });

        const r = await createCharge({
            actor: me, title: req.body.title, amount: req.body.amount, deadline: req.body.deadline,
            note: req.body.note, targets: req.body.targets, openAll: req.body.openAll, payeeType: req.body.payeeType
        });
        if (r.error) return res.status(r.status || 400).json({ error: r.error });

        logger.info(`pay: 创建缴费单 #${r.intentId}「${r.title}」金额=${r.amount === null ? '按人' : r.amount} 名单=${r.targetCount} 截止=${r.deadline}`);
        res.json({
            ok: true, token: r.token, url: r.url,
            title: r.title, amount: r.amount, deadline: r.deadline, expiresAt: r.expiresAt,
            targetCount: r.targetCount, payee: r.payee,
            message: '缴费单已创建'
        });
    } catch (error) {
        logger.error('创建缴费单错误:', error);
        res.status(500).json({ error: '创建缴费单失败' });
    }
});

/** 缴费单详情（含名单与已付/未付） */
router.get('/charge/:token', authMiddleware, async (req, res) => {
    try {
        const found = await loadIntent(req.params.token);
        if (!found) return res.status(404).json({ error: '缴费单不存在' });
        const { intent, payee } = found;
        if (intent.kind !== 'charge') return res.status(400).json({ error: '这不是缴费单码' });

        const rows = await db.all(
            `SELECT c.*, u.username, u.nickname FROM pay_charges c LEFT JOIN users u ON u.id = c.user_id
             WHERE c.intent_id = ? ORDER BY (c.status = 'paid') DESC, c.id ASC`,
            [intent.id]
        );
        const my = rows.filter(r => r.user_id === req.userId);
        const open = rows.find(r => r.user_id === null && r.player_name === null);
        const total = round2(rows.reduce((s, r) => s + (r.amount || 0), 0));
        const paidSum = round2(rows.filter(r => r.status === 'paid').reduce((s, r) => s + (r.amount || 0), 0));
        const me = await db.get('SELECT id, nickname, username, COALESCE(contribution,0) AS contribution FROM users WHERE id = ?', [req.userId]);

        res.json({
            intent: {
                token: intent.token, kind: intent.kind, status: intent.status,
                title: intent.meta ? safeTitle(intent.meta, intent.note) : intent.note,
                note: intent.note, amount: intent.amount === null ? null : round2(intent.amount),
                expiresAt: intent.expires_at, createdAt: intent.created_at, createdBy: intent.created_by,
                remainSeconds: remainSecOf(intent.expires_at)
            },
            payee: { id: payee ? payee.id : null, type: payee ? payee.type : null, name: payee ? payee.display_name : '未知' },
            stats: { count: rows.length, paidCount: rows.filter(r => r.status === 'paid').length, total, paidSum },
            roster: rows.map(r => ({
                id: r.id, userId: r.user_id, name: r.nickname || r.username || r.player_name || '未绑定',
                amount: round2(r.amount), status: r.status
            })),
            mine: my.length ? { id: my[0].id, amount: round2(my[0].amount), status: my[0].status }
                : (open ? { id: open.id, amount: round2(open.amount), status: open.status } : null),
            isCreator: intent.created_by === req.userId,
            myBalance: me ? round2(me.contribution || 0) : 0,
            canPay: !!(my.length || open) && intent.status === 'created' && intent.expires_at >= getLocalTimestamp()
        });
    } catch (error) {
        logger.error('获取缴费单错误:', error);
        res.status(500).json({ error: '获取缴费单失败' });
    }
});

function safeTitle(meta, fallback) {
    try { return JSON.parse(meta).title || fallback || '缴费单'; } catch (_) { return fallback || '缴费单'; }
}

/** 支付我在缴费单中的份额（本人在线，点击即为确认，决策 3） */
router.post('/charge/:token/pay', authMiddleware, async (req, res) => {
    try {
        const found = await loadIntent(req.params.token);
        if (!found) return res.status(404).json({ error: '缴费单不存在' });
        const { intent, payee } = found;
        if (intent.kind !== 'charge') return res.status(400).json({ error: '这不是缴费单码' });
        if (intent.status !== 'created') return res.status(409).json({ error: `缴费单当前状态为 ${intent.status}，无法支付` });
        if (intent.expires_at < getLocalTimestamp()) return res.status(410).json({ error: '缴费单已过截止时间' });

        const me = await db.get('SELECT id, username, nickname FROM users WHERE id = ?', [req.userId]);
        if (!me) return res.status(404).json({ error: '用户不存在' });

        let row = await db.get('SELECT * FROM pay_charges WHERE intent_id = ? AND user_id = ?', [intent.id, req.userId]);
        if (!row) row = await db.get('SELECT * FROM pay_charges WHERE intent_id = ? AND user_id IS NULL AND player_name IS NULL', [intent.id]);
        if (!row) return res.status(403).json({ error: '你不在该缴费单名单中' });
        if (row.status === 'paid') return res.status(409).json({ error: '你已完成缴费' });
        if (row.status === 'pending_approval') return res.status(409).json({ error: '你的缴费正在等待管理员审批' });

        const amount = row.amount !== null && row.amount !== undefined && row.amount > 0
            ? round2(row.amount)
            : parseAmount(req.body.amount);
        if (amount === null) return res.status(400).json({ error: '请填写缴费金额（大于 0，最多两位小数）' });

        const child = await createIntent({
            kind: 'charge_pay', payeeId: payee.id, amount,
            note: `缴费单：${intent.meta ? safeTitle(intent.meta, intent.note) : (intent.note || '')}`.slice(0, 100),
            createdBy: me.id, payerUserId: me.id, ttlMs: 10 * 60 * 1000,
            meta: { parentChargeToken: intent.token, chargeId: row.id }
        });
        const result = await executeTransfer({
            intent: child, payee, payerId: req.userId, amount,
            note: `缴费单：${intent.meta ? safeTitle(intent.meta, intent.note) : ''}`.slice(0, 100),
            ip: req.ip || req.connection?.remoteAddress || '',
            ua: (req.headers['user-agent'] || '').slice(0, 200)
        });
        if (result.status === 'error') {
            await db.run("UPDATE pay_intents SET status = 'rejected' WHERE id = ?", [child.id]);
            return res.status(result.httpStatus || 400).json({ error: result.error });
        }

        await db.run(
            `UPDATE pay_charges SET status = ?, paid_tx_id = ?, updated_at = ? WHERE id = ?`,
            [result.status === 'success' ? 'paid' : 'pending_approval', result.transactionId || null, getLocalTimestamp(), row.id]
        );

        // 全部缴清 → 通知创建者
        try {
            const rest = await db.get(
                `SELECT COUNT(*) AS c FROM pay_charges WHERE intent_id = ? AND status <> 'paid'`, [intent.id]
            );
            if (rest && rest.c === 0) {
                await createNotification({
                    userId: intent.created_by, type: 'pay', title: '缴费单已全部缴清',
                    content: `「${intent.meta ? safeTitle(intent.meta, intent.note) : '缴费单'}」名单内成员已完成缴费`,
                    actorId: req.userId, url: `/pay/charge/${intent.token}`
                });
            }
        } catch (e) { logger.warn('pay: 缴费完成通知失败:', e.message); }

        res.json({
            ok: true, status: result.status, transactionId: result.transactionId, amount,
            balance: result.balance, message: result.status === 'success' ? `已缴纳 ${amount} 贡献点` : result.message
        });
    } catch (error) {
        logger.error('缴费单支付错误:', error);
        res.status(500).json({ error: '缴费失败，请稍后重试' });
    }
});

/** 关闭缴费单（创建者或管理员） */
router.post('/charge/:token/close', authMiddleware, async (req, res) => {
    try {
        const found = await loadIntent(req.params.token);
        if (!found) return res.status(404).json({ error: '缴费单不存在' });
        const { intent } = found;
        if (intent.kind !== 'charge') return res.status(400).json({ error: '这不是缴费单码' });
        const level = await fetchLatestLevel(req.userId);
        if (intent.created_by !== req.userId && level < 1) return res.status(403).json({ error: '只有创建者或管理员可以关闭缴费单' });
        await db.run("UPDATE pay_intents SET status = 'closed' WHERE id = ?", [intent.id]);
        logger.info(`pay: 关闭缴费单 #${intent.id} by ${req.userId}`);
        res.json({ ok: true, status: 'closed' });
    } catch (error) {
        logger.error('关闭缴费单错误:', error);
        res.status(500).json({ error: '关闭缴费单失败' });
    }
});

/** 我相关的缴费单（我创建的 / 我要缴的） */
router.get('/charges', authMiddleware, async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT i.id, i.token, i.note, i.meta, i.amount, i.status, i.expires_at, i.created_at,
                    p.display_name AS payee_name,
                    (SELECT COUNT(*) FROM pay_charges c WHERE c.intent_id = i.id) AS total_count,
                    (SELECT COUNT(*) FROM pay_charges c WHERE c.intent_id = i.id AND c.status = 'paid') AS paid_count,
                    (SELECT c.status FROM pay_charges c WHERE c.intent_id = i.id AND c.user_id = ?) AS my_status
             FROM pay_intents i LEFT JOIN pay_payees p ON p.id = i.payee_id
             WHERE i.kind = 'charge' AND (i.created_by = ? OR EXISTS (
                 SELECT 1 FROM pay_charges c WHERE c.intent_id = i.id AND (c.user_id = ? OR c.user_id IS NULL)))
             ORDER BY i.id DESC LIMIT 50`,
            [req.userId, req.userId, req.userId]
        );
        res.json({
            charges: rows.map(r => ({
                token: r.token, title: r.meta ? safeTitle(r.meta, r.note) : r.note,
                amount: r.amount === null ? null : round2(r.amount), status: r.status,
                expiresAt: r.expires_at, payeeName: r.payee_name,
                totalCount: r.total_count, paidCount: r.paid_count, myStatus: r.my_status,
                remainSeconds: remainSecOf(r.expires_at)
            }))
        });
    } catch (error) {
        logger.error('获取缴费单列表错误:', error);
        res.status(500).json({ error: '获取缴费单列表失败' });
    }
});

/* ---------------------------------------------------------- 我的流水与记录 */

/**
 * 【服务层】某用户的收付款记录（网页与 QQ 机器人共用）
 * @returns {{records:Array, todayPaid:number}}
 */
async function myRecords(userId, limit = 50) {
    const lim = Math.min(parseInt(limit) || 50, 200);
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
        [userId, userId, userId, lim]
    );
    return {
        records: rows.map(r => ({
            id: r.id,
            direction: r.from_user_id === userId ? 'out' : 'in',
            amount: round2(r.amount), status: r.status, note: r.note,
            payeeName: r.payee_name, payeeType: r.payee_type,
            fromName: r.from_nickname || r.from_username,
            kind: r.intent_kind, token: r.intent_token,
            createdAt: r.created_at, settledAt: r.settled_at
        })),
        todayPaid: await todayPaid(userId)
    };
}

router.get('/records', authMiddleware, async (req, res) => {
    try {
        const r = await myRecords(req.userId, req.query.limit);
        res.json(r);
    } catch (error) {
        logger.error('获取支付记录错误:', error);
        res.status(500).json({ error: '获取支付记录失败' });
    }
});

/* ------------------------------------------------------ 管理员：审批与对账 */

/** 待审批列表（大额支付） */
router.get('/admin/approvals', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT t.*, p.display_name AS payee_name, p.type AS payee_type,
                    u.username AS from_username, u.nickname AS from_nickname,
                    i.token AS intent_token, i.kind AS intent_kind, i.note AS intent_note
             FROM pay_transactions t
             LEFT JOIN pay_payees p ON p.id = t.to_payee_id
             LEFT JOIN users u ON u.id = t.from_user_id
             LEFT JOIN pay_intents i ON i.id = t.intent_id
             WHERE t.status = 'pending_approval' ORDER BY t.id ASC LIMIT 200`
        );
        res.json({
            approvals: rows.map(r => ({
                id: r.id, amount: round2(r.amount), note: r.note || r.intent_note,
                payeeName: r.payee_name, payeeType: r.payee_type,
                payerId: r.from_user_id, payerName: r.from_nickname || r.from_username,
                kind: r.intent_kind, token: r.intent_token, createdAt: r.created_at
            })),
            thresholds: await thresholds()
        });
    } catch (error) {
        logger.error('获取待审批列表错误:', error);
        res.status(500).json({ error: '获取待审批列表失败' });
    }
});

/** 审批通过 / 驳回 */
router.post('/admin/approve/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const tx = await db.get('SELECT * FROM pay_transactions WHERE id = ?', [parseInt(req.params.id)]);
        if (!tx) return res.status(404).json({ error: '流水不存在' });
        if (tx.status !== 'pending_approval') return res.status(409).json({ error: `该笔流水当前状态为 ${tx.status}，不可审批` });

        const action = req.body.action === 'reject' ? 'reject' : 'approve';
        const intent = tx.intent_id ? await db.get('SELECT * FROM pay_intents WHERE id = ?', [tx.intent_id]) : null;
        const payee = await db.get('SELECT * FROM pay_payees WHERE id = ?', [tx.to_payee_id]);
        const payer = await db.get('SELECT id, username, nickname FROM users WHERE id = ?', [tx.from_user_id]);

        if (action === 'reject') {
            await db.run("UPDATE pay_transactions SET status = 'rejected', approver_id = ? WHERE id = ?", [req.userId, tx.id]);
            if (intent) await db.run("UPDATE pay_intents SET status = 'rejected' WHERE id = ?", [intent.id]);
            // 若是缴费单，名单行回退为未缴
            const linked = await chargeRowOfIntent(intent, tx.id, tx.from_user_id);
            if (linked) {
                await db.run(
                    `UPDATE pay_charges SET status = 'unpaid', paid_tx_id = NULL, updated_at = ?
                     WHERE intent_id = ? AND (paid_tx_id = ? OR user_id = ?)`,
                    [getLocalTimestamp(), linked.parent.id, tx.id, tx.from_user_id]
                );
            }
            try {
                await createNotification({
                    userId: tx.from_user_id, type: 'pay', title: '大额支付被驳回',
                    content: `你向 ${payee ? payee.display_name : '对方'} 支付 ${round2(tx.amount)} 贡献点的申请被管理员驳回`,
                    actorId: req.userId, url: '/pay/records'
                });
            } catch (e) { logger.warn('pay: 驳回通知失败:', e.message); }
            logger.info(`pay: 审批驳回 tx=${tx.id} by ${req.userId}`);
            return res.json({ ok: true, status: 'rejected', message: '已驳回，款项未划转' });
        }

        if (!intent) return res.status(400).json({ error: '流水缺少关联意图，无法结算' });
        const result = await executeTransfer({
            intent, payee, payerId: tx.from_user_id, amount: round2(tx.amount),
            note: tx.note, ip: tx.ip, ua: tx.user_agent, forceSettle: true, existingTxId: tx.id
        });
        if (result.status === 'error') return res.status(result.httpStatus || 400).json({ error: result.error });
        await db.run("UPDATE pay_transactions SET approver_id = ? WHERE id = ?", [req.userId, tx.id]);
        // 若是缴费单，名单行改为已缴
        const linked = await chargeRowOfIntent(intent, tx.id, tx.from_user_id);
        if (linked) {
            await db.run(
                `UPDATE pay_charges SET status = 'paid', paid_tx_id = ?, updated_at = ?
                 WHERE intent_id = ? AND (paid_tx_id = ? OR user_id = ?)`,
                [tx.id, getLocalTimestamp(), linked.parent.id, tx.id, tx.from_user_id]
            );
        }
        try {
            await createNotification({
                userId: tx.from_user_id, type: 'pay', title: '大额支付已通过',
                content: `你向 ${payee ? payee.display_name : '对方'} 支付 ${round2(tx.amount)} 贡献点的申请已通过，已扣款`,
                actorId: req.userId, url: '/pay/records'
            });
        } catch (e) { logger.warn('pay: 通过通知失败:', e.message); }
        logger.info(`pay: 审批通过 tx=${tx.id} by ${req.userId} payer=${tx.from_user_id}`);
        res.json({ ok: true, status: 'success', transactionId: tx.id, balance: result.balance, message: '已通过并完成划转' });
    } catch (error) {
        logger.error('审批支付错误:', error);
        res.status(500).json({ error: '审批失败' });
    }
});

/** 全量流水 + 对账（支持筛选与 CSV 导出） */
router.get('/admin/records', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { status, kind, userId, from, to, format } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const where = [], params = [];
        if (status) { where.push('t.status = ?'); params.push(String(status)); }
        if (kind) { where.push('i.kind = ?'); params.push(String(kind)); }
        if (userId) { where.push('(t.from_user_id = ? OR p.user_id = ? OR p.owner_user_id = ?)'); params.push(parseInt(userId), parseInt(userId), parseInt(userId)); }
        if (from) { where.push('t.created_at >= ?'); params.push(String(from)); }
        if (to) { where.push('t.created_at <= ?'); params.push(String(to)); }
        const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const rows = await db.all(
            `SELECT t.*, p.display_name AS payee_name, p.type AS payee_type,
                    u.username AS from_username, u.nickname AS from_nickname,
                    a.username AS approver_name, i.kind AS intent_kind, i.token AS intent_token
             FROM pay_transactions t
             LEFT JOIN pay_payees p ON p.id = t.to_payee_id
             LEFT JOIN users u ON u.id = t.from_user_id
             LEFT JOIN users a ON a.id = t.approver_id
             LEFT JOIN pay_intents i ON i.id = t.intent_id
             ${clause} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        const agg = await db.get(
            `SELECT COUNT(*) AS c, COALESCE(SUM(CASE WHEN t.status = 'success' THEN t.amount END),0) AS success_sum
             FROM pay_transactions t LEFT JOIN pay_payees p ON p.id = t.to_payee_id
             LEFT JOIN pay_intents i ON i.id = t.intent_id ${clause}`,
            params
        );
        const mapped = rows.map(r => ({
            id: r.id, amount: round2(r.amount), status: r.status, note: r.note,
            payeeName: r.payee_name, payeeType: r.payee_type,
            payerId: r.from_user_id, payerName: r.from_nickname || r.from_username,
            approverName: r.approver_name, kind: r.intent_kind, token: r.intent_token,
            ip: r.ip, createdAt: r.created_at, settledAt: r.settled_at
        }));

        if (String(format).toLowerCase() === 'csv') {
            const head = ['流水号', '金额', '状态', '场景', '付款方', '收款方', '收款类型', '备注', 'IP', '审批人', '创建时间', '结算时间'];
            const esc = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
            const lines = [head.join(',')].concat(mapped.map(r => [
                r.id, r.amount, r.status, r.kind, r.payerName, r.payeeName, r.payeeType, r.note, r.ip, r.approverName, r.createdAt, r.settledAt
            ].map(esc).join(',')));
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="pay-records-${Date.now()}.csv"`);
            return res.send('\uFEFF' + lines.join('\n'));
        }

        res.json({ records: mapped, total: agg ? agg.c : 0, successSum: round2(agg ? agg.success_sum : 0), limit, offset });
    } catch (error) {
        logger.error('对账查询错误:', error);
        res.status(500).json({ error: '对账查询失败' });
    }
});

/** 对账概览 */
router.get('/admin/summary', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const one = async (sql, args = []) => round2((await db.get(sql, args))?.s || 0);
        const cnt = async (sql, args = []) => (await db.get(sql, args))?.c || 0;
        const today = await one(`SELECT COALESCE(SUM(amount),0) s FROM pay_transactions WHERE status='success' AND date(created_at)=date('now','localtime')`);
        const todayCount = await cnt(`SELECT COUNT(*) c FROM pay_transactions WHERE status='success' AND date(created_at)=date('now','localtime')`);
        const week = await one(`SELECT COALESCE(SUM(amount),0) s FROM pay_transactions WHERE status='success' AND created_at >= datetime('now','localtime','-7 days')`);
        const total = await one(`SELECT COALESCE(SUM(amount),0) s FROM pay_transactions WHERE status='success'`);
        const totalCount = await cnt(`SELECT COUNT(*) c FROM pay_transactions WHERE status='success'`);
        const pendingCount = await cnt(`SELECT COUNT(*) c FROM pay_transactions WHERE status='pending_approval'`);
        const pendingSum = await one(`SELECT COALESCE(SUM(amount),0) s FROM pay_transactions WHERE status='pending_approval'`);
        const vault = await db.get(`SELECT u.id, u.nickname, ROUND(COALESCE(u.contribution,0),2) AS balance FROM users u WHERE u.username = 'guild_treasury'`);
        const activeCodes = await cnt(`SELECT COUNT(*) c FROM pay_intents WHERE status IN ('created','scanned') AND expires_at >= ?`, [getLocalTimestamp()]);
        const topPayees = await db.all(
            `SELECT p.display_name AS name, p.type, COUNT(*) AS c, ROUND(SUM(t.amount),2) AS s
             FROM pay_transactions t JOIN pay_payees p ON p.id = t.to_payee_id
             WHERE t.status = 'success' GROUP BY p.id ORDER BY s DESC LIMIT 10`
        );
        const charges = await db.get(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid
             FROM pay_charges`
        );
        res.json({
            today: { sum: today, count: todayCount },
            week: { sum: week },
            total: { sum: total, count: totalCount },
            pending: { count: pendingCount, sum: pendingSum },
            vault: vault ? { id: vault.id, name: vault.nickname, balance: round2(vault.balance) } : null,
            activeCodes,
            topPayees: topPayees.map(t => ({ name: t.name, type: t.type, count: t.c, sum: round2(t.s) })),
            charges: charges ? { total: charges.total || 0, paid: charges.paid || 0 } : { total: 0, paid: 0 },
            thresholds: await thresholds()
        });
    } catch (error) {
        logger.error('对账概览错误:', error);
        res.status(500).json({ error: '对账概览失败' });
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

/* --------------------------------------------------- 二维码图片（public 只读） */

/** 允许编码成二维码的内容：本站在线支付链接或纯 token（防止被当成任意二维码生成器） */
const PAY_QR_LINK_RE = /^(?:https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?)?\/pay\/(?:charge\/)?[A-Za-z0-9_-]{16,}(?:\?[A-Za-z0-9_=&%.,-]{0,120})?$/;
const PAY_QR_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const PAY_QR_TEXT_MAX = 512;

/**
 * 二维码图片（供网页与 QQ 机器人直接发图）
 * GET /api/pay/qr.png?text=<链接或 token>&size=320
 *
 * 公开只读、无鉴权：内容不含敏感信息（token 本身即需付款方本人登录确认才可能扣款），
 * 但**只允许**编码本站 `/pay/...` 支付链接或纯 token，其它内容一律拒绝。
 */
router.get('/qr.png', async (req, res) => {
    try {
        const raw = String(req.query.text || '').trim();
        if (!raw) return res.status(400).json({ error: '缺少 text 参数' });
        if (raw.length > PAY_QR_TEXT_MAX) {
            return res.status(400).json({ error: `text 过长（上限 ${PAY_QR_TEXT_MAX} 字符）` });
        }
        if (!PAY_QR_LINK_RE.test(raw) && !PAY_QR_TOKEN_RE.test(raw)) {
            return res.status(400).json({ error: '仅支持本站在线支付链接（/pay/...）或支付 token' });
        }

        const size = Math.min(Math.max(parseInt(req.query.size) || 320, 120), 800);
        let QRCode;
        try {
            QRCode = require('qrcode');
        } catch (e) {
            logger.error('qrcode 依赖缺失，请执行 npm install qrcode');
            return res.status(500).json({ error: '二维码服务未就绪' });
        }

        const buf = await QRCode.toBuffer(raw, {
            type: 'png', width: size, margin: 1,
            errorCorrectionLevel: 'M',
            color: { dark: '#111111', light: '#ffffffff' }
        });
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.send(buf);
    } catch (error) {
        logger.error('生成二维码图片错误:', error);
        res.status(500).json({ error: '生成二维码失败' });
    }
});

module.exports = router;
module.exports.executeTransfer = executeTransfer;
module.exports.ensureUserPayee = ensureUserPayee;
module.exports.createIntent = createIntent;
module.exports.extractToken = extractToken;
module.exports.thresholds = thresholds;
module.exports.parseAmount = parseAmount;
module.exports.round2 = round2;
module.exports.createReceiveCode = createReceiveCode;
module.exports.currentPayerCode = currentPayerCode;
module.exports.createCharge = createCharge;
module.exports.myRecords = myRecords;
