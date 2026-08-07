import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/UI';
import { requireLogin, formatDate } from '../utils';

const TYPE_NAMES = { daily: '日报', decision: '决策', forum: '贴吧' };

export default function Following() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [tab, setTab] = useState('feed');
  const [posts, setPosts] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [follows, setFollows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!requireLogin(navigate)) return;
    setLoading(true);
    Promise.all([
      api.get('/api/favorites/feed').then(d => d.posts || []).catch(() => []),
      api.get('/api/favorites/posts').then(d => d.favorites || []).catch(() => []),
      api.get('/api/favorites/users').then(d => d.follows || []).catch(() => [])
    ]).then(([p, f, fl]) => {
      setPosts(p);
      setFavorites(f);
      setFollows(fl);
      setLoading(false);
    });
  }, [navigate]);

  const unfollow = async (userId) => {
    if (!confirm('确定取消关注？')) return;
    try {
      await api.post(`/api/favorites/users/${userId}`, {});
      showToast('已取消关注', 'success');
      setFollows(follows.filter(x => x.id !== userId));
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />加载中...</div>;

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/2.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>关注动态</h1>
          <p>关注你关心的成员，不错过任何动态</p>
        </div>
      </div>

      <div className="flex" style={{ gap: 10, marginBottom: 20 }}>
        <button className={`btn ${tab === 'feed' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('feed')}>关注动态</button>
        <button className={`btn ${tab === 'fav' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('fav')}>我的收藏</button>
        <button className={`btn ${tab === 'follows' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('follows')}>我的关注（{follows.length}）</button>
      </div>

      {tab === 'feed' && (posts.length === 0 ? (
        <div className="empty-state">
          <p>还没有关注动态</p>
          <p className="text-secondary" style={{ fontSize: 13, marginTop: 6 }}>去成员主页关注感兴趣的成员吧</p>
        </div>
      ) : (
        <div className="grid grid-3">
          {posts.map(p => (
            <Link key={p.id} to={`/post/${p.id}`} className="card" style={{ padding: 20, textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <img src={p.author_avatar || '/images/default-avatar.png'} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
                <span className="text-secondary" style={{ fontSize: 12 }}>{p.author_nickname || p.author_username}</span>
                <span className="badge badge-primary" style={{ fontSize: 10 }}>{TYPE_NAMES[p.type] || p.type}</span>
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{p.title}</h3>
              <p className="text-secondary" style={{ fontSize: 12 }}>{formatDate(p.created_at, false)} · {p.views} 阅读 · {p.likes} 赞</p>
            </Link>
          ))}
        </div>
      ))}

      {tab === 'fav' && (favorites.length === 0 ? (
        <div className="empty-state">
          <p>还没有收藏任何帖子</p>
          <Link to="/forum" className="btn btn-primary mt-3">去逛逛</Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {favorites.map(f => (
            <Link key={f.favorite_id} to={`/post/${f.id}`} className="flex" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', gap: 12, textDecoration: 'none', color: 'inherit' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{f.title}</div>
                <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                  {f.author_nickname || f.author_username} · {formatDate(f.created_at, false)} · {f.likes} 赞
                </div>
              </div>
              <span className="badge badge-primary" style={{ fontSize: 10 }}>{TYPE_NAMES[f.type] || f.type}</span>
            </Link>
          ))}
        </div>
      ))}

      {tab === 'follows' && (follows.length === 0 ? (
        <div className="empty-state"><p>还没有关注任何人</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {follows.map(u => (
            <div key={u.id} className="flex" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', gap: 12, alignItems: 'center' }}>
              <img src={u.avatar || '/images/default-avatar.png'} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
              <Link to={`/profile/${u.username}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
                <div style={{ fontWeight: 600 }}>{u.nickname || u.username}</div>
                <div className="text-secondary" style={{ fontSize: 12 }}>@{u.username} · {u.contribution} 贡献点</div>
              </Link>
              <button className="btn btn-secondary btn-sm" onClick={() => unfollow(u.id)}>取消关注</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
