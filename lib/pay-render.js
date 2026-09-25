/**
 * 贡献点支付：服务端出图（SVG → PNG，sharp 渲染）
 *
 * 用途：QQ 群机器人直接把「缴费单海报 / 财务对账海报」作为图片发到群里，
 * 群里不用点链接也能看清金额、截止与进度（微信内置浏览器体验差的场景尤其有用）。
 *
 * 约定：
 *  - 中文渲染依赖系统 CJK 字体（HK 已装 fonts-noto-cjk），字体族统一走 NotoSansCJK。
 *  - 缴费单海报是**公开只读**的（不含名单姓名，避免泄露成员信息）；
 *    财务对账海报含管理数据，必须用签名链接访问，见 signRender / verifyRender。
 *  - 所有金额一律两位小数（fmtPoints 口径）。
 */
const crypto = require('crypto');

const FONT = "'Noto Sans CJK SC','Noto Sans CJK JS','Noto Sans CJK JP',sans-serif";
const SITE = (process.env.SITE_URL || 'https://xuanjian.top').replace(/\/+$/, '');

const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (n) => Number(n || 0).toFixed(2);
const fmtTime = (s) => String(s || '').slice(0, 16);

/** 按字符数折行（中英混排够用，不追求排版精度） */
function wrap(text, perLine, maxLines = 2) {
    const chars = [...String(text || '')];
    const lines = [];
    for (let i = 0; i < chars.length && lines.length < maxLines; i += perLine) {
        lines.push(chars.slice(i, i + perLine).join(''));
    }
    if (chars.length > perLine * maxLines) {
        lines[maxLines - 1] = lines[maxLines - 1].slice(0, perLine - 1) + '…';
    }
    return lines;
}

function progressBar(x, y, w, h, percent, color) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#1b2436"/>
  <rect x="${x}" y="${y}" width="${Math.max(2, Math.round(w * p / 100))}" height="${h}" rx="${h / 2}" fill="${color}"/>`;
}

function frame(width, height, body) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d1526"/><stop offset="100%" stop-color="#131c30"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="24" fill="url(#bg)"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="23" fill="none" stroke="#233049" stroke-width="2"/>
  <rect x="0" y="0" width="${width}" height="8" rx="4" fill="url(#accent)"/>
${body}
</svg>`;
}

/**
 * 缴费单海报
 * @param {object} d { title, amount, note, deadline, payee, stats:{count,paidCount,total,paidSum}, token, expired }
 */
function chargePosterSvg(d) {
    const W = 660, H = 1000;
    const titleLines = wrap(d.title || '缴费单', 13, 2);
    const percentP = d.stats && d.stats.count ? Math.round((d.stats.paidCount / d.stats.count) * 100) : 0;
    const percentM = d.stats && d.stats.total ? Math.round((d.stats.paidSum / d.stats.total) * 100) : 0;
    const amountText = d.amount === null || d.amount === undefined ? '按人填写' : `${money(d.amount)} 贡献点/人`;

    return frame(W, H, `
  <text x="40" y="70" font-family="${FONT}" font-size="18" fill="#7f8ea8">玄剑公会 · 缴费单</text>
  <text x="40" y="106" font-family="${FONT}" font-size="16" fill="${d.expired ? '#f87171' : '#34d399'}">${d.expired ? '已截止 / 已关闭' : '进行中'}</text>

  ${titleLines.map((line, i) => `<text x="40" y="${172 + i * 50}" font-family="${FONT}" font-size="40" font-weight="700" fill="#f1f5f9">${esc(line)}</text>`).join('')}

  <text x="40" y="${300}" font-family="${FONT}" font-size="17" fill="#7f8ea8">应缴金额</text>
  <text x="40" y="${348}" font-family="${FONT}" font-size="38" font-weight="700" fill="#fbbf24">${esc(amountText)}</text>

  <text x="40" y="${400}" font-family="${FONT}" font-size="15" fill="#7f8ea8">截止时间：<tspan fill="#cbd5e1">${esc(fmtTime(d.deadline))}</tspan></text>
  <text x="40" y="${428}" font-family="${FONT}" font-size="15" fill="#7f8ea8">收款方：<tspan fill="#cbd5e1">${esc(d.payee || '—')}</tspan></text>
  ${d.note ? `<text x="40" y="${456}" font-family="${FONT}" font-size="15" fill="#7f8ea8">说明：<tspan fill="#cbd5e1">${esc(String(d.note).slice(0, 28))}</tspan></text>` : ''}

  <text x="40" y="${512}" font-family="${FONT}" font-size="17" font-weight="700" fill="#e2e8f0">缴费进度</text>
  <text x="40" y="${544}" font-family="${FONT}" font-size="15" fill="#94a3b8">人数 ${d.stats ? d.stats.paidCount : 0} / ${d.stats ? d.stats.count : 0}</text>
  <text x="${W - 40}" y="${544}" text-anchor="end" font-family="${FONT}" font-size="15" font-weight="700" fill="#38bdf8">${percentP}%</text>
  ${progressBar(40, 556, W - 80, 14, percentP, '#38bdf8')}

  <text x="40" y="${612}" font-family="${FONT}" font-size="15" fill="#94a3b8">金额 ${money(d.stats ? d.stats.paidSum : 0)} / ${money(d.stats ? d.stats.total : 0)}</text>
  <text x="${W - 40}" y="${612}" text-anchor="end" font-family="${FONT}" font-size="15" font-weight="700" fill="#34d399">${percentM}%</text>
  ${progressBar(40, 624, W - 80, 14, percentM, '#34d399')}

  <rect x="40" y="664" width="${W - 80}" height="240" rx="18" fill="#0a1120" stroke="#233049" stroke-width="1.5"/>
  <text x="${W / 2}" y="698" text-anchor="middle" font-family="${FONT}" font-size="16" fill="#94a3b8">扫码打开缴费单</text>
  <text x="${W / 2}" y="886" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#64748b">${esc(`${SITE}/pay/charge/${d.token}`)}</text>

  <text x="40" y="940" font-family="${FONT}" font-size="13" fill="#64748b">名单成员请在自己登录的官网会话里确认支付，机器人不会代扣。</text>
  <text x="40" y="968" font-family="${FONT}" font-size="13" fill="#475569">生成时间 ${esc(fmtTime(d.generatedAt))}</text>
`);
}

/**
 * 财务对账海报（管理数据，必须签名访问）
 * @param {object} s /api/pay/admin/summary 的返回体
 */
function summaryPosterSvg(s) {
    const W = 720;
    const tops = (s.topPayees || []).slice(0, 5);
    const H = 720 + tops.length * 34;
    const rows = [
        ['今日支付', `${money(s.today?.sum)} 点`, `${s.today?.count || 0} 笔`],
        ['近 7 天', `${money(s.week?.sum)} 点`, ''],
        ['累计支付', `${money(s.total?.sum)} 点`, `${s.total?.count || 0} 笔`],
        ['待审批', `${money(s.pending?.sum)} 点`, `${s.pending?.count || 0} 笔`],
        ['系统金库', `${money(s.vault?.balance)} 点`, s.vault?.name || '玄剑财政']
    ];
    return frame(W, H, `
  <text x="40" y="70" font-family="${FONT}" font-size="18" fill="#7f8ea8">玄剑公会 · 财务对账</text>
  <text x="40" y="120" font-family="${FONT}" font-size="38" font-weight="700" fill="#f1f5f9">贡献点对账概览</text>
  <text x="40" y="156" font-family="${FONT}" font-size="15" fill="#64748b">生成时间 ${esc(fmtTime(s.generatedAt))} · 活跃二维码 ${s.activeCodes || 0} 个</text>

  ${rows.map((r, i) => {
        const y = 212 + i * 54;
        return `<rect x="40" y="${y - 30}" width="${W - 80}" height="44" rx="12" fill="#0f1728"/>
  <text x="58" y="${y}" font-family="${FONT}" font-size="16" fill="#94a3b8">${esc(r[0])}</text>
  <text x="${W - 58}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="18" font-weight="700" fill="#e2e8f0">${esc(r[1])}</text>
  <text x="${W - 190}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="14" fill="#64748b">${esc(r[2])}</text>`;
    }).join('')}

  <text x="40" y="${212 + rows.length * 54 + 18}" font-family="${FONT}" font-size="17" font-weight="700" fill="#e2e8f0">Top 收款方</text>
  ${tops.length === 0
            ? `<text x="40" y="${212 + rows.length * 54 + 52}" font-family="${FONT}" font-size="14" fill="#64748b">暂无成功支付记录</text>`
            : tops.map((t, i) => {
                const y = 212 + rows.length * 54 + 56 + i * 34;
                return `<text x="40" y="${y}" font-family="${FONT}" font-size="15" fill="#cbd5e1">${i + 1}. ${esc(String(t.name || '').slice(0, 16))}</text>
  <text x="${W - 40}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="15" font-weight="700" fill="#38bdf8">${money(t.sum)} 点 · ${t.count} 笔</text>`;
            }).join('')}

  <text x="40" y="${H - 40}" font-family="${FONT}" font-size="13" fill="#475569">风控阈值：单笔 ${money(s.thresholds?.single)} · 单日 ${money(s.thresholds?.daily)} · 超 ${money(s.thresholds?.approval)} 转审批</text>
`);
}

/** SVG 字符串 → PNG Buffer（可叠加二维码 PNG） */
async function renderPng(svg, overlays = []) {
    const sharp = require('sharp');
    const base = sharp(Buffer.from(svg)).png();
    if (!overlays.length) return base.toBuffer();
    return base.composite(overlays).png().toBuffer();
}

/** 把二维码 PNG 放到缴费单海报中央 */
function qrOverlay(qrBuffer, { left, top, size }) {
    return { input: qrBuffer, left, top, width: size, height: size };
}

/* ------------------------------- 签名链接 ------------------------------- */

const SIGN_TTL = 600; // 10 分钟

function hmac(kind, exp) {
    const secret = process.env.JWT_SECRET || 'xuanjian-pay-render';
    return crypto.createHmac('sha256', secret).update(`${kind}:${exp}`).digest('hex').slice(0, 32);
}

/** 生成带签名的渲染链接（供机器人取图，QQ 取图不带请求头） */
function signRender(kind, ttlSec = SIGN_TTL) {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    return `${SITE}/api/pay/render/${kind}.png?exp=${exp}&sig=${hmac(kind, exp)}`;
}

/** 校验签名（时间戳 + 常量时间比较） */
function verifyRender(kind, exp, sig) {
    const e = parseInt(exp, 10);
    if (!Number.isFinite(e)) return false;
    if (e < Math.floor(Date.now() / 1000)) return false;
    if (e > Math.floor(Date.now() / 1000) + SIGN_TTL + 60) return false;
    const expect = hmac(kind, e);
    const got = String(sig || '');
    if (got.length !== expect.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(got));
    } catch (_) {
        return false;
    }
}

module.exports = { chargePosterSvg, summaryPosterSvg, renderPng, qrOverlay, signRender, verifyRender, wrap, esc, SITE };
