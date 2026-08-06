import { Link } from 'react-router-dom';
import { QQIcon, BilibiliIcon, DouyinIcon } from '../components/Icons';

// 社交媒体页面：展示公会各平台官方账号
const PLATFORMS = [
  {
    name: 'QQ群',
    desc: '加入玄剑公会官方QQ群，与成员实时交流',
    Icon: QQIcon,
    color: '#12B7F5',
    link: 'https://qm.qq.com/cgi-bin/qm/qr?k=xuanjian'
  },
  {
    name: 'B站',
    desc: '关注B站账号，观看公会视频与实况',
    Icon: BilibiliIcon,
    color: '#00A1D6',
    link: '#'
  },
  {
    name: '抖音',
    desc: '关注抖音账号，获取公会日常花絮',
    Icon: DouyinIcon,
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
              <p.Icon size={36} color={p.color} />
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
