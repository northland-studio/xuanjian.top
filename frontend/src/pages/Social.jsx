import { Link } from 'react-router-dom';

// 社交媒体页面：展示公会各平台官方账号
const PLATFORMS = [
  {
    name: 'QQ群',
    desc: '加入玄剑公会官方QQ群，与成员实时交流',
    icon: 'M21.9 17.5c-.4-1.2-1.2-1.9-2.1-2.6-.6-.5-1.2-.9-1.6-1.4-.1-.1-.2-.3-.2-.5l.1-1.9c.1-1.2-.3-2.4-1.1-3.4-1.4-1.7-3.5-2.4-5.5-2.5h-.5c-2 0-4.1.8-5.5 2.5-.8 1-1.2 2.2-1.1 3.4l.1 1.9c0 .2-.1.4-.2.5-.4.5-1 1-1.6 1.4-.9.7-1.7 1.4-2.1 2.6-.2.6-.3 1.4 0 2 .3.6.9 1 1.6 1 .9 0 1.9-.3 2.8-.6.5-.2 1-.4 1.4-.4.5 0 1 .1 1.5.3.5.3 1 .6 1.5 1 .5.4 1 .9 1.5 1.3.4.3 1.1.3 1.5 0 .5-.4 1-.9 1.5-1.3.5-.4 1-.7 1.5-1 .5-.2 1-.3 1.5-.3.4 0 .9.2 1.4.4.9.3 1.9.6 2.8.6.7 0 1.3-.4 1.6-1 .3-.6.2-1.4 0-2z',
    color: '#12B7F5',
    link: 'https://qm.qq.com/cgi-bin/qm/qr?k=xuanjian'
  },
  {
    name: 'B站',
    desc: '关注B站账号，观看公会视频与实况',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm-2.2 6.2v7.6a1 1 0 001.5.86l6.6-3.8a1 1 0 000-1.72l-6.6-3.8a1 1 0 00-1.5.86z',
    color: '#00A1D6',
    link: '#'
  },
  {
    name: '抖音',
    desc: '关注抖音账号，获取公会日常花絮',
    icon: 'M12 2v13.55A4 4 0 1014.2 19V7h4.4V3h-6.6z',
    color: '#FE2C55',
    link: '#'
  }
];

export default function Social() {
  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/4.png)' }}>
        <div className="page-banner-content">
          <h1>社交媒体</h1>
          <p>关注公会各平台官方账号，不错过任何精彩瞬间</p>
        </div>
      </div>

      <div className="grid grid-3">
        {PLATFORMS.map(p => (
          <a key={p.name} href={p.link} target={p.link !== '#' ? '_blank' : undefined} rel="noreferrer" className="card card-hover text-center" style={{ padding: 36, textDecoration: 'none', display: 'block' }}>
            <div className="flex-center" style={{ width: 72, height: 72, margin: '0 auto 18px', borderRadius: 20, background: `${p.color}14`, color: p.color }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
                <path d={p.icon} />
              </svg>
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{p.name}</h3>
            <p className="text-secondary" style={{ fontSize: 13, lineHeight: 1.7 }}>{p.desc}</p>
            <span className="btn btn-secondary btn-sm mt-4" style={{ color: 'var(--primary)' }}>立即关注 →</span>
          </a>
        ))}
      </div>

      <div className="card text-center mt-4" style={{ padding: 32 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>更多互动方式</h3>
        <p className="text-secondary" style={{ fontSize: 14, marginBottom: 16 }}>
          登录公会网站参与日报、决策与贴吧讨论，你的每一次发言都在推动公会成长。
        </p>
        <Link to="/forum" className="btn btn-primary">进入贴吧</Link>
      </div>
    </div>
  );
}
