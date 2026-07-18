const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/guild.db');
const db = new sqlite3.Database(DB_PATH);

console.log('开始添加K线数据表...');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS stock_ohlc (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_id INTEGER NOT NULL,
            time DATETIME NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (stock_id) REFERENCES stocks(id),
            UNIQUE(stock_id, time)
        )
    `, (err) => {
        if (err) console.error('创建stock_ohlc表失败:', err);
        else console.log('stock_ohlc表创建成功');
    });

    // 创建索引加速查询
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_stock_ohlc_stock_time 
        ON stock_ohlc(stock_id, time DESC)
    `, (err) => {
        if (err) console.error('创建索引失败:', err);
        else console.log('索引创建成功');
    });
});

setTimeout(() => {
    db.close();
    console.log('K线数据表迁移完成！');
}, 1000);