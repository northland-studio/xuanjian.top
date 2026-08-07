// API 客户端
// 网页版同源（''）；Capacitor 原生 WebView 使用绝对地址
function detectNative() {
  if (typeof window === 'undefined') return { capacitor: false, electron: false };
  return {
    capacitor: !!window.Capacitor?.isNativePlatform?.(),
    electron: !!window.electronAPI
  };
}

const native = detectNative();
const API_BASE = native.capacitor ? 'https://xuanjian.top' : '';

// 平台信息（供原生能力模块使用）
export const platformInfo = native;

export function getToken() {
  return localStorage.getItem('token');
}

export function setAuth(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

async function request(url, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(data.error || data.message || '请求失败');
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  get: (url) => request(url),
  post: (url, body) => request(url, { method: 'POST', body: JSON.stringify(body) }),
  put: (url, body) => request(url, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (url) => request(url, { method: 'DELETE' })
};

// 七牛云上传地址（亚太-新加坡区域 as0）
const QINIU_UPLOAD_URL = 'https://up-as0.qiniup.com/';

// 获取七牛上传凭证
async function getQiniuToken(filename) {
  return request('/api/upload/token', {
    method: 'POST',
    body: JSON.stringify({ filename })
  });
}

// 通过 XHR 直传七牛云，支持进度回调（0-100）
function xhrUpload(uploadToken, key, file, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('token', uploadToken);
    formData.append('key', key);
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const r = JSON.parse(xhr.responseText);
          resolve(r.key || key);
        } catch {
          resolve(key);
        }
      } else {
        let msg = `上传失败: HTTP ${xhr.status}`;
        try {
          const r = JSON.parse(xhr.responseText);
          if (r.error) msg = r.error;
        } catch { /* 忽略解析错误 */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.open('POST', QINIU_UPLOAD_URL);
    xhr.send(formData);
  });
}

// 上传图片（单张），onProgress 回调 0-100
export async function uploadImage(file, onProgress) {
  const { uploadToken, key, domain } = await getQiniuToken(file.name);
  await xhrUpload(uploadToken, key, file, onProgress);
  return `${domain}/${key}`;
}

// 上传多张图片（顺序上传），onProgress(doneCount, currentPercent, totalCount)
export async function uploadImages(files, onProgress) {
  const urls = [];
  for (let i = 0; i < files.length; i++) {
    const url = await uploadImage(files[i], (p) => onProgress?.(i, p, files.length));
    urls.push(url);
  }
  return urls;
}

// 上传 Minecraft 皮肤（本地 /api/skins，FormData，64x64 PNG）
export async function uploadSkin(file, onProgress) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const formData = new FormData();
    formData.append('skin', file);

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const r = JSON.parse(xhr.responseText);
        if (xhr.status === 200) resolve(r);
        else reject(new Error(r.error || `上传失败: HTTP ${xhr.status}`));
      } catch {
        reject(new Error('上传失败'));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.open('POST', `${API_BASE}/api/skins`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}
