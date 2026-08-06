import { Link } from 'react-router-dom';

// 新用户注册仅支持QQ登录
export default function Register() {
  const qqRegister = () => {
    window.location.href = '/api/auth/qq/login';
  };

  return (
    <div className="fade-in-up" style={{ maxWidth: 420, margin: '40px auto' }}>
      <div className="card" style={{ padding: 40, boxShadow: 'var(--shadow-lg)', textAlign: 'center' }}>
        <img src="/icon.png" alt="玄剑公会" style={{ width: 80, height: 80, borderRadius: 18, marginBottom: 16 }} />
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>加入玄剑公会</h1>
        <p className="text-secondary" style={{ fontSize: 14, marginBottom: 28 }}>
          新用户注册仅支持 QQ 登录，简单快捷
        </p>

        <button onClick={qqRegister} className="btn btn-block" style={{ background: '#fff', color: '#333', border: '1px solid var(--border)', padding: 14 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#12B7F5">
            <path d="M21.9 17.5c-.4-1.2-1.2-1.9-2.1-2.6-.6-.5-1.2-.9-1.6-1.4-.1-.1-.2-.3-.2-.5l.1-1.9c.1-1.2-.3-2.4-1.1-3.4-1.4-1.7-3.5-2.4-5.5-2.5h-.5c-2 0-4.1.8-5.5 2.5-.8 1-1.2 2.2-1.1 3.4l.1 1.9c0 .2-.1.4-.2.5-.4.5-1 1-1.6 1.4-.9.7-1.7 1.4-2.1 2.6-.2.6-.3 1.4 0 2 .3.6.9 1 1.6 1 .9 0 1.9-.3 2.8-.6.5-.2 1-.4 1.4-.4.5 0 1 .1 1.5.3.5.3 1 .6 1.5 1 .5.4 1 .9 1.5 1.3.4.3 1.1.3 1.5 0 .5-.4 1-.9 1.5-1.3.5-.4 1-.7 1.5-1 .5-.2 1-.3 1.5-.3.4 0 .9.2 1.4.4.9.3 1.9.6 2.8.6.7 0 1.3-.4 1.6-1 .3-.6.2-1.4 0-2z" />
          </svg>
          <span style={{ fontSize: 16, fontWeight: 600 }}>使用 QQ 一键注册</span>
        </button>

        <div className="text-secondary mt-4" style={{ fontSize: 13, lineHeight: 1.8, marginTop: 24 }}>
          <p>注册即表示同意公会章程</p>
          <p>新用户注册后请前往设置页绑定邮箱</p>
          <p className="mt-2">已有账号？<Link to="/login" style={{ color: 'var(--primary)' }}>直接登录</Link></p>
        </div>
      </div>
    </div>
  );
}
