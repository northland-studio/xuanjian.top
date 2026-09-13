/**
 * 多端运行环境检测（Web / PWA / Capacitor 原生 / Electron 桌面）
 *
 * 统一出口，供两类消费者使用：
 *   1) JS 逻辑：import { isNative, isMobile, ... }
 *   2) CSS：applyPlatformAttrs() 会把结果写到 <html data-*> 上，样式里可直接选择
 *         [data-platform="ios"] / [data-shell="electron"] / [data-touch="true"] ...
 */

function safe(fn, fallback = false) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/** Electron 桌面壳 */
export const isElectron = safe(() => !!window.electronAPI);

/** Capacitor 原生壳（Android / iOS） */
export const isCapacitor = safe(() => !!window.Capacitor?.isNativePlatform?.());

/** 是否运行在原生壳内（Electron 或 Capacitor） */
export const isNative = isElectron || isCapacitor;

/** 是否以「已安装应用」姿态运行（PWA standalone / iOS 主屏 / 原生壳） */
export const isStandalone =
  isNative ||
  safe(() => window.matchMedia?.('(display-mode: standalone)').matches) ||
  safe(() => window.navigator.standalone === true);

const ua = safe(() => navigator.userAgent || '', '');

/** iOS / iPadOS（含 iPad 桌面版 UA 伪装） */
export const isIOS =
  /iPad|iPhone|iPod/.test(ua) ||
  safe(() => navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isAndroid = /Android/i.test(ua);

/** 触摸优先设备（粗指针） */
export const isTouch =
  safe(() => window.matchMedia?.('(pointer: coarse)').matches) ||
  safe(() => 'ontouchstart' in window);

/** 移动端（触摸优先或移动 UA） */
export const isMobile = isIOS || isAndroid || isTouch;

/** 平台标识：ios / android / desktop */
export function platformName() {
  if (isIOS) return 'ios';
  if (isAndroid) return 'android';
  return 'desktop';
}

/** 外壳标识：electron / capacitor / pwa / web */
export function shellName() {
  if (isElectron) return 'electron';
  if (isCapacitor) return 'capacitor';
  if (safe(() => window.matchMedia?.('(display-mode: standalone)').matches) || safe(() => window.navigator.standalone === true)) return 'pwa';
  return 'web';
}

/**
 * 把环境信息写到 <html data-*>，供 CSS 选择器使用。
 * 需在首屏渲染前调用（main.jsx 顶部）。
 */
export function applyPlatformAttrs(root = document.documentElement) {
  root.dataset.platform = platformName();
  root.dataset.shell = shellName();
  root.dataset.native = isNative ? 'true' : 'false';
  root.dataset.touch = isTouch ? 'true' : 'false';
  root.dataset.standalone = isStandalone ? 'true' : 'false';
  return { isNative, isElectron, isCapacitor, isStandalone, isIOS, isAndroid, isTouch, isMobile };
}

export const platform = {
  isElectron, isCapacitor, isNative, isStandalone,
  isIOS, isAndroid, isTouch, isMobile,
  name: platformName(), shell: shellName()
};
