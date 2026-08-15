import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, uploadImage, uploadProjection } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { formatDate } from '../utils';

const TABS = [
  { key: 'dashboard', label: '数据看板' },
  { key: 'banners', label: '轮播图管理' },
  { key: 'users', label: '用户管理' },
  { key: 'posts', label: '内容管理' },
  { key: 'announcements', label: '公告管理' },
  { key: 'shop', label: '商城管理' },
  { key: 'claims', label: '申报审核' },
  { key: 'tasks', label: '任务管理' },
  { key: 'logs', label: '贡献点日志' },
  { key: 'verify', label: '核销商品' },
  { key: 'mod', label: '模组管理' }
];

const LEVEL_NAMES = { 0: '成员', 1: '管理员', 2: '超级管理员' };

export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState(() => {
    const h = window.location.hash;
    return h.includes('mod-servers') || h.includes('mod') ? 'mod' : 'banners';
  });

  useEffect(() => {
    if (!user) { navigate('/login?redirect=/admin'); return; }
    if (user.level < 1) {
      showToast('没有管理权限', 'error');
      navigate('/');
    }
  }, [user, navigate]);

  if (!user || user.level < 1) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/1.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>管理后台</h1>
          <p>站点内容与配置管理</p>
        </div>
      </div>

      <div className="flex" style={{ gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} className={`btn ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'dashboard' && <Dashboard showToast={showToast} />}
      {tab === 'banners' && <BannerManager showToast={showToast} />}
      {tab === 'users' && <UserManager showToast={showToast} isSuper={user.level >= 2} />}
      {tab === 'posts' && <PostManager showToast={showToast} />}
      {tab === 'announcements' && <AnnouncementManager showToast={showToast} />}
      {tab === 'shop' && <ShopManager showToast={showToast} />}
      {tab === 'claims' && <ClaimReview showToast={showToast} />}
      {tab === 'tasks' && <TaskManager showToast={showToast} />}
      {tab === 'logs' && <ContributionLogs showToast={showToast} />}
      {tab === 'verify' && <VerifyManager showToast={showToast} />}
      {tab === 'mod' && <ModServerManager showToast={showToast} />}
    </div>
  );
}

/* ============ 轮播图管理 ============ */
function BannerManager({ showToast }) {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null=新增, {} 表示编辑中
  const [form, setForm] = useState({ title: '', subtitle: '', image: '', link: '', sort_order: 0, is_active: true });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const fileInput = useRef(null);

  const fetchBanners = () => {
    setLoading(true);
    api.get('/api/banners/all')
      .then(data => setBanners(data.banners || []))
      .catch(() => setBanners([]))
      .finally(() => setLoading(false));
  };

  useEffect(fetchBanners, []);

  const startCreate = () => {
    setEditing({});
    setForm({ title: '', subtitle: '', image: '', link: '', sort_order: banners.length + 1, is_active: true });
  };

  const startEdit = (b) => {
    setEditing(b);
    setForm({ title: b.title || '', subtitle: b.subtitle || '', image: b.image || '', link: b.link || '', sort_order: b.sort_order || 0, is_active: !!b.is_active });
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const url = await uploadImage(file, p => setUploadProgress(p));
      setForm(f => ({ ...f, image: url }));
      showToast('图片上传成功', 'success');
    } catch (err) {
      showToast(err.message || '上传失败', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(null);
      e.target.value = '';
    }
  };

  const save = async () => {
    if (!form.image) { showToast('请上传轮播图片', 'error'); return; }
    const body = { ...form, sort_order: parseInt(form.sort_order) || 0 };
    try {
      if (editing && editing.id) {
        await api.put(`/api/banners/${editing.id}`, body);
        showToast('轮播图更新成功', 'success');
      } else {
        await api.post('/api/banners', body);
        showToast('轮播图创建成功', 'success');
      }
      setEditing(null);
      fetchBanners();
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('确定删除该轮播图？')) return;
    try {
      await api.delete(`/api/banners/${id}`);
      showToast('删除成功', 'success');
      fetchBanners();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <div>
      <div className="flex-between mb-3">
        <p className="text-secondary" style={{ fontSize: 14 }}>首页轮播图配置，支持上传图片、填写标题与跳转链接</p>
        <button className="btn btn-primary btn-sm" onClick={startCreate}>+ 新增轮播图</button>
      </div>

      {/* 新增/编辑表单 */}
      {editing !== null && (
        <div className="card mb-4" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{editing.id ? '编辑轮播图' : '新增轮播图'}</h3>
          <div className="grid grid-2" style={{ gap: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">标题</label>
              <input className="form-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="轮播标题" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">副标题</label>
              <input className="form-input" value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="一句话副标题" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">跳转链接</label>
              <input className="form-input" value={form.link} onChange={e => setForm(f => ({ ...f, link: e.target.value }))} placeholder="/forum 或 https://..." />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">排序（数字越小越靠前）</label>
              <input type="number" className="form-input" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
            </div>
          </div>
          <div className="form-group mt-4">
            <label className="form-label">轮播图片</label>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={handleUpload} />
            <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
              {form.image ? (
                <img src={form.image} alt="预览" style={{ width: 160, height: 90, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
              ) : (
                <div className="flex-center" style={{ width: 160, height: 90, background: 'var(--input-bg)', borderRadius: 10, color: 'var(--text-secondary)', fontSize: 13 }}>暂无图片</div>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current.click()} disabled={uploading}>
                {uploading ? '上传中...' : (form.image ? '更换图片' : '上传图片')}
              </button>
              <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 14, cursor: 'pointer', marginLeft: 8 }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} />
                启用
              </label>
            </div>
            <p className="text-secondary" style={{ fontSize: 12, marginTop: 8 }}>也可以直接填写已有图片地址（如 /2.png、/3.png、/4.png、/7.png）</p>
          </div>
          <div className="flex" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>取消</button>
            <button className="btn btn-primary" onClick={save}>保存</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : banners.length === 0 ? (
        <div className="empty-state"><p>暂无轮播图</p></div>
      ) : (
        <div className="flex-col" style={{ gap: 12 }}>
          {banners.map(b => (
            <div key={b.id} className="card flex" style={{ padding: 14, gap: 16, alignItems: 'center' }}>
              <img src={b.image} alt={b.title} style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700 }}>{b.title || '(无标题)'}</span>
                  {b.is_active ? <span className="badge badge-success">启用</span> : <span className="badge badge-gray">停用</span>}
                  <span className="text-secondary" style={{ fontSize: 12 }}>排序 {b.sort_order}</span>
                </div>
                {b.subtitle && <div className="text-secondary" style={{ fontSize: 13, marginTop: 2 }}>{b.subtitle}</div>}
                {b.link && <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>链接：{b.link}</div>}
              </div>
              <div className="flex" style={{ gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(b)}>编辑</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(b.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 用户管理 ============ */
function UserManager({ showToast, isSuper }) {
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchUsers = (p, kw) => {
    setLoading(true);
    const params = new URLSearchParams({ page: p, limit: 20 });
    if (kw) params.set('search', kw);
    api.get(`/api/admin/users?${params}`)
      .then(data => { setUsers(data.users || []); setTotalPages(data.totalPages || 1); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(1, ''); }, []);

  const setLevel = async (id, level) => {
    if (!confirm(`确定将用户等级设为「${LEVEL_NAMES[level] || level}」？`)) return;
    try {
      await api.put(`/api/admin/users/${id}/level`, { level: parseInt(level) });
      showToast('等级更新成功', 'success');
      fetchUsers(page, search);
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    }
  };

  return (
    <div>
      <form className="flex" style={{ gap: 10, marginBottom: 16 }} onSubmit={e => { e.preventDefault(); setPage(1); fetchUsers(1, search.trim()); }}>
        <input className="form-input" placeholder="搜索用户名/昵称/邮箱" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-secondary" type="submit">搜索</button>
      </form>
      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {users.map(u => (
            <div key={u.id} className="flex" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 12, alignItems: 'center' }}>
              <img src={u.avatar || '/images/default-avatar.png'} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{u.nickname || u.username}</span>
                <span className="text-secondary ml-2" style={{ fontSize: 12 }}>@{u.username}</span>
                <span className="badge ml-2" style={{ background: 'rgba(0,74,173,0.12)', color: 'var(--primary)', fontSize: 11 }}>{LEVEL_NAMES[u.level] || '成员'}</span>
              </div>
              <div className="text-secondary" style={{ fontSize: 12 }}>{u.email || '未绑定邮箱'}</div>
              {isSuper && (
                <select
                  className="form-select"
                  style={{ width: 120, padding: '6px 8px' }}
                  value={u.level}
                  onChange={e => setLevel(u.id, e.target.value)}
                >
                  {Object.entries(LEVEL_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <div className="flex-center" style={{ gap: 12, marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => { setPage(page - 1); fetchUsers(page - 1, search); }}>上一页</button>
          <span className="text-secondary" style={{ fontSize: 14 }}>{page}/{totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => { setPage(page + 1); fetchUsers(page + 1, search); }}>下一页</button>
        </div>
      )}
    </div>
  );
}

/* ============ 内容管理 ============ */
function PostManager({ showToast }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPosts = () => {
    setLoading(true);
    api.get('/api/admin/posts?limit=50')
      .then(data => setPosts(data.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  };

  useEffect(fetchPosts, []);

  const togglePin = async (id, isPinned) => {
    try {
      await api.put(`/api/admin/posts/${id}/pin`, { is_pinned: isPinned ? 0 : 1 });
      showToast(isPinned ? '已取消置顶' : '已置顶', 'success');
      fetchPosts();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('确定删除该内容？')) return;
    try {
      await api.delete(`/api/posts/${id}`);
      showToast('删除成功', 'success');
      fetchPosts();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <div>
      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : posts.length === 0 ? (
        <div className="empty-state"><p>暂无内容</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {posts.map(p => (
            <div key={p.id} className="flex" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{p.is_pinned === 1 ? '📌 ' : ''}{p.title}</span>
                <span className="badge ml-2" style={{ fontSize: 11, background: 'rgba(0,74,173,0.12)', color: 'var(--primary)' }}>{p.type}</span>
                <div className="text-secondary" style={{ fontSize: 12 }}>{p.nickname || p.username} · {formatDate(p.created_at)} · {p.views} 浏览</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => togglePin(p.id, p.is_pinned)}>{p.is_pinned === 1 ? '取消置顶' : '置顶'}</button>
              <button className="btn btn-danger btn-sm" onClick={() => remove(p.id)}>删除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 公告管理 ============ */
function AnnouncementManager({ showToast }) {
  const [announcements, setAnnouncements] = useState([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPopup, setIsPopup] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [editing, setEditing] = useState(null); // null=新增, {} = 编辑中
  const [loading, setLoading] = useState(true);

  const fetchList = () => {
    setLoading(true);
    api.get('/api/admin/announcements')
      .then(data => setAnnouncements(data.announcements || []))
      .catch(() => setAnnouncements([]))
      .finally(() => setLoading(false));
  };

  useEffect(fetchList, []);

  const resetForm = () => {
    setTitle('');
    setContent('');
    setIsPopup(false);
    setIsActive(true);
    setEditing(null);
  };

  const startEdit = (a) => {
    setEditing(a);
    setTitle(a.title || '');
    setContent(a.content || '');
    setIsPopup(!!a.is_popup);
    setIsActive(!!a.is_active);
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) { showToast('标题和内容不能为空', 'error'); return; }
    const body = { title: title.trim(), content: content.trim(), isPopup, isActive };
    try {
      if (editing && editing.id) {
        await api.put(`/api/admin/announcements/${editing.id}`, body);
        showToast('公告更新成功', 'success');
      } else {
        await api.post('/api/admin/announcements', body);
        showToast('公告发布成功', 'success');
      }
      resetForm();
      fetchList();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('确定删除该公告？')) return;
    try {
      await api.delete(`/api/admin/announcements/${id}`);
      showToast('删除成功', 'success');
      fetchList();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{editing ? '编辑公告' : '发布公告'}</h3>
        <div className="form-group">
          <label className="form-label">标题</label>
          <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="公告标题" />
        </div>
        <div className="form-group">
          <label className="form-label">内容</label>
          <textarea className="form-textarea" value={content} onChange={e => setContent(e.target.value)} placeholder="公告内容（支持多行文本）" style={{ minHeight: 140 }} />
        </div>
        <div className="flex" style={{ gap: 16, marginBottom: 16 }}>
          <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={isPopup} onChange={e => setIsPopup(e.target.checked)} style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} />
            设为弹窗公告
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} />
            立即启用
          </label>
        </div>
        <div className="flex" style={{ gap: 10 }}>
          <button className="btn btn-primary btn-block" onClick={save}>{editing ? '保存修改' : '发布公告'}</button>
          {editing && <button className="btn btn-secondary" onClick={resetForm}>取消</button>}
        </div>
      </div>
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>已发布公告</h3>
        {loading ? (
          <div className="loading" style={{ padding: 20 }}><div className="spinner" /></div>
        ) : announcements.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}><p>暂无公告</p></div>
        ) : (
          <div className="flex-col" style={{ gap: 10 }}>
            {announcements.map(a => (
              <div key={a.id} className="card" style={{ padding: 14, background: 'var(--input-bg)' }}>
                <div className="flex-between mb-1">
                  <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700 }}>{a.title}</span>
                    {a.is_popup ? <span className="badge badge-success">弹窗</span> : <span className="badge badge-gray">普通</span>}
                    {a.is_active ? <span className="badge badge-success">启用</span> : <span className="badge badge-gray">停用</span>}
                  </div>
                  <div className="flex" style={{ gap: 6 }}>
                    <button className="link-btn" onClick={() => startEdit(a)}>编辑</button>
                    <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => remove(a.id)}>删除</button>
                  </div>
                </div>
                <div className="text-secondary" style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.content}</div>
                <div className="text-secondary" style={{ fontSize: 12, marginTop: 6 }}>{formatDate(a.created_at)}</div>
              </div>
            ))}
          </div>
        )}

        {/* 弹窗历史 */}
        {announcements.some(a => a.is_popup) && (
          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>弹窗历史</h3>
            <div className="flex-col" style={{ gap: 10 }}>
              {announcements.filter(a => a.is_popup).map(a => (
                <div key={a.id} className="card" style={{ padding: 14, borderLeft: '3px solid var(--primary)', background: 'var(--input-bg)' }}>
                  <div className="flex-between mb-1">
                    <span style={{ fontWeight: 700 }}>{a.title}</span>
                    <span className="flex" style={{ gap: 6, alignItems: 'center' }}>
                      {a.is_active ? <span className="badge badge-success">启用中</span> : <span className="badge badge-gray">已停用</span>}
                      <span className="text-secondary" style={{ fontSize: 12 }}>发布于 {formatDate(a.created_at)}</span>
                    </span>
                  </div>
                  <div className="text-secondary" style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.content}</div>
                  {a.updated_at && a.updated_at !== a.created_at && (
                    <div className="text-secondary" style={{ fontSize: 12, marginTop: 6 }}>最近修改 {formatDate(a.updated_at)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ 商城管理 ============ */
const ITEM_TYPES = [
  { value: 'other', label: '物品' },
  { value: 'title', label: '称号' },
  { value: 'permission', label: '使用权限' }
];

const EMPTY_ITEM = { name: '', description: '', type: 'other', ref_id: '', price: '', image: '', stock: -1, duration_days: '', is_active: true };

function ShopManager({ showToast }) {
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null=列表，{} = 新增
  const [form, setForm] = useState(EMPTY_ITEM);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const fileInput = useRef(null);

  const fetchItems = () => {
    setLoading(true);
    Promise.all([
      api.get('/api/shop/admin/items'),
      api.get('/api/shop/admin/sales').catch(() => null)
    ]).then(([d, s]) => {
      setItems(d.items || []);
      setSales(s);
    }).catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(fetchItems, []);

  const startCreate = () => {
    setEditing({});
    setForm(EMPTY_ITEM);
  };

  const startEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name || '',
      description: item.description || '',
      type: item.type || 'other',
      ref_id: item.ref_id || '',
      price: item.price ?? '',
      image: item.image || '',
      stock: item.stock ?? -1,
      duration_days: item.duration_days ?? '',
      is_active: !!item.is_active
    });
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const url = await uploadImage(file, p => setUploadProgress(p));
      setForm(f => ({ ...f, image: url }));
      showToast('图片上传成功', 'success');
    } catch (err) {
      showToast(err.message || '上传失败', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(null);
      e.target.value = '';
    }
  };

  const save = async () => {
    if (!form.name.trim()) { showToast('请填写商品名称', 'error'); return; }
    if (form.price === '' || Number(form.price) < 0) { showToast('请填写有效价格', 'error'); return; }
    const body = {
      name: form.name.trim(),
      description: form.description,
      type: form.type,
      ref_id: form.type === 'title' && form.ref_id ? parseInt(form.ref_id) : null,
      price: Number(form.price),
      image: form.image,
      stock: form.stock === '' ? -1 : parseInt(form.stock),
      duration_days: form.duration_days === '' ? 0 : parseInt(form.duration_days),
      is_active: form.is_active
    };
    try {
      if (editing && editing.id) {
        await api.put(`/api/shop/items/${editing.id}`, body);
        showToast('商品更新成功', 'success');
      } else {
        await api.post('/api/shop/items', body);
        showToast('商品创建成功', 'success');
      }
      setEditing(null);
      fetchItems();
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('确定删除该商品？')) return;
    try {
      await api.delete(`/api/shop/items/${id}`);
      showToast('删除成功', 'success');
      fetchItems();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  if (editing !== null) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{editing.id ? '编辑商品' : '新增商品'}</h3>
        <div className="grid grid-2" style={{ gap: 16 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">名称</label>
            <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="商品名称" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">类型</label>
            <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {form.type === 'title' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">称号ID（ref_id）</label>
              <input className="form-input" value={form.ref_id} onChange={e => setForm(f => ({ ...f, ref_id: e.target.value }))} placeholder="对应称号表的ID" />
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">价格（贡献点）</label>
            <input type="number" className="form-input" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">库存（-1 为不限量）</label>
            <input type="number" className="form-input" value={form.stock} onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} />
          </div>
          {form.type === 'permission' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">有效期（天数）</label>
              <input type="number" className="form-input" value={form.duration_days} onChange={e => setForm(f => ({ ...f, duration_days: e.target.value }))} placeholder="例如：30" min="1" />
              <p className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>权限类商品兑换后立即生效，到期自动失效；留空或 0 表示长期有效</p>
            </div>
          )}
        </div>
        <div className="form-group mt-4">
          <label className="form-label">描述</label>
          <textarea className="form-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="商品描述" style={{ minHeight: 80 }} />
        </div>
        <div className="form-group mt-4">
          <label className="form-label">商品图片</label>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={handleUpload} />
          <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
            {form.image ? (
              <img src={form.image} alt="预览" style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
            ) : (
              <div className="flex-center" style={{ width: 120, height: 80, background: 'var(--input-bg)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 12 }}>暂无图片</div>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current.click()} disabled={uploading}>
              {uploading ? (uploadProgress !== null ? `上传中 ${uploadProgress}%` : '上传中...') : (form.image ? '更换图片' : '上传图片')}
            </button>
            <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 14, cursor: 'pointer', marginLeft: 8 }}>
              <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} />
              上架
            </label>
          </div>
        </div>
        <div className="flex" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>取消</button>
          <button className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* 商品营业额 */}
      {sales && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>商品营业额</h3>
          <div className="grid grid-3" style={{ gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'var(--input-bg)', borderRadius: 10, padding: '12px 14px' }}>
              <div className="text-secondary" style={{ fontSize: 12 }}>累计营业额</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--warning)', marginTop: 2 }}>{(sales.total?.revenue || 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400 }}>贡献点</span></div>
            </div>
            <div style={{ background: 'var(--input-bg)', borderRadius: 10, padding: '12px 14px' }}>
              <div className="text-secondary" style={{ fontSize: 12 }}>交易笔数</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{sales.total?.transactions || 0}</div>
            </div>
            <div style={{ background: 'var(--input-bg)', borderRadius: 10, padding: '12px 14px' }}>
              <div className="text-secondary" style={{ fontSize: 12 }}>近7天营业额</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{(sales.daily || []).reduce((s, d) => s + (d.revenue || 0), 0).toLocaleString()}</div>
            </div>
          </div>
          {(sales.daily || []).length > 0 && (
            <div className="flex" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              {sales.daily.map(d => (
                <span key={d.d} className="badge" style={{ fontSize: 12, background: 'rgba(0,74,173,0.1)', color: 'var(--text)' }}>
                  {d.d.slice(5)}：{d.revenue} 点
                </span>
              ))}
            </div>
          )}
          {(sales.byItem || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="text-secondary" style={{ fontSize: 12, fontWeight: 600 }}>按商品（累计）</div>
              {sales.byItem.map((b, i) => (
                <div key={i} className="flex-between" style={{ padding: '7px 10px', background: 'var(--input-bg)', borderRadius: 8, fontSize: 13 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.item_name}</span>
                  <span style={{ flexShrink: 0 }}>售出 {b.sold} 件 · <b style={{ color: 'var(--warning)' }}>{b.revenue}</b> 点</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-between mb-3">
        <p className="text-secondary" style={{ fontSize: 14 }}>管理商城商品：上架/下架、库存与价格调整</p>
        <button className="btn btn-primary btn-sm" onClick={startCreate}>+ 新增商品</button>
      </div>
      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="empty-state"><p>暂无商品</p></div>
      ) : (
        <div className="flex-col" style={{ gap: 10 }}>
          {items.map(item => (
            <div key={item.id} className="card flex" style={{ padding: 14, gap: 14, alignItems: 'center' }}>
              {item.image ? (
                <img src={item.image} alt={item.name} style={{ width: 72, height: 48, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              ) : (
                <div className="flex-center" style={{ width: 72, height: 48, background: 'var(--input-bg)', borderRadius: 8, fontSize: 20, flexShrink: 0 }}>📦</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700 }}>{item.name}</span>
                  <span className="badge" style={{ fontSize: 11, background: 'rgba(0,74,173,0.12)', color: 'var(--primary)' }}>{ITEM_TYPES.find(t => t.value === item.type)?.label || item.type}</span>
                  {item.is_active ? <span className="badge badge-success">上架</span> : <span className="badge badge-gray">下架</span>}
                </div>
                <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                  {item.price} 贡献点 · {item.stock === -1 ? '不限量' : `库存 ${item.stock}`}
                  {item.type === 'permission' ? ` · 有效期 ${item.duration_days || 0} 天` : ''}
                  {item.ref_id ? ` · 称号ID ${item.ref_id}` : ''}
                </div>
                {item.description && <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>{item.description}</div>}
              </div>
              <div className="flex" style={{ gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(item)}>编辑</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 申报审核 ============ */
const CLAIM_STATUS = {
  pending: { label: '待审核', color: '#f59e0b' },
  approved: { label: '已通过', color: '#10b981' },
  rejected: { label: '已拒绝', color: '#ef4444' }
};

function ClaimReview({ showToast }) {
  const [status, setStatus] = useState('pending');
  const [claims, setClaims] = useState([]);
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(null);

  const fetchClaims = (s) => {
    setLoading(true);
    api.get(`/api/claims?status=${s}&limit=50`)
      .then(data => setClaims(data.claims || []))
      .catch(() => setClaims([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchClaims(status); }, [status]);

  const review = async (id, result) => {
    if (!confirm(`确定${result === 'approved' ? '通过' : '拒绝'}该申报？`)) return;
    setSubmitting(id);
    try {
      await api.put(`/api/claims/${id}/review`, { status: result, reviewNote: (notes[id] || '').trim() });
      showToast('审核完成', 'success');
      fetchClaims(status);
    } catch (e) {
      showToast(e.message || '审核失败', 'error');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div>
      <div className="flex" style={{ gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {Object.entries(CLAIM_STATUS).map(([k, v]) => (
          <button key={k} className={`btn ${status === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatus(k)}>{v.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : claims.length === 0 ? (
        <div className="empty-state"><p>暂无{CLAIM_STATUS[status].label}的申报</p></div>
      ) : (
        <div className="flex-col" style={{ gap: 12 }}>
          {claims.map(c => (
            <div key={c.id} className="card" style={{ padding: 18 }}>
              <div className="flex-between mb-2" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
                  <img src={c.avatar || '/images/default-avatar.png'} alt="" style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }} />
                  <div>
                    <span style={{ fontWeight: 600 }}>{c.nickname || c.username}</span>
                    <span className="text-secondary ml-1" style={{ fontSize: 12 }}>@{c.username}</span>
                  </div>
                  <span className="badge" style={{ fontSize: 12, background: `${CLAIM_STATUS[c.status]?.color || '#888'}1a`, color: CLAIM_STATUS[c.status]?.color || '#888' }}>
                    {CLAIM_STATUS[c.status]?.label || c.status}
                  </span>
                </div>
                <div className="flex" style={{ gap: 14, alignItems: 'center' }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: '#f59e0b' }}>+{c.amount} <span style={{ fontSize: 12, fontWeight: 400 }}>贡献点</span></span>
                  <span className="text-secondary" style={{ fontSize: 12 }}>{formatDate(c.created_at)}</span>
                </div>
              </div>

              <p className="text-secondary" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>{c.reason}</p>

              {c.evidenceImages && c.evidenceImages.length > 0 && (
                <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {c.evidenceImages.map((img, i) => (
                    <img key={i} src={img} alt="证据" style={{ width: 90, height: 68, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', cursor: 'zoom-in' }} onClick={() => window.open(img, '_blank')} />
                  ))}
                </div>
              )}

              {c.review_note && (
                <div className="text-secondary" style={{ fontSize: 12, marginBottom: 10, background: 'var(--input-bg)', padding: '8px 12px', borderRadius: 8 }}>
                  审核备注：{c.review_note}
                </div>
              )}

              {status === 'pending' && (
                <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="form-input"
                    placeholder="审核备注（可选）"
                    value={notes[c.id] || ''}
                    onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))}
                    style={{ flex: 1, minWidth: 160 }}
                  />
                  <button className="btn btn-success btn-sm" style={{ background: '#10b981' }} disabled={submitting === c.id} onClick={() => review(c.id, 'approved')}>
                    通过
                  </button>
                  <button className="btn btn-danger btn-sm" disabled={submitting === c.id} onClick={() => review(c.id, 'rejected')}>
                    拒绝
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 数据看板 ============ */
function Dashboard({ showToast }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/api/admin/dashboard')
      .then(setData)
      .catch(() => showToast('看板数据加载失败', 'error'));
  }, [showToast]);

  if (!data) return <div className="loading"><div className="spinner" />加载中...</div>;

  const maxFlow = Math.max(...data.contributionFlow.map(d => Math.abs(d.amount)), 1);
  const maxUsers = Math.max(...data.userGrowth.map(d => d.count), 1);
  const maxViews = Math.max(...data.viewsTrend.map(d => d.pv), 1);
  const TYPE_NAMES = { claim: '申报', task: '任务', transfer_in: '转入', transfer_out: '转出', purchase: '消费', reward: '签到', admin: '管理调整' };

  // 补全近7天浏览量（无访问的天补 0）
  const viewsByDate = {};
  (data.viewsTrend || []).forEach(d => { viewsByDate[d.date] = d.pv; });
  const viewsTrend7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const pad = n => String(n).padStart(2, '0');
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { date: key, pv: viewsByDate[key] || 0 };
  });

  return (
    <div>
      <div className="grid grid-4" style={{ gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="text-secondary" style={{ fontSize: 13 }}>贡献点总量</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>{data.totalContribution}</div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="text-secondary" style={{ fontSize: 13 }}>今日签到</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#10b981', marginTop: 4 }}>{data.todayCheckins}</div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="text-secondary" style={{ fontSize: 13 }}>今日浏览量</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#8b5cf6', marginTop: 4 }}>{data.todayViews ?? 0}</div>
          <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>累计 {data.totalViews ?? 0}</div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="text-secondary" style={{ fontSize: 13 }}>贡献点流动类型</div>
          <div style={{ fontSize: 13, marginTop: 8, maxHeight: 90, overflowY: 'auto' }}>
            {data.contributionByType.map(t => (
              <div key={t.type} className="flex" style={{ justifyContent: 'space-between', padding: '2px 0' }}>
                <span>{TYPE_NAMES[t.type] || t.type}</span>
                <b>{t.amount > 0 ? '+' : ''}{t.amount}</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ marginBottom: 12, fontSize: 15 }}>近7天贡献点流动</h4>
          {data.contributionFlow.length === 0 ? <p className="text-secondary" style={{ fontSize: 13 }}>暂无数据</p> : (
            <div className="flex" style={{ alignItems: 'flex-end', gap: 8, height: 120 }}>
              {data.contributionFlow.map(d => (
                <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: d.amount >= 0 ? '#10b981' : '#ef4444', marginBottom: 4 }}>{d.amount > 0 ? '+' : ''}{d.amount}</div>
                  <div style={{ height: Math.max(4, Math.abs(d.amount) / maxFlow * 80), background: d.amount >= 0 ? 'var(--primary)' : '#ef4444', borderRadius: '4px 4px 0 0' }} />
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>{d.date.slice(5)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ marginBottom: 12, fontSize: 15 }}>近7天新增用户</h4>
          {data.userGrowth.length === 0 ? <p className="text-secondary" style={{ fontSize: 13 }}>暂无数据</p> : (
            <div className="flex" style={{ alignItems: 'flex-end', gap: 8, height: 120 }}>
              {data.userGrowth.map(d => (
                <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--primary)', marginBottom: 4 }}>{d.count}</div>
                  <div style={{ height: Math.max(4, d.count / maxUsers * 80), background: 'var(--primary)', borderRadius: '4px 4px 0 0' }} />
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>{d.date.slice(5)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h4 style={{ marginBottom: 12, fontSize: 15 }}>近7天全站浏览量</h4>
        <div className="flex" style={{ alignItems: 'flex-end', gap: 8, height: 120 }}>
          {viewsTrend7.map(d => (
            <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#8b5cf6', marginBottom: 4 }}>{d.pv}</div>
              <div style={{ height: Math.max(4, d.pv / maxViews * 80), background: '#8b5cf6', borderRadius: '4px 4px 0 0', opacity: d.pv ? 1 : 0.25 }} />
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>{d.date.slice(5)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h4 style={{ marginBottom: 12, fontSize: 15 }}>贡献点排行 Top 8</h4>
        <div className="grid grid-4" style={{ gap: 10 }}>
          {data.topContributors.map((u, i) => (
            <div key={u.id} className="flex" style={{ gap: 10, alignItems: 'center', padding: '10px 12px', background: 'var(--input-bg)', borderRadius: 10 }}>
              <span style={{ fontWeight: 800, color: i < 3 ? '#f59e0b' : 'var(--text-secondary)' }}>{i + 1}</span>
              <img src={u.avatar || '/images/default-avatar.png'} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nickname || u.username}</div>
              </div>
              <b style={{ fontSize: 13, color: 'var(--primary)' }}>{u.contribution}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============ 贡献点日志 ============ */
const LOG_TYPE_NAMES = { claim: '申报', task: '任务', transfer_in: '转入', transfer_out: '转出', purchase: '商城消费', reward: '签到奖励', admin: '管理调整' };

function ContributionLogs({ showToast }) {
  const [logs, setLogs] = useState([]);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchLogs = (t) => {
    setLoading(true);
    const q = t ? `?type=${t}` : '';
    api.get(`/api/contributions/all-logs${q}`)
      .then(d => setLogs(d.logs || []))
      .catch(() => showToast('日志加载失败', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLogs(''); }, []);

  return (
    <div>
      <div className="flex" style={{ gap: 10, marginBottom: 16 }}>
        <select className="form-select" style={{ width: 160 }} value={type} onChange={e => { setType(e.target.value); fetchLogs(e.target.value); }}>
          <option value="">全部类型</option>
          {Object.entries(LOG_TYPE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-secondary" style={{ fontSize: 13, alignSelf: 'center' }}>共 {logs.length} 条</span>
      </div>
      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : logs.length === 0 ? (
        <div className="empty-state"><p>暂无流水记录</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {logs.map(l => (
            <div key={l.id} className="flex" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{l.nickname || l.username}</div>
                <div className="text-secondary" style={{ fontSize: 12 }}>{formatDate(l.created_at, false)}</div>
              </div>
              <span className="badge badge-gray" style={{ fontSize: 11 }}>{LOG_TYPE_NAMES[l.type] || l.type}</span>
              <b style={{ fontSize: 14, color: l.amount >= 0 ? '#10b981' : '#ef4444' }}>{l.amount >= 0 ? '+' : ''}{l.amount}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 任务管理 ============ */
function TaskManager({ showToast }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', image: '', projection: '', reward: '' });
  const [createdCode, setCreatedCode] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [claims, setClaims] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const fileInput = useRef(null);
  const projInput = useRef(null);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const url = await uploadImage(file, p => setUploadProgress(p));
      setForm(f => ({ ...f, image: url }));
      showToast('图片上传成功', 'success');
    } catch (err) {
      showToast(err.message || '上传失败', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(null);
      e.target.value = '';
    }
  };

  const handleProjUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.litematic')) {
      showToast('仅支持 .litematic 投影文件', 'error');
      e.target.value = '';
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const url = await uploadProjection(file, p => setUploadProgress(p));
      setForm(f => ({ ...f, projection: url }));
      showToast('投影上传成功', 'success');
    } catch (err) {
      showToast(err.message || '上传失败', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(null);
      e.target.value = '';
    }
  };

  const fetchTasks = () => {
    setLoading(true);
    api.get('/api/tasks/admin/list')
      .then(d => setTasks(d.tasks || []))
      .catch(() => showToast('任务加载失败', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(fetchTasks, []);

  const createTask = async () => {
    if (!form.title.trim() || !form.reward) { showToast('请填写标题与奖励', 'error'); return; }
    try {
      const d = await api.post('/api/tasks', { ...form, reward: parseInt(form.reward) });
      showToast('任务创建成功', 'success');
      setCreatedCode(d.code);
      setForm({ title: '', description: '', image: '', projection: '', reward: '' });
      setShowForm(false);
      fetchTasks();
    } catch (e) {
      showToast(e.message || '创建失败', 'error');
    }
  };

  const toggleActive = async (t) => {
    try {
      await api.put(`/api/tasks/${t.id}`, { title: t.title, description: t.description, image: t.image, projection: t.projection, reward: t.reward, isActive: t.is_active ? 0 : 1 });
      showToast(t.is_active ? '已下线' : '已上线', 'success');
      fetchTasks();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const loadClaims = async (taskId) => {
    if (expanded === taskId) { setExpanded(null); return; }
    try {
      const d = await api.get(`/api/tasks/${taskId}/claims`);
      setClaims(d.claims || []);
      setExpanded(taskId);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <div>
      <div className="flex" style={{ gap: 10, marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>{showForm ? '收起表单' : '创建任务'}</button>
        {createdCode && (
          <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
            <span className="text-secondary" style={{ fontSize: 13 }}>完成验证码（仅管理员可见，请发给完成任务者）：</span>
            <code style={{ background: '#fff3cd', padding: '4px 10px', borderRadius: 6, fontSize: 14, fontWeight: 700, color: '#b45309' }}>{createdCode}</code>
            <button className="btn btn-secondary btn-sm" onClick={() => setCreatedCode('')}>关闭</button>
          </div>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h4 style={{ marginBottom: 12 }}>创建任务</h4>
          <div style={{ display: 'grid', gap: 10 }}>
            <input className="form-input" placeholder="任务标题 *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <textarea className="form-input" rows={2} placeholder="任务说明" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={handleUpload} />
              {form.image ? (
                <img src={form.image} alt="任务配图" style={{ width: 96, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
              ) : (
                <div className="flex-center" style={{ width: 96, height: 64, background: 'var(--input-bg)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 12 }}>任务配图</div>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current.click()} disabled={uploading}>
                {uploading ? (uploadProgress !== null ? `上传中 ${uploadProgress}%` : '上传中...') : (form.image ? '更换图片' : '上传图片')}
              </button>
              {form.image && <button type="button" className="link-btn" onClick={() => setForm(f => ({ ...f, image: '' }))}>移除</button>}
            </div>
            <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
              <input ref={projInput} type="file" accept=".litematic" hidden onChange={handleProjUpload} />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => projInput.current.click()} disabled={uploading}>
                {uploading ? (uploadProgress !== null ? `上传中 ${uploadProgress}%` : '上传中...') : (form.projection ? '更换投影' : '上传投影(.litematic)')}
              </button>
              {form.projection && <button type="button" className="link-btn" onClick={() => setForm(f => ({ ...f, projection: '' }))}>移除投影</button>}
              {form.projection && <span className="text-secondary" style={{ fontSize: 12 }}>已上传投影文件</span>}
            </div>
            <input className="form-input" type="number" placeholder="贡献点奖励 *" value={form.reward} onChange={e => setForm({ ...form, reward: e.target.value })} />
          </div>
          <div className="flex" style={{ gap: 10, marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setShowForm(false)}>取消</button>
            <button className="btn btn-primary" onClick={createTask}>创建</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : tasks.length === 0 ? (
        <div className="empty-state"><p>暂无任务</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {tasks.map(t => (
            <div key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex" style={{ padding: '14px 16px', gap: 12, alignItems: 'center' }}>
                {t.image && <img src={t.image} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{t.title} {!t.is_active && <span className="badge badge-gray" style={{ fontSize: 10 }}>已下线</span>}</div>
                  <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                    奖励 {t.reward} · 领取 {t.claim_count} · 完成 {t.completed_count} · 验证码 <code style={{ background: 'var(--input-bg)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>{t.code}</code>
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => loadClaims(t.id)}>{expanded === t.id ? '收起' : '领取记录'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(t)}>{t.is_active ? '下线' : '上线'}</button>
              </div>
              {expanded === t.id && (
                <div style={{ padding: '0 16px 14px 16px' }}>
                  {claims.length === 0 ? <p className="text-secondary" style={{ fontSize: 13 }}>暂无成员接取</p> : (
                    claims.map(c => (
                      <div key={c.id} className="flex" style={{ padding: '8px 12px', background: 'var(--input-bg)', borderRadius: 8, marginBottom: 6, gap: 10, alignItems: 'center' }}>
                        <div style={{ flex: 1, fontSize: 13 }}>{c.nickname || c.username} <span className="text-secondary" style={{ fontSize: 11 }}>@{c.username}</span></div>
                        {c.status === 'completed' ? (
                          <span className="badge badge-success" style={{ fontSize: 11 }}>已完成 {c.completed_at ? formatDate(c.completed_at, false) : ''}</span>
                        ) : (
                          <span className="badge badge-gray" style={{ fontSize: 11 }}>进行中</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 核销商品 ============ */
function VerifyManager({ showToast }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [already, setAlready] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState(null);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const verify = async () => {
    if (!code.trim()) { showToast('请输入核销码', 'error'); return; }
    setChecking(true);
    setError('');
    setResult(null);
    setAlready(false);
    setVerifiedAt(null);
    setQty(1);
    try {
      const d = await api.post('/api/shop/verify', { code: code.trim() });
      setResult(d.item);
      setAlready(!!d.already);
      setVerifiedAt(d.verifiedAt || null);
      setQty(d.quantity || 1);
    } catch (e) {
      setError(e.message);
      showToast(e.message, 'error');
    } finally {
      setChecking(false);
    }
  };

  const confirm = async () => {
    if (!confirm(already ? '该核销码已核销，仍要确认？' : '确认核销此商品？')) return;
    setConfirming(true);
    try {
      const d = await api.post('/api/shop/confirm', { code: code.trim() });
      showToast(`${d.message}（${d.itemName}）${d.quantity ? ` ×${d.quantity}` : ''}`, 'success');
      setResult(null);
      setAlready(false);
      setCode('');
    } catch (e) {
      setError(e.message);
      showToast(e.message, 'error');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ padding: 20, maxWidth: 520, marginBottom: 16 }}>
        <h4 style={{ marginBottom: 6 }}>核销商品</h4>
        <p className="text-secondary" style={{ fontSize: 13, marginBottom: 14 }}>输入成员提供的核销码，验证后确认核销（用于线下交付凭证）</p>
        <div className="flex" style={{ gap: 10 }}>
          <input
            className="form-input"
            placeholder="请输入核销码"
            value={code}
            onChange={e => { setCode(e.target.value); setResult(null); setError(''); }}
            style={{ flex: 1 }}
            onKeyDown={e => e.key === 'Enter' && verify()}
          />
          <button className="btn btn-primary" disabled={checking} onClick={verify}>{checking ? '验证中...' : '验证'}</button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 20, maxWidth: 520, background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <div style={{ color: '#ef4444', fontSize: 14, fontWeight: 600 }}>✗ {error}</div>
        </div>
      )}

      {result && (
        <div className="card" style={{ padding: 20, maxWidth: 520 }}>
          <h4 style={{ color: already ? '#f59e0b' : '#10b981', marginBottom: 12 }}>
            {already ? '⚠ 该核销码已核销' : '✓ 核销码有效'}
          </h4>
          {already && verifiedAt && (
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 10 }}>核销时间：{formatDate(verifiedAt, false)}</div>
          )}
          {!already && qty > 1 && (
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 10 }}>本批共 {qty} 件，核销一次整批完成</div>
          )}
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div><span className="text-secondary">商品：</span><b>{result.name}</b></div>
            <div><span className="text-secondary">类型：</span>{result.type === 'title' ? '称号' : '其他'}</div>
            <div><span className="text-secondary">购买人：</span>{result.buyer}</div>
            <div><span className="text-secondary">购买时间：</span>{formatDate(result.purchasedAt, false)}</div>
            {result.description && <div><span className="text-secondary">说明：</span>{result.description}</div>}
          </div>
          <div className="flex" style={{ gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setResult(null)}>取消</button>
            <button className="btn btn-success" style={{ background: '#10b981' }} disabled={confirming} onClick={confirm}>
              {confirming ? '核销中...' : '确认核销'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ 模组管理 ============ */
function ModServerManager({ showToast }) {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [serverIp, setServerIp] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const d = await api.get('/api/mod/servers');
      setServers(d.servers || []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addServer = async () => {
    if (!name.trim()) { showToast('请输入服务器名称', 'error'); return; }
    setSaving(true);
    try {
      const d = await api.post('/api/mod/servers', { name: name.trim(), serverIp: serverIp.trim() });
      showToast('服务器添加成功', 'success');
      // 新密钥仅显示一次
      showToast(`服务器密钥：${d.serverKey}`, 'success');
      setName(''); setServerIp('');
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateServer = async (id, field, value) => {
    const target = servers.find(s => s.id === id);
    const next = { ...target, [field]: value };
    try {
      await api.put(`/api/mod/servers/${id}`, { name: next.name, serverIp: next.server_ip });
      setServers(servers.map(s => s.id === id ? { ...s, [field]: value } : s));
      showToast('更新成功', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const removeServer = async (id) => {
    if (!confirm('确认删除该服务器？删除后模组将无法上报与提醒')) return;
    try {
      await api.delete(`/api/mod/servers/${id}`);
      setServers(servers.filter(s => s.id !== id));
      showToast('删除成功', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h4 style={{ marginBottom: 6 }}>添加游戏服务器</h4>
        <p className="text-secondary" style={{ fontSize: 13, marginBottom: 14 }}>
          注册公会游戏服务器：模组填入生成的密钥后即可上报在线玩家、接收申报审核提醒
        </p>
        <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input className="form-input" placeholder="服务器名称（如：玄剑主服）" value={name}
            onChange={e => setName(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <input className="form-input" placeholder="公网IP（可选）" value={serverIp}
            onChange={e => setServerIp(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <button className="btn btn-primary" disabled={saving} onClick={addServer}>
            {saving ? '添加中...' : '添加服务器'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 8 }}>
        {servers.length === 0 && (
          <div className="empty-state"><p>尚未注册任何服务器</p></div>
        )}
        {servers.map((s, i) => (
          <div key={s.id} className="flex-between" style={{
            padding: '14px 16px',
            borderBottom: i < servers.length - 1 ? '1px solid var(--border)' : 'none',
            gap: 12,
            flexWrap: 'wrap'
          }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {s.name}
                <span className="text-secondary" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                  密钥：<code style={{ fontSize: 11 }}>{s.server_key}</code>
                </span>
              </div>
              <div className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>
                服务器IP：
                <input
                  className="form-input"
                  style={{ display: 'inline-flex', width: 180, padding: '3px 8px', fontSize: 12, marginLeft: 4 }}
                  value={s.server_ip}
                  onChange={e => updateServer(s.id, 'server_ip', e.target.value)}
                  onBlur={e => updateServer(s.id, 'server_ip', e.target.value)}
                />
                <span style={{ marginLeft: 12 }}>
                  最后在线：{s.last_seen_at ? formatDate(s.last_seen_at, true) : '从未'}
                </span>
              </div>
            </div>
            <button className="btn btn-danger btn-sm" style={{ background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => removeServer(s.id)}>
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
