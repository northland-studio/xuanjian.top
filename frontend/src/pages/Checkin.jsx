import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { requireLogin, formatDate } from '../utils';

export default function Checkin() {
  const navigate = useNavigate();
  const { user, refreshMe } = useAuth();
  const { showToast } = useToast();
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!requireLogin(navigate)) return;
    Promise.all([
      api.get('/api/checkin/status').catch(() => null),
      api.get('/api/checkin/leaderboard?limit=10').catch(() => ({ leaderboard: [] }))
    ]).then(([s, l]) => {
      setStatus(s);
      setLeaderboard(l.leaderboard || []);
      setLoading(false);
    });
  }, [navigate]);

  const doCheckin = async () => {
    setChecking(true);
    try {
      const data = await api.post('/api/checkin/checkin', {});
      showToast(`签到成功！获得 ${data.rewardPoints} 贡献点`, 'success');
      setStatus(prev => ({ ...prev, todayCheckedIn: true, todayReward: data.rewardPoints, continuousDays: data.continuousDays, totalCheckins: (prev?.totalCheckins || 0) + 1, maxContinuousDays: Math.max(prev?.maxContinuousDays || 0, data.continuousDays) }));
      refreshMe();
    } catch (e) {
      showToast(e.message || '签到失败', 'error');
    } finally {
      setChecking(false);
    }
  };

  if (!user) {
    return <div className="empty-state"><p>请先登录</p><Link to="/login" className="btn btn-primary mt-3">去登录</Link></div>;
  }

  if (loading) return <div className="loading"><div className="spinner" />加载中...</div>;

  const rewards = status?.rewards || [];
  const recent = status?.recentCheckins || [];

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/3.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>每日签到</h1>
          <p>每日签到固定获得 2 贡献点</p>
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
        {/* 签到卡片 */}
        <div className="card text-center" style={{ padding: 32 }}>
          <div className="checkin-calendar flex-center" style={{ width: 88, height: 88, margin: '0 auto 16px', borderRadius: 24, background: 'var(--gradient)', color: '#fff', fontSize: 32, fontWeight: 800 }}>
            {status?.continuousDays || 0}
          </div>
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 6 }}>当前连续签到天数</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
            {status?.todayCheckedIn ? `今日已签到（+${status.todayReward || 0} 贡献点）` : `今日签到可获得 ${status?.todayReward || 0} 贡献点`}
          </div>
          <button className="btn btn-primary btn-block" disabled={status?.todayCheckedIn || checking} onClick={doCheckin} style={{ fontSize: 16, padding: 14 }}>
            {status?.todayCheckedIn ? '今日已签到' : checking ? '签到中...' : '立即签到'}
          </button>

          <div className="grid grid-2" style={{ gap: 10, marginTop: 20, textAlign: 'center' }}>
            <div className="card" style={{ padding: '12px 8px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)' }}>{status?.totalCheckins || 0}</div>
              <div className="text-secondary" style={{ fontSize: 12 }}>累计签到</div>
            </div>
            <div className="card" style={{ padding: '12px 8px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--success)' }}>{status?.maxContinuousDays || 0}</div>
              <div className="text-secondary" style={{ fontSize: 12 }}>最高连签</div>
            </div>
          </div>
        </div>

        {/* 右侧信息 */}
        <div className="flex-col" style={{ gap: 16 }}>
          {/* 奖励规则 */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>签到奖励规则</h3>
            <div className="flex-col" style={{ gap: 8 }}>
              {rewards.map(r => (
                <div key={r.continuous_days} className="flex-between" style={{ fontSize: 13.5 }}>
                  <span className="text-secondary">连续 {r.continuous_days} 天</span>
                  <span style={{ fontWeight: 600, color: 'var(--warning)' }}>+{r.reward_points} 贡献点</span>
                </div>
              ))}
            </div>
          </div>

          {/* 排行榜 */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>签到排行榜</h3>
            {leaderboard.length === 0 ? (
              <div className="text-secondary" style={{ fontSize: 13 }}>暂无数据</div>
            ) : (
              leaderboard.slice(0, 5).map((u, i) => (
                <div key={u.id} className="flex-between" style={{ padding: '8px 0', fontSize: 14, borderBottom: '1px solid var(--border)' }}>
                  <span className="flex" style={{ gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 22, color: i < 3 ? 'var(--warning)' : 'var(--text-secondary)', fontWeight: 700 }}>{i + 1}</span>
                    <Link to={`/profile/${u.username}`} style={{ color: 'var(--text)' }}>{u.nickname || u.username}</Link>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--success)' }}>{u.continuous_days} 天</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 最近签到记录 */}
      {recent.length > 0 && (
        <div className="card mt-4" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>最近签到记录</h3>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            {recent.map(r => (
              <span key={r.checkin_date} className="badge badge-success" style={{ fontSize: 12 }}>
                {r.checkin_date} +{r.reward_points}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
