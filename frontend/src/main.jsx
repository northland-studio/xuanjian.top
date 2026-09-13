import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/global.css';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/UI';
import { applyPlatformAttrs, isNative } from './lib/platform';

// 首屏渲染前标记运行环境（data-platform / data-shell / data-native / data-touch），
// 供 CSS 做分端适配（安全区域、触摸交互、原生壳样式等）
applyPlatformAttrs();

// 修正移动端浏览器动态工具栏导致 100vh 不准的问题，暴露 --app-vh
function syncAppHeight() {
  document.documentElement.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`);
}
syncAppHeight();
window.addEventListener('resize', syncAppHeight);
window.addEventListener('orientationchange', syncAppHeight);

// PWA Service Worker（仅网页版注册；Electron/Capacitor 原生环境不注册）
if ('serviceWorker' in navigator && !isNative) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  </BrowserRouter>
);
