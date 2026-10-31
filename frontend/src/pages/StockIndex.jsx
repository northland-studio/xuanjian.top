/**
 * 股市 · 哲式动态指数系统（简化版展示）
 *
 * 设计原则：不显示 K 线等专业图线，只给普通人看得懂的信息
 *  - 现价 / 涨跌 / 涨跌额 / 涨跌幅
 *  - 用虚线标出「昨日收盘价」，让「今天比昨天贵还是便宜」一目了然
 *  - 熔断状态提示（股价低于底价时禁止买入，显示为禁用按钮）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import '../styles/stock-index.css';

const BOARD_ICONS = { 'XJ-HEAVY': '⚙️', 'XJ-BUILD': '🏗️', 'XJ-LABOR': '👷' };

function fmt(n, digits = 2) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(digits);
}

/** 价格区间条：现价 vs 昨日收盘（虚线） */
function PriceBar({ price, yesterday }) {
    const lo = Math.min(price, yesterday) * 0.98;
    const hi = Math.max(price, yesterday) * 1.02;
    const span = hi - lo || 1;
    const posY = ((yesterday - lo) / span) * 100;
    const posP = ((price - lo) / span) * 100;
    const up = price >= yesterday;
    return (
        <div className="sx-bar" title={`现价 ${fmt(price)} ／ 昨日收盘 ${fmt(yesterday)}`}>
            <div className="sx-bar-track">
                <div className="sx-bar-fill" style={{ width: Math.max(2, Math.min(100, posP)) + '%', background: up ? 'var(--danger)' : 'var(--success)' }} />
                <div className="sx-bar-dash" style={{ left: Math.max(0, Math.min(100, posY)) + '%' }} />
                <div className="sx-bar-dot" style={{ left: Math.max(0, Math.min(100, posP)) + '%', background: up ? 'var(--danger)' : 'var(--success)' }} />
            </div>
            <div className="sx-bar-labels">
                <span>近日低点 {fmt(lo)}</span>
                <span className="sx-bar-legend">┈ 昨日收盘 {fmt(yesterday)}</span>
            </div>
        </div>
    );
}

export default function StockIndex() {
    const { user } = useAuth();
    const { showToast } = useToast();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [qty, setQty] = useState({});
    const [busy, setBusy] = useState(false);
    const [settlements, setSettlements] = useState([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [q, s] = await Promise.all([
                api.get('/api/express-index/quotes'),
                api.get('/api/express-index/settlements?limit=10').catch(() => ({ settlements: [] }))
            ]);
            setData(q);
            setSettlements(s.settlements || []);
            setErr('');
        } catch (e) {
            setErr(e.message || '加载失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const settings = data && data.settings;
    const stocks = (data && data.stocks) || [];

    const trade = async (stock, side) => {
        if (!user) return showToast('请先登录', 'error');
        const n = Math.floor(Number(qty[stock.id] || 0));
        if (!n || n <= 0) return showToast('请输入买入/卖出的股数', 'error');
        setBusy(true);
        try {
            const r = await api.post(`/api/express-index/${side}`, { stockId: stock.id, shares: n });
            if (side === 'buy') showToast(`买入成功：${n} 股 × ${fmt(r.price)}，手续费 ${fmt(r.fee)}，共扣 ${fmt(r.cost)}`, 'success');
            else showToast(`卖出成功：${n} 股 × ${fmt(r.price)}，印花税 ${fmt(r.tax)}，到账 ${fmt(r.income)}`, 'success');
            await load();
        } catch (e) {
            showToast(e.message || '交易失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    const totalDelta = useMemo(() => stocks.reduce((s, x) => s + (Number(x.change) || 0), 0), [stocks]);

    if (loading) return <div className="sx-page"><div className="sx-empty">加载中…</div></div>;
    if (err) return <div className="sx-page"><div className="sx-empty">{err}</div></div>;

    return (
        <div className="sx-page">
            <header className="sx-head">
                <div>
                    <h1>公会股市</h1>
                    <p className="sx-sub">哲式动态指数系统 · 三大产业板块：任务做得越多，对应板块股价越高</p>
                </div>
                <div className="sx-legend">
                    <span>📈 现价</span>
                    <span>┈ 昨日收盘</span>
                    {settings && <span>熔断底价 {fmt(settings.floorPrice)}</span>}
                </div>
            </header>

            <div className="sx-grid">
                {stocks.map((s) => {
                    const up = s.change > 0;
                    const down = s.change < 0;
                    return (
                        <article className="sx-card" key={s.id}>
                            <div className="sx-card-top">
                                <div className="sx-name">
                                    <span className="sx-icon">{BOARD_ICONS[s.symbol] || '📊'}</span>
                                    <div>
                                        <b>{s.name}</b>
                                        <span className="sx-symbol">{s.symbol}</span>
                                    </div>
                                </div>
                                <div className={'sx-price ' + (up ? 'is-up' : down ? 'is-down' : '')}>
                                    {fmt(s.price)}
                                    <span className="sx-change">
                                        {up ? '▲' : down ? '▼' : '—'} {up ? '+' : ''}{fmt(s.change)}（{up ? '+' : ''}{fmt(s.changePct)}%）
                                    </span>
                                </div>
                            </div>

                            <PriceBar price={s.price} yesterday={s.yesterdayClose} />

                            <p className="sx-desc">{s.description}</p>

                            {s.floored ? (
                                <div className="sx-alert">已触及熔断底价 {fmt(settings.priceBase)}，暂不可买入（等待任务拉动或成员抛售）</div>
                            ) : null}

                            <div className="sx-trade">
                                <input
                                    className="sx-input"
                                    type="number"
                                    min="1"
                                    placeholder="股数"
                                    value={qty[s.id] || ''}
                                    onChange={(e) => setQty((m) => ({ ...m, [s.id]: e.target.value }))}
                                />
                                <button className="btn btn-primary btn-sm" disabled={busy || !s.canBuy} onClick={() => trade(s, 'buy')}>买入</button>
                                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => trade(s, 'sell')}>卖出</button>
                            </div>
                            <p className="sx-fee">
                                买入手续费 {settings ? (settings.buyFeeRate * 100).toFixed(0) : 1}% ｜ 卖出印花税 {settings ? (settings.sellTaxRate * 100).toFixed(0) : 5}%
                            </p>
                        </article>
                    );
                })}
            </div>

            <section className="sx-rules">
                <h2>规则说明</h2>
                <ul>
                    <li>任务完成后，对应板块股价上涨：<b>ΔP = 哲指数 × 悬赏价 K × (完成人数 N ÷ 活跃基准) ÷ (max(现价, 股价基准) ÷ 股价基准)</b></li>
                    <li>股价越高，同样的任务带来的涨幅越小（防无限刷分）；股价越低，做任务涨得越快（鼓励去冷门板块）。</li>
                    <li>股价低于熔断底价时禁止买入，避免分母趋近 0 导致股价暴涨。</li>
                    <li>股票可随时买入卖出，不设 T+1；买入收小额手续费，卖出收较高印花税。</li>
                </ul>
                {settings && (
                    <p className="sx-params">
                        当前参数：哲指数 {settings.zheIndex} ｜ 股价基准 {settings.priceBase} ｜ 活跃基准 {settings.activeBase} ｜ 熔断底价 {settings.floorPrice}
                    </p>
                )}
            </section>

            <section className="sx-settle">
                <h2>最近结算</h2>
                {settlements.length === 0 ? <p className="sx-sub">暂无结算记录</p> : (
                    <div className="sx-settle-list">
                        {settlements.map((r) => (
                            <div className="sx-settle-item" key={r.id}>
                                <b>{r.stock_name || '—'}</b>
                                <span>{fmt(r.price_before)} → {fmt(r.price_after)}</span>
                                <span className={Number(r.delta) >= 0 ? 'is-up' : 'is-down'}>ΔP {Number(r.delta) >= 0 ? '+' : ''}{fmt(r.delta)}</span>
                                <span className="sx-settle-meta">{r.task_title || ('任务#' + r.task_id)} · K={r.reward} · N={r.finish_count}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
