import { useEffect, useState } from 'react';

// 图片查看器（Lightbox）：全屏遮罩查看图片，支持左右切换、Esc/点击关闭
export default function Lightbox({ images, index: initialIndex = 0, onClose }) {
  const list = (Array.isArray(images) ? images : []).filter(Boolean);
  const [index, setIndex] = useState(initialIndex);

  // 索引越界保护
  const safeIndex = list.length ? Math.min(Math.max(index, 0), list.length - 1) : 0;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex(i => Math.max(i - 1, 0));
      if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, list.length - 1));
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, list.length]);

  if (list.length === 0) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button
        className="lightbox-close"
        onClick={onClose}
        aria-label="关闭"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {list.length > 1 && (
        <>
          <button
            className="lightbox-nav prev"
            onClick={e => { e.stopPropagation(); setIndex(i => Math.max(i - 1, 0)); }}
            aria-label="上一张"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            className="lightbox-nav next"
            onClick={e => { e.stopPropagation(); setIndex(i => Math.min(i + 1, list.length - 1)); }}
            aria-label="下一张"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      <img
        className="lightbox-image"
        src={list[safeIndex]}
        alt=""
        onClick={e => e.stopPropagation()}
      />

      {list.length > 1 && (
        <div className="lightbox-counter">{safeIndex + 1} / {list.length}</div>
      )}
    </div>
  );
}
