import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';

export default function Login() {
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password, remember);
      showToast('登录成功', 'success');
      const redirect = params.get('redirect');
      setTimeout(() => navigate(redirect || '/'), 500);
    } catch (err) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const qqLogin = () => {
    const redirect = params.get('redirect') || '';
    window.location.href = `/api/auth/qq/login?redirect=${encodeURIComponent(redirect)}`;
  };

  const urlError = params.get('error');

  return (
    <div className="fade-in-up" style={{ maxWidth: 420, margin: '40px auto' }}>
      <div className="card" style={{ padding: 40, boxShadow: 'var(--shadow-lg)' }}>
        <div className="text-center mb-4">
          <img src="/icon.png" alt="玄剑公会" style={{ width: 80, height: 80, borderRadius: 18, marginBottom: 16 }} />
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>欢迎回来</h1>
          <p className="text-secondary" style={{ fontSize: 14 }}>登录您的玄剑公会账号</p>
        </div>

        {(error || urlError) && (
          <div style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', padding: 12, borderRadius: 8, marginBottom: 20, fontSize: 14 }}>
            {error || decodeURIComponent(urlError)}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">用户名</label>
            <input
              className="form-input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="请输入用户名"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">密码</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
            />
          </div>
          <div className="flex-between mb-4" style={{ fontSize: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} />
              <span>记住我</span>
            </label>
            <Link to="/forgot-password" style={{ color: 'var(--primary)' }}>忘记密码？</Link>
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <div className="flex-center gap-3" style={{ margin: '20px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          或
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <button
          onClick={qqLogin}
          className="btn btn-block"
          style={{ background: '#fff', color: '#333', border: '1px solid var(--border)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#12B7F5">
            <path d="M21.9 17.5c-.4-1.2-1.2-1.9-2.1-2.6-.6-.5-1.2-.9-1.6-1.4-.1-.1-.2-.3-.2-.5l.1-1.9c.1-1.2-.3-2.4-1.1-3.4-1.4-1.7-3.5-2.4-5.5-2.5h-.5c-2 0-4.1.8-5.5 2.5-.8 1-1.2 2.2-1.1 3.4l.1 1.9c0 .2-.1.4-.2.5-.4.5-1 1-1.6 1.4-.9.7-1.7 1.4-2.1 2.6-.2.6-.3 1.4 0 2 .3.6.9 1 1.6 1 .9 0 1.9-.3 2.8-.6.5-.2 1-.4 1.4-.4.5 0 1 .1 1.5.3.5.3 1 .6 1.5 1 .5.4 1 .9 1.5 1.3.4.3 1.1.3 1.5 0 .5-.4 1-.9 1.5-1.3.5-.4 1-.7 1.5-1 .5-.2 1-.3 1.5-.3.4 0 .9.2 1.4.4.9.3 1.9.6 2.8.6.7 0 1.3-.4 1.6-1 .3-.6.2-1.4 0-2z" />
          </svg>
          QQ登录
        </button>

        <div className="text-center mt-4" style={{ paddingTop: 20, borderTop: '1px solid var(--border)', fontSize: 14 }}>
          <span className="text-secondary">还没有账号？</span>
          <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 500 }}>使用QQ注册</Link>
        </div>
      </div>
    </div>
  );
}
