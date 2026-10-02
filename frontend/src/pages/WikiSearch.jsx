import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import WikiSearchBox from '../components/WikiSearchBox';
import WikiTree from '../components/WikiTree';
import { formatDate } from '../utils';

/** 搜索结果页：/wiki/search?q=&category=&page= */
export default function WikiSearch() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') || '';
  const category = sp.get('category') || '';
  const page = Number(sp.get('page') || 1);

  const [data, setData] = useState(null);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/wiki/categories').then(d => setTree(d.tree || [])).catch(() => setTree([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    params.set('page', String(page));
    params.set('limit', '15');
    api.get(`/api/wiki/search?${params.toString()}`)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [q, category, page]);

  const setParam = (k, v) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.set('page', '1');
    setSp(next);
  };

  const pages = data?.pages || [];
  const totalPages = data?.totalPages || 1;
  const mode = data?.mode;

  return (
    <div className="fade-in-up wiki-page">
      <div className="wiki-breadcrumb">
        <Link to="/wiki">Wiki</Link><span>/ 搜索</span>
      </div>

      <div className="wiki-hero" style={{ padding: '26px 22px' }}>
        <h1>搜索 Wiki</h1>
        <p>标题、摘要、正文全文搜索；中文按 3 字以上走全文索引，短词自动退回模糊匹配。</p>
      </div>

      <WikiSearchBox autoFocus />

      <div className="wiki-layout-2">
        <div className="wiki-col-side">
          <WikiTree nodes={tree} activeSlug="" />
          {category && (
            <div className="wiki-panel">
              <h4>当前过滤</h4>
              <div className="flex" style={{ gap: 6, alignItems: 'center' }}>
                <span className="badge">{category}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setParam('category', '')}>清除</button>
              </div>
            </div>
          )}
        </div>

        <div>
          {loading ? (
            <div className="loading"><div className="spinner" />搜索中…</div>
          ) : (
            <>
              <div className="wiki-section-head">
                <h2>{q ? `「${q}」` : '最近更新'}{data?.total ? ` · ${data.total} 条结果` : ''}</h2>
                <span className="text-secondary" style={{ fontSize: 12 }}>
                  {mode === 'fts' ? '全文索引匹配' : mode === 'like' ? '模糊匹配（短词）' : '最近更新'}
                </span>
              </div>

              {pages.length === 0 ? (
                <div className="empty-state">
                  <p>没有找到相关内容</p>
                  <Link to="/wiki/editor" className="btn btn-primary mt-3">新建这一页（管理员）</Link>
                </div>
              ) : (
                <div className="flex-col" style={{ gap: 12 }}>
                  {pages.map(p => (
                    <div key={p.id} className="wiki-article" style={{ padding: 16 }}>
                      <Link to={`/wiki/${p.slug}`} style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}>{p.title}</Link>
                      <div className="text-secondary" style={{ fontSize: 12.5, marginTop: 4 }}>
                        {p.category_name && (
                          <Link to={`/wiki/category/${p.category_slug}`} style={{ color: 'var(--primary)', marginRight: 8 }}>{p.category_name}</Link>
                        )}
                        更新于 {formatDate(p.updated_at, false)} · {p.views || 0} 次阅读
                      </div>
                      <p className="text-secondary" style={{ fontSize: 13.5, lineHeight: 1.7, marginTop: 8 }}>
                        {p.snippet || p.summary || '（暂无摘要）'}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex-center" style={{ gap: 8, marginTop: 18 }}>
                  <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>上一页</button>
                  <span className="text-secondary" style={{ fontSize: 13 }}>第 {page} / {totalPages} 页</span>
                  <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>下一页</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
