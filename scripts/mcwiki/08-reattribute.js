/**
 * 诊断 + 重署名工具（一次性）
 *
 * A) 诊断「维度」(#144) 两个版本到底谁是谁：分别打印长度、是否含本站导入页脚、
 *    以及各自是否含 Minecraft Wiki 来源链接。
 * B) 把**导入页面**的 author_id / last_editor_id 改成指定用户（默认 1 号），
 *    并把对应的导入版本记录 editor_id 一并改过去；站上原有页面（导入前就存在）不动。
 *
 * 用法：
 *   node scripts/mcwiki/08-reattribute.js                 # 只诊断
 *   node scripts/mcwiki/08-reattribute.js --apply --user=1 # 执行重署名
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const db = require(path.join(ROOT, 'database'));

const APPLY = process.argv.includes('--apply');
const USER_ID = Number((process.argv.find((a) => a.startsWith('--user=')) || '').slice(7)) || 1;
const FOOTER_MARK = '本条目由玄剑公会 Wiki 依据';
const SOURCE_HOST = 'zh.minecraft.wiki';
const CATEGORY_ID = 7;

const sig = (s) => ({
  len: s.length,
  ourFooter: s.includes(FOOTER_MARK),
  sourceHost: s.includes(SOURCE_HOST),
  head: s.slice(0, 70).replace(/\s+/g, ' '),
  tail: s.slice(-90).replace(/\s+/g, ' ')
});

async function main() {
  const users = await db.all('SELECT id, username, nickname, level, created_at FROM users WHERE id IN (1, 4)');
  console.log('账号：');
  for (const u of users) console.log(`  #${u.id} ${u.username}（${u.nickname || '—'}）level=${u.level} 注册 ${u.created_at}`);

  console.log('\n=== A) 维度 #144 版本对照 ===');
  const revs = await db.all('SELECT id, created_at, revision_note, content FROM wiki_revisions WHERE page_id = 144 ORDER BY id');
  for (const r of revs) {
    const s = sig(r.content);
    console.log(`  #${r.id} ${r.created_at} ${r.revision_note}`);
    console.log(`     长度=${s.len} 本站导入页脚=${s.ourFooter} 含来源站=${s.sourceHost}`);
    console.log(`     开头: ${s.head}`);
    console.log(`     结尾: ${s.tail}`);
  }
  const page = await db.get('SELECT id, content, author_id, last_editor_id, created_at FROM wiki_pages WHERE id = 144');
  console.log(`  当前页面行：长度=${page.content.length} 作者=${page.author_id} 末编辑=${page.last_editor_id} 建于 ${page.created_at}`);

  console.log('\n=== B) 分类 7 下页面归属 ===');
  const pages = await db.all(
    `SELECT p.id, p.title, p.slug, p.author_id, p.last_editor_id, p.created_at, p.content,
            (SELECT MIN(created_at) FROM wiki_revisions r WHERE r.page_id = p.id) AS first_rev_at
       FROM wiki_pages p WHERE p.category_id = ? ORDER BY p.id`,
    [CATEGORY_ID]
  );
  const imported = [];
  const original = [];
  for (const p of pages) {
    const s = sig(p.content);
    (s.ourFooter ? imported : original).push({ ...p, len: s.len });
  }
  console.log(`  导入页（含本站来源页脚）：${imported.length} 个，其中署名不是 #${USER_ID} 的 ${imported.filter((p) => p.author_id !== USER_ID || p.last_editor_id !== USER_ID).length} 个`);
  console.log(`  站上原有页（无本站来源页脚）：${original.length} 个 → ${original.map((p) => `${p.title}#${p.id}(作者${p.author_id})`).join('、')}`);

  if (!APPLY) {
    console.log('\n（只诊断。要执行重署名请加 --apply --user=1）');
    return;
  }

  const ids = imported.map((p) => p.id);
  if (!ids.length) { console.log('没有需要改的页面'); return; }
  const ph = ids.map(() => '?').join(',');
  const r1 = await db.run(`UPDATE wiki_pages SET author_id = ?, last_editor_id = ? WHERE id IN (${ph})`, [USER_ID, USER_ID, ...ids]);
  const r2 = await db.run(
    `UPDATE wiki_revisions SET editor_id = ? WHERE page_id IN (${ph}) AND revision_note IN ('创建页面', '生电条目改写更新', '生电条目改写更新（补主图）')`,
    [USER_ID, ...ids]
  );
  console.log(`\n✓ 已把 ${r1.changes} 个页面的作者/末编辑改为 #${USER_ID}，${r2.changes} 条版本记录编辑者同步`);
  const check = await db.get('SELECT COUNT(*) c FROM wiki_pages WHERE category_id = ? AND author_id <> ?', [CATEGORY_ID, USER_ID]);
  console.log(`  仍不属于 #${USER_ID} 的页面：${check.c} 个（应为站上原有页数量）`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('失败：', e.message); process.exit(1); });
