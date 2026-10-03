/**
 * 阶段 5：质检改写产物（客观、可复现，不依赖人工抽查）
 *
 * 用法：node scripts/mcwiki/05-validate.js [--strict]
 * 输入：data/mcwiki/prepared/<key>.json（素材）+ data/mcwiki/adapted/<key>.json（改写产物）
 * 输出：data/mcwiki/validate-report.json + 控制台摘要
 *
 * 检查项：
 *  1. 契约：字段齐全、key 与文件名一致、summary 长度、正文长度（中文字数）
 *  2. 标签白名单：只允许规范里列出的标签/属性
 *  3. 内链白名单：[[...]] 目标必须在上线清单里
 *  4. **照抄检测**：把改写正文切成 20 字滑窗，逐个在源文本里找，
 *     报告与原文的最长连续重合长度（≥20 字判为 FAIL，≥14 字给出告警）
 */
const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const { finalTitle } = require('./titles');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data', 'mcwiki');
const PREP = path.join(DATA, 'prepared');
const ADAPT = path.join(DATA, 'adapted');
const STRICT = process.argv.includes('--strict');

const ALLOWED_TAGS = new Set(['h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'br', 'hr', 'a', 'b', 'i', 's', 'del', 'mark', 'sub', 'sup', 'figure', 'figcaption']);
const COPY_FAIL = 16;   // 归一化后连续重合 ≥ 16 汉字 → FAIL（规范红线：禁止整句照搬）
const COPY_WARN = 12;   // ≥ 12 汉字 → 告警

const toText = (html) =>
  sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '');

/**
 * 照抄检测只针对**散文**，并且先做归一化——规范明确允许逐字一致的内容必须排除，
 * 否则全是误报：
 *   · 表格单元格（配方/数值/掉落物）→ 整块剔除
 *   · 括号内的英文名（「红石中继器（Redstone Repeater）」）→ 剔除
 *   · 配置键 / ID / 数值 / 单位（max-chained-neighbor-updates、disable_mob_generation、100000）→ 剔除
 * 剩下的才是「有没有整句搬别人的话」。
 */
const proseOnly = (html) => toText(String(html || '').replace(/<table[\s\S]*?<\/table>/gi, ' '));
const normCopy = (t) =>
  String(t || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[A-Za-z0-9_\-.:⁄/×+*'"`[\]{}<>|\\~^%$#@!?,;=]+/g, '')
    .replace(/\s+/g, '');

/** 找出改写文本里长度为 n、能在源文本中原样找到的片段（返回片段本身） */
function findRun(adaptedText, sourceText, n) {
  for (let i = 0; i + n <= adaptedText.length; i++) {
    const s = adaptedText.slice(i, i + n);
    if (sourceText.includes(s)) return s;
  }
  return null;
}

/** 改写文本里最长的、能在源文本里原样找到的连续片段 */
function longestOverlap(adaptedText, sourceText) {
  if (!adaptedText || !sourceText) return { len: 0, sample: null };
  const probe = (n) => !!findRun(adaptedText, sourceText, n);
  if (!probe(12)) return { len: 0, sample: null };
  let hi = 12;
  while (hi * 2 <= adaptedText.length && probe(hi * 2)) hi *= 2;
  let a = hi;
  let b = Math.min(hi * 2, adaptedText.length);
  while (a < b) {
    const mid = Math.ceil((a + b) / 2);
    if (probe(mid)) a = mid;
    else b = mid - 1;
  }
  return { len: a, sample: findRun(adaptedText, sourceText, a) };
}

function main() {
  const index = JSON.parse(fs.readFileSync(path.join(PREP, '_index.json'), 'utf8').replace(/^\uFEFF/, ''));
  const titles = new Set(index.pages.map((p) => p.title));
  const files = fs.existsSync(ADAPT) ? fs.readdirSync(ADAPT).filter((f) => f.endsWith('.json')) : [];
  const report = { checkedAt: new Date().toISOString(), total: files.length, pass: [], warn: [], fail: [] };

  for (const f of files) {
    const key = path.basename(f, '.json');
    const issues = [];
    const warns = [];
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(ADAPT, f), 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      report.fail.push({ key, issues: ['JSON 解析失败：' + e.message] });
      continue;
    }
    const cardPath = path.join(PREP, f);
    const card = fs.existsSync(cardPath) ? JSON.parse(fs.readFileSync(cardPath, 'utf8').replace(/^\uFEFF/, '')) : null;

    if (meta.key !== undefined && meta.key !== key) issues.push(`key 与文件名不一致（${meta.key}）`);
    const title = String(meta.title || '').trim();
    const summary = String(meta.summary || '').trim();
    const content = String(meta.content || '');
    if (!title) issues.push('缺 title');
    if (!summary) issues.push('缺 summary');
    if (summary.length > 120) warns.push(`summary ${summary.length} 字，超过 120`);
    const text = toText(content);
    if (text.length < 300) warns.push(`正文仅 ${text.length} 字（规范 300–900）`);
    if (text.length > 1500) warns.push(`正文 ${text.length} 字，偏长`);

    // 标签白名单
    const tags = [...content.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());
    const badTags = [...new Set(tags.filter((t) => !ALLOWED_TAGS.has(t)))];
    if (badTags.length) issues.push('非法标签：' + badTags.join(','));
    if (/\sclass=|\sstyle=|\son[a-z]+=/i.test(content)) issues.push('出现 class/style/事件属性');

    // 内链白名单（链接可能写成源站标题，先归一到入库标题再比对）
    const links = [...content.matchAll(/\[\[([^\[\]|]+)(?:\|[^\[\]]+)?\]\]/g)].map((m) => finalTitle(m[1].trim()));
    const badLinks = [...new Set(links.filter((t) => !titles.has(t)))];
    if (badLinks.length) warns.push('内链不在上线清单：' + badLinks.join('、'));

    // 结构
    const h2s = [...content.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => toText(m[1]));
    if (!h2s.some((h) => h.includes('概述'))) warns.push('缺「概述」小节');
    if (!content.includes('<table') && !content.includes('<ul')) warns.push('既无表格也无要点列表');
    if (/来源与许可|CC BY-NC-SA/.test(content)) warns.push('正文自带来源声明（发布脚本会重复追加）');

    // 照抄检测
    let overlap = 0;
    let overlapSample = null;
    if (card) {
      const source = normCopy(card.lead + ' ' + (card.sections || []).map((s) => s.text).join(' '));
      const res = longestOverlap(normCopy(proseOnly(content)), source);
      overlap = res.len;
      overlapSample = res.sample;
      if (overlap >= COPY_FAIL) issues.push(`散文与原文连续重合 ${overlap} 字（红线 ${COPY_FAIL}）：「${overlapSample}」`);
      else if (overlap >= COPY_WARN) warns.push(`散文与原文连续重合 ${overlap} 字（告警线 ${COPY_WARN}）：「${overlapSample}」`);
    }

    const row = { key, title, chars: text.length, summaryLen: summary.length, links: links.length, badLinks, overlap, tables: (content.match(/<table/gi) || []).length, li: (content.match(/<li/gi) || []).length, h2: h2s };
    if (issues.length) report.fail.push({ ...row, issues, warns });
    else if (warns.length) report.warn.push({ ...row, warns });
    else report.pass.push(row);
  }

  fs.writeFileSync(path.join(DATA, 'validate-report.json'), JSON.stringify(report, null, 1), 'utf8');
  const maxOverlap = Math.max(0, ...report.pass.concat(report.warn, report.fail).map((r) => r.overlap || 0));
  console.log(`质检 ${report.total} 页：合格 ${report.pass.length} / 告警 ${report.warn.length} / 不合格 ${report.fail.length}   最长原文重合 ${maxOverlap} 字`);
  for (const r of report.fail) console.log(`  ✗ ${r.key}：${r.issues.join('；')}${r.warns && r.warns.length ? '  [告警] ' + r.warns.join('；') : ''}`);
  for (const r of report.warn.slice(0, 25)) console.log(`  ! ${r.key}：${r.warns.join('；')}`);
  if (report.warn.length > 25) console.log(`  … 另有 ${report.warn.length - 25} 条告警见 validate-report.json`);
  console.log('报告：data/mcwiki/validate-report.json');
  if (STRICT && report.fail.length) process.exit(2);
}

main();
