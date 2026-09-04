import { useState, useCallback, useEffect } from 'react';
import { api } from '../api';
import SkinViewer from '../components/SkinViewer';
import { formatDate, fmtPoints } from '../utils';
import { exportArchivePdf, exportArchiveDocx, exportAllArchivesZip } from '../lib/gmirs-export';

// 档案展示用的类型标签（无子列时显示通用列名）
const TYPE_LABELS = {
  claim: '贡献点申报', task: '官方任务', player_task: '玩家任务',
  transfer_in: '贡献点转入', transfer_out: '贡献点转出',
  purchase: '贡献点消费', title: '称号购买', reward: '签到奖励',
  admin: '管理调整', discipline: '处分扣点', post: '发帖奖励', exchange: '外站兑换'
};
const GROUP_ORDER = ['task', 'player_task', 'claim', 'transfer_in', 'transfer_out', 'purchase', 'exchange', 'title', 'reward', 'discipline', 'post', 'admin'];

export default function Gmirs() {
  const [keyword, setKeyword] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [archive, setArchive] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const [exportLabel, setExportLabel] = useState('');

  // 验证码查伪
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyChecking, setVerifyChecking] = useState(false);

  const doQuery = useCallback(async (kw = keyword) => {
    const q = (kw || '').trim();
    if (!q) { setUsers([]); setSearched(false); return; }
    setLoading(true);
    try {
      const data = await api.get(`/api/gmirs/query?keyword=${encodeURIComponent(q)}`);
      setUsers(data.users || []);
      setSearched(true);
    } catch (e) {
      setUsers([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  const loadArchive = useCallback(async (id) => {
    if (!id) return;
    setSelectedId(id);
    setArchiveLoading(true);
    try {
      const data = await api.get(`/api/gmirs/user/${id}`);
      setArchive(data.archive || null);
    } catch (e) {
      setArchive(null);
    } finally {
      setArchiveLoading(false);
    }
  }, []);

  const doVerify = useCallback(async () => {
    const code = (verifyCode || '').trim();
    if (!code) { setVerifyResult(null); return; }
    setVerifyChecking(true);
    try {
      const data = await api.get(`/api/gmirs/verify?code=${encodeURIComponent(code)}${selectedId ? `&userId=${selectedId}` : ''}`);
      setVerifyResult(data);
    } catch (e) {
      setVerifyResult({ valid: false, error: e.message });
    } finally {
      setVerifyChecking(false);
    }
  }, [verifyCode, selectedId]);

  const doExport = async (type) => {
    if (!archive) return;
    setExporting(type);
    setExportProgress(0);
    setExportLabel(type === 'pdf' ? '正在生成 PDF…' : '正在生成 Word 文档…');
    try {
      if (type === 'pdf') await exportArchivePdf(archive, setExportProgress);
      else if (type === 'docx') await exportArchiveDocx(archive, setExportProgress);
    } catch (e) {
      alert(`导出失败：${e.message || e}`);
    } finally {
      setExporting('');
      setExportProgress(0);
      setExportLabel('');
    }
  };

  const doExportAll = async () => {
    setExporting('zip');
    setExportProgress(0);
    setExportLabel('正在获取成员档案数据…');
    try {
      const data = await api.get('/api/gmirs/export');
      const archives = data.archives || [];
      setExportLabel(archives.length ? '正在打包成员档案…' : '正在打包…');
      await exportAllArchivesZip(archives, setExportProgress);
    } catch (e) {
      alert(`批量导出失败：${e.message || e}`);
    } finally {
      setExporting('');
      setExportProgress(0);
      setExportLabel('');
    }
  };

  return (
    <div className="fade-in-up no-radius">
      <div className="page-banner" style={{ background: 'linear-gradient(135deg, #004AAD 0%, #0066cc 100%)' }}>
        <div className="page-banner-content">
          <h1 style={{ fontSize: 30 }}>玄剑公会成员档案信息查询管理系统</h1>
          <p style={{ letterSpacing: 1 }}>Xuanjian Guild Member Information Retrieval System · GMIRS</p>
        </div>
      </div>

      {/* 查询区 */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input
            className="form-input"
            style={{ flex: 1, minWidth: 220 }}
            placeholder="输入成员用户名/昵称/ID 查询档案"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doQuery()}
          />
          <button className="btn btn-primary" onClick={() => doQuery()} disabled={loading}>
            {loading ? '查询中...' : '查询'}
          </button>
          <button className="btn btn-secondary" onClick={doExportAll} disabled={exporting === 'zip'}>
            {exporting === 'zip' ? '打包中...' : '一键导出全部档案(ZIP)'}
          </button>
        </div>

        {/* 查伪区 */}
        <div className="flex" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="text-secondary" style={{ fontSize: 13 }}>验证码查伪：</span>
          <input
            className="form-input"
            style={{ flex: 1, maxWidth: 260 }}
            placeholder="如 XJ-XXXX-XXXX-XXXX"
            value={verifyCode}
            onChange={e => { setVerifyCode(e.target.value); setVerifyResult(null); }}
          />
          <button className="btn btn-secondary" onClick={doVerify} disabled={verifyChecking}>
            {verifyChecking ? '校验中...' : '校验'}
          </button>
          {verifyResult && (
            <span className="badge" style={{ fontSize: 13, background: verifyResult.valid ? 'rgba(40,167,69,0.15)' : 'rgba(220,53,69,0.15)', color: verifyResult.valid ? 'var(--success)' : 'var(--danger)' }}>
              {verifyResult.valid ? `✓ 有效档案（${verifyResult.user?.nickname || verifyResult.user?.username || '已匹配'}）` : (verifyResult.error || '✗ 无效验证码')}
            </span>
          )}
        </div>

        {searched && !loading && users.length === 0 && (
          <div className="empty-state" style={{ marginTop: 12 }}><p>未查询到相关成员</p></div>
        )}
      </div>

      {exporting && (
        <div className="card mb-4" style={{ padding: 14 }}>
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
            <span>{exportLabel}</span>
            <span className="text-secondary">{exportProgress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${exportProgress}%` }} />
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: selectedId && archive ? '280px 1fr' : '1fr', gap: 16, alignItems: 'start' }}>
        {/* 结果列表 */}
        {searched && users.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="flex-col" style={{ maxHeight: 560, overflowY: 'auto' }}>
              {users.map(u => (
                <button
                  key={u.id}
                  onClick={() => loadArchive(u.id)}
                  className="flex"
                  style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 12, alignItems: 'center', background: selectedId === u.id ? 'var(--primary-soft)' : 'transparent', textAlign: 'left', cursor: 'pointer', border: 'none', width: '100%' }}
                >
                  {u.avatar
                    ? <img src={u.avatar} alt="" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--input-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontWeight: 700, flexShrink: 0 }}>{(u.nickname || u.username || '?').slice(0, 1)}</div>}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nickname || u.username}</div>
                    <div className="text-secondary" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{u.username} · {fmtPoints(u.contribution)} 点</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 档案详情 */}
        <div>
          {archiveLoading && <div className="card loading" style={{ padding: 40 }}><div className="spinner" />加载档案...</div>}

          {!archiveLoading && selectedId && !archive && (
            <div className="card empty-state" style={{ padding: 40 }}><p>未找到该成员档案</p></div>
          )}

          {!archiveLoading && archive && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* 档案头 */}
              <div style={{ padding: 24, borderBottom: '1px solid var(--border)' }}>
                <div className="flex" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div className="flex" style={{ gap: 14, alignItems: 'center' }}>
                    {archive.user.avatar
                      ? <img src={archive.user.avatar} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
                      : <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--input-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 26, fontWeight: 700 }}>{(archive.user.nickname || archive.user.username || '?').slice(0, 1)}</div>}
                    <div>
                      <div style={{ fontSize: 21, fontWeight: 800 }}>{archive.user.nickname || archive.user.username}</div>
                      <div className="text-secondary" style={{ fontSize: 13, marginTop: 3 }}>用户ID：{archive.user.id}</div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {archive.user.generation && (
                          <span className="badge" style={{ background: `${archive.user.generation.color || 'var(--primary)'}22`, color: archive.user.generation.color || 'var(--primary)', border: `1px solid ${archive.user.generation.color || 'var(--primary)'}44` }}>
                            代系 · {archive.user.generation.name}
                          </span>
                        )}
                        {archive.user.is_frozen ? <span className="badge" style={{ background: 'rgba(220,53,69,0.15)', color: 'var(--danger)' }}>账号冻结</span> : null}
                      </div>
                    </div>
                  </div>
                  {/* 皮肤渲染（站长立渲染） */}
                  <div style={{ marginLeft: 'auto', textAlign: 'center' }}>
                    <div className="text-secondary" style={{ fontSize: 11, marginBottom: 4 }}>用户皮肤图（动态渲染）</div>
                    <SkinViewer
                      skin={archive.user.skin_path || undefined}
                      width={120}
                      height={160}
                      zoom={1.1}
                      autoRotate
                      style={{ background: 'linear-gradient(180deg,#eaf4ff,#dff0d8)', borderRadius: 8 }}
                    />
                  </div>
                </div>

                {/* 基本信息 */}
                <div className="grid grid-2" style={{ gap: 8, marginTop: 20 }}>
                  {[
                    ['游戏ID', archive.user.game_id || '—'],
                    ['注册时间', formatDate(archive.user.created_at, false)],
                    ['绑定邮箱', archive.user.email || '未绑定'],
                    ['贡献点余额', `${fmtPoints(archive.user.contribution)} 点`]
                  ].map(([k, v]) => (
                    <div key={k} className="flex" style={{ justifyContent: 'space-between', padding: '9px 12px', background: 'var(--input-bg)', borderRadius: 8, fontSize: 13 }}>
                      <span className="text-secondary">{k}</span>
                      <b>{v}</b>
                    </div>
                  ))}
                </div>

                <div className="flex" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => doExport('pdf')} disabled={!!exporting}>
                      {exporting === 'pdf' ? '导出中...' : '导出 PDF'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => doExport('docx')} disabled={!!exporting}>
                      {exporting === 'docx' ? '导出中...' : '导出 Word(DOCX)'}
                    </button>
                  </div>
                  <span className="text-secondary" style={{ fontSize: 12 }}>验证码：<code style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>{archive.verify_code}</code></span>
                </div>
              </div>

              {/* 处分记录 */}
              <div style={{ padding: 24, borderBottom: '1px solid var(--border)' }}>
                <h3 className="panel-title">处分记录</h3>
                {archive.discipline.length ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th>日期</th>
                          <th>处分等级</th>
                          <th>处分原因</th>
                          <th>附加惩罚</th>
                          <th>扣点</th>
                          <th>处分人</th>
                          <th>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {archive.discipline.map(d => (
                          <tr key={d.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatDate(d.created_at, false)}</td>
                            <td><span className="badge" style={{ background: 'rgba(220,53,69,0.15)', color: 'var(--danger)' }}>{d.level_text}</span></td>
                            <td>{d.reason}</td>
                            <td>{d.extra_penalty || '—'}</td>
                            <td>{d.deduct_points > 0 ? `-${d.deduct_points}` : '—'}</td>
                            <td>{d.admin_name || '系统'}</td>
                            <td>{d.is_active ? <span className="badge" style={{ background: 'rgba(220,53,69,0.15)', color: 'var(--danger)' }}>生效中</span> : <span className="badge" style={{ background: 'rgba(23,162,184,0.15)', color: 'var(--info)' }}>已撤销</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: 16 }}><p>暂无处分记录</p></div>
                )}
              </div>

              {/* 贡献点明细（按类型分区段） */}
              <div style={{ padding: 24 }}>
                <h3 className="panel-title">贡献点明细</h3>
                {sortGroups(archive.contribution?.groups).length === 0 ? (
                  <div className="empty-state" style={{ padding: 16 }}><p>暂无贡献点流水</p></div>
                ) : (
                  sortGroups(archive.contribution?.groups).map(g => (
                    <div key={g.type} style={{ marginBottom: 20 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--primary)' }}>{g.type_label || TYPE_LABELS[g.type] || g.type}</h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="table" style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              {groupColumns(g.type).map(c => <th key={c.key}>{c.header}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {g.items.map(it => (
                              <tr key={it.id}>
                                {groupColumns(g.type).map(c => (
                                  <td key={c.key}>
                                    {c.key === '__type__' ? (g.type_label || TYPE_LABELS[g.type] || g.type)
                                      : c.key === 'amount' ? <span style={{ color: (it.amount ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{(it.amount ?? 0) >= 0 ? '+' : ''}{fmtPoints(it.amount)}</span>
                                      : c.key === 'created_at' ? formatDate(it.created_at, false)
                                      : c.key === 'detail' ? (it.detail || it.note || '—')
                                      : c.key === 'reply' ? (it.reply || '—')
                                      : (it[c.key] || '—')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 分组排序（与后端 GROUP_ORDER 对齐）
function sortGroups(groups) {
  if (!groups || !groups.length) return [];
  const ordered = [];
  GROUP_ORDER.forEach(t => { const g = groups.find(x => x.type === t); if (g) ordered.push(g); });
  groups.forEach(g => { if (!GROUP_ORDER.includes(g.type)) ordered.push(g); });
  return ordered;
}

// 每种类型表头子列（与 gmirs-export 对齐）
function groupColumns(type) {
  if (type === 'task') return [
    { header: '官方/玩家任务', key: '__type__' },
    { header: '任务内容', key: 'detail' },
    { header: '给予点数', key: 'amount' },
    { header: '日期', key: 'created_at' }
  ];
  if (type === 'claim') return [
    { header: '申报内容', key: 'detail' },
    { header: '管理回复内容', key: 'reply' },
    { header: '给予点数', key: 'amount' },
    { header: '日期', key: 'created_at' }
  ];
  if (type === 'player_task') return [
    { header: '任务内容', key: 'detail' },
    { header: '给予点数', key: 'amount' },
    { header: '日期', key: 'created_at' }
  ];
  return [
    { header: '内容/说明', key: 'detail' },
    { header: '数量', key: 'amount' },
    { header: '日期', key: 'created_at' }
  ];
}
