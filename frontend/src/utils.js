// 通用工具函数

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
