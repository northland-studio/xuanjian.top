const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'guild.db');
const db = new sqlite3.Database(DB_PATH);

console.log('开始轮播图 subtitle 字段迁移...');

db.serialize(() => {
    // 添加 subtitle 列（若不存在）
    db.get("PRAGMA table_info(banners)", (err, rows) => {
        if (err) return console.error('读取表结构失败:', err.message);
    });

    db.run("ALTER TABLE banners ADD COLUMN subtitle TEXT DEFAULT ''", (err) => {
        if (err && !/duplicate column/i.test(err.message)) {
            console.error('添加 subtitle 列失败:', err.message);
        } else {
            console.log('subtitle 列已就绪');
        }
    });

    // 更新默认轮播图，补充副标题（复用现有图片资源）
    const updates = [
        ['玄剑公会', '探索无限可能，创造属于我们的世界', '/1.png'],
        ['公会贴吧', '自由交流 · 分享经验 · 展示作品', '/4.png'],
        ['会员商城', '使用贡献点兑换专属好物', '/7.png'],
        ['每日签到', '连续签到赢取丰厚贡献点', '/3.png']
    ];
    const stmt = db.prepare(
        'UPDATE banners SET subtitle = ?, image = ? WHERE title = ? AND image = ?'
    );
    updates.forEach(([title, subtitle, image]) => {
        stmt.run(subtitle, image, title, image);
    });
    stmt.finalize((err) => {
        if (err) console.error('更新默认轮播图失败:', err.message);
        else console.log('默认轮播图副标题更新完成');
    });
});

setTimeout(() => {
    db.close();
    console.log('轮播图 subtitle 迁移完成！');
}, 1000);
