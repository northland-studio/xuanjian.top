import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, uploadImages } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { requireLogin, formatDate } from '../utils';

const STATUS_META = {
  pending: { label: '待审核', color: 'var(--warning)' },
  approved: { label: '已通过', color: 'var(--success)' },
  rejected: { label: '已驳回', color: 'var(--danger)' }
};

const LOG_TYPE_META = {
  claim: { label: '申报', color: 'var(--success)' },
  task_reward: { label: '任务奖励', color: 'var(--success)' },
  transfer_in: { label: '转入', color: 'var(--success)' },
  transfer_out: { label: '转出', color: 'var(--danger)' },
  purchase: { label: '商城消费', color: 'var(--danger)' },
  reward: { label: '签到奖励', color: 'var(--success)' },
  admin: { label: '管理员调整', color: 'var(--warning)' }
};

export default function Claims() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const fileInput = useRef(null);

  const [claims, setClaims] = useState([]);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');

  // 互转 / 流水
  const [pageTab, setPageTab] = useState('claim');
  const [toUsername, setToUsername] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logType, setLogType] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    if (!requireLogin(navigate)) return;
    fetchClaims('all');
  }, [navigate]);

  const fetchClaims = async (status = '') => {
    setLoading(true);
    try {
      const data = await api.get(`/api/claims${status ? `?status=${status}` : ''}&limit=50`);
      setClaims(data.claims || []);
    } catch (e) {
      setClaims([]);
    } finally {
      setLoading(false);
    }
  };

  const handleImages = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const urls = await uploadImages(files, (done, pct, total) => {
        setUploadProgress(Math.round(((done + pct / 100) / total) * 100));
      });
      setEvidence(prev => [...prev, ...urls]);
      showToast('图片上传成功', 'success');
    } catch (err) {
      showToast(err.message || '上传失败', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(null);
      e.target.value = '';
    }
  };

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { showToast('请填写有效的申报数量', 'error'); return; }
    if (!reason.trim() || reason.trim().length < 10) { showToast('申报原因至少10个字符', 'error'); return; }
    setSubmitting(true);
    try {
      await api.post('/api/claims', { amount: amt, reason: reason.trim(), evidenceImages: evidence });
      showToast('申报提交成功，请等待管理员审核', 'success');
      setAmount('');
      setReason('');
      setEvidence([]);
      fetchClaims(tab);
    } catch (e) {
      showToast(e.message || '提交失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const adminReview = async (id, status) => {
    if (!confirm(`确定${status === 'approved' ? '通过' : '驳回'}该申报？`)) return;
    try {
      await api.put(`/api/claims/${id}/review`, { status });
      showToast('审核完成', 'success');
      fetchClaims(tab);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

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
    const amt = parseInt(transferAmount);
    if (!toUsername.trim()) { showToast('请输入对方用户名', 'error'); return; }
    if (!amt || amt <= 0) { showToast('请填写有效的转账数量', 'error'); return; }
    setTransferring(true);
    try {
      // 通过用户名解析目标用户 ID
      const target = await api.get(`/api/auth/user/${toUsername.trim()}`);
      const toUserId = target?.user?.id;
      if (!toUserId) { showToast('用户不存在', 'error'); return; }
      await api.post('/api/contributions/transfer', { toUserId, amount: amt, note: transferNote.trim() });
      showToast('转账成功', 'success');
      setToUsername('');
      setTransferAmount('');
      setTransferNote('');
      fetchLogs(logType);
    } catch (e) {
      showToast(e.message || '转账失败', 'error');
    } finally {
      setTransferring(false);
    }
  };

  const switchPageTab = (t) => {
    setPageTab(t);
    if (t === 'logs' && logs.length === 0) fetchLogs();
  };

  const isAdmin = user?.level >= 1;

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/7.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>贡献点</h1>
          <p>申报贡献、成员互转、查看明细流水</p>
        </div>
      </div>

      <div className="flex" style={{ gap: 10, marginBottom: 20 }}>
        <button className={`btn ${pageTab === 'claim' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPageTab('claim')}>贡献点申报</button>
        <button className={`btn ${pageTab === 'transfer' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPageTab('transfer')}>贡献点互转</button>
        <button className={`btn ${pageTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchPageTab('logs')}>我的流水</button>
      </div>

      {pageTab === 'transfer' && (
        <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>转账给其他成员</h3>
            <p className="text-secondary" style={{ fontSize: 12, marginBottom: 18 }}>单次上限 1000 贡献点，每日累计转出上限 1000。转账后将通知对方。</p>
            <div className="form-group">
              <label className="form-label">对方用户名</label>
              <input className="form-input" value={toUsername} onChange={e => setToUsername(e.target.value)} placeholder="输入对方的用户名，如 xuanjian" />
            </div>
            <div className="form-group">
              <label className="form-label">转账数量</label>
              <input type="number" className="form-input" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder="例如：50" min="1" />
            </div>
            <div className="form-group">
              <label className="form-label">备注（可选）</label>
              <input className="form-input" value={transferNote} onChange={e => setTransferNote(e.target.value)} placeholder="转账用途说明" />
            </div>
            <div className="flex-between" style={{ alignItems: 'center' }}>
              <span className="text-secondary" style={{ fontSize: 13 }}>我的贡献点：{user?.contribution ?? 0}</span>
              <button className="btn btn-primary" onClick={doTransfer} disabled={transferring}>
                {transferring ? '转账中...' : '确认转账'}
              </button>
            </div>
          </div>
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>互转说明</h3>
            <div className="flex-col" style={{ gap: 14 }}>
              {[
                '按劳分配：贡献点代表你为公会建设做出的贡献',
                '可通过他人转入、完成任务、自行申报获得',
                '贡献点可兑换公会仓库或机器的使用权限',
                '转账前请确认对方用户名正确，转账后不可撤销',
                '每日转出上限 1000 贡献点，防止恶意刷点'
              ].map((t, i) => (
                <div key={i} className="flex" style={{ gap: 10, fontSize: 14, lineHeight: 1.6 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{i + 1}</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {pageTab === 'logs' && (
        <div className="card" style={{ padding: 24 }}>
          <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>我的贡献点流水</h3>
            <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
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
                        <span style={{ fontWeight: 700, color: positive ? 'var(--success)' : 'var(--danger)' }}>{positive ? '+' : ''}{l.amount} 贡献点</span>
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
      )}

      {pageTab === 'claim' && (
      <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
        {/* 申报表单 */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 18 }}>提交申报</h3>
          <div className="form-group">
            <label className="form-label">申报贡献点数量</label>
            <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} placeholder="例如：10" min="1" />
          </div>
          <div className="form-group">
            <label className="form-label">申报原因（至少10个字符）</label>
            <textarea className="form-textarea" style={{ minHeight: 120 }} value={reason} onChange={e => setReason(e.target.value)} placeholder="请详细描述你的贡献内容..." />
          </div>
          <div className="form-group">
            <label className="form-label">证明材料（图片，可选）</label>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={handleImages} />
            <button type="button" className="btn btn-secondary" onClick={() => fileInput.current.click()} disabled={uploading}>
              {uploading ? (uploadProgress !== null ? `上传中 ${uploadProgress}%` : '上传中...') : '+ 上传证明材料'}
            </button>
            {evidence.length > 0 && (
              <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {evidence.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt="" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                    <button type="button" onClick={() => setEvidence(prev => prev.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-primary btn-block" onClick={submit} disabled={submitting}>
            {submitting ? '提交中...' : '提交申报'}
          </button>
        </div>

        {/* 申报记录 */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>我的申报记录</h3>
          <div className="flex" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {['pending', 'approved', 'rejected'].map(s => (
              <button key={s} className={`btn btn-sm ${tab === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setTab(s); fetchClaims(s); }}>
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="loading" style={{ padding: 20 }}><div className="spinner" /></div>
          ) : claims.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}><p>暂无记录</p></div>
          ) : (
            <div className="flex-col" style={{ gap: 12 }}>
              {claims.map(c => (
                <div key={c.id} className="card" style={{ padding: 14, background: 'var(--input-bg)' }}>
                  <div className="flex-between mb-1">
                    <span style={{ fontWeight: 700, color: 'var(--warning)' }}>+{c.amount} 贡献点</span>
                    <span className="badge" style={{ background: `${STATUS_META[c.status]?.color}1a`, color: STATUS_META[c.status]?.color }}>
                      {STATUS_META[c.status]?.label || c.status}
                    </span>
                  </div>
                  <div className="text-secondary" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 6 }}>{c.reason}</div>
                  {c.evidenceImages && c.evidenceImages.length > 0 && (
                    <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                      {c.evidenceImages.map((img, i) => (
                        <a key={i} href={img} target="_blank" rel="noreferrer">
                          <img src={img} alt="" style={{ width: 60, height: 45, objectFit: 'cover', borderRadius: 6 }} />
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="flex-between" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span>{formatDate(c.created_at)}</span>
                    {c.review_note && <span>审核备注：{c.review_note}</span>}
                    {isAdmin && c.status === 'pending' && (
                      <span className="flex" style={{ gap: 6 }}>
                        <button className="btn btn-success btn-sm" onClick={() => adminReview(c.id, 'approved')}>通过</button>
                        <button className="btn btn-danger btn-sm" onClick={() => adminReview(c.id, 'rejected')}>驳回</button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

    </div>
  );
}
