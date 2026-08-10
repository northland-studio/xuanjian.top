import { useEffect, useRef, useState } from 'react';
import { Structure, NbtFile, ThreeStructureRenderer, loadDefaultPackResources } from '@mattzh72/lodestone';

// lodestone 默认材质包（assets.json / atlas.png / block-flags），由 Vite 复制到 public 目录静态托管。
// 注意：lodestone 用 new URL(rel, base) 拼接资源地址，base 必须是绝对 URL，否则报 "Invalid base URL"
const PACK_BASE = '/lodestone/default-pack/';

// 渲染分辨率上限（大投影性能优化：最高 1，关抗锯齿）
const PIXEL_RATIO_CAP = 1;
// 空闲 1.5 秒后降为 30fps，交互时 60fps
const IDLE_FPS = 30;
const ACTIVE_FPS = 60;
const IDLE_TIMEOUT_MS = 1500;

// 材质包只需加载一次，模块级缓存（失败后允许重试）
let packPromise = null;
function getPack() {
  if (!packPromise) {
    const absoluteBase = new URL(PACK_BASE, window.location.href).toString();
    packPromise = loadDefaultPackResources({ baseUrl: absoluteBase }).catch(err => {
      packPromise = null;
      throw err;
    });
  }
  return packPromise;
}

// 共享解析 Worker（fetch + NBT 解压 + 位解包放在后台线程）
let workerRef = null;
let workerReady = null;
let reqId = 0;
const pending = new Map();

function initWorker() {
  if (workerReady) return workerReady;
  workerReady = new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/projection.worker.js', import.meta.url), { type: 'module' });
    workerRef = w;
    w.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'loaded') {
        const p = pending.get(d.id);
        if (!p) return;
        pending.delete(d.id);
        if (d.ok) p.resolve(d);
        else p.reject(new Error(d.error || '投影解析失败'));
      }
    };
    w.onerror = (err) => {
      workerRef = null;
      workerReady = null;
      reject(new Error(err?.message || '投影解析线程启动失败'));
    };
    resolve(w);
  });
  return workerReady;
}

async function parseInWorker(url) {
  const w = await initWorker();
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: 'load', id, url });
  });
}

/**
 * Litematic 投影文件 3D 预览组件（大规模投影优化版）
 * - Web Worker 后台解析，主线程不阻塞
 * - asyncBuild 分片网格构建 + chunkSize 32 + 分辨率上限
 * - 空闲 30fps / 交互 60fps
 * - 懒加载：进入视口才初始化，离开视口暂停渲染
 * @param {string} url .litematic 文件地址（七牛 CDN）
 * @param {number} height 预览区高度（px），默认 320
 */
export default function LitematicViewer({ url, height = 320 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const inViewRef = useRef(false);
  const [status, setStatus] = useState('pending'); // pending 未进入视口 | loading 加载中 | ready 渲染中 | error
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let renderer = null;
    let started = false;
    const ctl = { yaw: 0.7, pitch: 0.4, dist: 60 };
    let lastInteraction = Date.now();

    const applyCamera = () => {
      if (!renderer) return;
      const t = ctl.target;
      const px = t[0] + ctl.dist * Math.cos(ctl.pitch) * Math.sin(ctl.yaw);
      const py = t[1] + ctl.dist * Math.sin(ctl.pitch);
      const pz = t[2] + ctl.dist * Math.cos(ctl.pitch) * Math.cos(ctl.yaw);
      renderer.setCamera({ position: [px, py, pz], target: t, up: [0, 1, 0] });
    };

    const init = async () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      try {
        setStatus('loading');
        setError('');
        // 后台线程解析 + 材质包加载并行
        const [res, pack] = await Promise.all([parseInWorker(url), getPack()]);
        if (disposed) return;

        const nbt = NbtFile.read(new Uint8Array(res.bytes), { compression: 'none' });
        const structure = Structure.fromNbt(nbt.root);
        // 尺寸归一化：getMetadata 返回 {x,y,z}，getSize 返回数组
        const rawSize = (res.meta && res.meta.size) || structure.getSize() || { x: 0, y: 0, z: 0 };
        const sx = rawSize.x ?? rawSize[0] ?? 0;
        const sy = rawSize.y ?? rawSize[1] ?? 0;
        const sz = rawSize.z ?? rawSize[2] ?? 0;
        ctl.target = [sx / 2, sy / 2, sz / 2];
        const maxDim = Math.max(sx, sy, sz, 1);
        ctl.dist = Math.max(8, Math.min(500, maxDim * 2.2));
        ctl.yaw = 0.7;
        ctl.pitch = 0.4;
        setInfo({ blocks: res.meta ? res.meta.totalBlocks : undefined, size: { x: sx, y: sy, z: sz } });

        // 大规模优化：关闭抗锯齿、启用分片网格构建、放大 chunk 减少 draw call；
        // drawDistance 随结构尺寸增大，避免大结构被视距剔除
        renderer = new ThreeStructureRenderer(canvas, structure, pack.resources, {
          antialias: false,
          asyncBuild: true,
          chunkSize: 32,
          drawDistance: Math.max(256, maxDim * 2.6),
        });
        rendererRef.current = renderer;
        setStatus('ready');
        setBuilding(true);

        const resize = () => {
          if (!renderer || !wrap) return;
          const w = Math.max(1, wrap.clientWidth);
          const h = Math.max(1, height);
          const dpr = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP);
          // 传逻辑尺寸，lodestone 内部按 pixelRatio 放大画布
          renderer.setViewport(0, 0, w, h, dpr);
          applyCamera();
        };
        resize();

        let ro = null;
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(resize);
          ro.observe(wrap);
        }

        // 交互：拖拽旋转 / 滚轮缩放
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        const onPointerDown = (e) => {
          dragging = true;
          lastX = e.clientX;
          lastY = e.clientY;
          lastInteraction = Date.now();
          canvas.style.cursor = 'grabbing';
          canvas.setPointerCapture?.(e.pointerId);
        };
        const onPointerMove = (e) => {
          if (!dragging) return;
          ctl.yaw -= (e.clientX - lastX) * 0.008;
          ctl.pitch += (e.clientY - lastY) * 0.008;
          ctl.pitch = Math.max(-1.5, Math.min(1.5, ctl.pitch));
          lastX = e.clientX;
          lastY = e.clientY;
          lastInteraction = Date.now();
          applyCamera();
        };
        const onPointerUp = () => {
          dragging = false;
          canvas.style.cursor = 'grab';
        };
        const onWheel = (e) => {
          e.preventDefault();
          ctl.dist *= 1 + Math.sign(e.deltaY) * 0.1;
          ctl.dist = Math.max(5, Math.min(2000, ctl.dist));
          lastInteraction = Date.now();
          applyCamera();
        };
        canvas.style.cursor = 'grab';
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });

        applyCamera();
        // 分片构建完成后隐藏"构建中"提示
        renderer.whenReady().then(() => {
          if (!disposed) setBuilding(false);
        }).catch(() => {});

        // 渲染循环：空闲降帧 + 离开视口暂停
        let lastFrame = 0;
        const loop = (now) => {
          raf = requestAnimationFrame(loop);
          if (disposed || !renderer) return;
          if (!inViewRef.current) return; // 离开视口暂停
          const frameInterval = 1000 / (Date.now() - lastInteraction > IDLE_TIMEOUT_MS ? IDLE_FPS : ACTIVE_FPS);
          if (now - lastFrame < frameInterval) return; // 降帧
          lastFrame = now;
          renderer.drawStructure();
        };
        raf = requestAnimationFrame(loop);

        return () => {
          dragging = false;
          canvas.removeEventListener('pointerdown', onPointerDown);
          canvas.removeEventListener('pointermove', onPointerMove);
          canvas.removeEventListener('pointerup', onPointerUp);
          canvas.removeEventListener('pointercancel', onPointerUp);
          canvas.removeEventListener('wheel', onWheel);
          ro?.disconnect();
        };
      } catch (err) {
        if (!disposed) {
          setStatus('error');
          setError(err?.message || '投影加载失败');
        }
      }
    };

    // 懒加载：进入视口才初始化
    let cleanupFn = null;
    let io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          inViewRef.current = entry.isIntersecting;
          if (entry.isIntersecting && !started) {
            started = true;
            io.disconnect();
            cleanupFn = init();
          }
        });
      }, { rootMargin: '200px' });
      if (wrapRef.current) io.observe(wrapRef.current);
    } else {
      started = true;
      cleanupFn = init();
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io?.disconnect();
      Promise.resolve(cleanupFn).then(fn => fn?.());
      renderer?.dispose?.();
      rendererRef.current = null;
    };
  }, [url, height]);

  const fmtSize = (s) => s ? `${s.x ?? s[0]}×${s.y ?? s[1]}×${s.z ?? s[2]}` : '';

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        height,
        background: 'radial-gradient(circle at 50% 40%, #1e293b, #0b1220)',
        borderRadius: 10,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }} />
      {status === 'pending' && (
        <div className="flex-center" style={{ position: 'absolute', inset: 0, color: 'var(--text-secondary)', fontSize: 13, background: 'rgba(11,18,32,0.5)' }}>
          滚动到此处自动加载预览
        </div>
      )}
      {status === 'loading' && (
        <div className="flex-center" style={{ position: 'absolute', inset: 0, color: 'var(--text-secondary)', fontSize: 13, gap: 8, background: 'rgba(11,18,32,0.5)' }}>
          <span className="spinner" style={{ width: 18, height: 18 }} />投影解析中...
        </div>
      )}
      {status === 'error' && (
        <div className="flex-center" style={{ position: 'absolute', inset: 0, color: 'var(--danger)', fontSize: 13, padding: 12, textAlign: 'center' }}>
          {error}
        </div>
      )}
      {status === 'ready' && info && (
        <div style={{ position: 'absolute', left: 10, top: 10, display: 'flex', gap: 8, flexWrap: 'wrap', pointerEvents: 'none' }}>
          {info.blocks != null && (
            <span className="badge" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11 }}>{info.blocks.toLocaleString()} 方块</span>
          )}
          {info.size && <span className="badge" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11 }}>{fmtSize(info.size)}</span>}
          {building && <span className="badge" style={{ background: 'rgba(255,165,0,0.35)', color: '#fff', fontSize: 11 }}>网格构建中...</span>}
        </div>
      )}
      {status === 'ready' && (
        <div style={{ position: 'absolute', right: 10, bottom: 8, color: 'rgba(255,255,255,0.45)', fontSize: 11, pointerEvents: 'none' }}>
          拖拽旋转 · 滚轮缩放
        </div>
      )}
    </div>
  );
}
