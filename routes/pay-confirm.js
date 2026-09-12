/**
 * 支付确认（面向用户的缴费确认页）
 *  - GET  /api/pay-confirm/:token        查询订单详情（公开，凭 token）
 *  - POST /api/pay-confirm/:token/confirm 用户点击「确认支付」后真正扣/加款（公开，凭 token；公共单需登录）
 *  - POST /api/pay-confirm/admin/link     后台生成缴费链接（管理员，支持选择扣款主体/本站/公共单）
 *  - GET  /api/pay-confirm/admin/sites    后台可选扣款主体列表
 *  - GET  /api/pay-confirm/admin/orders   后台缴费单列表
 *
 * 安全：token 为 48 位随机 hex，不可猜测；仅能操作对应订单；已处理订单幂等。
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { authMiddleware, adminMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const logger = require('../lib/logger');
const paygate = require('../lib/paygate');

const router = express.Router();

/** 订单 -> 前端展示用的 DTO（不泄露敏感字段） */
function toDto(order) {
    return {
        orderNo: order.order_no,
        amount: order.amount,
        direction: order.direction,
        status: order.status,
        subject: order.subject || '',
        siteName: order.site_name || '',
        isPublic: order.user_id == null,
        createdAt: order.created_at,
        handledAt: order.handled_at || null,
    };
}

/** 确保存在「官网自营」虚拟站点（作为「本站」扣款主体） */
async function ensureSelfSite() {
    let site = await db.get("SELECT * FROM pay_sites WHERE name='官网自营' LIMIT 1");
    if (!site) {
        const api_key = 'xk_' + crypto.randomBytes(16).toString('hex');
        const hmac_secret = crypto.randomBytes(24).toString('hex');
        const r = await db.run(
            "INSERT INTO pay_sites (name, site_url, api_key, hmac_secret, callback_url, enabled) VALUES ('官网自营','',?,?,'',1)",
            [api_key, hmac_secret]
        );
        site = await db.get('SELECT * FROM pay_sites WHERE id=?', [r.id]);
    }
    return site;
}

// 查询订单（公开，凭 token）
router.get('/:token', async (req, res) => {
    try {
        const order = await paygate.getOrderByConfirmToken(req.params.token);
        if (!order) return res.status(404).json({ error: '订单不存在或链接已失效' });

        // 附带用户信息（昵称）与余额，便于确认页展示（公共单无绑定用户）
        let user = null;
        if (order.user_id != null) {
            user = await db.get('SELECT id, username, nickname, contribution FROM users WHERE id=?', [order.user_id]);
        }
        res.json({
            order: toDto(order),
            user: user ? { id: user.id, username: user.username, nickname: user.nickname, contribution: user.contribution } : null,
        });
    } catch (e) {
        logger.error('支付确认页查询失败:', e.message);
        res.status(500).json({ error: '查询失败' });
    }
});

// 用户确认支付（公开，凭 token；公共单需登录后绑定当前用户）
router.post('/:token/confirm', optionalAuthMiddleware, async (req, res) => {
    try {
        const order = await paygate.getOrderByConfirmToken(req.params.token);
        if (!order) return res.status(404).json({ error: '订单不存在或链接已失效' });

        // 公共缴费单：需登录，把当前用户绑定为付款人
        if (order.user_id == null) {
            if (!req.userId) return res.status(401).json({ error: '公共缴费单需要登录后确认支付' });
            await db.run('UPDATE pay_orders SET user_id=? WHERE id=? AND user_id IS NULL', [req.userId, order.id]);
            order.user_id = req.userId;
        }

        if (order.status === 'success') {
            return res.json({ success: true, already: true, status: 'success' });
        }
        if (order.status === 'fail') {
            return res.status(400).json({ error: '该订单已失败，无法支付' });
        }
        if (order.status !== 'awaiting_confirm' && order.status !== 'pending') {
            return res.status(400).json({ error: `订单状态异常（${order.status}）` });
        }

        // 真正执行：扣/加贡献点，并异步回调外站
        const r = await paygate.handleOrder(order.order_no);
        if (!r.ok) return res.status(400).json({ error: r.error || '支付失败' });

        // 异步通知外站（本站/官网自营无回调地址，自动跳过）
        try {
            const site = await db.get('SELECT * FROM pay_sites WHERE id=?', [order.site_id]);
            if (site) {
                setImmediate(() => {
                    paygate.notifyExternal(r.order, site).catch(e => logger.error('确认后回调外站失败:', e.message));
                });
            }
        } catch (e) { /* 回调失败不影响确认结果 */ }

        logger.info(`支付确认成功: order=${order.order_no} amount=${order.amount} direction=${order.direction}`);
        res.json({ success: true, status: r.order.status, amount: r.order.amount, direction: r.order.direction });
    } catch (e) {
        logger.error('支付确认失败:', e.message);
        res.status(500).json({ error: '支付失败' });
    }
});

// 后台：可选扣款主体列表（含「本站」虚拟项）
router.get('/admin/sites', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const sites = await db.all('SELECT id, name, enabled FROM pay_sites ORDER BY id');
        res.json({ sites: sites.map(s => ({ id: s.id, name: s.name, enabled: !!s.enabled })) });
    } catch (e) {
        logger.error('获取扣款主体列表失败:', e.message);
        res.status(500).json({ error: '获取失败' });
    }
});

// 后台：生成缴费链接（管理员）
router.post('/admin/link', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { user_id, username, amount, direction, subject, site_id, is_public } = req.body || {};
        const amt = parseInt(amount);
        if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: '金额必须为正整数' });

        const isPublic = is_public === true || is_public === 'true' || is_public === 1;

        // 定位官网用户（公共缴费单可不指定用户）
        let uid = user_id ? parseInt(user_id) : null;
        if (!uid && username) {
            const u = await db.get('SELECT id FROM users WHERE username=? OR nickname=? LIMIT 1', [username, username]);
            if (u) uid = u.id;
        }
        if (!uid && !isPublic) return res.status(400).json({ error: '未找到该用户（或勾选「公共缴费单」）' });

        // 扣款主体：可选具体站点 / 本站（官网自营）
        let site = null;
        const sid = String(site_id || '').toLowerCase();
        if (sid === 'self' || sid === 'guanwang' || sid === '0') {
            site = await ensureSelfSite();
        } else if (site_id) {
            site = await db.get('SELECT * FROM pay_sites WHERE id=?', [parseInt(site_id)]);
        }
        if (!site) site = await db.get('SELECT * FROM pay_sites ORDER BY id LIMIT 1');
        if (!site) return res.status(400).json({ error: '尚无可用支付站点，请先创建站点' });

        const siteOrderNo = 'ADM' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
        const r = await paygate.createOrder(site, {
            site_order_no: siteOrderNo,
            user_id: uid,
            amount: amt,
            direction: direction === 'in' ? 'in' : 'out',
            subject: subject || (isPublic ? '公共缴费单' : '缴费单'),
            require_confirm: true,
            public_order: isPublic,
        });
        if (r.error) return res.status(400).json({ error: r.error });

        const base = (process.env.SITE_URL || 'https://xuanjian.top').replace(/\/$/, '');
        const link = `${base}/pay/confirm/${r.order.confirm_token}`;
        logger.info(`管理员生成缴费链接: order=${r.order.order_no} user=${uid || '(公共)'} site=${site.name} amount=${amt} by=${req.userId}`);
        res.json({ success: true, orderNo: r.order.order_no, link, token: r.order.confirm_token, amount: amt, direction: r.order.direction, status: r.order.status, siteName: site.name, isPublic });
    } catch (e) {
        logger.error('生成缴费链接失败:', e.message);
        res.status(500).json({ error: '生成失败' });
    }
});

// 后台：缴费单列表
router.get('/admin/orders', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT o.id, o.order_no, o.site_order_no, o.user_id, o.amount, o.direction, o.status, o.subject, o.confirm_token, o.created_at, o.handled_at,
                    u.username, u.nickname, s.name AS site_name
             FROM pay_orders o
             LEFT JOIN users u ON u.id = o.user_id
             LEFT JOIN pay_sites s ON s.id = o.site_id
             ORDER BY o.id DESC LIMIT 200`
        );
        const base = (process.env.SITE_URL || 'https://xuanjian.top').replace(/\/$/, '');
        res.json({
            orders: rows.map(o => ({
                ...o,
                is_public: o.user_id == null,
                link: o.confirm_token ? `${base}/pay/confirm/${o.confirm_token}` : null,
            })),
        });
    } catch (e) {
        logger.error('获取缴费单列表失败:', e.message);
        res.status(500).json({ error: '获取失败' });
    }
});

module.exports = router;
