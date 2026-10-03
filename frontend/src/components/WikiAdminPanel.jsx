import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { IconStar, IconPin } from './WikiIcons';
import { formatDate } from '../utils';

const TABS = [
  { key: 'review', label: '待审核' },
  { key: 'pages', label: '页面' },
  { key: 'drafts', label: '草稿' },
  { key: 'categories', label: '分类' },
  { key: 'history', label: '历史版本' },
  { key: 'stats', label: '数据统计' },
  { key: 'review-config', label: '审核设置' }
];

const TAB_KEYS = TABS.map(t => t.key);

/** 从 URL hash 取子页（#wiki/review → review） */
function initialTab() {
  if (typeof window === 'undefined') return 'pages';
  const m = window.location.hash.match(/^#wiki\/([\w-]+)/);
  return m && TAB_KEYS.includes(m[1]) ? m[1] : 'pages';
}

const STATUS_LABEL = { published: '已发布', draft: '草稿', archived: '已归档' };

/**
 * 管理后台 · Wiki
 * 页面 / 草稿 / 分类 / 历史版本 / 数据统计；写权限沿用 adminMiddleware（level≥1），
 * 彻底删除与删除分类需要超级管理员。
 */
export default function WikiAdminPanel() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState(initialTab);
  const [pendingCount, setPendingCount] = useState(0);
  const [submissions, setSubmissions] = useState([]);
  const [subStatus, setSubStatus] = useState('pending');
  const [subDetail, setSubDetail] = useState(null);      // { submission, current }
  const [subNote, setSubNote] = useState('');
  const [subPoints, setSubPoints] = useState('0');
  const [subBusy, setSubBusy] = useState(false);
  const [reviewCfg, setReviewCfg] = useState(null);
  const [cfgForm, setCfgForm] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const reviewCfgRef = useRef(null);

  const [tree, setTree] = useState([]);
  const [flatCats, setFlatCats] = useState([]);
  const [pages, setPages] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({ status: 'all', category_id: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [catForm, setCatForm] = useState({ name: '', parent_id: '', slug: '', description: '', sort_order: 0, icon: '' });
  const [editingCat, setEditingCat] = useState(null);

  const isSuper = !!user && user.level >= 2;

  const flatten = (nodes, depth = 0, out = []) => {
    for (const n of nodes) {
      out.push({ ...n, depth });
      if (n.children?.length) flatten(n.children, depth + 1, out);
    }
    return out;
  };

  const loadCats = useCallback(async () => {
    try {
      const d = await api.get('/api/wiki/categories?all=1');
      setTree(d.tree || []);
      setFlatCats(flatten(d.tree || []));
    } catch (e) { /* 忽略 */ }
  }, []);

  const loadPages = useCallback(async (f = filters, p = page, statusOverride) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('status', statusOverride || f.status || 'all');
      if (f.category_id) params.set('category_id', f.category_id);
      if (f.q) params.set('q', f.q);
      params.set('page', String(p));
      params.set('limit', '15');
      const d = await api.get(`/api/wiki/admin/pages?${params.toString()}`);
      setPages(d.pages || []);
      setTotal(d.total || 0);
      setTotalPages(d.totalPages || 1);
    } catch (e) {
      showToast(e.message || '加载页面失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, showToast]);

  /* ---------- 待审核 / 审核设置 ---------- */

  const loadPendingCount = useCallback(async () => {
    try {
      const d = await api.get('/api/wiki/submissions/pending-count');
      setPendingCount(d.count || 0);
    } catch (e) { /* 忽略 */ }
  }, []);

  const loadSubmissions = useCallback(async (status = subStatus) => {
    setLoading(true);
    try {
      const d = await api.get(`/api/wiki/submissions?status=${encodeURIComponent(status)}&limit=50`);
      setSubmissions(d.items || []);
      setTotal(d.total || 0);
    } catch (e) {
      showToast(e.message || '加载待审列表失败', 'error');
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, [subStatus, showToast]);

  const openSubmission = useCallback(async (id) => {
    try {
      const d = await api.get(`/api/wiki/submissions/${id}`);
      setSubDetail(d);
      setSubNote('');
      // 贡献点回赠：影子模式下不预填 AI 建议值（仍由管理员定分），只在旁边展示建议
      const aiPts = d?.submission?.auto?.reward?.points;
      const shadow = reviewCfgRef.current?.rewardShadow !== false;
      const max = reviewCfgRef.current?.rewardMax ?? 10;
      const preset = (!shadow && Number.isFinite(Number(aiPts))) ? Math.min(Number(aiPts), max) : 0;
      setSubPoints(String(preset));
    } catch (e) {
      showToast(e.message || '加载提交详情失败', 'error');
    }
  }, [showToast]);

  const review = async (action) => {
    if (!subDetail?.submission) return;
    const id = subDetail.submission.id;
    if (action === 'reject' && !subNote.trim()) return showToast('驳回请填写理由，便于提交人修改', 'error');
    setSubBusy(true);
    try {
      const body = { note: subNote.trim() };
      if (action === 'approve') {
        const pts = Math.max(0, Math.round(Number(subPoints) || 0));
        if (pts > 0) body.points = pts;
      }
      const d = await api.post(`/api/wiki/submissions/${id}/${action}`, body);
      showToast(d.message || (action === 'approve' ? '已通过' : '已驳回'), 'success');
      setSubDetail(null);
      await Promise.all([loadSubmissions(), loadPendingCount(), loadPages()]);
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      setSubBusy(false);
    }
  };

  /** 自动通过的投稿事后补发贡献点 */
  const grantReward = async () => {
    if (!subDetail?.submission) return;
    const id = subDetail.submission.id;
    const pts = Math.max(0, Math.round(Number(subPoints) || 0));
    if (pts <= 0) return showToast('请填写要补发的贡献点', 'error');
    setSubBusy(true);
    try {
      const d = await api.post(`/api/wiki/submissions/${id}/reward`, { points: pts });
      showToast(d.message || '已补发', 'success');
      setSubDetail(null);
      await Promise.all([loadSubmissions(), loadPendingCount()]);
    } catch (e) {
      showToast(e.message || '补发失败', 'error');
    } finally {
      setSubBusy(false);
    }
  };

  const loadReviewConfig = useCallback(async () => {
    try {
      const d = await api.get('/api/wiki/review-config');
      setReviewCfg(d.config);
      setCfgForm(d.config);
      setApiKeyInput('');
    } catch (e) {
      showToast(e.message || '加载审核配置失败', 'error');
    }
  }, [showToast]);

  const saveReviewConfig = async () => {
    if (!cfgForm) return;
    setSubBusy(true);
    try {
      const body = {
        enabled: cfgForm.enabled, autoApprove: cfgForm.autoApprove, autoReject: cfgForm.autoReject,
        approveThreshold: Number(cfgForm.approveThreshold), rejectThreshold: Number(cfgForm.rejectThreshold),
        maxPerDay: Number(cfgForm.maxPerDay), model: cfgForm.model, baseUrl: cfgForm.baseUrl,
        rewardEnabled: cfgForm.rewardEnabled !== false, rewardShadow: cfgForm.rewardShadow !== false,
        rewardMax: Number(cfgForm.rewardMax ?? 10), rewardDailyMax: Number(cfgForm.rewardDailyMax ?? 20)
      };
      if (apiKeyInput.trim()) body.apiKey = apiKeyInput.trim();
      const d = await api.put('/api/wiki/review-config', body);
      setReviewCfg(d.config); setCfgForm(d.config); setApiKeyInput('');
      showToast('审核配置已保存', 'success');
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    } finally {
      setSubBusy(false);
    }
  };

  const clearApiKey = async () => {
    if (!confirm('确定清空 GLM API Key？清空后自动审核会跳过，所有投稿转人工。')) return;
    setSubBusy(true);
    try {
      const d = await api.put('/api/wiki/review-config', { apiKey: null });
      setReviewCfg(d.config); setCfgForm(d.config);
      showToast('已清空 API Key', 'success');
    } catch (e) {
      showToast(e.message || '清空失败', 'error');
    } finally {
      setSubBusy(false);
    }
  };

  const testGlm = async () => {
    setSubBusy(true);
    try {
      const d = await api.post('/api/wiki/review-config/test', {});
      if (d.ok) showToast(`连通正常：${d.result.model} 判定 ${d.result.decision}（${d.result.ms}ms）`, 'success');
      else showToast(`测试失败：${d.result?.error || '未知错误'}`, 'error');
    } catch (e) {
      showToast(e.message || '测试失败', 'error');
    } finally {
      setSubBusy(false);
    }
  };

  useEffect(() => { loadCats(); }, [loadCats]);
  useEffect(() => { loadPendingCount(); }, [loadPendingCount]);
  useEffect(() => { reviewCfgRef.current = reviewCfg; }, [reviewCfg]);
  useEffect(() => { loadPages(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters, page]);
  useEffect(() => {
    if (tab === 'stats') api.get('/api/wiki/stats').then(d => setStats(d.stats)).catch(() => {});
    if (tab === 'history') api.get('/api/wiki/admin/revisions?limit=80').then(d => setRevisions(d.revisions || [])).catch(() => {});
    if (tab === 'review') { loadSubmissions(); if (!reviewCfg) loadReviewConfig(); }
    if (tab === 'review-config') loadReviewConfig();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  const publish = async (id) => {
    try {
      await api.post(`/api/wiki/${id}/publish`, {});
      showToast('已发布', 'success');
      loadPages();
    } catch (e) { showToast(e.message || '发布失败', 'error'); }
  };
  const archive = async (id) => {
    if (!confirm('归档后游客与搜索都看不到，确定？')) return;
    try {
      await api.post(`/api/wiki/${id}/archive`, {});
      showToast('已归档', 'success');
      loadPages();
    } catch (e) { showToast(e.message || '归档失败', 'error'); }
  };
  const restore = async (id) => {
    try {
      await api.post(`/api/wiki/${id}/restore`, { status: 'published' });
      showToast('已恢复并发布', 'success');
      loadPages();
    } catch (e) { showToast(e.message || '恢复失败', 'error'); }
  };
  const remove = async (id, title) => {
    if (!isSuper) return showToast('彻底删除需要超级管理员', 'error');
    if (!confirm(`彻底删除「${title}」？版本历史与内链一并删除。`)) return;
    try {
      await api.delete(`/api/wiki/${id}`);
      showToast('已彻底删除', 'success');
      loadPages();
    } catch (e) { showToast(e.message || '删除失败', 'error'); }
  };

  const saveCat = async () => {
    if (!catForm.name.trim()) return showToast('分类名称不能为空', 'error');
    try {
      const body = {
        name: catForm.name.trim(),
        parent_id: catForm.parent_id || null,
        slug: catForm.slug.trim() || undefined,
        description: catForm.description,
        icon: catForm.icon,
        sort_order: Number(catForm.sort_order) || 0
      };
      if (editingCat) await api.put(`/api/wiki/categories/${editingCat}`, body);
      else await api.post('/api/wiki/categories', body);
      showToast(editingCat ? '分类已更新' : '分类已创建', 'success');
      setCatForm({ name: '', parent_id: '', slug: '', description: '', sort_order: 0, icon: '' });
      setEditingCat(null);
      loadCats();
    } catch (e) { showToast(e.message || '保存分类失败', 'error'); }
  };

  const editCat = (c) => {
    setEditingCat(c.id);
    setCatForm({
      name: c.name, parent_id: c.parent_id || '', slug: c.slug,
      description: c.description || '', sort_order: c.sort_order || 0, icon: c.icon || ''
    });
  };

  const removeCat = async (c) => {
    if (!isSuper) return showToast('删除分类需要超级管理员', 'error');
    if (!confirm(`删除分类「${c.name}」？（有子分类或文章时会被拒绝）`)) return;
    try {
      await api.delete(`/api/wiki/categories/${c.id}`);
      showToast('分类已删除', 'success');
      loadCats();
    } catch (e) { showToast(e.message || '删除失败', 'error'); }
  };

  return (
    <div className="wiki-admin">
      <div className="wiki-section-head">
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>Wiki 知识库</h3>
        <Link to="/wiki/editor" className="btn btn-primary btn-sm">+ 新建页面</Link>
      </div>

      <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setTab(t.key);
              if (window.location.hash !== `#wiki/${t.key}`) window.history.replaceState(null, '', `#wiki/${t.key}`);
              if (t.key === 'drafts') { setFilters(f => ({ ...f, status: 'draft' })); setPage(1); }
            }}
          >
            {t.label}{t.key === 'review' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      {tab === 'review' && (
        <>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {[['pending', '待审核'], ['approved', '已通过'], ['rejected', '未通过'], ['all', '全部']].map(([k, label]) => (
              <button key={k} className={`btn btn-sm ${subStatus === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setSubStatus(k); setSubDetail(null); loadSubmissions(k); }}>{label}</button>
            ))}
            <span className="text-secondary" style={{ fontSize: 12.5, alignSelf: 'center' }}>
              共 {total} 条{subStatus === 'pending' && pendingCount !== total ? `（当前待审 ${pendingCount}）` : ''}
            </span>
          </div>

          {loading ? (
            <div className="text-secondary" style={{ fontSize: 13 }}>加载中…</div>
          ) : submissions.length === 0 ? (
            <div className="empty-state"><p>这里没有需要处理的投稿</p></div>
          ) : (
            <div className="flex-col" style={{ gap: 10 }}>
              {submissions.map(s => (
                <div key={s.id} className="wiki-admin-row">
                  <div className="war-main">
                    <b>{s.title}</b>
                    <span className={`badge ${s.status === 'pending' ? 'badge-warning' : s.status === 'approved' ? 'badge-success' : 'badge-danger'}`} style={{ marginLeft: 8 }}>
                      {s.status === 'pending' ? '待审核' : s.status === 'approved' ? '已通过' : '未通过'}
                    </span>
                    <div className="text-secondary" style={{ fontSize: 12.5, marginTop: 4 }}>
                      {s.kind === 'new' ? '新建页面' : `修改「${s.page_title || '页面'}」`} · 提交人 <b>{s.submitter_nickname || s.submitter_username || '—'}</b> · {formatDate(s.created_at, true)}
                      {s.category_name ? ` · 分类 ${s.category_name}` : ''} · 正文 {s.content_length || 0} 字
                    </div>
                    {s.auto && (
                      <div className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>
                        自动审核：
                        {s.auto.skipped ? `已跳过（${s.auto.skipped}）`
                          : s.auto.ok ? `${s.auto.decision === 'approve' ? '建议通过' : s.auto.decision === 'reject' ? '建议驳回' : '转人工'}（置信度 ${s.auto.score}${s.auto.categories?.length ? ' · ' + s.auto.categories.join('/') : ''}）${s.auto.reasons?.length ? '：' + s.auto.reasons.join('；') : ''}`
                            : `失败（${s.auto.error || '未知'}）`}
                      </div>
                    )}
                    {s.review_note && <div className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>审核意见：{s.review_note}</div>}
                    {s.status === 'approved' && (
                      <div className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>
                        回赠：{s.reward_points != null
                          ? `已发放 ${s.reward_points} 分`
                          : (s.auto?.reward ? `未发放（AI 建议 ${s.auto.reward.points} 分，可在详情里补发）` : '未发放')}
                      </div>
                    )}
                  </div>
                  <div className="flex" style={{ gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => openSubmission(s.id)}>查看/审核</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {subDetail && (
            <div className="card" style={{ padding: 16, marginTop: 16 }}>
              <div className="wiki-section-head">
                <h3 style={{ fontSize: 15 }}>审核：{subDetail.submission.title}</h3>
                <button className="btn btn-secondary btn-sm" onClick={() => setSubDetail(null)}>关闭</button>
              </div>
              <div className="text-secondary" style={{ fontSize: 12.5, marginBottom: 10 }}>
                {subDetail.submission.kind === 'new' ? '新建页面' : `修改「${subDetail.current?.title || ''}」`}
                {subDetail.auto_test_note}
              </div>

              {/* 待审内容 */}
              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13.5 }}>待审内容</div>
              <div className="wiki-content" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, maxHeight: 420, overflow: 'auto' }}
                dangerouslySetInnerHTML={{ __html: subDetail.submission.content }} />

              {/* 当前线上内容（修改类才有） */}
              {subDetail.current && (
                <>
                  <div style={{ margin: '14px 0 8px', fontWeight: 600, fontSize: 13.5 }}>当前线上内容（对比）</div>
                  <div className="wiki-content" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, maxHeight: 260, overflow: 'auto', opacity: .85 }}
                    dangerouslySetInnerHTML={{ __html: subDetail.current.content }} />
                </>
              )}

              <div className="form-group" style={{ marginTop: 14 }}>
                <label className="form-label">审核意见（驳回时必填，会通知提交人）</label>
                <textarea className="form-textarea" style={{ minHeight: 64 }} value={subNote} onChange={e => setSubNote(e.target.value)} placeholder="例如：数据来源不明，请补充出处" />
              </div>

              {/* 贡献点回赠：AI 只给建议，实际发放由这里的人决定 */}
              {reviewCfg?.rewardEnabled && (
                <div className="card" style={{ padding: 12, marginBottom: 12, background: 'var(--input-bg)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>贡献点回赠</div>
                  <div className="text-secondary" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                    AI 建议：{subDetail.submission.auto?.reward
                      ? `${subDetail.submission.auto.reward.points} 分（${subDetail.submission.auto.reward.reason || '无理由'}）`
                      : (subDetail.submission.auto?.skipped ? `未评估（${subDetail.submission.auto.skipped}）` : '未评估')}
                    {reviewCfg.rewardShadow ? '　·　当前是影子模式：建议值只作参考，不自动预填、不自动发放' : ''}
                    <br />
                    作者回赠情况：近 30 天 {subDetail.author_stats?.points30 ?? 0} 分 / {subDetail.author_stats?.times30 ?? 0} 次 · 今日 {subDetail.author_stats?.pointsToday ?? 0} 分
                    （每日上限 {reviewCfg.rewardDailyMax || '不限'}，单次上限 {reviewCfg.rewardMax}）· 全站近 30 天均分 {subDetail.author_stats?.siteAvg ?? 0}
                    {subDetail.reward ? `　·　本条已发放 ${subDetail.reward.points} 分` : ''}
                  </div>
                  <div className="flex" style={{ gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    <label className="form-label" style={{ margin: 0 }}>本次发放</label>
                    <input
                      className="form-input"
                      style={{ width: 96 }}
                      type="number" min="0" max={reviewCfg.rewardMax}
                      value={subPoints}
                      onChange={e => setSubPoints(e.target.value)}
                      disabled={subDetail.submission.status !== 'pending' && subDetail.submission.status !== 'approved'}
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSubPoints(String(Math.max(0, Math.round(Number(subDetail.submission.auto?.reward?.points) || 0))))}>
                      采用 AI 建议
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSubPoints('0')}>清零</button>
                    {subDetail.reward && <span className="text-secondary" style={{ fontSize: 12 }}>已发过后不会重复发放</span>}
                  </div>
                </div>
              )}

              <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" disabled={subBusy || subDetail.submission.status !== 'pending'} onClick={() => review('approve')}>通过并发布</button>
                <button className="btn btn-danger btn-sm" disabled={subBusy || subDetail.submission.status !== 'pending'} onClick={() => review('reject')}>驳回</button>
                {subDetail.submission.status === 'approved' && reviewCfg?.rewardEnabled && !subDetail.reward && (
                  <button className="btn btn-secondary btn-sm" disabled={subBusy} onClick={grantReward}>补发奖励</button>
                )}
                {subDetail.submission.status !== 'pending' && <span className="text-secondary" style={{ fontSize: 12.5, alignSelf: 'center' }}>该提交已处理过{subDetail.submission.status === 'approved' && !subDetail.reward ? '（可在此补发奖励）' : ''}</span>}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'review-config' && (
        <div className="card" style={{ padding: 16 }}>
          {!cfgForm ? (
            <div className="text-secondary" style={{ fontSize: 13 }}>加载中…</div>
          ) : (
            <>
              <p className="text-secondary" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                普通用户的投稿先进入待审队列，线上内容不变；管理员通过后才发布。<strong>所有管理员共用这一套配置</strong>，
                API Key 保存在服务端、接口不会回显明文。自动审核只在"未配置 Key / 调用失败 / 返回不可解析"时保守地转人工，<strong>绝不会因为报错而放行</strong>。
              </p>

              <div className="flex-col" style={{ gap: 12, marginTop: 12 }}>
                <label className="flex" style={{ gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" checked={!!cfgForm.enabled} onChange={e => setCfgForm(f => ({ ...f, enabled: e.target.checked }))} /> 启用 GLM 自动审核
                </label>
                <label className="flex" style={{ gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" checked={!!cfgForm.autoApprove} onChange={e => setCfgForm(f => ({ ...f, autoApprove: e.target.checked }))} /> 高置信且无违规时自动通过
                </label>
                <label className="flex" style={{ gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" checked={!!cfgForm.autoReject} onChange={e => setCfgForm(f => ({ ...f, autoReject: e.target.checked }))} /> 明确违规时自动驳回
                </label>
                <label className="flex" style={{ gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" checked={cfgForm.rewardEnabled !== false} onChange={e => setCfgForm(f => ({ ...f, rewardEnabled: e.target.checked }))} /> 审核通过时发放贡献点回赠
                </label>
                <label className="flex" style={{ gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" checked={cfgForm.rewardShadow !== false} onChange={e => setCfgForm(f => ({ ...f, rewardShadow: e.target.checked }))} /> 影子模式（AI 只给建议、审核台不预填，仍由管理员定分）
                </label>

                <div className="grid grid-2" style={{ gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">自动通过置信度阈值（0–1）</label>
                    <input className="form-input" type="number" step="0.05" min="0" max="1" value={cfgForm.approveThreshold}
                      onChange={e => setCfgForm(f => ({ ...f, approveThreshold: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">自动驳回置信度阈值（0–1）</label>
                    <input className="form-input" type="number" step="0.05" min="0" max="1" value={cfgForm.rejectThreshold}
                      onChange={e => setCfgForm(f => ({ ...f, rejectThreshold: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">模型名</label>
                    <input className="form-input" value={cfgForm.model} onChange={e => setCfgForm(f => ({ ...f, model: e.target.value }))} placeholder="glm-4-flash" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">每人每日提交上限（0 = 不限）</label>
                    <input className="form-input" type="number" min="0" value={cfgForm.maxPerDay}
                      onChange={e => setCfgForm(f => ({ ...f, maxPerDay: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">单次回赠上限（贡献点）</label>
                    <input className="form-input" type="number" min="0" value={cfgForm.rewardMax ?? 10}
                      onChange={e => setCfgForm(f => ({ ...f, rewardMax: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">同一作者每日回赠上限（0 = 不限）</label>
                    <input className="form-input" type="number" min="0" value={cfgForm.rewardDailyMax ?? 20}
                      onChange={e => setCfgForm(f => ({ ...f, rewardDailyMax: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                    <label className="form-label">API 地址</label>
                    <input className="form-input" value={cfgForm.baseUrl} onChange={e => setCfgForm(f => ({ ...f, baseUrl: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                    <label className="form-label">
                      GLM API Key
                      {reviewCfg?.apiKeyConfigured
                        ? <span className="text-secondary" style={{ fontWeight: 400, marginLeft: 8 }}>已配置（末四位 {reviewCfg.apiKeyTail}）</span>
                        : <span className="text-secondary" style={{ fontWeight: 400, marginLeft: 8 }}>未配置 → 自动审核会跳过，全部转人工</span>}
                    </label>
                    <div className="flex" style={{ gap: 8 }}>
                      <input className="form-input" type="password" value={apiKeyInput} autoComplete="new-password"
                        onChange={e => setApiKeyInput(e.target.value)} placeholder={reviewCfg?.apiKeyConfigured ? '留空 = 不修改' : '粘贴智谱 API Key'} />
                      {reviewCfg?.apiKeyConfigured && (
                        <button className="btn btn-secondary btn-sm" onClick={clearApiKey} disabled={subBusy}>清空</button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={saveReviewConfig} disabled={subBusy}>保存配置</button>
                <button className="btn btn-secondary btn-sm" onClick={testGlm} disabled={subBusy || !reviewCfg?.apiKeyConfigured}>测试连通</button>
                <span className="text-secondary" style={{ fontSize: 12.5, alignSelf: 'center' }}>prompt 版本：{reviewCfg?.promptVersion}</span>
              </div>
            </>
          )}
        </div>
      )}

      {(tab === 'pages' || tab === 'drafts') && (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="flex" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label className="form-label">搜索标题/摘要</label>
                <input className="form-input" value={filters.q} onChange={e => { setFilters(f => ({ ...f, q: e.target.value })); setPage(1); }} placeholder="关键词…" />
              </div>
              <div style={{ flex: '0 1 170px' }}>
                <label className="form-label">分类</label>
                <select className="form-select" value={filters.category_id} onChange={e => { setFilters(f => ({ ...f, category_id: e.target.value })); setPage(1); }}>
                  <option value="">全部分类</option>
                  {flatCats.map(c => <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.name}</option>)}
                </select>
              </div>
              <div style={{ flex: '0 1 150px' }}>
                <label className="form-label">状态</label>
                <select className="form-select" value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}>
                  <option value="all">全部</option>
                  <option value="published">已发布</option>
                  <option value="draft">草稿</option>
                  <option value="archived">已归档</option>
                </select>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => loadPages(filters, 1)}>刷新</button>
            </div>
          </div>

          {loading ? (
            <div className="loading"><div className="spinner" /></div>
          ) : pages.length === 0 ? (
            <div className="empty-state"><p>没有符合条件的页面</p></div>
          ) : (
            <>
              <div className="text-secondary" style={{ fontSize: 12.5, marginBottom: 8 }}>共 {total} 篇</div>
              {pages.map(p => (
                <div key={p.id} className="wiki-admin-row">
                  <div className="war-main">
                    <b>{p.is_pinned ? <><IconPin />{' '}</> : null}{p.is_featured ? <><IconStar />{' '}</> : null}{p.title}</b>
                    <div>
                      <span className={`badge ${p.status === 'published' ? 'badge-success' : p.status === 'draft' ? 'badge-warning' : 'badge-gray'}`}>{STATUS_LABEL[p.status] || p.status}</span>
                      <span style={{ marginLeft: 8 }}>{p.category_name || '未分类'} · {p.author_name || p.author_username || '—'} · 更新 {formatDate(p.updated_at, true)} · {p.views || 0} 阅读</span>
                    </div>
                  </div>
                  <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <Link to={`/wiki/${p.slug}`} className="btn btn-secondary btn-sm">查看</Link>
                    <Link to={`/wiki/editor/${p.id}`} className="btn btn-secondary btn-sm">编辑</Link>
                    <Link to={`/wiki/${p.slug}/history`} className="btn btn-secondary btn-sm">历史</Link>
                    {p.status !== 'published' && <button className="btn btn-primary btn-sm" onClick={() => publish(p.id)}>发布</button>}
                    {p.status === 'archived' && <button className="btn btn-secondary btn-sm" onClick={() => restore(p.id)}>恢复</button>}
                    {p.status !== 'archived' && <button className="btn btn-secondary btn-sm" onClick={() => archive(p.id)}>归档</button>}
                    {isSuper && <button className="btn btn-danger btn-sm" onClick={() => remove(p.id, p.title)}>删除</button>}
                  </div>
                </div>
              ))}
              {totalPages > 1 && (
                <div className="flex-center" style={{ gap: 8, marginTop: 14 }}>
                  <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
                  <span className="text-secondary" style={{ fontSize: 13 }}>第 {page} / {totalPages} 页</span>
                  <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'categories' && (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{editingCat ? '编辑分类' : '新增分类'}</div>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">名称 *</label>
                <input className="form-input" value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">父分类</label>
                <select className="form-select" value={catForm.parent_id} onChange={e => setCatForm(f => ({ ...f, parent_id: e.target.value }))}>
                  <option value="">（顶级分类）</option>
                  {flatCats.filter(c => c.id !== editingCat).map(c => <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">排序（小的在前）</label>
                <input type="number" className="form-input" value={catForm.sort_order} onChange={e => setCatForm(f => ({ ...f, sort_order: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">slug（留空自动拼音）</label>
                <input className="form-input" value={catForm.slug} onChange={e => setCatForm(f => ({ ...f, slug: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">图标（emoji 或短文本）</label>
                <input className="form-input" value={catForm.icon} onChange={e => setCatForm(f => ({ ...f, icon: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">描述</label>
                <input className="form-input" value={catForm.description} onChange={e => setCatForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="flex" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={saveCat}>{editingCat ? '保存修改' : '新增分类'}</button>
              {editingCat && <button className="btn btn-secondary btn-sm" onClick={() => { setEditingCat(null); setCatForm({ name: '', parent_id: '', slug: '', description: '', sort_order: 0, icon: '' }); }}>取消</button>}
            </div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>分类树（{flatCats.length}）</div>
            {flatCats.length === 0 ? <div className="text-secondary" style={{ fontSize: 13 }}>还没有分类</div> : flatCats.map(c => (
              <div key={c.id} className="wiki-admin-cat flex" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                <div className="wac-main">
                  <span style={{ marginLeft: c.depth * 16 }}>{c.icon ? `${c.icon} ` : ''}<b>{c.name}</b></span>
                  <span className="text-secondary" style={{ fontSize: 12, marginLeft: 8 }}>/wiki/category/{c.slug} · 排序 {c.sort_order} · {c.page_count || 0} 篇</span>
                </div>
                <div className="flex" style={{ gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => editCat(c)}>编辑</button>
                  {isSuper && <button className="btn btn-danger btn-sm" onClick={() => removeCat(c)}>删除</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>最近版本记录（{revisions.length}）</div>
          {revisions.length === 0 ? <div className="text-secondary" style={{ fontSize: 13 }}>暂无记录</div> : revisions.map(r => (
            <div key={r.id} className="wiki-admin-rev flex" style={{ justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <div className="war-main" style={{ minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{r.title}</b>
                <div className="text-secondary" style={{ fontSize: 12 }}>
                  版本 #{r.id} · {formatDate(r.created_at, true)} · {r.editor_name || r.editor_username || '—'}
                  {r.revision_note ? ` · ${r.revision_note}` : ''}
                </div>
              </div>
              <div className="flex" style={{ gap: 6 }}>
                {r.page_slug && <Link to={`/wiki/${r.page_slug}/history`} className="btn btn-secondary btn-sm">查看该页历史</Link>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'stats' && (
        <div className="wiki-stat-grid">
          {[
            ['总文章数', stats?.total], ['已发布', stats?.published], ['草稿', stats?.draft],
            ['已归档', stats?.archived], ['分类数', stats?.categories], ['总浏览量', stats?.totalViews],
            ['近 30 天更新', stats?.updated30], ['版本总数', stats?.revisions]
          ].map(([label, value]) => (
            <div key={label} className="wiki-stat">
              <b>{value ?? '—'}</b>
              <span>{label}</span>
            </div>
          ))}
          <div className="wiki-stat" style={{ gridColumn: '1 / -1', textAlign: 'left' }}>
            <span>全文索引（FTS5）：{stats?.fts ? '正常' : '不可用（已退回模糊搜索）'}</span>
            {stats?.editors?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <b style={{ fontSize: 13 }}>近 30 天活跃编辑者</b>
                <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {stats.editors.map(e => (
                    <span key={e.id} className="badge">{e.nickname || e.username} · {e.edits} 次</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
