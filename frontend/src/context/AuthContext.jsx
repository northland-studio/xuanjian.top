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
      }
    }
  }, []);

  useEffect(() => {
    refreshMe();
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
