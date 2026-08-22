import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { requireLogin, formatDate, fmtPoints } from '../utils';

const LOG_TYPE_META = {
  claim: { label: '申报', color: 'var(--success)' },
  task_reward: { label: '任务奖励', color: 'var(--success)' },
  transfer_in: { label: '转入', color: 'var(--success)' },
  transfer_out: { label: '转出', color: 'var(--danger)' },
  purchase: { label: '商城消费', color: 'var(--danger)' },
  reward: { label: '签到奖励', color: 'var(--success)' },
  admin: { label: '管理员调整', color: 'var(--warning)' }
};

export default function Trade() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [toUsername, setToUsername] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [transferring, setTransferring] = useState(false);

  const [logs, setLogs] = useState([]);
  const [logType, setLogType] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    if (!requireLogin(navigate)) return;
    fetchLogs();
  }, [navigate]);

  const fetchLogs = async (type = '') => {
    setLogsLoading(true);
    try {
      const data = await api.get(`/api/contributions/logs?limit=50${type ? `&type=${type}` : ''}`);
      setLogs(data.logs || []);
    } catch (e) {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  const doTransfer = async () => {
    const amt = parseInt(amount);
    if (!toUsername.trim()) { showToast('请输入对方用户名', 'error'); return; }
    if (!amt || amt <= 0) { showToast('请填写有效的转账数量', 'error'); return; }
    setTransferring(true);
    try {
      // 通过用户名解析目标用户 ID
      const target = await api.get(`/api/auth/user/${toUsername.trim()}`);
      const toUserId = target?.user?.id;
      if (!toUserId) { showToast('用户不存在', 'error'); return; }
      await api.post('/api/contributions/transfer', { toUserId, amount: amt, note: note.trim() });
      showToast('转账成功', 'success');
      setToUsername('');
      setAmount('');
      setNote('');
      fetchLogs(logType);
    } catch (e) {
      showToast(e.message || '转账失败', 'error');
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/7.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>贡献点交易</h1>
          <p>成员间互转贡献点，明细全量可查</p>
          <div className="flex" style={{ gap: 10 }}>
            <Link to="/claims" className="btn btn-primary">贡献点申报</Link>
            <Link to="/shop" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>贡献点商城</Link>
          </div>
        </div>
      </div>

      {user && (
        <div className="card mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '16px 20px' }}>
          <span style={{ fontSize: 15 }}>当前贡献点：</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning)' }}>{fmtPoints(user.contribution ?? 0)} <span style={{ fontSize: 13, fontWeight: 400 }}>点</span></span>
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
        {/* 转账表单 */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>转账给其他成员</h3>
          <p className="text-secondary" style={{ fontSize: 12, marginBottom: 18 }}>单次上限 1000 贡献点，每日累计转出上限 1000。转账后将通知对方。</p>
          <div className="form-group">
            <label className="form-label">对方用户名</label>
            <input className="form-input" value={toUsername} onChange={e => setToUsername(e.target.value)} placeholder="输入对方的用户名，如 xuanjian" />
          </div>
          <div className="form-group">
            <label className="form-label">转账数量</label>
            <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} placeholder="例如：50" min="1" />
          </div>
          <div className="form-group">
            <label className="form-label">备注（可选）</label>
            <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="转账用途说明" />
          </div>
          <div className="flex-between" style={{ alignItems: 'center' }}>
            <span className="text-secondary" style={{ fontSize: 13 }}>我的贡献点：{fmtPoints(user?.contribution ?? 0)}</span>
            <button className="btn btn-primary" onClick={doTransfer} disabled={transferring}>
              {transferring ? '转账中...' : '确认转账'}
            </button>
          </div>
          <div className="card" style={{ marginTop: 16, padding: 14, background: 'var(--input-bg)' }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>交易须知</h4>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              按劳分配：贡献点代表你为公会建设做出的贡献，可通过他人转入、完成任务、自行申报获得。转账前请确认对方用户名正确，转账后不可撤销。
            </div>
          </div>
        </div>

        {/* 我的流水 */}
        <div className="card" style={{ padding: 24 }}>
          <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>我的贡献点流水</h3>
            <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className={`btn btn-sm ${!logType ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setLogType(''); fetchLogs(''); }}>全部</button>
              {Object.entries(LOG_TYPE_META).map(([k, v]) => (
                <button key={k} className={`btn btn-sm ${logType === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setLogType(k); fetchLogs(k); }}>{v.label}</button>
              ))}
            </div>
          </div>
          {logsLoading ? (
            <div className="loading" style={{ padding: 20 }}><div className="spinner" /></div>
          ) : logs.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}><p>暂无流水记录</p></div>
          ) : (
            <div className="flex-col" style={{ gap: 10 }}>
              {logs.map(l => {
                const meta = LOG_TYPE_META[l.type] || { label: l.type, color: 'var(--text-secondary)' };
                const positive = (l.amount ?? 0) >= 0;
                return (
                  <div key={l.id} className="flex-between" style={{ padding: '12px 14px', background: 'var(--input-bg)', borderRadius: 10, alignItems: 'center' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: positive ? 'var(--success)' : 'var(--danger)' }}>{positive ? '+' : ''}{fmtPoints(l.amount)} 贡献点</span>
                        <span className="badge" style={{ background: `${meta.color}1a`, color: meta.color }}>{meta.label}</span>
                      </div>
                      {l.note && <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>{l.note}</div>}
                    </div>
                    <span className="text-secondary" style={{ fontSize: 12, flexShrink: 0 }}>{formatDate(l.created_at, false)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
