import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, uploadImage } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { formatDate } from '../utils';

const TABS = [
  { key: 'banners', label: '轮播图管理' },
  { key: 'users', label: '用户管理' },
  { key: 'posts', label: '内容管理' },
  { key: 'announcements', label: '公告管理' }
];

const LEVEL_NAMES = { 0: '成员', 1: '管理员', 2: '超级管理员', 3: '创始人' };

export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState('banners');

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
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/1.png)' }}>
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

      {tab === 'banners' && <BannerManager showToast={showToast} />}
      {tab === 'users' && <UserManager showToast={showToast} isSuper={user.level >= 2} />}
      {tab === 'posts' && <PostManager showToast={showToast} />}
      {tab === 'announcements' && <AnnouncementManager showToast={showToast} />}
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
    try {
      const url = await uploadImage(file);
      setForm(f => ({ ...f, image: url }));
      showToast('图片上传成功', 'success');
    } catch (err) {
      showToast(err.message || '上传失败', 'error');
    } finally {
      setUploading(false);
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
                <span className="badge ml-2" style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--primary)', fontSize: 11 }}>{LEVEL_NAMES[u.level] || '成员'}</span>
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
                <span className="badge ml-2" style={{ fontSize: 11, background: 'rgba(99,102,241,0.12)', color: 'var(--primary)' }}>{p.type}</span>
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
  const [loading, setLoading] = useState(true);

  const fetchList = () => {
    setLoading(true);
    api.get('/api/admin/announcements')
      .then(data => setAnnouncements(data.announcements || []))
      .catch(() => setAnnouncements([]))
      .finally(() => setLoading(false));
  };

  useEffect(fetchList, []);

  const create = async () => {
    if (!title.trim() || !content.trim()) { showToast('标题和内容不能为空', 'error'); return; }
    try {
      await api.post('/api/admin/announcements', { title: title.trim(), content: content.trim() });
      showToast('公告发布成功', 'success');
      setTitle('');
      setContent('');
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
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>发布公告</h3>
        <div className="form-group">
          <label className="form-label">标题</label>
          <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="公告标题" />
        </div>
        <div className="form-group">
          <label className="form-label">内容</label>
          <textarea className="form-textarea" value={content} onChange={e => setContent(e.target.value)} placeholder="公告内容" style={{ minHeight: 140 }} />
        </div>
        <button className="btn btn-primary btn-block" onClick={create}>发布公告</button>
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
                  <span style={{ fontWeight: 700 }}>{a.title}</span>
                  <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => remove(a.id)}>删除</button>
                </div>
                <div className="text-secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>{a.content}</div>
                <div className="text-secondary" style={{ fontSize: 12, marginTop: 6 }}>{formatDate(a.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
