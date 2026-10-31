/**
 * 股市 · 哲式动态指数系统
 *
 * 两个页签：
 *  - 股票行情：三板块卡片 + Chart.js 价格曲线（含昨日收盘虚线）
 *  - 我的持仓：持有股数、成本、市值、浮动盈亏
 *
 * 全部图标使用内联 SVG，不使用 emoji。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import '../styles/stock-index.css';
import '../styles/stock-index-extra.css';

Chart.register(...registerables);

/* ---------- 内联 SVG 图标 ---------- */
const Svg = ({ children, size = 20, ...rest }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
);
const IconGear = (p) => (<Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>);
const IconBuilding = (p) => (<Svg {...p}><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /><path d="M9 11h.01M15 11h.01M9 8h.01M15 8h.01" /></Svg>);
const IconUsers = (p) => (<Svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>);
const IconChart = (p) => (<Svg {...p}><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></Svg>);
const IconWallet = (p) => (<Svg {...p}><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" /><path d="M16 12h.01" /></Svg>);

const BOARD_ICONS = { 'XJ-HEAVY': IconGear, 'XJ-BUILD': IconBuilding, 'XJ-LABOR': IconUsers };
const fmt = (n, d = 2) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '—');

/* ---------- Chart.js 价格曲线（含昨日收盘虚线） ---------- */
function PriceChart({ stockId, yesterdayClose, refreshKey }) {
    const canvasRef = useRef(null);
    const chartRef = useRef(null);
    const [points, setPoints] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        api.get(`/api/express-index/history?stockId=${stockId}&limit=40`)
            .then((d) => { if (alive) setPoints(d.points || []); })
            .catch(() => { if (alive) setPoints([]); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [stockId, refreshKey]);

    useEffect(() => {
        if (!canvasRef.current || loading || !points.length) return;
        const labels = points.map((p) => p.label);
        const prices = points.map((p) => p.price);
        const baseline = labels.map(() => Number(yesterdayClose));
        if (chartRef.current) chartRef.current.destroy();
        chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: '成交价',
                        data: prices,
                        borderColor: '#004aad',
                        backgroundColor: 'rgba(0,74,173,.12)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.35,
                        fill: true
                    },
                    {
                        label: '昨日收盘',
                        data: baseline,
                        borderColor: '#94a3b8',
                        borderWidth: 1.5,
                        borderDash: [6, 5],
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}：${Number(ctx.parsed.y).toFixed(2)}` } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 8 } },
                    y: { grid: { color: 'rgba(148,163,184,.18)' }, ticks: { font: { size: 10 } } }
                }
            }
        });
        return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
    }, [points, loading, yesterdayClose]);

    if (loading) return <div className="sx-chart-empty">图表加载中…</div>;
    if (!points.length) return <div className="sx-chart-empty">暂无成交记录：完成一次任务或买卖后这里会出现曲线</div>;
    return <div className="sx-chart"><canvas ref={canvasRef} /></div>;
}

export default function StockIndex() {
    const { user } = useAuth();
    const { showToast } = useToast();
    const [tab, setTab] = useState('market');
    const [data, setData] = useState(null);
    const [holdings, setHoldings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [qty, setQty] = useState({});
    const [busy, setBusy] = useState(false);
    const [activeStock, setActiveStock] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = await api.get('/api/express-index/quotes');
            setData(q);
            if (!activeStock && q.stocks && q.stocks.length) setActiveStock(q.stocks[0].id);
            if (user) {
                const h = await api.get('/api/express-index/holdings').catch(() => null);
                setHoldings(h);
            }
            setErr('');
        } catch (e) {
            setErr(e.message || '加载失败');
        } finally {
            setLoading(false);
        }
    }, [user, activeStock]);

    useEffect(() => { void load(); }, [load]);

    const stocks = (data && data.stocks) || [];
    const settings = data && data.settings;
    const current = useMemo(() => stocks.find((s) => s.id === activeStock) || stocks[0], [stocks, activeStock]);

    const trade = async (stock, side, sharesOverride) => {
        if (!user) return showToast('请先登录', 'error');
        const n = Math.floor(Number(sharesOverride !== undefined ? sharesOverride : qty[stock.id] || 0));
        if (!n || n <= 0) return showToast('请输入股数', 'error');
        setBusy(true);
        try {
            const r = await api.post(`/api/express-index/${side}`, { stockId: stock.id, shares: n });
            if (side === 'buy') showToast(`买入 ${n} 股 × ${fmt(r.price)}，手续费 ${fmt(r.fee)}，共扣 ${fmt(r.cost)}`, 'success');
            else showToast(`卖出 ${n} 股，印花税 ${fmt(r.tax)}，到账 ${fmt(r.income)}`, 'success');
            setQty((m) => ({ ...m, [stock.id]: '' }));
            setRefreshKey((k) => k + 1);
            await load();
        } catch (e) {
            showToast(e.message || '交易失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    if (loading) return <div className="sx-page"><div className="sx-empty">加载中…</div></div>;
    if (err) return <div className="sx-page"><div className="sx-empty">{err}</div></div>;

    return (
        <div className="sx-page">
            <header className="sx-head">
                <div>
                    <h1>公会股市</h1>
                    <p className="sx-sub">哲式动态指数系统 · 三大产业板块：任务做得越多，对应板块股价越高</p>
                </div>
                <div className="sx-tabs">
                    <button className={tab === 'market' ? 'is-active' : ''} onClick={() => setTab('market')}>
                        <IconChart size={16} /> 股票行情
                    </button>
                    <button className={tab === 'holdings' ? 'is-active' : ''} onClick={() => setTab('holdings')}>
                        <IconWallet size={16} /> 我的持仓
                    </button>
                </div>
            </header>

            {tab === 'market' && (
                <>
                    <div className="sx-grid">
                        {stocks.map((s) => {
                            const Icon = BOARD_ICONS[s.symbol] || IconChart;
                            const up = s.change > 0;
                            const down = s.change < 0;
                            return (
                                <article className={'sx-card' + (current && current.id === s.id ? ' is-active' : '')} key={s.id} onClick={() => setActiveStock(s.id)}>
                                    <div className="sx-card-top">
                                        <div className="sx-name">
                                            <span className="sx-icon"><Icon size={22} /></span>
                                            <div>
                                                <b>{s.name}</b>
                                                <span className="sx-symbol">{s.symbol}</span>
                                            </div>
                                        </div>
                                        <div className={'sx-price ' + (up ? 'is-up' : down ? 'is-down' : '')}>
                                            {fmt(s.price)}
                                            <span className="sx-change">
                                                {up ? '+' : ''}{fmt(s.change)}（{up ? '+' : ''}{fmt(s.changePct)}%）
                                            </span>
                                        </div>
                                    </div>
                                    <div className="sx-meta">
                                        <span>昨日收盘 <b>{fmt(s.yesterdayClose)}</b></span>
                                        {s.floored && <span className="sx-floored">已熔断</span>}
                                    </div>
                                    <div className="sx-trade">
                                        <input className="sx-input" type="number" min="1" placeholder="股数"
                                            value={qty[s.id] || ''}
                                            onChange={(e) => setQty((m) => ({ ...m, [s.id]: e.target.value }))} />
                                        <button className="btn btn-primary btn-sm" disabled={busy || !s.canBuy} onClick={(e) => { e.stopPropagation(); trade(s, 'buy'); }}>买入</button>
                                        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); trade(s, 'sell'); }}>卖出</button>
                                    </div>
                                    <p className="sx-fee">买入手续费 {settings ? (settings.buyFeeRate * 100).toFixed(0) : 1}% ｜ 卖出印花税 {settings ? (settings.sellTaxRate * 100).toFixed(0) : 5}%</p>
                                </article>
                            );
                        })}
                    </div>

                    {current && (
                        <section className="sx-chart-card">
                            <div className="sx-chart-head">
                                <h2>{current.name} · 价格走势</h2>
                                <span className="sx-chart-legend">蓝色实线 = 成交价 ｜ 灰色虚线 = 昨日收盘 {fmt(current.yesterdayClose)}</span>
                            </div>
                            <PriceChart stockId={current.id} yesterdayClose={current.yesterdayClose} refreshKey={refreshKey} />
                        </section>
                    )}

                    <section className="sx-rules">
                        <h2>规则说明</h2>
                        <ul>
                            <li>任务完成后对应板块上涨：<b>ΔP = 哲指数 × 悬赏价 K × (完成人数 N ÷ 活跃基准) ÷ (max(现价, 股价基准) ÷ 股价基准)</b></li>
                            <li>股价越高，同样任务带来的涨幅越小（防止无限刷分）；股价越低，做任务涨得越快。</li>
                            <li>股价低于熔断底价时禁止买入，避免分母趋近 0 导致股价暴涨。</li>
                            <li>可随时买卖，不设 T+1；买入收小额手续费，卖出收较高印花税。</li>
                        </ul>
                        {settings && (
                            <p className="sx-params">当前参数：哲指数 {settings.zheIndex} ｜ 股价基准 {settings.priceBase} ｜ 活跃基准 {settings.activeBase} ｜ 熔断底价 {settings.floorPrice}</p>
                        )}
                    </section>
                </>
            )}

            {tab === 'holdings' && (
                <section className="sx-holdings">
                    {!user ? (
                        <div className="sx-empty">登录后查看持仓</div>
                    ) : !holdings || !holdings.items.length ? (
                        <div className="sx-empty">还没有持仓，去「股票行情」买入一些吧</div>
                    ) : (
                        <>
                            <div className="sx-summary">
                                <div><span>总市值</span><b>{fmt(holdings.summary.marketValue)}</b></div>
                                <div><span>总成本</span><b>{fmt(holdings.summary.cost)}</b></div>
                                <div><span>浮动盈亏</span><b className={holdings.summary.profit >= 0 ? 'is-up' : 'is-down'}>{holdings.summary.profit >= 0 ? '+' : ''}{fmt(holdings.summary.profit)}</b></div>
                            </div>
                            <div className="adm-table-wrap" style={{ marginTop: 14 }}>
                                <table className="adm-table">
                                    <thead><tr><th>板块</th><th>持有股数</th><th>成本均价</th><th>现价</th><th>市值</th><th>浮动盈亏</th><th>操作</th></tr></thead>
                                    <tbody>
                                        {holdings.items.map((h) => (
                                            <tr key={h.stockId}>
                                                <td>{h.name}<span className="adm-mono">{h.symbol}</span></td>
                                                <td>{h.shares}</td>
                                                <td>{fmt(h.avgCost)}</td>
                                                <td>{fmt(h.price)}</td>
                                                <td>{fmt(h.marketValue)}</td>
                                                <td className={h.profit >= 0 ? 'is-up' : 'is-down'}>{h.profit >= 0 ? '+' : ''}{fmt(h.profit)}（{h.profitPct >= 0 ? '+' : ''}{fmt(h.profitPct)}%）</td>
                                                <td>
                                                    <button className="btn btn-xs btn-ghost" onClick={() => trade({ id: h.stockId, name: h.name }, 'sell', h.shares)} disabled={busy}>清仓</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </section>
            )}
        </div>
    );
}
