/**
 * 迁移：换服贡献点折算
 *
 * 表：
 *  - contribution_conversions        折算批次（状态、模式、区间配置、统计）
 *  - contribution_conversion_items  批次下的逐人明细（折算前后值，用于预览/撤销）
 *
 * 幂等：可重复执行。
 */
const db = require('../database');

const TABLES = [
    `CREATE TABLE IF NOT EXISTS contribution_conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL CHECK (mode IN ('uniform','tiers')),
        status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','applied','reverted')),
        uniform_ratio REAL,
        tiers TEXT,
        scope TEXT NOT NULL DEFAULT 'positive',
        exclude_ids TEXT,
        round_mode TEXT NOT NULL DEFAULT 'round',
        min_result INTEGER NOT NULL DEFAULT 0,
        affected INTEGER NOT NULL DEFAULT 0,
        total_before REAL NOT NULL DEFAULT 0,
        total_after REAL NOT NULL DEFAULT 0,
        note TEXT,
        operator_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        applied_at DATETIME,
        reverted_at DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS contribution_conversion_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversion_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        username TEXT,
        nickname TEXT,
        rank INTEGER,
        before_value REAL NOT NULL,
        ratio REAL NOT NULL,
        after_value REAL NOT NULL,
        delta REAL NOT NULL,
        log_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (conversion_id, user_id)
    )`
];

const INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_conv_status ON contribution_conversions(status, id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_conv_items_conv ON contribution_conversion_items(conversion_id)',
    'CREATE INDEX IF NOT EXISTS idx_conv_items_user ON contribution_conversion_items(user_id)'
];

(async () => {
    console.log('=== 换服折算迁移 ===');
    for (const sql of TABLES) await db.run(sql);
    console.log('✓ 业务表 2 张');
    for (const sql of INDEXES) await db.run(sql);
    console.log('✓ 索引 3 个');

    const cols = await db.all('PRAGMA table_info(contribution_conversions)');
    console.log('✓ 字段：' + cols.map((c) => c.name).join(', '));

    const cnt = await db.get('SELECT COUNT(*) AS c FROM contribution_conversions');
    console.log('✓ 现有批次：' + cnt.c);
    console.log('=== 完成 ===');
    process.exit(0);
})().catch((e) => {
    console.error('迁移失败：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
