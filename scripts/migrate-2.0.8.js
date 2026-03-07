const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/guild.db');
const db = new sqlite3.Database(DB_PATH);

const migrate = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS titles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    color TEXT DEFAULT '#6366f1',
                    price INTEGER DEFAULT 0,
                    is_preset INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            db.run(`
                CREATE TABLE IF NOT EXISTS user_titles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    title_id INTEGER NOT NULL,
                    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (title_id) REFERENCES titles(id),
                    UNIQUE(user_id, title_id)
                )
            `);

            db.run(`ALTER TABLE users ADD COLUMN equipped_title INTEGER DEFAULT NULL`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('添加 equipped_title 列失败:', err);
                }
            });

            db.run(`
                CREATE TABLE IF NOT EXISTS password_resets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    email TEXT NOT NULL,
                    token TEXT NOT NULL,
                    expires_at DATETIME NOT NULL,
                    used INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `);

            db.run(`
                CREATE TABLE IF NOT EXISTS contribution_claims (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    amount INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    evidence TEXT,
                    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
                    reviewed_by INTEGER,
                    review_note TEXT,
                    reviewed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (reviewed_by) REFERENCES users(id)
                )
            `);

            db.run(`
                CREATE TABLE IF NOT EXISTS shop_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    type TEXT NOT NULL CHECK(type IN ('title', 'other')),
                    ref_id INTEGER,
                    price INTEGER NOT NULL,
                    image TEXT,
                    stock INTEGER DEFAULT -1,
                    is_active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            db.run(`
                CREATE TABLE IF NOT EXISTS user_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    item_id INTEGER NOT NULL,
                    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (item_id) REFERENCES shop_items(id)
                )
            `);

            db.run(`
                CREATE TABLE IF NOT EXISTS rankings_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL,
                    data TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            console.log('数据库迁移完成');
            resolve();
        });
    });
};

const insertDefaultTitles = () => {
    return new Promise((resolve, reject) => {
        const defaultTitles = [
            { name: '玄剑元老', description: '公会创始成员', color: '#f59e0b', price: 0, is_preset: 1 },
            { name: '贡献之星', description: '贡献点达到1000', color: '#10b981', price: 0, is_preset: 1 },
            { name: '签到达人', description: '连续签到30天', color: '#8b5cf6', price: 0, is_preset: 1 },
            { name: '股神', description: '股票盈利超过500', color: '#ef4444', price: 0, is_preset: 1 },
            { name: '贴吧大佬', description: '发布帖子超过50篇', color: '#3b82f6', price: 0, is_preset: 1 },
            { name: '人气王', description: '获得点赞超过100', color: '#ec4899', price: 0, is_preset: 1 },
        ];

        const stmt = db.prepare(`
            INSERT OR IGNORE INTO titles (name, description, color, price, is_preset) 
            VALUES (?, ?, ?, ?, ?)
        `);

        defaultTitles.forEach(t => {
            stmt.run(t.name, t.description, t.color, t.price, t.is_preset);
        });

        stmt.finalize();
        console.log('默认称号插入完成');
        resolve();
    });
};

const init = async () => {
    try {
        await migrate();
        await insertDefaultTitles();
        console.log('v2.0.8 数据库迁移完成！');
        db.close();
    } catch (error) {
        console.error('迁移失败:', error);
        db.close();
        process.exit(1);
    }
};

init();
