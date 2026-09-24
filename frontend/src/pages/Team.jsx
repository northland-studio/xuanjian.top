import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatDate } from '../utils';

/*
 * 队伍信息采集公示（NorthTeam）· 只读公示页
 * 数据来源：GET /api/team/public（列表，无认证）、GET /api/team/public/:id（详情，无认证）
 * 契约见 H:\chengxuyuanma\north-team\docs\API.md
 */

// 原版 16 色（与后端 COLORS / 插件颜色名一致）
const MC_COLORS = {
  black: '#000000', dark_blue: '#0000AA', dark_green: '#00AA00', dark_aqua: '#00AAAA',
  dark_red: '#AA0000', dark_purple: '#AA00AA', gold: '#FFAA00', gray: '#AAAAAA',
  dark_gray: '#555555', blue: '#5555FF', green: '#55FF55', aqua: '#55FFFF',
  red: '#FF5555', light_purple: '#FF55FF', yellow: '#FFFF55', white: '#FFFFFF'
};

const COLOR_NAMES = {
  black: '黑色', dark_blue: '深蓝', dark_green: '深绿', dark_aqua: '深青',
  dark_red: '深红', dark_purple: '深紫', gold: '金色', gray: '灰色',
  dark_gray: '深灰', blue: '蓝色', green: '绿色', aqua: '青色',
  red: '红色', light_purple: '粉紫', yellow: '黄色', white: '白色'
};

const VISIBILITY_NAMES = {
  always: '始终可见',
  hideForOtherTeams: '对其他队伍隐藏',
  hideForOwnTeam: '对己方队伍隐藏',
  never: '始终隐藏'
};

const COLLISION_NAMES = {
  always: '正常碰撞（可推动任何玩家）',
  pushOtherTeams: '只推动其他队伍',
  pushOwnTeam: '只推动己方队伍',
  never: '完全不碰撞'
};

const POSITION_NAMES = { sidebar: '侧边栏', list: '玩家列表 (Tab)', below_name: '名牌下方' };
const SCORE_MODE_NAMES = { member_count: '按人数自动计算', fixed: '固定分数' };

/* ==================== MiniMessage 极简渲染 ==================== */
// 仅识别颜色标签 / 装饰标签 / & 传统颜色码，满足公示展示需要（不实现完整 MiniMessage）
const MM_DECOR_TAGS = ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'];
const MM_LEGACY_COLORS = {
  '0': 'black', '1': 'dark_blue', '2': 'dark_green', '3': 'dark_aqua', '4': 'dark_red',
  '5': 'dark_purple', '6': 'gold', '7': 'gray', '8': 'dark_gray', '9': 'blue',
  a: 'green', b: 'aqua', c: 'red', d: 'light_purple', e: 'yellow', f: 'white'
};
const MM_LEGACY_DECOR = { k: 'obfuscated', l: 'bold', m: 'strikethrough', n: 'underlined', o: 'italic' };

// 内部样式对象 → React 内联样式
function toCss(style) {
  const css = {};
  if (style.color && MC_COLORS[style.color]) css.color = MC_COLORS[style.color];
  if (style.bold) css.fontWeight = 700;
  if (style.italic) css.fontStyle = 'italic';
  const deco = [];
  if (style.underlined) deco.push('underline');
  if (style.strikethrough) deco.push('line-through');
  if (deco.length) css.textDecoration = deco.join(' ');
  return css;
}

/** 把 MiniMessage 文本切成 [{ text, style }] 片段，未识别的标签按普通文本原样保留 */
function parseMiniMessage(input) {
  const text = String(input == null ? '' : input);
  const out = [];
  const tagRe = /<(\/?)([a-zA-Z_]+)>|&([0-9a-fk-or])/gi;
  let style = {};
  let buf = '';
  let lastIndex = 0;
  const flush = () => {
    if (buf) { out.push({ text: buf, style: { ...style } }); buf = ''; }
  };

  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const slash = m[1];
    const legacy = m[3];
    let key = null;
    let closing = false;

    if (legacy) {
      const ch = legacy.toLowerCase();
      if (ch === 'r') key = 'reset';
      else if (MM_LEGACY_COLORS[ch]) key = MM_LEGACY_COLORS[ch];
      else if (MM_LEGACY_DECOR[ch]) key = MM_LEGACY_DECOR[ch];
      if (!key) continue;
    } else {
      key = m[2].toLowerCase();
      closing = slash === '/';
      if (key !== 'reset' && !MC_COLORS[key] && !MM_DECOR_TAGS.includes(key)) continue;
    }

    buf += text.slice(lastIndex, m.index);
    flush();
    lastIndex = tagRe.lastIndex;

    if (key === 'reset') { style = {}; continue; }
    const next = { ...style };
    if (MC_COLORS[key]) {
      if (closing) delete next.color; else next.color = key;
    } else if (closing) {
      delete next[key];
    } else {
      next[key] = true;
    }
    style = next;
  }

  buf += text.slice(lastIndex);
  flush();
  return out;
}

/** 彩色文本组件：prefix / suffix / 记分板显示名等 MiniMessage 字段用它渲染 */
function MiniMessageText({ text, fallback = '—' }) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return <span className="text-secondary">{fallback}</span>;
  const parts = parseMiniMessage(raw);
  return (
    <span>
      {parts.map((p, i) => <span key={i} style={toCss(p.style)}>{p.text}</span>)}
    </span>
  );
}

/** 队伍颜色色块（黑色/白色在深色底上也能看清：加一圈描边） */
function ColorBlock({ color, size = 12 }) {
  return (
    <span
      title={COLOR_NAMES[color] || color}
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

/** 键值行 */
function Field({ label, text, node }) {
  return (
    <div>
      <span className="text-secondary">{label}：</span>
      {node || <span>{text}</span>}
    </div>
  );
}

/* ==================== 单个队伍详情块 ==================== */
function TeamBlock({ unit }) {
  const members = unit.members || [];
  return (
    <div className="card" style={{ padding: 16, background: 'var(--input-bg)' }}>
      <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <ColorBlock color={unit.color} size={16} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{unit.display_name}</span>
        <span className="badge badge-gray" style={{ fontSize: 11 }}>key: {unit.key}</span>
        <span className="badge badge-gray" style={{ fontSize: 11 }}>{COLOR_NAMES[unit.color] || unit.color}</span>
        <span className="badge badge-primary" style={{ fontSize: 11 }}>{members.length} 人</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, marginTop: 12, fontSize: 13 }}>
        <Field label="前缀" node={<MiniMessageText text={unit.prefix} fallback="（无）" />} />
        <Field label="后缀" node={<MiniMessageText text={unit.suffix} fallback="（无）" />} />
        <Field label="友伤" text={unit.friendly_fire ? '允许（友军可互相伤害）' : '禁止（友军免伤）'} />
        <Field label="隐身可见" text={unit.see_friendly_invisibles ? '可见队友隐身' : '不可见队友隐身'} />
        <Field label="名牌可见" text={VISIBILITY_NAMES[unit.nametag_visibility] || unit.nametag_visibility} />
        <Field label="死亡消息可见" text={VISIBILITY_NAMES[unit.death_message_visibility] || unit.death_message_visibility} />
        <Field label="碰撞规则" text={COLLISION_NAMES[unit.collision_rule] || unit.collision_rule} />
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="text-secondary" style={{ fontSize: 12, marginBottom: 6 }}>成员名单（{members.length}）</div>
        {members.length === 0 ? (
          <div className="text-secondary" style={{ fontSize: 13 }}>暂无成员</div>
        ) : (
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            {members.map(name => (
              <span
                key={name}
                className="badge"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--card)', color: 'var(--text)', fontSize: 12 }}
              >
                <img
                  src="/images/default-avatar.png"
                  alt=""
                  style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }}
                />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ==================== 配置详情 ==================== */
function ConfigDetail({ cfg }) {
  const sb = cfg.scoreboard || {};
  return (
    <div className="flex-col" style={{ gap: 14 }}>
      {cfg.description && (
        <p className="text-secondary" style={{ fontSize: 14, lineHeight: 1.7 }}>{cfg.description}</p>
      )}

      <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="badge badge-gray">配置 ID：{cfg.id}</span>
        <span className="badge badge-gray">更新时间：{formatDate(cfg.version)}</span>
        <span className="badge badge-gray">记分板：{sb.enabled ? '开启' : '关闭'}</span>
        {sb.enabled && <span className="badge badge-gray">objective：{sb.objective}</span>}
        {sb.enabled && <span className="badge badge-gray">位置：{POSITION_NAMES[sb.position] || sb.position}</span>}
        {sb.enabled && <span className="badge badge-gray">分数模式：{SCORE_MODE_NAMES[sb.score_mode] || sb.score_mode}</span>}
      </div>

      {sb.enabled && (
        <div className="text-secondary" style={{ fontSize: 13 }}>
          记分板显示名：<MiniMessageText text={sb.display_name} />
        </div>
      )}

      {(cfg.units || []).map(unit => <TeamBlock key={unit.key} unit={unit} />)}
    </div>
  );
}

/* ==================== 页面 ==================== */
export default function Team() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({});
  const [detailLoading, setDetailLoading] = useState(null);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/api/team/public')
      .then(d => setConfigs(d.configs || []))
      .catch(e => { setConfigs([]); setError(e.message || '队伍公示加载失败'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (id) => {
    setDetailLoading(id);
    setDetailError('');
    try {
      const d = await api.get(`/api/team/public/${id}`);
      setDetails(prev => ({ ...prev, [id]: d }));
    } catch (e) {
      setDetailError(e.message || '队伍详情加载失败');
    } finally {
      setDetailLoading(null);
    }
  };

  const toggleDetail = (id) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!details[id]) loadDetail(id);
  };

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/1.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>队伍公示</h1>
          <p>活动队伍配置公开信息 · 游戏内使用 /nt apply &lt;配置ID&gt; 应用</p>
        </div>
      </div>

      <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
        <p className="text-secondary" style={{ fontSize: 14 }}>已公示 {configs.length} 份队伍配置</p>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />加载中...</div>
      ) : error ? (
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 14 }}>加载失败：{error}</p>
          <button className="btn btn-primary" onClick={load}>重试</button>
        </div>
      ) : configs.length === 0 ? (
        <div className="empty-state"><p>暂无已公示的队伍配置</p></div>
      ) : (
        <div className="flex-col" style={{ gap: 14 }}>
          {configs.map(c => {
            const opened = openId === c.id;
            const teams = c.teams || [];
            return (
              <div key={c.id} className="card" style={{ padding: 20 }}>
                <div className="flex-between" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: 17, fontWeight: 700 }}>{c.name}</h3>
                      <span className="badge badge-gray" style={{ fontSize: 11 }}>配置 ID {c.id}</span>
                    </div>
                    <div className="text-secondary" style={{ fontSize: 13, marginTop: 4 }}>
                      活动日期：{c.event_date || '未设置'} · 更新时间：{formatDate(c.version)}
                    </div>
                  </div>
                  <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="badge badge-primary">队伍 {c.unit_count} 支</span>
                    <span className="badge badge-success">总人数 {c.member_count}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleDetail(c.id)}>
                      {opened ? '收起详情' : '查看详情'}
                    </button>
                  </div>
                </div>

                {teams.length > 0 && (
                  <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {teams.map(t => (
                      <span
                        key={t.key}
                        className="badge"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--input-bg)', color: 'var(--text)', fontSize: 12 }}
                      >
                        <ColorBlock color={t.color} size={10} />
                        {t.display_name} · {t.member_count} 人
                      </span>
                    ))}
                  </div>
                )}

                {opened && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    {detailLoading === c.id ? (
                      <div className="loading" style={{ padding: 20 }}><div className="spinner" />详情加载中...</div>
                    ) : detailError && !details[c.id] ? (
                      <div>
                        <p style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 12 }}>详情加载失败：{detailError}</p>
                        <button className="btn btn-secondary btn-sm" onClick={() => loadDetail(c.id)}>重试</button>
                      </div>
                    ) : details[c.id] ? (
                      <ConfigDetail cfg={details[c.id]} />
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="card mt-4" style={{ padding: 18 }}>
        <p className="text-secondary" style={{ fontSize: 13, lineHeight: 1.8 }}>
          说明：本页仅展示管理员已公示的队伍配置。游戏内使用 <b>/nt apply &lt;配置ID&gt;</b> 可把对应配置应用到服务器；
          成员名为游戏 ID（离线模式玩家名），大小写不敏感。如需修改配置，请联系管理员在管理后台「队伍配置」中调整。
          <Link to="/mods" style={{ marginLeft: 6 }}>查看游戏模组</Link>
        </p>
      </div>
    </div>
  );
}
