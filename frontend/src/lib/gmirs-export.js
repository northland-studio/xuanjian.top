/**
 * GMIRS 档案导出工具
 * 将单个/全部成员档案导出为 PDF / docx / ZIP（一键全部）。
 * 皮肤图通过离屏皮肤渲染器（preserveDrawingBuffer）截取 Canvas → dataURL 嵌入。
 *
 * 依赖：jspdf、jspdf-autotable、docx、jszip、file-saver
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, Table as DocTable, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from 'docx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// 贡献点流水类型在档案中的分组顺序（与后端 GROUP_ORDER 对齐）
const GROUP_ORDER = ['task', 'player_task', 'claim', 'transfer_in', 'transfer_out', 'purchase', 'title', 'reward', 'discipline', 'post', 'admin'];
const TYPE_LABELS = {
  claim: '贡献点申报', task: '官方任务', player_task: '玩家任务',
  transfer_in: '贡献点转入', transfer_out: '贡献点转出',
  purchase: '贡献点消费', title: '称号购买', reward: '签到奖励',
  admin: '管理调整', discipline: '处分扣点', post: '发帖奖励'
};

// ===== 通用工具 =====
const pad = n => String(n).padStart(2, '0');
function fmtDate(ts, withTime = false) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  const date = `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`;
  if (!withTime) return date;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtPoints(n) {
  if (n === null || n === undefined) return '0';
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
function sortGroups(groups) {
  if (!groups || !groups.length) return [];
  const ordered = [];
  GROUP_ORDER.forEach(t => { const g = groups.find(x => x.type === t); if (g) ordered.push(g); });
  groups.forEach(g => { if (!GROUP_ORDER.includes(g.type)) ordered.push(g); });
  return ordered;
}
// 每种类型表头子列（任务/申报带专属子列，其余用通用列）
function groupColumns(type) {
  if (type === 'task') return [
    { header: '官方/玩家任务', key: '__type__' },
    { header: '任务内容', key: 'detail' },
    { header: '给予点数', key: 'amount' },
    { header: '日期', key: 'created_at' }
  ];
  if (type === 'claim') return [
    { header: '申报内容', key: 'detail' },
    { header: '管理回复内容', key: 'reply' },
    { header: '给予点数', key: 'amount' },
    { header: '日期', key: 'created_at' }
  ];
  if (type === 'player_task') return [
    { header: '任务内容', key: 'detail' },
    { header: '给予点数', key: 'amount' },
    { header: '日期', key: 'created_at' }
  ];
  return [
    { header: '内容/说明', key: 'detail' },
    { header: '数量', key: 'amount' },
    { header: '日期', key: 'created_at' }
  ];
}

// ===== 中文字体加载与注册（jsPDF 默认字体不含中文，需嵌入 CJK 字体） =====
const CJK_FONT_FILE = 'cjk.ttf';
const CJK_FONT_NAME = 'DengXian';
let cjkFontBase64Promise = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// 缓存字体 Base64，避免重复请求与编码
function getCjkFontBase64() {
  if (!cjkFontBase64Promise) {
    cjkFontBase64Promise = fetch(`/fonts/${CJK_FONT_FILE}`)
      .then(res => { if (!res.ok) throw new Error('中文字体加载失败'); return res.arrayBuffer(); })
      .then(buf => arrayBufferToBase64(buf));
  }
  return cjkFontBase64Promise;
}

// 为单个 jsPDF 实例注册并启用中文字体（VFS 按文档实例存储）
async function registerCjkFont(doc) {
  const base64 = await getCjkFontBase64();
  doc.addFileToVFS(CJK_FONT_FILE, base64);
  doc.addFont(CJK_FONT_FILE, CJK_FONT_NAME, 'normal');
  doc.setFont(CJK_FONT_NAME, 'normal');
}

// 远程头像 → 圆形 PNG dataURL（用 canvas 裁剪为圆形，透明圆角，直接嵌入即可保证圆形显示）
async function loadCircularAvatarDataURL(url, size = 256) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(bmp, 0, 0, size, size);
    if (bmp.close) bmp.close();
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

// 圆形头像绘制：优先圆形 PNG，无图时绘制圆形底色 + 首字占位
function drawAvatar(doc, avatarDataUrl, fallbackChar, x, y, size) {
  if (avatarDataUrl) {
    doc.addImage(avatarDataUrl, x, y, size, size);
    return;
  }
  const r = size / 2;
  doc.setFillColor(240, 244, 250);
  doc.circle(x + r, y + r, r, 'F');
  doc.setTextColor(150);
  doc.setFontSize(14);
  doc.text(String(fallbackChar || '?'), x + r, y + r + 4, { align: 'center' });
}

// ===== 离线渲染皮肤 → PNG dataURL =====
// 通过动态 import skinview3d（独立 chunk），用 preserveDrawingBuffer 的离屏 canvas 截图
async function renderSkinToDataURL(skinUrl, width = 160, height = 200) {
  if (!skinUrl) return null;
  try {
    const { SkinViewer } = await import('skinview3d');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const viewer = new SkinViewer({
      canvas,
      width,
      height,
      skin: skinUrl,
      pixelRatio: 1,
      preserveDrawingBuffer: true,
      enableControls: false,
      animation: null,
      zoom: 1.05
    });
    viewer.render();
    await new Promise(r => setTimeout(r, 200));
    viewer.render();
    const dataURL = canvas.toDataURL('image/png');
    viewer.dispose();
    return dataURL;
  } catch (e) {
    // 皮肤加载失败/跨域等：返回占位
    return null;
  }
}

// ===== 构建档案展示数据（供两种导出复用，头部信息） =====
function buildHeader(archive) {
  const u = archive.user;
  return {
    nickname: u.nickname || u.username,
    id: u.id,
    username: u.username,
    gameId: u.game_id || '—',
    email: u.email || '未绑定邮箱',
    registered: fmtDate(u.created_at, false),
    balance: u.contribution ?? 0,
    verifyCode: archive.verify_code
  };
}

// ===== PDF 导出（jspdf + autotable） =====
export async function exportArchivePdf(archive, onProgress) {
  onProgress?.(10);
  const [skin, avatar] = await Promise.all([
    renderSkinToDataURL(archive.user.skin_path),
    loadCircularAvatarDataURL(archive.user.avatar)
  ]);
  onProgress?.(35);
  const doc = new jsPDF('p', 'mm', 'a4'); // 210 x 297
  await registerCjkFont(doc);
  onProgress?.(80);
  const pageW = 210, pageH = 297;
  const left = 20, right = 190;

  // 标题
  doc.setFont(CJK_FONT_NAME, 'normal');
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text('玄剑公会成员档案信息查询管理系统', 105, 20, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont(CJK_FONT_NAME, 'normal');
  doc.setTextColor(120);
  doc.text('Xuanjian Guild Member Information Retrieval System', 105, 25, { align: 'center' });

  // 圆形头像 + 名称
  const headY = 34;
  drawAvatar(doc, avatar, (archive.user.nickname || archive.user.username || '?').slice(0, 1), left, headY, 26);
  doc.setTextColor(20);
  doc.setFont(CJK_FONT_NAME, 'normal');
  doc.setFontSize(15);
  doc.text('【用户昵称】', 52, headY + 11);
  doc.setFontSize(12);
  doc.text(`${archive.user.nickname || archive.user.username}`, 52, headY + 11, { align: 'left' });
  doc.setFont(CJK_FONT_NAME, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`用户ID：${archive.user.id}`, 52, headY + 18);

  // 皮肤图（右上）
  if (skin) {
    doc.addImage(skin, 'PNG', 168, headY - 4, 22, 27);
  } else {
    doc.setDrawColor(200);
    doc.setFillColor(240, 244, 250);
    doc.roundedRect(168, headY - 4, 22, 27, 2, 2, 'FD');
    doc.setTextColor(150);
    doc.setFontSize(7);
    doc.text('用户皮肤图', 179, headY + 8, { align: 'center' });
  }

  // 基本信息表
  const infoY = headY + 32;
  autoTable(doc, {
    startY: infoY,
    margin: { left, right: 20 },
    theme: 'grid',
    styles: { font: CJK_FONT_NAME, fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [238, 240, 245], textColor: [30, 30, 30], fontStyle: 'normal' },
    body: [
      ['游戏ID', fmtText(archive.user.game_id), '注册时间', fmtDate(archive.user.created_at, false)],
      ['绑定邮箱', fmtText(archive.user.email), '贡献点余额', `${fmtPoints(archive.user.contribution)} 点`]
    ],
    columnStyles: {
      0: { cellWidth: 28, fontStyle: 'normal' },
      2: { cellWidth: 28, fontStyle: 'normal' }
    }
  });

  let y = doc.lastAutoTable.finalY + 10;

  // 处分记录
  doc.setFont(CJK_FONT_NAME, 'normal');
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text('处分记录', left, y);
  y += 4;
  const discRows = (archive.discipline || []).map(d => [
    fmtDate(d.created_at, false),
    d.level_text || String(d.level),
    (d.reason || '—') + (d.extra_penalty ? `\n附加：${d.extra_penalty}` : ''),
    d.admin_name || '系统',
    d.revoked_at ? `已撤销（${fmtDate(d.revoked_at, false)}）` : '生效中'
  ]);
  autoTable(doc, {
    startY: y,
    margin: { left, right: 20 },
    theme: 'striped',
    styles: { font: CJK_FONT_NAME, fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [238, 240, 245], textColor: [30, 30, 30], fontStyle: 'normal' },
    head: [['日期', '处分等级', '处分原因/附加惩罚', '处分人', '状态']],
    body: discRows.length ? discRows : [['暂无处分记录', '', '', '', '']]
  });
  y = doc.lastAutoTable.finalY + 10;

  // 贡献点明细（按类型分区段）
  doc.setFont(CJK_FONT_NAME, 'normal');
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text('贡献点明细', left, y);
  y += 4;
  const groups = sortGroups(archive.contribution?.groups);
  if (!groups.length) {
    autoTable(doc, {
      startY: y, margin: { left, right: 20 },
      theme: 'plain', styles: { font: CJK_FONT_NAME, fontSize: 9 },
      body: [['暂无贡献点流水']]
    });
    y = doc.lastAutoTable.finalY + 6;
  } else {
    groups.forEach(g => {
      const cols = groupColumns(g.type);
      const rows = g.items.map(it => cols.map(c => {
        if (c.key === '__type__') return g.type_label || TYPE_LABELS[g.type] || g.type;
        if (c.key === 'amount') return `${(it.amount ?? 0) >= 0 ? '+' : ''}${it.amount}`;
        if (c.key === 'created_at') return fmtDate(it.created_at, false);
        if (c.key === 'detail') return fmtText(it.detail) || fmtText(it.note);
        if (c.key === 'reply') return fmtText(it.reply) || '—';
        return fmtText(it[c.key]);
      }));
      // 分段标题：类型名
      doc.setFont(CJK_FONT_NAME, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(g.type_label || TYPE_LABELS[g.type] || g.type, left, y);
      autoTable(doc, {
        startY: y + 2,
        margin: { left, right: 20 },
        theme: 'grid',
        styles: { font: CJK_FONT_NAME, fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [244, 246, 250], textColor: [40, 40, 40], fontStyle: 'normal' },
        head: [cols.map(c => c.header)],
        body: rows.length ? rows : [cols.map(() => '—')]
      });
      y = doc.lastAutoTable.finalY + 3;
    });
  }

  // 页脚：导出日期 + 验证码查伪
  const footY = pageH - 16;
  doc.setDrawColor(220);
  doc.line(left, footY - 5, right, footY - 5);
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`导出日期：${fmtDate(new Date(), true)}`, left, footY);
  doc.setFont(CJK_FONT_NAME, 'normal');
  doc.setTextColor(60);
  doc.text(`验证码查伪：${archive.verify_code}`, right, footY, { align: 'right' });

  onProgress?.(100);
  doc.save(`玄剑公会成员档案-${archive.user.nickname || archive.user.username}-${archive.user.id}.pdf`);
}

// ===== docx 导出 =====
export async function exportArchiveDocx(archive, onProgress) {
  const u = archive.user;
  onProgress?.(10);
  const skin = await renderSkinToDataURL(u.skin_path);
  onProgress?.(60);
  const children = [];

  // 标题
  children.push(new Paragraph({ text: '玄剑公会成员档案信息查询管理系统', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }));
  children.push(new Paragraph({ text: 'Xuanjian Guild Member Information Retrieval System', alignment: AlignmentType.CENTER, style: 'IntenseQuote' }));

  // 头块：头像+昵称+皮肤图
  children.push(new Paragraph({ spacing: { before: 200 } }));
  if (skin) children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: dataURLToUint8(skin), transformation: { width: 120, height: 150 } })] }));
  children.push(new Paragraph({ text: `${u.nickname || u.username}（用户ID：${u.id}）`, heading: HeadingLevel.HEADING_2 }));

  // 基本信息表
  children.push(new DocTable({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
    rows: [
      new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ text: '游戏ID' })], width: { size: 15, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: fmtText(u.game_id) })] }),
        new TableCell({ children: [new Paragraph({ text: '注册时间' })], width: { size: 15, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: fmtDate(u.created_at, false) })] })
      ] }),
      new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ text: '绑定邮箱' })], width: { size: 15, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: fmtText(u.email) })] }),
        new TableCell({ children: [new Paragraph({ text: '贡献点余额' })], width: { size: 15, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: `${fmtPoints(u.contribution)} 点` })] })
      ] })
    ]
  }));

  children.push(new Paragraph({ text: '处分记录', heading: HeadingLevel.HEADING_3 }));
  const discRows = (archive.discipline || []).map(d => new TableRow({ children: [
    cell(`${fmtDate(d.created_at, false)}`),
    cell(d.level_text || String(d.level)),
    cell((d.reason || '—') + (d.extra_penalty ? `\n附加：${d.extra_penalty}` : '')),
    cell(d.admin_name || '系统'),
    cell(d.revoked_at ? `已撤销（${fmtDate(d.revoked_at, false)}）` : '生效中')
  ] }));
  children.push(new DocTable({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
    rows: [
      new TableRow({ children: [cell('日期', true), cell('处分等级', true), cell('处分原因/附加惩罚', true), cell('处分人', true), cell('状态', true)] }),
      ...(discRows.length ? discRows : [new TableRow({ children: discCells(['暂无处分记录', '', '', '', ''], true) })])
    ]
  }));

  children.push(new Paragraph({ text: '贡献点明细', heading: HeadingLevel.HEADING_3 }));
  const groups = sortGroups(archive.contribution?.groups);
  if (!groups.length) {
    children.push(new Paragraph({ text: '暂无贡献点流水' }));
  } else {
    groups.forEach(g => {
      const cols = groupColumns(g.type);
      children.push(new Paragraph({ text: g.type_label || TYPE_LABELS[g.type] || g.type, heading: HeadingLevel.HEADING_4 }));
      const head = cols.map(c => c.header);
      const rows = g.items.map(it => cols.map(c => {
        if (c.key === '__type__') return g.type_label || TYPE_LABELS[g.type] || g.type;
        if (c.key === 'amount') return `${(it.amount ?? 0) >= 0 ? '+' : ''}${it.amount}`;
        if (c.key === 'created_at') return fmtDate(it.created_at, false);
        if (c.key === 'detail') return fmtText(it.detail) || fmtText(it.note);
        if (c.key === 'reply') return fmtText(it.reply) || '—';
        return fmtText(it[c.key]);
      }));
      children.push(new DocTable({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: thinBorders(),
        rows: [
          new TableRow({ children: head.map(h => cell(h, true)) }),
          ...(rows.length ? rows.map(r => new TableRow({ children: r.map(v => cell(v || '—')) })) : [new TableRow({ children: cols.map(() => cell('—')) })])
        ]
      }));
    });
  }

  children.push(new Paragraph({ text: `导出日期：${fmtDate(new Date(), true)}    验证码查伪：${archive.verify_code}`, spacing: { before: 300 } }));

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  onProgress?.(90);
  saveAs(blob, `玄剑公会成员档案-${u.nickname || u.username}-${u.id}.docx`);
  onProgress?.(100);
}

// ===== 一键导出所有成员（ZIP：每个成员 PDF + 索引） =====
export async function exportAllArchivesZip(archives, onProgress) {
  const zip = new JSZip();
  const indexLines = [];
  const total = archives.length || 1;
  for (let i = 0; i < archives.length; i++) {
    const a = archives[i];
    const u = a.user;
    const [skin, avatar] = await Promise.all([
      renderSkinToDataURL(u.skin_path),
      loadCircularAvatarDataURL(u.avatar)
    ]);
    const doc = await buildPdfBuffer(a, skin, avatar);
    const fname = `成员档案_${(u.nickname || u.username)}_${u.id}.pdf`;
    zip.file(fname, doc.output('arraybuffer'));
    indexLines.push(`${(u.nickname || u.username)} | 用户ID:${u.id} | 验证码:${a.verify_code}`);
    onProgress?.(Math.round(((i + 1) / total) * 100));
  }
  zip.file('全部成员档案索引.txt', `玄剑公会成员档案索引（共 ${archives.length} 人）\n\n${indexLines.join('\n')}`);
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `玄剑公会全部成员档案_${fmtDate(new Date(), false).replace(/[年月日]/g, '')}.zip`);
  onProgress?.(100);
}

// ===== PDF 生成复用（返回 jsPDF 实例，供单/批量共用） =====
async function buildPdfBuffer(archive, skin, avatar) {
  const doc = new jsPDF('p', 'mm', 'a4');
  await registerCjkFont(doc);
  const pageW = 210, pageH = 297;
  const left = 20, right = 190;
  doc.setFont(CJK_FONT_NAME, 'normal'); doc.setFontSize(16); doc.setTextColor(20);
  doc.text('玄剑公会成员档案信息查询管理系统', 105, 20, { align: 'center' });
  doc.setFontSize(9); doc.setFont(CJK_FONT_NAME, 'normal'); doc.setTextColor(120);
  doc.text('Xuanjian Guild Member Information Retrieval System', 105, 25, { align: 'center' });

  const headY = 34;
  drawAvatar(doc, avatar, (archive.user.nickname || archive.user.username || '?').slice(0, 1), left, headY, 26);
  doc.setTextColor(20); doc.setFont(CJK_FONT_NAME, 'normal'); doc.setFontSize(15);
  doc.text(`${archive.user.nickname || archive.user.username}`, 52, headY + 11);
  doc.setFont(CJK_FONT_NAME, 'normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text(`用户ID：${archive.user.id}`, 52, headY + 18);
  if (skin) doc.addImage(skin, 'PNG', 168, headY - 4, 22, 27);
  else { doc.setFillColor(240, 244, 250); doc.roundedRect(168, headY - 4, 22, 27, 2, 2, 'FD'); doc.setTextColor(150); doc.setFontSize(7); doc.text('用户皮肤图', 179, headY + 8, { align: 'center' }); }

  const infoY = headY + 32;
  autoTable(doc, {
    startY: infoY, margin: { left, right: 20 }, theme: 'grid',
    styles: { font: CJK_FONT_NAME, fontSize: 9, cellPadding: 2.5 }, headStyles: { fillColor: [238, 240, 245], textColor: [30, 30, 30], fontStyle: 'normal' },
    body: [
      ['游戏ID', fmtText(archive.user.game_id), '注册时间', fmtDate(archive.user.created_at, false)],
      ['绑定邮箱', fmtText(archive.user.email), '贡献点余额', `${fmtPoints(archive.user.contribution)} 点`]
    ],
    columnStyles: { 0: { cellWidth: 28, fontStyle: 'normal' }, 2: { cellWidth: 28, fontStyle: 'normal' } }
  });
  let y = doc.lastAutoTable.finalY + 10;

  doc.setFont(CJK_FONT_NAME, 'normal'); doc.setFontSize(11); doc.setTextColor(20);
  doc.text('处分记录', left, y); y += 4;
  const discRows = (archive.discipline || []).map(d => [
    fmtDate(d.created_at, false), d.level_text || String(d.level),
    (d.reason || '—') + (d.extra_penalty ? `\n附加：${d.extra_penalty}` : ''),
    d.admin_name || '系统', d.revoked_at ? `已撤销（${fmtDate(d.revoked_at, false)}）` : '生效中'
  ]);
  autoTable(doc, {
    startY: y, margin: { left, right: 20 }, theme: 'striped',
    styles: { font: CJK_FONT_NAME, fontSize: 8.5, cellPadding: 2.5 }, headStyles: { fillColor: [238, 240, 245], textColor: [30, 30, 30], fontStyle: 'normal' },
    head: [['日期', '处分等级', '处分原因/附加惩罚', '处分人', '状态']],
    body: discRows.length ? discRows : [['暂无处分记录', '', '', '', '']]
  });
  y = doc.lastAutoTable.finalY + 10;

  doc.setFont(CJK_FONT_NAME, 'normal'); doc.setFontSize(11); doc.setTextColor(20);
  doc.text('贡献点明细', left, y); y += 4;
  const groups = sortGroups(archive.contribution?.groups);
  if (!groups.length) {
    autoTable(doc, { startY: y, margin: { left, right: 20 }, theme: 'plain', styles: { font: CJK_FONT_NAME, fontSize: 9 }, body: [['暂无贡献点流水']] });
    y = doc.lastAutoTable.finalY + 6;
  } else {
    groups.forEach(g => {
      const cols = groupColumns(g.type);
      const rows = g.items.map(it => cols.map(c => {
        if (c.key === '__type__') return g.type_label || TYPE_LABELS[g.type] || g.type;
        if (c.key === 'amount') return `${(it.amount ?? 0) >= 0 ? '+' : ''}${it.amount}`;
        if (c.key === 'created_at') return fmtDate(it.created_at, false);
        if (c.key === 'detail') return fmtText(it.detail) || fmtText(it.note);
        if (c.key === 'reply') return fmtText(it.reply) || '—';
        return fmtText(it[c.key]);
      }));
      doc.setFont(CJK_FONT_NAME, 'normal'); doc.setFontSize(9); doc.setTextColor(60);
      doc.text(g.type_label || TYPE_LABELS[g.type] || g.type, left, y);
      autoTable(doc, {
        startY: y + 2, margin: { left, right: 20 }, theme: 'grid',
        styles: { font: CJK_FONT_NAME, fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [244, 246, 250], textColor: [40, 40, 40], fontStyle: 'normal' },
        head: [cols.map(c => c.header)],
        body: rows.length ? rows : [cols.map(() => '—')]
      });
      y = doc.lastAutoTable.finalY + 3;
    });
  }

  const footY = pageH - 16;
  doc.setDrawColor(220); doc.line(left, footY - 5, right, footY - 5);
  doc.setFontSize(9); doc.setTextColor(90);
  doc.text(`导出日期：${fmtDate(new Date(), true)}`, left, footY);
  doc.setFont(CJK_FONT_NAME, 'normal'); doc.setTextColor(60);
  doc.text(`验证码查伪：${archive.verify_code}`, right, footY, { align: 'right' });
  return doc;
}

// ===== 辅助函数 =====
function fmtText(v) { return v === null || v === undefined || v === '' ? '—' : String(v); }
function dataURLToUint8(dataURL) {
  const base64 = dataURL.split(',')[1] || '';
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}
function thinBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }
  };
}
function cell(text, bold = false) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold })] })]
  });
}
function discCells(texts, bold = false) {
  return texts.map(t => cell(t, bold));
}
