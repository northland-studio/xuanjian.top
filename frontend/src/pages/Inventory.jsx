import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/UI';
import { requireLogin, formatDate } from '../utils';

export default function Inventory() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [tab, setTab] = useState('items');
  const [items, setItems] = useState([]);
  const [titles, setTitles] = useState([]);
  const [equippedTitle, setEquippedTitle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!requireLogin(navigate)) return;
    Promise.all([
      api.get('/api/shop/my-items').then(d => d.items || []).catch(() => []),
      api.get('/api/titles/my').then(d => { setEquippedTitle(d.equippedTitle); return d.titles || []; }).catch(() => [])
    ]).then(([i, t]) => {
      setItems(i);
      setTitles(t);
      setLoading(false);
    });
  }, [navigate]);

  const equipTitle = async (titleId) => {
    try {
      await api.put('/api/titles/equip', { titleId });
      setEquippedTitle(titleId);
      showToast('称号装备成功', 'success');
    } catch (e) {
      showToast(e.message || '装备失败', 'error');
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />加载中...</div>;

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/2.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>我的库存</h1>
          <p>管理你已获得的商品与称号</p>
        </div>
      </div>

      <div className="flex" style={{ gap: 10, marginBottom: 20 }}>
        <button className={`btn ${tab === 'items' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('items')}>我的商品</button>
        <button className={`btn ${tab === 'titles' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('titles')}>我的称号</button>
      </div>

      {tab === 'items' ? (
        items.length === 0 ? (
          <div className="empty-state">
            <p>还没有购买任何商品</p>
            <Link to="/shop" className="btn btn-primary mt-3">去逛逛商城</Link>
          </div>
        ) : (
          <div className="grid grid-3">
            {items.map(it => (
              <div key={it.id} className="card" style={{ padding: 20 }}>
                {it.image ? (
                  <img src={it.image} alt={it.name} style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 8, marginBottom: 12 }} />
                ) : (
                  <div className="flex-center" style={{ width: '100%', height: 100, background: 'var(--input-bg)', borderRadius: 8, marginBottom: 12, fontSize: 36, opacity: 0.6 }}>📦</div>
                )}
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                  {it.name}
                  {it.quantity > 1 && <span className="badge badge-primary" style={{ marginLeft: 8, fontSize: 12 }}>×{it.quantity}</span>}
                </h3>
                <p className="text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>{it.description || ''}</p>
                {it.type === 'permission' ? (
                  <div style={{ fontSize: 12, marginBottom: 8 }}>
                    {it.expires_at ? (
                      <>
                        <span className="badge badge-success">使用中</span>
                        <div className="text-secondary" style={{ marginTop: 4 }}>有效期至 {formatDate(it.expires_at)}</div>
                      </>
                    ) : (
                      <span className="badge badge-success">长期有效</span>
                    )}
                  </div>
                ) : it.verification_code ? (
                  <>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                      <span className="text-secondary">核销码：</span>
                      <code style={{ background: 'var(--input-bg)', padding: '2px 8px', borderRadius: 6, fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}>{it.verification_code}</code>
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 8 }}>
                      {it.verified_at ? (
                        <span className="badge badge-success">已核销 {formatDate(it.verified_at, false)}</span>
                      ) : (
                        <span className="badge badge-warning">待核销</span>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, marginBottom: 10 }}>
                    <span className="badge badge-success">已发放</span>
                  </div>
                )}
                <div className="text-secondary" style={{ fontSize: 12 }}>兑换于 {formatDate(it.purchased_at, false)}</div>
              </div>
            ))}
          </div>
        )
      ) : titles.length === 0 ? (
        <div className="empty-state">
          <p>还没有获得任何称号</p>
          <Link to="/shop" className="btn btn-primary mt-3">去商城购买称号</Link>
        </div>
      ) : (
        <div className="grid grid-3">
          {titles.map(t => (
            <div key={t.id} className={`card text-center ${equippedTitle === t.id ? 'title-equipped' : ''}`} style={{ padding: 24, borderColor: equippedTitle === t.id ? 'var(--success)' : undefined }}>
              <div className="flex-center" style={{ width: 56, height: 56, margin: '0 auto 12px', borderRadius: 14, background: t.color ? `${t.color}22` : 'var(--gradient)', color: t.color || '#fff', fontSize: 26, fontWeight: 800 }}>
                {t.name.charAt(0)}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: t.color || 'var(--text)', marginBottom: 10 }}>{t.name}</h3>
              {t.description && <p className="text-secondary" style={{ fontSize: 12, marginBottom: 14, minHeight: 34 }}>{t.description}</p>}
              {equippedTitle === t.id ? (
                <span className="badge badge-success">装备中</span>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={() => equipTitle(t.id)}>装备</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
