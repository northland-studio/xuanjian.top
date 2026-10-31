/**
 * 管理面板 · 哲式动态指数系统（股市参数）
 *
 * 可配置：哲指数、股价基准、活跃量化基准、熔断底价、买入费率、卖出印花税
 * 另含：手动触发收盘快照、查看最近结算、查看三板块现价
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import '../styles/stock-index.css';

const FIELDS = [
    { key: 'zheIndex', label: '哲指数', hint: '公式基准乘数，默认 20（越大每次任务涨得越多）' },
    { key: 'priceBase', label: '股价指数（股价基准）', hint: '公式分母基准，默认 5；股价低于它触发熔断' },
    { key: 'activeBase', label: '活跃量化指数（活跃基准）', hint: '完成人数基准，默认 10；N=10 时系数为 1' },
    { key: 'floorPrice', label: '熔断底价', hint: '现价低于此值时禁止买入，默认 5' },
    { key: 'buyFeeRate', label: '买入手续费率', hint: '0.01 = 1%' },
    { key: 'sellTaxRate', label: '卖出印花税率', hint: '0.05 = 5%' }
];

export default function ExpressIndexAdmin({ showToast }) {
    const toast = (m, t) => showToast && showToast(m, t);
    const [settings, setSettings] = useState(null);
    const [form, setForm] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [quotes, setQuotes] = useState([]);
    const [settlements, setSettlements] = useState([]);
    const [day, setDay] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [s, q, st] = await Promise.all([
                api.get('/api/express-index/settings'),
                api.get('/api/express-index/quotes'),
                api.get('/api/express-index/settlements?limit=10')
            ]);
            setSettings(s.settings);
            setForm(s.settings);
            setQuotes(q.stocks || []);
            setSettlements(st.settlements || []);
        } catch (e) {
            toast('读取参数失败：' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const dirty = settings && FIELDS.some((f) => Number(form[f.key]) !== Number(settings[f.key]));

    const save = async () => {
        setSaving(true);
        try {
            const r = await api.put('/api/express-index/settings', form);
            setSettings(r.settings);
            setForm(r.settings);
            toast('参数已保存，立即生效', 'success');
            await load();
        } catch (e) {
            toast('保存失败：' + e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const reset = () => { setForm(settings); toast('已还原为当前生效值', 'info'); };

    const snapshot = async () => {
        try {
            const body = day ? { day } : {};
            const r = await api.post('/api/express-index/snapshot', body);
            toast(`已记录 ${r.day} 收盘快照（${r.stocks} 只板块）`, 'success');
            await load();
        } catch (e) {
            toast('快照失败：' + e.message, 'error');
        }
    };

    if (loading) return <div className="adm-card">加载中…</div>;

    return (
        <div className="adm-page">
            <div className="adm-card">
                <div className="adm-card-head">
                    <h3>哲式动态指数 · 参数配置</h3>
                    <span className="adm-pill is-good">修改后立即生效</span>
                </div>
                <p className="adm-card-desc">
                    ΔP = 哲指数 × 悬赏价 K × (完成人数 N ÷ 活跃基准) ÷ (max(现价, 股价基准) ÷ 股价基准)。
                    股价接近熔断底价时，分母按 1 计算，防止股价暴涨。
                </p>
                <div className="adm-form-grid">
                    {FIELDS.map((f) => (
                        <label className="adm-field" key={f.key}>
                            <span>{f.label}</span>
                            <input
                                className="adm-input"
                                type="number"
                                step={f.key.includes('Rate') ? '0.01' : '1'}
                                min="0"
                                value={form[f.key] === undefined ? '' : form[f.key]}
                                onChange={(e) => setForm((m) => ({ ...m, [f.key]: e.target.value }))}
                            />
                            <span className="adm-hint">{f.hint}</span>
                        </label>
                    ))}
                </div>
                <div className="adm-actions">
                    <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
                        {saving ? '保存中…' : dirty ? '保存参数' : '参数未修改'}
                    </button>
                    <button className="btn btn-ghost" onClick={reset} disabled={!dirty}>还原</button>
                    <button className="btn btn-ghost" onClick={load}>刷新</button>
                </div>
            </div>

            <div className="adm-card">
                <div className="adm-card-head">
                    <h3>收盘快照</h3>
                    <div className="adm-actions" style={{ marginTop: 0 }}>
                        <input className="adm-input" style={{ width: 150 }} placeholder="日期（可空=今天）" value={day} onChange={(e) => setDay(e.target.value)} />
                        <button className="btn btn-sm btn-primary" onClick={snapshot}>手动记录</button>
                    </div>
                </div>
                <p className="adm-card-desc">
                    每日 00:00（Asia/Shanghai）自动记录；这里可手动补记某天。快照用于前端「昨日收盘虚线」。
                </p>
            </div>

            <div className="adm-card">
                <h3>三板块现价</h3>
                <div className="adm-table-wrap">
                    <table className="adm-table">
                        <thead><tr><th>板块</th><th>现价</th><th>昨日收盘</th><th>涨跌</th><th>涨跌幅</th><th>熔断</th></tr></thead>
                        <tbody>
                            {quotes.map((q) => (
                                <tr key={q.id}>
                                    <td>{q.name}<span className="adm-mono">{q.symbol}</span></td>
                                    <td><b>{Number(q.price).toFixed(2)}</b></td>
                                    <td>{Number(q.yesterdayClose).toFixed(2)}</td>
                                    <td className={q.change > 0 ? 'is-up' : q.change < 0 ? 'is-down' : ''}>{q.change > 0 ? '+' : ''}{q.change.toFixed(2)}</td>
                                    <td className={q.change > 0 ? 'is-up' : q.change < 0 ? 'is-down' : ''}>{q.change > 0 ? '+' : ''}{q.changePct.toFixed(2)}%</td>
                                    <td>{q.floored ? <span className="adm-pill is-bad">已熔断</span> : <span className="adm-pill is-good">正常</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="adm-card">
                <h3>最近结算</h3>
                {settlements.length === 0 ? <p className="adm-hint">暂无结算记录</p> : (
                    <div className="adm-table-wrap">
                        <table className="adm-table">
                            <thead><tr><th>板块</th><th>任务</th><th>K</th><th>N</th><th>前 → 后</th><th>ΔP</th><th>时间</th></tr></thead>
                            <tbody>
                                {settlements.map((r) => (
                                    <tr key={r.id}>
                                        <td>{r.stock_name}</td>
                                        <td>{r.task_title || ('#' + r.task_id)}</td>
                                        <td>{r.reward}</td>
                                        <td>{r.finish_count}</td>
                                        <td>{Number(r.price_before).toFixed(2)} → {Number(r.price_after).toFixed(2)}</td>
                                        <td className={r.delta >= 0 ? 'is-up' : 'is-down'}>{r.delta >= 0 ? '+' : ''}{Number(r.delta).toFixed(2)}</td>
                                        <td className="adm-mono">{r.created_at}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
