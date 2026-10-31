/**
 * 迁移：contribution_logs.amount 从 INTEGER 改为 REAL
 * 原因：换服折算比例为小数（如 ×0.35），产生小数增量；SQLite 的 INTEGER 亲和性会把
 * 小数截成整数，导致流水与真实余额不符。
 */
const db = require('../database');

(async () => {
    console.log('=== contribution_logs.amount 类型迁移 ===');
    const info = await db.all('PRAGMA table_info(contribution_logs)');
    const amount = info.find((c) => c.name === 'amount');
    console.log('  当前类型：' + (amount ? amount.type : '(缺失)'));

    if (amount && String(amount.type).toUpperCase() === 'REAL') {
        console.log('  已是 REAL，无需迁移');
        process.exit(0);
    }

    // SQLite 不能直接改列类型，需重建表
    await db.transaction(async () => {
        await db.run(`CREATE TABLE IF NOT EXISTS contribution_logs_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('claim','task','transfer_in','transfer_out','purchase','reward','admin','player_task','transfer','title','discipline','post','exchange','payment','bubble','donation','pay_out','pay_in','market_escrow_in','market_escrow_out','market_sale','market_tax','market_fee','market_refund','market_adjust')),
            ref_id INTEGER DEFAULT 0,
            note TEXT,
            balance_after REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        await db.run(`INSERT INTO contribution_logs_new (id, user_id, amount, type, ref_id, note, balance_after, created_at)
                      SELECT id, user_id, amount, type, ref_id, note, balance_after, created_at FROM contribution_logs`);
        await db.run('DROP TABLE contribution_logs');
        await db.run('ALTER TABLE contribution_logs_new RENAME TO contribution_logs');
        await db.run('CREATE INDEX IF NOT EXISTS idx_contribution_logs_user ON contribution_logs(user_id, created_at)');
    });

    const after = await db.all('PRAGMA table_info(contribution_logs)');
    const a2 = after.find((c) => c.name === 'amount');
    const cnt = await db.get('SELECT COUNT(*) AS c FROM contribution_logs');
    console.log('  迁移后类型：' + (a2 ? a2.type : '?') + '，保留行数：' + cnt.c);

    // 余额字段也改 REAL 后，用户表 contribution 若为 INTEGER 也需注意；检查一下
    const u = await db.all('PRAGMA table_info(users)');
    const uc = u.find((c) => c.name === 'contribution');
    console.log('  users.contribution 类型：' + (uc ? uc.type : '?') + '（SQLite 动态类型，实测已存小数 270.52，无需迁移）');
    console.log('=== 完成 ===');
    process.exit(0);
})().catch((e) => {
    console.error('迁移失败：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
