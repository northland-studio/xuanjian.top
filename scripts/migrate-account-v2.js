const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'guild.db');
const db = new sqlite3.Database(DB_PATH);

console.log('开始账户体系V2迁移...');

db.serialize(() => {
    // 1. 重建 users 表：email 改为可空（新用户QQ注册后可留空，手动绑定）
    db.all("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'", (err, rows) => {
        if (err) { console.error('查询users表失败:', err); db.close(); return; }

        const createSql = rows[0].sql;
        const emailNullable = !/email TEXT UNIQUE NOT NULL/.test(createSql);

        if (!emailNullable) {
            console.log('users.email 当前为 NOT NULL，开始重建表...');
            db.run('PRAGMA foreign_keys=OFF', (err2) => {
                if (err2) console.error('关闭外键失败:', err2);
                db.run(`
                    CREATE TABLE users_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT UNIQUE NOT NULL,
                        nickname TEXT NOT NULL,
                        email TEXT UNIQUE,
                        password TEXT NOT NULL,
                        avatar TEXT DEFAULT '/uploads/default-avatar.png',
                        level INTEGER DEFAULT 0,
                        contribution INTEGER DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        email_verified INTEGER DEFAULT 0,
                        equipped_title INTEGER DEFAULT NULL,
                        openid TEXT
                    )
                `, (err3) => {
                    if (err3) { console.error('创建users_new失败:', err3); db.close(); return; }
                    console.log('users_new 表创建成功');
                    db.run(`
                        INSERT INTO users_new (id, username, nickname, email, password, avatar, level, contribution, created_at, updated_at, email_verified, equipped_title, openid)
                        SELECT id, username, nickname, email, password, avatar, level, contribution, created_at, updated_at, email_verified, equipped_title, openid FROM users
                    `, (err4) => {
                        if (err4) { console.error('复制数据失败:', err4); db.close(); return; }
                        console.log('数据复制成功');
                        db.run('DROP TABLE users', (err5) => {
                            if (err5) { console.error('删除旧表失败:', err5); db.close(); return; }
                            db.run('ALTER TABLE users_new RENAME TO users', (err6) => {
                                if (err6) { console.error('重命名失败:', err6); db.close(); return; }
                                console.log('users 表重建成功（email 可空）');
                                finalizeSteps();
                            });
                        });
                    });
                });
            });
        } else {
            console.log('users.email 已可空，跳过重建');
            finalizeSteps();
        }
    });

    function finalizeSteps() {
        // 2. 创建 openid 唯一索引（若不存在）
        db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid ON users(openid) WHERE openid IS NOT NULL AND openid != ''", (err) => {
            if (err) console.error('创建openid索引失败:', err);
            else console.log('openid 唯一索引已确认');
        });

        // 3. 所有账户贡献点归零
        db.run('UPDATE users SET contribution = 0', (err) => {
            if (err) console.error('贡献点归零失败:', err);
            else console.log('所有账户贡献点已归零');
        });

        // 4. 停用股票模块（隐藏，保留数据）
        db.run('UPDATE stocks SET is_active = 0', (err) => {
            if (err) console.error('停用股票失败:', err);
            else console.log('所有股票已停用');
        });

        setTimeout(() => {
            db.close();
            console.log('账户体系V2迁移完成！');
        }, 500);
    }
});
