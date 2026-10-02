import { createContext, useContext } from 'react';

/**
 * 服务端预取数据（SSR/SSG 首屏）
 *
 * 服务端渲染时由 lib/ssr.js 传入一份 { [provider]: data }，
 * 客户端 hydrate 时由 window.__SSR_DATA__ 传入同一份数据 —— 两边首屏渲染结果一致，才能无警告 hydrate。
 *
 * 页面用法：
 *   const seeded = useServerData('post');           // 服务端给的数据（没有则为 undefined）
 *   const [post, setPost] = useState(seeded || null);
 *   useEffect(() => { if (!seeded) { 正常走 api.get(...) } }, []);
 */
const ServerDataContext = createContext(null);

export function ServerDataProvider({ value, children }) {
  return <ServerDataContext.Provider value={value || null}>{children}</ServerDataContext.Provider>;
}

/** 取某个数据源的服务端预取结果（客户端首次渲染也会命中，保证 hydration 一致） */
export function useServerData(key) {
  const all = useContext(ServerDataContext);
  if (!all || !key) return undefined;
  return all[key];
}

/** 取整份预取数据（少数页面需要多个 key 时用） */
export function useServerDataAll() {
  return useContext(ServerDataContext) || {};
}

export default ServerDataContext;
