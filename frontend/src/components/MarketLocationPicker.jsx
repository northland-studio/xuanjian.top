/**
 * 集市地点选择器（GIS 地图选点 + 坐标手输双入口）
 *
 * 规范第十七条：用 GIS 地图能力替换旧地点选择，同时保留「地图定位 / 坐标输入 / 地图选点」三种方式，
 * 复用既有 server / dimension / X / Y / Z 字段，不新建并行地点系统。
 *
 * 本组件只负责“选点”，真正的写入仍走集市既有接口（market_store_locations），
 * 因此不会影响商品 / 店铺 / 订单 / 托管 / 退款 / 结算逻辑。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import GisMap from './gis/GisMap';

const DIM_LABEL = { overworld: '主世界', nether: '下界', end: '末地', custom: '自定义' };

export default function MarketLocationPicker({ value, onChange, disabled = false, height = '320px' }) {
    const [config, setConfig] = useState(null);
    const [worlds, setWorlds] = useState([]);
    const [mapOpen, setMapOpen] = useState(false);
    const [error, setError] = useState('');
    const [focus, setFocus] = useState(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [cfg, wl] = await Promise.all([api.get('/api/gis/config'), api.get('/api/gis/worlds')]);
                if (!alive) return;
                setConfig(cfg);
                // 选点需要所有世界（含已归档：只读坐标平面仍可用于选点）
                setWorlds(wl.worlds || []);
            } catch (e) {
                if (alive) setError('GIS 地图服务暂不可用，可直接手输坐标');
            }
        })();
        return () => { alive = false; };
    }, []);

    const pickerServerKey = value?.serverKey;
    const pickerDimension = value?.dimension || 'overworld';
    const world = useMemo(() => {
        const candidates = worlds.filter((w) => w.serverKey === pickerServerKey);
        // 选点只需要坐标平面：优先 ACTIVE 世界，没有 ACTIVE 时用已归档世界（只读浏览不影响选点）
        return candidates.find((w) => w.status === 'ACTIVE' && w.dimensions.some((d) => d.dimension === pickerDimension))
            || candidates.find((w) => w.status === 'ACTIVE')
            || candidates.find((w) => w.dimensions.some((d) => d.dimension === pickerDimension))
            || candidates[0]
            || null;
    }, [worlds, pickerServerKey, pickerDimension]);

    const set = useCallback((patch) => {
        onChange && onChange(patch);
    }, [onChange]);

    const onPick = useCallback(({ x, z }) => {
        set({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
        setFocus({ x, z, zoom: 0 });
    }, [set]);

    const pickValue = value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.z))
        ? { x: Number(value.x), z: Number(value.z) } : null;

    const coordsInvalid = !value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.z));

    return (
        <div className="gis-picker">
            <div className="gis-form-row">
                <div className="form-group">
                    <label className="form-label">服务器 *</label>
                    <select className="form-select" value={value?.serverKey || ''} disabled={disabled}
                        onChange={(e) => {
                            const s = (config ? config.servers : []).find((x) => x.serverKey === e.target.value);
                            set({ serverKey: e.target.value, serverName: s ? s.serverName : '' });
                        }}>
                        <option value="">选择服务器</option>
                        {(config ? config.servers : []).map((s) => <option key={s.serverKey} value={s.serverKey}>{s.serverName || s.serverKey}</option>)}
                        {value && value.serverKey && !(config ? config.servers : []).some((s) => s.serverKey === value.serverKey) && (
                            <option value={value.serverKey}>{value.serverName || value.serverKey}</option>
                        )}
                    </select>
                </div>
                <div className="form-group">
                    <label className="form-label">维度 *</label>
                    <select className="form-select" value={value?.dimension || 'overworld'} disabled={disabled}
                        onChange={(e) => set({ dimension: e.target.value })}>
                        {Object.entries(DIM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                </div>
            </div>
            {value?.dimension === 'custom' && (
                <div className="form-group">
                    <label className="form-label">自定义维度名</label>
                    <input className="form-input" value={value?.dimensionCustom || ''} disabled={disabled}
                        onChange={(e) => set({ dimensionCustom: e.target.value })} placeholder="例如：资源世界" />
                </div>
            )}

            <div className="gis-form-row">
                <div className="form-group">
                    <label className="form-label">X *</label>
                    <input className="form-input" type="number" step="0.1" value={value?.x ?? ''} disabled={disabled}
                        onChange={(e) => set({ x: e.target.value })} />
                </div>
                <div className="form-group">
                    <label className="form-label">Y</label>
                    <input className="form-input" type="number" step="0.1" value={value?.y ?? 64} disabled={disabled}
                        onChange={(e) => set({ y: e.target.value })} />
                </div>
                <div className="form-group">
                    <label className="form-label">Z *</label>
                    <input className="form-input" type="number" step="0.1" value={value?.z ?? ''} disabled={disabled}
                        onChange={(e) => set({ z: e.target.value })} />
                </div>
            </div>

            <div className="gis-inline">
                <button className="btn btn-secondary btn-sm" type="button" disabled={disabled}
                    onClick={() => setMapOpen((v) => !v)}>{mapOpen ? '收起地图选点' : '在地图上选点'}</button>
                <button className="btn btn-ghost btn-sm" type="button" disabled={disabled || coordsInvalid}
                    onClick={() => setFocus({ x: Number(value.x), z: Number(value.z), zoom: 0 })}>定位到坐标</button>
                {pickValue && <span className="gis-dim">当前：X {pickValue.x} / Z {pickValue.z}</span>}
            </div>
            {error && <div className="gis-warn">{error}</div>}
            {coordsInvalid && <div className="gis-hint">请填写 X / Z 坐标，或打开地图点击选点。</div>}

            {mapOpen && (
                <div className="gis-picker-map">
                    {world ? (
                        <>
                            {world.status !== 'ACTIVE' && (
                                <div className="gis-hint" style={{ padding: '6px 8px' }}>
                                    当前世界「{world.worldKey}」为 {world.status} 状态：仅用于坐标选点与展示，客户端不会同步该世界数据。
                                </div>
                            )}
                            <GisMap
                                worldId={world.id}
                                dimension={value?.dimension || 'overworld'}
                                objects={[]}
                                picker
                                pickValue={pickValue}
                                onPick={onPick}
                                focus={focus}
                                height={height}
                                showLayers={{ district: false, road: false, marker: false, market: false, contour: false, hillshade: false, missing: false }}
                            />
                        </>
                    ) : (
                        <div className="gis-warn">该服务器还没有在 GIS 注册世界，暂不能地图选点（可直接手输坐标）。</div>
                    )}
                </div>
            )}
        </div>
    );
}
