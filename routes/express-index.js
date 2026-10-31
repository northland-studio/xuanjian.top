/**
 * 哲式动态指数系统 · API
 *
 * 公开：
 *   GET  /api/express-index/quotes        三板块行情（现价/昨收/涨跌/涨跌幅度/熔断状态）
 *   GET  /api/express-index/settlements   最近结算记录（审计）
 * 登录：
 *   POST /api/express-index/buy           买入 { stockId, shares }
 *   POST /api/express-index/sell          卖出 { stockId, shares }
 * 管理员：
 *   GET  /api/express-index/settings      读取参数
 *   PUT  /api/express-index/settings      修改参数（哲指数/股价基准/活跃基准/买卖费率/熔断底价）
 *   POST /api/express-index/snapshot      手动触发收盘快照
 *   POST /api/express-index/settle        手动结算某任务 { taskId }
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const expressIndex = require('../lib/express-index');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

function handle(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (e) {
            const status = e.status || 500;
            if (status >= 500) logger.error('哲指数接口错误：' + (e && e.stack ? e.stack : e));
            res.status(status).json({ ok: false, error: e.message || '服务内部错误', code: e.code || undefined });
        }
    };
}

/* ---------- 公开 ---------- */
router.get('/quotes', handle(async (_req, res) => {
    const data = await expressIndex.quotes();
    res.json({ ok: true, ...data });
}));

router.get('/settlements', handle(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const rows = await db.all(
        `SELECT s.*, st.name AS stock_name, t.title AS task_title
           FROM stock_settlements s
           LEFT JOIN stocks st ON st.id = s.stock_id
           LEFT JOIN tasks t ON t.id = s.task_id
          ORDER BY s.id DESC LIMIT ?`,
        [limit]
    );
    res.json({ ok: true, settlements: rows });
}));

/* ---------- 交易 ---------- */
router.post('/buy', authMiddleware, handle(async (req, res) => {
    const { stockId, shares } = req.body || {};
    const r = await expressIndex.buy({ userId: req.userId, stockId: Number(stockId), shares });
    res.json(r);
}));

router.post('/sell', authMiddleware, handle(async (req, res) => {
    const { stockId, shares } = req.body || {};
    const r = await expressIndex.sell({ userId: req.userId, stockId: Number(stockId), shares });
    res.json(r);
}));

/* ---------- 管理 ---------- */
router.get('/settings', authMiddleware, adminMiddleware, handle(async (_req, res) => {
    res.json({ ok: true, settings: await expressIndex.getSettings(), keys: expressIndex.KEYS, defaults: expressIndex.DEFAULTS });
}));

router.put('/settings', authMiddleware, adminMiddleware, handle(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    const map = {
        zheIndex: expressIndex.KEYS.zheIndex,
        priceBase: expressIndex.KEYS.priceBase,
        activeBase: expressIndex.KEYS.activeBase,
        floorPrice: expressIndex.KEYS.floorPrice,
        buyFeeRate: expressIndex.KEYS.buyFeeRate,
        sellTaxRate: expressIndex.KEYS.sellTaxRate
    };
    for (const [k, key] of Object.entries(map)) {
        if (b[k] === undefined || b[k] === '') continue;
        const v = Number(b[k]);
        if (!Number.isFinite(v) || v < 0) return res.status(400).json({ ok: false, error: k + ' 必须是非负数字' });
        patch[key] = v;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: '没有需要修改的参数' });
    const settings = await expressIndex.setSettings(patch);
    res.json({ ok: true, settings });
}));

router.post('/snapshot', authMiddleware, adminMiddleware, handle(async (req, res) => {
    const day = (req.body && req.body.day) || undefined;
    res.json({ ok: true, ...(await expressIndex.snapshotDaily(day)) });
}));

router.post('/settle', authMiddleware, adminMiddleware, handle(async (req, res) => {
    const taskId = Number((req.body || {}).taskId);
    if (!taskId) return res.status(400).json({ ok: false, error: '缺少 taskId' });
    const r = await expressIndex.settleByTask(taskId, { operatorId: req.userId });
    res.json({ ok: true, ...r });
}));

module.exports = router;
