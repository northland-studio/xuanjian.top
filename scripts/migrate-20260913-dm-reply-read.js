// 迁移：私聊「回复引用」与「已读回执」
//  1) chat_messages 新增 reply_to_id  （引用回复的原消息 ID）
//  2) chat_messages 新增 read_at      （被对方读取的时间；NULL = 未读）
//  3) 补索引：按会话+未读查询、按被引用消息查询
// 用法：先备份数据库，再执行 node scripts/migrate-20260913-dm-reply-read.js
const path = require('path');
const db = require(path.join(__dirname, '..', 'database'));

async function hasColumn(table, col) {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    return rows.some(r => r.name === col);
}

(async () => {
    try {
        if (await hasColumn('chat_messages', 'reply_to_id')) {
            console.log('[跳过] chat_messages 已含 reply_to_id 列');
        } else {
            await db.run('ALTER TABLE chat_messages ADD COLUMN reply_to_id INTEGER');
            console.log('[完成] chat_messages 新增 reply_to_id 列');
        }

        if (await hasColumn('chat_messages', 'read_at')) {
            console.log('[跳过] chat_messages 已含 read_at 列');
        } else {
            await db.run('ALTER TABLE chat_messages ADD COLUMN read_at DATETIME');
            console.log('[完成] chat_messages 新增 read_at 列');
        }

        await db.run('CREATE INDEX IF NOT EXISTS idx_chat_dm_unread ON chat_messages(receiver_id, read_at)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_chat_reply ON chat_messages(reply_to_id)');
        console.log('[完成] 索引就绪');

        const n = await db.get('SELECT COUNT(*) AS c FROM chat_messages');
        console.log(`[完成] 迁移成功，chat_messages 现有 ${n.c} 条记录`);
    } catch (e) {
        console.error('[失败] 迁移:', e.message);
        process.exit(1);
    } finally {
        db.close();
    }
})();
