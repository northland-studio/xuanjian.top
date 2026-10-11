// 集市专用小工具（只放在 frontend/src/market/ 下，不改动共享 utils.js）
import { parseTags } from '../utils';

/**
 * 集市 tags 字段兼容解析：
 * 后端 market_stores.tags / market_products.tags 存的是 JSON 数组字符串（如 '["24h","附魔书"]'），
 * 而共享的 parseTags 只处理「逗号分隔字符串或真数组」，直接用它会把 '["24h"' 当成一个标签。
 * 这里先尝试 JSON.parse，失败再回退到 parseTags（同时兜住逗号分隔的历史数据）。
 */
export function marketTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return parseTags(tags);
  if (typeof tags === 'string') {
    const s = tags.trim();
    if (s.startsWith('[')) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.map(t => String(t).trim()).filter(Boolean);
      } catch { /* 非法 JSON 时回退 */ }
    }
  }
  return parseTags(tags);
}

/** 数字金额格式化（贡献点，两位小数） */
export function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : '0.00';
}

/** 订单/店铺状态 → badge 类名 */
export function badgeClass(status) {
  if (['settled', 'active'].includes(status)) return 'badge-success';
  if (['paid', 'delivered'].includes(status)) return 'badge-primary';
  if (['refunding', 'refunded', 'disputed', 'suspended', 'rejected'].includes(status)) return 'badge-danger';
  if (['pending', 'pending_payment', 'awaiting_confirm', 'grace', 'paused'].includes(status)) return 'badge-warning';
  return 'badge-gray';
}
