/**
 * Wiki 投稿「贡献点回赠」建表
 *
 * 用法：node scripts/migrate-wiki-reward.js
 *
 * 新增 wiki_rewards：每次审核通过的发放记录。
 *   - submission_id 上建 UNIQUE：**幂等**的根，重复点「通过」不会重复发分
 *   - ai_points / ai_reason：AI 建议值与原话，用于事后校准（影子模式就是靠这张表比对）
 *   - points：实际发放值（管理员可改），与建议值分开存
 *
 * 贡献点本身沿用既有经济：`users.contribution` + `contribution_logs`（type='reward' 已在白名单里），
 * 不新造记账体系。
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'database'));

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS wiki_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      page_id INTEGER DEFAULT NULL,
      user_id INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      ai_points INTEGER DEFAULT NULL,
      ai_reason TEXT DEFAULT '',
      reviewer_id INTEGER DEFAULT NULL,
      note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_rewards_submission ON wiki_rewards(submission_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_rewards_user ON wiki_rewards(user_id, created_at DESC)`
];

async function main() {
  console.log('库：' + (process.env.DB_FILE || 'data/guild.db'));
  for (const sql of STATEMENTS) await db.run(sql);
  const n = await db.get('SELECT COUNT(*) AS c FROM wiki_rewards');
  const sum = await db.get('SELECT COALESCE(SUM(points), 0) AS s FROM wiki_rewards');
  console.log(`✓ wiki_rewards 就绪：已发放 ${n.c} 笔 / 合计 ${sum.s} 点`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('迁移失败：', e.message); process.exit(1); });
