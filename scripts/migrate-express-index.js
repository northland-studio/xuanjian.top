/**
 * 迁移：哲式动态指数系统
 *
 * - 新建三只股票：玄剑重工 / 玄剑建工 / 玄剑人力
 * - 删除旧股票与旧交易/价格/K线数据
 * - tasks 增加 stock_id（任务绑定板块）
 * - stock_daily_snapshots 每日收盘快照（昨日收盘虚线）
 * - stock_settlements 结算流水（可追溯每次 ΔP）
 * - settings 增加可配参数：哲指数、股价基准、活跃基准、买入费率、卖出费率
 */
const db = require('../database');

const DEFAULTS = {
    'express.zheIndex': '20',
    'express.priceBase': '5',
    'express.activeBase': '10',
    'express.buyFeeRate': '0.01',
    'express.sellTaxRate': '0.05',
    'express.floorPrice': '5'
};

const NEW_STOCKS = [
    { symbol: 'XJ-HEAVY', name: '玄剑重工', description: '生电机器、刷怪塔、熔炉组等工业类任务对应板块' },
    { symbol: 'XJ-BUILD', name: '玄剑建工', description: '奇观建筑、天穹仓库、道路规划等建筑类任务对应板块' },
    { symbol: 'XJ-LABOR', name: '玄剑人力', description: '开荒、平地、资源粗加工等基础劳动力任务对应板块' }
];

(async () => {
    console.log('=== 哲式动态指数系统迁移 ===');

    // 1. 参数默认值
    await db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    for (const [k, v] of Object.entries(DEFAULTS)) {
        const row = await db.get('SELECT key FROM settings WHERE key = ?', [k]);
        if (!row) await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
    }
    console.log('✓ 参数默认值 ' + Object.keys(DEFAULTS).length + ' 项');

    // 2. 清空旧股票数据（外键先关闭，避免旧交易/持仓阻挠）
    try { await db.run('PRAGMA foreign_keys = OFF'); } catch {}

    const oldCount = await db.get('SELECT COUNT(*) AS c FROM stocks');
    if (oldCount.c) {
        for (const t of ['stock_transactions', 'stock_prices', 'stock_ohlc']) {
            try { await db.run('DELETE FROM ' + t); } catch {}
        }
        await db.run('DELETE FROM stocks');
        console.log('✓ 已删除旧股票 ' + oldCount.c + ' 只及关联交易/价格/K线数据');
        try { await db.run('PRAGMA foreign_keys = ON'); } catch {}
    } else {
        console.log('✓ 旧股票已清空');
    }

    // 3. 新建三只板块股票
    let created = 0;
    for (const s of NEW_STOCKS) {
        const exists = await db.get('SELECT id FROM stocks WHERE symbol = ?', [s.symbol]);
        if (exists) continue;
        await db.run(
            `INSERT INTO stocks (symbol, name, description, base_price, current_price, total_shares, available_shares, volatility, trend, is_active)
             VALUES (?, ?, ?, 5, 5, 0, 0, 0, 0, 1)`,
            [s.symbol, s.name, s.description]
        );
        created++;
    }
    console.log('✓ 新建板块股票 ' + created + ' 只（基准价 5）');

    // 4. tasks 绑定板块
    const cols = await db.all('PRAGMA table_info(tasks)');
    if (!cols.some((c) => c.name === 'stock_id')) {
        await db.run('ALTER TABLE tasks ADD COLUMN stock_id INTEGER');
        console.log('✓ tasks.stock_id 已添加');
    } else {
        console.log('✓ tasks.stock_id 已存在');
    }

    // 5. 每日收盘快照
    await db.run(`CREATE TABLE IF NOT EXISTS stock_daily_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        open_price REAL,
        close_price REAL NOT NULL,
        delta_sum REAL NOT NULL DEFAULT 0,
        trade_count INTEGER NOT NULL DEFAULT 0,
        volume_value REAL NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (stock_id, day)
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_stock_snap_day ON stock_daily_snapshots(day)');
    console.log('✓ stock_daily_snapshots');

    // 6. 结算流水
    await db.run(`CREATE TABLE IF NOT EXISTS stock_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id INTEGER NOT NULL,
        task_id INTEGER,
        reward INTEGER NOT NULL,
        finish_count INTEGER NOT NULL,
        price_before REAL NOT NULL,
        price_after REAL NOT NULL,
        delta REAL NOT NULL,
        formula TEXT,
        operator_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_stock_settle_stock ON stock_settlements(stock_id, id DESC)');
    console.log('✓ stock_settlements');

    const stocks = await db.all('SELECT id, symbol, name, current_price, is_active FROM stocks ORDER BY id');
    console.log('=== 当前板块 ===');
    stocks.forEach((s) => console.log(`  [${s.id}] ${s.name} (${s.symbol}) 现价 ${s.current_price} 启用=${s.is_active}`));
    console.log('=== 完成 ===');
    process.exit(0);
})().catch((e) => {
    console.error('迁移失败：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
