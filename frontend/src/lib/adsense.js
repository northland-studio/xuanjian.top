/**
 * Google AdSense 加载器（Auto Ads 模式）
 *
 * 投放边界（已确认，不要扩大）：
 *   ✅ 只允许在内容页注入广告脚本：
 *      - Wiki 文章页  frontend/src/pages/WikiPage.jsx
 *      - 日报/决策列表 frontend/src/pages/ContentList.jsx（type === 'daily' | 'decision'）
 *   ❌ 支付/缴费/二维码（/pay*）、聊天（/chat*）、贴吧（/forum，UGC）、登录注册、
 *      后台、设置、库存、任务、签到、通知、Wiki 编辑器、404/空状态屏：一律不注入。
 *
 * 因此广告脚本**不写死**在 index.html 里，而是由内容页组件在 useEffect 中按需注入；
 * 非内容页永远不会请求 pagead2.googlesyndication.com，Auto Ads 也就不会在那里出广告。
 *
 * 只用 Auto Ads：不在页面里手写 <ins class="adsbygoogle"> 广告位。
 */
import { useEffect } from 'react';

/** AdSense 发布商 ID（与 index.html 的 google-adsense-account 元标记、public/ads.txt 保持一致） */
export const ADSENSE_CLIENT = 'ca-pub-3459289852610191';

const ADSENSE_SCRIPT_SRC =
  `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

const SCRIPT_MARKER_ATTR = 'data-xj-adsense';

/**
 * 注入 AdSense 脚本（幂等 + SSR 安全）
 * - SSR/SSG：没有 document，直接 return（服务端不会注入广告脚本）
 * - 已注入过（同一 SPA 生命周期内再次进入内容页）：跳过，不重复请求
 */
export function loadAdSense() {
  if (typeof document === 'undefined') return;

  // 幂等：已注入（本模块注入的或别处注入的同一脚本）就不再插入
  if (document.querySelector(`script[${SCRIPT_MARKER_ATTR}="1"]`)) return;
  if (document.querySelector(`script[src^="https://pagead2.googlesyndication.com/"]`)) return;

  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = ADSENSE_SCRIPT_SRC;
  script.setAttribute(SCRIPT_MARKER_ATTR, '1'); // 便于线上排查：document.querySelector('script[data-xj-adsense="1"]')
  document.head.appendChild(script);
}

/**
 * React hook：enabled 为真时加载 AdSense（只在 useEffect 里碰 DOM，渲染期不访问 window/document，
 * 保证 SSG/SSR 直出的 HTML 与客户端首次渲染一致，hydrate 不报 mismatch）。
 *
 * @param {boolean} enabled 是否允许在本页投放（默认 false 更安全：非内容页请显式传 false 或不调用）
 */
export function useAdSense(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    loadAdSense();
  }, [enabled]);
}
