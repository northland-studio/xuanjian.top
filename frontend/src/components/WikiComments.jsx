import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from './UI';
import { formatDate } from '../utils';

const LIMIT = 20;
const MAX_LEN = 2000;

/**
 * 页面评论（扁平列表，不带嵌套）。
 * 未登录时只读；登录后可发表；本人或管理员可删除。
 * 正文统一按纯文本渲染（不解析 HTML / Markdown），从根上避免 XSS。
 */
export default function WikiComments({ pageId, initialCount = null }) {
  const { user, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(initialCount ?? 0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async (p = 1) => {
    if (!pageId) return;
    setLoading(true);
    try {
      const d = await api.get(`/api/wiki/pages/${pageId}/comments?page=${p}&limit=${LIMIT}`);
      setItems(Array.isArray(d?.items) ? d.items : []);
      setTotal(d?.total || 0);
      setPage(p);
    } catch (e) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => { load(1); }, [load]);

  const submit = async () => {
    const content = text.trim();
    if (!content) return showToast('评论内容不能为空', 'error');
    if (content.length > MAX_LEN) return showToast(`评论过长（上限 ${MAX_LEN} 字）`, 'error');
    setPosting(true);
    try {
      const d = await api.post(`/api/wiki/pages/${pageId}/comments`, { content });
      setItems(prev => [d.comment, ...prev]);
      setTotal(t => t + 1);
      setText('');
      showToast('评论已发布', 'success');
    } catch (e) {
      showToast(e.message || '发表失败', 'error');
    } finally {
      setPosting(false);
    }
  };

  const remove = async (c) => {
    if (!confirm('确定删除这条评论？')) return;
    try {
      await api.delete(`/api/wiki/comments/${c.id}`);
      setItems(prev => prev.filter(x => x.id !== c.id));
      setTotal(t => Math.max(0, t - 1));
      showToast('评论已删除', 'success');
    } catch (e) {
      showToast(e.message || '删除失败', 'error');
    }
  };

  const canRemove = (c) => user && (Number(user.id) === Number(c.user_id) || Number(user.level) >= 1);
  const pages = Math.ceil(total / LIMIT);

  return (
    <section className="wiki-comments" id="comments">
      <div className="wiki-comments-head">
        <h2>评论{total > 0 ? `（${total}）` : ''}</h2>
        {!authLoading && !user && (
          <span className="text-secondary" style={{ fontSize: 13 }}>
            <Link to="/login">登录</Link> 后可以发表评论
          </span>
        )}
      </div>

      {user ? (
        <div className="wiki-comment-form">
          <textarea
            value={text}
            maxLength={MAX_LEN}
            placeholder="说点什么……（支持多行，纯文本显示）"
            onChange={e => setText(e.target.value)}
          />
          <div className="wiki-comment-actions">
            <span className="text-secondary">{text.length}/{MAX_LEN}　请勿发布广告或人身攻击内容</span>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={posting || !text.trim()}>
              {posting ? '发表中…' : '发表评论'}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="text-secondary" style={{ fontSize: 13 }}>加载评论中…</div>
      ) : items.length === 0 ? (
        <div className="text-secondary" style={{ fontSize: 13 }}>还没有评论，来说第一句。</div>
      ) : (
        <div className="wiki-comment-list">
          {items.map(c => (
            <article className="wiki-comment" key={c.id}>
              {c.avatar
                ? <img className="wiki-comment-avatar" src={c.avatar} alt="" loading="lazy" />
                : <div className="wiki-comment-avatar" />}
              <div className="wiki-comment-main">
                <div className="wiki-comment-meta">
                  <b>{c.nickname || c.username || '未知用户'}</b>
                  <span>{formatDate(c.created_at, true)}</span>
                  {canRemove(c) && (
                    <button className="wiki-comment-del" onClick={() => remove(c)}>删除</button>
                  )}
                </div>
                <div className="wiki-comment-body">{c.content}</div>
              </div>
            </article>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex" style={{ gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => load(p)}
            >{p}</button>
          ))}
        </div>
      )}
    </section>
  );
}
