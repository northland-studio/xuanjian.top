import jsQR from 'jsqr';

/**
 * 扫码工具（三级降级）
 *  1) 浏览器原生 BarcodeDetector（Chrome / Edge / 部分安卓 WebView）
 *  2) jsQR 本地解码（图片上传 / 摄像头逐帧）
 *  3) 手动粘贴码或链接（由页面实现，不在此文件）
 * 微信内置浏览器通常拿不到摄像头（getUserMedia 被拒或不存在），
 * 这里只负责「尝试」，失败一律交给调用方降级，不抛未捕获异常。
 */

/** 是否具备摄像头能力（仅探测 API 是否存在，不代表已授权） */
export function hasCamera() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;
}

/** 是否支持原生条码识别 */
export async function hasBarcodeDetector() {
  try {
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return false;
    const formats = window.BarcodeDetector.getSupportedFormats
      ? await window.BarcodeDetector.getSupportedFormats()
      : null;
    return !formats || formats.includes('qr_code');
  } catch {
    return false;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = src;
  });
}

async function imageDataFromFile(file, maxSide = 1200) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 从图片文件解码二维码内容
 * @param {File|Blob} file
 * @returns {Promise<string|null>} 识别到的文本，识别失败返回 null
 */
export async function decodeImageFile(file) {
  if (!file) return null;
  // 1) 原生识别可以直接吃 Blob，速度快、对模糊照片更稳
  try {
    if (await hasBarcodeDetector()) {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const codes = await detector.detect(file);
      if (codes && codes[0] && codes[0].rawValue) return codes[0].rawValue;
    }
  } catch { /* 落到 jsQR */ }
  // 2) jsQR：图片允许反色，尽量识别出内容
  try {
    const data = await imageDataFromFile(file);
    if (!data) return null;
    const res = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
    return res && res.data ? res.data : null;
  } catch {
    return null;
  }
}

/**
 * 开启摄像头扫码
 * @param {HTMLVideoElement} video 承载视频的元素
 * @param {(text:string)=>void} onResult 识别成功回调（识别成功后自动停止）
 * @param {(err:Error)=>void} onError 摄像头不可用回调（调用方据此降级）
 * @returns {Promise<{stop:()=>void, usingNative:boolean}>}
 */
export async function startScanner(video, onResult, onError) {
  let stream = null;
  let raf = 0;
  let timer = 0;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0;
    timer = 0;
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (video) {
      try { video.srcObject = null; } catch { /* 忽略 */ }
    }
  };

  if (!hasCamera() || !video) {
    onError?.(new Error('当前浏览器不支持调用摄像头'));
    return { stop, usingNative: false };
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    try { await video.play(); } catch { /* iOS 需用户手势，忽略 */ }
  } catch (e) {
    onError?.(e);
    return { stop, usingNative: false };
  }

  const usingNative = await hasBarcodeDetector();
  const detector = usingNative ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const tick = async () => {
    if (stopped) return;
    try {
      if (detector) {
        const codes = await detector.detect(video);
        if (codes && codes[0] && codes[0].rawValue) {
          const text = codes[0].rawValue;
          stop();
          onResult?.(text);
          return;
        }
      } else if (video.videoWidth) {
        const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const res = jsQR(data.data, data.width, data.height, { inversionAttempts: 'dontInvert' });
        if (res && res.data) {
          const text = res.data;
          stop();
          onResult?.(text);
          return;
        }
      }
    } catch { /* 单帧失败忽略，继续下一帧 */ }
    // jsQR 逐帧较耗性能，节流避免手机发烫
    timer = setTimeout(() => { if (!stopped) raf = requestAnimationFrame(tick); }, detector ? 280 : 450);
  };

  raf = requestAnimationFrame(tick);
  return { stop, usingNative };
}
