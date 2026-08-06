import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const TABS = [
  { key: 'contribution', label: '贡献点排行' },
  { key: 'posts-views', label: '内容热度' },
  { key: 'posts-likes', label: '点赞排行' },
  { key: 'checkin', label: '签到排行' }
];

export default function Rankings() {
  const [tab, setTab] = useState('contribution');
  const [rankings, setRankings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const isContribution = tab === 'contribution';
    const apiUrl = isContribution ? '/api/rankings/contribution' : `/api/rankings/${tab}?limit=20`;
    api.get(apiUrl)
      .then(data => setRankings(data.rankings || []))
      .catch(() => setRankings([]))
      .finally(() => setLoading(false));
  }, [tab]);

  const isPosts = tab === 'posts-views' || tab === 'posts-likes';

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/2.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>成员排行榜</h1>
          <p>见证大家的付出与荣耀，争做公会之星</p>
        </div>
      </div>

      <div className="flex" style={{ gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} className={`btn ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />加载中...</div>
      ) : rankings.length === 0 ? (
        <div className="empty-state"><p>暂无数据</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {rankings.map((r, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
            return isPosts ? (
              <Link key={r.id} to={`/post/${r.id}`} className="rank-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--border)', textDecoration: 'none' }}>
                <span className="rank-num" style={{ width: 40, textAlign: 'center', fontWeight: 800, fontSize: 16, color: i < 3 ? 'var(--warning)' : 'var(--text-secondary)' }}>{medal || i + 1}</span>
                <img src={r.avatar || '/images/default-avatar.png'} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{r.title}</div>
                  <div className="text-secondary" style={{ fontSize: 12 }}>
                    {r.nickname || r.username}
                    {r.title_name && <span className="badge ml-1" style={{ background: `${r.title_color || 'var(--primary)'}22`, color: r.title_color || 'var(--primary)', fontSize: 11 }}>{r.title_name}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--primary)' }}>{r.views || 0} 浏览</div>
                  <div className="text-secondary" style={{ fontSize: 12 }}>{r.likes || 0} 赞 · {r.comments_count || 0} 评</div>
                </div>
              </Link>
            ) : (
              <Link key={r.id} to={`/profile/${r.username}`} className="rank-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--border)', textDecoration: 'none' }}>
                <span className="rank-num" style={{ width: 40, textAlign: 'center', fontWeight: 800, fontSize: 16, color: i < 3 ? 'var(--warning)' : 'var(--text-secondary)' }}>{medal || i + 1}</span>
                <img src={r.avatar || '/images/default-avatar.png'} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{r.nickname || r.username}</span>
                  {r.title_name && <span className="badge ml-1" style={{ background: `${r.title_color || 'var(--primary)'}22`, color: r.title_color || 'var(--primary)', fontSize: 11 }}>{r.title_name}</span>}
                </div>
                {tab === 'checkin' ? (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: 'var(--success)' }}>{r.continuous_days || 0} 天</div>
                    <div className="text-secondary" style={{ fontSize: 12 }}>连续 · 共{r.total_checkins || 0}次</div>
                  </div>
                ) : (
                  <div style={{ fontWeight: 700, color: 'var(--warning)' }}>{r.contribution ?? 0} <span style={{ fontSize: 12, fontWeight: 400 }}>贡献点</span></div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
