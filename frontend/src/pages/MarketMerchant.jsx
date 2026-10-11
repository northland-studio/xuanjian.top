import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, uploadImage } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { IconArrowLeft, IconCheck, IconClose, IconPackage, Stars } from '../components/MarketIcons';
import { requireLogin, formatDate, fmtPoints } from '../utils';
import { marketTags } from '../market/helpers';
import '../styles/market.css';

const TABS = [
  { key: 'store', label: '店铺' },
  { key: 'locations', label: '位置' },
  { key: 'products', label: '商品' },
  { key: 'orders', label: '订单' },
  { key: 'reviews', label: '评价' },
  { key: 'verify', label: '核销台' },
  { key: 'refunds', label: '退款' },
  { key: 'finance', label: '经营账务' }
];

const DIM_LABEL = { overworld: '主世界', nether: '下界', end: '末地', custom: '自定义' };
const STORE_STATUS_LABEL = { pending: '待审核', active: '营业中', paused: '暂停营业', grace: '续费宽限期', suspended: '欠费暂停', closed: '已关闭', rejected: '审核未通过' };
const ORDER_STATUS_LABEL = {
  pending_payment: '待付款', paid: '已付款·待核销', delivered: '已核销·待履约', awaiting_confirm: '待确认收货', settled: '已完成',
  cancelled: '已取消', refunding: '退款处理中', refunded: '已退款', disputed: '争议处理中', expired: '已过期'
};
const ORDER_TABS = ['', 'paid', 'delivered', 'awaiting_confirm', 'settled', 'refunding', 'disputed', 'refunded', 'cancelled'];

/** 单图上传（七牛直传），value 为 URL */
function ImageField({ label, value, onChange, hint }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const inputRef = useRef(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setPercent(0);
    try {
      const url = await uploadImage(file, setPercent);
      onChange(url);
      showToast('图片上传成功', 'success');
    } catch (err) {
      showToast(err.message || '上传失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div className="mk-inline">
        {value ? <img src={value} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} /> : null}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? `上传中 ${percent}%` : (value ? '更换图片' : '上传图片')}
        </button>
        {value && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}>清除</button>}
        <input ref={inputRef} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
      </div>
      {hint && <div className="mk-note" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function MultiImageField({ label, values, onChange, max = 8 }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    try {
      const next = [...values];
      for (const f of files) {
        if (next.length >= max) break;
        const url = await uploadImage(f);
        next.push(url);
      }
      onChange(next);
    } catch (err) {
      showToast(err.message || '上传失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-group">
      <label className="form-label">{label}（最多 {max} 张）</label>
      <div className="mk-thumb-strip">
        {values.map((u, i) => (
          <div className="mk-thumb" key={`${u}-${i}`}>
            <img src={u} alt="" />
            <button type="button" onClick={() => onChange(values.filter((_, idx) => idx !== i))} aria-label="移除图片" title="移除图片"><IconClose size={12} /></button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} disabled={busy || values.length >= max}>
          {busy ? '上传中...' : '添加图片'}
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple onChange={pick} style={{ display: 'none' }} />
      </div>
    </div>
  );
}

export default function MarketMerchant() {
  const navigate = useNavigate();
  const { user, refreshMe } = useAuth();
  const { showToast } = useToast();

  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState('store');
  const [stores, setStores] = useState([]);
  const [fees, setFees] = useState({});
  const [storeId, setStoreId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 开店表单
  const [openForm, setOpenForm] = useState({ name: '', intro: '', category_id: '', tags: '', cover: '', avatar: '' });
  // 店铺资料
  const [storeForm, setStoreForm] = useState(null);
  // 位置
  const [locations, setLocations] = useState([]);
  const [locForm, setLocForm] = useState(null);
  // 商品
  const [products, setProducts] = useState([]);
  const [productForm, setProductForm] = useState(null);
  // 订单
  const [orders, setOrders] = useState([]);
  const [orderStatus, setOrderStatus] = useState('');
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  // 核销
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyOut, setVerifyOut] = useState(null);
  // 退款
  const [refunds, setRefunds] = useState([]);
  // 评价管理
  const [reviews, setReviews] = useState([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewStat, setReviewStat] = useState(null); // 店铺评分汇总（隐藏/恢复后同步刷新）
  const [replyDraft, setReplyDraft] = useState({});   // reviewId -> 待提交的回复文本
  const [replyOpen, setReplyOpen] = useState({});     // reviewId -> 回复框是否展开
  // 经营账
  const [finance, setFinance] = useState(null);

  const store = useMemo(() => stores.find(s => Number(s.id) === Number(storeId)) || null, [stores, storeId]);
  const categories = cfg?.categories?.store || [];
  const productCategories = cfg?.categories?.product || [];

  useEffect(() => {
    api.get('/api/market/config').then(setCfg).catch(() => {});
  }, []);

  const loadStores = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get('/api/market/merchant/stores');
      const list = d.stores || [];
      setStores(list);
      setFees(d.fees || {});
      setStoreId(prev => {
        if (prev && list.some(s => Number(s.id) === Number(prev))) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      showToast(e.message || '加载店铺失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    loadStores();
  }, [user, loadStores]);

  useEffect(() => {
    if (!store) { setStoreForm(null); return; }
    setStoreForm({
      name: store.name || '',
      intro: store.intro || '',
      notice: store.notice || '',
      category_id: store.category_id ? String(store.category_id) : '',
      tags: marketTags(store.tags).join(','),
      cover: store.cover || '',
      avatar: store.avatar || ''
    });
  }, [store]);

  const loadLocations = useCallback(async (id) => {
    const d = await api.get(`/api/market/stores/${id}`);
    setLocations(d.store?.locations || []);
  }, []);

  const loadProducts = useCallback(async (id) => {
    const d = await api.get(`/api/market/merchant/products?store_id=${id}`);
    setProducts(d.items || []);
  }, []);

  const loadOrders = useCallback(async (id, status, page = 1) => {
    const qs = new URLSearchParams({ store_id: String(id), limit: '10', page: String(page) });
    if (status) qs.set('status', status);
    const d = await api.get(`/api/market/merchant/orders?${qs.toString()}`);
    setOrders(prev => (page > 1 ? [...prev, ...(d.items || [])] : (d.items || [])));
    setOrderTotal(d.total || 0);
    setOrderPage(page);
  }, []);

  const loadRefunds = useCallback(async (id) => {
    // 退款申请从订单详情聚合：拉取 refunding 状态的订单，再取各自退款单
    const d = await api.get(`/api/market/merchant/orders?store_id=${id}&status=refunding&limit=30&page=1`);
    const rows = d.items || [];
    const out = [];
    for (const o of rows) {
      try {
        const detail = await api.get(`/api/market/orders/${o.id}`);
        for (const r of (detail.refunds || [])) {
          if (r.status === 'pending') out.push({ ...r, order_no: o.order_no, buyer: o.buyer_nickname || o.buyer_username, buyer_pay: o.buyer_pay });
        }
      } catch { /* 忽略单条失败 */ }
    }
    setRefunds(out);
  }, []);

  const loadReviews = useCallback(async (id, page = 1) => {
    const qs = new URLSearchParams({ store_id: String(id), limit: '10', page: String(page) });
    const d = await api.get(`/api/market/merchant/reviews?${qs.toString()}`);
    const list = d.items || [];
    setReviews(prev => (page > 1 ? [...prev, ...list] : list));
    setReviewTotal(d.total || 0);
    setReviewPage(page);
    setReviewStat(d.store || null);
    // 仅预填尚未编辑过的条目，避免正在输入的内容被刷新覆盖
    setReplyDraft(prev => {
      const next = { ...prev };
      for (const r of list) if (next[r.id] === undefined) next[r.id] = r.reply || '';
      return next;
    });
    return d;
  }, []);

  const loadFinance = useCallback(async (id) => {
    const d = await api.get(`/api/market/merchant/finance?store_id=${id}`);
    setFinance(d);
  }, []);

  const reloadTab = useCallback(async (which = tab) => {
    if (!storeId) return;
    try {
      if (which === 'locations') await loadLocations(storeId);
      else if (which === 'products') await loadProducts(storeId);
      else if (which === 'orders') await loadOrders(storeId, orderStatus, 1);
      else if (which === 'reviews') await loadReviews(storeId, 1);
      else if (which === 'refunds') await loadRefunds(storeId);
      else if (which === 'finance') await loadFinance(storeId);
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
    }
  }, [storeId, tab, orderStatus, loadLocations, loadProducts, loadOrders, loadReviews, loadRefunds, loadFinance, showToast]);

  useEffect(() => { reloadTab(tab); }, [tab, storeId, reloadTab]);

  const applyStore = (updated) => {
    setStores(prev => prev.map(s => (Number(s.id) === Number(updated.id) ? { ...s, ...updated } : s)));
  };

  /* ---------- 开店 ---------- */
  const createStore = async (e) => {
    e.preventDefault();
    if (!openForm.name.trim()) { showToast('请填写店铺名称', 'error'); return; }
    setBusy(true);
    try {
      const d = await api.post('/api/market/merchant/stores', {
        name: openForm.name.trim(),
        intro: openForm.intro,
        category_id: openForm.category_id ? Number(openForm.category_id) : undefined,
        tags: openForm.tags ? openForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        cover: openForm.cover,
        avatar: openForm.avatar
      });
      showToast(d.message || '开店申请已提交', 'success');
      setOpenForm({ name: '', intro: '', category_id: '', tags: '', cover: '', avatar: '' });
      refreshMe?.();
      await loadStores();
      setTab('store');
    } catch (err) {
      showToast(err.message || '申请开店失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 店铺资料 ---------- */
  const saveStore = async () => {
    if (!storeForm) return;
    setBusy(true);
    try {
      const d = await api.put(`/api/market/merchant/stores/${storeId}`, {
        name: storeForm.name,
        intro: storeForm.intro,
        notice: storeForm.notice,
        category_id: storeForm.category_id ? Number(storeForm.category_id) : null,
        tags: storeForm.tags ? storeForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        cover: storeForm.cover,
        avatar: storeForm.avatar
      });
      applyStore(d.store);
      showToast('店铺资料已保存', 'success');
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const renew = async () => {
    if (!confirm(`续费 ${fmtPoints(fees.renewFee || 0)} 贡献点，续期 ${fees.cycleDays || 30} 天。确定继续？`)) return;
    setBusy(true);
    try {
      const d = await api.post(`/api/market/merchant/stores/${storeId}/renew`, {});
      applyStore(d.store);
      showToast(`续费成功，有效期至 ${formatDate(d.periodTo, false)}${d.resumed ? `，恢复 ${d.resumed} 件商品` : ''}`, 'success');
      refreshMe?.();
    } catch (e) {
      showToast(e.message || '续费失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleBusiness = async () => {
    const next = store.status === 'paused' ? 'active' : 'paused';
    const label = next === 'paused' ? '暂停营业' : '恢复营业';
    if (!confirm(`确定${label}？`)) return;
    setBusy(true);
    try {
      const d = await api.post(`/api/market/merchant/stores/${storeId}/status`, { status: next });
      applyStore(d.store);
      showToast(`已${label}`, 'success');
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 位置 ---------- */
  const emptyLoc = () => ({
    id: null, server_key: 's115', server_name: '', dimension: 'overworld', dimension_custom: '',
    x: 0, y: 64, z: 0, label: '', note: '', is_public: true
  });

  const saveLocation = async (e) => {
    e.preventDefault();
    if (!locForm) return;
    setBusy(true);
    try {
      const body = {
        server_key: locForm.server_key,
        server_name: locForm.server_name,
        dimension: locForm.dimension,
        dimension_custom: locForm.dimension_custom,
        x: Number(locForm.x) || 0,
        y: Number(locForm.y) || 64,
        z: Number(locForm.z) || 0,
        label: locForm.label,
        note: locForm.note,
        is_public: !!locForm.is_public
      };
      if (locForm.id) await api.put(`/api/market/merchant/locations/${locForm.id}`, body);
      else await api.post(`/api/market/merchant/stores/${storeId}/locations`, body);
      showToast(locForm.id ? '位置已更新' : '位置已添加', 'success');
      setLocForm(null);
      await loadLocations(storeId);
    } catch (err) {
      showToast(err.message || '保存位置失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteLocation = async (id) => {
    if (!confirm('确定删除该位置？')) return;
    try {
      await api.delete(`/api/market/merchant/locations/${id}`);
      showToast('位置已删除', 'success');
      await loadLocations(storeId);
    } catch (e) {
      showToast(e.message || '删除失败', 'error');
    }
  };

  /* ---------- 商品 ---------- */
  const emptyProduct = () => ({
    id: null, title: '', summary: '', description: '', category_id: '', tags: '', cover: '',
    price: '', stock: 0, per_order_limit: 0, per_user_limit: 0, spec: '', status: 'on', images: []
  });

  const editProduct = (p) => setProductForm({
    id: p.id, title: p.title || '', summary: p.summary || '', description: p.description || '',
    category_id: p.category_id ? String(p.category_id) : '', tags: marketTags(p.tags).join(','),
    cover: p.cover || '', price: p.price ?? '', stock: p.stock ?? 0,
    per_order_limit: p.per_order_limit ?? 0, per_user_limit: p.per_user_limit ?? 0,
    spec: p.spec || '', status: p.status === 'soldout' ? 'on' : (p.status || 'on'),
    images: p.images || []
  });

  const saveProduct = async (e) => {
    e.preventDefault();
    if (!productForm) return;
    setBusy(true);
    try {
      const body = {
        title: productForm.title,
        summary: productForm.summary,
        description: productForm.description,
        category_id: productForm.category_id ? Number(productForm.category_id) : null,
        tags: productForm.tags ? productForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        cover: productForm.cover,
        price: Number(productForm.price) || 0,
        stock: Number(productForm.stock) || 0,
        per_order_limit: Number(productForm.per_order_limit) || 0,
        per_user_limit: Number(productForm.per_user_limit) || 0,
        spec: productForm.spec,
        status: productForm.status,
        images: productForm.images
      };
      if (productForm.id) await api.put(`/api/market/merchant/products/${productForm.id}`, body);
      else await api.post('/api/market/merchant/products', { ...body, store_id: storeId });
      showToast(productForm.id ? '商品已保存' : '商品已创建', 'success');
      setProductForm(null);
      await loadProducts(storeId);
    } catch (err) {
      showToast(err.message || '保存商品失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleProductStatus = async (p) => {
    const next = p.status === 'on' ? 'off' : 'on';
    try {
      await api.put(`/api/market/merchant/products/${p.id}`, { status: next });
      showToast(next === 'on' ? '已上架' : '已下架', 'success');
      await loadProducts(storeId);
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    }
  };

  const removeProduct = async (p) => {
    if (!confirm(`确定删除「${p.title}」？删除后不可恢复（历史订单不受影响）`)) return;
    try {
      await api.delete(`/api/market/merchant/products/${p.id}`);
      showToast('商品已删除', 'success');
      await loadProducts(storeId);
    } catch (e) {
      showToast(e.message || '删除失败', 'error');
    }
  };

  /* ---------- 履约 / 核销 / 退款 ---------- */
  const deliver = async (o) => {
    const note = prompt('交付说明（可选）', '') ?? null;
    if (note === null) return;
    try {
      await api.post(`/api/market/merchant/orders/${o.id}/deliver`, { note });
      showToast('已标记交付，等待买家确认收货', 'success');
      await loadOrders(storeId, orderStatus, 1);
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    }
  };

  const doVerify = async (e) => {
    e.preventDefault();
    if (!verifyCode.trim()) return;
    setBusy(true);
    setVerifyOut(null);
    try {
      const d = await api.post('/api/market/merchant/verify', { store_id: storeId, code: verifyCode.trim() });
      setVerifyOut({ ok: true, message: d.message || '核销成功', order: d.order, already: d.already });
      setVerifyCode('');
      showToast(d.message || '核销成功', 'success');
      if (tab === 'orders') await loadOrders(storeId, orderStatus, 1);
    } catch (err) {
      setVerifyOut({ ok: false, message: err.message || '核销失败' });
      showToast(err.message || '核销失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 评价管理 ---------- */
  const toggleReply = (id) => setReplyOpen(p => ({ ...p, [id]: !p[id] }));

  const saveReply = async (r) => {
    const reply = (replyDraft[r.id] ?? '').trim();
    try {
      await api.post(`/api/market/merchant/reviews/${r.id}/reply`, { reply });
      showToast(reply ? '回复已保存，买家会收到通知' : '已清空回复', 'success');
      setReplyOpen(p => ({ ...p, [r.id]: false }));
      await loadReviews(storeId, 1);
    } catch (e) {
      showToast(e.message || '回复失败', 'error');
    }
  };

  const setReviewStatus = async (r, status) => {
    const hidden = status === 'hidden';
    if (hidden && !confirm('隐藏后该评价不再展示，并会同步从店铺均分里扣减；确定隐藏？')) return;
    const reason = hidden ? (prompt('隐藏原因（可选，仅记入审计）', '') ?? null) : '';
    if (hidden && reason === null) return;
    setBusy(true);
    try {
      await api.post(`/api/market/merchant/reviews/${r.id}/status`, { status, reason });
      showToast(hidden ? '评价已隐藏，店铺均分已同步扣减' : '评价已恢复展示，均分已加回', 'success');
      const d = await loadReviews(storeId, 1);
      if (d?.store) applyStore(d.store);
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRefund = async (r, action) => {
    const note = action === 'reject' ? (prompt('拒绝原因', '') ?? null) : (prompt('处理说明（可选）', '') ?? null);
    if (note === null) return;
    try {
      await api.post(`/api/market/merchant/refunds/${r.id}/${action}`, { note });
      showToast(action === 'approve' ? '已同意退款' : '已拒绝退款', 'success');
      await loadRefunds(storeId);
      refreshMe?.();
    } catch (e) {
      showToast(e.message || '处理失败', 'error');
    }
  };

  if (!user) {
    return (
      <div className="fade-in-up">
        <div className="section-head"><h2 className="section-title">商家后台</h2></div>
        <div className="empty-state">
          <p>登录后可以申请开店、管理商品与订单</p>
          <button
            className="btn btn-primary"
            onClick={() => requireLogin(navigate, '请先登录后再进入商家后台')}
          >
            去登录
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="loading"><div className="spinner" />加载中...</div>;

  return (
    <div className="fade-in-up">
      <div className="section-head">
        <h2 className="section-title">商家后台</h2>
        <p className="section-desc">管理店铺资料、位置、商品、订单核销与经营账务</p>
      </div>

      <div className="mk-inline" style={{ marginBottom: 12 }}>
        <Link to="/market" className="btn btn-secondary btn-sm mk-icon-text"><IconArrowLeft size={14} />集市首页</Link>
        <Link to="/market/orders" className="btn btn-secondary btn-sm">我的订单</Link>
        {store && <Link to={`/market/store/${store.id}`} className="btn btn-secondary btn-sm">查看店铺主页</Link>}
      </div>

      {stores.length === 0 ? (
        <div className="mk-panel">
          <div className="mk-panel-title">申请开店</div>
          <p className="mk-note" style={{ marginBottom: 12 }}>
            开店费 {cfg?.fees?.openFeeEnabled === false ? '免收' : `${fmtPoints(cfg?.fees?.openFee || 0)} 贡献点`}
            {cfg?.fees?.openFeeFirstFree ? '（首店免费）' : ''}
            ；每 {cfg?.fees?.cycleDays || 30} 天需续费 {fmtPoints(cfg?.fees?.renewFee || 0)} 贡献点。
            提交后需管理员审核，审核通过才算正式营业。
          </p>
          <form onSubmit={createStore}>
            <div className="mk-form-grid">
              <div className="form-group">
                <label className="form-label">店铺名称 *（2–30 字）</label>
                <input className="form-input" value={openForm.name} onChange={e => setOpenForm(f => ({ ...f, name: e.target.value }))} maxLength={30} required />
              </div>
              <div className="form-group">
                <label className="form-label">店铺分类</label>
                <select className="form-select" value={openForm.category_id} onChange={e => setOpenForm(f => ({ ...f, category_id: e.target.value }))}>
                  <option value="">未选择</option>
                  {/* 原生 option 里放不了 SVG，分类图标只在集市页的筛选按钮上按 slug 渲染 */}
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">店铺简介</label>
              <textarea className="form-textarea" value={openForm.intro} onChange={e => setOpenForm(f => ({ ...f, intro: e.target.value }))} maxLength={500} placeholder="主营什么、在哪个服务器、营业时间……" />
            </div>
            <div className="form-group">
              <label className="form-label">标签（逗号分隔，最多 8 个）</label>
              <input className="form-input" value={openForm.tags} onChange={e => setOpenForm(f => ({ ...f, tags: e.target.value }))} placeholder="例：红石, 附魔书, 24h" />
            </div>
            <div className="mk-form-grid">
              <ImageField label="封面图" value={openForm.cover} onChange={v => setOpenForm(f => ({ ...f, cover: v }))} />
              <ImageField label="店铺头像" value={openForm.avatar} onChange={v => setOpenForm(f => ({ ...f, avatar: v }))} />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? '提交中...' : '提交开店申请'}</button>
          </form>
        </div>
      ) : (
        <>
          <div className="mk-panel">
            <div className="mk-panel-title">我的店铺（{stores.length}）</div>
            <div className="mk-chips">
              {stores.map(s => (
                <button key={s.id} className={`mk-chip ${Number(storeId) === Number(s.id) ? 'active' : ''}`} onClick={() => setStoreId(s.id)}>
                  {s.name}
                </button>
              ))}
            </div>
            {store && (
              <div className="mk-kv" style={{ marginTop: 8 }}>
                <span className={`badge ${store.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{STORE_STATUS_LABEL[store.status] || store.status}</span>
                <span>有效期至 {store.expire_at ? formatDate(store.expire_at, false) : '—'}</span>
                <span>成交 {store.sales_count || 0}</span>
                <span>评分 {store.rating_count > 0 ? (store.rating_sum / store.rating_count).toFixed(1) : '暂无'}（{store.rating_count}）</span>
              </div>
            )}
          </div>

          <div className="mk-subnav">
            {TABS.map(t => (
              <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>

          {/* ---- 店铺资料 ---- */}
          {tab === 'store' && storeForm && store && (
            <>
              <div className="mk-panel">
                <div className="mk-panel-title">续费与营业状态</div>
                <div className="mk-stat-grid">
                  <div className="mk-stat"><div className="k">续期费</div><div className="v">{fmtPoints(fees.renewFee || 0)}</div></div>
                  <div className="mk-stat"><div className="k">周期</div><div className="v">{fees.cycleDays || 30} 天</div></div>
                  <div className="mk-stat"><div className="k">到期时间</div><div className="v" style={{ fontSize: 13 }}>{store.expire_at ? formatDate(store.expire_at, false) : '—'}</div></div>
                  <div className="mk-stat"><div className="k">宽限期</div><div className="v">{fees.graceDays ?? 0} 天</div></div>
                </div>
                <div className="mk-inline" style={{ marginTop: 12 }}>
                  <button className="btn btn-primary" onClick={renew} disabled={busy}>续费 {fmtPoints(fees.renewFee || 0)} 点</button>
                  {['active', 'paused'].includes(store.status) && (
                    <button className="btn btn-secondary" onClick={toggleBusiness} disabled={busy}>
                      {store.status === 'paused' ? '恢复营业' : '暂停营业'}
                    </button>
                  )}
                  {store.status === 'pending' && <span className="badge badge-warning">等待管理员审核中</span>}
                  {store.status === 'rejected' && store.review_note && <span className="mk-note">拒绝原因：{store.review_note}</span>}
                </div>
              </div>

              <div className="mk-panel">
                <div className="mk-panel-title">店铺资料与公告</div>
                <div className="mk-form-grid">
                  <div className="form-group">
                    <label className="form-label">店铺名称</label>
                    <input className="form-input" value={storeForm.name} onChange={e => setStoreForm(f => ({ ...f, name: e.target.value }))} maxLength={30} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">分类</label>
                    <select className="form-select" value={storeForm.category_id} onChange={e => setStoreForm(f => ({ ...f, category_id: e.target.value }))}>
                      <option value="">未选择</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">简介</label>
                  <textarea className="form-textarea" value={storeForm.intro} onChange={e => setStoreForm(f => ({ ...f, intro: e.target.value }))} maxLength={500} />
                </div>
                <div className="form-group">
                  <label className="form-label">公告</label>
                  <textarea className="form-textarea" value={storeForm.notice} onChange={e => setStoreForm(f => ({ ...f, notice: e.target.value }))} maxLength={1000} />
                </div>
                <div className="form-group">
                  <label className="form-label">标签（逗号分隔）</label>
                  <input className="form-input" value={storeForm.tags} onChange={e => setStoreForm(f => ({ ...f, tags: e.target.value }))} />
                </div>
                <div className="mk-form-grid">
                  <ImageField label="封面图" value={storeForm.cover} onChange={v => setStoreForm(f => ({ ...f, cover: v }))} />
                  <ImageField label="头像" value={storeForm.avatar} onChange={v => setStoreForm(f => ({ ...f, avatar: v }))} />
                </div>
                <button className="btn btn-primary" onClick={saveStore} disabled={busy}>{busy ? '保存中...' : '保存店铺资料'}</button>
              </div>
            </>
          )}

          {/* ---- 位置 ---- */}
          {tab === 'locations' && (
            <div className="mk-panel">
              <div className="mk-panel-title">
                店铺位置（{locations.length}）
                <button className="btn btn-primary btn-sm" onClick={() => setLocForm(locForm ? null : emptyLoc())}>
                  {locForm ? '取消编辑' : '添加位置'}
                </button>
              </div>

              {locForm && (
                <form onSubmit={saveLocation} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 12 }}>
                  <div className="mk-form-grid">
                    <div className="form-group">
                      <label className="form-label">服务器标识 *</label>
                      <input className="form-input" value={locForm.server_key} onChange={e => setLocForm(f => ({ ...f, server_key: e.target.value }))} placeholder="s115" required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">服务器名称</label>
                      <input className="form-input" value={locForm.server_name} onChange={e => setLocForm(f => ({ ...f, server_name: e.target.value }))} placeholder="例：115 服" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">维度</label>
                      <select className="form-select" value={locForm.dimension} onChange={e => setLocForm(f => ({ ...f, dimension: e.target.value }))}>
                        {Object.entries(DIM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    {locForm.dimension === 'custom' && (
                      <div className="form-group">
                        <label className="form-label">自定义维度名</label>
                        <input className="form-input" value={locForm.dimension_custom} onChange={e => setLocForm(f => ({ ...f, dimension_custom: e.target.value }))} />
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">X 坐标</label>
                      <input className="form-input" type="number" value={locForm.x} onChange={e => setLocForm(f => ({ ...f, x: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Y 坐标</label>
                      <input className="form-input" type="number" value={locForm.y} onChange={e => setLocForm(f => ({ ...f, y: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Z 坐标</label>
                      <input className="form-input" type="number" value={locForm.z} onChange={e => setLocForm(f => ({ ...f, z: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">标注</label>
                      <input className="form-input" value={locForm.label} onChange={e => setLocForm(f => ({ ...f, label: e.target.value }))} placeholder="例：主城东门" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">备注</label>
                    <textarea className="form-textarea" value={locForm.note} onChange={e => setLocForm(f => ({ ...f, note: e.target.value }))} maxLength={200} />
                  </div>
                  <div className="mk-inline">
                    <label className="mk-note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={!!locForm.is_public} onChange={e => setLocForm(f => ({ ...f, is_public: e.target.checked }))} />
                      在地图与店铺页公开
                    </label>
                    <button className="btn btn-primary" type="submit" disabled={busy}>{locForm.id ? '保存位置' : '添加位置'}</button>
                  </div>
                </form>
              )}

              {locations.length === 0 ? (
                <div className="mk-empty">还没有位置，添加后玩家就能在地图上找到你</div>
              ) : locations.map(l => (
                <div key={l.id} className="mk-list-row">
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>
                      {l.label || `${l.server_name || l.server_key} · ${DIM_LABEL[l.dimension] || l.dimension}`}
                      {!l.is_public ? <span className="badge badge-warning" style={{ marginLeft: 6 }}>不公开</span> : null}
                    </div>
                    <div className="mk-loc-coord">{l.server_name || l.server_key} / {DIM_LABEL[l.dimension] || l.dimension}：X {l.x} Y {l.y} Z {l.z}</div>
                    {l.note && <div className="mk-note">{l.note}</div>}
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => setLocForm({ ...l, is_public: !!l.is_public })}>编辑</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteLocation(l.id)}>删除</button>
                </div>
              ))}
            </div>
          )}

          {/* ---- 商品 ---- */}
          {tab === 'products' && (
            <div className="mk-panel">
              <div className="mk-panel-title">
                商品（{products.length}）
                <button className="btn btn-primary btn-sm" onClick={() => setProductForm(productForm ? null : emptyProduct())}>
                  {productForm ? '取消编辑' : '新建商品'}
                </button>
              </div>

              {productForm && (
                <form onSubmit={saveProduct} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 12 }}>
                  <div className="form-group">
                    <label className="form-label">商品标题 *（2–60 字）</label>
                    <input className="form-input" value={productForm.title} onChange={e => setProductForm(f => ({ ...f, title: e.target.value }))} maxLength={60} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">一句话简介</label>
                    <input className="form-input" value={productForm.summary} onChange={e => setProductForm(f => ({ ...f, summary: e.target.value }))} maxLength={200} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">详细描述（支持富文本 HTML，后端会做白名单清洗）</label>
                    <textarea className="form-textarea" style={{ minHeight: 130 }} value={productForm.description} onChange={e => setProductForm(f => ({ ...f, description: e.target.value }))} placeholder="<p>说明材质、数量、交付方式……</p>" />
                  </div>
                  <div className="mk-form-grid">
                    <div className="form-group">
                      <label className="form-label">分类</label>
                      <select className="form-select" value={productForm.category_id} onChange={e => setProductForm(f => ({ ...f, category_id: e.target.value }))}>
                        <option value="">未选择</option>
                        {productCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">状态</label>
                      <select className="form-select" value={productForm.status} onChange={e => setProductForm(f => ({ ...f, status: e.target.value }))}>
                        <option value="on">上架在售</option>
                        <option value="draft">草稿（不展示）</option>
                        <option value="off">下架</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">价格（贡献点）*</label>
                      <input className="form-input" type="number" step="0.01" min="0.01" value={productForm.price} onChange={e => setProductForm(f => ({ ...f, price: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">库存（0 表示售罄）</label>
                      <input className="form-input" type="number" min="0" value={productForm.stock} onChange={e => setProductForm(f => ({ ...f, stock: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">单笔限购（0 = 不限）</label>
                      <input className="form-input" type="number" min="0" value={productForm.per_order_limit} onChange={e => setProductForm(f => ({ ...f, per_order_limit: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">每人限购（0 = 不限）</label>
                      <input className="form-input" type="number" min="0" value={productForm.per_user_limit} onChange={e => setProductForm(f => ({ ...f, per_user_limit: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">规格说明</label>
                      <input className="form-input" value={productForm.spec} onChange={e => setProductForm(f => ({ ...f, spec: e.target.value }))} placeholder="例：一组 64 个" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">标签（逗号分隔）</label>
                      <input className="form-input" value={productForm.tags} onChange={e => setProductForm(f => ({ ...f, tags: e.target.value }))} />
                    </div>
                  </div>
                  <ImageField label="封面图" value={productForm.cover} onChange={v => setProductForm(f => ({ ...f, cover: v }))} />
                  <MultiImageField label="商品图集" values={productForm.images} onChange={v => setProductForm(f => ({ ...f, images: v }))} />
                  <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '保存中...' : (productForm.id ? '保存商品' : '创建商品')}</button>
                </form>
              )}

              {products.length === 0 ? (
                <div className="mk-empty">还没有商品，点「新建商品」上架第一件商品</div>
              ) : products.map(p => (
                <div key={p.id} className="mk-list-row">
                  {p.cover
                    ? <img src={p.cover} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                    : <div style={{ width: 52, height: 52, borderRadius: 8, background: 'var(--input-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}><IconPackage size={22} /></div>}
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>
                      {p.title}
                      <span className={`badge ${p.status === 'on' ? 'badge-success' : p.status === 'removed' ? 'badge-danger' : 'badge-gray'}`} style={{ marginLeft: 6 }}>
                        {{ on: '在售', off: '已下架', draft: '草稿', soldout: '售罄', removed: '已删除' }[p.status] || p.status}
                      </span>
                    </div>
                    <div className="mk-note">
                      {fmtPoints(p.price)} 点 · 库存 {p.stock} · 已售 {p.sold}
                      {p.per_order_limit > 0 ? ` · 单笔限购 ${p.per_order_limit}` : ''}
                      {p.per_user_limit > 0 ? ` · 每人限购 ${p.per_user_limit}` : ''}
                    </div>
                  </div>
                  {p.status !== 'removed' && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => editProduct(p)}>编辑</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleProductStatus(p)}>{p.status === 'on' ? '下架' : '上架'}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => removeProduct(p)}>删除</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ---- 订单 ---- */}
          {tab === 'orders' && (
            <div className="mk-panel">
              <div className="mk-panel-title">店铺订单（{orderTotal}）</div>
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
                      <span className={`badge ${o.status === 'settled' ? 'badge-success' : 'badge-primary'}`} style={{ marginLeft: 6 }}>{ORDER_STATUS_LABEL[o.status] || o.status}</span>
                    </div>
                    <div className="mk-note">
                      买家 {o.buyer_nickname || o.buyer_username || '—'} · {o.items_title} · 实付 {fmtPoints(o.buyer_pay)} · 收入 {fmtPoints(o.merchant_income)}
                    </div>
                    <div className="mk-note">
                      {formatDate(o.created_at)}
                      {o.code_tail ? ` · 核销码末四位 ${o.code_tail}` : ''}
                      {o.code_used_at ? ` · 已核销 ${formatDate(o.code_used_at)}` : ''}
                    </div>
                  </div>
                  {['paid', 'delivered'].includes(o.status) && (
                    <button className="btn btn-primary btn-sm" onClick={() => deliver(o)}>标记已交付</button>
                  )}
                </div>
              ))}
              {orders.length < orderTotal && (
                <div className="mk-loadmore">
                  <button className="btn btn-secondary" onClick={() => loadOrders(storeId, orderStatus, orderPage + 1)}>加载更多</button>
                </div>
              )}
            </div>
          )}

          {/* ---- 评价管理 ---- */}
          {tab === 'reviews' && (
            <div className="mk-panel">
              <div className="mk-panel-title">
                店铺评价（{reviewTotal}）
                {reviewStat ? (
                  <Stars
                    value={reviewStat.rating_count > 0 ? reviewStat.rating_sum / reviewStat.rating_count : 0}
                    count={reviewStat.rating_count}
                    countSuffix=" 条"
                  />
                ) : null}
              </div>
              <p className="mk-note" style={{ marginBottom: 10 }}>
                可以回复买家（买家会收到站内与邮件通知），也可以隐藏个别评价：隐藏后不再展示，并从店铺均分里同步扣减，恢复展示时会加回。
              </p>
              {reviews.length === 0 ? (
                <div className="mk-empty">还没有收到评价</div>
              ) : reviews.map(r => (
                <div key={r.id} className="mk-review-manage">
                  <div className="head">
                    <img
                      src={r.buyer_avatar || '/images/default-avatar.png'}
                      alt=""
                      onError={e => { e.currentTarget.src = '/images/default-avatar.png'; }}
                    />
                    <strong>{r.buyer_nickname || r.buyer_username || '匿名玩家'}</strong>
                    <Stars value={r.rating} size={13} />
                    <span className={`badge ${r.status === 'hidden' ? 'badge-gray' : 'badge-success'}`}>
                      {r.status === 'hidden' ? '已隐藏' : '展示中'}
                    </span>
                    <span className="text-secondary" style={{ marginLeft: 'auto', fontSize: 12 }}>{formatDate(r.created_at)}</span>
                  </div>
                  <div className="mk-note">
                    订单 {r.order_no || '—'}{r.product_title ? ` · 商品 ${r.product_title}` : ''}
                  </div>
                  {r.content && <div className="body">{r.content}</div>}
                  {r.reply ? <div className="existing-reply">当前回复：{r.reply}</div> : null}
                  <div className="mk-inline" style={{ marginTop: 8 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleReply(r.id)}>
                      {replyOpen[r.id] ? '收起回复' : (r.reply ? '修改回复' : '回复')}
                    </button>
                    <button
                      className={`btn btn-sm ${r.status === 'hidden' ? 'btn-success' : 'btn-ghost'}`}
                      disabled={busy}
                      onClick={() => setReviewStatus(r, r.status === 'hidden' ? 'visible' : 'hidden')}
                    >
                      {r.status === 'hidden' ? '恢复展示' : '隐藏评价'}
                    </button>
                  </div>
                  {replyOpen[r.id] && (
                    <div className="reply-box">
                      <textarea
                        className="form-textarea"
                        value={replyDraft[r.id] ?? ''}
                        onChange={e => setReplyDraft(p => ({ ...p, [r.id]: e.target.value }))}
                        placeholder="回复该评价（最多 500 字；留空保存即清空回复）"
                        maxLength={500}
                      />
                      <div className="mk-inline" style={{ marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveReply(r)}>保存回复</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setReplyDraft(p => ({ ...p, [r.id]: r.reply || '' }));
                            toggleReply(r.id);
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {reviews.length < reviewTotal && (
                <div className="mk-loadmore">
                  <button className="btn btn-secondary" disabled={busy} onClick={() => loadReviews(storeId, reviewPage + 1)}>加载更多</button>
                </div>
              )}
            </div>
          )}

          {/* ---- 核销台 ---- */}
          {tab === 'verify' && (
            <div className="mk-panel">
              <div className="mk-panel-title">核销台</div>
              <p className="mk-note" style={{ marginBottom: 10 }}>输入买家出示的核销码（形如 BW-XXXX-XXXXXX），核销后请在游戏内交付，再让买家确认收货。</p>
              <form className="mk-search" onSubmit={doVerify}>
                <input
                  className="form-input"
                  value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value.toUpperCase())}
                  placeholder="BW-XXXX-XXXXXX"
                  autoComplete="off"
                />
                <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '核销中...' : '核销'}</button>
              </form>
              {verifyOut && (
                <div className={`mk-verify-out ${verifyOut.ok ? 'ok' : 'bad'}`}>
                  {verifyOut.ok ? <IconCheck size={15} /> : <IconClose size={15} />}{verifyOut.message}
                  {verifyOut.order && (
                    <div className="mk-note" style={{ color: 'inherit', marginTop: 6 }}>
                      订单 {verifyOut.order.order_no} · {fmtPoints(verifyOut.order.buyer_pay)} 点
                      {verifyOut.already ? '（此前已核销，未重复处理）' : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---- 退款处理 ---- */}
          {tab === 'refunds' && (
            <div className="mk-panel">
              <div className="mk-panel-title">退款申请（{refunds.length}）</div>
              {refunds.length === 0 ? (
                <div className="mk-empty">没有待处理的退款申请</div>
              ) : refunds.map(r => (
                <div key={r.id} className="mk-list-row">
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>退款 #{r.id} · {fmtPoints(r.amount)} 点</div>
                    <div className="mk-note">订单 {r.order_no} · 买家 {r.buyer || '—'}</div>
                    {r.reason && <div className="mk-note">原因：{r.reason}</div>}
                  </div>
                  <button className="btn btn-success btn-sm" onClick={() => handleRefund(r, 'approve')}>同意</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleRefund(r, 'reject')}>拒绝</button>
                </div>
              ))}
            </div>
          )}

          {/* ---- 经营账务 ---- */}
          {tab === 'finance' && (
            <div className="mk-panel">
              <div className="mk-panel-title">经营账务</div>
              {!finance ? (
                <div className="loading"><div className="spinner" />加载中...</div>
              ) : (
                <>
                  <div className="mk-stat-grid">
                    <div className="mk-stat"><div className="k">累计订单</div><div className="v">{finance.summary.orders}</div></div>
                    <div className="mk-stat"><div className="k">成交额（税基）</div><div className="v">{fmtPoints(finance.summary.gmv)}</div></div>
                    <div className="mk-stat"><div className="k">我的收入</div><div className="v" style={{ color: 'var(--success)' }}>{fmtPoints(finance.summary.income)}</div></div>
                    <div className="mk-stat"><div className="k">交易税</div><div className="v">{fmtPoints(finance.summary.tax)}</div></div>
                    <div className="mk-stat"><div className="k">买家实付</div><div className="v">{fmtPoints(finance.summary.buyerPay)}</div></div>
                    <div className="mk-stat"><div className="k">待结算（{finance.summary.pendingCount} 单）</div><div className="v" style={{ color: 'var(--warning)' }}>{fmtPoints(finance.summary.pendingSettle)}</div></div>
                    <div className="mk-stat"><div className="k">已缴费用</div><div className="v">{fmtPoints(finance.summary.feesPaid)}</div></div>
                    <div className="mk-stat"><div className="k">已退款（{finance.summary.refundCount} 单）</div><div className="v">{fmtPoints(finance.summary.refunded)}</div></div>
                  </div>

                  <div className="mk-panel-title" style={{ marginTop: 16 }}>月报（近 12 个月）</div>
                  {finance.monthly.length === 0 ? (
                    <div className="mk-empty">暂无结算记录</div>
                  ) : (
                    <div className="mk-table-wrap">
                      <table className="table">
                        <thead><tr><th>月份</th><th>订单</th><th>收入</th><th>交易税</th></tr></thead>
                        <tbody>
                          {finance.monthly.map(m => (
                            <tr key={m.ym}><td>{m.ym}</td><td>{m.cnt}</td><td>{fmtPoints(m.income)}</td><td>{fmtPoints(m.tax)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="mk-panel-title" style={{ marginTop: 16 }}>商铺档案</div>
                  {finance.archives.length === 0 ? (
                    <div className="mk-empty">暂无档案</div>
                  ) : finance.archives.map(a => (
                    <div key={a.archive_no} className="mk-list-row">
                      <div className="grow">
                        <div style={{ fontWeight: 600 }}>{a.title}</div>
                        <div className="mk-note">{a.summary}</div>
                      </div>
                      <span className="mk-note">{formatDate(a.created_at)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
