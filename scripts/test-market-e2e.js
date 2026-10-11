/**
 * 「紫雪坊市公会集市」后端端到端联调
 *
 * 用法：
 *   # 终端 A（测试库，勿用生产库）
 *   DB_FILE=data/wiki-mobile-test.db PORT=3998 node server.js
 *   # 终端 B
 *   DB_FILE=data/wiki-mobile-test.db node scripts/test-market-e2e.js 3998
 *
 * 若上一次联调被中途打断留下脏数据，可加 --reset 先清空集市表（guild.db 需要 ALLOW_RESET_PROD=1 才允许）。
 *
 * 覆盖：开店（收费/审核/拒绝退费）→ 商品 → 下单（幂等 + 并发幂等）→ 托管账 →
 *       核销码（哈希存储 / 越权 / 重复核销）→ 交付 → 确认结算（交易税分户账）→
 *       评价/收藏/退款/争议 → 续费与欠费宽限 → 通知投递 → 财政报表与对账 → 调账
 *
 * 结束后：回滚费率配置、清理测试数据与测试账号（不动任何真实用户）。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2]) || 3998;
const RESET = process.argv.includes('--reset');
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.resolve(ROOT, process.env.DB_FILE || 'data/guild.db');

const db = new sqlite3.Database(DB_PATH);
const get = (sql, a = []) => new Promise((r, j) => db.get(sql, a, (e, x) => e ? j(e) : r(x)));
const all = (sql, a = []) => new Promise((r, j) => db.all(sql, a, (e, x) => e ? j(e) : r(x)));
const run = (sql, a = []) => new Promise((r, j) => db.run(sql, a, function (e) { e ? j(e) : r(this); }));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' · ' + extra : ''}`); }
    else { fail++; failures.push(name); console.log(`  ✗ ${name}${extra ? ' · ' + extra : ''}`); }
}
function section(t) { console.log(`\n—— ${t} ——`); }

const tok = (userId, level = 0) => jwt.sign({ userId, level }, process.env.JWT_SECRET);
async function api(method, url, userId, body, extraHeaders = {}) {
    const res = await fetch(BASE + url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(userId ? { Authorization: 'Bearer ' + tok(userId) } : {}),
            ...extraHeaders
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* 非 JSON */ }
    return { status: res.status, json };
}
const bal = async (id) => (await get('SELECT COALESCE(contribution,0) AS c FROM users WHERE id = ?', [id])).c;
const escrowId = async () => (await get("SELECT id FROM users WHERE username = 'market_escrow'")).id;
const ledgerSum = async (kind, direction) => {
    const r = await get(`SELECT COALESCE(SUM(amount),0) AS s FROM market_finance_ledger WHERE kind = ? AND direction = ?`, [kind, direction]);
    return r.s;
};

const TABLES = ['market_stores', 'market_store_locations', 'market_products', 'market_product_images', 'market_orders',
    'market_order_items', 'market_verify_codes', 'market_fee_ledger', 'market_finance_ledger', 'market_reviews',
    'market_favorites', 'market_disputes', 'market_refunds', 'market_short_links', 'market_archives',
    'market_notify_events', 'market_audit_logs'];
const startMax = {};
let startNotif = 0, cfgBefore = null;
const TEST_USERS = ['mkt_e2e_admin', 'mkt_e2e_merchant', 'mkt_e2e_buyer', 'mkt_e2e_other'];
const stamp = Date.now().toString(36).slice(-5);

async function ensureUser(username, nickname, level, contribution) {
    let u = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (!u) {
        const r = await run(
            `INSERT INTO users (username, nickname, password, level, contribution, email, email_verified, password_set)
             VALUES (?, ?, ?, ?, ?, NULL, 0, 0)`,
            [username, nickname, 'e2e-not-a-real-password-hash', level, contribution]);
        u = { id: r.lastID };
    } else {
        await run('UPDATE users SET level = ?, contribution = ?, email = NULL, avatar = ? WHERE id = ?', [level, contribution, '', u.id]);
    }
    return u.id;
}

async function cleanup() {
    try {
        for (const t of TABLES) await run(`DELETE FROM ${t} WHERE id > ?`, [startMax[t] || 0]);
        await run('DELETE FROM notifications WHERE id > ?', [startNotif]);
        // 测试账号的流水/关系
        const users = await all(`SELECT id FROM users WHERE username IN (${TEST_USERS.map(() => '?').join(',')})`, TEST_USERS);
        for (const u of users) {
            await run('DELETE FROM contribution_logs WHERE user_id = ?', [u.id]);
            await run('DELETE FROM notifications WHERE user_id = ?', [u.id]);
            await run('DELETE FROM users WHERE id = ?', [u.id]);
        }
        if (cfgBefore) {
            await run('UPDATE settings SET value = ?, updated_at = datetime(\'now\',\'localtime\') WHERE key = ?',
                [JSON.stringify(cfgBefore), 'market_config']);
        }
        console.log('\n· 已清理测试数据与测试账号，费率配置已还原');
    } catch (e) {
        console.log('\n· 清理失败：' + e.message);
    }
}

(async () => {
    console.log(`\n=== 紫雪坊市公会集市 后端端到端联调 @ ${BASE}（库：${path.relative(ROOT, DB_PATH)}）===`);

    // ---------- 准备 ----------
    if (RESET) {
        if (path.basename(DB_PATH) === 'guild.db' && process.env.ALLOW_RESET_PROD !== '1') {
            throw new Error('--reset 拒绝在生产库 guild.db 上执行（确需清空请显式设置 ALLOW_RESET_PROD=1）');
        }
        for (const t of TABLES) await run(`DELETE FROM ${t}`).catch(() => { });
        await run(`UPDATE users SET contribution = 0 WHERE username = 'market_escrow'`);
        console.log('· 已按 --reset 清空集市表（测试库专用）');
    }
    for (const t of TABLES) {
        const r = await get(`SELECT COALESCE(MAX(id),0) AS m FROM ${t}`).catch(() => ({ m: 0 }));
        startMax[t] = r.m;
    }
    startNotif = (await get('SELECT COALESCE(MAX(id),0) AS m FROM notifications')).m;
    const cfgRow = await get("SELECT value FROM settings WHERE key = 'market_config'");
    cfgBefore = cfgRow && cfgRow.value ? JSON.parse(cfgRow.value) : null;
    const cfgRes = await api('GET', '/api/market/config');
    if (!cfgRes.json || !cfgRes.json.fees) throw new Error('集市接口不可用：请先启动测试服务（DB_FILE=data/wiki-mobile-test.db PORT=3998 node server.js）');

    const adminId = await ensureUser('mkt_e2e_admin', '联调管理员', 2, 0);
    const merchantId = await ensureUser('mkt_e2e_merchant', '联调店主', 0, 100);
    const buyerId = await ensureUser('mkt_e2e_buyer', '联调买家', 0, 100);
    const otherId = await ensureUser('mkt_e2e_other', '联调路人', 0, 50);
    const guild = await get("SELECT avatar FROM users WHERE username = 'xuanjian_guild'") || await get('SELECT avatar FROM users WHERE id = 1');

    // ---------- 1 配置 ----------
    section('1. 费率配置');
    const patch = {
        openFeeEnabled: true, openFee: 5, openFeeFirstFree: false,
        renewFeeEnabled: true, renewFee: 2, cyclePreset: 'monthly', cycleDays: 30,
        graceDays: 7, remindBeforeDays: 3, autoPauseAfterGrace: true,
        taxEnabled: true, taxRateBp: 500, taxMode: 'merchant', taxRounding: 'round',
        storeReviewRequired: true, maxOpenStoresPerUser: 2, maxProductsPerStore: 50,
        verifyCodeTtlHours: 72, autoConfirmDays: 7
    };
    const put = await api('PUT', '/api/market/admin/config', adminId, patch);
    check('管理员可保存费率配置', put.status === 200 && put.json.config.openFee === 5);
    const cfgNow = (await api('GET', '/api/market/config', null)).json;
    check('公开配置读数一致（开店费 5 / 税率 500bp / 商家承担）',
        cfgNow.fees.openFee === 5 && cfgNow.tax.rateBp === 500 && cfgNow.tax.mode === 'merchant');
    check('公开配置带店铺/商品分类', Array.isArray(cfgNow.categories.store) && cfgNow.categories.store.length > 0);
    const sim = await api('POST', '/api/market/admin/config/simulate', adminId, { amount: 10, mode: 'merchant' });
    check('试算：成交 10 → 税 0.5 / 商家 9.5 / 买家实付 10',
        sim.json.tax === 0.5 && sim.json.merchantIncome === 9.5 && sim.json.buyerPay === 10, JSON.stringify(sim.json.guildIncome));
    check('试算响应里没有"平台服务费"科目', sim.json.fee === undefined && sim.json.platformFee === undefined);

    // ---------- 2 开店 ----------
    section('2. 开店：收费 / 审核');
    const m0 = await bal(merchantId);
    const open1 = await api('POST', '/api/market/merchant/stores', merchantId, {
        name: `联调铺子${stamp}`, intro: '端到端联调用店铺', tags: ['测试']
    });
    const storeA = open1.json && open1.json.store ? open1.json.store : (open1.json && open1.json.store_id ? { id: open1.json.store_id } : null);
    check('提交开店申请成功', open1.status === 201 && !!storeA);
    const storeAId = storeA ? storeA.id : open1.json.store_id;
    const m1 = await bal(merchantId);
    check('开店费从店主余额扣除 5 点', Math.abs((m0 - m1) - 5) < 1e-9, `${m0} → ${m1}`);
    check('分户账记 open_fee(in) 5 点', Math.abs((await ledgerSum('open_fee', 'in')) - 5) < 1e-9);
    const feeRow = await get(`SELECT * FROM market_fee_ledger WHERE store_id = ? AND kind = 'open'`, [storeAId]);
    check('扣费台账 open/paid 落库', !!feeRow && feeRow.status === 'paid' && feeRow.amount === 5);
    const archStore = await get(`SELECT * FROM market_archives WHERE kind = 'store' AND ref_id = ?`, [storeAId]);
    check('商铺信息写入档案（kind=store）', !!archStore && /^PS-/.test(archStore.archive_no), archStore && archStore.archive_no);
    const pendingStore = await get('SELECT status FROM market_stores WHERE id = ?', [storeAId]);
    check('未审核店铺状态为 pending', pendingStore.status === 'pending');
    const buyBeforeApprove = await api('POST', '/api/market/orders', buyerId, { store_id: storeAId, items: [] });
    check('未审核店铺不能下单', buyBeforeApprove.status >= 400);
    const review = await api('POST', `/api/market/admin/stores/${storeAId}/review`, adminId, { action: 'approve', note: '联调通过' });
    const afterReview = await get('SELECT status, expire_at, next_fee_at FROM market_stores WHERE id = ?', [storeAId]);
    check('管理员审核通过 → active 且有有效期', review.status === 200 && afterReview.status === 'active' && !!afterReview.expire_at, String(afterReview.expire_at));

    // ---------- 3 商品 ----------
    section('3. 商品');
    const prod = await api('POST', '/api/market/merchant/products', merchantId, {
        store_id: storeAId, title: `联调钻石 x1 ${stamp}`, summary: '端到端联调商品',
        description: '<p>联调用</p><script>alert(1)</script>', price: 10, stock: 3, status: 'on', images: []
    });
    const pid = prod.json && prod.json.product ? prod.json.product.id : null;
    check('店主上架商品成功', prod.status === 201 && !!pid, `#${pid}`);
    const pdesc = await get('SELECT description FROM market_products WHERE id = ?', [pid]);
    check('商品富文本被净化（script 标签被剔除）', !/script/i.test(pdesc.description || ''), String(pdesc.description).slice(0, 60));
    const otherAdd = await api('POST', '/api/market/merchant/products', otherId, { store_id: storeAId, title: '越权商品', price: 1, stock: 1, status: 'on' });
    check('非店主不能往别人店里加商品（403）', otherAdd.status === 403);
    const pubProd = await api('GET', `/api/market/products/${pid}`, null);
    check('公开商品详情可读且标记可购买', pubProd.status === 200 && pubProd.json.product.buyable === true);
    check('公开商品详情不泄露核销码字段', !JSON.stringify(pubProd.json).includes('code_hash'));

    // ---------- 4 下单 ----------
    section('4. 下单：托管 / 幂等 / 越权');
    const b0 = await bal(buyerId), e0 = await bal(await escrowId());
    const noAuth = await api('POST', '/api/market/orders', null, { store_id: storeAId, items: [{ product_id: pid, quantity: 1 }] });
    check('未登录不能下单（401）', noAuth.status === 401);
    const selfBuy = await api('POST', '/api/market/orders', merchantId, { store_id: storeAId, items: [{ product_id: pid, quantity: 1 }] });
    check('店主不能买自己店里的商品', selfBuy.status === 400);
    const idem1 = `e2e-order-1-${stamp}`;
    const order1 = await api('POST', '/api/market/orders', buyerId, { store_id: storeAId, items: [{ product_id: pid, quantity: 1 }] }, { 'Idempotency-Key': idem1 });
    const o1 = order1.json.order || {};
    check('下单成功（201）', order1.status === 201 && o1.status === 'paid');
    check('金额链路正确：成交 10 / 税 0.5 / 商家 9.5 / 买家实付 10',
        o1.amount === 10 && o1.tax_amount === 0.5 && o1.merchant_income === 9.5 && o1.buyer_pay === 10,
        JSON.stringify({ a: o1.amount, t: o1.tax_amount, mi: o1.merchant_income, bp: o1.buyer_pay }));
    check('税率按订单快照保存（500bp / merchant）', o1.tax_rate_bp === 500 && o1.tax_mode === 'merchant');
    check('明文核销码只在下单响应里出现一次', /^BW-[A-Z0-9]{4}-[A-Z0-9]{6}$/.test(String(order1.json.verify_code || '')), order1.json.verify_code);
    const plainCode = order1.json.verify_code;
    const b1 = await bal(buyerId), e1 = await bal(await escrowId());
    check('买家扣 10 点、托管账号 +10 点', Math.abs((b0 - b1) - 10) < 1e-9 && Math.abs((e1 - e0) - 10) < 1e-9, `${b0}→${b1} escrow ${e0}→${e1}`);
    const vc = await get('SELECT * FROM market_verify_codes WHERE order_id = ?', [o1.id]);
    const crypto = require('crypto');
    check('核销码只存 sha256 哈希 + 末 4 位', vc.code_hash === crypto.createHash('sha256').update(plainCode.toUpperCase()).digest('hex') && vc.code_tail === plainCode.slice(-4));
    const orderIdem = await get('SELECT COUNT(*) AS c FROM market_orders WHERE idem_key = ?', [idem1]);
    check('同一 Idempotency-Key 只落一单', orderIdem.c === 1);
    const retry = await api('POST', '/api/market/orders', buyerId, { store_id: storeAId, items: [{ product_id: pid, quantity: 1 }] }, { 'Idempotency-Key': idem1 });
    check('重复提交返回原单且不再扣款', retry.status === 200 && retry.json.reused === true && retry.json.verify_code === null && Math.abs((await bal(buyerId)) - b1) < 1e-9);
    // 并发同 key
    const idem2 = `e2e-order-race-${stamp}`;
    const [r1, r2] = await Promise.all([
        api('POST', '/api/market/orders', buyerId, { store_id: storeAId, items: [{ product_id: pid, quantity: 1 }] }, { 'Idempotency-Key': idem2 }),
        api('POST', '/api/market/orders', buyerId, { store_id: storeAId, items: [{ product_id: pid, quantity: 1 }] }, { 'Idempotency-Key': idem2 })
    ]);
    const raceOrders = await all('SELECT id FROM market_orders WHERE idem_key = ?', [idem2]);
    const raceCharged = Math.abs((b1 - (await bal(buyerId))) - 10) < 1e-9;
    check('并发同 key：只落一单且只扣一次款', raceOrders.length === 1 && raceCharged,
        `订单 ${raceOrders.length} 条 / 状态 ${r1.status},${r2.status}` +
        (r1.status >= 400 || r2.status >= 400 ? ` / ${(r1.json && r1.json.error) || (r2.json && r2.json.error) || ''}` : ''));
    const raceOrderId = raceOrders[0].id;
    const seeByOther = await api('GET', `/api/market/orders/${o1.id}`, otherId);
    check('无关用户看不了别人的订单（403）', seeByOther.status === 403);
    const seeByOwner = await api('GET', `/api/market/orders/${o1.id}`, merchantId);
    check('店主可看本店订单', seeByOwner.status === 200 && seeByOwner.json.role === 'owner');
    check('订单详情不返回明文核销码', !JSON.stringify(seeByOwner.json).includes(plainCode));

    // ---------- 5 核销 ----------
    section('5. 核销');
    const bad = await api('POST', '/api/market/merchant/verify', merchantId, { store_id: storeAId, code: 'BW-ZZZZ-ZZZZZZ' });
    check('错误核销码被拒绝', bad.status >= 400);
    const foreign = await api('POST', '/api/market/merchant/verify', otherId, { store_id: storeAId, code: plainCode });
    check('非本店店主不能核销（403）', foreign.status === 403);
    const eVerifyBefore = await bal(await escrowId());
    const okv = await api('POST', '/api/market/merchant/verify', merchantId, { store_id: storeAId, code: plainCode });
    check('店主核销成功 → 订单进入已核销', okv.status === 200 && (await get('SELECT status FROM market_orders WHERE id = ?', [o1.id])).status === 'delivered');
    check('核销不动钱（托管余额不变）', Math.abs((await bal(await escrowId())) - eVerifyBefore) < 1e-9);
    const againv = await api('POST', '/api/market/merchant/verify', merchantId, { store_id: storeAId, code: plainCode });
    check('重复核销幂等（不重复处理）', againv.status === 200 && againv.json.already === true);
    const delv = await api('POST', `/api/market/merchant/orders/${o1.id}/deliver`, merchantId, { note: '游戏内已交货' });
    check('标记交付 → 待买家确认', delv.status === 200 && (await get('SELECT status FROM market_orders WHERE id = ?', [o1.id])).status === 'awaiting_confirm');

    // ---------- 6 结算 ----------
    section('6. 确认收货 → 结算（交易税分户账）');
    const m2 = await bal(merchantId), e2 = await bal(await escrowId());
    const taxBefore = await ledgerSum('tax', 'in');
    const conf = await api('POST', `/api/market/orders/${o1.id}/confirm`, buyerId);
    check('买家确认收货 → 订单已完成', conf.status === 200 && (await get('SELECT status FROM market_orders WHERE id = ?', [o1.id])).status === 'settled');
    const m3 = await bal(merchantId), e3 = await bal(await escrowId());
    check('商家到账 9.5 点（10 − 5% 税）', Math.abs((m3 - m2) - 9.5) < 1e-9, `${m2} → ${m3}`);
    check('托管账号完整清空本单 10 点（9.5 给商家 + 0.5 税退出流通）', Math.abs((e2 - e3) - o1.buyer_pay) < 1e-9, `${e2} → ${e3}`);
    check('交易税 0.5 点记入公会分户账', Math.abs((await ledgerSum('tax', 'in')) - taxBefore - 0.5) < 1e-9);
    const taxRow = await get('SELECT * FROM market_finance_ledger WHERE kind = ? AND order_id = ?', ['tax', o1.id]);
    check('税务流水带税率快照与承担方', !!taxRow && taxRow.tax_rate_bp === 500 && taxRow.tax_mode === 'merchant');
    const conf2 = await api('POST', `/api/market/orders/${o1.id}/confirm`, buyerId);
    check('重复确认幂等：余额不再变化', conf2.status === 200 && conf2.json.already === true && Math.abs((await bal(merchantId)) - m3) < 1e-9);
    const archLedger = await get(`SELECT * FROM market_archives WHERE kind = 'ledger' AND ref_id = ? AND ref_type = 'order'`, [o1.id]);
    check('结算写入账本类档案（kind=ledger）', !!archLedger && /^PL-/.test(archLedger.archive_no), archLedger && archLedger.archive_no);
    const storeStat = await get('SELECT sales_count FROM market_stores WHERE id = ?', [storeAId]);
    check('店铺成交数 +1', storeStat.sales_count === 1);

    // ---------- 7 评价 / 收藏 ----------
    section('7. 评价 / 收藏');
    const rev = await api('POST', '/api/market/reviews', buyerId, { order_id: o1.id, rating: 5, content: '联调好评' });
    check('买家可评价', rev.status === 201);
    const rev2 = await api('POST', '/api/market/reviews', buyerId, { order_id: o1.id, rating: 1, content: '重复评价' });
    check('一单一评（重复被拒 409）', rev2.status === 409);
    const revOther = await api('POST', '/api/market/reviews', otherId, { order_id: o1.id, rating: 1 });
    check('非买家不能评价（403）', revOther.status === 403);
    const storeRating = await get('SELECT rating_sum, rating_count FROM market_stores WHERE id = ?', [storeAId]);
    check('店铺评分累计正确（5 星 1 条）', storeRating.rating_sum === 5 && storeRating.rating_count === 1);
    const fav = await api('POST', '/api/market/favorites', buyerId, { target_type: 'product', target_id: pid });
    const favList = await api('GET', '/api/market/favorites', buyerId);
    check('收藏商品成功并可查询', fav.status === 201 && favList.json.products.some(p => p.id === pid));
    const unfav = await api('DELETE', `/api/market/favorites/product/${pid}`, buyerId);
    check('取消收藏成功', unfav.status === 200 && (await api('GET', '/api/market/favorites', buyerId)).json.products.every(p => p.id !== pid));

    // ---------- 8 退款 ----------
    section('8. 退款（未结算订单，托管退回）');
    const b2 = await bal(buyerId), e4 = await bal(await escrowId());
    const stockBefore = (await get('SELECT stock FROM market_products WHERE id = ?', [pid])).stock;
    // 用并发那一单做退款流程（状态 paid）
    const stock2 = (await get('SELECT status FROM market_orders WHERE id = ?', [raceOrderId])).status;
    check('并发单处于已付款待核销', stock2 === 'paid', stock2);
    const reqRefund = await api('POST', `/api/market/orders/${raceOrderId}/refund`, buyerId, { reason: '联调主动退款' });
    check('买家申请退款 → 退款处理中', reqRefund.status === 201 && (await get('SELECT status FROM market_orders WHERE id = ?', [raceOrderId])).status === 'refunding');
    const refundRow = await get('SELECT * FROM market_refunds WHERE order_id = ?', [raceOrderId]);
    const approve = await api('POST', `/api/market/merchant/refunds/${refundRow.id}/approve`, merchantId);
    const b3 = await bal(buyerId), e5 = await bal(await escrowId());
    check('商家同意退款 → 订单已退款', approve.status === 200 && (await get('SELECT status FROM market_orders WHERE id = ?', [raceOrderId])).status === 'refunded');
    check('退款把钱从托管退回买家', Math.abs((b3 - b2) - 10) < 1e-9 && Math.abs((e4 - e5) - 10) < 1e-9);
    check('未结算订单退款不产生税务冲回流水', (await get('SELECT COUNT(*) AS c FROM market_finance_ledger WHERE kind = ? AND order_id = ?', ['refund_tax', raceOrderId])).c === 0);
    check('退款回补库存', (await get('SELECT stock FROM market_products WHERE id = ?', [pid])).stock === stockBefore + 1);

    // ---------- 9 争议 ----------
    section('9. 争议裁决');
    const order3 = await api('POST', '/api/market/orders', buyerId, { store_id: storeAId, items: [{ product_id: pid, quantity: 1 }] }, { 'Idempotency-Key': `e2e-order-3-${stamp}` });
    const o3id = order3.json.order.id;
    const disp = await api('POST', `/api/market/orders/${o3id}/dispute`, buyerId, { reason: '联调争议' });
    check('买家发起争议成功', disp.status === 201 && (await get('SELECT status FROM market_orders WHERE id = ?', [o3id])).status === 'disputed');
    const bD = await bal(buyerId);
    const dispList = await api('GET', '/api/market/admin/disputes', adminId);
    const openDisp = (dispList.json.items || []).find(d => Number(d.order_id) === Number(o3id));
    check('管理员可见待处理争议', !!openDisp);
    const resolve = await api('POST', `/api/market/admin/disputes/${openDisp.id}/resolve`, adminId, { result: 'refund', note: '联调裁决退款' });
    check('裁决退款 → 订单已退款、买家收到钱', resolve.status === 200 && (await get('SELECT status FROM market_orders WHERE id = ?', [o3id])).status === 'refunded' && Math.abs((await bal(buyerId)) - bD - 10) < 1e-9);

    // ---------- 10 拒绝开店退费 ----------
    section('10. 开店被拒 → 退还开店费');
    const mPre = await bal(merchantId);
    const open2 = await api('POST', '/api/market/merchant/stores', merchantId, { name: `联调被拒铺子${stamp}`, intro: '用于测试拒绝退费' });
    const storeBId = open2.json && open2.json.store ? open2.json.store.id : null;
    check('第二家店可申请（上限已放宽到 2）', open2.status === 201 && !!storeBId, `store#${storeBId} ${open2.json && open2.json.error || ''}`);
    check('再次收取开店费 5 点', !!storeBId && Math.abs((mPre - (await bal(merchantId))) - 5) < 1e-9);
    const refundFeeBefore = await ledgerSum('refund_fee', 'out');
    const reject = storeBId ? await api('POST', `/api/market/admin/stores/${storeBId}/review`, adminId, { action: 'reject', note: '联调拒绝' }) : { status: 0 };
    const storeBRow = storeBId ? await get('SELECT status FROM market_stores WHERE id = ?', [storeBId]) : null;
    check('审核拒绝成功', reject.status === 200 && !!storeBRow && storeBRow.status === 'rejected');
    check('开店费原路退还店主', !!storeBId && Math.abs((await bal(merchantId)) - mPre) < 1e-9);
    check('分户账记 refund_fee(out) 5 点', Math.abs((await ledgerSum('refund_fee', 'out')) - refundFeeBefore - 5) < 1e-9);
    const feeLedgerB = storeBId ? await get(`SELECT status FROM market_fee_ledger WHERE store_id = ? AND kind = 'open'`, [storeBId]) : null;
    check('扣费台账标记为已退', !!feeLedgerB && feeLedgerB.status === 'refunded');

    // ---------- 11 续费 ----------
    section('11. 续期扣费 / 欠费宽限');
    await run(`UPDATE market_stores SET next_fee_at = ?, status = 'active' WHERE id = ?`, ['2000-01-01 00:00:00', storeAId]);
    const mR = await bal(merchantId);
    const renewBefore = await ledgerSum('renew_fee', 'in');
    const jobs1 = await api('POST', '/api/market/admin/jobs/run', adminId, {});
    const storeAfterRenew = await get('SELECT status, next_fee_at FROM market_stores WHERE id = ?', [storeAId]);
    check('到期自动续费：状态保持营业且续期到未来', jobs1.status === 200 && storeAfterRenew.status === 'active' && String(storeAfterRenew.next_fee_at) > '2020-01-01');
    check('续期费 2 点从店主扣除', Math.abs((mR - (await bal(merchantId))) - 2) < 1e-9, `${mR} → ${await bal(merchantId)}`);
    check('分户账记 renew_fee(in) 2 点', Math.abs((await ledgerSum('renew_fee', 'in')) - renewBefore - 2) < 1e-9);
    // 扣不动 → 宽限期（用另一个逾期时间点，避免与上一轮成功的续费凭证同键）
    await run(`UPDATE market_stores SET next_fee_at = ?, status = 'active', grace_until = NULL, fee_fail_count = 0 WHERE id = ?`, ['2001-06-01 00:00:00', storeAId]);
    await run('UPDATE users SET contribution = 0 WHERE id = ?', [merchantId]);
    const jobs2 = await api('POST', '/api/market/admin/jobs/run', adminId, {});
    const graceStore = await get('SELECT status, grace_until, fee_fail_count FROM market_stores WHERE id = ?', [storeAId]);
    check('余额不足时进入宽限期并记失败次数', jobs2.status === 200 && graceStore.status === 'grace' && graceStore.fee_fail_count >= 1, `${graceStore.status} / 失败 ${graceStore.fee_fail_count} 次`);
    const failRow = await get(`SELECT status, fail_reason FROM market_fee_ledger WHERE store_id = ? AND kind = 'renew' AND status = 'failed'`, [storeAId]);
    check('扣费失败写入台账失败原因', !!failRow && /不足|不存在/.test(failRow.fail_reason || ''), failRow && failRow.fail_reason);
    // 宽限期到期 → 欠费暂停 + 自动下架
    await run(`UPDATE market_stores SET grace_until = ? WHERE id = ?`, ['2000-01-01 00:00:00', storeAId]);
    const jobs3 = await api('POST', '/api/market/admin/jobs/run', adminId, {});
    const susp = await get('SELECT status FROM market_stores WHERE id = ?', [storeAId]);
    check('宽限期结束 → 欠费暂停', jobs3.status === 200 && susp.status === 'suspended', susp.status);
    const offProd = await get('SELECT status, off_reason FROM market_products WHERE id = ?', [pid]);
    check('欠费暂停自动下架商品并标注原因', offProd.status === 'off' && /欠费/.test(offProd.off_reason || ''), `${offProd.status}/${offProd.off_reason}`);
    // 续费后恢复
    await run('UPDATE users SET contribution = 100 WHERE id = ?', [merchantId]);
    const renewManual = await api('POST', `/api/market/merchant/stores/${storeAId}/renew`, merchantId, {});
    const resumed = await get('SELECT status FROM market_products WHERE id = ?', [pid]);
    check('手动续费后店铺恢复营业、商品自动上架', renewManual.status === 200 && (await get('SELECT status FROM market_stores WHERE id = ?', [storeAId])).status === 'active' && resumed.status === 'on');

    // ---------- 12 通知 ----------
    section('12. 三路通知（站内 / 实时 / 邮件）');
    const disp2 = await api('POST', '/api/market/admin/notify/dispatch', adminId, { limit: 200 });
    check('通知队列投递执行成功', disp2.status === 200 && disp2.json.result.total > 0, JSON.stringify(disp2.json.result));
    const inapp = await get(`SELECT COUNT(*) AS c FROM notifications WHERE user_id IN (?, ?) AND type LIKE 'market_%'`,
        [merchantId, buyerId]);
    check('站内通知已落到现有 notifications 表', inapp.c > 0, `${inapp.c} 条`);
    const evRows = await all(`SELECT status, channels, COUNT(*) AS c FROM market_notify_events GROUP BY status`);
    check('通知事件有成功投递记录', evRows.some(r => r.status === 'sent'), JSON.stringify(evRows));
    const mailEv = await get(`SELECT last_error FROM market_notify_events WHERE channels LIKE '%mail%' LIMIT 1`);
    check('测试账号无邮箱时邮件渠道被安全跳过', !mailEv || /no-address|mail:/.test(mailEv.last_error || ''), mailEv && mailEv.last_error);
    const allEvents = await all('SELECT payload FROM market_notify_events');
    check('任何通知内容都不含明文核销码', allEvents.every(r => !String(r.payload).includes(plainCode)));

    // ---------- 13 财政 / 对账 / 档案 ----------
    section('13. 财政分户账 / 对账 / 档案 / 审计');
    const fin = await api('GET', '/api/market/admin/finance', adminId);
    check('财政报表可读', fin.status === 200);
    check('收入三类科目齐全（开店费/续期费/交易税）',
        fin.json.income.openFee > 0 && fin.json.income.renewFee > 0 && fin.json.income.tax > 0,
        JSON.stringify(fin.json.income));
    check('报表中没有"公会财政账号"（已删除）', fin.json.accounts.treasury === undefined);
    check('托管账号在报表中可见带头像', !!fin.json.accounts.escrow && !!fin.json.accounts.escrow.avatar, fin.json.accounts.escrow && fin.json.accounts.escrow.avatar);
    check('托管头像与公会官方账号一致', fin.json.accounts.escrow.avatar === (guild && guild.avatar), `${guild && guild.avatar}`);
    check('科目里没有平台服务费/抽成', fin.json.income.serviceFee === undefined && fin.json.income.commission === undefined);
    const rec = await api('GET', '/api/market/admin/reconcile', adminId);
    check('对账自检通过：托管余额 = 未结算订单合计', rec.json.escrow.balanced === true,
        `托管 ${rec.json.escrow.balance} / 在途 ${rec.json.escrow.pendingOrders}`);
    check('对账自检通过：交易税 = 已结算订单税额', rec.json.tax.balanced === true, JSON.stringify(rec.json.tax));
    check('对账自检通过：开店费 = 店铺已缴开店费', rec.json.openFee.balanced === true, JSON.stringify(rec.json.openFee));
    check('对账自检通过：续期费 = 扣费台账', rec.json.renewFee.balanced === true, JSON.stringify(rec.json.renewFee));
    check('整体对账 ok', rec.json.ok === true);
    const arc = await api('GET', '/api/market/admin/archives', adminId);
    check('档案检索包含商铺与账本两类', (arc.json.items || []).some(a => a.kind === 'store') && (arc.json.items || []).some(a => a.kind === 'ledger'));
    const aud = await api('GET', '/api/market/admin/audit', adminId);
    check('审计日志记录了审核/结算等敏感操作',
        ['store_approve', 'order_settle', 'store_reject'].every(a => (aud.json.items || []).some(x => x.action === a)),
        [...new Set((aud.json.items || []).map(x => x.action))].slice(0, 8).join(','));

    // ---------- 14 调账 ----------
    section('14. 手工调账（只写分户账）');
    const mA = await bal(merchantId);
    const adjIn = await api('POST', '/api/market/admin/finance/adjust', adminId, { user_id: merchantId, amount: 3, direction: 'in', note: '联调调账入账' });
    check('调账入账：扣用户 3 点 + 分户账 adjust(in)', adjIn.status === 200 && Math.abs((mA - (await bal(merchantId))) - 3) < 1e-9);
    const adjOut = await api('POST', '/api/market/admin/finance/adjust', adminId, { user_id: merchantId, amount: 3, direction: 'out', note: '联调调账出账' });
    check('调账出账：补回用户 3 点 + 分户账 adjust(out)', adjOut.status === 200 && Math.abs((await bal(merchantId)) - mA) < 1e-9);
    const adjBad = await api('POST', '/api/market/admin/finance/adjust', adminId, { amount: 3, direction: 'in', note: '缺用户' });
    check('调账必须指定用户', adjBad.status === 400);
    const adjDenied = await api('POST', '/api/market/admin/finance/adjust', buyerId, { user_id: merchantId, amount: 1, direction: 'in', note: '越权' });
    check('普通用户不能调账（403）', adjDenied.status === 403);

    // ---------- 15 明文码落盘检查 ----------
    section('15. 核销码明文落盘检查');
    const files = [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm'].filter(f => fs.existsSync(f));
    let hit = null;
    for (const f of files) {
        const buf = fs.readFileSync(f);
        if (buf.includes(Buffer.from(plainCode, 'utf8'))) hit = path.basename(f);
    }
    check('数据库文件（含 WAL）里搜不到明文核销码', !hit, hit ? `命中 ${hit}` : `${files.length} 个文件已扫描`);

    // ---------- 汇总 ----------
    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
    if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
    await cleanup();
    db.close();
    process.exit(fail ? 1 : 0);
})().catch(async (e) => {
    console.error('\n联调中断：', e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 3).join('\n'));
    await cleanup();
    db.close();
    process.exit(1);
});
