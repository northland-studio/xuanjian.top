import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { formatDate } from '../utils';

const STATUS_LABEL = { pending: '待审核', approved: '已通过', rejected: '未通过' };
const STATUS_CLASS = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger' };

/**
 * 我的 Wiki 投稿：普通用户查看自己提交的页面/修改的审核状态与驳回理由。
 */
export default function MySubmissions() {
  const { user, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');

  const load = useCallback(async (st = 'all') => {
    setLoading(true);
    try {
      const d = await api.get(`/api/wiki/submissions/mine?status=${encodeURIComponent(st)}&limit=50`);
      setItems(Array.isArray(d?.items) ? d.items : []);
      setTotal(d?.total || 0);
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { if (user) load(status); }, [user, status, load]);

  if (authLoading || loading) return <div className="loading"><div className="spinner" />加载中…</div>;
  if (!user) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <p>请先登录后查看你的投稿记录</p>
        <Link to="/login" className="btn btn-primary mt-3">去登录</Link>
      </div>
    );
  }

  return (
    <div className="fade-in-up wiki-page" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="wiki-breadcrumb">
        <Link to="/wiki">Wiki</Link><span>/</span><span>我的投稿</span>
      </div>

      <div className="wiki-article">
        <div className="wiki-section-head">
          <h2 style={{ fontSize: 20 }}>我的投稿（{total}）</h2>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {[['all', '全部'], ['pending', '待审核'], ['approved', '已通过'], ['rejected', '未通过']].map(([k, label]) => (
              <button
                key={k}
                className={`btn btn-sm ${status === k ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStatus(k)}
              >{label}</button>
            ))}
          </div>
        </div>

        <div className="wiki-submit-notice">
          投稿通过审核后才会发布到线上；未通过的会在这里给出理由。想继续编辑，可以直接在原页面上再次提交。
        </div>

        {items.length === 0 ? (
          <div className="empty-state"><p>还没有投稿记录</p><Link to="/wiki" className="btn btn-secondary mt-3">去 Wiki 写一篇</Link></div>
        ) : (
          <div className="flex-col" style={{ gap: 10 }}>
            {items.map(s => (
              <div key={s.id} className="wiki-admin-row">
                <div className="war-main">
                  <b>{s.title}</b>
                  <span className={`badge ${STATUS_CLASS[s.status] || 'badge-gray'}`} style={{ marginLeft: 8 }}>
                    {STATUS_LABEL[s.status] || s.status}
                  </span>
                  <span className="text-secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    {s.kind === 'new' ? '新建页面' : '修改已有页面'} · 提交于 {formatDate(s.created_at, true)}
                    {s.reviewed_at ? ` · 处理于 ${formatDate(s.reviewed_at, true)}` : ''}
                  </span>
                  {s.review_note && (
                    <div className="text-secondary" style={{ fontSize: 12.5, marginTop: 4 }}>
                      审核意见：{s.review_note}
                    </div>
                  )}
                  {s.page_slug && (
                    <div style={{ marginTop: 6 }}>
                      <Link to={`/wiki/${s.page_slug}`} className="btn btn-secondary btn-sm">查看页面</Link>
                      <Link to={`/wiki/editor/${s.page_id}`} className="btn btn-secondary btn-sm" style={{ marginLeft: 6 }}>继续编辑</Link>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
