/**
 * 巡检导出库：列出表结构与关键表的时间跨度、行数（只读）
 * 用法：node scripts/econ/inspect-db.js "H:/chengxuyuanma/guanwang/guild (1).db"
 */
const sqlite3 = require('sqlite3');

const DB = process.argv[2];
if (!DB) {
    console.error('请传入数据库路径');
    process.exit(1);
}

const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);

const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));

(async () => {
    const tables = await all(`SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name`);
    console.log('=== 表清单 ===');
    for (const t of tables) {
        const c = await get(`SELECT COUNT(*) AS c FROM "${t.name}"`);
        console.log(`  ${t.name.padEnd(28)} rows=${c.c}`);
    }

    const want = ['contribution_logs', 'users', 'checkins', 'task_claims', 'shop_items', 'shop_purchases',
        'shop_orders', 'titles', 'user_titles', 'transfers', 'contribution_claims', 'player_tasks'];
    console.log('\n=== 关键表结构 ===');
    for (const t of want) {
        const row = tables.find(x => x.name === t);
        if (!row) { console.log(`  [缺失] ${t}`); continue; }
        console.log(`\n--- ${t} ---`);
        console.log(row.sql);
    }

    console.log('\n=== 时间跨度 ===');
    const spans = [
        ['contribution_logs', 'created_at'],
        ['users', 'created_at'],
        ['checkins', 'checkin_date'],
        ['task_claims', 'created_at'],
        ['shop_items', 'created_at'],
    ];
    for (const [t, col] of spans) {
        if (!tables.find(x => x.name === t)) continue;
        try {
            const r = await get(`SELECT MIN(${col}) AS mn, MAX(${col}) AS mx FROM ${t}`);
            console.log(`  ${t}.${col}: ${r.mn} ~ ${r.mx}`);
        } catch (e) {
            console.log(`  ${t}.${col}: 查询失败 ${e.message}`);
        }
    }

    console.log('\n=== contribution_logs 按类型 ===');
    const types = await all(`SELECT type, COUNT(*) c, SUM(amount) s FROM contribution_logs GROUP BY type ORDER BY c DESC`);
    types.forEach(t => console.log(`  ${String(t.type).padEnd(14)} n=${String(t.c).padStart(5)} sum=${t.s}`));

    console.log('\n=== contribution_logs 按月 ===');
    const months = await all(`SELECT substr(created_at,1,7) AS m, COUNT(*) c FROM contribution_logs GROUP BY m ORDER BY m`);
    months.forEach(m => console.log(`  ${m.m}: ${m.c}`));

    db.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
