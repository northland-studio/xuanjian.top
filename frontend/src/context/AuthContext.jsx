import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, getCurrentUser, clearAuth } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getCurrentUser());
  const [loading, setLoading] = useState(false);

  const refreshMe = useCallback(async () => {
    if (!getToken()) return;
    try {
      const me = await api.get('/api/auth/me');
      localStorage.setItem('user', JSON.stringify(me));
      setUser(me);
    } catch (e) {
      if (e.status === 401) {
        clearAuth();
        setUser(null);
      } else if (e.status === 403 && e.data && e.data.code === 'ACCOUNT_FROZEN') {
        // 账号冻结/封禁立即失效：清空登录态并跳转冻结提示页
        clearAuth();
        setUser(null);
        if (typeof window !== 'undefined' && window.location.pathname !== '/freeze') {
          window.location.href = '/freeze';
        }
      }
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // 权限刷新：切回页面/窗口聚焦时刷新 /api/auth/me（角色、权限、封禁状态变化无需重新登录即可生效）
  useEffect(() => {
    let last = 0;
    const refreshIfStale = () => {
      const now = Date.now();
      if (now - last < 15000) return;
      last = now;
      refreshMe();
    };
    const onVisible = () => { if (!document.hidden) refreshIfStale(); };
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshMe]);

  const login = async (username, password, remember) => {
    const data = await api.post('/api/auth/login', { username, password, remember });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    clearAuth();
    setUser(null);
  };

  const updateUser = (newUser) => {
    setUser(newUser);
    localStorage.setItem('user', JSON.stringify(newUser));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshMe, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
