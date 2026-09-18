/** 验证「无法购买气泡」根因：contribution_logs 的 CHECK 白名单是否含 'bubble' */
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', '..', 'guild (1).db');
const TMP = path.join(__dirname, '..', '..', 'reports', '_check-bubble.db');
fs.copyFileSync(SRC, TMP);

const db = new sqlite3.Database(TMP);
const run = (s, p = []) => new Promise((r, j) => db.run(s, p, function (e) { e ? j(e) : r(this); }));
const get = (s, p = []) => new Promise((r, j) => db.get(s, p, (e, x) => e ? j(e) : r(x)));

(async () => {
    const t = await get(`SELECT sql FROM sqlite_master WHERE name='contribution_logs'`);
    const has = /'bubble'/.test(t.sql);
    console.log(`contribution_logs CHECK 白名单含 'bubble'? ${has ? '是' : '否  ← 问题所在'}`);

    const bubbles = await db.all(`SELECT id, name, price, is_active FROM chat_bubbles`);
    console.log('chat_bubbles:', JSON.stringify(bubbles));

    const u = await get(`SELECT id, nickname, contribution FROM users WHERE contribution >= 50 ORDER BY contribution DESC LIMIT 1`);
    console.log(`测试用户: id=${u.id} ${u.nickname} 余额=${u.contribution}`);

    console.log('\n--- 模拟购买（与 routes/chat.js 完全相同的 INSERT）---');
    await run('BEGIN');
    try {
        await run('UPDATE users SET contribution = contribution - ? WHERE id=?', [50, u.id]);
        await run(
            'INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after) VALUES (?,?,?,?,?,?)',
            [u.id, -50, 'bubble', 2, '购买聊天气泡「清新绿」', 0]
        );
        await run('INSERT INTO user_bubbles (user_id, bubble_id) VALUES (?,?)', [u.id, 2]);
        await run('ROLLBACK');
        console.log('结果: 成功（无 CHECK 冲突）');
    } catch (e) {
        await run('ROLLBACK');
        console.log('结果: 失败 → ' + e.message);
    }

    console.log('\n--- 对照：把 type 换成白名单内的 purchase ---');
    await run('BEGIN');
    try {
        await run(
            'INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after) VALUES (?,?,?,?,?,?)',
            [u.id, -50, 'purchase', 2, '对照测试', 0]
        );
        await run('ROLLBACK');
        console.log('结果: 成功（证明只是 type 不在白名单）');
    } catch (e) {
        await run('ROLLBACK');
        console.log('结果: 失败 → ' + e.message);
    }

    db.close();
    fs.unlinkSync(TMP);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
