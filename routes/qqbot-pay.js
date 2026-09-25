/**
 * QQ 群机器人 · 贡献点扫码支付接口
 *
 * 设计原则（与 docs/PAY-QR-DESIGN.md 决策 3 一致）：
 *  - **机器人只负责出码与播报，扣款一律回到网页确认**（不做免密支付）；
 *    本文件不提供任何「直接扣款」接口，也不存在代用户确认付款的入口。
 *  - 鉴权沿用 routes/qqbot.js 的 X-Bot-Token（复用其 botTokenAuth），不新增密钥、不放宽权限。
 *  - QQ 与官网账号的绑定关系取自 users.qq（由 /api/qqbot/bind + /confirm 流程写入）。
 *  - 出码 / 记录 / 开单的业务逻辑全部复用 routes/pay.js 导出的服务层函数，
 *    保证网页与机器人的校验规则、风控阈值完全一致。
 *
 * 挂载：server.js → app.use('/api/qqbot/pay', qqbotPayRoutes)
 *   POST /api/qqbot/pay/receive-code  { qq, amount?, note? }   生成收款码（90 秒）
 *   POST /api/qqbot/pay/payer-code    { qq }                    生成付款码（60 秒）
 *   GET  /api/qqbot/pay/records       ?qq=&limit=               查询本人支付记录（只读）
 *   POST /api/qqbot/pay/charge        { qq, title, amount?, targets?, openAll?, deadline? } 创建缴费单
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { botTokenAuth } = require('./qqbot');
const pay = require('./pay');
const router = express.Router();

/** 官网站点根地址（用于拼可扫码的完整链接与二维码图片地址） */
const SITE_BASE = (process.env.SITE_URL || 'https://xuanjian.top').replace(/\/+$/, '');

/** 站点内相对路径 → 完整 URL */
function absUrl(path) {
    return `${SITE_BASE}${path}`;
}

/**
 * 生成二维码图片地址（公开只读接口，内容为该笔支付的完整链接）
 * 机器人直接把该 URL 作为图片发送即可。
 */
function qrImageUrl(text, size = 360) {
    return `${SITE_BASE}/api/pay/qr.png?text=${encodeURIComponent(text)}&size=${size}`;
}

/**
 * 按 QQ 号定位绑定的官网用户
 * @returns {{status:number,error:string}|{qq:string,user:object}}
 */
async function userByQq(rawQq, { requireActive = true } = {}) {
    const qq = String(rawQq || '').trim();
    if (!/^\d{5,12}$/.test(qq)) return { status: 400, error: 'QQ 号无效' };

    const user = await db.get(
        'SELECT id, username, nickname, level, email_verified, is_frozen FROM users WHERE qq = ?',
        [qq]
    );
    if (!user) {
        return {
            status: 404,
            error: '该 QQ 尚未绑定官网账号：请先在群里发送 #绑定 <官网用户名>，'
                + '再登录官网「账户设置 → 群机器人绑定」输入绑定码完成确认'
        };
    }
    if (requireActive && user.is_frozen) {
        return { status: 403, error: '该账号已被冻结，无法使用支付功能，请联系管理员' };
    }
    return { qq, user };
}

/** 统一的用户摘要（不返回邮箱等敏感字段） */
function userBrief(user) {
    return { id: user.id, username: user.username, nickname: user.nickname };
}

/* ------------------------------------------------ 收款码（主扫：机器人出码） */

/**
 * 机器人代已绑定用户生成收款码
 * body: { qq, amount?, note? }
 */
router.post('/receive-code', botTokenAuth, async (req, res) => {
    try {
        const found = await userByQq(req.body.qq);
        if (found.error) return res.status(found.status).json({ error: found.error });

        const r = await pay.createReceiveCode({
            user: found.user, amount: req.body.amount, note: req.body.note, via: 'qqbot'
        });
        if (r.error) return res.status(r.status || 400).json({ error: r.error });

        const url = absUrl(r.url);
        logger.info(`[qqbot] 收款码 qq=${found.qq} user=${found.user.id} `
            + `amount=${r.amount === null ? '由付款方填写' : r.amount} token=${r.token.slice(0, 8)}…`);

        res.json({
            ok: true, qq: found.qq, user: userBrief(found.user),
            token: r.token, url, qrUrl: qrImageUrl(url),
            amount: r.amount, note: r.note || null, payee: r.payee,
            expiresAt: r.expiresAt, ttlSeconds: r.ttlSeconds,
            message: '请让付款方用手机扫码（或在官网「支付中心 → 扫一扫」扫这张图）确认支付'
        });
    } catch (error) {
        logger.error('[qqbot] 生成收款码错误:', error);
        res.status(500).json({ error: '生成收款码失败，请稍后重试' });
    }
});

/* ------------------------------------------------ 付款码（反扫：机器人出码） */

/**
 * 机器人代已绑定用户生成付款码（60 秒刷新）
 * body: { qq }
 */
router.post('/payer-code', botTokenAuth, async (req, res) => {
    try {
        const found = await userByQq(req.body.qq);
        if (found.error) return res.status(found.status).json({ error: found.error });

        const r = await pay.currentPayerCode(found.user.id);
        if (r.error) return res.status(r.status || 400).json({ error: r.error });

        const url = absUrl(r.url);
        logger.info(`[qqbot] 付款码 qq=${found.qq} user=${found.user.id} remain=${r.remainSeconds}s token=${r.token.slice(0, 8)}…`);

        res.json({
            ok: true, qq: found.qq, user: userBrief(found.user),
            token: r.token, url, qrUrl: qrImageUrl(url), kind: r.kind,
            expiresAt: r.expiresAt, ttlSeconds: r.ttlSeconds, remainSeconds: r.remainSeconds,
            pendingToken: r.pendingToken,
            message: '请让收款方在官网「支付中心 → 扫一扫」扫这张图并填写金额；'
                + '扫描后需要你在网页上本人确认才会扣款'
        });
    } catch (error) {
        logger.error('[qqbot] 生成付款码错误:', error);
        res.status(500).json({ error: '生成付款码失败，请稍后重试' });
    }
});

/* ------------------------------------------------------------ 支付记录（只读） */

/**
 * 查询某 QQ 的支付记录（仅限本人，只读）
 * GET /records?qq=...&limit=20
 */
router.get('/records', botTokenAuth, async (req, res) => {
    try {
        const found = await userByQq(req.query.qq, { requireActive: false });
        if (found.error) return res.status(found.status).json({ error: found.error });

        const r = await pay.myRecords(found.user.id, req.query.limit || 20);
        res.json({
            ok: true, qq: found.qq, user: userBrief(found.user),
            todayPaid: r.todayPaid, records: r.records
        });
    } catch (error) {
        logger.error('[qqbot] 查询支付记录错误:', error);
        res.status(500).json({ error: '查询支付记录失败，请稍后重试' });
    }
});

/* ------------------------------------------------------------------ 缴费单 */

/**
 * 创建缴费单（仅管理员或认证成员；权限校验在 pay.createCharge 内统一实现）
 * body: { qq, title, amount?, targets?: (string|{qq,playerName?})[], openAll?, deadline?, note?, payeeType? }
 */
router.post('/charge', botTokenAuth, async (req, res) => {
    try {
        const found = await userByQq(req.body.qq);
        if (found.error) return res.status(found.status).json({ error: found.error });

        // 目标名单：兼容 ["123456", { qq, playerName }] 两种写法
        const rawTargets = Array.isArray(req.body.targets) ? req.body.targets : [];
        const targets = rawTargets.map((t) => {
            if (typeof t === 'string' || typeof t === 'number') return { qq: String(t) };
            if (t && typeof t === 'object') return t;
            return null;
        }).filter(Boolean);

        const r = await pay.createCharge({
            actor: found.user,
            title: req.body.title,
            amount: req.body.amount,
            deadline: req.body.deadline,
            note: req.body.note,
            targets,
            openAll: !!req.body.openAll,
            payeeType: req.body.payeeType
        });
        if (r.error) return res.status(r.status || 400).json({ error: r.error });

        const url = absUrl(r.url);
        logger.info(`[qqbot] 创建缴费单 #${r.intentId}「${r.title}」by qq=${found.qq} `
            + `金额=${r.amount === null ? '按人' : r.amount} 名单=${r.targetCount} 截止=${r.deadline}`);

        res.json({
            ok: true, qq: found.qq, user: userBrief(found.user),
            token: r.token, url, qrUrl: qrImageUrl(url),
            title: r.title, amount: r.amount, deadline: r.deadline, expiresAt: r.expiresAt,
            targetCount: r.targetCount, payee: r.payee,
            unmatchedQq: r.unmatchedQq || [],
            message: '缴费单已创建，可把二维码发到群里'
        });
    } catch (error) {
        logger.error('[qqbot] 创建缴费单错误:', error);
        res.status(500).json({ error: '创建缴费单失败，请稍后重试' });
    }
});

module.exports = router;
