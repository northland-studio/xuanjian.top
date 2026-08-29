// 迁移：创建 generations 配置表 + users.generation 字段 + 初始代系数据
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(process.cwd(), 'data', 'guild.db'));

db.serialize(() => {
  // 1. generations 配置表
  db.run(`
    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT,      -- 起始日期 YYYY-MM-DD（含）
      end_date TEXT,        -- 结束日期 YYYY-MM-DD（含，NULL 表示到当前）
      color TEXT DEFAULT '#004AAD',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (e) => {
    if (e) { console.error('建 generations 表失败:', e.message); process.exit(1); }
    console.log('generations 表已创建');
  });

  // 2. users 加 generation 字段
  db.all(`PRAGMA table_info(users)`, (e2, cols) => {
    if (e2) { console.error('查询 users 失败:', e2.message); process.exit(1); }
    if (!cols.some(c => c.name === 'generation')) {
      db.run(`ALTER TABLE users ADD COLUMN generation TEXT`, (e3) => {
        if (e3) { console.error('加 generation 字段失败:', e3.message); process.exit(1); }
        console.log('users.generation 字段已添加');
        seedGenerations();
      });
    } else {
      console.log('users.generation 已存在');
      seedGenerations();
    }
  });

  function seedGenerations() {
    // 初始代系数据（按注册时间分段，日期基于实际数据 2026-02 ~ 2026-08）
    const seed = [
      ['元老代', '2026-01-01', '2026-02-28', '#8b5cf6', 1],
      ['第二期', '2026-03-01', '2026-03-31', '#f59e0b', 2],
      ['第三期', '2026-04-01', '2026-04-30', '#10b981', 3],
      ['第四期', '2026-05-01', '2026-06-30', '#06b6d4', 4],
      ['第五期', '2026-07-01', null, '#ef4444', 5]
    ];
    db.get(`SELECT COUNT(*) AS c FROM generations`, (e4, r) => {
      if (e4) { console.error('查 generations 失败:', e4.message); process.exit(1); }
      if ((r.c || 0) === 0) {
        const stmt = db.prepare(`INSERT INTO generations (name, start_date, end_date, color, sort_order) VALUES (?, ?, ?, ?, ?)`);
        seed.forEach(g => stmt.run(g[0], g[1], g[2], g[3], g[4]));
        stmt.finalize((e5) => {
          if (e5) { console.error('填充代系失败:', e5.message); process.exit(1); }
          console.log('已填充初始代系数据');
          printGenerations();
        });
      } else {
        console.log('generations 已有数据，跳过填充');
        printGenerations();
      }
    });
  }

  function printGenerations() {
    db.all(`SELECT * FROM generations ORDER BY sort_order`, (e6, rows) => {
      if (!e6) {
        console.log('=== generations 数据 ===');
        rows.forEach(r => console.log(`  ${r.name}: ${r.start_date} ~ ${r.end_date || '至今'} (${r.color})`));
      }
      db.close();
    });
  }
});
