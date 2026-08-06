import { Link } from 'react-router-dom';
import { QQIcon } from '../components/Icons';

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
          <QQIcon size={24} color="#12B7F5" />
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
