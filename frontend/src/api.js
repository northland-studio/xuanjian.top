// API 客户端
const API_BASE = '';

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

// 上传图片
export async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);
  const response = await fetch(`${API_BASE}/api/upload/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '上传失败');
  return data.url;
}

export async function uploadImages(files) {
  const formData = new FormData();
  files.forEach(f => formData.append('images', f));
  const response = await fetch(`${API_BASE}/api/upload/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '上传失败');
  return data.urls;
}
