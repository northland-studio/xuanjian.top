import { useEffect, useRef } from 'react';

// 自定义动画池：基于 skinview3d FunctionAnimation 编写（progress 0~1 循环），供随机播放
function buildAnimationPool({ FunctionAnimation, RunningAnimation }) {
  const TAU = Math.PI * 2;
  return {
    // 挥手：右臂前后摆动 + 头部轻摆
    wave: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      player.rightArm.rotation.x = -1.0;
      player.rightArm.rotation.y = 1.3 * Math.sin(t);
      player.leftArm.rotation.x = 0.05;
      player.head.rotation.z = 0.12 * Math.sin(t);
    }),
    // 欢呼：双臂举起上下交替 + 身体轻摆
    cheer: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      player.rightArm.rotation.x = -Math.PI * 0.85 + 0.35 * Math.sin(t);
      player.leftArm.rotation.x = -Math.PI * 0.85 - 0.35 * Math.sin(t);
      player.body.rotation.y = 0.2 * Math.sin(t);
    }),
    // 打拳：双臂交替出拳 + 身体前倾
    punch: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      const hit = Math.max(0, Math.sin(t));
      const hitAlt = Math.max(0, Math.sin(t - Math.PI));
      player.rightArm.rotation.x = -1.5 * hit;
      player.leftArm.rotation.x = -1.2 * hitAlt;
      player.body.rotation.x = 0.12 * hit;
    }),
    // 跳舞：身体左右摇摆 + 双臂交替甩动 + 双腿轻点
    dance: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      player.body.rotation.z = 0.35 * Math.sin(t);
      player.head.rotation.z = -0.22 * Math.sin(t);
      player.rightArm.rotation.x = -0.9 * Math.sin(2 * t);
      player.leftArm.rotation.x = 0.9 * Math.sin(2 * t);
      player.rightLeg.rotation.z = 0.15 * Math.sin(2 * t);
      player.leftLeg.rotation.z = -0.15 * Math.sin(2 * t);
    }),
    // 摇头：头部左右摇动
    headshake: () => new FunctionAnimation((player, p) => {
      const t = p * TAU;
      player.head.rotation.y = 0.7 * Math.sin(t);
      player.head.rotation.z = 0.12 * Math.sin(t * 0.5);
    }),
    // 原地跑步（官方动画，混入池中增加多样性）
    running: () => new RunningAnimation()
  };
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
 *  - onClick: 点击画布回调
 *  - style: 附加样式
 */
export default function SkinViewer({ skin, width = 240, height = 320, autoRotate = true, animation = 'idle', animationSpeed = 1, zoom = 1.1, onClick, style }) {
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
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (viewer) viewer.dispose();
      viewerRef.current = null;
    };
  }, [width, height, autoRotate, zoom, animation]);

  // 皮肤变化时热更新
  useEffect(() => {
    const v = viewerRef.current;
    if (v && skin) v.loadSkin(skin);
  }, [skin]);

  return <canvas ref={canvasRef} onClick={onClick} style={{ width, height, display: 'block', ...style }} />;
}
