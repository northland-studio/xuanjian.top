// 迁移：重建 notifications 表，扩展 type CHECK 约束（新增 purchase / discipline）
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(process.cwd(), 'data', 'guild.db'));

db.serialize(() => {
  db.run("PRAGMA foreign_keys=OFF");
  db.run(`
    CREATE TABLE notifications_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN (
          'post_daily','post_decision','comment','like','claim_result','task_reward',
          'transfer','favorite','follow','purchase','discipline','player_task'
        )),
        title TEXT,
        content TEXT,
        post_id INTEGER,
        comment_id INTEGER,
        actor_id INTEGER,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (e) => {
    if (e) { console.error('建新表失败:', e.message); process.exit(1); }
    db.run(`INSERT INTO notifications_new SELECT id, user_id, type, title, content, post_id, comment_id, actor_id, is_read, created_at FROM notifications`, (e2) => {
      if (e2) { console.error('复制数据失败:', e2.message); process.exit(1); }
      db.run(`DROP TABLE notifications`, (e3) => {
        if (e3) { console.error('删旧表失败:', e3.message); process.exit(1); }
        db.run(`ALTER TABLE notifications_new RENAME TO notifications`, (e4) => {
          if (e4) { console.error('重命名失败:', e4.message); process.exit(1); }
          db.run("PRAGMA foreign_keys=ON");
          // 验证
          db.all(`SELECT sql FROM sqlite_master WHERE type='table' AND name='notifications'`, (e5, r) => {
            console.log('迁移完成，新建表SQL:');
            console.log(r[0]?.sql);
            db.close();
          });
        });
      });
    });
  });
});
