import { useEffect, useRef } from 'react';

/**
 * Minecraft 玩家皮肤模型（基于 skinview3d，动态加载避免首屏体积增加）
 * props:
 *  - skin: 皮肤图片 URL（64x64 PNG），为空时渲染默认 Steve
 *  - width / height: 画布尺寸
 *  - autoRotate: 是否自动旋转
 *  - zoom: 相机缩放
 *  - onClick: 点击画布回调
 *  - style: 附加样式
 */
export default function SkinViewer({ skin, width = 240, height = 320, autoRotate = true, zoom = 1.1, onClick, style }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const skinRef = useRef(skin);
  skinRef.current = skin;

  // 初始化（skinview3d 动态 import，打包为独立 chunk）
  useEffect(() => {
    let cancelled = false;
    let viewer = null;
    import('skinview3d')
      .then(({ SkinViewer, IdleAnimation }) => {
        if (cancelled || !canvasRef.current) return;
        viewer = new SkinViewer({
          canvas: canvasRef.current,
          width,
          height,
          skin: skinRef.current || undefined
        });
        viewer.autoRotate = autoRotate;
        viewer.autoRotateSpeed = 1.5;
        viewer.camera.zoom = zoom;
        viewer.animation = new IdleAnimation();
        viewerRef.current = viewer;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (viewer) viewer.dispose();
      viewerRef.current = null;
    };
  }, [width, height, autoRotate, zoom]);

  // 皮肤变化时热更新
  useEffect(() => {
    const v = viewerRef.current;
    if (v && skin) v.loadSkin(skin);
  }, [skin]);

  return <canvas ref={canvasRef} onClick={onClick} style={{ width, height, display: 'block', ...style }} />;
}
