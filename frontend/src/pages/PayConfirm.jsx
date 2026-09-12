import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

/**
 * 支付确认页（独立于主站布局，链接可直接分享）
 * 路由：/pay/confirm/:token
 * 流程：展示订单详情 → 用户点「确认支付」→ 真正扣/加贡献点 → 显示结果
 */
export default function PayConfirm() {
  const { token } = useParams();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const d = await api.get(`/api/pay-confirm/${token}`);
        if (!on) return;
        setOrder(d.order);
        setUser(d.user);
        if (d.order.status === 'success') {
          setResult({ success: true, already: true, amount: d.order.amount, direction: d.order.direction });
        }
      } catch (e) {
        if (on) setError(e.message || '加载失败');
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, [token]);

  const doPay = async () => {
    if (paying) return;
    setPaying(true);
    setError('');
    try {
      const r = await api.post(`/api/pay-confirm/${token}/confirm`, {});
      setResult({ success: true, ...r });
    } catch (e) {
      setError(e.message || '支付失败');
    } finally {
      setPaying(false);
    }
  };

  const dirText = (d) => (d === 'out' ? '扣除贡献点' : '增加贡献点');
  const sym = (d) => (d === 'out' ? '-' : '+');

  if (loading) {
    return <div style={wrap}><div style={card}><p style={{ textAlign: 'center', color: '#5b6b8c' }}>加载订单中…</p></div></div>;
  }

  if (error && !order) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 44, textAlign: 'center' }}>⚠️</div>
          <h3 style={{ textAlign: 'center', color: '#c0392b' }}>{error}</h3>
          <button className="btn" style={{ width: '100%', marginTop: 16 }} onClick={() => nav('/')}>返回首页</button>
        </div>
      </div>
    );
  }

  if (result && result.success) {
    const ok = true;
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 52, textAlign: 'center' }}>✅</div>
          <h2 style={{ textAlign: 'center', color: '#1e9e6a' }}>支付成功</h2>
          <p style={{ textAlign: 'center', color: '#5b6b8c' }}>
            {result.direction === 'out' ? '已扣除' : '已增加'} <b>{result.amount}</b> 贡献点
            {result.already ? '（该订单此前已支付）' : ''}
          </p>
          {user && (
            <p style={{ textAlign: 'center', color: '#8697b5', fontSize: 13 }}>
              当前贡献点：{result.already ? user.contribution : '刷新后可见'}
            </p>
          )}
          <button className="btn" style={{ width: '100%', marginTop: 18 }} onClick={() => nav('/')}>返回首页</button>
        </div>
      </div>
    );
  }

  const isDone = order && order.status === 'success';
  const isFail = order && order.status === 'fail';

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 40, textAlign: 'center' }}>💳</div>
        <h2 style={{ textAlign: 'center', margin: '6px 0 2px', color: '#1a3d7c' }}>支付确认</h2>
        <p style={{ textAlign: 'center', color: '#8697b5', fontSize: 13, marginTop: 0 }}>
          请核对订单信息后确认支付
        </p>

        <div style={panel}>
          <Row label="订单号" value={order.orderNo} mono />
          {order.subject && <Row label="项目" value={order.subject} />}
          {order.siteName && <Row label="来源" value={order.siteName} />}
          <Row label="类型" value={dirText(order.direction)} />
          <Row label="金额" value={<span style={{ color: order.direction === 'out' ? '#c0392b' : '#1e9e6a', fontWeight: 700 }}>{sym(order.direction)}{order.amount} 贡献点</span>} />
          {user && <Row label="账号" value={user.nickname || user.username} />}
          {user && <Row label="当前贡献点" value={String(Math.floor(user.contribution ?? 0))} />}
          <Row label="状态" value={<StatusTag status={order.status} />} />
        </div>

        {error && <p style={{ color: '#c0392b', textAlign: 'center', marginTop: 10 }}>{error}</p>}

        {isDone ? (
          <p style={{ textAlign: 'center', color: '#1e9e6a', marginTop: 14, fontWeight: 700 }}>该订单已完成支付</p>
        ) : isFail ? (
          <p style={{ textAlign: 'center', color: '#c0392b', marginTop: 14, fontWeight: 700 }}>该订单已失败，无法支付</p>
        ) : (
          <button
            className="btn"
            style={{ width: '100%', marginTop: 18 }}
            disabled={paying}
            onClick={doPay}
          >
            {paying ? '支付处理中…' : `确认支付（${sym(order.direction)}${order.amount} 贡献点）`}
          </button>
        )}

        <button className="btn ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => nav('/')}>取消并返回</button>

        <p style={{ textAlign: 'center', color: '#b0bdd4', fontSize: 12, marginTop: 14 }}>
          确认后将从你的官网账户{sym(order.direction) === '-' ? '扣除' : '增加'}相应贡献点，操作不可撤销
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #e3ebf7' }}>
      <span style={{ color: '#8697b5', fontSize: 13 }}>{label}</span>
      <span style={{ color: '#1a3d7c', fontSize: 13, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all', textAlign: 'right', maxWidth: '62%' }}>{value}</span>
    </div>
  );
}

function StatusTag({ status }) {
  const map = {
    pending: ['待确认', '#fff3e0', '#a35a00'],
    awaiting_confirm: ['待确认', '#fff3e0', '#a35a00'],
    success: ['已完成', '#e6f7ee', '#12704a'],
    fail: ['已失败', '#ffeaea', '#a11d1d'],
    expired: ['已过期', '#eef2f9', '#5b6b8c'],
  };
  const [text, bg, color] = map[status] || [status, '#eef2f9', '#5b6b8c'];
  return <span style={{ background: bg, color, padding: '2px 10px', borderRadius: 999, fontSize: 12 }}>{text}</span>;
}

const wrap = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #eef4ff 0%, #f7faff 100%)',
  padding: 16,
  boxSizing: 'border-box',
};

const card = {
  width: '100%',
  maxWidth: 420,
  background: '#fff',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 10px 40px rgba(31,80,180,.12)',
};

const panel = {
  marginTop: 14,
  background: '#f8fbff',
  borderRadius: 12,
  padding: '4px 14px',
};
