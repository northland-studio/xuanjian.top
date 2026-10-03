/**
 * Wiki 开放编辑（审核制）+ 页面评论 的建表迁移
 *
 * 用法：
 *   node scripts/migrate-wiki-review.js                       # 默认 data/guild.db
 *   DB_FILE=data/wiki-mobile-test.db node scripts/migrate-wiki-review.js
 *
 * 新增：
 *   wiki_submissions  待审提交单（新建与修改共用一套流程）
 *       —— **提交单自己持有草稿正文**（不含 revision_id）：因为 wiki_revisions.page_id 是
 *          NOT NULL，草稿页面还不存在时没法往版本表里塞；而且草稿不该污染页面版本历史。
 *          审核通过时才走 createPage/updatePage 落成正式版本。
 *   wiki_comments     页面评论（形态对齐既有的 posts 评论表）
 *
 * 同时把默认审核配置写进 settings 表的 `wiki_review_config`。
 * 幂等：表已存在则不动；若检测到早期错误结构（缺 content 列）会明确提示并重建（仅限尚未投产时）。
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'database'));

const DEFAULT_REVIEW_CONFIG = {
  enabled: true,              // 是否启用 GLM 自动审核（未配置 apiKey 时自动跳过、全部转人工）
  autoApprove: true,          // 是否允许"高置信无违规"直接通过
  autoReject: true,           // 是否允许"明确违规"直接驳回
  approveThreshold: 0.85,     // 自动通过所需置信度
  rejectThreshold: 0.9,       // 自动驳回所需置信度
  model: 'glm-4-flash',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',                 // 管理员在后台填写；接口只回显"已配置 + 末 4 位"
  maxPerDay: 5,               // 每人每日提交上限（0 = 不限）
  maxContentLength: 200000
};

const SUBMISSIONS_SQL = `CREATE TABLE IF NOT EXISTS wiki_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER DEFAULT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('new','edit')),
      submitter_id INTEGER NOT NULL,
      category_id INTEGER DEFAULT NULL,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewer_id INTEGER DEFAULT NULL,
      review_note TEXT DEFAULT '',
      auto_review TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME DEFAULT NULL
   )`;

const STATEMENTS = [
  SUBMISSIONS_SQL,
  `CREATE INDEX IF NOT EXISTS idx_wiki_submissions_status ON wiki_submissions(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_submissions_submitter ON wiki_submissions(submitter_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_submissions_page ON wiki_submissions(page_id)`,
  `CREATE TABLE IF NOT EXISTS wiki_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_comments_page ON wiki_comments(page_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_comments_user ON wiki_comments(user_id, created_at DESC)`
];

async function main() {
  console.log('库：' + (process.env.DB_FILE || 'data/guild.db'));

  // 早期结构（带 revision_id、缺 content）直接重建——该表此前从未投产，内容为空
  const cols = await db.all('PRAGMA table_info(wiki_submissions)');
  if (cols.length && !cols.some((c) => c.name === 'content')) {
    const n = await db.get('SELECT COUNT(*) c FROM wiki_submissions');
    if (n.c > 0) throw new Error(`wiki_submissions 是旧结构且有 ${n.c} 行数据，拒绝自动重建，请人工处理`);
    await db.run('DROP TABLE wiki_submissions');
    console.log('· 检测到早期结构（无 content 列），已删除空表后重建');
  }

  for (const sql of STATEMENTS) await db.run(sql);
  console.log('✓ 表与索引就绪：wiki_submissions / wiki_comments');

  const existing = await db.get('SELECT value FROM settings WHERE key = ?', ['wiki_review_config']);
  if (!existing) {
    await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [
      'wiki_review_config', JSON.stringify(DEFAULT_REVIEW_CONFIG), db.getLocalTimestamp()
    ]);
    console.log('✓ 写入默认审核配置（apiKey 为空 → 自动审核会跳过，全部转人工）');
  } else {
    console.log('· 审核配置已存在，保持不动');
  }

  const sub = await db.get("SELECT COUNT(*) c FROM wiki_submissions WHERE status = 'pending'");
  const cmt = await db.get('SELECT COUNT(*) c FROM wiki_comments');
  console.log(`现状：待审 ${sub.c} 条，评论 ${cmt.c} 条`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('迁移失败：', e.message); process.exit(1); });
