// 全局配置
const API_BASE_URL = '';

// 获取Token
function getToken() {
    return localStorage.getItem('token');
}

// 获取当前用户
function getCurrentUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
}

// 设置当前用户
function setCurrentUser(user) {
    localStorage.setItem('user', JSON.stringify(user));
}

// 清除登录状态
function clearAuth() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}

// 检查是否登录
function isLoggedIn() {
    return !!getToken();
}

// 检查是否为管理员
function isAdmin() {
    const user = getCurrentUser();
    return user && user.level >= 1;
}

// 检查是否为超级管理员
function isSuperAdmin() {
    const user = getCurrentUser();
    return user && user.level >= 2;
}

// API请求封装
async function apiRequest(url, options = {}) {
    const token = getToken();
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
        }
    };
    
    const response = await fetch(`${API_BASE_URL}${url}`, {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
        throw new Error(data.error || '请求失败');
    }
    
    return data;
}

// GET请求
function get(url) {
    return apiRequest(url, { method: 'GET' });
}

// POST请求
function post(url, body) {
    return apiRequest(url, {
        method: 'POST',
        body: JSON.stringify(body)
    });
}

// PUT请求
function put(url, body) {
    return apiRequest(url, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
}

// DELETE请求
function del(url) {
    return apiRequest(url, { method: 'DELETE' });
}

// 格式化日期
function formatDate(dateString) {
    // 将日期字符串转换为本地时间
    const date = new Date(dateString);
    const now = new Date();
    
    // 计算时间差（毫秒）
    const diff = now.getTime() - date.getTime();
    
    // 如果时间差为负数（未来时间），显示具体日期
    if (diff < 0) {
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    // 小于1分钟
    if (diff < 60000) {
        return '刚刚';
    }
    // 小于1小时
    if (diff < 3600000) {
        return Math.floor(diff / 60000) + '分钟前';
    }
    // 小于24小时
    if (diff < 86400000) {
        return Math.floor(diff / 3600000) + '小时前';
    }
    // 小于7天
    if (diff < 604800000) {
        return Math.floor(diff / 86400000) + '天前';
    }
    
    // 超过7天显示具体日期
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

// 格式化数字
function formatNumber(num) {
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + 'w';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
}

// 截断文本
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// 显示提示消息
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    const colors = {
        info: '#6366f1',
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b'
    };
    
    toast.style.cssText = `
        position: fixed;
        top: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: ${colors[type]};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 3000;
        animation: fadeIn 0.3s ease-out;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// 确认对话框
function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.innerHTML = `
            <div class="confirm-content">
                <p class="confirm-message">${message}</p>
                <div class="confirm-buttons">
                    <button class="btn btn-secondary confirm-cancel">取消</button>
                    <button class="btn btn-danger confirm-ok">确定</button>
                </div>
            </div>
        `;
        
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 3000;
        `;
        
        const content = modal.querySelector('.confirm-content');
        content.style.cssText = `
            background: white;
            padding: 24px;
            border-radius: 12px;
            max-width: 400px;
            width: 90%;
        `;
        
        const messageEl = modal.querySelector('.confirm-message');
        messageEl.style.cssText = `
            margin-bottom: 20px;
            font-size: 16px;
            color: #1e293b;
        `;
        
        const buttons = modal.querySelector('.confirm-buttons');
        buttons.style.cssText = `
            display: flex;
            gap: 12px;
            justify-content: flex-end;
        `;
        
        document.body.appendChild(modal);
        
        modal.querySelector('.confirm-cancel').onclick = () => {
            modal.remove();
            resolve(false);
        };
        
        modal.querySelector('.confirm-ok').onclick = () => {
            modal.remove();
            resolve(true);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        };
    });
}

// 渲染导航栏
function renderNavbar() {
    const user = getCurrentUser();
    const navUser = document.querySelector('.nav-user');
    
    if (!navUser) return;
    
    if (user) {
        navUser.innerHTML = `
            <a href="/profile">
                <img src="${user.avatar || '/uploads/default-avatar.png'}" alt="${user.nickname}" class="nav-avatar">
            </a>
        `;
    } else {
        navUser.innerHTML = `<a href="/login" class="nav-login-btn">登录</a>`;
    }
}

// 导航栏滚动效果
function initNavbarScroll() {
    const navbar = document.querySelector('.navbar');
    const backToTop = document.querySelector('.back-to-top');
    let lastScroll = 0;
    
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        // 导航栏隐藏/显示
        if (currentScroll > 100) {
            if (currentScroll > lastScroll) {
                navbar.classList.add('hidden');
            } else {
                navbar.classList.remove('hidden');
            }
        } else {
            navbar.classList.remove('hidden');
        }
        
        // 回顶按钮
        if (backToTop) {
            if (currentScroll > 300) {
                backToTop.classList.add('visible');
            } else {
                backToTop.classList.remove('visible');
            }
        }
        
        lastScroll = currentScroll;
    });
    
    // 回顶按钮点击
    if (backToTop) {
        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
}

// 检查弹窗公告
async function checkPopupAnnouncement() {
    const dismissed = sessionStorage.getItem('announcementDismissed');
    if (dismissed) return;
    
    try {
        const announcement = await get('/api/announcements/popup');
        if (announcement) {
            showPopupAnnouncement(announcement);
        }
    } catch (error) {
        console.error('获取公告失败:', error);
    }
}

// 显示弹窗公告
function showPopupAnnouncement(announcement) {
    const modal = document.createElement('div');
    modal.className = 'popup-modal active';
    modal.innerHTML = `
        <div class="popup-content">
            <div class="popup-header">
                <h3 class="popup-title">${announcement.title}</h3>
            </div>
            <div class="popup-body">
                <div class="popup-text">${announcement.content}</div>
            </div>
            <div class="popup-footer">
                <button class="btn btn-primary popup-close">我知道了</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.popup-close').onclick = () => {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
        sessionStorage.setItem('announcementDismissed', 'true');
    };
    
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
            setTimeout(() => modal.remove(), 300);
            sessionStorage.setItem('announcementDismissed', 'true');
        }
    };
}

// 初始化页面
function initPage() {
    renderNavbar();
    initNavbarScroll();
    checkPopupAnnouncement();
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initPage);
