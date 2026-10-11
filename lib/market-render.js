/**
 * 「紫雪坊市公会集市」出图：二维码 / 分享海报 / 地图画
 *
 * 复用既有出图管线（lib/pay-render.js 的 sharp + Noto CJK，不引 Chromium）：
 *   - 二维码：qrcode 包直接出 PNG，内容永远是「短链绝对地址」https://xuanjian.top/q/<code>
 *   - 海报：SVG（店铺/商品信息 + 坐标 + 价格）→ PNG，再把二维码叠进预留位置
 *   - 地图画：按地图投影把店铺落点画成方块地图，用于游戏内地图画/宣传图
 *
 * 说明：海报只放公开信息（店铺名、商品名、价格、坐标、短链二维码），
 * **绝不放核销码**——核销码只在下单响应与买家订单页出现。
 */
const qrcode = require('qrcode');
const { renderPng, qrOverlay } = require('./pay-render');

const FONT = "'Noto Sans CJK SC','Noto Sans CJK JS','Noto Sans CJK JP',sans-serif";
const SITE = (process.env.SITE_URL || 'https://xuanjian.top').replace(/\/+$/, '');
const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => Number(n || 0).toFixed(2);

/** 短链绝对地址（二维码内容） */
const shortUrl = (code) => `${SITE}/q/${encodeURIComponent(String(code))}`;

/**
 * 生成二维码 PNG
 * @param {string} text 二维码内容
 * @param {{width?:number, dark?:string, light?:string, margin?:number}} opts
 */
async function qrPng(text, { width = 512, dark = '#1b1035', light = '#ffffff', margin = 2 } = {}) {
    return qrcode.toBuffer(String(text), {
        type: 'png', width, margin,
        errorCorrectionLevel: 'M',
        color: { dark, light }
    });
}

/** 短链二维码（带缓存，短链内容不会变） */
const qrCache = new Map();
const QR_CACHE_MAX = 300;
async function shortQrPng(code) {
    const key = String(code);
    if (qrCache.has(key)) return qrCache.get(key);
    const buf = await qrPng(shortUrl(key), { width: 512 });
    if (qrCache.size >= QR_CACHE_MAX) qrCache.delete(qrCache.keys().next().value);
    qrCache.set(key, buf);
    return buf;
}

/* ------------------------------- 分享海报 ------------------------------- */

function frame(W, H, body, accent = '#8b5cf6') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#171029"/><stop offset="60%" stop-color="#0d0a18"/><stop offset="100%" stop-color="#08060f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${accent}"/><stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="url(#accent)"/>
  <g opacity="0.5">
    <circle cx="${W - 60}" cy="70" r="2.5" fill="#c4b5fd"/>
    <circle cx="${W - 150}" cy="38" r="1.8" fill="#a5b4fc"/>
    <circle cx="${W - 240}" cy="96" r="2" fill="#e9d5ff"/>
    <circle cx="60" cy="130" r="1.6" fill="#a5b4fc"/>
    <circle cx="${W - 90}" cy="180" r="1.4" fill="#c4b5fd"/>
  </g>
  ${body}
</svg>`;
}

/**
 * 店铺/商品分享海报 SVG
 * @param {{kind:'store'|'product', title:string, subtitle?:string, storeName?:string, price?:number,
 *          stock?:number, tags?:string[], intro?:string, location?:string, rating?:number, sales?:number,
 *          code:string, qrSize?:number}} d
 */
function sharePosterSvg(d) {
    const W = 720;
    const qrSize = d.qrSize || 300;
    const H = 1000;
    const qrX = (W - qrSize) / 2;
    const qrY = 470;
    const kindLabel = d.kind === 'store' ? '店铺' : '商品';
    const tags = (d.tags || []).slice(0, 4);
    return frame(W, H, `
  <text x="40" y="64" font-family="${FONT}" font-size="18" fill="#9d8ec7">玄剑公会 · 紫雪坊市</text>
  <text x="40" y="128" font-family="${FONT}" font-size="40" font-weight="700" fill="#f5f3ff">${esc(String(d.title || '').slice(0, 14))}</text>
  <text x="40" y="164" font-family="${FONT}" font-size="17" fill="#a78bfa">${esc(kindLabel)}${d.storeName ? ' · ' + esc(String(d.storeName).slice(0, 16)) : ''}</text>
  ${d.subtitle ? `<text x="40" y="196" font-family="${FONT}" font-size="15" fill="#8b8aa8">${esc(String(d.subtitle).slice(0, 34))}</text>` : ''}

  ${d.price !== undefined && d.price !== null ? `
  <text x="40" y="268" font-family="${FONT}" font-size="15" fill="#8b8aa8">售价</text>
  <text x="40" y="316" font-family="${FONT}" font-size="46" font-weight="700" fill="#fbbf24">${money(d.price)}</text>
  <text x="${40 + String(money(d.price)).length * 28 + 12}" y="316" font-family="${FONT}" font-size="18" fill="#a78bfa">贡献点</text>
  ${d.stock !== undefined ? `<text x="${W - 40}" y="316" text-anchor="end" font-family="${FONT}" font-size="16" fill="#94a3b8">库存 ${Number(d.stock) || 0}</text>` : ''}` : ''}

  ${tags.map((t, i) => `
  <rect x="${40 + i * 132}" y="352" rx="14" width="120" height="34" fill="#2a1f47" stroke="#4c1d95"/>
  <text x="${100 + i * 132}" y="375" text-anchor="middle" font-family="${FONT}" font-size="14" fill="#ddd6fe">${esc(String(t).slice(0, 7))}</text>`).join('')}

  <rect x="${qrX - 16}" y="${qrY - 16}" width="${qrSize + 32}" height="${qrSize + 32}" rx="20" fill="#ffffff"/>
  <text x="${W / 2}" y="${qrY - 30}" text-anchor="middle" font-family="${FONT}" font-size="15" fill="#a1a1aa">扫码进坊市 · ${esc(SITE.replace(/^https?:\/\//, ''))}/q/${esc(d.code)}</text>

  <rect x="40" y="${qrY + qrSize + 46}" width="${W - 80}" height="1" fill="#312e5a"/>
  ${d.location ? `<text x="40" y="${qrY + qrSize + 92}" font-family="${FONT}" font-size="16" fill="#cbd5e1">坐标　${esc(String(d.location).slice(0, 40))}</text>` : ''}
  ${d.rating ? `<text x="40" y="${qrY + qrSize + 126}" font-family="${FONT}" font-size="16" fill="#cbd5e1">评分　${money(d.rating)} / 5</text>` : ''}
  ${d.sales !== undefined ? `<text x="${W - 40}" y="${qrY + qrSize + 126}" text-anchor="end" font-family="${FONT}" font-size="16" fill="#cbd5e1">成交 ${Number(d.sales) || 0} 单</text>` : ''}
  ${d.intro ? `<text x="40" y="${qrY + qrSize + 162}" font-family="${FONT}" font-size="14" fill="#8b8aa8">${esc(String(d.intro).slice(0, 40))}</text>` : ''}
  <text x="${W / 2}" y="${H - 34}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#4c4470">玄剑公会 · 紫雪坊市公会集市 · 贡献点交易</text>
`, d.kind === 'store' ? '#a855f7' : '#22d3ee');
}

/** 海报 PNG（内嵌二维码） */
async function sharePosterPng(d) {
    const qrSize = d.qrSize || 300;
    const qr = await qrPng(shortUrl(d.code), { width: qrSize, margin: 1 });
    const svg = sharePosterSvg({ ...d, qrSize });
    return renderPng(svg, [qrOverlay(qr, { left: Math.round((720 - qrSize) / 2), top: 470, size: qrSize })]);
}

/* ------------------------------- 地图画 ------------------------------- */

/**
 * 地图画（Minecraft map art 风格）：把一张 128×128 的落点图叠加到底图上，
 * 每个店铺点画成一小块色块（3×3 像素），并画十字准星与坐标刻度。
 * @param {{points:Array<{px:number,py:number,label?:string,highlight?:boolean}>, title?:string, size?:number}} d
 */
function mapArtSvg({ points = [], title = '紫雪坊市 · 店铺地图', size = 640 }) {
    const pad = 48;
    const inner = size - pad * 2;
    const px = (p) => pad + Math.max(0, Math.min(100, Number(p.px) || 0)) / 100 * inner;
    const py = (p) => pad + Math.max(0, Math.min(100, Number(p.py) || 0)) / 100 * inner;
    const ticks = [0, 25, 50, 75, 100];
    return frame(size, size, `
  <text x="${pad}" y="32" font-family="${FONT}" font-size="20" font-weight="700" fill="#f5f3ff">${esc(title)}</text>
  <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" fill="#0b1020" stroke="#3b2f63"/>
  ${ticks.map(t => `
  <line x1="${pad + t / 100 * inner}" y1="${pad}" x2="${pad + t / 100 * inner}" y2="${pad + inner}" stroke="#1e293b"/>
  <line x1="${pad}" y1="${pad + t / 100 * inner}" x2="${pad + inner}" y2="${pad + t / 100 * inner}" stroke="#1e293b"/>
  <text x="${pad + t / 100 * inner}" y="${pad - 8}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#64748b">${t}%</text>
  <text x="${pad - 8}" y="${pad + t / 100 * inner + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="#64748b">${t}%</text>`).join('')}
  ${points.map(p => {
        const x = px(p), y = py(p);
        const c = p.highlight ? '#fbbf24' : '#22d3ee';
        return `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="${c}"/>
  <rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.8"/>`;
    }).join('')}
  <text x="${pad}" y="${size - 18}" font-family="${FONT}" font-size="12" fill="#4c4470">共 ${points.length} 个落点 · 每格为地图百分比刻度</text>
`, '#22d3ee');
}

/** 地图画 PNG */
async function renderMapArt(d) {
    return renderPng(mapArtSvg(d));
}

module.exports = {
    shortUrl, qrPng, shortQrPng, sharePosterSvg, sharePosterPng, mapArtSvg, renderMapArt, FONT, SITE
};
