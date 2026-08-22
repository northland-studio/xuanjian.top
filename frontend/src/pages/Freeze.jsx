import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, clearAuth } from '../api';

// 账号冻结页：被处分「开除会籍（冻结账号）」的用户尝试登录时跳转至此
export default function Freeze() {
  const navigate = useNavigate();

  // 冻结用户不应保留登录态，清除本地凭证并停留在本页
  useEffect(() => {
    if (getToken()) clearAuth();
  }, []);

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.icon}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: '0 0 10px' }}>账号已被冻结</h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.85)', lineHeight: 1.8, margin: 0 }}>
          该账号因公会处分已被暂冻结，无法登录官网。
        </p>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8, margin: '14px 0 0' }}>
          如有疑问，请通过 QQ 群联系管理员处理。
        </p>
        <button
          onClick={() => navigate('/login')}
          style={{
            marginTop: 28,
            padding: '12px 32px',
            border: 'none',
            borderRadius: 10,
            background: 'linear-gradient(135deg,#ef4444,#dc2626)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          返回登录
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: 'radial-gradient(circle at 50% 30%, #1e293b 0%, #0f172a 60%, #0b1120 100%)'
  },
  card: {
    maxWidth: 440,
    width: '100%',
    textAlign: 'center',
    padding: '44px 32px',
    borderRadius: 20,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
    backdropFilter: 'blur(6px)'
  },
  icon: {
    width: 96,
    height: 96,
    margin: '0 auto 20px',
    borderRadius: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ef4444',
    background: 'rgba(239,68,68,0.14)'
  }
};
