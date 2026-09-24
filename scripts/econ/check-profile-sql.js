/**
 * 校验 /api/mod/profile 用到的所有 SQL 在真实库上可执行（只读）
 * 用法：node scripts/econ/check-profile-sql.js "H:/chengxuyuanma/guanwang/guild (1).db"
 */
const sqlite3 = require('sqlite3');
const path = require('path');

const DB = process.argv[2] || path.join(__dirname, '..', '..', 'guild (1).db');
const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
const get = (s, p = []) => new Promise((r, j) => db.get(s, p, (e, x) => e ? j(e) : r(x)));

(async () => {
    // 找一个已绑定且已确认的 uuid
    const b = await get(`SELECT uuid, user_id FROM mod_bindings WHERE status='confirmed' LIMIT 1`);
    console.log('绑定样本:', b ? JSON.stringify(b) : '(无已确认绑定)');
    const uid = b ? b.user_id : 1;

    const checks = [
        ['users 表字段', `SELECT id, username, nickname, avatar, level, contribution, game_id, equipped_title FROM users WHERE id=?`, [uid]],
        ['排名', `SELECT COUNT(*) + 1 AS rank FROM users WHERE COALESCE(contribution,0) > COALESCE(?,0)`, [0]],
        ['成员总数', `SELECT COUNT(*) AS c FROM users WHERE is_frozen = 0`, []],
        ['今日', `SELECT DATE('now','localtime') AS d`, []],
        ['签到', `SELECT continuous_days, reward_points FROM checkins WHERE user_id=? AND checkin_date=?`, [uid, '2026-09-13']],
        ['称号', `SELECT t.name, t.color FROM users u LEFT JOIN titles t ON t.id = u.equipped_title WHERE u.id=? AND u.equipped_title IS NOT NULL`, [uid]],
        ['未读通知', `SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0`, [uid]],
        ['待审申报', `SELECT COUNT(*) AS c FROM contribution_claims WHERE user_id=? AND status='pending'`, [uid]],
        ['可接任务', `SELECT COUNT(*) AS c FROM tasks t WHERE t.is_active=1 AND NOT EXISTS (SELECT 1 FROM task_claims tc WHERE tc.task_id=t.id AND tc.user_id=?)`, [uid]],
        ['我的任务', `SELECT COUNT(*) AS c FROM task_claims WHERE user_id=? AND status='pending'`, [uid]],
        ['已完成任务', `SELECT COUNT(*) AS c FROM task_claims WHERE user_id=? AND status='completed'`, [uid]],
        ['在线人数', `SELECT COUNT(*) AS c FROM mod_online`, []],
    ];

    let fail = 0;
    for (const [name, sql, params] of checks) {
        try {
            const r = await get(sql, params);
            console.log(`  [ok]   ${name.padEnd(12)} → ${JSON.stringify(r)}`);
        } catch (e) {
            console.log(`  [FAIL] ${name.padEnd(12)} → ${e.message}`);
            fail++;
        }
    }

    // 申报状态取值范围
    const st = await new Promise((r) => db.all(`SELECT status, COUNT(*) c FROM contribution_claims GROUP BY status`, (e, x) => r(x || [])));
    console.log('contribution_claims.status 取值:', JSON.stringify(st));
    const g = await new Promise((r) => db.all(`SELECT generation, COUNT(*) c FROM users GROUP BY generation`, (e, x) => r(x || [])));
    console.log('users.generation 取值:', JSON.stringify(g));

    console.log(fail ? `\n=== ${fail} 项 SQL 不可用 ===` : '\n=== 全部 SQL 可用 ===');
    db.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
