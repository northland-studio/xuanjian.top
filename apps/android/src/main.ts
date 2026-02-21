import { state, API_BASE_URL, User, Post, Comment, Notification } from './config';
import './styles.css';

const STATIC_BASE = 'https://xuanjian.top';

// DOM 元素
const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T;

// 获取完整URL
function getImageUrl(path: string | undefined): string {
    if (!path) return '';
    if (path.startsWith('data:')) return path;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (path.startsWith('/')) return `${STATIC_BASE}${path}`;
    return `${STATIC_BASE}/${path}`;
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initUser();
    
    if (state.currentUser) {
        refreshUserInfo();
        loadUnreadNotificationCount();
    }
    
    showHomePage();
});

// 主题初始化
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    state.theme = savedTheme as 'light' | 'dark';
    
    const themeToggle = $('themeToggle');
    themeToggle?.addEventListener('click', toggleTheme);
}

function toggleTheme() {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    state.theme = newTheme;
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

// 侧边栏初始化
function initSidebar() {
    const menuToggle = $('menuToggle');
    const overlay = $('sidebarOverlay');
    
    menuToggle?.addEventListener('click', () => toggleSidebar(true));
    overlay?.addEventListener('click', () => toggleSidebar(false));
    
    // 导航项点击
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = (item as HTMLElement).dataset.page;
            if (page) {
                navigateTo(page);
                toggleSidebar(false);
            }
        });
    });
    
    // 用户信息点击
    const userInfo = $('userInfo');
    userInfo?.addEventListener('click', () => {
        if (state.currentUser) {
            showProfile(state.currentUser.username);
        } else {
            showLoginModal();
        }
        toggleSidebar(false);
    });
}

function toggleSidebar(open: boolean) {
    const sidebar = $('sidebar');
    const overlay = $('sidebarOverlay');
    
    if (open) {
        sidebar?.classList.add('open');
        overlay?.classList.add('active');
    } else {
        sidebar?.classList.remove('open');
        overlay?.classList.remove('active');
    }
    
    state.sidebarOpen = open;
}

// 导航
async function navigateTo(page: string) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-page') === page);
    });
    
    state.currentPage = page;
    
    switch (page) {
        case 'home': await showHomePage(); break;
        case 'daily': await loadPosts('daily'); break;
        case 'decision': await loadPosts('decision'); break;
        case 'forum': await loadPosts('forum'); break;
        case 'social': showSocialPage(); break;
        case 'notifications': await showNotificationsPage(); break;
    }
}

// 用户初始化
function initUser() {
    updateUserUI();
}

function updateUserUI() {
    const userInfo = $('userInfo');
    if (!userInfo) return;
    
    if (state.currentUser) {
        const avatarUrl = getImageUrl(state.currentUser.avatar);
        userInfo.innerHTML = `
            <div class="user-avatar-placeholder">
                ${avatarUrl ? `<img src="${avatarUrl}" alt="" onerror="this.parentElement.innerHTML='<svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><path d=\\'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\\'></path><circle cx=\\'12\\' cy=\\'7\\' r=\\'4\\'></circle></svg>'">` : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`}
            </div>
            <div class="user-details">
                <div class="user-name">${state.currentUser.nickname}</div>
                <div class="user-handle">@${state.currentUser.username}</div>
            </div>
        `;
    } else {
        userInfo.innerHTML = `
            <div class="user-avatar-placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
            </div>
            <div class="user-details">
                <div class="user-name">未登录</div>
                <div class="user-handle">点击登录</div>
            </div>
        `;
    }
}

// 刷新用户信息
async function refreshUserInfo() {
    if (!state.token) return;
    
    try {
        const user = await fetchAPI<User>('/auth/me');
        state.currentUser = user;
        localStorage.setItem('user', JSON.stringify(user));
        updateUserUI();
    } catch (error) {
        console.error('刷新用户信息失败:', error);
    }
}

// API 请求
async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options?.headers
    };
    
    if (state.token) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${state.token}`;
    }
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: '请求失败' }));
        throw new Error(error.error || '请求失败');
    }
    
    return response.json();
}

// Toast 提示
function showToast(message: string, type: 'success' | 'error' = 'success') {
    const container = $('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}

// 格式化日期
function formatDate(dateStr: string | undefined): string {
    if (!dateStr) return '未知';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '未知';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
}

// 加载未读通知数
async function loadUnreadNotificationCount() {
    if (!state.token) return;
    
    try {
        const data = await fetchAPI<{ unreadCount: number }>('/notifications?limit=1');
        const badge = $('sidebar-notification-badge');
        if (badge) {
            if (data.unreadCount > 0) {
                badge.textContent = data.unreadCount > 99 ? '99+' : data.unreadCount.toString();
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (e) {
        // 静默失败
    }
}

// ============ 页面渲染 ============

async function showHomePage() {
    const content = $('content-body');
    if (!content) return;
    
    content.innerHTML = `
        <div class="home-header">
            <h1>欢迎来到玄剑公会</h1>
            <p>我的世界玄剑公会官方社区</p>
            ${state.currentUser ? `<button class="btn btn-primary" onclick="showEditorPage()" style="margin-top: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M12 4v16m8-8H4"></path>
                </svg>
                发布内容
            </button>` : ''}
        </div>
        
        <h2 class="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            最新日报
        </h2>
        <div id="home-daily-list"><div class="loading-spinner"><div class="spinner"></div></div></div>
        
        <h2 class="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="m9 12 2 2 4-4"></path>
            </svg>
            最新决策
        </h2>
        <div id="home-decision-list"><div class="loading-spinner"><div class="spinner"></div></div></div>
    `;
    
    loadHomeDaily();
    loadHomeDecision();
}

async function loadHomeDaily() {
    try {
        const data = await fetchAPI<{ posts: Post[] }>('/posts?type=daily&limit=3');
        const container = $('home-daily-list');
        if (!container) return;
        
        if (data.posts.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>暂无日报</p></div>';
            return;
        }
        
        container.innerHTML = data.posts.map(post => renderPostItem(post)).join('');
        bindPostClick();
    } catch (e) {
        const container = $('home-daily-list');
        if (container) container.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
    }
}

async function loadHomeDecision() {
    try {
        const data = await fetchAPI<{ posts: Post[] }>('/posts?type=decision&limit=3');
        const container = $('home-decision-list');
        if (!container) return;
        
        if (data.posts.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>暂无决策</p></div>';
            return;
        }
        
        container.innerHTML = data.posts.map(post => renderPostItem(post)).join('');
        bindPostClick();
    } catch (e) {
        const container = $('home-decision-list');
        if (container) container.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
    }
}

async function loadPosts(type: string) {
    const content = $('content-body');
    if (!content) return;
    
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    
    try {
        const data = await fetchAPI<{ posts: Post[] }>(`/posts?type=${type}&limit=50`);
        
        if (data.posts.length === 0) {
            content.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><h3>暂无内容</h3></div>`;
            return;
        }
        
        content.innerHTML = data.posts.map(post => renderPostItem(post)).join('');
        bindPostClick();
    } catch (e) {
        content.innerHTML = '<div class="empty-state"><h3>加载失败</h3></div>';
    }
}

function renderPostItem(post: Post): string {
    const canEdit = state.currentUser && state.currentUser.id === post.author_id;
    return `
        <div class="post-item" data-id="${post.id}">
            <div class="post-header">
                <img src="${getImageUrl(post.author_avatar) || 'https://xuanjian.top/uploads/default-avatar.png'}" class="post-avatar" alt="" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <div class="post-author">
                    <div class="post-author-name">${post.author_nickname || '未知用户'}</div>
                    <div class="post-time">${formatDate(post.created_at)}</div>
                </div>
                ${post.is_pinned ? '<span class="tag">置顶</span>' : ''}
                ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); editPost(${post.id})">编辑</button>` : ''}
            </div>
            <div class="post-title">${escapeHtml(post.title)}</div>
            <div class="post-content">${stripHtml(post.content).substring(0, 150)}${post.content.length > 150 ? '...' : ''}</div>
            <div class="post-footer">
                <span class="post-stat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    ${post.views}
                </span>
                <span class="post-stat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="${post.isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                    ${post.likes}
                </span>
            </div>
        </div>
    `;
}

function bindPostClick() {
    document.querySelectorAll('.post-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = (item as HTMLElement).dataset.id;
            if (id) showPostDetail(parseInt(id));
        });
    });
}

// 社交媒体页
function showSocialPage() {
    const content = $('content-body');
    if (!content) return;
    
    content.innerHTML = `
        <div class="card">
            <h3 class="card-title">社交媒体</h3>
            <p style="color: var(--text-secondary); margin-top: 8px;">敬请期待...</p>
        </div>
    `;
}

// 帖子详情
async function showPostDetail(id: number) {
    const content = $('content-body');
    if (!content) return;
    
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    
    try {
        const data = await fetchAPI<{ post: Post, comments: Comment[] }>(`/posts/${id}`);
        const post = data.post;
        const canEdit = state.currentUser && state.currentUser.id === post.author_id;
        
        content.innerHTML = `
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M19 12H5M12 19l-7-7 7-7"></path>
                </svg>
                返回
            </button>
            
            <div class="card">
                <div class="post-header">
                    <img src="${getImageUrl(post.author_avatar) || 'https://xuanjian.top/uploads/default-avatar.png'}" class="post-avatar" alt="" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                    <div class="post-author">
                        <div class="post-author-name">${post.author_nickname || '未知用户'}</div>
                        <div class="post-time">${formatDate(post.created_at)}</div>
                    </div>
                    ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick="editPost(${id})">编辑</button>` : ''}
                </div>
                <h2 style="font-size: 18px; margin-bottom: 12px;">${escapeHtml(post.title)}</h2>
                <div class="post-content-full">${post.content || ''}</div>
                ${post.images && post.images.length > 0 ? `
                    <div class="post-images" style="margin-top: 16px;">
                        ${post.images.map(img => `<img src="${getImageUrl(img)}" onclick="previewImage('${getImageUrl(img)}')" style="cursor: pointer;">`).join('')}
                    </div>
                ` : ''}
                <div class="post-footer" style="margin-top: 16px;">
                    <span class="post-stat">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        ${post.views}
                    </span>
                    <span class="post-stat" onclick="toggleLike(${id})" style="cursor: pointer;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="${post.isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                        </svg>
                        ${post.likes}
                    </span>
                </div>
            </div>
            
            <div class="card" style="margin-top: 16px;">
                <h3 class="card-title">发表评论</h3>
                <div id="reply-info" style="display: none; margin-bottom: 8px; padding: 8px; background: var(--bg-tertiary); border-radius: 8px;">
                    <span id="reply-to-name"></span>
                    <button class="btn btn-sm btn-secondary" onclick="cancelReply()" style="margin-left: 8px;">取消</button>
                </div>
                <textarea id="comment-input" placeholder="写下你的评论..." style="width: 100%; min-height: 80px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); resize: vertical;"></textarea>
                <button class="btn btn-primary" onclick="submitComment(${id})" style="margin-top: 8px;">发表评论</button>
            </div>
            
            <h3 class="section-title" style="margin-top: 20px;">评论 (${data.comments.length})</h3>
            <div id="comments-list">
                ${data.comments.length === 0 ? '<div class="empty-state"><p>暂无评论，快来抢沙发吧！</p></div>' : 
                    data.comments.map(c => renderComment(c)).join('')}
            </div>
        `;
    } catch (e) {
        content.innerHTML = `
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `;
    }
}

function renderComment(comment: Comment): string {
    const replies = comment.replies?.map(r => renderComment(r)).join('') || '';
    const replyToInfo = comment.reply_to ? `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">回复 @${comment.reply_to.nickname}</div>` : '';
    
    return `
        <div class="card">
            <div class="post-header">
                <img src="${getImageUrl(comment.author_avatar) || 'https://xuanjian.top/uploads/default-avatar.png'}" class="post-avatar" alt="" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <div class="post-author">
                    <div class="post-author-name">${comment.author_nickname}</div>
                    <div class="post-time">${formatDate(comment.created_at)}</div>
                </div>
            </div>
            ${replyToInfo}
            <div style="color: var(--text-secondary);">${escapeHtml(comment.content)}</div>
            <div style="margin-top: 8px;">
                <button class="btn btn-sm btn-secondary" onclick="setReplyTo(${comment.id}, '${escapeHtml(comment.author_nickname || '')}')">回复</button>
            </div>
            ${replies ? `<div style="margin-top: 12px; padding-left: 12px; border-left: 2px solid var(--border);">${replies}</div>` : ''}
        </div>
    `;
}

let replyToId: number | null = null;

function setReplyTo(commentId: number, authorName: string) {
    replyToId = commentId;
    const replyInfo = $('reply-info');
    const replyName = $('reply-to-name');
    if (replyInfo && replyName) {
        replyName.textContent = `回复 @${authorName}`;
        replyInfo.style.display = 'block';
    }
    const input = $('comment-input') as HTMLTextAreaElement;
    if (input) input.focus();
}

function cancelReply() {
    replyToId = null;
    const replyInfo = $('reply-info');
    if (replyInfo) replyInfo.style.display = 'none';
}

async function submitComment(postId: number) {
    if (!state.currentUser) {
        showLoginModal();
        return;
    }
    
    const input = $('comment-input') as HTMLTextAreaElement;
    const content = input?.value.trim();
    
    if (!content) {
        showToast('请输入评论内容', 'error');
        return;
    }
    
    try {
        await fetchAPI(`/posts/${postId}/comments`, {
            method: 'POST',
            body: JSON.stringify({
                content,
                parentId: replyToId
            })
        });
        
        showToast('评论成功');
        showPostDetail(postId);
    } catch (e) {
        showToast((e as Error).message || '评论失败', 'error');
    }
}

function goBack() {
    navigateTo(state.currentPage);
}

// 点赞
async function toggleLike(postId: number) {
    if (!state.currentUser) {
        showLoginModal();
        return;
    }
    
    try {
        await fetchAPI(`/posts/${postId}/like`, { method: 'POST' });
        showPostDetail(postId);
    } catch (e) {
        showToast('操作失败', 'error');
    }
}

// 个人主页
async function showProfile(username: string) {
    const content = $('content-body');
    if (!content) return;
    
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    
    try {
        const data = await fetchAPI<{ user: User }>(`/auth/user/${username}`);
        const user = data.user;
        const isOwnProfile = state.currentUser?.username === username;
        
        content.innerHTML = `
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M19 12H5M12 19l-7-7 7-7"></path>
                </svg>
                返回
            </button>
            
            <div class="card" style="text-align: center;">
                <img src="${getImageUrl(user.avatar) || 'https://xuanjian.top/uploads/default-avatar.png'}" style="width: 80px; height: 80px; border-radius: 50%; margin-bottom: 16px;" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <h2 style="margin-bottom: 8px;">${user.nickname}</h2>
                <p style="color: var(--text-muted); margin-bottom: 8px;">@${user.username}</p>
                <span class="tag">${user.level >= 2 ? '超级管理员' : user.level >= 1 ? '管理员' : '普通成员'}</span>
            </div>
            
            <div class="card">
                <h3 class="card-title">账号信息</h3>
                <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border);">
                    <span style="color: var(--text-secondary);">邮箱</span>
                    <span>${user.email || '未设置'}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border);">
                    <span style="color: var(--text-secondary);">邮箱验证</span>
                    <span style="color: ${user.is_email_verified ? 'var(--success)' : 'var(--warning)'};">${user.is_email_verified ? '已验证' : '未验证'}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 12px 0;">
                    <span style="color: var(--text-secondary);">注册时间</span>
                    <span>${formatDate(user.created_at)}</span>
                </div>
            </div>
            
            ${isOwnProfile ? `
                <button class="btn btn-secondary btn-block" onclick="showSettingsPage()" style="margin-top: 12px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    账号设置
                </button>
                
                ${user.level >= 1 ? `
                    <button class="btn btn-primary btn-block" onclick="showAdminPage()" style="margin-top: 12px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                        管理系统
                    </button>
                ` : ''}
                
                <button class="btn btn-danger btn-block" onclick="handleLogout()" style="margin-top: 12px;">退出登录</button>
            ` : ''}
            
            <h3 class="section-title" style="margin-top: 20px;">发布的帖子</h3>
            <div id="profile-posts-list"><div class="loading-spinner"><div class="spinner"></div></div></div>
        `;
        
        // 加载用户帖子
        try {
            const postsData = await fetchAPI<{ posts: Post[] }>(`/posts?author=${username}&limit=20`);
            const postsList = $('profile-posts-list');
            if (postsList) {
                if (postsData.posts.length > 0) {
                    postsList.innerHTML = postsData.posts.map(post => renderPostItem(post)).join('');
                    bindPostClick();
                } else {
                    postsList.innerHTML = '<div class="empty-state"><p>暂无帖子</p></div>';
                }
            }
        } catch {
            const postsList = $('profile-posts-list');
            if (postsList) postsList.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
        }
    } catch (e) {
        content.innerHTML = `
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>用户不存在</h3></div>
        `;
    }
}

// 设置页面
function showSettingsPage() {
    const content = $('content-body');
    if (!content || !state.currentUser) return;
    
    const user = state.currentUser;
    
    content.innerHTML = `
        <button class="btn btn-secondary" onclick="showProfile('${user.username}')" style="margin-bottom: 16px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                <path d="M19 12H5M12 19l-7-7 7-7"></path>
            </svg>
            返回
        </button>
        
        <div class="card">
            <h3 class="card-title">修改头像</h3>
            <div style="text-align: center; margin-bottom: 16px;">
                <img id="settings-avatar-preview" src="${getImageUrl(user.avatar) || 'https://xuanjian.top/uploads/default-avatar.png'}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-bottom: 12px;" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <br>
                <button class="btn btn-secondary" onclick="selectAvatar()">选择图片</button>
            </div>
        </div>
        
        <div class="card">
            <h3 class="card-title">修改资料</h3>
            <div class="form-group">
                <label>昵称</label>
                <input type="text" id="settings-nickname" value="${user.nickname || ''}" placeholder="请输入昵称">
            </div>
            <div class="form-group">
                <label>邮箱 ${user.is_email_verified ? '<span style="color: var(--success);">✓ 已验证</span>' : '<span style="color: var(--warning);">⚠ 未验证</span>'}</label>
                <input type="email" id="settings-email" value="${user.email || ''}" placeholder="请输入邮箱" ${user.is_email_verified ? 'disabled' : ''}>
            </div>
            <button class="btn btn-primary btn-block" onclick="saveProfile()">保存资料</button>
        </div>
        
        <div class="card">
            <h3 class="card-title">修改密码</h3>
            <div class="form-group">
                <label>当前密码</label>
                <input type="password" id="settings-old-password" placeholder="请输入当前密码">
            </div>
            <div class="form-group">
                <label>新密码</label>
                <input type="password" id="settings-new-password" placeholder="请输入新密码">
            </div>
            <div class="form-group">
                <label>确认新密码</label>
                <input type="password" id="settings-confirm-password" placeholder="请再次输入新密码">
            </div>
            <button class="btn btn-primary btn-block" onclick="changePassword()">修改密码</button>
        </div>
    `;
}

// 选择头像
async function selectAvatar() {
    const url = await selectAndUploadImage();
    if (url) {
        const preview = $('settings-avatar-preview') as HTMLImageElement;
        if (preview) preview.src = url;
        showToast('头像已上传，请保存资料');
    }
}

// 保存资料
async function saveProfile() {
    const nickname = ($('settings-nickname') as HTMLInputElement)?.value.trim();
    const email = ($('settings-email') as HTMLInputElement)?.value.trim();
    const avatar = ($('settings-avatar-preview') as HTMLImageElement)?.src;
    
    if (!nickname) {
        showToast('请输入昵称', 'error');
        return;
    }
    
    try {
        const updateData: any = { nickname, email };
        if (avatar && !avatar.includes('default-avatar')) {
            updateData.avatar = avatar;
        }
        
        const result = await fetchAPI<{ user: User }>('/auth/profile', {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });
        
        if (result.user) {
            state.currentUser = result.user;
            localStorage.setItem('user', JSON.stringify(result.user));
        }
        
        updateUserUI();
        showToast('保存成功');
    } catch (e) {
        showToast((e as Error).message || '保存失败', 'error');
    }
}

// 修改密码
async function changePassword() {
    const oldPassword = ($('settings-old-password') as HTMLInputElement)?.value;
    const newPassword = ($('settings-new-password') as HTMLInputElement)?.value;
    const confirmPassword = ($('settings-confirm-password') as HTMLInputElement)?.value;
    
    if (!oldPassword || !newPassword || !confirmPassword) {
        showToast('请填写完整信息', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showToast('两次密码不一致', 'error');
        return;
    }
    
    if (newPassword.length < 6) {
        showToast('密码至少6位', 'error');
        return;
    }
    
    try {
        await fetchAPI('/auth/password', {
            method: 'PUT',
            body: JSON.stringify({ oldPassword, newPassword })
        });
        
        showToast('密码修改成功');
        ($('settings-old-password') as HTMLInputElement).value = '';
        ($('settings-new-password') as HTMLInputElement).value = '';
        ($('settings-confirm-password') as HTMLInputElement).value = '';
    } catch (e) {
        showToast((e as Error).message || '修改失败', 'error');
    }
}

// 编辑器页面
let editingPostId: number | null = null;
let editorImages: string[] = [];

function showEditorPage(postId?: number) {
    const content = $('content-body');
    if (!content) return;
    
    if (!state.currentUser) {
        showLoginModal();
        return;
    }
    
    editingPostId = postId || null;
    editorImages = [];
    
    let postData = { title: '', content: '', type: 'forum', images: [] as string[] };
    
    if (postId) {
        fetchAPI<{ post: Post }>(`/posts/${postId}`).then(data => {
            postData = {
                title: data.post.title,
                content: data.post.content,
                type: data.post.type,
                images: data.post.images || []
            };
            editorImages = postData.images;
            renderEditorContent(postData);
        }).catch(() => {
            showToast('加载帖子失败', 'error');
        });
    } else {
        renderEditorContent(postData);
    }
}

function renderEditorContent(postData: { title: string; content: string; type: string; images: string[] }) {
    const content = $('content-body');
    if (!content) return;
    
    const canPostDaily = state.currentUser && state.currentUser.level >= 1;
    
    content.innerHTML = `
        <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                <path d="M19 12H5M12 19l-7-7 7-7"></path>
            </svg>
            返回
        </button>
        
        <div class="card">
            <h3 class="card-title">${editingPostId ? '编辑帖子' : '发布新帖'}</h3>
            
            <div class="form-group">
                <label>标题</label>
                <input type="text" id="editor-title" value="${escapeHtml(postData.title)}" placeholder="请输入标题">
            </div>
            
            <div class="form-group">
                <label>类型</label>
                <select id="editor-type" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary);">
                    <option value="forum" ${postData.type === 'forum' ? 'selected' : ''}>贴吧</option>
                    ${canPostDaily ? `
                        <option value="daily" ${postData.type === 'daily' ? 'selected' : ''}>日报</option>
                        <option value="decision" ${postData.type === 'decision' ? 'selected' : ''}>决策</option>
                    ` : ''}
                </select>
            </div>
            
            <div class="form-group">
                <label>内容</label>
                <div class="editor-toolbar" style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
                    <button type="button" class="btn btn-sm btn-secondary" onclick="editorAction('bold')"><strong>B</strong></button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="editorAction('italic')"><em>I</em></button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="editorAction('underline')"><u>U</u></button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="addEditorImage()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        图片
                    </button>
                </div>
                <textarea id="editor-content" placeholder="请输入内容..." style="width: 100%; min-height: 200px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); resize: vertical; line-height: 1.6;">${escapeHtml(postData.content)}</textarea>
            </div>
            
            <div id="editor-images" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
                ${editorImages.map((img, i) => `
                    <div style="position: relative; width: 80px; height: 80px;">
                        <img src="${getImageUrl(img)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">
                        <button onclick="removeEditorImage(${i})" style="position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; border-radius: 50%; background: var(--danger); color: white; border: none; font-size: 14px;">x</button>
                    </div>
                `).join('')}
            </div>
            
            <button class="btn btn-primary btn-block" onclick="submitPost()">
                ${editingPostId ? '保存修改' : '发布'}
            </button>
        </div>
    `;
}

function editorAction(action: string) {
    const textarea = $('editor-content') as HTMLTextAreaElement;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);
    
    const actions: Record<string, [string, string]> = {
        'bold': ['<strong>', '</strong>'],
        'italic': ['<em>', '</em>'],
        'underline': ['<u>', '</u>']
    };
    
    const [open, close] = actions[action] || ['', ''];
    textarea.value = textarea.value.substring(0, start) + open + selected + close + textarea.value.substring(end);
    textarea.focus();
    textarea.selectionStart = start + open.length;
    textarea.selectionEnd = start + open.length + selected.length;
}

async function addEditorImage() {
    const url = await selectAndUploadImage();
    if (url) {
        editorImages.push(url);
        const container = $('editor-images');
        if (container) {
            const div = document.createElement('div');
            div.style.cssText = 'position: relative; width: 80px; height: 80px;';
            div.innerHTML = `
                <img src="${getImageUrl(url)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">
                <button onclick="removeEditorImage(${editorImages.length - 1})" style="position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; border-radius: 50%; background: var(--danger); color: white; border: none; font-size: 14px;">x</button>
            `;
            container.appendChild(div);
        }
    }
}

function removeEditorImage(index: number) {
    editorImages.splice(index, 1);
    if (editingPostId) {
        showEditorPage(editingPostId);
    } else {
        showEditorPage();
    }
}

async function submitPost() {
    const title = ($('editor-title') as HTMLInputElement)?.value.trim();
    const type = ($('editor-type') as HTMLSelectElement)?.value;
    const content = ($('editor-content') as HTMLTextAreaElement)?.value.trim();
    
    if (!title || !content) {
        showToast('请填写标题和内容', 'error');
        return;
    }
    
    try {
        if (editingPostId) {
            await fetchAPI(`/posts/${editingPostId}`, {
                method: 'PUT',
                body: JSON.stringify({ title, content, images: editorImages })
            });
            showToast('修改成功');
        } else {
            await fetchAPI('/posts', {
                method: 'POST',
                body: JSON.stringify({ title, content, type, images: editorImages })
            });
            showToast('发布成功');
        }
        
        goBack();
    } catch (e) {
        showToast((e as Error).message || '操作失败', 'error');
    }
}

function editPost(postId: number) {
    showEditorPage(postId);
}

// 后台管理页面
async function showAdminPage() {
    const content = $('content-body');
    if (!content || !state.currentUser || state.currentUser.level < 1) return;
    
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    
    try {
        const stats = await fetchAPI<{ totalUsers: number, totalPosts: number, totalComments: number, totalViews: number }>('/admin/stats');
        
        content.innerHTML = `
            <button class="btn btn-secondary" onclick="showProfile('${state.currentUser?.username}')" style="margin-bottom: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M19 12H5M12 19l-7-7 7-7"></path>
                </svg>
                返回
            </button>
            
            <div class="card">
                <h3 class="card-title">系统统计</h3>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${stats.totalUsers}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">用户数</div>
                    </div>
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${stats.totalPosts}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">帖子数</div>
                    </div>
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${stats.totalComments}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">评论数</div>
                    </div>
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${stats.totalViews}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">总浏览</div>
                    </div>
                </div>
            </div>
            
            <button class="btn btn-primary btn-block" onclick="showEditorPage()" style="margin-top: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M12 4v16m8-8H4"></path>
                </svg>
                发布新帖
            </button>
        `;
    } catch (e) {
        content.innerHTML = `
            <button class="btn btn-secondary" onclick="showProfile('${state.currentUser?.username}')" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `;
    }
}

// 通知页
async function showNotificationsPage() {
    const content = $('content-body');
    if (!content) return;
    
    if (!state.currentUser) {
        showLoginModal();
        return;
    }
    
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    
    try {
        const data = await fetchAPI<{ notifications: Notification[], unreadCount: number }>('/notifications');
        
        if (data.notifications.length === 0) {
            content.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <h3>暂无通知</h3>
                </div>
            `;
            return;
        }
        
        content.innerHTML = data.notifications.map(n => renderNotification(n)).join('');
        
        document.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', async () => {
                const id = (item as HTMLElement).dataset.id;
                const postId = (item as HTMLElement).dataset.postId;
                if (id) {
                    await fetchAPI(`/notifications/${id}/read`, { method: 'PUT' });
                    loadUnreadNotificationCount();
                }
                if (postId) {
                    showPostDetail(parseInt(postId));
                }
            });
        });
    } catch (e) {
        content.innerHTML = '<div class="empty-state"><h3>加载失败</h3></div>';
    }
}

function renderNotification(n: Notification): string {
    const icons: Record<string, string> = {
        'post_daily': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
        'post_decision': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>',
        'comment': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
        'like': '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>'
    };
    
    const classes: Record<string, string> = {
        'post_daily': 'daily',
        'post_decision': 'decision',
        'comment': 'comment',
        'like': 'like'
    };
    
    return `
        <div class="notification-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-post-id="${n.post_id || ''}">
            <div class="notification-icon ${classes[n.type] || 'daily'}">
                ${icons[n.type] || ''}
            </div>
            <div class="notification-content">
                <div class="notification-title">${escapeHtml(n.title)}</div>
                <div class="notification-text">${escapeHtml(n.content || n.post_title || '')}</div>
                <div class="notification-meta">${formatDate(n.created_at)}${n.actor_nickname ? ` · 来自 ${n.actor_nickname}` : ''}</div>
            </div>
        </div>
    `;
}

// 登录注册
function showLoginModal() {
    const modal = $('login-modal');
    modal?.classList.add('active');
}

function hideLoginModal() {
    const modal = $('login-modal');
    modal?.classList.remove('active');
}

function showRegisterModal() {
    hideLoginModal();
    const modal = $('register-modal');
    modal?.classList.add('active');
}

function hideRegisterModal() {
    const modal = $('register-modal');
    modal?.classList.remove('active');
}

async function handleLogin() {
    const username = ($('login-username') as HTMLInputElement)?.value.trim();
    const password = ($('login-password') as HTMLInputElement)?.value;
    
    if (!username || !password) {
        showToast('请填写用户名和密码', 'error');
        return;
    }
    
    try {
        const data = await fetchAPI<{ token: string, user: User }>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        
        state.token = data.token;
        state.currentUser = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        hideLoginModal();
        updateUserUI();
        loadUnreadNotificationCount();
        showToast('登录成功');
        showHomePage();
    } catch (e) {
        showToast((e as Error).message || '登录失败', 'error');
    }
}

let codeCooldown = 0;

async function sendVerificationCode() {
    const email = ($('register-email') as HTMLInputElement)?.value.trim();
    if (!email) {
        showToast('请输入邮箱', 'error');
        return;
    }
    
    if (codeCooldown > 0) {
        showToast(`请等待 ${codeCooldown} 秒`, 'error');
        return;
    }
    
    try {
        await fetchAPI('/auth/send-code', {
            method: 'POST',
            body: JSON.stringify({ email })
        });
        
        showToast('验证码已发送');
        codeCooldown = 60;
        
        const btn = $('send-code-btn');
        if (btn) {
            const timer = setInterval(() => {
                codeCooldown--;
                if (codeCooldown > 0) {
                    btn.textContent = `${codeCooldown}s`;
                } else {
                    btn.textContent = '发送验证码';
                    clearInterval(timer);
                }
            }, 1000);
        }
    } catch (e) {
        showToast((e as Error).message || '发送失败', 'error');
    }
}

async function handleRegister() {
    const username = ($('register-username') as HTMLInputElement)?.value.trim();
    const nickname = ($('register-nickname') as HTMLInputElement)?.value.trim();
    const email = ($('register-email') as HTMLInputElement)?.value.trim();
    const password = ($('register-password') as HTMLInputElement)?.value;
    const code = ($('register-code') as HTMLInputElement)?.value.trim();
    
    if (!username || !nickname || !email || !password || !code) {
        showToast('请填写完整信息', 'error');
        return;
    }
    
    try {
        await fetchAPI('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, nickname, email, password, code })
        });
        
        showToast('注册成功，请登录');
        hideRegisterModal();
        showLoginModal();
    } catch (e) {
        showToast((e as Error).message || '注册失败', 'error');
    }
}

function handleLogout() {
    state.token = null;
    state.currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    updateUserUI();
    showToast('已退出登录');
    showHomePage();
}

// 工具函数
function escapeHtml(text: string): string {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function stripHtml(html: string): string {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// 图片预览
(window as any).previewImage = (src: string) => {
    let modal = document.querySelector('.image-preview-modal') as HTMLElement;
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'image-preview-modal';
        modal.innerHTML = `
            <button class="image-preview-close" onclick="closeImagePreview()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <img src="${src}">
        `;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
        document.body.appendChild(modal);
    } else {
        modal.querySelector('img')?.setAttribute('src', src);
    }
    modal.classList.add('active');
};

(window as any).closeImagePreview = () => {
    const modal = document.querySelector('.image-preview-modal') as HTMLElement;
    if (modal) {
        modal.classList.remove('active');
    }
};

// 全局函数
(window as any).showLoginModal = showLoginModal;
(window as any).hideLoginModal = hideLoginModal;
(window as any).showRegisterModal = showRegisterModal;
(window as any).hideRegisterModal = hideRegisterModal;
(window as any).handleLogin = handleLogin;
(window as any).handleRegister = handleRegister;
(window as any).handleLogout = handleLogout;
(window as any).sendVerificationCode = sendVerificationCode;
(window as any).toggleLike = toggleLike;
(window as any).showSettingsPage = showSettingsPage;
(window as any).showEditorPage = showEditorPage;
(window as any).showAdminPage = showAdminPage;
(window as any).showProfile = showProfile;
(window as any).goBack = goBack;
(window as any).setReplyTo = setReplyTo;
(window as any).cancelReply = cancelReply;
(window as any).submitComment = submitComment;
(window as any).editPost = editPost;
(window as any).editorAction = editorAction;
(window as any).addEditorImage = addEditorImage;
(window as any).removeEditorImage = removeEditorImage;
(window as any).submitPost = submitPost;

// 图片上传功能
async function selectAndUploadImage(): Promise<string | null> {
    try {
        const { Camera, CameraResultType } = await import('@capacitor/camera');
        
        const photo = await Camera.getPhoto({
            quality: 90,
            allowEditing: false,
            resultType: CameraResultType.Base64
        });
        
        const byteCharacters = atob(photo.base64String!);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/jpeg' });
        
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        const formData = new FormData();
        formData.append('image', file);
        
        const response = await fetch(`${API_BASE_URL}/upload/image`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.token}`
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('上传失败');
        }
        
        const data = await response.json();
        return data.url;
    } catch (error) {
        console.error('图片上传失败:', error);
        showToast('图片上传失败', 'error');
        return null;
    }
}

(window as any).selectAndUploadImage = selectAndUploadImage;
(window as any).selectAvatar = selectAvatar;
(window as any).saveProfile = saveProfile;
(window as any).changePassword = changePassword;
