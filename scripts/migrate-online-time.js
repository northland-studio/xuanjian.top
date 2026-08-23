// 迁移：创建 online_time 上线时长累计表
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(process.cwd(), 'data', 'guild.db'));

db.run(`
CREATE TABLE IF NOT EXISTS online_time (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    user_id INTEGER,
    player_name TEXT,
    total_seconds INTEGER DEFAULT 0,
    last_seen_at DATETIME,
    updated_at DATETIME
)
`, (e) => {
  if (e) { console.error('建表失败:', e.message); process.exit(1); }
  console.log('online_time 表已创建');
  db.all(`PRAGMA table_info(online_time)`, (e2, cols) => {
    if (!e2) { console.log('列:'); cols.forEach(c => console.log('  ' + c.name + ': ' + c.type)); }
    db.close();
  });
});
