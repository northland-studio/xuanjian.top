import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api';
import { AdminIcon } from './Icons';
import SkinWidget from './SkinWidget';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [unread, setUnread] = useState(0);
  const userMenuRef = useRef(null);

  // 轮询未读通知数（登录用户）
  useEffect(() => {
    if (!user) { setUnread(0); return; }
    let cancelled = false;
    const fetchUnread = () => {
      api.get('/api/notifications?limit=1')
        .then(d => { if (!cancelled) setUnread(d.unreadCount || 0); })
        .catch(() => {});
    };
    fetchUnread();
    const t = setInterval(fetchUnread, 30000); // 每30秒
    return () => { cancelled = true; clearInterval(t); };
  }, [user]);

  // WebSocket 实时通知：收到新通知时立即刷新未读数
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`);
    let cancelled = false;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'notification') {
          // 刷新未读角标
          api.get('/api/notifications?limit=1')
            .then(d => { if (!cancelled) setUnread(d.unreadCount || 0); })
            .catch(() => {});
        }
      } catch (e) { /* 忽略 */ }
    };
    return () => { cancelled = true; ws.close(); };
  }, [user]);

  useEffect(() => {
    let lastScroll = window.pageYOffset;
    const onScroll = () => {
      const current = window.pageYOffset;
      if (current > 100 && current > lastScroll) setHidden(true);
      else setHidden(false);
      lastScroll = current;
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 点击外部关闭用户菜单
  useEffect(() => {
    const onClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, []);

  const handleLogout = () => {
    setUserMenuOpen(false);
    logout();
    navigate('/');
  };

  const navLinks = [
    { to: '/daily', label: '日报' },
    { to: '/decision', label: '决策' },
    { to: '/forum', label: '贴吧' },
    { to: '/tasks', label: '任务' },
    { to: '/trade', label: '交易' },
    { to: '/following', label: '动态' },
    { to: '/shop', label: '商城' },
    { to: '/rankings', label: '排行榜' },
    { to: '/economics', label: '经济' },
    { to: '/mods', label: '模组' },
    { to: '/projections', label: '投影' },
    { to: '/social', label: '社交媒体' }
  ];

  return (
    <>
      <nav className={`navbar ${hidden ? 'hidden' : ''}`}>
        <div className="navbar-content">
          <Link to="/" className="navbar-brand">
            <img src="/icon.png" alt="玄剑公会" className="navbar-logo" />
            <div>
              <span className="navbar-title-cn">我的世界玄剑公会</span>
              <span className="navbar-title-en">Minecraft Xuanjian Guild</span>
            </div>
          </Link>

          <button
            className="mobile-menu-btn"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="展开菜单"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className={`navbar-nav ${menuOpen ? 'active' : ''}`} onClick={() => setMenuOpen(false)}>
            {navLinks.map(l => (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                {l.label}
              </NavLink>
            ))}
            <div className="nav-user">
              <button className="theme-toggle" onClick={toggleTheme} title="切换主题">
                <svg className="moon-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                <svg className="sun-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </button>

              {user && (
                <Link to="/notifications" className="theme-toggle notification-bell" title="我的通知">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unread > 0 && <span className="notification-badge">{unread > 99 ? '99+' : unread}</span>}
                </Link>
              )}

              {user ? (
                <div className="user-menu" ref={userMenuRef}>
                  <button
                    className="user-menu-btn"
                    onClick={e => { e.stopPropagation(); setUserMenuOpen(o => !o); }}
                    title={user.nickname || user.username}
                  >
                    <img src={user.avatar || '/images/default-avatar.png'} alt="头像" className="nav-avatar" />
                  </button>
                  {userMenuOpen && (
                    <div className="user-menu-panel" onClick={e => e.stopPropagation()}>
                      <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{user.nickname || user.username}</div>
                        <div className="text-secondary" style={{ fontSize: 12 }}>@{user.username}</div>
                      </div>
                      <Link to="/profile" className="user-menu-item" onClick={() => setUserMenuOpen(false)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        个人主页
                      </Link>
                      <Link to="/settings" className="user-menu-item" onClick={() => setUserMenuOpen(false)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        账户设置
                      </Link>
                      {user.level >= 1 && (
                        <Link to="/admin" className="user-menu-item" onClick={() => setUserMenuOpen(false)}>
                          <AdminIcon size={16} />
                          管理后台
                        </Link>
                      )}
                      <div className="user-menu-sep" />
                      <button className="user-menu-item danger" onClick={handleLogout}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        退出登录
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link to="/login" className="nav-login-btn">登录</Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {user && user.password_set === 0 && (
        <div className="password-tip-banner">
          <span>您还未设置密码，设置后即可使用用户名+密码登录</span>
          <Link to="/settings" onClick={() => setUserMenuOpen(false)}>立即设置</Link>
        </div>
      )}

      <main className="main-content">
        <div className="container">{children}</div>
      </main>

      {/* 右下角常驻皮肤模型（可收起） */}
      <SkinWidget />

      <footer className="footer">
        <div className="footer-content">
          <span>© 2026 我的世界玄剑公会</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <a href="https://xuanjian.top" target="_blank" rel="noreferrer">官网</a>
            <a href="https://qm.qq.com/cgi-bin/qm/qr?k=xuanjian" target="_blank" rel="noreferrer">QQ群</a>
          </span>
        </div>
      </footer>
    </>
  );
}
