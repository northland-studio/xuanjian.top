import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtPoints } from '../utils';

const STATUS_META = {
  normal: { text: '健康', color: 'var(--success)' },
  watch: { text: '关注', color: 'var(--warning)' },
  warn: { text: '警戒', color: 'var(--danger)' },
  manual: { text: '人工监测', color: 'var(--text-secondary)' }
};

function toDateStr(d) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}
function getMondayStr() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  return toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff));
}

function MetricIcon({ status }) {
  const color = STATUS_META[status]?.color || 'var(--primary)';
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

export default function Economics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(getMondayStr);
  const [endDate, setEndDate] = useState(() => toDateStr(new Date()));

  useEffect(() => {
    api.get('/api/economics/overview')
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const exportXlsx = () => {
    const params = new URLSearchParams();
    if (startDate) params.set('start', startDate);
    if (endDate) params.set('end', endDate);
    const qs = params.toString();
    window.open(`/api/economics/export${qs ? `?${qs}` : ''}`, '_blank');
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!data) return <div className="empty-state"><p>经济数据加载失败</p></div>;

  const { metrics, totals, dailyFlows, overLimit, eco, priceItems, topHolders } = data;
  const maxFlow = Math.max(1, ...dailyFlows.map(d => Math.max(d.inflow, d.outflow)));

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/1.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>经济看板</h1>
          <p>贡献点试点方案观测指标实时计算 · 数据每页刷新时更新</p>
        </div>
      </div>

      {/* 导出报表 */}
      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <div className="flex" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>导出报表</span>
          <input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: 'auto' }} />
          <span className="text-secondary">至</span>
          <input type="date" className="form-input" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: 'auto' }} />
          <button className="btn btn-primary" onClick={exportXlsx}>导出 xlsx</button>
          <span className="text-secondary" style={{ fontSize: 12 }}>《贡献点总览表》+《账户余额公示》，支持自选时间段（默认本周）</span>
        </div>
      </div>

      {/* 核心指标 */}
      <div className="grid grid-3" style={{ gap: 14, marginBottom: 20 }}>
        {metrics.map(m => {
          const meta = STATUS_META[m.status];
          return (
            <div key={m.key} className="card card-hover" style={{ padding: 20 }}>
              <div className="flex-between" style={{ marginBottom: 10 }}>
                <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                  <MetricIcon status={m.status} />
                  <span className="text-secondary" style={{ fontSize: 13, fontWeight: 500 }}>{m.label}</span>
                </div>
                <span className="badge" style={{ background: `${meta.color}1f`, color: meta.color }}>{meta.text}</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2 }}>
                {m.display}
                <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 4 }}>{m.unit}</span>
              </div>
              <div className="text-secondary" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>{m.desc}</div>
            </div>
          );
        })}
      </div>

      {/* 总量统计 */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>总量概览</h3>
        <div className="grid grid-4" style={{ gap: 10 }}>
          {[
            { label: '成员总数', value: totals.totalUsers },
            { label: '持有贡献点成员', value: totals.holders },
            { label: '当前流通总量', value: fmtPoints(totals.totalSupply) },
            { label: '累计获得', value: fmtPoints(totals.totalGain) },
            { label: '累计消费（商城）', value: fmtPoints(totals.totalPurchase) },
            { label: '累计总流出', value: fmtPoints(totals.totalOutflow) },
            { label: '期初存量（推算）', value: fmtPoints(totals.startSupply) },
            { label: '近30天活跃成员', value: totals.activeUsers }
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--input-bg)', borderRadius: 10, padding: '12px 14px' }}>
              <div className="text-secondary" style={{ fontSize: 12 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 近7天流动 */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>近7天贡献点流动</h3>
        {dailyFlows.length === 0 ? (
          <div className="empty-state"><p>暂无流动记录</p></div>
        ) : (
          <div className="flex" style={{ gap: 10, alignItems: 'flex-end', height: 160, paddingTop: 10 }}>
            {dailyFlows.map(d => (
              <div key={d.d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: '100%', width: '100%', justifyContent: 'center' }}>
                  <div style={{ width: '30%', height: `${Math.max(2, (d.inflow / maxFlow) * 100)}%`, background: 'var(--primary)', borderRadius: '4px 4px 0 0', minHeight: 2 }} title={`流入 ${d.inflow}`} />
                  <div style={{ width: '30%', height: `${Math.max(2, (d.outflow / maxFlow) * 100)}%`, background: 'var(--danger)', opacity: 0.75, borderRadius: '4px 4px 0 0', minHeight: 2 }} title={`流出 ${d.outflow}`} />
                </div>
                <div className="text-secondary" style={{ fontSize: 11, marginTop: 6, whiteSpace: 'nowrap' }}>{d.d.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="flex" style={{ gap: 16, marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span className="flex" style={{ gap: 6, alignItems: 'center' }}><span style={{ width: 10, height: 10, background: 'var(--primary)', borderRadius: 3, display: 'inline-block' }} />流入</span>
          <span className="flex" style={{ gap: 6, alignItems: 'center' }}><span style={{ width: 10, height: 10, background: 'var(--danger)', opacity: 0.75, borderRadius: 3, display: 'inline-block' }} />流出</span>
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 20, marginBottom: 20, alignItems: 'start' }}>
        {/* 超限预警 */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>产量超限预警（单日≤50 / 单月≤1500）</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {overLimit.daily.length === 0 && overLimit.monthly.length === 0 && (
              <div className="empty-state"><p>暂无明显超限，一切正常</p></div>
            )}
            {overLimit.daily.map(u => (
              <div key={`d${u.user_id}`} className="badge badge-danger" style={{ width: 'fit-content' }}>
                用户 {u.user_id} 今日新增 {u.amt}（超50上限）
              </div>
            ))}
            {overLimit.monthly.map(u => (
              <div key={`m${u.user_id}`} className="badge badge-danger" style={{ width: 'fit-content' }}>
                用户 {u.user_id} 本月新增 {u.amt}（超1500上限）
              </div>
            ))}
          </div>
        </div>

        {/* 生态数据 */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>生态活跃</h3>
          <div className="grid grid-3" style={{ gap: 10 }}>
            {[
              { label: '签到次数', value: eco.checkins },
              { label: '完成任务', value: eco.tasks_done },
              { label: '申报记录', value: eco.claims },
              { label: '转账笔数', value: eco.transfers },
              { label: '股市成交', value: eco.stock_trades },
              { label: '在售称号/商品', value: `${eco.titles}/${eco.shop_items}` }
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--input-bg)', borderRadius: 10, padding: '10px 12px' }}>
                <div className="text-secondary" style={{ fontSize: 11 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 贡献点分布 Top10 */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>贡献点持有 Top10</h3>
        {topHolders.length === 0 ? (
          <div className="empty-state"><p>暂无持有者</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topHolders.map((u, i) => {
              const pct = Math.max(2, (u.contribution / topHolders[0].contribution) * 100);
              return (
                <div key={u.username} className="flex" style={{ gap: 12, alignItems: 'center' }}>
                  <span style={{ width: 20, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>#{i + 1}</span>
                  <span style={{ width: 130, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nickname || u.username}</span>
                  <div style={{ flex: 1, height: 10, background: 'var(--input-bg)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gradient)', borderRadius: 5 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, width: 70, textAlign: 'right' }}>{fmtPoints(u.contribution)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 消费项目价格一览 */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>兑换项目价格一览（价格稳定观测基准）</h3>
        {priceItems.length === 0 ? (
          <div className="empty-state"><p>暂无在售项目</p></div>
        ) : (
          <div className="grid grid-2" style={{ gap: 8 }}>
            {priceItems.map((p, i) => (
              <div key={i} className="flex-between" style={{ padding: '8px 12px', background: 'var(--input-bg)', borderRadius: 8 }}>
                <span style={{ fontSize: 13 }}>
                  <span className="badge badge-primary" style={{ fontSize: 11, marginRight: 8 }}>{p.kind}</span>
                  {p.name}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtPoints(p.price)} 点</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-secondary" style={{ fontSize: 12, marginTop: 12 }}>
          注：黑市价格等线下情况需人工核验，本看板以官方兑换价为基准。
        </p>
      </div>

      <p className="text-secondary" style={{ fontSize: 12, lineHeight: 1.8 }}>
        口径说明：参与率按近30天活跃成员计算；消费率按贡献点流水（商城 purchase）计算，称号/补签卡/股市交易暂未计入流水；期初存量无历史快照，由「期末存量 − 期间净流入」反推，仅供参考。
      </p>
    </div>
  );
}
