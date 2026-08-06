/**
 * v2.0.1 数据迁移
 * 1. 重建 notifications 表：CHECK 约束加入 'claim_result'，修复申报审核通知创建失败
 * 2. 修复 contribution 为 NULL 的用户：补发其已通过申报的贡献点
 *
 * 运行：node scripts/migrate-v2.0.1.js
 */
require('dotenv').config();
const db = require('../database');

(async () => {
    await db.run('PRAGMA busy_timeout = 10000');

    // 1. 重建 notifications 表
    const cols = await db.all('PRAGMA table_info(notifications)');
    if (!cols.some(c => c.name === 'type')) {
        console.log('[跳过] notifications 表不存在');
    } else {
        await db.run('BEGIN');
        try {
            await db.run('ALTER TABLE notifications RENAME TO notifications_old');
            await db.run(`CREATE TABLE notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('post_daily', 'post_decision', 'comment', 'like', 'claim_result')),
                title TEXT,
                content TEXT,
                post_id INTEGER,
                comment_id INTEGER,
                actor_id INTEGER,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            await db.run(`INSERT INTO notifications (id, user_id, type, title, content, post_id, comment_id, actor_id, is_read, created_at)
                SELECT id, user_id, type, title, content, post_id, comment_id, actor_id, is_read, created_at FROM notifications_old`);
            await db.run('DROP TABLE notifications_old');
            await db.run('COMMIT');
            const n = await db.get('SELECT COUNT(*) c FROM notifications');
            console.log(`[完成] notifications 表已重建（CHECK 加入 claim_result），现有 ${n.c} 条记录`);
        } catch (e) {
            await db.run('ROLLBACK');
            console.error('[失败] notifications 重建:', e.message);
            process.exit(1);
        }
    }

    // 2. 修复 contribution 为 NULL 的用户
    const nullUsers = await db.all('SELECT id, username FROM users WHERE contribution IS NULL');
    console.log(`\ncontribution 为 NULL 的用户: ${nullUsers.length} 个`);
    let fixed = 0;
    for (const u of nullUsers) {
        const sum = await db.get(
            `SELECT COALESCE(SUM(amount), 0) s FROM contribution_claims WHERE user_id = ? AND status = 'approved'`,
            [u.id]
        );
        await db.run('UPDATE users SET contribution = ? WHERE id = ?', [sum.s, u.id]);
        console.log(`[修复] ${u.username}(id=${u.id}) contribution 0 -> ${sum.s}`);
        fixed++;
    }
    console.log(`[完成] 已修复 ${fixed} 个用户的贡献点`);

    db.close();
})();
