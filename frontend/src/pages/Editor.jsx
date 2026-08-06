import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, uploadImages } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import RichTextEditor from '../components/RichTextEditor';
import { requireLogin } from '../utils';

const TYPES = [
  { value: 'forum', label: '贴吧讨论', desc: '自由交流、分享经验' },
  { value: 'daily', label: '公会日报', desc: '需要管理权限' },
  { value: 'decision', label: '决策公示', desc: '需要管理权限' }
];

export default function Editor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const fileInput = useRef(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState(params.get('type') || 'forum');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(!!id);

  useEffect(() => {
    if (!requireLogin(navigate)) return;
    if (id) {
      api.get(`/api/posts/${id}`).then(data => {
        const p = data.post;
        setTitle(p.title);
        setContent(p.content);
        setType(p.type);
        setTags((p.tags || '').split(',').join(', '));
        setImages(p.images || []);
        setLoading(false);
      }).catch(e => { showToast(e.message, 'error'); navigate('/forum'); });
    }
  }, [id, navigate]);

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const urls = await uploadImages(files);
      setImages(prev => [...prev, ...urls]);
      showToast('图片上传成功', 'success');
    } catch (err) {
      showToast(err.message || '图片上传失败', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const submit = async () => {
    if (!requireLogin(navigate)) return;
    if (!title.trim() || !content.trim()) {
      showToast('标题和内容不能为空', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        title: title.trim(),
        content: content.trim(),
        type,
        tags: tags.split(/[,，]/).map(t => t.trim()).filter(Boolean).join(','),
        images
      };
      if (id) {
        await api.put(`/api/posts/${id}`, body);
        showToast('更新成功', 'success');
        navigate(`/post/${id}`);
      } else {
        const data = await api.post('/api/posts', body);
        showToast('发布成功', 'success');
        navigate(`/post/${data.postId}`);
      }
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />加载中...</div>;

  return (
    <div className="fade-in-up" style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="card" style={{ padding: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{id ? '编辑内容' : '发布内容'}</h1>
        <p className="text-secondary" style={{ fontSize: 14, marginBottom: 24 }}>
          {user?.email_bound && user?.qq_bound
            ? '请文明发言，遵守公会规则'
            : <span style={{ color: 'var(--warning)' }}>提示：需先绑定QQ和邮箱后才能发布内容，请前往 <a href="/settings">设置</a> 完成绑定</span>}
        </p>

        <div className="form-group">
          <label className="form-label">内容类型</label>
          <div className="grid grid-3" style={{ gap: 10 }}>
            {TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                className={`btn ${type === t.value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setType(t.value)}
                style={{ flexDirection: 'column', padding: '14px 10px', lineHeight: 1.4 }}
              >
                <span style={{ fontWeight: 600 }}>{t.label}</span>
                <span style={{ fontSize: 12, opacity: 0.8 }}>{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">标题</label>
          <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="请输入标题" maxLength={100} />
        </div>

        <div className="form-group">
          <label className="form-label">内容（支持富文本）</label>
          <RichTextEditor value={content} onChange={setContent} />
          <div className="text-secondary" style={{ fontSize: 12, marginTop: 8 }}>支持标题、加粗、引用、列表、链接、代码块等格式</div>
        </div>

        <div className="form-group">
          <label className="form-label">标签（用逗号分隔）</label>
          <input className="form-input" value={tags} onChange={e => setTags(e.target.value)} placeholder="例如：活动, 公告, 经验分享" />
        </div>

        <div className="form-group">
          <label className="form-label">图片（可选，支持多图）</label>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={handleImageUpload} />
          <button type="button" className="btn btn-secondary" onClick={() => fileInput.current.click()} disabled={uploading}>
            {uploading ? '上传中...' : '+ 添加图片'}
          </button>
          {images.length > 0 && (
            <div className="flex" style={{ gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              {images.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={img} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  <button
                    type="button"
                    onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
                    aria-label="删除图片"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex" style={{ gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? '提交中...' : (id ? '保存修改' : '发布')}
          </button>
        </div>
      </div>
    </div>
  );
}
