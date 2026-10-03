/**
 * 阶段 3：把抓取产物压成「改写素材卡」，供改写阶段（子代理）读取
 *
 * 用法：node scripts/mcwiki/03-prepare.js
 * 输入：data/mcwiki/raw/*.json + data/mcwiki/fetch-report.json
 * 输出：data/mcwiki/prepared/<key>.json   每页一张素材卡（约 3-6KB）
 *       data/mcwiki/prepared/_index.json  全部标题 + 分组（改写时 [[内链]] 的白名单）
 *
 * 去重：同 revid 的重定向页只保留一个（村民职业→村民、敌对生物→生物）。
 */
const fs = require('fs');
const path = require('path');
const { finalTitle } = require('./titles');

const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'mcwiki');
const RAW_DIR = path.join(OUT_DIR, 'raw');
const PREP_DIR = path.join(OUT_DIR, 'prepared');

/** 同 revid 只留一个（后面的标题是重定向） */
const DROP = new Set(['村民职业', '敌对生物']);

const LEAD_MAX = 1200;
const SECTION_TEXT_MAX = 700;
const MAX_SECTIONS = 12;
const MAX_ROWS = 10;
const MAX_COLS = 8;

const trimTable = (rows) =>
  (rows || []).slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map((c) => c.replace(/\[\[[^\]]*\]\]/g, '').trim()));

/** 清掉渲染残留：编辑链接、小工具占位、页脚套话 */
function cleanText(s) {
  return String(s || '')
    .replace(/(?:编辑源代码|编辑){2,}/g, '')
    .replace(/^[\s]*(?:编辑源代码|编辑|源代码)[\s]*/g, '')
    .replace(/正在加载互动小工具[^。]*。?/g, '')
    .replace(/如果加载失败[^。]*。?/g, '')
    .replace(/请刷新本页面[^。]*。?/g, '')
    .replace(/本页面[^。]{0,20}仅供参考[^。]*。?/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildCard(raw) {
  const sections = [];
  for (const s of raw.sections || []) {
    if (sections.length >= MAX_SECTIONS) break;
    const text = cleanText(s.text).slice(0, SECTION_TEXT_MAX);
    const tables = (s.tables || []).slice(0, 2).map(trimTable);
    if (!text && !tables.length) continue;
    sections.push({ title: s.title, text, tables });
  }
  return {
    key: raw.key,
    title: raw.title,
    finalTitle: finalTitle(raw.title),   // 入库标题（已去 Tutorial: 前缀 / 撞名例外）
    group: raw.group,
    sourceUrl: raw.sourceUrl,
    revid: raw.revid,
    license: raw.license,
    lead: cleanText(raw.lead).slice(0, LEAD_MAX),
    leadTables: (raw.leadTables || []).slice(0, 2).map(trimTable),
    outline: (raw.sections || []).map((s) => s.title),
    sections
  };
}

function main() {
  fs.mkdirSync(PREP_DIR, { recursive: true });
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.json'));
  const index = [];
  const titleMap = {};
  let bytes = 0;
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8'));
    if (DROP.has(raw.title)) continue;
    const card = buildCard(raw);
    titleMap[card.title] = card.finalTitle;
    // 素材太薄（首段 + 有内容的小节都很少）的页面标记出来，改写阶段直接跳过
    const thickness = card.lead.length + card.sections.reduce((n, s) => n + s.text.length + s.tables.length * 200, 0);
    card.thin = thickness < 350;
    const out = path.join(PREP_DIR, f);
    fs.writeFileSync(out, JSON.stringify(card, null, 1), 'utf8');
    bytes += JSON.stringify(card).length;
    index.push({ key: card.key, title: card.finalTitle, sourceTitle: card.title, group: card.group, revid: card.revid, sections: card.sections.length, thin: card.thin, bytes: JSON.stringify(card).length });
  }
  index.sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
  fs.writeFileSync(path.join(PREP_DIR, '_index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), count: index.length, note: 'title 为最终入库标题（已去 Tutorial: 前缀），改写时的 [[内链]] 一律用这个 title', pages: index }, null, 1), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'title-map.json'), JSON.stringify(titleMap, null, 1), 'utf8');
  // 来源索引：发布阶段拼页脚时要引用**具体来源条目**（URL + revid），
  // 改写产物里没有这些字段，所以单独落一份小映射表。
  const sources = {};
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8'));
    if (DROP.has(raw.title)) continue;
    sources[raw.key] = { sourceTitle: raw.title, sourceUrl: raw.sourceUrl, revid: raw.revid, finalTitle: finalTitle(raw.title) };
  }
  fs.writeFileSync(path.join(OUT_DIR, 'sources.json'), JSON.stringify(sources, null, 1), 'utf8');
  const thin = index.filter((i) => i.thin).map((i) => i.title);
  console.log(`素材卡 ${index.length} 张，共 ${(bytes / 1024).toFixed(0)}KB（平均 ${(bytes / index.length / 1024).toFixed(1)}KB/页）`);
  if (thin.length) console.log(`素材过薄（改写阶段建议跳过）：${thin.join('、')}`);
  console.log('索引：data/mcwiki/prepared/_index.json');
}

main();
