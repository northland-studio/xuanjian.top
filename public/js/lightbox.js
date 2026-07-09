// 图片查看器 (Lightbox) - 支持缩放和拖拽
class Lightbox {
    constructor() {
        this.images = [];
        this.currentIndex = 0;
        this.overlay = null;
        this.imageEl = null;
        this.counterEl = null;
        this.prevBtn = null;
        this.nextBtn = null;
        this.loadingEl = null;
        
        // 缩放相关
        this.scale = 1;
        this.minScale = 0.5;
        this.maxScale = 5;
        this.translateX = 0;
        this.translateY = 0;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        
        this.init();
    }

    init() {
        this.createOverlay();
        this.bindEvents();
    }

    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'lightbox-overlay';
        this.overlay.innerHTML = `
            <button class="lightbox-close" aria-label="关闭">✕</button>
            <button class="lightbox-nav lightbox-prev" aria-label="上一张">‹</button>
            <button class="lightbox-nav lightbox-next" aria-label="下一张">›</button>
            <div class="lightbox-toolbar">
                <button class="lightbox-zoom-btn lightbox-zoom-out" aria-label="缩小">−</button>
                <span class="lightbox-zoom-level">100%</span>
                <button class="lightbox-zoom-btn lightbox-zoom-in" aria-label="放大">+</button>
                <button class="lightbox-zoom-btn lightbox-zoom-reset" aria-label="重置">⟲</button>
            </div>
            <div class="lightbox-content">
                <div class="lightbox-loading"></div>
                <img class="lightbox-image" src="" alt="" draggable="false">
            </div>
            <div class="lightbox-counter"></div>
        `;
        document.body.appendChild(this.overlay);

        this.imageEl = this.overlay.querySelector('.lightbox-image');
        this.counterEl = this.overlay.querySelector('.lightbox-counter');
        this.prevBtn = this.overlay.querySelector('.lightbox-prev');
        this.nextBtn = this.overlay.querySelector('.lightbox-next');
        this.loadingEl = this.overlay.querySelector('.lightbox-loading');
        this.zoomLevelEl = this.overlay.querySelector('.lightbox-zoom-level');
        this.zoomInBtn = this.overlay.querySelector('.lightbox-zoom-in');
        this.zoomOutBtn = this.overlay.querySelector('.lightbox-zoom-out');
        this.zoomResetBtn = this.overlay.querySelector('.lightbox-zoom-reset');
    }

    bindEvents() {
        // 关闭按钮
        this.overlay.querySelector('.lightbox-close').addEventListener('click', () => this.close());
        
        // 点击遮罩关闭（仅在未缩放时）
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay && this.scale === 1) this.close();
        });

        // 导航按钮
        this.prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prev();
        });
        this.nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.next();
        });

        // 缩放按钮
        this.zoomInBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.zoomIn();
        });
        this.zoomOutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.zoomOut();
        });
        this.zoomResetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.resetZoom();
        });

        // 键盘事件
        document.addEventListener('keydown', (e) => {
            if (!this.overlay.classList.contains('active')) return;
            
            switch (e.key) {
                case 'Escape':
                    this.close();
                    break;
                case 'ArrowLeft':
                    this.prev();
                    break;
                case 'ArrowRight':
                    this.next();
                    break;
                case '+':
                case '=':
                    this.zoomIn();
                    break;
                case '-':
                    this.zoomOut();
                    break;
                case '0':
                    this.resetZoom();
                    break;
            }
        });

        // 鼠标滚轮缩放
        this.overlay.addEventListener('wheel', (e) => {
            if (!this.overlay.classList.contains('active')) return;
            e.preventDefault();
            
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.setScale(this.scale + delta);
        }, { passive: false });

        // 双击放大/缩小
        this.imageEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (this.scale > 1) {
                this.resetZoom();
            } else {
                this.setScale(2);
            }
        });

        // 拖拽开始
        this.imageEl.addEventListener('mousedown', (e) => {
            if (this.scale > 1) {
                e.preventDefault();
                this.isDragging = true;
                this.dragStartX = e.clientX - this.translateX;
                this.dragStartY = e.clientY - this.translateY;
                this.imageEl.style.cursor = 'grabbing';
            }
        });

        // 拖拽移动
        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            this.translateX = e.clientX - this.dragStartX;
            this.translateY = e.clientY - this.dragStartY;
            this.updateTransform();
        });

        // 拖拽结束
        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.imageEl.style.cursor = this.scale > 1 ? 'grab' : 'default';
            }
        });

        // 触摸事件 - 缩放
        let touchStartDistance = 0;
        let touchStartScale = 1;

        this.overlay.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                touchStartDistance = this.getTouchDistance(e.touches);
                touchStartScale = this.scale;
            } else if (e.touches.length === 1 && this.scale > 1) {
                this.isDragging = true;
                this.dragStartX = e.touches[0].clientX - this.translateX;
                this.dragStartY = e.touches[0].clientY - this.translateY;
            }
        }, { passive: true });

        this.overlay.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                const currentDistance = this.getTouchDistance(e.touches);
                const scale = touchStartScale * (currentDistance / touchStartDistance);
                this.setScale(scale);
            } else if (e.touches.length === 1 && this.isDragging) {
                this.translateX = e.touches[0].clientX - this.dragStartX;
                this.translateY = e.touches[0].clientY - this.dragStartY;
                this.updateTransform();
            }
        }, { passive: true });

        this.overlay.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                this.isDragging = false;
            }
            
            // 单指滑动切换图片（仅在未缩放时）
            if (e.changedTouches.length === 1 && this.scale === 1) {
                const touchEndX = e.changedTouches[0].screenX;
                const touchStartX = e.changedTouches[0].screenX;
                // 需要记录起始位置
            }
        }, { passive: true });

        // 触摸滑动支持（仅在未缩放时）
        let swipeStartX = 0;
        let swipeEndX = 0;

        this.overlay.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1 && this.scale === 1) {
                swipeStartX = e.touches[0].screenX;
            }
        }, { passive: true });

        this.overlay.addEventListener('touchend', (e) => {
            if (e.changedTouches.length === 1 && this.scale === 1) {
                swipeEndX = e.changedTouches[0].screenX;
                const diff = swipeStartX - swipeEndX;
                
                if (Math.abs(diff) > 50) {
                    if (diff > 0) {
                        this.next();
                    } else {
                        this.prev();
                    }
                }
            }
        }, { passive: true });
    }

    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    setScale(newScale) {
        this.scale = Math.max(this.minScale, Math.min(this.maxScale, newScale));
        this.zoomLevelEl.textContent = Math.round(this.scale * 100) + '%';
        this.updateTransform();
        
        // 更新鼠标样式
        this.imageEl.style.cursor = this.scale > 1 ? 'grab' : 'default';
    }

    zoomIn() {
        this.setScale(this.scale + 0.5);
    }

    zoomOut() {
        this.setScale(this.scale - 0.5);
    }

    resetZoom() {
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.zoomLevelEl.textContent = '100%';
        this.updateTransform();
        this.imageEl.style.cursor = 'default';
    }

    updateTransform() {
        this.imageEl.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    }

    open(images, index = 0) {
        this.images = images;
        this.currentIndex = index;
        this.resetZoom();
        this.show();
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    show() {
        const src = this.images[this.currentIndex];
        
        // 显示加载状态
        this.loadingEl.style.display = 'block';
        this.imageEl.style.opacity = '0';
        
        // 加载图片
        const img = new Image();
        img.onload = () => {
            this.imageEl.src = src;
            this.imageEl.style.opacity = '1';
            this.loadingEl.style.display = 'none';
        };
        img.onerror = () => {
            this.loadingEl.style.display = 'none';
            this.imageEl.src = src;
            this.imageEl.style.opacity = '1';
        };
        img.src = src;

        // 更新计数器
        this.counterEl.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
        
        // 更新导航按钮状态
        this.prevBtn.style.display = this.images.length > 1 ? 'flex' : 'none';
        this.nextBtn.style.display = this.images.length > 1 ? 'flex' : 'none';
    }

    prev() {
        if (this.images.length <= 1) return;
        this.currentIndex = (this.currentIndex - 1 + this.images.length) % this.images.length;
        this.resetZoom();
        this.show();
    }

    next() {
        if (this.images.length <= 1) return;
        this.currentIndex = (this.currentIndex + 1) % this.images.length;
        this.resetZoom();
        this.show();
    }

    close() {
        this.overlay.classList.remove('active');
        document.body.style.overflow = '';
        this.resetZoom();
    }
}

// 全局实例
window.lightbox = new Lightbox();

// 初始化帖子内容中的图片查看器
function initPostImageLightbox() {
    // 获取所有帖子内容中的图片
    const postContents = document.querySelectorAll('.post-content, .post-detail-content, .forum-content, .daily-content, .decision-content, .comment-content');
    
    postContents.forEach(content => {
        const images = content.querySelectorAll('img');
        if (images.length === 0) return;
        
        const imageUrls = Array.from(images).map(img => img.src);
        
        images.forEach((img, index) => {
            img.style.cursor = 'pointer';
            img.addEventListener('click', () => {
                window.lightbox.open(imageUrls, index);
            });
        });
    });
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPostImageLightbox);
} else {
    initPostImageLightbox();
}

// 导出供外部使用
window.initPostImageLightbox = initPostImageLightbox;