/**
 * 玄剑姬 RAG 控制面板（挂在现有 /admin 内，不另建后台）
 *
 * 子页：概览 / 模型配置 / 索引管理 / 问答测试台 / 用量与日志
 * 权限：普通管理员可查看与测试；超管才能改密钥、模型、提示词与预算。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import RagSettingsPanel from './RagSettingsPanel';
import '../styles/rag-admin.css';

const SUB_TABS = [
  { key: 'overview', label: '概览与健康' },
  { key: 'config', label: '模型配置' },
  { key: 'index', label: '索引管理' },
  { key: 'test', label: '问答测试台' },
  { key: 'usage', label: '用量与日志' }
];

const STATUS_LABEL = {
  indexed: '已索引',
  pending: '待索引',
  stale: '内容已变更',
  failed: '索引失败',
  not_public: '不可检索'
};

function Tag({ children, tone }) {
  const cls = tone === 'bad' ? 'is-bad' : tone === 'ok' ? 'is-ok' : tone === 'warn' ? 'is-warn' : '';
  return <span className={`rag-pill ${cls}`}>{children}</span>;
}

export default function RagAdminPanel({ showToast, isSuper }) {
    const [sub, setSub] = useState('overview');
    const [status, setStatus] = useState(null);
    const [config, setConfig] = useState(null);
    const [pages, setPages] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [logs, setLogs] = useState([]);
    const [usage, setUsage] = useState([]);
    const [loading, setLoading] = useState(false);
    const [testQ, setTestQ] = useState('');
    const [testResult, setTestResult] = useState(null);
    const [draft, setDraft] = useState({});

    const toast = (m, type) => showToast && showToast(m, type);

    const loadStatus = useCallback(async () => {
        try {
            const r = await api.get('/api/faq/admin/status');
            setStatus(r);
        } catch (e) {
            toast('读取状态失败：' + e.message, 'error');
        }
    }, []);

    const loadConfig = useCallback(async () => {
        try {
            const r = await api.get('/api/faq/admin/config');
            setConfig(r);
            setDraft(r.config || {});
        } catch (e) {
            toast('读取配置失败：' + e.message, 'error');
        }
    }, []);

    const loadIndex = useCallback(async () => {
        try {
            const [p, t] = await Promise.all([api.get('/api/faq/admin/index?limit=100'), api.get('/api/faq/admin/tasks?limit=30')]);
            setPages(p.pages || []);
            setTasks(t.tasks || []);
        } catch (e) {
            toast('读取索引失败：' + e.message, 'error');
        }
    }, []);

    const loadUsage = useCallback(async () => {
        try {
            const [u, l] = await Promise.all([api.get('/api/faq/admin/usage?days=14'), api.get('/api/faq/admin/logs?limit=40')]);
            setUsage(u.usage || []);
            setLogs(l.logs || []);
        } catch (e) {
            toast('读取用量失败：' + e.message, 'error');
        }
    }, []);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    useEffect(() => {
        if (sub === 'config') void loadConfig();
        if (sub === 'index') void loadIndex();
        if (sub === 'usage') void loadUsage();
    }, [sub, loadConfig, loadIndex, loadUsage]);

    const run = async (label, fn) => {
        setLoading(true);
        try {
            await fn();
        } catch (e) {
            toast(label + '失败：' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const saveConfig = () =>
        run('保存配置', async () => {
            const r = await api.put('/api/faq/admin/config', { config: draft });
            toast(r.needRebuild ? '已保存。注意：Embedding 变更，需要全量重建索引' : '配置已保存', r.needRebuild ? 'warning' : 'success');
            await loadConfig();
            await loadStatus();
        });

    const connectivity = () =>
        run('连通性测试', async () => {
            const r = await api.post('/api/faq/admin/test/connectivity', {});
            setTestResult({ kind: 'connectivity', ...r });
            toast(r.ok ? '两家模型均连通' : '存在不通的服务，请查看结果', r.ok ? 'success' : 'error');
        });

    const testAsk = () =>
        run('测试问答', async () => {
            const r = await api.post('/api/faq/admin/test/ask', { question: testQ });
            setTestResult({ kind: 'ask', ...r });
        });

    const rebuildPage = (pageId) =>
        run('单页重建', async () => {
            await api.post(`/api/faq/admin/index/${pageId}/rebuild`, {});
            toast('已投递重建任务', 'success');
            await loadIndex();
        });

    const processTasks = () =>
        run('处理任务', async () => {
            const r = await api.post('/api/faq/admin/process-tasks', { max: 10 });
            toast('本次处理 ' + (r.results || []).length + ' 个任务', 'success');
            await loadIndex();
            await loadStatus();
        });

    const reconcile = () =>
        run('一致性核对', async () => {
            const r = await api.post('/api/faq/admin/reconcile', {});
            toast('核对完成：' + JSON.stringify(r.result), 'success');
            await loadIndex();
        });

    const fullRebuild = () => {
        if (!window.confirm('全量重建会重新 Embedding 所有已发布页面，消耗额度且耗时较长，确认继续？')) return;
        void run('全量重建', async () => {
            const r = await api.post('/api/faq/admin/rebuild', {});
            toast(r.ok ? '全量重建任务已创建（#' + r.taskId + '）' : r.reason, r.ok ? 'success' : 'error');
        });
    };

    /* ---------------- 概览 ---------------- */
    const overview = () => {
        if (!status) return <div className="admin-empty">正在读取状态…</div>;
        const s = status.stats || {};
        return (
            <div className="admin-grid">
                <div className="admin-card">
                    <h3>服务状态</h3>
                    <ul className="admin-kv">
                        <li><span>向量检索</span><b><span className={`rag-pill ${s.vec && s.vec.ready ? 'is-ok' : 'is-bad'}`}>{s.vec && s.vec.ready ? '可用 ' + s.vec.version : '不可用'}</span></b></li>
                        <li><span>全文索引</span><b>{s.vec ? 'FTS5 已就绪' : '-'}</b></li>
                        <li><span>提示词版本</span><b>{status.service && status.service.promptVersion}</b></li>
                        <li><span>熔断</span><b><span className={`rag-pill ${status.breaker && status.breaker.open ? 'is-bad' : 'is-ok'}`}>{status.breaker && status.breaker.open ? '已熔断' : '正常'}</span></b></li>
                    </ul>
                </div>
                <div className="admin-card">
                    <h3>索引规模</h3>
                    <ul className="admin-kv">
                        <li><span>已发布页面</span><b>{s.publishedPages}</b></li>
                        <li><span>已索引页面</span><b>{s.indexedPages}</b></li>
                        <li><span>分块总数</span><b>{s.chunks}</b></li>
                        <li><span>向量条数</span><b>{s.vectors}</b></li>
                        <li><span>任务状态</span><b>{JSON.stringify(s.tasks || {})}</b></li>
                    </ul>
                </div>
                <div className="admin-card">
                    <h3>今日用量 / 预算</h3>
                    <ul className="admin-kv">
                        <li><span>请求数</span><b>{(status.usage && status.usage.requests) || 0}</b></li>
                        <li><span>LLM tokens</span><b>{(status.usage && status.usage.llmTokens) || 0}</b></li>
                        <li><span>Embedding tokens</span><b>{(status.usage && status.usage.embeddingTokens) || 0}</b></li>
                        <li><span>估算花费（元）</span><b>{Number((status.usage && status.usage.cost) || 0).toFixed(4)}</b></li>
                        <li><span>每日预算</span><b>{status.budget && status.budget.limit}</b></li>
                    </ul>
                </div>
                <div className="admin-card">
                    <h3>密钥状态</h3>
                    <ul className="admin-kv">
                        <li><span>加密主密钥</span><b>{status.secrets && status.secrets.hasMasterKey ? '已配置' : '未配置（RAG_SECRET_KEY）'}</b></li>
                        <li><span>Embedding Key</span><b>{status.secrets && status.secrets.embeddingConfigured ? '已配置' : '未配置'}</b></li>
                        <li><span>LLM Key</span><b>{status.secrets && status.secrets.llmConfigured ? '已配置' : '未配置'}</b></li>
                    </ul>
                    {status.lastError && (
                        <p className="admin-warn">最近失败：{status.lastError.last_error}</p>
                    )}
                </div>
            </div>
        );
    };

    /* ---------------- 模型配置 ---------------- */
    const configView = () => (
        <RagSettingsPanel
            canEdit={!!isSuper}
            toast={showToast}
            onSaved={() => {
                void loadStatus();
            }}
        />
    );

    /* ---------------- 索引管理 ---------------- */
    const indexView = () => (
        <div className="admin-card">
            <div className="admin-actions">
                <button className="btn btn-sm btn-ghost" onClick={loadIndex}>刷新</button>
                <button className="btn btn-sm btn-ghost" disabled={loading} onClick={processTasks}>立即处理任务</button>
                <button className="btn btn-sm btn-ghost" disabled={loading} onClick={reconcile}>一致性核对</button>
                {isSuper && <button className="btn btn-sm btn-primary" disabled={loading} onClick={fullRebuild}>全量重建</button>}
            </div>

            <h3 style={{ marginTop: 16 }}>页面索引（{pages.length}）</h3>
            <table className="admin-table">
                <thead>
                    <tr><th>页面</th><th>状态</th><th>分块</th><th>内容/索引 hash</th><th>最近更新</th><th>操作</th></tr>
                </thead>
                <tbody>
                    {pages.map((p) => (
                        <tr key={p.page_id}>
                            <td>{p.title || ('#' + p.page_id)}</td>
                            <td><Tag tone={p.status === 'indexed' ? 'ok' : p.status === 'failed' ? 'bad' : undefined}>{STATUS_LABEL[p.status] || p.status}</Tag></td>
                            <td>{p.chunk_count}</td>
                            <td className="admin-mono">
                                {(p.content_hash || '').slice(0, 8)} / {(p.indexed_hash || '').slice(0, 8)}
                            </td>
                            <td className="admin-mono">{p.updated_at}</td>
                            <td>
                                <button className="btn btn-xs btn-ghost" disabled={loading} onClick={() => rebuildPage(p.page_id)}>重建</button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h3 style={{ marginTop: 18 }}>最近任务（{tasks.length}）</h3>
            <table className="admin-table">
                <thead><tr><th>ID</th><th>类型</th><th>页面</th><th>状态</th><th>尝试</th><th>错误</th></tr></thead>
                <tbody>
                    {tasks.map((t) => (
                        <tr key={t.id}>
                            <td>{t.id}</td>
                            <td>{t.type}</td>
                            <td>{t.page_id || '-'}</td>
                            <td><Tag tone={t.status === 'success' ? 'ok' : t.status === 'failed' ? 'bad' : undefined}>{t.status}</Tag></td>
                            <td>{t.attempts}</td>
                            <td className="admin-mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.last_error || ''}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    /* ---------------- 测试台 ---------------- */
    const testView = () => (
        <div className="admin-card">
            <h3>问答测试台</h3>
            <p className="admin-hint">会真实调用检索与 LLM，并展示向量 / 全文 / RRF 候选与最终来源。</p>
            <div className="admin-actions">
                <input
                    className="admin-input"
                    value={testQ}
                    onChange={(e) => setTestQ(e.target.value)}
                    placeholder="输入一个真实问题"
                    style={{ flex: 1, minWidth: 240 }}
                />
                <button className="btn btn-primary btn-sm" disabled={loading || !testQ.trim()} onClick={testAsk}>提问</button>
            </div>

            {testResult && testResult.kind === 'ask' && (
                <div style={{ marginTop: 16 }}>
                    <h4>回答</h4>
                    <div className="rag-answer">{testResult.result && testResult.result.answer}</div>
                    {testResult.result && testResult.result.sources && (
                        <>
                            <h4>来源</h4>
                            <ul className="admin-list">
                                {testResult.result.sources.map((s) => (
                                    <li key={s.pageId}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span className="admin-mono">{s.categoryPath}</span></li>
                                ))}
                            </ul>
                        </>
                    )}
                    {testResult.result && testResult.result.diagnostics && (
                        <>
                            <h4>检索诊断</h4>
                            <pre className="admin-pre">{JSON.stringify({
                                vectorCount: testResult.result.diagnostics.vectorCount,
                                ftsCount: testResult.result.diagnostics.ftsCount,
                                fusedCount: testResult.result.diagnostics.fusedCount,
                                params: testResult.result.diagnostics.params,
                                vectorTopK: testResult.result.diagnostics.vectorTopK,
                                ftsTopK: testResult.result.diagnostics.ftsTopK,
                                rrfTop: testResult.result.diagnostics.rrfTop
                            }, null, 2)}</pre>
                        </>
                    )}
                </div>
            )}
        </div>
    );

    /* ---------------- 用量与日志 ---------------- */
    const usageView = () => (
        <div className="admin-card">
            <h3>每日用量</h3>
            <table className="admin-table">
                <thead><tr><th>日期</th><th>来源</th><th>请求</th><th>LLM tokens</th><th>Embedding tokens</th><th>估算费用</th></tr></thead>
                <tbody>
                    {usage.map((u, i) => (
                        <tr key={i}>
                            <td className="admin-mono">{u.day}</td>
                            <td>{u.source_type}</td>
                            <td>{u.requests}</td>
                            <td>{u.llm_tokens}</td>
                            <td>{u.embedding_tokens}</td>
                            <td>{Number(u.cost_estimate || 0).toFixed(4)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h3 style={{ marginTop: 18 }}>最近问答日志（30 天保留）</h3>
            <table className="admin-table">
                <thead><tr><th>时间</th><th>来源</th><th>问题</th><th>状态</th><th>耗时</th><th>tokens</th></tr></thead>
                <tbody>
                    {logs.map((l) => (
                        <tr key={l.id}>
                            <td className="admin-mono">{l.created_at}</td>
                            <td>{l.source_type}</td>
                            <td style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.question}</td>
                            <td><Tag tone={l.status === 'ok' ? 'ok' : 'bad'}>{l.status}</Tag></td>
                            <td>{l.latency_ms}ms</td>
                            <td>{l.total_tokens}{l.usage_is_real ? '' : '(估算)'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    return (
        <div className="rag-admin">
            <div className="admin-tabs">
                {SUB_TABS.map((t) => (
                    <button
                        key={t.key}
                        className={`admin-tab ${sub === t.key ? 'is-active' : ''}`}
                        onClick={() => setSub(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            {sub === 'overview' && overview()}
            {sub === 'config' && configView()}
            {sub === 'index' && indexView()}
            {sub === 'test' && testView()}
            {sub === 'usage' && usageView()}
        </div>
    );
}
