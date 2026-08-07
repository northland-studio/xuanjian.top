import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { timeAgo } from '../utils';

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    api.get('/api/notifications')
      .then(data => setNotifications(data.notifications || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const markRead = async (id) => {
    try {
      await api.put(`/api/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
    } catch (e) {}
  };

  const markAllRead = async () => {
    try {
      await api.put('/api/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    } catch (e) {}
  };

  if (!user) {
    return (
      <div className="empty-state">
        <p>请先登录后查看通知</p>
        <a href="/login" className="btn btn-primary mt-3">去登录</a>
      </div>
    );
  }

  const unread = notifications.filter(n => !n.is_read).length;

  return (
    <div className="fade-in-up" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="flex-between mb-4">
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>我的通知</h1>
        {unread > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={markAllRead}>全部已读</button>
        )}
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />加载中...</div>
      ) : notifications.length === 0 ? (
        <div className="empty-state"><p>暂无通知</p></div>
      ) : (
        <div className="flex-col" style={{ gap: 10 }}>
          {notifications.map(n => (
            <div
              key={n.id}
              className={`card ${!n.is_read ? 'notif-unread' : ''}`}
              style={{ padding: 16, cursor: 'pointer', borderColor: !n.is_read ? 'var(--primary)' : undefined }}
              onClick={() => handleClick(n)}
            >
              <div className="flex-between" style={{ marginBottom: 6 }}>
                <span className="badge badge-primary" style={{ fontSize: 11 }}>{n.type}</span>
                <span className="text-secondary" style={{ fontSize: 12 }}>{timeAgo(n.created_at)}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{n.title}</div>
              <div className="text-secondary" style={{ fontSize: 13 }}>{n.content}</div>
              {!n.is_read && <span className="badge badge-danger" style={{ fontSize: 10, marginTop: 8 }}>未读</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
