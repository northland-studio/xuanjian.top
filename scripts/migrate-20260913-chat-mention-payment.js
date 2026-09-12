// 迁移：公屏@提及 + 私聊系统通知 + 缴费单流水口径
//  1) chat_messages 新增 mention_ids 列（@提及用户 ID，逗号分隔）
//  2) notifications 表 type CHECK 扩展 'chat'（私聊）/ 'chat_mention'（被@提及）
//  3) contribution_logs 表 type CHECK 扩展 'payment'（缴费单，区别于 'exchange' 外站兑换）
// 用法：先备份数据库，再执行 node scripts/migrate-20260913-chat-mention-payment.js
const path = require('path');
const db = require(path.join(__dirname, '..', 'database'));

async function hasColumn(table, col) {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    return rows.some(r => r.name === col);
}

(async () => {
    try {
        // ---- 1) chat_messages.mention_ids ----
        if (await hasColumn('chat_messages', 'mention_ids')) {
            console.log('[跳过] chat_messages 已含 mention_ids 列');
        } else {
            await db.run('ALTER TABLE chat_messages ADD COLUMN mention_ids TEXT');
            console.log('[完成] chat_messages 新增 mention_ids 列');
        }

        // ---- 2) notifications type CHECK 扩展 chat / chat_mention ----
        const notif = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='notifications'`);
        if (notif?.sql?.includes("'chat'") && notif?.sql?.includes("'chat_mention'")) {
            console.log('[跳过] notifications 已含 chat / chat_mention 类型');
        } else {
            await db.run('ALTER TABLE notifications RENAME TO notifications_old');
            await db.run(`CREATE TABLE notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN (
                  'post_daily','post_decision','comment','like','claim_result','task_reward',
                  'transfer','favorite','follow','purchase','discipline','player_task','chat','chat_mention'
                )),
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
            const n = await db.get('SELECT COUNT(*) AS c FROM notifications');
            console.log(`[完成] notifications CHECK 已扩展（chat / chat_mention），现有 ${n.c} 条记录`);
        }

        // ---- 3) contribution_logs type CHECK 扩展 payment ----
        const clog = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='contribution_logs'`);
        if (clog?.sql?.includes("'payment'")) {
            console.log('[跳过] contribution_logs 已含 payment 类型');
        } else {
            await db.run('ALTER TABLE contribution_logs RENAME TO contribution_logs_old');
            await db.run(`CREATE TABLE contribution_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('claim', 'task', 'transfer_in', 'transfer_out', 'purchase', 'reward', 'admin', 'player_task', 'transfer', 'title', 'discipline', 'post', 'exchange', 'payment')),
                ref_id INTEGER DEFAULT 0,
                note TEXT,
                balance_after INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`);
            await db.run(`INSERT INTO contribution_logs (id, user_id, amount, type, ref_id, note, balance_after, created_at)
                SELECT id, user_id, amount, type, ref_id, note, balance_after, created_at FROM contribution_logs_old`);
            await db.run('DROP TABLE contribution_logs_old');
            await db.run('CREATE INDEX IF NOT EXISTS idx_contribution_logs_user ON contribution_logs(user_id, created_at)');
            const n = await db.get('SELECT COUNT(*) AS c FROM contribution_logs');
            console.log(`[完成] contribution_logs CHECK 已扩展（payment），现有 ${n.c} 条记录`);
        }

        console.log('[完成] 全部迁移成功');
    } catch (e) {
        console.error('[失败] 迁移:', e.message);
        process.exit(1);
    } finally {
        db.close();
    }
})();
