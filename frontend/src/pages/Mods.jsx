import { useAuth } from '../context/AuthContext';

const FEATURES = [
  { icon: 'check', title: '自动签到', desc: '登录服务器后自动完成官网每日签到，贡献点直接到账' },
  { icon: 'link', title: '账号绑定', desc: '/xj bind 将游戏角色与官网账号绑定，支持邮件确认，档案游戏ID自动同步' },
  { icon: 'list', title: '任务系统', desc: '/xj task 查看官方任务、接取任务、验证码提交完成' },
  { icon: 'coin', title: '贡献点', desc: '/xj cb 查询余额，/xj cb pay 二次确认转账，/xj claim 在线申报' },
  { icon: 'users', title: '在线玩家', desc: '/xj online 随时查看服务器在线玩家' },
  { icon: 'sync', title: '实时同步', desc: '官网日报、决策更新与申报审核实时广播到游戏内' }
];

const ICONS = {
  check: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  link: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.657l-2.828 2.828a4 4 0 01-5.657-5.657l1.5-1.5m8.657-5.657l1.5-1.5a4 4 0 115.657 5.657l-2.828 2.828a4 4 0 01-5.657 0" />
    </svg>
  ),
  list: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5h11M9 12h11M9 19h11M5 5h.01M5 12h.01M5 19h.01" />
    </svg>
  ),
  coin: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-4.418 0-8 1.343-8 3s3.582 3 8 3 8-1.343 8-3-3.582-3-8-3zm0 0V6m0 2c4.418 0 8 1.343 8 3v4c0 1.657-3.582 3-8 3s-8-1.343-8-3v-4c0-1.657 3.582-3 8-3z" />
    </svg>
  ),
  users: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  sync: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
};

const COMMANDS = [
  { cmd: '/xj bind <官网账号>', desc: '绑定官网账号（邮件确认）' },
  { cmd: '/xj bind status', desc: '查看绑定状态' },
  { cmd: '/xj checkin', desc: '手动签到' },
  { cmd: '/xj task list', desc: '查看任务列表' },
  { cmd: '/xj task accept <任务ID>', desc: '接取任务' },
  { cmd: '/xj task verify <任务ID> <验证码>', desc: '提交验证码完成任务' },
  { cmd: '/xj task my', desc: '查看我的任务' },
  { cmd: '/xj cb', desc: '查看贡献点余额' },
  { cmd: '/xj cb pay <玩家> <金额>', desc: '贡献点转账（二次确认）' },
  { cmd: '/xj cb confirm / cancel', desc: '确认 / 取消转账' },
  { cmd: '/xj claim <数量> <理由>', desc: '贡献点申报' },
  { cmd: '/xj online', desc: '查看在线玩家' },
  { cmd: '/xj help', desc: '查看帮助' },
  { cmd: '/xj version', desc: '查看模组版本' }
];

export default function Mods() {
  const { user } = useAuth();

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/1.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>游戏模组</h1>
          <p>xuanjianmod · 打通游戏与官网的联动桥梁</p>
        </div>
      </div>

      {/* 下载区 */}
      <div className="card" style={{ padding: 28, marginBottom: 20, textAlign: 'center' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>玄剑公会联动模组</h2>
        <p className="text-secondary" style={{ marginBottom: 20 }}>
          支持 Minecraft 1.21.x 与 26.x（Fabric），游戏内完成签到、任务、贡献点等全部官网操作
        </p>
        <div className="flex" style={{ gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="https://github.com/Morzane123/xuanjian-mod/releases"
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
            style={{ padding: '12px 28px', fontSize: 15 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: '-3px', marginRight: 6 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            前往下载（GitHub Releases）
          </a>
          <a
            href="https://github.com/Morzane123/xuanjian-mod"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ padding: '12px 28px', fontSize: 15 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: '-3px', marginRight: 6 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            源码仓库
          </a>
        </div>
        <div className="text-secondary" style={{ fontSize: 12, marginTop: 14 }}>
          需同时安装 Fabric Loader 与 Fabric API · 构建产物由 GitHub Actions 自动产出
        </div>
      </div>

      {/* 功能特性 */}
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '24px 0 14px' }}>功能特性</h3>
      <div className="grid grid-3" style={{ gap: 14, marginBottom: 8 }}>
        {FEATURES.map(f => (
          <div key={f.title} className="card card-hover" style={{ padding: 18 }}>
            <div style={{ color: 'var(--primary)', marginBottom: 10 }}>{ICONS[f.icon]}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{f.title}</div>
            <div className="text-secondary" style={{ fontSize: 13, lineHeight: 1.7 }}>{f.desc}</div>
          </div>
        ))}
      </div>

      {/* 指令说明书 */}
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '24px 0 14px' }}>指令说明书</h3>
      <div className="card" style={{ padding: 8 }}>
        {COMMANDS.map((c, i) => (
          <div
            key={c.cmd}
            className="flex-between"
            style={{
              padding: '12px 16px',
              borderBottom: i < COMMANDS.length - 1 ? '1px solid var(--border)' : 'none',
              gap: 16,
              flexWrap: 'wrap'
            }}
          >
            <code style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{c.cmd}</code>
            <span className="text-secondary" style={{ fontSize: 13, flex: 1, minWidth: 160 }}>{c.desc}</span>
          </div>
        ))}
      </div>

      {/* 安装说明 */}
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '24px 0 14px' }}>安装说明</h3>
      <div className="card" style={{ padding: 22 }}>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2.1, fontSize: 14 }}>
          <li>为服务器安装对应版本的 <strong>Fabric Loader</strong> 与 <strong>Fabric API</strong></li>
          <li>将下载的 <code>xuanjianmod-*.jar</code> 放入服务器 <code>mods/</code> 目录</li>
          <li>启动服务器，编辑 <code>config/xuanjianmod.properties</code> 填写官网 API 地址与服务器密钥</li>
          <li>重启服务器，玩家即可使用 <code>/xj</code> 指令</li>
        </ol>
        <div className="text-secondary" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.7 }}>
          服务器密钥由管理员在官网「管理后台 - 模组管理」中生成，用于在线玩家上报与申报提醒功能。
        </div>
        {user && user.level >= 1 && (
          <div style={{ marginTop: 16 }}>
            <a href="/admin#mod-servers" className="btn btn-primary btn-sm">前往模组管理</a>
          </div>
        )}
      </div>
    </div>
  );
}
