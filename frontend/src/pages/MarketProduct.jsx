import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiBase, getToken } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { IconArrowLeft, IconClose, IconMinus, IconPlus, IconWarn, Stars, StarToggle } from '../components/MarketIcons';
import { requireLogin, formatDate, stripHtml } from '../utils';
import '../styles/market.css';

/** 下单成功后必须显著展示明文核销码（只返回一次） */
function VerifyCodeModal({ code, order, onClose }) {
  const qrTarget = order?.short_code || order?.order_no;
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3 className="modal-title">下单成功</h3>
          <button className="modal-close mk-modal-close" onClick={onClose} aria-label="关闭" title="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="mk-code-box">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>核销码（交给商家核销）</div>
            <div className="mk-code-value">{code || '——'}</div>
            <div className="mk-code-warn"><IconWarn size={15} />只显示这一次，请立即记录或截图保存</div>
            {qrTarget ? (
              <img className="mk-code-qr" src={`/api/market/qr/${qrTarget}.png`} alt="核销码二维码" />
            ) : null}
            {qrTarget ? <div className="mk-note" style={{ marginTop: 6 }}>商家也可扫码核销</div> : null}
          </div>
          {order && (
            <div className="mk-stat-grid">
              <div className="mk-stat"><div className="k">订单号</div><div className="v" style={{ fontSize: 13 }}>{order.order_no}</div></div>
              <div className="mk-stat"><div className="k">应付</div><div className="v">{Number(order.buyer_pay || 0).toFixed(2)}</div></div>
            </div>
          )}
          <p className="mk-note" style={{ marginTop: 10 }}>
            在游戏内把核销码交给店主，店主核销后你会在「我的订单」里看到状态变化，收到货再点「确认收货」。
          </p>
        </div>
        <div className="modal-footer">
          <Link to="/market/orders" className="btn btn-secondary" onClick={onClose}>我的订单</Link>
          <button className="btn btn-primary" onClick={onClose}>我已记下</button>
        </div>
      </div>
    </div>
  );
}

export default function MarketProduct() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refreshMe } = useAuth();
  const { showToast } = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const [buying, setBuying] = useState(false);
  const [result, setResult] = useState(null); // { verify_code, order }
  const [favBusy, setFavBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/market/products/${id}`);
      setData(d);
    } catch (e) {
      showToast(e.message || '商品不存在或已下架', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  const product = data?.product;
  const limits = useMemo(() => {
    if (!product) return { max: 1, stock: 0 };
    const stock = Number(product.stock) || 0;
    const perOrder = Number(product.per_order_limit) || 0; // 0 = 不限
    const perUser = Number(product.per_user_limit) || 0;   // 0 = 不限
    let max = stock;
    if (perOrder > 0) max = Math.min(max, perOrder);
    if (perUser > 0) max = Math.min(max, perUser);
    return { max: Math.max(1, max), stock, perOrder, perUser };
  }, [product]);

  useEffect(() => { setQty(1); }, [id]);

  const toggleFavorite = async () => {
    if (!requireLogin(navigate, '登录后才能收藏商品')) return;
    setFavBusy(true);
    try {
      if (product.is_favorited) {
        await api.delete(`/api/market/favorites/product/${product.id}`);
        setData(d => ({ ...d, product: { ...d.product, is_favorited: false } }));
        showToast('已取消收藏', 'info');
      } else {
        await api.post('/api/market/favorites', { target_type: 'product', target_id: product.id });
        setData(d => ({ ...d, product: { ...d.product, is_favorited: true } }));
        showToast('已收藏商品', 'success');
      }
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      setFavBusy(false);
    }
  };

  // 下单：api 封装不支持自定义请求头，这里直接 fetch 以便带 Idempotency-Key
  const buy = async () => {
    if (!requireLogin(navigate, '请先登录后再下单')) return;
    if (!product.buyable) return;
    const n = Math.max(1, Math.min(limits.max, Number(qty) || 1));
    const total = Number(product.price) * n;
    if (!confirm(`确定购买「${product.title}」${n} 件？\n应付 ${total.toFixed(2)} 贡献点`)) return;
    setBuying(true);
    const idem = `mk-${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await fetch(`${apiBase}/api/market/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idem,
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
        },
        body: JSON.stringify({
          store_id: product.store_id,
          items: [{ product_id: product.id, quantity: n }],
          idem_key: idem
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.message || '下单失败');
      setResult({ verify_code: body.verify_code, order: body.order, notice: body.notice });
      showToast('下单成功，请记下核销码', 'success');
      refreshMe?.();
      load();
    } catch (e) {
      showToast(e.message || '下单失败', 'error');
    } finally {
      setBuying(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />加载中...</div>;
  if (!product) {
    return (
      <div className="empty-state">
        <p>商品不存在或已下架</p>
        <Link to="/market" className="btn btn-primary">返回集市</Link>
      </div>
    );
  }

  const images = product.images && product.images.length > 0 ? product.images : (product.cover ? [product.cover] : []);
  const soldOut = product.status === 'soldout' || (Number(product.stock) || 0) <= 0;
  const statusLabel = { on: '在售', soldout: '已售罄', off: '已下架', draft: '草稿', removed: '已删除' };
  const storeStatusLabel = { pending: '待审核', active: '营业中', paused: '暂停营业', grace: '续费宽限期', suspended: '欠费暂停', closed: '已关闭', rejected: '审核未通过' };

  return (
    <div className="fade-in-up">
      <div className="mk-inline" style={{ marginBottom: 12 }}>
        <Link to="/market" className="btn btn-secondary btn-sm mk-icon-text"><IconArrowLeft size={14} />返回集市</Link>
        {product.store && <Link to={`/market/store/${product.store.id}`} className="btn btn-secondary btn-sm">进入店铺</Link>}
      </div>

      {images.length > 0 && (
        <div className="mk-gallery">
          {images.map((u, i) => <img key={`${u}-${i}`} src={u} alt={`${product.title} 图 ${i + 1}`} loading={i > 0 ? 'lazy' : undefined} />)}
        </div>
      )}

      <div className="mk-panel">
        <h1 style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.35 }}>{product.title}</h1>
        {product.summary && <p className="mk-note" style={{ marginTop: 6 }}>{product.summary}</p>}
        <div className="mk-inline" style={{ marginTop: 10 }}>
          <span className="mk-price" style={{ fontSize: 22 }}>{Number(product.price || 0).toFixed(2)}<small> 贡献点</small></span>
          <span className={`badge ${soldOut ? 'badge-danger' : 'badge-success'}`}>{statusLabel[product.status] || product.status}</span>
          {product.category?.name ? <span className="badge badge-gray">{product.category.name}</span> : null}
        </div>
        <div className="mk-kv">
          <span>库存 {Number(product.stock) || 0}</span>
          <span>已售 {product.sold || 0}</span>
          {product.per_order_limit > 0 ? <span>单笔限购 {product.per_order_limit}</span> : null}
          {product.per_user_limit > 0 ? <span>每人限购 {product.per_user_limit}</span> : null}
          {product.spec ? <span>规格：{product.spec}</span> : null}
        </div>
      </div>

      <div className="mk-buy-box">
        <div className="mk-buy-row">
          <span>购买数量</span>
          <div className="mk-qty">
            <button type="button" onClick={() => setQty(q => Math.max(1, (Number(q) || 1) - 1))} disabled={!product.buyable} aria-label="减少数量" title="减少数量"><IconMinus size={15} /></button>
            <input
              className="form-input"
              type="number"
              min={1}
              max={limits.max}
              value={qty}
              onChange={e => setQty(Math.max(1, Math.min(limits.max, Number(e.target.value) || 1)))}
              disabled={!product.buyable}
            />
            <button type="button" onClick={() => setQty(q => Math.min(limits.max, (Number(q) || 1) + 1))} disabled={!product.buyable} aria-label="增加数量" title="增加数量"><IconPlus size={15} /></button>
          </div>
        </div>
        <div className="mk-buy-row">
          <span>限购上限</span>
          <span>最多 {limits.max} 件{limits.stock <= 0 ? '（已无库存）' : ''}</span>
        </div>
        <div className="mk-buy-row" style={{ fontSize: 15, color: 'var(--text)' }}>
          <strong>合计</strong>
          <strong className="mk-price">{(Number(product.price || 0) * (Number(qty) || 1)).toFixed(2)} <small>贡献点</small></strong>
        </div>
        {product.is_owner ? (
          <div className="mk-note">这是你自己的商品，不能购买。可到<Link to="/market/merchant">商家后台</Link>管理。</div>
        ) : (
          <button className="btn btn-primary btn-block" onClick={buy} disabled={buying || !product.buyable}>
            {buying ? '下单中...' : (soldOut ? '已售罄' : (product.buyable ? '立即购买' : '暂不可购买'))}
          </button>
        )}
        {!product.buyable && !product.is_owner && (
          <div className="mk-note" style={{ marginTop: 6 }}>
            {soldOut ? '该商品已售罄或下架。' : '该店铺当前不可营业（可能暂停/欠费/审核中）。'}
          </div>
        )}
        <div className="mk-inline" style={{ marginTop: 10 }}>
          <button className={`btn mk-icon-text ${product.is_favorited ? 'btn-secondary' : 'btn-ghost'} btn-sm`} onClick={toggleFavorite} disabled={favBusy}>
            <StarToggle active={!!product.is_favorited} size={15} />
            {product.is_favorited ? '已收藏' : '收藏'}
          </button>
          {product.short_code && (
            <a className="btn btn-ghost btn-sm" href={`/api/market/poster/${product.short_code}.png`} target="_blank" rel="noreferrer">分享海报</a>
          )}
        </div>
      </div>

      <div className="mk-panel">
        <div className="mk-panel-title">商品描述</div>
        {product.description_html ? (
          <div className="rich-content" dangerouslySetInnerHTML={{ __html: product.description_html }} />
        ) : (
          <div className="mk-empty">{stripHtml(product.description) || '店主还没有填写商品描述'}</div>
        )}
      </div>

      <div className="mk-panel">
        <div className="mk-panel-title">店铺信息</div>
        {product.store ? (
          <div className="mk-list-row">
            <img
              src={product.store.owner?.avatar || '/images/default-avatar.png'}
              alt=""
              style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border)' }}
              onError={e => { e.currentTarget.src = '/images/default-avatar.png'; }}
            />
            <div className="grow">
              <div style={{ fontWeight: 700 }}>
                <Link to={`/market/store/${product.store.id}`}>{product.store.name}</Link>
                <span className={`badge ${product.store.status === 'active' ? 'badge-success' : 'badge-warning'}`} style={{ marginLeft: 6 }}>
                  {storeStatusLabel[product.store.status] || product.store.status}
                </span>
              </div>
              <div className="mk-kv">
                <Stars value={product.store.rating_count > 0 ? product.store.rating_sum / product.store.rating_count : 0} count={product.store.rating_count} countSuffix=" 条" />
                <span>成交 {product.store.sales_count || 0}</span>
                <span>店主 {product.store.owner?.nickname || product.store.owner?.username || '—'}</span>
              </div>
            </div>
          </div>
        ) : <div className="mk-empty">店铺信息不可用</div>}
      </div>

      <div className="mk-panel">
        <div className="mk-panel-title">商品评价 <Stars value={data.rating} /></div>
        {(data.reviews || []).length === 0 ? (
          <div className="mk-empty">还没有评价</div>
        ) : data.reviews.map(r => (
          <div key={r.id} className="mk-review">
            <div className="mk-review-head">
              <img src={r.avatar || '/images/default-avatar.png'} alt="" onError={e => { e.currentTarget.src = '/images/default-avatar.png'; }} />
              <strong style={{ fontSize: 13 }}>{r.nickname || r.username || '匿名玩家'}</strong>
              <Stars value={r.rating} showValue={false} size={13} />
              <span className="text-secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>{formatDate(r.created_at)}</span>
            </div>
            {r.content && <div className="mk-review-body">{r.content}</div>}
            {r.reply && <div className="mk-review-reply">店主回复：{r.reply}</div>}
          </div>
        ))}
      </div>

      {result && (
        <VerifyCodeModal
          code={result.verify_code}
          order={result.order}
          onClose={() => setResult(null)}
        />
      )}
    </div>
  );
}
