// 通用工具函数

// 贡献点格式化：固定保留小数点后两位，四舍五入（如 21 -> 21.00, 20.8 -> 20.80）
export function fmtPoints(n) {
  if (n === null || n === undefined || n === '') return '0.00';
  const num = Number(n);
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 格式化日期时间
export function formatDate(dateStr, withTime = true) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = n => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!withTime) return date;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 相对时间
export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;
  return formatDate(dateStr, false);
}

// 内容类型标签配置
export const TYPE_META = {
  daily: { label: '日报', color: 'var(--primary)' },
  decision: { label: '决策', color: 'var(--warning)' },
  forum: { label: '贴吧', color: 'var(--success)' }
};

// 检查登录状态（返回 true 则跳转登录页）
export function requireLogin(navigate, message) {
  const token = localStorage.getItem('token');
  if (!token) {
    navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}${message ? `&msg=${encodeURIComponent(message)}` : ''}`);
    return false;
  }
  return true;
}

// 解析 tags 字段（可能是逗号分隔字符串或数组）
export function parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter(Boolean);
  return tags.split(',').map(t => t.trim()).filter(Boolean);
}

// HTML 转纯文本（用于列表摘要）
// 浏览器里走 DOM（最准确）；SSR/SSG 的 Node 环境没有 document，退回「去标签 + 解实体」的等价实现，
// 否则内容列表（日报/决策/贴吧）在服务端渲染时会直接抛 document is not defined。
const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  hellip: '…', mdash: '—', ndash: '–', middot: '·',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’'
};
function decodeEntities(str) {
  return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : m;
  });
}
export function stripHtml(html) {
  if (!html) return '';
  if (typeof document === 'undefined') {
    return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

// 高亮匹配关键词（返回安全 HTML，配合 dangerouslySetInnerHTML 使用）
export function highlightHtml(text, keyword) {
  if (!text) return '';
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  if (!keyword) return safe;
  const kw = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!kw) return safe;
  return safe.replace(new RegExp(`(${kw})`, 'gi'), '<mark>$1</mark>');
}

// 富文本归一化：纯文本（无 HTML 标签）内容将换行符转为 <br>，避免渲染时折叠不换行
export function normalizeRichContent(html) {
  if (!html) return '';
  if (!/<[a-zA-Z][^>]*>/.test(html)) {
    return String(html).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
  }
  return html;
}
