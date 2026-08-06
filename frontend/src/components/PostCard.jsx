import { Link } from 'react-router-dom';
import { timeAgo, TYPE_META, parseTags } from '../utils';

// 内容卡片（日报/决策/贴吧通用）
export default function PostCard({ post }) {
  const type = TYPE_META[post.type] || TYPE_META.forum;
  const tags = parseTags(post.tags);

  return (
    <div className="card card-hover post-card">
      <div className="flex-between mb-2">
        <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
          <Link to={`/profile/${post.author_username}`}>
            <img
              src={post.author_avatar || '/images/default-avatar.png'}
              alt={post.author_nickname}
              className="post-avatar"
              style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
            />
          </Link>
          <div>
            <Link to={`/profile/${post.author_username}`} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              {post.author_nickname || post.author_username}
              {post.author_title_name && (
                <span
                  className="badge ml-1"
                  style={{ background: `${post.author_title_color || 'var(--primary)'}22`, color: post.author_title_color || 'var(--primary)', marginLeft: 6 }}
                >
                  {post.author_title_name}
                </span>
              )}
            </Link>
            <div className="text-secondary" style={{ fontSize: 12 }}>{timeAgo(post.created_at)}</div>
          </div>
        </div>
        <span className="badge" style={{ background: `${type.color}1a`, color: type.color }}>{type.label}</span>
      </div>

      <Link to={`/post/${post.id}`}>
        <h3 className="post-title" style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: 'var(--text)', lineHeight: 1.4 }}>
          {post.is_pinned === 1 && (
            <span className="badge badge-danger mr-1" style={{ marginRight: 6, fontSize: 11 }}>置顶</span>
          )}
          {post.title}
        </h3>
      </Link>

      {post.content && (
        <p className="post-excerpt" style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.7, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {post.content}
        </p>
      )}

      {post.images && post.images.length > 0 && (
        <div className="post-thumbs flex" style={{ gap: 8, marginBottom: 12, overflow: 'hidden' }}>
          {post.images.slice(0, 3).map((img, i) => (
            <img
              key={i}
              src={img}
              alt=""
              style={{ width: 90, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
            />
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {tags.map(t => (
            <span key={t} className="badge badge-gray">{t}</span>
          ))}
        </div>
      )}

      <div className="flex-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
        <span className="flex" style={{ gap: 16 }}>
          <span className="flex" style={{ gap: 4, alignItems: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {post.views || 0}
          </span>
          <span className="flex" style={{ gap: 4, alignItems: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {post.comments_count || 0}
          </span>
        </span>
        <span className="flex" style={{ gap: 4, alignItems: 'center' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
          </svg>
          {post.likes || 0}
        </span>
      </div>
    </div>
  );
}
