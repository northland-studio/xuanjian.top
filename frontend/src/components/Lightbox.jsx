import { useEffect, useRef, useState } from 'react';
import 'viewerjs/dist/viewer.css';

/**
 * 图片查看器（基于 viewerjs）：全屏查看图片，支持缩放/旋转/平移/切换/下载
 * props:
 *  - images: 图片 URL 数组
 *  - index: 初始显示第几张
 *  - onClose: 关闭回调
 */
export default function Lightbox({ images, index: initialIndex = 0, onClose }) {
  const list = (Array.isArray(images) ? images : []).filter(Boolean);
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [ready, setReady] = useState(false);

  // 动态加载 viewerjs（减少首屏体积）
  useEffect(() => {
    let cancelled = false;
    import('viewerjs').then(({ default: Viewer }) => {
      if (cancelled) return;
      setReady(true);
      window.__Viewer = Viewer;
    });
    return () => { cancelled = true; };
  }, []);

  // 初始化/销毁 viewer
  useEffect(() => {
    if (!ready || list.length === 0) return;

    let viewer = null;
    // 确保图片列表先渲染完成
    const timer = setTimeout(() => {
      if (!containerRef.current) return;
      viewer = new window.__Viewer(containerRef.current, {
        initialView: initialIndex,
        toolbar: {
          zoomIn: 1, zoomOut: 1, oneToOne: 1, reset: 1,
          prev: list.length > 1, play: { show: list.length > 1 }, next: list.length > 1,
          rotateLeft: 1, rotateRight: 1, flipHorizontal: 1, flipVertical: 1,
          zoomRatio: 10, download: 1
        },
        title: true,
        navbar: false,
        hidden() { onClose(); }
      });
      viewer.show();
      viewerRef.current = viewer;
    }, 0);

    return () => {
      clearTimeout(timer);
      if (viewer) viewer.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, list.length, initialIndex]);

  if (list.length === 0) return null;

  return (
    <div style={{ display: 'none' }} ref={containerRef}>
      {list.map((src, i) => (
        <img key={i} src={src} alt="" data-original={src} />
      ))}
    </div>
  );
}
