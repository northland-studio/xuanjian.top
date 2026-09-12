/**
 * 迁移：2026-09-13 聊天增强
 *  1) chat_messages 增加 image_url / sticker_url / voice_url / voice_duration / expires_at
 *  2) 新建 chat_stickers（用户表情包）与 chat_stickers_public（全站公共表情包）
 * 幂等：可重复执行。
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_FILE
    ? path.resolve(process.cwd(), process.env.DB_FILE)
    : path.join(__dirname, '..', 'data', 'guild.db');
const db = new sqlite3.Database(DB_PATH);
console.log('[migrate] db =', DB_PATH);

const run = (sql) => new Promise((res, rej) => db.run(sql, (e) => e ? rej(e) : res()));
const all = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => e ? rej(e) : res(r)));

(async () => {
    try {
        console.log('[migrate] start');

        // 1) chat_messages 补列
        const cols = (await all('PRAGMA table_info(chat_messages)')).map(c => c.name);
        const add = async (name, ddl) => {
            if (!cols.includes(name)) {
                await run(`ALTER TABLE chat_messages ADD COLUMN ${ddl}`);
                console.log(`[migrate] chat_messages + ${name}`);
            }
        };
        await add('image_url', 'image_url TEXT');
        await add('sticker_url', 'sticker_url TEXT');
        await add('voice_url', 'voice_url TEXT');
        await add('voice_duration', 'voice_duration INTEGER');
        await add('expires_at', 'expires_at DATETIME');
        await run('CREATE INDEX IF NOT EXISTS idx_chat_expires ON chat_messages(expires_at)');

        // 2) 用户表情包
        await run(`
            CREATE TABLE IF NOT EXISTS chat_stickers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                url TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run('CREATE INDEX IF NOT EXISTS idx_stickers_user ON chat_stickers(user_id)');

        // 3) 全站公共表情包（管理员维护）
        await run(`
            CREATE TABLE IF NOT EXISTS chat_stickers_public (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                name TEXT DEFAULT '',
                sort_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[migrate] chat_stickers / chat_stickers_public ready');

        console.log('[migrate] done');
    } catch (e) {
        console.error('[migrate] failed:', e.message);
        process.exitCode = 1;
    } finally {
        db.close();
    }
})();
