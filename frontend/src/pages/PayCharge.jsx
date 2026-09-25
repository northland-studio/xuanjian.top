import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { AlertIcon, UsersIcon } from '../components/ChatIcons';
import { requireLogin, fmtPoints, formatDate } from '../utils';
import { useCountdown, fmtDuration, statusMeta, PAYEE_TYPE_LABEL } from '../lib/pay';

function remainSeconds(expiresAt) {
  if (!expiresAt) return 0;
  const t = new Date(String(expiresAt).replace(' ', 'T')).getTime();
  if (!t || isNaN(t)) return 0;
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}

/** 剩余秒数优先用服务端 remainSeconds（服务器与浏览器时区不一致时直接解析 expiresAt 会误判已过期） */
function serverRemain(intent) {
  if (!intent) return 0;
  if (typeof intent.remainSeconds === 'number') return intent.remainSeconds;
  return remainSeconds(intent.expiresAt);
}

/**
 * 缴费单页：/pay/charge/:token（一码多人，各付各的）
 * 名单未付在前，创建者可关闭；全部缴清展示提示
 */
export default function PayCharge() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { refreshMe, user } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [memberQ, setMemberQ] = useState('');
  const [memberHits, setMemberHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [guestName, setGuestName] = useState('');

  const intent = data ? data.intent : null;
  const left = useCountdown(serverRemain(intent), token);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/pay/charge/${token}`);
      setData(d);
      setError('');
    } catch (e) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!requireLogin(navigate, '登录后才能查看缴费单')) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const doPay = async () => {
    if (busy || !data || !data.mine) return;
    const needAmount = !data.mine.amount || data.mine.amount <= 0;
    if (needAmount) {
      const n = Number(amount);
      if (!amount || !isFinite(n) || n <= 0) {
        showToast('请填写大于 0 的缴费金额', 'error');
        return;
      }
    }
    setBusy(true);
    try {
      const body = needAmount ? { amount: Number(amount) } : {};
      const r = await api.post(`/api/pay/charge/${token}/pay`, body);
      setResult(r);
      refreshMe?.();
      showToast(r.status === 'pending_approval' ? '金额较大，已提交管理员审批' : (r.message || '缴费成功'), r.status === 'pending_approval' ? 'info' : 'success');
      await load();
    } catch (e) {
      showToast(e.message || '缴费失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doClose = async () => {
    if (busy) return;
    if (!window.confirm('确定关闭该缴费单？关闭后名单内成员将无法继续缴纳。')) return;
    setBusy(true);
    try {
      await api.post(`/pay/charge/${token}/close`, {});
      showToast('缴费单已关闭', 'success');
      await load();
    } catch (e) {
      showToast(e.message || '关闭失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 创建者/管理员：搜索成员逐个加入名单 ---------- */

  const searchMembers = useCallback(async (kw) => {
    const q = String(kw || '').trim();
    if (!q) { setMemberHits([]); return; }
    setSearching(true);
    try {
      const d = await api.get(`/api/pay/members?q=${encodeURIComponent(q)}&exclude=${encodeURIComponent(token)}`);
      setMemberHits(d.members || []);
    } catch (e) {
      showToast(e.message || '搜索成员失败', 'error');
      setMemberHits([]);
    } finally {
      setSearching(false);
    }
  }, [token, showToast]);

  useEffect(() => {
    const kw = memberQ.trim();
    if (!kw) { setMemberHits([]); return undefined; }
    const t = setTimeout(() => { searchMembers(kw); }, 350);
    return () => clearTimeout(t);
  }, [memberQ, searchMembers]);

  const isManager = !!(data && (data.isCreator || (user && user.level >= 1)));

  const addTarget = async (member) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/pay/charge/${token}/targets`, { targets: [{ userId: member.id }] });
      showToast(r.message || '已加入名单', 'success');
      setMemberQ('');
      setMemberHits([]);
      await load();
    } catch (e) {
      showToast(e.message || '加入名单失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const addGuestTarget = async () => {
    const name = guestName.trim();
    if (!name) return showToast('请填写玩家名称', 'error');
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/pay/charge/${token}/targets`, { targets: [{ playerName: name }] });
      showToast(r.message || '已加入名单', 'success');
      setGuestName('');
      await load();
    } catch (e) {
      showToast(e.message || '加入名单失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeTarget = async (row) => {
    if (busy) return;
    if (!window.confirm(`确定把「${row.name}」移出名单？`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/pay/charge/${token}/targets/${row.id}`);
      showToast('已移出名单', 'success');
      await load();
    } catch (e) {
      showToast(e.message || '移出名单失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="loading" style={{ padding: 60 }}><div className="spinner" /></div>;
  }

  if (!data) {
    return (
      <div className="fade-in-up">
        <div className="card" style={{ padding: 26, maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
          <AlertIcon size={44} />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '10px 0 6px' }}>无法打开缴费单</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{error || '缴费单不存在或链接已失效'}</p>
          <div className="flex-center" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <Link to="/pay" className="btn btn-primary">去支付中心</Link>
            <button className="btn btn-secondary" onClick={load}>重新加载</button>
          </div>
        </div>
      </div>
    );
  }

  const { payee, stats, roster, mine, isCreator, myBalance, canPay } = data;
  const st = statusMeta(intent.status);
  const allPaid = stats && stats.count > 0 && stats.paidCount >= stats.count;
  const percent = stats && stats.count > 0 ? Math.round((stats.paidCount / stats.count) * 100) : 0;
  const sumPercent = stats && stats.total > 0 ? Math.round((stats.paidSum / stats.total) * 100) : 0;
  const expired = intent.status === 'closed' || left <= 0;
  // 名单：未付在前
  const sortedRoster = [...(roster || [])].sort((a, b) => {
    const rank = (r) => (r.status === 'paid' ? 2 : r.status === 'pending_approval' ? 1 : 0);
    const d = rank(a) - rank(b);
    return d !== 0 ? d : a.id - b.id;
  });
  const needAmount = mine && (!mine.amount || mine.amount <= 0);

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/4.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>{intent.title || '缴费单'}</h1>
          <p>一码多人，名单内成员各缴各的，全流程留痕</p>
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
              <UsersIcon size={20} />
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>缴费单详情</h3>
            </div>
            <span className={`badge ${allPaid ? 'badge-success' : st.cls}`}>{allPaid ? '已全部缴清' : st.label}</span>
          </div>

          <div style={{ background: 'var(--input-bg)', borderRadius: 12, padding: '4px 14px' }}>
            <Row label="标题" value={intent.title || '缴费单'} />
            <Row label="收款方" value={payee && payee.name ? payee.name : '未知'} />
            <Row label="收款类型" value={payee && payee.type ? (PAYEE_TYPE_LABEL[payee.type] || payee.type) : '—'} />
            <Row
              label="应缴金额"
              value={intent.amount === null || intent.amount === undefined
                ? <span style={{ color: 'var(--warning)', fontWeight: 700 }}>各人金额不同 / 由缴纳人填写</span>
                : <span style={{ fontWeight: 800 }}>{fmtPoints(intent.amount)} 贡献点</span>}
            />
            {intent.note ? <Row label="说明" value={intent.note} /> : null}
            <Row label="截止时间" value={`${formatDate(intent.expiresAt)}${expired ? '（已截止）' : `（剩余 ${fmtDuration(left)}）`}`} />
            <Row label="创建时间" value={formatDate(intent.createdAt)} />
          </div>

          {allPaid && (
            <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(30,158,106,0.12)', color: 'var(--success)', fontSize: 14, fontWeight: 700, textAlign: 'center' }}>
              已全部缴清
            </div>
          )}

          {result && (
            <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'var(--input-bg)', fontSize: 13, lineHeight: 1.9 }}>
              {result.status === 'pending_approval' ? (
                <span style={{ color: 'var(--warning)', fontWeight: 700 }}>金额较大，已提交管理员审批，审批通过后计入已缴。</span>
              ) : (
                <span style={{ color: 'var(--success)', fontWeight: 700 }}>
                  已缴纳 {fmtPoints(result.amount)} 贡献点，当前余额 {fmtPoints(result.balance)} 点。
                </span>
              )}
            </div>
          )}

          {mine && canPay ? (
            <div style={{ marginTop: 16 }}>
              <div className="form-group">
                <label className="form-label">
                  {needAmount ? '缴纳金额（贡献点）' : `我的应缴金额：${fmtPoints(mine.amount)} 贡献点`}
                </label>
                {needAmount && (
                  <input
                    type="number"
                    className="form-input"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="填写你要缴纳的金额，例如：30.00"
                  />
                )}
              </div>
              <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={doPay} disabled={busy}>
                  {busy ? '处理中…' : `缴纳 ${fmtPoints(needAmount ? (Number(amount) || 0) : mine.amount)} 贡献点`}
                </button>
                <span className="text-secondary" style={{ fontSize: 13, alignSelf: 'center' }}>我的余额：{fmtPoints(myBalance)} 点</span>
              </div>
            </div>
          ) : mine && mine.status === 'paid' ? (
            <p style={{ marginTop: 16, fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>你已完成缴费，谢谢配合。</p>
          ) : mine && mine.status === 'pending_approval' ? (
            <p style={{ marginTop: 16, fontSize: 14, fontWeight: 700, color: 'var(--warning)' }}>你的缴费正在等待管理员审批。</p>
          ) : (
            <p style={{ marginTop: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
              {expired ? '缴费单已截止或已关闭，无法继续缴纳。' : '你不在该缴费单名单中（或未绑定官网账号），如有疑问请联系创建者。'}
            </p>
          )}

          {isCreator && intent.status === 'created' && (
            <div style={{ marginTop: 16, borderTop: '1px dashed var(--border)', paddingTop: 14 }}>
              <button className="btn btn-danger btn-sm" onClick={doClose} disabled={busy}>关闭缴费单</button>
              <span className="text-secondary" style={{ fontSize: 12, marginLeft: 10 }}>你是创建者，可随时关闭</span>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>缴费进度</h3>

          <div className="flex-between" style={{ fontSize: 13, marginBottom: 6 }}>
            <span>人数 {stats.paidCount} / {stats.count}</span>
            <span style={{ fontWeight: 700 }}>{percent}%</span>
          </div>
          <div className="progress-track" style={{ marginBottom: 14 }}>
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>

          <div className="flex-between" style={{ fontSize: 13, marginBottom: 6 }}>
            <span>金额 {fmtPoints(stats.paidSum)} / {fmtPoints(stats.total)}</span>
            <span style={{ fontWeight: 700 }}>{sumPercent}%</span>
          </div>
          <div className="progress-track" style={{ marginBottom: 16 }}>
            <div className="progress-fill" style={{ width: `${sumPercent}%` }} />
          </div>

          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>名单（未缴在前）</h4>
          {sortedRoster.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}><p>名单为空</p></div>
          ) : (
            <div className="flex-col" style={{ gap: 8 }}>
              {sortedRoster.map(r => {
                const rst = statusMeta(r.status);
                const isMe = r.userId && data.mine && r.id === data.mine.id;
                return (
                  <div
                    key={r.id}
                    className="flex-between"
                    style={{
                      padding: '10px 12px',
                      background: isMe ? 'rgba(0,74,173,0.10)' : 'var(--input-bg)',
                      borderRadius: 10,
                      alignItems: 'center',
                      gap: 10
                    }}
                  >
                    <span style={{ fontSize: 13, minWidth: 0, wordBreak: 'break-all' }}>
                      {r.name}{isMe ? '（我）' : ''}
                    </span>
                    <span className="flex" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtPoints(r.amount)} 点</span>
                      <span className={`badge ${rst.cls}`}>{rst.label}</span>
                      {isManager && r.status === 'unpaid' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => removeTarget(r)} disabled={busy}>移出</button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {isManager && intent.status === 'created' && !expired && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>搜索成员逐个加入名单</h4>
              <p className="text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>
                按 昵称 / 用户名 / QQ 号 搜索；也可按名称添加未绑定官网账号的玩家（创建者与管理员可用）。
              </p>
              <input
                className="form-input"
                value={memberQ}
                onChange={e => setMemberQ(e.target.value)}
                placeholder="输入昵称 / 用户名 / QQ 号搜索"
              />
              {searching && <div className="text-secondary" style={{ fontSize: 12, marginTop: 8 }}>搜索中…</div>}
              {!searching && memberQ.trim() && memberHits.length === 0 && (
                <div className="text-secondary" style={{ fontSize: 12, marginTop: 8 }}>没有匹配的成员</div>
              )}
              {memberHits.length > 0 && (
                <div className="flex-col" style={{ gap: 6, marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                  {memberHits.map(m => (
                    <div key={m.id} className="flex-between" style={{ padding: '8px 10px', background: 'var(--input-bg)', borderRadius: 8, gap: 8 }}>
                      <span style={{ fontSize: 13, minWidth: 0, wordBreak: 'break-all' }}>
                        {m.name}
                        <span className="text-secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                          @{m.username}{m.qqBound ? ' · 已绑定 QQ' : ''}
                        </span>
                      </span>
                      <button className="btn btn-secondary btn-sm" disabled={busy || m.inRoster} onClick={() => addTarget(m)}>
                        {m.inRoster ? '已在名单' : '加入'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  style={{ flex: '1 1 140px' }}
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  placeholder="未绑定玩家名称，例如：张三"
                />
                <button className="btn btn-secondary" onClick={addGuestTarget} disabled={busy}>按名称加入</button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }} className="flex" >
            <Link to="/pay/records" className="btn btn-secondary btn-sm">我的缴费单与记录</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px dashed var(--border)' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, wordBreak: 'break-all', textAlign: 'right' }}>{value}</span>
    </div>
  );
}
