import { API_BASE, STATIC_BASE } from './config';
import { RichEditor, stripHtml } from './rich-editor';
import { initAutoUpdateCheck, manualCheckForUpdate } from './version-check';

// 富文本编辑器实例
let richEditor: RichEditor | null = null;

async function initTitlebar() {
    try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        
        const minimizeBtn = $('titlebar-minimize');
        const maximizeBtn = $('titlebar-maximize');
        const closeBtn = $('titlebar-close');
        const titlebar = document.querySelector('.titlebar');
        
        if (titlebar) {
            titlebar.addEventListener('mousedown', (e) => {
                const target = e.target as HTMLElement;
                if (!target.closest('.titlebar-btn')) {
                    appWindow.startDragging();
                }
            });
        }
        
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => appWindow.minimize());
        }
        
        if (maximizeBtn) {
            const updateMaximizeIcon = async () => {
                const isMaximized = await appWindow.isMaximized();
                maximizeBtn.innerHTML = isMaximized 
                    ? `<svg viewBox="0 0 24 24" width="12" height="12">
                        <path fill="currentColor" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
                       </svg>`
                    : `<svg viewBox="0 0 24 24" width="12" height="12">
                        <path fill="currentColor" d="M4 4h16v16H4V4zm2 2v12h12V6H6z"/>
                       </svg>`;
                maximizeBtn.title = isMaximized ? '还原' : '最大化';
            };
            
            maximizeBtn.addEventListener('click', async () => {
                const isMaximized = await appWindow.isMaximized();
                if (isMaximized) {
                    await appWindow.unmaximize();
                } else {
                    await appWindow.maximize();
                }
                updateMaximizeIcon();
            });
            
            updateMaximizeIcon();
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => appWindow.close());
        }
    } catch (error) {
        console.log('Tauri window API not available:', error);
    }
}

interface User {
    id: number;
    username: string;
    nickname: string;
    email?: string;
    avatar?: string;
    level: number;
    contribution: number;
    email_verified?: number;
    created_at: string;
    posts_count?: number;
    comments_count?: number;
    likes_count?: number;
}

interface Post {
    id: number;
    title: string;
    content: string;
    type: string;
    author_id: number;
    author_nickname: string;
    author_username: string;
    author_avatar?: string;
    author_contribution?: number;
    created_at: string;
    updated_at?: string;
    likes: number;
    views: number;
    comments_count: number;
    tags?: string;
    images?: string[];
    is_pinned?: number;
    status?: string;
}

interface Comment {
    id: number;
    post_id: number;
    author_id: number;
    author_nickname: string;
    author_username: string;
    author_avatar?: string;
    content: string;
    created_at: string;
    parent_id?: number;
    reply_to?: { nickname: string; username: string };
    replies?: Comment[];
}

interface Announcement {
    id: number;
    title: string;
    content: string;
    is_popup: number;
    is_active: number;
    created_at: string;
}

interface AppState {
    currentPage: string;
    currentPostId: number | null;
    currentUser: User | null;
    token: string | null;
    isLoading: boolean;
    editingPostId: number | null;
    uploadedImages: string[];
}

const state: AppState = {
    currentPage: 'home',
    currentPostId: null,
    currentUser: null,
    token: null,
    isLoading: false,
    editingPostId: null,
    uploadedImages: []
};

const $ = (id: string) => document.getElementById(id);

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const toast = $('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = `toast ${type} active`;
    
    setTimeout(() => {
        toast.classList.remove('active');
    }, 3000);
}

async function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    
    const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {})
    };
    
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    const data = await response.json();
    
    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    
    return data;
}

function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
}

function formatNumber(num: number): string {
    if (num >= 10000) return (num / 10000).toFixed(1) + '万';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return (num || 0).toString();
}

function getImageUrl(path: string | undefined): string {
    if (!path) return '';
    if (path.startsWith('data:')) return path;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (path.startsWith('/')) return `${STATIC_BASE}${path}`;
    return `${STATIC_BASE}/${path}`;
}

function getAvatarUrl(avatar: string | undefined): string {
    return getImageUrl(avatar);
}

function getInitial(name: string | undefined): string {
    return (name || '未')[0];
}

function renderAvatar(avatar: string | undefined, name: string | undefined, size: number = 44): string {
    const avatarUrl = getAvatarUrl(avatar);
    const initial = getInitial(name);
    const sizeStyle = `width:${size}px;height:${size}px;font-size:${size * 0.4}px;`;
    
    if (avatarUrl) {
        return `<img src="${avatarUrl}" class="post-avatar" style="${sizeStyle}" onerror="this.outerHTML='<div class=\\'post-avatar-placeholder\\' style=\\'${sizeStyle}\\'>${initial}</div>'">`;
    }
    return `<div class="post-avatar-placeholder" style="${sizeStyle}">${initial}</div>`;
}

function renderPostCard(post: Post, canEdit: boolean = false): string {
    const excerpt = stripHtml(post.content).substring(0, 120);
    const firstImage = post.images?.[0];
    const avatarHtml = renderAvatar(post.author_avatar, post.author_nickname);
    
    // 置顶标识
    const pinnedBadge = post.is_pinned ? `
        <span class="pinned-badge">
            <svg viewBox="0 0 24 24" width="14" height="14">
                <path fill="currentColor" d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z"/>
            </svg>
            置顶
        </span>
    ` : '';
    
    let imageHtml = '';
    if (firstImage) {
        imageHtml = `<div class="post-images"><img src="${getImageUrl(firstImage)}" class="post-image" alt="" onerror="this.parentElement.remove()"></div>`;
    }
    
    let tagsHtml = '';
    if (post.tags) {
        const tags = post.tags.split(',').filter(t => t.trim());
        if (tags.length > 0) {
            tagsHtml = `<div class="tags-container">${tags.map(t => `<span class="tag">${t.trim()}</span>`).join('')}</div>`;
        }
    }
    
    let editBtnHtml = '';
    if (canEdit) {
        editBtnHtml = `
            <button class="edit-btn" onclick="event.stopPropagation(); window.editPost(${post.id})" type="button">
                <svg viewBox="0 0 24 24" width="14" height="14">
                    <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                </svg>
                编辑
            </button>
        `;
    }
    
    return `
        <div class="post-card ${post.is_pinned ? 'post-pinned' : ''}" data-id="${post.id}">
            <div class="post-header">
                ${avatarHtml}
                <div class="post-meta">
                    <span class="post-author">${post.author_nickname || '未知用户'}</span>
                    <span class="post-time">${formatDate(post.created_at)}</span>
                </div>
                <div class="post-badges">
                    ${pinnedBadge}
                    ${editBtnHtml}
                </div>
            </div>
            <div class="post-title">${post.title || '无标题'}</div>
            ${excerpt ? `<div class="post-excerpt">${excerpt}</div>` : ''}
            ${tagsHtml}
            ${imageHtml}
            <div class="post-footer">
                <span class="post-stat">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                    ${formatNumber(post.likes)}
                </span>
                <span class="post-stat">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                    </svg>
                    ${formatNumber(post.views)}
                </span>
                <span class="post-stat">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="currentColor" d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/>
                    </svg>
                    ${formatNumber(post.comments_count)}
                </span>
            </div>
        </div>
    `;
}

function renderComment(comment: Comment, isReply: boolean = false): string {
    const avatarHtml = renderAvatar(comment.author_avatar, comment.author_nickname, isReply ? 28 : 36);
    const replyToInfo = isReply && comment.reply_to ? `<div class="reply-to-info">回复 <span class="reply-to-name">@${comment.reply_to.nickname}</span></div>` : '';
    const replyButton = state.currentUser ? `<button class="comment-reply-btn" data-id="${comment.id}" data-name="${comment.author_nickname}" type="button">回复</button>` : '';
    
    let repliesHtml = '';
    if (comment.replies && comment.replies.length > 0) {
        repliesHtml = `<div class="comment-replies">${comment.replies.map(reply => renderComment(reply, true)).join('')}</div>`;
    }
    
    return `
        <div class="comment-item ${isReply ? 'comment-reply' : ''}" data-id="${comment.id}">
            ${avatarHtml}
            <div class="comment-content">
                <div class="comment-header">
                    <span class="comment-author">${comment.author_nickname}</span>
                    <span class="comment-time">${formatDate(comment.created_at)}</span>
                </div>
                ${replyToInfo}
                <div class="comment-text">${comment.content}</div>
                <div class="comment-actions">
                    ${replyButton}
                </div>
                <div class="reply-form-container" id="reply-form-${comment.id}" style="display: none;">
                    <textarea class="reply-input" id="reply-input-${comment.id}" placeholder="回复 ${comment.author_nickname}..." rows="2"></textarea>
                    <div class="reply-form-actions">
                        <button class="btn-secondary btn-sm" onclick="window.hideReplyForm(${comment.id})" type="button">取消</button>
                        <button class="btn-primary btn-sm" onclick="window.submitReply(${comment.id})" type="button">发送</button>
                    </div>
                </div>
            </div>
        </div>
        ${repliesHtml}
    `;
}

async function loadPosts(type: string = '') {
    const contentBody = $('content-body');
    if (!contentBody) return;
    
    contentBody.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        const endpoint = type ? `/posts?type=${type}&limit=50` : '/posts?limit=50';
        const data = await fetchAPI<{ posts: Post[], total: number }>(endpoint);
        
        const posts = data.posts || [];
        
        if (!posts.length) {
            contentBody.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" width="64" height="64">
                        <path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                    </svg>
                    <p>暂无内容</p>
                </div>
            `;
            return;
        }
        
        contentBody.innerHTML = posts.map(post => renderPostCard(post, state.currentUser?.id === post.author_id)).join('');
        
        contentBody.querySelectorAll('.post-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.getAttribute('data-id');
                if (id) showPostDetail(parseInt(id));
            });
        });
    } catch (error) {
        console.error('Load posts error:', error);
        contentBody.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="64" height="64">
                    <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <p>加载失败</p>
                <p style="font-size: 12px; margin-top: 8px;">${(error as Error).message}</p>
            </div>
        `;
    }
}

async function showPostDetail(id: number) {
    const contentBody = $('content-body');
    const titleEl = $('page-title') as HTMLElement;
    
    if (!contentBody) return;
    
    state.currentPostId = id;
    contentBody.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        const data = await fetchAPI<{ post: Post, comments: Comment[] }>(`/posts/${id}`);
        const post = data.post;
        const comments = data.comments || [];
        
        if (titleEl) titleEl.textContent = '帖子详情';
        
        const avatarHtml = renderAvatar(post.author_avatar, post.author_nickname);
        const canEdit = state.currentUser?.id === post.author_id;
        
        let imagesHtml = '';
        if (post.images && post.images.length > 0) {
            imagesHtml = `
                <div class="post-images" style="margin-top: 16px;">
                    ${post.images.map(img => `
                        <img src="${getImageUrl(img)}" class="post-image" alt="" style="cursor: pointer; max-width: 100%; border-radius: 8px;" onclick="window.previewImage('${getImageUrl(img)}')" onerror="this.remove()">
                    `).join('')}
                </div>
            `;
        }
        
        let tagsHtml = '';
        if (post.tags) {
            const tags = post.tags.split(',').filter(t => t.trim());
            if (tags.length > 0) {
                tagsHtml = `<div class="tags-container">${tags.map(t => `<span class="tag">${t.trim()}</span>`).join('')}</div>`;
            }
        }
        
        let commentsHtml = '';
        if (comments.length > 0) {
            commentsHtml = comments.map(c => renderComment(c)).join('');
        } else {
            commentsHtml = '<div class="empty-state" style="padding: 20px;"><p>暂无评论</p></div>';
        }
        
        const isLoggedIn = !!state.currentUser;
        
        contentBody.innerHTML = `
            <div class="post-detail">
                <button class="back-btn" id="back-btn" type="button">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                    </svg>
                    返回
                </button>
                
                <div class="post-detail-header">
                    <div class="post-header" style="cursor: pointer;" onclick="window.showProfile('${post.author_username}')">
                        ${avatarHtml}
                        <div class="post-meta">
                            <span class="post-author">${post.author_nickname || '未知用户'}</span>
                            <span class="post-time">@${post.author_username}</span>
                        </div>
                    </div>
                    ${canEdit ? `
                        <button class="edit-btn" onclick="window.editPost(${post.id})" type="button">
                            <svg viewBox="0 0 24 24" width="14" height="14">
                                <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                            </svg>
                            编辑
                        </button>
                    ` : ''}
                </div>
                
                <div class="post-detail-title">${post.title || '无标题'}</div>
                
                <div class="post-detail-meta">
                    <span>${formatDate(post.created_at)}</span>
                    <span>·</span>
                    <span>${formatNumber(post.views)} 次浏览</span>
                    <span>·</span>
                    <span>${formatNumber(post.likes)} 赞</span>
                </div>
                
                <div class="post-content">${post.content || ''}</div>
                
                ${tagsHtml}
                ${imagesHtml}
                
                <div class="post-detail-actions">
                    <button class="action-btn" id="like-btn" data-id="${post.id}" type="button">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                        点赞
                    </button>
                    <button class="action-btn" id="share-btn" type="button">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
                        </svg>
                        分享
                    </button>
                </div>
                
                <div class="comments-section">
                    <div class="comments-title">评论 (${comments.length})</div>
                    
                    ${isLoggedIn ? `
                        <div class="comment-form">
                            <textarea class="comment-input" id="comment-input" placeholder="写下你的评论..." rows="3"></textarea>
                            <button class="comment-submit" id="comment-submit" type="button">发送</button>
                        </div>
                    ` : `
                        <div class="comment-form" style="text-align: center; padding: 20px; background: var(--bg-secondary); border-radius: var(--radius-sm);">
                            <p style="color: var(--text-muted);">登录后才能评论</p>
                            <button class="btn-primary" style="margin-top: 12px; width: auto; padding: 10px 24px;" onclick="window.showLoginModal()" type="button">登录</button>
                        </div>
                    `}
                    
                    <div class="comments-list">
                        ${commentsHtml}
                    </div>
                </div>
            </div>
        `;
        
        const backBtn = $('back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => navigateTo(state.currentPage));
        }
        
        const likeBtn = $('like-btn');
        if (likeBtn) {
            likeBtn.addEventListener('click', () => handleLike(post.id));
        }
        
        const shareBtn = $('share-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => handleShare(post));
        }
        
        const commentSubmit = $('comment-submit');
        const commentInput = $('comment-input');
        if (commentSubmit && commentInput) {
            commentSubmit.addEventListener('click', () => handleSubmitComment(post.id));
        }
    } catch (error) {
        console.error('Load post detail error:', error);
        contentBody.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="64" height="64">
                    <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <p>加载失败</p>
                <p style="font-size: 12px; margin-top: 8px;">${(error as Error).message}</p>
            </div>
        `;
    }
}

async function showProfile(username: string) {
    const contentBody = $('content-body');
    const titleEl = $('page-title') as HTMLElement;
    
    if (!contentBody) return;
    
    contentBody.innerHTML = '<div class="loading-spinner"></div>';
    if (titleEl) titleEl.textContent = '个人主页';
    
    try {
        const data = await fetchAPI<{ user: User }>(`/auth/user/${username}`);
        const user = data.user;
        const isOwnProfile = state.currentUser?.username === username;
        
        const avatarHtml = renderAvatar(user.avatar, user.nickname, 100);
        
        let profileActions = '';
        if (isOwnProfile) {
            profileActions = `
                <div class="profile-actions">
                    <button class="profile-action-btn" id="edit-profile-btn" type="button">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                        编辑资料
                    </button>
                    <button class="profile-action-btn" id="check-update-btn" type="button">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                        </svg>
                        检查更新
                    </button>
                    <button class="profile-action-btn danger" id="logout-btn" type="button">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path fill="currentColor" d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
                        </svg>
                        退出登录
                    </button>
                </div>
            `;
        }
        
        contentBody.innerHTML = `
            <div class="profile-header">
                ${avatarHtml}
                <div class="profile-name">${user.nickname || '未知用户'}</div>
                <div class="profile-handle">@${user.username}</div>
                <div class="profile-stats">
                    <div class="profile-stat">
                        <div class="profile-stat-value">${user.posts_count || 0}</div>
                        <div class="profile-stat-label">帖子</div>
                    </div>
                    <div class="profile-stat">
                        <div class="profile-stat-value">${user.comments_count || 0}</div>
                        <div class="profile-stat-label">评论</div>
                    </div>
                    <div class="profile-stat">
                        <div class="profile-stat-value">${user.likes_count || 0}</div>
                        <div class="profile-stat-label">获赞</div>
                    </div>
                </div>
                ${profileActions}
            </div>
            <div class="profile-posts">
                <h3 style="margin-bottom: 16px; font-size: 16px;">发布的帖子</h3>
                <div id="profile-posts-list"></div>
            </div>
        `;
        
        if (isOwnProfile) {
            const editProfileBtn = $('edit-profile-btn');
            if (editProfileBtn) {
                editProfileBtn.addEventListener('click', () => showEditProfileModal(user));
            }
            
            const checkUpdateBtn = $('check-update-btn');
            if (checkUpdateBtn) {
                checkUpdateBtn.addEventListener('click', () => manualCheckForUpdate(true));
            }
            
            const logoutBtn = $('logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', handleLogout);
            }
        }
        
        const postsList = $('profile-posts-list');
        if (postsList) {
            try {
                const postsData = await fetchAPI<{ posts: Post[] }>(`/posts?author=${username}&limit=20`);
                const posts = postsData.posts || [];
                
                if (posts.length > 0) {
                    postsList.innerHTML = posts.map(post => renderPostCard(post, isOwnProfile)).join('');
                    postsList.querySelectorAll('.post-card').forEach(card => {
                        card.addEventListener('click', () => {
                            const id = card.getAttribute('data-id');
                            if (id) showPostDetail(parseInt(id));
                        });
                    });
                } else {
                    postsList.innerHTML = '<div class="empty-state" style="padding: 20px;"><p>暂无帖子</p></div>';
                }
            } catch {
                postsList.innerHTML = '<div class="empty-state" style="padding: 20px;"><p>加载帖子失败</p></div>';
            }
        }
    } catch (error) {
        console.error('Load profile error:', error);
        contentBody.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="64" height="64">
                    <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <p>用户不存在</p>
            </div>
        `;
    }
}

function showEditProfileModal(user: User) {
    const contentBody = $('content-body');
    if (!contentBody) return;
    
    const avatarUrl = getAvatarUrl(user.avatar);
    
    contentBody.innerHTML = `
        <div class="settings-page">
            <button class="back-btn" id="back-to-profile" type="button">
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                </svg>
                返回
            </button>
            
            <h2 style="margin-bottom: 24px;">编辑资料</h2>
            
            <div class="form-group">
                <label>头像</label>
                <div class="avatar-upload-area">
                    <div class="avatar-preview" id="avatar-preview">
                        <img src="${avatarUrl || ''}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23ccc%22 d=%22M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%22/></svg>'">
                    </div>
                    <div>
                        <input type="file" id="avatar-upload-input" accept="image/*" style="display:none;">
                        <button class="avatar-upload-btn" id="avatar-upload-btn" type="button">更换头像</button>
                    </div>
                </div>
            </div>
            
            <div class="form-group">
                <label>昵称</label>
                <input type="text" id="edit-nickname" value="${user.nickname || ''}" placeholder="请输入昵称">
            </div>
            
            <div class="form-group">
                <label>
                    邮箱
                    ${user.email_verified ?
                        '<span style="color: #10b981; font-size: 13px; margin-left: 8px;">✓ 已验证</span>' :
                        '<span style="color: #f59e0b; font-size: 13px; margin-left: 8px;">⚠ 未验证</span>'
                    }
                </label>
                <div style="display: flex; gap: 8px;">
                    <input type="email" id="edit-email" value="${user.email || ''}" placeholder="请输入邮箱" ${user.email_verified ? 'disabled style="flex: 1; background: #f8fafc;"' : 'style="flex: 1;"'}>
                    ${!user.email_verified ? `
                        <button class="btn-secondary" id="send-verify-code-btn" style="white-space: nowrap;">获取验证码</button>
                    ` : ''}
                </div>
                ${!user.email_verified ? `
                    <div style="margin-top: 12px;">
                        <input type="text" id="verify-email-code" placeholder="请输入验证码" maxlength="6" style="width: 200px;">
                        <button class="btn-primary" id="verify-email-btn" type="button" style="width: auto; padding: 10px 20px; margin-left: 8px; font-size: 14px;">验证邮箱</button>
                    </div>
                ` : ''}
            </div>
            
            <div class="form-group">
                <label>新密码（留空则不修改）</label>
                <input type="password" id="edit-password" placeholder="请输入新密码">
            </div>
            
            <div class="form-group">
                <label>确认新密码</label>
                <input type="password" id="edit-confirm-password" placeholder="请再次输入新密码">
            </div>
            
            <button class="btn-primary" id="save-profile-btn" type="button">保存修改</button>
        </div>
    `;
    
    const backBtn = $('back-to-profile');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (state.currentUser) {
                showProfile(state.currentUser.username);
            }
        });
    }
    
    const avatarUploadBtn = $('avatar-upload-btn');
    const avatarUploadInput = $('avatar-upload-input') as HTMLInputElement;
    
    if (avatarUploadBtn && avatarUploadInput) {
        avatarUploadBtn.addEventListener('click', () => avatarUploadInput.click());
        avatarUploadInput.addEventListener('change', () => {
            if (avatarUploadInput.files && avatarUploadInput.files.length > 0) {
                handleAvatarUpload(avatarUploadInput.files[0]);
            }
        });
    }
    
    const saveBtn = $('save-profile-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => handleSaveProfile(user.id));
    }

    // 绑定邮箱验证按钮事件
    if (!user.email_verified) {
        const sendVerifyCodeBtn = $('send-verify-code-btn');
        if (sendVerifyCodeBtn) {
            sendVerifyCodeBtn.addEventListener('click', sendBindVerificationCode);
        }

        const verifyEmailBtn = $('verify-email-btn');
        if (verifyEmailBtn) {
            verifyEmailBtn.addEventListener('click', handleVerifyEmail);
        }
    }
}

let bindCodeCountdown = 0;

async function sendBindVerificationCode() {
    const email = ($('edit-email') as HTMLInputElement)?.value.trim();
    const sendBtn = $('send-verify-code-btn') as HTMLButtonElement;

    if (!email) {
        showToast('请先输入邮箱地址', 'error');
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast('邮箱格式不正确', 'error');
        return;
    }

    try {
        sendBtn.disabled = true;
        await fetchAPI('/auth/send-bind-code', {
            method: 'POST',
            body: JSON.stringify({ email })
        });

        // 开始倒计时
        bindCodeCountdown = 60;
        sendBtn.textContent = `${bindCodeCountdown}秒后重试`;
        const timer = setInterval(() => {
            bindCodeCountdown--;
            if (bindCodeCountdown <= 0) {
                clearInterval(timer);
                sendBtn.disabled = false;
                sendBtn.textContent = '获取验证码';
            } else {
                sendBtn.textContent = `${bindCodeCountdown}秒后重试`;
            }
        }, 1000);

        showToast('验证码已发送，请查收邮件', 'success');
    } catch (error) {
        sendBtn.disabled = false;
        showToast((error as Error).message, 'error');
    }
}

async function handleVerifyEmail() {
    const email = ($('edit-email') as HTMLInputElement)?.value.trim();
    const code = ($('verify-email-code') as HTMLInputElement)?.value.trim();

    if (!email || !code) {
        showToast('请输入邮箱和验证码', 'error');
        return;
    }

    try {
        await fetchAPI('/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ email, code })
        });

        showToast('邮箱验证成功', 'success');

        // 更新当前用户信息
        if (state.currentUser) {
            state.currentUser.email = email;
            state.currentUser.email_verified = 1;
            localStorage.setItem('user', JSON.stringify(state.currentUser));
        }

        // 刷新页面
        setTimeout(() => {
            if (state.currentUser) {
                showEditProfileModal(state.currentUser);
            }
        }, 1000);
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

async function handleAvatarUpload(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);
    
    try {
        const response = await fetch(`${API_BASE}/upload/avatar`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.token}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '上传失败');
        }
        
        const avatarPreview = $('avatar-preview')?.querySelector('img') as HTMLImageElement;
        if (avatarPreview && data.path) {
            avatarPreview.src = getImageUrl(data.path);
        }
        
        state.currentUser = { ...state.currentUser!, avatar: data.path };
        localStorage.setItem('user', JSON.stringify(state.currentUser));
        updateUserUI();
        
        showToast('头像上传成功', 'success');
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

async function handleSaveProfile(userId: number) {
    const nickname = ($('edit-nickname') as HTMLInputElement)?.value.trim();
    const email = ($('edit-email') as HTMLInputElement)?.value.trim();
    const password = ($('edit-password') as HTMLInputElement)?.value;
    const confirmPassword = ($('edit-confirm-password') as HTMLInputElement)?.value;
    
    if (!nickname) {
        showToast('昵称不能为空', 'error');
        return;
    }
    
    if (password && password !== confirmPassword) {
        showToast('两次密码不一致', 'error');
        return;
    }
    
    if (password && password.length < 6) {
        showToast('密码至少6位', 'error');
        return;
    }
    
    const updateData: Record<string, string> = { nickname, email };
    if (password) {
        updateData.password = password;
    }
    
    try {
        const result = await fetchAPI<{ user: User }>(`/auth/user/${userId}`, {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });
        
        state.currentUser = result.user;
        localStorage.setItem('user', JSON.stringify(result.user));
        updateUserUI();
        showToast('保存成功', 'success');
        showProfile(state.currentUser!.username);
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

function showSearchPage() {
    const contentBody = $('content-body');
    const titleEl = $('page-title') as HTMLElement;
    
    if (!contentBody) return;
    if (titleEl) titleEl.textContent = '搜索';
    
    contentBody.innerHTML = `
        <div class="search-container">
            <div class="search-box">
                <input type="text" class="search-input" id="search-input" placeholder="搜索帖子标题、内容或标签...">
                <button class="search-btn" id="search-btn" type="button">搜索</button>
            </div>
        </div>
        <div id="search-results"></div>
    `;
    
    const searchBtn = $('search-btn');
    const searchInput = $('search-input') as HTMLInputElement;
    
    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => performSearch(searchInput.value));
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch(searchInput.value);
        });
    }
}

async function performSearch(query: string) {
    const resultsContainer = $('search-results');
    if (!resultsContainer || !query.trim()) return;
    
    resultsContainer.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        const data = await fetchAPI<{ posts: Post[], total: number }>(`/posts?search=${encodeURIComponent(query)}&limit=50`);
        const posts = data.posts || [];
        
        if (!posts.length) {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <p>未找到相关内容</p>
                </div>
            `;
            return;
        }
        
        resultsContainer.innerHTML = `
            <p style="margin-bottom: 16px; color: var(--text-secondary);">找到 ${data.total} 条结果</p>
            ${posts.map(post => renderPostCard(post, state.currentUser?.id === post.author_id)).join('')}
        `;
        
        resultsContainer.querySelectorAll('.post-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.getAttribute('data-id');
                if (id) showPostDetail(parseInt(id));
            });
        });
    } catch (error) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <p>搜索失败: ${(error as Error).message}</p>
            </div>
        `;
    }
}

async function showAdminPage() {
    const contentBody = $('content-body');
    const titleEl = $('page-title') as HTMLElement;
    
    if (!contentBody) return;
    if (titleEl) titleEl.textContent = '管理后台';
    
    if (!state.currentUser || state.currentUser.level < 1) {
        contentBody.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="64" height="64">
                    <path fill="currentColor" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
                </svg>
                <p>权限不足</p>
                <p style="font-size: 12px; margin-top: 8px;">需要管理员权限</p>
            </div>
        `;
        return;
    }
    
    contentBody.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        const stats = await fetchAPI<{
            users: number;
            posts: number;
            comments: number;
            daily: number;
            decisions: number;
            forums: number;
        }>('/admin/statistics');
        
        contentBody.innerHTML = `
            <div class="admin-stats">
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${stats.users}</div>
                    <div class="admin-stat-label">用户总数</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${stats.posts}</div>
                    <div class="admin-stat-label">帖子总数</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${stats.comments}</div>
                    <div class="admin-stat-label">评论总数</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${stats.daily}</div>
                    <div class="admin-stat-label">日报</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${stats.decisions}</div>
                    <div class="admin-stat-label">决策</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${stats.forums}</div>
                    <div class="admin-stat-label">贴吧</div>
                </div>
            </div>
            
            <div class="admin-section">
                <div class="admin-section-title">帖子管理</div>
                <div id="admin-posts-list"></div>
            </div>
            
            <div class="admin-section">
                <div class="admin-section-title">用户管理</div>
                <div id="admin-users-list"></div>
            </div>
            
            <div class="admin-section">
                <div class="admin-section-title">公告管理</div>
                <div id="admin-announcements-list"></div>
            </div>
        `;
        
        const postsList = $('admin-posts-list');
        if (postsList) {
            const postsData = await fetchAPI<{ posts: Post[], total: number }>('/admin/posts?limit=20');
            const posts = postsData.posts || [];
            
            if (posts.length > 0) {
                postsList.innerHTML = `
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>标题</th>
                                <th>类型</th>
                                <th>作者</th>
                                <th>状态</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${posts.map(post => `
                                <tr>
                                    <td>${post.id}</td>
                                    <td>${post.title?.substring(0, 30) || '无标题'}${post.title?.length > 30 ? '...' : ''}</td>
                                    <td><span class="admin-badge primary">${post.type}</span></td>
                                    <td>${post.author_nickname || '未知'}</td>
                                    <td><span class="admin-badge ${post.status === 'active' ? 'success' : 'danger'}">${post.status === 'active' ? '正常' : '已删除'}</span></td>
                                    <td class="admin-actions">
                                        <button class="admin-btn" onclick="window.togglePinPost(${post.id}, ${post.is_pinned ? 0 : 1})" type="button">${post.is_pinned ? '取消置顶' : '置顶'}</button>
                                        ${post.status === 'active' ? `<button class="admin-btn danger" onclick="window.deletePost(${post.id})" type="button">删除</button>` : ''}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                postsList.innerHTML = '<p style="color: var(--text-muted);">暂无帖子</p>';
            }
        }
        
        const usersList = $('admin-users-list');
        if (usersList) {
            const usersData = await fetchAPI<{ users: User[], total: number }>('/admin/users?limit=20');
            const users = usersData.users || [];
            const isSuperAdmin = state.currentUser && state.currentUser.level >= 2;
            
            if (users.length > 0) {
                usersList.innerHTML = `
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>用户名</th>
                                <th>昵称</th>
                                <th>等级</th>
                                <th>贡献</th>
                                <th>注册时间</th>
                                ${isSuperAdmin ? '<th>操作</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${users.map(user => `
                                <tr>
                                    <td>${user.id}</td>
                                    <td>${user.username}</td>
                                    <td>${user.nickname || '-'}</td>
                                    <td><span class="admin-badge ${user.level >= 2 ? 'danger' : user.level >= 1 ? 'warning' : 'success'}">${user.level >= 2 ? '超级管理员' : user.level >= 1 ? '管理员' : '普通用户'}</span></td>
                                    <td>${user.contribution || 0}</td>
                                    <td>${formatDate(user.created_at)}</td>
                                    ${isSuperAdmin ? `
                                        <td class="admin-actions">
                                            <select class="admin-select" onchange="window.setUserLevel(${user.id}, this.value)" ${user.id === state.currentUser?.id ? 'disabled' : ''}>
                                                <option value="0" ${user.level === 0 ? 'selected' : ''}>普通用户</option>
                                                <option value="1" ${user.level === 1 ? 'selected' : ''}>管理员</option>
                                                <option value="2" ${user.level === 2 ? 'selected' : ''}>超级管理员</option>
                                            </select>
                                        </td>
                                    ` : ''}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                usersList.innerHTML = '<p style="color: var(--text-muted);">暂无用户</p>';
            }
        }
        
        const announcementsList = $('admin-announcements-list');
        if (announcementsList) {
            const announcements = await fetchAPI<Announcement[]>('/admin/announcements');
            
            if (announcements.length > 0) {
                announcementsList.innerHTML = `
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>标题</th>
                                <th>弹窗</th>
                                <th>状态</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${announcements.map(ann => `
                                <tr>
                                    <td>${ann.id}</td>
                                    <td>${ann.title?.substring(0, 30) || '无标题'}${ann.title?.length > 30 ? '...' : ''}</td>
                                    <td><span class="admin-badge ${ann.is_popup ? 'warning' : ''}">${ann.is_popup ? '是' : '否'}</span></td>
                                    <td><span class="admin-badge ${ann.is_active ? 'success' : 'danger'}">${ann.is_active ? '启用' : '禁用'}</span></td>
                                    <td>${formatDate(ann.created_at)}</td>
                                    <td class="admin-actions">
                                        <button class="admin-btn danger" onclick="window.deleteAnnouncement(${ann.id})" type="button">删除</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                announcementsList.innerHTML = '<p style="color: var(--text-muted);">暂无公告</p>';
            }
        }
    } catch (error) {
        contentBody.innerHTML = `
            <div class="empty-state">
                <p>加载失败: ${(error as Error).message}</p>
            </div>
        `;
    }
}

async function showStockPage() {
    const contentBody = $('content-body');
    const titleEl = $('page-title') as HTMLElement;
    
    if (!contentBody) return;
    if (titleEl) titleEl.textContent = '虚拟股票';
    
    contentBody.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        const [stocksRes, portfolioRes] = await Promise.all([
            fetchAPI<{ stocks: any[] }>('/stock/stocks'),
            fetchAPI<{ availablePoints: number; holdings: any[]; totalValue: number; totalProfit: number }>('/stock/portfolio')
        ]);
        
        const stocks = stocksRes.stocks || [];
        const portfolio = portfolioRes;
        
        contentBody.innerHTML = `
            <div class="card" style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; margin-bottom: 16px;">
                <div style="font-size: 14px; opacity: 0.8;">总资产</div>
                <div style="font-size: 28px; font-weight: bold; margin: 8px 0;">${(portfolio.totalValue || 0).toFixed(2)}</div>
                <div style="display: flex; gap: 24px; margin-top: 16px;">
                    <div>
                        <div style="font-size: 18px; font-weight: 600;">${(portfolio.availablePoints || 0).toFixed(2)}</div>
                        <div style="font-size: 12px; opacity: 0.8;">可用贡献点</div>
                    </div>
                    <div>
                        <div style="font-size: 18px; font-weight: 600; color: ${(portfolio.totalProfit || 0) >= 0 ? '#86efac' : '#fca5a5'};">${(portfolio.totalProfit || 0) >= 0 ? '+' : ''}${(portfolio.totalProfit || 0).toFixed(2)}</div>
                        <div style="font-size: 12px; opacity: 0.8;">浮动盈亏</div>
                    </div>
                </div>
            </div>
            
            <div class="section-title" style="margin-top: 20px;">股票市场</div>
            ${stocks.map(stock => {
                const change = stock.current_price - stock.base_price;
                const changePercent = (change / stock.base_price * 100).toFixed(2);
                const isUp = change >= 0;
                return `
                    <div class="card" onclick="showStockDetail(${stock.id})" style="cursor: pointer;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-weight: 600;">${stock.symbol}</div>
                                <div style="font-size: 12px; color: var(--text-muted);">${stock.name}</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 20px; font-weight: 700;">${stock.current_price.toFixed(2)}</div>
                                <div style="font-size: 12px; color: ${isUp ? 'var(--success)' : 'var(--danger)'};">
                                    ${isUp ? '+' : ''}${change.toFixed(2)} (${isUp ? '+' : ''}${changePercent}%)
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
            
            <div class="section-title" style="margin-top: 20px;">我的持仓</div>
            ${(portfolio.holdings || []).length === 0 ? '<div class="empty-state"><p>暂无持仓</p></div>' :
                portfolio.holdings.map((h: any) => `
                    <div class="card">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-weight: 600;">${h.symbol}</div>
                                <div style="font-size: 12px; color: var(--text-muted);">${h.name} · ${h.shares}股</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 18px; font-weight: 700;">${(h.current_value || 0).toFixed(2)}</div>
                                <div style="font-size: 12px; color: ${(h.profit_loss || 0) >= 0 ? 'var(--success)' : 'var(--danger)'};">
                                    ${(h.profit_loss || 0) >= 0 ? '+' : ''}${(h.profit_loss || 0).toFixed(2)}
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')
            }
        `;
    } catch (e) {
        contentBody.innerHTML = `<div class="empty-state"><h3>加载失败</h3></div>`;
    }
}

async function showCheckinPage() {
    const contentBody = $('content-body');
    const titleEl = $('page-title') as HTMLElement;
    
    if (!contentBody) return;
    if (titleEl) titleEl.textContent = '每日签到';
    
    contentBody.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        const status = await fetchAPI<any>('/checkin/status');
        
        contentBody.innerHTML = `
            <div class="card" style="background: ${status.todayCheckedIn ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)'}; color: white; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 16px;">${status.todayCheckedIn ? '✓' : '📅'}</div>
                <div style="font-size: 20px; font-weight: 600;">${status.todayCheckedIn ? '今日已签到' : '今日未签到'}</div>
                <div style="font-size: 14px; opacity: 0.9; margin-top: 8px;">
                    ${status.todayCheckedIn ? `已连续签到 ${status.continuousDays} 天` : `签到可获得 ${status.todayReward} 贡献点`}
                </div>
                ${!status.todayCheckedIn ? `<button class="btn btn-primary" style="margin-top: 16px; background: white; color: #f59e0b;" onclick="doCheckin()">立即签到</button>` : ''}
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 16px;">
                <div class="card" style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${status.continuousDays}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">连续签到</div>
                </div>
                <div class="card" style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${status.totalCheckins}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">累计签到</div>
                </div>
                <div class="card" style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${status.makeupCards}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">补签卡</div>
                </div>
                <div class="card" style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${status.totalContribution}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">贡献点</div>
                </div>
            </div>
            
            <div class="card" style="margin-top: 16px;">
                <div class="section-title">补签功能</div>
                <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
                    可补签最近7天内未签到的日期，每次消耗1张补签卡
                </p>
                <button class="btn btn-warning btn-block" onclick="buyMakeupCard()">购买补签卡 (50贡献点)</button>
            </div>
            
            <div class="card" style="margin-top: 16px;">
                <div class="section-title">连续签到奖励</div>
                ${(status.rewards || []).slice(0, 7).map((r: any) => `
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
                        <span>连续 ${r.continuous_days} 天</span>
                        <span style="color: #f59e0b; font-weight: 600;">+${r.reward_points}</span>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (e) {
        contentBody.innerHTML = `<div class="empty-state"><h3>加载失败</h3></div>`;
    }
}

async function doCheckin() {
    try {
        const result = await fetchAPI<{ rewardPoints: number; continuousDays: number }>('/checkin/checkin', { method: 'POST' });
        showToast(`签到成功！获得 ${result.rewardPoints} 贡献点`);
        showCheckinPage();
    } catch (e: any) {
        showToast(e.message || '签到失败', 'error');
    }
}

async function buyMakeupCard() {
    try {
        await fetchAPI('/checkin/buy-makeup-card', {
            method: 'POST',
            body: JSON.stringify({ quantity: 1 })
        });
        showToast('购买成功');
        showCheckinPage();
    } catch (e: any) {
        showToast(e.message || '购买失败', 'error');
    }
}

async function togglePinPost(postId: number, isPinned: number) {
    try {
        await fetchAPI(`/admin/posts/${postId}/pin`, {
            method: 'PUT',
            body: JSON.stringify({ isPinned: !!isPinned })
        });
        showToast(isPinned ? '置顶成功' : '取消置顶成功', 'success');
        showAdminPage();
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

async function deletePost(postId: number) {
    if (!confirm('确定要删除这篇帖子吗？')) return;
    
    try {
        await fetchAPI(`/posts/${postId}`, {
            method: 'DELETE'
        });
        showToast('删除成功', 'success');
        showAdminPage();
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

async function deleteAnnouncement(announcementId: number) {
    if (!confirm('确定要删除这条公告吗？')) return;
    
    try {
        await fetchAPI(`/admin/announcements/${announcementId}`, {
            method: 'DELETE'
        });
        showToast('删除成功', 'success');
        showAdminPage();
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

async function setUserLevel(userId: number, level: string) {
    try {
        await fetchAPI(`/admin/users/${userId}/level`, {
            method: 'PUT',
            body: JSON.stringify({ level: parseInt(level) })
        });
        showToast('等级设置成功', 'success');
        showAdminPage();
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

function handleLogout() {
    state.token = null;
    state.currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    updateUserUI();
    showToast('已退出登录', 'success');
    navigateTo('home');
}

async function handleLike(postId: number) {
    if (!state.currentUser) {
        showToast('请先登录', 'error');
        showLoginModal();
        return;
    }
    
    if (!checkEmailVerified()) return;
    
    try {
        const result = await fetchAPI<{ liked: boolean }>(`/posts/${postId}/like`, {
            method: 'POST'
        });
        
        showToast(result.liked ? '点赞成功' : '已取消点赞', 'success');
        showPostDetail(postId);
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

// 检查邮箱验证状态
function checkEmailVerified(): boolean {
    if (!state.currentUser) return false;
    if (!state.currentUser.email_verified) {
        showEmailVerifyModal();
        return false;
    }
    return true;
}

// 显示邮箱验证弹窗
function showEmailVerifyModal() {
    const contentBody = $('content-body');
    if (!contentBody) return;
    
    const modal = document.createElement('div');
    modal.className = 'email-verify-modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-content" style="max-width: 420px;">
            <div class="modal-header">
                <h3 class="modal-title">
                    <svg viewBox="0 0 24 24" width="24" height="24" style="color: #f59e0b; margin-right: 8px;">
                        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                    请验证您的邮箱
                </h3>
                <button class="modal-close" id="email-verify-close" type="button">×</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 16px;">您的账号尚未验证邮箱，部分功能将受到限制：</p>
                <ul style="margin-bottom: 16px; padding-left: 20px; color: var(--text-secondary);">
                    <li>无法发表评论</li>
                    <li>无法发布内容</li>
                    <li>无法点赞</li>
                </ul>
                <p style="color: var(--text-secondary); font-size: 14px;">请前往编辑资料页面绑定邮箱以解锁全部功能。</p>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="email-verify-later" type="button">稍后再说</button>
                <button class="btn-primary" id="email-verify-now" type="button">去验证</button>
            </div>
        </div>
    `;
    
    contentBody.appendChild(modal);
    
    const closeModal = () => modal.remove();
    
    modal.querySelector('#email-verify-close')?.addEventListener('click', closeModal);
    modal.querySelector('#email-verify-later')?.addEventListener('click', closeModal);
    modal.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
    modal.querySelector('#email-verify-now')?.addEventListener('click', () => {
        closeModal();
        if (state.currentUser) {
            showEditProfileModal(state.currentUser);
        }
    });
}

// 显示回复表单
// @ts-ignore - used in HTML onclick
function showReplyForm(commentId: number, authorName: string) {
    // 先隐藏所有回复表单
    document.querySelectorAll('.reply-form-container').forEach(el => {
        (el as HTMLElement).style.display = 'none';
    });
    
    const form = $(`reply-form-${commentId}`);
    if (form) {
        form.style.display = 'block';
        const input = $(`reply-input-${commentId}`) as HTMLTextAreaElement;
        if (input) {
            input.focus();
            input.placeholder = `回复 ${authorName}...`;
        }
    }
}

// 隐藏回复表单
// @ts-ignore - used in HTML onclick
function hideReplyForm(commentId: number) {
    const form = $(`reply-form-${commentId}`);
    if (form) {
        form.style.display = 'none';
        const input = $(`reply-input-${commentId}`) as HTMLTextAreaElement;
        if (input) input.value = '';
    }
}

// 提交回复
// @ts-ignore - used in HTML onclick
async function submitReply(parentId: number) {
    if (!checkEmailVerified()) return;
    
    const input = $(`reply-input-${parentId}`) as HTMLTextAreaElement;
    if (!input) return;
    
    const content = input.value.trim();
    if (!content) {
        showToast('请输入回复内容', 'error');
        return;
    }
    
    if (!state.currentPostId) return;
    
    try {
        await fetchAPI(`/posts/${state.currentPostId}/comments`, {
            method: 'POST',
            body: JSON.stringify({ content, parentId })
        });
        
        showToast('回复成功', 'success');
        showPostDetail(state.currentPostId);
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

async function handleSubmitComment(postId: number) {
    if (!checkEmailVerified()) return;
    
    const input = $('comment-input') as HTMLTextAreaElement;
    if (!input) return;
    
    const content = input.value.trim();
    if (!content) {
        showToast('请输入评论内容', 'error');
        return;
    }
    
    try {
        await fetchAPI(`/posts/${postId}/comments`, {
            method: 'POST',
            body: JSON.stringify({ content })
        });
        
        showToast('评论成功', 'success');
        showPostDetail(postId);
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

function handleShare(post: Post) {
    const shareText = `【${post.title}】https://xuanjian.top/post/${post.id}`;
    
    if (navigator.share) {
        navigator.share({
            title: post.title,
            text: shareText,
            url: `https://xuanjian.top/post/${post.id}`
        }).catch(() => {
            copyToClipboard(shareText);
        });
    } else {
        copyToClipboard(shareText);
    }
}

function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('链接已复制到剪贴板', 'success');
    }).catch(() => {
        showToast('复制失败', 'error');
    });
}

function showEditorPage(postId?: number) {
    const contentBody = $('content-body');
    const titleEl = $('page-title') as HTMLElement;
    
    if (!contentBody) return;
    if (titleEl) titleEl.textContent = postId ? '编辑帖子' : '发布内容';
    
    state.editingPostId = postId || null;
    state.uploadedImages = [];
    state.currentPage = 'editor';
    
    contentBody.innerHTML = `
        <div class="editor-page">
            <button class="back-btn" id="editor-back-btn" type="button">
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                </svg>
                返回
            </button>
            
            <div class="form-group">
                <label>标题</label>
                <input type="text" id="editor-post-title" placeholder="请输入标题">
            </div>
            
            <div class="form-group">
                <label>类型</label>
                <select id="editor-post-type" class="form-select">
                    <option value="forum">贴吧</option>
                    <option value="daily">日报</option>
                    <option value="decision">决策</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>内容</label>
                <div id="rich-editor-container"></div>
                <textarea id="editor-post-content" style="display:none;"></textarea>
            </div>
            
            <div class="form-group">
                <label>图片</label>
                <div class="image-upload-area" id="image-upload-area">
                    <input type="file" id="image-upload-input" accept="image/*" multiple style="display:none;">
                    <div class="image-upload-btn" id="image-upload-btn">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                        </svg>
                        <span>上传图片</span>
                    </div>
                </div>
                <div class="image-preview-list" id="image-preview-list"></div>
            </div>
            
            <div class="form-group">
                <label>标签（用逗号分隔）</label>
                <input type="text" id="editor-post-tags" placeholder="例如: 公告, 活动">
            </div>
            
            <input type="hidden" id="editor-post-id">
            
            <div class="editor-actions">
                <button class="btn-secondary" id="editor-cancel-btn" type="button">取消</button>
                <button class="btn-primary" id="editor-submit-btn" type="button">发布</button>
            </div>
        </div>
    `;
    
    const backBtn = $('editor-back-btn');
    const cancelBtn = $('editor-cancel-btn');
    if (backBtn) backBtn.addEventListener('click', () => navigateTo('home'));
    if (cancelBtn) cancelBtn.addEventListener('click', () => navigateTo('home'));
    
    const submitBtn = $('editor-submit-btn');
    if (submitBtn) submitBtn.addEventListener('click', handleEditorSubmit);
    
    // 初始化富文本编辑器
    if (richEditor) {
        richEditor.destroy();
    }
    richEditor = new RichEditor('rich-editor-container');
    
    const imageUploadBtn = $('image-upload-btn');
    const imageUploadInput = $('image-upload-input') as HTMLInputElement;
    if (imageUploadBtn && imageUploadInput) {
        imageUploadBtn.addEventListener('click', () => imageUploadInput.click());
        imageUploadInput.addEventListener('change', () => {
            if (imageUploadInput.files && imageUploadInput.files.length > 0) {
                handleImageUpload(imageUploadInput.files);
            }
        });
    }
    
    if (postId) {
        fetchAPI<{ post: Post }>(`/posts/${postId}`).then(data => {
            const post = data.post;
            ($('editor-post-title') as HTMLInputElement).value = post.title || '';
            ($('editor-post-type') as HTMLSelectElement).value = post.type || 'forum';
            ($('editor-post-tags') as HTMLInputElement).value = post.tags || '';
            ($('editor-post-id') as HTMLInputElement).value = postId.toString();
            
            // 设置富文本编辑器内容
            if (richEditor && post.content) {
                richEditor.setContent(post.content);
            }
            
            if (post.images && post.images.length > 0) {
                state.uploadedImages = post.images;
                renderImagePreviews();
            }
            
            if (submitBtn) submitBtn.textContent = '保存修改';
        }).catch(err => {
            showToast(err.message, 'error');
        });
    }
}

function renderImagePreviews() {
    const previewList = $('image-preview-list');
    if (!previewList) return;
    
    previewList.innerHTML = state.uploadedImages.map((img, index) => `
        <div class="image-preview-item">
            <img src="${getImageUrl(img)}" alt="">
            <button class="image-preview-remove" onclick="window.removeImage(${index})" type="button">×</button>
        </div>
    `).join('');
}

function removeImage(index: number) {
    state.uploadedImages.splice(index, 1);
    renderImagePreviews();
}

async function handleImageUpload(files: FileList) {
    const formData = new FormData();
    
    for (let i = 0; i < files.length; i++) {
        formData.append('images', files[i]);
    }
    
    try {
        const response = await fetch(`${API_BASE}/upload/images`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.token}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '上传失败');
        }
        
        const imageUrls = data.urls || data.paths || [];
        state.uploadedImages.push(...imageUrls);
        renderImagePreviews();
        showToast('图片上传成功', 'success');
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

function insertFormat(format: string) {
    const textarea = $('editor-post-content') as HTMLTextAreaElement;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    
    let insert = '';
    switch (format) {
        case 'bold':
            insert = `<strong>${selected || '粗体文字'}</strong>`;
            break;
        case 'italic':
            insert = `<em>${selected || '斜体文字'}</em>`;
            break;
        case 'heading':
            insert = `<h3>${selected || '标题'}</h3>`;
            break;
        case 'link':
            insert = `<a href="${selected || 'https://'}">${selected || '链接文字'}</a>`;
            break;
        case 'list':
            insert = `<ul>\n<li>${selected || '列表项'}</li>\n</ul>`;
            break;
    }
    
    textarea.value = text.substring(0, start) + insert + text.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + insert.length;
}

function hideEditorModal() {
    const modal = $('editor-modal');
    if (modal) modal.classList.remove('active');
    state.editingPostId = null;
}

async function handleEditorSubmit() {
    const title = ($('editor-post-title') as HTMLInputElement)?.value.trim();
    const type = ($('editor-post-type') as HTMLSelectElement)?.value;
    const tags = ($('editor-post-tags') as HTMLInputElement)?.value.trim();
    const postId = ($('editor-post-id') as HTMLInputElement)?.value;
    
    // 从富文本编辑器获取内容
    const content = richEditor?.getContent().trim() || '';
    
    if (!title || !content) {
        showToast('标题和内容不能为空', 'error');
        return;
    }
    
    try {
        if (postId) {
            await fetchAPI(`/posts/${postId}`, {
                method: 'PUT',
                body: JSON.stringify({ title, content, tags, images: state.uploadedImages })
            });
            showToast('更新成功', 'success');
        } else {
            await fetchAPI('/posts', {
                method: 'POST',
                body: JSON.stringify({ title, content, type, tags, images: state.uploadedImages })
            });
            showToast('发布成功', 'success');
        }
        
        hideEditorModal();
        navigateTo(state.currentPage);
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

function editPost(postId: number) {
    showEditorPage(postId);
}

async function loadPopupAnnouncement() {
    try {
        const announcement = await fetchAPI<Announcement | null>('/announcements/popup');
        
        if (announcement) {
            const modal = $('announcement-modal');
            const titleEl = $('announcement-title');
            const bodyEl = $('announcement-body');
            
            if (modal && titleEl && bodyEl) {
                titleEl.textContent = announcement.title;
                bodyEl.innerHTML = `<div style="line-height: 1.8;">${announcement.content}</div>`;
                modal.classList.add('active');
            }
        }
    } catch (error) {
        console.error('Load announcement error:', error);
    }
}

function hideAnnouncementModal() {
    const modal = $('announcement-modal');
    if (modal) modal.classList.remove('active');
}

async function navigateTo(page: string) {
    if (state.isLoading) return;
    state.isLoading = true;
    
    state.currentPage = page;
    state.currentPostId = null;
    
    const titleEl = $('page-title') as HTMLElement;
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-page') === page);
    });
    
    if (titleEl) {
        const titles: Record<string, string> = {
            home: '首页',
            daily: '日报',
            decision: '决策',
            forum: '贴吧',
            search: '搜索',
            notifications: '通知中心',
            admin: '管理后台',
            stock: '虚拟股票',
            checkin: '每日签到'
        };
        titleEl.textContent = titles[page] || '首页';
    }

    switch (page) {
        case 'home':
            await loadPosts();
            break;
        case 'daily':
            await loadPosts('daily');
            break;
        case 'decision':
            await loadPosts('decision');
            break;
        case 'forum':
            await loadPosts('forum');
            break;
        case 'search':
            showSearchPage();
            break;
        case 'notifications':
            await showNotificationsPage();
            break;
        case 'admin':
            await showAdminPage();
            break;
        case 'stock':
            await showStockPage();
            break;
        case 'checkin':
            await showCheckinPage();
            break;
        default:
            await loadPosts();
    }
    
    state.isLoading = false;
}

function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

function updateUserUI() {
    const userAvatar = $('user-avatar') as HTMLImageElement;
    const avatarPlaceholder = $('avatar-placeholder');
    const userDisplayName = $('user-display-name');
    const userHandle = $('user-handle');
    const navAdmin = $('nav-admin');
    
    if (state.currentUser) {
        const avatarUrl = getAvatarUrl(state.currentUser.avatar);
        
        if (userAvatar && avatarUrl) {
            userAvatar.src = avatarUrl;
            userAvatar.style.display = 'block';
            if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
        } else if (avatarPlaceholder) {
            avatarPlaceholder.innerHTML = getInitial(state.currentUser.nickname);
            avatarPlaceholder.style.display = 'flex';
            if (userAvatar) userAvatar.style.display = 'none';
        }
        
        if (userDisplayName) userDisplayName.textContent = state.currentUser.nickname;
        if (userHandle) userHandle.textContent = `@${state.currentUser.username}`;
        
        if (navAdmin && state.currentUser.level >= 1) {
            (navAdmin as HTMLElement).style.display = 'flex';
        }
    } else {
        if (userAvatar) userAvatar.style.display = 'none';
        if (avatarPlaceholder) {
            avatarPlaceholder.innerHTML = `
                <svg viewBox="0 0 24 24" width="24" height="24">
                    <path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
            `;
            avatarPlaceholder.style.display = 'flex';
        }
        if (userDisplayName) userDisplayName.textContent = '未登录';
        if (userHandle) userHandle.textContent = '@guest';
        if (navAdmin) (navAdmin as HTMLElement).style.display = 'none';
    }
}

// 刷新用户信息（同步邮箱验证状态）
async function refreshUserInfo() {
    if (!state.token) return;

    try {
        const user = await fetchAPI<User>('/auth/me');
        state.currentUser = user;
        localStorage.setItem('user', JSON.stringify(user));
        updateUserUI();
    } catch (error) {
        // 如果刷新失败，可能是token过期
        console.error('刷新用户信息失败:', error);
    }
}

// 加载未读通知数量
async function loadUnreadNotificationCount() {
    if (!state.token) {
        const badge = $('sidebar-notification-badge');
        if (badge) badge.style.display = 'none';
        return;
    }

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
    } catch (error) {
        // 静默失败
    }
}

// 显示通知页面
async function showNotificationsPage() {
    const contentBody = $('content-body');
    if (!contentBody) return;

    if (!state.currentUser) {
        showToast('请先登录', 'error');
        showLoginModal();
        return;
    }

    contentBody.innerHTML = '<div class="loading-spinner"></div>';

    try {
        const data = await fetchAPI<{ notifications: any[], unreadCount: number }>('/notifications');

        let notificationsHtml = '';
        if (data.notifications.length === 0) {
            notificationsHtml = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" style="margin-bottom: 16px; opacity: 0.5;">
                        <path fill="currentColor" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                    </svg>
                    <p>暂无通知</p>
                </div>
            `;
        } else {
            notificationsHtml = `
                <div class="notifications-list">
                    ${data.notifications.map(n => renderNotificationItem(n)).join('')}
                </div>
            `;
        }

        contentBody.innerHTML = `
            <div class="notifications-page">
                <div class="notifications-header">
                    <h2>通知中心 ${data.unreadCount > 0 ? `<span class="unread-badge">${data.unreadCount}条未读</span>` : ''}</h2>
                    ${data.unreadCount > 0 ? `<button class="btn btn-secondary btn-sm" id="mark-all-read">全部已读</button>` : ''}
                </div>
                ${notificationsHtml}
            </div>
        `;

        // 绑定事件
        if (data.unreadCount > 0) {
            $('mark-all-read')?.addEventListener('click', async () => {
                try {
                    await fetchAPI('/notifications/read-all', { method: 'PUT' });
                    showToast('已全部标记为已读', 'success');
                    loadUnreadNotificationCount();
                    showNotificationsPage();
                } catch (error) {
                    showToast('操作失败', 'error');
                }
            });
        }

        document.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (!(e.target as HTMLElement).closest('.notification-actions')) {
                    const id = (item as HTMLElement).dataset.id;
                    const postId = (item as HTMLElement).dataset.postId;
                    if (id) {
                        await fetchAPI(`/notifications/${id}/read`, { method: 'PUT' });
                        loadUnreadNotificationCount();
                    }
                    if (postId) {
                        showPostDetail(parseInt(postId));
                    }
                }
            });
        });

        document.querySelectorAll('.mark-read-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = (btn as HTMLElement).dataset.id;
                if (id) {
                    await fetchAPI(`/notifications/${id}/read`, { method: 'PUT' });
                    loadUnreadNotificationCount();
                    showNotificationsPage();
                }
            });
        });

        document.querySelectorAll('.delete-notification-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = (btn as HTMLElement).dataset.id;
                if (id && confirm('确定要删除这条通知吗？')) {
                    await fetchAPI(`/notifications/${id}`, { method: 'DELETE' });
                    loadUnreadNotificationCount();
                    showNotificationsPage();
                }
            });
        });

    } catch (error) {
        contentBody.innerHTML = `
            <div class="empty-state">
                <p>加载失败: ${(error as Error).message}</p>
            </div>
        `;
    }
}

// 渲染通知项
function renderNotificationItem(n: any): string {
    const typeIcons: Record<string, string> = {
        'post_daily': '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>',
        'post_decision': '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
        'comment': '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>',
        'like': '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
    };

    const typeColors: Record<string, string> = {
        'post_daily': '#3b82f6',
        'post_decision': '#8b5cf6',
        'comment': '#10b981',
        'like': '#ef4444'
    };

    const isRead = n.is_read === 1;

    return `
        <div class="notification-item ${isRead ? 'read' : 'unread'}" data-id="${n.id}" data-post-id="${n.post_id || ''}">
            <div class="notification-icon" style="background: ${typeColors[n.type]}20; color: ${typeColors[n.type]};">
                ${typeIcons[n.type] || ''}
            </div>
            <div class="notification-content">
                <div class="notification-title">${n.title}</div>
                <div class="notification-text">${n.content || n.post_title || ''}</div>
                <div class="notification-meta">
                    <span>${formatDate(n.created_at)}</span>
                    ${n.actor_nickname ? `<span>by ${n.actor_nickname}</span>` : ''}
                </div>
            </div>
            <div class="notification-actions">
                ${!isRead ? `<button class="btn btn-sm btn-secondary mark-read-btn" data-id="${n.id}">已读</button>` : ''}
                <button class="btn btn-sm btn-danger delete-notification-btn" data-id="${n.id}">删除</button>
            </div>
        </div>
    `;
}

function showLoginModal() {
    const modal = $('login-modal');
    if (modal) modal.classList.add('active');
}

function hideLoginModal() {
    const modal = $('login-modal');
    if (modal) modal.classList.remove('active');
}

function showRegisterModal() {
    const modal = $('register-modal');
    if (modal) modal.classList.add('active');
}

function hideRegisterModal() {
    const modal = $('register-modal');
    if (modal) modal.classList.remove('active');
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
        showToast('登录成功', 'success');
        
        if (state.currentPostId) {
            showPostDetail(state.currentPostId);
        }
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

let registerCodeCountdown = 0;

async function sendRegisterCode() {
    const email = ($('register-email') as HTMLInputElement)?.value.trim();
    const sendBtn = $('send-code-btn') as HTMLButtonElement;

    if (!email) {
        showToast('请先输入邮箱地址', 'error');
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast('邮箱格式不正确', 'error');
        return;
    }

    try {
        sendBtn.disabled = true;
        await fetchAPI('/auth/send-code', {
            method: 'POST',
            body: JSON.stringify({ email, type: 'register' })
        });

        // 开始倒计时
        registerCodeCountdown = 60;
        sendBtn.textContent = `${registerCodeCountdown}秒后重试`;
        const timer = setInterval(() => {
            registerCodeCountdown--;
            if (registerCodeCountdown <= 0) {
                clearInterval(timer);
                sendBtn.disabled = false;
                sendBtn.textContent = '获取验证码';
            } else {
                sendBtn.textContent = `${registerCodeCountdown}秒后重试`;
            }
        }, 1000);

        showToast('验证码已发送，请查收邮件', 'success');
    } catch (error) {
        sendBtn.disabled = false;
        showToast((error as Error).message, 'error');
    }
}

async function handleRegister() {
    const username = ($('register-username') as HTMLInputElement)?.value.trim();
    const nickname = ($('register-nickname') as HTMLInputElement)?.value.trim();
    const email = ($('register-email') as HTMLInputElement)?.value.trim();
    const verificationCode = ($('register-code') as HTMLInputElement)?.value.trim();
    const password = ($('register-password') as HTMLInputElement)?.value;
    const confirm = ($('register-confirm') as HTMLInputElement)?.value;

    if (!username || !nickname || !email || !verificationCode || !password || !confirm) {
        showToast('请填写所有字段', 'error');
        return;
    }

    if (password !== confirm) {
        showToast('两次密码不一致', 'error');
        return;
    }

    if (password.length < 6) {
        showToast('密码至少6位', 'error');
        return;
    }

    try {
        await fetchAPI('/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                username,
                nickname,
                email,
                verificationCode,
                password
            })
        });

        hideRegisterModal();
        showLoginModal();
        showToast('注册成功，请登录', 'success');
    } catch (error) {
        showToast((error as Error).message, 'error');
    }
}

function previewImage(src: string) {
    const modal = $('image-modal');
    const preview = $('image-preview') as HTMLImageElement;
    
    if (modal && preview) {
        preview.src = src;
        modal.classList.add('active');
    }
}

function hideImageModal() {
    const modal = $('image-modal');
    if (modal) modal.classList.remove('active');
}

function initApp() {
    console.log('App initialized');
    
    initTitlebar();
    initTheme();
    
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    
    if (savedToken && savedUser) {
        try {
            state.token = savedToken;
            state.currentUser = JSON.parse(savedUser);
            // 刷新用户信息以同步邮箱验证状态
            refreshUserInfo();
        } catch {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        }
    }

    updateUserUI();
    loadUnreadNotificationCount();
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.getAttribute('data-page');
            if (page) navigateTo(page);
        });
    });
    
    const themeToggle = $('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    const refreshBtn = $('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (state.currentPostId) {
                showPostDetail(state.currentPostId);
            } else {
                navigateTo(state.currentPage);
            }
        });
    }
    
    const userCard = $('user-card');
    if (userCard) {
        userCard.addEventListener('click', () => {
            if (state.currentUser) {
                showProfile(state.currentUser.username);
            } else {
                showLoginModal();
            }
        });
    }
    
    const writeBtn = $('write-btn');
    if (writeBtn) {
        writeBtn.addEventListener('click', () => {
            if (state.currentUser) {
                showEditorPage();
            } else {
                showToast('请先登录', 'error');
                showLoginModal();
            }
        });
    }
    
    const loginClose = $('login-close');
    if (loginClose) {
        loginClose.addEventListener('click', hideLoginModal);
    }
    
    const registerClose = $('register-close');
    if (registerClose) {
        registerClose.addEventListener('click', hideRegisterModal);
    }
    
    const loginSubmit = $('login-submit');
    if (loginSubmit) {
        loginSubmit.addEventListener('click', handleLogin);
    }
    
    const registerSubmit = $('register-submit');
    if (registerSubmit) {
        registerSubmit.addEventListener('click', handleRegister);
    }

    const sendCodeBtn = $('send-code-btn');
    if (sendCodeBtn) {
        sendCodeBtn.addEventListener('click', sendRegisterCode);
    }

    const goRegister = $('go-register');
    if (goRegister) {
        goRegister.addEventListener('click', (e) => {
            e.preventDefault();
            hideLoginModal();
            showRegisterModal();
        });
    }
    
    const goLogin = $('go-login');
    if (goLogin) {
        goLogin.addEventListener('click', (e) => {
            e.preventDefault();
            hideRegisterModal();
            showLoginModal();
        });
    }
    
    const loginModal = $('login-modal');
    if (loginModal) {
        loginModal.querySelector('.modal-backdrop')?.addEventListener('click', hideLoginModal);
    }
    
    const registerModal = $('register-modal');
    if (registerModal) {
        registerModal.querySelector('.modal-backdrop')?.addEventListener('click', hideRegisterModal);
    }
    
    const announcementClose = $('announcement-close');
    if (announcementClose) {
        announcementClose.addEventListener('click', hideAnnouncementModal);
    }
    
    const announcementModal = $('announcement-modal');
    if (announcementModal) {
        announcementModal.querySelector('.modal-backdrop')?.addEventListener('click', hideAnnouncementModal);
    }
    
    const imageModal = $('image-modal');
    if (imageModal) {
        imageModal.addEventListener('click', hideImageModal);
    }
    
    (window as any).showLoginModal = showLoginModal;
    (window as any).showProfile = showProfile;
    (window as any).previewImage = previewImage;
    (window as any).editPost = editPost;
    (window as any).togglePinPost = togglePinPost;
    (window as any).deletePost = deletePost;
    (window as any).deleteAnnouncement = deleteAnnouncement;
    (window as any).setUserLevel = setUserLevel;
    (window as any).removeImage = removeImage;
    (window as any).insertFormat = insertFormat;
    (window as any).showStockPage = showStockPage;
    (window as any).showCheckinPage = showCheckinPage;
    (window as any).doCheckin = doCheckin;
    (window as any).buyMakeupCard = buyMakeupCard;

    // 定时刷新未读通知数（每30秒）
    setInterval(loadUnreadNotificationCount, 30000);

    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F12' || 
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
            (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.key === 'S' || e.key === 's'))) {
            e.preventDefault();
            return false;
        }
    });
    
    navigateTo('home');
    loadPopupAnnouncement();
    
    // 初始化自动更新检查（每24小时检查一次）
    initAutoUpdateCheck(24);
}

document.addEventListener('DOMContentLoaded', initApp);
