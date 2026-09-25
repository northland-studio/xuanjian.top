import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { AlertIcon, CheckCircleIcon } from '../components/ChatIcons';
import { requireLogin, fmtPoints, formatDate } from '../utils';
import { useCountdown, fmtSeconds, statusMeta, PAYEE_TYPE_LABEL, KIND_LABEL } from '../lib/pay';

/** 解析服务端 'YYYY-MM-DD HH:mm:ss'（本地时区）为剩余秒数（仅作旧接口兜底） */
function remainSeconds(expiresAt) {
  if (!expiresAt) return 0;
  const t = new Date(String(expiresAt).replace(' ', 'T')).getTime();
  if (!t || isNaN(t)) return 0;
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}

/**
 * 剩余秒数一律以服务端 remainSeconds 为准：
 * 服务器时区（HK=UTC）与浏览器时区不一致时，直接解析 expiresAt 会把未过期误判为已过期。
 */
function serverRemain(intent) {
  if (!intent) return 0;
  if (typeof intent.remainSeconds === 'number') return intent.remainSeconds;
  return remainSeconds(intent.expiresAt);
}

/**
 * 付款落地页：/pay/:token（收款码主扫）
 * 只读展示 → 付款人本人确认支付（需要金额时由付款人填写）
 */
export default function PayIntent() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { refreshMe } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null); // { message, status }
  const [amount, setAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState(null);

  const intent = data ? data.intent : null;
  const left = useCountdown(serverRemain(intent), token);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/pay/intents/${token}`);
      setData(d);
      setError(null);
    } catch (e) {
      setError({ message: e.message || '加载失败', status: e.status });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!requireLogin(navigate, '登录后才能扫码付款')) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const doPay = async () => {
    if (paying || !data) return;
    const needAmount = data.intent.amount === null || data.intent.amount === undefined;
    if (needAmount) {
      const n = Number(amount);
      if (!amount || !isFinite(n) || n <= 0) {
        showToast('请填写大于 0 的支付金额', 'error');
        return;
      }
    }
    setPaying(true);
    try {
      const body = needAmount ? { amount: Number(amount) } : {};
      const r = await api.post(`/api/pay/intents/${token}/confirm`, body);
      setResult(r);
      refreshMe?.();
      showToast(r.status === 'pending_approval' ? '已提交管理员审批' : '支付成功', r.status === 'pending_approval' ? 'info' : 'success');
      await load();
    } catch (e) {
      if (e.status === 409 || e.status === 410) {
        setError({ message: e.message, status: e.status });
      } else {
        showToast(e.message || '支付失败', 'error');
      }
    } finally {
      setPaying(false);
    }
  };

  if (loading && !data) {
    return <div className="loading" style={{ padding: 60 }}><div className="spinner" /></div>;
  }

  // 缴费单码：引导到缴费单页面
  if (intent && intent.kind === 'charge') {
    return <Navigate to={`/pay/charge/${token}`} replace />;
  }

  // 加载失败（含 409 / 410）
  if (!data) {
    const conflict = error && (error.status === 409 || error.status === 410);
    return (
      <div className="fade-in-up">
        <div className="card" style={{ padding: 26, maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
          <AlertIcon size={44} />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '10px 0 6px' }}>
            {error && error.status === 410 ? '二维码已过期' : error && error.status === 409 ? '该二维码不可用' : '二维码无效'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            {error ? error.message : '二维码不存在或已被使用'}
            <br />
            {conflict ? '请让对方在支付中心重新生成收款码后再扫。' : '请确认链接是否完整，或让对方重新生成二维码。'}
          </p>
          <div className="flex-center" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <Link to="/pay" className="btn btn-primary">去支付中心</Link>
            <button className="btn btn-secondary" onClick={load}>重新加载</button>
          </div>
        </div>
      </div>
    );
  }

  const { payee, me, isSelf, limits, todayPaid } = data;
  const needAmount = intent.amount === null || intent.amount === undefined;
  const showPayAmount = needAmount ? Number(amount) || 0 : Number(intent.amount) || 0;
  const overApproval = showPayAmount > (limits ? limits.approval : 200);
  const overSingle = showPayAmount > (limits ? limits.single : 500);
  const overDaily = limits ? (Number(todayPaid || 0) + showPayAmount) > limits.daily : false;
  const expired = !!intent && left <= 0;
  const payable = !expired && !isSelf && intent.status !== 'paid' && intent.status !== 'pending_approval';
  const st = statusMeta(result && result.status === 'success' ? 'paid' : intent.status);

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/3.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>扫码付款</h1>
          <p>核对收款方与金额后，由你本人确认支付</p>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {result && result.status === 'success' && (
          <div className="card mb-4" style={{ padding: 22, textAlign: 'center', borderTop: '3px solid var(--success)' }}>
            <CheckCircleIcon size={48} />
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '8px 0 6px' }}>支付成功</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              已向 {result.payee ? result.payee.name : (payee && payee.name) || '对方'} 支付
              <span style={{ fontWeight: 800, color: 'var(--success)' }}> {fmtPoints(result.amount)} </span>贡献点
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              最新余额：{fmtPoints(result.balance !== undefined && result.balance !== null ? result.balance : (me ? me.balance : 0))} 点
            </p>
            <div className="flex-center" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <Link to="/pay/records" className="btn btn-primary">查看收付款记录</Link>
              <Link to="/pay" className="btn btn-secondary">返回支付中心</Link>
            </div>
          </div>
        )}

        {result && result.status === 'pending_approval' && (
          <div className="card mb-4" style={{ padding: 22, textAlign: 'center', borderTop: '3px solid var(--warning)' }}>
            <AlertIcon size={44} />
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '8px 0 6px' }}>已提交管理员审批</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              {result.message || `金额超过 ${limits ? limits.approval : 200} 贡献点，需要管理员审批后才会扣款。`}
              <br />
              审批结果会通过站内通知告知。
            </p>
            <div className="flex-center" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <Link to="/pay/records" className="btn btn-primary">查看记录</Link>
              <Link to="/pay" className="btn btn-secondary">返回支付中心</Link>
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 22 }}>
          <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>付款信息</h3>
            <span className={`badge ${st.cls}`}>{st.label}</span>
          </div>

          <div style={{ background: 'var(--input-bg)', borderRadius: 12, padding: '4px 14px' }}>
            <Row label="收款方" value={payee && payee.name ? payee.name : '未知'} />
            <Row label="收款类型" value={payee && payee.type ? (PAYEE_TYPE_LABEL[payee.type] || payee.type) : '—'} />
            <Row label="场景" value={KIND_LABEL[intent.kind] || intent.kind} />
            <Row
              label="金额"
              value={needAmount
                ? <span style={{ color: 'var(--warning)', fontWeight: 700 }}>由付款方填写</span>
                : <span style={{ color: 'var(--danger)', fontWeight: 800 }}>{fmtPoints(intent.amount)} 贡献点</span>}
            />
            {intent.note ? <Row label="用途" value={intent.note} /> : null}
            <Row label="生成时间" value={formatDate(intent.createdAt)} />
            <Row
              label="剩余有效时间"
              value={<span style={{ color: expired ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{expired ? '已过期' : `${fmtSeconds(left)}（90 秒有效）`}</span>}
            />
          </div>

          <div style={{ background: 'var(--input-bg)', borderRadius: 12, padding: '4px 14px', marginTop: 14 }}>
            <Row label="我的余额" value={`${fmtPoints(me ? me.balance : 0)} 贡献点`} />
            <Row
              label="今日已付 / 日上限"
              value={limits ? `${fmtPoints(todayPaid || 0)} / ${fmtPoints(limits.daily)} 贡献点` : '—'}
            />
          </div>

          {limits && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
              限额规则：单笔不超过 {fmtPoints(limits.single)} 点，单日累计不超过 {fmtPoints(limits.daily)} 点；
              单笔超过 {fmtPoints(limits.approval)} 点将转管理员审批，审批通过后才会扣款。
            </div>
          )}

          {needAmount && payable && (
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">支付金额（贡献点）</label>
              <input
                type="number"
                className="form-input"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="例如：20.00"
              />
            </div>
          )}

          {isSelf && (
            <p style={{ marginTop: 14, fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>
              这是你自己的收款码，不能向自己付款。
            </p>
          )}
          {!isSelf && overSingle && (
            <p style={{ marginTop: 14, fontSize: 13, color: 'var(--danger)' }}>
              金额超过单笔上限 {limits ? fmtPoints(limits.single) : '500'} 点，请减少金额。
            </p>
          )}
          {!isSelf && !overSingle && overDaily && (
            <p style={{ marginTop: 14, fontSize: 13, color: 'var(--danger)' }}>
              加上今日已付将超过单日上限 {limits ? fmtPoints(limits.daily) : '2000'} 点，请明日再付或减少金额。
            </p>
          )}
          {!isSelf && !overSingle && !overDaily && overApproval && (
            <p style={{ marginTop: 14, fontSize: 13, color: 'var(--warning)' }}>
              该金额超过 {limits ? fmtPoints(limits.approval) : '200'} 点，确认后将提交管理员审批。
            </p>
          )}
          {expired && (
            <p style={{ marginTop: 14, fontSize: 13, color: 'var(--danger)' }}>
              二维码已过期，请让对方在支付中心重新生成收款码。
            </p>
          )}

          <div className="flex" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={doPay}
              disabled={paying || !payable || overSingle || overDaily}
            >
              {paying ? '支付处理中…' : overApproval ? `确认支付（需审批）` : `确认支付${showPayAmount > 0 ? ` ${fmtPoints(showPayAmount)} 点` : ''}`}
            </button>
            <Link to="/pay" className="btn btn-secondary">返回支付中心</Link>
            <button className="btn btn-ghost" onClick={load} disabled={paying}>刷新</button>
          </div>

          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            确认后将从你的官网账户扣除相应贡献点，收款方立即到账，操作不可撤销。若页面提示已被他人扫码占用，
            请让收款方重新生成二维码。
          </p>
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
