/**
 * 迁移：扩展 notifications.type 的取值白名单
 *
 * 背景：notifications 建表时用 CHECK 约束写死了 type 白名单，不含 'system'/'title_grant'；
 * 管理员「头衔给予」写站内通知时会 SQLITE_CONSTRAINT（CHECK constraint failed）而静默失败。
 * SQLite 不支持直接修改 CHECK，只能重建表（notifications 无外键、无索引、无触发器，重建是安全的）。
 *
 * 用法：cd 官网根目录 && node scripts/migrate-notification-types.js
 */
const db = require('../database');

// 原白名单 + 新增：system（系统通知）、title_grant（头衔发放）、wiki（Wiki 发布）
const TYPES = [
    'post_daily', 'post_decision', 'comment', 'like', 'claim_result', 'task_reward',
    'transfer', 'favorite', 'follow', 'purchase', 'discipline', 'player_task',
    'chat', 'chat_mention', 'pay', 'system', 'title_grant', 'wiki'
];

const COLUMNS = 'id, user_id, type, title, content, post_id, comment_id, actor_id, is_read, created_at';

(async () => {
    const tableSql = `CREATE TABLE notifications_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN (${TYPES.map(t => `'${t}'`).join(', ')})),
                title TEXT,
                content TEXT,
                post_id INTEGER,
                comment_id INTEGER,
                actor_id INTEGER,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`;

    const before = await db.get('SELECT COUNT(*) AS c FROM notifications');
    console.log(`迁移前通知行数：${before.c}`);

    await db.transaction(async () => {
        await db.run('DROP TABLE IF EXISTS notifications_new');
        await db.run(tableSql);
        await db.run(`INSERT INTO notifications_new (${COLUMNS}) SELECT ${COLUMNS} FROM notifications`);
        await db.run('DROP TABLE notifications');
        await db.run('ALTER TABLE notifications_new RENAME TO notifications');
    });

    const after = await db.get('SELECT COUNT(*) AS c FROM notifications');
    console.log(`迁移后通知行数：${after.c}${Number(after.c) === Number(before.c) ? ' ✓ 一致' : ' ✗ 行数不一致，请检查备份！'}`);

    // 校验新白名单已生效
    try {
        const r = await db.run("INSERT INTO notifications (user_id, type, title, content) VALUES (1, 'title_grant', '__迁移自检__', '迁移自检')");
        await db.run('DELETE FROM notifications WHERE id = ?', [r.id]);
        console.log("CHECK 校验：'title_grant' 可写入 ✓（自检数据已删除）");
    } catch (e) {
        console.error("CHECK 校验失败：'title_grant' 仍不可写入 → " + e.message);
        process.exit(1);
    }

    console.log('迁移完成 ✓');
    process.exit(0);
})().catch(e => {
    console.error('迁移失败:', e.message);
    process.exit(1);
});
