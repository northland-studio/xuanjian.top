import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, uploadImage } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from './UI';
import { IconArrowLeft, IconCheck, IconClose, IconImage, IconMap, IconUpload, IconWarn } from './MarketIcons';
import { formatDate, fmtPoints } from '../utils';
import '../styles/market.css';

const TABS = [
  { key: 'stores', label: '店铺审核' },
  { key: 'config', label: '费率与税务' },
  { key: 'map', label: '地图设置' },
  { key: 'orders', label: '订单' },
  { key: 'disputes', label: '争议裁决' },
  { key: 'finance', label: '公会分户账' },
  { key: 'adjust', label: '手工调账' },
  { key: 'archives', label: '档案检索' },
  { key: 'audit', label: '审计日志' },
  { key: 'notify', label: '通知与任务' },
  { key: 'reconcile', label: '对账自检' }
];

/** 地图投影默认范围（后端 settings.market_config.mapRange.default 的兜底值） */
const DEFAULT_MAP_RANGE = { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000, flipZ: true };
/** 底图草稿在预览里的伪 key（还没保存进 mapBackgrounds 时用） */
const DRAFT_KEY = '__draft__';
const DIM_OPTIONS = [['overworld', '主世界'], ['nether', '下界'], ['end', '末地'], ['custom', '自定义']];

const STORE_STATUS_LABEL = { pending: '待审核', active: '营业中', paused: '暂停营业', grace: '续费宽限期', suspended: '欠费暂停', closed: '已关闭', rejected: '审核未通过' };
const ORDER_STATUS_LABEL = {
  pending_payment: '待付款', paid: '已付款·待核销', delivered: '已核销·待履约', awaiting_confirm: '待确认收货', settled: '已完成',
  cancelled: '已取消', refunding: '退款处理中', refunded: '已退款', disputed: '争议处理中', expired: '已过期'
};
const ORDER_TABS = ['', 'paid', 'delivered', 'awaiting_confirm', 'settled', 'refunding', 'disputed', 'refunded', 'cancelled'];

/** 扁平配置字段（PUT /admin/config） */
const CONFIG_FIELDS = [
  { key: 'openFeeEnabled', label: '启用开店费', type: 'bool' },
  { key: 'openFee', label: '开店费（贡献点）', type: 'number' },
  { key: 'openFeeFirstFree', label: '首店免开店费', type: 'bool' },
  { key: 'renewFeeEnabled', label: '启用续期费', type: 'bool' },
  { key: 'renewFee', label: '续期费（贡献点）', type: 'number' },
  { key: 'cycleDays', label: '营业周期（天，0 = 按预设）', type: 'number' },
  { key: 'graceDays', label: '续费宽限期（天）', type: 'number' },
  { key: 'taxEnabled', label: '启用交易税', type: 'bool' },
  { key: 'taxRateBp', label: '税率（基点 bp，100bp = 1%）', type: 'number' },
  { key: 'taxMode', label: '承担方', type: 'select', options: [['merchant', '商家承担（从成交额扣）'], ['buyer', '买家承担（买家多付）']] },
  { key: 'taxRounding', label: '取整方式', type: 'select', options: [['round', '四舍五入'], ['floor', '向下取整'], ['ceil', '向上取整']] },
  { key: 'storeReviewRequired', label: '开店需审核', type: 'bool' },
  { key: 'verifyCodeTtlHours', label: '核销码有效期（小时）', type: 'number' },
  { key: 'autoConfirmDays', label: '自动确认收货（天）', type: 'number' },
  { key: 'perOrderLimitDefault', label: '默认单笔限购', type: 'number' },
  { key: 'maxProductsPerStore', label: '每店商品上限', type: 'number' },
  { key: 'maxOpenStoresPerUser', label: '每人可开店数', type: 'number' }
];

function Dialog({ title, children, onClose, footer, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: wide ? 560 : 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close mk-modal-close" onClick={onClose} aria-label="关闭" title="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

function Check({ ok, label }) {
  return (
    <span className={`badge mk-icon-text ${ok ? 'badge-success' : 'badge-danger'}`} style={{ marginRight: 6 }}>
      {ok ? <IconCheck size={13} /> : <IconClose size={13} />}{label}
    </span>
  );
}

export default function MarketAdminPanel() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState('stores');

  // 店铺
  const [stores, setStores] = useState([]);
  const [storeStatus, setStoreStatus] = useState('pending');
  const [storeKw, setStoreKw] = useState('');
  const [storeTotal, setStoreTotal] = useState(0);
  // 配置
  const [config, setConfig] = useState(null);
  const [cfgForm, setCfgForm] = useState(null);
  const [cycleDaysEffective, setCycleDaysEffective] = useState(null);
  const [sim, setSim] = useState({ amount: 100, mode: 'merchant', rateBp: '', discount: 0 });
  const [simOut, setSimOut] = useState(null);
  // 地图设置
  const [mapRange, setMapRange] = useState(DEFAULT_MAP_RANGE);
  const [mapBackgrounds, setMapBackgrounds] = useState({});
  const [bgForm, setBgForm] = useState({ serverKey: '', dimension: 'overworld', url: '', minX: '', maxX: '', minZ: '', maxZ: '', flipZ: true });
  const [bgUploading, setBgUploading] = useState(false);
  const [previewKey, setPreviewKey] = useState('');
  const bgInputRef = useRef(null);
  // 订单
  const [orders, setOrders] = useState([]);
  const [orderStatus, setOrderStatus] = useState('');
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [orderStats, setOrderStats] = useState(null);
  // 争议
  const [disputes, setDisputes] = useState([]);
  const [disputeStatus, setDisputeStatus] = useState('open');
  // 财政
  const [finance, setFinance] = useState(null);
  // 调账
  const [adjust, setAdjust] = useState({ user_id: '', amount: '', direction: 'in', note: '' });
  const [adjustUser, setAdjustUser] = useState(null);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  // 档案
  const [archives, setArchives] = useState([]);
  const [archiveKind, setArchiveKind] = useState('');
  const [archiveKw, setArchiveKw] = useState('');
  // 审计
  const [audits, setAudits] = useState([]);
  const [auditAction, setAuditAction] = useState('');
  // 通知
  const [events, setEvents] = useState([]);
  const [eventStatus, setEventStatus] = useState('');
  // 对账
  const [reconcile, setReconcile] = useState(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // { type, payload }

  const isAdmin = user && Number(user.level) >= 1;

  /* ---------- 加载 ---------- */
  const loadStores = useCallback(async (status = storeStatus, keyword = storeKw) => {
    const qs = new URLSearchParams({ limit: '20', page: '1' });
    if (status) qs.set('status', status);
    if (keyword) qs.set('keyword', keyword);
    const d = await api.get(`/api/market/admin/stores?${qs.toString()}`);
    setStores(d.items || []);
    setStoreTotal(d.total || 0);
  }, [storeStatus, storeKw]);

  const loadConfig = useCallback(async () => {
    const d = await api.get('/api/market/admin/config');
    setConfig(d.config);
    setCfgForm(d.config);
    setCycleDaysEffective(d.cycleDaysEffective);
  }, []);

  const loadOrders = useCallback(async (status = orderStatus, page = 1) => {
    const qs = new URLSearchParams({ limit: '15', page: String(page) });
    if (status) qs.set('status', status);
    const d = await api.get(`/api/market/admin/orders?${qs.toString()}`);
    setOrders(prev => (page > 1 ? [...prev, ...(d.items || [])] : (d.items || [])));
    setOrderTotal(d.total || 0);
    setOrderStats(d.stats || null);
    setOrderPage(page);
  }, [orderStatus]);

  const loadDisputes = useCallback(async (status = disputeStatus) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    const d = await api.get(`/api/market/admin/disputes?${qs.toString()}`);
    setDisputes(d.items || []);
  }, [disputeStatus]);

  const loadFinance = useCallback(async () => {
    const d = await api.get('/api/market/admin/finance');
    setFinance(d);
  }, []);

  const loadArchives = useCallback(async (kind = archiveKind, keyword = archiveKw) => {
    const qs = new URLSearchParams({ limit: '20', page: '1' });
    if (kind) qs.set('kind', kind);
    if (keyword) qs.set('keyword', keyword);
    const d = await api.get(`/api/market/admin/archives?${qs.toString()}`);
    setArchives(d.items || []);
  }, [archiveKind, archiveKw]);

  const loadAudits = useCallback(async (action = auditAction) => {
    const qs = new URLSearchParams({ limit: '30', page: '1' });
    if (action) qs.set('action', action);
    const d = await api.get(`/api/market/admin/audit?${qs.toString()}`);
    setAudits(d.items || []);
  }, [auditAction]);

  const loadEvents = useCallback(async (status = eventStatus) => {
    const qs = new URLSearchParams({ limit: '30', page: '1' });
    if (status) qs.set('status', status);
    const d = await api.get(`/api/market/admin/notify/events?${qs.toString()}`);
    setEvents(d.items || []);
  }, [eventStatus]);

  const loadReconcile = useCallback(async () => {
    const d = await api.get('/api/market/admin/reconcile');
    setReconcile(d);
  }, []);

  const loadTab = useCallback(async (which) => {
    setLoading(true);
    try {
      if (which === 'stores') await loadStores();
      else if (which === 'config' || which === 'map') await loadConfig();
      else if (which === 'orders') await loadOrders(orderStatus, 1);
      else if (which === 'disputes') await loadDisputes();
      else if (which === 'finance') await loadFinance();
      else if (which === 'archives') await loadArchives();
      else if (which === 'audit') await loadAudits();
      else if (which === 'notify') await loadEvents();
      else if (which === 'reconcile') await loadReconcile();
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [loadStores, loadConfig, loadOrders, orderStatus, loadDisputes, loadFinance, loadArchives, loadAudits, loadEvents, loadReconcile, showToast]);

  useEffect(() => {
    if (isAdmin) loadTab(tab);
  }, [tab, isAdmin, loadTab]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) showToast(okMsg, 'success');
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  // 配置加载后回填地图表单：mapRange.default 是对全部服务器生效的兜底范围
  useEffect(() => {
    if (!config) return;
    setMapRange({ ...DEFAULT_MAP_RANGE, ...(config.mapRange?.default || {}) });
    setMapBackgrounds(config.mapBackgrounds || {});
  }, [config]);

  /* ---------- 地图设置 ---------- */

  /** 表单范围 → 后端要的纯数字结构（少字段一律兜底成 0 / true） */
  const pureRange = (r) => ({
    minX: Number(r.minX) || 0,
    maxX: Number(r.maxX) || 0,
    minZ: Number(r.minZ) || 0,
    maxZ: Number(r.maxZ) || 0,
    flipZ: r.flipZ !== false
  });

  const pickBackground = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBgUploading(true);
    try {
      const url = await uploadImage(file);
      setBgForm(f => ({ ...f, url }));
      showToast('底图上传成功', 'success');
    } catch (err) {
      showToast(err.message || '底图上传失败', 'error');
    } finally {
      setBgUploading(false);
    }
  };

  /** 把当前填写的底图加入待保存列表（真正落库在「保存地图配置」） */
  const addBackground = () => {
    const serverKey = bgForm.serverKey.trim();
    if (!serverKey) { showToast('请填写服务器 key，例如 s115', 'error'); return; }
    if (!bgForm.url) { showToast('请先上传底图', 'error'); return; }
    const key = `${serverKey}|${bgForm.dimension}`;
    if (mapBackgrounds[key] && !confirm(`「${key}」已有底图配置，确定覆盖？`)) return;
    setMapBackgrounds(prev => ({ ...prev, [key]: { url: bgForm.url, ...pureRange(bgForm) } }));
    setPreviewKey(key);
    setBgForm({ serverKey, dimension: bgForm.dimension, url: '', minX: '', maxX: '', minZ: '', maxZ: '', flipZ: bgForm.flipZ });
    showToast('已加入列表，点「保存地图配置」生效', 'info');
  };

  const editBackground = (key) => {
    const bg = mapBackgrounds[key] || {};
    const [serverKey, dimension] = key.split('|');
    setBgForm({
      serverKey: serverKey || '',
      dimension: dimension || 'overworld',
      url: bg.url || '',
      minX: bg.minX ?? '',
      maxX: bg.maxX ?? '',
      minZ: bg.minZ ?? '',
      maxZ: bg.maxZ ?? '',
      flipZ: bg.flipZ !== false
    });
    setPreviewKey(key);
  };

  const removeBackground = (key) => {
    if (!confirm(`确定删除「${key}」的底图与范围？点「保存地图配置」后生效`)) return;
    setMapBackgrounds(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (previewKey === key) setPreviewKey('');
  };

  const saveMapConfig = () => run(async () => {
    // saveConfig 是浅合并：mapRange 要整体回传，这里保留后端已有的服务器级范围，只覆盖 default
    const nextRange = { ...(config?.mapRange || {}), default: pureRange(mapRange) };
    const d = await api.put('/api/market/admin/config', { mapRange: nextRange, mapBackgrounds });
    setConfig(d.config);
    setCfgForm(d.config);
    setCycleDaysEffective(d.cycleDaysEffective);
    await loadConfig();
  }, '地图配置已保存（已写入审计与档案）');

  // 预览：底图叠后端生成的地图画，用来核对范围是否对得上
  const previewBg = previewKey === DRAFT_KEY
    ? { url: bgForm.url, ...pureRange(bgForm) }
    : (previewKey ? mapBackgrounds[previewKey] : null);
  const previewServer = previewKey === DRAFT_KEY ? bgForm.serverKey.trim() : (previewKey ? previewKey.split('|')[0] : '');
  const previewDimension = previewKey === DRAFT_KEY ? bgForm.dimension : (previewKey ? previewKey.split('|')[1] : '');
  const bgKeys = Object.keys(mapBackgrounds);

  if (!isAdmin) {
    return (
      <div className="fade-in-up">
        <div className="section-head"><h2 className="section-title">集市管理后台</h2></div>
        <div className="empty-state">
          <p>无权限：该页面仅管理员（等级 ≥ 1）可访问</p>
          <Link to="/market" className="btn btn-primary">返回集市</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in-up">
      <div className="section-head">
        <h2 className="section-title">集市管理后台</h2>
        <p className="section-desc">审核、费率税务、订单与争议、公会收入分户账、档案与对账</p>
      </div>

      <div className="mk-inline" style={{ marginBottom: 12 }}>
        <Link to="/market" className="btn btn-secondary btn-sm mk-icon-text"><IconArrowLeft size={14} />集市首页</Link>
        <Link to="/market/merchant" className="btn btn-secondary btn-sm">商家后台</Link>
      </div>

      <div className="mk-subnav">
        {TABS.map(t => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {loading && <div className="loading"><div className="spinner" />加载中...</div>}

      {/* ---------- 店铺审核 ---------- */}
      {tab === 'stores' && !loading && (
        <div className="mk-panel">
          <div className="mk-panel-title">店铺（{storeTotal}）</div>
          <form
            className="mk-search"
            onSubmit={e => { e.preventDefault(); run(() => loadStores(storeStatus, storeKw)); }}
          >
            <input className="form-input" placeholder="搜索店铺名" value={storeKw} onChange={e => setStoreKw(e.target.value)} />
            <button className="btn btn-primary" type="submit">搜索</button>
          </form>
          <div className="mk-chips" style={{ marginBottom: 10 }}>
            {['', 'pending', 'active', 'paused', 'grace', 'suspended', 'closed', 'rejected'].map(s => (
              <button key={s || 'all'} className={`mk-chip ${storeStatus === s ? 'active' : ''}`} onClick={() => setStoreStatus(s)}>
                {s ? STORE_STATUS_LABEL[s] : '全部'}
              </button>
            ))}
          </div>

          {stores.length === 0 ? (
            <div className="mk-empty">没有符合条件的店铺</div>
          ) : stores.map(s => (
            <div key={s.id} className="mk-list-row">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  #{s.id} {s.name}
                  <span className={`badge ${s.status === 'active' ? 'badge-success' : s.status === 'pending' ? 'badge-warning' : 'badge-gray'}`} style={{ marginLeft: 6 }}>
                    {STORE_STATUS_LABEL[s.status] || s.status}
                  </span>
                  {s.open_fee_paid > 0 ? <span className="badge badge-gray" style={{ marginLeft: 4 }}>开店费 {fmtPoints(s.open_fee_paid)}</span> : null}
                </div>
                <div className="mk-note">
                  店主 {s.owner_nickname || s.owner_username || '—'}（余额 {fmtPoints(s.owner_contribution)}）
                  {s.category_id ? ` · 分类 #${s.category_id}` : ''}
                </div>
                <div className="mk-note">
                  创建 {formatDate(s.created_at)}
                  {s.expire_at ? ` · 到期 ${formatDate(s.expire_at, false)}` : ''}
                  {s.review_note ? ` · 审核备注：${s.review_note}` : ''}
                </div>
              </div>
              <div className="flex-col gap-2">
                {s.status === 'pending' && (
                  <>
                    <button
                      className="btn btn-success btn-sm"
                      disabled={busy}
                      onClick={() => setDialog({ type: 'review', payload: { store: s, action: 'approve' } })}
                    >
                      通过
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                      onClick={() => setDialog({ type: 'review', payload: { store: s, action: 'reject' } })}
                    >
                      拒绝
                    </button>
                  </>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ type: 'status', payload: { store: s } })}>改状态</button>
                <Link to={`/market/store/${s.id}`} className="btn btn-ghost btn-sm">查看</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- 费率与税务 ---------- */}
      {tab === 'config' && !loading && cfgForm && (
        <>
          <div className="mk-panel">
            <div className="mk-panel-title">
              费率与税务配置
              {cycleDaysEffective ? <span className="badge badge-gray">实际周期 {cycleDaysEffective} 天</span> : null}
            </div>
            <div className="mk-form-grid">
              {CONFIG_FIELDS.map(f => (
                <div className="form-group" key={f.key}>
                  <label className="form-label">{f.label}</label>
                  {f.type === 'bool' ? (
                    <label className="mk-note" style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!cfgForm[f.key]}
                        onChange={e => setCfgForm(c => ({ ...c, [f.key]: e.target.checked }))}
                      />
                      {cfgForm[f.key] ? '已启用' : '未启用'}
                    </label>
                  ) : f.type === 'select' ? (
                    <select className="form-select" value={cfgForm[f.key] ?? ''} onChange={e => setCfgForm(c => ({ ...c, [f.key]: e.target.value }))}>
                      {f.options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                  ) : (
                    <input
                      className="form-input"
                      type="number"
                      step="0.01"
                      value={cfgForm[f.key] ?? ''}
                      onChange={e => setCfgForm(c => ({ ...c, [f.key]: e.target.value === '' ? '' : Number(e.target.value) }))}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mk-inline">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => run(async () => {
                  const body = {};
                  for (const f of CONFIG_FIELDS) {
                    if (cfgForm[f.key] !== undefined) body[f.key] = cfgForm[f.key];
                  }
                  const d = await api.put('/api/market/admin/config', body);
                  setConfig(d.config);
                  setCfgForm(d.config);
                  setCycleDaysEffective(d.cycleDaysEffective);
                  await loadConfig();
                }, '配置已保存（已写入审计与档案）')}
              >
                保存配置
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setCfgForm(config)}>还原</button>
            </div>
            <div className="mk-note" style={{ marginTop: 10 }}>
              公会不设余额账号：开店费、续期费、交易税一经收取即退出流通，只在分户账记账；系统内不存在平台服务费/抽成科目。
            </div>
          </div>

          <div className="mk-panel">
            <div className="mk-panel-title">税费试算器（不落库）</div>
            <div className="mk-inline">
              <input className="form-input" type="number" step="0.01" placeholder="成交额" value={sim.amount} onChange={e => setSim(s => ({ ...s, amount: e.target.value }))} />
              <select className="form-select" value={sim.mode} onChange={e => setSim(s => ({ ...s, mode: e.target.value }))}>
                <option value="merchant">商家承担</option>
                <option value="buyer">买家承担</option>
              </select>
              <input className="form-input" type="number" placeholder="税率 bp（留空用配置值）" value={sim.rateBp} onChange={e => setSim(s => ({ ...s, rateBp: e.target.value }))} />
              <input className="form-input" type="number" step="0.01" placeholder="优惠额" value={sim.discount} onChange={e => setSim(s => ({ ...s, discount: e.target.value }))} />
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => run(async () => {
                  const d = await api.post('/api/market/admin/config/simulate', {
                    amount: Number(sim.amount) || 0,
                    mode: sim.mode,
                    ...(sim.rateBp === '' ? {} : { rateBp: Number(sim.rateBp) }),
                    discount: Number(sim.discount) || 0
                  });
                  setSimOut(d);
                })}
              >
                试算
              </button>
            </div>
            {simOut && (
              <div className="mk-stat-grid" style={{ marginTop: 12 }}>
                <div className="mk-stat"><div className="k">成交额</div><div className="v">{fmtPoints(simOut.amount)}</div></div>
                <div className="mk-stat"><div className="k">税基</div><div className="v">{fmtPoints(simOut.taxBase)}</div></div>
                <div className="mk-stat"><div className="k">税率</div><div className="v">{(Number(simOut.taxBp) / 100).toFixed(2)}%</div></div>
                <div className="mk-stat"><div className="k">交易税</div><div className="v">{fmtPoints(simOut.tax)}</div></div>
                <div className="mk-stat"><div className="k">买家实付</div><div className="v">{fmtPoints(simOut.buyerPay)}</div></div>
                <div className="mk-stat"><div className="k">商家到手</div><div className="v">{fmtPoints(simOut.merchantIncome)}</div></div>
                <div className="mk-stat"><div className="k">公会分户账收入</div><div className="v" style={{ color: 'var(--success)' }}>{fmtPoints(simOut.guildIncome)}</div></div>
                <div className="mk-stat"><div className="k">承担方</div><div className="v" style={{ fontSize: 14 }}>{simOut.taxMode === 'buyer' ? '买家' : '商家'}</div></div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------- 地图设置 ---------- */}
      {tab === 'map' && !loading && (
        <>
          <div className="mk-panel">
            <div className="mk-panel-title">
              <IconMap size={16} />默认投影范围（对全部服务器生效的兜底）
            </div>
            <p className="mk-note" style={{ marginBottom: 10 }}>
              世界坐标会被线性映射到地图的 0–100%：X 按 minX→maxX 对应左→右，Z 按 minZ→maxZ 对应一端到另一端。
              超出该范围的点在地图上会按边界裁剪并标红。下面「服务器|维度」里配了底图的话，优先用那份范围。
            </p>
            <div className="mk-maprange-grid">
              {[['minX', 'minX（地图左边界）'], ['maxX', 'maxX（地图右边界）'], ['minZ', 'minZ'], ['maxZ', 'maxZ']].map(([k, label]) => (
                <div className="form-group" key={k}>
                  <label className="form-label">{label}</label>
                  <input
                    className="form-input"
                    type="number"
                    value={mapRange[k] ?? ''}
                    onChange={e => setMapRange(r => ({ ...r, [k]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <label className="mk-note mk-icon-text" style={{ display: 'flex', paddingTop: 6 }}>
              <input
                type="checkbox"
                checked={mapRange.flipZ !== false}
                onChange={e => setMapRange(r => ({ ...r, flipZ: e.target.checked }))}
              />
              Z 轴翻转（勾选时 minZ 在地图下方、maxZ 在上方；取消勾选则相反）
            </label>
          </div>

          <div className="mk-panel">
            <div className="mk-panel-title">
              <IconImage size={16} />单个「服务器|维度」的底图与范围（{bgKeys.length}）
            </div>
            <p className="mk-note" style={{ marginBottom: 10 }}>
              键名固定为 服务器key|维度，例如 s115|overworld、s115|nether。该键一旦配置，它的范围就优先于上面的默认范围，并作为对应地图的底图。
            </p>

            <fieldset className="mk-fieldset">
              <legend>{bgForm.url ? '新增 / 编辑底图' : '新增底图'}</legend>
              <div className="mk-form-grid">
                <div className="form-group">
                  <label className="form-label">服务器 key *</label>
                  <input
                    className="form-input"
                    value={bgForm.serverKey}
                    onChange={e => setBgForm(f => ({ ...f, serverKey: e.target.value }))}
                    placeholder="例：s115"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">维度</label>
                  <select className="form-select" value={bgForm.dimension} onChange={e => setBgForm(f => ({ ...f, dimension: e.target.value }))}>
                    {DIM_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </div>
              </div>

              <div className="mk-inline">
                {bgForm.url
                  ? <img className="mk-bg-thumb" src={bgForm.url} alt="底图" />
                  : <div className="mk-bg-thumb-ph"><IconImage size={18} /></div>}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm mk-icon-text"
                  onClick={() => bgInputRef.current?.click()}
                  disabled={bgUploading}
                >
                  <IconUpload size={14} />{bgUploading ? '上传中...' : (bgForm.url ? '更换底图' : '上传底图')}
                </button>
                {bgForm.url ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBgForm(f => ({ ...f, url: '' }))}>清除底图</button> : null}
                <input ref={bgInputRef} type="file" accept="image/*" onChange={pickBackground} style={{ display: 'none' }} />
                <span className="mk-note">键名：{`${bgForm.serverKey.trim() || '服务器key'}|${bgForm.dimension}`}</span>
              </div>

              <div className="mk-maprange-grid" style={{ marginTop: 10 }}>
                {[['minX', '该底图的 minX'], ['maxX', '该底图的 maxX'], ['minZ', '该底图的 minZ'], ['maxZ', '该底图的 maxZ']].map(([k, label]) => (
                  <div className="form-group" key={k}>
                    <label className="form-label">{label}</label>
                    <input
                      className="form-input"
                      type="number"
                      value={bgForm[k] ?? ''}
                      onChange={e => setBgForm(f => ({ ...f, [k]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <label className="mk-note mk-icon-text" style={{ display: 'flex', paddingTop: 6 }}>
                <input
                  type="checkbox"
                  checked={bgForm.flipZ !== false}
                  onChange={e => setBgForm(f => ({ ...f, flipZ: e.target.checked }))}
                />
                Z 轴翻转
              </label>

              <div className="mk-inline" style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-primary" onClick={addBackground}>加入列表</button>
                <button type="button" className="btn btn-secondary" onClick={() => setPreviewKey(DRAFT_KEY)}>
                  预览当前填写
                </button>
                {previewKey === DRAFT_KEY ? <span className="mk-note">正在预览尚未保存的内容</span> : null}
              </div>
            </fieldset>

            {bgKeys.length === 0 ? (
              <div className="mk-empty">还没有配置「服务器|维度」底图，地图统一用上面的默认范围</div>
            ) : bgKeys.map(k => {
              const bg = mapBackgrounds[k] || {};
              return (
                <div key={k} className="mk-bg-row">
                  {bg.url
                    ? <img className="mk-bg-thumb" src={bg.url} alt="" />
                    : <div className="mk-bg-thumb-ph"><IconImage size={18} /></div>}
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{k}</div>
                    <div className="mk-note">
                      X {bg.minX} ~ {bg.maxX} · Z {bg.minZ} ~ {bg.maxZ} · {bg.flipZ === false ? '不翻转 Z' : '翻转 Z'}
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => editBackground(k)}>编辑</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPreviewKey(k)}>预览</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeBackground(k)}>删除</button>
                </div>
              );
            })}

            <div className="mk-inline" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" disabled={busy} onClick={saveMapConfig}>保存地图配置</button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => run(loadConfig, '已重新载入配置')}>放弃改动</button>
            </div>
            <div className="mk-note" style={{ marginTop: 8 }}>
              改动先在本地列表里生效，必须点「保存地图配置」才会写入后端；列表中的「删除」同理。
            </div>
          </div>

          <div className="mk-panel">
            <div className="mk-panel-title">
              <IconMap size={16} />预览（底图 + 后端生成的地图画）
            </div>
            {!previewBg || !previewBg.url ? (
              <div className="mk-empty">先在列表里点「预览」，或填好底图后点「预览当前填写」</div>
            ) : (
              <>
                <div className="mk-note" style={{ marginBottom: 8 }}>
                  {previewKey === DRAFT_KEY ? '尚未保存的内容' : previewKey}
                  {' · '}地图画按后端当前保存的范围生成，刚改过范围请先保存再看
                </div>
                <div className="mk-map-preview">
                  <span className="badge badge-gray">底图</span>
                  <img className="bg" src={previewBg.url} alt="底图" />
                  {previewServer && previewDimension ? (
                    <img
                      className="art"
                      src={`/api/market/map/art.png?server=${encodeURIComponent(previewServer)}&dimension=${encodeURIComponent(previewDimension)}`}
                      alt="地图画"
                    />
                  ) : null}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ---------- 订单 ---------- */}
      {tab === 'orders' && !loading && (
        <div className="mk-panel">
          <div className="mk-panel-title">订单（{orderTotal}）</div>
          {orderStats && (
            <div className="mk-stat-grid" style={{ marginBottom: 12 }}>
              <div className="mk-stat"><div className="k">订单总数</div><div className="v">{orderStats.total}</div></div>
              <div className="mk-stat"><div className="k">已结算成交额</div><div className="v">{fmtPoints(orderStats.gmv)}</div></div>
              <div className="mk-stat"><div className="k">已收交易税</div><div className="v">{fmtPoints(orderStats.tax)}</div></div>
              <div className="mk-stat"><div className="k">托管中金额</div><div className="v" style={{ color: 'var(--warning)' }}>{fmtPoints(orderStats.escrow)}</div></div>
            </div>
          )}
          <div className="mk-chips" style={{ marginBottom: 10 }}>
            {ORDER_TABS.map(s => (
              <button key={s || 'all'} className={`mk-chip ${orderStatus === s ? 'active' : ''}`} onClick={() => setOrderStatus(s)}>
                {s ? ORDER_STATUS_LABEL[s] : '全部'}
              </button>
            ))}
          </div>
          {orders.length === 0 ? (
            <div className="mk-empty">没有该状态的订单</div>
          ) : orders.map(o => (
            <div key={o.id} className="mk-list-row">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {o.order_no}
                  <span className="badge badge-gray" style={{ marginLeft: 6 }}>{ORDER_STATUS_LABEL[o.status] || o.status}</span>
                  {o.open_dispute ? <span className="badge badge-danger" style={{ marginLeft: 4 }}>有争议</span> : null}
                </div>
                <div className="mk-note">
                  {o.store_name || '—'} · 买家 {o.buyer_nickname || '—'} · 实付 {fmtPoints(o.buyer_pay)} · 税 {fmtPoints(o.tax_amount)} · 商家收入 {fmtPoints(o.merchant_income)}
                </div>
                <div className="mk-note">{formatDate(o.created_at)}{o.code_used_at ? ` · 核销 ${formatDate(o.code_used_at)}` : ''}</div>
              </div>
              {o.status !== 'refunded' && o.status !== 'cancelled' && (
                <button
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={() => setDialog({ type: 'refund', payload: { order: o } })}
                >
                  人工退款
                </button>
              )}
            </div>
          ))}
          {orders.length < orderTotal && (
            <div className="mk-loadmore">
              <button className="btn btn-secondary" disabled={busy} onClick={() => run(() => loadOrders(orderStatus, orderPage + 1))}>加载更多</button>
            </div>
          )}
        </div>
      )}

      {/* ---------- 争议 ---------- */}
      {tab === 'disputes' && !loading && (
        <div className="mk-panel">
          <div className="mk-panel-title">争议裁决（{disputes.length}）</div>
          <div className="mk-chips" style={{ marginBottom: 10 }}>
            {[['open', '处理中'], ['resolved', '已裁决'], ['', '全部']].map(([v, label]) => (
              <button key={v || 'all'} className={`mk-chip ${disputeStatus === v ? 'active' : ''}`} onClick={() => setDisputeStatus(v)}>{label}</button>
            ))}
          </div>
          {disputes.length === 0 ? (
            <div className="mk-empty">没有争议记录</div>
          ) : disputes.map(d => (
            <div key={d.id} className="mk-list-row">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  争议 #{d.id} · 订单 {d.order_no}
                  <span className={`badge ${d.status === 'open' ? 'badge-danger' : 'badge-gray'}`} style={{ marginLeft: 6 }}>{d.status === 'open' ? '处理中' : '已裁决'}</span>
                </div>
                <div className="mk-note">
                  {d.store_name} · 发起人 {d.opener_nickname || '—'} · 订单状态 {ORDER_STATUS_LABEL[d.order_status] || d.order_status} · 实付 {fmtPoints(d.buyer_pay)} · 商家收入 {fmtPoints(d.merchant_income)}
                </div>
                {d.reason && <div className="mk-note">理由：{d.reason}</div>}
                {d.note ? <div className="mk-note">裁决说明：{d.note}</div> : null}
                <div className="mk-note">{formatDate(d.created_at)}</div>
              </div>
              {d.status === 'open' && (
                <button className="btn btn-primary btn-sm" onClick={() => setDialog({ type: 'dispute', payload: { dispute: d } })}>裁决</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---------- 公会分户账 ---------- */}
      {tab === 'finance' && !loading && finance && (
        <>
          <div className="mk-panel">
            <div className="mk-panel-title">公会收入分户账</div>
            <div className="mk-note mk-icon-text" style={{ marginBottom: 10, color: 'var(--danger)', fontWeight: 600 }}>
              <IconWarn size={15} />公会不设余额账号，收入只记账（三类：开店费 / 续期费 / 交易税）
            </div>
            <div className="mk-stat-grid">
              <div className="mk-stat"><div className="k">开店费</div><div className="v">{fmtPoints(finance.income.openFee)}</div></div>
              <div className="mk-stat"><div className="k">续期费</div><div className="v">{fmtPoints(finance.income.renewFee)}</div></div>
              <div className="mk-stat"><div className="k">交易税</div><div className="v">{fmtPoints(finance.income.tax)}</div></div>
              <div className="mk-stat"><div className="k">开店费冲回</div><div className="v">{fmtPoints(finance.income.refundFee)}</div></div>
              <div className="mk-stat"><div className="k">交易税冲回</div><div className="v">{fmtPoints(finance.income.refundTax)}</div></div>
              <div className="mk-stat"><div className="k">调账入账</div><div className="v">{fmtPoints(finance.income.adjustIn)}</div></div>
              <div className="mk-stat"><div className="k">调账出账</div><div className="v">{fmtPoints(finance.income.adjustOut)}</div></div>
              <div className="mk-stat"><div className="k">分户账净额</div><div className="v" style={{ color: 'var(--success)' }}>{fmtPoints(finance.income.net)}</div></div>
            </div>
            <div className="mk-note" style={{ marginTop: 10 }}>
              业务事实口径对账：
              <Check ok={finance.facts.balanced} label={finance.facts.balanced ? '分户账与业务事实一致' : '存在差异'} />
              <br />
              交易税净额 {fmtPoints(finance.facts.taxNet)} / 已结算订单税 {fmtPoints(finance.facts.settledTax)}（差 {fmtPoints(finance.facts.taxDiff)}）；
              开店费净额 {fmtPoints(finance.facts.openFeeNet)} / 店铺已付 {fmtPoints(finance.facts.storeOpenFee)}（差 {fmtPoints(finance.facts.openFeeDiff)}）；
              续期费 {fmtPoints(finance.income.renewFee)} / 扣费记录 {fmtPoints(finance.facts.renewPaid)}（差 {fmtPoints(finance.facts.renewDiff)}）
            </div>
          </div>

          <div className="mk-panel">
            <div className="mk-panel-title">托管账号（交易款代持，非公会收入）</div>
            {finance.accounts?.escrow ? (
              <div className="mk-stat-grid">
                <div className="mk-stat"><div className="k">账号</div><div className="v" style={{ fontSize: 14 }}>{finance.accounts.escrow.nickname || finance.accounts.escrow.username}</div></div>
                <div className="mk-stat"><div className="k">余额（应等于未结算订单）</div><div className="v">{fmtPoints(finance.accounts.escrow.balance)}</div></div>
              </div>
            ) : <div className="mk-empty">托管账号不存在</div>}
          </div>

          <div className="mk-panel">
            <div className="mk-panel-title">按科目月度汇总</div>
            {finance.monthly.length === 0 ? <div className="mk-empty">暂无数据</div> : (
              <div className="mk-table-wrap">
                <table className="table">
                  <thead><tr><th>月份</th><th>科目</th><th>净额</th><th>笔数</th></tr></thead>
                  <tbody>
                    {finance.monthly.map((m, i) => (
                      <tr key={`${m.ym}-${m.kind}-${i}`}><td>{m.ym}</td><td>{m.kind}</td><td>{fmtPoints(m.net)}</td><td>{m.cnt}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mk-panel">
            <div className="mk-panel-title">分户账明细（最近 50 笔）</div>
            {finance.recent.length === 0 ? <div className="mk-empty">暂无记录</div> : (
              <div className="mk-table-wrap">
                <table className="table">
                  <thead><tr><th>时间</th><th>科目</th><th>方向</th><th>金额</th><th>备注</th></tr></thead>
                  <tbody>
                    {finance.recent.map(r => (
                      <tr key={r.id}>
                        <td>{formatDate(r.created_at)}</td>
                        <td>{r.kind}</td>
                        <td>{r.direction === 'in' ? '入账' : '冲回'}</td>
                        <td>{fmtPoints(r.amount)}</td>
                        <td>{r.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mk-note" style={{ marginTop: 10 }}>{finance.note}</div>
          </div>
        </>
      )}

      {/* ---------- 手工调账 ---------- */}
      {tab === 'adjust' && !loading && (
        <div className="mk-panel">
          <div className="mk-panel-title">手工调账</div>
          <p className="mk-note" style={{ marginBottom: 10 }}>
            入账 = 从指定用户余额扣除并记入公会分户账；出账 = 冲回，把贡献点补到指定用户余额。必须选择用户并填写理由。
          </p>
          <div className="mk-form-grid">
            <div className="form-group">
              <label className="form-label">用户 ID *</label>
              <input className="form-input" type="number" value={adjust.user_id} onChange={e => setAdjust(a => ({ ...a, user_id: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">金额 *</label>
              <input className="form-input" type="number" step="0.01" value={adjust.amount} onChange={e => setAdjust(a => ({ ...a, amount: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">方向 *</label>
              <select className="form-select" value={adjust.direction} onChange={e => setAdjust(a => ({ ...a, direction: e.target.value }))}>
                <option value="in">入账（公会收入，扣用户余额）</option>
                <option value="out">出账（冲回，补用户余额）</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">理由 *（必填）</label>
            <textarea className="form-textarea" value={adjust.note} onChange={e => setAdjust(a => ({ ...a, note: e.target.value }))} placeholder="例：补扣 8 月漏记的续期费" />
          </div>
          {adjustUser && <div className="mk-note">已选用户：#{adjustUser.id} {adjustUser.nickname || adjustUser.username || ''}（余额 {fmtPoints(adjustUser.contribution)}）</div>}
          <div className="mk-inline">
            <input className="form-input" placeholder="按用户名 / 昵称 / ID 搜人" value={userQuery} onChange={e => setUserQuery(e.target.value)} />
            <button
              className="btn btn-secondary"
              disabled={busy || !userQuery.trim()}
              onClick={() => run(async () => {
                const d = await api.get(`/api/donation/admin/search-users?q=${encodeURIComponent(userQuery.trim())}`);
                setUserResults(d.users || []);
                if ((d.users || []).length === 0) showToast('没有匹配的用户', 'info');
              })}
            >
              查询用户
            </button>
          </div>
          {userResults.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {userResults.map(u => (
                <div key={u.id} className="mk-list-row">
                  <img
                    src={u.avatar || '/images/default-avatar.png'}
                    alt=""
                    style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }}
                    onError={e => { e.currentTarget.src = '/images/default-avatar.png'; }}
                  />
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>#{u.id} {u.nickname || u.username}</div>
                    <div className="mk-note">余额 {fmtPoints(u.contribution)}</div>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setAdjust(a => ({ ...a, user_id: String(u.id) }));
                      setAdjustUser(u);
                      setUserResults([]);
                    }}
                  >
                    选择
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mk-inline">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => run(async () => {
                if (!adjust.user_id || !adjust.note.trim() || !(Number(adjust.amount) > 0)) {
                  throw new Error('用户、金额、理由都必须填写');
                }
                const d = await api.post('/api/market/admin/finance/adjust', {
                  user_id: Number(adjust.user_id),
                  amount: Number(adjust.amount),
                  direction: adjust.direction,
                  note: adjust.note.trim()
                });
                showToast(`调账成功：${d.direction === 'in' ? '入账' : '出账'} ${fmtPoints(d.amount)}（凭证 ${d.idem_key}）`, 'success');
                setAdjust({ user_id: '', amount: '', direction: 'in', note: '' });
                setAdjustUser(null);
                setUserQuery('');
                setUserResults([]);
              })}
            >
              提交调账
            </button>
          </div>
        </div>
      )}

      {/* ---------- 档案检索 ---------- */}
      {tab === 'archives' && !loading && (
        <div className="mk-panel">
          <div className="mk-panel-title">档案检索（{archives.length}）</div>
          <form className="mk-search" onSubmit={e => { e.preventDefault(); run(() => loadArchives(archiveKind, archiveKw)); }}>
            <input className="form-input" placeholder="档案号 / 标题 / 摘要关键词" value={archiveKw} onChange={e => setArchiveKw(e.target.value)} />
            <button className="btn btn-primary" type="submit">检索</button>
          </form>
          <div className="mk-chips" style={{ marginBottom: 10 }}>
            {[['', '全部'], ['store', '商铺档案'], ['ledger', '账本档案']].map(([v, label]) => (
              <button key={v || 'all'} className={`mk-chip ${archiveKind === v ? 'active' : ''}`} onClick={() => setArchiveKind(v)}>{label}</button>
            ))}
          </div>
          {archives.length === 0 ? <div className="mk-empty">没有档案</div> : archives.map(a => (
            <div key={a.archive_no} className="mk-list-row">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{a.archive_no} · {a.title}</div>
                <div className="mk-note">{a.summary}</div>
                <div className="mk-note">{a.kind} / {a.ref_type} #{a.ref_id} · {formatDate(a.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- 审计日志 ---------- */}
      {tab === 'audit' && !loading && (
        <div className="mk-panel">
          <div className="mk-panel-title">审计日志（最近 {audits.length} 条）</div>
          <div className="mk-inline" style={{ marginBottom: 10 }}>
            <input className="form-input" placeholder="按 action 过滤，如 store_approve / config_update" value={auditAction} onChange={e => setAuditAction(e.target.value)} />
            <button className="btn btn-secondary" disabled={busy} onClick={() => run(() => loadAudits(auditAction))}>过滤</button>
          </div>
          {audits.length === 0 ? <div className="mk-empty">没有日志</div> : (
            <div className="mk-table-wrap">
              <table className="table">
                <thead><tr><th>时间</th><th>操作</th><th>对象</th><th>操作人</th><th>说明</th></tr></thead>
                <tbody>
                  {audits.map(a => (
                    <tr key={a.id}>
                      <td>{formatDate(a.created_at)}</td>
                      <td>{a.action}</td>
                      <td>{a.target_type} #{a.target_id}</td>
                      <td>{a.operator_nickname || a.operator_id}</td>
                      <td>{a.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---------- 通知与任务 ---------- */}
      {tab === 'notify' && !loading && (
        <>
          <div className="mk-panel">
            <div className="mk-panel-title">定时任务与通知投递</div>
            <div className="mk-inline">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => run(async () => {
                  const d = await api.post('/api/market/admin/jobs/run', {});
                  showToast(`定时任务已执行：${JSON.stringify(d.result).slice(0, 160)}`, 'success');
                })}
              >
                一键跑定时任务
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => run(async () => {
                  const d = await api.post('/api/market/admin/notify/dispatch', { limit: 50 });
                  showToast(`通知投递完成：${JSON.stringify(d.result).slice(0, 160)}`, 'success');
                  await loadEvents(eventStatus);
                })}
              >
                手动投递通知队列
              </button>
            </div>
          </div>

          <div className="mk-panel">
            <div className="mk-panel-title">通知事件排查（{events.length}）</div>
            <div className="mk-chips" style={{ marginBottom: 10 }}>
              {[['', '全部'], ['pending', '待投递'], ['sent', '已投递'], ['failed', '失败']].map(([v, label]) => (
                <button key={v || 'all'} className={`mk-chip ${eventStatus === v ? 'active' : ''}`} onClick={() => setEventStatus(v)}>{label}</button>
              ))}
            </div>
            {events.length === 0 ? <div className="mk-empty">没有事件</div> : events.map(ev => (
              <div key={ev.id} className="mk-list-row">
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>
                    #{ev.id} {ev.event_type}
                    <span className={`badge ${ev.status === 'sent' ? 'badge-success' : ev.status === 'failed' ? 'badge-danger' : 'badge-warning'}`} style={{ marginLeft: 6 }}>{ev.status}</span>
                  </div>
                  <div className="mk-note">
                    event_key {ev.event_key} · user #{ev.user_id} · 渠道 {ev.channels || '—'}
                    {ev.attempts !== undefined ? ` · 尝试 ${ev.attempts}` : ''}
                    {ev.last_error ? ` · 错误：${ev.last_error}` : ''}
                  </div>
                  <div className="mk-note">{formatDate(ev.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------- 对账自检 ---------- */}
      {tab === 'reconcile' && !loading && reconcile && (
        <div className="mk-panel">
          <div className="mk-panel-title">
            对账自检
            <Check ok={reconcile.ok} label={reconcile.ok ? '全部平衡' : '存在差异'} />
          </div>

          <div className="mk-stat-grid">
            <div className="mk-stat">
              <div className="k">托管余额</div>
              <div className="v">{fmtPoints(reconcile.escrow.balance)}</div>
              <div className="k">未结算订单 {fmtPoints(reconcile.escrow.pendingOrders)}</div>
            </div>
            <div className="mk-stat">
              <div className="k">交易税（分户账 / 订单）</div>
              <div className="v" style={{ fontSize: 14 }}>{fmtPoints(reconcile.tax.ledger)} / {fmtPoints(reconcile.tax.settledOrders)}</div>
              <div className="k">{reconcile.tax.balanced ? '一致' : `差 ${fmtPoints(reconcile.tax.diff)}`}</div>
            </div>
            <div className="mk-stat">
              <div className="k">开店费（分户账 / 店铺）</div>
              <div className="v" style={{ fontSize: 14 }}>{fmtPoints(reconcile.openFee.ledger)} / {fmtPoints(reconcile.openFee.stores)}</div>
              <div className="k">{reconcile.openFee.balanced ? '一致' : `差 ${fmtPoints(reconcile.openFee.diff)}`}</div>
            </div>
            <div className="mk-stat">
              <div className="k">续期费（分户账 / 扣费记录）</div>
              <div className="v" style={{ fontSize: 14 }}>{fmtPoints(reconcile.renewFee.ledger)} / {fmtPoints(reconcile.renewFee.feeLedgerPaid)}</div>
              <div className="k">{reconcile.renewFee.balanced ? '一致' : `差 ${fmtPoints(reconcile.renewFee.diff)}`}</div>
            </div>
            <div className="mk-stat">
              <div className="k">分户账净额</div>
              <div className="v">{fmtPoints(reconcile.financeLedgerNet)}</div>
            </div>
            <div className="mk-stat">
              <div className="k">账本行数 / 异常</div>
              <div className="v" style={{ fontSize: 14 }}>
                {reconcile.ledger.rows} / 金额 {reconcile.ledger.badAmount} · 科目 {reconcile.ledger.badKind} · 方向 {reconcile.ledger.badDirection}
              </div>
            </div>
          </div>

          <div className="mk-note" style={{ marginTop: 10 }}>
            {reconcile.note}
          </div>
          <div className="mk-inline" style={{ marginTop: 10 }}>
            <button className="btn btn-secondary" disabled={busy} onClick={() => run(loadReconcile, '已重新对账')}>重新对账</button>
          </div>
        </div>
      )}

      {/* ---------- 弹窗：审核 ---------- */}
      {dialog?.type === 'review' && (
        <Dialog
          title={dialog.payload.action === 'approve' ? '通过店铺审核' : '拒绝店铺审核'}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDialog(null)}>取消</button>
              <button
                className={`btn ${dialog.payload.action === 'approve' ? 'btn-success' : 'btn-danger'}`}
                disabled={busy}
                onClick={() => {
                  const note = dialog.note || '';
                  run(async () => {
                    await api.post(`/api/market/admin/stores/${dialog.payload.store.id}/review`, { action: dialog.payload.action, note });
                    showToast(dialog.payload.action === 'approve' ? '已通过，店铺开始营业' : '已拒绝，开店费将退还', 'success');
                    setDialog(null);
                    await loadStores();
                  });
                }}
              >
                确认{dialog.payload.action === 'approve' ? '通过' : '拒绝'}
              </button>
            </>
          }
        >
          <p className="mk-note" style={{ marginBottom: 8 }}>
            店铺 #{dialog.payload.store.id}「{dialog.payload.store.name}」· 店主 {dialog.payload.store.owner_nickname || dialog.payload.store.owner_username}
            {dialog.payload.action === 'reject' ? '（拒绝会退还未冲回的开店费）' : ''}
          </p>
          <textarea
            className="form-textarea"
            placeholder="审核备注（可空）"
            value={dialog.note || ''}
            onChange={e => setDialog(d => ({ ...d, note: e.target.value }))}
          />
        </Dialog>
      )}

      {/* ---------- 弹窗：店铺状态 ---------- */}
      {dialog?.type === 'status' && (
        <Dialog
          title={`变更店铺状态：${dialog.payload.store.name}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDialog(null)}>取消</button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => run(async () => {
                  if (!dialog.status) throw new Error('请选择状态');
                  await api.post(`/api/market/admin/stores/${dialog.payload.store.id}/status`, { status: dialog.status, note: dialog.note || '' });
                  showToast('店铺状态已更新', 'success');
                  setDialog(null);
                  await loadStores();
                })}
              >
                确认变更
              </button>
            </>
          }
        >
          <div className="form-group">
            <label className="form-label">新状态</label>
            <select className="form-select" value={dialog.status || 'active'} onChange={e => setDialog(d => ({ ...d, status: e.target.value }))}>
              {['active', 'paused', 'suspended', 'closed'].map(s => <option key={s} value={s}>{STORE_STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">原因 / 说明</label>
            <textarea className="form-textarea" value={dialog.note || ''} onChange={e => setDialog(d => ({ ...d, note: e.target.value }))} />
          </div>
          <div className="mk-note">设为「欠费暂停」或「已关闭」会自动下架该店商品。</div>
        </Dialog>
      )}

      {/* ---------- 弹窗：人工退款 ---------- */}
      {dialog?.type === 'refund' && (
        <Dialog
          title={`人工退款：${dialog.payload.order.order_no}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDialog(null)}>取消</button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => run(async () => {
                  await api.post(`/api/market/admin/orders/${dialog.payload.order.id}/refund`, {
                    ...(dialog.amount === undefined || dialog.amount === '' ? {} : { amount: Number(dialog.amount) }),
                    reason: dialog.note || '管理员人工退款'
                  });
                  showToast('退款已执行', 'success');
                  setDialog(null);
                  await loadOrders(orderStatus, 1);
                })}
              >
                确认退款
              </button>
            </>
          }
        >
          <p className="mk-note" style={{ marginBottom: 8 }}>
            状态 {ORDER_STATUS_LABEL[dialog.payload.order.status] || dialog.payload.order.status} · 买家实付 {fmtPoints(dialog.payload.order.buyer_pay)}
            {dialog.payload.order.status === 'settled' ? '（已结算订单将从商家余额冲回）' : ''}
          </p>
          <div className="form-group">
            <label className="form-label">退款金额（留空 = 全额）</label>
            <input className="form-input" type="number" step="0.01" value={dialog.amount ?? ''} onChange={e => setDialog(d => ({ ...d, amount: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">退款理由</label>
            <textarea className="form-textarea" value={dialog.note || ''} onChange={e => setDialog(d => ({ ...d, note: e.target.value }))} />
          </div>
        </Dialog>
      )}

      {/* ---------- 弹窗：争议裁决 ---------- */}
      {dialog?.type === 'dispute' && (
        <Dialog
          title={`争议裁决 #${dialog.payload.dispute.id}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDialog(null)}>取消</button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => run(async () => {
                  if (!dialog.result) throw new Error('请选择裁决结果');
                  await api.post(`/api/market/admin/disputes/${dialog.payload.dispute.id}/resolve`, {
                    result: dialog.result,
                    ...(dialog.refund_amount === undefined || dialog.refund_amount === '' ? {} : { refund_amount: Number(dialog.refund_amount) }),
                    note: dialog.note || ''
                  });
                  showToast('裁决已提交', 'success');
                  setDialog(null);
                  await loadDisputes();
                })}
              >
                提交裁决
              </button>
            </>
          }
        >
          <p className="mk-note" style={{ marginBottom: 8 }}>
            订单 {dialog.payload.dispute.order_no} · 实付 {fmtPoints(dialog.payload.dispute.buyer_pay)} · 商家收入 {fmtPoints(dialog.payload.dispute.merchant_income)}
          </p>
          <div className="form-group">
            <label className="form-label">裁决结果</label>
            <select className="form-select" value={dialog.result || 'refund'} onChange={e => setDialog(d => ({ ...d, result: e.target.value }))}>
              <option value="refund">退款给买家（订单转已退款）</option>
              <option value="settle">维持交易（结算给商家）</option>
            </select>
          </div>
          {dialog.result !== 'settle' && (
            <div className="form-group">
              <label className="form-label">退款金额（留空 = 全额）</label>
              <input className="form-input" type="number" step="0.01" value={dialog.refund_amount ?? ''} onChange={e => setDialog(d => ({ ...d, refund_amount: e.target.value }))} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">裁决说明</label>
            <textarea className="form-textarea" value={dialog.note || ''} onChange={e => setDialog(d => ({ ...d, note: e.target.value }))} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
