/**
 * 阶段 2：抓取 zh.minecraft.wiki 源页面，抽取可用的**素材**（不是最终正文）
 *
 * 用法：node scripts/mcwiki/02-fetch.js [--only=标题1,标题2]
 * 产物：data/mcwiki/raw/<key>.json   每页一个
 *       data/mcwiki/fetch-report.json  汇总报告（缺失/大小/表格数）
 *
 * 每个 JSON 包含：来源 URL、revid、许可、规范化后的正文标题层级、各小节纯文本、
 * wikitable 结构化表格、图片文件名清单。**最终入库正文由改写阶段重写**，
 * 这里落盘的只是素材，用于改写与核对事实。
 *
 * 只读外部站点；不写数据库、不调用我们自己的 API。
 */
const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const { list, keyOf } = require('./titles');

const API = 'https://zh.minecraft.wiki/api.php';
const UA = 'xuanjian-wiki-importer/0.1 (+https://xuanjian.top; admin@xuanjian.top)';
const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'mcwiki');
const RAW_DIR = path.join(OUT_DIR, 'raw');

const LEAD_MAX = 3000;      // 首段纯文本上限
const SECTION_MAX = 1800;   // 每小节纯文本上限
const MAX_SECTIONS = 14;    // 最多保留小节数
const CELL_MAX = 160;       // 表格单元格字符上限
const MAX_TABLE_ROWS = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 去标签取纯文本（实体解码 + 压缩空白 + 清掉模板残留） */
function plain(html) {
  return sanitizeHtml(String(html), { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, '')   // 模板残留：[[|]] / [[页面|显示]]
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .split('\n')
    .filter((line) => !/^(?:Java版|基岩版|教育版|原主机版|中国版|仅Java版|仅基岩版|New Nintendo 3DS版)$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 剥掉导航框/信息框/编辑链接/引用角标等不适合搬运的部件 */
function stripNoise(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<table[^>]*class="[^"]*(?:infobox|navbox|mbox|ambox|messagebox|metadata|stub)[^"]*"[\s\S]*?<\/table>/gi, '')
    .replace(/<div[^>]*class="[^"]*(?:navbox|mw-editsection|noprint|printfooter|catlinks|mw-jump-link)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<span[^>]*class="[^"]*mw-editsection[^"]*"[\s\S]*?<\/span>/gi, '')
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, '')
    .replace(/<ol[^>]*class="[^"]*references[^"]*"[\s\S]*?<\/ol>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** 提取 wikitable → [[cell,...], ...] */
function parseTables(html) {
  const tables = [];
  const tre = /<table\b[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
  let t;
  while ((t = tre.exec(html))) {
    const rows = [];
    const rre = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let r;
    while ((r = rre.exec(t[1]))) {
      const cells = [];
      const cre = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let c;
      while ((c = cre.exec(r[1]))) cells.push(plain(c[1]).slice(0, CELL_MAX));
      if (cells.some((x) => x)) rows.push(cells);
    }
    if (rows.length >= 2 && rows.length <= MAX_TABLE_ROWS) tables.push(rows);
  }
  return tables;
}

/** 按 h2/h3 切段：返回 [{ level, title, html }]（首段 level 0） */
function splitSections(html) {
  const heads = [];
  const hre = /<h([23])\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = hre.exec(html))) {
    heads.push({ level: Number(m[1]), title: plain(m[3]).replace(/\[编辑\]$/, '').trim(), index: m.index, end: hre.lastIndex });
  }
  const parts = [];
  if (!heads.length) return [{ level: 0, title: '', html }];
  parts.push({ level: 0, title: '', html: html.slice(0, heads[0].index) });
  heads.forEach((h, i) => {
    const stop = i + 1 < heads.length ? heads[i + 1].index : html.length;
    parts.push({ level: h.level, title: h.title, html: html.slice(h.end, stop) });
  });
  return parts;
}

async function api(params, tries = 4) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 404) return { missing: true };
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.error) return { missing: true, error: json.error.code };
      return json;
    } catch (e) {
      lastErr = e;
      await sleep(1000 * (i + 1));
    }
  }
  throw new Error(lastErr && lastErr.message);
}

async function fetchPage(title) {
  const data = await api({
    action: 'parse',
    page: title,
    prop: 'text|sections|images|revid',
    variant: 'zh-cn',
    redirects: '1'
  });
  if (data.missing) return { title, missing: true };
  const p = data.parse;
  const html = stripNoise(p.text);
  const parts = splitSections(html);
  const sections = [];
  for (const part of parts) {
    const tables = parseTables(part.html);
    const text = plain(part.html.replace(/<table[\s\S]*?<\/table>/gi, '\n')).slice(0, part.level === 0 ? LEAD_MAX : SECTION_MAX);
    if (part.level === 0) {
      sections.push({ level: 0, title: '', text, tables });
      continue;
    }
    // 丢掉目录伪小节、以及只剩「主条目：xxx」的占位小节
    if (/^(?:目录|目次|contents)$/i.test(part.title.trim())) continue;
    if (text.length < 25 && !tables.length) continue;
    sections.push({ level: part.level, title: part.title, text, tables });
  }
  const lead = sections.find((s) => s.level === 0) || { text: '', tables: [] };
  return {
    title,
    sourceTitle: p.title,
    sourceUrl: `https://zh.minecraft.wiki/w/${encodeURIComponent(p.title)}?variant=zh-cn`,
    revid: p.revid,
    fetchedAt: new Date().toISOString(),
    license: 'CC BY-NC-SA 3.0',
    lead: lead.text,
    leadTables: lead.tables,
    sections: sections.filter((s) => s.level > 0).slice(0, MAX_SECTIONS),
    images: (p.images || []).slice(0, 40),
    imageCount: (p.images || []).length,
    rawHtmlBytes: (p.text || '').length
  };
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;
  let items = list();
  if (only) items = items.filter((i) => only.includes(i.title));

  fs.mkdirSync(RAW_DIR, { recursive: true });
  const report = { startedAt: new Date().toISOString(), source: 'https://zh.minecraft.wiki/', license: 'CC BY-NC-SA 3.0', ok: [], missing: [], failed: [] };

  for (const [i, item] of items.entries()) {
    const key = keyOf(item.title);
    try {
      const page = await fetchPage(item.title);
      if (page.missing) {
        report.missing.push(item.title);
        console.log(`[${i + 1}/${items.length}] 缺失  ${item.title}`);
      } else {
        page.group = item.group;
        page.key = key;
        fs.writeFileSync(path.join(RAW_DIR, key + '.json'), JSON.stringify(page, null, 1), 'utf8');
        const tableCount = (page.leadTables?.length || 0) + page.sections.reduce((n, s) => n + s.tables.length, 0);
        report.ok.push({
          title: item.title, key, group: item.group, revid: page.revid,
          leadLen: page.lead.length, sections: page.sections.length, tables: tableCount,
          images: page.imageCount, rawHtmlBytes: page.rawHtmlBytes
        });
        console.log(`[${i + 1}/${items.length}] ok    ${item.title.padEnd(22)} 首段${String(page.lead.length).padStart(4)}字 小节${String(page.sections.length).padStart(2)} 表${String(tableCount).padStart(2)} 图${String(page.imageCount).padStart(3)}`);
      }
    } catch (e) {
      report.failed.push({ title: item.title, error: e.message });
      console.log(`[${i + 1}/${items.length}] 失败  ${item.title}：${e.message}`);
    }
    await sleep(350);
  }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'fetch-report.json'), JSON.stringify(report, null, 1), 'utf8');
  const noLead = report.ok.filter((r) => r.leadLen < 40).map((r) => r.title);
  console.log(`\n成功 ${report.ok.length} / 缺失 ${report.missing.length} / 失败 ${report.failed.length}`);
  if (report.missing.length) console.log('缺失：' + report.missing.join('、'));
  if (report.failed.length) console.log('失败：' + report.failed.map((f) => f.title).join('、'));
  if (noLead.length) console.log('首段过短（改写时需依赖小节）：' + noLead.join('、'));
  console.log('报告：data/mcwiki/fetch-report.json');
}

main().catch((e) => {
  console.error('抓取失败：', e.message);
  process.exit(1);
});
