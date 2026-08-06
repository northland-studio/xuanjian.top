import { useEffect, useState } from 'react';
import { api } from '../api';

const STORAGE_KEY = 'xj_popup_announcement_seen';

export default function AnnouncementPopup() {
  const [announcement, setAnnouncement] = useState(null);

  useEffect(() => {
    api.get('/api/announcements/popup')
      .then(data => {
        if (!data) return;
        const seen = localStorage.getItem(STORAGE_KEY);
        if (seen === String(data.id)) return;
        setAnnouncement(data);
      })
      .catch(() => { /* 静默失败，不影响页面 */ });
  }, []);

  const close = () => {
    if (announcement) localStorage.setItem(STORAGE_KEY, String(announcement.id));
    setAnnouncement(null);
  };

  if (!announcement) return null;

  return (
    <div className="announcement-popup-overlay" onClick={close}>
      <div className="announcement-popup" onClick={e => e.stopPropagation()}>
        <button className="announcement-popup-close" onClick={close} aria-label="关闭公告">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="announcement-popup-title">{announcement.title || '公告'}</div>
        <div className="announcement-popup-body">{announcement.content}</div>
        <button className="announcement-popup-btn" onClick={close}>我知道了</button>
      </div>
    </div>
  );
}
