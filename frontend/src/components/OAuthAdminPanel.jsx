/**
 * 管理面板 · OAuth 应用管理
 *
 * 功能：已注册应用列表、注册新应用（密钥只显示一次）、轮换密钥、启停、接入审计日志
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import '../styles/rag-admin.css';

const SCOPES = [
    { id: 'read:user', label: '基础资料' },
    { id: 'read:member', label: '成员身份' },
    { id: 'cdn:read', label: 'CDN 资源' }
];

export default function OAuthAdminPanel({ showToast, isAdmin }) {
    const toast = (m, t) => showToast && showToast(m, t);
    const [clients, setClients] = useState([]);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState(null);
    const [form, setForm] = useState({ client_id: '', name: '', description: '', redirect_uris: '', allowed_scopes: ['read:user', 'read:member'], is_confidential: true });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [c, a] = await Promise.all([
                api.get('/api/oauth/clients'),
                api.get('/api/oauth/audit?limit=20').catch(() => ({ logs: [] }))
            ]);
            setClients(c.clients || []);
            setLogs(a.logs || []);
        } catch (e) {
            toast('读取应用失败：' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const create = async () => {
        const uris = form.redirect_uris.split('\n').map((s) => s.trim()).filter(Boolean);
        if (!form.client_id.trim() || !uris.length) return toast('请填写 client_id 与至少一个回调地址', 'error');
        setCreating(true);
        try {
            const r = await api.post('/api/oauth/clients', {
                client_id: form.client_id.trim(),
                name: form.name.trim() || form.client_id.trim(),
                description: form.description,
                is_confidential: form.is_confidential,
                redirect_uris: uris,
                allowed_scopes: form.allowed_scopes,
                owner_contact: 'northland@xuanjian.top'
            });
            setCreated({ client_id: r.client_id, client_secret: r.client_secret });
            setForm({ client_id: '', name: '', description: '', redirect_uris: '', allowed_scopes: ['read:user', 'read:member'], is_confidential: true });
            toast('应用已注册', 'success');
            await load();
        } catch (e) {
            toast('注册失败：' + e.message, 'error');
        } finally {
            setCreating(false);
        }
    };

    const rotate = async (id) => {
        if (!window.confirm('轮换密钥后旧密钥立即失效，需同步更新应用配置，确认继续？')) return;
        try {
            const r = await api.post(`/api/oauth/clients/${id}/rotate-secret`, {});
            setCreated({ client_id: r.client_id || ('id ' + id), client_secret: r.client_secret });
            toast('密钥已轮换，请立即保存', 'success');
            await load();
        } catch (e) {
            toast('轮换失败：' + e.message, 'error');
        }
    };

    const toggle = async (c) => {
        try {
            if (c.is_active) await api.delete(`/api/oauth/clients/${c.id}`);
            else await api.put(`/api/oauth/clients/${c.id}`, { is_active: true });
            toast(c.is_active ? '应用已停用' : '应用已启用', 'success');
            await load();
        } catch (e) {
            toast('操作失败：' + e.message, 'error');
        }
    };

    const toggleScope = (id) => {
        setForm((f) => ({
            ...f,
            allowed_scopes: f.allowed_scopes.includes(id) ? f.allowed_scopes.filter((s) => s !== id) : [...f.allowed_scopes, id]
        }));
    };

    if (!isAdmin) return <div className="adm-card"><p className="adm-warn">需要管理员权限</p></div>;
    if (loading) return <div className="adm-card">加载中…</div>;

    return (
        <div className="adm-page">
            {created && (
                <div className="adm-card" style={{ borderColor: 'var(--primary)' }}>
                    <h3>密钥已生成（仅显示一次）</h3>
                    <ul className="adm-kv">
                        <li><span>client_id</span><b>{created.client_id}</b></li>
                        <li><span>client_secret</span><b className="adm-mono">{created.client_secret || '（公共客户端，无密钥）'}</b></li>
                    </ul>
                    <p className="adm-hint">请立即复制保存，关闭后无法再次查看；丢失只能轮换。</p>
                    <div className="adm-actions">
                        <button className="btn btn-sm btn-ghost" onClick={() => setCreated(null)}>我已保存</button>
                    </div>
                </div>
            )}

            <div className="adm-card">
                <div className="adm-card-head">
                    <h3>已注册应用</h3>
                    <button className="btn btn-sm btn-ghost" onClick={load}>刷新</button>
                </div>
                <div className="adm-table-wrap">
                    <table className="adm-table">
                        <thead><tr><th>client_id</th><th>名称</th><th>类型</th><th>回调地址</th><th>权限</th><th>状态</th><th>最近使用</th><th>操作</th></tr></thead>
                        <tbody>
                            {clients.map((c) => (
                                <tr key={c.id}>
                                    <td><b>{c.client_id}</b></td>
                                    <td>{c.name}</td>
                                    <td>{c.is_confidential ? '机密' : '公共(PKCE)'}</td>
                                    <td className="adm-mono" style={{ maxWidth: 220, wordBreak: 'break-all' }}>{(c.redirect_uris || []).join(' , ')}</td>
                                    <td className="adm-mono">{(c.allowed_scopes || []).join(' ')}</td>
                                    <td>{c.is_active ? <span className="adm-pill is-good">启用</span> : <span className="adm-pill is-bad">停用</span>}</td>
                                    <td className="adm-mono">{c.last_used_at || '—'}</td>
                                    <td>
                                        {c.is_confidential && <button className="btn btn-xs btn-ghost" onClick={() => rotate(c.id)}>轮换密钥</button>}
                                        <button className="btn btn-xs btn-ghost" onClick={() => toggle(c)}>{c.is_active ? '停用' : '启用'}</button>
                                    </td>
                                </tr>
                            ))}
                            {!clients.length && <tr><td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>暂无应用</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="adm-card">
                <h3>注册新应用</h3>
                <div className="adm-form-grid">
                    <label className="adm-field"><span>client_id</span>
                        <input className="adm-input" placeholder="小写字母/数字/-/_/." value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
                        <span className="adm-hint">如 pcl2-launcher、nork</span>
                    </label>
                    <label className="adm-field"><span>显示名称</span>
                        <input className="adm-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </label>
                    <label className="adm-field"><span>类型</span>
                        <select className="adm-input" value={form.is_confidential ? '1' : '0'} onChange={(e) => setForm({ ...form, is_confidential: e.target.value === '1' })}>
                            <option value="1">机密客户端（有服务端，用 client_secret）</option>
                            <option value="0">公共客户端（桌面/移动，用 PKCE）</option>
                        </select>
                    </label>
                    <label className="adm-field"><span>回调地址</span>
                        <textarea className="adm-input" rows={3} placeholder="一行一个，如 https://app.example.com/callback" value={form.redirect_uris} onChange={(e) => setForm({ ...form, redirect_uris: e.target.value })} />
                        <span className="adm-hint">严格全等匹配，不做通配</span>
                    </label>
                </div>
                <div className="adm-field" style={{ marginTop: 8 }}>
                    <span>权限范围</span>
                    <div className="adm-actions" style={{ marginTop: 0 }}>
                        {SCOPES.map((s) => (
                            <button key={s.id} className={'btn btn-sm ' + (form.allowed_scopes.includes(s.id) ? 'btn-primary' : 'btn-ghost')} onClick={() => toggleScope(s.id)}>
                                {s.label}（{s.id}）
                            </button>
                        ))}
                    </div>
                </div>
                <div className="adm-actions">
                    <button className="btn btn-primary" onClick={create} disabled={creating}>{creating ? '注册中…' : '注册应用'}</button>
                </div>
            </div>

            <div className="adm-card">
                <h3>接入审计</h3>
                <div className="adm-table-wrap">
                    <table className="adm-table">
                        <thead><tr><th>时间</th><th>事件</th><th>应用</th><th>用户</th><th>IP</th><th>详情</th></tr></thead>
                        <tbody>
                            {logs.map((l) => (
                                <tr key={l.id}>
                                    <td className="adm-mono">{l.created_at}</td>
                                    <td>{l.event}</td>
                                    <td className="adm-mono">{l.client_id || '—'}</td>
                                    <td>{l.user_nickname || l.user_id || '—'}</td>
                                    <td className="adm-mono">{l.ip || '—'}</td>
                                    <td className="adm-mono" style={{ maxWidth: 220, wordBreak: 'break-all' }}>{l.detail || '—'}</td>
                                </tr>
                            ))}
                            {!logs.length && <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>暂无记录</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
