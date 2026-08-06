import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/UI';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const token = params.get('token') || '';
  const [valid, setValid] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) { setValid(false); return; }
    api.get(`/api/password/verify-reset-token/${token}`)
      .then(() => setValid(true))
      .catch(() => setValid(false));
  }, [token]);

  const submit = async () => {
    if (password.length < 6) { showToast('密码至少6位', 'error'); return; }
    if (password !== confirm) { showToast('两次密码不一致', 'error'); return; }
    setLoading(true);
    try {
      await api.post('/api/password/reset-password', { token, newPassword: password });
      showToast('密码重置成功，请使用新密码登录', 'success');
      setTimeout(() => navigate('/login'), 1200);
    } catch (e) {
      showToast(e.message || '重置失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fade-in-up" style={{ maxWidth: 420, margin: '40px auto' }}>
      <div className="card" style={{ padding: 40 }}>
        <div className="text-center mb-4">
          <img src="/icon.png" alt="玄剑公会" style={{ width: 72, height: 72, borderRadius: 16, marginBottom: 16 }} />
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>重置密码</h1>
        </div>

        {valid === null ? (
          <div className="loading" style={{ padding: 30 }}><div className="spinner" />验证中...</div>
        ) : valid === false ? (
          <div className="text-center">
            <p className="text-secondary" style={{ marginBottom: 20 }}>链接无效或已过期</p>
            <Link to="/forgot-password" className="btn btn-primary">重新发送</Link>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">新密码</label>
              <input type="password" className="form-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入新密码" />
            </div>
            <div className="form-group">
              <label className="form-label">确认新密码</label>
              <input type="password" className="form-input" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="请再次输入新密码" />
            </div>
            <button className="btn btn-primary btn-block" onClick={submit} disabled={loading}>
              {loading ? '提交中...' : '确认重置'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
