/**
 * 换服集体贡献点折算面板（管理后台 · 超级管理员）
 *
 * 流程：选比例规则 → 生成预览（不写数据）→ 看每个人的前后值 → 确认应用 → 可撤销
 * 两种模式：
 *   - 统一比例：全员 ×同一个系数
 *   - 排名区间：按贡献点排名，不同区间用不同系数
 * 默认排除集市托管账户与系统账号（level<0）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import '../styles/contribution-conversion.css';

const ROUND_MODES = [
    { key: 'round', label: '四舍五入' },
    { key: 'floor', label: '向下取整' },
    { key: 'ceil', label: '向上取整' }
];

export default function ContributionConversionPanel({ showToast, isAdmin }) {
    const toast = (m, t) => showToast && showToast(m, t);

    const [stats, setStats] = useState(null);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState('uniform');
    const [uniformRatio, setUniformRatio] = useState('0.5');
    const [tiers, setTiers] = useState([
        { from: 1, to: 10, ratio: '1.2' },
        { from: 11, to: 30, ratio: '1.0' },
        { from: 31, to: '', ratio: '0.8' }
    ]);
    const [scope, setScope] = useState('positive');
    const [roundMode, setRoundMode] = useState('round');
    const [minResult, setMinResult] = useState('0');
    const [note, setNote] = useState('');
    const [preview, setPreview] = useState(null);
    const [conversions, setConversions] = useState([]);
    const [detail, setDetail] = useState(null);
    const [filter, setFilter] = useState('');

    const loadCandidates = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get(`/api/contributions/conversion/candidates?scope=${scope}`);
            setUsers(r.users || []);
            setStats(r.stats || null);
        } catch (e) {
            toast('读取成员失败：' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [scope]);

    const loadConversions = useCallback(async () => {
        try {
            const r = await api.get('/api/contributions/conversion/list?limit=20');
            setConversions(r.conversions || []);
        } catch (e) {
            /* 静默 */
        }
    }, []);

    useEffect(() => {
        void loadCandidates();
        void loadConversions();
    }, [loadCandidates, loadConversions]);

    const doPreview = async () => {
        setLoading(true);
        setPreview(null);
        try {
            const body = {
                mode,
                scope,
                roundMode,
                minResult: Number(minResult) || 0,
                note,
                ...(mode === 'uniform'
                    ? { uniformRatio: Number(uniformRatio) }
                    : {
                        tiers: tiers.map((t) => ({
                            from: Number(t.from),
                            to: t.to === '' || t.to === null ? null : Number(t.to),
                            ratio: Number(t.ratio)
                        }))
                    })
            };
            const r = await api.post('/api/contributions/conversion/preview', body);
            setPreview(r);
            toast(`预览已生成（${r.summary.affected} 人参与）`, 'success');
            await loadConversions();
        } catch (e) {
            toast('生成预览失败：' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const doApply = async (id) => {
        if (!window.confirm(`确认应用折算批次 #${id}？\n这会直接修改所有参与成员的贡献点，请再确认一次。`)) return;
        setLoading(true);
        try {
            const r = await api.post(`/api/contributions/conversion/${id}/apply`, {});
            toast(`已应用：#${r.id}，影响 ${r.affected} 人`, 'success');
            setPreview(null);
            await Promise.all([loadCandidates(), loadConversions()]);
        } catch (e) {
            toast('应用失败：' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const doRevert = async (id) => {
        if (!window.confirm(`撤销批次 #${id}？将把所有仍停留在折算后值的成员恢复为折算前。`)) return;
        setLoading(true);
        try {
            const r = await api.post(`/api/contributions/conversion/${id}/revert`, {});
            toast(`已撤销：#${r.id}，影响 ${r.affected} 人`, 'success');
            await Promise.all([loadCandidates(), loadConversions()]);
        } catch (e) {
            toast('撤销失败：' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const doDelete = async (id) => {
        if (!window.confirm(`删除预览批次 #${id}？`)) return;
        try {
            await api.delete(`/api/contributions/conversion/${id}`);
            toast('已删除预览', 'success');
            await loadConversions();
        } catch (e) {
            toast('删除失败：' + e.message, 'error');
        }
    };

    const openDetail = async (id) => {
        try {
            const r = await api.get(`/api/contributions/conversion/${id}`);
            setDetail(r.conversion);
        } catch (e) {
            toast('读取明细失败：' + e.message, 'error');
        }
    };

    const filteredUsers = useMemo(() => {
        const f = filter.trim().toLowerCase();
        if (!f) return users;
        return users.filter((u) => String(u.nickname || '').toLowerCase().includes(f) || String(u.username || '').toLowerCase().includes(f));
    }, [users, filter]);

    if (!isAdmin) {
        return (
            <div className="adm-card">
                <h3>换服贡献点折算</h3>
                <p className="adm-warn">该功能会批量修改全站贡献点，需要管理员权限。</p>
            </div>
        );
    }


    return (
        <div className="adm-page">
            {/* 概览 */}
            <div className="adm-card">
                <h3>当前站点贡献点概况</h3>
                <div className="adm-stats">
                    <div className="adm-stat"><span className="adm-stat-label">注册用户</span><b className="adm-stat-value">{stats ? stats.totalUsers : '-'}</b></div>
                    <div className="adm-stat"><span className="adm-stat-label">持有贡献点</span><b className="adm-stat-value">{stats ? stats.withPoints : '-'}</b></div>
                    <div className="adm-stat"><span className="adm-stat-label">贡献点总额</span><b className="adm-stat-value">{stats ? stats.totalPoints : '-'}</b></div>
                    <div className="adm-stat"><span className="adm-stat-label">参与折算</span><b className="adm-stat-value">{stats ? stats.participants : '-'}</b></div>
                    <div className="adm-stat"><span className="adm-stat-label">已排除</span><b className="adm-stat-value">{stats ? stats.excluded : '-'}</b></div>
                </div>
                <p className="adm-hint">
                    默认排除：集市托管账户（market_escrow）、系统账号（level &lt; 0）。冻结账号可通过「参与范围」控制。
                </p>
            </div>

            {/* 规则配置 */}
            <div className="adm-card">
                <h3>折算规则</h3>

                <div className="adm-field">
                    <label>折算模式</label>
                    <div className="adm-tabs">
                        <button className={mode === 'uniform' ? 'is-active' : ''} onClick={() => setMode('uniform')}>统一比例</button>
                        <button className={mode === 'tiers' ? 'is-active' : ''} onClick={() => setMode('tiers')}>按排名区间</button>
                    </div>
                </div>

                {mode === 'uniform' ? (
                    <div className="adm-field">
                        <label>统一比例</label>
                        <div className="conv-inline">
                            <span>×</span>
                            <input className="adm-input" type="number" step="0.01" min="0" max="10" value={uniformRatio} onChange={(e) => setUniformRatio(e.target.value)} />
                            <span className="conv-sub">
                                例：0.5 = 全员减半；1.0 = 不变；1.2 = 全员上浮 20%
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="conv-tiers">
                        <div className="adm-tier-head">
                            <span>起始名次</span><span>结束名次</span><span>比例</span><span>操作</span>
                        </div>
                        {tiers.map((t, i) => (
                            <div className="adm-tier-row" key={i}>
                                <input className="adm-input" type="number" min="1" value={t.from} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
                                <input
                                    className="adm-input adm-tier-input"
                                    type="number"
                                    min="1"
                                    placeholder="留空=到末尾"
                                    value={t.to}
                                    onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                                />
                                <input className="adm-input" type="number" step="0.01" min="0" value={t.ratio} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, ratio: e.target.value } : x)))} />
                                <button className="btn btn-sm btn-ghost" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} disabled={tiers.length <= 1}>删除</button>
                            </div>
                        ))}
                        <button className="btn btn-sm btn-quiet" onClick={() => setTiers([...tiers, { from: '', to: '', ratio: '1.0' }])}>新增区间</button>
                    </div>
                )}

                <div className="adm-field">
                    <label>参与范围</label>
                    <div className="adm-tabs">
                        <button className={scope === 'positive' ? 'is-active' : ''} onClick={() => setScope('positive')}>贡献点 &gt; 0</button>
                        <button className={scope === 'active' ? 'is-active' : ''} onClick={() => setScope('active')}>未冻结</button>
                    </div>
                </div>

                <div className="adm-field">
                    <label>取整方式</label>
                    <div className="adm-tabs">
                        {ROUND_MODES.map((m) => (
                            <button key={m.key} className={roundMode === m.key ? 'is-active' : ''} onClick={() => setRoundMode(m.key)}>{m.label}</button>
                        ))}
                    </div>
                </div>

                <div className="adm-field">
                    <label>结果下限</label>
                    <div className="conv-inline">
                        <input className="adm-input" type="number" min="0" value={minResult} onChange={(e) => setMinResult(e.target.value)} />
                        <span className="conv-sub">折算后不低于该值（默认 0，避免出现负数）</span>
                    </div>
                </div>

                <div className="adm-field">
                    <label>备注</label>
                    <input className="adm-input conv-wide" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：2026 换服第一轮折算" maxLength={100} />
                </div>

                <div className="adm-actions">
                    <button className="btn btn-primary" onClick={doPreview} disabled={loading}>
                        {loading ? '处理中…' : '生成预览'}
                    </button>
                    <button className="btn btn-ghost" onClick={loadCandidates} disabled={loading}>刷新成员</button>
                </div>
            </div>

            {/* 预览 */}
            {preview && (
                <div className="adm-card">
                    <h3>
                        预览结果（批次 #{preview.conversionId}，尚未写入）
                    </h3>
                    <div className="adm-stats">
                        <div className="adm-stat"><span className="adm-stat-label">参与人数</span><b className="adm-stat-value">{preview.summary.affected}</b></div>
                        <div className="adm-stat"><span className="adm-stat-label">未参与</span><b className="adm-stat-value">{preview.summary.skipped}</b></div>
                        <div className="adm-stat"><span className="adm-stat-label">折算前总额</span><b className="adm-stat-value">{preview.summary.totalBefore}</b></div>
                        <div className="adm-stat"><span className="adm-stat-label">折算后总额</span><b className="adm-stat-value">{preview.summary.totalAfter}</b></div>
                        <div className="adm-stat"><span className="adm-stat-label">净变化</span><b className={preview.summary.totalDelta < 0 ? 'conv-down' : 'conv-up'}>{preview.summary.totalDelta}</b></div>
                    </div>
                    <div className="adm-table-wrap">
                        <table className="adm-table">
                            <thead>
                                <tr><th>排名</th><th>成员</th><th>折算前</th><th>比例</th><th>折算后</th><th>变化</th></tr>
                            </thead>
                            <tbody>
                                {(preview.items || []).map((it) => (
                                    <tr key={it.userId}>
                                        <td>{it.rank}</td>
                                        <td>{it.nickname || it.username}<span className="adm-mono">{it.username}</span></td>
                                        <td>{it.beforeValue}</td>
                                        <td>×{it.ratio}</td>
                                        <td><b>{it.afterValue}</b></td>
                                        <td className={it.delta < 0 ? 'conv-down' : it.delta > 0 ? 'conv-up' : ''}>{it.delta > 0 ? '+' : ''}{it.delta}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="adm-actions">
                        <button className="btn btn-danger" onClick={() => doApply(preview.conversionId)} disabled={loading}>确认应用</button>
                        <button className="btn btn-ghost" onClick={() => setPreview(null)}>放弃预览</button>
                    </div>
                </div>
            )}

            {/* 批次历史 */}
            <div className="adm-card">
                <h3>折算批次历史</h3>
                {conversions.length === 0 && <p className="adm-hint">暂无批次</p>}
                {conversions.length > 0 && (
                    <div className="adm-table-wrap">
                        <table className="adm-table">
                            <thead>
                                <tr><th>#</th><th>模式</th><th>状态</th><th>人数</th><th>前 → 后</th><th>操作人</th><th>时间</th><th>操作</th></tr>
                            </thead>
                            <tbody>
                                {conversions.map((c) => (
                                    <tr key={c.id}>
                                        <td>{c.id}</td>
                                        <td>{c.mode === 'uniform' ? `统一 ×${c.uniform_ratio}` : '按区间'}</td>
                                        <td>
                                            <span className={`conv-pill conv-pill-${c.status}`}>
                                                {c.status === 'preview' ? '预览' : c.status === 'applied' ? '已应用' : '已撤销'}
                                            </span>
                                        </td>
                                        <td>{c.affected}</td>
                                        <td>{c.total_before} → {c.total_after}</td>
                                        <td>{c.operator_name || '-'}</td>
                                        <td className="adm-mono">{c.applied_at || c.created_at}</td>
                                        <td>
                                            <button className="btn btn-xs btn-ghost" onClick={() => openDetail(c.id)}>明细</button>
                                            {c.status === 'preview' && <button className="btn btn-xs btn-ghost" onClick={() => doDelete(c.id)}>删除</button>}
                                            {c.status === 'applied' && <button className="btn btn-xs btn-ghost" onClick={() => doRevert(c.id)}>撤销</button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 明细弹层 */}
            {detail && (
                <div className="adm-card">
                    <h3>批次 #{detail.id} 明细（{detail.items ? detail.items.length : 0} 人）</h3>
                    <div className="adm-table-wrap" style={{ maxHeight: 420 }}>
                        <table className="adm-table">
                            <thead><tr><th>排名</th><th>成员</th><th>前</th><th>比例</th><th>后</th><th>变化</th></tr></thead>
                            <tbody>
                                {(detail.items || []).map((it) => (
                                    <tr key={it.id}>
                                        <td>{it.rank}</td>
                                        <td>{it.nickname || it.username}</td>
                                        <td>{it.before_value}</td>
                                        <td>×{it.ratio}</td>
                                        <td>{it.after_value}</td>
                                        <td className={it.delta < 0 ? 'conv-down' : it.delta > 0 ? 'conv-up' : ''}>{it.delta > 0 ? '+' : ''}{it.delta}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="adm-actions">
                        <button className="btn btn-ghost" onClick={() => setDetail(null)}>关闭</button>
                    </div>
                </div>
            )}

            {/* 成员名单 */}
            <div className="adm-card">
                <h3>参与成员名单（按贡献点排名）</h3>
                <input className="adm-input" style={{ maxWidth: 260 }} placeholder="搜索昵称 / 用户名" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <div className="adm-table-wrap" style={{ maxHeight: 380 }}>
                    <table className="adm-table">
                        <thead><tr><th>排名</th><th>成员</th><th>贡献点</th><th>状态</th></tr></thead>
                        <tbody>
                            {filteredUsers.map((u) => (
                                <tr key={u.id} className={u.excluded ? 'is-excluded' : ''}>
                                    <td>{u.rank}</td>
                                    <td>{u.nickname || u.username}<span className="adm-mono">{u.username}</span></td>
                                    <td>{u.contribution}</td>
                                    <td>{u.excluded ? <span className="conv-pill conv-pill-excluded">已排除</span> : u.is_frozen ? <span className="conv-pill conv-pill-frozen">冻结</span> : '正常'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
