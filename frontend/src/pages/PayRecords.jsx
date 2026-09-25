import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { requireLogin, fmtPoints, formatDate } from '../utils';
import { useCountdown, fmtDuration, statusMeta, KIND_LABEL } from '../lib/pay';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'in', label: '收入' },
  { key: 'out', label: '支出' },
  { key: 'pending_approval', label: '待审批' },
  { key: 'rejected', label: '已取消' }
];

/**
 * 我的收付款记录：/pay/records
 * 通知中心的「支付」类消息会跳到本页
 */
export default function PayRecords() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [todayPaid, setTodayPaid] = useState(0);
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        api.get('/api/pay/records?limit=100').catch(() => ({ records: [], todayPaid: 0 })),
        api.get('/api/pay/charges').catch(() => ({ charges: [] }))
      ]);
      setRecords(r.records || []);
      setTodayPaid(r.todayPaid || 0);
      setCharges(c.charges || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!requireLogin(navigate, '登录后才能查看收付款记录')) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = records.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'in' || filter === 'out') return r.direction === filter;
    return r.status === filter;
  });

  const income = records.filter(r => r.direction === 'in' && r.status === 'success').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const outcome = records.filter(r => r.direction === 'out' && r.status === 'success').reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/5.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>我的收付款记录</h1>
          <p>扫码支付的每一笔都全额留痕，可随时核对</p>
          <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Link to="/pay" className="btn btn-primary">去支付中心</Link>
            {user && user.level >= 1 && <Link to="/pay/admin" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>支付管理</Link>}
          </div>
        </div>
      </div>

      <div className="grid grid-3 mb-4" style={{ gap: 12 }}>
        <StatCard label="今日已付" value={`${fmtPoints(todayPaid)} 点`} color="var(--warning)" />
        <StatCard label="累计收入" value={`${fmtPoints(income)} 点`} color="var(--success)" />
        <StatCard label="累计支出" value={`${fmtPoints(outcome)} 点`} color="var(--danger)" />
      </div>

      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>资金流水</h3>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map(f => (
              <button
                key={f.key}
                className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="loading" style={{ padding: 24 }}><div className="spinner" /></div>
        ) : shown.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <p>暂无记录</p>
            <p className="text-secondary" style={{ fontSize: 12 }}>收款码、付款码、缴费单产生的收付款都会显示在这里。</p>
          </div>
        ) : (
          <div className="flex-col" style={{ gap: 10 }}>
            {shown.map(r => {
              const isOut = r.direction === 'out';
              const st = statusMeta(r.status);
              const link = r.token ? (r.kind === 'charge' ? `/pay/charge/${r.token}` : `/pay/${r.token}`) : null;
              return (
                <div
                  key={r.id}
                  style={{ padding: '12px 14px', background: 'var(--input-bg)', borderRadius: 10 }}
                >
                  <div className="flex-between" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>
                          {isOut ? '支出' : '收入'}
                        </span>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                        <span className="badge badge-gray">{KIND_LABEL[r.kind] || r.kind || '扫码支付'}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.7 }}>
                        {isOut ? `收款方：${r.payeeName || '—'}` : `付款方：${r.fromName || '—'}`}
                        {r.note ? ` · ${r.note}` : ''}
                        <br />
                        {formatDate(r.createdAt)}
                        {r.status === 'pending_approval' ? ' · 等待管理员审批' : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: isOut ? 'var(--danger)' : 'var(--success)' }}>
                        {isOut ? '-' : '+'}{fmtPoints(r.amount)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>贡献点</div>
                      {link && (
                        <Link to={link} className="link-btn" style={{ fontSize: 12 }}>查看详情</Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 22 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>我相关的缴费单</h3>
        {charges.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}>
            <p>暂无缴费单</p>
            <p className="text-secondary" style={{ fontSize: 12 }}>你创建的、或需要你缴纳的缴费单会显示在这里。</p>
          </div>
        ) : (
          <div className="flex-col" style={{ gap: 10 }}>
            {charges.map(c => (
              <ChargeRow key={c.token} charge={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChargeRow({ charge }) {
  const left = useCountdown(typeof charge.remainSeconds === 'number' ? charge.remainSeconds : remainSeconds(charge.expiresAt), charge.token);
  const st = statusMeta(charge.status);
  const mySt = charge.myStatus ? statusMeta(charge.myStatus) : null;
  const percent = charge.totalCount > 0 ? Math.round((charge.paidCount / charge.totalCount) * 100) : 0;
  return (
    <Link
      to={`/pay/charge/${charge.token}`}
      style={{ display: 'block', padding: '12px 14px', background: 'var(--input-bg)', borderRadius: 10, color: 'inherit' }}
    >
      <div className="flex-between" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 700, minWidth: 0, wordBreak: 'break-all' }}>{charge.title || '缴费单'}</span>
        <span className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {mySt && <span className={`badge ${mySt.cls}`}>我：{mySt.label}</span>}
          <span className={`badge ${st.cls}`}>{st.label}</span>
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.8 }}>
        收款方：{charge.payeeName || '—'}
        {charge.amount !== null && charge.amount !== undefined ? ` · 每人不低于 ${fmtPoints(charge.amount)} 点` : ' · 金额按人填写'}
        <br />
        进度 {charge.paidCount}/{charge.totalCount}（{percent}%）
        {charge.status === 'created' && (left > 0 ? ` · 剩余 ${fmtDuration(left)}` : ' · 已截止')}
      </div>
    </Link>
  );
}

function remainSeconds(expiresAt) {
  if (!expiresAt) return 0;
  const t = new Date(String(expiresAt).replace(' ', 'T')).getTime();
  if (!t || isNaN(t)) return 0;
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}

function StatCard({ label, value, color }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
