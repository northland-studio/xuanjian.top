const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../data/guild.db');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

// 初始化数据库表
const initTables = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // 用户表
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    nickname TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    avatar TEXT DEFAULT '/uploads/default-avatar.png',
                    level INTEGER DEFAULT 0,
                    contribution INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 内容表（日报、决策、贴吧）
            db.run(`
                CREATE TABLE IF NOT EXISTS posts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('daily', 'decision', 'forum')),
                    author_id INTEGER NOT NULL,
                    tags TEXT,
                    images TEXT,
                    views INTEGER DEFAULT 0,
                    likes INTEGER DEFAULT 0,
                    comments_count INTEGER DEFAULT 0,
                    is_pinned INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (author_id) REFERENCES users(id)
                )
            `);

            // 评论表
            db.run(`
                CREATE TABLE IF NOT EXISTS comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id INTEGER NOT NULL,
                    author_id INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    parent_id INTEGER DEFAULT NULL,
                    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (post_id) REFERENCES posts(id),
                    FOREIGN KEY (author_id) REFERENCES users(id),
                    FOREIGN KEY (parent_id) REFERENCES comments(id)
                )
            `);

            // 点赞表
            db.run(`
                CREATE TABLE IF NOT EXISTS likes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (post_id) REFERENCES posts(id),
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    UNIQUE(post_id, user_id)
                )
            `);

            // 公告表
            db.run(`
                CREATE TABLE IF NOT EXISTS announcements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    is_popup INTEGER DEFAULT 1,
                    is_active INTEGER DEFAULT 1,
                    created_by INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (created_by) REFERENCES users(id)
                )
            `);

            // 系统设置表
            db.run(`
                CREATE TABLE IF NOT EXISTS settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            console.log('数据库表创建完成');
            resolve();
        });
    });
};

// 创建默认管理员账号
const createDefaultAdmin = async () => {
    const adminPassword = process.env.ADMIN_PASSWORD || 'xuanjian123';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    return new Promise((resolve, reject) => {
        db.get('SELECT id FROM users WHERE level = 2', (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            
            if (row) {
                console.log('超级管理员已存在');
                resolve();
                return;
            }
            
            db.run(
                `INSERT INTO users (username, nickname, email, password, level, contribution) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['admin', '系统管理员', 'admin@xuanjian.top', hashedPassword, 2, 9999],
                function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    console.log('超级管理员账号创建成功');
                    console.log('用户名: admin');
                    console.log('密码:', adminPassword);
                    resolve();
                }
            );
        });
    });
};

// 初始化默认设置
const initSettings = () => {
    return new Promise((resolve, reject) => {
        const defaultSettings = [
            { key: 'site_name', value: '我的世界玄剑公会' },
            { key: 'site_slogan', value: '探索无限可能，创造属于我们的世界' },
            { key: 'site_slogan_en', value: 'Explore Infinite Possibilities, Create Our World' }
        ];
        
        const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
        defaultSettings.forEach(setting => {
            stmt.run(setting.key, setting.value);
        });
        stmt.finalize();
        
        console.log('默认设置初始化完成');
        resolve();
    });
};

// 执行初始化
const init = async () => {
    try {
        await initTables();
        await createDefaultAdmin();
        await initSettings();
        console.log('数据库初始化完成！');
        db.close();
    } catch (error) {
        console.error('数据库初始化失败:', error);
        db.close();
        process.exit(1);
    }
};

init();
