import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, uploadProjection } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import LitematicViewer from '../components/LitematicViewer';
import { formatDate, timeAgo, requireLogin } from '../utils';

// 文件大小格式化
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 投影仓库：上传 / 浏览 / 3D 预览 / 下载 Minecraft .litematic 投影文件
 */
export default function Projections() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const fileInput = useRef(null);

  const [projections, setProjections] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // 上传表单
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [tags, setTags] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [publishing, setPublishing] = useState(false);

  // 预览弹窗
  const [preview, setPreview] = useState(null);

  const load = useCallback((p, kw) => {
    setLoading(true);
    const params = new URLSearchParams({ page: p, limit: 12 });
    if (kw) params.set('q', kw);
    api.get(`/api/projections?${params.toString()}`)
      .then(d => {
        setProjections(prev => (p > 1 ? [...prev, ...d.projections] : d.projections));
        setTotal(d.total);
      })
      .catch(() => showToast('投影列表加载失败', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => { load(1, ''); }, [load]);

  const doSearch = () => {
    setPage(1);
    setSearch(q.trim());
    load(1, q.trim());
  };

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (f && !f.name.toLowerCase().endsWith('.litematic')) {
      showToast('仅支持 .litematic 投影文件', 'error');
      e.target.value = '';
      return;
    }
    setFile(f || null);
  };

  const publish = async () => {
    if (!requireLogin(navigate)) return;
    if (!title.trim()) { showToast('请输入投影标题', 'error'); return; }
    if (!file) { showToast('请选择 .litematic 投影文件', 'error'); return; }
    setPublishing(true);
    try {
      setUploading(true);
      setUploadProgress(0);
      const url = await uploadProjection(file, p => setUploadProgress(p));
      setUploading(false);
      await api.post('/api/projections', {
        title: title.trim(),
        description: desc.trim(),
        fileUrl: url,
        fileSize: file.size,
        tags: tags.split(/[,，]/).map(t => t.trim()).filter(Boolean).join(',')
      });
      showToast('投影发布成功', 'success');
      setTitle(''); setDesc(''); setTags(''); setFile(null);
      setShowForm(false);
      setPage(1);
      load(1, search);
    } catch (e) {
      showToast(e.message || '发布失败', 'error');
    } finally {
      setUploading(false);
      setPublishing(false);
    }
  };

  const download = async (p) => {
    try {
      const d = await api.post(`/api/projections/${p.id}/download`, {});
      window.open(d.url, '_blank');
    } catch (e) {
      showToast(e.message || '下载失败', 'error');
    }
  };

  const remove = async (p) => {
    if (!confirm(`确定删除投影「${p.title}」吗？`)) return;
    try {
      await api.delete(`/api/projections/${p.id}`);
      showToast('投影已删除', 'success');
      setProjections(prev => prev.filter(x => x.id !== p.id));
    } catch (e) {
      showToast(e.message || '删除失败', 'error');
    }
  };

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/2.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>投影仓库</h1>
          <p>上传、分享与预览 Minecraft Litematica 投影文件</p>
        </div>
      </div>

      <div className="card" style={{ padding: '14px 20px', marginBottom: 16, background: 'linear-gradient(135deg, rgba(0,74,173,0.06), rgba(0,102,204,0.04))' }}>
        <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="flex" style={{ gap: 8, flex: 1, minWidth: 220 }}>
            <input
              className="form-input"
              placeholder="搜索投影标题 / 标签..."
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              style={{ maxWidth: 320 }}
            />
            <button className="btn btn-secondary" onClick={doSearch}>搜索</button>
          </div>
          <button className="btn btn-primary" onClick={() => { if (!requireLogin(navigate, '请先登录后上传投影')) return; setShowForm(s => !s); }}>
            {showForm ? '收起上传' : '+ 上传投影'}
          </button>
        </div>

        {showForm && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="form-group">
              <label className="form-label">投影标题</label>
              <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：现代别墅 32×24" maxLength={60} />
            </div>
            <div className="form-group">
              <label className="form-label">描述</label>
              <textarea className="form-input" rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="建筑风格、需要的方块清单、使用建议等" />
            </div>
            <div className="form-group">
              <label className="form-label">标签（用逗号分隔）</label>
              <input className="form-input" value={tags} onChange={e => setTags(e.target.value)} placeholder="例如：建筑, 生存, 别墅" />
            </div>
            <div className="form-group">
              <label className="form-label">投影文件（.litematic，最大20MB）</label>
              <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input ref={fileInput} type="file" accept=".litematic" hidden onChange={handleFile} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current.click()} disabled={uploading}>
                  {uploading ? `上传中 ${uploadProgress}%` : (file ? '重新选择' : '选择文件')}
                </button>
                {file && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {file.name}（{formatBytes(file.size)}）
                    <button type="button" className="link-btn" onClick={() => setFile(null)}>移除</button>
                  </span>
                )}
              </div>
            </div>
            <div className="flex" style={{ gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn btn-primary" disabled={publishing || uploading} onClick={publish}>
                {publishing ? '发布中...' : '发布投影'}
              </button>
            </div>
          </div>
        )}
      </div>

      {loading && projections.length === 0 ? (
        <div className="loading"><div className="spinner" />加载中...</div>
      ) : projections.length === 0 ? (
        <div className="empty-state"><p>{search ? '未找到相关投影' : '仓库还是空的，快来上传第一个投影吧'}</p></div>
      ) : (
        <>
          <div className="grid grid-3">
            {projections.map(p => (
              <div key={p.id} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{p.title}</h3>
                <div className="text-secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  <Link to={`/profile/${p.author_username}`} style={{ color: 'var(--primary)' }}>{p.author_nickname || p.author_username}</Link>
                  {' · '}{timeAgo(p.created_at)}
                </div>
                <p className="text-secondary" style={{ fontSize: 13, marginBottom: 10, flex: 1, minHeight: 36, whiteSpace: 'pre-wrap' }}>{p.description || '暂无说明'}</p>
                {p.tags?.length > 0 && (
                  <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {p.tags.map(t => <span key={t} className="badge" style={{ fontSize: 11 }}>{t}</span>)}
                  </div>
                )}
                <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span className="text-secondary" style={{ fontSize: 12 }}>{formatBytes(p.file_size)}</span>
                  <span className="text-secondary" style={{ fontSize: 12 }}>下载 {p.downloads}</span>
                </div>
                <div className="flex" style={{ gap: 8 }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => setPreview(p)}>3D 预览</button>
                  <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => download(p)}>下载</button>
                  {(user && (user.id === p.author_id || user.level >= 1)) && (
                    <button className="btn btn-secondary btn-sm" style={{ color: 'var(--danger)' }} onClick={() => remove(p)}>删除</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {projections.length < total && (
            <div className="flex-center" style={{ marginTop: 20 }}>
              <button className="btn btn-secondary" disabled={loading} onClick={() => { const np = page + 1; setPage(np); load(np, search); }}>
                {loading ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal-content" style={{ maxWidth: 720, width: '92vw' }} onClick={e => e.stopPropagation()}>
            <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.title}</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setPreview(null)}>关闭</button>
            </div>
            <LitematicViewer url={preview.file_url} height={420} />
            <div className="flex" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={() => download(preview)}>下载投影文件</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
