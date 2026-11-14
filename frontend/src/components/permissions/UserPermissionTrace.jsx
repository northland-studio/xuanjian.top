/**
 * 用户权限溯源（用户详情页）：Level / 角色 / 最终有效权限 / 每项权限来源 / 失效原因
 *
 * 双向成员管理的“用户侧”：权限管理员可在此为用户分配/移除角色（复用同一后端服务）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { hasAnyPermission, isPermissionAdmin } from './usePermissions';
import './permissions.css';

const STATUS_LABEL = { ACTIVE: '启用', DISABLED: '禁用', ARCHIVED: '归档' };
const REASON_LABEL = {
  account_frozen: '账号已冻结/封禁：所有权限立即失效（角色关系保留）',
  system_account: '系统账号不参与用户权限体系',
  role_disabled: '角色已禁用，不参与权限计算',
  role_archived: '角色已归档，不参与权限计算',
  permission_disabled: '权限定义已停用，不参与权限计算',
  no_grant: '没有任何 Level 基础权限或 ACTIVE 角色授予该权限',
  unknown_permission: '权限未在代码注册表中注册'
};

function fmtDate(s) {
  return s ? String(s).replace('T', ' ').slice(0, 19) : '-';
}

export default function UserPermissionTrace({ userId, onClose, showToast }) {
  const { user } = useAuth();
  const [trace, setTrace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roles, setRoles] = useState([]);
  const [roleIds, setRoleIds] = useState([]);
  const [savingRoles, setSavingRoles] = useState(false);
  const [roleResults, setRoleResults] = useState(null);

  const canManage = isPermissionAdmin(user) || hasAnyPermission(user, ['admin.permissions.manage']);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const d = await api.get(`/api/permissions/users/${userId}/permissions`);
      setTrace(d.trace);
      const roleList = await api.get('/api/permissions/roles?limit=100');
      setRoles(roleList.items || []);
      const mine = await api.get(`/api/permissions/users/${userId}/roles`);
      setRoleIds((mine.roles || []).map(r => r.id));
    } catch (e) {
      setError(e.message || '加载用户权限失败');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const out = {};
    for (const p of (trace?.effectivePermissions || [])) {
      if (!out[p.module]) out[p.module] = [];
      out[p.module].push(p);
    }
    return out;
  }, [trace]);

  const saveRoles = async () => {
    if (!window.confirm('确定保存该用户的角色配置？\n（变更将在下一次请求立即生效）')) return;
    setSavingRoles(true);
    setRoleResults(null);
    try {
      const d = await api.put(`/api/permissions/users/${userId}/roles`, { role_ids: roleIds });
      setRoleResults(d);
      showToast(`角色配置已保存：成功 ${d.successCount}，失败 ${d.failCount}`, d.failCount ? 'error' : 'success');
      await load();
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    } finally {
      setSavingRoles(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div className="modal-header">
          <h3 className="modal-title">用户权限溯源</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '72vh', overflow: 'auto' }}>
          {loading ? (
            <div className="loading"><div className="spinner" /></div>
          ) : error ? (
            <p className="adm-empty">{error}</p>
          ) : !trace ? null : (
            <div className="perm-trace-grid">
              <div className="adm-card" style={{ padding: 12 }}>
                <div className="perm-row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{trace.user.nickname || trace.user.username}</strong>
                    <span className="text-secondary" style={{ marginLeft: 8, fontSize: 12 }}>@{trace.user.username} · ID {trace.user.id}</span>
                  </div>
                  <div className="perm-row">
                    <span className="perm-tag">Level {trace.user.level} · {trace.user.levelLabel}</span>
                    {trace.user.frozen && <span className="perm-tag disabled">已冻结</span>}
                    <span className={`perm-tag ${trace.economy.access ? 'active' : 'archived'}`}>
                      经济资格：{trace.economy.access ? '有' : '无'}
                    </span>
                  </div>
                </div>
                <div className="perm-role-meta" style={{ marginTop: 6 }}>
                  <span>Level 基础权限：{trace.level.basePermissions[0] === '*' ? '全部权限' : `${trace.level.basePermissions.length} 项（${trace.level.label}）`}</span>
                  <span>有效权限总数：{trace.summary.effectivePermissionCount}</span>
                  <span>角色：{trace.summary.roleCount}（生效 {trace.summary.activeRoleCount}）</span>
                </div>
              </div>

              <div className="adm-card" style={{ padding: 12 }}>
                <div className="adm-card-title" style={{ fontSize: 13 }}>角色列表（含状态）</div>
                {trace.roles.length === 0 ? <p className="adm-empty">该用户没有任何角色</p> : (
                  <div className="adm-table-wrap">
                    <table className="adm-table">
                      <thead><tr><th>角色</th><th>作用域</th><th>状态</th><th>权限数</th><th>加入时间</th></tr></thead>
                      <tbody>
                        {trace.roles.map(r => (
                          <tr key={r.id}>
                            <td>{r.name}{r.type === 'system' ? '（系统）' : ''}</td>
                            <td>{r.scope === 'global' ? '全局' : `模块·${r.module || '-'}`}</td>
                            <td>
                              <span className={`perm-tag ${r.status.toLowerCase()}`}>{STATUS_LABEL[r.status]}</span>
                              {r.status !== 'ACTIVE' && <span className="adm-hint" style={{ marginLeft: 6 }}>不参与权限计算</span>}
                            </td>
                            <td>{r.permissions.length}</td>
                            <td>{fmtDate(r.joinedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="adm-card" style={{ padding: 12 }}>
                <div className="adm-card-title" style={{ fontSize: 13 }}>最终有效权限（含来源）</div>
                {Object.keys(grouped).length === 0 ? <p className="adm-empty">该用户当前没有任何有效权限</p> : (
                  Object.entries(grouped).map(([mod, list]) => (
                    <div key={mod} className="perm-module-block">
                      <div className="perm-module-title"><span>{mod}</span><span className="perm-tag">{list.length} 项</span></div>
                      {list.map(p => (
                        <div key={p.key} className="perm-trace-perm">
                          <span>
                            <span className="adm-mono" style={{ fontSize: 12 }}>{p.key}</span>
                            {p.protected && <span className="perm-tag protected" style={{ marginLeft: 6 }}>核心</span>}
                          </span>
                          <span className="perm-trace-src">{p.description}</span>
                          <span className="perm-trace-src">来源：{p.sources.map(s => s.label).join('、')}</span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>

              {trace.reasons.length > 0 && (
                <div className="adm-card" style={{ padding: 12 }}>
                  <div className="adm-card-title" style={{ fontSize: 13 }}>失效原因（为什么没有某项权限）</div>
                  {trace.reasons.slice(0, 40).map((r, i) => (
                    <div key={i} className="perm-reason" style={{ marginBottom: 6 }}>
                      <span className="adm-mono">{r.permission}</span> — {REASON_LABEL[r.reason] || r.reason}
                      {r.detail ? `（${r.detail}）` : ''}
                    </div>
                  ))}
                </div>
              )}

              {canManage && (
                <div className="adm-card" style={{ padding: 12 }}>
                  <div className="adm-card-title" style={{ fontSize: 13 }}>分配 / 移除角色（用户侧）</div>
                  <div className="perm-role-list" style={{ maxHeight: 260 }}>
                    {roles.map(r => (
                      <label key={r.id} className={`perm-check ${r.status !== 'ACTIVE' ? 'disabled' : ''}`}>
                        <input
                          type="checkbox"
                          checked={roleIds.includes(r.id)}
                          disabled={r.status !== 'ACTIVE'}
                          onChange={() => setRoleIds(prev => prev.includes(r.id) ? prev.filter(x => x !== r.id) : [...prev, r.id])}
                        />
                        <span>
                          {r.name}
                          <span className={`perm-tag ${r.status.toLowerCase()}`} style={{ marginLeft: 6 }}>{STATUS_LABEL[r.status]}</span>
                          <span className="perm-tag" style={{ marginLeft: 6 }}>{r.scope === 'global' ? '全局' : `模块·${r.module}`}</span>
                          <span className="adm-hint" style={{ marginLeft: 6 }}>{r.permissionCount} 权限</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="perm-row" style={{ marginTop: 8 }}>
                    <button className="btn btn-primary btn-sm" disabled={savingRoles} onClick={saveRoles}>
                      {savingRoles ? '保存中…' : '保存角色配置'}
                    </button>
                    <span className="adm-hint">只做角色分配；不存在单用户直接授权。</span>
                  </div>
                  {roleResults && (
                    <div className="perm-result-list">
                      {roleResults.results.map((r, i) => (
                        <div key={i} className={r.ok ? 'perm-result-ok' : 'perm-result-fail'}>
                          角色 #{r.roleId}（{r.action === 'add' ? '添加' : '移除'}）：{r.ok ? '成功' : `${r.error}（${r.code}）`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
