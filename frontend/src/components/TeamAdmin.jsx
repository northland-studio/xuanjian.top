import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatDate } from '../utils';

/*
 * 队伍信息采集公示（NorthTeam）· 管理端组件（挂在 /admin 的「队伍配置」tab）
 * 接口（JWT + 管理员，见 routes/team.js）：
 *   GET    /api/team/configs        列表
 *   GET    /api/team/configs/:id    完整配置（编辑用）
 *   POST   /api/team/configs        新建
 *   PUT    /api/team/configs/:id    全量覆盖更新（units + members 一起提交）
 *   DELETE /api/team/configs/:id    删除
 */

// 与后端 routes/team.js 的 COLORS 严格一致（16 种原版颜色）
const COLORS = ['black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold',
  'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white'];

const COLOR_LABELS = {
  black: 'black（黑）', dark_blue: 'dark_blue（深蓝）', dark_green: 'dark_green（深绿）',
  dark_aqua: 'dark_aqua（深青）', dark_red: 'dark_red（深红）', dark_purple: 'dark_purple（深紫）',
  gold: 'gold（金）', gray: 'gray（灰）', dark_gray: 'dark_gray（深灰）', blue: 'blue（蓝）',
  green: 'green（绿）', aqua: 'aqua（青）', red: 'red（红）', light_purple: 'light_purple（粉紫）',
  yellow: 'yellow（黄）', white: 'white（白）'
};

// 仅供颜色预览色块使用
const MC_COLORS = {
  black: '#000000', dark_blue: '#0000AA', dark_green: '#00AA00', dark_aqua: '#00AAAA',
  dark_red: '#AA0000', dark_purple: '#AA00AA', gold: '#FFAA00', gray: '#AAAAAA',
  dark_gray: '#555555', blue: '#5555FF', green: '#55FF55', aqua: '#55FFFF',
  red: '#FF5555', light_purple: '#FF55FF', yellow: '#FFFF55', white: '#FFFFFF'
};

const VISIBILITY_OPTIONS = [
  { value: 'always', label: 'always（始终可见）' },
  { value: 'hideForOtherTeams', label: 'hideForOtherTeams（对其他队伍隐藏）' },
  { value: 'hideForOwnTeam', label: 'hideForOwnTeam（对己方队伍隐藏）' },
  { value: 'never', label: 'never（始终隐藏）' }
];

const COLLISION_OPTIONS = [
  { value: 'always', label: 'always（正常碰撞）' },
  { value: 'pushOtherTeams', label: 'pushOtherTeams（只推其他队伍）' },
  { value: 'pushOwnTeam', label: 'pushOwnTeam（只推己方队伍）' },
  { value: 'never', label: 'never（不碰撞）' }
];

const POSITION_OPTIONS = [
  { value: 'sidebar', label: 'sidebar（侧边栏）' },
  { value: 'list', label: 'list（玩家列表）' },
  { value: 'below_name', label: 'below_name（名牌下方）' }
];

const SCORE_MODE_OPTIONS = [
  { value: 'member_count', label: 'member_count（按人数自动）' },
  { value: 'fixed', label: 'fixed（固定分数，本期保留）' }
];

const KEY_RE = /^[a-z0-9_]{1,16}$/;
const PLAYER_RE = /^[A-Za-z0-9_]{1,16}$/;
const OBJECTIVE_RE = /^[A-Za-z0-9_.-]{1,32}$/;

const MAX_UNITS = 32;
const MAX_MEMBERS = 100;
const MAX_TEXT = 64;

/** 新建一个空白队伍单元（unchecked 项按后端默认值给） */
function newUnit(index = 0) {
  return {
    key: '',
    display_name: '',
    color: COLORS[index % COLORS.length],
    prefix: '',
    suffix: '',
    friendly_fire: false,
    see_friendly_invisibles: true,
    nametag_visibility: 'always',
    death_message_visibility: 'always',
    collision_rule: 'always',
    membersText: ''
  };
}

function emptyForm() {
  return {
    name: '',
    description: '',
    event_date: '',
    is_public: true,
    scoreboard: {
      enabled: true,
      objective: 'nt_teams',
      display_name: '<gold>队伍</gold>',
      position: 'sidebar',
      score_mode: 'member_count'
    },
    units: [newUnit(0)]
  };
}

/** 成员文本框 → 数组：支持逗号（中英文）、换行、空格、分号、顿号分隔 */
function parseMembersText(text) {
  return String(text || '')
    .split(/[\s,，、;；]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** 大小写不敏感去重，保留首次出现的写法 */
function dedupeMembers(list) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const lower = m.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(m);
  }
  return out;
}

/** 前端基础校验：返回中文错误文案，空字符串表示通过（后端校验更全，失败时以其 error 为准） */
function validateForm(form) {
  const name = form.name.trim();
  if (!name) return '配置名称必填';
  if (name.length > MAX_TEXT) return `配置名称不能超过 ${MAX_TEXT} 个字符`;

  const sb = form.scoreboard;
  if (sb.enabled) {
    const objective = (sb.objective || '').trim();
    if (!objective) return '记分板 objective 不能为空';
    if (!OBJECTIVE_RE.test(objective)) return '记分板 objective 只允许字母、数字与 . _ -（不超过 32 位）';
  }

  if (!form.units.length) return '至少需要配置一个队伍';
  if (form.units.length > MAX_UNITS) return `队伍数量不能超过 ${MAX_UNITS} 个`;

  const keys = new Set();
  const owner = new Map(); // 玩家小写名 → 所在队伍 key
  for (let i = 0; i < form.units.length; i++) {
    const u = form.units[i];
    const key = (u.key || '').trim().toLowerCase();
    if (!KEY_RE.test(key)) return `第 ${i + 1} 个队伍的 key 不合法（只允许 a-z0-9_，不超过 16 位）`;
    if (keys.has(key)) return `队伍 key 重复：${key}`;
    keys.add(key);

    const displayName = (u.display_name || '').trim();
    if (!displayName) return `队伍 ${key} 的显示名必填`;
    if (displayName.length > 32) return `队伍 ${key} 的显示名不能超过 32 个字符`;

    if (!COLORS.includes(u.color)) return `队伍 ${key} 的颜色不在允许的 16 种原版颜色内`;
    if ((u.prefix || '').length > MAX_TEXT) return `队伍 ${key} 的前缀不能超过 ${MAX_TEXT} 个字符`;
    if ((u.suffix || '').length > MAX_TEXT) return `队伍 ${key} 的后缀不能超过 ${MAX_TEXT} 个字符`;

    const members = dedupeMembers(parseMembersText(u.membersText));
    if (members.length > MAX_MEMBERS) return `队伍 ${key} 的成员数不能超过 ${MAX_MEMBERS} 人`;
    for (const m of members) {
      if (!PLAYER_RE.test(m)) return `队伍 ${key} 的成员名不合法：${m}（只允许字母数字下划线，不超过 16 位）`;
      const lower = m.toLowerCase();
      if (owner.has(lower)) return `玩家 ${m} 同时出现在 ${owner.get(lower)} 和 ${key}`;
      owner.set(lower, key);
    }
  }
  return '';
}

/** 表单 → 接口请求体（去掉 id/version，units 与 members 整体提交） */
function buildPayload(form) {
  return {
    name: form.name.trim(),
    description: (form.description || '').slice(0, 500),
    event_date: form.event_date ? form.event_date : null,
    is_public: !!form.is_public,
    scoreboard: {
      enabled: !!form.scoreboard.enabled,
      objective: (form.scoreboard.objective || 'nt_teams').trim() || 'nt_teams',
      display_name: (form.scoreboard.display_name || '').slice(0, MAX_TEXT) || '<gold>队伍</gold>',
      position: form.scoreboard.position,
      score_mode: form.scoreboard.score_mode
    },
    units: form.units.map((u, i) => ({
      key: (u.key || '').trim().toLowerCase(),
      display_name: (u.display_name || '').trim(),
      color: u.color,
      prefix: u.prefix || '',
      suffix: u.suffix || '',
      friendly_fire: !!u.friendly_fire,
      see_friendly_invisibles: !!u.see_friendly_invisibles,
      nametag_visibility: u.nametag_visibility,
      death_message_visibility: u.death_message_visibility,
      collision_rule: u.collision_rule,
      sort_order: i + 1,
      members: dedupeMembers(parseMembersText(u.membersText))
    }))
  };
}

/** 完整配置 → 编辑表单 */
function configToForm(cfg) {
  const sb = cfg.scoreboard || {};
  return {
    name: cfg.name || '',
    description: cfg.description || '',
    event_date: cfg.event_date || '',
    is_public: !!cfg.is_public,
    scoreboard: {
      enabled: !!sb.enabled,
      objective: sb.objective || 'nt_teams',
      display_name: sb.display_name || '<gold>队伍</gold>',
      position: sb.position || 'sidebar',
      score_mode: sb.score_mode || 'member_count'
    },
    units: (cfg.units || []).map(u => ({
      key: u.key || '',
      display_name: u.display_name || '',
      color: u.color || 'white',
      prefix: u.prefix || '',
      suffix: u.suffix || '',
      friendly_fire: !!u.friendly_fire,
      see_friendly_invisibles: u.see_friendly_invisibles !== false,
      nametag_visibility: u.nametag_visibility || 'always',
      death_message_visibility: u.death_message_visibility || 'always',
      collision_rule: u.collision_rule || 'always',
      membersText: (u.members || []).join('\n')
    }))
  };
}

function ColorSwatch({ color, size = 14 }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: 4,
        flexShrink: 0,
        background: MC_COLORS[color] || '#888888',
        boxShadow: '0 0 0 1px var(--border)'
      }}
    />
  );
}

export default function TeamAdmin({ showToast }) {
  // Admin.jsx 其它 tab 都会传 showToast；这里做兜底，未传时只做本地错误展示
  const notify = (msg, type) => { if (typeof showToast === 'function') showToast(msg, type); };

  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null=列表；{} = 新建；含 id = 编辑
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadList = async () => {
    setLoading(true);
    try {
      const d = await api.get('/api/team/configs');
      setConfigs(d.configs || []);
    } catch (e) {
      notify(e.message || '队伍配置列表加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 表单操作 ---------- */
  const startCreate = () => {
    setEditing({});
    setForm(emptyForm());
    setError('');
  };

  const startEdit = async (id) => {
    setBusyId(id);
    setError('');
    try {
      const cfg = await api.get(`/api/team/configs/${id}`);
      setEditing(cfg);
      setForm(configToForm(cfg));
    } catch (e) {
      notify(e.message || '配置加载失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(emptyForm());
    setError('');
  };

  const patchForm = (patch) => setForm(f => ({ ...f, ...patch }));
  const patchScoreboard = (patch) => setForm(f => ({ ...f, scoreboard: { ...f.scoreboard, ...patch } }));
  const updateUnit = (index, patch) => setForm(f => ({
    ...f,
    units: f.units.map((u, i) => (i === index ? { ...u, ...patch } : u))
  }));
  const addUnit = () => setForm(f => {
    if (f.units.length >= MAX_UNITS) {
      notify(`队伍数量不能超过 ${MAX_UNITS} 个`, 'error');
      return f;
    }
    return { ...f, units: [...f.units, newUnit(f.units.length)] };
  });
  const removeUnit = (index) => setForm(f => ({ ...f, units: f.units.filter((_, i) => i !== index) }));

  const save = async () => {
    const invalid = validateForm(form);
    if (invalid) {
      setError(invalid);
      notify(invalid, 'error');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = buildPayload(form);
      if (editing && editing.id) {
        await api.put(`/api/team/configs/${editing.id}`, payload);
        notify('队伍配置已保存', 'success');
      } else {
        const d = await api.post('/api/team/configs', payload);
        notify(`队伍配置创建成功（ID ${d.id}）`, 'success');
      }
      setEditing(null);
      setForm(emptyForm());
      await loadList();
    } catch (e) {
      // 后端校验很全（如「玩家 X 同时出现在 yellow 和 red」），原文展示
      setError(e.message || '保存失败');
      notify(e.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* ---------- 列表操作 ---------- */
  const togglePublic = async (row) => {
    const tip = row.is_public
      ? `取消公示后，官网「队伍公示」页将不再显示「${row.name}」。确定取消？`
      : `确定公示「${row.name}」？公示后所有访客都能看到该配置的队伍与成员名单。`;
    if (!confirm(tip)) return;
    setBusyId(row.id);
    try {
      // PUT 为全量覆盖：先取完整配置再翻转 is_public
      const cfg = await api.get(`/api/team/configs/${row.id}`);
      await api.put(`/api/team/configs/${row.id}`, {
        name: cfg.name,
        description: cfg.description,
        event_date: cfg.event_date,
        is_public: !cfg.is_public,
        scoreboard: cfg.scoreboard,
        units: cfg.units
      });
      notify(cfg.is_public ? '已取消公示' : '已公示', 'success');
      await loadList();
    } catch (e) {
      notify(e.message || '操作失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row) => {
    if (!confirm(`确定删除队伍配置「${row.name}」（ID ${row.id}）？队伍与成员数据将一并删除且不可恢复。`)) return;
    setBusyId(row.id);
    try {
      await api.delete(`/api/team/configs/${row.id}`);
      notify('删除成功', 'success');
      if (editing && editing.id === row.id) cancelEdit();
      await loadList();
    } catch (e) {
      notify(e.message || '删除失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const copyId = async (id) => {
    const text = String(id);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // http 环境下的兜底复制
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      notify(`已复制配置 ID：${text}（游戏内 /nt apply ${text}）`, 'success');
    } catch {
      notify('复制失败，请手动选中复制', 'error');
    }
  };

  /* ==================== 编辑 / 新建表单 ==================== */
  if (editing !== null) {
    return (
      <div>
        <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{editing.id ? `编辑队伍配置（ID ${editing.id}）` : '新建队伍配置'}</h3>
            <p className="text-secondary" style={{ fontSize: 13, marginTop: 2 }}>
              保存为<b>整体覆盖</b>：队伍与成员名单会按当前表单一起提交；游戏内用 <code>/nt apply {editing.id || '<ID>'}</code> 应用
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>返回列表</button>
        </div>

        {error && (
          <div className="card mb-3" style={{ padding: 14, background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.3)' }}>
            <div style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>✗ {error}</div>
          </div>
        )}

        {/* 基础信息 */}
        <div className="card mb-4" style={{ padding: 20 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>基础信息</h4>
          <div className="grid grid-2" style={{ gap: 14 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">配置名称 *（≤ {MAX_TEXT} 字符）</label>
              <input
                className="form-input"
                value={form.name}
                maxLength={MAX_TEXT}
                placeholder="例如：周年庆大逃杀"
                onChange={e => patchForm({ name: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">活动日期</label>
              <input
                type="date"
                className="form-input"
                value={form.event_date || ''}
                onChange={e => patchForm({ event_date: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label className="form-label">描述（≤ 500 字符）</label>
              <textarea
                className="form-textarea"
                style={{ minHeight: 76 }}
                maxLength={500}
                value={form.description}
                placeholder="活动说明，例如：四人一队，共四队"
                onChange={e => patchForm({ description: e.target.value })}
              />
            </div>
          </div>
          <label className="flex mt-3" style={{ gap: 6, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={e => patchForm({ is_public: e.target.checked })}
              style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
            />
            在官网「队伍公示」页公示（关闭后仅管理员与插件可见）
          </label>
        </div>

        {/* 记分板 */}
        <div className="card mb-4" style={{ padding: 20 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>记分板段</h4>
          <label className="flex mb-3" style={{ gap: 6, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.scoreboard.enabled}
              onChange={e => patchScoreboard({ enabled: e.target.checked })}
              style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
            />
            应用配置时同步记分板（每队一行，分数=人数）
          </label>
          <div className="grid grid-2" style={{ gap: 14 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">objective（只允许字母数字 . _ -）</label>
              <input
                className="form-input"
                value={form.scoreboard.objective}
                maxLength={32}
                placeholder="nt_teams"
                onChange={e => patchScoreboard({ objective: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">显示名（MiniMessage）</label>
              <input
                className="form-input"
                value={form.scoreboard.display_name}
                maxLength={MAX_TEXT}
                placeholder="<gold>队伍</gold>"
                onChange={e => patchScoreboard({ display_name: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">位置</label>
              <select
                className="form-select"
                value={form.scoreboard.position}
                onChange={e => patchScoreboard({ position: e.target.value })}
              >
                {POSITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">分数模式</label>
              <select
                className="form-select"
                value={form.scoreboard.score_mode}
                onChange={e => patchScoreboard({ score_mode: e.target.value })}
              >
                {SCORE_MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* 队伍编辑器 */}
        <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700 }}>队伍（{form.units.length} / {MAX_UNITS}）</h4>
          <button className="btn btn-primary btn-sm" onClick={addUnit}>+ 添加队伍</button>
        </div>

        {form.units.length === 0 ? (
          <div className="empty-state"><p>至少需要配置一个队伍</p></div>
        ) : (
          <div className="flex-col" style={{ gap: 14 }}>
            {form.units.map((u, index) => {
              const memberCount = dedupeMembers(parseMembersText(u.membersText)).length;
              return (
                <div key={index} className="card" style={{ padding: 18 }}>
                  <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <ColorSwatch color={u.color} size={16} />
                      <span style={{ fontWeight: 700 }}>{u.display_name || `未命名队伍 ${index + 1}`}</span>
                      <span className="badge badge-gray" style={{ fontSize: 11 }}>key: {u.key || '未填写'}</span>
                      <span className="badge badge-gray" style={{ fontSize: 11 }}>{memberCount} 人</span>
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => removeUnit(index)}
                      disabled={form.units.length <= 1}
                      title={form.units.length <= 1 ? '至少保留一个队伍' : '删除该队伍'}
                    >
                      删除队伍
                    </button>
                  </div>

                  <div className="grid grid-3" style={{ gap: 12 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">key *（a-z0-9_，≤16）</label>
                      <input
                        className="form-input"
                        value={u.key}
                        maxLength={16}
                        placeholder="yellow"
                        onChange={e => updateUnit(index, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">显示名 *（≤32）</label>
                      <input
                        className="form-input"
                        value={u.display_name}
                        maxLength={32}
                        placeholder="黄队"
                        onChange={e => updateUnit(index, { display_name: e.target.value })}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">颜色 *（16 种原版颜色）</label>
                      <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                        <ColorSwatch color={u.color} size={18} />
                        <select
                          className="form-select"
                          value={u.color}
                          onChange={e => updateUnit(index, { color: e.target.value })}
                        >
                          {COLORS.map(c => <option key={c} value={c}>{COLOR_LABELS[c]}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">前缀（MiniMessage，≤64）</label>
                      <input
                        className="form-input"
                        value={u.prefix}
                        maxLength={MAX_TEXT}
                        placeholder="<yellow>[黄]</yellow> "
                        onChange={e => updateUnit(index, { prefix: e.target.value })}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">后缀（MiniMessage，≤64）</label>
                      <input
                        className="form-input"
                        value={u.suffix}
                        maxLength={MAX_TEXT}
                        placeholder="留空表示无后缀"
                        onChange={e => updateUnit(index, { suffix: e.target.value })}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">友伤 / 隐身可见</label>
                      <div className="flex" style={{ gap: 14, alignItems: 'center', minHeight: 46 }}>
                        <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={u.friendly_fire}
                            onChange={e => updateUnit(index, { friendly_fire: e.target.checked })}
                            style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
                          />
                          允许友伤
                        </label>
                        <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={u.see_friendly_invisibles}
                            onChange={e => updateUnit(index, { see_friendly_invisibles: e.target.checked })}
                            style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
                          />
                          可见队友隐身
                        </label>
                      </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">名牌可见</label>
                      <select
                        className="form-select"
                        value={u.nametag_visibility}
                        onChange={e => updateUnit(index, { nametag_visibility: e.target.value })}
                      >
                        {VISIBILITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">死亡消息可见</label>
                      <select
                        className="form-select"
                        value={u.death_message_visibility}
                        onChange={e => updateUnit(index, { death_message_visibility: e.target.value })}
                      >
                        {VISIBILITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">碰撞规则</label>
                      <select
                        className="form-select"
                        value={u.collision_rule}
                        onChange={e => updateUnit(index, { collision_rule: e.target.value })}
                      >
                        {COLLISION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="form-group mt-3" style={{ marginBottom: 0 }}>
                    <label className="form-label">成员名单（逗号或换行分隔，只允许字母数字下划线 ≤16 位）</label>
                    <textarea
                      className="form-textarea"
                      style={{ minHeight: 84 }}
                      value={u.membersText}
                      placeholder={'Morzane123, brichir\nSteve'}
                      onChange={e => updateUnit(index, { membersText: e.target.value })}
                    />
                    <p className="text-secondary" style={{ fontSize: 12, marginTop: 6 }}>
                      已解析 {memberCount} 名成员（自动去重；同一玩家不能同时出现在两个队伍中）
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-secondary" onClick={cancelEdit} disabled={saving}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中...' : (editing.id ? '保存修改' : '创建配置')}
          </button>
        </div>
      </div>
    );
  }

  /* ==================== 列表 ==================== */
  return (
    <div>
      <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
        <p className="text-secondary" style={{ fontSize: 14 }}>
          队伍配置管理：插件用 <b>/nt apply &lt;配置ID&gt;</b> 应用（点击表格里的 ID 即可复制）
        </p>
        <button className="btn btn-primary btn-sm" onClick={startCreate}>+ 新建配置</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : configs.length === 0 ? (
        <div className="empty-state">
          <p>暂无队伍配置</p>
          <p className="text-secondary" style={{ fontSize: 13, marginTop: 6 }}>可以手动新建，或由插件用 /nt import 采集服务器现状生成未公示草稿</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr>
                <th>配置 ID</th>
                <th>名称</th>
                <th>活动日期</th>
                <th>队伍数</th>
                <th>人数</th>
                <th>公示</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {configs.map(c => (
                <tr key={c.id}>
                  <td>
                    <button
                      type="button"
                      className="team-id-chip"
                      onClick={() => copyId(c.id)}
                      title={`点击复制（游戏内 /nt apply ${c.id}）`}
                    >
                      <b>{c.id}</b>
                      <span>复制</span>
                    </button>
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.event_date || '—'}</td>
                  <td>{c.unit_count}</td>
                  <td>{c.member_count}</td>
                  <td>
                    {c.is_public
                      ? <span className="badge badge-success">已公示</span>
                      : <span className="badge badge-gray">未公示</span>}
                  </td>
                  <td className="text-secondary">{formatDate(c.version)}</td>
                  <td>
                    <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-secondary btn-sm" disabled={busyId === c.id} onClick={() => startEdit(c.id)}>编辑</button>
                      <button className="btn btn-secondary btn-sm" disabled={busyId === c.id} onClick={() => togglePublic(c)}>
                        {c.is_public ? '取消公示' : '公示'}
                      </button>
                      <button className="btn btn-danger btn-sm" disabled={busyId === c.id} onClick={() => remove(c)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
