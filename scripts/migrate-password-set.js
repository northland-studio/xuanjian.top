// 添加 password_set 字段：0=未设置密码（QQ注册新用户），1=已设置密码
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/guild.db');
const db = new sqlite3.Database(DB_PATH);

console.log('开始添加 password_set 字段...');

db.all('PRAGMA table_info(users)', (err, columns) => {
    if (err) {
        console.error('读取users表结构失败:', err.message);
        db.close();
        return;
    }

    const hasField = columns.some(col => col.name === 'password_set');
    if (hasField) {
        console.log('password_set 字段已存在，跳过迁移');
        db.close();
        return;
    }

    db.run('ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1', (err2) => {
        if (err2) {
            console.error('添加password_set字段失败:', err2.message);
        } else {
            console.log('password_set 字段添加成功（默认1=已有密码）');
        }
        db.close();
    });
});
