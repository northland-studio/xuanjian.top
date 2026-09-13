import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

// 主题色（同步到 <meta name="theme-color">，影响移动端状态栏 / 桌面端标题栏配色）
const THEME_COLORS = { light: '#004AAD', dark: '#1a1b1d' };

// 首次进入：优先本地存储，其次跟随系统
function initialTheme() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* 私密模式忽略 */ }
    // 多端：同步浏览器/系统壳的主题色
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.light);
  }, [theme]);

  // 未手动设置过主题时，跟随系统切换（iOS/Android 与桌面系统主题变化）
  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch { /* 忽略 */ }
    if (saved === 'dark' || saved === 'light') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e) => setTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
