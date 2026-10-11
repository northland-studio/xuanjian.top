/**
 * 集市 → 现有三路通知系统的桥接（**不新建通知体系**）
 *
 *   站内通知：routes/notifications.js 的 createNotification()
 *   邮件：config/mail.js 的 sendGenericNotification()
 *   实时推送：lib/realtime.js 的 sendToUsers()（WebSocket）
 *   系统弹窗：复用 announcements（仅用于全员级公告，集市默认不占用）
 *
 * 可靠性：所有事件先落 market_notify_events（Outbox，event_key 唯一 = 幂等），
 * 业务事务提交后再投递；投递失败记录 attempts/last_error 并重试；投递成功置 sent。
 * 账务/订单只做一次（发通知不会反向改任何余额或状态）。
 */
const db = require('../database');
const logger = require('./logger');
const market = require('./market');

let mail = null;
let realtime = null;
let notifRoute = null;
function lazy() {
    if (!mail) {
        try { mail = require('../config/mail'); } catch (e) { logger.error('集市：邮件模块加载失败', e.message); mail = {}; }
    }
    if (!realtime) {
        try { realtime = require('./realtime'); } catch (e) { realtime = {}; }
    }
    if (!notifRoute) {
        try { notifRoute = require('../routes/notifications'); } catch (e) { logger.error('集市：站内通知模块加载失败', e.message); notifRoute = {}; }
    }
    return { mail, realtime, notifRoute };
}

/** 事件类型 → 站内通知 type（已加入白名单）/ 邮件主题 */
const EVENT_META = {
    store_applied: { type: 'market_store', title: '店铺申请已提交' },
    store_approved: { type: 'market_store', title: '店铺审核通过' },
    store_rejected: { type: 'market_store', title: '店铺审核未通过' },
    store_status: { type: 'market_store', title: '店铺状态变更' },
    store_expiring: { type: 'market_store', title: '店铺即将到期' },
    store_grace: { type: 'market_fee', title: '进入续费宽限期' },
    store_suspended: { type: 'market_fee', title: '店铺因欠费暂停' },
    store_renewed: { type: 'market_fee', title: '续费成功' },
    fee_failed: { type: 'market_fee', title: '续期扣费失败' },
    order_created: { type: 'market_order', title: '新订单待处理' },
    order_paid: { type: 'market_order', title: '购买成功' },
    order_verified: { type: 'market_order', title: '核销成功' },
    order_delivered: { type: 'market_order', title: '商家已标记履约' },
    order_confirmed: { type: 'market_order', title: '买家已确认收货' },
    order_settled: { type: 'market_order', title: '订单已完成结算' },
    order_cancelled: { type: 'market_order', title: '订单已取消' },
    order_refund_request: { type: 'market_order', title: '收到退款申请' },
    order_refunded: { type: 'market_order', title: '退款已完成' },
    order_expired: { type: 'market_order', title: '订单已过期' },
    dispute_opened: { type: 'market_dispute', title: '订单争议已开启' },
    dispute_resolved: { type: 'market_dispute', title: '争议已裁决' },
    review_new: { type: 'market_review', title: '收到新评价' },
    review_reply: { type: 'market_review', title: '店主回复了你的评价' },
    stock_soldout: { type: 'market_order', title: '商品已售罄' },
    product_on: { type: 'market_order', title: '商品已上架' }
};

/**
 * 投递待发事件。幂等：同一 event_key 只会成功投递一次；已 sent 的直接跳过。
 * @returns {Promise<{sent:number, failed:number, skipped:number}>}
 */
async function dispatchPending(limit = 30) {
    const { mail: mailMod, realtime: rt, notifRoute: nr } = lazy();
    const rows = await db.all(
        `SELECT * FROM market_notify_events WHERE status IN ('pending','failed') AND attempts < 5 ORDER BY id LIMIT ?`,
        [Math.min(200, Math.max(1, limit))]
    );
    let sent = 0, failed = 0, skipped = 0;

    for (const ev of rows) {
        const meta = EVENT_META[ev.event_type] || { type: 'system', title: '集市通知' };
        let payload = {};
        try { payload = JSON.parse(ev.payload || '{}'); } catch (e) { /* 容错 */ }
        const channels = String(ev.channels || 'inapp,realtime,mail').split(',').map(s => s.trim()).filter(Boolean);
        const results = [];
        let anyOk = false;

        // 1) 站内通知
        if (channels.includes('inapp') && ev.user_id && nr.createNotification) {
            try {
                await nr.createNotification({
                    userId: ev.user_id,
                    type: meta.type,
                    title: payload.title || meta.title,
                    content: payload.content || '',
                    url: payload.url || '/market'
                });
                results.push('inapp:ok'); anyOk = true;
            } catch (e) { results.push('inapp:' + e.message); }
        }

        // 2) 实时推送（WebSocket）
        if (channels.includes('realtime') && rt.sendToUsers) {
            try {
                rt.sendToUsers([Number(ev.user_id)], {
                    type: 'market',
                    event: ev.event_type,
                    title: payload.title || meta.title,
                    content: payload.content || '',
                    url: payload.url || '/market'
                });
                results.push('realtime:ok'); anyOk = true;
            } catch (e) { results.push('realtime:' + e.message); }
        }

        // 3) 邮件（只在需要时发；核销码等敏感凭证不放邮件）
        if (channels.includes('mail') && ev.user_id && mailMod.sendGenericNotification && !payload.noMail) {
            try {
                const u = await db.get('SELECT email, nickname, username FROM users WHERE id = ?', [ev.user_id]);
                if (u && u.email) {
                    await mailMod.sendGenericNotification(u.email, {
                        title: payload.title || meta.title,
                        subject: `玄剑公会集市 - ${payload.title || meta.title}`,
                        greeting: `您好，${u.nickname || u.username}！`,
                        rows: payload.rows || [['事件', payload.title || meta.title]],
                        note: payload.note || '',
                        actionText: payload.actionText || '前往集市',
                        actionUrl: payload.actionUrl || (process.env.SITE_URL || 'https://xuanjian.top') + '/market',
                        accentColor: payload.accentColor || '#8b5cf6'
                    });
                    results.push('mail:ok'); anyOk = true;
                } else {
                    results.push('mail:no-address');
                }
            } catch (e) { results.push('mail:' + e.message); }
        }

        const status = anyOk ? 'sent' : (results.length ? 'failed' : 'skipped');
        if (status === 'sent') sent++; else if (status === 'failed') failed++; else skipped++;
        await db.run(
            `UPDATE market_notify_events SET status = ?, attempts = attempts + 1, last_error = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END WHERE id = ?`,
            [status, results.join(' | ').slice(0, 400), status, market.now(), ev.id]
        );
    }
    return { sent, failed, skipped, total: rows.length };
}

/** 便捷封装：写事件（不投递，交由定时任务或显式调用） */
function emit(opts) {
    return market.emitEvent(opts);
}

module.exports = { dispatchPending, emit, EVENT_META };
