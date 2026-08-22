import { useEffect, useState } from 'react';
import { api, uploadImages, uploadProjection } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { fmtPoints } from '../utils';
import LitematicViewer from '../components/LitematicViewer';
import { formatDate } from '../utils';

// 解析图片字段（JSON 数组或逗号分隔）
function parseImages(images) {
  if (!images) return [];
  try {
    const arr = JSON.parse(images);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return String(images).split(',').filter(Boolean);
  }
}

/**
 * 玩家任务板块：玩家发布悬赏任务（消耗贡献点），接取→线下向发布者获取验证码→提交核实→贡献点到账
 */
export default function PlayerTasks() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [view, setView] = useState('list'); // list 广场 | mine 我的
  const [tasks, setTasks] = useState([]);
  const [published, setPublished] = useState([]);
  const [accepted, setAccepted] = useState([]);
  const [loading, setLoading] = useState(true);

  // 发布表单
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [reward, setReward] = useState('');
  const [images, setImages] = useState([]);
  const [projection, setProjection] = useState('');
  const [projectionName, setProjectionName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewId, setPreviewId] = useState(null);

  // 完成核实
  const [completeTask, setCompleteTask] = useState(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      api.get('/api/player-tasks').then(d => d.tasks || []).catch(() => []),
      api.get('/api/player-tasks/mine').then(d => d).catch(() => ({ published: [], accepted: [] }))
    ]).then(([t, m]) => {
      setTasks(t);
      setPublished(m.published || []);
      setAccepted(m.accepted || []);
      setLoading(false);
    });
  };

  useEffect(() => { loadAll(); }, []);

  const publish = async () => {
    if (!title.trim()) { showToast('请输入任务标题', 'error'); return; }
    const rw = parseInt(reward);
    if (!rw || rw <= 0) { showToast('请输入正确的悬赏贡献点', 'error'); return; }
    setPublishing(true);
    try {
      const data = await api.post('/api/player-tasks', { title: title.trim(), description: desc.trim(), images, projection, reward: rw });
      showToast(`${data.message}，完成验证码：${data.code}`, 'success');
      setTitle(''); setDesc(''); setReward(''); setImages([]); setProjection(''); setProjectionName('');
      setShowForm(false);
      loadAll();
      setView('mine');
    } catch (e) {
      showToast(e.message || '发布失败', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleImages = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
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

  const handleProjUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.litematic')) {
      showToast('仅支持 .litematic 投影文件', 'error');
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const url = await uploadProjection(file);
      setProjection(url);
      setProjectionName(file.name);
      showToast('投影上传成功', 'success');
    } catch (err) {
      showToast(err.message || '投影上传失败', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const accept = async (id) => {
    try {
      await api.post(`/api/player-tasks/${id}/accept`, {});
      showToast('任务接取成功，请尽快完成并联系发布者获取验证码', 'success');
      loadAll();
    } catch (e) {
      showToast(e.message || '接取失败', 'error');
    }
  };

  const cancel = async (id) => {
    if (!confirm('确定取消该任务吗？悬赏贡献点将退回')) return;
    try {
      await api.post(`/api/player-tasks/${id}/cancel`, {});
      showToast('任务已取消，贡献点已退回', 'success');
      loadAll();
    } catch (e) {
      showToast(e.message || '取消失败', 'error');
    }
  };

  const submitComplete = async () => {
    if (!code.trim()) { showToast('请输入完成验证码', 'error'); return; }
    setSubmitting(true);
    try {
      const data = await api.post(`/api/player-tasks/${completeTask.id}/complete`, { code: code.trim() });
      showToast(`${data.message}（+${fmtPoints(data.reward)} 贡献点）`, 'success');
      setCompleteTask(null);
      setCode('');
      loadAll();
    } catch (e) {
      showToast(e.message || '提交失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />加载中...</div>;

  const taskActions = (t) => {
    if (t.status === 'completed') return <span className="badge badge-success">已完成</span>;
    if (t.status === 'cancelled') return <span className="badge badge-gray">已取消</span>;
    if (t.author_id === user?.id) return <span className="badge badge-primary">我的发布</span>;
    if (t.acceptor_id === user?.id) return <button className="btn btn-primary btn-sm" onClick={() => setCompleteTask(t)}>提交验证码</button>;
    if (t.acceptor_id) return <span className="badge badge-gray">已接取</span>;
    return <button className="btn btn-secondary btn-sm" onClick={() => accept(t.id)}>接取任务</button>;
  };

  return (
    <div>
      {/* 板块说明 */}
      <div className="card" style={{ padding: '14px 20px', marginBottom: 16, background: 'linear-gradient(135deg, rgba(0,74,173,0.06), rgba(0,102,204,0.04))' }}>
        <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>玩家任务</div>
            <div className="text-secondary" style={{ fontSize: 13 }}>
              由玩家发起：发布悬赏需扣除贡献点，接取后完成任务并找发布者获取验证码，提交核实后贡献点到账
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
            {showForm ? '收起发布' : '+ 发布悬赏任务'}
          </button>
        </div>

        {showForm && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="form-group">
              <label className="form-label">任务标题</label>
              <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="需要他人帮忙完成的事情" maxLength={60} />
            </div>
            <div className="form-group">
              <label className="form-label">任务描述</label>
              <textarea className="form-input" rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="详细说明任务内容、要求与交付方式" />
            </div>
            <div className="form-group">
              <label className="form-label">悬赏贡献点（从你的账户扣除，完成后转账给接取者）</label>
              <input className="form-input" type="number" min={1} value={reward} onChange={e => setReward(e.target.value)} placeholder="例如 10" />
            </div>
            <div className="form-group">
              <label className="form-label">任务描述图片（可选，最多3张）</label>
              <div className="flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleImages} id="pt-images" />
                <button className="btn btn-secondary btn-sm" disabled={uploading || images.length >= 3} onClick={() => document.getElementById('pt-images').click()}>
                  {uploading ? '上传中...' : '上传图片'}
                </button>
                {images.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                    <button
                      onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--danger)', color: '#fff', fontSize: 11, lineHeight: 1, cursor: 'pointer' }}
                    >×</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">建筑投影（.litematic，可选）</label>
              <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                <input type="file" accept=".litematic" style={{ display: 'none' }} onChange={handleProjUpload} id="pt-proj" />
                <button className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => document.getElementById('pt-proj').click()}>
                  {uploading ? '上传中...' : (projection ? '更换投影' : '上传投影')}
                </button>
                {projection && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {projectionName || '已上传投影'}
                    <button className="link-btn" style={{ marginLeft: 8 }} onClick={() => { setProjection(''); setProjectionName(''); }}>移除</button>
                  </span>
                )}
              </div>
            </div>
            <div className="flex" style={{ gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn btn-primary" disabled={publishing} onClick={publish}>
                {publishing ? '发布中...' : '发布并扣除贡献点'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 切换：广场 / 我的 */}
      <div className="flex" style={{ gap: 10, marginBottom: 16 }}>
        <button className={`btn ${view === 'list' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('list')}>任务广场</button>
        <button className={`btn ${view === 'mine' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('mine')}>我的任务</button>
      </div>

      {view === 'list' ? (
        tasks.length === 0 ? (
          <div className="empty-state"><p>暂无玩家任务，快来发布第一个悬赏吧</p></div>
        ) : (
          <div className="grid grid-3">
            {tasks.map(t => {
              const imgs = parseImages(t.images);
              return (
                <div key={t.id} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column' }}>
                  {imgs.length > 0 && (
                    <img src={imgs[0]} alt={t.title} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 12 }} />
                  )}
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{t.title}</h3>
                  <p className="text-secondary" style={{ fontSize: 13, marginBottom: 10, flex: 1, minHeight: 40, whiteSpace: 'pre-wrap' }}>{t.description || '暂无说明'}</p>
                  <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span className="badge badge-warning" style={{ fontSize: 13 }}>悬赏 {fmtPoints(t.reward)} 贡献点</span>
                    <span className="badge" style={{ fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-secondary)' }}>{t.status_text}</span>
                  </div>
                  <div className="text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>
                    发布者 {t.author_nickname || t.author_username} · {formatDate(t.created_at, false)}
                  </div>
                  {t.projection && (
                    <button className="btn btn-secondary btn-sm" style={{ marginBottom: 8 }} onClick={() => setPreviewId(prev => prev === t.id ? null : t.id)}>
                      {previewId === t.id ? '收起预览' : '预览投影'}
                    </button>
                  )}
                  {previewId === t.id && t.projection && (
                    <div style={{ marginBottom: 10 }}>
                      <LitematicViewer url={t.projection} height={240} />
                    </div>
                  )}
                  {taskActions(t)}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 我发布的 */}
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>我发布的</h3>
            {published.length === 0 ? (
              <div className="empty-state"><p>还没有发布过玩家任务</p></div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {published.map(t => (
                  <div key={t.id} className="flex" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 600 }}>{t.title}</div>
                      <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                        {t.status_text} · 悬赏 {fmtPoints(t.reward)} 贡献点
                        {t.acceptor_nickname ? ` · 接取者 ${t.acceptor_nickname}` : ''}
                        {t.status === 'accepted' && (
                          <span style={{ color: 'var(--primary)' }}> · 完成验证码：<code style={{ background: 'var(--input-bg)', padding: '1px 5px', borderRadius: 5 }}>{t.code}</code></span>
                        )}
                      </div>
                    </div>
                    <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                      <span className={`badge ${t.status === 'completed' ? 'badge-success' : t.status === 'cancelled' ? 'badge-gray' : 'badge-warning'}`}>{t.status_text}</span>
                      {t.status === 'open' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => cancel(t.id)}>取消</button>
                      )}
                      {t.status === 'accepted' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(t.code || ''); showToast('验证码已复制，请线下提供给接取者', 'success'); }}>
                          复制验证码
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 我接取的 */}
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>我接取的</h3>
            {accepted.length === 0 ? (
              <div className="empty-state"><p>还没有接取玩家任务</p></div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {accepted.map(t => (
                  <div key={t.id} className="flex" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 600 }}>{t.title}</div>
                      <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                        {t.status_text} · 发布者 {t.author_nickname || t.author_username} · 悬赏 {fmtPoints(t.reward)} 贡献点
                      </div>
                    </div>
                    <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                      <span className={`badge ${t.status === 'completed' ? 'badge-success' : 'badge-warning'}`}>{t.status_text}</span>
                      {t.status === 'accepted' && (
                        <button className="btn btn-primary btn-sm" onClick={() => setCompleteTask(t)}>提交验证码</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 完成核实弹窗 */}
      {completeTask && (
        <div className="modal-overlay" onClick={() => setCompleteTask(null)}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 6 }}>完成任务核实</h3>
            <p className="text-secondary" style={{ fontSize: 13, marginBottom: 16 }}>
              「{completeTask.title}」请在下方输入发布者提供的完成验证码，核实通过后悬赏贡献点将到账
            </p>
            <input
              className="form-input"
              placeholder="输入完成验证码"
              value={code}
              onChange={e => setCode(e.target.value)}
              autoFocus
            />
            <div className="flex" style={{ gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setCompleteTask(null); setCode(''); }}>取消</button>
              <button className="btn btn-primary" disabled={submitting} onClick={submitComplete}>
                {submitting ? '提交中...' : '确认完成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
