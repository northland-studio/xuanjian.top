import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, uploadImages } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { fmtPoints } from '../utils';
import { requireLogin, formatDate } from '../utils';

const STATUS_META = {
  pending: { label: '待审核', color: 'var(--warning)' },
  approved: { label: '已通过', color: 'var(--success)' },
  rejected: { label: '已驳回', color: 'var(--danger)' }
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

  const isAdmin = user?.level >= 1;

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/7.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>贡献点申报</h1>
          <p>申报你的公会贡献，支持上传图片作为证明材料</p>
        </div>
      </div>

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
                    <span style={{ fontWeight: 700, color: 'var(--warning)' }}>+{fmtPoints(c.amount)} 贡献点</span>
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
    </div>
  );
}
