/**
 * 玄剑 GIS 地图组件（Leaflet + CRS.Simple，纯矢量按需加载）。
 *
 * 设计约束：
 *  - 不接任何第三方瓦片服务（无商业 key、无外网依赖），只在 Minecraft X/Z 平面坐标系上画矢量；
 *  - 只渲染父组件按 bbox 拉回来的可视区域对象（严禁一次性加载整个世界）；
 *  - 平移/缩放结束 → 上报 bbox 与 zoom，父组件据此请求数据；
 *  - 支持：图层开关、道路/城区绘制、顶点拖动、地图选点（集市）、等高线与无数据区域、山体阴影、历史视图。
 *
 * 坐标约定：Minecraft (x, z) ↔ Leaflet LatLng(lat = -z, lng = x)，即北为 -Z、东为 +X。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

const LAYER_DEFS = [
    { key: 'district', label: '城区边界' },
    { key: 'road', label: '道路' },
    { key: 'marker', label: '地点标记' },
    { key: 'market', label: '集市地点' },
    { key: 'contour', label: '等高线' },
    { key: 'hillshade', label: '地形阴影' },
    { key: 'missing', label: '无数据区' }
];

const TILE = 256;

export function mcToLatLng(x, z) { return [-z, x]; }
export function latLngToMc(ll) { return { x: ll.lng, z: -ll.lat }; }

function polygonCoords(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates[0] || [];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates[0] ? geometry.coordinates[0][0] || [] : [];
    return [];
}

function geometryToPoints(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return geometry.coordinates;
    if (geometry.type === 'Polygon') return geometry.coordinates[0] || [];
    return [];
}

const GisMap = forwardRef(function GisMap(props, ref) {
    const {
        worldId, dimension,
        objects = [],
        showLayers = { district: true, road: true, marker: true, market: false, contour: false, hillshade: false, missing: true },
        onBoundsChange,
        selectedKey = null,
        onSelect,
        drawMode = 'none',
        onDrawComplete,
        editTarget = null,          // { type:'road'|'district', geometry }
        editableVertices = false,
        onVertexMove,
        picker = false,
        pickValue = null,           // {x,z}
        onPick,
        contours = null,
        hillshade = null,
        missingRects = null,
        marketPlaces = [],
        historyMode = false,
        focus = null,               // {x,z,zoom}
        autoFitBbox = null,         // {minX,minZ,maxX,maxZ}：世界/维度切换后自动缩放到数据范围
        height = 'calc(100vh - 220px)',
        zoomLabel = null,
        onCursor
    } = props;

    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const libRef = useRef(null);
    const groupsRef = useRef({});
    const draftRef = useRef([]);
    const draftLayerRef = useRef(null);
    const onBoundsRef = useRef(onBoundsChange);
    const onSelectRef = useRef(onSelect);
    const drawModeRef = useRef(drawMode);
    const onDrawCompleteRef = useRef(onDrawComplete);
    const pickerRef = useRef(picker);
    const onPickRef = useRef(onPick);
    const renderDraftRef = useRef(() => { });
    const finishDraftRef = useRef(() => { });
    const cancelDraftRef = useRef(() => { });
    const [ready, setReady] = useState(false);
    const [draftCount, setDraftCount] = useState(0);
    const [cursor, setCursor] = useState(null);

    onBoundsRef.current = onBoundsChange;
    onSelectRef.current = onSelect;
    drawModeRef.current = drawMode;
    onDrawCompleteRef.current = onDrawComplete;
    pickerRef.current = picker;
    onPickRef.current = onPick;

    /* ---------------- 初始化 Leaflet（动态 import，避免 SSR 访问 window） ---------------- */
    useEffect(() => {
        let alive = true;
        let keyHandler = null;
        import('leaflet').then((mod) => {
            if (!alive || !containerRef.current || mapRef.current) return;
            const L = mod.default || mod;
            libRef.current = L;
            const map = L.map(containerRef.current, {
                crs: L.CRS.Simple,
                minZoom: -8,
                maxZoom: 6,
                zoomControl: true,
                attributionControl: false,
                preferCanvas: true,
                doubleClickZoom: true
            });
            map.setView([0, 0], -3);

            const groups = {};
            for (const g of ['grid', 'hillshade', 'district', 'road', 'marker', 'market', 'contour', 'missing', 'edit', 'draft', 'vertices', 'pick']) {
                groups[g] = L.layerGroup().addTo(map);
            }
            groupsRef.current = groups;

            // 坐标参考网格（间距随缩放自适应，便于按 Minecraft 坐标定位）
            const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
            const GridLayer = L.GridLayer.extend({
                createTile(coords) {
                    const tile = document.createElement('canvas');
                    const size = this.getTileSize();
                    tile.width = size.x;
                    tile.height = size.y;
                    const ctx = tile.getContext('2d');
                    const scale = Math.pow(2, coords.z);
                    const worldSize = TILE / scale;
                    const startX = coords.x * worldSize;
                    const startY = coords.y * worldSize;
                    const unit = NICE.find((s) => s * scale >= 90) || NICE[NICE.length - 1];
                    ctx.strokeStyle = 'rgba(120,160,220,0.16)';
                    ctx.lineWidth = 1;
                    ctx.fillStyle = 'rgba(150,190,240,0.4)';
                    ctx.font = '10px monospace';
                    for (let gx = Math.ceil(startX / unit) * unit; gx < startX + worldSize; gx += unit) {
                        const px = (gx - startX) * scale;
                        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, size.y); ctx.stroke();
                        ctx.fillText(`X ${Math.round(gx)}`, px + 2, 10);
                    }
                    for (let gy = Math.ceil(startY / unit) * unit; gy < startY + worldSize; gy += unit) {
                        const py = (gy - startY) * scale;
                        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(size.x, py); ctx.stroke();
                        ctx.fillText(`Z ${Math.round(gy)}`, 2, py - 2);
                    }
                    return tile;
                }
            });
            const gridLayer = new GridLayer({ tileSize: TILE, minZoom: -8, maxZoom: 6, opacity: 1 });
            gridLayer.addTo(map);
            gridLayer.bringToBack();

            const emitBounds = () => {
                const b = map.getBounds();
                const sw = latLngToMc(b.getSouthWest());
                const ne = latLngToMc(b.getNorthEast());
                const box = {
                    minX: Math.min(sw.x, ne.x), maxX: Math.max(sw.x, ne.x),
                    minZ: Math.min(sw.z, ne.z), maxZ: Math.max(sw.z, ne.z)
                };
                if (onBoundsRef.current) onBoundsRef.current(box, map.getZoom());
            };
            map.on('moveend zoomend', emitBounds);

            map.on('mousemove', (e) => {
                const mc = latLngToMc(e.latlng);
                setCursor({ x: Math.round(mc.x), z: Math.round(mc.z) });
                if (onCursor) onCursor({ x: Math.round(mc.x), z: Math.round(mc.z) });
            });

            // 绘制 / 选点 点击
            map.on('click', (e) => {
                const mc = latLngToMc(e.latlng);
                const pt = [Math.round(mc.x * 100) / 100, Math.round(mc.z * 100) / 100];
                if (pickerRef.current) {
                    if (onPickRef.current) onPickRef.current({ x: pt[0], z: pt[1] });
                    return;
                }
                const mode = drawModeRef.current;
                if (mode === 'marker') {
                    if (onDrawCompleteRef.current) onDrawCompleteRef.current('marker', { point: { x: pt[0], z: pt[1] } });
                    return;
                }
                if (mode === 'road' || mode === 'district') {
                    draftRef.current = [...draftRef.current, pt];
                    setDraftCount(draftRef.current.length);
                    renderDraftRef.current();
                }
            });

            map.on('dblclick', () => {
                const mode = drawModeRef.current;
                if (mode === 'road' || mode === 'district') finishDraftRef.current();
            });

            map.getContainer().addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const mode = drawModeRef.current;
                if (mode === 'road' || mode === 'district') {
                    draftRef.current = draftRef.current.slice(0, -1);
                    setDraftCount(draftRef.current.length);
                    renderDraftRef.current();
                }
            });

            keyHandler = (e) => {
                if (!containerRef.current) return;
                const tag = (e.target && e.target.tagName) || '';
                if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
                if (e.key === 'Escape') cancelDraftRef.current();
                else if (e.key === 'Enter') finishDraftRef.current();
                else if (e.key === 'Backspace' && (drawModeRef.current === 'road' || drawModeRef.current === 'district')) {
                    e.preventDefault();
                    draftRef.current = draftRef.current.slice(0, -1);
                    setDraftCount(draftRef.current.length);
                    renderDraftRef.current();
                }
            };
            window.addEventListener('keydown', keyHandler);

            mapRef.current = map;
            // 便于排障与端到端测试（只读句柄，不含敏感信息）
            if (typeof window !== 'undefined') window.__GIS_MAP__ = map;
            setReady(true);
            setTimeout(emitBounds, 60);
        }).catch(() => { });
        return () => {
            alive = false;
            if (keyHandler) window.removeEventListener('keydown', keyHandler);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => () => {
        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
        if (typeof window !== 'undefined' && window.__GIS_MAP__) window.__GIS_MAP__ = null;
    }, []);

    /* ---------------- 草稿渲染 ---------------- */
    const renderDraft = useCallback(() => {
        const L = libRef.current;
        const map = mapRef.current;
        if (!L || !map) return;
        const g = groupsRef.current.draft;
        if (!g) return;
        g.clearLayers();
        const pts = draftRef.current;
        const mode = drawModeRef.current;
        if (!pts.length) return;
        const latlngs = pts.map(([x, z]) => mcToLatLng(x, z));
        if (pts.length >= 2) {
            if (mode === 'district') {
                L.polygon(latlngs, { color: '#ffd166', weight: 2, dashArray: '6 4', fillOpacity: 0.12 }).addTo(g);
            } else {
                L.polyline(latlngs, { color: '#ffd166', weight: 3, dashArray: '6 4' }).addTo(g);
            }
        }
        pts.forEach(([x, z], i) => {
            L.circleMarker(mcToLatLng(x, z), { radius: 5, color: '#ffd166', fillColor: '#1b2436', fillOpacity: 1, weight: 2 })
                .bindTooltip(`${i + 1}. X ${x} Z ${z}`, { direction: 'top' })
                .addTo(g);
        });
    }, []);

    useEffect(() => {
        if (!ready) return;
        renderDraft();
    }, [ready, drawMode, renderDraft]);

    const finishDraft = () => {
        const mode = drawModeRef.current;
        const pts = draftRef.current;
        if (!onDrawCompleteRef.current) return;
        if (mode === 'road' && pts.length >= 2) {
            onDrawCompleteRef.current('road', { geometry: { type: 'LineString', coordinates: pts } });
            draftRef.current = [];
            setDraftCount(0);
            renderDraft();
        } else if (mode === 'district' && pts.length >= 3) {
            const ring = [...pts, [pts[0][0], pts[0][1]]];
            onDrawCompleteRef.current('district', { geometry: { type: 'Polygon', coordinates: [ring] } });
            draftRef.current = [];
            setDraftCount(0);
            renderDraft();
        }
    };
    const cancelDraft = () => {
        draftRef.current = [];
        setDraftCount(0);
        renderDraft();
    };

    renderDraftRef.current = renderDraft;
    finishDraftRef.current = finishDraft;
    cancelDraftRef.current = cancelDraft;

    useImperativeHandle(ref, () => ({
        finishDraft, cancelDraft,
        undoDraft() {
            draftRef.current = draftRef.current.slice(0, -1);
            setDraftCount(draftRef.current.length);
            renderDraft();
        },
        getDraftCount: () => draftRef.current.length,
        getMap: () => mapRef.current,
        focusOn(x, z, zoom) {
            const map = mapRef.current;
            if (map) map.setView(mcToLatLng(x, z), zoom === undefined ? map.getZoom() : zoom);
        },
        fitBbox(bbox) {
            const L = libRef.current;
            const map = mapRef.current;
            if (!L || !map || !bbox) return;
            map.fitBounds(L.latLngBounds(
                L.latLng(-bbox.maxZ, bbox.minX),
                L.latLng(-bbox.minZ, bbox.maxX)
            ), { padding: [24, 24] });
        },
        invalidate() { if (mapRef.current) mapRef.current.invalidateSize(); }
    }), [renderDraft]);

    /* ---------------- 视野聚焦 ---------------- */
    useEffect(() => {
        if (!ready || !focus || !mapRef.current) return;
        mapRef.current.setView(mcToLatLng(focus.x, focus.z), focus.zoom === undefined ? mapRef.current.getZoom() : focus.zoom);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, focus && focus.x, focus && focus.z, focus && focus.zoom]);

    /* ---------------- 世界/维度切换：有数据范围则自动定位，否则回到原点 ---------------- */
    const autoFitKey = autoFitBbox
        ? `${autoFitBbox.minX},${autoFitBbox.minZ},${autoFitBbox.maxX},${autoFitBbox.maxZ}`
        : '';
    useEffect(() => {
        const L = libRef.current;
        const map = mapRef.current;
        if (!ready || !map || !L) return;
        if (autoFitBbox) {
            map.fitBounds(L.latLngBounds(
                L.latLng(-autoFitBbox.maxZ, autoFitBbox.minX),
                L.latLng(-autoFitBbox.minZ, autoFitBbox.maxX)
            ), { padding: [24, 24] });
            return;
        }
        map.setView([0, 0], Math.min(map.getZoom(), -2));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, worldId, dimension, autoFitKey]);

    /* ---------------- 业务图层渲染 ---------------- */
    const layerState = useMemo(() => ({ ...showLayers }), [showLayers]);

    useEffect(() => {
        const L = libRef.current;
        const map = mapRef.current;
        if (!L || !map || !ready) return;
        const groups = groupsRef.current;
        for (const g of ['district', 'road', 'marker', 'market', 'edit', 'vertices', 'pick']) groups[g].clearLayers();

        const inLayer = (t) => layerState[t] !== false;

        // 城区
        if (inLayer('district')) {
            for (const o of objects) {
                if (o.type !== 'district' || !o.geometry) continue;
                const style = o.style || {};
                const isSel = selectedKey === `district:${o.id}`;
                const latlngs = (o.geometry.type === 'Polygon' ? o.geometry.coordinates : []).map((ring) => ring.map(([x, z]) => mcToLatLng(x, z)));
                if (!latlngs.length) continue;
                const poly = L.polygon(latlngs, {
                    color: isSel ? '#ffffff' : (style.color || '#5b8def'),
                    weight: isSel ? (style.weight || 2) + 2 : (style.weight || 2),
                    fillColor: style.color || '#5b8def',
                    fillOpacity: style.opacity === undefined ? 0.25 : style.opacity,
                    dashArray: isSel ? '8 5' : null
                });
                poly.bindTooltip(`${o.name}（${Math.round((o.metrics && o.metrics.area) || 0)} 方块²）`, { sticky: true });
                poly.on('click', (e) => { if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); if (onSelectRef.current) onSelectRef.current(o); });
                poly.addTo(groups.district);
            }
        }
        // 道路
        if (inLayer('road')) {
            for (const o of objects) {
                if (o.type !== 'road' || !o.geometry) continue;
                const isSel = selectedKey === `road:${o.id}`;
                const latlngs = o.geometry.coordinates.map(([x, z]) => mcToLatLng(x, z));
                const line = L.polyline(latlngs, {
                    color: isSel ? '#ffffff' : (o.isMain ? '#ffb703' : '#8ecae6'),
                    weight: Math.max(2, Math.min(12, Math.round((o.width || 5) / 1.5))),
                    opacity: isSel ? 1 : 0.85,
                    dashArray: isSel ? '8 5' : null,
                    lineCap: 'round'
                });
                line.bindTooltip(`${o.name}${o.isMain ? ' · 主干道' : ''}（宽 ${o.width}）`, { sticky: true });
                line.on('click', (e) => { if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); if (onSelectRef.current) onSelectRef.current(o); });
                line.addTo(groups.road);
            }
        }
        // Marker
        if (inLayer('marker')) {
            for (const o of objects) {
                if (o.type !== 'marker' || !o.point) continue;
                const isSel = selectedKey === `marker:${o.id}`;
                const cm = L.circleMarker(mcToLatLng(o.point.x, o.point.z), {
                    radius: isSel ? 9 : 6,
                    color: isSel ? '#ffffff' : '#ff5d8f',
                    weight: isSel ? 3 : 2,
                    fillColor: '#ff5d8f',
                    fillOpacity: 0.85
                });
                cm.bindTooltip(`${o.name} · ${o.category || ''}`, { direction: 'top' });
                cm.on('click', (e) => { if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); if (onSelectRef.current) onSelectRef.current(o); });
                cm.addTo(groups.marker);
            }
        }
        // 集市地点（只读图层，数据来自 market_store_locations）
        if (inLayer('market')) {
            for (const p of marketPlaces) {
                if (p.x === undefined || p.z === undefined) continue;
                const cm = L.circleMarker(mcToLatLng(p.x, p.z), {
                    radius: 5, color: '#ffd166', weight: 2, fillColor: '#ffd166', fillOpacity: 0.7
                });
                cm.bindTooltip(`${p.label || p.name}（集市）X ${p.x} Y ${p.y} Z ${p.z}`, { direction: 'top' });
                cm.on('click', () => {
                    if (onSelectRef.current) onSelectRef.current({ type: 'market_place', ...p, id: p.id });
                });
                cm.addTo(groups.market);
            }
        }

        // 编辑中的几何（道路/城区）+ 顶点拖动手柄
        if (editTarget && editTarget.geometry) {
            const pts = geometryToPoints(editTarget.geometry);
            const latlngs = pts.map(([x, z]) => mcToLatLng(x, z));
            if (editTarget.geometry.type === 'Polygon') {
                L.polygon(latlngs.map((ll) => ll), {
                    color: '#00e5ff', weight: 2, dashArray: '5 4', fillOpacity: 0.08
                }).addTo(groups.edit);
            } else {
                L.polyline(latlngs, { color: '#00e5ff', weight: 3 }).addTo(groups.edit);
            }
            if (editableVertices && onVertexMove) {
                // 多边形去掉闭合重复点
                const handles = editTarget.geometry.type === 'Polygon' ? pts.slice(0, Math.max(0, pts.length - 1)) : pts;
                handles.forEach(([x, z], idx) => {
                    const mk = L.marker(mcToLatLng(x, z), {
                        draggable: true,
                        icon: L.divIcon({ className: 'gis-vertex', iconSize: [12, 12] })
                    });
                    mk.on('dragend', () => {
                        const ll = mk.getLatLng();
                        const mc = latLngToMc(ll);
                        onVertexMove(idx, [Math.round(mc.x * 100) / 100, Math.round(mc.z * 100) / 100]);
                    });
                    mk.addTo(groups.vertices);
                });
            }
        }

        // 选点标记（集市）
        if (picker && pickValue && Number.isFinite(pickValue.x) && Number.isFinite(pickValue.z)) {
            L.circleMarker(mcToLatLng(pickValue.x, pickValue.z), {
                radius: 8, color: '#00e5ff', weight: 3, fillColor: '#00e5ff', fillOpacity: 0.5
            }).addTo(groups.pick);
            L.circle(mcToLatLng(pickValue.x, pickValue.z), {
                radius: 6, color: '#00e5ff', weight: 1, opacity: 0.6, fill: false
            }).addTo(groups.pick);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, objects, marketPlaces, layerState, selectedKey, editTarget, editableVertices, picker, pickValue, onVertexMove]);

    /* ---------------- 等高线 / 无数据区 ---------------- */
    useEffect(() => {
        const L = libRef.current;
        if (!L || !ready) return;
        const g = groupsRef.current.contour;
        g.clearLayers();
        if (!layerState.contour || !contours || !contours.lines) return;
        const max = contours.levels && contours.levels.length ? contours.levels[contours.levels.length - 1] : 1;
        for (const line of contours.lines) {
            const ratio = max ? line.level / max : 0;
            const color = `hsl(${Math.round(200 - ratio * 160)}, 85%, 62%)`;
            L.polyline(line.coordinates.map(([x, z]) => mcToLatLng(x, z)), {
                color, weight: line.level % Math.max(contours.interval || 10, 10) === 0 ? 1.6 : 1, opacity: 0.75, interactive: false
            }).addTo(g);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, contours, layerState.contour]);

    useEffect(() => {
        const L = libRef.current;
        if (!L || !ready) return;
        const g = groupsRef.current.missing;
        g.clearLayers();
        if (!layerState.missing || !missingRects || !missingRects.length) return;
        for (const r of missingRects.slice(0, 400)) {
            const [minX, minZ, maxX, maxZ] = r;
            L.rectangle(L.latLngBounds(L.latLng(-maxZ, minX), L.latLng(-minZ, maxX)), {
                color: 'rgba(255,120,120,0.30)', weight: 1, dashArray: '2 4', fillColor: '#ff5a5a', fillOpacity: 0.02, interactive: false
            }).addTo(g);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, missingRects, layerState.missing]);

    /* ---------------- 山体阴影（客户端渲染真实高程，不伪造） ---------------- */
    useEffect(() => {
        const L = libRef.current;
        const map = mapRef.current;
        if (!L || !map || !ready) return;
        const g = groupsRef.current.hillshade;
        g.clearLayers();
        if (!layerState.hillshade || !hillshade || !hillshade.intensity || !hillshade.width) return;
        const { width, height, intensity, origin, step } = hillshade;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(width, height);
        for (let i = 0; i < width * height; i++) {
            const v = intensity[i];
            const o = i * 4;
            if (v === null || v === undefined) { img.data[o + 3] = 0; continue; }
            img.data[o] = Math.round(v * 0.55 + 40);
            img.data[o + 1] = Math.round(v * 0.6 + 50);
            img.data[o + 2] = Math.round(v * 0.55 + 55);
            img.data[o + 3] = 150;
        }
        ctx.putImageData(img, 0, 0);
        const bounds = L.latLngBounds(
            L.latLng(-(origin.z + height * step), origin.x),
            L.latLng(-origin.z, origin.x + width * step)
        );
        L.imageOverlay(canvas.toDataURL('image/png'), bounds, { opacity: 0.9, interactive: false }).addTo(g);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, hillshade, layerState.hillshade]);

    /* ---------------- 样式 ---------------- */
    const draftHint = drawMode === 'road'
        ? `绘制道路：单击加顶点（已 ${draftCount} 个）· 双击/Enter 完成 · 右键/Backspace 撤销 · Esc 取消`
        : drawMode === 'district'
            ? `绘制城区：单击加边界点（已 ${draftCount} 个，≥3）· 双击/Enter 完成 · 右键撤销 · Esc 取消`
            : drawMode === 'marker' ? '单击地图放置地点标记' : picker ? '单击地图选择集市地点（也可直接输入坐标）' : '';

    const layerToggles = [];
    layerToggles.push(
        <div className="gis-layer-toggles" key="toggles">
            {LAYER_DEFS.filter((d) => ['district', 'road', 'marker', 'market'].includes(d.key)).map((d) => (
                <label key={d.key} className={`gis-toggle ${layerState[d.key] ? 'on' : ''}`}>
                    <input type="checkbox" checked={layerState[d.key] !== false} readOnly disabled />
                    <span>{d.label}</span>
                </label>
            ))}
        </div>
    );

    return (
        <div className={`gis-map-wrap ${historyMode ? 'gis-history-mode' : ''}`}>
            <div ref={containerRef} className="gis-map" style={{ height }} />
            {historyMode && <div className="gis-badge gis-badge-history">历史视图（只读）</div>}
            <div className="gis-map-overlay-top">
                {layerToggles}
            </div>
            {draftHint && <div className="gis-map-hint">{draftHint}</div>}
            <div className="gis-map-coords">
                {zoomLabel && <span>{zoomLabel}</span>}
                {cursor && <span>X {cursor.x} · Z {cursor.z}</span>}
                {!cursor && <span>缩放 {mapRef.current ? mapRef.current.getZoom() : '-'}</span>}
            </div>
        </div>
    );
});

export { LAYER_DEFS };
export default GisMap;
