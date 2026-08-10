import { useEffect, useRef, useState } from 'react';
import { LitematicLoader, ThreeStructureRenderer, loadDefaultPackResources } from '@mattzh72/lodestone';

// lodestone 默认材质包（assets.json / atlas.png / block-flags），由 Vite 复制到 public 目录静态托管。
// 注意：lodestone 用 new URL(rel, base) 拼接资源地址，base 必须是绝对 URL，否则报 "Invalid base URL"
const PACK_BASE = '/lodestone/default-pack/';

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

/**
 * Litematic 投影文件 3D 预览组件
 * 基于 @mattzh72/lodestone（three.js），支持拖拽旋转、滚轮缩放，自动按结构尺寸取景
 * @param {string} url .litematic 文件地址（七牛 CDN）
 * @param {number} height 预览区高度（px），默认 320
 */
export default function LitematicViewer({ url, height = 320 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null); // { blocks, size }

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let renderer = null;
    const ctl = { yaw: 0.6, pitch: 0.35, dist: 60 };

    const applyCamera = () => {
      if (!renderer) return;
      const px = ctl.dist * Math.cos(ctl.pitch) * Math.sin(ctl.yaw);
      const py = ctl.dist * Math.sin(ctl.pitch);
      const pz = ctl.dist * Math.cos(ctl.pitch) * Math.cos(ctl.yaw);
      renderer.setCamera({ position: [px, py, pz], target: [0, 0, 0], up: [0, 1, 0] });
    };

    const init = async () => {
      try {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;

        setStatus('loading');
        setError('');
        const { resources } = await getPack();
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`投影文件下载失败（HTTP ${resp.status}）`);
        const buf = new Uint8Array(await resp.arrayBuffer());

        const meta = LitematicLoader.getMetadata(buf);
        const structure = LitematicLoader.load(buf);
        if (disposed) return;

        const size = meta.size || { x: 0, y: 0, z: 0 };
        setInfo({ blocks: meta.totalBlocks, name: meta.name, size });
        // 按结构最大边长自动取景
        const maxDim = Math.max(size.x, size.z, size.y, 1);
        ctl.dist = Math.max(8, Math.min(500, maxDim * 2.2));
        ctl.yaw = 0.7;
        ctl.pitch = 0.4;

        renderer = new ThreeStructureRenderer(canvas, structure, resources, {
          antialias: true,
          preserveDrawingBuffer: false,
        });
        rendererRef.current = renderer;
        setStatus('ready');

        const resize = () => {
          if (!renderer || !wrap) return;
          const w = wrap.clientWidth;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.max(1, Math.floor(w * dpr));
          canvas.height = Math.max(1, Math.floor(height * dpr));
          renderer.setViewport(0, 0, canvas.width, canvas.height, dpr);
          renderer.setCamera({ position: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0] });
          applyCamera();
        };
        resize();

        let ro = null;
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(resize);
          ro.observe(wrap);
        }

        // 交互：拖拽旋转 / 滚轮缩放（每次变更后立即应用相机）
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        const onPointerDown = (e) => {
          dragging = true;
          lastX = e.clientX;
          lastY = e.clientY;
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
          applyCamera();
        };
        canvas.style.cursor = 'grab';
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });

        applyCamera();
        const loop = () => {
          if (disposed || !renderer) return;
          renderer.drawStructure();
          raf = requestAnimationFrame(loop);
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

    const cleanup = init();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      Promise.resolve(cleanup).then(fn => fn?.());
      renderer?.dispose?.();
      rendererRef.current = null;
    };
  }, [url, height]);

  const fmtSize = (s) => s ? `${s.x}×${s.y}×${s.z}` : '';

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
      {status === 'loading' && (
        <div className="flex-center" style={{ position: 'absolute', inset: 0, color: 'var(--text-secondary)', fontSize: 13, gap: 8, background: 'rgba(11,18,32,0.5)' }}>
          <span className="spinner" style={{ width: 18, height: 18 }} />投影加载中...
        </div>
      )}
      {status === 'error' && (
        <div className="flex-center" style={{ position: 'absolute', inset: 0, color: 'var(--danger)', fontSize: 13, padding: 12, textAlign: 'center' }}>
          {error}
        </div>
      )}
      {status === 'ready' && info && (
        <div style={{ position: 'absolute', left: 10, top: 10, display: 'flex', gap: 8, flexWrap: 'wrap', pointerEvents: 'none' }}>
          <span className="badge" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11 }}>{info.blocks.toLocaleString()} 方块</span>
          {info.size && <span className="badge" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11 }}>{fmtSize(info.size)}</span>}
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
