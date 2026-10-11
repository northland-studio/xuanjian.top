import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/UI';
import { IconClose } from '../components/MarketIcons';
import '../styles/market.css';

const DEFAULT_RANGE = { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000, flipZ: true };

function formatCoord(n) {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

export default function MarketMap() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [server, setServer] = useState('');
  const [dimension, setDimension] = useState('');
  const [keyword, setKeyword] = useState('');
  const [kwInput, setKwInput] = useState('');
  const [active, setActive] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (server) qs.set('server', server);
      if (dimension) qs.set('dimension', dimension);
      if (keyword) qs.set('keyword', keyword);
      const d = await api.get(`/api/market/map${qs.toString() ? `?${qs}` : ''}`);
      setData(d);
      setActive(null);
    } catch (e) {
      showToast(e.message || '加载地图失败', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [server, dimension, keyword, showToast]);

  useEffect(() => { load(); }, [load]);

  const points = data?.points || [];
  // 注意：后端 dimensions 返回的是 [{dimension:'overworld'}, ...] 这样的对象数组，需要取出键名
  const servers = data?.servers || [];
  const dimensions = (data?.dimensions || [])
    .map(d => (d && typeof d === 'object' ? d.dimension : d))
    .filter(Boolean);

  // 底图：取当前筛选结果里第一张有背景的图（后端按 服务器|维度 配置）
  const background = (data?.points || []).find(p => p.background)?.background || null;

  const range = useMemo(() => {
    const explicit = data?.mapRange?.default || DEFAULT_RANGE;
    return { ...DEFAULT_RANGE, ...explicit };
  }, [data]);

  const spanX = (range.maxX - range.minX) || 1;
  const spanZ = (range.maxZ - range.minZ) || 1;

  const axisLabels = useMemo(() => {
    const xs = [range.minX, range.minX + spanX / 2, range.maxX].map(formatCoord);
    const zs = [range.minZ, range.minZ + spanZ / 2, range.maxZ].map(formatCoord);
    return { xs, zs };
  }, [range, spanX, spanZ]);

  const submitSearch = (e) => {
    e.preventDefault();
    setKeyword(kwInput.trim());
  };

  const openPoint = (p) => {
    setActive(p);
  };

  return (
    <div className="fade-in-up">
      <div className="section-head">
        <h2 className="section-title">紫雪坊市 · 店铺地图</h2>
        <p className="section-desc">按服务器与维度筛选，点击标记查看店铺位置</p>
      </div>

      <div className="mk-toolbar">
        <form className="mk-search" onSubmit={submitSearch}>
          <input
            className="form-input"
            placeholder="搜索店铺名 / 位置备注"
            value={kwInput}
            onChange={e => setKwInput(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">搜索</button>
        </form>

        <div className="mk-chips">
          <span className="mk-chips-label">服务器</span>
          <button className={`mk-chip ${server === '' ? 'active' : ''}`} onClick={() => setServer('')}>全部</button>
          {servers.map(s => (
            <button key={s.server_key} className={`mk-chip ${server === s.server_key ? 'active' : ''}`} onClick={() => setServer(s.server_key)}>
              {s.server_name || s.server_key}
            </button>
          ))}
        </div>

        <div className="mk-chips">
          <span className="mk-chips-label">维度</span>
          <button className={`mk-chip ${dimension === '' ? 'active' : ''}`} onClick={() => setDimension('')}>全部</button>
          {dimensions.map(d => (
            <button key={d} className={`mk-chip ${dimension === d ? 'active' : ''}`} onClick={() => setDimension(d)}>
              {{ overworld: '主世界', nether: '下界', end: '末地', custom: '自定义' }[d] || d}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />加载地图...</div>
      ) : (
        <>
          <div className="mk-map-panel">
            {background && <img className="mk-map-bg" src={background} alt="地图底图" />}
            <div className="mk-map-inner">
              {/* 25% / 50% / 75% 网格线 */}
              {[25, 50, 75].map(v => (
                <div key={`v${v}`} className="mk-map-gridline" style={{ left: `${v}%`, top: 0, bottom: 0, width: 1 }} />
              ))}
              {[25, 50, 75].map(v => (
                <div key={`h${v}`} className="mk-map-gridline" style={{ top: `${v}%`, left: 0, right: 0, height: 1 }} />
              ))}

              {points.map(p => {
                if (p.px === null || p.px === undefined) return null;
                const left = `${p.px}%`;
                const top = p.range && p.range.flipZ === false ? `${p.py}%` : `${100 - p.py}%`;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`mk-map-mark ${p.inside === false ? 'outside' : ''}`}
                    style={{ left, top }}
                    title={`${p.store_name} · ${p.label || ''}`}
                    onClick={() => openPoint(p)}
                  >
                    <span className="mk-map-dot" />
                    <span className="mk-map-label">{p.store_name}</span>
                  </button>
                );
              })}

              {points.length === 0 && <div className="mk-map-empty">当前筛选下还没有公开的店铺位置</div>}
            </div>

            {/* 轴刻度 */}
            <span className="mk-map-axis min-x">{axisLabels.xs[0]}</span>
            <span className="mk-map-axis x">{axisLabels.xs[1]} X</span>
            <span className="mk-map-axis max-x">{axisLabels.xs[2]}</span>
            <span className="mk-map-axis min-z">{axisLabels.zs[0]}</span>
            <span className="mk-map-axis z">{axisLabels.zs[1]} Z</span>
            <span className="mk-map-axis max-z">{axisLabels.zs[2]}</span>
          </div>

          <div className="mk-result-line" style={{ marginTop: 12 }}>
            <span>
              共 {points.length} 个落点
              {points.some(p => p.inside === false) ? '（红色为超出地图范围的坐标）' : ''}
            </span>
            <a
              className="btn btn-secondary btn-sm"
              href={`/api/market/map/art.png?${new URLSearchParams({ ...(server ? { server } : {}), ...(dimension ? { dimension } : {}) }).toString()}`}
              target="_blank"
              rel="noreferrer"
            >
              导出地图画
            </a>
          </div>

          <div className="mk-panel" style={{ marginTop: 14 }}>
            <div className="mk-panel-title">落点列表</div>
            {points.length === 0 ? (
              <div className="mk-empty">暂无数据</div>
            ) : points.map(p => (
              <div key={`row-${p.id}`} className="mk-list-row">
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>
                    {p.store_name}
                    {p.label ? ` · ${p.label}` : ''}
                    {p.inside === false ? <span className="badge badge-danger" style={{ marginLeft: 6 }}>超出范围</span> : null}
                  </div>
                  <div className="mk-loc-coord">
                    {p.server_name || p.server_key} / {p.dimension_label || p.dimension}
                    {p.dimension === 'custom' && p.dimension_custom ? `（${p.dimension_custom}）` : ''}
                    ：X {p.x} Y {p.y} Z {p.z}
                  </div>
                  {p.note && <div className="mk-note">{p.note}</div>}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/market/store/${p.store_id}`)}>进店</button>
              </div>
            ))}
          </div>
        </>
      )}

      {active && (
        <div className="modal-overlay" onClick={() => setActive(null)}>
          <div className="modal-content" style={{ maxWidth: 340 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{active.store_name}</h3>
              <button className="modal-close mk-modal-close" onClick={() => setActive(null)} aria-label="关闭" title="关闭"><IconClose size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="mk-kv">
                <span>服务器 {active.server_name || active.server_key}</span>
                <span>维度 {active.dimension_label || active.dimension}{active.dimension_custom ? `（${active.dimension_custom}）` : ''}</span>
              </div>
              <div className="mk-loc-coord" style={{ marginTop: 8 }}>
                坐标 X {active.x} / Y {active.y} / Z {active.z}
              </div>
              {active.label && <div className="mk-note" style={{ marginTop: 6 }}>标注：{active.label}</div>}
              {active.note && <div className="mk-note">{active.note}</div>}
              {active.inside === false && <div className="mk-note" style={{ color: 'var(--danger)' }}>该坐标超出地图范围，标记位置已按边界裁剪显示</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActive(null)}>关闭</button>
              <Link className="btn btn-primary" to={`/market/store/${active.store_id}`}>进入店铺</Link>
            </div>
          </div>
        </div>
      )}

      <div className="mk-note" style={{ marginTop: 14 }}>
        地图坐标为后端按服务器/维度配置投影后的百分比位置，仅供参考，实际以游戏内坐标为准。
      </div>
    </div>
  );
}
