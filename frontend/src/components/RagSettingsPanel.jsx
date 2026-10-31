/**
 * 玄剑姬 · RAG 设置面板（管理后台内的「模型配置」页）
 *
 * 特点：
 * - 按用途分组（模型 / 检索 / 会话 / 限流 / 预算），带中文字段名、单位与说明
 * - 数字项用 number 输入并校验范围；开关项用 switch
 * - 有未保存修改时高亮提示；支持「恢复本组默认」「恢复全部默认」
 * - 密钥单独成区：只显示脱敏状态，输入新值才会覆盖，留空不影响；清空需二次确认
 * - 修改 Embedding 模型/维度会提示「必须全量重建索引」
 * - 非超管只读
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import '../styles/rag-settings.css';

const GROUPS = [
    {
        key: 'model',
        title: '模型与端点',
        desc: 'Embedding 与 LLM 服务地址、模型名；更换模型或维度后必须全量重建索引。',
        fields: [
            { key: 'embedding.provider', label: 'Embedding 供应商', type: 'text', readOnly: true },
            { key: 'embedding.baseUrl', label: 'Embedding 端点', type: 'text', hint: 'OpenAI 兼容，通常以 /v1 结尾' },
            { key: 'embedding.model', label: 'Embedding 模型', type: 'text', hint: '默认 BAAI/bge-m3' },
            { key: 'embedding.dimension', label: '向量维度', type: 'number', min: 256, max: 4096, unit: '维', hint: 'BGE-M3 为 1024，改错会导致检索失效' },
            { key: 'embedding.batchSize', label: 'Embedding 批大小', type: 'number', min: 1, max: 64, unit: '条' },
            { key: 'embedding.maxCharsPerBatch', label: '单批最大字符', type: 'number', min: 500, max: 50000, unit: '字' },
            { key: 'llm.provider', label: 'LLM 供应商', type: 'text', readOnly: true },
            { key: 'llm.baseUrl', label: 'LLM 端点', type: 'text' },
            { key: 'llm.model', label: 'LLM 模型', type: 'text', hint: '默认 deepseek-flash' },
            { key: 'llm.disableThinking', label: '关闭思考模式', type: 'switch', hint: 'deepseek-flash 为推理模型，关闭可大幅省 token；关闭后回答更简洁' }
        ]
    },
    {
        key: 'retrieve',
        title: '检索与分块',
        desc: '分块大小决定证据粒度；TopK 与 RRF 决定召回与融合。改分块参数需要全量重建。',
        fields: [
            { key: 'rag.chunkSize', label: '分块目标长度', type: 'number', min: 120, max: 2000, unit: '字' },
            { key: 'rag.chunkOverlap', label: '分块重叠', type: 'number', min: 0, max: 400, unit: '字' },
            { key: 'rag.vectorTopK', label: '向量候选数', type: 'number', min: 1, max: 200, unit: '条' },
            { key: 'rag.ftsTopK', label: '全文候选数', type: 'number', min: 1, max: 200, unit: '条' },
            { key: 'rag.rrfK', label: 'RRF 常数 k', type: 'number', min: 1, max: 200, hint: '经验值 60' },
            { key: 'rag.finalChunkCount', label: '最终证据块数', type: 'number', min: 1, max: 20, unit: '块' },
            { key: 'rag.maxContextChars', label: '上下文最大字符', type: 'number', min: 500, max: 20000, unit: '字' },
            { key: 'rag.maxOutputTokens', label: '回答最大 tokens', type: 'number', min: 64, max: 4000, unit: 'token' }
        ]
    },
    {
        key: 'session',
        title: '会话与日志',
        fields: [
            { key: 'rag.conversationIdleTimeout', label: '会话空闲超时', type: 'number', min: 60, max: 86400, unit: '秒', hint: '30 分钟 = 1800' },
            { key: 'rag.conversationMaxTurns', label: '带入历史轮数', type: 'number', min: 0, max: 20, unit: '轮' },
            { key: 'rag.logRetentionDays', label: '问答日志保留', type: 'number', min: 1, max: 365, unit: '天' }
        ]
    },
    {
        key: 'limit',
        title: '限流与输入限制',
        desc: '网站与机器人分别计数；游客以服务端签发的匿名 cookie 为主体。',
        fields: [
            { key: 'rag.guestPerMinute', label: '游客每分钟', type: 'number', min: 1, max: 120, unit: '次' },
            { key: 'rag.guestPerDay', label: '游客每日', type: 'number', min: 1, max: 5000, unit: '次' },
            { key: 'rag.userPerMinute', label: '登录用户每分钟', type: 'number', min: 1, max: 120, unit: '次' },
            { key: 'rag.userPerDay', label: '登录用户每日', type: 'number', min: 1, max: 5000, unit: '次' },
            { key: 'rag.botPerMinute', label: '机器人每分钟', type: 'number', min: 1, max: 600, unit: '次' },
            { key: 'rag.botPerDay', label: '机器人每日', type: 'number', min: 1, max: 20000, unit: '次' },
            { key: 'rag.maxQuestionLength', label: '问题最大长度', type: 'number', min: 20, max: 2000, unit: '字' },
            { key: 'rag.maxConcurrent', label: '最大并发', type: 'number', min: 1, max: 32, unit: '个' }
        ]
    },
    {
        key: 'budget',
        title: '预算与熔断',
        desc: '费用为「按 token 估算」，用于预警与熔断，不是账单。',
        fields: [
            { key: 'rag.dailyBudget', label: '每日预算', type: 'number', min: 0, max: 1000, step: 0.1, unit: '元', hint: '0 表示不限' },
            { key: 'rag.costAlertThreshold', label: '预算预警阈值', type: 'number', min: 0, max: 1, step: 0.05, hint: '0.7 = 用掉 70% 时提示' },
            { key: 'rag.dailyTokenLimit', label: '每日 token 硬上限', type: 'number', min: 10000, max: 5000000, step: 1000, unit: 'token', hint: '超出后直接拒答，防止费用失控；默认 120000' },
            { key: 'rag.circuitBreaker', label: '启用熔断', type: 'switch' },
            { key: 'rag.circuitFailThreshold', label: '连续失败阈值', type: 'number', min: 1, max: 50, unit: '次' },
            { key: 'rag.circuitCooldownSeconds', label: '熔断冷却', type: 'number', min: 30, max: 86400, unit: '秒' },
            { key: 'rag.allowFtsOnlyFallback', label: '允许纯全文降级', type: 'switch', hint: '向量不可用时是否仍用 FTS 回答；默认关闭（避免伪装成混合检索）' }
        ]
    }
];

const ALL_FIELDS = GROUPS.flatMap((g) => g.fields);

export default function RagSettingsPanel({ canEdit, onSaved, toast }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [server, setServer] = useState({});
    const [defaults, setDefaults] = useState({});
    const [draft, setDraft] = useState({});
    const [secrets, setSecrets] = useState(null);
    const [secretInputs, setSecretInputs] = useState({});
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [openGroups, setOpenGroups] = useState(() => new Set(GROUPS.map((g) => g.key)));

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const r = await api.get('/api/faq/admin/config');
            setServer(r.config || {});
            setDefaults(r.defaults || {});
            setDraft(r.config || {});
            setSecrets(r.secrets || null);
            setSecretInputs({});
        } catch (e) {
            setError(e.message || '读取配置失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const dirtyKeys = useMemo(
        () => ALL_FIELDS.filter((f) => String(draft[f.key] ?? '') !== String(server[f.key] ?? '')).map((f) => f.key),
        [draft, server]
    );
    const secretDirty = useMemo(
        () => Object.entries(secretInputs).filter(([, v]) => String(v || '').trim()).map(([k]) => k),
        [secretInputs]
    );
    const dirty = dirtyKeys.length + secretDirty.length > 0;

    const embeddingChanged = useMemo(() => {
        const keys = ['embedding.model', 'embedding.dimension', 'rag.chunkSize', 'rag.chunkOverlap'];
        return keys.some((k) => dirtyKeys.includes(k));
    }, [dirtyKeys]);

    const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

    const save = async () => {
        if (!canEdit) return;
        setSaving(true);
        setError('');
        setNotice('');
        try {
            const config = {};
            for (const k of dirtyKeys) config[k] = draft[k];
            for (const k of secretDirty) config[k] = secretInputs[k];
            const r = await api.put('/api/faq/admin/config', { config });
            const written = (r.written || []).length;
            setNotice(`已保存 ${written} 项${r.needRebuild ? '；Embedding/分块参数已变更，请到「索引管理」执行全量重建' : ''}`);
            if (typeof toast === 'function') toast('RAG 配置已保存', 'success');
            await load();
            if (typeof onSaved === 'function') onSaved();
        } catch (e) {
            setError(e.message || '保存失败');
        } finally {
            setSaving(false);
        }
    };

    const resetGroup = (group) => {
        setDraft((d) => {
            const next = { ...d };
            for (const f of group.fields) next[f.key] = defaults[f.key] !== undefined ? defaults[f.key] : server[f.key];
            return next;
        });
    };

    const resetAll = () => {
        setDraft({ ...defaults });
        setSecretInputs({});
    };

    const clearSecret = async (slot) => {
        if (!canEdit) return;
        if (!window.confirm(`确认清空 ${slot === 'embedding' ? 'Embedding' : 'LLM'} 密钥？清空后相关调用会失败，直到重新配置。`)) return;
        try {
            await api.post('/api/faq/admin/config/clear-secret', { slot });
            setNotice('已清空密钥');
            await load();
        } catch (e) {
            setError(e.message || '清空失败');
        }
    };

    if (loading) return <div className="admin-empty">正在读取 RAG 配置…</div>;

    return (
        <div className="adm-page">
            <div className="adm-toolbar">
                <div className="adm-page-status">
                    {dirty ? <span className="rag-dirty">有 {dirtyKeys.length + secretDirty.length} 项未保存</span> : <span className="rag-clean">配置与服务端一致</span>}
                    {!canEdit && <span className="rag-readonly">只读（需要超级管理员）</span>}
                </div>
                <div className="adm-page-actions">
                    <button className="btn btn-sm btn-ghost" onClick={resetAll} disabled={!canEdit || saving}>恢复全部默认</button>
                    <button className="btn btn-sm btn-primary" onClick={save} disabled={!canEdit || saving || !dirty}>
                        {saving ? '保存中…' : '保存修改'}
                    </button>
                </div>
            </div>

            {error && <div className="adm-alert adm-alert is-bad">{error}</div>}
            {notice && <div className="adm-alert adm-alert is-good">{notice}</div>}
            {embeddingChanged && (
                <div className="adm-alert adm-alert is-warn">
                    Embedding 模型 / 维度 / 分块参数有改动：保存后旧向量会按版本失效，必须到「索引管理」执行全量重建才能恢复问答。
                </div>
            )}

            <section className="adm-card">
                <div className="adm-card-head">
                    <div>
                        <h4>API 密钥</h4>
                        <p className="adm-card-desc">
                            使用 AES-256-GCM 加密存库，接口只返回脱敏状态。留空表示不修改；需要更换时输入新 Key。
                        </p>
                    </div>
                </div>
                <div className="adm-form-grid">
                    {[
                        { slot: 'embedding', key: 'embedding.apiKey', label: 'Embedding API Key', state: secrets && secrets.embedding },
                        { slot: 'llm', key: 'llm.apiKey', label: 'LLM API Key', state: secrets && secrets.llm }
                    ].map((s) => (
                        <div className="adm-field" key={s.key}>
                            <label className="adm-label">
                                {s.label}
                                {s.state && s.state.configured ? (
                                    <span className="adm-pill adm-pill is-good">已配置 {s.state.masked}（{s.state.source === 'env' ? '环境变量' : '数据库加密'}）</span>
                                ) : (
                                    <span className="adm-pill adm-pill is-bad">未配置</span>
                                )}
                            </label>
                            <div className="rag-secret-row">
                                <input
                                    type="password"
                                    className="adm-input"
                                    placeholder={canEdit ? '输入新 Key（留空不改）' : '只读'}
                                    disabled={!canEdit || saving}
                                    value={secretInputs[s.key] || ''}
                                    onChange={(e) => setSecretInputs((v) => ({ ...v, [s.key]: e.target.value }))}
                                />
                                {canEdit && (
                                    <button className="btn btn-sm btn-ghost" onClick={() => clearSecret(s.slot)} disabled={saving}>
                                        清空
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                {secrets && !secrets.hasMasterKey && (
                    <div className="adm-alert adm-alert is-warn">
                        未配置加密主密钥 <code>RAG_SECRET_KEY</code>，无法保存密钥。请在服务端 .env 中设置后重启。
                    </div>
                )}
            </section>

            {GROUPS.map((g) => {
                const open = openGroups.has(g.key);
                return (
                    <section className="adm-card" key={g.key}>
                        <button
                            type="button"
                            className="adm-card-head is-clickable"
                            onClick={() =>
                                setOpenGroups((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(g.key)) next.delete(g.key);
                                    else next.add(g.key);
                                    return next;
                                })
                            }
                        >
                            <div>
                                <h4>
                                    {g.title}
                                    <span className="rag-toggle">{open ? '收起' : '展开'}</span>
                                </h4>
                                {g.desc && <p className="adm-card-desc">{g.desc}</p>}
                            </div>
                        </button>

                        {open && (
                            <>
                                <div className="adm-form-grid">
                                    {g.fields.map((f) => {
                                        const changed = dirtyKeys.includes(f.key);
                                        return (
                                            <div className={`adm-field ${changed ? 'is-changed' : ''}`} key={f.key}>
                                                <label className="adm-label">
                                                    {f.label}
                                                    {f.unit && <em className="adm-stat-label">{f.unit}</em>}
                                                    {changed && <span className="rag-changed">已改</span>}
                                                </label>
                                                {f.type === 'switch' ? (
                                                    <button
                                                        type="button"
                                                        className={`adm-switch ${draft[f.key] ? 'is-on' : ''}`}
                                                        disabled={!canEdit || saving}
                                                        onClick={() => setField(f.key, !draft[f.key])}
                                                        aria-pressed={!!draft[f.key]}
                                                    >
                                                        <i />
                                                        <span>{draft[f.key] ? '开启' : '关闭'}</span>
                                                    </button>
                                                ) : (
                                                    <input
                                                        className="adm-input"
                                                        type={f.type === 'number' ? 'number' : 'text'}
                                                        min={f.min}
                                                        max={f.max}
                                                        step={f.step || (f.type === 'number' ? 1 : undefined)}
                                                        disabled={!canEdit || f.readOnly || saving}
                                                        value={draft[f.key] === undefined ? '' : draft[f.key]}
                                                        onChange={(e) => setField(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
                                                    />
                                                )}
                                                {f.hint && <p className="adm-hint">{f.hint}</p>}
                                            </div>
                                        );
                                    })}
                                </div>
                                {canEdit && (
                                    <button className="btn btn-sm btn-quiet" onClick={() => resetGroup(g)} disabled={saving}>
                                        恢复本组默认
                                    </button>
                                )}
                            </>
                        )}
                    </section>
                );
            })}
        </div>
    );
}
