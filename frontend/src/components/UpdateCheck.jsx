// 原生客户端（Electron / Capacitor）更新检测组件
// 网页版不渲染任何内容
import { useEffect, useState } from 'react';
import { platformInfo } from '../api';

// 统一原生更新 API（Promise 风格）
function createNativeApi() {
  if (platformInfo.electron && window.electronAPI) {
    const api = window.electronAPI;
    return {
      type: 'electron',
      getVersion: () => api.getVersion(),
      checkUpdate: () => api.checkUpdate(),
      downloadUpdate: () => api.downloadUpdate(),
      installUpdate: () => api.installUpdate(),
      subscribe(handlers) {
        const offs = [
          api.onUpdateAvailable?.((info) => handlers.onAvailable?.(info)),
          api.onUpdateProgress?.((p) => handlers.onProgress?.(p)),
          api.onUpdateDownloaded?.(() => handlers.onDownloaded?.()),
          api.onUpdateError?.((m) => handlers.onError?.(m)),
          api.onUpdateNotAvailable?.(() => handlers.onNoUpdate?.()),
        ].filter(Boolean);
        return () => offs.forEach((off) => off?.());
      },
    };
  }
  if (platformInfo.capacitor && window.Capacitor?.Plugins?.ApkUpdater) {
    const cap = window.Capacitor.Plugins.ApkUpdater;
    return {
      type: 'capacitor',
      getVersion: () => cap.getVersion(),
      checkUpdate: () => cap.checkUpdate(),
      downloadUpdate: () => cap.downloadAndInstall(),
      installUpdate: () => Promise.resolve({ ok: true }),
      subscribe(handlers) {
        const offProgress = cap.addListener?.('progress', (r) => handlers.onProgress?.(r.percent));
        return () => offProgress?.then((h) => h.remove?.());
      },
    };
  }
  return null;
}

export default function UpdateCheck() {
  const [state, setState] = useState({ phase: 'idle', info: null, percent: 0, error: '', version: '' });
  const [native] = useState(createNativeApi);

  useEffect(() => {
    if (!native) return;
    const off = native.subscribe({
      onAvailable: (info) => {
        let notes = [];
        if (info && Array.isArray(info.releaseNotes)) notes = info.releaseNotes;
        if (info && typeof info.releaseNotes === 'string') notes = info.releaseNotes.split(/\r?\n/).filter(Boolean);
        if (info && Array.isArray(info.notes)) notes = info.notes;
        setState((s) => ({ ...s, phase: 'available', info: { version: info?.version, notes } }));
      },
      onProgress: (p) => setState((s) => ({ ...s, percent: Math.round(p) })),
      onDownloaded: () => setState((s) => ({ ...s, phase: 'downloaded' })),
      onError: (m) => setState((s) => ({ ...s, error: m, phase: 'idle' })),
      onNoUpdate: () => setState((s) => ({ ...s, phase: 'idle', error: '' })),
    });
    // 启动时自动检查
    native.getVersion().then((v) => {
      const ver = v?.version || v;
      setState((s) => ({ ...s, version: ver }));
    }).catch(() => {});
    native.checkUpdate().catch(() => {});
    return () => off?.();
  }, [native]);

  if (!native) return null;

  const download = () => {
    setState((s) => ({ ...s, phase: 'downloading', error: '' }));
    native.downloadUpdate()
      .then((r) => {
        if (r && r.done) setState((s) => ({ ...s, phase: 'downloaded' }));
      })
      .catch((e) => setState((s) => ({ ...s, error: e?.message || String(e), phase: 'idle' })));
  };

  const install = () => {
    native.installUpdate().catch(() => {});
  };

  const manualCheck = () => {
    setState((s) => ({ ...s, error: '', phase: 'idle' }));
    native.checkUpdate()
      .then((r) => {
        if (!r) return;
        if (r.updateAvailable || r.hasUpdate) {
          setState((s) => ({
            ...s,
            phase: 'available',
            info: {
              version: r.updateInfo?.version || r.info?.versionName,
              notes: r.updateInfo?.releaseNotes || r.info?.notes || [],
            },
          }));
        } else {
          setState((s) => ({ ...s, error: '已是最新版本' }));
        }
      })
      .catch((e) => setState((s) => ({ ...s, error: e?.message || String(e) })));
  };

  const dismiss = () => setState((s) => ({ ...s, phase: 'idle', error: '' }));
  const show = ['available', 'downloading', 'downloaded'].includes(state.phase) || !!state.error;

  return (
    <>
      <button className="update-fab" onClick={manualCheck} title="检查更新" aria-label="检查更新">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>

      {show && (
        <div className="modal-overlay" onClick={dismiss}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">版本更新</div>
              <button className="modal-close" onClick={dismiss}>×</button>
            </div>
            <div className="modal-body">
              {state.error ? (
                <p className="text-secondary">{state.error}</p>
              ) : (
                <>
                  {state.version && <p className="text-secondary" style={{ fontSize: 13 }}>当前版本 v{state.version}</p>}
                  <p style={{ fontWeight: 700, marginTop: 8 }}>发现新版本 v{state.info?.version}</p>
                  {(state.info?.notes || []).map((n, i) => (
                    <p key={i} className="text-secondary" style={{ fontSize: 13, marginTop: 4 }}>· {n}</p>
                  ))}
                  {state.phase === 'downloading' && (
                    <div className="loading" style={{ padding: '16px 0' }}>
                      <div className="spinner" />
                      <p>下载中 {state.percent}%</p>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              {state.phase === 'available' && !state.error && (
                <button className="btn btn-primary" onClick={download}>下载更新</button>
              )}
              {state.phase === 'downloaded' && (
                <button className="btn btn-primary" onClick={install}>
                  {native.type === 'capacitor' ? '立即安装' : '立即安装'}
                </button>
              )}
              {!!state.error && <button className="btn" onClick={dismiss}>关闭</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
