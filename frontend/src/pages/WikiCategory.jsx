import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import WikiTree from '../components/WikiTree';
import { formatDate } from '../utils';

/** 分类页：/wiki/category/:slug —— 分类介绍 + 子分类 + 文章列表（分页/分类内搜索） */
export default function WikiCategory() {
  const { slug } = useParams();
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') || 1);
  const q = sp.get('q') || '';

  const [data, setData] = useState(null);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState(q);

  useEffect(() => {
    api.get('/api/wiki/categories').then(d => setTree(d.tree || [])).catch(() => setTree([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/wiki/categories/${slug}?page=${page}&limit=12${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [slug, page, q]);

  const submitSearch = (e) => {
    e.preventDefault();
    const next = new URLSearchParams(sp);
    if (kw.trim()) next.set('q', kw.trim()); else next.delete('q');
    next.set('page', '1');
    setSp(next);
  };

  if (loading) return <div className="loading"><div className="spinner" />加载分类…</div>;
  if (!data) return <div className="empty-state"><p>分类不存在或加载失败</p></div>;

  const { category, children = [], breadcrumb = [], pages = [], total = 0, totalPages = 1 } = data;

  return (
    <div className="fade-in-up">
      <div className="wiki-breadcrumb">
        <Link to="/wiki">Wiki</Link>
        {breadcrumb.map(b => (
          <span key={b.id}>/ <Link to={`/wiki/category/${b.slug}`}>{b.name}</Link></span>
        ))}
      </div>

      <div className="wiki-layout-2">
        <div className="wiki-col-side">
          <WikiTree nodes={tree} activeSlug={slug} />
        </div>

        <div>
          <div className="wiki-article" style={{ marginBottom: 18 }}>
            <div className="wiki-article-head">
              <h1>{category.icon ? `${category.icon} ` : ''}{category.name}</h1>
              {category.description && <p className="wiki-article-summary">{category.description}</p>}
            </div>

            {children.length > 0 && (
              <div className="flex" style={{ gap: 8, flexWrap: 'wrap', margin: '6px 0 4px' }}>
                {children.map(c => (
                  <Link key={c.id} to={`/wiki/category/${c.slug}`} className="badge">
                    {c.name}{typeof c.page_count === 'number' ? ` (${c.page_count})` : ''}
                  </Link>
                ))}
              </div>
            )}

            <form className="flex" style={{ gap: 8, marginTop: 14 }} onSubmit={submitSearch}>
              <input className="form-input" style={{ flex: 1 }} value={kw} onChange={e => setKw(e.target.value)} placeholder="在本分类内搜索…" />
              <button className="btn btn-primary" type="submit">搜索</button>
              {q && (
                <button type="button" className="btn btn-secondary" onClick={() => { setKw(''); const n = new URLSearchParams(sp); n.delete('q'); n.set('page', '1'); setSp(n); }}>
                  清除
                </button>
              )}
            </form>
          </div>

          <div className="wiki-section">
            <div className="wiki-section-head">
              <h2>{q ? `「${q}」的搜索结果` : '本分类文章'}</h2>
              <span className="text-secondary" style={{ fontSize: 13 }}>共 {total} 篇</span>
            </div>

            {pages.length === 0 ? (
              <div className="empty-state"><p>这里还没有内容</p></div>
            ) : (
              <div className="flex-col" style={{ gap: 10 }}>
                {pages.map(p => (
                  <Link key={p.id} to={`/wiki/${p.slug}`} className="wiki-admin-row" style={{ textDecoration: 'none', color: 'var(--text)' }}>
                    <div className="war-main">
                      <b>{p.is_pinned ? '📌 ' : ''}{p.title}</b>
                      <div>{p.summary || '（暂无摘要）'}</div>
                    </div>
                    <div className="text-secondary" style={{ fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatDate(p.updated_at, false)}<br />{p.views || 0} 次阅读
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex-center" style={{ gap: 8, marginTop: 18 }}>
                <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => { const n = new URLSearchParams(sp); n.set('page', String(page - 1)); setSp(n); }}>上一页</button>
                <span className="text-secondary" style={{ fontSize: 13 }}>第 {page} / {totalPages} 页</span>
                <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => { const n = new URLSearchParams(sp); n.set('page', String(page + 1)); setSp(n); }}>下一页</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
