import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import LitematicViewer from '../components/LitematicViewer';
import { requireLogin, formatDate } from '../utils';
import PlayerTasks from './PlayerTasks';

export default function Tasks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [scope, setScope] = useState('official'); // official 官方任务 | player 玩家任务
  const [tab, setTab] = useState('list');
  const [tasks, setTasks] = useState([]);
  const [myClaims, setMyClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [completeTask, setCompleteTask] = useState(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [previewId, setPreviewId] = useState(null);

  useEffect(() => {
    if (!requireLogin(navigate)) return;
    loadAll();
  }, [navigate]);

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      api.get('/api/tasks').then(d => d.tasks || []).catch(() => []),
      api.get('/api/tasks/my/all').then(d => d.claims || []).catch(() => [])
    ]).then(([t, c]) => {
      setTasks(t);
      setMyClaims(c);
      setLoading(false);
    });
  };

  const claimTask = async (taskId) => {
    try {
      await api.post(`/api/tasks/${taskId}/claim`, {});
      showToast('任务接取成功', 'success');
      loadAll();
    } catch (e) {
      showToast(e.message || '接取失败', 'error');
    }
  };

  const submitComplete = async () => {
    if (!code.trim()) { showToast('请输入完成验证码', 'error'); return; }
    setSubmitting(true);
    try {
      const data = await api.post(`/api/tasks/${completeTask.id}/complete`, { code: code.trim() });
      showToast(`${data.message}（+${data.reward} 贡献点）`, 'success');
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

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/2.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>任务中心</h1>
          <p>完成任务，获取贡献点奖励</p>
        </div>
      </div>

      <div className="flex" style={{ gap: 10, marginBottom: 16 }}>
        <button className={`btn ${scope === 'official' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setScope('official')}>官方任务</button>
        <button className={`btn ${scope === 'player' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setScope('player')}>玩家任务</button>
      </div>

      {scope === 'player' ? (
        <PlayerTasks />
      ) : (
      <>
      <div className="flex" style={{ gap: 10, marginBottom: 20 }}>
        <button className={`btn ${tab === 'list' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('list')}>全部任务</button>
        <button className={`btn ${tab === 'mine' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('mine')}>我的任务</button>
      </div>

      {tab === 'list' ? (
        tasks.length === 0 ? (
          <div className="empty-state"><p>暂无任务</p></div>
        ) : (
          <div className="grid grid-3">
            {tasks.map(t => (
              <div key={t.id} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column' }}>
                {t.image && (
                  <img src={t.image} alt={t.title} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 12 }} />
                )}
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{t.title}</h3>
                <p className="text-secondary" style={{ fontSize: 13, marginBottom: 10, flex: 1, minHeight: 40 }}>{t.description || '暂无说明'}</p>
                <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span className="badge badge-warning" style={{ fontSize: 13 }}>奖励 {t.reward} 贡献点</span>
                  {user?.level >= 1 && t.code && (
                    <code style={{ background: 'var(--input-bg)', padding: '2px 6px', borderRadius: 6, fontSize: 12, color: 'var(--primary)' }}>{t.code}</code>
                  )}
                </div>
                <div className="text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>
                  发布者 {t.creator_nickname} · {formatDate(t.created_at, false)}
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
                {t.myStatus === 'completed' ? (
                  <span className="badge badge-success" style={{ alignSelf: 'center' }}>已完成</span>
                ) : t.myStatus === 'pending' ? (
                  <button className="btn btn-primary btn-sm" onClick={() => setCompleteTask(t)}>提交验证码</button>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => claimTask(t.id)}>接取任务</button>
                )}
              </div>
            ))}
          </div>
        )
      ) : myClaims.length === 0 ? (
        <div className="empty-state"><p>还没有接取任何任务</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {myClaims.map(c => (
            <div key={c.id} className="flex" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{c.title}</div>
                <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>接取于 {formatDate(c.created_at, false)}</div>
              </div>
              <span className="badge badge-warning" style={{ fontSize: 12 }}>+{c.reward}</span>
              {c.status === 'completed' ? (
                <span className="badge badge-success">已完成 {c.completed_at ? formatDate(c.completed_at, false) : ''}</span>
              ) : (
                <span className="badge badge-gray">进行中</span>
              )}
            </div>
          ))}
        </div>
      )}

      {completeTask && (
        <div className="modal-overlay" onClick={() => setCompleteTask(null)}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 6 }}>完成任务</h3>
            <p className="text-secondary" style={{ fontSize: 13, marginBottom: 16 }}>
              「{completeTask.title}」请在下方输入管理员提供的完成验证码
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
      </>
      )}
    </div>
  );
}
