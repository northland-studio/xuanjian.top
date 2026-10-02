import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { formatDate } from '../utils';
import { plainText } from '../lib/seo';

/**
 * 简单行级 diff：返回 [{ type: 'same'|'del'|'ins', text }]
 * 不引第三方库，够用即可（req.md §14：最少实现「旧内容 / 新内容」并做简单 diff）。
 */
function diffLines(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');
  const n = a.length, m = b.length;
  // LCS 动态规划（页面文本量级不大，O(n*m) 可接受）
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'ins', text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i++] }); }
  while (j < m) { out.push({ type: 'ins', text: b[j++] }); }
  return out;
}

/** 把 HTML 拆成便于 diff 的行（按块级标签断行） */
function htmlToLines(html) {
  return String(html || '')
    .replace(/<\/(p|h[1-6]|li|tr|blockquote|figure|div|table|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .join('\n');
}

/** 版本历史页：/wiki/:slug/history —— 列表 + 查看版本 + 版本对比 + 恢复 */
export default function WikiHistory() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [page, setPage] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cur, setCur] = useState(null);          // 当前查看的版本（含 content）
  const [compare, setCompare] = useState(null);   // 被比较的版本
  const [busy, setBusy] = useState(false);

  const isAdmin = !!user && user.level >= 1;

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/wiki/${encodeURIComponent(slug)}/history`);
      setPage(d.page);
      setRevisions(d.revisions || []);
    } catch (e) {
      showToast(e.message || '加载历史失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug]);

  const view = async (rev) => {
    try {
      const d = await api.get(`/api/wiki/${encodeURIComponent(slug)}/history/${rev.id}`);
      setCur(d.revision);
      setCompare(null);
      window.scrollTo({ top: document.body.scrollHeight * 0.25, behavior: 'smooth' });
    } catch (e) {
      showToast(e.message || '加载版本失败', 'error');
    }
  };

  const doCompare = async (rev) => {
    try {
      const [a, b] = await Promise.all([
        api.get(`/api/wiki/${encodeURIComponent(slug)}/history/${rev.id}`),
        api.get(`/api/wiki/${slug}`)
      ]);
      setCur(a.revision);
      setCompare({ title: '当前版本', content: b.page.content });
    } catch (e) {
      showToast(e.message || '对比失败', 'error');
    }
  };

  const restore = async (rev) => {
    if (!confirm(`确定把页面恢复到版本 #${rev.id}（${formatDate(rev.created_at, true)}）？\n恢复会生成一条新的版本记录，历史不会丢失。`)) return;
    setBusy(true);
    try {
      await api.post(`/api/wiki/${page.id}/revisions/${rev.id}/restore`, {});
      showToast('已恢复该版本', 'success');
      setCur(null); setCompare(null);
      await load();
    } catch (e) {
      showToast(e.message || '恢复失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />加载版本历史…</div>;
  if (!page) return <div className="empty-state"><p>页面不存在</p></div>;

  const lines = cur && compare
    ? diffLines(htmlToLines(cur.content), htmlToLines(compare.content))
    : [];

  return (
    <div className="fade-in-up wiki-page">
      <div className="wiki-breadcrumb">
        <Link to="/wiki">Wiki</Link><span>/</span>
        <Link to={`/wiki/${page.slug}`}>{page.title}</Link><span>/ 历史版本</span>
      </div>

      <div className="wiki-article">
        <div className="wiki-article-head">
          <h1>{page.title} · 历史版本</h1>
          <p className="wiki-article-summary">
            共 {revisions.length} 个版本。每次正式保存都会留档；恢复旧版本同样会生成一条新记录，不会覆盖任何历史。
          </p>
          <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
            <Link to={`/wiki/${page.slug}`} className="btn btn-secondary btn-sm">返回正文</Link>
            {isAdmin && <Link to={`/wiki/editor/${page.id}`} className="btn btn-primary btn-sm">编辑当前版本</Link>}
          </div>
        </div>

        <ul className="wiki-rev-list">
          {revisions.map((r, idx) => (
            <li key={r.id} className="wiki-rev">
              <div className="wiki-rev-main">
                <b>版本 #{r.id}{idx === 0 ? '（最新）' : ''}</b>
                <div>
                  {formatDate(r.created_at, true)} · 编辑者 {r.editor_name || r.editor_username || '—'}
                  {r.revision_note ? ` · 备注：${r.revision_note}` : ''}
                  {r.content_length ? ` · 约 ${r.content_length} 字` : ''}
                </div>
              </div>
              <div className="flex" style={{ gap: 6 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => view(r)}>查看</button>
                <button className="btn btn-secondary btn-sm" onClick={() => doCompare(r)}>与当前对比</button>
                {isAdmin && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => restore(r)}>恢复</button>}
              </div>
            </li>
          ))}
        </ul>

        {cur && (
          <div style={{ marginTop: 22 }}>
            <div className="wiki-section-head">
              <h2>{compare ? `版本 #${cur.id} ↔ 当前版本（简单 diff）` : `版本 #${cur.id} 的内容`}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => { setCur(null); setCompare(null); }}>收起</button>
            </div>

            {compare ? (
              <div className="wiki-diff">
                <div className="wiki-diff-box">
                  <h4>版本 #{cur.id}（旧）</h4>
                  {lines.filter(l => l.type !== 'ins').map((l, i) => (
                    l.type === 'del'
                      ? <div key={i} style={{ background: 'rgba(220,53,69,.14)', borderRadius: 4, padding: '0 4px' }}>− {l.text}</div>
                      : <div key={i} style={{ opacity: .75 }}>{l.text}</div>
                  ))}
                </div>
                <div className="wiki-diff-box">
                  <h4>当前版本（新）</h4>
                  {lines.filter(l => l.type !== 'del').map((l, i) => (
                    l.type === 'ins'
                      ? <div key={i} style={{ background: 'rgba(16,185,129,.16)', borderRadius: 4, padding: '0 4px' }}>+ {l.text}</div>
                      : <div key={i} style={{ opacity: .75 }}>{l.text}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="wiki-diff-box" style={{ maxHeight: 'none' }}>
                <div className="wiki-content" dangerouslySetInnerHTML={{ __html: cur.content }} />
              </div>
            )}

            <p className="text-secondary" style={{ fontSize: 12.5, marginTop: 8 }}>
              该版本约 {plainText(cur.content, 999999).length} 字，编辑者 {cur.editor_name || cur.editor_username || '—'}。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
