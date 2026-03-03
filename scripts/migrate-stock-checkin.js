const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/guild.db');
const db = new sqlite3.Database(DB_PATH);

console.log('开始添加股票和签到功能数据库表...');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS stocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            base_price REAL NOT NULL DEFAULT 100,
            current_price REAL NOT NULL DEFAULT 100,
            total_shares INTEGER DEFAULT 10000,
            available_shares INTEGER DEFAULT 10000,
            volatility REAL DEFAULT 0.1,
            trend REAL DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('创建stocks表失败:', err);
        else console.log('stocks表创建成功');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS stock_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_id INTEGER NOT NULL,
            price REAL NOT NULL,
            volume INTEGER DEFAULT 0,
            recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (stock_id) REFERENCES stocks(id)
        )
    `, (err) => {
        if (err) console.error('创建stock_prices表失败:', err);
        else console.log('stock_prices表创建成功');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS user_stocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            stock_id INTEGER NOT NULL,
            shares INTEGER NOT NULL DEFAULT 0,
            avg_cost REAL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (stock_id) REFERENCES stocks(id),
            UNIQUE(user_id, stock_id)
        )
    `, (err) => {
        if (err) console.error('创建user_stocks表失败:', err);
        else console.log('user_stocks表创建成功');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS stock_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            stock_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('buy', 'sell')),
            shares INTEGER NOT NULL,
            price REAL NOT NULL,
            total_cost REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (stock_id) REFERENCES stocks(id)
        )
    `, (err) => {
        if (err) console.error('创建stock_transactions表失败:', err);
        else console.log('stock_transactions表创建成功');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS checkins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            checkin_date DATE NOT NULL,
            continuous_days INTEGER DEFAULT 1,
            reward_points INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, checkin_date)
        )
    `, (err) => {
        if (err) console.error('创建checkins表失败:', err);
        else console.log('checkins表创建成功');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS checkin_rewards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            continuous_days INTEGER NOT NULL UNIQUE,
            reward_points INTEGER NOT NULL,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('创建checkin_rewards表失败:', err);
        else console.log('checkin_rewards表创建成功');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS makeup_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            quantity INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id)
        )
    `, (err) => {
        if (err) console.error('创建makeup_cards表失败:', err);
        else console.log('makeup_cards表创建成功');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS makeup_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            target_date DATE NOT NULL,
            used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `, (err) => {
        if (err) console.error('创建makeup_usage表失败:', err);
        else console.log('makeup_usage表创建成功');
    });

    const defaultRewards = [
        [1, 5, '每日签到'],
        [2, 10, '连续2天'],
        [3, 15, '连续3天'],
        [4, 20, '连续4天'],
        [5, 30, '连续5天'],
        [6, 40, '连续6天'],
        [7, 100, '连续7天'],
        [14, 200, '连续14天'],
        [30, 500, '连续30天'],
        [60, 1000, '连续60天'],
        [90, 2000, '连续90天'],
        [180, 5000, '连续180天'],
        [365, 20000, '连续365天']
    ];

    const stmt = db.prepare('INSERT OR IGNORE INTO checkin_rewards (continuous_days, reward_points, description) VALUES (?, ?, ?)');
    defaultRewards.forEach(reward => {
        stmt.run(reward);
    });
    stmt.finalize((err) => {
        if (err) console.error('插入默认签到奖励失败:', err);
        else console.log('默认签到奖励插入成功');
    });

    const defaultStocks = [
        ['XJ001', '玄剑矿业', '玄剑公会核心矿业股票', 100, 100, 10000, 10000, 0.15, 0.02],
        ['XJ002', '玄剑建筑', '玄剑公会建筑板块股票', 80, 80, 8000, 8000, 0.12, 0.01],
        ['XJ003', '玄剑科技', '玄剑公会科技研发股票', 150, 150, 5000, 5000, 0.2, 0.03],
        ['XJ004', '玄剑农业', '玄剑公会农业发展股票', 50, 50, 15000, 15000, 0.08, 0.005],
        ['XJ005', '玄剑能源', '玄剑公会能源产业股票', 120, 120, 6000, 6000, 0.18, 0.015]
    ];

    const stockStmt = db.prepare('INSERT OR IGNORE INTO stocks (symbol, name, description, base_price, current_price, total_shares, available_shares, volatility, trend) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    defaultStocks.forEach(stock => {
        stockStmt.run(stock);
    });
    stockStmt.finalize((err) => {
        if (err) console.error('插入默认股票失败:', err);
        else console.log('默认股票插入成功');
    });
});

setTimeout(() => {
    db.close();
    console.log('数据库迁移完成！');
}, 1000);
