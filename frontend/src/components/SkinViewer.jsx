import { useEffect, useRef } from 'react';

// 自定义动画池：基于 skinview3d FunctionAnimation 编写（progress 0~1 循环），供随机播放
// 注意：骨骼位于 player.skin.* 下（player.skin.head / rightArm / leftArm / body / rightLeg / leftLeg）
function buildAnimationPool({ FunctionAnimation, RunningAnimation }) {
  const TAU = Math.PI * 2;
  return {
    // 挥手：右臂前后摆动 + 头部轻摆
    wave: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      player.skin.rightArm.rotation.x = -1.0;
      player.skin.rightArm.rotation.y = 1.3 * Math.sin(t);
      player.skin.leftArm.rotation.x = 0.05;
      player.skin.head.rotation.z = 0.12 * Math.sin(t);
    }),
    // 欢呼：双臂举起上下交替 + 身体轻摆
    cheer: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      player.skin.rightArm.rotation.x = -Math.PI * 0.85 + 0.35 * Math.sin(t);
      player.skin.leftArm.rotation.x = -Math.PI * 0.85 - 0.35 * Math.sin(t);
      player.skin.body.rotation.y = 0.2 * Math.sin(t);
    }),
    // 打拳：双臂交替出拳 + 身体前倾
    punch: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      const hit = Math.max(0, Math.sin(t));
      const hitAlt = Math.max(0, Math.sin(t - Math.PI));
      player.skin.rightArm.rotation.x = -1.5 * hit;
      player.skin.leftArm.rotation.x = -1.2 * hitAlt;
      player.skin.body.rotation.x = 0.12 * hit;
    }),
    // 跳舞：身体左右摇摆 + 双臂交替甩动 + 双腿轻点
    dance: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      player.skin.body.rotation.z = 0.35 * Math.sin(t);
      player.skin.head.rotation.z = -0.22 * Math.sin(t);
      player.skin.rightArm.rotation.x = -0.9 * Math.sin(2 * t);
      player.skin.leftArm.rotation.x = 0.9 * Math.sin(2 * t);
      player.skin.rightLeg.rotation.z = 0.15 * Math.sin(2 * t);
      player.skin.leftLeg.rotation.z = -0.15 * Math.sin(2 * t);
    }),
    // 摇头：头部左右摇动
    headshake: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      player.skin.head.rotation.y = 0.7 * Math.sin(t);
      player.skin.head.rotation.z = 0.12 * Math.sin(t * 0.5);
    }),
    // 原地跑步（官方动画，混入池中增加多样性）
    running: () => new RunningAnimation()
  };
}

// 模型头顶玩家名专用字体（Minecraft 风格），按需加载避免 16MB 字体阻塞首屏
const NAMETAG_FONT = 'XJ-Minecraft';
const NAMETAG_FONT_URL = '/fonts/1.ttf';
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
async function applyNametag(viewer, name) {
  if (!viewer || viewer.disposed) return;
  if (!name) {
    viewer.nameTag = null;
    return;
  }
  const ok = await ensureNametagFont();
  if (!viewer || viewer.disposed) return;
  const { NameTagObject } = await import('skinview3d');
  viewer.nameTag = new NameTagObject(name, {
    font: ok ? `48px ${NAMETAG_FONT}` : '48px Minecraft',
    textStyle: '#fff',
    backgroundStyle: 'rgba(0,0,0,0.4)',
    height: 2.4,
    margin: [3, 8, 3, 8],
    repaintAfterLoaded: true
  });
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
      .then(({ SkinViewer: Viewer, IdleAnimation, RunningAnimation, FunctionAnimation }) => {
        if (cancelled || !canvasRef.current) return;
        viewer = new Viewer({
          canvas: canvasRef.current,
          width,
          height,
          skin: skinRef.current || undefined
        });
        viewer.autoRotate = autoRotate;
        viewer.autoRotateSpeed = 1.5;
        viewer.camera.zoom = zoom;
        if (animation === 'random') {
          // 从自定义动画池随机选一个
          const pool = buildAnimationPool({ FunctionAnimation, RunningAnimation });
          const keys = Object.keys(pool);
          viewer.animation = pool[keys[Math.floor(Math.random() * keys.length)]]();
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
