import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getToken } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { AlertIcon, CheckCircleIcon } from '../components/ChatIcons';
import { fmtPoints, formatDate } from '../utils';
import { absUrl, statusMeta, KIND_LABEL, PAYEE_TYPE_LABEL } from '../lib/pay';

const TABS = [
  { key: 'approvals', label: '待审批' },
  { key: 'summary', label: '对账概览' },
  { key: 'records', label: '全量流水' },
  { key: 'settings', label: '风控阈值' }
];

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'success', label: '已完成' },
  { value: 'pending_approval', label: '待审批' },
  { value: 'rejected', label: '已驳回' },
  { value: 'failed', label: '已失败' }
];

const KIND_OPTIONS = [
  { value: '', label: '全部场景' },
  { value: 'receive', label: '收款码' },
  { value: 'payer_code', label: '付款码' },
  { value: 'charge', label: '缴费单' },
  { value: 'charge_pay', label: '缴费单缴费' }
];

/**
 * 支付管理（管理员）：/pay/admin
 * 待审批 / 对账概览 / 全量流水（含 CSV 导出）/ 风控阈值
 */
export default function PayAdmin() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState('approvals');

  const [approvals, setApprovals] = useState([]);
  const [approvalBusy, setApprovalBusy] = useState(0);
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState({ single: '', daily: '', approval: '' });
  const [savingSettings, setSavingSettings] = useState(false);
  const [records, setRecords] = useState([]);
  const [recordTotal, setRecordTotal] = useState(0);
  const [recordSum, setRecordSum] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({ status: '', kind: '', userId: '', from: '', to: '' });
  const LIMIT = 50;

  const query = useCallback((extra = {}) => {
    const p = new URLSearchParams();
    Object.entries({ ...filters, ...extra }).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) p.set(k, v); });
    return p.toString();
  }, [filters]);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get('/api/pay/admin/approvals');
      setApprovals(d.approvals || []);
    } catch (e) {
      showToast(e.message || '加载待审批失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get('/api/pay/admin/summary');
      setSummary(d);
    } catch (e) {
      showToast(e.message || '加载对账概览失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadSettings = useCallback(async () => {
    try {
      const d = await api.get('/api/pay/admin/settings');
      setSettings({ single: String(d.single ?? ''), daily: String(d.daily ?? ''), approval: String(d.approval ?? '') });
    } catch (e) {
      showToast(e.message || '读取阈值失败', 'error');
    }
  }, [showToast]);

  const loadRecords = useCallback(async (nextOffset = offset) => {
    setLoading(true);
    try {
      const d = await api.get(`/api/pay/admin/records?${query({ limit: LIMIT, offset: nextOffset })}`);
      setRecords(d.records || []);
      setRecordTotal(d.total || 0);
      setRecordSum(d.successSum || 0);
      setOffset(nextOffset);
    } catch (e) {
      showToast(e.message || '加载流水失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [offset, query, showToast]);

  useEffect(() => {
    if (!user) return;
    if (user.level < 1) return;
    if (tab === 'approvals') loadApprovals();
    else if (tab === 'summary') loadSummary();
    else if (tab === 'records') loadRecords(0);
    else if (tab === 'settings') loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user]);

  const doApprove = async (id, action) => {
    setApprovalBusy(id);
    try {
      const r = await api.post(`/api/pay/admin/approve/${id}`, { action });
      showToast(r.message || (action === 'approve' ? '已通过' : '已驳回'), 'success');
      await loadApprovals();
    } catch (e) {
      showToast(e.message || '审批失败', 'error');
    } finally {
      setApprovalBusy(0);
    }
  };

  const saveSettings = async () => {
    const body = {};
    for (const k of ['single', 'daily', 'approval']) {
      const v = Number(settings[k]);
      if (!isFinite(v) || v < 0) {
        showToast(`${k === 'single' ? '单笔上限' : k === 'daily' ? '单日上限' : '审批阈值'} 必须是不小于 0 的数字`, 'error');
        return;
      }
      body[k] = v;
    }
    setSavingSettings(true);
    try {
      const d = await api.put('/api/pay/admin/settings', body);
      setSettings({ single: String(d.single), daily: String(d.daily), approval: String(d.approval) });
      showToast('风控阈值已保存', 'success');
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  /**
   * 导出 CSV。
   * 管理端接口需要 Authorization 头，window.open 带不上，因此先带 token 拉取再本地下载；
   * 若拉取失败则回落到 window.open（后端若支持 ?token= 亦可直接导出）。
   */
  const exportCsv = async () => {
    const url = `/api/pay/admin/records?${query({ format: 'csv', limit: 1000, offset: 0 })}`;
    try {
      const res = await fetch(absUrl(url), { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `pay-records-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
      showToast('CSV 已开始下载', 'success');
    } catch {
      showToast('直接下载失败，改用新窗口导出', 'info');
      window.open(absUrl(`${url}&token=${encodeURIComponent(getToken() || '')}`), '_blank');
    }
  };

  if (!user || user.level < 1) {
    return (
      <div className="fade-in-up">
        <div className="card" style={{ padding: 26, maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
          <AlertIcon size={44} />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '10px 0 6px' }}>无访问权限</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            支付管理页面仅对管理员开放。如需查看自己的收付款记录，请前往「我的收付款记录」。
          </p>
          <div className="flex-center" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <Link to="/pay/records" className="btn btn-primary">我的收付款记录</Link>
            <Link to="/pay" className="btn btn-secondary">支付中心</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/6.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>支付管理</h1>
          <p>大额审批、对账概览、全量流水与风控阈值</p>
          <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Link to="/pay/records" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>我的记录</Link>
            <Link to="/admin" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>站点管理后台</Link>
          </div>
        </div>
      </div>

      <div className="flex mb-3" style={{ gap: 8, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'approvals' && approvals.length > 0 ? `（${approvals.length}）` : ''}
          </button>
        ))}
      </div>

      {loading && <div className="loading" style={{ padding: 16 }}><div className="spinner" /></div>}

      {/* ---------------- 待审批 ---------------- */}
      {tab === 'approvals' && (
        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>大额支付待审批</h3>
          <p className="text-secondary" style={{ fontSize: 12, marginBottom: 14 }}>
            超过阈值的支付会挂在这里，审批通过后才真正扣款与入账。
          </p>
          {approvals.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <p>暂无待审批记录</p>
            </div>
          ) : (
            <div className="flex-col" style={{ gap: 10 }}>
              {approvals.map(a => (
                <div key={a.id} style={{ padding: '12px 14px', background: 'var(--input-bg)', borderRadius: 10 }}>
                  <div className="flex-between" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--warning)' }}>{fmtPoints(a.amount)} 点</span>
                        <span className="badge badge-gray">{KIND_LABEL[a.kind] || a.kind || '扫码支付'}</span>
                        <span className="badge badge-gray">{PAYEE_TYPE_LABEL[a.payeeType] || a.payeeType || '—'}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.7 }}>
                        付款方：{a.payerName || '—'} → 收款方：{a.payeeName || '—'}
                        {a.note ? ` · ${a.note}` : ''}
                        <br />
                        {formatDate(a.createdAt)}
                        {a.token ? (
                          <>
                            {' · '}
                            <Link to={`/pay/${a.token}`} className="link-btn" style={{ fontSize: 12 }}>查看意图</Link>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex" style={{ gap: 8, flexShrink: 0 }}>
                      <button className="btn btn-success btn-sm" onClick={() => doApprove(a.id, 'approve')} disabled={approvalBusy === a.id}>
                        通过
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => doApprove(a.id, 'reject')} disabled={approvalBusy === a.id}>
                        驳回
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------- 对账概览 ---------------- */}
      {tab === 'summary' && (
        <div>
          {!summary ? (
            <div className="empty-state" style={{ padding: 24 }}><p>暂无数据</p></div>
          ) : (
            <>
              <div className="grid grid-3 mb-3" style={{ gap: 12 }}>
                <Box label="今日支付" value={`${fmtPoints(summary.today.sum)} 点`} sub={`${summary.today.count} 笔`} color="var(--primary)" />
                <Box label="近 7 天支付" value={`${fmtPoints(summary.week.sum)} 点`} sub="含今日" color="var(--primary)" />
                <Box label="累计支付" value={`${fmtPoints(summary.total.sum)} 点`} sub={`${summary.total.count} 笔`} color="var(--success)" />
                <Box label="待审批" value={`${fmtPoints(summary.pending.sum)} 点`} sub={`${summary.pending.count} 笔`} color="var(--warning)" />
                <Box label="系统金库余额" value={`${fmtPoints(summary.vault ? summary.vault.balance : 0)} 点`} sub={summary.vault ? summary.vault.name : '玄剑财政'} color="var(--warning)" />
                <Box label="活跃二维码" value={`${summary.activeCodes}`} sub="未过期且未支付" color="var(--text)" />
              </div>

              <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
                <div className="card" style={{ padding: 22 }}>
                  <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Top 收款方（累计）</h3>
                  {summary.topPayees.length === 0 ? (
                    <div className="empty-state" style={{ padding: 16 }}><p>暂无收款记录</p></div>
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>收款方</th>
                          <th>类型</th>
                          <th>笔数</th>
                          <th>金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.topPayees.map((t, i) => (
                          <tr key={`${t.name}-${i}`}>
                            <td>{t.name}</td>
                            <td>{PAYEE_TYPE_LABEL[t.type] || t.type}</td>
                            <td>{t.count}</td>
                            <td style={{ fontWeight: 700 }}>{fmtPoints(t.sum)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="card" style={{ padding: 22 }}>
                  <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>缴费单完成情况</h3>
                  <div style={{ fontSize: 14, lineHeight: 2 }}>
                    名单行总数：{summary.charges.total}
                    <br />
                    已缴：{summary.charges.paid}
                    <br />
                    未缴：{Math.max(0, summary.charges.total - summary.charges.paid)}
                    <br />
                    完成率：{summary.charges.total > 0 ? Math.round((summary.charges.paid / summary.charges.total) * 100) : 0}%
                  </div>
                  <div className="progress-track" style={{ marginTop: 12 }}>
                    <div
                      className="progress-fill"
                      style={{ width: `${summary.charges.total > 0 ? Math.round((summary.charges.paid / summary.charges.total) * 100) : 0}%` }}
                    />
                  </div>
                  <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
                    当前阈值：单笔 {fmtPoints(summary.thresholds.single)} 点 · 单日 {fmtPoints(summary.thresholds.daily)} 点 ·
                    超过 {fmtPoints(summary.thresholds.approval)} 点转审批
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------- 全量流水 ---------------- */}
      {tab === 'records' && (
        <div className="card" style={{ padding: 22 }}>
          <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>全量流水 / 对账</h3>
            <button className="btn btn-secondary btn-sm" onClick={exportCsv}>导出 CSV</button>
          </div>

          <div className="grid grid-4" style={{ gap: 10, marginBottom: 14 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">状态</label>
              <select className="form-select" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">场景</label>
              <select className="form-select" value={filters.kind} onChange={e => setFilters({ ...filters, kind: e.target.value })}>
                {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">用户 ID</label>
              <input className="form-input" value={filters.userId} onChange={e => setFilters({ ...filters, userId: e.target.value })} placeholder="如 12" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">起始日期</label>
              <input type="date" className="form-input" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value ? `${e.target.value} 00:00:00` : '' })} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">截止日期</label>
              <input type="date" className="form-input" value={filters.to ? filters.to.slice(0, 10) : ''} onChange={e => setFilters({ ...filters, to: e.target.value ? `${e.target.value} 23:59:59` : '' })} />
            </div>
          </div>

          <div className="flex" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => loadRecords(0)}>查询</button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { setFilters({ status: '', kind: '', userId: '', from: '', to: '' }); }}
            >
              重置条件
            </button>
            <span className="text-secondary" style={{ fontSize: 12, alignSelf: 'center' }}>
              共 {recordTotal} 笔，其中已完成合计 {fmtPoints(recordSum)} 点
            </span>
          </div>

          {records.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}><p>没有符合条件的流水</p></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>流水号</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>场景</th>
                    <th>付款方</th>
                    <th>收款方</th>
                    <th>备注</th>
                    <th>时间</th>
                    <th>审批人</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => {
                    const st = statusMeta(r.status);
                    return (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td style={{ fontWeight: 700 }}>{fmtPoints(r.amount)}</td>
                        <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                        <td>{KIND_LABEL[r.kind] || r.kind || '—'}</td>
                        <td>{r.payerName || '—'}</td>
                        <td>{r.payeeName || '—'}</td>
                        <td style={{ maxWidth: 180, wordBreak: 'break-all' }}>{r.note || '—'}</td>
                        <td>{formatDate(r.createdAt)}</td>
                        <td>{r.approverName || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex-between" style={{ marginTop: 14, gap: 10, flexWrap: 'wrap' }}>
            <span className="text-secondary" style={{ fontSize: 12 }}>
              第 {Math.floor(offset / LIMIT) + 1} 页（每页 {LIMIT} 条）
            </span>
            <div className="flex" style={{ gap: 8 }}>
              <button className="btn btn-secondary btn-sm" disabled={offset <= 0} onClick={() => loadRecords(Math.max(0, offset - LIMIT))}>上一页</button>
              <button className="btn btn-secondary btn-sm" disabled={offset + LIMIT >= recordTotal} onClick={() => loadRecords(offset + LIMIT)}>下一页</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 风控阈值 ---------------- */}
      {tab === 'settings' && (
        <div className="card" style={{ padding: 22, maxWidth: 560 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>风控阈值</h3>
          <p className="text-secondary" style={{ fontSize: 12, marginBottom: 16 }}>
            阈值对所有用户生效，保存后立即影响扫码支付与缴费单。
          </p>
          <div className="form-group">
            <label className="form-label">单笔上限（贡献点）</label>
            <input type="number" min="0" step="0.01" className="form-input" value={settings.single} onChange={e => setSettings({ ...settings, single: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">单日累计上限（贡献点）</label>
            <input type="number" min="0" step="0.01" className="form-input" value={settings.daily} onChange={e => setSettings({ ...settings, daily: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">转审批阈值（超过则需管理员审批）</label>
            <input type="number" min="0" step="0.01" className="form-input" value={settings.approval} onChange={e => setSettings({ ...settings, approval: e.target.value })} />
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={saveSettings} disabled={savingSettings}>
              {savingSettings ? '保存中…' : '保存阈值'}
            </button>
            <button className="btn btn-secondary" onClick={loadSettings} disabled={savingSettings}>重新读取</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 16, marginTop: 16, background: 'var(--input-bg)' }}>
        <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <CheckCircleIcon size={18} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            支付资金不入个人钱包池之外的地方：个人收款进个人余额，公会官方收款进系统金库「玄剑财政」，
            全量流水与贡献点日志双向可查，不做退款与提现。
          </span>
        </div>
      </div>
    </div>
  );
}

function Box({ label, value, sub, color }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}
