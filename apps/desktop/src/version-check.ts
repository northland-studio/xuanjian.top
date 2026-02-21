// 版本更新检测模块
import { API_BASE, STATIC_BASE } from './config';

// 当前应用版本（从 package.json 或 tauri.conf.json 同步）
export const APP_VERSION = '2.0.5';

export interface VersionInfo {
    version: string;
    downloadUrl?: string;
    releaseNotes?: string;
    forceUpdate?: boolean;
}

// 检查更新 - 优先从 version.json 获取，失败则尝试 /version API
export async function checkForUpdate(): Promise<VersionInfo | null> {
    // 首先尝试从静态文件获取版本信息
    try {
        const response = await fetch(`${STATIC_BASE}/version.json?v=${Date.now()}`, {
            method: 'GET',
            cache: 'no-cache'
        });

        if (response.ok) {
            const data: VersionInfo = await response.json();
            
            // 比较版本号
            if (isNewerVersion(data.version, APP_VERSION)) {
                return data;
            }
            return null;
        }
    } catch (error) {
        console.log('Failed to fetch version.json, trying API...');
    }

    // 如果静态文件获取失败，尝试 API 接口
    try {
        const response = await fetch(`${API_BASE}/version`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log('Version check failed:', response.status);
            return null;
        }

        const data: VersionInfo = await response.json();
        
        // 比较版本号
        if (isNewerVersion(data.version, APP_VERSION)) {
            return data;
        }
        
        return null;
    } catch (error) {
        console.error('Check update error:', error);
        return null;
    }
}

// 比较版本号 (返回 true 如果 remote > local)
function isNewerVersion(remote: string, local: string): boolean {
    const remoteParts = remote.split('.').map(Number);
    const localParts = local.split('.').map(Number);
    
    const maxLength = Math.max(remoteParts.length, localParts.length);
    
    for (let i = 0; i < maxLength; i++) {
        const remotePart = remoteParts[i] || 0;
        const localPart = localParts[i] || 0;
        
        if (remotePart > localPart) return true;
        if (remotePart < localPart) return false;
    }
    
    return false; // 版本相同
}

// 显示更新提示
export function showUpdateNotification(versionInfo: VersionInfo, onUpdate: () => void, onLater?: () => void) {
    // 创建更新提示弹窗
    const modal = document.createElement('div');
    modal.className = 'update-modal active';
    modal.innerHTML = `
        <div class="update-modal-backdrop"></div>
        <div class="update-modal-content">
            <div class="update-modal-header">
                <h3 class="update-modal-title">
                    <svg viewBox="0 0 24 24" width="24" height="24">
                        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                    发现新版本
                </h3>
            </div>
            <div class="update-modal-body">
                <p class="update-version">当前版本: ${APP_VERSION} → 最新版本: ${versionInfo.version}</p>
                ${versionInfo.releaseNotes ? `
                    <div class="update-notes">
                        <h4>更新内容:</h4>
                        <div class="update-notes-content">${versionInfo.releaseNotes}</div>
                    </div>
                ` : ''}
            </div>
            <div class="update-modal-footer">
                ${!versionInfo.forceUpdate && onLater ? `
                    <button class="btn-secondary" id="update-later-btn">稍后提醒</button>
                ` : ''}
                <button class="btn-primary" id="update-now-btn">立即更新</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 绑定事件
    const updateNowBtn = modal.querySelector('#update-now-btn');
    const updateLaterBtn = modal.querySelector('#update-later-btn');
    const backdrop = modal.querySelector('.update-modal-backdrop');
    
    const closeModal = () => {
        modal.remove();
    };
    
    updateNowBtn?.addEventListener('click', () => {
        closeModal();
        onUpdate();
    });
    
    updateLaterBtn?.addEventListener('click', () => {
        closeModal();
        onLater?.();
    });
    
    backdrop?.addEventListener('click', () => {
        if (!versionInfo.forceUpdate) {
            closeModal();
            onLater?.();
        }
    });
}

// 下载并安装更新
export async function downloadUpdate(downloadUrl: string): Promise<void> {
    try {
        // 使用 Tauri 的 shell API 打开下载链接
        const opener = await import('@tauri-apps/plugin-opener');
        await opener.openUrl(downloadUrl);
    } catch (error) {
        // 降级方案：使用浏览器打开
        window.open(downloadUrl, '_blank');
    }
}

// 初始化自动更新检查
export function initAutoUpdateCheck(checkIntervalHours: number = 24) {
    // 应用启动时检查一次
    setTimeout(() => {
        performUpdateCheck();
    }, 5000); // 延迟5秒，避免影响启动速度
    
    // 定期检查
    const intervalMs = checkIntervalHours * 60 * 60 * 1000;
    setInterval(() => {
        performUpdateCheck();
    }, intervalMs);
}

// 执行更新检查
async function performUpdateCheck() {
    const updateInfo = await checkForUpdate();
    
    if (updateInfo) {
        showUpdateNotification(
            updateInfo,
            () => {
                // 立即更新
                if (updateInfo.downloadUrl) {
                    downloadUpdate(updateInfo.downloadUrl);
                }
            },
            () => {
                // 稍后提醒 - 可以记录到本地存储
                console.log('User chose to update later');
            }
        );
    }
}

// 手动检查更新（用于菜单中的"检查更新"按钮）
export async function manualCheckForUpdate(showNoUpdateMessage: boolean = true): Promise<void> {
    const updateInfo = await checkForUpdate();
    
    if (updateInfo) {
        showUpdateNotification(
            updateInfo,
            () => {
                if (updateInfo.downloadUrl) {
                    downloadUpdate(updateInfo.downloadUrl);
                }
            },
            () => {
                console.log('User chose to update later');
            }
        );
    } else if (showNoUpdateMessage) {
        // 显示已是最新版本
        showNoUpdateToast();
    }
}

// 显示已是最新版本的提示
function showNoUpdateToast() {
    // 使用应用中的 toast 系统或创建临时提示
    const toast = document.createElement('div');
    toast.className = 'toast toast-success';
    toast.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        <span>当前已是最新版本 (${APP_VERSION})</span>
    `;
    
    document.body.appendChild(toast);
    
    // 动画显示
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    // 3秒后移除
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
