import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import WikiTree from '../components/WikiTree';
import WikiSearchBox from '../components/WikiSearchBox';
import { useServerData } from '../context/ServerDataContext';
import { formatDate } from '../utils';

/** 搜索图标（替代 emoji，风格对齐 ChatIcons.jsx：24 视框 / 线性描边 / currentColor） */
function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }} aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

/** 撰写图标 */
function IconPen() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }} aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/** 单张卡片：标题 + 摘要 + 分类/更新时间/浏览 */
function WikiCard({ page }) {
  return (
    <Link to={`/wiki/${page.slug}`} className="wiki-card">
      <h3>{page.is_featured ? '★ ' : ''}{page.title}</h3>
      <p>{page.summary || '（暂无摘要）'}</p>
      <div className="wiki-card-meta">
        {page.category_name && <span className="badge">{page.category_name}</span>}
        <span>{formatDate(page.updated_at, false)}</span>
        <span>{page.views || 0} 次阅读</span>
      </div>
    </Link>
  );
}

/** Wiki 首页：Hero + 搜索 + 分类树 + 精选/最近更新/热门 + 最近贡献者 */
export default function Wiki() {
  // SSR/SSG：服务端已预取好首页数据，首屏直接用，避免 hydrate 前后闪烁
  const seeded = useServerData('wikiHome');
  const [data, setData] = useState(seeded || null);
  const [loading, setLoading] = useState(!seeded);

  useEffect(() => {
    if (seeded) return;                     // 服务端已给数据，不再重复请求
    api.get('/api/wiki')
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [seeded]);

  if (loading) return <div className="loading"><div className="spinner" />加载 Wiki…</div>;
  if (!data) return <div className="empty-state"><p>Wiki 暂时无法加载，请稍后再试</p></div>;

  const { featured = [], recent = [], popular = [], contributors = [], categories = [], totalPages = 0 } = data;

  return (
    <div className="fade-in-up wiki-page">
      <div className="wiki-hero wiki-hero-home">
        {/* 装饰层：网格 + 星轨（内联 SVG，currentColor / 低透明度，pointer-events 由 CSS 关闭） */}
        <div className="wiki-hero-deco" aria-hidden="true">
          <svg className="wh-grid" fill="none" focusable="false">
            <defs>
              <pattern id="wikiHeroGrid" width="34" height="34" patternUnits="userSpaceOnUse">
                <path d="M34 0H0v34" stroke="currentColor" strokeWidth="1" />
              </pattern>
              <linearGradient id="wikiHeroGridFade" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.45" stopColor="#fff" stopOpacity="0.7" />
                <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
              </linearGradient>
              <mask id="wikiHeroGridMask">
                <rect width="100%" height="100%" fill="url(#wikiHeroGridFade)" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="url(#wikiHeroGrid)" mask="url(#wikiHeroGridMask)" />
          </svg>

          <svg className="wh-orbit" viewBox="0 0 340 340" fill="none" focusable="false">
            <circle cx="170" cy="170" r="150" stroke="currentColor" strokeOpacity="0.42" strokeWidth="1" strokeDasharray="3 9" />
            <circle cx="170" cy="170" r="112" stroke="currentColor" strokeOpacity="0.26" strokeWidth="1" />
            <ellipse cx="170" cy="170" rx="150" ry="56" stroke="currentColor" strokeOpacity="0.34" strokeWidth="1" transform="rotate(-18 170 170)" />
            <path d="M22 268c50 14 100-6 138-48" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" strokeLinecap="round" />
            {/* 书本 / 翻页符号 */}
            <g stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M64 186c22-9 44-9 66 0v72c-22-9-44-9-66 0z" />
              <path d="M196 186c-22-9-44-9-66 0v72c22-9 44-9 66 0z" />
              <path d="M130 186v72" />
            </g>
            {/* 星点 */}
            <circle cx="256" cy="66" r="2.6" fill="currentColor" fillOpacity="0.8" />
            <circle cx="292" cy="118" r="1.8" fill="currentColor" fillOpacity="0.55" />
            <circle cx="214" cy="256" r="2.1" fill="currentColor" fillOpacity="0.45" />
            <circle cx="88" cy="82" r="1.6" fill="currentColor" fillOpacity="0.4" />
          </svg>
        </div>

        <div className="wiki-hero-inner">
          <span className="wiki-hero-kicker">玄剑公会 · 长期知识库</span>
          <h1>玄剑 Wiki</h1>
          <p>
            公会的长期知识库：制度、历史档案、Minecraft 资料与项目文档。
            与日报/决策/贴吧不同，这里的每一页都是可以长期维护、随时查阅的稳定内容。
          </p>
        </div>

        <div className="wiki-hero-stats">
          <div className="wiki-hero-stat"><b>{totalPages}</b><span>篇已发布</span></div>
          <div className="wiki-hero-stat"><b>{categories.length}</b><span>个一级分类</span></div>
          <div className="wiki-hero-stat"><b>{contributors.length}</b><span>位近期编辑者</span></div>
        </div>
      </div>

      <WikiSearchBox />

      <div className="wiki-layout-2">
        <div className="wiki-col-side">
          <WikiTree nodes={categories} title="Wiki 目录" />
          <div className="wiki-panel">
            <h4>快速入口</h4>
            <div className="flex-col" style={{ gap: 6, fontSize: 13.5 }}>
              <Link to="/wiki/search" className="wiki-quick-link"><IconSearch /> 全站搜索</Link>
              <Link to="/wiki/editor" className="wiki-quick-link"><IconPen /> 新建页面（管理员）</Link>
            </div>
          </div>
        </div>

        <div>
          {featured.length > 0 && (
            <div className="wiki-section">
              <div className="wiki-section-head"><h2>精选文章</h2></div>
              <div className="wiki-card-grid">
                {featured.map(p => <WikiCard key={p.id} page={p} />)}
              </div>
            </div>
          )}

          <div className="wiki-section">
            <div className="wiki-section-head">
              <h2>最近更新</h2>
              <Link to="/wiki/search">全部 →</Link>
            </div>
            {recent.length === 0 ? (
              <div className="empty-state"><p>Wiki 还没有内容</p></div>
            ) : (
              <div className="wiki-card-grid">{recent.map(p => <WikiCard key={p.id} page={p} />)}</div>
            )}
          </div>

          {popular.length > 0 && (
            <div className="wiki-section">
              <div className="wiki-section-head"><h2>热门文章</h2></div>
              <div className="wiki-card-grid">{popular.slice(0, 6).map(p => <WikiCard key={p.id} page={p} />)}</div>
            </div>
          )}

          {contributors.length > 0 && (
            <div className="wiki-section">
              <div className="wiki-section-head"><h2>最近贡献者</h2></div>
              <div className="wiki-contributors">
                {contributors.map(c => (
                  <Link key={c.id} to={`/profile/${c.username}`} className="wiki-contributor">
                    <img src={c.avatar || '/images/default-avatar.png'} alt={c.nickname || c.username} />
                    <span>{c.nickname || c.username}</span>
                    <i>{c.edits} 次编辑</i>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
