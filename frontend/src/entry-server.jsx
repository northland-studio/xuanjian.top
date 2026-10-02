/**
 * SSR/SSG 服务端入口
 *
 * 由 lib/ssr.js 在 Node 侧 import 后调用 render(url, serverData)：
 *   - 用 MemoryRouter 渲染（react-router 7 没有 react-router-dom/server 的 StaticRouter，
 *     MemoryRouter 在服务端渲染出的树与客户端 BrowserRouter 首次渲染一致，可直接 hydrate）
 *   - serverData 是 lib/prefetch/* 预取的数据，注入 ServerDataProvider，让首屏就有真实内容
 * 构建：vite build --ssr src/entry-server.jsx（见 package.json 的 build:ssr）
 */
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/UI';
import { ServerDataProvider } from './context/ServerDataContext';

export function render(url, serverData = null) {
  const html = renderToString(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider>
        <ServerDataProvider value={serverData}>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </ServerDataProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  return { html };
}

export default render;
