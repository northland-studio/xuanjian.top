import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import WikiTree from '../components/WikiTree';
import WikiSearchBox from '../components/WikiSearchBox';
import { useServerData } from '../context/ServerDataContext';
import { formatDate } from '../utils';

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
    <div className="fade-in-up">
      <div className="wiki-hero">
        <h1>玄剑 Wiki</h1>
        <p>
          公会的长期知识库：制度、历史档案、Minecraft 资料与项目文档。
          与日报/决策/贴吧不同，这里的每一页都是可以长期维护、随时查阅的稳定内容。
        </p>
        <div className="wiki-hero-stats">
          <div><b>{totalPages}</b>篇已发布</div>
          <div><b>{categories.length}</b>个一级分类</div>
          <div><b>{contributors.length}</b>位近期编辑者</div>
        </div>
      </div>

      <WikiSearchBox />

      <div className="wiki-layout-2">
        <div className="wiki-col-side">
          <WikiTree nodes={categories} title="Wiki 目录" />
          <div className="wiki-panel">
            <h4>快速入口</h4>
            <div className="flex-col" style={{ gap: 6, fontSize: 13.5 }}>
              <Link to="/wiki/search" style={{ color: 'var(--primary)' }}>🔍 全站搜索</Link>
              <Link to="/wiki/editor" style={{ color: 'var(--primary)' }}>✍️ 新建页面（管理员）</Link>
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
