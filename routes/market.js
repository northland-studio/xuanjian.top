/**
 * 「紫雪坊市公会集市」路由
 *
 * 三段：
 *   /api/market/**                公开与买家（浏览、下单、确认收货、退款、评价、收藏、地图）
 *   /api/market/merchant/**       商家（店铺资料、商品、订单、核销、履约、退款处理、经营账、档案）
 *   /api/market/admin/**          管理员（审核、费率税务配置、争议裁决、人工退款、财政分户账、档案、审计、任务触发）
 *
 * 约定：
 *   - 所有"谁能看/谁能改"的判断都在后端；前端隐藏按钮只是体验
 *   - 富文本描述复用 wiki 的白名单清洗（sanitize-html），不新造清洗器
 *   - 图片只收 URL（复用 /api/upload/image 上传，不在集市里再写一套存储）
 */
const express = require('express');
const db = require('../database');
const logger = require('../lib/logger');
const market = require('../lib/market');
const settle = require('../lib/market-settle');
const jobs = require('../lib/market-jobs');
const notify = require('../lib/market-notify');
const wiki = require('../lib/wiki');
const { authMiddleware, adminMiddleware, optionalAuthMiddleware } = require('../middleware/auth');

const router = express.Router();

function fail(res, e, fallback) {
    const status = e && e.status ? e.status : 500;
    if (status >= 500) logger.error('[market]', e.message);
    return res.status(status).json({ error: e && e.message ? e.message : fallback });
}
const pageParams = (q) => {
    const limit = Math.min(60, Math.max(1, Number(q.limit) || 20));
    const page = Math.max(1, Number(q.page) || 1);
    return { limit, page, offset: (page - 1) * limit };
};
const safeJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } };

/* ==================================================================
 * 公开：配置 / 分类 / 首页
 * ================================================================== */

router.get('/config', async (req, res) => {
    try {
        const cfg = await market.getConfig();
        const cats = await db.all('SELECT id, kind, name, slug, icon, sort_order FROM market_categories WHERE is_active = 1 ORDER BY kind, sort_order, id');
        res.json({
            ok: true,
            fees: {
                openFeeEnabled: cfg.openFeeEnabled, openFee: cfg.openFee, openFeeFirstFree: cfg.openFeeFirstFree,
                renewFeeEnabled: cfg.renewFeeEnabled, renewFee: cfg.renewFee,
                cyclePreset: cfg.cyclePreset, cycleDays: market.cycleDaysOf(cfg), graceDays: cfg.graceDays
            },
            tax: { enabled: cfg.taxEnabled, rateBp: cfg.taxRateBp, mode: cfg.taxMode, rounding: cfg.taxRounding },
            limits: {
                perOrderLimitDefault: cfg.perOrderLimitDefault, maxProductsPerStore: cfg.maxProductsPerStore,
                verifyCodeTtlHours: cfg.verifyCodeTtlHours, maxOpenStoresPerUser: cfg.maxOpenStoresPerUser
            },
            storeStatusLabel: market.STORE_STATUS_LABEL,
            orderStatusLabel: market.ORDER_STATUS_LABEL,
            dimensions: market.DIMENSIONS,
            categories: { store: cats.filter(c => c.kind === 'store'), product: cats.filter(c => c.kind === 'product') }
        });
    } catch (e) { fail(res, e, '加载集市配置失败'); }
});

/** 店铺列表 */
router.get('/stores', optionalAuthMiddleware, async (req, res) => {
    try {
        const { limit, page, offset } = pageParams(req.query);
        const where = [`s.status IN ('active','grace')`];
        const params = [];
        if (req.query.keyword) { where.push('(s.name LIKE ? OR s.intro LIKE ? OR s.tags LIKE ?)'); const k = `%${req.query.keyword}%`; params.push(k, k, k); }
        if (req.query.category_id) { where.push('s.category_id = ?'); params.push(Number(req.query.category_id)); }
        if (req.query.server || req.query.dimension) {
            const sub = ['l.store_id = s.id', 'l.is_public = 1'];
            if (req.query.server) { sub.push('l.server_key = ?'); params.push(String(req.query.server)); }
            if (req.query.dimension) { sub.push('l.dimension = ?'); params.push(String(req.query.dimension)); }
            where.push(`EXISTS (SELECT 1 FROM market_store_locations l WHERE ${sub.join(' AND ')})`);
        }
        const sortMap = {
            hot: 's.sales_count DESC, s.order_count DESC, s.id DESC',
            rating: '(CASE WHEN s.rating_count > 0 THEN s.rating_sum * 1.0 / s.rating_count ELSE 0 END) DESC, s.rating_count DESC',
            new: 's.id DESC'
        };
        const order = sortMap[req.query.sort] || sortMap.hot;
        const sql = `FROM market_stores s WHERE ${where.join(' AND ')}`;
        const total = await db.get(`SELECT COUNT(*) AS c ${sql}`, params);
        const rows = await db.all(
            `SELECT s.id, s.name, s.slug, s.intro, s.cover, s.avatar, s.status, s.is_featured, s.rating_sum, s.rating_count,
                    s.sales_count, s.order_count, s.created_at, s.expire_at, s.tags, c.name AS category_name
             ${sql.replace('FROM market_stores s', 'FROM market_stores s LEFT JOIN market_categories c ON c.id = s.category_id')}
             ORDER BY s.is_featured DESC, ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
        res.json({ ok: true, total: total.c, page, limit, items: rows });
    } catch (e) { fail(res, e, '加载店铺列表失败'); }
});

/** 店铺详情（含位置、商品、公告、评价摘要） */
router.get('/stores/:id', optionalAuthMiddleware, async (req, res) => {
    try {
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [req.params.id]);
        if (!store) return res.status(404).json({ error: '店铺不存在' });
        const isOwner = req.userId && Number(req.userId) === Number(store.owner_id);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!['active', 'grace'].includes(store.status) && !isOwner && !isAdmin) {
            return res.status(404).json({ error: '店铺不存在' });
        }
        const [owner, cat, locs, products, reviews, fav] = await Promise.all([
            db.get('SELECT id, username, nickname, avatar, game_id FROM users WHERE id = ?', [store.owner_id]),
            store.category_id ? db.get('SELECT id, name, slug FROM market_categories WHERE id = ?', [store.category_id]) : null,
            db.all(`SELECT id, server_key, server_name, dimension, dimension_custom, x, y, z, label, note, is_public
                      FROM market_store_locations WHERE store_id = ? ${isOwner || isAdmin ? '' : 'AND is_public = 1'} ORDER BY id`, [store.id]),
            db.all(`SELECT id, title, summary, cover, price, stock, sold, status, per_user_limit FROM market_products
                     WHERE store_id = ? AND status IN ('on','soldout') ORDER BY sold DESC, id DESC LIMIT 60`, [store.id]),
            db.all(`SELECT r.id, r.rating, r.content, r.created_at, r.reply, u.nickname, u.username, u.avatar
                      FROM market_reviews r LEFT JOIN users u ON u.id = r.buyer_id
                     WHERE r.store_id = ? AND r.status = 'visible' ORDER BY r.id DESC LIMIT 20`, [store.id]),
            req.userId ? db.get(`SELECT id FROM market_favorites WHERE user_id = ? AND target_type = 'store' AND target_id = ?`, [req.userId, store.id]) : null
        ]);
        const shortCode = await market.shortLinkFor('store', store.id);
        res.json({
            ok: true,
            store: { ...store, owner, category: cat, locations: locs, is_owner: !!isOwner, is_favorited: !!fav, short_code: shortCode },
            products,
            reviews,
            rating: store.rating_count > 0 ? Math.round((store.rating_sum / store.rating_count) * 10) / 10 : 0
        });
    } catch (e) { fail(res, e, '加载店铺失败'); }
});

/** 商品搜索 */
router.get('/products', optionalAuthMiddleware, async (req, res) => {
    try {
        const { limit, page, offset } = pageParams(req.query);
        const where = [`p.status IN ('on','soldout')`, `s.status IN ('active','grace')`];
        const params = [];
        const kw = String(req.query.keyword || '').trim();
        if (kw) { where.push('(p.title LIKE ? OR p.summary LIKE ? OR p.tags LIKE ?)'); const k = `%${kw}%`; params.push(k, k, k); }
        if (req.query.category_id) { where.push('p.category_id = ?'); params.push(Number(req.query.category_id)); }
        if (req.query.store_id) { where.push('p.store_id = ?'); params.push(Number(req.query.store_id)); }
        if (req.query.min_price !== undefined && req.query.min_price !== '') { where.push('p.price >= ?'); params.push(Number(req.query.min_price)); }
        if (req.query.max_price !== undefined && req.query.max_price !== '') { where.push('p.price <= ?'); params.push(Number(req.query.max_price)); }
        if (req.query.in_stock === '1') { where.push(`p.status = 'on' AND p.stock > 0`); }
        const sortMap = {
            hot: 'p.sold DESC, p.views DESC, p.id DESC',
            price_asc: 'p.price ASC, p.id DESC',
            price_desc: 'p.price DESC, p.id DESC',
            new: 'p.id DESC'
        };
        const order = sortMap[req.query.sort] || sortMap.new;
        const from = `FROM market_products p JOIN market_stores s ON s.id = p.store_id LEFT JOIN market_categories c ON c.id = p.category_id
                      WHERE ${where.join(' AND ')}`;
        const total = await db.get(`SELECT COUNT(*) AS c ${from}`, params);
        const items = await db.all(
            `SELECT p.id, p.title, p.summary, p.cover, p.price, p.stock, p.sold, p.status, p.tags, p.per_user_limit,
                    p.store_id, s.name AS store_name, s.status AS store_status, c.name AS category_name
             ${from} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
        res.json({ ok: true, total: total.c, page, limit, items });
    } catch (e) { fail(res, e, '搜索商品失败'); }
});

/** 商品详情 */
router.get('/products/:id', optionalAuthMiddleware, async (req, res) => {
    try {
        const p = await db.get('SELECT * FROM market_products WHERE id = ?', [req.params.id]);
        if (!p) return res.status(404).json({ error: '商品不存在' });
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [p.store_id]);
        const isOwner = req.userId && store && Number(req.userId) === Number(store.owner_id);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!['on', 'soldout'].includes(p.status) && !isOwner && !isAdmin) return res.status(404).json({ error: '商品不存在' });
        const [images, cat, reviews, fav, owner] = await Promise.all([
            db.all('SELECT url FROM market_product_images WHERE product_id = ? ORDER BY sort_order, id', [p.id]),
            p.category_id ? db.get('SELECT id, name, slug FROM market_categories WHERE id = ?', [p.category_id]) : null,
            db.all(`SELECT r.id, r.rating, r.content, r.created_at, r.reply, u.nickname, u.username, u.avatar
                      FROM market_reviews r LEFT JOIN users u ON u.id = r.buyer_id
                     WHERE r.product_id = ? AND r.status = 'visible' ORDER BY r.id DESC LIMIT 20`, [p.id]),
            req.userId ? db.get(`SELECT id FROM market_favorites WHERE user_id = ? AND target_type = 'product' AND target_id = ?`, [req.userId, p.id]) : null,
            store ? db.get('SELECT id, username, nickname, avatar FROM users WHERE id = ?', [store.owner_id]) : null
        ]);
        // 描述白名单清洗（复用 wiki 的清洗器）
        const descHtml = p.description ? wiki.sanitizeContent(p.description) : '';
        const shortCode = await market.shortLinkFor('product', p.id);
        res.json({
            ok: true,
            product: {
                ...p, description_html: descHtml, images: images.map(i => i.url),
                category: cat, store: store ? { id: store.id, name: store.name, status: store.status, owner, rating_sum: store.rating_sum, rating_count: store.rating_count, sales_count: store.sales_count } : null,
                is_owner: !!isOwner, is_favorited: !!fav, short_code: shortCode,
                buyable: p.status === 'on' && p.stock > 0 && store && market.storeSellable(store) && !isOwner
            },
            reviews,
            rating: reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : 0
        });
    } catch (e) { fail(res, e, '加载商品失败'); }
});

/** 店铺地图（自定义 X/Z 投影） */
router.get('/map', optionalAuthMiddleware, async (req, res) => {
    try {
        const cfg = await market.getConfig();
        const where = [`l.is_public = 1`, `s.status IN ('active','grace')`];
        const params = [];
        const kw = String(req.query.keyword || '').trim();
        if (kw) { where.push('(s.name LIKE ? OR l.label LIKE ? OR l.note LIKE ?)'); const k = `%${kw}%`; params.push(k, k, k); }
        if (req.query.server) { where.push('l.server_key = ?'); params.push(String(req.query.server)); }
        if (req.query.dimension) { where.push('l.dimension = ?'); params.push(String(req.query.dimension)); }
        const rows = await db.all(
            `SELECT l.id, l.store_id, l.server_key, l.server_name, l.dimension, l.dimension_custom, l.x, l.y, l.z, l.label, l.note,
                    s.name AS store_name, s.avatar, s.cover, s.intro
               FROM market_store_locations l JOIN market_stores s ON s.id = l.store_id
              WHERE ${where.join(' AND ')} ORDER BY l.id LIMIT 1000`, params);
        const servers = await db.all(`SELECT DISTINCT l.server_key, l.server_name FROM market_store_locations l WHERE l.is_public = 1 ORDER BY l.server_key`);
        const dimensions = await db.all(`SELECT DISTINCT l.dimension FROM market_store_locations l WHERE l.is_public = 1`);
        const points = rows.map(r => {
            const proj = market.projectToMap(r.server_key, r.dimension, r.x, r.z, cfg);
            const bg = (cfg.mapBackgrounds || {})[`${r.server_key}|${r.dimension}`] || null;
            return {
                id: r.id, store_id: r.store_id, store_name: r.store_name, label: r.label, note: r.note,
                server_key: r.server_key, server_name: r.server_name || r.server_key,
                dimension: r.dimension, dimension_label: market.DIMENSIONS[r.dimension] || r.dimension, dimension_custom: r.dimension_custom,
                x: r.x, y: r.y, z: r.z, px: Math.round(proj.x * 100) / 100, py: Math.round(proj.y * 100) / 100,
                inside: proj.inside, range: proj.range, background: bg ? bg.url : null
            };
        });
        res.json({ ok: true, points, servers, dimensions, mapRange: cfg.mapRange, backgrounds: cfg.mapBackgrounds || {} });
    } catch (e) { fail(res, e, '加载地图数据失败'); }
});

/* ==================================================================
 * 买家：订单 / 评价 / 收藏
 * ================================================================== */

/** 下单（幂等：body.idem_key 或 Idempotency-Key 头） */
router.post('/orders', authMiddleware, async (req, res) => {
    try {
        const idem = String(req.headers['idempotency-key'] || req.body?.idem_key || '').slice(0, 80) || null;
        const out = await settle.createOrder({
            buyerId: req.userId,
            storeId: Number(req.body?.store_id),
            items: req.body?.items || [],
            idemKey: idem,
            remark: String(req.body?.remark || '').slice(0, 200)
        });
        res.status(out.reused ? 200 : 201).json({
            ok: true, reused: out.reused, order: out.order,
            // 明文核销码只在创建时返回这一次（库里只存哈希）
            verify_code: out.verifyCode,
            notice: out.reused ? '这是一次重复提交，返回已存在的订单' : '核销码只显示这一次，请记录下来交给商家'
        });
    } catch (e) { fail(res, e, '下单失败'); }
});

/** 我的订单 */
router.get('/orders', authMiddleware, async (req, res) => {
    try {
        const { limit, page, offset } = pageParams(req.query);
        const where = ['o.buyer_id = ?'];
        const params = [req.userId];
        if (req.query.status) { where.push('o.status = ?'); params.push(String(req.query.status)); }
        const from = `FROM market_orders o JOIN market_stores s ON s.id = o.store_id WHERE ${where.join(' AND ')}`;
        const total = await db.get(`SELECT COUNT(*) AS c ${from}`, params);
        const items = await db.all(
            `SELECT o.*, s.name AS store_name, s.avatar AS store_avatar,
                    (SELECT GROUP_CONCAT(title_snapshot, '、') FROM market_order_items WHERE order_id = o.id) AS items_title
             ${from} ORDER BY o.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        res.json({ ok: true, total: total.c, page, limit, items, statusLabel: market.ORDER_STATUS_LABEL });
    } catch (e) { fail(res, e, '加载订单失败'); }
});

/** 订单详情（买家 / 店主 / 管理员） */
router.get('/orders/:id', authMiddleware, async (req, res) => {
    try {
        const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ error: '订单不存在' });
        const store = await db.get('SELECT id, name, owner_id, avatar FROM market_stores WHERE id = ?', [order.store_id]);
        const isBuyer = Number(order.buyer_id) === Number(req.userId);
        const isOwner = store && Number(store.owner_id) === Number(req.userId);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!isBuyer && !isOwner && !isAdmin) return res.status(403).json({ error: '无权查看该订单' });
        const [items, code, refunds, dispute, review] = await Promise.all([
            db.all('SELECT * FROM market_order_items WHERE order_id = ?', [order.id]),
            db.get('SELECT used_at, used_by, expires_at, code_tail FROM market_verify_codes WHERE order_id = ?', [order.id]),
            db.all('SELECT id, amount, reason, status, handle_note, created_at, handled_at FROM market_refunds WHERE order_id = ?', [order.id]),
            db.get('SELECT * FROM market_disputes WHERE order_id = ? ORDER BY id DESC LIMIT 1', [order.id]),
            db.get('SELECT id, rating, content FROM market_reviews WHERE order_id = ?', [order.id])
        ]);
        res.json({
            ok: true,
            order, items, store, refunds, dispute, review,
            verify: code ? { used: !!code.used_at, expires_at: code.expires_at, tail: code.code_tail } : null,
            role: isBuyer ? 'buyer' : isOwner ? 'owner' : 'admin',
            statusLabel: market.ORDER_STATUS_LABEL
        });
    } catch (e) { fail(res, e, '加载订单失败'); }
});

/** 买家重新生成核销码（原码作废；未核销才可） */
router.post('/orders/:id/regen-code', authMiddleware, async (req, res) => {
    try {
        const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ error: '订单不存在' });
        if (Number(order.buyer_id) !== Number(req.userId)) return res.status(403).json({ error: '只能操作自己的订单' });
        if (order.status !== 'paid') return res.status(409).json({ error: '订单当前状态不能重新生成核销码' });
        const cfg = await market.getConfig();
        const code = market.generateVerifyCode();
        await db.run('UPDATE market_verify_codes SET code_hash = ?, code_tail = ?, expires_at = ?, failed_attempts = 0 WHERE order_id = ?',
            [market.hashCode(code), code.slice(-4), market.addDays(market.now(), Math.max(1, Math.ceil((cfg.verifyCodeTtlHours || 72) / 24))), order.id]);
        await market.audit(req.userId, 'verify_code_regen', 'order', order.id, null, null, '买家重新生成核销码');
        res.json({ ok: true, verify_code: code, notice: '旧核销码已作废，新码只显示这一次' });
    } catch (e) { fail(res, e, '重新生成核销码失败'); }
});

/** 买家确认收货 → 结算 */
router.post('/orders/:id/confirm', authMiddleware, async (req, res) => {
    try {
        const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ error: '订单不存在' });
        if (Number(order.buyer_id) !== Number(req.userId)) return res.status(403).json({ error: '只能确认自己的订单' });
        const out = await settle.settleOrder(order.id, req.userId, '买家确认收货');
        res.json({ ok: true, order: out.order, already: !!out.already });
    } catch (e) { fail(res, e, '确认收货失败'); }
});

/** 买家取消（未核销） */
router.post('/orders/:id/cancel', authMiddleware, async (req, res) => {
    try {
        const order = await settle.cancelOrder(req.params.id, req.userId, String(req.body?.reason || '').slice(0, 200));
        res.json({ ok: true, order });
    } catch (e) { fail(res, e, '取消订单失败'); }
});

/** 买家申请退款（进入退款处理中，等商家/管理员处理） */
router.post('/orders/:id/refund', authMiddleware, async (req, res) => {
    try {
        const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ error: '订单不存在' });
        if (Number(order.buyer_id) !== Number(req.userId)) return res.status(403).json({ error: '只能为自己的订单申请退款' });
        if (!['paid', 'delivered', 'awaiting_confirm'].includes(order.status)) {
            return res.status(409).json({ error: `订单当前「${market.ORDER_STATUS_LABEL[order.status]}」，不能申请退款` });
        }
        const reason = String(req.body?.reason || '').slice(0, 300);
        const r = await db.run(
            `INSERT INTO market_refunds (order_id, buyer_id, store_id, amount, reason, status, idem_key, created_at)
             VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
            [order.id, req.userId, order.store_id, market.money(order.buyer_pay), reason, `refund-req:${order.id}`, market.now()]
        );
        await db.run(`UPDATE market_orders SET status = 'refunding', updated_at = ? WHERE id = ? AND status IN ('paid','delivered','awaiting_confirm')`, [market.now(), order.id]);
        const store = await db.get('SELECT owner_id, name FROM market_stores WHERE id = ?', [order.store_id]);
        if (store) {
            await notify.emit({
                eventKey: `refund_req:${r.id}`, eventType: 'order_refund_request',
                userId: store.owner_id, storeId: order.store_id, orderId: order.id,
                payload: {
                    title: '收到退款申请',
                    content: `订单 ${order.order_no} 买家申请退款 ${order.buyer_pay} 贡献点${reason ? `（${reason}）` : ''}，请到商家后台处理。`,
                    url: '/market/merchant', rows: [['订单号', order.order_no], ['金额', `${order.buyer_pay} 贡献点`]]
                }
            });
        }
        res.status(201).json({ ok: true, refund: await db.get('SELECT * FROM market_refunds WHERE id = ?', [r.id]) });
    } catch (e) { fail(res, e, '申请退款失败'); }
});

/** 发起争议 */
router.post('/orders/:id/dispute', authMiddleware, async (req, res) => {
    try {
        const d = await settle.openDispute(req.params.id, req.userId, String(req.body?.reason || '').slice(0, 500));
        res.status(201).json({ ok: true, dispute: d });
    } catch (e) { fail(res, e, '发起争议失败'); }
});

/** 评价（一单一评；必须是该订单买家且订单已完成） */
router.post('/reviews', authMiddleware, async (req, res) => {
    try {
        const orderId = Number(req.body?.order_id);
        const rating = Math.max(1, Math.min(5, Number(req.body?.rating) || 5));
        const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [orderId]);
        if (!order) return res.status(404).json({ error: '订单不存在' });
        if (Number(order.buyer_id) !== Number(req.userId)) return res.status(403).json({ error: '只有买家可以评价' });
        if (order.status !== 'settled') return res.status(409).json({ error: '订单完成后才能评价' });
        const exist = await db.get('SELECT id FROM market_reviews WHERE order_id = ?', [orderId]);
        if (exist) return res.status(409).json({ error: '该订单已经评价过了' });
        const items = await db.all('SELECT product_id FROM market_order_items WHERE order_id = ? LIMIT 1', [orderId]);
        const content = String(req.body?.content || '').slice(0, 1000);
        const r = await db.run(
            `INSERT INTO market_reviews (order_id, store_id, product_id, buyer_id, rating, content, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [orderId, order.store_id, items[0] ? items[0].product_id : 0, req.userId, rating, content, market.now()]
        );
        await db.run('UPDATE market_stores SET rating_sum = rating_sum + ?, rating_count = rating_count + 1, updated_at = ? WHERE id = ?',
            [rating, market.now(), order.store_id]);
        const store = await db.get('SELECT owner_id, name FROM market_stores WHERE id = ?', [order.store_id]);
        if (store) {
            await notify.emit({
                eventKey: `review:${r.id}`, eventType: 'review_new',
                userId: store.owner_id, storeId: order.store_id, orderId,
                payload: { title: '收到新评价', content: `店铺「${store.name}」收到 ${rating} 星评价。`, url: '/market/merchant', noMail: true }
            });
        }
        res.status(201).json({ ok: true, review: await db.get('SELECT * FROM market_reviews WHERE id = ?', [r.id]) });
    } catch (e) { fail(res, e, '提交评价失败'); }
});

/** 收藏 */
router.get('/favorites', authMiddleware, async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM market_favorites WHERE user_id = ? ORDER BY id DESC LIMIT 200', [req.userId]);
        const stores = [], products = [];
        for (const f of rows) {
            if (f.target_type === 'store') {
                const s = await db.get('SELECT id, name, cover, intro, status FROM market_stores WHERE id = ?', [f.target_id]);
                if (s) stores.push(s);
            } else {
                const p = await db.get('SELECT id, title, cover, price, stock, status, store_id FROM market_products WHERE id = ?', [f.target_id]);
                if (p) products.push(p);
            }
        }
        res.json({ ok: true, stores, products });
    } catch (e) { fail(res, e, '加载收藏失败'); }
});
router.post('/favorites', authMiddleware, async (req, res) => {
    try {
        const type = req.body?.target_type === 'store' ? 'store' : 'product';
        const id = Number(req.body?.target_id);
        if (!id) return res.status(400).json({ error: '缺少目标 ID' });
        const table = type === 'store' ? 'market_stores' : 'market_products';
        const target = await db.get(`SELECT id FROM ${table} WHERE id = ?`, [id]);
        if (!target) return res.status(404).json({ error: '目标不存在' });
        await db.run('INSERT OR IGNORE INTO market_favorites (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)',
            [req.userId, type, id, market.now()]);
        res.status(201).json({ ok: true, favorited: true });
    } catch (e) { fail(res, e, '收藏失败'); }
});
router.delete('/favorites/:type/:id', authMiddleware, async (req, res) => {
    try {
        const type = req.params.type === 'store' ? 'store' : 'product';
        await db.run('DELETE FROM market_favorites WHERE user_id = ? AND target_type = ? AND target_id = ?',
            [req.userId, type, Number(req.params.id)]);
        res.json({ ok: true, favorited: false });
    } catch (e) { fail(res, e, '取消收藏失败'); }
});

/* ==================================================================
 * 商家
 * ================================================================== */

async function ownerStore(req, res, needStatus = null) {
    // 店铺 ID 可能来自路径（:id）、请求体或查询串（POST /merchant/products 用的是 body.store_id）
    const raw = req.params.id || req.params.storeId || (req.body && req.body.store_id) || req.query.store_id;
    const store = raw ? await db.get('SELECT * FROM market_stores WHERE id = ?', [Number(raw)]) : null;
    if (!store) { res.status(404).json({ error: '店铺不存在' }); return null; }
    const isAdmin = Number(req.userLevel) >= 1;
    if (Number(store.owner_id) !== Number(req.userId) && !isAdmin) { res.status(403).json({ error: '无权管理该店铺' }); return null; }
    if (needStatus && !needStatus.includes(store.status)) {
        res.status(409).json({ error: `店铺当前「${market.STORE_STATUS_LABEL[store.status] || store.status}」，不能执行该操作` });
        return null;
    }
    return store;
}

/** 申请开店（含开店费；首店可免） */
router.post('/merchant/stores', authMiddleware, async (req, res) => {
    try {
        const cfg = await market.getConfig();
        const name = String(req.body?.name || '').trim();
        if (name.length < 2 || name.length > 30) return res.status(400).json({ error: '店铺名需 2–30 字' });
        const mine = await db.all('SELECT id, status FROM market_stores WHERE owner_id = ?', [req.userId]);
        const active = mine.filter(s => !['closed', 'rejected'].includes(s.status));
        if (active.length >= Math.max(1, cfg.maxOpenStoresPerUser)) {
            return res.status(409).json({ error: `最多同时拥有 ${cfg.maxOpenStoresPerUser} 家店铺` });
        }
        const dupName = await db.get('SELECT id FROM market_stores WHERE name = ? AND status != ?', [name, 'closed']);
        if (dupName) return res.status(409).json({ error: '店铺名已被占用' });

        const fee = (cfg.openFeeEnabled && !(cfg.openFeeFirstFree && mine.length === 0)) ? market.money(cfg.openFee) : 0;
        if (fee > 0) {
            const u = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
            if (market.money(u.contribution) < fee) return res.status(400).json({ error: `开店费 ${fee} 贡献点不足（现有 ${market.money(u.contribution)}）` });
        }
        const slug = await market.uniqueStoreSlug(req.body?.slug || name);
        const idem = `open:${req.userId}:${Date.now()}`;
        let storeId = null;
        await db.transaction(async () => {
            const r = await db.run(
                `INSERT INTO market_stores (owner_id, name, slug, intro, category_id, tags, cover, avatar, status, open_fee_paid, cycle_days, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.userId, name, slug, String(req.body?.intro || '').slice(0, 500), req.body?.category_id ? Number(req.body.category_id) : null,
                    JSON.stringify(Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 8) : []),
                    String(req.body?.cover || '').slice(0, 500), String(req.body?.avatar || '').slice(0, 500),
                    cfg.storeReviewRequired === false ? 'active' : 'pending', fee, market.cycleDaysOf(cfg), market.now(), market.now()]
            );
            storeId = r.id;
            if (fee > 0) {
                // 开店费：扣店主余额 + 记公会收入（钱退出流通，不转入任何公会余额账号）
                await market.chargeFee({
                    userId: req.userId, amount: fee, kind: 'open_fee', type: 'market_fee', refId: storeId,
                    storeId, note: `开店费「${name}」`, idemKey: `fin:${idem}`
                });
                await db.run(
                    `INSERT INTO market_fee_ledger (store_id, owner_id, kind, amount, status, idem_key, note, created_at)
                     VALUES (?, ?, 'open', ?, 'paid', ?, '开店费', ?)`, [storeId, req.userId, fee, idem, market.now()]);
            }
            if (cfg.storeReviewRequired === false) {
                const to = market.addDays(market.now(), market.cycleDaysOf(cfg));
                await db.run('UPDATE market_stores SET expire_at = ?, next_fee_at = ?, reviewed_at = ? WHERE id = ?', [to, to, market.now(), storeId]);
            }
        });
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [storeId]);
        // 商铺信息纳入档案
        await market.writeArchive({
            kind: 'store', refType: 'store', refId: storeId,
            title: `商铺档案 #${storeId} ${name}`,
            summary: `店主 #${req.userId}；分类 ${store.category_id || '未分类'}；开店费 ${fee}；状态 ${store.status}`,
            payload: { store_id: storeId, owner_id: req.userId, name, slug, intro: store.intro, tags: store.tags, fee, created_at: store.created_at },
            operatorId: req.userId
        });
        await notify.emit({
            eventKey: `store_applied:${storeId}`, eventType: 'store_applied',
            userId: req.userId, storeId,
            payload: {
                title: '店铺申请已提交',
                content: `「${name}」已提交申请${fee > 0 ? `，已扣开店费 ${fee} 贡献点` : '（免开店费）'}，等待管理员审核。`,
                url: '/market/merchant', rows: [['店铺', name], ['开店费', `${fee} 贡献点`]]
            }
        });
        // 通知管理员
        const admins = await db.all('SELECT id FROM users WHERE level >= 1');
        for (const a of admins) {
            await notify.emit({
                eventKey: `store_applied_admin:${storeId}:${a.id}`, eventType: 'store_applied',
                userId: a.id, storeId, channels: 'inapp,realtime',
                payload: { title: '新的店铺申请', content: `「${name}」（店主 #${req.userId}）等待审核`, url: '/market/admin' }
            });
        }
        res.status(201).json({ ok: true, store, fee, message: fee > 0 ? `申请已提交，扣除开店费 ${fee} 贡献点` : '申请已提交（免开店费）' });
    } catch (e) { fail(res, e, '申请开店失败'); }
});

/** 我的店铺 */
router.get('/merchant/stores', authMiddleware, async (req, res) => {
    try {
        const stores = await db.all('SELECT * FROM market_stores WHERE owner_id = ? ORDER BY id DESC', [req.userId]);
        const cfg = await market.getConfig();
        res.json({ ok: true, stores, fees: { renewFee: cfg.renewFee, cycleDays: market.cycleDaysOf(cfg), graceDays: cfg.graceDays } });
    } catch (e) { fail(res, e, '加载我的店铺失败'); }
});

/** 编辑店铺资料/公告 */
router.put('/merchant/stores/:id', authMiddleware, async (req, res) => {
    try {
        const store = await ownerStore(req, res, ['pending', 'active', 'grace', 'paused', 'suspended']);
        if (!store) return;
        const b = req.body || {};
        const before = { name: store.name, intro: store.intro, notice: store.notice, cover: store.cover, avatar: store.avatar, category_id: store.category_id, tags: store.tags };
        const name = b.name !== undefined ? String(b.name).trim().slice(0, 30) : store.name;
        if (name.length < 2) return res.status(400).json({ error: '店铺名至少 2 字' });
        await db.run(
            `UPDATE market_stores SET name = ?, intro = ?, notice = ?, cover = ?, avatar = ?, category_id = ?, tags = ?, updated_at = ? WHERE id = ?`,
            [name,
                b.intro !== undefined ? String(b.intro).slice(0, 500) : store.intro,
                b.notice !== undefined ? String(b.notice).slice(0, 1000) : store.notice,
                b.cover !== undefined ? String(b.cover).slice(0, 500) : store.cover,
                b.avatar !== undefined ? String(b.avatar).slice(0, 500) : store.avatar,
                b.category_id !== undefined ? (b.category_id ? Number(b.category_id) : null) : store.category_id,
                b.tags !== undefined ? JSON.stringify(Array.isArray(b.tags) ? b.tags.slice(0, 8) : []) : store.tags,
                market.now(), store.id]
        );
        const after = await db.get('SELECT * FROM market_stores WHERE id = ?', [store.id]);
        await market.audit(req.userId, 'store_update', 'store', store.id, before, { name: after.name, intro: after.intro, notice: after.notice, cover: after.cover, avatar: after.avatar, category_id: after.category_id, tags: after.tags }, '');
        await market.writeArchive({
            kind: 'store', refType: 'store', refId: store.id,
            title: `商铺档案 #${store.id} ${after.name}`,
            summary: `店主 #${after.owner_id}；状态 ${after.status}；最近更新 ${after.updated_at}`,
            payload: { store_id: after.id, owner_id: after.owner_id, name: after.name, slug: after.slug, intro: after.intro, tags: after.tags, category_id: after.category_id, status: after.status, open_fee_paid: after.open_fee_paid, expire_at: after.expire_at, updated_at: after.updated_at },
            operatorId: req.userId
        });
        res.json({ ok: true, store: after });
    } catch (e) { fail(res, e, '保存店铺失败'); }
});

/** 手动续费（幂等：同一到期周期只扣一次） */
router.post('/merchant/stores/:id/renew', authMiddleware, async (req, res) => {
    try {
        const store = await ownerStore(req, res, ['active', 'grace', 'suspended', 'paused']);
        if (!store) return;
        const cfg = await market.getConfig();
        if (!cfg.renewFeeEnabled) return res.status(400).json({ error: '续期费当前未启用' });
        const days = market.cycleDaysOf(cfg);
        const fee = market.money(cfg.renewFee);
        const periodFrom = store.next_fee_at || store.expire_at || market.now();
        const periodTo = market.addDays(periodFrom < market.now() ? market.now() : periodFrom, days);
        const idem = `renew-manual:${store.id}:${store.expire_at || 'none'}:${periodTo}`;
        const done = await db.get('SELECT id FROM market_fee_ledger WHERE idem_key = ?', [idem]);
        if (done) return res.json({ ok: true, already: true, message: '该周期已续费过', store });
        const u = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        if (market.money(u.contribution) < fee) return res.status(400).json({ error: `贡献点不足（续期费 ${fee}，现有 ${market.money(u.contribution)}）` });
        await db.transaction(async () => {
            // 续期费：扣店主余额 + 记公会收入（钱退出流通，不转入任何公会余额账号）
            await market.chargeFee({
                userId: req.userId, amount: fee, kind: 'renew_fee', type: 'market_fee', refId: store.id,
                storeId: store.id, note: `店铺续期费「${store.name}」`, idemKey: `fin:${idem}`
            });
            await db.run(
                `INSERT INTO market_fee_ledger (store_id, owner_id, kind, amount, status, period_from, period_to, idem_key, operator_id, note, created_at)
                 VALUES (?, ?, 'renew', ?, 'paid', ?, ?, ?, ?, '手动续费', ?)`,
                [store.id, req.userId, fee, periodFrom, periodTo, idem, req.userId, market.now()]);
            await db.run(
                `UPDATE market_stores SET expire_at = ?, next_fee_at = ?, last_fee_at = ?, grace_until = NULL, fee_fail_count = 0,
                    status = CASE WHEN status IN ('grace','suspended') THEN 'active' ELSE status END, auto_paused = 0, updated_at = ? WHERE id = ?`,
                [periodTo, periodTo, market.now(), market.now(), store.id]);
        });
        const back = await jobs.resumeProductsOfStore(store.id);
        const after = await db.get('SELECT * FROM market_stores WHERE id = ?', [store.id]);
        await notify.emit({
            eventKey: `renew_manual:${store.id}:${periodTo}`, eventType: 'store_renewed',
            userId: req.userId, storeId: store.id,
            payload: {
                title: '续费成功，店铺已恢复营业',
                content: `「${store.name}」已续期至 ${periodTo}，扣费 ${fee} 贡献点${back ? `，恢复 ${back} 件因欠费下架的商品` : ''}。`,
                url: '/market/merchant', rows: [['续期至', periodTo], ['扣费', `${fee} 贡献点`]]
            }
        });
        res.json({ ok: true, store: after, fee, periodTo, resumed: back });
    } catch (e) { fail(res, e, '续费失败'); }
});

/** 店主暂停/恢复营业（不覆盖管理员的封禁状态） */
router.post('/merchant/stores/:id/status', authMiddleware, async (req, res) => {
    try {
        const store = await ownerStore(req, res);
        if (!store) return;
        const want = String(req.body?.status || '');
        if (!['paused', 'active'].includes(want)) return res.status(400).json({ error: '只能暂停或恢复营业' });
        if (store.status === 'suspended' || store.status === 'closed' || store.status === 'rejected') {
            return res.status(409).json({ error: `店铺当前「${market.STORE_STATUS_LABEL[store.status]}」，请先续费或联系管理员` });
        }
        await db.run('UPDATE market_stores SET status = ?, updated_at = ? WHERE id = ?', [want, market.now(), store.id]);
        res.json({ ok: true, store: await db.get('SELECT * FROM market_stores WHERE id = ?', [store.id]) });
    } catch (e) { fail(res, e, '变更营业状态失败'); }
});

/* ---- 店铺位置 ---- */
router.post('/merchant/stores/:id/locations', authMiddleware, async (req, res) => {
    try {
        const store = await ownerStore(req, res);
        if (!store) return;
        const b = req.body || {};
        const dims = ['overworld', 'nether', 'end', 'custom'];
        const dimension = dims.includes(b.dimension) ? b.dimension : 'overworld';
        const r = await db.run(
            `INSERT INTO market_store_locations (store_id, server_key, server_name, dimension, dimension_custom, x, y, z, label, note, is_public, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [store.id, String(b.server_key || 's115').slice(0, 40), String(b.server_name || '').slice(0, 60), dimension,
                String(b.dimension_custom || '').slice(0, 40), Number(b.x) || 0, Number(b.y) || 64, Number(b.z) || 0,
                String(b.label || '').slice(0, 40), String(b.note || '').slice(0, 200), b.is_public === false ? 0 : 1, market.now(), market.now()]
        );
        res.status(201).json({ ok: true, location: await db.get('SELECT * FROM market_store_locations WHERE id = ?', [r.id]) });
    } catch (e) { fail(res, e, '添加位置失败'); }
});
router.put('/merchant/locations/:id', authMiddleware, async (req, res) => {
    try {
        const loc = await db.get('SELECT * FROM market_store_locations WHERE id = ?', [req.params.id]);
        if (!loc) return res.status(404).json({ error: '位置不存在' });
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [loc.store_id]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权修改' });
        const b = req.body || {};
        await db.run(
            `UPDATE market_store_locations SET server_key = ?, server_name = ?, dimension = ?, dimension_custom = ?, x = ?, y = ?, z = ?,
                label = ?, note = ?, is_public = ?, updated_at = ? WHERE id = ?`,
            [b.server_key !== undefined ? String(b.server_key).slice(0, 40) : loc.server_key,
                b.server_name !== undefined ? String(b.server_name).slice(0, 60) : loc.server_name,
                b.dimension !== undefined && market.DIMENSIONS[b.dimension] ? b.dimension : loc.dimension,
                b.dimension_custom !== undefined ? String(b.dimension_custom).slice(0, 40) : loc.dimension_custom,
                b.x !== undefined ? Number(b.x) : loc.x, b.y !== undefined ? Number(b.y) : loc.y, b.z !== undefined ? Number(b.z) : loc.z,
                b.label !== undefined ? String(b.label).slice(0, 40) : loc.label,
                b.note !== undefined ? String(b.note).slice(0, 200) : loc.note,
                b.is_public !== undefined ? (b.is_public ? 1 : 0) : loc.is_public,
                market.now(), loc.id]
        );
        res.json({ ok: true, location: await db.get('SELECT * FROM market_store_locations WHERE id = ?', [loc.id]) });
    } catch (e) { fail(res, e, '保存位置失败'); }
});
router.delete('/merchant/locations/:id', authMiddleware, async (req, res) => {
    try {
        const loc = await db.get('SELECT * FROM market_store_locations WHERE id = ?', [req.params.id]);
        if (!loc) return res.json({ ok: true });
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [loc.store_id]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权删除' });
        await db.run('DELETE FROM market_store_locations WHERE id = ?', [loc.id]);
        res.json({ ok: true });
    } catch (e) { fail(res, e, '删除位置失败'); }
});

/* ---- 商品 ---- */
router.get('/merchant/products', authMiddleware, async (req, res) => {
    try {
        const storeId = Number(req.query.store_id);
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [storeId]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权查看' });
        const items = await db.all('SELECT * FROM market_products WHERE store_id = ? ORDER BY id DESC', [storeId]);
        for (const p of items) {
            p.images = (await db.all('SELECT url FROM market_product_images WHERE product_id = ? ORDER BY sort_order, id', [p.id])).map(x => x.url);
            p.tags = safeJson(p.tags, []);
        }
        res.json({ ok: true, items });
    } catch (e) { fail(res, e, '加载商品失败'); }
});

router.post('/merchant/products', authMiddleware, async (req, res) => {
    try {
        const store = await ownerStore(req, res, ['active', 'grace', 'paused']);
        if (!store) return;
        const cfg = await market.getConfig();
        const b = req.body || {};
        const title = String(b.title || '').trim();
        if (title.length < 2 || title.length > 60) return res.status(400).json({ error: '商品标题需 2–60 字' });
        const price = market.money(b.price);
        if (!(price > 0)) return res.status(400).json({ error: '价格必须大于 0' });
        const cnt = await db.get(`SELECT COUNT(*) AS c FROM market_products WHERE store_id = ? AND status != 'removed'`, [store.id]);
        if (Number(cnt.c) >= Math.max(1, cfg.maxProductsPerStore)) return res.status(409).json({ error: `每店最多 ${cfg.maxProductsPerStore} 件商品` });
        const desc = wiki.sanitizeContent(String(b.description || ''));
        const r = await db.run(
            `INSERT INTO market_products (store_id, title, summary, description, category_id, tags, cover, price, stock, per_order_limit, per_user_limit, spec, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [store.id, title, String(b.summary || '').slice(0, 200), desc,
                b.category_id ? Number(b.category_id) : null,
                JSON.stringify(Array.isArray(b.tags) ? b.tags.slice(0, 8) : []),
                String(b.cover || '').slice(0, 500), price, Math.max(0, Number(b.stock) || 0),
                Math.max(0, Number(b.per_order_limit) || 0), Math.max(0, Number(b.per_user_limit) || 0),
                String(b.spec || '').slice(0, 100), b.status === 'on' ? 'on' : 'draft', market.now(), market.now()]
        );
        const images = Array.isArray(b.images) ? b.images.slice(0, 8) : [];
        for (let i = 0; i < images.length; i++) {
            if (!images[i]) continue;
            await db.run('INSERT INTO market_product_images (product_id, url, sort_order, created_at) VALUES (?, ?, ?, ?)',
                [r.id, String(images[i]).slice(0, 500), i, market.now()]);
        }
        res.status(201).json({ ok: true, product: await db.get('SELECT * FROM market_products WHERE id = ?', [r.id]) });
    } catch (e) { fail(res, e, '创建商品失败'); }
});

router.put('/merchant/products/:id', authMiddleware, async (req, res) => {
    try {
        const p = await db.get('SELECT * FROM market_products WHERE id = ?', [req.params.id]);
        if (!p) return res.status(404).json({ error: '商品不存在' });
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [p.store_id]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权修改' });
        const b = req.body || {};
        const before = { title: p.title, price: p.price, stock: p.stock, status: p.status, per_user_limit: p.per_user_limit };
        const price = b.price !== undefined ? market.money(b.price) : p.price;
        if (!(price > 0)) return res.status(400).json({ error: '价格必须大于 0' });
        await db.transaction(async () => {
            await db.run(
                `UPDATE market_products SET title = ?, summary = ?, description = ?, category_id = ?, tags = ?, cover = ?, price = ?,
                    stock = ?, per_order_limit = ?, per_user_limit = ?, spec = ?, status = ?, off_reason = ?, updated_at = ? WHERE id = ?`,
                [b.title !== undefined ? String(b.title).trim().slice(0, 60) : p.title,
                    b.summary !== undefined ? String(b.summary).slice(0, 200) : p.summary,
                    b.description !== undefined ? wiki.sanitizeContent(String(b.description)) : p.description,
                    b.category_id !== undefined ? (b.category_id ? Number(b.category_id) : null) : p.category_id,
                    b.tags !== undefined ? JSON.stringify(Array.isArray(b.tags) ? b.tags.slice(0, 8) : []) : p.tags,
                    b.cover !== undefined ? String(b.cover).slice(0, 500) : p.cover,
                    price,
                    b.stock !== undefined ? Math.max(0, Number(b.stock)) : p.stock,
                    b.per_order_limit !== undefined ? Math.max(0, Number(b.per_order_limit)) : p.per_order_limit,
                    b.per_user_limit !== undefined ? Math.max(0, Number(b.per_user_limit)) : p.per_user_limit,
                    b.spec !== undefined ? String(b.spec).slice(0, 100) : p.spec,
                    b.status !== undefined && ['draft', 'on', 'off'].includes(b.status) ? b.status : p.status,
                    b.status === 'on' ? '' : p.off_reason,
                    market.now(), p.id]
            );
            if (Array.isArray(b.images)) {
                await db.run('DELETE FROM market_product_images WHERE product_id = ?', [p.id]);
                const imgs = b.images.slice(0, 8);
                for (let i = 0; i < imgs.length; i++) {
                    if (!imgs[i]) continue;
                    await db.run('INSERT INTO market_product_images (product_id, url, sort_order, created_at) VALUES (?, ?, ?, ?)',
                        [p.id, String(imgs[i]).slice(0, 500), i, market.now()]);
                }
            }
        });
        const after = await db.get('SELECT * FROM market_products WHERE id = ?', [p.id]);
        await market.audit(req.userId, 'product_update', 'product', p.id, before, { title: after.title, price: after.price, stock: after.stock, status: after.status }, '');
        res.json({ ok: true, product: after });
    } catch (e) { fail(res, e, '保存商品失败'); }
});

router.delete('/merchant/products/:id', authMiddleware, async (req, res) => {
    try {
        const p = await db.get('SELECT * FROM market_products WHERE id = ?', [req.params.id]);
        if (!p) return res.json({ ok: true });
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [p.store_id]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权删除' });
        // 软删：订单快照不依赖商品行，历史订单不受影响
        await db.run(`UPDATE market_products SET status = 'removed', updated_at = ? WHERE id = ?`, [market.now(), p.id]);
        await market.audit(req.userId, 'product_remove', 'product', p.id, { status: p.status }, { status: 'removed' }, String(req.body?.reason || ''));
        res.json({ ok: true });
    } catch (e) { fail(res, e, '删除商品失败'); }
});

/* ---- 商家订单 / 核销 / 履约 / 退款处理 ---- */
router.get('/merchant/orders', authMiddleware, async (req, res) => {
    try {
        const storeId = Number(req.query.store_id);
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [storeId]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权查看' });
        const { limit, page, offset } = pageParams(req.query);
        const where = ['o.store_id = ?'];
        const params = [storeId];
        if (req.query.status) { where.push('o.status = ?'); params.push(String(req.query.status)); }
        const from = `FROM market_orders o LEFT JOIN users u ON u.id = o.buyer_id WHERE ${where.join(' AND ')}`;
        const total = await db.get(`SELECT COUNT(*) AS c ${from}`, params);
        const items = await db.all(
            `SELECT o.*, u.nickname AS buyer_nickname, u.username AS buyer_username,
                    (SELECT GROUP_CONCAT(title_snapshot, '、') FROM market_order_items WHERE order_id = o.id) AS items_title,
                    (SELECT code_tail FROM market_verify_codes WHERE order_id = o.id) AS code_tail,
                    (SELECT used_at FROM market_verify_codes WHERE order_id = o.id) AS code_used_at
             ${from} ORDER BY o.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        res.json({ ok: true, total: total.c, page, limit, items, statusLabel: market.ORDER_STATUS_LABEL });
    } catch (e) { fail(res, e, '加载店铺订单失败'); }
});

/** 核销（按核销码） */
router.post('/merchant/verify', authMiddleware, async (req, res) => {
    try {
        const storeId = Number(req.body?.store_id);
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [storeId]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权核销该店铺订单' });
        const out = await settle.verifyByCode({ storeId, code: String(req.body?.code || ''), operatorId: req.userId });
        res.json({ ok: true, already: out.already, order: out.order, message: out.already ? '该订单此前已核销（未重复处理）' : '核销成功，请在游戏内交付' });
    } catch (e) { fail(res, e, '核销失败'); }
});

/** 标记已交付 → 等买家确认 */
router.post('/merchant/orders/:id/deliver', authMiddleware, async (req, res) => {
    try {
        const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ error: '订单不存在' });
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [order.store_id]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权操作' });
        const out = await settle.markDelivered(order.id, req.userId, String(req.body?.note || '').slice(0, 200));
        res.json({ ok: true, order: out });
    } catch (e) { fail(res, e, '标记交付失败'); }
});

/** 商家处理退款申请 */
router.post('/merchant/refunds/:id/:action', authMiddleware, async (req, res) => {
    try {
        const r = await db.get('SELECT * FROM market_refunds WHERE id = ?', [req.params.id]);
        if (!r) return res.status(404).json({ error: '退款申请不存在' });
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [r.store_id]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权处理' });
        if (r.status !== 'pending') return res.status(409).json({ error: '该申请已处理' });
        const action = req.params.action;
        if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '未知操作' });
        if (action === 'approve') {
            const out = await settle.refundOrder(r.order_id, { amount: r.amount, operatorId: req.userId, reason: r.reason || '商家同意退款' });
            res.json({ ok: true, refunded: out.refund || out.already ? r.amount : r.amount });
        } else {
            await db.transaction(async () => {
                await db.run(`UPDATE market_refunds SET status = 'rejected', handled_by = ?, handle_note = ?, handled_at = ? WHERE id = ?`,
                    [req.userId, String(req.body?.note || '').slice(0, 300), market.now(), r.id]);
                await db.run(`UPDATE market_orders SET status = 'awaiting_confirm', updated_at = ? WHERE id = ? AND status = 'refunding'`,
                    [market.now(), r.order_id]);
            });
            await notify.emit({
                eventKey: `refund_rejected:${r.id}`, eventType: 'order_refunded',
                userId: r.buyer_id, storeId: r.store_id, orderId: r.order_id,
                payload: { title: '退款申请被拒绝', content: `订单退款申请未通过：${req.body?.note || '商家已拒绝'}。如有异议可在订单页发起争议。`, url: '/market/orders' }
            });
            res.json({ ok: true, rejected: true });
        }
    } catch (e) { fail(res, e, '处理退款失败'); }
});

/** 商家经营账 + 档案 */
router.get('/merchant/finance', authMiddleware, async (req, res) => {
    try {
        const storeId = Number(req.query.store_id);
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [storeId]);
        const isAdmin = Number(req.userLevel) >= 1;
        if (!store || (Number(store.owner_id) !== Number(req.userId) && !isAdmin)) return res.status(403).json({ error: '无权查看' });
        const [agg, pending, fees, refunds, monthly, archives] = await Promise.all([
            db.get(`SELECT COUNT(*) AS orders,
                        COALESCE(SUM(CASE WHEN status = 'settled' THEN tax_base ELSE 0 END),0) AS gmv,
                        COALESCE(SUM(CASE WHEN status = 'settled' THEN merchant_income ELSE 0 END),0) AS income,
                        COALESCE(SUM(CASE WHEN status = 'settled' THEN tax_amount ELSE 0 END),0) AS tax,
                        COALESCE(SUM(CASE WHEN status = 'settled' THEN buyer_pay ELSE 0 END),0) AS buyer_pay
                   FROM market_orders WHERE store_id = ?`, [storeId]),
            db.get(`SELECT COALESCE(SUM(buyer_pay),0) AS amount, COUNT(*) AS cnt FROM market_orders
                     WHERE store_id = ? AND status IN ('paid','delivered','awaiting_confirm','disputed','refunding')`, [storeId]),
            db.get(`SELECT COALESCE(SUM(amount),0) AS paid FROM market_fee_ledger WHERE store_id = ? AND status = 'paid'`, [storeId]),
            db.get(`SELECT COALESCE(SUM(amount),0) AS amount, COUNT(*) AS cnt FROM market_refunds WHERE store_id = ? AND status = 'done'`, [storeId]),
            db.all(`SELECT substr(COALESCE(settled_at, created_at),1,7) AS ym,
                           COUNT(*) AS cnt, COALESCE(SUM(merchant_income),0) AS income, COALESCE(SUM(tax_amount),0) AS tax
                      FROM market_orders WHERE store_id = ? AND status = 'settled'
                     GROUP BY ym ORDER BY ym DESC LIMIT 12`, [storeId]),
            db.all(`SELECT archive_no, title, summary, created_at FROM market_archives WHERE kind = 'store' AND ref_id = ? ORDER BY id DESC LIMIT 10`, [storeId])
        ]);
        res.json({
            ok: true,
            summary: {
                orders: agg.orders, gmv: market.money(agg.gmv), income: market.money(agg.income), tax: market.money(agg.tax),
                buyerPay: market.money(agg.buyer_pay), pendingSettle: market.money(pending.amount), pendingCount: pending.cnt,
                feesPaid: market.money(fees.paid), refunded: market.money(refunds.amount), refundCount: refunds.cnt
            },
            monthly, archives,
            store: { id: store.id, name: store.name, status: store.status, expire_at: store.expire_at, next_fee_at: store.next_fee_at, grace_until: store.grace_until, sales_count: store.sales_count }
        });
    } catch (e) { fail(res, e, '加载经营账务失败'); }
});

/* ==================================================================
 * 管理员
 * ================================================================== */

router.get('/admin/stores', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { limit, page, offset } = pageParams(req.query);
        const where = [];
        const params = [];
        if (req.query.status) { where.push('s.status = ?'); params.push(String(req.query.status)); }
        if (req.query.keyword) { where.push('s.name LIKE ?'); params.push(`%${req.query.keyword}%`); }
        const from = `FROM market_stores s LEFT JOIN users u ON u.id = s.owner_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
        const total = await db.get(`SELECT COUNT(*) AS c ${from}`, params);
        const items = await db.all(
            `SELECT s.*, u.nickname AS owner_nickname, u.username AS owner_username, u.contribution AS owner_contribution
             ${from} ORDER BY (s.status = 'pending') DESC, s.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        res.json({ ok: true, total: total.c, page, limit, items, statusLabel: market.STORE_STATUS_LABEL });
    } catch (e) { fail(res, e, '加载店铺失败'); }
});

/** 店铺审核 */
router.post('/admin/stores/:id/review', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [req.params.id]);
        if (!store) return res.status(404).json({ error: '店铺不存在' });
        if (store.status !== 'pending') return res.status(409).json({ error: '只有待审核店铺能审核' });
        // 兼容两种写法：action='approve'|'reject'，或 approve=true|false
        const approve = req.body?.action !== undefined
            ? String(req.body.action) === 'approve'
            : req.body?.approve !== false;
        const note = String(req.body?.note || '').slice(0, 300);
        const cfg = await market.getConfig();
        const days = market.cycleDaysOf(cfg);
        await db.transaction(async () => {
            if (approve) {
                const from = market.now();
                const to = market.addDays(from, days);
                await db.run(
                    `UPDATE market_stores SET status = 'active', review_note = ?, reviewed_by = ?, reviewed_at = ?,
                        expire_at = ?, next_fee_at = ?, last_fee_at = ?, updated_at = ? WHERE id = ?`,
                    [note, req.userId, market.now(), to, to, from, market.now(), store.id]);
            } else {
                // 拒绝：退还开店费（若已扣）。退费 = 钱回到申请人余额 + 分户账记一笔 out 冲回
                const paid = market.money(store.open_fee_paid);
                if (paid > 0) {
                    await market.refundFee({
                        userId: store.owner_id, amount: paid, kind: 'refund_fee', type: 'market_refund',
                        refId: store.id, storeId: store.id,
                        note: `开店申请被拒，退还开店费「${store.name}」`,
                        idemKey: `openfee-refund:${store.id}`, operatorId: req.userId
                    });
                    await db.run(`UPDATE market_fee_ledger SET status = 'refunded' WHERE store_id = ? AND kind = 'open'`, [store.id]);
                }
                await db.run(`UPDATE market_stores SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
                    [note, req.userId, market.now(), market.now(), store.id]);
            }
        });
        const after = await db.get('SELECT * FROM market_stores WHERE id = ?', [store.id]);
        await market.audit(req.userId, approve ? 'store_approve' : 'store_reject', 'store', store.id, { status: store.status }, { status: after.status, note }, note);
        await market.writeArchive({
            kind: 'store', refType: 'store', refId: store.id,
            title: `商铺档案 #${store.id} ${after.name}`,
            summary: `${approve ? '审核通过' : '审核拒绝'}（${note || '无理由'}）；状态 ${after.status}；有效期至 ${after.expire_at || '—'}`,
            payload: { store_id: after.id, owner_id: after.owner_id, name: after.name, status: after.status, review_note: note, reviewed_by: req.userId, expire_at: after.expire_at },
            operatorId: req.userId
        });
        await notify.emit({
            eventKey: `store_review:${store.id}:${after.status}:${market.now()}`, eventType: approve ? 'store_approved' : 'store_rejected',
            userId: store.owner_id, storeId: store.id,
            payload: {
                title: approve ? '店铺审核通过' : '店铺审核未通过',
                content: approve ? `「${store.name}」已通过审核，有效期至 ${after.expire_at}。` : `「${store.name}」未通过审核：${note || '未说明原因'}${market.money(store.open_fee_paid) > 0 ? `（已退还开店费 ${market.money(store.open_fee_paid)} 贡献点）` : ''}`,
                url: '/market/merchant',
                rows: [['店铺', store.name], ['状态', market.STORE_STATUS_LABEL[after.status]]]
            }
        });
        res.json({ ok: true, store: after });
    } catch (e) { fail(res, e, '审核店铺失败'); }
});

/** 管理员强制变更店铺状态（暂停/恢复/关闭） */
router.post('/admin/stores/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [req.params.id]);
        if (!store) return res.status(404).json({ error: '店铺不存在' });
        const want = String(req.body?.status || '');
        if (!['active', 'paused', 'suspended', 'closed'].includes(want)) return res.status(400).json({ error: '状态不合法' });
        const note = String(req.body?.note || '').slice(0, 300);
        let off = 0;
        if (want === 'suspended' || want === 'closed') off = await jobs.pauseProductsOfStore(store.id);
        await db.run('UPDATE market_stores SET status = ?, updated_at = ? WHERE id = ?', [want, market.now(), store.id]);
        await market.audit(req.userId, 'store_status', 'store', store.id, { status: store.status }, { status: want, note, offProducts: off }, note);
        await notify.emit({
            eventKey: `store_status:${store.id}:${want}:${market.now()}`, eventType: 'store_status',
            userId: store.owner_id, storeId: store.id,
            payload: {
                title: '店铺状态变更',
                content: `「${store.name}」状态已变更为「${market.STORE_STATUS_LABEL[want]}」${note ? `：${note}` : ''}${off ? `（${off} 件商品已下架）` : ''}`,
                url: '/market/merchant'
            }
        });
        res.json({ ok: true, store: await db.get('SELECT * FROM market_stores WHERE id = ?', [store.id]), offProducts: off });
    } catch (e) { fail(res, e, '变更店铺状态失败'); }
});

/** 费率/税务/地图配置 */
router.get('/admin/config', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const cfg = await market.getConfig();
        const audits = await db.all(`SELECT * FROM market_audit_logs WHERE action = 'config_update' ORDER BY id DESC LIMIT 20`);
        res.json({ ok: true, config: cfg, cycleDaysEffective: market.cycleDaysOf(cfg), audits });
    } catch (e) { fail(res, e, '加载配置失败'); }
});
router.put('/admin/config', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const cfg = await market.saveConfig(req.body || {}, req.userId);
        res.json({ ok: true, config: cfg, cycleDaysEffective: market.cycleDaysOf(cfg) });
    } catch (e) { fail(res, e, '保存配置失败'); }
});
/** 试算（不落库）：给定成交额与模式，看买卖双方与公会各拿多少 */
router.post('/admin/config/simulate', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const cfg = await market.getConfig();
        const amount = market.money(req.body?.amount || 0);
        const mode = req.body?.mode === 'buyer' ? 'buyer' : 'merchant';
        const taxBp = req.body?.rateBp !== undefined ? Number(req.body.rateBp) : cfg.taxRateBp;
        const t = market.calcTax(amount, Number(req.body?.discount) || 0, { ...cfg, taxMode: mode, taxRateBp: taxBp });
        res.json({ ok: true, amount, ...t, guildIncome: t.tax });
    } catch (e) { fail(res, e, '试算失败'); }
});

/** 订单/争议/退款/财政/档案/审计 */
router.get('/admin/orders', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { limit, page, offset } = pageParams(req.query);
        const where = [];
        const params = [];
        if (req.query.status) { where.push('o.status = ?'); params.push(String(req.query.status)); }
        if (req.query.store_id) { where.push('o.store_id = ?'); params.push(Number(req.query.store_id)); }
        const from = `FROM market_orders o LEFT JOIN market_stores s ON s.id = o.store_id LEFT JOIN users ub ON ub.id = o.buyer_id
                      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
        const total = await db.get(`SELECT COUNT(*) AS c ${from}`, params);
        const items = await db.all(
            `SELECT o.*, s.name AS store_name, ub.nickname AS buyer_nickname,
                    (SELECT used_at FROM market_verify_codes WHERE order_id = o.id) AS code_used_at,
                    (SELECT id FROM market_disputes WHERE order_id = o.id AND status = 'open') AS open_dispute
             ${from} ORDER BY o.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        const stats = await db.get(`SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status='settled' THEN tax_base ELSE 0 END),0) AS gmv,
            COALESCE(SUM(CASE WHEN status='settled' THEN tax_amount ELSE 0 END),0) AS tax,
            COALESCE(SUM(CASE WHEN status IN ('paid','delivered','awaiting_confirm','disputed','refunding') THEN buyer_pay ELSE 0 END),0) AS escrow,
            COALESCE(SUM(CASE WHEN status='refunded' THEN buyer_pay ELSE 0 END),0) AS refunded
            FROM market_orders`);
        res.json({ ok: true, total: total.c, page, limit, items, stats, statusLabel: market.ORDER_STATUS_LABEL });
    } catch (e) { fail(res, e, '加载订单失败'); }
});

/** 管理员人工退款（含已结算订单：从商家余额冲回） */
router.post('/admin/orders/:id/refund', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const order = await db.get('SELECT * FROM market_orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ error: '订单不存在' });
        const reason = String(req.body?.reason || '').slice(0, 300) || '管理员人工退款';
        if (order.status === 'settled') {
            // 已结算：直接从商家余额冲回给买家（差额由商家承担），并记审计
            const store = await db.get('SELECT * FROM market_stores WHERE id = ?', [order.store_id]);
            const amount = market.money(req.body?.amount === undefined ? order.buyer_pay : req.body.amount);
            const owner = await db.get('SELECT contribution FROM users WHERE id = ?', [store.owner_id]);
            if (market.money(owner.contribution) < amount) {
                return res.status(400).json({ error: `商家余额不足（${market.money(owner.contribution)} / 需 ${amount}），请先与商家协商或手工调账` });
            }
            const idem = `admin-refund:${order.id}`;
            const dup = await db.get('SELECT id FROM market_refunds WHERE idem_key = ?', [idem]);
            if (dup && dup.status === 'done') return res.json({ ok: true, already: true, refund: dup });
            await db.transaction(async () => {
                await market.transferPoints(store.owner_id, order.buyer_id, amount, 'market_refund', 'market_refund', order.id, `管理员人工退款 ${order.order_no}`);
                await db.run(
                    `INSERT INTO market_refunds (order_id, buyer_id, store_id, amount, reason, status, handled_by, handle_note, idem_key, created_at, handled_at)
                     VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?)`,
                    [order.id, order.buyer_id, order.store_id, amount, reason, req.userId, reason, idem, market.now(), market.now()]);
                await db.run(`UPDATE market_orders SET status = 'refunded', refunded_at = ?, close_reason = ?, updated_at = ? WHERE id = ?`,
                    [market.now(), `管理员退款：${reason}`, market.now(), order.id]);
            });
            await market.audit(req.userId, 'admin_refund_settled', 'order', order.id, { status: 'settled' }, { status: 'refunded', amount }, reason);
            await notify.emit({
                eventKey: `admin_refund:${order.id}`, eventType: 'order_refunded',
                userId: order.buyer_id, storeId: order.store_id, orderId: order.id,
                payload: { title: '管理员已为你退款', content: `订单 ${order.order_no} 已退款 ${amount} 贡献点（${reason}）。`, url: '/market/orders' }
            });
            return res.json({ ok: true, refunded: amount, fromMerchant: true });
        }
        const out = await settle.refundOrder(order.id, {
            amount: req.body?.amount === undefined ? null : market.money(req.body.amount),
            operatorId: req.userId, reason
        });
        res.json({ ok: true, refunded: out.refund, already: !!out.already });
    } catch (e) { fail(res, e, '人工退款失败'); }
});

router.get('/admin/disputes', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const where = [];
        const params = [];
        if (req.query.status) { where.push('d.status = ?'); params.push(String(req.query.status)); }
        const items = await db.all(
            `SELECT d.*, o.order_no, o.buyer_pay, o.merchant_income, o.tax_amount, o.status AS order_status, o.store_id,
                    s.name AS store_name, u.nickname AS opener_nickname
               FROM market_disputes d JOIN market_orders o ON o.id = d.order_id
               LEFT JOIN market_stores s ON s.id = o.store_id LEFT JOIN users u ON u.id = d.opened_by
              ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (d.status = 'open') DESC, d.id DESC LIMIT 100`, params);
        res.json({ ok: true, items });
    } catch (e) { fail(res, e, '加载争议失败'); }
});
router.post('/admin/disputes/:id/resolve', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const out = await settle.resolveDispute(req.params.id, {
            result: req.body?.result === 'refund' ? 'refund' : 'settle',
            refundAmount: req.body?.refund_amount === undefined ? null : market.money(req.body.refund_amount),
            operatorId: req.userId, note: String(req.body?.note || '').slice(0, 300)
        });
        res.json({ ok: true, dispute: out });
    } catch (e) { fail(res, e, '裁决失败'); }
});

/** 公会收入分户账 + 报表（**没有平台服务费科目，也没有公会余额账号**） */
router.get('/admin/finance', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const [byKind, monthly, escrow, recent, facts] = await Promise.all([
            db.get(`SELECT
                COALESCE(SUM(CASE WHEN kind='open_fee' AND direction='in' THEN amount ELSE 0 END),0) AS open_fee,
                COALESCE(SUM(CASE WHEN kind='renew_fee' AND direction='in' THEN amount ELSE 0 END),0) AS renew_fee,
                COALESCE(SUM(CASE WHEN kind='tax' AND direction='in' THEN amount ELSE 0 END),0) AS tax,
                COALESCE(SUM(CASE WHEN kind='refund_fee' AND direction='out' THEN amount ELSE 0 END),0) AS refund_fee,
                COALESCE(SUM(CASE WHEN kind='refund_tax' AND direction='out' THEN amount ELSE 0 END),0) AS refund_tax,
                COALESCE(SUM(CASE WHEN kind='adjust' AND direction='in' THEN amount ELSE 0 END),0) AS adjust_in,
                COALESCE(SUM(CASE WHEN kind='adjust' AND direction='out' THEN amount ELSE 0 END),0) AS adjust_out
                FROM market_finance_ledger`),
            db.all(`SELECT substr(created_at,1,7) AS ym, kind, COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS net,
                           COUNT(*) AS cnt FROM market_finance_ledger GROUP BY ym, kind ORDER BY ym DESC LIMIT 60`),
            db.get(`SELECT id, username, nickname, avatar, contribution FROM users WHERE username = ?`, [market.ESCROW_USERNAME]),
            db.all(`SELECT * FROM market_finance_ledger ORDER BY id DESC LIMIT 50`),
            // 业务事实口径：分户账必须和订单/店铺/扣费记录对得上
            db.get(`SELECT
                (SELECT COALESCE(SUM(tax_amount),0) FROM market_orders WHERE status='settled') AS settled_tax,
                (SELECT COALESCE(SUM(open_fee_paid),0) FROM market_stores WHERE open_fee_paid > 0 AND status <> 'rejected') AS store_open_fee,
                (SELECT COALESCE(SUM(amount),0) FROM market_fee_ledger WHERE kind='renew' AND status='paid') AS renew_paid`)
        ]);
        const income = {
            openFee: market.money(byKind.open_fee), renewFee: market.money(byKind.renew_fee),
            tax: market.money(byKind.tax), refundFee: market.money(byKind.refund_fee),
            refundTax: market.money(byKind.refund_tax),
            adjustIn: market.money(byKind.adjust_in), adjustOut: market.money(byKind.adjust_out)
        };
        income.net = market.money(income.openFee + income.renewFee + income.tax + income.adjustIn
            - income.refundFee - income.refundTax - income.adjustOut);
        const factCheck = {
            // 分户账口径 = 三类收入(in) − 对应冲回(out)
            taxNet: market.money(income.tax - income.refundTax),
            openFeeNet: market.money(income.openFee - income.refundFee),
            settledTax: market.money(facts.settled_tax),
            storeOpenFee: market.money(facts.store_open_fee),
            renewPaid: market.money(facts.renew_paid)
        };
        factCheck.taxDiff = market.money(factCheck.taxNet - factCheck.settledTax);
        factCheck.openFeeDiff = market.money(factCheck.openFeeNet - factCheck.storeOpenFee);
        factCheck.renewDiff = market.money(income.renewFee - factCheck.renewPaid);
        factCheck.balanced = Math.abs(factCheck.taxDiff) < 0.011 && Math.abs(factCheck.openFeeDiff) < 0.011
            && Math.abs(factCheck.renewDiff) < 0.011;
        res.json({
            ok: true,
            income,
            facts: factCheck,
            accounts: {
                escrow: escrow ? {
                    id: escrow.id, username: escrow.username, nickname: escrow.nickname,
                    avatar: escrow.avatar || '', balance: market.money(escrow.contribution)
                } : null
            },
            monthly, recent,
            note: '公会收入只有分户账一个口径（开店费 / 续期费 / 交易税），收入即钱退出流通；系统不存在平台服务费抽成科目，也不设公会余额账号'
        });
    } catch (e) { fail(res, e, '加载财政账失败'); }
});

/** 手工调账（只写分户账 + 直接增减用户余额，无公会余额账号） */
router.post('/admin/finance/adjust', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const kind = ['adjust'].includes(req.body?.kind) ? req.body.kind : 'adjust';
        const direction = req.body?.direction === 'out' ? 'out' : 'in';
        const amount = market.money(req.body?.amount);
        if (!(amount > 0)) return res.status(400).json({ error: '金额必须大于 0' });
        const note = String(req.body?.note || '').slice(0, 300);
        if (!note) return res.status(400).json({ error: '调账必须填写理由' });
        const userId = Number(req.body?.user_id);
        if (!userId) return res.status(400).json({ error: '调账必须指定用户（入账=从该用户扣，出账=补到该用户）' });
        const target = await db.get('SELECT id, nickname FROM users WHERE id = ?', [userId]);
        if (!target) return res.status(404).json({ error: '用户不存在' });
        const idem = String(req.body?.idem_key || `adjust:${Date.now()}`).slice(0, 80);
        const dup = await db.get('SELECT id FROM market_finance_ledger WHERE idem_key = ?', [idem]);
        if (dup) return res.status(409).json({ error: '该调账凭证已存在（idem_key 重复）' });
        await db.transaction(async () => {
            if (direction === 'in') {
                // 公会收入：从该用户扣，退出流通
                await market.chargeFee({
                    userId, amount, kind, type: 'market_adjust', refId: 0,
                    note: `集市调账入账：${note}`, idemKey: idem, operatorId: req.userId
                });
            } else {
                // 冲回：补到该用户余额
                await market.refundFee({
                    userId, amount, kind, type: 'market_adjust', refId: 0,
                    note: `集市调账出账：${note}`, idemKey: idem, operatorId: req.userId
                });
            }
        });
        await market.audit(req.userId, 'finance_adjust', 'finance', userId, null, { direction, amount, note, user_id: userId }, note);
        res.json({ ok: true, user: { id: target.id, nickname: target.nickname }, direction, amount, idem_key: idem });
    } catch (e) { fail(res, e, '调账失败'); }
});

/** 档案检索（商铺 + 账本） */
router.get('/admin/archives', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { limit, page, offset } = pageParams(req.query);
        const where = [];
        const params = [];
        if (req.query.kind) { where.push('kind = ?'); params.push(String(req.query.kind)); }
        if (req.query.keyword) { where.push('(title LIKE ? OR summary LIKE ? OR archive_no LIKE ?)'); const k = `%${req.query.keyword}%`; params.push(k, k, k); }
        const from = `${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
        const total = await db.get(`SELECT COUNT(*) AS c FROM market_archives ${from}`, params);
        const items = await db.all(`SELECT * FROM market_archives ${from} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        res.json({ ok: true, total: total.c, page, limit, items });
    } catch (e) { fail(res, e, '加载档案失败'); }
});

/** 审计日志 */
router.get('/admin/audit', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { limit, page, offset } = pageParams(req.query);
        const where = [];
        const params = [];
        if (req.query.action) { where.push('a.action = ?'); params.push(String(req.query.action)); }
        const from = `FROM market_audit_logs a LEFT JOIN users u ON u.id = a.operator_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
        const total = await db.get(`SELECT COUNT(*) AS c ${from}`, params);
        const items = await db.all(`SELECT a.*, u.nickname AS operator_nickname ${from} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        res.json({ ok: true, total: total.c, page, limit, items });
    } catch (e) { fail(res, e, '加载审计失败'); }
});

/** 分类管理 */
router.post('/admin/categories', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const kind = req.body?.kind === 'store' ? 'store' : 'product';
        const name = String(req.body?.name || '').trim().slice(0, 20);
        if (!name) return res.status(400).json({ error: '分类名不能为空' });
        const slug = market.slugifyStore(req.body?.slug || name) || `cat-${Date.now().toString(36)}`;
        const r = await db.run('INSERT OR IGNORE INTO market_categories (kind, name, slug, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
            [kind, name, slug, String(req.body?.icon || '').slice(0, 8), Number(req.body?.sort_order) || 0]);
        res.status(201).json({ ok: true, category: await db.get('SELECT * FROM market_categories WHERE id = ?', [r.id]) });
    } catch (e) { fail(res, e, '创建分类失败'); }
});
router.delete('/admin/categories/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        await db.run('UPDATE market_categories SET is_active = 0 WHERE id = ?', [Number(req.params.id)]);
        res.json({ ok: true });
    } catch (e) { fail(res, e, '停用分类失败'); }
});

/** 手动跑一次定时任务（幂等） */
router.post('/admin/jobs/run', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const out = await jobs.runAll();
        res.json({ ok: true, result: out });
    } catch (e) { fail(res, e, '执行任务失败'); }
});
/** 手动投递通知队列 */
router.post('/admin/notify/dispatch', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        res.json({ ok: true, result: await notify.dispatchPending(Number(req.body?.limit) || 50) });
    } catch (e) { fail(res, e, '投递失败'); }
});
/** 通知事件排查 */
router.get('/admin/notify/events', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { limit, page, offset } = pageParams(req.query);
        const where = [];
        const params = [];
        if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
        const from = `${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
        const total = await db.get(`SELECT COUNT(*) AS c FROM market_notify_events ${from}`, params);
        const items = await db.all(`SELECT * FROM market_notify_events ${from} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        res.json({ ok: true, total: total.c, page, limit, items });
    } catch (e) { fail(res, e, '加载通知事件失败'); }
});

/** 对账自检：托管余额 vs 未结算订单；分户账 vs 业务事实（无公会余额账号，收入只看分户账） */
router.get('/admin/reconcile', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const escrow = await db.get('SELECT id, username, avatar, contribution FROM users WHERE username = ?', [market.ESCROW_USERNAME]);
        const pending = await db.get(`SELECT COALESCE(SUM(buyer_pay),0) AS s FROM market_orders
                                       WHERE status IN ('paid','delivered','awaiting_confirm','disputed','refunding')`);
        const fin = await db.get(`SELECT
            COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS net,
            COALESCE(SUM(CASE WHEN kind='tax' THEN (CASE WHEN direction='in' THEN amount ELSE -amount END) ELSE 0 END),0) AS tax_net,
            COALESCE(SUM(CASE WHEN kind='open_fee' THEN (CASE WHEN direction='in' THEN amount ELSE -amount END) ELSE 0 END),0) AS open_net,
            COALESCE(SUM(CASE WHEN kind='refund_fee' THEN (CASE WHEN direction='in' THEN amount ELSE -amount END) ELSE 0 END),0) AS refund_fee_net,
            COALESCE(SUM(CASE WHEN kind='refund_tax' THEN (CASE WHEN direction='in' THEN amount ELSE -amount END) ELSE 0 END),0) AS refund_tax_net,
            COALESCE(SUM(CASE WHEN kind='renew_fee' THEN (CASE WHEN direction='in' THEN amount ELSE -amount END) ELSE 0 END),0) AS renew_net,
            COUNT(*) AS cnt, SUM(CASE WHEN amount <= 0 THEN 1 ELSE 0 END) AS bad_amount,
            SUM(CASE WHEN kind IN ('tax','open_fee','renew_fee','refund_fee','refund_tax','adjust') THEN 0 ELSE 1 END) AS bad_kind,
            SUM(CASE WHEN direction IN ('in','out') THEN 0 ELSE 1 END) AS bad_direction
            FROM market_finance_ledger`);
        const facts = await db.get(`SELECT
            (SELECT COALESCE(SUM(tax_amount),0) FROM market_orders WHERE status='settled') AS settled_tax,
            (SELECT COALESCE(SUM(open_fee_paid),0) FROM market_stores WHERE open_fee_paid > 0 AND status <> 'rejected') AS store_open_fee,
            (SELECT COALESCE(SUM(amount),0) FROM market_fee_ledger WHERE kind='renew' AND status='paid') AS renew_paid`);
        const escrowBalance = market.money(escrow ? escrow.contribution : 0);
        const diffEscrow = market.money(escrowBalance - pending.s);
        // 分户账口径 = 该类收入(in) + 该类冲回(out，本身为负数)，再与业务事实逐项对账
        const openNet = market.money(fin.open_net + fin.refund_fee_net);
        const taxNet = market.money(fin.tax_net + fin.refund_tax_net);
        const renewNet = market.money(fin.renew_net);
        const checks = {
            escrow: {
                balance: escrowBalance, pendingOrders: market.money(pending.s), diff: diffEscrow,
                balanced: Math.abs(diffEscrow) < 0.011
            },
            tax: {
                ledger: taxNet, settledOrders: market.money(facts.settled_tax),
                diff: market.money(taxNet - facts.settled_tax), balanced: Math.abs(taxNet - facts.settled_tax) < 0.011
            },
            openFee: {
                ledger: openNet, stores: market.money(facts.store_open_fee),
                diff: market.money(openNet - facts.store_open_fee), balanced: Math.abs(openNet - facts.store_open_fee) < 0.011
            },
            renewFee: {
                ledger: renewNet, feeLedgerPaid: market.money(facts.renew_paid),
                diff: market.money(renewNet - facts.renew_paid), balanced: Math.abs(renewNet - facts.renew_paid) < 0.011
            },
            ledger: {
                rows: fin.cnt, badAmount: fin.bad_amount || 0, badKind: fin.bad_kind || 0, badDirection: fin.bad_direction || 0
            }
        };
        checks.ok = checks.escrow.balanced && checks.tax.balanced && checks.openFee.balanced
            && checks.renewFee.balanced && !checks.ledger.badAmount && !checks.ledger.badKind && !checks.ledger.badDirection;
        res.json({
            ok: true,
            ...checks,
            escrow: { ...checks.escrow, id: escrow ? escrow.id : null, username: escrow ? escrow.username : null, avatar: escrow ? (escrow.avatar || '') : '' },
            financeLedgerNet: market.money(fin.net),
            note: '公会不持有余额账号：交易税/开店费/续期费一经收取即退出流通，只以 market_finance_ledger 记账；因此这里用「分户账 vs 订单/店铺事实」对账，而不是余额对账'
        });
    } catch (e) { fail(res, e, '对账失败'); }
});

module.exports = router;
