import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { requireLogin } from '../utils';

export default function Shop() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState('titles');
  const [titles, setTitles] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/api/titles').then(d => d.titles || []).catch(() => []),
      api.get('/api/shop/items?type=other').then(d => d.items || []).catch(() => [])
    ]).then(([t, i]) => {
      setTitles(t);
      setItems(i);
      setLoading(false);
    });
  }, []);

  const buy = async (type, id, name, price) => {
    if (!requireLogin(navigate, '请先登录后再购买')) return;
    if (!confirm(`确定购买「${name}」？\n价格：${price} 贡献点`)) return;
    try {
      if (type === 'title') {
        await api.post(`/api/titles/${id}/buy`, {});
      } else {
        await api.post(`/api/shop/items/${id}/buy`, { quantity: 1 });
      }
      showToast('购买成功！', 'success');
    } catch (e) {
      showToast(e.message || '购买失败', 'error');
    }
  };

  const myItemsUrl = user ? `/profile` : '/login';

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/7.png)' }}>
        <div className="page-banner-content">
          <h1>会员商城</h1>
          <p>使用贡献点兑换专属称号与好物，享受会员特权</p>
          <div className="flex" style={{ gap: 10 }}>
            <Link to={myItemsUrl} className="btn btn-primary">我的库存</Link>
            <Link to="/claims" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>贡献点申报</Link>
          </div>
        </div>
      </div>

      {user && (
        <div className="card mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 15 }}>当前贡献点：</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning)' }}>{user.contribution ?? 0} <span style={{ fontSize: 13, fontWeight: 400 }}>点</span></span>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex" style={{ gap: 10, marginBottom: 20 }}>
        <button className={`btn ${tab === 'titles' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('titles')}>称号</button>
        <button className={`btn ${tab === 'items' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('items')}>商品</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />加载中...</div>
      ) : tab === 'titles' ? (
        <div className="grid grid-3">
          {titles.map(t => (
            <div key={t.id} className="card card-hover text-center" style={{ padding: 28 }}>
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
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b', marginBottom: 14 }}>{t.price} <span style={{ fontSize: 13, fontWeight: 400 }}>贡献点</span></div>
              <button className="btn btn-primary btn-block" onClick={() => buy('title', t.id, t.name, t.price)}>购买</button>
            </div>
          ))}
          {titles.length === 0 && <div className="empty-state" style={{ gridColumn: '1/-1' }}>暂无称号</div>}
        </div>
      ) : (
        <div className="grid grid-3">
          {items.map(item => (
            <div key={item.id} className="card card-hover" style={{ padding: 24 }}>
              {item.image ? (
                <img src={item.image} alt={item.name} style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, marginBottom: 14 }} />
              ) : (
                <div className="flex-center" style={{ width: '100%', height: 140, background: 'var(--input-bg)', borderRadius: 10, marginBottom: 14, fontSize: 44, opacity: 0.6 }}>📦</div>
              )}
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{item.name}</h3>
              <p className="text-secondary" style={{ fontSize: 13, marginBottom: 14, minHeight: 40, lineHeight: 1.6 }}>{item.description || '暂无描述'}</p>
              <div className="flex-between" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{item.price} <span style={{ fontSize: 13, fontWeight: 400 }}>贡献点</span></span>
                <span className="text-secondary" style={{ fontSize: 12 }}>{item.stock === -1 ? '不限量' : `库存 ${item.stock}`}</span>
              </div>
              <button className="btn btn-primary btn-block" onClick={() => buy('item', item.id, item.name, item.price)}>购买</button>
            </div>
          ))}
          {items.length === 0 && <div className="empty-state" style={{ gridColumn: '1/-1' }}>暂无商品</div>}
        </div>
      )}
    </div>
  );
}
