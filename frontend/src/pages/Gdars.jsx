import { useState, useCallback } from 'react';
import { api } from '../api';
import { formatDate } from '../utils';

// 处分级别标签（与后端 LEVEL_TEXT 对齐）
const LEVEL_META = {
  1: { text: '全会通报批评', color: 'var(--warning)' },
  2: { text: '通报批评+扣点', color: 'var(--danger)' },
  3: { text: '开除会籍（冻结）', color: 'var(--danger)' }
};

// 贡献点格式化
function fmtPoints(n) {
  if (n === null || n === undefined) return '0';
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export default function Gdars() {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  const doQuery = useCallback(async (kw = keyword) => {
    const q = (kw || '').trim();
    setError('');
    if (!q) { setResults([]); setSearched(false); return; }
    setLoading(true);
    try {
      const data = await api.get(`/api/discipline/query?username=${encodeURIComponent(q)}`);
      setResults(data.results || []);
      setSearched(true);
    } catch (e) {
      setError(e.message || '查询失败');
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  const onKeyDown = (e) => { if (e.key === 'Enter') doQuery(); };

  const hasActive = (actions) => actions.some(a => a.is_active);

  return (
    <div className="fade-in-up">
      {/* 顶部横幅 */}
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/7.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1 style={{ fontSize: 30 }}>玄剑公会成员处分信息查询管理系统</h1>
          <p style={{ letterSpacing: 1 }}>Xuanjian Guild Disciplinary Action Retrieval System · GDARS</p>
        </div>
      </div>

      {/* 查询框 */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input
            className="form-input"
            style={{ flex: 1, minWidth: 220 }}
            placeholder="输入成员用户名/昵称/ID 查询处分记录"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="btn btn-primary" onClick={() => doQuery()} disabled={loading}>
            {loading ? '查询中...' : '查询'}
          </button>
        </div>
        <p className="text-secondary" style={{ fontSize: 12, marginTop: 8 }}>
          仅展示受处分成员的处分记录。若无记录表示该成员当前无处分。
        </p>
        {error && <div className="alert alert-danger" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {searched && !loading && results.length === 0 && (
        <div className="card" style={{ padding: 30, textAlign: 'center' }}>
          <h3 style={{ fontSize: 16 }}>未查询到相关记录</h3>
          <p className="text-secondary" style={{ fontSize: 13, marginTop: 6 }}>请确认用户名/昵称正确，或该成员暂无处分记录。</p>
        </div>
      )}

      {results.map(({ user, actions }) => (
        <div key={user.id} className="card mb-4" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="flex-between" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 10 }}>
            <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
              {user.avatar
                ? <img src={user.avatar} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                : <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--input-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontWeight: 700 }}>{(user.nickname || user.username || '?').slice(0, 1)}</div>}
              <div>
                <div style={{ fontWeight: 700 }}>{user.nickname || user.username}</div>
                <div className="text-secondary" style={{ fontSize: 12 }}>@{user.username} · ID {user.id}</div>
              </div>
            </div>
            <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
              {hasActive(actions) ? (
                <span className="badge" style={{ background: 'rgba(220,53,69,0.15)', color: 'var(--danger)' }}>有生效处分</span>
              ) : actions.length ? (
                <span className="badge" style={{ background: 'rgba(23,162,184,0.15)', color: 'var(--info)' }}>处分已全部撤销</span>
              ) : (
                <span className="badge" style={{ background: 'rgba(40,167,69,0.15)', color: 'var(--success)' }}>无处分记录</span>
              )}
              <span className="text-secondary" style={{ fontSize: 12 }}>贡献点 {fmtPoints(user.contribution)}</span>
            </div>
          </div>

          {actions.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>处分等级</th>
                    <th>处分理由</th>
                    <th>附加惩罚</th>
                    <th>扣点</th>
                    <th>处分人</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map(a => {
                    const meta = LEVEL_META[a.level] || { text: a.level_text || '未知', color: 'var(--text-secondary)' };
                    return (
                      <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.6 }}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(a.created_at, false)}</td>
                        <td><span className="badge" style={{ background: `${meta.color}1a`, color: meta.color }}>{a.level_text || meta.text}</span></td>
                        <td>{a.reason || '—'}</td>
                        <td>{a.extra_penalty || '—'}</td>
                        <td>{a.deduct_points > 0 ? `-${a.deduct_points}` : '—'}</td>
                        <td>{a.admin_name || '系统'}</td>
                        <td>
                          {a.is_active
                            ? <span className="badge" style={{ background: 'rgba(220,53,69,0.15)', color: 'var(--danger)' }}>生效中</span>
                            : <span className="badge" style={{ background: 'rgba(23,162,184,0.15)', color: 'var(--info)' }}>已撤销</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 24 }}><p>该成员暂无处分记录</p></div>
          )}
        </div>
      ))}
    </div>
  );
}
