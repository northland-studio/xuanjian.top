const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/guild.db');
const db = new sqlite3.Database(DB_PATH);

const migrate = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`
                ALTER TABLE user_items ADD COLUMN verification_code TEXT DEFAULT NULL
            `, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('添加 verification_code 列失败:', err);
                }
            });

            db.run(`
                ALTER TABLE user_items ADD COLUMN verified_at DATETIME DEFAULT NULL
            `, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('添加 verified_at 列失败:', err);
                }
            });

            db.run(`
                ALTER TABLE user_items ADD COLUMN verified_by INTEGER DEFAULT NULL
            `, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('添加 verified_by 列失败:', err);
                }
            });

            db.run(`
                CREATE INDEX IF NOT EXISTS idx_user_items_verification_code ON user_items(verification_code)
            `);

            console.log('核销功能数据库迁移完成');
            resolve();
        });
    });
};

const init = async () => {
    try {
        await migrate();
        console.log('核销功能迁移完成！');
        db.close();
    } catch (error) {
        console.error('迁移失败:', error);
        db.close();
        process.exit(1);
    }
};

init();
