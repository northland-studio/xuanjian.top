import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * 首页顶部滚动公告条（无缝横向滚动）
 * 复用公告系统：拉取所有启用的公告（含弹窗公告与普通公告），在首页顶部循环滚动展示。
 * 风格与现有组件一致（--primary / --card / badge 等）。
 */
export default function AnnouncementMarquee() {
  const [announcements, setAnnouncements] = useState([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    api.get('/api/announcements')
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        // 只展示启用的公告
        setAnnouncements(list.filter(a => a.is_active));
      })
      .catch(() => { /* 静默失败 */ });
  }, []);

  if (!announcements.length) return null;

  // 拼接滚动内容：每条公告 = 「标题：内容」，用分隔符连接，复制一份实现无缝循环
  const items = announcements.map(a => `${a.title}${a.content ? '：' + a.content : ''}`);
  const content = items.join('　｜　');
  // 复制两遍，配合 CSS 动画实现无缝滚动
  const trackContent = `${content}　｜　${content}`;

  return (
    <div
      className="announcement-marquee"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="marquee"
      aria-label="公告栏"
    >
      <span className="announcement-marquee-tag">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4, verticalAlign: '-2px' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
        公告
      </span>
      <div className="announcement-marquee-viewport">
        <div className={`announcement-marquee-track${paused ? ' paused' : ''}`}>{trackContent}</div>
      </div>
    </div>
  );
}
