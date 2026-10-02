import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, uploadImage } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import WikiRichEditor from '../components/WikiRichEditor';

/** 把扁平分类列表转成带缩进的选项（前端展示层级用） */
function flatOptions(tree, depth = 0, out = []) {
  for (const n of tree) {
    out.push({ id: n.id, name: `${'　'.repeat(depth)}${depth ? '└ ' : ''}${n.name}` });
    if (n.children?.length) flatOptions(n.children, depth + 1, out);
  }
  return out;
}

/**
 * Wiki 编辑器：/wiki/editor（新建） 与 /wiki/editor/:id（编辑）
 * 仅管理员可用（level ≥ 1）；slug 由标题自动生成拼音，也可手动改（改标题不会动旧 slug）。
 */
export default function WikiEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { showToast } = useToast();

  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({
    title: sp.get('title') || '',
    category_id: '',
    slug: '',
    summary: '',
    content: '',
    cover_image: '',
    is_featured: false,
    is_pinned: false,
    status: 'draft',
    revision_note: '',
    notify: false
  });
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [slugLocked, setSlugLocked] = useState(false);
  const [meta, setMeta] = useState(null);   // 已有页面的元信息（id/slug/status/updated_at）
  const coverRef = useMemo(() => ({ current: null }), []);

  const isAdmin = !!user && user.level >= 1;
  const isSuper = !!user && user.level >= 2;

  useEffect(() => {
    api.get('/api/wiki/categories?all=1')
      .then(d => setCats(d.tree || []))
      .catch(() => setCats([]));
  }, []);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    setLoading(true);
    api.get(`/api/wiki/id/${id}`)
      .then(d => {
        const p = d.page;
        setMeta(p);
        setSlugLocked(true);
        setForm(f => ({
          ...f,
          title: p.title,
          category_id: p.category_id || '',
          slug: p.slug,
          summary: p.summary || '',
          content: p.content || '',
          cover_image: p.cover_image || '',
          is_featured: !!p.is_featured,
          is_pinned: !!p.is_pinned,
          status: p.status
        }));
      })
      .catch(e => showToast(e.message || '加载页面失败', 'error'))
      .finally(() => setLoading(false));
  }, [id, showToast]);

  // 标题变化 → 自动建议 slug（编辑已有页面时不自动改，避免旧链接失效）
  const suggestSlug = useCallback(async (title) => {
    if (!title.trim()) return;
    try {
      const d = await api.get(`/api/wiki/slug-suggest?title=${encodeURIComponent(title)}${id ? `&id=${id}` : ''}`);
      setForm(f => ({ ...f, slug: d.slug }));
    } catch (e) { /* 建议失败不阻塞编辑 */ }
  }, [id]);

  useEffect(() => {
    if (slugLocked || !form.title.trim()) return;
    const t = setTimeout(() => suggestSlug(form.title), 350);
    return () => clearTimeout(t);
  }, [form.title, slugLocked, suggestSlug]);

  const save = async (forcedStatus) => {
    if (!isAdmin) return showToast('需要管理员权限', 'error');
    if (!form.title.trim()) return showToast('请填写标题', 'error');
    if (!form.content.trim()) return showToast('正文不能为空', 'error');
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        category_id: form.category_id || null,
        slug: form.slug.trim() || undefined,
        summary: form.summary.trim(),
        content: form.content,
        cover_image: form.cover_image,
        is_featured: form.is_featured,
        is_pinned: form.is_pinned,
        status: forcedStatus || form.status,
        revision_note: form.revision_note || undefined,
        notify: !!form.notify
      };
      if (id) {
        const d = await api.put(`/api/wiki/${id}`, body);
        setMeta(d.page);
        showToast('已保存（已生成新版本）', 'success');
      } else {
        const d = await api.post('/api/wiki', body);
        showToast('页面已创建', 'success');
        navigate(`/wiki/editor/${d.page.id}`);
      }
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!id) return save('published');
    try {
      setSaving(true);
      await api.put(`/api/wiki/${id}`, { ...form, status: 'published', slug: form.slug.trim() || undefined });
      const d = await api.post(`/api/wiki/${id}/publish`, { notify: !!form.notify });
      setMeta(d.page);
      showToast(`已发布${d.notified ? `，并通知了 ${d.notified} 人` : ''}`, 'success');
    } catch (e) {
      showToast(e.message || '发布失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!id || !confirm('确定归档这一页？归档后游客与搜索都看不到，可在后台恢复。')) return;
    try {
      const d = await api.post(`/api/wiki/${id}/archive`, {});
      setMeta(d.page);
      setForm(f => ({ ...f, status: 'archived' }));
      showToast('已归档', 'success');
    } catch (e) {
      showToast(e.message || '归档失败', 'error');
    }
  };

  const remove = async () => {
    if (!isSuper) return showToast('彻底删除需要超级管理员', 'error');
    if (!confirm('确定彻底删除该页面？版本历史与内链会一并删除，不可恢复。')) return;
    try {
      await api.delete(`/api/wiki/${id}`);
      showToast('已彻底删除', 'success');
      navigate('/admin#wiki');
    } catch (e) {
      showToast(e.message || '删除失败', 'error');
    }
  };

  // 预览改为弹层：结果不再渲染在页面最底部（那里点了看不出变化，用户以为按钮失效）
  const doPreview = async () => {
    if (previewLoading) return;
    if (!form.content.trim()) return showToast('正文是空的，先写点内容再预览', 'error');
    setPreviewLoading(true);
    try {
      const d = await api.post('/api/wiki/preview', { content: form.content });
      setPreview({ html: d?.html || '', links: d?.links || 0, missing: d?.missing || [] });
    } catch (e) {
      showToast(e?.message || '预览失败：请检查登录状态或稍后重试', 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = useCallback(() => setPreview(null), []);

  // Esc 关闭预览；打开期间锁住页面滚动，避免背景跟着滚
  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [preview]);

  const uploadCover = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setForm(f => ({ ...f, cover_image: url }));
      showToast('封面已上传', 'success');
    } catch (e) {
      showToast(e.message || '上传失败', 'error');
    } finally {
      setUploading(false);
    }
  };

  if (authLoading || loading) return <div className="loading"><div className="spinner" />加载中…</div>;
  if (!isAdmin) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <p>Wiki 编辑仅对管理员开放</p>
        <Link to="/wiki" className="btn btn-secondary mt-3">返回 Wiki</Link>
      </div>
    );
  }

  const options = flatOptions(cats);

  return (
    <div className="fade-in-up">
      <div className="wiki-breadcrumb">
        <Link to="/wiki">Wiki</Link><span>/</span>
        {meta ? <Link to={`/wiki/${meta.slug}`}>{meta.title}</Link> : <span>新建页面</span>}
        <span>/ 编辑</span>
      </div>

      <div className="wiki-article">
        <div className="wiki-section-head">
          <h2 style={{ fontSize: 20 }}>{id ? '编辑 Wiki 页面' : '新建 Wiki 页面'}</h2>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            {meta && <span className={`badge ${meta.status === 'published' ? 'badge-success' : 'badge-warning'}`}>{meta.status === 'published' ? '已发布' : meta.status === 'draft' ? '草稿' : '已归档'}</span>}
            <button className="btn btn-secondary btn-sm" onClick={doPreview} disabled={!form.content.trim() || previewLoading}>{previewLoading ? '预览中…' : '预览'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => save()} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            <button className="btn btn-primary btn-sm" onClick={publish} disabled={saving}>发布</button>
            {id && <button className="btn btn-secondary btn-sm" onClick={archive}>归档</button>}
            {id && isSuper && <button className="btn btn-danger btn-sm" onClick={remove}>彻底删除</button>}
            {id && <Link to={`/wiki/${meta?.slug}/history`} className="btn btn-secondary btn-sm">历史版本</Link>}
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 16, marginTop: 14 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">标题 *</label>
            <input className="form-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="例如：紫雪镇时期" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">所属分类</label>
            <select className="form-select" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
              <option value="">（不分类）</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">URL 标识（slug）</label>
            <div className="flex" style={{ gap: 8 }}>
              <input className="form-input" value={form.slug} onChange={e => { setSlugLocked(true); setForm(f => ({ ...f, slug: e.target.value })); }} placeholder="自动按标题生成拼音" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSlugLocked(false); suggestSlug(form.title); }}>重新生成</button>
            </div>
            <p className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>
              预览：<code>/wiki/{form.slug || '…'}</code>　改标题不会自动改 slug（避免历史链接失效）
            </p>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">修改备注（写进版本历史）</label>
            <input className="form-input" value={form.revision_note} onChange={e => setForm(f => ({ ...f, revision_note: e.target.value }))} placeholder="例如：补充第五代历史" />
          </div>
        </div>

        <div className="form-group" style={{ marginTop: 16 }}>
          <label className="form-label">摘要（列表与搜索结果里显示；留空自动取正文前 100 字）</label>
          <textarea className="form-textarea" style={{ minHeight: 60 }} value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} />
        </div>

        <div className="flex" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 16px' }}>
          <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={form.is_featured} onChange={e => setForm(f => ({ ...f, is_featured: e.target.checked }))} /> 设为精选
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={form.is_pinned} onChange={e => setForm(f => ({ ...f, is_pinned: e.target.checked }))} /> 置顶
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={form.notify} onChange={e => setForm(f => ({ ...f, notify: e.target.checked }))} /> 发布时通知全员
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 14 }}>
            封面：
            <input type="file" accept="image/*" onChange={e => uploadCover(e.target.files?.[0])} disabled={uploading} />
            {form.cover_image && <img src={form.cover_image} alt="封面" style={{ width: 60, height: 36, objectFit: 'cover', borderRadius: 6 }} />}
          </label>
        </div>

        <WikiRichEditor value={form.content} onChange={(html) => setForm(f => ({ ...f, content: html }))} />
      </div>

      {/* 预览弹层：portal 到 body，避免 .fade-in-up（animation-fill-mode: both 留下 transform）
          成为 fixed 定位的包含块，导致遮罩跟着页面内容走 */}
      {preview && typeof document !== 'undefined' && createPortal((
        <div className="wiki-preview-mask" role="dialog" aria-modal="true" aria-label="预览" onClick={closePreview}>
          <div className="wiki-preview-card" onClick={e => e.stopPropagation()}>
            <div className="wiki-preview-head">
              <div className="wiki-preview-title">
                预览
                <span className="wiki-preview-stat">内链 {preview.links} 个 · 待创建 {preview.missing.length} 个</span>
              </div>
              <button type="button" className="wiki-preview-close" onClick={closePreview} title="关闭预览（Esc）" aria-label="关闭预览">×</button>
            </div>
            {preview.missing.length > 0 && (
              <p className="wiki-preview-missing">
                以下页面还不存在，保存后会显示为「待创建」红链：{preview.missing.join('、')}
              </p>
            )}
            <div className="wiki-preview-body">
              <div className="wiki-content" dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
