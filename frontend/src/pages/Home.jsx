import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Carousel from '../components/Carousel';
import AnnouncementMarquee from '../components/AnnouncementMarquee';
import { api } from '../api';

const features = [
  {
    to: '/daily',
    title: '公会日报',
    desc: '了解公会最新动态、活动预告和重要通知，掌握第一手资讯',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="28" height="28">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
  },
  {
    to: '/decision',
    title: '决策公示',
    desc: '公会重大决策和管理制度公示，确保公会运营透明公开',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="28" height="28">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    )
  },
  {
    to: '/forum',
    title: '公会贴吧',
    desc: '自由交流、分享经验、展示作品，与公会成员一起畅所欲言',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="28" height="28">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
      </svg>
    )
  },
  {
    to: '/shop',
    title: '会员商城',
    desc: '使用贡献点兑换专属商品、称号和福利，享受会员特权',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="28" height="28">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    )
  },
  {
    to: '/rankings',
    title: '成员排行榜',
    desc: '查看公会成员贡献排行，见证大家的付出与荣耀',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="28" height="28">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )
  },
  {
    to: '/social',
    title: '社交媒体',
    desc: '关注公会社交媒体账号，不错过任何精彩瞬间',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="28" height="28">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    )
  }
];

export default function Home() {
  const [stats, setStats] = useState({ users: 0, posts: 0, comments: 0 });

  useEffect(() => {
    api.get('/api/posts/public-stats')
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className="fade-in-up">
      {/* 首页顶部滚动公告 */}
      <AnnouncementMarquee />

      {/* 轮播图（主页 Hero） */}
      <Carousel />

      {/* 统计数据 */}
      <div className="stats-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, textAlign: 'center', marginBottom: 32 }}>
        <div className="stats-strip-item">
          <div className="stats-strip-num" style={{ color: 'var(--primary)' }}>{stats.users || 0}</div>
          <div className="text-secondary" style={{ fontSize: 13 }}>注册成员</div>
        </div>
        <div className="stats-strip-item">
          <div className="stats-strip-num" style={{ color: 'var(--success)' }}>{stats.posts || 0}</div>
          <div className="text-secondary" style={{ fontSize: 13 }}>发布内容</div>
        </div>
        <div className="stats-strip-item">
          <div className="stats-strip-num" style={{ color: 'var(--accent)' }}>{stats.comments || 0}</div>
          <div className="text-secondary" style={{ fontSize: 13 }}>互动交流</div>
        </div>
      </div>

      {/* 功能入口 */}
      <div className="section-head">
        <h2 className="section-title">公会功能</h2>
        <p className="section-desc">选择想要探索的板块，开始你的玄剑之旅</p>
      </div>
      <div className="grid grid-3" style={{ marginBottom: 32 }}>
        {features.map((f, i) => (
          <Link key={f.to} to={f.to} className="card card-hover stagger-item" style={{ display: 'block', textDecoration: 'none', animationDelay: `${i * 0.06}s` }}>
            <div className="feature-icon" style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--gradient)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, transition: 'transform .3s' }}>
              {f.icon}
            </div>
            <h3 style={{ fontSize: 17, marginBottom: 6, color: 'var(--text)' }}>{f.title}</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{f.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
