/**
 * 集市订单状态机 + 资金结算（钱只在这里动）
 *
 * 状态流转（严格白名单，任何请求都不能直接写状态）：
 *   pending_payment ──pay──▶ paid ──verify(核销码)──▶ delivered ──deliver──▶ awaiting_confirm ──settle──▶ settled
 *        │                    │                          │                        │
 *        └──expire──▶ expired └──cancel/refund──▶ refunded ◀──refund── refunding ──┘
 *   任一未结算状态 ──dispute──▶ disputed ──resolve──▶ settled | refunded
 *
 * 资金（唯一中间态账号 market_escrow；公会收入只记分户账 market_finance_ledger，不设余额账号）：
 *   下单：买家 -buyerPay → escrow +buyerPay
 *   结算：escrow -buyerPay → 商家 +merchantIncome，税从 escrow 划出退出流通并记 market_finance_ledger(tax, in)
 *   退款：escrow -refund → 买家 +refund（未结算订单没记过税，因此不写税务冲回）
 *   争议：钱留在 escrow，禁止结算
 */
const crypto = require('crypto');
const db = require('../database');
const logger = require('./logger');
const market = require('./market');
const notify = require('./market-notify');

/**
 * 进程内串行化资金事务：sqlite3 是单连接，两个请求同时 BEGIN 会报
 * "cannot start a transaction within a transaction"。排队执行可让并发下单/结算
 * 一个接一个跑（数据库层仍是原来的 BEGIN/COMMIT，不改动 database.js 的既有行为）。
 */
let txQueue = Promise.resolve();
function serialized(fn) {
    const next = txQueue.then(fn, fn);
    txQueue = next.then(() => { }, () => { });
    return next;
}

/** 允许的状态迁移 */
const TRANSITIONS = {
    pending_payment: ['paid', 'cancelled', 'expired'],
    paid: ['delivered', 'refunding', 'refunded', 'disputed', 'cancelled'],
    delivered: ['awaiting_confirm', 'refunding', 'refunded', 'disputed'],
    awaiting_confirm: ['settled', 'refunding', 'refunded', 'disputed'],
    refunding: ['refunded', 'paid', 'delivered', 'awaiting_confirm'],
    disputed: ['settled', 'refunded', 'awaiting_confirm'],
    settled: [],
    refunded: [],
    cancelled: [],
    expired: []
};
function canTransition(from, to) {
    return (TRANSITIONS[from] || []).includes(to);
}

function newOrderNo() {
    const d = new Date();
    const p = (x, n = 2) => String(x).padStart(n, '0');
    return `M${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}${crypto.randomInt(100, 999)}`;
}

async function statusGuard(orderId, expect, to, extraWhere = '') {
    const row = await db.get(`SELECT * FROM market_orders WHERE id = ?`, [orderId]);
    if (!row) throw Object.assign(new Error('订单不存在'), { status: 404 });
    const expects = Array.isArray(expect) ? expect : [expect];
    if (!expects.includes(row.status)) {
        throw Object.assign(new Error(`订单当前状态为「${market.ORDER_STATUS_LABEL[row.status] || row.status}」，不能执行该操作`), { status: 409 });
    }
    if (to && !canTransition(row.status, to)) {
        throw Object.assign(new Error(`不允许的状态流转：${row.status} → ${to}`), { status: 409 });
    }
    return row;
}

/* ==================== 下单 ==================== */

/**
 * 创建订单（原子：校验 → 扣买家 → 入托管 → 建订单/快照/核销码）
 * @param {{buyerId:number, storeId:number, items:Array<{product_id:number,quantity:number}>, idemKey?:string, remark?:string}} p
 * @returns {Promise<{order:object, verifyCode:string, reused:boolean}>}
 */
async function createOrder({ buyerId, storeId, items, idemKey, remark = '' }) {
    if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('购物车为空'), { status: 400 });
    // 幂等：同一 idemKey 直接返回已有订单（不重复扣款）
    if (idemKey) {
        const exist = await db.get('SELECT * FROM market_orders WHERE idem_key = ?', [idemKey]);
        if (exist) return { order: exist, verifyCode: null, reused: true };
    }
    const cfg = await market.getConfig();
    const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [storeId]);
    if (!store) throw Object.assign(new Error('店铺不存在'), { status: 404 });
    if (!market.storeSellable(store)) {
        throw Object.assign(new Error(`店铺当前「${market.STORE_STATUS_LABEL[store.status] || store.status}」，无法下单`), { status: 409 });
    }
    if (Number(store.owner_id) === Number(buyerId)) throw Object.assign(new Error('不能购买自己店铺的商品'), { status: 400 });

    // 逐项校验 + 组装快照（价格以服务端为准，前端传什么都不影响）
    let amount = 0;
    const lines = [];
    for (const it of items) {
        const pid = Number(it.product_id);
        const qty = Math.max(1, Math.min(999, Number(it.quantity) || 1));
        const p = await db.get('SELECT * FROM market_products WHERE id = ? AND store_id = ?', [pid, storeId]);
        if (!p) throw Object.assign(new Error(`商品 #${pid} 不存在或不属于该店铺`), { status: 400 });
        if (p.status !== 'on') throw Object.assign(new Error(`商品「${p.title}」未上架`), { status: 409 });
        if (Number(p.stock) < qty) throw Object.assign(new Error(`商品「${p.title}」库存不足（余 ${p.stock}）`), { status: 409 });
        const perOrder = Number(p.per_order_limit) || 0;
        if (perOrder > 0 && qty > perOrder) throw Object.assign(new Error(`商品「${p.title}」单笔限购 ${perOrder} 件`), { status: 400 });
        const perUser = Number(p.per_user_limit) || 0;
        if (perUser > 0) {
            const got = await db.get(
                `SELECT COALESCE(SUM(oi.quantity),0) AS q FROM market_order_items oi
                   JOIN market_orders o ON o.id = oi.order_id
                  WHERE oi.product_id = ? AND o.buyer_id = ? AND o.status IN ('paid','delivered','awaiting_confirm','settled')`,
                [pid, buyerId]
            );
            if (Number(got.q) + qty > perUser) {
                throw Object.assign(new Error(`商品「${p.title}」每人限购 ${perUser} 件（已购 ${got.q}）`), { status: 400 });
            }
        }
        const subtotal = market.money(p.price * qty);
        amount = market.money(amount + subtotal);
        lines.push({
            product_id: p.id, store_id: storeId, title_snapshot: p.title, price_snapshot: market.money(p.price),
            spec_snapshot: p.spec || '', quantity: qty, subtotal, cover_snapshot: p.cover || ''
        });
    }

    const t = market.calcTax(amount, 0, cfg);
    const escrow = await market.escrowId();
    const orderNo = newOrderNo();
    const plainCode = market.generateVerifyCode();
    const codeHash = market.hashCode(plainCode);
    const expires = market.addDays(market.now(), Math.max(1, Math.ceil((Number(cfg.verifyCodeTtlHours) || 72) / 24)));

    let orderId = null;
    try {
        await serialized(() => db.transaction(async () => {
            // 1) 扣买家 → 托管（余额不足会抛错并整体回滚，不会留下已付款订单）
            await market.transferPoints(buyerId, escrow, t.buyerPay, 'market_escrow_in', 'market_escrow_in', 0, `集市下单 ${orderNo}`);
            // 2) 原子扣库存（带条件，防并发超卖）
            for (const ln of lines) {
                const r = await db.run(
                    `UPDATE market_products SET stock = stock - ?, sold = sold + ?, updated_at = ?
                      WHERE id = ? AND status = 'on' AND stock >= ?`,
                    [ln.quantity, ln.quantity, market.now(), ln.product_id, ln.quantity]
                );
                if (!r.changes) throw Object.assign(new Error(`商品「${ln.title_snapshot}」库存不足（并发）`), { status: 409 });
                const left = await db.get('SELECT stock FROM market_products WHERE id = ?', [ln.product_id]);
                if (Number(left.stock) === 0) {
                    await db.run(`UPDATE market_products SET status = 'soldout', updated_at = ? WHERE id = ?`, [market.now(), ln.product_id]);
                }
            }
            // 3) 建订单
            const r = await db.run(
                `INSERT INTO market_orders (order_no, idem_key, buyer_id, store_id, status, amount, discount, tax_base, tax_rate_bp,
                    tax_mode, tax_amount, buyer_pay, merchant_income, snapshot, created_at, paid_at, updated_at)
                 VALUES (?, ?, ?, ?, 'paid', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [orderNo, idemKey || null, buyerId, storeId, market.money(amount), t.taxBase, t.taxBp, t.taxMode,
                    t.tax, t.buyerPay, t.merchantIncome, JSON.stringify(lines), market.now(), market.now(), market.now()]
            );
            orderId = r.id;
            for (const ln of lines) {
                await db.run(
                    `INSERT INTO market_order_items (order_id, product_id, store_id, title_snapshot, price_snapshot, spec_snapshot, quantity, subtotal, cover_snapshot)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [orderId, ln.product_id, ln.store_id, ln.title_snapshot, ln.price_snapshot, ln.spec_snapshot, ln.quantity, ln.subtotal, ln.cover_snapshot]
                );
            }
            // 4) 核销码（只存哈希 + 末 4 位）
            await db.run(
                `INSERT INTO market_verify_codes (order_id, code_hash, code_tail, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
                [orderId, codeHash, plainCode.slice(-4), expires, market.now()]
            );
            await db.run(`UPDATE market_stores SET order_count = order_count + 1, updated_at = ? WHERE id = ?`, [market.now(), storeId]);
        }));
    } catch (e) {
        // 并发下同 idem_key 撞 UNIQUE：整个事务已回滚（钱没扣），直接返回已存在的那一单
        if (idemKey && /UNIQUE/i.test(String(e.message || ''))) {
            const exist = await db.get('SELECT * FROM market_orders WHERE idem_key = ?', [idemKey]);
            if (exist) return { order: exist, verifyCode: null, reused: true };
        }
        throw e;
    }

    const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [orderId]);
    await notify.emit({
        eventKey: `order_paid:${orderId}`, eventType: 'order_paid',
        userId: buyerId, storeId, orderId,
        payload: {
            title: '购买成功，等待核销',
            content: `订单 ${orderNo} 已支付 ${t.buyerPay} 贡献点（托管中）。请到「我的订单」查看核销码并在游戏内交给商家。`,
            url: '/market/orders',
            rows: [['订单号', orderNo], ['实付', `${t.buyerPay} 贡献点`], ['核销码有效期', expires]]
        }
    });
    await notify.emit({
        eventKey: `order_new:${orderId}`, eventType: 'order_created',
        userId: store.owner_id, storeId, orderId,
        payload: {
            title: '新订单待处理',
            content: `店铺「${store.name}」收到新订单 ${orderNo}，金额 ${t.merchantIncome} 贡献点（结算后到账）。请等买家提供核销码。`,
            url: '/market/merchant',
            rows: [['订单号', orderNo], ['你的收入', `${t.merchantIncome} 贡献点`]]
        }
    });
    await market.audit(buyerId, 'order_create', 'order', orderId, null, { orderNo, amount, tax: t.tax, buyerPay: t.buyerPay }, remark);
    return { order, verifyCode: plainCode, reused: false };
}

/* ==================== 核销 ==================== */

/**
 * 商家按核销码核销（幂等：重复核销不会重复结算/重复扣款）
 * 只能核销「属于本店」且状态为 paid 的订单。
 */
async function verifyByCode({ storeId, code, operatorId }) {
    const hash = market.hashCode(code);
    const row = await db.get('SELECT * FROM market_verify_codes WHERE code_hash = ?', [hash]);
    if (!row) throw Object.assign(new Error('核销码无效'), { status: 404 });
    if (row.failed_attempts > 20) throw Object.assign(new Error('该核销码尝试次数过多，请联系管理员'), { status: 429 });
    const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [row.order_id]);
    if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
    if (Number(order.store_id) !== Number(storeId)) {
        await db.run('UPDATE market_verify_codes SET failed_attempts = failed_attempts + 1 WHERE id = ?', [row.id]);
        throw Object.assign(new Error('该核销码不属于你的店铺'), { status: 403 });
    }
    if (row.used_at) {
        return { order, already: true, usedAt: row.used_at };   // 幂等：告知已核销，不做任何资金/状态动作
    }
    if (order.status !== 'paid') {
        throw Object.assign(new Error(`订单当前「${market.ORDER_STATUS_LABEL[order.status]}」，不能核销`), { status: 409 });
    }
    if (row.expires_at && row.expires_at < market.now()) {
        throw Object.assign(new Error('核销码已过期，请让买家在订单页重新生成'), { status: 409 });
    }
    await serialized(() => db.transaction(async () => {
        await db.run(`UPDATE market_verify_codes SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL`,
            [market.now(), operatorId, row.id]);
        await db.run(`UPDATE market_orders SET status = 'delivered', verified_at = ?, verified_by = ?, updated_at = ? WHERE id = ? AND status = 'paid'`,
            [market.now(), operatorId, market.now(), order.id]);
    }));
    const updated = await db.get('SELECT * FROM market_orders WHERE id = ?', [order.id]);
    await notify.emit({
        eventKey: `order_verified:${order.id}`, eventType: 'order_verified',
        userId: order.buyer_id, storeId, orderId: order.id,
        payload: {
            title: '核销成功，等待交货',
            content: `订单 ${order.order_no} 已被商家核销，请在游戏内完成交付后到官网确认收货。`,
            url: '/market/orders', noMail: true
        }
    });
    await notify.emit({
        eventKey: `order_verified_m:${order.id}`, eventType: 'order_verified',
        userId: null, storeId, orderId: order.id, channels: 'inapp'
    });
    return { order: updated, already: false };
}

/** 商家标记已交付 → 待买家确认收货 */
async function markDelivered(orderId, operatorId, note = '') {
    await statusGuard(orderId, ['delivered', 'paid'], 'awaiting_confirm');
    await db.run(
        `UPDATE market_orders SET status = 'awaiting_confirm', delivered_at = ?, updated_at = ? WHERE id = ?`,
        [market.now(), market.now(), orderId]
    );
    const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [orderId]);
    await notify.emit({
        eventKey: `order_delivered:${orderId}`, eventType: 'order_delivered',
        userId: order.buyer_id, storeId: order.store_id, orderId,
        payload: {
            title: '商家已交付，请确认收货',
            content: `订单 ${order.order_no} 商家已标记完成交付。请在游戏内核对后到官网确认收货；${note || ''}`,
            url: '/market/orders'
        }
    });
    return order;
}

/* ==================== 结算 ==================== */

/**
 * 结算订单：托管 → 商家 + 交易税退出流通（工会没有余额账号，税只记入分户账）。
 * 幂等：只有 awaiting_confirm/delivered/disputed 能进；settled 再次调用直接返回。
 */
async function settleOrder(orderId, operatorId = null, note = '') {
    const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [orderId]);
    if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
    if (order.status === 'settled') return { order, already: true };
    if (order.status === 'refunded') throw Object.assign(new Error('订单已退款，不能结算'), { status: 409 });
    if (!['awaiting_confirm', 'delivered', 'disputed'].includes(order.status)) {
        throw Object.assign(new Error(`订单当前「${market.ORDER_STATUS_LABEL[order.status]}」，不能结算`), { status: 409 });
    }
    const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [order.store_id]);
    if (!store) throw Object.assign(new Error('店铺不存在'), { status: 404 });
    const escrow = await market.escrowId();
    const buyerPay = market.money(order.buyer_pay);
    const merchantIncome = market.money(order.merchant_income);
    const tax = market.money(order.tax_amount);

    await serialized(() => db.transaction(async () => {
        // 先把状态推进到 settled 作为并发闸门：抢不到的调用直接回滚，不会重复动钱
        const moved = await db.run(
            `UPDATE market_orders SET status = 'settled', confirmed_at = COALESCE(confirmed_at, ?), settled_at = ?, updated_at = ?
              WHERE id = ? AND status IN ('awaiting_confirm','delivered','disputed')`,
            [market.now(), market.now(), market.now(), order.id]
        );
        if (!moved.changes) throw Object.assign(new Error('订单状态已变化，本次结算未执行'), { status: 409 });
        // 托管出账：商家所得 + 交易税 = 买家实付（两种承担方式都成立）
        await market.moveBalance(escrow, -merchantIncome, 'market_escrow_out', order.id, `订单结算 ${order.order_no}`);
        // 商家入账
        await market.moveBalance(store.owner_id, merchantIncome, 'market_sale', order.id, `销售收入 ${order.order_no}`);
        // 交易税：从托管账户划出后退出流通，只留分户账凭证（**没有平台服务费**）
        if (tax > 0) {
            await market.moveBalance(escrow, -tax, 'market_tax', order.id, `交易税 ${order.order_no}`);
            await market.financeIncome({
                kind: 'tax', amount: tax, fromUserId: order.buyer_id, orderId: order.id, storeId: order.store_id,
                note: `订单 ${order.order_no} 交易税`, idemKey: `tax:${order.id}`,
                taxMode: order.tax_mode, taxRateBp: order.tax_rate_bp, operatorId
            });
        }
        await db.run(
            `UPDATE market_stores SET sales_count = sales_count + 1, updated_at = ? WHERE id = ?`,
            [market.now(), order.store_id]
        );
    }));

    const settled = await db.get('SELECT * FROM market_orders WHERE id = ?', [order.id]);
    await notify.emit({
        eventKey: `order_settled:${order.id}`, eventType: 'order_settled',
        userId: store.owner_id, storeId: order.store_id, orderId: order.id,
        payload: {
            title: '订单已完成结算',
            content: `订单 ${order.order_no} 收入 ${merchantIncome} 贡献点已入账${tax > 0 ? `（已扣交易税 ${tax}）` : ''}。`,
            url: '/market/merchant',
            rows: [['订单号', order.order_no], ['入账', `${merchantIncome} 贡献点`], ['交易税', `${tax} 贡献点`]]
        }
    });
    await notify.emit({
        eventKey: `order_settled_b:${order.id}`, eventType: 'order_settled',
        userId: order.buyer_id, storeId: order.store_id, orderId: order.id,
        payload: { title: '订单已完成', content: `订单 ${order.order_no} 已确认收货并完成结算，欢迎评价。`, url: '/market/orders' }
    });
    // 归档（账本类）
    await market.writeArchive({
        kind: 'ledger', refType: 'order', refId: order.id,
        title: `集市订单结算 ${order.order_no}`,
        summary: `成交 ${order.tax_base} / 税 ${tax} / 商家 ${merchantIncome} / 买家实付 ${buyerPay}（${order.tax_mode === 'buyer' ? '买家承担' : '商家承担'}，${order.tax_rate_bp}bp）`,
        payload: { order_no: order.order_no, store_id: order.store_id, buyer_id: order.buyer_id, amount: order.amount, tax, merchant_income: merchantIncome, buyer_pay: buyerPay, tax_mode: order.tax_mode, tax_rate_bp: order.tax_rate_bp, settled_at: settled.settled_at },
        operatorId
    });
    await market.audit(operatorId, 'order_settle', 'order', order.id, { status: order.status }, { status: 'settled', note }, note);
    return { order: settled, already: false, merchantIncome, tax };
}

/* ==================== 退款 ==================== */

/**
 * 退款（托管 → 买家）。幂等：market_refunds.idem_key 唯一 + 订单状态判断。
 * @param {number} orderId
 * @param {{amount?:number, operatorId?:number, reason?:string, fromDispute?:boolean}} opts
 */
async function refundOrder(orderId, { amount = null, operatorId = null, reason = '', fromDispute = false } = {}) {
    const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [orderId]);
    if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
    if (order.status === 'refunded') return { order, already: true };
    if (order.status === 'settled') {
        throw Object.assign(new Error('订单已结算。如需退款请由管理员走"人工退款"（从商家余额冲回）'), { status: 409 });
    }
    if (!['paid', 'delivered', 'awaiting_confirm', 'disputed', 'refunding'].includes(order.status)) {
        throw Object.assign(new Error(`订单当前「${market.ORDER_STATUS_LABEL[order.status]}」，不能退款`), { status: 409 });
    }
    const escrow = await market.escrowId();
    const refund = market.money(amount === null ? order.buyer_pay : Math.min(amount, order.buyer_pay));
    const idem = `refund:${order.id}`;
    const done = await db.get('SELECT id FROM market_refunds WHERE idem_key = ?', [idem]);
    if (done && done.status === 'done') return { order, already: true };

    await serialized(() => db.transaction(async () => {
        // 状态闸门：抢不到就整体回滚，钱不会退两次
        const moved = await db.run(
            `UPDATE market_orders SET status = 'refunded', refunded_at = ?, close_reason = ?, updated_at = ?
              WHERE id = ? AND status IN ('paid','delivered','awaiting_confirm','disputed','refunding')`,
            [market.now(), reason || '退款', market.now(), order.id]
        );
        if (!moved.changes) throw Object.assign(new Error('订单状态已变化，本次退款未执行'), { status: 409 });
        await market.moveBalance(escrow, -refund, 'market_escrow_out', order.id, `订单退款 ${order.order_no}`);
        await market.moveBalance(order.buyer_id, refund, 'market_refund', order.id, `订单退款 ${order.order_no}`);
        // 注意：未结算的订单**从未记过交易税**（税只在结算时入分户账），
        // 所以这里不写 refund_tax 冲回，否则会把公会收入记成负数。
        if (done) {
            await db.run(`UPDATE market_refunds SET status = 'done', handled_by = ?, handle_note = ?, handled_at = ? WHERE id = ?`,
                [operatorId, reason, market.now(), done.id]);
        } else {
            await db.run(
                `INSERT INTO market_refunds (order_id, buyer_id, store_id, amount, reason, status, handled_by, handle_note, idem_key, created_at, handled_at)
                 VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?)`,
                [order.id, order.buyer_id, order.store_id, refund, reason, operatorId, reason, idem, market.now(), market.now()]
            );
        }
        // 库存回补（未结算的订单退款时把货放回去）
        const items = await db.all('SELECT * FROM market_order_items WHERE order_id = ?', [order.id]);
        for (const it of items) {
            await db.run(
                `UPDATE market_products SET stock = stock + ?, sold = CASE WHEN sold >= ? THEN sold - ? ELSE 0 END,
                    status = CASE WHEN status = 'soldout' THEN 'on' ELSE status END, updated_at = ? WHERE id = ?`,
                [it.quantity, it.quantity, it.quantity, market.now(), it.product_id]
            );
        }
    }));

    const after = await db.get('SELECT * FROM market_orders WHERE id = ?', [order.id]);
    await notify.emit({
        eventKey: `order_refunded:${order.id}`, eventType: 'order_refunded',
        userId: order.buyer_id, storeId: order.store_id, orderId: order.id,
        payload: {
            title: '退款已完成',
            content: `订单 ${order.order_no} 已退款 ${refund} 贡献点到你的账户${reason ? `（原因：${reason}）` : ''}。`,
            url: '/market/orders', rows: [['订单号', order.order_no], ['退款', `${refund} 贡献点`]]
        }
    });
    await notify.emit({
        eventKey: `order_refunded_m:${order.id}`, eventType: 'order_refunded',
        userId: null, storeId: order.store_id, orderId: order.id, channels: 'inapp'
    });
    await market.audit(operatorId, 'order_refund', 'order', order.id, { status: order.status }, { status: 'refunded', refund, fromDispute }, reason);
    return { order: after, already: false, refund };
}

/* ==================== 取消 / 争议 ==================== */

async function cancelOrder(orderId, buyerId, reason = '') {
    const order = await statusGuard(orderId, ['paid'], 'cancelled');
    if (Number(order.buyer_id) !== Number(buyerId)) throw Object.assign(new Error('只能取消自己的订单'), { status: 403 });
    const code = await db.get('SELECT used_at FROM market_verify_codes WHERE order_id = ?', [orderId]);
    if (code && code.used_at) throw Object.assign(new Error('订单已被核销，无法直接取消（请申请退款）'), { status: 409 });
    await db.run(`UPDATE market_orders SET status = 'cancelled', close_reason = ?, updated_at = ? WHERE id = ?`, [reason || '买家取消', market.now(), orderId]);
    await refundOrder(orderId, { operatorId: buyerId, reason: reason || '买家取消订单' });
    const after = await db.get('SELECT * FROM market_orders WHERE id = ?', [orderId]);
    await notify.emit({
        eventKey: `order_cancelled:${orderId}`, eventType: 'order_cancelled',
        userId: null, storeId: order.store_id, orderId, channels: 'inapp'
    });
    return after;
}

async function openDispute(orderId, buyerId, reason) {
    const order = await statusGuard(orderId, ['paid', 'delivered', 'awaiting_confirm'], 'disputed');
    if (Number(order.buyer_id) !== Number(buyerId)) throw Object.assign(new Error('只能对自己的订单发起争议'), { status: 403 });
    const r = await db.run(
        `INSERT INTO market_disputes (order_id, opened_by, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)`,
        [orderId, buyerId, String(reason || '').slice(0, 500), market.now()]
    );
    await db.run(`UPDATE market_orders SET status = 'disputed', updated_at = ? WHERE id = ?`, [market.now(), orderId]);
    await db.run(`UPDATE market_stores SET dispute_count = dispute_count + 1, updated_at = ? WHERE id = ?`, [market.now(), order.store_id]);
    await notify.emit({
        eventKey: `dispute_opened:${r.id}`, eventType: 'dispute_opened',
        userId: order.buyer_id, storeId: order.store_id, orderId,
        payload: { title: '争议已提交', content: `订单 ${order.order_no} 的争议已提交，管理员会尽快处理；期间款项冻结在托管账户。`, url: '/market/orders' }
    });
    await market.audit(buyerId, 'dispute_open', 'order', orderId, { status: order.status }, { status: 'disputed', reason }, reason);
    return db.get('SELECT * FROM market_disputes WHERE id = ?', [r.id]);
}

/** 管理员裁决争议：退款 或 放行结算 */
async function resolveDispute(disputeId, { result, refundAmount = null, operatorId, note = '' }) {
    const d = await db.get('SELECT * FROM market_disputes WHERE id = ?', [disputeId]);
    if (!d) throw Object.assign(new Error('争议不存在'), { status: 404 });
    if (d.status !== 'open') throw Object.assign(new Error('该争议已处理'), { status: 409 });
    const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [d.order_id]);
    if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });

    if (result === 'refund') {
        const rr = await refundOrder(order.id, { amount: refundAmount === null ? order.buyer_pay : refundAmount, operatorId, reason: note || '争议裁决：退款', fromDispute: true });
        await db.run(`UPDATE market_disputes SET status = 'resolved_buyer', resolution = ?, refund_amount = ?, handled_by = ?, resolved_at = ? WHERE id = ?`,
            [note, rr.refund || 0, operatorId, market.now(), disputeId]);
    } else {
        await settleOrder(order.id, operatorId, note || '争议裁决：放行结算');
        await db.run(`UPDATE market_disputes SET status = 'resolved_merchant', resolution = ?, handled_by = ?, resolved_at = ? WHERE id = ?`,
            [note, operatorId, market.now(), disputeId]);
    }
    await notify.emit({
        eventKey: `dispute_resolved:${disputeId}`, eventType: 'dispute_resolved',
        userId: order.buyer_id, storeId: order.store_id, orderId: order.id,
        payload: {
            title: '争议已裁决',
            content: `订单 ${order.order_no} 的争议已处理：${result === 'refund' ? '同意退款' : '放行结算'}。${note || ''}`,
            url: '/market/orders'
        }
    });
    return db.get('SELECT * FROM market_disputes WHERE id = ?', [disputeId]);
}

module.exports = {
    TRANSITIONS, canTransition, createOrder, verifyByCode, markDelivered,
    settleOrder, refundOrder, cancelOrder, openDispute, resolveDispute, statusGuard, newOrderNo
};
