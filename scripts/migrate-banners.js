const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'guild.db');
const db = new sqlite3.Database(DB_PATH);

console.log('开始创建轮播图表...');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS banners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            subtitle TEXT DEFAULT '',
            image TEXT NOT NULL,
            link TEXT,
            sort_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('创建banners表失败:', err);
        else console.log('banners 表创建成功');
    });

    // 插入默认轮播图（使用现有图片资源）
    const defaultBanners = [
        ['玄剑公会', '探索无限可能，创造属于我们的世界', '/1.png', '/', 1],
        ['公会贴吧', '自由交流 · 分享经验 · 展示作品', '/4.png', '/forum', 2],
        ['会员商城', '使用贡献点兑换专属好物', '/7.png', '/shop', 3],
        ['每日签到', '连续签到赢取丰厚贡献点', '/3.png', '/checkin', 4]
    ];
    const stmt = db.prepare('INSERT OR IGNORE INTO banners (title, subtitle, image, link, sort_order) VALUES (?, ?, ?, ?, ?)');
    defaultBanners.forEach(b => stmt.run(b));
    stmt.finalize((err) => {
        if (err) console.error('插入默认轮播图失败:', err);
        else console.log('默认轮播图插入成功');
    });
});

setTimeout(() => {
    db.close();
    console.log('轮播图迁移完成！');
}, 1000);
