import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import SkinViewer from './SkinViewer';

/**
 * 右下角常驻 Minecraft 皮肤模型
 * 随机从用户皮肤池加载皮肤，可折叠为小按钮
 */
export default function SkinWidget() {
  const [skin, setSkin] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const containerRef = useRef(null);

  // 加载随机皮肤
  useEffect(() => {
    api.get('/api/skins/random')
      .then(d => setSkin(d.skin || null))
      .catch(() => {});
  }, []);

  // 点击切换随机皮肤
  const refreshSkin = async () => {
    try {
      const d = await api.get('/api/skins/random');
      setSkin(d.skin || null);
    } catch { /* 忽略 */ }
  };

  // WebGL 支持检测（无支持则隐藏模型）
  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      setReady(!!gl);
    } catch {
      setReady(false);
    }
  }, []);

  if (!ready) return null;

  return (
    <div
      ref={containerRef}
      className="skin-widget"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 90,
        userSelect: 'none'
      }}
    >
      {collapsed ? (
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setCollapsed(false)}
          title="展开皮肤模型"
          style={{ borderRadius: 20, boxShadow: 'var(--shadow)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </button>
      ) : (
        <div
          style={{
            position: 'relative',
            width: 225,
            filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.35))',
            cursor: 'pointer'
          }}
          onClick={refreshSkin}
        >
          {/* 收起按钮 */}
          <button
            onClick={e => { e.stopPropagation(); setCollapsed(true); }}
            title="收起"
            aria-label="收起皮肤模型"
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              zIndex: 2,
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(0,0,0,0.35)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              lineHeight: 1
            }}
          >
            ×
          </button>
          {/* 换一换 */}
          <button
            onClick={e => { e.stopPropagation(); refreshSkin(); }}
            title="换一个皮肤"
            aria-label="换一个皮肤"
            style={{
              position: 'absolute',
              bottom: 6,
              right: 6,
              zIndex: 2,
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(0,0,0,0.35)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <SkinViewer skin={skin || undefined} width={225} height={300} autoRotate={false} animation="running" animationSpeed={0.6} zoom={0.95} />
        </div>
      )}
    </div>
  );
}
