/**
 * GIS 侧边面板集合：审核队列、地形分析、历史版本/快照、管理与空间搜索。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';

const STATUS_LABEL = { DRAFT: '草稿', REVIEW: '待审核', PUBLISHED: '已发布', REJECTED: '已驳回', ARCHIVED: '已归档' };
const TYPE_LABEL = { district: '城区', road: '道路', marker: '标记' };

function fmtBox(b) {
    if (!b) return '—';
    return `${Math.round(b.minX)},${Math.round(b.minZ)} → ${Math.round(b.maxX)},${Math.round(b.maxZ)}`;
}

/* ============================ 审核队列 ============================ */
export function GisReviewPanel({ worldId, busy, onSelect, onAction, version }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const qs = new URLSearchParams();
            if (worldId) qs.set('worldId', worldId);
            qs.set('status', 'REVIEW');
            qs.set('limit', '100');
            const d = await api.get(`/api/gis/review/queue?${qs}`);
            setItems(d.items || []);
        } catch (e) {
            setError(e.message || '加载失败');
        } finally {
            setLoading(false);
        }
    }, [worldId]);

    useEffect(() => { load(); }, [load, version]);

    return (
        <div className="gis-panel">
            <div className="gis-panel-head">
                待审核队列（{items.length}）
                <button className="gis-icon-btn" onClick={load} title="刷新">⟳</button>
            </div>
            {error && <div className="gis-error">{error}</div>}
            {loading && <div className="gis-empty">加载中…</div>}
            {!loading && items.length === 0 && <div className="gis-empty">暂无待审核提交</div>}
            <div className="gis-list">
                {items.map((o) => (
                    <div key={`${o.type}:${o.id}`} className="gis-list-row">
                        <button className="gis-link" onClick={() => onSelect(o)}>
                            <span className="gis-dim">[{TYPE_LABEL[o.type]}]</span> {o.name}
                        </button>
                        <span className="gis-dim">v{o.revision} · {o.updatedAt}</span>
                        <div className="gis-list-actions">
                            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAction('publish', o)}>通过</button>
                            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAction('reject', o)}>驳回</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ============================ 地形分析 ============================ */
export function GisTerrainPanel({ worldId, dimension, bbox, settings, onChange, refreshKey }) {
    const [coverage, setCoverage] = useState(null);
    const [stats, setStats] = useState(null);
    const [slope, setSlope] = useState(null);
    const [distribution, setDistribution] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [profile, setProfile] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [from, setFrom] = useState({ x: 0, z: 0 });
    const [to, setTo] = useState({ x: 200, z: 0 });
    const [interval, setIntervalValue] = useState(settings.interval || 10);

    const load = useCallback(async () => {
        if (!worldId || !dimension) return;
        setLoading(true);
        setError('');
        try {
            const base = `worldId=${worldId}&dimension=${dimension}`;
            const bboxQ = bbox ? `&bbox=${bbox.minX},${bbox.minZ},${bbox.maxX},${bbox.maxZ}` : '';
            const [cov, st, sl, dist, jobList] = await Promise.all([
                api.get(`/api/gis/terrain/coverage?${base}${bboxQ}`),
                bbox ? api.get(`/api/gis/terrain/stats?${base}${bboxQ}`).catch(() => null) : Promise.resolve(null),
                bbox ? api.get(`/api/gis/terrain/slope?${base}${bboxQ}&resolution=4`).catch(() => null) : Promise.resolve(null),
                bbox ? api.get(`/api/gis/terrain/distribution?${base}${bboxQ}&bucket=10`).catch(() => null) : Promise.resolve(null),
                api.get('/api/gis/jobs?limit=5').catch(() => null)
            ]);
            setCoverage(cov);
            setStats(st);
            setSlope(sl);
            setDistribution(dist);
            setJobs((jobList && jobList.items) || []);
        } catch (e) {
            setError(e.message || '地形数据加载失败');
        } finally {
            setLoading(false);
        }
    }, [worldId, dimension, bbox && bbox.minX, bbox && bbox.minZ, bbox && bbox.maxX, bbox && bbox.maxZ]);

    useEffect(() => { load(); }, [load, refreshKey]);

    const loadProfile = async () => {
        setError('');
        try {
            const pts = encodeURIComponent(JSON.stringify([[from.x, from.z], [to.x, to.z]]));
            const d = await api.get(`/api/gis/terrain/profile?worldId=${worldId}&dimension=${dimension}&points=${pts}&samples=120`);
            setProfile(d);
        } catch (e) {
            setError(e.message || '剖面计算失败');
        }
    };

    const chart = useMemo(() => {
        if (!profile || !profile.samples || !profile.samples.length) return null;
        const w = 300;
        const h = 110;
        const samples = profile.samples;
        const heights = samples.map((s) => s.height).filter((v) => v !== null);
        const min = heights.length ? Math.min(...heights) : 0;
        const max = heights.length ? Math.max(...heights) : 1;
        const span = Math.max(1, max - min);
        const points = samples.map((s, i) => {
            if (s.height === null) return null;
            const x = (i / (samples.length - 1)) * w;
            const y = h - ((s.height - min) / span) * (h - 10) - 5;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const segments = [];
        let cur = [];
        for (const p of points) {
            if (p === null) { if (cur.length) segments.push(cur.join(' ')); cur = []; }
            else cur.push(p);
        }
        if (cur.length) segments.push(cur.join(' '));
        return { w, h, segments, min, max, missing: profile.missingRanges || [] };
    }, [profile]);

    return (
        <div className="gis-panel">
            <div className="gis-panel-head">
                地形分析
                <button className="gis-icon-btn" onClick={load} title="刷新">⟳</button>
            </div>
            {error && <div className="gis-error">{error}</div>}

            <div className="gis-subhead">等高线</div>
            <div className="gis-inline">
                <label className="gis-toggle on">
                    <input type="checkbox" checked={!!settings.contour} onChange={(e) => onChange({ ...settings, contour: e.target.checked })} />
                    <span>显示等高线</span>
                </label>
                <select className="form-select gis-select-sm" value={settings.interval || 10} onChange={(e) => {
                    const v = Number(e.target.value);
                    setIntervalValue(v);
                    onChange({ ...settings, interval: v });
                }}>
                    {[5, 10, 20, 50, 100].map((v) => <option key={v} value={v}>{v} m</option>)}
                </select>
            </div>
            <div className="gis-inline">
                <label className="gis-toggle on">
                    <input type="checkbox" checked={!!settings.missing} onChange={(e) => onChange({ ...settings, missing: e.target.checked })} />
                    <span>标记无数据区</span>
                </label>
                <label className="gis-toggle on">
                    <input type="checkbox" checked={!!settings.hillshade} onChange={(e) => onChange({ ...settings, hillshade: e.target.checked })} />
                    <span>山体阴影</span>
                </label>
            </div>
            <div className="gis-hint">等高距支持 5/10/20/50/100m，按缩放自适应采样；未采集区域显示为红色虚线框，不会被当成平地。</div>

            <div className="gis-subhead">当前视野</div>
            <div className="gis-kv"><span>范围</span><b>{fmtBox(bbox)}</b></div>
            {loading && <div className="gis-empty">计算中…</div>}
            {coverage && (
                <>
                    <div className="gis-kv"><span>已采集 chunk</span><b>{coverage.chunkCount}（覆盖率 {(coverage.coverage * 100).toFixed(1)}%）</b></div>
                    <div className="gis-kv"><span>缺失 chunk</span><b>{coverage.missing ? coverage.missing.length : 0}</b></div>
                    {!coverage.hasData && <div className="gis-warn">本区域没有采集到高程数据（不会伪造地形）</div>}
                </>
            )}
            {stats && stats.hasData && (
                <>
                    <div className="gis-kv"><span>高程 min/mean/max</span><b>{stats.min} / {stats.mean} / {stats.max}</b></div>
                    <div className="gis-kv"><span>p50 / p90</span><b>{stats.p50} / {stats.p90}</b></div>
                    <div className="gis-kv"><span>标准差</span><b>{stats.stdev}</b></div>
                </>
            )}
            {slope && slope.hasData && (
                <>
                    <div className="gis-subhead">坡度</div>
                    <div className="gis-kv"><span>平均 / 最大</span><b>{slope.mean}° / {slope.max}°</b></div>
                    <div className="gis-hint">基于真实高程差分计算（网格步长 {slope.step} 方块）；缺失采样不参与坡度计算。</div>
                </>
            )}
            {distribution && distribution.hasData && (
                <>
                    <div className="gis-subhead">高程分布（每 {distribution.bucket} m）</div>
                    <div className="gis-bars">
                        {distribution.bins.map((b) => {
                            const maxCount = Math.max(...distribution.bins.map((x) => x.count));
                            return (
                                <div key={b.from} className="gis-bar-row" title={`${b.from}~${b.to} m：${b.count} 个采样`}>
                                    <span className="gis-bar-label">{b.from}</span>
                                    <span className="gis-bar-track">
                                        <span className="gis-bar-fill" style={{ width: `${maxCount ? Math.round((b.count / maxCount) * 100) : 0}%` }} />
                                    </span>
                                    <span className="gis-bar-count">{b.count}</span>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            <div className="gis-subhead">地形剖面</div>
            <div className="gis-form-row">
                <div className="form-group"><label className="form-label">起点 X</label><input className="form-input" type="number" value={from.x} onChange={(e) => setFrom({ ...from, x: Number(e.target.value) })} /></div>
                <div className="form-group"><label className="form-label">起点 Z</label><input className="form-input" type="number" value={from.z} onChange={(e) => setFrom({ ...from, z: Number(e.target.value) })} /></div>
            </div>
            <div className="gis-form-row">
                <div className="form-group"><label className="form-label">终点 X</label><input className="form-input" type="number" value={to.x} onChange={(e) => setTo({ ...to, x: Number(e.target.value) })} /></div>
                <div className="form-group"><label className="form-label">终点 Z</label><input className="form-input" type="number" value={to.z} onChange={(e) => setTo({ ...to, z: Number(e.target.value) })} /></div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={loadProfile}>计算剖面</button>
            {chart && (
                <div className="gis-chart">
                    <svg viewBox={`0 0 ${chart.w} ${chart.h}`} width="100%" height="120">
                        <rect x="0" y="0" width={chart.w} height={chart.h} fill="rgba(10,20,35,0.5)" />
                        {chart.segments.map((seg, i) => (
                            <polyline key={i} points={seg} fill="none" stroke="#4dd0e1" strokeWidth="1.6" />
                        ))}
                        <text x="4" y="12" fill="#8fa7c4" fontSize="9">{chart.max} m</text>
                        <text x="4" y={chart.h - 4} fill="#8fa7c4" fontSize="9">{chart.min} m</text>
                    </svg>
                    <div className="gis-hint">
                        长度 {profile.length} 方块 · 缺失段 {chart.missing.length ? chart.missing.map((r) => `${Math.round(r[0])}~${Math.round(r[1])}m`).join('，') : '无'}
                    </div>
                </div>
            )}
            {profile && !chart && <div className="gis-empty">剖面范围内没有高程数据</div>}
            <div className="gis-hint">等高线/统计按需计算并有面积上限；大范围预热可用「创建等高线预热任务」（异步任务，不阻塞普通接口）。</div>
            <button className="btn btn-ghost btn-sm" onClick={async () => {
                try {
                    await api.post('/api/gis/terrain/jobs', {
                        kind: 'contour-prewarm', worldId, dimension,
                        bbox: bbox ? `${bbox.minX},${bbox.minZ},${bbox.maxX},${bbox.maxZ}` : undefined,
                        interval
                    });
                    load();
                } catch (e) { setError(e.message || '任务创建失败'); }
            }}>创建等高线预热任务</button>
            {jobs.length > 0 && (
                <>
                    <div className="gis-subhead">最近异步任务</div>
                    {jobs.map((j) => (
                        <div key={j.id} className="gis-kv">
                            <span>#{j.id} {j.kind}</span>
                            <b>{j.status}{j.status === 'RUNNING' ? ` ${Math.round((j.progress || 0) * 100)}%` : ''}</b>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}

/* ============================ 历史地图 ============================ */
export function GisHistoryPanel({ worldId, dimension, bbox, canAdmin, onSnapshotView, onTimeView, onExit, onFocusBbox, version }) {
    const [snapshots, setSnapshots] = useState([]);
    const [error, setError] = useState('');
    const [asOf, setAsOf] = useState('');
    const [name, setName] = useState('');
    const [diff, setDiff] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!worldId) return;
        try {
            const d = await api.get(`/api/gis/history/snapshots?worldId=${worldId}`);
            setSnapshots(d.items || []);
        } catch (e) { setError(e.message || '快照加载失败'); }
    }, [worldId]);

    useEffect(() => { load(); }, [load, version]);

    const createSnapshot = async () => {
        setBusy(true);
        setError('');
        try {
            await api.post('/api/gis/history/snapshots', { worldId, name: name || `快照 ${new Date().toLocaleString()}`, dimension: dimension || undefined });
            setName('');
            await load();
        } catch (e) { setError(e.message || '创建快照失败'); }
        finally { setBusy(false); }
    };

    const showSnapshot = async (snap) => {
        setError('');
        try {
            const d = await api.get(`/api/gis/history/at?snapshotId=${snap.id}&bbox=${bbox ? `${bbox.minX},${bbox.minZ},${bbox.maxX},${bbox.maxZ}` : ''}`.replace(/&bbox=$/, ''));
            onSnapshotView(snap, d.objects || []);
        } catch (e) { setError(e.message || '历史视图加载失败'); }
    };

    const showTime = async () => {
        setError('');
        try {
            const qs = new URLSearchParams({ worldId, asOf });
            if (dimension) qs.set('dimension', dimension);
            if (bbox) qs.set('bbox', `${bbox.minX},${bbox.minZ},${bbox.maxX},${bbox.maxZ}`);
            const d = await api.get(`/api/gis/history/at?${qs}`);
            onTimeView(d.asOf, d.objects || []);
        } catch (e) { setError(e.message || '历史视图加载失败'); }
    };

    const showDiff = async (snap) => {
        setError('');
        try {
            const d = await api.get(`/api/gis/history/diff?snapshotId=${snap.id}&against=current`);
            setDiff(d);
        } catch (e) { setError(e.message || '差异计算失败'); }
    };

    return (
        <div className="gis-panel">
            <div className="gis-panel-head">
                历史地图
                <button className="gis-icon-btn" onClick={onExit} title="返回当前">✕</button>
            </div>
            {error && <div className="gis-error">{error}</div>}
            <div className="gis-hint">历史视图只读，不覆盖当前数据；切回「返回当前」即可恢复实时图层。</div>
            <div className="gis-inline">
                <input className="form-input" value={name} placeholder="快照名称" onChange={(e) => setName(e.target.value)} />
                <button className="btn btn-secondary btn-sm" disabled={!canAdmin || busy} onClick={createSnapshot}>创建快照</button>
            </div>
            <div className="gis-subhead">按时间查看</div>
            <div className="gis-inline">
                <input className="form-input" placeholder="2026-11-14 12:00:00" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={showTime} disabled={!asOf}>查看</button>
            </div>
            <div className="gis-subhead">快照列表（{snapshots.length}）</div>
            <div className="gis-list">
                {snapshots.length === 0 && <div className="gis-empty">暂无快照</div>}
                {snapshots.map((s) => (
                    <div key={s.id} className="gis-list-row">
                        <div>
                            <div style={{ fontWeight: 600 }}>{s.name}</div>
                            <div className="gis-dim">{s.capturedAt} · {s.objectCount} 个对象{s.dimension ? ` · ${s.dimension}` : ''}</div>
                        </div>
                        <div className="gis-list-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => showSnapshot(s)}>查看</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => showDiff(s)}>对比当前</button>
                        </div>
                    </div>
                ))}
            </div>
            {diff && (
                <>
                    <div className="gis-subhead">与当前对比（{diff.snapshot.name}）</div>
                    <div className="gis-kv"><span>新增</span><b>{diff.summary.added}</b></div>
                    <div className="gis-kv"><span>删除</span><b>{diff.summary.removed}</b></div>
                    <div className="gis-kv"><span>变更</span><b>{diff.summary.changed}</b></div>
                    {diff.changed.slice(0, 8).map((c) => (
                        <div key={`${c.after.type}:${c.after.id}`} className="gis-dim">· {c.after.name}（v{c.before.revision} → v{c.after.revision}）</div>
                    ))}
                </>
            )}
            {onFocusBbox && <button className="btn btn-ghost btn-sm" onClick={onFocusBbox}>缩放到历史范围</button>}
        </div>
    );
}

/* ============================ 空间搜索 ============================ */
export function GisSearchPanel({ worldId, dimension, bbox, onPick }) {
    const [q, setQ] = useState('');
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [restrictBbox, setRestrictBbox] = useState(false);

    const search = async (e) => {
        e && e.preventDefault();
        if (!q.trim()) return;
        setLoading(true);
        setError('');
        try {
            const qs = new URLSearchParams({ q: q.trim() });
            if (worldId) qs.set('worldId', worldId);
            if (dimension) qs.set('dimension', dimension);
            // 默认在整个世界/维度内搜索（此前强制带当前视野 bbox，用户停在原点时永远搜不到数据）
            if (restrictBbox && bbox) qs.set('bbox', `${bbox.minX},${bbox.minZ},${bbox.maxX},${bbox.maxZ}`);
            const d = await api.get(`/api/gis/search?${qs}`);
            setItems(d.items || []);
        } catch (e2) {
            setError(e2.message || '搜索失败');
            setItems([]);
        } finally { setLoading(false); }
    };

    return (
        <div className="gis-panel">
            <div className="gis-panel-head">空间搜索</div>
            <form className="gis-inline" onSubmit={search}>
                <input className="form-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="名称 / 描述关键词" maxLength={60} />
                <button className="btn btn-secondary btn-sm" type="submit" disabled={loading}>搜索</button>
            </form>
            <label className="gis-check">
                <input type="checkbox" checked={restrictBbox} onChange={(e) => setRestrictBbox(e.target.checked)} />
                <span>仅搜索当前视野范围</span>
            </label>
            {error && <div className="gis-error">{error}</div>}
            <div className="gis-hint">默认在当前世界/维度内全局搜索（只搜已发布对象）；勾选后限制在当前地图视野。</div>
            <div className="gis-list">
                {items.map((o) => (
                    <div key={`${o.type}:${o.id}`} className="gis-list-row">
                        <button className="gis-link" onClick={() => onPick(o)}>
                            <span className="gis-dim">[{TYPE_LABEL[o.type] || o.type}]</span> {o.name}
                        </button>
                        <span className="gis-dim">{STATUS_LABEL[o.status] || o.status}</span>
                    </div>
                ))}
                {!loading && items.length === 0 && q && <div className="gis-empty">没有匹配结果</div>}
            </div>
        </div>
    );
}

/* ============================ 管理（服务器/世界） ============================ */
export function GisAdminPanel({ worlds, servers, stats, canAdmin, onChanged }) {
    const [form, setForm] = useState({ serverKey: '', serverName: '', worldKey: '', mcVersion: '1.21.11' });
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const registerServer = async () => {
        setBusy(true);
        setError('');
        try {
            await api.post('/api/gis/admin/servers', {
                serverKey: form.serverKey, serverName: form.serverName, mcVersion: form.mcVersion
            });
            onChanged && onChanged();
        } catch (e) { setError(e.message || '注册服务器失败'); } finally { setBusy(false); }
    };

    const registerWorld = async () => {
        setBusy(true);
        setError('');
        try {
            await api.post('/api/gis/admin/worlds', {
                serverKey: form.serverKey, serverName: form.serverName, worldKey: form.worldKey, mcVersion: form.mcVersion
            });
            onChanged && onChanged();
        } catch (e) { setError(e.message || '注册世界失败'); } finally { setBusy(false); }
    };

    const setWorld = async (world, patch) => {
        setBusy(true);
        setError('');
        try {
            await api.put(`/api/gis/admin/worlds/${world.id}`, patch);
            onChanged && onChanged();
        } catch (e) { setError(e.message || '更新失败'); } finally { setBusy(false); }
    };

    return (
        <div className="gis-panel">
            <div className="gis-panel-head">GIS 管理</div>
            {!canAdmin && <div className="gis-warn">需要 gis.admin 权限</div>}
            {error && <div className="gis-error">{error}</div>}
            {stats && (
                <div className="gis-kv"><span>待审 / 服务器</span><b>{stats.reviewPending} / {stats.servers}</b></div>
            )}
            <div className="gis-subhead">服务器与世界（含归档）</div>
            <div className="gis-hint">
                操作步骤：① 注册服务器（serverKey，如 `yl`）→ ② 注册世界（worldKey，如 `yl-main`，绑定到服务器）→
                ③ 对真实服务器启用该世界并「设为当前」；客户端 `bootstrap` 只会拿到 ACTIVE 世界。
                归档 = 旧服世界只读保留（数据不删），新服世界设为 ACTIVE + 当前 即可切换。
            </div>
            <div className="gis-list">
                {(worlds || []).map((w) => (
                    <div key={w.id} className="gis-list-row">
                        <div>
                            <div style={{ fontWeight: 600 }}>{w.worldKey}{w.isCurrent ? ' · 当前' : ''}</div>
                            <div className="gis-dim">{w.serverKey} · {w.status} · v{w.mcVersion || '?'} · {w.dimensions.map((d) => `${d.dimension}:${d.chunkCount}`).join(' / ')}</div>
                        </div>
                        <div className="gis-list-actions">
                            {canAdmin && w.status !== 'ACTIVE' && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setWorld(w, { status: 'ACTIVE' })}>启用</button>}
                            {canAdmin && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setWorld(w, { isCurrent: true })}>设为当前</button>}
                            {canAdmin && w.status === 'ACTIVE' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setWorld(w, { status: 'ARCHIVED' })}>归档</button>}
                        </div>
                    </div>
                ))}
            </div>
            {canAdmin && (
                <>
                    <div className="gis-subhead">注册服务器（未注册服务器不得上传）</div>
                    <div className="gis-inline">
                        <input className="form-input" placeholder="serverKey（如 yl）" value={form.serverKey} onChange={(e) => setForm({ ...form, serverKey: e.target.value })} />
                        <input className="form-input" placeholder="服务器名" value={form.serverName} onChange={(e) => setForm({ ...form, serverName: e.target.value })} />
                        <button className="btn btn-secondary btn-sm" disabled={busy || !form.serverKey} onClick={registerServer}>注册</button>
                    </div>
                    <div className="gis-subhead">注册世界（客户端不能自建世界）</div>
                    <div className="gis-inline">
                        <input className="form-input" placeholder="worldKey（如 yl-main）" value={form.worldKey} onChange={(e) => setForm({ ...form, worldKey: e.target.value })} />
                        <button className="btn btn-secondary btn-sm" disabled={busy || !form.worldKey || !form.serverKey} onClick={registerWorld}>注册世界</button>
                    </div>
                    <div className="gis-hint">服务器列表：{(servers || []).map((s) => s.serverKey).join('、') || '无'}。上传策略默认 member（公会成员即可上传），可在服务端设为 token/closed。</div>
                </>
            )}
        </div>
    );
}
