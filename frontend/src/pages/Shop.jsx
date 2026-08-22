import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { requireLogin, formatDate } from '../utils';

// 商品/权限卡片：普通商品支持选择数量批量购买（整批 1 个核销码），权限类商品不支持数量
function ItemCard({ item, type, buying, onBuy }) {
  const maxQty = item.stock === -1 ? 99 : Math.max(1, item.stock || 1);
  const [qty, setQty] = useState(1);

  const changeQty = (v) => {
    const n = parseInt(v) || 1;
    setQty(Math.min(maxQty, Math.max(1, n)));
  };

  return (
    <div className="card card-hover" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
      {item.image ? (
        <img src={item.image} alt={item.name} style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, marginBottom: 14 }} />
      ) : (
        <div className="flex-center" style={{ width: '100%', height: 140, background: 'var(--input-bg)', borderRadius: 10, marginBottom: 14, fontSize: 40, opacity: 0.6 }}>
          {type === 'permission' ? (
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ) : (
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          )}
        </div>
      )}
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{item.name}</h3>
      <p className="text-secondary" style={{ fontSize: 13, marginBottom: 14, minHeight: 40, lineHeight: 1.6 }}>{item.description || '暂无描述'}</p>
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--warning)' }}>{item.price} <span style={{ fontSize: 13, fontWeight: 400 }}>贡献点</span></span>
        <span className="text-secondary" style={{ fontSize: 12 }}>
          {type === 'permission' ? `有效期 ${item.duration_days || 0} 天` : (item.stock === -1 ? '不限量' : `库存 ${item.stock}`)}
        </span>
      </div>
      {type !== 'permission' && (
        <div className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <span className="text-secondary" style={{ fontSize: 12 }}>数量</span>
          <input
            type="number" min={1} max={maxQty} value={qty}
            onChange={e => changeQty(e.target.value)}
            className="form-input" style={{ width: 64, textAlign: 'center' }}
          />
          <span className="text-secondary" style={{ fontSize: 12 }}>{item.stock === -1 ? '' : `上限 ${item.stock}`}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)' }}>合计 {item.price * qty}</span>
        </div>
      )}
      <button className="btn btn-primary btn-block" style={{ marginTop: 'auto' }} onClick={() => onBuy(type, item.id, item.name, item.price, item.duration_days, qty)} disabled={buying}>
        {type === 'permission' ? '立即兑换' : `购买 ×${qty}`}
      </button>
    </div>
  );
}

export default function Shop() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState('items'); // 优先展示商品 tab
  const [titles, setTitles] = useState([]);
  const [items, setItems] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [myPermissions, setMyPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [t, i, p, mp] = await Promise.all([
        api.get('/api/titles').then(d => d.titles || []).catch(() => []),
        api.get('/api/shop/items?type=other').then(d => d.items || []).catch(() => []),
        api.get('/api/shop/items?type=permission').then(d => d.items || []).catch(() => []),
        api.get('/api/shop/my-permissions').then(d => d.items || []).catch(() => [])
      ]);
      setTitles(t);
      setItems(i);
      setPermissions(p);
      setMyPermissions(mp);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const buy = async (type, id, name, price, durationDays, qty = 1) => {
    if (!requireLogin(navigate, '请先登录后再购买')) return;
    const confirmText = type === 'permission'
      ? `确定用 ${price} 贡献点兑换「${name}」？\n开通后有效期 ${durationDays} 天`
      : `确定购买「${name}」×${qty}？\n总价：${price * qty} 贡献点（单价 ${price}）\n整批仅生成 1 个核销码`;
    if (!confirm(confirmText)) return;
    setBuying(true);
    try {
      if (type === 'title') {
        await api.post(`/api/titles/${id}/buy`, {});
        showToast('购买成功！', 'success');
      } else {
        const data = await api.post(`/api/shop/items/${id}/buy`, { quantity: qty });
        if (data.purchasedItems?.[0]?.expiresAt) {
          showToast(`兑换成功，有效期至 ${data.purchasedItems[0].expiresAt}`, 'success');
        } else {
          const code = data.purchasedItems?.[0]?.verificationCode;
          showToast(code ? `购买成功！核销码：${code}（${qty} 件共 1 码）` : '购买成功！', 'success');
        }
      }
      updateUser({ ...user, contribution: (user?.contribution ?? 0) - price * qty });
      fetchAll();
    } catch (e) {
      showToast(e.message || '购买失败', 'error');
    } finally {
      setBuying(false);
    }
  };

  const renderItemCard = (item, type) => <ItemCard key={item.id} item={item} type={type} buying={buying} onBuy={buy} />;

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/7.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>贡献点商城</h1>
          <p>按劳分配，贡献点兑换称号、物品与公会资源使用权限</p>
          <div className="flex" style={{ gap: 10 }}>
            <Link to="/inventory" className="btn btn-primary">我的库存</Link>
            <Link to="/trade" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>贡献点交易</Link>
          </div>
        </div>
      </div>

      {user && (
        <div className="card mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '16px 20px' }}>
          <span style={{ fontSize: 15 }}>当前贡献点：</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning)' }}>{user.contribution ?? 0} <span style={{ fontSize: 13, fontWeight: 400 }}>点</span></span>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex" style={{ gap: 10, marginBottom: 20 }}>
        <button className={`btn ${tab === 'titles' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('titles')}>称号</button>
        <button className={`btn ${tab === 'items' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('items')}>物品</button>
        <button className={`btn ${tab === 'permissions' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('permissions')}>使用权限</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />加载中...</div>
      ) : tab === 'titles' ? (
        <div className="grid grid-3">
          {titles.map(t => (
            <div key={t.id} className="card card-hover text-center" style={{ padding: 28, display: 'flex', flexDirection: 'column' }}>
              <div
                className="flex-center"
                style={{
                  width: 64, height: 64, margin: '0 auto 16px', borderRadius: 16,
                  background: t.color ? `${t.color}22` : 'var(--gradient)', color: t.color || '#fff',
                  fontSize: 30, fontWeight: 800
                }}
              >
                {t.name.charAt(0)}
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: t.color || 'var(--text)', marginBottom: 10 }}>{t.name}</h3>
              {t.description && <p className="text-secondary" style={{ fontSize: 13, marginBottom: 16, minHeight: 40 }}>{t.description}</p>}
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--warning)', marginBottom: 14 }}>{t.price} <span style={{ fontSize: 13, fontWeight: 400 }}>贡献点</span></div>
              <button className="btn btn-primary btn-block" style={{ marginTop: 'auto' }} onClick={() => buy('title', t.id, t.name, t.price)} disabled={buying}>购买</button>
            </div>
          ))}
          {titles.length === 0 && <div className="empty-state" style={{ gridColumn: '1/-1' }}>暂无称号</div>}
        </div>
      ) : tab === 'items' ? (
        <div className="grid grid-3">
          {items.map(item => renderItemCard(item, 'other'))}
          {items.length === 0 && <div className="empty-state" style={{ gridColumn: '1/-1' }}>暂无物品</div>}
        </div>
      ) : (
        <div className="flex-col" style={{ gap: 24 }}>
          {/* 可兑换的权限 */}
          <div>
            <div className="section-head">
              <h2 className="section-title">可兑换权限</h2>
              <p className="text-secondary" style={{ fontSize: 13 }}>兑换公会仓库 / 机器使用权限，兑换后立即生效</p>
            </div>
            {permissions.length === 0 ? (
              <div className="empty-state"><p>暂无可兑换权限</p></div>
            ) : (
              <div className="grid grid-3">
                {permissions.map(item => renderItemCard(item, 'permission'))}
              </div>
            )}
          </div>

          {/* 我的有效权限 */}
          {user && (
            <div>
              <div className="section-head">
                <h2 className="section-title">我的有效权限</h2>
              </div>
              {myPermissions.length === 0 ? (
                <div className="empty-state"><p>还没有有效权限，快去兑换吧</p></div>
              ) : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  {myPermissions.map(p => (
                    <div key={p.id} className="flex-between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', gap: 12, alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                        {p.description && <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>{p.description}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span className="badge badge-success">使用中</span>
                        <div className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>
                          {p.expires_at ? `至 ${formatDate(p.expires_at)}` : '长期有效'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
