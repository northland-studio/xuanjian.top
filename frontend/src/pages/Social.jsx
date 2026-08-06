import { Link } from 'react-router-dom';

// 社交媒体页面：展示公会各平台官方账号
const PLATFORMS = [
  {
    name: 'QQ群',
    desc: '加入玄剑公会官方QQ群，与成员实时交流',
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H16.3c-.05-1.15-.69-1.81-2.34-1.81-1.74 0-2.48.87-2.48 1.7 0 .86.7 1.31 2.66 1.9 2.41.73 4.1 1.64 4.1 3.72 0 1.87-1.44 3.11-3.83 3.44z',
    color: '#12B7F5',
    link: 'https://qm.qq.com/cgi-bin/qm/qr?k=xuanjian'
  },
  {
    name: 'B站',
    desc: '关注B站账号，观看公会视频与实况',
    icon: 'M17.813 4.653h.714l.321-.321a1.6 1.6 0 011.274-.428 1.6 1.6 0 011.274 2.726l-.321.321v.803l.321.321a1.6 1.6 0 01-1.274 2.727 1.6 1.6 0 01-1.274-.428l-.321-.321h-9.23l-.321.321a1.6 1.6 0 01-1.274.428 1.6 1.6 0 01-1.274-2.726l.321-.322v-.803l-.321-.321a1.6 1.6 0 011.274-2.726 1.6 1.6 0 011.274.428l.321.321zm-4.575 4.765a.6.6 0 00-.6.6v.268a.6.6 0 00.6.6h.402a.6.6 0 00.6-.6v-.268a.6.6 0 00-.6-.6zm3.5 0a.6.6 0 00-.6.6v.268a.6.6 0 00.6.6h.401a.6.6 0 00.6-.6v-.268a.6.6 0 00-.6-.6zm-1.75-7.608a.6.6 0 00-.6.6v.268a.6.6 0 00.6.6h.401a.6.6 0 00.6-.6v-.268a.6.6 0 00-.6-.6zm3.5 0a.6.6 0 00-.6.6v.268a.6.6 0 00.6.6h.401a.6.6 0 00.6-.6v-.268a.6.6 0 00-.6-.6zM14.7 15.35l3.7-2.18-3.7-2.18v4.36zM8.988 2.3l5.212 5.214h3.317a1.886 1.886 0 011.886 1.886v4.82a1.886 1.886 0 01-1.886 1.886H7.151a1.886 1.886 0 01-1.886-1.886v-4.82a1.886 1.886 0 011.886-1.886h2.685L13.18 2.3a.357.357 0 00-.009-.5l-.009-.01a.38.38 0 00-.537-.007l-4.51 4.51h-1.26L10.99 2.3l-.009-.009a.38.38 0 00-.537-.007l-1.456 1.456z',
    color: '#00A1D6',
    link: '#'
  },
  {
    name: '抖音',
    desc: '关注抖音账号，获取公会日常花絮',
    icon: 'M12 2c2.717 0 5.057.722 7.132 2.09l-2.15 3.72c-1.1-.66-2.37-1.1-3.97-1.17v9.69c0 .06.002.12.006.18a4.57 4.57 0 11-5.32-4.53V9.03a8.32 8.32 0 00-1.22.09A7.57 7.57 0 104.4 19.84a7.57 7.57 0 006.9-7.55V7.24c2.4.13 3.9 1.03 4.9 2.25.6-.42 3.04-2.27 3.04-2.27L12 2z',
    color: '#000000',
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
