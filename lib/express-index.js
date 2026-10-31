/**
 * 哲式动态指数系统 · 核心逻辑
 *
 * 公式（原文）：
 *   ΔP = 哲指数 × K × (N / 活跃量化基准) ÷ (max(P, 股价基准) / 股价基准)
 *   默认：ΔP = 20 × K × (N/10) ÷ (max(P,5)/5)
 *
 * 熔断：
 *   - 计算时 P < 股价基准 → 分母按 (基准/基准)=1 计（防止 ΔP 爆炸）
 *   - 交易时 P < 股价基准 → 禁止买入
 *
 * K = 任务贡献点奖励 reward
 * N = 该任务「不同完成用户数」（task_claims 审核通过去重）
 */
const db = require('../database');
const logger = require('./logger');

const KEYS = {
    zheIndex: 'express.zheIndex',
    priceBase: 'express.priceBase',
    activeBase: 'express.activeBase',
    buyFeeRate: 'express.buyFeeRate',
    sellTaxRate: 'express.sellTaxRate',
    floorPrice: 'express.floorPrice'
};

const DEFAULTS = {
    zheIndex: 20,
    priceBase: 5,
    activeBase: 10,
    buyFeeRate: 0.01,
    sellTaxRate: 0.05,
    floorPrice: 5
};

async function getSettings() {
    const rows = await db.all('SELECT key, value FROM settings');
    const map = {};
    rows.forEach((r) => { map[r.key] = r.value; });
    const num = (k, d) => {
        const v = Number(map[k]);
        return Number.isFinite(v) && v > 0 ? v : d;
    };
    return {
        zheIndex: num(KEYS.zheIndex, DEFAULTS.zheIndex),
        priceBase: num(KEYS.priceBase, DEFAULTS.priceBase),
        activeBase: num(KEYS.activeBase, DEFAULTS.activeBase),
        floorPrice: num(KEYS.floorPrice, DEFAULTS.floorPrice),
        buyFeeRate: (() => { const v = Number(map[KEYS.buyFeeRate]); return Number.isFinite(v) && v >= 0 ? v : DEFAULTS.buyFeeRate; })(),
        sellTaxRate: (() => { const v = Number(map[KEYS.sellTaxRate]); return Number.isFinite(v) && v >= 0 ? v : DEFAULTS.sellTaxRate; })()
    };
}

async function setSettings(patch) {
    const allow = Object.values(KEYS);
    for (const [k, v] of Object.entries(patch || {})) {
        if (!allow.includes(k)) continue;
        const val = String(v);
        const row = await db.get('SELECT key FROM settings WHERE key = ?', [k]);
        if (row) await db.run('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?', [val, k]);
        else await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, val]);
    }
    return getSettings();
}

/** 计算单次结算涨幅 */
function calcDelta({ K, N, P, cfg }) {
    const k = Math.max(0, Number(K) || 0);
    const n = Math.max(0, Number(N) || 0);
    const p = Number(P) || 0;
    const base = cfg.priceBase;
    // 熔断：股价低于基准时，分母按 1（即 (base/base)）
    const denominator = p < base ? 1 : p / base;
    const delta = cfg.zheIndex * k * (n / cfg.activeBase) / denominator;
    return {
        delta: Math.round(delta * 100) / 100,
        denominator,
        floored: p < base
    };
}

/** 任务完成人数（去重） */
async function taskFinishCount(taskId) {
    const row = await db.get(
        `SELECT COUNT(DISTINCT user_id) AS c FROM task_claims WHERE task_id = ? AND status IN ('approved','completed')`,
        [taskId]
    );
    return row ? row.c : 0;
}

/**
 * 按任务结算股价（幂等：同一 task 只结算一次，靠 stock_settlements 唯一约束检查）
 * 返回 null 表示该任务未绑定板块或已结算
 */
async function settleByTask(taskId, { operatorId = null } = {}) {
    const task = await db.get('SELECT id, title, reward, stock_id FROM tasks WHERE id = ?', [taskId]);
    if (!task || !task.stock_id) return { skipped: 'task_not_bound' };

    const done = await db.get('SELECT id FROM stock_settlements WHERE task_id = ?', [taskId]);
    if (done) return { skipped: 'already_settled', settlementId: done.id };

    const stock = await db.get('SELECT id, name, current_price FROM stocks WHERE id = ? AND is_active = 1', [task.stock_id]);
    if (!stock) return { skipped: 'stock_not_found' };

    const cfg = await getSettings();
    const N = await taskFinishCount(taskId);
    const K = Number(task.reward) || 0;
    if (N <= 0 || K <= 0) return { skipped: 'no_finishers_or_reward', N, K };

    const P = Number(stock.current_price) || cfg.priceBase;
    const { delta, denominator, floored } = calcDelta({ K, N, P, cfg });
    const after = Math.round((P + delta) * 100) / 100;

    await db.transaction(async () => {
        await db.run('UPDATE stocks SET current_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [after, stock.id]);
        await db.run(
            `INSERT INTO stock_settlements (stock_id, task_id, reward, finish_count, price_before, price_after, delta, formula, operator_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [stock.id, taskId, K, N, P, after, delta,
                `ΔP=${cfg.zheIndex}×${K}×(${N}/${cfg.activeBase})÷${denominator}`,
                operatorId]
        );
    });

    logger.info?.('[express] 结算 task=' + taskId + ' ' + stock.name + ' ' + P + ' → ' + after + ' (ΔP=' + delta + ')');
    return { ok: true, stockId: stock.id, stockName: stock.name, K, N, priceBefore: P, priceAfter: after, delta, floored };
}

/** 买入（贡献点 → 股份），返回成交详情；P<基准禁止买入 */
async function buy({ userId, stockId, shares }) {
    const cfg = await getSettings();
    const stock = await db.get('SELECT * FROM stocks WHERE id = ? AND is_active = 1', [stockId]);
    if (!stock) throw Object.assign(new Error('股票不存在或已停用'), { status: 404 });

    const P = Number(stock.current_price) || 0;
    if (P < cfg.floorPrice) {
        throw Object.assign(new Error(`当前股价 ${P} 低于熔断底价 ${cfg.floorPrice}，禁止买入`), { status: 400, code: 'circuit_breaker' });
    }
    const n = Math.floor(Number(shares));
    if (!n || n <= 0) throw Object.assign(new Error('买入股数必须为正整数'), { status: 400 });

    const gross = Math.round(P * n * 100) / 100;
    const fee = Math.round(gross * cfg.buyFeeRate * 100) / 100;
    const cost = Math.round((gross + fee) * 100) / 100;

    return db.transaction(async () => {
        const u = await db.get('SELECT id, COALESCE(contribution,0) AS c FROM users WHERE id = ?', [userId]);
        if (!u) throw Object.assign(new Error('用户不存在'), { status: 404 });
        if (Number(u.c) < cost) throw Object.assign(new Error(`贡献点不足：需要 ${cost}，当前 ${u.c}`), { status: 400 });

        await db.run('UPDATE users SET contribution = COALESCE(contribution,0) - ? WHERE id = ?', [cost, userId]);
        await db.run(
            `INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after)
             VALUES (?, ?, 'exchange', ?, ?, ?)`,
            [userId, -cost, stockId, `买入${stock.name} ${n} 股（含手续费 ${fee}）`, Math.round((Number(u.c) - cost) * 100) / 100]
        ).catch(() => {});
        const hold = await db.get('SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?', [userId, stockId]);
        if (hold) {
            await db.run('UPDATE stock_holdings SET shares = shares + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [n, gross, hold.id]);
        } else {
            await db.run('INSERT INTO stock_holdings (user_id, stock_id, shares, cost_basis) VALUES (?, ?, ?, ?)', [userId, stockId, n, gross]);
        }
        await db.run(
            `INSERT INTO stock_prices (stock_id, price, volume, recorded_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
            [stockId, P, n]
        ).catch(() => {});

        return { ok: true, stockId, shares: n, price: P, gross, fee, cost, balanceAfter: Math.round((Number(u.c) - cost) * 100) / 100 };
    });
}

/** 卖出（股份 → 贡献点），收高额印花税 */
async function sell({ userId, stockId, shares }) {
    const cfg = await getSettings();
    const stock = await db.get('SELECT * FROM stocks WHERE id = ? AND is_active = 1', [stockId]);
    if (!stock) throw Object.assign(new Error('股票不存在或已停用'), { status: 404 });

    const P = Number(stock.current_price) || 0;
    const n = Math.floor(Number(shares));
    if (!n || n <= 0) throw Object.assign(new Error('卖出股数必须为正整数'), { status: 400 });

    const gross = Math.round(P * n * 100) / 100;
    const tax = Math.round(gross * cfg.sellTaxRate * 100) / 100;
    const income = Math.round((gross - tax) * 100) / 100;

    return db.transaction(async () => {
        const u = await db.get('SELECT id, COALESCE(contribution,0) AS c FROM users WHERE id = ?', [userId]);
        if (!u) throw Object.assign(new Error('用户不存在'), { status: 404 });

        await db.run('UPDATE users SET contribution = COALESCE(contribution,0) + ? WHERE id = ?', [income, userId]);
        await db.run(
            `INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after)
             VALUES (?, ?, 'exchange', ?, ?, ?)`,
            [userId, income, stockId, `卖出${stock.name} ${n} 股（印花税 ${tax}）`, Math.round((Number(u.c) + income) * 100) / 100]
        ).catch(() => {});
        await db.run(
            `INSERT INTO stock_prices (stock_id, price, volume, recorded_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
            [stockId, P, n]
        ).catch(() => {});

        const hold = await db.get('SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?', [userId, stockId]);
        if (!hold || hold.shares < n) throw Object.assign(new Error('持仓不足：当前持有 ' + (hold ? hold.shares : 0) + ' 股'), { status: 400 });
        const avgCost = hold.shares > 0 ? hold.cost_basis / hold.shares : 0;
        const left = hold.shares - n;
        await db.run('UPDATE stock_holdings SET shares = ?, cost_basis = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
            left, Math.max(0, Math.round(avgCost * left * 100) / 100), hold.id
        ]);

        return { ok: true, stockId, shares: n, price: P, gross, tax, income, balanceAfter: Math.round((Number(u.c) + income) * 100) / 100 };
    });
}

/** 每日 00:00（Asia/Shanghai）快照 */
async function snapshotDaily(day) {
    const d = day || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const stocks = await db.all('SELECT id, current_price FROM stocks WHERE is_active = 1');
    let count = 0;
    for (const s of stocks) {
        const agg = await db.get(
            `SELECT COALESCE(SUM(delta),0) AS delta_sum, COUNT(*) AS n FROM stock_settlements
              WHERE stock_id = ? AND date(created_at) = date(?)`,
            [s.id, d]
        ).catch(() => ({ delta_sum: 0, n: 0 }));
        const prev = await db.get('SELECT close_price FROM stock_daily_snapshots WHERE stock_id = ? ORDER BY day DESC LIMIT 1', [s.id]);
        await db.run(
            `INSERT INTO stock_daily_snapshots (stock_id, day, open_price, close_price, delta_sum, trade_count)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(stock_id, day) DO UPDATE SET close_price = excluded.close_price`,
            [s.id, d, prev ? prev.close_price : s.current_price, s.current_price, agg.delta_sum || 0, agg.n || 0]
        );
        count++;
    }
    return { day: d, stocks: count };
}

/** 行情（含昨日收盘） */
async function quotes() {
    const cfg = await getSettings();
    const stocks = await db.all('SELECT id, symbol, name, description, current_price, is_active FROM stocks WHERE is_active = 1 ORDER BY id');
    const out = [];
    for (const s of stocks) {
        const snap = await db.get('SELECT close_price FROM stock_daily_snapshots WHERE stock_id = ? ORDER BY day DESC LIMIT 1', [s.id]);
        const yesterday = snap ? Number(snap.close_price) : Number(s.current_price);
        const change = Math.round((Number(s.current_price) - yesterday) * 100) / 100;
        const changePct = yesterday ? Math.round((change / yesterday) * 10000) / 100 : 0;
        out.push({
            id: s.id, symbol: s.symbol, name: s.name, description: s.description,
            price: Number(s.current_price),
            yesterdayClose: Math.round(yesterday * 100) / 100,
            change,
            changePct,
            floorPrice: cfg.floorPrice,
            canBuy: Number(s.current_price) >= cfg.floorPrice,
            floored: Number(s.current_price) < cfg.floorPrice
        });
    }
    return { stocks: out, settings: cfg };
}

/** 我的持仓（含市值与浮动盈亏） */
async function holdings(userId) {
    const rows = await db.all(
        `SELECT h.stock_id, h.shares, h.cost_basis, s.name, s.symbol, s.current_price
           FROM stock_holdings h JOIN stocks s ON s.id = h.stock_id
          WHERE h.user_id = ? AND h.shares > 0 ORDER BY h.stock_id`,
        [userId]
    );
    const items = rows.map((r) => {
        const marketValue = Math.round(Number(r.current_price) * r.shares * 100) / 100;
        const cost = Number(r.cost_basis) || 0;
        const profit = Math.round((marketValue - cost) * 100) / 100;
        const profitPct = cost > 0 ? Math.round((profit / cost) * 10000) / 100 : 0;
        return {
            stockId: r.stock_id, name: r.name, symbol: r.symbol, shares: r.shares,
            avgCost: r.shares ? Math.round((cost / r.shares) * 100) / 100 : 0,
            price: Number(r.current_price), marketValue, cost: Math.round(cost * 100) / 100, profit, profitPct
        };
    });
    const marketValue = Math.round(items.reduce((s2, i) => s2 + i.marketValue, 0) * 100) / 100;
    const cost = Math.round(items.reduce((s2, i) => s2 + i.cost, 0) * 100) / 100;
    const profit = Math.round((marketValue - cost) * 100) / 100;
    const user = await db.get('SELECT COALESCE(contribution,0) AS cash FROM users WHERE id = ?', [userId]);
    const cash = Math.round((Number(user ? user.cash : 0)) * 100) / 100;
    return {
        items,
        summary: {
            marketValue,
            cost,
            profit,
            profitPct: cost > 0 ? Math.round((profit / cost) * 10000) / 100 : 0,
            cash,
            totalAssets: Math.round((marketValue + cash) * 100) / 100,
            // 赚损净额：当前浮动盈亏（持仓市值 - 持仓成本）
            netProfit: profit
        }
    };
}

/** 价格曲线（Chart.js 用）：最近 N 条成交价 + 收盘快照 */
async function history(stockId, limit = 40, range = '1d') {
    const RANGE_KEEP = { '1d': 0, '5d': 5, '1m': 30, '3m': 90, '1y': 365, all: 9999 };
    const keepDays = RANGE_KEEP[String(range)] !== undefined ? RANGE_KEEP[String(range)] : 0;
    const stock = await db.get('SELECT id, name, symbol, current_price FROM stocks WHERE id = ?', [stockId]);
    if (!stock) return null;
    const rows = await db.all(
        `SELECT price, recorded_at FROM stock_prices WHERE stock_id = ? ORDER BY id DESC LIMIT ?`,
        [stockId, Math.min(200, Math.max(5, Number(limit) || 40))]
    );
    const snapLimit = keepDays > 0 ? Math.min(400, keepDays) : 30;
    const snaps = await db.all(
        'SELECT day, close_price FROM stock_daily_snapshots WHERE stock_id = ? ORDER BY day DESC LIMIT ?',
        [stockId, snapLimit]
    );
    const trades = rows.reverse().map((r) => ({ label: String(r.recorded_at).slice(11, 16), price: Number(r.price) }));
    const closes = snaps.reverse().map((r) => ({ label: String(r.day).slice(5), price: Number(r.close_price) }));
    const lastSnap = snaps.length ? Number(snaps[snaps.length - 1].close_price) : Number(stock.current_price);
    return { stock, points: trades.length ? trades : closes, closes, yesterdayClose: lastSnap };
}

module.exports = {
    holdings,
    history,
    KEYS, DEFAULTS, getSettings, setSettings, calcDelta, taskFinishCount,
    settleByTask, buy, sell, snapshotDaily, quotes
};
