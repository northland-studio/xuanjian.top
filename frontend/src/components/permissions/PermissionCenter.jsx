/**
 * 权限中心（并入现有 /admin，不新建独立后台）
 *
 * 功能：角色列表/详情、权限编辑、成员双向管理（角色侧）、模板复制、状态管理、审计日志。
 * 说明：所有写操作都会在下一次后端请求立即生效（后端无权限缓存）；前端只做体验层。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../UI';
import './permissions.css';

const STATUS_LABEL = { ACTIVE: '启用', DISABLED: '禁用', ARCHIVED: '归档' };
const SCOPE_LABEL = { global: '全局', module: '模块' };

function fmtDate(s) {
  if (!s) return '-';
  return String(s).replace('T', ' ').slice(0, 19);
}

/** 轻量弹窗（复用全站 modal 样式） */
function ModalBox({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export default function PermissionCenter() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const isSuper = Number(user?.level) >= 2;
  const [innerTab, setInnerTab] = useState('roles');
  const [registry, setRegistry] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleTotal, setRoleTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTemplate, setCreateTemplate] = useState('');

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (scopeFilter) params.set('scope', scopeFilter);
      const d = await api.get(`/api/permissions/roles?${params}`);
      setRoles(d.items || []);
      setRoleTotal(d.total || 0);
    } catch (e) {
      showToast(e.message || '加载角色失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, scopeFilter, showToast]);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    try {
      const d = await api.get(`/api/permissions/roles/${id}`);
      setDetail(d.role);
    } catch (e) {
      showToast(e.message || '加载角色详情失败', 'error');
      setDetail(null);
    }
  }, [showToast]);

  useEffect(() => {
    (async () => {
      try {
        const [reg, tpl] = await Promise.all([
          api.get('/api/permissions/registry'),
          api.get('/api/permissions/templates')
        ]);
        setRegistry(reg);
        setTemplates(tpl.templates || []);
      } catch (e) {
        showToast(e.message || '加载权限注册表失败', 'error');
      }
    })();
  }, [showToast]);

  useEffect(() => { loadRoles(); }, [loadRoles]);
  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

  const refreshAll = useCallback(async () => {
    await loadRoles();
    if (selectedId) await loadDetail(selectedId);
  }, [loadRoles, loadDetail, selectedId]);

  const modules = registry?.modules || {};

  return (
    <div className="adm-page">
      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <div className="adm-card-title">权限中心</div>
            <p className="adm-card-desc" style={{ margin: 0 }}>
              三层模型：Level 基础权限 ∪ 多角色权限（并集，无继承）∪ 代码注册的细粒度权限。
              所有变更在下一次后端请求立即生效；不支持、也不存在任何单用户直接授权。
            </p>
          </div>
          <div className="adm-toolbar-right">
            <button className="btn btn-secondary btn-sm" onClick={refreshAll}>刷新</button>
            <button className="btn btn-primary btn-sm" onClick={() => { setCreateTemplate(''); setCreateOpen(true); }}>新建角色</button>
          </div>
        </div>

        <div className="adm-tabs">
          {[
            ['roles', `角色（${roleTotal}）`],
            ['templates', `系统模板（${templates.length}）`],
            ['audit', '审计日志']
          ].map(([k, label]) => (
            <button key={k} className={`adm-tab ${innerTab === k ? 'active' : ''}`} onClick={() => setInnerTab(k)}>{label}</button>
          ))}
        </div>
      </div>

      {innerTab === 'roles' && (
        <div className="perm-layout">
          <div className="adm-card">
            <div className="perm-row" style={{ marginBottom: 10 }}>
              <input
                className="adm-input"
                style={{ flex: 1 }}
                placeholder="搜索角色名 / 描述"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadRoles(); }}
              />
              <button className="btn btn-secondary btn-sm" onClick={loadRoles}>搜索</button>
            </div>
            <div className="perm-row" style={{ marginBottom: 10 }}>
              <select className="adm-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">全部状态</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="adm-input" value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}>
                <option value="">全部作用域</option>
                <option value="global">全局角色</option>
                <option value="module">模块角色</option>
              </select>
            </div>
            {loading ? (
              <div className="loading"><div className="spinner" /></div>
            ) : roles.length === 0 ? (
              <p className="adm-empty">没有匹配的角色</p>
            ) : (
              <div className="perm-role-list">
                {roles.map(r => (
                  <div
                    key={r.id}
                    className={`perm-role-item ${selectedId === r.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <div className="perm-role-item-head">
                      <span className="perm-role-name">{r.name}</span>
                      <span className={`perm-tag ${r.status.toLowerCase()}`}>{STATUS_LABEL[r.status]}</span>
                    </div>
                    <div className="perm-role-meta">
                      <span className="perm-tag">{SCOPE_LABEL[r.scope]}{r.module ? `·${modules[r.module] || r.module}` : ''}</span>
                      <span className={`perm-tag ${r.isSystem ? 'system' : ''}`}>{r.isSystem ? '系统角色' : '自定义'}</span>
                      <span>{r.permissionCount} 权限 / {r.memberCount} 成员</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="adm-card">
            {!detail ? (
              <p className="adm-empty">从左侧选择一个角色查看详情</p>
            ) : (
              <RoleDetail
                key={detail.id}
                role={detail}
                registry={registry}
                modules={modules}
                isSuper={isSuper}
                onChanged={refreshAll}
                showToast={showToast}
              />
            )}
          </div>
        </div>
      )}

      {innerTab === 'templates' && (
        <div className="adm-card">
          <div className="adm-card-title">系统角色模板</div>
          <p className="adm-card-desc">模板可复制为自定义角色，复制后与模板完全独立（不再跟随模板变化）。</p>
          <div className="adm-grid">
            {templates.map(t => (
              <div key={t.key} className="adm-card" style={{ padding: 14 }}>
                <div className="perm-row" style={{ justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13.5 }}>{t.name}</strong>
                  <span className="perm-tag system">系统模板</span>
                </div>
                <p className="adm-card-desc" style={{ margin: '6px 0' }}>
                  {t.description}（{SCOPE_LABEL[t.scope]}{t.module ? `·${modules[t.module] || t.module}` : ''}，{t.permissions.length} 项权限）
                </p>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setCreateTemplate(t.key); setCreateOpen(true); }}
                >
                  复制为自定义角色 →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {innerTab === 'audit' && <AuditLog showToast={showToast} />}

      <CreateRoleModal
        open={createOpen}
        initialTemplate={createTemplate}
        onClose={() => { setCreateOpen(false); setCreateTemplate(''); }}
        registry={registry}
        templates={templates}
        modules={modules}
        isSuper={isSuper}
        showToast={showToast}
        onCreated={async (role) => {
          setCreateOpen(false);
          setCreateTemplate('');
          await loadRoles();
          if (role && role.id) setSelectedId(role.id);
        }}
      />
    </div>
  );
}

/* ================= 角色详情 ================= */
function RoleDetail({ role, registry, modules, isSuper, onChanged, showToast }) {
  const [tab, setTab] = useState('permissions');
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description || '');
  const [savingInfo, setSavingInfo] = useState(false);
  const readOnly = role.isSystem && !isSuper;

  const changeStatus = async (status) => {
    const ok = window.confirm(
      `确定将角色「${role.name}」${status === 'ACTIVE' ? '恢复/启用' : status === 'DISABLED' ? '禁用' : '归档'}？\n（高风险操作，变更将在下一次请求立即生效）`
    );
    if (!ok) return;
    try {
      await api.post(`/api/permissions/roles/${role.id}/status`, { status });
      showToast(`角色状态已更新为 ${STATUS_LABEL[status]}`, 'success');
      onChanged();
    } catch (e) {
      showToast(e.message || '状态更新失败', 'error');
    }
  };

  const saveInfo = async () => {
    setSavingInfo(true);
    try {
      await api.put(`/api/permissions/roles/${role.id}`, { name: name.trim(), description: description.trim() });
      showToast('角色信息已更新', 'success');
      onChanged();
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    } finally {
      setSavingInfo(false);
    }
  };

  return (
    <div>
      <div className="perm-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <div className="adm-card-title" style={{ marginBottom: 4 }}>{role.name}</div>
          <div className="perm-role-meta">
            <span className={`perm-tag ${role.status.toLowerCase()}`}>{STATUS_LABEL[role.status]}</span>
            <span className="perm-tag">{SCOPE_LABEL[role.scope]}{role.module ? `·${modules[role.module] || role.module}` : ''}</span>
            <span className={`perm-tag ${role.isSystem ? 'system' : ''}`}>{role.isSystem ? '系统角色（受保护）' : '自定义角色'}</span>
            <span>创建 {fmtDate(role.createdAt)}</span>
            <span>更新 {fmtDate(role.updatedAt)}</span>
          </div>
        </div>
        <div className="perm-row">
          {role.status !== 'ACTIVE' && (
            <button className="btn btn-secondary btn-sm" onClick={() => changeStatus('ACTIVE')}>恢复 / 启用</button>
          )}
          {role.status === 'ACTIVE' && (
            <button className="btn btn-secondary btn-sm" onClick={() => changeStatus('DISABLED')}>禁用</button>
          )}
          {role.status !== 'ARCHIVED' && (
            <button className="btn btn-secondary btn-sm" onClick={() => changeStatus('ARCHIVED')}>归档</button>
          )}
        </div>
      </div>

      <div className="adm-tabs" style={{ marginTop: 10 }}>
        <button className={`adm-tab ${tab === 'permissions' ? 'active' : ''}`} onClick={() => setTab('permissions')}>权限配置</button>
        <button className={`adm-tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>成员管理</button>
        <button className={`adm-tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>基本信息</button>
      </div>

      {tab === 'permissions' && (
        <PermissionEditor key={role.id} role={role} registry={registry} modules={modules} isSuper={isSuper} onChanged={onChanged} showToast={showToast} />
      )}
      {tab === 'members' && <RoleMembers key={role.id} role={role} onChanged={onChanged} showToast={showToast} />}
      {tab === 'info' && (
        <div className="adm-form-grid" style={{ marginTop: 12 }}>
          <div className="adm-field">
            <label className="adm-label">角色名称</label>
            <input className="adm-input" value={name} onChange={e => setName(e.target.value)} disabled={readOnly} />
          </div>
          <div className="adm-field">
            <label className="adm-label">描述</label>
            <input className="adm-input" value={description} onChange={e => setDescription(e.target.value)} disabled={readOnly} />
          </div>
          <div className="adm-field">
            <button className="btn btn-primary btn-sm" disabled={readOnly || savingInfo} onClick={saveInfo}>
              {savingInfo ? '保存中…' : '保存'}
            </button>
            {readOnly && <span className="adm-hint" style={{ marginLeft: 10 }}>系统角色仅超级管理员可修改</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= 权限编辑器 ================= */
function PermissionEditor({ role, registry, modules, isSuper, onChanged, showToast }) {
  const [selected, setSelected] = useState(() => new Set(role.permissionKeys || []));
  const [saving, setSaving] = useState(false);
  const readOnly = role.isSystem && !isSuper;
  const archived = role.status === 'ARCHIVED';

  const grouped = useMemo(() => {
    const out = {};
    for (const p of (registry?.permissions || [])) {
      if (!out[p.module]) out[p.module] = [];
      out[p.module].push(p);
    }
    return out;
  }, [registry]);

  const toggle = (key) => {
    if (readOnly || archived) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async () => {
    const keys = [...selected];
    const added = keys.filter(k => !(role.permissionKeys || []).includes(k));
    const removed = (role.permissionKeys || []).filter(k => !selected.has(k));
    const ok = window.confirm(
      `确定保存角色「${role.name}」的权限？\n新增 ${added.length} 项，移除 ${removed.length} 项。\n（高风险操作，下一次请求立即生效）`
    );
    if (!ok) return;
    setSaving(true);
    try {
      await api.put(`/api/permissions/roles/${role.id}/permissions`, { permissions: keys });
      showToast('角色权限已保存，下一次请求立即生效', 'success');
      onChanged();
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      {readOnly && <div className="adm-alert" style={{ marginBottom: 10 }}>系统角色的权限只能由超级管理员修改。</div>}
      {archived && <div className="adm-warn" style={{ marginBottom: 10 }}>角色已归档：请先恢复再修改权限。</div>}
      {Object.entries(grouped).map(([mod, list]) => {
        if (role.scope === 'module' && mod !== role.module) return null;
        const activeCount = list.filter(p => selected.has(p.key)).length;
        return (
          <div key={mod} className="perm-module-block">
            <div className="perm-module-title">
              <span>{modules[mod] || mod}</span>
              <span className="perm-tag">{activeCount}/{list.length}</span>
            </div>
            {list.map(p => {
              const permDisabled = p.status !== 'ACTIVE';
              const cannotSelect = readOnly || archived || permDisabled || (p.protected && !isSuper);
              return (
                <label key={p.key} className={`perm-check ${cannotSelect ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(p.key)}
                    disabled={cannotSelect}
                    onChange={() => toggle(p.key)}
                  />
                  <span style={{ flex: 1 }}>
                    <span className="adm-mono" style={{ fontSize: 12 }}>{p.key}</span>
                    <span className="perm-tag" style={{ marginLeft: 6 }}>{p.status === 'ACTIVE' ? '可用' : '已停用'}</span>
                    {p.protected && <span className="perm-tag protected" style={{ marginLeft: 6 }}>核心权限</span>}
                    <div className="perm-check-desc">{p.description}</div>
                  </span>
                </label>
              );
            })}
          </div>
        );
      })}
      {!readOnly && (
        <div className="perm-row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" disabled={saving || archived} onClick={save}>
            {saving ? '保存中…' : '保存权限配置'}
          </button>
          <span className="adm-hint">模块角色只能配置所属模块权限；核心权限仅超级管理员可授予。</span>
        </div>
      )}
    </div>
  );
}

/* ================= 角色成员 ================= */
function RoleMembers({ role, onChanged, showToast }) {
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [userQ, setUserQ] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [results, setResults] = useState(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (search.trim()) params.set('search', search.trim());
      const d = await api.get(`/api/permissions/roles/${role.id}/members?${params}`);
      setMembers(d.items || []);
      setTotal(d.total || 0);
    } catch (e) {
      showToast(e.message || '加载成员失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [role.id, search, showToast]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const searchUsers = async () => {
    try {
      const d = await api.get(`/api/permissions/users/search?q=${encodeURIComponent(userQ.trim())}&limit=20`);
      setUserResults(d.users || []);
      setPicked(new Set());
    } catch (e) {
      showToast(e.message || '搜索用户失败', 'error');
    }
  };

  const addPicked = async () => {
    const ids = [...picked];
    if (!ids.length) return;
    const names = userResults.filter(u => ids.includes(u.id)).map(u => u.nickname || u.username);
    const ok = window.confirm(`确定向角色「${role.name}」批量添加 ${ids.length} 名成员？\n名单：${names.join('、')}`);
    if (!ok) return;
    setAdding(true);
    setResults(null);
    try {
      const d = await api.post(`/api/permissions/roles/${role.id}/members`, { user_ids: ids });
      setResults(d);
      showToast(`批量添加完成：成功 ${d.successCount}，失败 ${d.failCount}`, d.failCount ? 'error' : 'success');
      setPicked(new Set());
      await loadMembers();
      onChanged();
    } catch (e) {
      showToast(e.message || '添加失败', 'error');
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (userId) => {
    if (!window.confirm('确定从该角色移除此成员？')) return;
    try {
      const d = await api.delete(`/api/permissions/roles/${role.id}/members/${userId}`);
      showToast(`已移除（成功 ${d.successCount}，失败 ${d.failCount}）`, d.failCount ? 'error' : 'success');
      await loadMembers();
      onChanged();
    } catch (e) {
      showToast(e.message || '移除失败', 'error');
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="adm-toolbar">
        <div className="adm-toolbar-left">
          <input
            className="adm-input"
            placeholder="按用户名/昵称筛选成员"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadMembers()}
          />
          <button className="btn btn-secondary btn-sm" onClick={loadMembers}>筛选</button>
          <span className="adm-hint">共 {total} 名成员</span>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : members.length === 0 ? (
        <p className="adm-empty">该角色暂无成员</p>
      ) : (
        <div>
          {members.map(m => (
            <div key={m.id} className="perm-member">
              <img src={m.avatar || '/images/default-avatar.png'} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{m.nickname || m.username}</span>
                <span className="text-secondary" style={{ fontSize: 12, marginLeft: 8 }}>@{m.username} · Level {m.level}</span>
                {m.frozen && <span className="perm-tag disabled" style={{ marginLeft: 6 }}>已冻结</span>}
              </div>
              <span className="adm-hint">{fmtDate(m.joinedAt)}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => removeMember(m.id)}>移除</button>
            </div>
          ))}
        </div>
      )}

      <div className="adm-card" style={{ marginTop: 14, padding: 12 }}>
        <div className="adm-card-title" style={{ fontSize: 13 }}>添加成员（支持批量）</div>
        <div className="perm-row">
          <input
            className="adm-input"
            style={{ flex: 1 }}
            placeholder="输入用户名 / 昵称 / 用户ID 搜索"
            value={userQ}
            onChange={e => setUserQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') searchUsers(); }}
          />
          <button className="btn btn-secondary btn-sm" onClick={searchUsers}>搜索</button>
          <button className="btn btn-primary btn-sm" disabled={!picked.size || adding} onClick={addPicked}>
            {adding ? '添加中…' : `添加选中（${picked.size}）`}
          </button>
        </div>
        {userResults.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {userResults.map(u => (
              <label key={u.id} className="perm-check">
                <input
                  type="checkbox"
                  checked={picked.has(u.id)}
                  onChange={() => setPicked(prev => {
                    const next = new Set(prev);
                    if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                    return next;
                  })}
                />
                <span>{u.nickname || u.username} <span className="text-secondary" style={{ fontSize: 12 }}>@{u.username} · Level {u.level}</span></span>
              </label>
            ))}
          </div>
        )}
        {results && (
          <div className="perm-result-list">
            {results.results.map((r, i) => (
              <div key={i} className={r.ok ? 'perm-result-ok' : 'perm-result-fail'}>
                用户 #{r.userId}：{r.ok ? (r.already ? '已是成员（跳过）' : '成功') : `${r.error}（${r.code}）`}
              </div>
            ))}
          </div>
        )}
        <p className="adm-hint" style={{ marginTop: 8 }}>
          禁用/归档角色不能分配新成员；批量操作逐条返回结果，单个失败不影响其他目标。
        </p>
      </div>
    </div>
  );
}

/* ================= 新建角色 ================= */
function CreateRoleModal({ open, initialTemplate, onClose, registry, templates, modules, isSuper, showToast, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('module');
  const [moduleName, setModuleName] = useState('wiki');
  const [templateKey, setTemplateKey] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  const reset = useCallback((tplKey) => {
    const tpl = (templates || []).find(t => t.key === tplKey);
    setName(tpl ? `${tpl.name}（副本）` : '');
    setDescription(tpl ? (tpl.description || '') : '');
    setScope(tpl ? tpl.scope : 'module');
    setModuleName(tpl && tpl.module ? tpl.module : 'wiki');
    setTemplateKey(tpl ? tpl.key : '');
    setSelected(new Set(tpl ? (tpl.permissions || []) : []));
  }, [templates]);

  useEffect(() => {
    if (!open) return;
    reset(initialTemplate || '');
  }, [open, initialTemplate, reset]);

  const applyTemplate = (key) => { reset(key); };

  const availablePerms = useMemo(() => {
    const list = registry?.permissions || [];
    if (scope === 'module') return list.filter(p => p.module === moduleName);
    return list.filter(p => p.module !== 'admin' || isSuper);
  }, [registry, scope, moduleName, isSuper]);

  const submit = async () => {
    if (!name.trim()) { showToast('请填写角色名称', 'error'); return; }
    setSaving(true);
    try {
      const d = await api.post('/api/permissions/roles', {
        name: name.trim(),
        description: description.trim(),
        scope,
        module: scope === 'module' ? moduleName : undefined,
        template_key: templateKey || undefined,
        permissions: [...selected]
      });
      showToast('角色已创建', 'success');
      onCreated(d.role);
    } catch (e) {
      showToast(e.message || '创建失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  const moduleOptions = Object.entries(modules).filter(([k]) => k !== 'admin');

  return (
    <ModalBox open={open} title="新建角色" onClose={onClose}>
      <div className="adm-form-grid">
        <div className="adm-field">
          <label className="adm-label">基于系统模板（可选）</label>
          <select className="adm-input" value={templateKey} onChange={e => applyTemplate(e.target.value)}>
            <option value="">不基于模板（自建）</option>
            {templates.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </div>
        <div className="adm-field">
          <label className="adm-label">角色名称 *</label>
          <input className="adm-input" value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="例如：Wiki 夜班编辑" />
        </div>
        <div className="adm-field">
          <label className="adm-label">描述</label>
          <input className="adm-input" value={description} onChange={e => setDescription(e.target.value)} maxLength={200} />
        </div>
        <div className="adm-field">
          <label className="adm-label">作用域</label>
          <select className="adm-input" value={scope} onChange={e => { setScope(e.target.value); setSelected(new Set()); }} disabled={!!templateKey}>
            <option value="module">模块角色（只能配置本模块权限）</option>
            <option value="global">全局角色（可配置普通业务模块权限）</option>
          </select>
        </div>
        {scope === 'module' && (
          <div className="adm-field">
            <label className="adm-label">所属模块</label>
            <select className="adm-input" value={moduleName} onChange={e => { setModuleName(e.target.value); setSelected(new Set()); }} disabled={!!templateKey}>
              {moduleOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}
        <div className="adm-field">
          <label className="adm-label">权限（已选 {selected.size} 项）</label>
          <div style={{ maxHeight: '42vh', overflow: 'auto' }}>
            {availablePerms.map(p => (
              <label key={p.key} className={`perm-check ${(p.protected && !isSuper) || p.status !== 'ACTIVE' ? 'disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(p.key)}
                  disabled={(p.protected && !isSuper) || p.status !== 'ACTIVE'}
                  onChange={() => setSelected(prev => {
                    const next = new Set(prev);
                    if (next.has(p.key)) next.delete(p.key); else next.add(p.key);
                    return next;
                  })}
                />
                <span>
                  <span className="adm-mono" style={{ fontSize: 12 }}>{p.key}</span>
                  {p.protected && <span className="perm-tag protected" style={{ marginLeft: 6 }}>核心</span>}
                  <div className="perm-check-desc">{p.description}</div>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="perm-row">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? '创建中…' : '创建角色'}</button>
        </div>
      </div>
    </ModalBox>
  );
}

/* ================= 审计日志 ================= */
function AuditLog({ showToast }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionLabels, setActionLabels] = useState({});
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (action) params.set('action', action);
      const d = await api.get(`/api/permissions/audit?${params}`);
      setItems(d.items || []);
      setTotal(d.total || 0);
      setActionLabels(d.actionLabels || {});
    } catch (e) {
      showToast(e.message || '加载审计日志失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, action, showToast]);

  useEffect(() => { load(); }, [load]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const diffText = (item) => {
    try {
      const before = item.before ? JSON.stringify(item.before) : '-';
      const after = item.after ? JSON.stringify(item.after) : '-';
      return `前：${before}\n后：${after}`;
    } catch (e) {
      return '-';
    }
  };

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <div className="adm-card-title">权限审计日志</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="adm-input" value={action} onChange={e => { setAction(e.target.value); setPage(1); }}>
            <option value="">全部动作</option>
            {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={load}>刷新</button>
        </div>
      </div>
      <p className="adm-card-desc">只记录管理动作（创建/修改角色、权限变更、状态变更、成员分配/移除、批量结果、等级调整、人工调整贡献点），不记录每次普通权限检查。</p>
      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : items.length === 0 ? (
        <p className="adm-empty">暂无审计记录</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>操作者</th>
                <th>目标</th>
                <th>说明</th>
                <th>前后差异</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(it.createdAt)}</td>
                  <td>{it.actionLabel}</td>
                  <td>{it.actorName}</td>
                  <td>{it.targetType ? `${it.targetType}#${it.targetId}` : '-'}</td>
                  <td style={{ maxWidth: 260 }}>{it.note}</td>
                  <td><div className="perm-audit-diff">{diffText(it)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {totalPages > 1 && (
        <div className="perm-row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span className="adm-hint">{page}/{totalPages}（共 {total} 条）</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}
    </div>
  );
}
