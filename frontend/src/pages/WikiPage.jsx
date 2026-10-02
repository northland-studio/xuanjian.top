import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import WikiTree from '../components/WikiTree';
import WikiToc, { withHeadingIds } from '../components/WikiToc';
import Lightbox from '../components/Lightbox';
import { useServerData } from '../context/ServerDataContext';
import { formatDate } from '../utils';
import { setPageSeo, plainText } from '../lib/seo';
import { useAdSense } from '../lib/adsense';

/**
 * Wiki 文章页：/wiki/:slug
 * 桌面端三栏（目录树 / 正文 / TOC+信息+相关），移动端自动单列。
 */
export default function WikiPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // SSR/SSG：服务端已渲染好这一篇（含正文 HTML、面包屑、相关、上下篇）
  const seeded = useServerData('wikiPage');
  const seededTree = useServerData('wikiTree');
  const seededForThis = seeded && seeded.page && seeded.page.slug === slug ? seeded : null;

  const [data, setData] = useState(seededForThis);
  const [tree, setTree] = useState(seededTree || []);
  const [loading, setLoading] = useState(!seededForThis);
  const [notFound, setNotFound] = useState(false);

  // Google AdSense（Auto Ads）：仅在文章存在时注入脚本（空状态 / 404 不投放）
  useAdSense(!!(data && data.page));

  const isAdmin = !!user && user.level >= 1;

  useEffect(() => {
    if (seededTree) return;
    api.get('/api/wiki/categories').then(d => setTree(d.tree || [])).catch(() => setTree([]));
  }, [seededTree]);

  useEffect(() => {
    if (seeded && seeded.page && seeded.page.slug === slug) {
      setData(seeded);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setNotFound(false);
    setData(null);
    api.get(`/api/wiki/${encodeURIComponent(slug)}`)
      .then(d => {
        if (!alive) return;
        setData(d);
        const page = d.page || {};
        const url = `https://xuanjian.top/wiki/${page.slug}`;
        setPageSeo({
          title: `${page.title} · 玄剑 Wiki`,
          description: page.summary || plainText(d.content_html),
          image: page.cover_image,
          url
        });
      })
      .catch(() => { if (alive) setNotFound(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const page = data?.page;
  const html = useMemo(() => (data?.content_html ? withHeadingIds(data.content_html) : ''), [data]);

  // 图片查看器：SSG/SSR 直出的 HTML 用事件委托挂点击（不能逐张绑），
  // 图集 = 当前页 .wiki-content 里的全部图片，点哪张就从哪张开始看。
  const contentRef = useRef(null);
  const [lightbox, setLightbox] = useState(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onClick = (e) => {
      const img = e.target.closest && e.target.closest('img');
      if (!img || !el.contains(img)) return;
      const list = [...el.querySelectorAll('img')].map(i => i.getAttribute('src')).filter(Boolean);
      if (!list.length) return;
      e.preventDefault();
      setLightbox({ images: list, index: Math.max(0, list.indexOf(img.getAttribute('src'))) });
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [html]);

  if (loading) return <div className="loading"><div className="spinner" />加载中…</div>;
  if (notFound || !page) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <p>这一页还不存在</p>
        <div className="flex-center" style={{ gap: 10, marginTop: 12 }}>
          <Link to="/wiki" className="btn btn-secondary">返回 Wiki 首页</Link>
          {isAdmin && <Link to={`/wiki/editor?title=${encodeURIComponent(slug)}`} className="btn btn-primary">用这个标题创建</Link>}
        </div>
      </div>
    );
  }

  const breadcrumb = data.breadcrumb || [];
  const related = data.related || [];
  const { prev, next } = data.neighbors || {};
  const canEdit = data.can_edit;

  return (
    <div className="fade-in-up wiki-page">
      <div className="wiki-breadcrumb">
        <Link to="/wiki">Wiki</Link>
        {breadcrumb.map(b => (
          <span key={b.id}>/ <Link to={`/wiki/category/${b.slug}`}>{b.name}</Link></span>
        ))}
        <span>/ {page.title}</span>
      </div>

      <div className="wiki-layout">
        <div className="wiki-col-side">
          <WikiTree nodes={tree} activeSlug={page.category_slug} />
        </div>

        <div>
          <article className="wiki-article">
            <div className="wiki-article-head">
              <h1>{page.title}</h1>
              {page.summary && <p className="wiki-article-summary">{page.summary}</p>}
              <div className="wiki-article-meta">
                {page.category_name && (
                  <span>分类：<Link to={`/wiki/category/${page.category_slug}`} style={{ color: 'var(--primary)' }}>{page.category_name}</Link></span>
                )}
                <span>作者：<b>{page.author_name || page.author_username || '—'}</b></span>
                <span>最后编辑：<b>{page.editor_name || page.editor_username || page.author_name || '—'}</b> · {formatDate(page.updated_at, false)}</span>
                <span>创建：{formatDate(page.created_at, false)}</span>
                <span>{page.views || 0} 次阅读</span>
                {page.status !== 'published' && <span className="badge badge-warning">{page.status === 'draft' ? '草稿' : '已归档'}</span>}
              </div>

              {canEdit && (
                <div className="flex" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                  <Link to={`/wiki/editor/${page.id}`} className="btn btn-primary btn-sm">编辑</Link>
                  <Link to={`/wiki/${page.slug}/history`} className="btn btn-secondary btn-sm">历史版本</Link>
                  <Link to={`/wiki/category/${page.category_slug || ''}`} className="btn btn-secondary btn-sm">返回分类</Link>
                </div>
              )}
            </div>

            <div className="wiki-content" ref={contentRef} dangerouslySetInnerHTML={{ __html: html }} />
          </article>

          {(prev || next) && (
            <div className="wiki-footnav">
              {prev ? (
                <Link to={`/wiki/${prev.slug}`}><span>← 上一篇</span><b>{prev.title}</b></Link>
              ) : <span />}
              {next && (
                <Link to={`/wiki/${next.slug}`} style={{ textAlign: 'right' }}><span>下一篇 →</span><b>{next.title}</b></Link>
              )}
            </div>
          )}

          {related.length > 0 && (
            <div className="wiki-section" style={{ marginTop: 22 }}>
              <div className="wiki-section-head"><h2>相关文章</h2></div>
              <div className="wiki-card-grid">
                {related.slice(0, 6).map(r => (
                  <Link key={r.id} to={`/wiki/${r.slug}`} className="wiki-card">
                    <h3>{r.title}</h3>
                    <p>{r.summary || '（暂无摘要）'}</p>
                    <div className="wiki-card-meta">
                      <span>{r.reason === 'link' ? '本页引用' : r.reason === 'backlink' ? '引用了本页' : '同分类'}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="wiki-col-toc">
          <div className="wiki-panel">
            <h4>文章信息</h4>
            <div className="flex-col" style={{ gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              <span>作者：{page.author_name || page.author_username || '—'}</span>
              <span>最后编辑：{formatDate(page.updated_at, true)}</span>
              <span>创建：{formatDate(page.created_at, false)}</span>
              <span>阅读：{page.views || 0}</span>
              <span>字数：约 {plainText(html, 999999).length} 字</span>
            </div>
          </div>
          <WikiToc html={html} />
        </div>
      </div>

      {lightbox && (
        <Lightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
