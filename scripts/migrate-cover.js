const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'guild.db');
const db = new sqlite3.Database(DB_PATH);

console.log('开始添加用户封面字段迁移...');

db.serialize(() => {
    db.all("PRAGMA table_info(users)", (err, columns) => {
        if (err) {
            console.error('读取users表结构失败:', err);
            db.close();
            return;
        }
        const hasCover = columns.some(col => col.name === 'cover');
        if (hasCover) {
            console.log('cover 字段已存在，跳过迁移');
        } else {
            db.run("ALTER TABLE users ADD COLUMN cover TEXT DEFAULT ''", (err2) => {
                if (err2) console.error('添加cover字段失败:', err2);
                else console.log('cover 字段添加成功');
            });
        }
        setTimeout(() => {
            db.close();
            console.log('封面字段迁移完成！');
        }, 500);
    });
});
