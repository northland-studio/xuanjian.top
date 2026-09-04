/**
 * 支付网关核心逻辑：HMAC 验签、下单幂等、余额事务、出站回调
 * 供 routes/paygate.js 调用。贡献点变动统一走 db 事务 + addContributionLog(type='exchange')。
 */
const crypto = require('crypto');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { addContributionLog } = require('./contribution');
const logger = require('./paygate-logger');

/** 生成官网侧单一流水号 */
function genOrderNo() {
    return 'XJ' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * 校验外站请求的 HMAC 签名
 * 约定签名 = _sign = hex(hmac_sha256(secret, sortedQueryOrBody))
 * 简单实现：签名原文 = 请求体各 key(排除 _sign) 按 key 字典序拼 k=v 用 & 连接
 * @returns {boolean}
 */
function verifyHmac(secret, raw) {
    if (!secret || !raw || typeof raw !== 'object') return false;
    const sign = raw._sign;
    if (!sign || typeof sign !== 'string') return false;
    const pairs = Object.keys(raw)
        .filter(k => k !== '_sign')
        .sort()
        .map(k => `${k}=${raw[k]}`)
        .join('&');
    const expect = crypto.createHmac('sha256', secret).update(pairs).digest('hex');
    const a = Buffer.from(expect, 'utf8');
    const b = Buffer.from(sign, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/** 生产签名（服务端给外站的示例/测试亦可复用） */
function signPayload(secret, payload) {
    const pairs = Object.keys(payload)
        .filter(k => k !== '_sign')
        .sort()
        .map(k => `${k}=${payload[k]}`)
        .join('&');
    return crypto.createHmac('sha256', secret).update(pairs).digest('hex');
}

/**
 * 幂等创建兑换单（外站发起；site 需先验签）
 * @returns {Promise<{order,error?}>}
 */
async function createOrder(site, body) {
    try {
        const siteOrderNo = String(body.site_order_no || '').trim();
        const amount = parseInt(body.amount);
        if (!siteOrderNo) return { error: '缺少 site_order_no' };
        if (!Number.isFinite(amount) || amount <= 0) return { error: 'amount 必须为正整数' };
        const direction = body.direction === 'in' ? 'in' : 'out';

        // 指定官网账号（可选：外站选传 username/nickname 或 user_id）
        let userId = body.user_id ? parseInt(body.user_id) : null;
        if (!userId && body.username) {
            const u = await db.get('SELECT id FROM users WHERE username = ? OR nickname = ? LIMIT 1', [body.username, body.username]);
            if (u) userId = u.id;
        }
        if (!userId) return { error: '无法定位官网账号（username/user_id 缺失或不存在）' };

        // 幂等：同站同单号已存在直接返回，不重复下单
        const existed = await db.get('SELECT * FROM pay_orders WHERE site_id = ? AND site_order_no = ?', [site.id, siteOrderNo]);
        if (existed) return { order: existed };

        const orderNo = genOrderNo();
        const ins = await db.run(
            `INSERT INTO pay_orders (site_id, site_order_no, order_no, user_id, site_user_id, amount, direction, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [site.id, siteOrderNo, orderNo, userId, body.site_user_id ? String(body.site_user_id).slice(0, 80) : null, amount, direction]
        );
        const order = await db.get('SELECT * FROM pay_orders WHERE id = ?', [ins.id]);
        await logger.audit({ orderNo: order.order_no, siteId: site.id, action: 'order.create', detail: { amount, direction, siteOrderNo, userId } });
        logger.info('order.created', { orderNo: order.order_no, site: site.name, userId, amount, direction });
        return { order };
    } catch (e) {
        logger.error('order.create.failed', { message: e.message });
        return { error: '下单失败：' + e.message };
    }
}

/**
 * 处理待处理单：按方向执行余额变更并落 exchange 流水；成功后进入回调。
 * 幂等：status!=pending 直接返回现状。
 * @returns {Promise<{ok,error?,order?}>}
 */
async function handleOrder(orderNo) {
    const order = await db.get('SELECT * FROM pay_orders WHERE order_no = ?', [orderNo]);
    if (!order) return { ok: false, error: '订单不存在' };
    if (order.status !== 'pending') return { ok: true, order }; // 幂等

    try {
        const user = await db.get('SELECT id, contribution FROM users WHERE id = ?', [order.user_id]);
        if (!user) {
            await db.run("UPDATE pay_orders SET status='fail', handled_at=? WHERE id=?", [getLocalTimestamp(), order.id]);
            await logger.audit({ orderNo, siteId: order.site_id, action: 'order.fail_user_missing', detail: { userId: order.user_id } });
            return { ok: false, error: '官网账号不存在' };
        }

        // 事务：余额 + exchange 流水
        let finalAmount;
        if (order.direction === 'out') {
            // 换成外部积分：扣本站贡献点，须余额足够
            if ((user.contribution || 0) < order.amount) {
                await db.run("UPDATE pay_orders SET status='fail', handled_at=? WHERE id=?", [getLocalTimestamp(), order.id]);
                await logger.audit({ orderNo, siteId: order.site_id, action: 'order.fail_insufficient', detail: { need: order.amount, have: user.contribution } });
                return { ok: false, error: '贡献点不足，无法兑换' };
            }
            finalAmount = -order.amount;
        } else {
            finalAmount = order.amount; // 外部充入
        }

        await db.transaction(async () => {
            await db.run(
                'UPDATE users SET contribution = contribution + ?, updated_at = ? WHERE id = ?',
                [finalAmount, getLocalTimestamp(), order.user_id]
            );
            await db.run(
                "UPDATE pay_orders SET status='success', handled_at=? WHERE id=?",
                [getLocalTimestamp(), order.id]
            );
        });

        const note = order.direction === 'out'
            ? `外站兑换支出 ${order.amount}（${order.site_order_no}）`
            : `外站充入/兑换 ${order.amount}（${order.site_order_no}）`;
        await addContributionLog(order.user_id, finalAmount, 'exchange', order.id, note);

        const upd = await db.get('SELECT contribution FROM users WHERE id=?', [order.user_id]);
        await logger.audit({ orderNo, siteId: order.site_id, action: 'order.handled', detail: { direction: order.direction, amount: order.amount, finalAmount, balance: upd?.contribution } });
        logger.info('order.handled', { orderNo, site: order.site_id, userId: order.user_id, direction: order.direction, finalAmount, balance: upd?.contribution });
        return { ok: true, order: await db.get('SELECT * FROM pay_orders WHERE id=?', [order.id]) };
    } catch (e) {
        logger.error('order.handle.failed', { orderNo, message: e.message });
        return { ok: false, error: '处理失败：' + e.message };
    }
}

/**
 * 出站回调外站（官网支付结果通知外站），带次数与 body。
 * 由调用方决定是否异步执行。record=true 时更新订单回调计数与响应。
 */
async function notifyExternal(order, site, resultPayload) {
    const siteCallback = site.callback_url || site.site_url;
    if (!siteCallback) {
        logger.warn('notify.no_callback_url', { orderNo: order.order_no, site: site.id });
        return;
    }
    const payload = { ...(resultPayload || {}), order_no: order.order_no, site_order_no: order.site_order_no, status: order.status };
    const _sign = signPayload(site.hmac_secret, payload);
    const signed = { ...payload, _sign };
    let respBody = '';
    let ok = false;
    try {
        const resp = await fetch(siteCallback, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': site.api_key },
            body: JSON.stringify(signed),
            signal: AbortSignal.timeout(8000),
        });
        respBody = String(await resp.text()).slice(0, 1000);
        ok = resp.ok;
    } catch (e) {
        respBody = 'notify error: ' + (e.message || '');
        ok = false;
    }
    // 更新回调状态
    const nextCount = (order.notify_count || 0) + 1;
    await db.run(
        'UPDATE pay_orders SET notified = ?, notify_count = ?, notify_response = ? WHERE id = ?',
        [ok ? 1 : 0, nextCount, respBody || null, order.id]
    );
    await logger.audit({ orderNo: order.order_no, siteId: site.id, action: 'notify.callback', detail: { ok, count: nextCount, status: order.status, resp: respBody } });
    logger.info('notify.sent', { orderNo: order.order_no, ok, attempt: nextCount });
    return ok;
}

module.exports = { genOrderNo, verifyHmac, signPayload, createOrder, handleOrder, notifyExternal };
