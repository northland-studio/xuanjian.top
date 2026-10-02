import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/UI';
import { formatDate } from '../utils';

/**
 * 头衔给予（管理后台分页）
 *
 * 用途：管理员把某个头衔**直接放进指定玩家的仓库**（「我的库存 → 我的称号」），
 * 不扣贡献点、不需要玩家先拥有，和商城购买是两条独立路径。
 *
 * 玩家定位：支持账号ID（数字，按注册顺序）/ 用户ID（自定义，/profile/<用户ID>）/ 昵称 / 邮箱 模糊搜索，
 * 选中后先列出该玩家已有头衔，避免重复发放（后端也会拦一次）。
 */
export default function TitleGrantPanel() {
  const { showToast } = useToast();
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [target, setTarget] = useState(null);          // 选中的玩家
  const [owned, setOwned] = useState([]);              // 该玩家已有头衔
  const [equippedTitle, setEquippedTitle] = useState(null);
  const [titles, setTitles] = useState([]);            // 全部头衔（含未上架）
  const [titleId, setTitleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingTitles, setLoadingTitles] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    api.get('/api/titles/all')
      .then(d => setTitles(d.titles || []))
      .catch(e => showToast(e.message || '加载头衔失败', 'error'))
      .finally(() => setLoadingTitles(false));
  }, [showToast]);

  const loadOwned = useCallback(async (userId) => {
    try {
      const d = await api.get(`/api/titles/user/${userId}`);
      setOwned(d.titles || []);
      setEquippedTitle(d.equippedTitle || null);
    } catch (e) {
      setOwned([]);
      setEquippedTitle(null);
    }
  }, []);

  const search = async (e) => {
    e?.preventDefault?.();
    const kw = keyword.trim();
    if (!kw) { setResults([]); return; }
    const my = ++seq.current;
    setSearching(true);
    try {
      const d = await api.get(`/api/admin/users?search=${encodeURIComponent(kw)}&limit=10`);
      if (my !== seq.current) return;      // 只认最后一次搜索
      setResults(d.users || []);
      if (!(d.users || []).length) showToast('没有匹配的玩家', 'error');
    } catch (err) {
      showToast(err.message || '搜索失败', 'error');
    } finally {
      if (my === seq.current) setSearching(false);
    }
  };

  const pick = async (u) => {
    setTarget(u);
    setTitleId('');
    await loadOwned(u.id);
  };

  const ownedIds = useMemo(() => new Set(owned.map(t => t.id)), [owned]);

  const grant = async () => {
    if (!target || !titleId) { showToast('请先选择玩家与头衔', 'error'); return; }
    setBusy(true);
    try {
      const d = await api.post('/api/titles/grant', { userId: target.id, titleId: Number(titleId) });
      showToast(d.message || '发放成功', 'success');
      setTitleId('');
      await loadOwned(target.id);
    } catch (e) {
      showToast(e.message || '发放失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>头衔给予</h3>
      <p className="text-secondary" style={{ fontSize: 13, marginBottom: 16 }}>
        把头衔直接放进指定玩家的仓库：发放后出现在该玩家的「我的库存 → 我的称号」，可自行装备（不扣贡献点）。
      </p>

      {/* 1. 选玩家 */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>1. 选择玩家</div>
        <form className="flex" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={search}>
          <input
            className="form-input"
            style={{ flex: '1 1 260px' }}
            placeholder="账号ID / 用户ID / 昵称 / 邮箱"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={searching}>{searching ? '搜索中...' : '搜索'}</button>
        </form>

        {results.length > 0 && (
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>账号ID</th>
                  <th>用户ID</th>
                  <th>昵称</th>
                  <th>邮箱</th>
                  <th>代系</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.map(u => (
                  <tr key={u.id} style={target?.id === u.id ? { background: 'var(--input-bg)' } : undefined}>
                    <td>{u.id}</td>
                    <td><code>{u.username}</code></td>
                    <td>{u.nickname || '—'}</td>
                    <td className="text-secondary" style={{ fontSize: 12 }}>{u.email || '未绑定'}</td>
                    <td>{u.generation_display || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => pick(u)}>
                        {target?.id === u.id ? '已选中' : '选为发放对象'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. 选头衔 */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>2. 选择头衔并发放</div>

        {!target ? (
          <div className="empty-state" style={{ padding: 16 }}><p>先在上面选一个玩家</p></div>
        ) : (
          <>
            <div className="flex" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', background: 'var(--input-bg)', borderRadius: 8, fontSize: 13 }}>
              <b>{target.nickname || target.username}</b>
              <span className="text-secondary">账号ID {target.id} · 用户ID {target.username}</span>
              <span className="text-secondary">注册 {formatDate(target.created_at, false)}</span>
              <span className="text-secondary">贡献点 {Number(target.contribution || 0).toFixed(2)}</span>
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="text-secondary" style={{ fontSize: 12, marginBottom: 6 }}>
                该玩家已有头衔（{owned.length}）{equippedTitle ? '，当前装备中' : ''}
              </div>
              {owned.length === 0 ? (
                <div className="text-secondary" style={{ fontSize: 13 }}>暂无头衔</div>
              ) : (
                <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {owned.map(t => (
                    <span
                      key={t.id}
                      className="badge"
                      style={{ background: `${t.color || 'var(--primary)'}22`, color: t.color || 'var(--primary)', border: `1px solid ${t.color || 'var(--primary)'}44` }}
                    >
                      {t.name}{equippedTitle === t.id ? '（装备中）' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex" style={{ gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 280px' }}>
                <label className="form-label">要发放的头衔</label>
                <select className="form-input" value={titleId} onChange={e => setTitleId(e.target.value)} disabled={loadingTitles}>
                  <option value="">{loadingTitles ? '加载中...' : '请选择头衔'}</option>
                  {titles.map(t => (
                    <option key={t.id} value={t.id} disabled={ownedIds.has(t.id)}>
                      {t.name}{ownedIds.has(t.id) ? '（已有）' : ''}{t.is_active ? '' : '（已下架）'}{t.price ? ` · ${t.price} 点` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={grant} disabled={busy || !titleId}>
                {busy ? '发放中...' : '给予头衔'}
              </button>
            </div>

            <p className="text-secondary" style={{ fontSize: 12, marginTop: 10 }}>
              发放后会给该玩家发一条站内通知（并尝试 Web Push）；重复发放会被拦截。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
