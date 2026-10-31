/**
 * 迁移：股票持仓表
 */
const db = require('../database');

(async () => {
    await db.run(`CREATE TABLE IF NOT EXISTS stock_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stock_id INTEGER NOT NULL,
        shares INTEGER NOT NULL DEFAULT 0,
        cost_basis REAL NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, stock_id)
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_holdings_user ON stock_holdings(user_id)');
    const c = await db.get('SELECT COUNT(*) AS c FROM stock_holdings');
    console.log('✓ stock_holdings 就绪，现有持仓行数：' + c.c);
    process.exit(0);
})().catch((e) => { console.error('迁移失败：' + e.message); process.exit(1); });
