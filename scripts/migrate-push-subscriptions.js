// 迁移：创建 push_subscriptions 表（Web Push 订阅）
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(process.cwd(), 'data', 'guild.db'));
db.run(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    subscription_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`, (e) => {
  if (e) { console.error('建表失败:', e.message); process.exit(1); }
  console.log('push_subscriptions 表已创建');
  db.all(`PRAGMA table_info(push_subscriptions)`, (e2, cols) => {
    if (!e2) { console.log('列:'); cols.forEach(c => console.log('  ' + c.name + ': ' + c.type)); }
    db.close();
  });
});
