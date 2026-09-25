import { useEffect, useState } from 'react';
import { platformInfo } from '../api';

/**
 * 贡献点扫码支付：前端公共常量与工具
 * 金额一律两位小数，展示统一走 fmtPoints（utils.js）
 */

const SITE_ORIGIN = 'https://xuanjian.top';

// 原生壳（Capacitor / Electron）里 window.location 指向本地，需要回落到线上域名
const NEEDS_ORIGIN = !!(platformInfo && (platformInfo.capacitor || platformInfo.electron));

/** 接口 / 静态资源绝对地址 */
export function absUrl(path) {
  return NEEDS_ORIGIN ? `${SITE_ORIGIN}${path}` : path;
}

export { fmtPoints } from '../utils';

/**
 * 二维码图片地址：交由后端生成（前端不引入二维码库）
 * GET /api/pay/qr.png?text=<encodeURIComponent(完整URL)>
 */
export function qrImageUrl(text) {
  return absUrl(`/api/pay/qr.png?text=${encodeURIComponent(text)}`);
}

/**
 * 分享 / 扫码用的绝对链接
 * 统一使用线上一级域名：后端 /api/pay/qr.png 只允许编码本站在线支付链接，
 * 同时手机相机扫到该链接也能直接打开官网 H5。
 */
export function shareLink(path) {
  return `${SITE_ORIGIN}${path}`;
}

/** 支付/缴费相关状态 → 文案与徽章样式 */
const STATUS_MAP = {
  created: ['待支付', 'badge-warning'],
  scanned: ['待支付', 'badge-warning'],
  paid: ['已完成', 'badge-success'],
  success: ['已完成', 'badge-success'],
  pending_approval: ['待审批', 'badge-warning'],
  awaiting_approval: ['待审批', 'badge-warning'],
  rejected: ['已取消', 'badge-gray'],
  expired: ['已过期', 'badge-gray'],
  closed: ['已关闭', 'badge-gray'],
  failed: ['已失败', 'badge-danger'],
  unpaid: ['未缴', 'badge-gray'],
  waived: ['已减免', 'badge-gray']
};

export function statusMeta(status) {
  const [label, cls] = STATUS_MAP[status] || [status || '未知', 'badge-gray'];
  return { label, cls };
}

/** 支付场景文案 */
export const KIND_LABEL = {
  receive: '收款码',
  payer_code: '付款码',
  charge: '缴费单',
  charge_pay: '缴费单缴费'
};

/** 收款主体类型文案 */
export const PAYEE_TYPE_LABEL = {
  user: '个人',
  event: '活动摊位',
  system: '公会金库'
};

/**
 * 秒级倒计时（以服务端下发的 remainSeconds / ttlSeconds 为基准，规避客户端时钟偏差）
 * seconds 变化或 resetKey 变化时重置
 */
export function useCountdown(seconds, resetKey) {
  const [left, setLeft] = useState(() => Math.max(0, Math.floor(seconds || 0)));

  useEffect(() => {
    setLeft(Math.max(0, Math.floor(seconds || 0)));
    if (!seconds) return undefined;
    const t = setInterval(() => setLeft(v => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [seconds, resetKey]);

  return left;
}

/** 复制文本：微信内置浏览器没有 clipboard API 时回落 execCommand */
export async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 继续走传统方案 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 把服务端下发的秒数显示为 mm:ss */
export function fmtSeconds(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 倒计时展示：二维码（秒级）用 mm:ss；截止时间（可能数天）用中文时长 */
export function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  if (s < 3600) return fmtSeconds(s);
  if (s < 86400) return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
  return `${Math.floor(s / 86400)} 天 ${Math.floor((s % 86400) / 3600)} 小时`;
}
