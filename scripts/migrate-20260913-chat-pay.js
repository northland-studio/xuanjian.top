/**
 * 迁移：2026-09-13 更新
 *  1) pay_orders 增加 subject / confirm_token（支付确认页）
 *  2) 新建 chat_messages（公屏/私聊消息）
 *  3) 新建 chat_bubbles（气泡样式，后台可管价）
 *  4) 新建 user_bubbles（用户已购气泡）
 * 幂等：可重复执行。
 * 用法：node scripts/migrate-20260913-chat-pay.js
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_FILE
    ? path.resolve(process.cwd(), process.env.DB_FILE)
    : path.join(__dirname, '..', 'data', 'guild.db');
const db = new sqlite3.Database(DB_PATH);
console.log('[migrate] db =', DB_PATH);

const run = (sql) => new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
});
const all = (sql) => new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
});

(async () => {
    try {
        console.log('[migrate] start');

        // ---- 1) pay_orders 补列 ----
        const cols = (await all('PRAGMA table_info(pay_orders)')).map(c => c.name);
        if (!cols.includes('subject')) {
            await run('ALTER TABLE pay_orders ADD COLUMN subject TEXT');
            console.log('[migrate] pay_orders + subject');
        }
        if (!cols.includes('confirm_token')) {
            await run('ALTER TABLE pay_orders ADD COLUMN confirm_token TEXT');
            console.log('[migrate] pay_orders + confirm_token');
        }
        await run('CREATE INDEX IF NOT EXISTS idx_pay_orders_confirm_token ON pay_orders(confirm_token)');

        // ---- 2) 聊天消息表 ----
        await run(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel TEXT NOT NULL DEFAULT 'public',
                sender_id INTEGER,
                receiver_id INTEGER,
                content TEXT NOT NULL,
                bubble_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run('CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel, id DESC)');
        await run('CREATE INDEX IF NOT EXISTS idx_chat_dm ON chat_messages(sender_id, receiver_id, id DESC)');
        console.log('[migrate] chat_messages ready');

        // ---- 3) 气泡表（后台可改价）----
        await run(`
            CREATE TABLE IF NOT EXISTS chat_bubbles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                bg_color TEXT NOT NULL DEFAULT '#e8f0fe',
                text_color TEXT NOT NULL DEFAULT '#1a3d7c',
                border_color TEXT DEFAULT '',
                price INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run(`
            CREATE TABLE IF NOT EXISTS user_bubbles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                bubble_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, bubble_id)
            )
        `);
        await run('CREATE INDEX IF NOT EXISTS idx_user_bubbles ON user_bubbles(user_id)');
        console.log('[migrate] chat_bubbles/user_bubbles ready');

        // ---- 4) 默认气泡（仅当表为空时插入）----
        const cnt = await new Promise((res, rej) => db.get('SELECT COUNT(*) c FROM chat_bubbles', (e, r) => e ? rej(e) : res(r.c)));
        if (!cnt) {
            const defaults = [
                ['默认', '#e8f0fe', '#1a3d7c', '', 0, 1, 0],
                ['清新绿', '#e6f7ee', '#12704a', '#b7e4cd', 50, 1, 1],
                ['暖阳橙', '#fff3e0', '#a35a00', '#ffd9a8', 100, 1, 2],
                ['樱花粉', '#ffeef4', '#a3215b', '#ffc9dd', 150, 1, 3],
                ['星空紫', '#f3e8ff', '#5b21b6', '#d8b4fe', 200, 1, 4],
                ['烈焰红', '#ffeaea', '#a11d1d', '#ffbdbd', 300, 1, 5],
            ];
            for (const d of defaults) {
                await new Promise((res, rej) => db.run(
                    'INSERT INTO chat_bubbles (name, bg_color, text_color, border_color, price, is_active, sort_order) VALUES (?,?,?,?,?,?,?)',
                    d, (e) => e ? rej(e) : res()
                ));
            }
            console.log('[migrate] default bubbles inserted:', defaults.length);
        } else {
            console.log('[migrate] bubbles exist, skip defaults');
        }

        console.log('[migrate] done');
    } catch (e) {
        console.error('[migrate] failed:', e.message);
        process.exitCode = 1;
    } finally {
        db.close();
    }
})();
