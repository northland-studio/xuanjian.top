import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

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

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const navLinks = [
    { to: '/daily', label: '日报' },
    { to: '/decision', label: '决策' },
    { to: '/forum', label: '贴吧' },
    { to: '/shop', label: '商城' },
    { to: '/rankings', label: '排行榜' },
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
              {user ? (
                <Link to="/profile" title={user.nickname || user.username}>
                  <img src={user.avatar || '/images/default-avatar.png'} alt="头像" className="nav-avatar" />
                </Link>
              ) : (
                <Link to="/login" className="nav-login-btn">登录</Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="main-content">
        <div className="container">{children}</div>
      </main>

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
