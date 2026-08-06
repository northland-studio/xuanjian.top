import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import PostCard from '../components/PostCard';
import { requireLogin } from '../utils';

// 通用内容列表页（日报/决策/贴吧）
export default function ContentList({ type, title }) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 10;

  const fetchPosts = useCallback(async (p, kw) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type, page: p, limit });
      if (kw) params.set('search', kw);
      const data = await api.get(`/api/posts?${params}`);
      setPosts(data.posts || []);
      setTotalPages(data.totalPages || 1);
    } catch (e) {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    fetchPosts(1, keyword);
    setPage(1);
  }, [fetchPosts, keyword]);

  const handleSearch = (e) => {
    e.preventDefault();
    setKeyword(search.trim());
  };

  const handlePublish = () => {
    if (!requireLogin(navigate)) return;
    navigate(`/editor?type=${type}`);
  };

  const bgImage = type === 'daily' ? '/2.png?v=20260806' : type === 'decision' ? '/3.png?v=20260806' : '/4.png?v=20260806';

  return (
    <div className="fade-in-up">
      {/* 板块头部 */}
      <div className="page-banner" style={{ backgroundImage: `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(${bgImage})` }}>
        <div className="page-banner-content">
          <h1>{title}</h1>
          <p>{type === 'daily' ? '了解公会最新动态、活动预告和重要通知' : type === 'decision' ? '公会重大决策和管理制度公示' : '自由交流、分享经验、展示作品'}</p>
          <button className="btn btn-primary" onClick={handlePublish}>发布内容</button>
        </div>
      </div>

      {/* 搜索栏 */}
      <form className="search-bar flex" style={{ gap: 10, marginBottom: 20 }} onSubmit={handleSearch}>
        <input
          className="form-input"
          placeholder={`搜索${title}内容...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-secondary">搜索</button>
      </form>

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          加载中...
        </div>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4, marginBottom: 12 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p>暂无内容，快去发布第一条吧！</p>
          <button className="btn btn-primary mt-3" onClick={handlePublish}>立即发布</button>
        </div>
      ) : (
        <div className="flex-col" style={{ gap: 16 }}>
          {posts.map(p => <PostCard key={p.id} post={p} />)}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex-center" style={{ gap: 12, marginTop: 24 }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); fetchPosts(p, keyword); }}>
            上一页
          </button>
          <span className="text-secondary" style={{ fontSize: 14 }}>
            {page} / {totalPages}
          </span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => { const p = page + 1; setPage(p); fetchPosts(p, keyword); }}>
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
