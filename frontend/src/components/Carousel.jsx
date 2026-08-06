import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

// 兜底默认轮播图（复用现有图片资源，管理后台未配置时展示）
const DEFAULT_BANNERS = [
  { id: 0, title: '玄剑公会', subtitle: '探索无限可能，创造属于我们的世界', image: '/1.png', link: '/' },
  { id: 1, title: '公会贴吧', subtitle: '自由交流 · 分享经验 · 展示作品', image: '/4.png', link: '/forum' },
  { id: 2, title: '会员商城', subtitle: '使用贡献点兑换专属好物', image: '/7.png', link: '/shop' },
  { id: 3, title: '每日签到', subtitle: '连续签到赢取丰厚贡献点', image: '/3.png', link: '/checkin' }
];

function normalizeLink(link) {
  if (!link) return null;
  if (link.startsWith('http://') || link.startsWith('https://')) return { external: true, to: link };
  return { external: false, to: link || '/' };
}

// 首页轮播图（支持管理后台配置）
export default function Carousel() {
  const [banners, setBanners] = useState([]);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    api.get('/api/banners')
      .then(data => {
        if (data.banners && data.banners.length > 0) setBanners(data.banners);
        else setBanners(DEFAULT_BANNERS);
      })
      .catch(() => setBanners(DEFAULT_BANNERS));
  }, []);

  const count = banners.length;
  const goTo = useCallback(i => setCurrent(((i % count) + count) % count), [count]);

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  // 自动播放（悬停暂停）
  useEffect(() => {
    if (count <= 1 || paused) return;
    timerRef.current = setInterval(() => {
      setCurrent(c => (c + 1) % count);
    }, 5000);
    return () => clearInterval(timerRef.current);
  }, [count, paused]);

  if (count === 0) return null;

  return (
    <div
      className="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {banners.map((b, i) => {
        const link = normalizeLink(b.link);
        const active = i === current;
        const slide = (
          <>
            <img
              className="carousel-bg"
              src={b.image}
              alt={b.title || '轮播图'}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
            <div className="carousel-overlay" />
            <div className="carousel-text">
              <div className="carousel-kicker">玄剑公会 · Xuanjian Guild</div>
              {b.title && <h2 className="carousel-title">{b.title}</h2>}
              {b.subtitle && <p className="carousel-subtitle">{b.subtitle}</p>}
              {link && !link.external && (
                <Link to={link.to} className="btn btn-primary btn-sm carousel-btn">
                  立即前往
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
                  </svg>
                </Link>
              )}
              {link && link.external && (
                <a href={link.to} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm carousel-btn">
                  立即前往
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
                  </svg>
                </a>
              )}
            </div>
          </>
        );
        return (
          <div key={b.id} className={`carousel-slide ${active ? 'active' : ''}`}>
            {slide}
          </div>
        );
      })}

      {count > 1 && (
        <>
          <button className="carousel-arrow prev" onClick={prev} aria-label="上一张">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button className="carousel-arrow next" onClick={next} aria-label="下一张">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <div className="carousel-dots">
            {banners.map((b, i) => (
              <button
                key={b.id}
                className={`carousel-dot ${i === current ? 'active' : ''}`}
                onClick={() => goTo(i)}
                aria-label={`切换到第${i + 1}张`}
              >
                <span className="carousel-dot-fill" style={{ animationPlayState: paused ? 'paused' : 'running' }} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
