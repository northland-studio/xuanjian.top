import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { IconArrowLeft, IconClose, IconPackage, Stars, StarToggle } from '../components/MarketIcons';
import { requireLogin, formatDate } from '../utils';
import { marketTags } from '../market/helpers';
import '../styles/market.css';

const DIM_LABEL = { overworld: '主世界', nether: '下界', end: '末地', custom: '自定义' };

function ShareModal({ shortCode, title, onClose }) {
  if (!shortCode) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">分享</h3>
          <button className="modal-close mk-modal-close" onClick={onClose} aria-label="关闭" title="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal-body" style={{ textAlign: 'center' }}>
          <p className="mk-note" style={{ marginBottom: 10 }}>扫码或在游戏内分享给同伴，短链地址：<br />{`/q/${shortCode}`}</p>
          <img className="mk-code-qr" src={`/api/market/qr/${shortCode}.png`} alt="二维码" />
          <div style={{ marginTop: 12 }}>
            <img
              src={`/api/market/poster/${shortCode}.png`}
              alt="分享海报"
              style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)' }}
            />
            <div className="mk-note" style={{ marginTop: 6 }}>{title} · 分享海报（可直接转发）</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketStore() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [favBusy, setFavBusy] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/market/stores/${id}`);
      setData(d);
    } catch (e) {
      showToast(e.message || '店铺不存在或已关闭', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  const toggleFavorite = async () => {
    if (!requireLogin(navigate, '登录后才能收藏店铺')) return;
    setFavBusy(true);
    try {
      if (data.store.is_favorited) {
        await api.delete(`/api/market/favorites/store/${data.store.id}`);
        setData(d => ({ ...d, store: { ...d.store, is_favorited: false } }));
        showToast('已取消收藏', 'info');
      } else {
        await api.post('/api/market/favorites', { target_type: 'store', target_id: data.store.id });
        setData(d => ({ ...d, store: { ...d.store, is_favorited: true } }));
        showToast('已收藏店铺', 'success');
      }
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      setFavBusy(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />加载中...</div>;
  if (!data || !data.store) {
    return (
      <div className="empty-state">
        <p>店铺不存在或已关闭</p>
        <Link to="/market" className="btn btn-primary">返回集市</Link>
      </div>
    );
  }

  const { store, products = [], reviews = [], rating } = data;
  const tags = marketTags(store.tags);
  const statusLabel = { pending: '待审核', active: '营业中', paused: '暂停营业', grace: '续费宽限期', suspended: '欠费暂停', closed: '已关闭', rejected: '审核未通过' };
  const storeQr = store.short_code || `store-${store.id}`;

  return (
    <div className="fade-in-up">
      <div className="mk-inline" style={{ marginBottom: 12 }}>
        <Link to="/market" className="btn btn-secondary btn-sm mk-icon-text"><IconArrowLeft size={14} />返回集市</Link>
        <Link to="/market/map" className="btn btn-secondary btn-sm">店铺地图</Link>
      </div>

      <div className="mk-store-hero">
        {store.cover
          ? <img className="mk-store-cover" src={store.cover} alt={store.name} />
          : <div className="mk-store-cover-ph" />}
        <div className="mk-store-hero-body">
          <img
            className="mk-store-avatar"
            src={store.avatar || '/images/default-avatar.png'}
            alt={store.name}
            onError={e => { e.currentTarget.src = '/images/default-avatar.png'; }}
          />
          <div className="mk-store-hero-info">
            <h1>
              {store.name}
              <span className={`badge ${store.status === 'active' ? 'badge-success' : 'badge-warning'}`} style={{ marginLeft: 8 }}>
                {statusLabel[store.status] || store.status}
              </span>
            </h1>
            <div className="mk-kv">
              <Stars value={rating} count={store.rating_count} countSuffix=" 条" />
              <span>成交 {store.sales_count || 0}</span>
              <span>订单 {store.order_count || 0}</span>
              {store.category?.name ? <span>分类：{store.category.name}</span> : null}
              {store.expire_at ? <span>有效期至 {formatDate(store.expire_at, false)}</span> : null}
            </div>
            {store.intro && <p className="mk-note" style={{ marginTop: 8 }}>{store.intro}</p>}
            {tags.length > 0 && (
              <div className="mk-tags">
                {tags.map(t => <span key={t} className="mk-tag">{t}</span>)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mk-inline" style={{ marginBottom: 16 }}>
        <button className={`btn mk-icon-text ${store.is_favorited ? 'btn-secondary' : 'btn-primary'}`} onClick={toggleFavorite} disabled={favBusy}>
          <StarToggle active={!!store.is_favorited} size={15} />
          {store.is_favorited ? '已收藏' : '收藏店铺'}
        </button>
        <button className="btn btn-secondary" onClick={() => setShowShare(true)} disabled={!storeQr}>分享二维码 / 海报</button>
        {store.is_owner && <Link to="/market/merchant" className="btn btn-secondary">商家后台管理</Link>}
      </div>

      {store.notice && (
        <div className="mk-notice">
          <strong>店铺公告：</strong>{store.notice}
        </div>
      )}

      <div className="mk-panel">
        <div className="mk-panel-title">
          位置（{store.locations?.length || 0}）
          <Link to="/market/map" className="btn btn-secondary btn-sm">在地图上查看</Link>
        </div>
        {(store.locations || []).length === 0 ? (
          <div className="mk-empty">店主还没有登记位置，可在商家后台添加</div>
        ) : (
          store.locations.map(l => (
            <div key={l.id} className="mk-loc-row">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {l.label || `${l.server_name || l.server_key} · ${DIM_LABEL[l.dimension] || l.dimension}${l.dimension === 'custom' && l.dimension_custom ? `（${l.dimension_custom}）` : ''}`}
                </div>
                <div className="mk-loc-coord">X {l.x} / Y {l.y} / Z {l.z}</div>
                {l.note && <div className="mk-note">{l.note}</div>}
              </div>
              <span className="badge badge-gray">{(l.server_name || l.server_key)}</span>
              {!l.is_public ? <span className="badge badge-warning">不公开</span> : null}
            </div>
          ))
        )}
      </div>

      <div className="mk-panel">
        <div className="mk-panel-title">在售商品（{products.length}）</div>
        {products.length === 0 ? (
          <div className="mk-empty">该店铺暂时没有上架商品</div>
        ) : (
          <div className="mk-product-grid">
            {products.map(p => (
              <Link key={p.id} to={`/market/product/${p.id}`} className={`mk-product-card ${p.status === 'soldout' || p.stock <= 0 ? 'mk-soldout' : ''}`}>
                {p.cover
                  ? <img className="mk-product-cover" src={p.cover} alt={p.title} loading="lazy" />
                  : <div className="mk-product-cover-ph"><IconPackage size={30} /></div>}
                <div className="mk-product-body">
                  <div className="mk-product-title">{p.title}</div>
                  <div className="mk-product-store">{p.summary || '点击查看详情'}</div>
                  <div className="mk-product-foot">
                    <span className="mk-price">{Number(p.price || 0).toFixed(2)}<small> 贡献点</small></span>
                    <span className="mk-stock">库存 {p.stock ?? 0}<br />已售 {p.sold || 0}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mk-panel">
        <div className="mk-panel-title">
          店铺评价 <Stars value={rating} count={store.rating_count} countSuffix=" 条" />
        </div>
        {reviews.length === 0 ? (
          <div className="mk-empty">还没有评价</div>
        ) : (
          reviews.map(r => (
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
          ))
        )}
      </div>

      <div className="mk-note">
        当前贡献点：{user ? Number(user.contribution || 0).toFixed(2) : '未登录'}
      </div>

      {showShare && <ShareModal shortCode={storeQr} title={store.name} onClose={() => setShowShare(false)} />}
    </div>
  );
}
