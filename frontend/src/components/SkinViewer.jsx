import { useEffect, useRef } from 'react';

// 动作池：全部使用 skinview3d 官方动画，随机播放
function buildAnimationPool(animations) {
  const { IdleAnimation, WalkingAnimation, RunningAnimation, FlyingAnimation, WaveAnimation, CrouchAnimation, SwimAnimation } = animations;
  return [
    () => new IdleAnimation(),
    () => new WalkingAnimation(),
    () => new RunningAnimation(),
    () => new FlyingAnimation(),
    () => new WaveAnimation('right'),
    () => new CrouchAnimation(),
    () => new SwimAnimation()
  ];
}

// 模型头顶玩家名字体：skinview3d 官方 Minecraft 字体（jsDelivr CDN，~50KB），替代 16MB 本地字体
const NAMETAG_FONT = 'Minecraft';
const NAMETAG_FONT_URL = 'https://cdn.jsdelivr.net/npm/skinview3d@3.4.2/assets/minecraft.woff2';
let fontReady = null;

function ensureNametagFont() {
  if (fontReady !== null) return fontReady;
  try {
    fontReady = new FontFace(NAMETAG_FONT, `url(${NAMETAG_FONT_URL})`)
      .load()
      .then(font => {
        document.fonts.add(font);
        return true;
      })
      .catch(() => false);
  } catch {
    fontReady = Promise.resolve(false);
  }
  return fontReady;
}

// 为 viewer 设置/更新头顶玩家名（跟随模型）
// 先立即用默认字体显示名字，字体加载完成后替换为指定字体重绘
async function applyNametag(viewer, name) {
  if (!viewer || viewer.disposed) return;
  if (!name) {
    viewer.nameTag = null;
    return;
  }
  const { NameTagObject } = await import('skinview3d');
  if (!viewer || viewer.disposed) return;
  viewer.nameTag = new NameTagObject(name, {
    textStyle: '#fff',
    backgroundStyle: 'rgba(0,0,0,0.4)',
    height: 2.4,
    margin: [3, 8, 3, 8]
  });
  // 名字贴近头顶（覆盖默认 y=20，避免放大后跑出画布）
  viewer.nameTag.position.y = 4.5;
  // 模型整体下移，给头顶名字留出空间（随 zoom 等比）
  viewer.playerWrapper.position.y = -0.55 * viewer.camera.zoom;
  // 字体就绪后用指定字体重绘（不会等待，名字已先显示）
  const ok = await ensureNametagFont();
  if (!viewer || viewer.disposed || !ok) return;
  viewer.nameTag = new NameTagObject(name, {
    font: `48px ${NAMETAG_FONT}`,
    textStyle: '#fff',
    backgroundStyle: 'rgba(0,0,0,0.4)',
    height: 2.4,
    margin: [3, 8, 3, 8]
  });
  viewer.nameTag.position.y = 4.5;
}

/**
 * Minecraft 玩家皮肤模型（基于 skinview3d，动态加载避免首屏体积增加）
 * props:
 *  - skin: 皮肤图片 URL（64x64 PNG），为空时渲染默认 Steve
 *  - width / height: 画布尺寸
 *  - autoRotate: 是否自动旋转
 *  - animation: 'idle' 站立 | 'running' 原地跑步 | 'random' 随机自定义动画
 *  - animationSpeed: 动画速度倍率（默认 1）
 *  - zoom: 相机缩放
 *  - name: 头顶玩家名（游戏ID），跟随模型
 *  - onClick: 点击画布回调
 *  - style: 附加样式
 */
export default function SkinViewer({ skin, width = 240, height = 320, autoRotate = true, animation = 'idle', animationSpeed = 1, zoom = 1.1, name, onClick, style }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const skinRef = useRef(skin);
  skinRef.current = skin;

  // 初始化（skinview3d 动态 import，打包为独立 chunk）
  useEffect(() => {
    let cancelled = false;
    let viewer = null;
    import('skinview3d')
      .then(({ SkinViewer: Viewer, IdleAnimation, WalkingAnimation, RunningAnimation, FlyingAnimation, WaveAnimation, CrouchAnimation, SwimAnimation }) => {
        if (cancelled || !canvasRef.current) return;
        viewer = new Viewer({
          canvas: canvasRef.current,
          width,
          height,
          skin: skinRef.current || undefined
        });
        viewer.autoRotate = autoRotate;
        viewer.autoRotateSpeed = 1.5;
        // 自适应：zoom='auto' 时按画布高度自动计算，保证模型全身+头顶名字完整显示
        viewer.camera.zoom = zoom === 'auto' ? Math.max(0.3, height / 172) : zoom;
        if (animation === 'random') {
          // 从官方动画池随机选一个
          const pool = buildAnimationPool({ IdleAnimation, WalkingAnimation, RunningAnimation, FlyingAnimation, WaveAnimation, CrouchAnimation, SwimAnimation });
          viewer.animation = pool[Math.floor(Math.random() * pool.length)]();
        } else {
          viewer.animation = animation === 'running' ? new RunningAnimation() : new IdleAnimation();
        }
        viewer.animation.speed = animationSpeed;
        viewerRef.current = viewer;
        // 头顶玩家名
        if (name) applyNametag(viewer, name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (viewer) viewer.dispose();
      viewerRef.current = null;
    };
  }, [width, height, autoRotate, zoom, animation]);

  // 名字变化时更新 Nametag
  useEffect(() => {
    const v = viewerRef.current;
    if (v) applyNametag(v, name);
  }, [name]);

  // 皮肤变化时热更新
  useEffect(() => {
    const v = viewerRef.current;
    if (v && skin) v.loadSkin(skin);
  }, [skin]);

  return <canvas ref={canvasRef} onClick={onClick} style={{ width, height, display: 'block', ...style }} />;
}
