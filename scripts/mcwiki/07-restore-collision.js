/**
 * 一次性修复：把被导入覆盖的自建页面「维度」恢复到它自己的第 1 版
 *
 * 背景：导入前 minecraft-zhi-shi 分类下已有 11 个自建页面（生电 / 刷铁机 / 刷线机 / 熔炉组 /
 * 村民交易 / 红石基础 / 下界合金 / 全自动农场 / 附魔 / 维度 / 生电发展路线）。
 * 其中「维度」与导入清单里的 Minecraft Wiki 页面同名，--update 把它当成"更新"覆盖掉了。
 * 用 restoreRevision 恢复到第 1 版（会新增一条「恢复自版本 #x」记录，审计链完整）。
 *
 * 用法：node scripts/mcwiki/07-restore-collision.js [--dry-run]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const db = require(path.join(ROOT, 'database'));
const wiki = require(path.join(ROOT, 'lib', 'wiki'));

const DRY = process.argv.includes('--dry-run');
const TARGET_TITLE = '维度';

async function main() {
  const page = await db.get('SELECT id, title, slug, content, created_at FROM wiki_pages WHERE title = ?', [TARGET_TITLE]);
  if (!page) throw new Error(`找不到页面：${TARGET_TITLE}`);
  const revs = await db.all(
    'SELECT id, revision_note, created_at, LENGTH(content) AS len FROM wiki_revisions WHERE page_id = ? ORDER BY id',
    [page.id]
  );
  console.log(`页面 #${page.id}「${page.title}」/wiki/${page.slug}  建于 ${page.created_at}  当前正文 ${page.content.length} 字`);
  console.log('版本历史：');
  for (const r of revs) console.log(`  #${r.id}  ${r.created_at}  ${String(r.len).padStart(6)} 字  ${r.revision_note || ''}`);

  if (revs.length < 2) { console.log('只有一条版本，无需恢复'); return; }
  const first = revs[0];
  const isMine = /来源与许可|CC BY-NC-SA/.test(page.content);
  if (!isMine) { console.log('当前正文不是导入版本（未见来源页脚），无需恢复'); return; }
  if (DRY) { console.log(`\n[DRY] 将恢复到版本 #${first.id}（${first.len} 字）`); return; }

  const admin = await db.get('SELECT id, username FROM users WHERE level = 0 ORDER BY id LIMIT 1');
  await wiki.restoreRevision(page.id, first.id, admin.id);
  const after = await db.get('SELECT content, updated_at FROM wiki_pages WHERE id = ?', [page.id]);
  console.log(`\n✓ 已恢复：正文 ${page.content.length} → ${after.content.length} 字（操作者 ${admin.username}）`);
  console.log(`  仍是导入内容？${/来源与许可|CC BY-NC-SA/.test(after.content) ? '是（异常）' : '否（正常）'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('失败：', e.message); process.exit(1); });
