const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/guild.db');
const db = new sqlite3.Database(DB_PATH);

console.log('开始添加QQ登录支持...');

db.serialize(() => {
    // 检查 users 表是否已有 openid 字段
    db.all("PRAGMA table_info(users)", (err, columns) => {
        if (err) {
            console.error('读取users表结构失败:', err);
            db.close();
            return;
        }

        const hasOpenid = columns.some(col => col.name === 'openid');
        if (hasOpenid) {
            console.log('openid 字段已存在，跳过迁移');
            finalize();
            return;
        }

        db.run('ALTER TABLE users ADD COLUMN openid TEXT', (err) => {
            if (err) {
                console.error('添加openid字段失败:', err);
            } else {
                console.log('openid 字段添加成功');
            }
            // ALTER 完成后创建唯一索引
            db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid ON users(openid) WHERE openid IS NOT NULL AND openid != ''", (err2) => {
                if (err2) console.error('创建openid索引失败:', err2);
                else console.log('openid 唯一索引创建成功');
                finalize();
            });
        });
    });
});

function finalize() {
    db.close();
    console.log('迁移完成！');
}
