/**
 * Wiki 条目的「群聊卡片」渲染：HTML → SVG 海报 → PNG（sharp）
 *
 * 为什么不用无头浏览器截图：
 *   官网已有成熟的 SVG→PNG 管线（lib/pay-render.js，sharp + Noto CJK，`#help` 卡片在用），
 *   渲染一张约 100ms；而 Chromium 截图要常驻几百 MB 进程、单张 1–3 秒，且 Wiki 页是
 *   三栏桌面布局，截成图在手机上反而难读。卡片只取"能一眼看完"的部分。
 *
 * 复用：wrap / esc / renderPng / SITE 都来自 pay-render，风格与现有卡片一致。
 */
const sanitizeHtml = require('sanitize-html');
const payRender = require('./pay-render');

const { wrap, esc, renderPng, SITE } = payRender;

const W = 860;                 // 卡片宽度
const PAD = 36;
const FONT = "'Noto Sans CJK SC','Noto Sans CJK JS','Noto Sans CJK JP',sans-serif";
const BG = '#0f172a';
const CARD = '#151f36';
const GOLD = '#fbbf24';
const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const LINE = '#243049';

/** HTML → 结构化摘要（段落 / 要点 / 表格行） */
function extractContent(html) {
  const raw = String(html || '');

  // 段落：只取 <p>，避免把 <h2> 标题、列表、来源声明混进正文节选
  const paras = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = pRe.exec(raw)) && paras.length < 12) {
    const t = sanitizeHtml(pm[1], { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
    // 跳过页面自带的"来源与许可"声明（卡片底部会统一标一次）与过短行
    if (t.length < 12 || /^来源与许可/.test(t) || /^本条目由玄剑公会 Wiki 依据/.test(t)) continue;
    paras.push(t);
  }
  const clean = sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} });

  // 要点：<li> 纯文本
  const points = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(raw)) && points.length < 8) {
    const t = sanitizeHtml(m[1], { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
    if (t.length > 4) points.push(t);
  }

  // 表格：各行拼成 "列1｜列2"
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let r;
  while ((r = rowRe.exec(raw)) && rows.length < 5) {
    const cells = [];
    const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let c;
    while ((c = cellRe.exec(r[1])) && cells.length < 4) {
      const t = sanitizeHtml(c[1], { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
      cells.push(t.slice(0, 22));
    }
    if (cells.some(Boolean)) rows.push(cells.join('｜'));
  }

  // 首图（正文内 <img src>），供合成到卡片顶部；跳过来源页脚里的图
  const bodyHtml = raw.split(/<h2[^>]*>\s*来源与许可/)[0];
  const imgMatch = bodyHtml.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i);
  const imageUrl = imgMatch ? imgMatch[1] : null;

  // 来源标注（我们导入的条目底部有来源与许可那段）
  const srcMatch = /Minecraft Wiki（中文）「([^」]{1,40})」/.exec(clean);
  const source = srcMatch ? `Minecraft Wiki（中文）「${srcMatch[1]}」` : null;

  return { paras, points, rows, imageUrl, source };
}

/** 生成卡片 SVG */
function wikiCardSvg(d) {
  const titleLines = wrap(d.title || '', 26, 2);
  const summaryLines = wrap(d.summary || '', 46, 3);
  const paraLines = [];
  for (const p of d.paras || []) {
    if (paraLines.length >= 8) break;
    for (const line of wrap(p, 46, 3)) paraLines.push(line);
  }

  const blocks = [];
  let y = 0;

  // 摘要
  if (summaryLines.length) {
    blocks.push({ kind: 'summary', lines: summaryLines });
  }
  // 正文节选
  if (paraLines.length) {
    blocks.push({ kind: 'section', label: '正文节选', lines: paraLines });
  }
  // 要点
  if ((d.points || []).length) {
    const lines = [];
    for (const p of d.points.slice(0, 6)) {
      const w = wrap(p, 42, 2);
      lines.push('· ' + w[0]);
      for (let i = 1; i < w.length; i++) lines.push('  ' + w[i]);
    }
    blocks.push({ kind: 'section', label: '要点', lines });
  }
  // 数据表
  if ((d.rows || []).length) {
    blocks.push({ kind: 'section', label: '关键数据', lines: d.rows.slice(0, 5) });
  }

  // 计算高度
  const HEAD_H = 132;
  const imageH = d.imageBox ? d.imageBox.height + 16 : 0;
  let bodyH = 0;
  for (const b of blocks) {
    if (b.kind === 'summary') bodyH += b.lines.length * 26 + 14;
    else bodyH += 26 + b.lines.length * 24 + 12; // 小标题 + 内容
  }
  const FOOT_H = 76;
  const H = HEAD_H + imageH + bodyH + FOOT_H + PAD;

  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" rx="18" fill="${BG}"/>`);
  parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="${LINE}"/>`);
  // 顶部品牌条
  parts.push(`<rect x="0" y="0" width="${W}" height="6" rx="3" fill="${GOLD}"/>`);
  parts.push(`<text x="${PAD}" y="46" font-family="${FONT}" font-size="15" fill="${MUTED}">玄剑公会 · Wiki 词条</text>`);
  if (d.categoryPath) {
    parts.push(`<text x="${PAD}" y="70" font-family="${FONT}" font-size="13" fill="#64748b">${esc(d.categoryPath)}</text>`);
  }
  let ty = 104;
  for (const line of titleLines) {
    parts.push(`<text x="${PAD}" y="${ty}" font-family="${FONT}" font-size="30" font-weight="700" fill="${TEXT}">${esc(line)}</text>`);
    ty += 38;
  }

  let cy = HEAD_H + imageH;
  for (const b of blocks) {
    if (b.kind === 'summary') {
      for (const line of b.lines) {
        parts.push(`<text x="${PAD}" y="${cy + 18}" font-family="${FONT}" font-size="16" fill="${MUTED}">${esc(line)}</text>`);
        cy += 26;
      }
      cy += 14;
      continue;
    }
    parts.push(`<rect x="${PAD}" y="${cy + 2}" width="4" height="18" rx="2" fill="${GOLD}"/>`);
    parts.push(`<text x="${PAD + 12}" y="${cy + 17}" font-family="${FONT}" font-size="15" font-weight="700" fill="${GOLD}">${esc(b.label)}</text>`);
    cy += 26;
    for (const line of b.lines) {
      parts.push(`<text x="${PAD}" y="${cy + 16}" font-family="${FONT}" font-size="15" fill="${TEXT}">${esc(line)}</text>`);
      cy += 24;
    }
    cy += 12;
  }

  // 页脚：来源与访问地址
  const fy = H - FOOT_H;
  parts.push(`<line x1="${PAD}" y1="${fy}" x2="${W - PAD}" y2="${fy}" stroke="${LINE}"/>`);
  if (d.source) {
    parts.push(`<text x="${PAD}" y="${fy + 26}" font-family="${FONT}" font-size="13" fill="${MUTED}">来源：${esc(d.source)}（CC BY-NC-SA 3.0，正文为本站改写）</text>`);
  }
  parts.push(`<text x="${PAD}" y="${fy + 50}" font-family="${FONT}" font-size="13" fill="#64748b">完整内容与图片请访问：${esc(d.url || SITE)}</text>`);

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`,
    height: H,
    imageBox: d.imageBox || null
  };
}

/** 首图合成：把页面首图缩放后贴到标题下方（失败就返回空，不影响出图） */
async function imageOverlayFor(imageUrl) {
  if (!imageUrl) return null;
  try {
    const resp = await fetch(imageUrl, { headers: { 'User-Agent': 'xuanjian-wiki-card/1.0' } });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return null;
    const sharp = require('sharp');
    const boxW = W - PAD * 2;
    const boxH = 240;
    const resized = await sharp(buf, { failOn: 'none' })
      .resize({ width: boxW, height: boxH, fit: 'contain', background: { r: 21, g: 31, b: 54, alpha: 0 } })
      .png()
      .toBuffer();
    const meta = await sharp(resized).metadata();
    const overlay = {
      input: resized,
      left: PAD + Math.max(0, Math.round((boxW - (meta.width || boxW)) / 2)),
      top: 132,
      width: meta.width,
      height: meta.height
    };
    return { overlay, height: meta.height || boxH };
  } catch (e) {
    return null;
  }
}

/**
 * 出一张卡片 PNG。
 * @param {object} page wiki_pages 行（含 title/summary/content/category_name/updated_at/views）
 * @returns {Promise<Buffer>}
 */
async function renderWikiCard(page) {
  const { paras, points, rows, imageUrl, source } = extractContent(page.content);
  const img = await imageOverlayFor(imageUrl);
  const built = wikiCardSvg({
    title: page.title,
    summary: page.summary || paras[0] || '',
    categoryPath: page.category_name ? `分类：${page.category_name}` : '',
    paras,
    points,
    rows,
    source,
    url: `${SITE}/wiki/${page.slug}`,
    imageBox: img ? { height: img.height } : null
  });
  const overlays = img ? [img.overlay] : [];
  return renderPng(built.svg, overlays);
}

module.exports = { renderWikiCard, wikiCardSvg, extractContent, W, PAD };
