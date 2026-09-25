// 贡献点扫码支付：表结构 + 系统金库账户
// 用法：node scripts/migrate-pay.js
// 幂等：全部 IF NOT EXISTS；金库账户已存在则复用
//
// 设计见 docs/PAY-QR-DESIGN.md：
//   pay_payees       收款主体（user / event / system）
//   pay_intents      付款意图（token 即二维码内容；三种码共用）
//   pay_transactions 资金流水（对账唯一依据，不可变）
//   pay_charges      缴费单（一码多人，已付/未付由流水聚合）
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'guild.db');
const db = new sqlite3.Database(DB_PATH);
const run = (sql, args = []) => new Promise((res, rej) => db.run(sql, args, function (e) { e ? rej(e) : res(this); }));
const get = (sql, args = []) => new Promise((res, rej) => db.get(sql, args, (e, r) => (e ? rej(e) : res(r))));
const all = (sql, args = []) => new Promise((res, rej) => db.all(sql, args, (e, r) => (e ? rej(e) : res(r))));

/**
 * 扩展某表 type 列的 CHECK 白名单（幂等）
 * contribution_logs.type / notifications.type 都有 CHECK 约束，不扩展会 SQLITE_CONSTRAINT
 */
async function extendEnum(table, extraTypes) {
    const row = await get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
    if (!row || !row.sql) return `${table}: 表不存在，跳过`;
    const m = row.sql.match(/type\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*type\s+IN\s*\(([^)]*)\)\s*\)/i);
    if (!m) return `${table}: type 无 CHECK 约束，无需扩展`;
    const current = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    const missing = extraTypes.filter(t => !current.includes(t));
    if (missing.length === 0) return `${table}: 已包含 ${extraTypes.join('/')}，无需扩展`;

    const merged = [...current, ...missing];
    const newSql = row.sql.replace(m[0], `type TEXT NOT NULL CHECK (type IN (${merged.map(t => `'${t}'`).join(', ')}))`);
    const cols = (await all(`PRAGMA table_info(${table})`)).map(c => c.name).join(', ');
    const indexes = await all(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL", [table]
    );

    await run('BEGIN');
    try {
        await run(`ALTER TABLE ${table} RENAME TO ${table}_paybak`);
        await run(newSql);
        await run(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM ${table}_paybak`);
        await run(`DROP TABLE ${table}_paybak`);
        for (const idx of indexes) { try { await run(idx.sql); } catch (_) { } }
        await run('COMMIT');
    } catch (e) {
        await run('ROLLBACK');
        throw new Error(`扩展 ${table} 白名单失败: ${e.message}`);
    }
    return `${table}: 已补充 ${missing.join('/')}（共 ${merged.length} 种类型）`;
}

/** 系统金库账户名（决策 1） */
const VAULT_NAME = '玄剑财政';
const VAULT_USERNAME = 'guild_treasury';

(async () => {
    console.log(`数据库: ${DB_PATH}`);

    await run(`CREATE TABLE IF NOT EXISTS pay_payees (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        type          TEXT NOT NULL,
        user_id       INTEGER,
        system_key    TEXT,
        display_name  TEXT NOT NULL,
        owner_user_id INTEGER,
        status        TEXT NOT NULL DEFAULT 'active',
        created_at    TEXT NOT NULL
    )`);

    await run(`CREATE TABLE IF NOT EXISTS pay_intents (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        token         TEXT NOT NULL UNIQUE,
        kind          TEXT NOT NULL,
        payee_id      INTEGER NOT NULL,
        payer_user_id INTEGER,
        amount        REAL,
        note          TEXT,
        expires_at    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'created',
        scanned_by    INTEGER,
        created_by    INTEGER NOT NULL,
        created_at    TEXT NOT NULL,
        paid_at       TEXT,
        paid_tx_id    INTEGER,
        meta          TEXT
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_pay_intents_token ON pay_intents(token)');
    await run('CREATE INDEX IF NOT EXISTS idx_pay_intents_status ON pay_intents(status, expires_at)');

    await run(`CREATE TABLE IF NOT EXISTS pay_transactions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        intent_id     INTEGER,
        from_user_id  INTEGER,
        to_payee_id   INTEGER NOT NULL,
        amount        REAL NOT NULL,
        note          TEXT,
        status        TEXT NOT NULL,
        approver_id   INTEGER,
        ip            TEXT,
        user_agent    TEXT,
        created_at    TEXT NOT NULL,
        settled_at    TEXT
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_pay_tx_from ON pay_transactions(from_user_id, created_at)');
    await run('CREATE INDEX IF NOT EXISTS idx_pay_tx_status ON pay_transactions(status)');

    await run(`CREATE TABLE IF NOT EXISTS pay_charges (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        intent_id     INTEGER NOT NULL,
        user_id       INTEGER,
        player_name   TEXT,
        amount        REAL NOT NULL,
        status        TEXT NOT NULL DEFAULT 'unpaid',
        paid_tx_id    INTEGER,
        updated_at    TEXT NOT NULL
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_pay_charges_intent ON pay_charges(intent_id)');

    // 流水日志类型白名单：pay_out / pay_in；通知类型白名单：pay
    console.log('  ' + await extendEnum('contribution_logs', ['pay_out', 'pay_in']));
    console.log('  ' + await extendEnum('notifications', ['pay']));

    // 系统金库账户（决策 1：公会官方收款单独一个账户，不进任何个人余额）
    let vault = await get('SELECT id, nickname, contribution FROM users WHERE username = ?', [VAULT_USERNAME]);
    if (!vault) {
        const r = await run(
            `INSERT INTO users (username, nickname, password, contribution, created_at)
             VALUES (?, ?, ?, 0, datetime('now','localtime'))`,
            [VAULT_USERNAME, VAULT_NAME, '!locked-no-login!']
        );
        vault = { id: r.lastID, nickname: VAULT_NAME, contribution: 0 };
        console.log(`  ✓ 已创建系统金库账户「${VAULT_NAME}」(users.id=${r.lastID}, username=${VAULT_USERNAME})`);
    } else {
        console.log(`  — 系统金库账户已存在：users.id=${vault.id}「${vault.nickname}」余额 ${vault.contribution}`);
    }

    let payee = await get("SELECT id FROM pay_payees WHERE type = 'system' AND system_key = 'guild_treasury'");
    if (!payee) {
        const r = await run(
            `INSERT INTO pay_payees (type, user_id, system_key, display_name, owner_user_id, status, created_at)
             VALUES ('system', ?, 'guild_treasury', ?, NULL, 'active', datetime('now','localtime'))`,
            [vault.id, VAULT_NAME]
        );
        console.log(`  ✓ 已登记收款主体：system 金库 payee_id=${r.lastID}`);
    } else {
        console.log(`  — 金库收款主体已存在 payee_id=${payee.id}`);
    }

    const tables = await new Promise((res, rej) =>
        db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pay_%' ORDER BY name", (e, r) => e ? rej(e) : res(r)));
    console.log('');
    console.log('  已就绪的表: ' + tables.map(t => t.name).join(', '));
    console.log('  触发器（两位小数）: ' + ((await get("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_users_contribution_2dp'")) ? '存在 ✓' : '缺失 ✗'));
    console.log('✓ 完成');
    db.close();
})().catch(e => { console.error('迁移失败:', e.message); process.exitCode = 1; db.close(); });
