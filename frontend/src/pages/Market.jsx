import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { CategoryIcon, IconMap, IconPackage, IconPin, IconReceipt, IconShield, IconStore, Stars } from '../components/MarketIcons';
import { marketTags, money } from '../market/helpers';
import '../styles/market.css';

const PAGE_SIZE = 12;

// 集市首页排序：店铺走 hot/rating/new，商品走 hot/new/price_asc/price_desc
const STORE_SORTS = [
  { key: 'hot', label: '最热' },
  { key: 'rating', label: '好评' },
  { key: 'new', label: '最新' }
];
const PRODUCT_SORTS = [
  { key: 'hot', label: '最热' },
  { key: 'new', label: '最新' },
  { key: 'price_asc', label: '价格升序' },
  { key: 'price_desc', label: '价格降序' }
];

function StoreCard({ store }) {
  const tags = marketTags(store.tags);
  return (
    <Link to={`/market/store/${store.id}`} className="mk-store-card">
      <img
        className="mk-store-avatar"
        src={store.avatar || store.cover || '/images/default-avatar.png'}
        alt={store.name}
        loading="lazy"
        onError={e => { e.currentTarget.src = '/images/default-avatar.png'; }}
      />
      <div className="mk-store-main">
        <div className="mk-store-name">
          <span>{store.name}</span>
          {store.is_featured ? <span className="badge badge-warning">推荐</span> : null}
          {store.category_name ? <span className="badge badge-gray">{store.category_name}</span> : null}
        </div>
        <div className="mk-store-intro">{store.intro || '这个店铺还没有写简介'}</div>
        <div className="mk-store-meta">
          <Stars value={store.rating_count > 0 ? store.rating_sum / store.rating_count : 0} count={store.rating_count} />
          <span>成交 {store.sales_count || 0}</span>
          <span>订单 {store.order_count || 0}</span>
        </div>
        {tags.length > 0 && (
          <div className="mk-tags">
            {tags.slice(0, 4).map(t => <span key={t} className="mk-tag">{t}</span>)}
          </div>
        )}
      </div>
    </Link>
  );
}

function ProductCard({ product }) {
  const soldOut = product.status === 'soldout' || (product.stock !== undefined && product.stock <= 0);
  return (
    <Link to={`/market/product/${product.id}`} className={`mk-product-card ${soldOut ? 'mk-soldout' : ''}`}>
      {product.cover
        ? <img className="mk-product-cover" src={product.cover} alt={product.title} loading="lazy" />
        : <div className="mk-product-cover-ph"><IconPackage size={30} /></div>}
      <div className="mk-product-body">
        <div className="mk-product-title">{product.title}</div>
        <div className="mk-product-store">{product.store_name || '未知店铺'}</div>
        <div className="mk-product-foot">
          <span className="mk-price">{money(product.price)}<small> 贡献点</small></span>
          <span className="mk-stock">
            {product.stock === -1 ? '不限量' : `库存 ${product.stock ?? 0}`}
            <br />已售 {product.sold || 0}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function Market() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState('stores'); // stores | products
  const [keyword, setKeyword] = useState('');
  const [kwInput, setKwInput] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState('hot');

  const [stores, setStores] = useState([]);
  const [storeTotal, setStoreTotal] = useState(0);
  const [storePage, setStorePage] = useState(1);

  const [products, setProducts] = useState([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productPage, setProductPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api.get('/api/market/config')
      .then(d => setCfg(d))
      .catch(e => showToast(e.message || '加载集市配置失败', 'error'));
  }, [showToast]);

  const categories = useMemo(() => {
    if (!cfg) return [];
    return tab === 'stores' ? (cfg.categories?.store || []) : (cfg.categories?.product || []);
  }, [cfg, tab]);

  const loadStores = useCallback(async (page, append) => {
    const qs = new URLSearchParams();
    if (keyword) qs.set('keyword', keyword);
    if (categoryId) qs.set('category_id', categoryId);
    if (sort) qs.set('sort', sort);
    qs.set('limit', String(PAGE_SIZE));
    qs.set('page', String(page));
    const d = await api.get(`/api/market/stores?${qs.toString()}`);
    setStoreTotal(d.total || 0);
    setStorePage(page);
    setStores(prev => (append ? [...prev, ...(d.items || [])] : (d.items || [])));
  }, [keyword, categoryId, sort]);

  const loadProducts = useCallback(async (page, append) => {
    const qs = new URLSearchParams();
    if (keyword) qs.set('keyword', keyword);
    if (categoryId) qs.set('category_id', categoryId);
    if (sort) qs.set('sort', sort);
    qs.set('limit', String(PAGE_SIZE));
    qs.set('page', String(page));
    const d = await api.get(`/api/market/products?${qs.toString()}`);
    setProductTotal(d.total || 0);
    setProductPage(page);
    setProducts(prev => (append ? [...prev, ...(d.items || [])] : (d.items || [])));
  }, [keyword, categoryId, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'stores') await loadStores(1, false);
      else await loadProducts(1, false);
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, loadStores, loadProducts, showToast]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      if (tab === 'stores') await loadStores(storePage + 1, true);
      else await loadProducts(productPage + 1, true);
    } catch (e) {
      showToast(e.message || '加载更多失败', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const switchTab = (next) => {
    setTab(next);
    setCategoryId('');
    setSort('hot');
  };

  const submitSearch = (e) => {
    e.preventDefault();
    setKeyword(kwInput.trim());
  };

  const total = tab === 'stores' ? storeTotal : productTotal;
  const page = tab === 'stores' ? storePage : productPage;
  const hasMore = (tab === 'stores' ? stores.length : products.length) < total;

  const fees = cfg?.fees || {};
  const tax = cfg?.tax || {};
  const taxPercent = tax.enabled ? ((Number(tax.rateBp) || 0) / 100).toFixed(2).replace(/\.?0+$/, '') : null;

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.55)), url(/7.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>紫雪坊市 · 公会集市</h1>
          <p>玩家自营店铺 · 面对面交易 · 公会只提供场地与账本</p>
          <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Link to="/market/map" className="btn btn-primary">店铺地图</Link>
            <Link to="/market/orders" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>我的订单</Link>
            <Link to="/market/merchant" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>商家后台</Link>
            {user?.level >= 1 && (
              <Link to="/admin#market" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>管理后台</Link>
            )}
          </div>
        </div>
      </div>

      {/* 费率说明：开店费 / 续期费 / 交易税（公会不抽成、不设余额账号） */}
      <div className="mk-feebar">
        <div className="mk-fee-item">
          <span className="k">开店费</span>
          <span className="v">
            {fees.openFeeEnabled === false
              ? '暂不收费'
              : (Number(fees.openFee) > 0 ? <>{Number(fees.openFee).toFixed(2)}<small> 贡献点</small></> : '免费')}
          </span>
        </div>
        <div className="mk-fee-item">
          <span className="k">续期费（{fees.cycleDays || 30} 天/期）</span>
          <span className="v">
            {fees.renewFeeEnabled === false
              ? '暂不收费'
              : (Number(fees.renewFee) > 0 ? <>{Number(fees.renewFee).toFixed(2)}<small> 贡献点</small></> : '免费')}
          </span>
        </div>
        <div className="mk-fee-item">
          <span className="k">交易税（{tax.mode === 'buyer' ? '买家承担' : '商家承担'}）</span>
          <span className="v">
            {taxPercent ? <>{taxPercent}<small>%</small></> : '未启用'}
          </span>
        </div>
        <div className="mk-fee-item mk-fee-note">
          <span className="k">说明</span>
          <span className="v">
            {fees.openFeeFirstFree ? '首店免开店费；' : ''}
            公会只收上述费用，不设余额账号、只记分户账；交易款在确认收货前由托管账号代持。
          </span>
        </div>
      </div>

      <div className="mk-quick">
        <Link to="/market/map"><IconMap size={17} />店铺地图</Link>
        <Link to="/market/orders"><IconReceipt size={17} />我的订单</Link>
        <Link to="/market/merchant"><IconStore size={17} />商家后台</Link>
        {user?.level >= 1
          ? <Link to="/admin#market"><IconShield size={17} />管理后台</Link>
          : <Link to="/market/map"><IconPin size={17} />找店铺</Link>}
      </div>

      <div className="mk-tabs">
        <button className={`btn ${tab === 'stores' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchTab('stores')}>店铺</button>
        <button className={`btn ${tab === 'products' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchTab('products')}>商品</button>
      </div>

      <div className="mk-toolbar">
        <form className="mk-search" onSubmit={submitSearch}>
          <input
            className="form-input"
            placeholder={tab === 'stores' ? '搜索店铺名 / 简介 / 标签' : '搜索商品标题 / 简介 / 标签'}
            value={kwInput}
            onChange={e => setKwInput(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">搜索</button>
          {keyword && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => { setKwInput(''); setKeyword(''); }}
            >
              清空
            </button>
          )}
        </form>

        <div className="mk-chips">
          <span className="mk-chips-label">分类</span>
          <button className={`mk-chip ${categoryId === '' ? 'active' : ''}`} onClick={() => setCategoryId('')}>全部</button>
          {categories.map(c => (
            <button
              key={c.id}
              className={`mk-chip ${String(categoryId) === String(c.id) ? 'active' : ''}`}
              onClick={() => setCategoryId(String(c.id))}
            >
              <CategoryIcon slug={c.slug} size={14} />{c.name}
            </button>
          ))}
        </div>

        <div className="mk-chips">
          <span className="mk-chips-label">排序</span>
          {(tab === 'stores' ? STORE_SORTS : PRODUCT_SORTS).map(s => (
            <button key={s.key} className={`mk-chip ${sort === s.key ? 'active' : ''}`} onClick={() => setSort(s.key)}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className="mk-result-line">
        <span>
          共 {total} {tab === 'stores' ? '家店铺' : '件商品'}
          {keyword ? `（关键词「${keyword}」）` : ''}
        </span>
        {cfg?.limits?.maxProductsPerStore ? <span>每店最多 {cfg.limits.maxProductsPerStore} 件商品</span> : null}
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />加载中...</div>
      ) : tab === 'stores' ? (
        stores.length === 0 ? (
          <div className="empty-state">
            <p>还没有符合条件的店铺</p>
            <Link to="/market/merchant" className="btn btn-primary">去开店</Link>
          </div>
        ) : (
          <div className="mk-store-grid">
            {stores.map(s => <StoreCard key={s.id} store={s} />)}
          </div>
        )
      ) : (
        products.length === 0 ? (
          <div className="empty-state"><p>还没有符合条件的商品</p></div>
        ) : (
          <div className="mk-product-grid">
            {products.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        )
      )}

      {!loading && hasMore && (
        <div className="mk-loadmore">
          <button className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? '加载中...' : `加载更多（第 ${page + 1} 页）`}
          </button>
        </div>
      )}

      <div className="mk-note" style={{ marginTop: 20 }}>
        {cfg?.limits?.verifyCodeTtlHours ? `核销码有效期 ${cfg.limits.verifyCodeTtlHours} 小时；` : ''}
        下单后请在游戏内与商家当面交付，确认收货后交易款才结算给商家。
        {user ? '' : '（登录后可下单、核销与评价）'}
        {cfg?.fees?.graceDays ? ` 到期后有 ${cfg.fees.graceDays} 天宽限期可续费。` : ''}
      </div>
    </div>
  );
}
