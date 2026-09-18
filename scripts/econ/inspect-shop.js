/** 巡检：商店/称号/任务等与「营业额」相关的表结构与数据 */
const sqlite3 = require('sqlite3');
const path = require('path');

const DB = process.argv[2] || path.join(__dirname, '..', '..', 'guild (1).db');
const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
const all = (s, p = []) => new Promise((r, j) => db.all(s, p, (e, x) => e ? j(e) : r(x)));

(async () => {
    for (const t of ['shop_items', 'user_items', 'titles', 'user_titles', 'player_tasks', 'tasks', 'transfers']) {
        const r = await all('SELECT sql FROM sqlite_master WHERE name=?', [t]);
        console.log(`\n--- ${t} ---`);
        console.log(r[0] ? r[0].sql : '(缺失)');
    }

    console.log('\n=== shop_items 全部数据 ===');
    console.log(JSON.stringify(await all('SELECT * FROM shop_items'), null, 1));

    console.log('\n=== titles 全部数据 ===');
    console.log(JSON.stringify(await all('SELECT * FROM titles'), null, 1));

    console.log('\n=== contribution_logs: type=purchase 按 ref_id 汇总 ===');
    const pur = await all(`SELECT ref_id, COUNT(*) n, SUM(-amount) revenue, MIN(created_at) first_at, MAX(created_at) last_at
                           FROM contribution_logs WHERE type='purchase' GROUP BY ref_id ORDER BY revenue DESC`);
    console.log(JSON.stringify(pur, null, 1));

    console.log('\n=== contribution_logs: type=title 按 ref_id ===');
    const tit = await all(`SELECT ref_id, COUNT(*) n, SUM(-amount) revenue, MIN(created_at) first_at, MAX(created_at) last_at
                           FROM contribution_logs WHERE type='title' GROUP BY ref_id`);
    console.log(JSON.stringify(tit, null, 1));

    db.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
