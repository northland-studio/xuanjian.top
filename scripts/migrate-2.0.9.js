const db = require('../database');

module.exports = {
    up: async () => {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run(`ALTER TABLE shop_items ADD COLUMN content TEXT`, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error('添加 content 字段失败:', err.message);
                    } else {
                        console.log('shop_items 表已添加 content 字段');
                    }
                });
                
                db.run(`ALTER TABLE shop_items ADD COLUMN images TEXT DEFAULT '[]'`, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error('添加 images 字段失败:', err.message);
                    } else {
                        console.log('shop_items 表已添加 images 字段');
                    }
                });
                
                setTimeout(() => {
                    console.log('数据库迁移完成：shop_items 表更新');
                    resolve();
                }, 1000);
            });
        });
    }
};
