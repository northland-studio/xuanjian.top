import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import Lightbox from '../components/Lightbox';
import { formatDate, TYPE_META, parseTags, requireLogin } from '../utils';

function CommentItem({ comment, depth, onReply, onDelete, me }) {
  const [showReply, setShowReply] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const canDelete = me && (me.id === comment.author_id || me.level >= 1);

  const submitReply = async () => {
    if (!replyContent.trim()) return;
    try {
      await api.post(`/api/posts/${comment.post_id}/comments`, { content: replyContent.trim(), parentId: comment.id });
      setReplyContent('');
      setShowReply(false);
      window.location.reload();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="comment" style={{ marginLeft: depth > 0 ? 16 : 0, padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="flex" style={{ gap: 12 }}>
        <Link to={`/profile/${comment.author_username}`}>
          <img
            src={comment.author_avatar || '/images/default-avatar.png'}
            alt=""
            style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }}
          />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex-between">
            <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Link to={`/profile/${comment.author_username}`} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                {comment.author_nickname || comment.author_username}
              </Link>
              {comment.author_title_name && (
                <span className="badge" style={{ background: `${comment.author_title_color || 'var(--primary)'}22`, color: comment.author_title_color || 'var(--primary)', fontSize: 11 }}>
                  {comment.author_title_name}
                </span>
              )}
              {comment.reply_to && (
                <span className="text-secondary" style={{ fontSize: 13 }}>
                  回复 <Link to={`/profile/${comment.reply_to.username}`} style={{ color: 'var(--primary)' }}>{comment.reply_to.nickname || comment.reply_to.username}</Link>
                </span>
              )}
            </div>
            <span className="text-secondary" style={{ fontSize: 12 }}>{formatDate(comment.created_at)}</span>
          </div>
          <p style={{ fontSize: 14, margin: '6px 0', lineHeight: 1.7, wordBreak: 'break-word' }}>{comment.content}</p>
          <div className="flex" style={{ gap: 14 }}>
            <button className="link-btn" onClick={() => setShowReply(s => !s)}>回复</button>
            {canDelete && (
              <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => onDelete(comment.id)}>删除</button>
            )}
          </div>
          {showReply && (
            <div className="flex" style={{ gap: 10, marginTop: 10 }}>
              <input
                className="form-input"
                placeholder="写下你的回复..."
                value={replyContent}
                onChange={e => setReplyContent(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary btn-sm" onClick={submitReply}>回复</button>
            </div>
          )}
        </div>
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div style={{ marginTop: 8, background: 'var(--input-bg)', borderRadius: 10, padding: '4px 14px' }}>
          {comment.replies.map(r => (
            <CommentItem key={r.id} comment={r} depth={depth + 1} onReply={onReply} onDelete={onDelete} me={me} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [liked, setLiked] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { images: [], index }

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/posts/${id}`);
      setPost(data.post);
      setComments(data.comments || []);
      if (user) {
        api.get(`/api/favorites/posts/${id}/check`)
          .then(d => setFavorited(!!d.favorited))
          .catch(() => {});
      }
    } catch (e) {
      if (e.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  if (loading) {
    return <div className="loading"><div className="spinner" />加载中...</div>;
  }

  if (notFound || !post) {
    return (
      <div className="empty-state">
        <p>内容不存在或已被删除</p>
        <Link to="/forum" className="btn btn-primary mt-3">返回贴吧</Link>
      </div>
    );
  }

  const tags = parseTags(post.tags);
  const typeMeta = TYPE_META[post.type] || TYPE_META.forum;
  const canDelete = user && (user.id === post.author_id || user.level >= 1);

  const handleLike = async () => {
    if (!requireLogin(navigate, '请先登录后再点赞')) return;
    try {
      const data = await api.post(`/api/posts/${post.id}/like`);
      setLiked(data.liked);
      setPost(p => ({ ...p, likes: (p.likes || 0) + (data.liked ? 1 : -1) }));
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleFavorite = async () => {
    if (!requireLogin(navigate, '请先登录后再收藏')) return;
    try {
      const data = await api.post(`/api/favorites/posts/${post.id}`);
      setFavorited(data.favorited);
      showToast(data.favorited ? '收藏成功' : '已取消收藏', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // 分享：复制【帖子题目】+ 链接
  const sharePost = async () => {
    const url = `${window.location.origin}/posts/${post.id}`;
    const text = `【${post.title}】${url}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('链接已复制到剪贴板', 'success');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('链接已复制到剪贴板', 'success');
      } catch {
        showToast('复制失败，请手动复制地址栏链接', 'error');
      }
    }
  };

  // 富文本内图片点击放大
  const openRichImage = (e) => {
    const target = e.target;
    if (!target || target.tagName !== 'IMG') return;
    const container = e.currentTarget;
    const imgs = Array.from(container.querySelectorAll('img'))
      .map(img => img.getAttribute('src') || '')
      .filter(Boolean);
    const idx = imgs.indexOf(target.getAttribute('src'));
    setLightbox({ images: imgs, index: Math.max(idx, 0) });
  };

  const submitComment = async () => {
    if (!requireLogin(navigate, '请先登录后再评论')) return;
    if (!commentText.trim()) return;
    try {
      await api.post(`/api/posts/${post.id}/comments`, { content: commentText.trim() });
      setCommentText('');
      fetchDetail();
      showToast('评论成功', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const deleteComment = async (commentId) => {
    if (!confirm('确定删除这条评论吗？')) return;
    try {
      await api.delete(`/api/posts/${post.id}/comments/${commentId}`);
      fetchDetail();
      showToast('评论已删除', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const deletePost = async () => {
    if (!confirm('确定删除这篇内容吗？')) return;
    try {
      await api.delete(`/api/posts/${post.id}`);
      showToast('删除成功', 'success');
      navigate(post.type === 'forum' ? '/forum' : `/${post.type}`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <div className="fade-in-up" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="card" style={{ padding: '28px 24px' }}>
        <div className="flex-between mb-3">
          <span className="badge" style={{ background: `${typeMeta.color}1a`, color: typeMeta.color }}>{typeMeta.label}</span>
          {post.is_pinned === 1 && <span className="badge badge-danger">置顶</span>}
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 14, lineHeight: 1.4 }}>{post.title}</h1>

        <div className="flex-between" style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
          <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
            <Link to={`/profile/${post.author_username}`}>
              <img src={post.author_avatar || '/images/default-avatar.png'} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
            </Link>
            <div>
              <Link to={`/profile/${post.author_username}`} style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15 }}>
                {post.author_nickname || post.author_username}
                {post.author_title_name && (
                  <span className="badge ml-1" style={{ background: `${post.author_title_color || 'var(--primary)'}22`, color: post.author_title_color || 'var(--primary)', marginLeft: 6 }}>
                    {post.author_title_name}
                  </span>
                )}
              </Link>
              <div className="text-secondary" style={{ fontSize: 12 }}>{formatDate(post.created_at)} · {post.views} 次浏览</div>
            </div>
          </div>
          {canDelete && (
            <div className="flex" style={{ gap: 8 }}>
              {user && user.id === post.author_id && (
                <Link to={`/editor/${post.id}`} className="btn btn-secondary btn-sm">编辑</Link>
              )}
              <button className="btn btn-danger btn-sm" onClick={deletePost}>删除</button>
            </div>
          )}
        </div>

        <div className="rich-content" onClick={openRichImage}>
          <div dangerouslySetInnerHTML={{ __html: post.content }} />
        </div>

        {post.images && post.images.length > 0 && (
          <div className="post-images" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 16 }}>
            {post.images.map((img, i) => (
              <img
                key={i}
                src={img}
                alt=""
                onClick={() => setLightbox({ images: post.images, index: i })}
                style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', cursor: 'zoom-in' }}
              />
            ))}
          </div>
        )}

        {tags.length > 0 && (
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
            {tags.map(t => <span key={t} className="badge badge-gray">#{t}</span>)}
          </div>
        )}

        <div className="flex-center" style={{ gap: 12, marginTop: 24 }}>
          <button className="btn btn-secondary" onClick={sharePost}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            分享
          </button>
          <button className={`btn ${liked ? 'btn-primary' : 'btn-secondary'}`} onClick={handleLike}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
            </svg>
            点赞 {post.likes || 0}
          </button>
          <button className={`btn ${favorited ? 'btn-primary' : 'btn-secondary'}`} onClick={handleFavorite}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L3.436 10.1c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            收藏
          </button>
        </div>
      </div>

      {lightbox && (
        <Lightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />
      )}

      {/* 评论区 */}
      <div className="card mt-4" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>评论（{comments.length}）</h3>

        <div className="flex" style={{ gap: 10, marginBottom: 20 }}>
          <input
            className="form-input"
            placeholder={user ? '写下你的评论...' : '登录后可参与评论'}
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            style={{ flex: 1 }}
            disabled={!user}
            onKeyDown={e => { if (e.key === 'Enter') submitComment(); }}
          />
          <button className="btn btn-primary" onClick={submitComment}>发表</button>
        </div>

        {comments.length === 0 ? (
          <div className="text-secondary" style={{ textAlign: 'center', padding: '24px 0', fontSize: 14 }}>暂无评论，快来抢沙发！</div>
        ) : (
          comments.map(c => (
            <CommentItem key={c.id} comment={c} depth={0} me={user} onDelete={deleteComment} />
          ))
        )}
      </div>
    </div>
  );
}
