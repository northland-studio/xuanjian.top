// 图片查看器 (Lightbox)
class Lightbox {
    constructor() {
        this.images = [];
        this.currentIndex = 0;
        this.overlay = null;
        this.imageEl = null;
        this.counterEl = null;
        this.prevBtn = null;
        this.nextBtn = null;
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
            <div class="lightbox-content">
                <div class="lightbox-loading"></div>
                <img class="lightbox-image" src="" alt="">
            </div>
            <div class="lightbox-counter"></div>
        `;
        document.body.appendChild(this.overlay);

        this.imageEl = this.overlay.querySelector('.lightbox-image');
        this.counterEl = this.overlay.querySelector('.lightbox-counter');
        this.prevBtn = this.overlay.querySelector('.lightbox-prev');
        this.nextBtn = this.overlay.querySelector('.lightbox-next');
        this.loadingEl = this.overlay.querySelector('.lightbox-loading');
    }

    bindEvents() {
        // 关闭按钮
        this.overlay.querySelector('.lightbox-close').addEventListener('click', () => this.close());
        
        // 点击遮罩关闭
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
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
            }
        });

        // 触摸滑动支持
        let touchStartX = 0;
        let touchEndX = 0;

        this.overlay.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        this.overlay.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            const diff = touchStartX - touchEndX;
            
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    this.next();
                } else {
                    this.prev();
                }
            }
        }, { passive: true });
    }

    open(images, index = 0) {
        this.images = images;
        this.currentIndex = index;
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
        this.show();
    }

    next() {
        if (this.images.length <= 1) return;
        this.currentIndex = (this.currentIndex + 1) % this.images.length;
        this.show();
    }

    close() {
        this.overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// 全局实例
window.lightbox = new Lightbox();

// 初始化帖子内容中的图片查看器
function initPostImageLightbox() {
    // 获取所有帖子内容中的图片
    const postContents = document.querySelectorAll('.post-content, .forum-content, .daily-content, .decision-content');
    
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
