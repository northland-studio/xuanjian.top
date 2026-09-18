/**
 * jsPDF 中文字体（等线 / DengXian）注册工具
 *
 * jsPDF 内置字体不含中文字形，不注册就会输出乱码。
 * 字体文件位于 public/fonts/cjk.ttf，按文档实例注册到 VFS。
 * 档案导出与捐赠墙导出共用本模块，避免两处各写一份。
 */

export const CJK_FONT_FILE = 'cjk.ttf';
export const CJK_FONT_NAME = 'DengXian';

// 版本号用于打破浏览器缓存（替换字体文件时同步更新）
const FONT_URL = `/fonts/${CJK_FONT_FILE}?v=20260822b`;

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

/** 拉取并缓存字体 Base64（多次导出只请求一次） */
export function getCjkFontBase64() {
  if (!cjkFontBase64Promise) {
    cjkFontBase64Promise = fetch(FONT_URL)
      .then(res => {
        if (!res.ok) throw new Error('中文字体加载失败（' + res.status + '）');
        return res.arrayBuffer();
      })
      .then(buf => arrayBufferToBase64(buf));
  }
  return cjkFontBase64Promise;
}

/**
 * 为单个 jsPDF 实例注册并启用中文字体（VFS 按文档实例存储，每次新建 doc 都要调用）。
 * 调用后 doc 的当前字体即为等线，后续 text()/autoTable 均正常显示中文。
 */
export async function registerCjkFont(doc) {
  const base64 = await getCjkFontBase64();
  doc.addFileToVFS(CJK_FONT_FILE, base64);
  doc.addFont(CJK_FONT_FILE, CJK_FONT_NAME, 'normal');
  doc.setFont(CJK_FONT_NAME, 'normal');
  return CJK_FONT_NAME;
}

/** autoTable 通用的中文字体样式片段 */
export const CJK_TABLE_STYLE = { font: CJK_FONT_NAME };
