/**
 * 集市定时任务（幂等，可在服务启动时注册，也可由管理员手动触发）
 *
 *   renewDue()      到期续费：能扣就扣（延长有效期），扣不动 → 宽限期（grace）
 *   graceExpire()   宽限期结束仍欠费 → suspended（暂停并下架商品，只下架"因欠费"的那些）
 *   expireOrders()  待付款订单超时 → expired（未扣款，无资金动作）
 *   autoConfirm()   商家已交付且超过 autoConfirmDays → 自动确认收货并结算
 *   remindDue()     到期前 remindBeforeDays 提醒
 *   dispatchNotify()投递通知 Outbox
 *
 * 幂等保证：
 *   - 续费：market_fee_ledger.idem_key = renew:{store}:{period_to}（唯一索引），重复跑不会重复扣
 *   - 结算：订单状态机 + settled_at 非空即跳过；托管转账只在 pending 状态执行一次
 *   - 通知：market_notify_events.event_key 唯一
 */
const db = require('../database');
const logger = require('./logger');
const market = require('./market');
const notify = require('./market-notify');

const OFF_REASON_AUTO = '欠费自动下架';

/** 标记商品为"因欠费下架"，用于续费成功后只恢复这一批 */
async function pauseProductsOfStore(storeId) {
    const r = await db.run(
        `UPDATE market_products SET status = 'off', off_reason = ?, updated_at = ? WHERE store_id = ? AND status = 'on'`,
        [OFF_REASON_AUTO, market.now(), storeId]
    );
    return r.changes || 0;
}
async function resumeProductsOfStore(storeId) {
    const r = await db.run(
        `UPDATE market_products SET status = 'on', off_reason = '', updated_at = ? WHERE store_id = ? AND status = 'off' AND off_reason = ?`,
        [market.now(), storeId, OFF_REASON_AUTO]
    );
    return r.changes || 0;
}

/** 到期续费 */
async function renewDue() {
    const cfg = await market.getConfig();
    if (!cfg.renewFeeEnabled) return { checked: 0, renewed: 0, failed: 0, grace: 0 };
    const nowStr = market.now();
    const due = await db.all(
        `SELECT * FROM market_stores WHERE status IN ('active','grace') AND next_fee_at IS NOT NULL AND next_fee_at <= ? ORDER BY next_fee_at LIMIT 200`,
        [nowStr]
    );
    let renewed = 0, failed = 0, grace = 0;
    const days = market.cycleDaysOf(cfg);

    for (const s of due) {
        const idem = `renew:${s.id}:${s.next_fee_at}`;
        const done = await db.get('SELECT id FROM market_fee_ledger WHERE idem_key = ?', [idem]);
        if (done) continue;
        const fee = market.money(cfg.renewFee);
        const owner = await db.get('SELECT id, contribution FROM users WHERE id = ?', [s.owner_id]);
        const canPay = owner && market.money(owner.contribution) + 1e-9 >= fee && fee > 0;

        if (fee === 0 || canPay) {
            // 逾期才续费的：从"现在"起算新周期，否则会把新周期也定在过去，导致每轮都重复扣费
            const periodFrom = (s.next_fee_at && s.next_fee_at > nowStr) ? s.next_fee_at : nowStr;
            const periodTo = market.addDays(periodFrom, days);
            await db.transaction(async () => {
                if (fee > 0) {
                    // 续期费：扣店主余额 + 记公会收入（钱退出流通，公会不持有余额账号）
                    await market.chargeFee({
                        userId: s.owner_id, amount: fee, kind: 'renew_fee', type: 'market_fee', refId: s.id,
                        storeId: s.id, note: `店铺续期费「${s.name}」`, idemKey: `fin:${idem}`
                    });
                }
                await db.run(
                    `INSERT INTO market_fee_ledger (store_id, owner_id, kind, amount, status, period_from, period_to, idem_key, note, created_at)
                     VALUES (?, ?, 'renew', ?, 'paid', ?, ?, ?, '自动续期', ?)`,
                    [s.id, s.owner_id, fee, periodFrom, periodTo, idem, nowStr]
                );
                await db.run(
                    `UPDATE market_stores SET expire_at = ?, next_fee_at = ?, last_fee_at = ?, grace_until = NULL,
                        fee_fail_count = 0, status = CASE WHEN status = 'grace' THEN 'active' ELSE status END, updated_at = ?
                     WHERE id = ?`,
                    [periodTo, periodTo, nowStr, nowStr, s.id]
                );
            });
            // 续费成功：只恢复"因欠费下架"的商品
            const back = await resumeProductsOfStore(s.id);
            renewed++;
            await notify.emit({
                eventKey: `renewed:${s.id}:${periodTo}`, eventType: 'store_renewed',
                userId: s.owner_id, storeId: s.id,
                payload: {
                    title: '店铺续费成功',
                    content: `「${s.name}」已续期至 ${periodTo}${fee > 0 ? `，扣费 ${fee} 贡献点` : ''}${back ? `，已恢复 ${back} 件因欠费下架的商品` : ''}`,
                    url: '/market/merchant',
                    rows: [['店铺', s.name], ['续期至', periodTo], ['扣费', `${fee} 贡献点`]]
                }
            });
        } else {
            // 扣不动 → 记失败 + 进宽限期
            const graceUntil = market.addDays(nowStr, cfg.graceDays);
            await db.transaction(async () => {
                await db.run(
                    `INSERT INTO market_fee_ledger (store_id, owner_id, kind, amount, status, fail_reason, period_from, idem_key, note, created_at)
                     VALUES (?, ?, 'renew', ?, 'failed', ?, ?, ?, '自动续期失败', ?)`,
                    [s.id, s.owner_id, fee, owner ? '贡献点不足' : '店主账号不存在', s.next_fee_at, idem, nowStr]
                );
                await db.run(
                    `UPDATE market_stores SET status = CASE WHEN status = 'active' THEN 'grace' ELSE status END,
                        grace_until = COALESCE(grace_until, ?), fee_fail_count = fee_fail_count + 1, updated_at = ? WHERE id = ?`,
                    [graceUntil, nowStr, s.id]
                );
            });
            failed++;
            grace++;
            await notify.emit({
                eventKey: `fee_fail:${s.id}:${s.next_fee_at}`, eventType: 'fee_failed',
                userId: s.owner_id, storeId: s.id,
                payload: {
                    title: '续期扣费失败',
                    content: `「${s.name}」续期费 ${fee} 贡献点扣款失败（贡献点不足）。请在 ${graceUntil} 前补足并手动续费，否则店铺将被暂停并下架商品。`,
                    url: '/market/merchant',
                    rows: [['店铺', s.name], ['应扣', `${fee} 贡献点`], ['宽限至', graceUntil]]
                }
            });
        }
    }
    if (renewed || failed) logger.info(`集市续费任务：检查 ${due.length}，成功 ${renewed}，失败 ${failed}`);
    return { checked: due.length, renewed, failed, grace };
}

/** 宽限期结束 → 暂停 + 下架 */
async function graceExpire() {
    const cfg = await market.getConfig();
    if (!cfg.autoPauseAfterGrace) return { paused: 0 };
    const nowStr = market.now();
    const rows = await db.all(
        `SELECT * FROM market_stores WHERE status = 'grace' AND grace_until IS NOT NULL AND grace_until <= ? LIMIT 200`,
        [nowStr]
    );
    let paused = 0;
    for (const s of rows) {
        const off = await pauseProductsOfStore(s.id);
        await db.run(
            `UPDATE market_stores SET status = 'suspended', auto_paused = 1, updated_at = ? WHERE id = ? AND status = 'grace'`,
            [nowStr, s.id]
        );
        paused++;
        await notify.emit({
            eventKey: `suspended:${s.id}:${s.grace_until}`, eventType: 'store_suspended',
            userId: s.owner_id, storeId: s.id,
            payload: {
                title: '店铺已因欠费暂停',
                content: `「${s.name}」宽限期已结束，店铺已暂停营业${off ? `，${off} 件商品已自动下架` : ''}。补足贡献点后可在商家后台手动续费恢复。`,
                url: '/market/merchant',
                rows: [['店铺', s.name], ['下架商品', `${off} 件`]]
            }
        });
    }
    if (paused) logger.info(`集市：${paused} 家店铺因欠费暂停`);
    return { paused };
}

/** 到期前提醒 */
async function remindDue() {
    const cfg = await market.getConfig();
    const days = Math.max(1, Number(cfg.remindBeforeDays) || 3);
    const nowStr = market.now();
    const rows = await db.all(
        `SELECT * FROM market_stores WHERE status = 'active' AND next_fee_at IS NOT NULL AND next_fee_at > ? AND next_fee_at <= ? LIMIT 200`,
        [nowStr, market.addDays(nowStr, days)]
    );
    let n = 0;
    for (const s of rows) {
        const key = `expiring:${s.id}:${s.next_fee_at}`;
        const dup = await db.get('SELECT id FROM market_notify_events WHERE event_key = ?', [key]);
        if (dup) continue;
        await notify.emit({
            eventKey: key, eventType: 'store_expiring',
            userId: s.owner_id, storeId: s.id,
            payload: {
                title: '店铺即将到期',
                content: `「${s.name}」将于 ${s.next_fee_at} 到期（续期费 ${cfg.renewFee} 贡献点），请提前续费以免影响营业。`,
                url: '/market/merchant',
                rows: [['店铺', s.name], ['到期', s.next_fee_at]]
            }
        });
        n++;
    }
    return { reminded: n };
}

/** 待付款订单超时 */
async function expireOrders() {
    const rows = await db.all(
        `SELECT id, order_no, buyer_id FROM market_orders WHERE status = 'pending_payment' AND created_at <= ? LIMIT 200`,
        [market.addDays(market.now(), -1)]
    );
    let n = 0;
    for (const o of rows) {
        await db.run(`UPDATE market_orders SET status = 'expired', close_reason = '超时未付款', updated_at = ? WHERE id = ? AND status = 'pending_payment'`,
            [market.now(), o.id]);
        n++;
    }
    return { expired: n };
}

/** 自动确认收货（商家已交付，超时无异议） */
async function autoConfirm() {
    const cfg = await market.getConfig();
    const days = Number(cfg.autoConfirmDays) || 0;
    if (days <= 0) return { confirmed: 0 };
    const rows = await db.all(
        `SELECT * FROM market_orders WHERE status = 'awaiting_confirm' AND delivered_at IS NOT NULL AND delivered_at <= ? LIMIT 200`,
        [market.addDays(market.now(), -days)]
    );
    const settleOrder = require('./market-settle').settleOrder;
    let n = 0;
    for (const o of rows) {
        try {
            await settleOrder(o.id, null, '系统自动确认收货');
            n++;
        } catch (e) {
            logger.error(`集市自动确认失败 #${o.id}:`, e.message);
        }
    }
    return { confirmed: n };
}

/** 一次跑完所有任务（幂等，可安全重复调用） */
async function runAll() {
    const out = {};
    try { out.renew = await renewDue(); } catch (e) { out.renew = { error: e.message }; logger.error('集市续费任务失败:', e.message); }
    try { out.grace = await graceExpire(); } catch (e) { out.grace = { error: e.message }; logger.error('集市宽限期任务失败:', e.message); }
    try { out.remind = await remindDue(); } catch (e) { out.remind = { error: e.message }; }
    try { out.expire = await expireOrders(); } catch (e) { out.expire = { error: e.message }; }
    try { out.autoConfirm = await autoConfirm(); } catch (e) { out.autoConfirm = { error: e.message }; logger.error('集市自动确认失败:', e.message); }
    try { out.notify = await notify.dispatchPending(); } catch (e) { out.notify = { error: e.message }; logger.error('集市通知投递失败:', e.message); }
    return out;
}

/** 注册定时器（默认 10 分钟一次；MARKET_JOBS_INTERVAL_MS 可覆盖，0 关闭）
 *  集市的表还没迁移时自动跳过，不让定时器刷错误日志。 */
let timer = null;
function startScheduler() {
    const ms = Number(process.env.MARKET_JOBS_INTERVAL_MS ?? 600000);
    if (!ms || timer) return null;
    const boot = async () => {
        const t = await db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'market_orders'`);
        if (!t) {
            logger.warn('集市定时任务未注册：market_* 表不存在（请先执行 scripts/migrate-marketplace.js）');
            return;
        }
        setTimeout(() => runAll().catch(e => logger.error('集市定时任务异常:', e.message)), 60 * 1000);
        timer = setInterval(() => {
            runAll().catch(e => logger.error('集市定时任务异常:', e.message));
        }, ms);
        if (timer.unref) timer.unref();
        logger.info(`集市定时任务已注册：每 ${Math.round(ms / 1000)} 秒一次`);
    };
    boot().catch(e => logger.error('集市定时任务注册失败:', e.message));
    return true;
}
function stopScheduler() {
    if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
    runAll, renewDue, graceExpire, remindDue, expireOrders, autoConfirm,
    pauseProductsOfStore, resumeProductsOfStore, startScheduler, stopScheduler, OFF_REASON_AUTO
};
