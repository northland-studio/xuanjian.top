import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/UI';

export default function ForgotPassword() {
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const sendReset = async () => {
    if (!email.trim()) { showToast('请输入邮箱', 'error'); return; }
    setLoading(true);
    try {
      await api.post('/api/password/forgot-password', { email: email.trim() });
      setStep(2);
    } catch (e) {
      showToast(e.message || '发送失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fade-in-up" style={{ maxWidth: 420, margin: '40px auto' }}>
      <div className="card" style={{ padding: 40 }}>
        <div className="text-center mb-4">
          <img src="/icon.png" alt="玄剑公会" style={{ width: 72, height: 72, borderRadius: 16, marginBottom: 16 }} />
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>找回密码</h1>
          <p className="text-secondary" style={{ fontSize: 14 }}>通过邮箱验证重置密码</p>
        </div>

        {step === 1 ? (
          <>
            <div className="form-group">
              <label className="form-label">注册邮箱</label>
              <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="请输入注册邮箱" />
            </div>
            <button className="btn btn-primary btn-block" onClick={sendReset} disabled={loading}>
              {loading ? '发送中...' : '发送重置邮件'}
            </button>
          </>
        ) : (
          <div className="text-center">
            <div className="flex-center" style={{ width: 64, height: 64, margin: '0 auto 16px', borderRadius: '50%', background: 'rgba(16,185,129,0.12)', color: 'var(--success)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>重置邮件已发送</h3>
            <p className="text-secondary" style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              请前往 {email} 查收邮件，点击邮件中的链接即可重置密码。
            </p>
            <Link to="/login" className="btn btn-primary">返回登录</Link>
          </div>
        )}

        <div className="text-center mt-4">
          <Link to="/login" className="text-secondary" style={{ fontSize: 14 }}>← 返回登录</Link>
        </div>
      </div>
    </div>
  );
}
