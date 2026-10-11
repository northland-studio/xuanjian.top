/**
 * 核销码二维码的纯函数部分（与 UI 分开，便于 Node 侧做回归测试）
 *
 * 约定：
 *  - 只有完整核销码（BW-XXXX-XXXXXX）才出二维码；「末四位 XXXX」这类提示文本不出。
 *  - 二维码内容 = 商家后台核销台深链：<站点>/market/merchant?store_id=<店铺>&code=<核销码>
 *    商家用手机扫码即可打开核销台并自动填入，商家页只做「预填 + 聚焦」，不会自动核销。
 */

/** 是否完整核销码（大小写不敏感，与后端 hashCode 的 toUpperCase 口径一致） */
export function isFullVerifyCode(code) {
  return /^BW-[A-Za-z0-9]{4}-[A-Za-z0-9]{6}$/i.test(String(code || '').trim());
}

/** 扫码后要打开的地址（origin 可显式传入，便于测试与 SSR 复用） */
export function verifyScanUrl(code, storeId, origin) {
  const base = origin || (typeof window !== 'undefined' && window.location ? window.location.origin : '');
  const q = new URLSearchParams();
  if (storeId) q.set('store_id', String(storeId));
  q.set('code', String(code || '').trim().toUpperCase());
  return `${base}/market/merchant?${q.toString()}`;
}
