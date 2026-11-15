/**
 * 玄剑 GIS 网页地图（/gis）
 *
 * 功能：世界/Dimension 切换、图层开关、按 bbox 按需加载、道路/城区绘制、顶点拖动、
 * Marker 提交、属性编辑、Wiki 关联、审核与版本回滚、空间搜索、等高线与地形分析、历史地图、集市地点图层。
 *
 * 资源约束：2G2H，无全图渲染、无第三方瓦片，只做矢量按需加载 + 服务端按 bbox 分页。
 * 安全约束：前端隐藏按钮不等于鉴权，所有写操作后端 requirePermission 独立校验。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import GisMap from '../components/gis/GisMap';
import GisInspector from '../components/gis/GisInspector';
import { GisReviewPanel, GisTerrainPanel, GisHistoryPanel, GisSearchPanel, GisAdminPanel } from '../components/gis/GisPanels';
import { hasPermission } from '../components/permissions/usePermissions';
import '../styles/gis.css';

const DIM_LABEL = { overworld: '主世界', nether: '下界', end: '末地', custom: '自定义' };
const STATUS_LABEL = { DRAFT: '草稿', REVIEW: '待审核', PUBLISHED: '已发布', REJECTED: '已驳回', ARCHIVED: '已归档' };
const CATEGORY_LABEL = {
    public_building: '公共建筑', housing: '住宅', shop: '商铺', industry: '工业',
    agriculture: '农业', transport: '交通', entertainment: '娱乐', government: '政府/组织', other: '其他'
};

function objectKey(o) { return `${o.type}:${o.id}`; }

function geometryCenter(geometry) {
    if (!geometry) return null;
    const pts = geometry.type === 'Point' ? [geometry.coordinates]
        : geometry.type === 'LineString' ? geometry.coordinates
            : geometry.type === 'Polygon' ? geometry.coordinates[0] : [];
    if (!pts || !pts.length) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, bbox: { minX, minZ, maxX, maxZ } };
}

export default function Gis() {
    const { user } = useAuth();
    const { showToast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const mapRef = useRef(null);

    const can = useMemo(() => ({
        access: hasPermission(user, 'gis.access'),
        submit: hasPermission(user, 'gis.submit'),
        roadEdit: hasPermission(user, 'gis.road.edit'),
        districtEdit: hasPermission(user, 'gis.district.edit'),
        review: hasPermission(user, 'gis.object.review'),
        admin: hasPermission(user, 'gis.admin')
    }), [user]);
    const canAnyEdit = can.roadEdit || can.districtEdit || can.submit;

    const [config, setConfig] = useState(null);
    const [allWorlds, setAllWorlds] = useState([]);
    const [worldId, setWorldId] = useState(null);
    const [dimension, setDimension] = useState('overworld');
    const [bbox, setBbox] = useState(null);
    const [zoom, setZoom] = useState(-3);
    const [objects, setObjects] = useState([]);
    const [loadingObjects, setLoadingObjects] = useState(false);
    const [truncated, setTruncated] = useState(false);
    const [limits, setLimits] = useState({ maxBboxArea: 16000000 });

    const [selected, setSelected] = useState(null);       // 当前选中（published）
    const [detail, setDetail] = useState(null);           // 详情 {object, published, working}
    const [geometryDraft, setGeometryDraft] = useState(null);
    const [vertexEdit, setVertexEdit] = useState(false);
    const [versions, setVersions] = useState([]);
    const [localObjects, setLocalObjects] = useState([]);  // 本次编辑产生的草稿（发布层还没有）

    const [drawMode, setDrawMode] = useState('none');
    const [creating, setCreating] = useState(null);        // {type, data}
    const [newForm, setNewForm] = useState(null);

    const [layers, setLayers] = useState({ blocks: true, district: true, road: true, marker: true, market: false });
    const [terrain, setTerrain] = useState({ contour: false, interval: 10, hillshade: false, missing: false });
    const [contours, setContours] = useState(null);
    const [hillshade, setHillshade] = useState(null);
    const [missingRects, setMissingRects] = useState(null);
    const [marketPlaces, setMarketPlaces] = useState([]);
    const [coverageVersion, setCoverageVersion] = useState(0);
    // 方块彩色地图（浏览器端渲染）：调色板 + 覆盖度索引 + 渲染统计
    const [palette, setPalette] = useState(null);
    const [mapIndex, setMapIndex] = useState(null);
    const [blockStats, setBlockStats] = useState(null);

    const [panel, setPanel] = useState('attr');
    const [history, setHistory] = useState(null);          // {label, objects}
    const [stats, setStats] = useState(null);
    const [busy, setBusy] = useState(false);

    const currentWorld = useMemo(() => allWorlds.find((w) => w.id === Number(worldId)) || null, [allWorlds, worldId]);
    /** 当前世界/维度的数据范围（用于「定位到数据」与自动视野）；无采集数据时为 null */
    const dataBbox = useMemo(() => {
        if (!currentWorld) return null;
        const d = (currentWorld.dimensions || []).find((x) => x.dimension === dimension);
        const b = d && d.bbox;
        if (!b || !Number.isFinite(Number(b.minX)) || !Number.isFinite(Number(b.maxX))) return null;
        return { minX: Number(b.minX), minZ: Number(b.minZ), maxX: Number(b.maxX), maxZ: Number(b.maxZ) };
    }, [currentWorld, dimension]);
    const [jump, setJump] = useState({ x: '', z: '' });

    /* ---------------- 方块彩色地图：调色板 + 覆盖度索引 ---------------- */
    useEffect(() => {
        let alive = true;
        api.get('/api/gis/map/palette').then((d) => { if (alive) setPalette(d); }).catch(() => { });
        return () => { alive = false; };
    }, []);
    useEffect(() => {
        if (!worldId) { setMapIndex(null); return undefined; }
        let alive = true;
        api.get(`/api/gis/map/index?worldId=${worldId}`)
            .then((d) => { if (alive) setMapIndex(d); })
            .catch(() => { if (alive) setMapIndex(null); });
        return () => { alive = false; };
    }, [worldId, coverageVersion]);
    /** 当前维度是否有方块底图数据（chunkCount>0 才显示图层开关） */
    const mapDim = mapIndex && mapIndex.dimensions ? mapIndex.dimensions[dimension] : null;
    const blockAvailable = !!(mapDim && Number(mapDim.chunkCount) > 0);
    const blockBbox = useMemo(() => {
        const b = mapDim && mapDim.bbox;
        if (b && Number.isFinite(Number(b.minX)) && Number.isFinite(Number(b.maxX))) {
            return { minX: Number(b.minX), minZ: Number(b.minZ), maxX: Number(b.maxX), maxZ: Number(b.maxZ) };
        }
        return dataBbox || null;
    }, [mapDim, dataBbox]);
    // 有方块数据默认开启，无数据自动隐藏（符合设计文档 3.2）
    useEffect(() => {
        setLayers((l) => ({ ...l, blocks: blockAvailable }));
    }, [blockAvailable, worldId, dimension]);

    /* ---------------- 数据区域（region）聚类：默认只看最大区域 ---------------- */
    const regionList = useMemo(() => (mapDim && Array.isArray(mapDim.regions) ? mapDim.regions : []), [mapDim]);
    // 默认视野（「主城区」）：对象最多的区域 → 最早开始采集的区域（firstSeen 升序）→ chunk 更多
    const preferredRegion = useMemo(() => {
        if (!regionList.length) return null;
        return [...regionList].sort((a, b) =>
            (Number(b.objectCount) || 0) - (Number(a.objectCount) || 0) ||
            String(a.firstSeen || '9999').localeCompare(String(b.firstSeen || '9999')) ||
            b.chunkCount - a.chunkCount || a.id - b.id)[0];
    }, [regionList]);
    const preferredRegionId = preferredRegion ? preferredRegion.id : null;
    const [activeRegionId, setActiveRegionId] = useState(null);
    useEffect(() => {
        // 世界/维度/索引变化：默认选「主城区」（对象最多，其次最大区域）
        setActiveRegionId(preferredRegionId);
    }, [worldId, dimension, preferredRegionId]);
    const activeRegion = useMemo(
        () => regionList.find((r) => r.id === activeRegionId) || regionList[0] || null,
        [regionList, activeRegionId]
    );
    /** 「定位到数据」/自动视野：优先最大区域，避免一次缩放到 11 万方块 */
    const autoFitBbox = useMemo(() => {
        const b = (activeRegion && activeRegion.bbox) || (regionList[0] && regionList[0].bbox);
        if (b) return b;
        return dataBbox || null;
    }, [activeRegion, regionList, dataBbox]);
    const regionLabel = useCallback((r) => {
        const isMain = r.id === preferredRegionId;
        const name = r.districtName || (isMain ? '主城区' : `区域 ${r.id}`);
        if (r.districtName || isMain) return `${name}（${r.chunkCount} chunk）`;
        return `${name}（${r.chunkCount} chunk，X${r.centerX} Z${r.centerZ}）`;
    }, [preferredRegionId]);
    const focusRegion = useCallback((id) => {
        const r = regionList.find((x) => x.id === id);
        setActiveRegionId(id);
        if (r && mapRef.current) mapRef.current.fitBbox(r.bbox);
    }, [regionList]);
    /** 图层开关：方块/矢量 → layers，地形类 → terrain */
    const toggleLayer = useCallback((key, value) => {
        if (key === 'contour' || key === 'hillshade' || key === 'missing') {
            setTerrain((t) => ({ ...t, [key]: value }));
        } else {
            setLayers((l) => ({ ...l, [key]: value }));
        }
    }, []);
    // 首次进入有地形数据的世界/维度时，自动开启山体阴影 + 等高线 + 无数据区标记，
    // 避免用户看到「只有网格和矢量」而误以为地图不渲染（可随时在地形面板关掉）。
    const terrainAutoRef = useRef('');
    useEffect(() => {
        if (!dataBbox) return;
        const key = `${worldId}:${dimension}`;
        if (terrainAutoRef.current === key) return;
        terrainAutoRef.current = key;
        setTerrain((t) => ({ ...t, contour: true, hillshade: true, missing: true, interval: t.interval || 20 }));
    }, [dataBbox, worldId, dimension]);
    /** 可浏览世界：ACTIVE 在前，ARCHIVED/SNAPSHOT 作为只读历史世界 */
    const worlds = useMemo(() => {
        const rank = (w) => (w.status === 'ACTIVE' ? 0 : w.status === 'SNAPSHOT' ? 1 : 2);
        return [...allWorlds].sort((a, b) => rank(a) - rank(b) || Number(b.isCurrent) - Number(a.isCurrent) || a.id - b.id);
    }, [allWorlds]);
    const readOnlyWorld = !!currentWorld && currentWorld.status !== 'ACTIVE';
    const dimensions = useMemo(() => {
        const ORDER = ['overworld', 'nether', 'end', 'custom'];
        const ds = currentWorld ? currentWorld.dimensions.map((d) => d.dimension) : ['overworld'];
        const list = ds.length ? ds : ['overworld'];
        return [...list].sort((a, b) => {
            const ia = ORDER.indexOf(a); const ib = ORDER.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
    }, [currentWorld]);

    const displayObjects = useMemo(() => {
        const map = new Map();
        for (const o of objects) map.set(objectKey(o), o);
        for (const o of localObjects) map.set(objectKey(o), o);
        return Array.from(map.values());
    }, [objects, localObjects]);

    const districtOptions = useMemo(() => displayObjects.filter((o) => o.type === 'district').map((o) => ({ id: o.id, name: o.name })), [displayObjects]);

    /* ---------------- 初始化 ---------------- */
    const loadWorlds = useCallback(async () => {
        try {
            const wl = await api.get('/api/gis/worlds');
            const list = wl.worlds || [];
            setAllWorlds(list);
            const active = list.filter((w) => w.status === 'ACTIVE');
            const preferred = active.find((w) => w.isCurrent) || active[0] || list[0] || null;
            setWorldId((prev) => (prev && list.some((w) => w.id === Number(prev)) ? prev : (preferred ? preferred.id : null)));
            if (preferred) {
                const dims = preferred.dimensions.map((d) => d.dimension);
                setDimension((prev) => (dims.includes(prev) ? prev : (dims.includes('overworld') ? 'overworld' : (dims[0] || 'overworld'))));
            }
            return list;
        } catch (e) {
            showToast(e.message || '世界列表加载失败', 'error');
            return [];
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const cfg = await api.get('/api/gis/config');
                if (!alive) return;
                setConfig(cfg);
                if (cfg.limits && cfg.limits.maxBboxArea) setLimits(cfg.limits);
                await loadWorlds();
            } catch (e) {
                showToast(e.message || 'GIS 配置加载失败', 'error');
            }
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // URL 深链：?object=marker:12 或 ?x=..&z=..&zoom=..
    useEffect(() => {
        const obj = searchParams.get('object');
        const x = searchParams.get('x');
        const z = searchParams.get('z');
        if (obj) {
            const [type, id] = obj.split(':');
            if (type && id) selectByTypeId(type, Number(id));
        } else if (x !== null && z !== null && mapRef.current) {
            mapRef.current.focusOn(Number(x), Number(z), Number(searchParams.get('zoom') || -1));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, worldId]);

    /* ---------------- 视野变化 → 拉对象 ---------------- */
    const onBoundsChange = useCallback((box, z) => {
        // bbox 面积上限：超出则以中心裁剪，避免“拉整个世界”
        const area = Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxZ - box.minZ);
        let next = box;
        if (area > limits.maxBboxArea) {
            const cx = (box.minX + box.maxX) / 2;
            const cz = (box.minZ + box.maxZ) / 2;
            const half = Math.sqrt(limits.maxBboxArea) / 2;
            next = { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half };
        }
        setZoom(z);
        setBbox((prev) => {
            if (prev && Math.abs(prev.minX - next.minX) < 0.5 && Math.abs(prev.maxX - next.maxX) < 0.5
                && Math.abs(prev.minZ - next.minZ) < 0.5 && Math.abs(prev.maxZ - next.maxZ) < 0.5) return prev;
            return next;
        });
    }, [limits.maxBboxArea]);

    const bboxStr = useMemo(() => (bbox ? `${bbox.minX},${bbox.minZ},${bbox.maxX},${bbox.maxZ}` : ''), [bbox]);

    /** 地形类接口的同步计算面积有上限：把当前视野裁剪成上限内的中心区域 */
    const terrainBboxStr = useMemo(() => {
        if (!bbox) return '';
        const maxArea = limits.terrainSyncBboxArea || 262144;
        const area = Math.max(0, bbox.maxX - bbox.minX) * Math.max(0, bbox.maxZ - bbox.minZ);
        if (area <= maxArea) return bboxStr;
        const cx = (bbox.minX + bbox.maxX) / 2;
        const cz = (bbox.minZ + bbox.maxZ) / 2;
        const half = Math.sqrt(maxArea) / 2;
        return `${Math.round(cx - half)},${Math.round(cz - half)},${Math.round(cx + half)},${Math.round(cz + half)}`;
    }, [bbox, bboxStr, limits.terrainSyncBboxArea]);

    useEffect(() => {
        if (!worldId || !bbox || history) return undefined;
        let alive = true;
        const timer = setTimeout(async () => {
            setLoadingObjects(true);
            try {
                const qs = new URLSearchParams({
                    worldId, dimension, bbox: bboxStr, limit: '800', zoom: String(zoom), types: 'district,road,marker'
                });
                const d = await api.get(`/api/gis/objects?${qs}`);
                if (!alive) return;
                setObjects(d.objects || []);
                setTruncated(!!d.truncated);
            } catch (e) {
                if (alive) showToast(e.message || '对象加载失败', 'error');
            } finally {
                if (alive) setLoadingObjects(false);
            }
        }, 220);
        return () => { alive = false; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [worldId, dimension, bboxStr, zoom, history]);

    /* ---------------- 集市地点图层 ---------------- */
    useEffect(() => {
        if (!layers.market || !currentWorld || !bbox) { setMarketPlaces([]); return undefined; }
        let alive = true;
        const timer = setTimeout(async () => {
            try {
                const qs = new URLSearchParams({
                    serverKey: currentWorld.serverKey, dimension, bbox: bboxStr, limit: '2000'
                });
                const d = await api.get(`/api/gis/market/locations?${qs}`);
                if (alive) setMarketPlaces(d.items || []);
            } catch (e) { /* 集市模块不可用时静默 */ }
        }, 260);
        return () => { alive = false; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layers.market, currentWorld && currentWorld.serverKey, dimension, bboxStr]);

    /* ---------------- 等高线 / 山体阴影 ---------------- */
    useEffect(() => {
        if (!terrain.contour || !worldId || !bbox) { setContours(null); setMissingRects(null); return undefined; }
        let alive = true;
        const timer = setTimeout(async () => {
            try {
                const qs = new URLSearchParams({
                    worldId, dimension, bbox: terrainBboxStr, interval: String(terrain.interval), zoom: String(zoom)
                });
                const d = await api.get(`/api/gis/terrain/contours?${qs}`);
                if (!alive) return;
                setContours(d);
                setMissingRects(d && d.data ? d.data.missingRects || [] : []);
            } catch (e) {
                if (alive) showToast(e.message || '等高线计算失败', 'error');
            }
        }, 320);
        return () => { alive = false; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [terrain.contour, terrain.interval, worldId, dimension, terrainBboxStr, zoom]);

    useEffect(() => {
        if (!terrain.hillshade || !worldId || !bbox) { setHillshade(null); return undefined; }
        let alive = true;
        const timer = setTimeout(async () => {
            try {
                const qs = new URLSearchParams({ worldId, dimension, bbox: terrainBboxStr, resolution: '2' });
                const d = await api.get(`/api/gis/terrain/hillshade?${qs}`);
                if (alive) setHillshade(d);
            } catch (e) {
                if (alive) showToast(e.message || '地形阴影计算失败', 'error');
            }
        }, 320);
        return () => { alive = false; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [terrain.hillshade, worldId, dimension, terrainBboxStr]);

    /* ---------------- 选择对象 ---------------- */
    const selectByTypeId = useCallback(async (type, id) => {
        try {
            const d = await api.get(`/api/gis/objects/${type}/${id}`);
            const target = d.working && d.working.status !== 'ARCHIVED' && can.access ? d.working : d.object;
            setSelected(target);
            setDetail(d);
            setGeometryDraft(null);
            setVertexEdit(false);
            setPanel('attr');
            loadVersions(type, id);
        } catch (e) {
            showToast(e.message || '对象详情加载失败', 'error');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [can.access]);

    const loadVersions = async (type, id) => {
        if (!can.access) { setVersions([]); return; }
        try {
            const d = await api.get(`/api/gis/objects/${type}/${id}/revisions?limit=50`);
            setVersions(d.items || []);
        } catch (e) { setVersions([]); }
    };

    const onSelect = useCallback((o) => {
        if (!o) { setSelected(null); setDetail(null); return; }
        if (o.type === 'market_place') { setSelected(o); setDetail(null); setPanel('attr'); return; }
        selectByTypeId(o.type, o.id);
    }, [selectByTypeId]);

    const focusObject = (o) => {
        const geom = o.geometry || (o.point ? { type: 'Point', coordinates: [o.point.x, o.point.z] } : (o.coordinates ? { type: 'LineString', coordinates: o.coordinates } : null));
        const c = geometryCenter(geom);
        if (c && mapRef.current) {
            if (o.type === 'marker' || o.point) mapRef.current.focusOn(c.x, c.z, 1);
            else mapRef.current.fitBbox(c.bbox);
        } else if (o.x !== undefined) {
            mapRef.current && mapRef.current.focusOn(o.x, o.z, 1);
        }
    };

    /* ---------------- 绘制 → 新建 ---------------- */
    const onDrawComplete = useCallback((type, data) => {
        setCreating({ type, data });
        setDrawMode('none');
        setPanel('attr');
        const base = {
            name: '', description: '', wikiPageId: '',
            category: 'other', districtType: 'district', roadType: 'road', width: 5, roadLevel: 3, isMain: false,
            color: '#5b8def', opacity: 0.25, weight: 2, submit: true
        };
        if (type === 'marker') {
            base.x = data.point.x; base.y = 64; base.z = data.point.z;
        }
        setNewForm(base);
        if (data.point && mapRef.current) mapRef.current.focusOn(data.point.x, data.point.z, mapRef.current.getMap() ? mapRef.current.getMap().getZoom() : 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveNew = async () => {
        if (!newForm || !creating) return;
        if (!newForm.name.trim()) { showToast('请填写名称', 'error'); return; }
        setBusy(true);
        try {
            const payload = {
                worldId, dimension, name: newForm.name.trim(), description: newForm.description,
                wikiPageId: newForm.wikiPageId === '' ? null : Number(newForm.wikiPageId)
            };
            if (creating.type === 'marker') {
                payload.category = newForm.category;
                payload.point = { x: Number(newForm.x), y: Number(newForm.y), z: Number(newForm.z) };
            } else {
                payload.geometry = creating.data.geometry;
            }
            if (creating.type === 'road') {
                payload.width = Number(newForm.width);
                payload.roadLevel = Number(newForm.roadLevel);
                payload.isMain = !!newForm.isMain;
                payload.roadType = newForm.roadType;
            }
            if (creating.type === 'district') {
                payload.districtType = newForm.districtType;
                payload.styleColor = newForm.color;
                payload.styleOpacity = Number(newForm.opacity);
                payload.styleWeight = Number(newForm.weight);
            }
            const d = await api.post(`/api/gis/objects/${creating.type}`, payload);
            let created = d.object;
            if (newForm.submit && created.status === 'DRAFT') {
                try {
                    const s = await api.post(`/api/gis/objects/${creating.type}/${created.id}/submit`, {});
                    created = s.object;
                } catch (e) { /* 保持草稿 */ }
            }
            setLocalObjects((prev) => [...prev.filter((o) => objectKey(o) !== objectKey(created)), created]);
            setCreating(null);
            setNewForm(null);
            showToast(`已创建${creating.type === 'marker' ? '标记' : creating.type === 'road' ? '道路' : '城区'}（${STATUS_LABEL[created.status] || created.status}）`, 'success');
            await selectByTypeId(creating.type, created.id);
            setCoverageVersion((v) => v + 1);
        } catch (e) {
            showToast(e.message || '创建失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    /* ---------------- 编辑保存 / 审核动作 ---------------- */
    const refreshSelected = async (type, id) => {
        try {
            const d = await api.get(`/api/gis/objects/${type}/${id}`);
            const target = (d.working && d.working.status !== 'ARCHIVED' && can.access) ? d.working : d.object;
            setSelected(target);
            setDetail(d);
            setLocalObjects((prev) => {
                if (!d.working || d.working.status === 'ARCHIVED') return prev;
                return [...prev.filter((o) => objectKey(o) !== objectKey(d.working)), d.working];
            });
            loadVersions(type, id);
        } catch (e) { /* ignore */ }
    };

    const saveEdit = async (payload) => {
        if (!selected || selected.type === 'market_place') return;
        setBusy(true);
        try {
            const body = { ...payload };
            if (geometryDraft) body.geometry = geometryDraft;
            await api.put(`/api/gis/objects/${selected.type}/${selected.id}`, body);
            setGeometryDraft(null);
            setVertexEdit(false);
            await refreshSelected(selected.type, selected.id);
            showToast('已保存（新版本）', 'success');
        } catch (e) {
            showToast(e.message || '保存失败', 'error');
        } finally { setBusy(false); }
    };

    const doAction = async (action, obj) => {
        const target = obj || selected;
        if (!target || target.type === 'market_place') return;
        setBusy(true);
        try {
            const base = `/api/gis/objects/${target.type}/${target.id}`;
            if (action === 'submit') await api.post(`${base}/submit`, {});
            else if (action === 'publish') await api.post(`${base}/publish`, {});
            else if (action === 'reject') {
                const note = window.prompt('驳回原因（可留空）', '');
                if (note === null) { setBusy(false); return; }
                await api.post(`${base}/reject`, { note });
            } else if (action === 'archive') {
                if (!window.confirm(`确认归档删除「${target.name}」？地图将不再显示（历史版本保留）。`)) { setBusy(false); return; }
                await api.delete(base);
                setLocalObjects((prev) => prev.filter((o) => objectKey(o) !== objectKey(target)));
                setSelected(null);
                setDetail(null);
            }
            showToast('操作成功', 'success');
            if (action !== 'archive') await refreshSelected(target.type, target.id);
            setCoverageVersion((v) => v + 1);
        } catch (e) {
            showToast(e.message || '操作失败', 'error');
        } finally { setBusy(false); }
    };

    const saveWiki = async (wikiPageId) => {
        if (!selected || selected.type === 'market_place') return;
        setBusy(true);
        try {
            await api.post(`/api/gis/objects/${selected.type}/${selected.id}/wiki`, { wikiPageId });
            await refreshSelected(selected.type, selected.id);
            showToast('Wiki 关联已更新', 'success');
        } catch (e) { showToast(e.message || 'Wiki 关联失败', 'error'); }
        finally { setBusy(false); }
    };

    const rollback = async (rev) => {
        if (!selected) return;
        if (!window.confirm(`确认回滚到 v${rev}？将生成新版本并立即发布（历史不覆盖当前）。`)) return;
        setBusy(true);
        try {
            await api.post(`/api/gis/objects/${selected.type}/${selected.id}/rollback`, { revision: rev });
            await refreshSelected(selected.type, selected.id);
            showToast(`已回滚到 v${rev}`, 'success');
        } catch (e) { showToast(e.message || '回滚失败', 'error'); }
        finally { setBusy(false); }
    };

    const loadVersion = async (rev) => {
        if (!selected) return;
        try {
            const d = await api.get(`/api/gis/objects/${selected.type}/${selected.id}/revisions/${rev}`);
            const snap = d.revision.snapshot;
            setSelected({ ...snap, type: selected.type, revision: rev, publishedRevision: snap.revision });
            setGeometryDraft(snap.geometry || null);
            showToast(`正在查看 v${rev}（只读，可回滚）`, 'info');
        } catch (e) { showToast(e.message || '版本加载失败', 'error'); }
    };

    /* ---------------- 顶点拖动 ---------------- */
    const onVertexMove = useCallback((index, point) => {
        const geom = geometryDraft || (selected && selected.geometry);
        if (!geom) return;
        let next;
        if (geom.type === 'LineString') {
            const coords = geom.coordinates.map((c) => [...c]);
            coords[index] = point;
            next = { type: 'LineString', coordinates: coords };
        } else {
            const ring = geom.coordinates[0].map((c) => [...c]);
            ring[index] = point;
            ring[ring.length - 1] = [ring[0][0], ring[0][1]];
            next = { type: 'Polygon', coordinates: [ring] };
        }
        setGeometryDraft(next);
    }, [geometryDraft, selected]);

    /* ---------------- 历史视图 ---------------- */
    const enterSnapshotView = (snap, list) => {
        setHistory({ label: `快照：${snap.name}（${snap.capturedAt}）`, objects: list });
        setObjects(list);
    };
    const enterTimeView = (asOf, list) => {
        setHistory({ label: `历史时间：${asOf}`, objects: list });
        setObjects(list);
    };
    const exitHistory = () => {
        setHistory(null);
        // bbox 换成新对象触发按需重新加载当前发布层
        setBbox((b) => (b ? { ...b } : b));
    };
    const doJump = () => {
        const x = Number(jump.x);
        const z = Number(jump.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
            showToast('请输入有效的 X / Z 坐标', 'error');
            return;
        }
        if (mapRef.current) mapRef.current.focusOn(x, z, 1);
    };

    const loadStats = async () => {
        if (!can.admin) return;
        try {
            const d = await api.get('/api/gis/admin/stats');
            setStats(d);
        } catch (e) { /* ignore */ }
    };
    useEffect(() => { if (panel === 'admin') loadStats(); /* eslint-disable-next-line */ }, [panel]);

    const reloadWorlds = async () => {
        const list = await loadWorlds();
        // 归档/切换后如果当前世界不可读写，清掉编辑态
        const cur = list.find((w) => w.id === Number(worldId));
        if (cur && cur.status !== 'ACTIVE') {
            setDrawMode('none');
            setCreating(null);
            setNewForm(null);
            setVertexEdit(false);
            setGeometryDraft(null);
        }
    };

    const panelTabs = [
        { key: 'attr', label: '属性', show: true },
        { key: 'terrain', label: '地形', show: true },
        { key: 'search', label: '搜索', show: true },
        { key: 'review', label: '审核', show: can.review },
        { key: 'history', label: '历史', show: can.access },
        { key: 'admin', label: '管理', show: can.admin }
    ].filter((t) => t.show);

    const drawButtons = [
        { mode: 'road', label: '绘制道路', show: can.roadEdit && !readOnlyWorld && !!worldId },
        { mode: 'district', label: '绘制城区', show: can.districtEdit && !readOnlyWorld && !!worldId },
        { mode: 'marker', label: '添加标记', show: can.submit && !readOnlyWorld && !!worldId }
    ].filter((b) => b.show);

    const currentObjectsCount = displayObjects.length;

    return (
        <div className="gis-page">
            <div className="gis-topbar">
                <div className="gis-topbar-left">
                    <span className="gis-title">玄剑 GIS</span>
                    <select className="form-select gis-select-sm" value={worldId || ''} onChange={(e) => {
                        setWorldId(Number(e.target.value));
                        setSelected(null); setDetail(null); setHistory(null);
                        const w = worlds.find((x) => x.id === Number(e.target.value));
                        const dims = w ? w.dimensions.map((d) => d.dimension) : ['overworld'];
                        setDimension(dims.includes(dimension) ? dimension : (dims.includes('overworld') ? 'overworld' : dims[0]));
                    }}>
                        {allWorlds.length === 0 && <option value="">（未注册世界）</option>}
                        {worlds.map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.serverName} · {w.worldKey}
                                {w.status === 'ACTIVE' ? (w.isCurrent ? '（当前）' : '') : `（${w.status === 'ARCHIVED' ? '已归档·只读' : '快照·只读'}）`}
                            </option>
                        ))}
                    </select>
                    <select className="form-select gis-select-sm" value={dimension} onChange={(e) => { setDimension(e.target.value); setSelected(null); setDetail(null); setHistory(null); }}>
                        {dimensions.map((d) => <option key={d} value={d}>{DIM_LABEL[d] || d}</option>)}
                    </select>
                    {regionList.length > 0 && (
                        <select className="form-select gis-select-sm gis-select-region" value={activeRegionId || ''}
                            title={regionList.length > 1 ? '已采集多个数据区域，切换查看' : '当前维度的数据区域'}
                            onChange={(e) => focusRegion(Number(e.target.value))}>
                            {regionList.map((r) => <option key={r.id} value={r.id}>{regionLabel(r)}</option>)}
                        </select>
                    )}
                    <input className="form-input gis-input-xy" type="number" placeholder="X" value={jump.x}
                        onChange={(e) => setJump((j) => ({ ...j, x: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') doJump(); }} />
                    <input className="form-input gis-input-xy" type="number" placeholder="Z" value={jump.z}
                        onChange={(e) => setJump((j) => ({ ...j, z: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') doJump(); }} />
                    <button className="btn btn-secondary btn-sm" onClick={doJump}>跳转坐标</button>
                    <button className="btn btn-secondary btn-sm" disabled={!autoFitBbox}
                        title={autoFitBbox ? '缩放到当前数据区域（默认最大区域）' : '当前世界/维度还没有采集数据'}
                        onClick={() => { if (autoFitBbox && mapRef.current) mapRef.current.fitBbox(autoFitBbox); }}>定位到数据</button>
                </div>
                <div className="gis-topbar-right">
                    {drawButtons.map((b) => (
                        <button key={b.mode} className={`btn btn-sm ${drawMode === b.mode ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => {
                                if (drawMode === b.mode) { setDrawMode('none'); mapRef.current && mapRef.current.cancelDraft(); return; }
                                setDrawMode(b.mode);
                                setCreating(null); setNewForm(null);
                            }}>{b.label}</button>
                    ))}
                    {drawMode !== 'none' && (
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={() => mapRef.current && mapRef.current.undoDraft()}>撤销点</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => mapRef.current && mapRef.current.cancelDraft()}>取消</button>
                        </>
                    )}
                    <button className={`btn btn-sm ${terrain.contour ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTerrain((t) => ({ ...t, contour: !t.contour }))}>等高线</button>
                    <span className="gis-dim gis-count">
                        {loadingObjects ? '加载中…' : `视野内 ${currentObjectsCount} 个对象`}{truncated ? '（已截断，请放大）' : ''}
                        {history ? ' · 历史视图' : ''}
                    </span>
                    {history && <button className="btn btn-secondary btn-sm" onClick={exitHistory}>返回当前</button>}
                    {readOnlyWorld && <span className="gis-dim gis-count">（该世界已归档：只读浏览，禁止编辑/上传）</span>}
                    {!user && <Link className="btn btn-secondary btn-sm" to="/login">登录后可编辑</Link>}
                    {user && !can.access && <span className="gis-dim">（只读模式：需要 gis.access 权限才能编辑）</span>}
                </div>
            </div>

            <div className="gis-body">
                <div className="gis-map-col">
                    {allWorlds.length > 0 && !allWorlds.some((w) => w.status === 'ACTIVE') && (
                        <div className="gis-banner">
                            <b>当前没有 ACTIVE 世界。</b>
                            已注册世界均为归档/快照：地图只读浏览历史数据；Minecraft 客户端会进入本地模式（本地采集/地图/HUD 可用，上传被禁止）。
                            {can.admin
                                ? <button className="btn btn-secondary btn-sm" onClick={() => setPanel('admin')}>去「管理」启用或注册世界</button>
                                : <span>请联系 GIS 管理员注册新世界后使用。</span>}
                        </div>
                    )}
                    {dataBbox && !history && !loadingObjects && currentObjectsCount === 0 && (
                        <div className="gis-banner">
                            <b>当前视野内没有对象。</b>
                            {regionList.length > 1
                                ? <>已采集 {regionList.length} 个数据区域，当前显示第 {regionList.findIndex((r) => r.id === (activeRegion && activeRegion.id)) + 1} 个（{activeRegion && (activeRegion.districtName || (activeRegion.id === preferredRegionId ? '主城区' : `区域 ${activeRegion.id}`))}，{activeRegion ? activeRegion.chunkCount : 0} chunk）。</>
                                : <>当前数据区域范围是 X {autoFitBbox ? autoFitBbox.minX : dataBbox.minX}~{autoFitBbox ? autoFitBbox.maxX : dataBbox.maxX} / Z {autoFitBbox ? autoFitBbox.minZ : dataBbox.minZ}~{autoFitBbox ? autoFitBbox.maxZ : dataBbox.maxZ}。</>}
                            <button className="btn btn-secondary btn-sm" onClick={() => autoFitBbox && mapRef.current && mapRef.current.fitBbox(autoFitBbox)}>定位到数据</button>
                            {regionList.length > 1 && <span className="gis-dim">可用顶部「区域」下拉切换（如紫雪城区）。</span>}
                            <span className="gis-dim">或用顶部「跳转坐标」输入城区/标记的坐标。</span>
                        </div>
                    )}
                    {allWorlds.length === 0 && (
                        <div className="gis-banner">
                            尚未注册任何 GIS 世界。
                            {can.admin
                                ? <button className="btn btn-secondary btn-sm" onClick={() => setPanel('admin')}>去「管理」注册服务器与世界</button>
                                : <span>请联系 GIS 管理员注册服务器与世界。</span>}
                        </div>
                    )}
                    <GisMap
                        ref={mapRef}
                        worldId={worldId}
                        dimension={dimension}
                        objects={history ? history.objects : displayObjects}
                        showLayers={{ ...layers, contour: terrain.contour, hillshade: terrain.hillshade, missing: terrain.missing }}
                        onBoundsChange={onBoundsChange}
                        blockMap={{ enabled: layers.blocks && blockAvailable, worldId, dimension, palette, dataBbox: blockBbox }}
                        blockAvailable={blockAvailable}
                        onToggleLayer={toggleLayer}
                        onBlockStats={setBlockStats}
                        selectedKey={selected && selected.type !== 'market_place' ? objectKey(selected) : null}
                        onSelect={onSelect}
                        drawMode={drawMode}
                        onDrawComplete={onDrawComplete}
                        editTarget={selected && selected.type !== 'market_place' && selected.geometry ? { type: selected.type, geometry: geometryDraft || selected.geometry } : null}
                        editableVertices={vertexEdit && !!geometryDraft}
                        onVertexMove={onVertexMove}
                        contours={contours}
                        hillshade={hillshade}
                        missingRects={terrain.missing ? missingRects : null}
                        marketPlaces={marketPlaces}
                        historyMode={!!history}
                        autoFitBbox={autoFitBbox}
                        height="calc(100vh - 200px)"
                        zoomLabel={`缩放 ${zoom}`}
                    />
                    <div className="gis-legend">
                        <span><i className="gis-dot" style={{ background: '#5b8def' }} />城区</span>
                        <span><i className="gis-dot" style={{ background: '#8ecae6' }} />道路</span>
                        <span><i className="gis-dot" style={{ background: '#ffb703' }} />主干道</span>
                        <span><i className="gis-dot" style={{ background: '#ff5d8f' }} />标记</span>
                        <span><i className="gis-dot" style={{ background: '#ffd166' }} />集市地点</span>
                        <span><i className="gis-dot gis-dot-outline" />无数据区</span>
                        <span className="gis-dim">滚轮缩放 · 拖动平移 · 双击绘制结束 · Esc 取消</span>
                        {blockAvailable && (
                            <span className="gis-dim">
                                方块底图 {layers.blocks ? '开' : '关'}
                                {blockStats ? ` · tile ${blockStats.tiles} · 请求 ${blockStats.requests} · 缓存命中 ${blockStats.cacheHits} · 绘制 ${blockStats.paintMs ?? blockStats.lastMs}ms（峰值 ${blockStats.paintMaxMs ?? '-'}ms）` : ''}
                                {blockStats && blockStats.truncated ? ' · 已截断（放大看更多）' : ''}
                            </span>
                        )}
                        {mapDim && (
                            <span className="gis-dim">
                                数据 {mapDim.chunkCount} chunk（彩色 {mapDim.surfaceChunks} / 高度兜底 {mapDim.fallbackChunks}）
                            </span>
                        )}
                    </div>
                </div>

                <div className="gis-side">
                    <div className="gis-tabs">
                        {panelTabs.map((t) => (
                            <button key={t.key} className={`gis-tab ${panel === t.key ? 'active' : ''}`} onClick={() => setPanel(t.key)}>{t.label}</button>
                        ))}
                    </div>

                    {panel === 'attr' && (
                        <>
                            {creating && newForm ? (
                                <div className="gis-panel">
                                    <div className="gis-panel-head">
                                        新建{creating.type === 'marker' ? '地点标记' : creating.type === 'road' ? '道路' : '城区'}
                                        <button className="gis-icon-btn" onClick={() => { setCreating(null); setNewForm(null); }}>×</button>
                                    </div>
                                    <div className="gis-form">
                                        <div className="form-group">
                                            <label className="form-label">名称 *</label>
                                            <input className="form-input" value={newForm.name} maxLength={60} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} />
                                        </div>
                                        {creating.type === 'marker' && (
                                            <>
                                                <div className="form-group">
                                                    <label className="form-label">分类</label>
                                                    <select className="form-select" value={newForm.category} onChange={(e) => setNewForm({ ...newForm, category: e.target.value })}>
                                                        {(config ? config.markerCategories : []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                                                    </select>
                                                </div>
                                                <div className="gis-form-row">
                                                    <div className="form-group"><label className="form-label">X</label><input className="form-input" type="number" value={newForm.x} onChange={(e) => setNewForm({ ...newForm, x: e.target.value })} /></div>
                                                    <div className="form-group"><label className="form-label">Y</label><input className="form-input" type="number" value={newForm.y} onChange={(e) => setNewForm({ ...newForm, y: e.target.value })} /></div>
                                                    <div className="form-group"><label className="form-label">Z</label><input className="form-input" type="number" value={newForm.z} onChange={(e) => setNewForm({ ...newForm, z: e.target.value })} /></div>
                                                </div>
                                            </>
                                        )}
                                        {creating.type === 'road' && (
                                            <div className="gis-form-row">
                                                <div className="form-group"><label className="form-label">宽度</label><input className="form-input" type="number" min="1" max="64" value={newForm.width} onChange={(e) => setNewForm({ ...newForm, width: e.target.value })} /></div>
                                                <div className="form-group"><label className="form-label">等级</label>
                                                    <select className="form-select" value={newForm.roadLevel} onChange={(e) => setNewForm({ ...newForm, roadLevel: e.target.value })}>
                                                        {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{l} 级</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                        {creating.type === 'district' && (
                                            <div className="gis-form-row">
                                                <div className="form-group"><label className="form-label">颜色</label><input className="form-input" type="color" value={newForm.color} onChange={(e) => setNewForm({ ...newForm, color: e.target.value })} /></div>
                                                <div className="form-group"><label className="form-label">透明度</label><input className="form-input" type="number" step="0.05" min="0" max="1" value={newForm.opacity} onChange={(e) => setNewForm({ ...newForm, opacity: e.target.value })} /></div>
                                            </div>
                                        )}
                                        <div className="form-group">
                                            <label className="form-label">描述</label>
                                            <textarea className="form-textarea" rows={3} value={newForm.description} onChange={(e) => setNewForm({ ...newForm, description: e.target.value })} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">关联 Wiki 页面 ID（可空）</label>
                                            <input className="form-input" type="number" value={newForm.wikiPageId} onChange={(e) => setNewForm({ ...newForm, wikiPageId: e.target.value })} />
                                        </div>
                                        <label className="gis-check">
                                            <input type="checkbox" checked={!!newForm.submit} onChange={(e) => setNewForm({ ...newForm, submit: e.target.checked })} />
                                            创建后直接提交审核（编辑员可关闭，先存草稿）
                                        </label>
                                        <button className="btn btn-primary" disabled={busy} onClick={saveNew}>保存</button>
                                        {!canAnyEdit && <div className="gis-warn">当前账号无 GIS 编辑权限，保存会被后端拒绝。</div>}
                                    </div>
                                </div>
                            ) : (
                                <GisInspector
                                    object={selected}
                                    geometryDraft={geometryDraft}
                                    categories={config ? config.markerCategories : []}
                                    districts={districtOptions}
                                    canEdit={can.access && (selected && selected.type !== 'market_place')}
                                    canReview={can.review}
                                    canAdmin={can.admin}
                                    busy={busy}
                                    versions={versions}
                                    vertexEdit={vertexEdit}
                                    onToggleVertexEdit={(v) => { setVertexEdit(v); if (v && selected && selected.geometry && !geometryDraft) setGeometryDraft(JSON.parse(JSON.stringify(selected.geometry))); }}
                                    onGeometryReset={() => { setGeometryDraft(null); setVertexEdit(false); }}
                                    onSave={saveEdit}
                                    onAction={doAction}
                                    onWiki={saveWiki}
                                    onClose={() => { setSelected(null); setDetail(null); }}
                                    onFocus={focusObject}
                                    onLoadVersion={loadVersion}
                                    onRollback={rollback}
                                />
                            )}
                            {can.review && (
                                <div className="gis-quick">
                                    <button className="btn btn-secondary btn-sm" onClick={() => setPanel('review')}>打开审核队列</button>
                                </div>
                            )}
                        </>
                    )}

                    {panel === 'terrain' && (
                        <GisTerrainPanel
                            worldId={worldId}
                            dimension={dimension}
                            bbox={bbox}
                            settings={terrain}
                            onChange={setTerrain}
                            refreshKey={coverageVersion}
                        />
                    )}
                    {panel === 'search' && (
                        <GisSearchPanel worldId={worldId} dimension={dimension} bbox={bbox} onPick={(o) => { onSelect(o); focusObject(o); }} />
                    )}
                    {panel === 'review' && can.review && (
                        <GisReviewPanel
                            worldId={worldId}
                            busy={busy}
                            version={coverageVersion}
                            onSelect={(o) => { onSelect(o); focusObject(o); }}
                            onAction={(action, o) => doAction(action, o)}
                        />
                    )}
                    {panel === 'history' && can.access && (
                        <GisHistoryPanel
                            worldId={worldId}
                            dimension={dimension}
                            bbox={bbox}
                            canAdmin={can.admin}
                            version={coverageVersion}
                            onSnapshotView={enterSnapshotView}
                            onTimeView={enterTimeView}
                            onExit={exitHistory}
                            onFocusBbox={() => {
                                const list = (history && history.objects) || [];
                                const boxes = list.map((o) => geometryCenter(o.geometry || (o.point ? { type: 'Point', coordinates: [o.point.x, o.point.z] } : null))).filter(Boolean);
                                if (!boxes.length || !mapRef.current) return;
                                const box = {
                                    minX: Math.min(...boxes.map((b) => b.bbox.minX)),
                                    minZ: Math.min(...boxes.map((b) => b.bbox.minZ)),
                                    maxX: Math.max(...boxes.map((b) => b.bbox.maxX)),
                                    maxZ: Math.max(...boxes.map((b) => b.bbox.maxZ))
                                };
                                mapRef.current.fitBbox(box);
                            }}
                        />
                    )}
                    {panel === 'admin' && can.admin && (
                        <GisAdminPanel worlds={allWorlds} servers={config ? config.servers : []} stats={stats} canAdmin={can.admin} onChanged={reloadWorlds} />
                    )}
                    {panel === 'attr' && !user && (
                        <div className="gis-panel">
                            <div className="gis-panel-head">说明</div>
                            <div className="gis-hint">
                                玄剑 GIS 是玄剑世界的地理信息系统：城区、道路、地点标记、地形与历史版本。<br />
                                未登录可浏览已发布图层；登录公会成员可提交地点标记（需审核），GIS 编辑员可绘制道路与城区。
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
