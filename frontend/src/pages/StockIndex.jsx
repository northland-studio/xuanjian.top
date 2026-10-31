/**
 * 股市 · 哲式动态指数系统（微软财经风格布局）
 *
 * 左侧：板块列表 + 迷你走势（SVG sparkline）+ 昨收
 * 右侧：大字现价、涨跌额/涨跌幅、区间切换（1天/5天/1月/3月/1年/全部）、
 *       Chart.js 主图（灰色虚线=昨日收盘并带数值标签）、快速比较
 * 页签：股票行情 / 我的持仓（总资产 = 持仓市值 + 贡献点余额；赚损净额）
 * 全部图标为内联 SVG，不使用 emoji。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import '../styles/stock-index.css';
import '../styles/stock-index-extra.css';
import '../styles/stock-finance.css';

Chart.register(...registerables);

const Svg = ({ children, size = 20, ...rest }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
);
const IconGear = (p) => (<Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>);
const IconBuilding = (p) => (<Svg {...p}><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /><path d="M9 11h.01M15 11h.01M9 8h.01M15 8h.01" /></Svg>);
const IconUsers = (p) => (<Svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>);
const IconChart = (p) => (<Svg {...p}><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></Svg>);
const IconWallet = (p) => (<Svg {...p}><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" /><path d="M16 12h.01" /></Svg>);
const IconSearch = (p) => (<Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>);

const BOARD_ICONS = { 'XJ-HEAVY': IconGear, 'XJ-BUILD': IconBuilding, 'XJ-LABOR': IconUsers };
const RANGES = [
    { key: '1d', label: '1天' },
    { key: '5d', label: '5天' },
    { key: '1m', label: '1个月' },
    { key: '3m', label: '3个月' },
    { key: '1y', label: '1年' },
    { key: 'all', label: '全部' }
];
const fmt = (n, d = 2) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '—');

/** 迷你走势（SVG，不依赖 Chart.js） */
function Sparkline({ points, up }) {
    if (!points || points.length < 2) {
        return <svg className="fin-spark" viewBox="0 0 100 28" preserveAspectRatio="none"><path d="M0 14h100" stroke="currentColor" strokeOpacity=".25" strokeWidth="1" /></svg>;
    }
    const prices = points.map((p) => Number(p.price));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || 1;
    const d = prices
        .map((p, i) => {
            const x = (i / (prices.length - 1)) * 100;
            const y = 26 - ((p - min) / span) * 24;
            return (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
        })
        .join(' ');
    return (
        <svg className="fin-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
            <path d={d} fill="none" stroke={up ? 'var(--danger)' : 'var(--success)'} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}

/** 主图：Chart.js + 昨日收盘虚线（带数值标签） */
function PriceChart({ stockId, yesterdayClose, range, refreshKey }) {
    const canvasRef = useRef(null);
    const chartRef = useRef(null);
    const [points, setPoints] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        api.get(`/api/express-index/history?stockId=${stockId}&range=${range}&limit=120`)
            .then((d) => { if (alive) setPoints(d.points || []); })
            .catch(() => { if (alive) setPoints([]); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [stockId, range, refreshKey]);

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
                        borderColor: '#2f81f7',
                        backgroundColor: 'rgba(47,129,247,.14)',
                        borderWidth: 1.6,
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        tension: 0.25,
                        fill: true
                    },
                    {
                        label: '昨日收盘',
                        data: baseline,
                        borderColor: '#9aa7b8',
                        borderWidth: 1.2,
                        borderDash: [5, 4],
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
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15,23,42,.92)',
                        padding: 10,
                        displayColors: false,
                        callbacks: {
                            title: (items) => items[0] ? items[0].label : '',
                            label: (ctx) => `${ctx.dataset.label}：${Number(ctx.parsed.y).toFixed(2)}`
                        }
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(148,163,184,.10)' }, ticks: { font: { size: 10 }, maxTicksLimit: 8, color: '#8b98a9' } },
                    y: { grid: { color: 'rgba(148,163,184,.14)' }, ticks: { font: { size: 10 }, color: '#8b98a9' }, position: 'left' }
                }
            }
        });
        return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
    }, [points, loading, yesterdayClose]);

    if (loading) return <div className="fin-chart-empty">图表加载中…</div>;
    if (!points.length) return <div className="fin-chart-empty">暂无成交记录：完成一次任务或买卖后这里会出现曲线</div>;
    return (
        <div className="fin-chart">
            <div className="fin-chart-badge">昨日收盘 {fmt(yesterdayClose)}</div>
            <canvas ref={canvasRef} />
        </div>
    );
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
    const [range, setRange] = useState('1d');
    const [refreshKey, setRefreshKey] = useState(0);
    const [sparks, setSparks] = useState({});
    const [keyword, setKeyword] = useState('');

    const firstLoadRef = useRef(true);

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const q = await api.get('/api/express-index/quotes');
            setData(q);
            // 首次加载：选中第一个板块并拉取各板块迷你走势
            if (firstLoadRef.current && q.stocks && q.stocks.length) {
                firstLoadRef.current = false;
                setActiveStock((cur) => cur || q.stocks[0].id);
                Promise.all(q.stocks.map(async (s) => {
                    const h = await api.get(`/api/express-index/history?stockId=${s.id}&range=1d&limit=30`).catch(() => null);
                    return [s.id, h ? h.points || [] : []];
                })).then((entries) => setSparks(Object.fromEntries(entries))).catch(() => {});
            }
            if (user) {
                const h = await api.get('/api/express-index/holdings').catch(() => null);
                setHoldings(h);
            }
            setErr('');
        } catch (e) {
            if (!silent) setErr(e.message || '加载失败');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [user]);

    useEffect(() => { void load(); }, [load]);

    const stocks = useMemo(() => {
        const list = (data && data.stocks) || [];
        const k = keyword.trim();
        if (!k) return list;
        return list.filter((s) => s.name.includes(k) || s.symbol.toLowerCase().includes(k.toLowerCase()));
    }, [data, keyword]);

    const settings = data && data.settings;
    const current = useMemo(() => {
        const all = (data && data.stocks) || [];
        return all.find((s) => s.id === activeStock) || all[0];
    }, [data, activeStock]);

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
            await load(true);
        } catch (e) {
            showToast(e.message || '交易失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    if (loading) return <div className="fin-page"><div className="fin-empty">加载中…</div></div>;
    if (err) return <div className="fin-page"><div className="fin-empty">{err}</div></div>;

    return (
        <div className="fin-page">
            {/* 顶部工具条 */}
            <div className="fin-topbar">
                <div className="fin-brand">公会股市<span>哲式动态指数</span></div>
                <div className="fin-search">
                    <IconSearch size={16} />
                    <input placeholder="搜索板块名称 / 代码" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                </div>
                <div className="fin-tabs">
                    <button className={tab === 'market' ? 'is-active' : ''} onClick={() => setTab('market')}>
                        <IconChart size={15} /> 股票行情
                    </button>
                    <button className={tab === 'holdings' ? 'is-active' : ''} onClick={() => setTab('holdings')}>
                        <IconWallet size={15} /> 我的持仓
                    </button>
                </div>
            </div>

            {tab === 'market' && (
                <div className="fin-layout">
                    {/* 左：板块列表 */}
                    <aside className="fin-side">
                        <div className="fin-side-title">相关板块</div>
                        {stocks.map((s) => {
                            const Icon = BOARD_ICONS[s.symbol] || IconChart;
                            const up = s.change > 0;
                            const down = s.change < 0;
                            return (
                                <button key={s.id} className={'fin-side-item' + (current && current.id === s.id ? ' is-active' : '')} onClick={() => setActiveStock(s.id)}>
                                    <div className="fin-side-head">
                                        <span className="fin-side-name"><Icon size={14} /> {s.name}</span>
                                        <span className="fin-side-price">{fmt(s.price)}</span>
                                    </div>
                                    <div className="fin-side-body">
                                        <Sparkline points={sparks[s.id]} up={up} />
                                        <span className={'fin-side-chg ' + (up ? 'is-up' : down ? 'is-down' : '')}>
                                            {up ? '+' : ''}{fmt(s.change)}（{up ? '+' : ''}{fmt(s.changePct)}%）
                                        </span>
                                    </div>
                                    <div className="fin-side-sub">{s.symbol} · 昨收 {fmt(s.yesterdayClose)}</div>
                                </button>
                            );
                        })}
                        {!stocks.length && <div className="fin-empty">没有匹配的板块</div>}
                    </aside>

                    {/* 右：主面板 */}
                    <main className="fin-main">
                        {current && (
                            <>
                                <div className="fin-quote">
                                    <div className="fin-quote-head">
                                        <div>
                                            <div className="fin-quote-name">{current.name} <span>{current.symbol}</span></div>
                                            <div className="fin-quote-tag">玄剑公会 · 板块指数 · 单位：贡献点</div>
                                        </div>
                                        {current.floored && <div className="fin-quote-warn">已触及熔断底价，暂不可买入</div>}
                                    </div>
                                    <div className="fin-quote-big">
                                        <span className={'fin-big ' + (current.change > 0 ? 'is-up' : current.change < 0 ? 'is-down' : '')}>{fmt(current.price, 2)}</span>
                                        <span className={'fin-big-chg ' + (current.change > 0 ? 'is-up' : current.change < 0 ? 'is-down' : '')}>
                                            {current.change > 0 ? '+' : ''}{fmt(current.change)}（{current.change > 0 ? '+' : ''}{fmt(current.changePct)}%）
                                        </span>
                                    </div>
                                    <div className="fin-quote-meta">
                                        <span>昨收 <b>{fmt(current.yesterdayClose)}</b></span>
                                        <span>熔断底价 <b>{fmt(settings && settings.floorPrice)}</b></span>
                                        <span>买入手续费 <b>{(settings ? settings.buyFeeRate * 100 : 1).toFixed(0)}%</b></span>
                                        <span>卖出印花税 <b>{(settings ? settings.sellTaxRate * 100 : 5).toFixed(0)}%</b></span>
                                    </div>
                                </div>

                                <div className="fin-range">
                                    {RANGES.map((r) => (
                                        <button key={r.key} className={range === r.key ? 'is-active' : ''} onClick={() => setRange(r.key)}>{r.label}</button>
                                    ))}
                                </div>

                                <PriceChart stockId={current.id} yesterdayClose={current.yesterdayClose} range={range} refreshKey={refreshKey} />

                                <div className="fin-trade-row">
                                    <input className="fin-qty" type="number" min="1" placeholder="股数" value={qty[current.id] || ''}
                                        onChange={(e) => setQty((m) => ({ ...m, [current.id]: e.target.value }))} />
                                    <button className="fin-btn fin-buy" disabled={busy || !current.canBuy} onClick={() => trade(current, 'buy')}>买入</button>
                                    <button className="fin-btn fin-sell" disabled={busy} onClick={() => trade(current, 'sell')}>卖出</button>
                                    <span className="fin-fee-note">买入扣手续费，卖出扣印花税；无 T+1 限制</span>
                                </div>

                                <div className="fin-compare">
                                    <div className="fin-compare-title">快速比较</div>
                                    <div className="fin-compare-grid">
                                        {(data.stocks || []).map((s) => (
                                            <div className={'fin-compare-item' + (s.id === current.id ? ' is-active' : '')} key={s.id} onClick={() => setActiveStock(s.id)}>
                                                <div className="fin-compare-name">{s.name}</div>
                                                <div className="fin-compare-price">{fmt(s.price)}</div>
                                                <div className={'fin-compare-chg ' + (s.change > 0 ? 'is-up' : s.change < 0 ? 'is-down' : '')}>
                                                    {s.change > 0 ? '+' : ''}{fmt(s.change)}（{s.change > 0 ? '+' : ''}{fmt(s.changePct)}%）
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="fin-rules">
                                    <b>规则：</b>ΔP = 哲指数 × 悬赏价 K × (完成人数 N ÷ 活跃基准) ÷ (max(现价, 股价基准) ÷ 股价基准)。
                                    股价越高同样任务涨幅越小，股价越低涨得越快；低于熔断底价禁止买入。
                                </div>
                            </>
                        )}
                    </main>
                </div>
            )}

            {tab === 'holdings' && (
                <div className="fin-holdings">
                    {!user ? (
                        <div className="fin-empty">登录后查看持仓</div>
                    ) : !holdings || !holdings.items.length ? (
                        <div className="fin-empty">还没有持仓，去「股票行情」买入一些吧</div>
                    ) : (
                        <>
                            <div className="fin-assets">
                                <div className="fin-asset-main">
                                    <span>总资产</span>
                                    <b>{fmt(holdings.summary.totalAssets)}</b>
                                    <em>持仓市值 {fmt(holdings.summary.marketValue)} + 贡献点余额 {fmt(holdings.summary.cash)}</em>
                                </div>
                                <div className={holdings.summary.netProfit >= 0 ? 'is-up' : 'is-down'}>
                                    <span>赚损净额</span>
                                    <b>{holdings.summary.netProfit >= 0 ? '+' : ''}{fmt(holdings.summary.netProfit)}</b>
                                    <em>成本 {fmt(holdings.summary.cost)} · {holdings.summary.netProfit >= 0 ? '+' : ''}{fmt(holdings.summary.profitPct)}%</em>
                                </div>
                            </div>
                            <div className="adm-table-wrap" style={{ marginTop: 14 }}>
                                <table className="adm-table">
                                    <thead><tr><th>板块</th><th>持有股数</th><th>成本均价</th><th>现价</th><th>市值</th><th>赚损净额</th><th>操作</th></tr></thead>
                                    <tbody>
                                        {holdings.items.map((h) => (
                                            <tr key={h.stockId}>
                                                <td>{h.name}<span className="adm-mono">{h.symbol}</span></td>
                                                <td>{h.shares}</td>
                                                <td>{fmt(h.avgCost)}</td>
                                                <td>{fmt(h.price)}</td>
                                                <td>{fmt(h.marketValue)}</td>
                                                <td className={h.profit >= 0 ? 'is-up' : 'is-down'}>{h.profit >= 0 ? '+' : ''}{fmt(h.profit)}（{h.profitPct >= 0 ? '+' : ''}{fmt(h.profitPct)}%）</td>
                                                <td><button className="btn btn-xs btn-ghost" onClick={() => trade({ id: h.stockId, name: h.name }, 'sell', h.shares)} disabled={busy}>清仓</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
