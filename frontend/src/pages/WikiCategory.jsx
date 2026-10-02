import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import WikiTree from '../components/WikiTree';
import { withHeadingIds } from '../components/WikiToc';
import { useToast } from '../components/UI';
import { useServerData } from '../context/ServerDataContext';
import { formatDate } from '../utils';

/** 整本通史导出只在「公会历史」这个根分类下提供 */
const BOOK_CATEGORY_SLUG = 'gong-hui-li-shi';

/** 分类页：/wiki/category/:slug —— 分类介绍 + 子分类 + 文章列表（分页/分类内搜索） */
export default function WikiCategory() {
  const { slug } = useParams();
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') || 1);
  const q = sp.get('q') || '';
  const { showToast } = useToast();

  // SSR/SSG 预取只覆盖「第一页、无搜索词」的形态（分页/搜索由客户端接管）
  const seededCat = useServerData('wikiCategory');
  const seededTree = useServerData('wikiTree');
  const useSeeded = !!seededCat && page === 1 && !q;

  const [data, setData] = useState(useSeeded ? seededCat : null);
  const [tree, setTree] = useState(seededTree || []);
  const [loading, setLoading] = useState(!useSeeded);
  const [kw, setKw] = useState(q);
  const [bookExporting, setBookExporting] = useState(false);

  useEffect(() => {
    if (seededTree) return;
    api.get('/api/wiki/categories').then(d => setTree(d.tree || [])).catch(() => setTree([]));
  }, [seededTree]);

  useEffect(() => {
    if (useSeeded) return;
    setLoading(true);
    api.get(`/api/wiki/categories/${slug}?page=${page}&limit=12${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [slug, page, q, useSeeded]);

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

  const canExportBook = slug === BOOK_CATEGORY_SLUG;

  // 整本通史：拉全「公会历史」下所有已发布页面 → 逐页取正文 → 合并成一个 PDF（封面+目录+每章另起一页）
  const exportBook = async () => {
    if (bookExporting) return;
    setBookExporting(true);
    try {
      const list = [];
      let p = 1;
      let sum = Infinity;
      while (list.length < sum && p <= 10) {
        // eslint-disable-next-line no-await-in-loop
        const d = await api.get(`/api/wiki/categories/${encodeURIComponent(slug)}?page=${p}&limit=100`);
        list.push(...(d.pages || []));
        sum = d.total || 0;
        if (!d.pages || !d.pages.length) break;
        p += 1;
      }
      if (!list.length) throw new Error('这个分类下还没有文章');
      const chapters = [];
      for (const item of list) {
        // eslint-disable-next-line no-await-in-loop
        const d = await api.get(`/api/wiki/${encodeURIComponent(item.slug)}`);
        chapters.push({
          page: d.page || item,
          html: withHeadingIds(d.content_html || ''),
          breadcrumb: d.breadcrumb || []
        });
      }
      const { exportWikiBookPdf } = await import('../lib/wiki-pdf.js');
      await exportWikiBookPdf({
        title: `玄剑公会通史（${category?.name || '公会历史'}）`,
        subtitle: `共 ${chapters.length} 章 · 由 xuanjian.top 生成`,
        chapters
      });
      showToast('整本通史 PDF 已导出', 'success');
    } catch (e) {
      showToast(e?.message || '整本导出失败', 'error');
    } finally {
      setBookExporting(false);
    }
  };

  return (
    <div className="fade-in-up wiki-page">
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
              {canExportBook && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={exportBook}
                  disabled={bookExporting}
                  title="把本分类下全部已发布页面合并导出成一个 PDF"
                >
                  {bookExporting ? '导出中…' : '导出整本通史'}
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
