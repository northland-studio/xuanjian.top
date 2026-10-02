/**
 * Wiki 正文 / 通史整本 → PDF 导出（浏览器端）
 *
 * 设计要点：
 *  - 正文按块解析（DOMParser → 块数组）后逐块排版，输出的是**矢量文字**而不是页面截图；
 *  - 中文字体内嵌复用 lib/pdf-font.js（jsPDF 自带字体没有中文字形，不注册会乱码）；
 *  - 图片一律经同源代理 /api/gmirs/proxy-image 取回（cdn.xuanjian.top 有 CORS 限制），
 *    再经 canvas 缩放 + 转 JPEG dataURL 后交给 doc.addImage；
 *  - 表格走 jspdf-autotable（表头灰底）；
 *  - SSR 安全：模块顶层不访问 window / document，DOMParser 只在函数内部使用。
 *    调用方必须用动态 import（await import('../lib/wiki-pdf.js')），
 *    这样本模块不会进 SSR 产物、也不进首屏包。
 *
 * 只读复用：./pdf-font.js、../utils.js；不新增任何 npm 依赖。
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { CJK_FONT_NAME, registerCjkFont } from './pdf-font';

export const SITE_ORIGIN = 'https://xuanjian.top';

/* ==================== 版面常量 ==================== */

const PT2MM = 0.3527778;                 // 1pt = 0.3527778mm
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = { left: 18, right: 18, top: 18, bottom: 24 };
const CONTENT_W = PAGE_W - MARGIN.left - MARGIN.right;   // 174mm
const CONTENT_TOP = MARGIN.top;
const CONTENT_BOTTOM = PAGE_H - MARGIN.bottom;           // 273mm，页脚线之下不再排版
const FOOTER_LINE_Y = PAGE_H - 19.5;
const FOOTER_TEXT_Y = PAGE_H - 15;

const BODY_SIZE = 10.5;
const COLOR_TITLE = [17, 24, 39];
const COLOR_HEADING = [22, 34, 56];
const COLOR_BODY = [40, 44, 52];
const COLOR_MUTED = [122, 128, 140];
const COLOR_QUOTE = [104, 112, 126];
const COLOR_LINK = [24, 96, 176];
const COLOR_RULE = [214, 219, 228];

const IMG_MAX_SIDE = 1400;   // 图片最长边上限（px）
const IMG_QUALITY = 0.8;     // canvas → JPEG 质量

/* ==================== 通用小工具 ==================== */

const pad2 = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD（与 frontend/src/utils.js 的 formatDate(x, false) 输出一致） */
function fmtDay(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 20260728 */
export function ymdCompact(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

/** 文件名安全化：去掉 Windows / URL 非法字符 */
export function sanitizeFileName(name) {
  return String(name || '未命名')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 80) || '未命名';
}

function tagOf(node) {
  if (!node || node.nodeType !== 1) return '';
  return String(node.tagName || node.nodeName || node.name || '').toLowerCase();
}

function classesOf(el) {
  if (!el || el.nodeType !== 1) return [];
  const raw = typeof el.getAttribute === 'function'
    ? el.getAttribute('class')
    : el.className;
  return String(raw || '').split(/\s+/).filter(Boolean);
}

function hasClass(el, name) {
  if (!el) return false;
  if (typeof el.classList?.contains === 'function') return el.classList.contains(name);
  return classesOf(el).includes(name);
}

function elementChildren(el) {
  if (!el) return [];
  if (el.children && typeof el.children.length === 'number') return Array.from(el.children);
  return Array.from(el.childNodes || []).filter((n) => n.nodeType === 1);
}

function attr(el, name) {
  if (!el || typeof el.getAttribute !== 'function') return '';
  return el.getAttribute(name) || '';
}

/** 元素纯文本（含子节点），<br> 视作换行 */
function rawText(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  if (tagOf(node) === 'br') return '\n';
  if (typeof node.textContent === 'string') return node.textContent;
  return Array.from(node.childNodes || []).map(rawText).join('');
}

/**
 * 空白归一：折叠换行/连续空格，并去掉「中日韩字符之间」被 HTML 源码换行撑出来的空格，
 * 否则 jsPDF 排版时会看到字与字之间的多余空隙（中文字距问题）。
 */
export function collapse(text) {
  return String(text == null ? '' : text)
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef])\s+(?=[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef])/g, '$1')
    .trim();
}

/* ==================== HTML → 块数组（纯解析，可单测） ==================== */

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'font', 'i', 'ins', 'kbd', 'label', 'mark', 'q', 'ruby', 's', 'samp', 'small',
  'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr'
]);

const CARD_CLASSES = ['wiki-member-card', 'wiki-gen-card'];

function isInlineTag(tag) {
  return INLINE_TAGS.has(tag);
}

function isCardEl(el) {
  return CARD_CLASSES.some((c) => hasClass(el, c));
}

function isCardKind(el) {
  if (hasClass(el, 'wiki-gen-card')) return 'generation';
  if (hasClass(el, 'wiki-member-card')) return 'member';
  return '';
}

/**
 * 卡片（{{member:…}} / {{generation:…}} 短代码渲染结果）拆成名称 + 说明。
 * 渲染出来形如：
 *   <a class="wiki-member-card" …><img …><span class="wiki-member-meta">
 *     <b>白杨.</b><i>用户ID baiyangsz · 账号ID 3 · 紫雪镇一</i><i>游戏ID baiyangsz</i></span></a>
 *   <span class="wiki-gen-card" …><b>紫雪镇一</b><i>2021-05-05 ~ 2021-09-19 · 手动指定 3 人</i></span>
 */
function cardParts(el) {
  // 结构：<a class="wiki-member-card"><img><span class="wiki-member-meta"><b>名</b><i>…</i></span></a>
  //       <span class="wiki-gen-card"><b>代系</b><i>区间 · N 人</i></span>
  // <b>/<i> 可能被包在 .wiki-member-meta 里，所以要按后代找。
  const name = collapse(descendantsByTag(el, 'b').map((c) => rawText(c)).join(' ')) || collapse(rawText(el));
  const info = descendantsByTag(el, 'i')
    .map((c) => collapse(rawText(c)))
    .filter(Boolean)
    .join(' · ');
  return { name, info };
}

/** 卡片 → 独立成行的小字信息 */
function cardToText(el) {
  const { name, info } = cardParts(el);
  const prefix = isCardKind(el) === 'generation' ? '代系' : '成员';
  if (hasClass(el, 'wiki-member-missing') || hasClass(el, 'wiki-gen-missing')) {
    return `${prefix}：${name}（条目缺失）`;
  }
  return info ? `${prefix}：${name}（${info}）` : `${prefix}：${name}`;
}

/** 内联场景下的短写法（卡片夹在普通段落文字中间，只保留前两个字段） */
function cardToInlineText(el) {
  const { name, info } = cardParts(el);
  if (hasClass(el, 'wiki-member-missing') || hasClass(el, 'wiki-gen-missing')) return `${name}（条目缺失）`;
  const short = info.split(' · ').filter(Boolean).slice(0, 2).join(' · ');
  return short ? `${name}（${short}）` : name;
}

function firstByTag(el, tag) {
  for (const c of elementChildren(el)) {
    if (tagOf(c) === tag) return c;
    const deep = firstByTag(c, tag);
    if (deep) return deep;
  }
  return null;
}

/** 收集后代里指定标签（命中即不再往下钻，避免把 <b> 里的 <i> 也算进来） */
function descendantsByTag(node, tag, out = []) {
  for (const c of elementChildren(node)) {
    if (tagOf(c) === tag) out.push(c);
    else descendantsByTag(c, tag, out);
  }
  return out;
}

/** 找「唯一的卡片后代」，供整段只有卡片时单独成行 */
function findOnlyCard(el) {
  let found = null;
  let count = 0;
  let hasImg = false;
  const walk = (n) => {
    for (const c of elementChildren(n)) {
      if (isCardEl(c)) { count += 1; if (!found) found = c; continue; }
      if (tagOf(c) === 'img') hasImg = true;
      walk(c);
    }
  };
  walk(el);
  if (hasImg || count !== 1 || !found) return null;
  if (collapse(textExcluding(el, found))) return null;
  return found;
}

function textExcluding(node, skip) {
  if (!node || node === skip) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  let out = '';
  for (const c of Array.from(node.childNodes || [])) out += textExcluding(c, skip);
  return out;
}

function absoluteWikiUrl(href) {
  const h = String(href || '').trim();
  if (!h || h.startsWith('#')) return '';
  if (/^\/wiki\//.test(h)) return /^\/wiki\/editor/.test(h) ? '' : SITE_ORIGIN + h;
  const m = /^https?:\/\/(?:www\.)?xuanjian\.top(\/wiki\/.*)$/i.exec(h);
  return m ? SITE_ORIGIN + m[1] : '';
}

function collectLink(a, sink) {
  if (!sink || hasClass(a, 'wiki-member-card')) return;
  const url = absoluteWikiUrl(attr(a, 'href'));
  if (!url) return;
  sink.links.push({ text: collapse(rawText(a)) || url, url });
}

/** 行内节点 → 纯文本（顺带收集 wiki 链接、把卡片降级成短文本） */
function inlineText(node, sink) {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const tag = tagOf(node);
  if (tag === 'br') return '\n';
  if (tag === 'img' || tag === 'input' || tag === 'hr') return '';
  if (isCardEl(node)) return cardToInlineText(node);
  if (tag === 'a') collectLink(node, sink);
  let out = '';
  for (const c of Array.from(node.childNodes || [])) out += inlineText(c, sink);
  return out;
}

function imageBlock(imgEl) {
  return {
    type: 'image',
    src: String(attr(imgEl, 'src') || '').trim(),
    alt: collapse(attr(imgEl, 'alt')),
    caption: ''
  };
}

/** figure > img (+ figcaption) */
function figureBlocks(figureEl) {
  const out = [];
  const caption = collapse(elementChildren(figureEl)
    .filter((c) => tagOf(c) === 'figcaption')
    .map((c) => rawText(c))
    .join(' '));
  const imgs = [];
  const collect = (n) => {
    for (const c of elementChildren(n)) {
      if (tagOf(c) === 'img') imgs.push(c);
      else if (tagOf(c) === 'figcaption') continue;
      else collect(c);
    }
  };
  collect(figureEl);
  imgs.forEach((img, i) => {
    const b = imageBlock(img);
    // 图注只取 figcaption；alt 一般与正文「图1-1 …」重复，不当作图注
    if (caption) b.caption = imgs.length > 1 ? `${caption}（${i + 1}）` : caption;
    out.push(b);
  });
  if (!imgs.length) {
    const text = collapse(rawText(figureEl));
    if (text) out.push({ type: 'paragraph', text });
  }
  return out;
}

function tableBlock(tableEl) {
  const rows = [];
  const walk = (n, inHead) => {
    for (const c of elementChildren(n)) {
      const tag = tagOf(c);
      if (tag === 'tr') rows.push({ el: c, inHead });
      else if (tag === 'thead') walk(c, true);
      else if (tag === 'tbody' || tag === 'tfoot') walk(c, false);
      else walk(c, inHead);
    }
  };
  walk(tableEl, false);

  const parseCell = (cellEl) => {
    const text = String(rawText(cellEl) || '')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((s) => collapse(s))
      .filter(Boolean)
      .join('\n');
    const colSpan = Number(attr(cellEl, 'colspan')) || 1;
    const rowSpan = Number(attr(cellEl, 'rowspan')) || 1;
    const isHeader = tagOf(cellEl) === 'th';
    const cell = { content: text };
    if (colSpan > 1) cell.colSpan = colSpan;
    if (rowSpan > 1) cell.rowSpan = rowSpan;
    if (isHeader) cell.styles = { fontStyle: 'normal' };
    return cell;
  };

  const headRows = rows.filter((r) => r.inHead).map((r) => elementChildren(r.el).map(parseCell));
  let bodyRows = rows.filter((r) => !r.inHead).map((r) => elementChildren(r.el).map(parseCell));

  // 没有 thead 时：首行全是 th 才当作表头（首列是 th 的「行标题表」不算）
  if (!headRows.length && bodyRows.length) {
    const firstRow = rows.find((r) => !r.inHead);
    const ths = elementChildren(firstRow.el).filter((c) => tagOf(c) === 'th');
    const tds = elementChildren(firstRow.el).filter((c) => tagOf(c) === 'td');
    if (ths.length && !tds.length) {
      headRows.push(bodyRows[0]);
      bodyRows = bodyRows.slice(1);
    }
  }
  return { type: 'table', head: headRows, body: bodyRows };
}

function listBlock(listEl, sink) {
  const ordered = tagOf(listEl) === 'ol';
  const items = [];
  for (const li of elementChildren(listEl)) {
    if (tagOf(li) !== 'li') continue;
    let text = '';
    let checked = null;
    const subItems = [];
    for (const child of Array.from(li.childNodes || [])) {
      const tag = tagOf(child);
      if (child.nodeType === 1 && (tag === 'ul' || tag === 'ol')) {
        const sub = listBlock(child, sink);
        sub.items.forEach((si) => subItems.push({ text: si.text, ordered: sub.ordered, checked: si.checked }));
        continue;
      }
      if (child.nodeType === 1 && tag === 'input' && String(attr(child, 'type')).toLowerCase() === 'checkbox') {
        checked = attr(child, 'checked') !== '' || child.checked === true;
        continue;
      }
      if (child.nodeType === 1 && tag === 'label') {
        const input = firstByTag(child, 'input');
        if (input) checked = attr(input, 'checked') !== '' || input.checked === true;
        continue;   // 勾选框本身不产生文字
      }
      if (child.nodeType === 1 && tag === 'p') {
        const t = collapse(inlineText(child, sink));
        if (t) text += (text ? '\n' : '') + t;
        continue;
      }
      text += child.nodeType === 3 ? (child.nodeValue || '') : inlineText(child, sink);
    }
    items.push({ text: collapse(text), subItems, checked });
  }
  return { type: 'list', ordered, items };
}

function headingBlock(el) {
  return { type: 'heading', level: Number(tagOf(el).slice(1)) || 2, text: collapse(rawText(el)) };
}

function blockquoteBlock(el, sink) {
  return { type: 'blockquote', blocks: containerBlocks(el, sink) };
}

function codeBlock(el) {
  const code = firstByTag(el, 'code') || el;
  const lang = (classesOf(code).find((c) => c.startsWith('language-')) || '').replace('language-', '');
  const raw = String(rawText(code) || '').replace(/\r\n?/g, '\n');
  const text = raw.replace(/^\n+|\s+$/g, '');
  return { type: 'code', text, lang };
}

/** 段落型元素（p/div/span…）：内部可能混着图片、卡片，需要拆成多个块 */
function paragraphLikeBlocks(el, sink) {
  const out = [];
  let buf = '';
  const flush = () => {
    const t = collapse(buf);
    buf = '';
    if (t) out.push({ type: 'paragraph', text: t });
  };
  for (const child of Array.from(el.childNodes || [])) {
    if (child.nodeType === 3) { buf += child.nodeValue || ''; continue; }
    if (child.nodeType !== 1) continue;
    const tag = tagOf(child);
    if (tag === 'br') { buf += '\n'; continue; }
    if (tag === 'img') { flush(); out.push(imageBlock(child)); continue; }
    if (tag === 'figure') { flush(); out.push(...figureBlocks(child)); continue; }
    if (isCardEl(child)) { buf += ` ${cardToInlineText(child)} `; continue; }
    if (!isInlineTag(tag)) { flush(); out.push(...elementBlocks(child, sink)); continue; }
    buf += inlineText(child, sink);
  }
  flush();
  return out;
}

function paraBlocks(el, sink) {
  const card = findOnlyCard(el);
  if (card) {
    return [{
      type: 'card',
      kind: isCardKind(card) || 'member',
      text: cardToText(card)
    }];
  }
  return paragraphLikeBlocks(el, sink);
}

function hasBlockChild(el) {
  return elementChildren(el).some((c) => {
    const tag = tagOf(c);
    if (tag === 'img' || tag === 'br') return false;
    return !isInlineTag(tag);
  });
}

function elementBlocks(el, sink) {
  const tag = tagOf(el);
  if (/^h[1-6]$/.test(tag)) {
    const b = headingBlock(el);
    return b.text ? [b] : [];
  }
  if (tag === 'p') return paraBlocks(el, sink);
  if (tag === 'ul' || tag === 'ol') {
    const b = listBlock(el, sink);
    return b.items.length ? [b] : [];
  }
  if (tag === 'blockquote') return [blockquoteBlock(el, sink)];
  if (tag === 'pre') return [codeBlock(el)];
  if (tag === 'table') return [tableBlock(el)];
  if (tag === 'figure') return figureBlocks(el);
  if (tag === 'img') return [imageBlock(el)];
  if (tag === 'hr') return [{ type: 'hr' }];
  if (tag === 'br') return [];
  if (hasBlockChild(el)) return containerBlocks(el, sink);
  return paraBlocks(el, sink);
}

/** 容器 → 块数组：行内内容攒成段落，块级元素各自成块 */
function containerBlocks(el, sink) {
  const out = [];
  let buf = '';
  const flush = () => {
    const t = collapse(buf);
    buf = '';
    if (t) out.push({ type: 'paragraph', text: t });
  };
  for (const child of Array.from(el.childNodes || [])) {
    if (child.nodeType === 3) { buf += child.nodeValue || ''; continue; }
    if (child.nodeType !== 1) continue;
    const tag = tagOf(child);
    if (isInlineTag(tag)) {
      if (tag === 'br') { buf += '\n'; continue; }
      buf += inlineText(child, sink);
      continue;
    }
    flush();
    out.push(...elementBlocks(child, sink));
  }
  flush();
  return out;
}

function parseHtmlRoot(html) {
  if (typeof DOMParser === 'undefined') return null;   // 非浏览器环境（SSR）不解析
  try {
    const parsed = new DOMParser().parseFromString(`<body>${String(html || '')}</body>`, 'text/html');
    return parsed && parsed.body ? parsed.body : null;
  } catch {
    return null;
  }
}

/**
 * 正文 HTML → 块数组（纯函数，便于单测）
 *
 * 块类型：
 *   { type:'heading', level, text }
 *   { type:'paragraph', text }
 *   { type:'list', ordered, items:[{ text, checked, subItems:[{ text, ordered, checked }] }] }
 *   { type:'blockquote', blocks:[…] }
 *   { type:'code', text, lang }
 *   { type:'table', head:[[cell]], body:[[cell]] }   // cell = { content, colSpan?, rowSpan?, styles? }
 *   { type:'image', src, alt, caption }
 *   { type:'card', kind:'member'|'generation', text } // .wiki-member-card / .wiki-gen-card 降级
 *   { type:'hr' }
 *   { type:'links', title, items:[{ text, url }] }    // 文末「相关链接」
 *
 * @param {string} html 正文 HTML
 * @param {Element} [rootEl] 可选：直接给一个已解析的根元素（单测时注入即可，无需 DOMParser）
 */
export function htmlToBlocks(html, rootEl = null) {
  const root = rootEl || parseHtmlRoot(html);
  if (!root) return [];
  const sink = { links: [] };
  const blocks = containerBlocks(root, sink);
  if (sink.links.length) {
    const seen = new Set();
    const items = [];
    for (const l of sink.links) {
      if (seen.has(l.url)) continue;
      seen.add(l.url);
      items.push(l);
    }
    blocks.push({ type: 'links', title: '相关链接', items });
  }
  return blocks;
}

/** 供「相关链接」之外的地方复用：把块数组拍平成纯文本行 */
export function blocksToPlainLines(blocks) {
  const out = [];
  const push = (b) => {
    if (!b) return;
    if (b.type === 'heading') out.push({ kind: 'heading', level: b.level, text: b.text });
    else if (b.type === 'paragraph' || b.type === 'card') out.push({ kind: 'text', text: b.text });
    else if (b.type === 'code') out.push({ kind: 'text', text: b.text });
    else if (b.type === 'list') {
      b.items.forEach((it, i) => {
        out.push({ kind: 'text', text: `${b.ordered ? `${i + 1}.` : '·'} ${it.text}` });
        (it.subItems || []).forEach((s, j) => out.push({ kind: 'text', text: `   ${s.ordered ? `${j + 1}.` : '·'} ${s.text}` }));
      });
    } else if (b.type === 'blockquote') {
      (b.blocks || []).forEach((inner) => blocksToPlainLines([inner]).forEach((l) => out.push(l)));
    } else if (b.type === 'links') {
      b.items.forEach((l) => out.push({ kind: 'text', text: `${l.text} — ${l.url}` }));
    }
  };
  (blocks || []).forEach(push);
  return out;
}

/* ==================== 图片：代理 → canvas → JPEG dataURL ==================== */

function proxyUrlFor(src) {
  const s = String(src || '').trim();
  if (!s) return '';
  if (/^data:/i.test(s)) return s;
  // 跨域 CDN 图（cdn.xuanjian.top 等）必须走同源代理，否则 canvas 会被 CORS 污染
  if (/^https?:\/\//i.test(s)) return `/api/gmirs/proxy-image?url=${encodeURIComponent(s)}`;
  return s;   // 同源相对路径直接取
}

function sizeOf(source) {
  return {
    w: source.width || source.naturalWidth || 0,
    h: source.height || source.naturalHeight || 0
  };
}

function loadViaObjectUrl(objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = objectUrl;
  });
}

/**
 * 取图 → 缩放（最长边 ≤ IMG_MAX_SIDE）→ canvas → JPEG dataURL
 * @returns {Promise<{data:string,width:number,height:number}>}
 */
export async function loadImageEntry(src) {
  const url = proxyUrlFor(src);
  if (!url) throw new Error('图片地址为空');
  let source = null;
  let objectUrl = '';
  if (/^data:/i.test(url)) {
    source = await loadViaObjectUrl(url);
  } else {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`图片请求失败（HTTP ${res.status}）`);
    const blob = await res.blob();
    if (typeof createImageBitmap === 'function') {
      try { source = await createImageBitmap(blob); } catch { source = null; }
    }
    if (!source) {
      objectUrl = URL.createObjectURL(blob);
      source = await loadViaObjectUrl(objectUrl);
    }
  }
  try {
    const { w, h } = sizeOf(source);
    if (!w || !h) throw new Error('图片尺寸异常');
    const scale = Math.min(1, IMG_MAX_SIDE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = '#ffffff';          // 透明 PNG 转 JPEG 前铺白底，避免变黑
    c2d.fillRect(0, 0, cw, ch);
    c2d.drawImage(source, 0, 0, cw, ch);
    return { data: canvas.toDataURL('image/jpeg', IMG_QUALITY), width: cw, height: ch };
  } finally {
    if (source && typeof source.close === 'function') source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function collectImageSrcs(blocks, out = []) {
  for (const b of blocks || []) {
    if (!b) continue;
    if (b.type === 'image' && b.src && !out.includes(b.src)) out.push(b.src);
    if (b.type === 'blockquote' && b.blocks) collectImageSrcs(b.blocks, out);
  }
  return out;
}

/** 并发预取全部图片（限流 4），返回 Map<src, entry|null> */
async function preloadImages(blocks, onProgress) {
  const srcs = collectImageSrcs(blocks);
  const map = new Map();
  if (!srcs.length) return map;
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < srcs.length) {
      const src = srcs[cursor++];
      try {
        map.set(src, await loadImageEntry(src));
      } catch {
        map.set(src, null);
      }
      done += 1;
      onProgress?.(done / srcs.length);
    }
  };
  const n = Math.min(4, srcs.length);
  await Promise.all(Array.from({ length: n }, worker));
  return map;
}

/* ==================== 排版工具 ==================== */

function createCtx(doc, opts = {}) {
  return {
    doc,
    y: CONTENT_TOP,
    x: MARGIN.left,
    width: CONTENT_W,
    bottom: CONTENT_BOTTOM,
    slug: opts.slug || ''
  };
}

function ensureSpace(ctx, h) {
  if (ctx.y + h > ctx.bottom) {
    ctx.doc.addPage();
    ctx.y = CONTENT_TOP;
    return true;
  }
  return false;
}

function applyTextStyle(doc, size, color) {
  // 只注册了 normal（同一字体再注册一份 bold 会让 16MB 字体在 PDF 里嵌两份），
  // 标题的「加粗」观感由「同一行重绘一次、横向偏移 0.02em」模拟。
  doc.setFont(CJK_FONT_NAME, 'normal');
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}

function drawLine(doc, text, x, y, size, bold, opts) {
  doc.text(text, x, y, opts);
  if (bold) doc.text(text, x + Math.max(0.12, size * PT2MM * 0.032), y, opts);
}

/**
 * 画一段自动换行的文字。ctx.y 语义为「下一行的顶边」。
 */
function drawText(ctx, text, style = {}) {
  const doc = ctx.doc;
  const str = String(text == null ? '' : text);
  if (!str.trim()) return;
  const size = style.size || BODY_SIZE;
  const color = style.color || COLOR_BODY;
  const indent = style.indent || 0;
  const x = ctx.x + indent;
  const width = Math.max(10, (style.width == null ? ctx.width : style.width) - indent);
  const lh = style.lineHeight || size * PT2MM * 1.5;
  const asc = size * PT2MM * 0.83;

  applyTextStyle(doc, size, color);
  const lines = doc.splitTextToSize(str, width);
  if (style.before) ctx.y += style.before;
  lines.forEach((line) => {
    ensureSpace(ctx, lh);
    let tx = x;
    let opts;
    if (style.align === 'center') { tx = ctx.x + ctx.width / 2; opts = { align: 'center' }; }
    else if (style.align === 'right') { tx = ctx.x + ctx.width; opts = { align: 'right' }; }
    drawLine(doc, line, tx, ctx.y + asc, size, !!style.bold, opts);
    ctx.y += lh;
  });
  if (style.after) ctx.y += style.after;
}

function drawRule(ctx, gapBefore = 0, thickness = 0.25, color = COLOR_RULE) {
  const doc = ctx.doc;
  if (gapBefore) ctx.y += gapBefore;
  ensureSpace(ctx, 2);
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(thickness);
  doc.line(ctx.x, ctx.y, ctx.x + ctx.width, ctx.y);
  ctx.y += thickness + 1.5;
}

/* ==================== 块渲染 ==================== */

const HEADING_STYLE = {
  1: { size: 16, before: 6, after: 3 },
  2: { size: 14, before: 6.5, after: 3, rule: true },
  3: { size: 12, before: 5, after: 2.5 },
  4: { size: 11, before: 4, after: 2.2 },
  5: { size: 10.5, before: 3.5, after: 2 },
  6: { size: 10.5, before: 3.5, after: 2 }
};

function renderHeading(ctx, block) {
  const st = HEADING_STYLE[block.level] || HEADING_STYLE[4];
  const lh = st.size * PT2MM * 1.4;
  // 标题不与后续内容脱节：至少留出标题 + 两行正文的位置
  ensureSpace(ctx, st.before + lh + lh * 1.6);
  drawText(ctx, block.text, {
    size: st.size,
    color: COLOR_HEADING,
    bold: true,
    lineHeight: lh,
    before: st.before,
    after: st.after
  });
  if (st.rule) {
    const doc = ctx.doc;
    ensureSpace(ctx, 2);
    doc.setDrawColor(COLOR_RULE[0], COLOR_RULE[1], COLOR_RULE[2]);
    doc.setLineWidth(0.4);
    doc.line(ctx.x, ctx.y, ctx.x + Math.min(ctx.width, 60), ctx.y);
    ctx.y += 2.6;
  }
}

function drawListItem(ctx, marker, text, level) {
  const doc = ctx.doc;
  const size = BODY_SIZE;
  const lh = size * PT2MM * 1.5;
  const asc = size * PT2MM * 0.83;
  const markerX = ctx.x + (level === 0 ? 3.6 : 10.6);
  const textX = ctx.x + (level === 0 ? 8.5 : 15.5);
  const width = Math.max(20, ctx.width - (textX - ctx.x));
  applyTextStyle(doc, size, level === 0 ? COLOR_BODY : COLOR_QUOTE);
  const lines = doc.splitTextToSize(String(text || ''), width);
  if (!lines.length) return;
  ensureSpace(ctx, lh * 2);
  doc.text(marker, markerX, ctx.y + asc);
  doc.text(lines[0], textX, ctx.y + asc);
  ctx.y += lh;
  for (let i = 1; i < lines.length; i++) {
    ensureSpace(ctx, lh);
    doc.text(lines[i], textX, ctx.y + asc);
    ctx.y += lh;
  }
  ctx.y += 0.8;
}

function renderList(ctx, block) {
  const items = block.items || [];
  items.forEach((it, i) => {
    let marker = block.ordered ? `${i + 1}.` : '•';
    if (it.checked === true) marker = '☑';
    else if (it.checked === false) marker = '☐';
    drawListItem(ctx, marker, it.text, 0);
    (it.subItems || []).forEach((sub, j) => {
      drawListItem(ctx, sub.ordered ? `${j + 1}.` : '○', sub.text, 1);
    });
  });
  ctx.y += 1.4;
}

function renderQuote(ctx, block) {
  const inner = blocksToPlainLines(block.blocks || []).filter((l) => l.text);
  if (!inner.length) return;
  const doc = ctx.doc;
  const size = 10;
  const lh = size * PT2MM * 1.5;
  const asc = size * PT2MM * 0.83;
  const barX = ctx.x + 1.6;
  const textX = ctx.x + 7;
  const width = ctx.width - 7;
  ctx.y += 2;
  inner.forEach((line) => {
    const text = line.kind === 'heading' ? `【${line.text}】` : line.text;
    applyTextStyle(doc, size, COLOR_QUOTE);
    const lines = doc.splitTextToSize(text, width);
    lines.forEach((l) => {
      ensureSpace(ctx, lh);
      const top = ctx.y;
      doc.setDrawColor(198, 205, 218);
      doc.setLineWidth(0.7);
      doc.line(barX, top + 0.6, barX, top + lh - 1.2);
      doc.text(l, textX, top + asc);
      ctx.y += lh;
    });
  });
  ctx.y += 2.6;
}

function renderCode(ctx, block) {
  const doc = ctx.doc;
  const size = 9;
  const lh = size * PT2MM * 1.45;
  const asc = size * PT2MM * 0.83;
  const padX = 3;
  const padY = 1.2;
  const rawLines = String(block.text || '').split('\n');
  const wrapped = [];
  applyTextStyle(doc, size, [55, 60, 70]);
  rawLines.forEach((line) => {
    const parts = doc.splitTextToSize(line === '' ? ' ' : line, ctx.width - padX * 2);
    (parts.length ? parts : [' ']).forEach((p) => wrapped.push(p));
  });
  if (!wrapped.length) return;
  ctx.y += Math.max(1.5, padY);
  wrapped.forEach((line) => {
    if (ctx.y + lh > ctx.bottom) { doc.addPage(); ctx.y = CONTENT_TOP; }
    const top = ctx.y;
    doc.setFillColor(243, 245, 248);
    doc.rect(ctx.x, top - lh * 0.28, ctx.width, lh, 'F');
    applyTextStyle(doc, size, [55, 60, 70]);
    doc.text(line, ctx.x + padX, top + asc);
    ctx.y += lh;
  });
  ctx.y += padY + 2.4;
}

function renderTable(ctx, block) {
  const doc = ctx.doc;
  const head = (block.head && block.head.length) ? block.head : undefined;
  const body = block.body && block.body.length ? block.body : [[{ content: '（空表格）' }]];
  autoTable(doc, {
    startY: ctx.y,
    margin: { left: MARGIN.left, right: MARGIN.right, top: CONTENT_TOP, bottom: MARGIN.bottom },
    theme: 'grid',
    head,
    body,
    showHead: head ? 'everyPage' : 'never',
    styles: {
      font: CJK_FONT_NAME,
      fontStyle: 'normal',
      fontSize: 9,
      cellPadding: 2,
      overflow: 'linebreak',
      textColor: COLOR_BODY,
      lineColor: [223, 227, 234],
      lineWidth: 0.15
    },
    headStyles: {
      fillColor: [236, 239, 245],
      textColor: [30, 34, 42],
      fontStyle: 'normal',
      lineWidth: 0.15
    },
    alternateRowStyles: { fillColor: [250, 251, 253] }
  });
  const finalY = doc.lastAutoTable && typeof doc.lastAutoTable.finalY === 'number'
    ? doc.lastAutoTable.finalY
    : ctx.y;
  ctx.y = Math.min(finalY + 4, ctx.bottom);
  ctx.y += 2;
}

function renderImage(ctx, block, images) {
  const entry = images ? images.get(block.src) : null;
  if (!entry || !entry.data) {
    drawText(ctx, `［图片${block.alt ? `：${block.alt}` : ''}（未能载入）］`, {
      size: 8.5,
      color: COLOR_MUTED,
      align: 'center',
      before: 2,
      after: 2
    });
    return;
  }
  const maxH = 108;
  let w = ctx.width;
  let h = w * (entry.height / entry.width);
  if (h > maxH) {
    h = maxH;
    w = maxH * (entry.width / entry.height);
  }
  ctx.y += 2.5;
  ensureSpace(ctx, h + 2);
  const x = ctx.x + (ctx.width - w) / 2;
  try {
    ctx.doc.addImage(entry.data, 'JPEG', x, ctx.y, w, h);
  } catch {
    drawText(ctx, `［图片${block.alt ? `：${block.alt}` : ''}（嵌入失败）］`, {
      size: 8.5, color: COLOR_MUTED, align: 'center', after: 2
    });
    return;
  }
  ctx.y += h + 1.5;
  if (block.caption) {
    drawText(ctx, block.caption, { size: 8.5, color: COLOR_MUTED, align: 'center', after: 1 });
  }
  ctx.y += 3;
}

function renderCard(ctx, block) {
  drawText(ctx, block.text, {
    size: 8.5,
    color: COLOR_MUTED,
    indent: 2.5,
    before: 1.2,
    after: 2
  });
}

function renderLinks(ctx, block) {
  const items = (block.items || []).filter((l) => l.url);
  if (!items.length) return;
  drawRule(ctx, 3);
  drawText(ctx, block.title || '相关链接', { size: 11, color: COLOR_HEADING, bold: true, before: 1.5, after: 2 });
  items.forEach((l, i) => {
    drawText(ctx, `${i + 1}. ${l.text}`, { size: 9, color: COLOR_BODY, indent: 1, after: 0.6 });
    drawText(ctx, l.url, { size: 8.5, color: COLOR_LINK, indent: 6, after: 2.2 });
  });
}

function renderBlocks(ctx, blocks, images) {
  (blocks || []).forEach((b) => {
    if (!b) return;
    switch (b.type) {
      case 'heading': renderHeading(ctx, b); break;
      case 'paragraph': drawText(ctx, b.text, { size: BODY_SIZE, color: COLOR_BODY, after: 2.8 }); break;
      case 'list': renderList(ctx, b); break;
      case 'blockquote': renderQuote(ctx, b); break;
      case 'code': renderCode(ctx, b); break;
      case 'table': renderTable(ctx, b); break;
      case 'image': renderImage(ctx, b, images); break;
      case 'card': renderCard(ctx, b); break;
      case 'links': renderLinks(ctx, b); break;
      case 'hr': drawRule(ctx, 3); break;
      default: break;
    }
  });
}

/* ==================== 页眉 / 页脚 ==================== */

function renderArticleHeader(ctx, { page = {}, breadcrumb = [], exportedAt = new Date(), subtitle = '' } = {}) {
  const doc = ctx.doc;
  const topSize = 8.5;
  applyTextStyle(doc, topSize, COLOR_MUTED);
  const topBaseline = ctx.y + topSize * PT2MM * 0.83;
  doc.text('玄剑 Wiki · 文档导出', ctx.x, topBaseline);
  doc.text(`导出日期：${fmtDay(exportedAt)}`, ctx.x + ctx.width, topBaseline, { align: 'right' });
  ctx.y += topSize * PT2MM * 1.4 + 3.5;

  drawText(ctx, page.title || '未命名条目', {
    size: 19,
    color: COLOR_TITLE,
    bold: true,
    lineHeight: 19 * PT2MM * 1.3,
    after: 2.5
  });
  if (subtitle) drawText(ctx, subtitle, { size: 10, color: COLOR_MUTED, after: 2 });
  if (page.summary) {
    drawText(ctx, page.summary, { size: 10, color: [96, 102, 114], after: 3.2 });
  }

  const crumbs = ['Wiki', ...breadcrumb.map((b) => b.name || b.title || '').filter(Boolean), page.title || '']
    .filter(Boolean).join(' / ');
  drawText(ctx, crumbs, { size: 8.5, color: COLOR_MUTED, after: 1.6 });

  const meta = [];
  if (page.category_name) meta.push(`分类：${page.category_name}`);
  meta.push(`作者：${page.author_name || page.author_username || '—'}`);
  const editor = page.editor_name || page.editor_username;
  if (editor) meta.push(`最后编辑：${editor}${page.updated_at ? ` · ${fmtDay(page.updated_at)}` : ''}`);
  else if (page.updated_at) meta.push(`最后编辑：${fmtDay(page.updated_at)}`);
  if (page.created_at) meta.push(`创建：${fmtDay(page.created_at)}`);
  if (page.views != null) meta.push(`阅读：${page.views}`);
  drawText(ctx, meta.join('  ·  '), { size: 8.5, color: COLOR_MUTED, after: 0 });

  drawRule(ctx, 3.5, 0.5, [206, 212, 222]);
  ctx.y += 1.5;
}

function drawFooters(doc, { slug = '', leftText = '', rightText = '' } = {}) {
  const total = doc.getNumberOfPages();
  const left = leftText || `玄剑 Wiki · ${SITE_ORIGIN}/wiki/${slug}`;
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(COLOR_RULE[0], COLOR_RULE[1], COLOR_RULE[2]);
    doc.setLineWidth(0.2);
    doc.line(MARGIN.left, FOOTER_LINE_Y, PAGE_W - MARGIN.right, FOOTER_LINE_Y);
    applyTextStyle(doc, 8, COLOR_MUTED);
    doc.text(left, MARGIN.left, FOOTER_TEXT_Y);
    doc.text(rightText || `第 ${i} 页 / 共 ${total} 页`, PAGE_W - MARGIN.right, FOOTER_TEXT_Y, { align: 'right' });
  }
}

/* ==================== 对外入口 ==================== */

/**
 * 单篇 Wiki 文章 → PDF 并下载
 * @param {{ page:object, html:string, breadcrumb?:Array, onProgress?:(p:number)=>void }} params
 * @returns {Promise<string>} 文件名
 */
export async function exportWikiPdf({ page = {}, html = '', breadcrumb = [], onProgress } = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  onProgress?.(5);
  await registerCjkFont(doc);
  onProgress?.(12);

  const ctx = createCtx(doc, { slug: page.slug || '' });
  const exportedAt = new Date();
  const blocks = htmlToBlocks(html);
  const images = await preloadImages(blocks, (ratio) => onProgress?.(12 + Math.round(ratio * 60)));
  onProgress?.(76);

  renderArticleHeader(ctx, { page, breadcrumb, exportedAt });
  renderBlocks(ctx, blocks, images);
  drawFooters(doc, { slug: page.slug || '' });

  onProgress?.(100);
  const fileName = `玄剑Wiki-${sanitizeFileName(page.title)}-${ymdCompact(exportedAt)}.pdf`;
  saveAs(doc.output('blob'), fileName);
  return fileName;
}

/**
 * 整本通史 → 单个 PDF（封面 + 目录 + 每章另起一页）
 * @param {{ title?:string, subtitle?:string, chapters:Array<{page:object, html:string, breadcrumb?:Array}>,
 *           onProgress?:(p:number)=>void }} params
 */
export async function exportWikiBookPdf({ title = '玄剑公会通史', subtitle = '', chapters = [], onProgress } = {}) {
  const list = (chapters || []).filter((c) => c && c.page);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  onProgress?.(3);
  await registerCjkFont(doc);
  onProgress?.(8);

  const exportedAt = new Date();
  const ctx = createCtx(doc);

  // ---- 封面 ----
  ctx.y = 80;
  drawText(ctx, title, { size: 26, color: COLOR_TITLE, bold: true, align: 'center', lineHeight: 12, after: 6 });
  if (subtitle) drawText(ctx, subtitle, { size: 12, color: COLOR_MUTED, align: 'center', after: 8 });
  drawText(ctx, `共 ${list.length} 章 · ${SITE_ORIGIN}/wiki`, { size: 10, color: COLOR_MUTED, align: 'center', after: 6 });
  drawText(ctx, `导出日期：${fmtDay(exportedAt)}`, { size: 10, color: COLOR_MUTED, align: 'center' });

  // ---- 目录页（占位，页码最后回填）----
  doc.addPage();
  const tocPage = doc.getNumberOfPages();
  const tocCtx = createCtx(doc);
  drawText(tocCtx, '目录', { size: 18, color: COLOR_TITLE, bold: true, after: 4 });
  drawText(tocCtx, '（页码为 PDF 页序号，与阅读器显示一致）', { size: 8.5, color: COLOR_MUTED, after: 5 });

  // ---- 各章 ----
  const startPages = [];
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    doc.addPage();
    startPages.push(doc.getNumberOfPages());
    const c = createCtx(doc, { slug: ch.page.slug || '' });
    renderArticleHeader(c, { page: ch.page, breadcrumb: ch.breadcrumb || [], exportedAt });
    const blocks = htmlToBlocks(ch.html || '');
    // eslint-disable-next-line no-await-in-loop
    const images = await preloadImages(blocks, null);
    renderBlocks(c, blocks, images);
    onProgress?.(10 + Math.round(((i + 1) / Math.max(1, list.length)) * 85));
  }

  // ---- 回填目录 ----
  doc.setPage(tocPage);
  const rowH = 8.4;
  const perCol = Math.floor((CONTENT_BOTTOM - tocCtx.y) / rowH);
  const twoCol = list.length > perCol;
  const colW = twoCol ? (CONTENT_W - 8) / 2 : CONTENT_W;
  list.forEach((ch, i) => {
    const col = twoCol && i >= perCol ? 1 : 0;
    const idx = twoCol ? (col === 0 ? i : i - perCol) : i;
    const y = tocCtx.y + idx * rowH;
    const x = MARGIN.left + col * (colW + 8);
    const num = `${ch.page.chapter_no ? `${ch.page.chapter_no}. ` : ''}${ch.page.title || ''}`;
    const label = `${i + 1}. ${num}`;
    applyTextStyle(doc, 10, COLOR_BODY);
    const maxW = colW - 14;
    const text = doc.splitTextToSize(label, maxW)[0] || label;
    doc.text(text, x, y + 5.4);
    doc.setDrawColor(226, 230, 238);
    doc.setLineWidth(0.15);
    doc.line(x + Math.min(maxW, doc.getTextWidth(text) + 2), y + 5.6, x + colW - 10, y + 5.6);
    applyTextStyle(doc, 10, COLOR_HEADING);
    doc.text(String(startPages[i] || ''), x + colW - 8, y + 5.4, { align: 'right' });
  });

  drawFooters(doc, { leftText: `玄剑 Wiki · ${SITE_ORIGIN}/wiki`, rightText: `全书共 ${doc.getNumberOfPages()} 页` });

  onProgress?.(100);
  const fileName = `玄剑Wiki-${sanitizeFileName(title)}-全本-${ymdCompact(exportedAt)}.pdf`;
  saveAs(doc.output('blob'), fileName);
  return fileName;
}
