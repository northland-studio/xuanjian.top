// 迁移：generations 表补充 updated_at 列（修复代系更新接口 500）
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(process.cwd(), 'data', 'guild.db'));
db.all(`PRAGMA table_info(generations)`, (e, cols) => {
  if (e) { console.error(e); process.exit(1); }
  if (!cols.some(c => c.name === 'updated_at')) {
    db.run(`ALTER TABLE generations ADD COLUMN updated_at DATETIME`, (e2) => {
      if (e2) { console.error('加列失败:', e2.message); process.exit(1); }
      console.log('generations.updated_at 已添加');
      db.close();
    });
  } else {
    console.log('generations.updated_at 已存在');
    db.close();
  }
});
