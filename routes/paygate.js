/**
 * 外部站点贡献点兑换/支付网关
 * 供外站调用，安全设计：站点 api_key + HMAC 签名鉴权；幂等；状态机；出站回调。
 * 管理端走本官网 adminMiddleware（level>=1）。
 */
const express = require('express');
const db = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const paygate = require('../lib/paygate');
const logger = require('../lib/paygate-logger');
const router = express.Router();

/** 按 api_key 定位外站 */
async function findSiteByKey(apiKey) {
    if (!apiKey) return null;
    return db.get('SELECT * FROM pay_sites WHERE api_key = ?', [apiKey]);
}

/** 外站鉴权中间件：X-Api-Key + HMAC body 验签 */
async function paygateAuth(req, res, next) {
    try {
        const apiKey = req.headers['x-api-key'];
        const site = await findSiteByKey(apiKey);
        if (!site || !site.enabled) return res.status(401).json({ error: 'API Key 无效或站点未启用' });
        if (!paygate.verifyHmac(site.hmac_secret, req.body || {})) {
            return res.status(401).json({ error: '签名校验失败' });
        }
        req.paySite = site;
        next();
    } catch (e) {
        logger.error('auth.failed', { message: e.message });
        res.status(500).json({ error: '鉴权失败' });
    }
}

// ====== 外站接口 ======

// 外站发起兑换单（站点验签 + 幂等）
router.post('/order/create', paygateAuth, async (req, res) => {
    const r = await paygate.createOrder(req.paySite, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    return res.json({ success: true, order_no: r.order.order_no, site_order_no: r.order.site_order_no, status: r.order.status });
});

// 外站确认执行（默认自动执行刚创建的单，可带 order_no）
// 处理成功扣除/入账并异步回往外站
router.post('/order/execute', paygateAuth, async (req, res) => {
    try {
        const body = req.body || {};
        let orderNo = body.order_no;
        if (!orderNo && body.site_order_no) {
            const o = await db.get('SELECT order_no FROM pay_orders WHERE site_id=? AND site_order_no=?', [req.paySite.id, body.site_order_no]);
            if (o) orderNo = o.order_no;
        }
        if (!orderNo) return res.status(400).json({ error: '缺少 order_no' });

        const r = await paygate.handleOrder(orderNo);
        if (!r.ok) return res.status(400).json({ error: r.error });
        const order = r.order;
        // 异步回调外站（不阻塞响应）
        notifyAsync(order, req.paySite);
        return res.json({ success: true, order_no: order.order_no, status: order.status, amount: order.amount, direction: order.direction });
    } catch (e) {
        logger.error('execute.failed', { message: e.message });
        res.status(500).json({ error: '执行失败' });
    }
});

// 外站查询订单状态
router.get('/order/query', paygateAuth, async (req, res) => {
    const orderNo = req.query.order_no;
    const siteOrderNo = req.query.site_order_no;
    if (!orderNo && !siteOrderNo) return res.status(400).json({ error: '缺少订单号' });
    const where = orderNo ? 'order_no = ?' : 'site_order_no = ?';
    const val = orderNo || siteOrderNo;
    const order = await db.get(`SELECT * FROM pay_orders WHERE ${where} AND site_id = ?`, [val, req.paySite.id]);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    res.json({ order_no: order.order_no, site_order_no: order.site_order_no, status: order.status, amount: order.amount, direction: order.direction, created_at: order.created_at, handled_at: order.handled_at });
});

async function notifyAsync(order, site) {
    setTimeout(async () => {
        try { await paygate.notifyExternal(order, site); } catch (e) { logger.error('notify.async.error', { orderNo: order.order_no, message: e.message }); }
    }, 0);
}

// ====== 管理端 ======

// 站点列表
router.get('/sites', authMiddleware, adminMiddleware, async (req, res) => {
    const sites = await db.all('SELECT id, name, site_url, api_key, enabled, callback_url, created_at FROM pay_sites ORDER BY id DESC');
    res.json({ sites });
});

// 新增站点（生成 api_key 与 secret）
router.post('/sites', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, site_url, callback_url, enabled } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: '站点名称不能为空' });
        const crypto = require('crypto');
        const api_key = 'xk_' + crypto.randomBytes(16).toString('hex');
        const hmac_secret = crypto.randomBytes(24).toString('hex');
        const r = await db.run(
            'INSERT INTO pay_sites (name, site_url, api_key, hmac_secret, callback_url, enabled) VALUES (?, ?, ?, ?, ?, ?)',
            [name.trim(), site_url || '', api_key, hmac_secret, callback_url || '', enabled === false ? 0 : 1]
        );
        logger.audit({ action: 'site.create', detail: { name: name.trim() } });
        res.status(201).json({ success: true, siteId: r.id, api_key, hmac_secret, name: name.trim() });
    } catch (e) {
        logger.error('site.create.failed', { message: e.message });
        res.status(500).json({ error: '创建失败' });
    }
});

// 编辑站点
router.put('/sites/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, site_url, callback_url, enabled } = req.body;
        await db.run(
            'UPDATE pay_sites SET name=?, site_url=?, callback_url=?, enabled=? WHERE id=?',
            [name?.trim() || '', site_url || '', callback_url || '', enabled === false ? 0 : 1, req.params.id]
        );
        logger.audit({ action: 'site.update', detail: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: '更新失败' }); }
});

// 删除站点
router.delete('/sites/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const has = await db.get('SELECT id FROM pay_orders WHERE site_id=? LIMIT 1', [req.params.id]);
        if (has) return res.status(400).json({ error: '该站点已有订单，无法删除（可停用）' });
        await db.run('DELETE FROM pay_sites WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: '删除失败' }); }
});

// 订单列表（管理端，支持状态筛选）
router.get('/admin/orders', authMiddleware, adminMiddleware, async (req, res) => {
    const { status, site } = req.query;
    let sql = `SELECT o.*, s.name AS site_name, u.username
               FROM pay_orders o
               LEFT JOIN pay_sites s ON o.site_id = s.id
               LEFT JOIN users u ON o.user_id = u.id
               WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND o.status = ?'; params.push(status); }
    if (site) { sql += ' AND o.site_id = ?'; params.push(parseInt(site)); }
    sql += ' ORDER BY o.id DESC LIMIT 200';
    const rows = await db.all(sql, params);
    res.json({ orders: rows });
});

// 兑换关键日志（审计，pay_logs）
router.get('/admin/logs', authMiddleware, adminMiddleware, async (req, res) => {
    const rows = await db.all('SELECT * FROM pay_logs ORDER BY id DESC LIMIT 200');
    res.json({ logs: rows });
});

module.exports = router;
