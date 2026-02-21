const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/guild.db');
const db = new sqlite3.Database(DB_PATH);

// 迁移：添加email_verified字段到users表
async function migrate() {
    try {
        // 检查字段是否已存在
        const columns = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(users)", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const hasEmailVerified = columns.some(col => col.name === 'email_verified');

        if (!hasEmailVerified) {
            console.log('添加 email_verified 字段到 users 表...');
            await new Promise((resolve, reject) => {
                db.run('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log('✓ 字段添加成功');
        } else {
            console.log('email_verified 字段已存在，跳过');
        }

        // 检查verification_codes表是否存在
        const tables = await new Promise((resolve, reject) => {
            db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='verification_codes'", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (tables.length === 0) {
            console.log('创建 verification_codes 表...');
            await new Promise((resolve, reject) => {
                db.run(`
                    CREATE TABLE verification_codes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email TEXT NOT NULL,
                        code TEXT NOT NULL,
                        type TEXT NOT NULL,
                        expires_at DATETIME NOT NULL,
                        used INTEGER DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log('✓ 表创建成功');
        } else {
            console.log('verification_codes 表已存在，跳过');
        }

        console.log('数据库迁移完成！');
        db.close();
    } catch (error) {
        console.error('迁移失败:', error);
        db.close();
        process.exit(1);
    }
}

migrate();
