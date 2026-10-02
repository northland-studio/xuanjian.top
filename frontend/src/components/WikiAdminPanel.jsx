import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { formatDate } from '../utils';

const TABS = [
  { key: 'pages', label: '页面' },
  { key: 'drafts', label: '草稿' },
  { key: 'categories', label: '分类' },
  { key: 'history', label: '历史版本' },
  { key: 'stats', label: '数据统计' }
];

const STATUS_LABEL = { published: '已发布', draft: '草稿', archived: '已归档' };

/**
 * 管理后台 · Wiki
 * 页面 / 草稿 / 分类 / 历史版本 / 数据统计；写权限沿用 adminMiddleware（level≥1），
 * 彻底删除与删除分类需要超级管理员。
 */
export default function WikiAdminPanel() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState('pages');

  const [tree, setTree] = useState([]);
  const [flatCats, setFlatCats] = useState([]);
  const [pages, setPages] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({ status: 'all', category_id: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [catForm, setCatForm] = useState({ name: '', parent_id: '', slug: '', description: '', sort_order: 0, icon: '' });
  const [editingCat, setEditingCat] = useState(null);

  const isSuper = !!user && user.level >= 2;

  const flatten = (nodes, depth = 0, out = []) => {
    for (const n of nodes) {
      out.push({ ...n, depth });
      if (n.children?.length) flatten(n.children, depth + 1, out);
    }
    return out;
  };

  const loadCats = useCallback(async () => {
    try {
      const d = await api.get('/api/wiki/categories?all=1');
      setTree(d.tree || []);
      setFlatCats(flatten(d.tree || []));
    } catch (e) { /* 忽略 */ }
  }, []);

  const loadPages = useCallback(async (f = filters, p = page, statusOverride) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('status', statusOverride || f.status || 'all');
      if (f.category_id) params.set('category_id', f.category_id);
      if (f.q) params.set('q', f.q);
      params.set('page', String(p));
      params.set('limit', '15');
      const d = await api.get(`/api/wiki/admin/pages?${params.toString()}`);
      setPages(d.pages || []);
      setTotal(d.total || 0);
      setTotalPages(d.totalPages || 1);
    } catch (e) {
      showToast(e.message || '加载页面失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, showToast]);

  useEffect(() => { loadCats(); }, [loadCats]);
  useEffect(() => { loadPages(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters, page]);
  useEffect(() => {
    if (tab === 'stats') api.get('/api/wiki/stats').then(d => setStats(d.stats)).catch(() => {});
    if (tab === 'history') api.get('/api/wiki/admin/revisions?limit=80').then(d => setRevisions(d.revisions || [])).catch(() => {});
  }, [tab]);

  const publish = async (id) => {
    try {
      await api.post(`/api/wiki/${id}/publish`, {});
      showToast('已发布', 'success');
      loadPages();
    } catch (e) { showToast(e.message || '发布失败', 'error'); }
  };
  const archive = async (id) => {
    if (!confirm('归档后游客与搜索都看不到，确定？')) return;
    try {
      await api.post(`/api/wiki/${id}/archive`, {});
      showToast('已归档', 'success');
      loadPages();
    } catch (e) { showToast(e.message || '归档失败', 'error'); }
  };
  const restore = async (id) => {
    try {
      await api.post(`/api/wiki/${id}/restore`, { status: 'published' });
      showToast('已恢复并发布', 'success');
      loadPages();
    } catch (e) { showToast(e.message || '恢复失败', 'error'); }
  };
  const remove = async (id, title) => {
    if (!isSuper) return showToast('彻底删除需要超级管理员', 'error');
    if (!confirm(`彻底删除「${title}」？版本历史与内链一并删除。`)) return;
    try {
      await api.delete(`/api/wiki/${id}`);
      showToast('已彻底删除', 'success');
      loadPages();
    } catch (e) { showToast(e.message || '删除失败', 'error'); }
  };

  const saveCat = async () => {
    if (!catForm.name.trim()) return showToast('分类名称不能为空', 'error');
    try {
      const body = {
        name: catForm.name.trim(),
        parent_id: catForm.parent_id || null,
        slug: catForm.slug.trim() || undefined,
        description: catForm.description,
        icon: catForm.icon,
        sort_order: Number(catForm.sort_order) || 0
      };
      if (editingCat) await api.put(`/api/wiki/categories/${editingCat}`, body);
      else await api.post('/api/wiki/categories', body);
      showToast(editingCat ? '分类已更新' : '分类已创建', 'success');
      setCatForm({ name: '', parent_id: '', slug: '', description: '', sort_order: 0, icon: '' });
      setEditingCat(null);
      loadCats();
    } catch (e) { showToast(e.message || '保存分类失败', 'error'); }
  };

  const editCat = (c) => {
    setEditingCat(c.id);
    setCatForm({
      name: c.name, parent_id: c.parent_id || '', slug: c.slug,
      description: c.description || '', sort_order: c.sort_order || 0, icon: c.icon || ''
    });
  };

  const removeCat = async (c) => {
    if (!isSuper) return showToast('删除分类需要超级管理员', 'error');
    if (!confirm(`删除分类「${c.name}」？（有子分类或文章时会被拒绝）`)) return;
    try {
      await api.delete(`/api/wiki/categories/${c.id}`);
      showToast('分类已删除', 'success');
      loadCats();
    } catch (e) { showToast(e.message || '删除失败', 'error'); }
  };

  return (
    <div>
      <div className="wiki-section-head">
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>Wiki 知识库</h3>
        <Link to="/wiki/editor" className="btn btn-primary btn-sm">+ 新建页面</Link>
      </div>

      <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setTab(t.key); if (t.key === 'drafts') { setFilters(f => ({ ...f, status: 'draft' })); setPage(1); } }}>
            {t.label}
          </button>
        ))}
      </div>

      {(tab === 'pages' || tab === 'drafts') && (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="flex" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label className="form-label">搜索标题/摘要</label>
                <input className="form-input" value={filters.q} onChange={e => { setFilters(f => ({ ...f, q: e.target.value })); setPage(1); }} placeholder="关键词…" />
              </div>
              <div style={{ flex: '0 1 170px' }}>
                <label className="form-label">分类</label>
                <select className="form-select" value={filters.category_id} onChange={e => { setFilters(f => ({ ...f, category_id: e.target.value })); setPage(1); }}>
                  <option value="">全部分类</option>
                  {flatCats.map(c => <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.name}</option>)}
                </select>
              </div>
              <div style={{ flex: '0 1 150px' }}>
                <label className="form-label">状态</label>
                <select className="form-select" value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}>
                  <option value="all">全部</option>
                  <option value="published">已发布</option>
                  <option value="draft">草稿</option>
                  <option value="archived">已归档</option>
                </select>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => loadPages(filters, 1)}>刷新</button>
            </div>
          </div>

          {loading ? (
            <div className="loading"><div className="spinner" /></div>
          ) : pages.length === 0 ? (
            <div className="empty-state"><p>没有符合条件的页面</p></div>
          ) : (
            <>
              <div className="text-secondary" style={{ fontSize: 12.5, marginBottom: 8 }}>共 {total} 篇</div>
              {pages.map(p => (
                <div key={p.id} className="wiki-admin-row">
                  <div className="war-main">
                    <b>{p.is_pinned ? '📌 ' : ''}{p.is_featured ? '★ ' : ''}{p.title}</b>
                    <div>
                      <span className={`badge ${p.status === 'published' ? 'badge-success' : p.status === 'draft' ? 'badge-warning' : 'badge-gray'}`}>{STATUS_LABEL[p.status] || p.status}</span>
                      <span style={{ marginLeft: 8 }}>{p.category_name || '未分类'} · {p.author_name || p.author_username || '—'} · 更新 {formatDate(p.updated_at, true)} · {p.views || 0} 阅读</span>
                    </div>
                  </div>
                  <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <Link to={`/wiki/${p.slug}`} className="btn btn-secondary btn-sm">查看</Link>
                    <Link to={`/wiki/editor/${p.id}`} className="btn btn-secondary btn-sm">编辑</Link>
                    <Link to={`/wiki/${p.slug}/history`} className="btn btn-secondary btn-sm">历史</Link>
                    {p.status !== 'published' && <button className="btn btn-primary btn-sm" onClick={() => publish(p.id)}>发布</button>}
                    {p.status === 'archived' && <button className="btn btn-secondary btn-sm" onClick={() => restore(p.id)}>恢复</button>}
                    {p.status !== 'archived' && <button className="btn btn-secondary btn-sm" onClick={() => archive(p.id)}>归档</button>}
                    {isSuper && <button className="btn btn-danger btn-sm" onClick={() => remove(p.id, p.title)}>删除</button>}
                  </div>
                </div>
              ))}
              {totalPages > 1 && (
                <div className="flex-center" style={{ gap: 8, marginTop: 14 }}>
                  <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
                  <span className="text-secondary" style={{ fontSize: 13 }}>第 {page} / {totalPages} 页</span>
                  <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'categories' && (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{editingCat ? '编辑分类' : '新增分类'}</div>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">名称 *</label>
                <input className="form-input" value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">父分类</label>
                <select className="form-select" value={catForm.parent_id} onChange={e => setCatForm(f => ({ ...f, parent_id: e.target.value }))}>
                  <option value="">（顶级分类）</option>
                  {flatCats.filter(c => c.id !== editingCat).map(c => <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">排序（小的在前）</label>
                <input type="number" className="form-input" value={catForm.sort_order} onChange={e => setCatForm(f => ({ ...f, sort_order: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">slug（留空自动拼音）</label>
                <input className="form-input" value={catForm.slug} onChange={e => setCatForm(f => ({ ...f, slug: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">图标（emoji 或短文本）</label>
                <input className="form-input" value={catForm.icon} onChange={e => setCatForm(f => ({ ...f, icon: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">描述</label>
                <input className="form-input" value={catForm.description} onChange={e => setCatForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="flex" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={saveCat}>{editingCat ? '保存修改' : '新增分类'}</button>
              {editingCat && <button className="btn btn-secondary btn-sm" onClick={() => { setEditingCat(null); setCatForm({ name: '', parent_id: '', slug: '', description: '', sort_order: 0, icon: '' }); }}>取消</button>}
            </div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>分类树（{flatCats.length}）</div>
            {flatCats.length === 0 ? <div className="text-secondary" style={{ fontSize: 13 }}>还没有分类</div> : flatCats.map(c => (
              <div key={c.id} className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span style={{ marginLeft: c.depth * 16 }}>{c.icon ? `${c.icon} ` : ''}<b>{c.name}</b></span>
                  <span className="text-secondary" style={{ fontSize: 12, marginLeft: 8 }}>/wiki/category/{c.slug} · 排序 {c.sort_order} · {c.page_count || 0} 篇</span>
                </div>
                <div className="flex" style={{ gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => editCat(c)}>编辑</button>
                  {isSuper && <button className="btn btn-danger btn-sm" onClick={() => removeCat(c)}>删除</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>最近版本记录（{revisions.length}）</div>
          {revisions.length === 0 ? <div className="text-secondary" style={{ fontSize: 13 }}>暂无记录</div> : revisions.map(r => (
            <div key={r.id} className="flex" style={{ justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{r.title}</b>
                <div className="text-secondary" style={{ fontSize: 12 }}>
                  版本 #{r.id} · {formatDate(r.created_at, true)} · {r.editor_name || r.editor_username || '—'}
                  {r.revision_note ? ` · ${r.revision_note}` : ''}
                </div>
              </div>
              <div className="flex" style={{ gap: 6 }}>
                {r.page_slug && <Link to={`/wiki/${r.page_slug}/history`} className="btn btn-secondary btn-sm">查看该页历史</Link>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'stats' && (
        <div className="wiki-stat-grid">
          {[
            ['总文章数', stats?.total], ['已发布', stats?.published], ['草稿', stats?.draft],
            ['已归档', stats?.archived], ['分类数', stats?.categories], ['总浏览量', stats?.totalViews],
            ['近 30 天更新', stats?.updated30], ['版本总数', stats?.revisions]
          ].map(([label, value]) => (
            <div key={label} className="wiki-stat">
              <b>{value ?? '—'}</b>
              <span>{label}</span>
            </div>
          ))}
          <div className="wiki-stat" style={{ gridColumn: '1 / -1', textAlign: 'left' }}>
            <span>全文索引（FTS5）：{stats?.fts ? '正常' : '不可用（已退回模糊搜索）'}</span>
            {stats?.editors?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <b style={{ fontSize: 13 }}>近 30 天活跃编辑者</b>
                <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {stats.editors.map(e => (
                    <span key={e.id} className="badge">{e.nickname || e.username} · {e.edits} 次</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
