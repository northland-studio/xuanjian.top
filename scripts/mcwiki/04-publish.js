/**
 * 阶段 4：把改写产物写入 Wiki（默认 dry-run，不写库）
 *
 * 用法（在站点根目录执行，需要在服务器上，因为要直接调 lib/wiki.js 与 sqlite）：
 *   node scripts/mcwiki/04-publish.js --dry-run                # 只体检，不写库
 *   node scripts/mcwiki/04-publish.js --write                  # 正式写入
 *   node scripts/mcwiki/04-publish.js --write --only=红石比较器,活塞
 *   node scripts/mcwiki/04-publish.js --write --update         # 已存在的同名页改为更新一版
 *
 * 设计要点：
 *  - 走 lib/wiki.js 的 createPage（与后台发布同一套逻辑：内链解析、白名单清洗、版本记录、FTS 索引、
 *    SSG 失效），因此不经过 HTTP、不需要管理员令牌，也**不会触发任何通知**（通知在路由层，这里不调）。
 *  - 来源与许可页脚由本脚本统一追加，保证 100% 覆盖，不依赖改写阶段的自觉。
 *  - 同名页面默认跳过，保证可重复执行（幂等）。
 */
const fs = require('fs');
const path = require('path');
const { finalTitle } = require('./titles');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.MCWIKI_ADAPTED || path.join(ROOT, 'data', 'mcwiki', 'adapted');
const REPORT = path.join(ROOT, 'data', 'mcwiki', 'publish-report.json');
const IMAGE_MANIFEST = process.env.MCWIKI_IMAGES || path.join(ROOT, 'data', 'mcwiki', 'images.json');
const SOURCE_INDEX = process.env.MCWIKI_SOURCES || path.join(ROOT, 'data', 'mcwiki', 'sources.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

const DRY = has('--dry-run') || !has('--write');
const UPDATE = has('--update');
const ONLY = (valOf('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const ONLY_FILE = valOf('only-file');
const CATEGORY_SLUG = valOf('category') || 'minecraft-zhi-shi';

let db;
let wiki;

/** 统一的来源与许可页脚（引用具体来源条目页，而不是站点首页） */
function sourceFooter(meta) {
  const src = meta.sourceUrl || 'https://zh.minecraft.wiki/';
  const title = meta.sourceTitle || meta.title;
  const rev = meta.revid ? `，取用版本 ${meta.revid}` : '';
  return (
    '\n<hr>\n<blockquote><p><strong>来源与许可</strong>：本条目由玄剑公会 Wiki 依据 ' +
    `<a href="${src}" target="_blank" rel="noopener noreferrer">Minecraft Wiki（中文）「${title}」</a>` +
    `（CC BY-NC-SA 3.0${rev}）整理改写：正文表述为本站自撰，数值与表格数据取自该页面，` +
    '完整内容与更新请查阅原站。本页同样以 CC BY-NC-SA 3.0 提供。</p></blockquote>'
  );
}

/**
 * 内链目标统一到最终入库标题：
 * 改写时拿到的白名单来自源站，可能写成 [[Tutorial:刷怪塔]]，但入库标题是「刷怪塔」。
 * 这里在解析前统一改写，避免「先建页面」阶段产生一堆永久死链。
 */
function normalizeLinks(html) {
  return String(html || '').replace(/\[\[([^\[\]|]+)(\|[^\[\]]+)?\]\]/g, (full, target, label) => {
    const src = String(target).trim();
    const fin = finalTitle(src);
    return fin && fin !== src ? `[[${fin}${label || ''}]]` : full;
  });
}

/** 统一的主图区块（图 + 出处），插在正文最前面 */
function figureBlock(meta) {
  return (
    `<figure><img src="${meta.cdn}" alt="${meta.alt || meta.title}" loading="lazy">` +
    `<figcaption>${meta.alt || meta.title} · 图源：Minecraft Wiki（CC BY-NC-SA 3.0）</figcaption></figure>\n`
  );
}

function countMatches(s, re) {
  return (String(s).match(re) || []).length;
}

async function main() {
  db = require(path.join(ROOT, 'database'));
  wiki = require(path.join(ROOT, 'lib', 'wiki'));

  const cat = await wiki.getCategoryBySlug(CATEGORY_SLUG);
  if (!cat) throw new Error(`分类不存在：${CATEGORY_SLUG}`);
  // 署名：默认用 1 号用户（玄剑公会官方账号），可用 --user=<id> 或 MCWIKI_AUTHOR_ID 覆盖
  const wantUser = Number(valOf('user') || process.env.MCWIKI_AUTHOR_ID || 1);
  const admin = (await db.get('SELECT id, username FROM users WHERE id = ?', [wantUser]))
    || (await db.get('SELECT id, username FROM users WHERE level = 0 ORDER BY id LIMIT 1'));
  if (!admin) throw new Error(`找不到署名账号（--user=${wantUser}）`);

  // 主图清单（可选）：由 06-images.js 产出；不存在就纯文字发布
  let imageItems = {};
  if (fs.existsSync(IMAGE_MANIFEST)) {
    try {
      imageItems = (JSON.parse(fs.readFileSync(IMAGE_MANIFEST, 'utf8').replace(/^\uFEFF/, '')).items) || {};
    } catch (e) {
      console.log(`⚠ 主图清单解析失败（按纯文字发布）：${e.message}`);
    }
  }
  const withImage = Object.values(imageItems).filter((v) => v && v.cdn).length;

  // 来源索引（key → 源条目标题/URL/revid）：页脚要引具体条目页
  let sourceIndex = {};
  if (fs.existsSync(SOURCE_INDEX)) {
    try { sourceIndex = JSON.parse(fs.readFileSync(SOURCE_INDEX, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { /* 忽略 */ }
  }
  const footMetaOf = (meta, key) => {
    const s = sourceIndex[key] || {};
    return {
      ...meta,
      sourceTitle: meta.sourceTitle || s.sourceTitle,
      sourceUrl: meta.sourceUrl || s.sourceUrl,
      revid: meta.revid || s.revid
    };
  };

  let files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')) : [];
  // --only 适合少量页；批量场景用 --only-file（一行一个 key，或逗号分隔），
  // 因为超长命令行会被 shell/ssh 截断（踩过一次：74 个 key 只传到 26 个）。
  let onlySet = ONLY;
  if (ONLY_FILE) {
    const txt = fs.readFileSync(ONLY_FILE, 'utf8').replace(/^\uFEFF/, '');
    onlySet = txt.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
  }
  if (onlySet.length) files = files.filter((f) => onlySet.includes(path.basename(f, '.json')));
  if (!files.length) throw new Error(`没有可发布的改写产物：${DATA_DIR}`);

  console.log(`模式：${DRY ? 'DRY-RUN（不写库）' : 'WRITE'}   分类：${cat.name}（#${cat.id}）   作者：${admin.username}（#${admin.id}）`);
  console.log(`主图清单：${withImage} 张可用${withImage ? '' : '（未跑 06-images.js，将按纯文字发布）'}`);
  console.log(`待处理 ${files.length} 个改写产物\n`);

  const report = { startedAt: new Date().toISOString(), mode: DRY ? 'dry-run' : 'write', category: cat.slug, created: [], updated: [], skipped: [], failed: [] };
  const pad = (s, n) => String(s).padEnd(n, ' ');

  for (const f of files) {
    const key = path.basename(f, '.json');
    let meta;
    try {
      // 防御 BOM：Windows 侧写文件很容易带上 \uFEFF，JSON.parse 会直接抛错
      const text = fs.readFileSync(path.join(DATA_DIR, f), 'utf8').replace(/^\uFEFF/, '');
      meta = JSON.parse(text);
    } catch (e) {
      report.failed.push({ key, stage: 'parse', error: e.message });
      console.log(`✗ ${pad(key, 22)} JSON 解析失败：${e.message}`);
      continue;
    }

    const title = finalTitle(String(meta.title || key));
    const summary = String(meta.summary || '').trim();
    const raw = normalizeLinks(String(meta.content || '').trim());
    // 主图（06-images.js 产出的清单）：有就插在正文最前面，图源与许可随图标注
    const img = imageItems[key];
    const body = img && img.cdn && !/^\s*<figure/i.test(raw) ? figureBlock({ ...img, title }) + raw : raw;
    if (!title) { report.failed.push({ key, stage: 'validate', error: '标题为空' }); console.log(`✗ ${pad(key, 22)} 标题为空`); continue; }
    if (!raw) { report.failed.push({ key, stage: 'validate', error: '正文为空' }); console.log(`✗ ${pad(key, 22)} 正文为空`); continue; }
    if (title.length > 200) { report.failed.push({ key, stage: 'validate', error: '标题过长' }); console.log(`✗ ${pad(key, 22)} 标题过长`); continue; }
    if (summary.length > 500) { report.failed.push({ key, stage: 'validate', error: '摘要过长' }); console.log(`✗ ${pad(key, 22)} 摘要过长`); continue; }

    const content = body + sourceFooter(footMetaOf(meta, key));
    const clean = wiki.sanitizeContent(content);

    // 体检指标
    const stats = {
      title,
      summaryLen: summary.length,
      contentLen: content.length,
      cleanLen: clean.length,
      lostChars: content.length - clean.length,
      h2: countMatches(clean, /<h2\b/gi),
      tables: countMatches(clean, /<table\b/gi),
      lis: countMatches(clean, /<li\b/gi),
      wikiLinks: countMatches(clean, /\[\[[^\]]+\]\]/g),
      externalLinks: countMatches(clean, /<a\b[^>]*href="https?:/gi),
      hasSourceFooter: clean.includes('来源与许可'),
      sanitizeWarning: content.length - clean.length > content.length * 0.25
    };

    const existing = await db.get('SELECT id, title, slug, status, content FROM wiki_pages WHERE title = ?', [title]);

    if (existing && !UPDATE) {
      report.skipped.push({ key, title, slug: existing.slug, reason: '同名页面已存在（--update 可覆盖更新）' });
      console.log(`– ${pad(key, 22)} 已存在，跳过（#${existing.id} /wiki/${existing.slug}）`);
      continue;
    }
    // 幂等：正文逐字节相同就不写库（避免重复执行时刷出一堆无意义的版本记录）
    if (existing && existing.content === clean) {
      report.skipped.push({ key, title, slug: existing.slug, reason: '内容无变化' });
      console.log(`= ${pad(key, 22)} 内容无变化，跳过`);
      continue;
    }

    if (DRY) {
      console.log(`· ${pad(key, 22)} → 「${title}」 摘要${String(stats.summaryLen).padStart(3)}字 正文${String(stats.cleanLen).padStart(5)}字 h2×${stats.h2} 表×${stats.tables} li×${stats.lis} 内链×${stats.wikiLinks} 页脚${stats.hasSourceFooter ? '✓' : '✗'}${img && img.cdn ? ' 主图✓' : ''}${stats.sanitizeWarning ? '  ⚠清洗掉>25%' : ''}`);
      (report.created).push({ key, title, dryRun: true, ...stats });
      continue;
    }

    try {
      if (existing && UPDATE) {
        const page = await wiki.updatePage(existing.id, { title, content, summary, category_id: cat.id, status: 'published' }, admin.id, '生电条目改写更新');
        report.updated.push({ key, title, id: existing.id, slug: page.slug, ...stats });
        console.log(`↑ ${pad(key, 22)} 已更新 #${existing.id} /wiki/${page.slug}  正文${stats.cleanLen}字`);
      } else {
        const page = await wiki.createPage({ title, content, summary, category_id: cat.id, status: 'published' }, admin.id);
        report.created.push({ key, title, id: page.id, slug: page.slug, ...stats });
        console.log(`✓ ${pad(key, 22)} 已创建 #${page.id} /wiki/${page.slug}  正文${stats.cleanLen}字`);
      }
    } catch (e) {
      report.failed.push({ key, title, stage: 'write', error: e.message });
      console.log(`✗ ${pad(key, 22)} 写入失败：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  /* ---- 内链二次解析 ----
   * [[标题]] 是在保存时解析成 <a> 的：先创建的页面会把当时还不存在的目标永久标成「未创建」。
   * 全部写完后，用磁盘上的原始 [[...]] 文本重新解析一次，直接更新正文（不新增版本），
   * 顺带把「创建页面」那条版本的正文也校正，保证版本历史与线上内容一致。
   */
  if (!DRY && (report.created.length || report.updated.length)) {
    console.log('\n[内链二次解析] 修正「先建页面指向后建页面」造成的未创建链接');
    const targets = [...report.created, ...report.updated].filter((x) => x.id);
    let fixed = 0;
    let stillMissing = 0;
    let totalLinks = 0;
    for (const item of targets) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, item.key + '.json'), 'utf8').replace(/^\uFEFF/, ''));
        // 必须和主循环完全一致地重建正文：内链目标先归一到入库标题，再补主图，
        // 否则这一遍会把主图洗掉（曾经就是这里把 74 页的 <figure> 弄没了）。
        const rawFix = normalizeLinks(String(meta.content || '').trim());
        const imgFix = imageItems[item.key];
        const bodyFix = imgFix && imgFix.cdn && !/^\s*<figure/i.test(rawFix)
          ? figureBlock({ ...imgFix, title: item.title }) + rawFix
          : rawFix;
        const { html, targetIds } = await wiki.resolveWikiLinks(bodyFix);
        const content = wiki.sanitizeContent(html) + sourceFooter(footMetaOf(meta, item.key));
        const ts = typeof db.getLocalTimestamp === 'function' ? db.getLocalTimestamp() : new Date().toISOString();
        await db.run('UPDATE wiki_pages SET content = ?, updated_at = ? WHERE id = ?', [content, ts, item.id]);
        await db.run("UPDATE wiki_revisions SET content = ? WHERE page_id = ? AND revision_note = '创建页面'", [content, item.id]);
        const ids = Array.from(targetIds);
        await wiki.syncLinks(item.id, ids);
        await wiki.reindexPage(item.id);
        const miss = (content.match(/wiki-link-missing/g) || []).length;
        totalLinks += ids.length;
        stillMissing += miss;
        fixed++;
        if (miss) console.log(`  · ${item.title}：已解析内链 ${ids.length} 条，仍指向未创建页面 ${miss} 条`);
      } catch (e) {
        console.log(`  ✗ ${item.title} 内链修正失败：${e.message}`);
      }
    }
    console.log(`  已修正 ${fixed}/${targets.length} 页，解析出内链 ${totalLinks} 条，仍指向未创建页面 ${stillMissing} 条`);
    report.linkFix = { fixed, total: targets.length, resolvedLinks: totalLinks, stillMissing };
  }

  report.finishedAt = new Date().toISOString();
  report.summary = {
    total: files.length,
    created: report.created.length,
    updated: report.updated.length,
    skipped: report.skipped.length,
    failed: report.failed.length
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1), 'utf8');
  console.log(`\n合计 ${files.length}：新建 ${report.summary.created} / 更新 ${report.summary.updated} / 跳过 ${report.summary.skipped} / 失败 ${report.summary.failed}`);
  if (report.failed.length) console.log('失败：' + report.failed.map((x) => `${x.key}(${x.error})`).join('、'));
  console.log(`报告：${path.relative(ROOT, REPORT)}`);
  if (DRY) console.log('（DRY-RUN：未写入任何数据；确认无误后加 --write 正式执行）');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('发布失败：', e.message);
    process.exit(1);
  });
