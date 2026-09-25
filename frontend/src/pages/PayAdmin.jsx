import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AlertIcon } from '../components/ChatIcons';
import PayAdminPanel from '../components/PayAdminPanel';

/**
 * 支付管理独立页：/pay/admin
 * 面板实现见 components/PayAdminPanel.jsx（同一份代码也挂在站点管理后台的「支付管理」分页）
 */
export default function PayAdmin() {
  const { user } = useAuth();

  if (!user || user.level < 1) {
    return (
      <div className="fade-in-up">
        <div className="card" style={{ padding: 26, maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
          <AlertIcon size={44} />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '10px 0 6px' }}>无访问权限</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            支付管理页面仅对管理员开放。如需查看自己的收付款记录，请前往「我的收付款记录」。
          </p>
          <div className="flex-center" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <Link to="/pay/records" className="btn btn-primary">我的收付款记录</Link>
            <Link to="/pay" className="btn btn-secondary">支付中心</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/6.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>支付管理</h1>
          <p>大额审批、对账概览、全量流水与风控阈值</p>
          <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Link to="/admin#pay" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>站点管理后台</Link>
            <Link to="/pay/records" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>我的记录</Link>
          </div>
        </div>
      </div>

      <PayAdminPanel />
    </div>
  );
}
