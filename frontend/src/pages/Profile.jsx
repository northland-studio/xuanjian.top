import { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../utils';
import PostCard from '../components/PostCard';

export default function Profile() {
  const { username: paramUsername } = useParams();
  const navigate = useNavigate();
  const { user: me } = useAuth();

  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const isSelf = !paramUsername || (me && me.username === paramUsername);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      if (isSelf) {
        if (!me) {
          navigate('/login?redirect=/profile');
          return;
        }
        const data = await api.get('/api/auth/me');
        setProfile({ user: data });
      } else {
        const data = await api.get(`/api/auth/user/${paramUsername}`);
        setProfile(data);
      }
    } catch (e) {
      if (e.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [isSelf, paramUsername, me, navigate]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  useEffect(() => {
    if (!profile) return;
    const username = profile.user.username;
    api.get(`/api/posts?author=${username}&limit=5`)
      .then(data => setPosts(data.posts || []))
      .catch(() => {});
  }, [profile]);

  if (loading) return <div className="loading"><div className="spinner" />加载中...</div>;
  if (notFound || !profile) {
    return <div className="empty-state"><p>用户不存在</p></div>;
  }

  const u = profile.user;

  return (
    <div className="fade-in-up">
      {/* 用户信息卡 */}
      <div className="profile-hero card" style={{ overflow: 'hidden', padding: 0, border: 'none', boxShadow: 'var(--shadow-lg)' }}>
        <div className="profile-cover" style={{ height: 130, background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)' }} />
        <div style={{ padding: '0 24px 24px', position: 'relative' }}>
          <img
            src={u.avatar || '/images/default-avatar.png'}
            alt="头像"
            style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', border: '4px solid var(--card)', position: 'absolute', top: -48, left: 24, boxShadow: 'var(--shadow)' }}
          />
          <div className="flex-between" style={{ alignItems: 'flex-end', marginTop: 56 }}>
            <div>
              <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 24, fontWeight: 800 }}>{u.nickname || u.username}</h1>
                {u.title_name && (
                  <span className="badge" style={{ background: `${u.title_color || 'var(--primary)'}22`, color: u.title_color || 'var(--primary)' }}>
                    {u.title_name}
                  </span>
                )}
                {u.level >= 1 && <span className="badge badge-warning">管理员</span>}
              </div>
              <div className="text-secondary" style={{ fontSize: 13, marginTop: 2 }}>
                @{u.username} · 加入于 {formatDate(u.created_at, false)}
              </div>
            </div>
            {isSelf && (
              <Link to="/settings" className="btn btn-secondary btn-sm">编辑资料</Link>
            )}
          </div>

          {/* 统计 */}
          <div className="grid grid-4" style={{ gap: 12, marginTop: 20 }}>
            {[
              { label: '贡献点', value: u.contribution ?? 0 },
              { label: '帖子', value: u.posts_count ?? 0 },
              { label: '评论', value: u.comments_count ?? 0 },
              { label: '获赞', value: u.likes_count ?? 0 }
            ].map(s => (
              <div key={s.label} className="card" style={{ padding: '14px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)' }}>{s.value}</div>
                <div className="text-secondary" style={{ fontSize: 12 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 个人快捷入口 */}
      {isSelf && (
        <div className="grid grid-4" style={{ gap: 12, margin: '16px 0' }}>
          {[
            { to: '/checkin', label: '每日签到', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
            { to: '/claims', label: '贡献点申报', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
            { to: '/inventory', label: '我的库存', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
            { to: '/notifications', label: '我的通知', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' }
          ].map(s => (
            <Link key={s.to} to={s.to} className="card card-hover" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', textDecoration: 'none' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{s.label}</span>
            </Link>
          ))}
        </div>
      )}

      {/* 用户帖子 */}
      <div className="section-head" style={{ marginTop: 8 }}>
        <h2 className="section-title">{isSelf ? '我的发布' : `${u.nickname || u.username} 的发布`}</h2>
      </div>
      {posts.length === 0 ? (
        <div className="empty-state"><p>暂无发布内容</p></div>
      ) : (
        <div className="flex-col" style={{ gap: 16 }}>
          {posts.map(p => <PostCard key={p.id} post={p} />)}
        </div>
      )}
    </div>
  );
}
