/**
 * v2.2.0 数据迁移
 * 1. 重建 notifications 表：CHECK 约束加入新通知类型（task_reward / transfer / favorite / follow / task_remind）
 * 2. 创建贡献点审计日志表 contribution_logs（记录所有贡献点变动）
 * 3. 创建贡献点互转表 transfers
 * 4. 创建任务系统表 tasks / task_claims
 * 5. 创建收藏表 favorites、关注表 follows
 *
 * 运行：node scripts/migrate-v2.2.0.js
 */
require('dotenv').config();
const db = require('../database');

const NOTIF_TYPES = ['post_daily', 'post_decision', 'comment', 'like', 'claim_result', 'task_reward', 'transfer', 'favorite', 'follow'];

(async () => {
    await db.run('PRAGMA busy_timeout = 10000');

    // 1. 重建 notifications 表（扩展 CHECK）
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
                type TEXT NOT NULL CHECK (type IN (${NOTIF_TYPES.map(t => `'${t}'`).join(', ')})),
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
            console.log(`[完成] notifications 表已重建（CHECK 扩展新类型），现有 ${n.c} 条记录`);
        } catch (e) {
            await db.run('ROLLBACK');
            console.error('[失败] notifications 重建:', e.message);
            process.exit(1);
        }
    }

    // 2. 贡献点审计日志表
    await db.run(`CREATE TABLE IF NOT EXISTS contribution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('claim', 'task', 'transfer_in', 'transfer_out', 'purchase', 'reward', 'admin')),
        ref_id INTEGER DEFAULT 0,
        note TEXT,
        balance_after INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_contribution_logs_user ON contribution_logs(user_id, created_at)');
    console.log('[完成] contribution_logs 表就绪');

    // 3. 贡献点互转表
    await db.run(`CREATE TABLE IF NOT EXISTS transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user INTEGER NOT NULL,
        to_user INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_user) REFERENCES users(id),
        FOREIGN KEY (to_user) REFERENCES users(id)
    )`);
    console.log('[完成] transfers 表就绪');

    // 4. 任务系统表
    await db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        image TEXT,
        reward INTEGER NOT NULL DEFAULT 0,
        code TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS task_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
        code TEXT,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(task_id, user_id)
    )`);
    console.log('[完成] tasks / task_claims 表就绪');

    // 5. 收藏 / 关注表
    await db.run(`CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (post_id) REFERENCES posts(id),
        UNIQUE(user_id, post_id)
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id INTEGER NOT NULL,
        followee_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (follower_id) REFERENCES users(id),
        FOREIGN KEY (followee_id) REFERENCES users(id),
        UNIQUE(follower_id, followee_id)
    )`);
    console.log('[完成] favorites / follows 表就绪');

    db.close();
    console.log('v2.2.0 迁移全部完成');
})();
