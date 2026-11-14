/**
 * 地点引用（集市 / XBed 预留）。
 *
 * 集市地点：只读 `market_store_locations`（唯一数据源，不复制、不并行建表），
 * 供 /gis 地图「集市地点」图层与空间关联使用；写操作仍走集市既有接口。
 *
 * XBed 预留：gis_place_refs 表保存外部系统（xbed）对 GIS 地点的引用，
 * 不改 xbed / xbed-plugin 仓库。
 */

const db = require('../../database');
const { errors } = require('./errors');
const { LIMITS } = require('./constants');
const geo = require('./geo');
const audit = require('./audit');

const localTs = () => new Date(Date.now() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 19).replace('T', ' ');

/** server_key → 当前 ACTIVE 世界（可选关联） */
async function serverWorldMap() {
    const rows = await db.all(`SELECT id, server_key, world_key, is_current FROM gis_worlds WHERE status = 'ACTIVE'`);
    const map = new Map();
    for (const r of rows) {
        const cur = map.get(r.server_key);
        if (!cur || Number(r.is_current) === 1) map.set(r.server_key, { worldId: r.id, worldKey: r.world_key });
    }
    return map;
}

/** 集市店铺地点（只读，is_public=1） */
async function listMarketLocations({ serverKey = null, dimension = null, bbox = null, limit = 2000, includePrivate = false } = {}) {
    const where = [];
    const params = [];
    if (!includePrivate) { where.push('l.is_public = 1'); where.push(`s.status IN ('active','grace')`); }
    if (serverKey) { where.push('l.server_key = ?'); params.push(String(serverKey)); }
    if (dimension) { where.push('l.dimension = ?'); params.push(String(dimension)); }
    let box = null;
    if (bbox) {
        box = geo.parseBbox(bbox);
        where.push('l.x >= ?', 'l.x <= ?', 'l.z >= ?', 'l.z <= ?');
        params.push(box.minX, box.maxX, box.minZ, box.maxZ);
    }
    const lim = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
    const sql = `SELECT l.id, l.store_id, l.server_key, l.server_name, l.dimension, l.dimension_custom,
                        l.x, l.y, l.z, l.label, l.note, l.is_public, l.created_at, l.updated_at,
                        l.world_id, l.gis_marker_id,
                        s.name AS store_name, s.slug AS store_slug, s.avatar AS store_avatar, s.status AS store_status
                   FROM market_store_locations l
                   LEFT JOIN market_stores s ON s.id = l.store_id
                  ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY l.id LIMIT ?`;
    let rows;
    try {
        rows = await db.all(sql, [...params, lim]);
    } catch (e) {
        // 集市表不存在（未安装集市模块）时返回空，不影响 GIS 其他功能
        return { items: [], total: 0, bbox: box };
    }
    const worldMap = await serverWorldMap();
    const items = rows.map((r) => ({
        id: r.id,
        kind: 'market_store',
        refType: 'market_store_location',
        refId: r.id,
        storeId: r.store_id,
        storeName: r.store_name || '',
        storeSlug: r.store_slug || null,
        storeAvatar: r.store_avatar || null,
        name: r.label || r.store_name || `集市地点 #${r.id}`,
        serverKey: r.server_key,
        serverName: r.server_name || r.server_key,
        dimension: r.dimension,
        dimensionCustom: r.dimension_custom || '',
        x: r.x, y: r.y, z: r.z,
        label: r.label || '',
        note: r.note || '',
        isPublic: Number(r.is_public) === 1,
        worldId: r.world_id || (worldMap.get(r.server_key) || {}).worldId || null,
        gisMarkerId: r.gis_marker_id || null,
        link: `/market/store/${r.store_id}`,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    }));
    return { items, total: items.length, bbox: box };
}

/** 数量核对：集市地点 vs GIS 可见地点 */
async function countMarketLocations() {
    const out = { marketLocations: 0, publicLocations: 0, marketStores: 0, gisPlaces: 0, publicPlaces: 0, consistent: true };
    try {
        const total = await db.get(`SELECT COUNT(*) AS c FROM market_store_locations`);
        out.marketLocations = Number(total && total.c) || 0;
        const pub = await db.get(`SELECT COUNT(*) AS c FROM market_store_locations WHERE is_public = 1`);
        out.publicLocations = Number(pub && pub.c) || 0;
        const stores = await db.get(`SELECT COUNT(*) AS c FROM market_stores`);
        out.marketStores = Number(stores && stores.c) || 0;
    } catch (e) { /* 集市表不存在 */ }
    const listed = await listMarketLocations({ limit: 5000 });
    out.publicPlaces = listed.total;
    out.gisPlaces = out.marketLocations;
    out.consistent = out.marketLocations === out.gisPlaces;
    return out;
}

/** 统一地点引用列表：集市地点 + 已发布 Marker（bbox 可选，结果有硬上限） */
async function listPlaces({ worldId = null, dimension = null, bbox = null, kind = null } = {}) {
    const kinds = kind ? String(kind).split(',').map((s) => s.trim()).filter(Boolean) : null;
    const wantMarket = !kinds || kinds.some((k) => k === 'market_store' || k === 'all');
    const wantMarker = !kinds || kinds.some((k) => k === 'gis_marker' || k === 'marker' || k === 'all');
    const wantDistrict = !kinds || kinds.some((k) => k === 'district' || k === 'all');
    const out = [];
    if (wantMarket) {
        const market = await listMarketLocations({ dimension, bbox, limit: 2000 });
        const items = market.items.filter((i) => (!worldId || i.worldId === null || Number(i.worldId) === Number(worldId)));
        out.push(...items);
    }
    if (wantMarker || wantDistrict) {
        const width = Number(worldId);
        if (!Number.isInteger(width) || width <= 0 || !dimension) {
            if (out.length) return { items: out, total: out.length };
            throw errors.invalid('查询 GIS 对象地点时 worldId 与 dimension 必填', 'worldId');
        }
        const objectTypes = [];
        if (wantMarker) objectTypes.push('marker');
        if (wantDistrict) objectTypes.push('district');
        const objects = require('./objects');
        const res = await objects.queryPublished({
            worldId: width, dimension, bbox: bbox || undefined,
            types: objectTypes, limit: 500, detail: false
        });
        for (const o of res.objects) {
            out.push({
                kind: o.type === 'marker' ? 'gis_marker' : 'district',
                refType: o.type, refId: o.id, id: `${o.type}:${o.id}`,
                name: o.name, worldId: o.worldId, dimension: o.dimension,
                x: o.point ? o.point.x : null, y: o.point ? o.point.y : null, z: o.point ? o.point.z : null,
                label: o.name, note: o.description || '', wikiPageId: o.wikiPageId,
                link: `/gis?object=${o.type}:${o.id}`
            });
        }
    }
    return { items: out, total: out.length, truncated: out.length >= 2500 };
}

/** 单条地点引用 */
async function getPlace(kind, refId) {
    const id = Number(refId);
    if (!Number.isInteger(id) || id <= 0) throw errors.invalid('refId 必须是正整数', 'refId');
    if (kind === 'market_store' || kind === 'market_store_location') {
        const row = await db.get(
            `SELECT l.id, l.store_id, l.server_key, l.server_name, l.dimension, l.dimension_custom,
                    l.x, l.y, l.z, l.label, l.note, l.is_public, l.world_id, l.gis_marker_id, l.created_at, l.updated_at,
                    s.name AS store_name, s.slug AS store_slug
               FROM market_store_locations l LEFT JOIN market_stores s ON s.id = l.store_id WHERE l.id = ?`, [id]);
        if (!row) throw errors.notFound('集市地点不存在');
        const worldMap = await serverWorldMap();
        return {
            kind: 'market_store', refType: 'market_store_location', refId: row.id, id: row.id,
            storeId: row.store_id, storeName: row.store_name || '', storeSlug: row.store_slug || null,
            name: row.label || row.store_name || `集市地点 #${row.id}`,
            serverKey: row.server_key, serverName: row.server_name || row.server_key,
            dimension: row.dimension, dimensionCustom: row.dimension_custom || '',
            x: row.x, y: row.y, z: row.z, label: row.label || '', note: row.note || '',
            isPublic: Number(row.is_public) === 1,
            worldId: row.world_id || (worldMap.get(row.server_key) || {}).worldId || null,
            gisMarkerId: row.gis_marker_id || null,
            link: `/market/store/${row.store_id}`
        };
    }
    if (kind === 'marker' || kind === 'district') {
        const objects = require('./objects');
        const o = await objects.getPublished(kind, id);
        if (!o) throw errors.notFound('GIS 对象未发布或不存在');
        return {
            kind: kind === 'marker' ? 'gis_marker' : 'district', refType: kind, refId: id, id: `${kind}:${id}`,
            name: o.name, worldId: o.worldId, dimension: o.dimension,
            x: o.point ? o.point.x : null, y: o.point ? o.point.y : null, z: o.point ? o.point.z : null,
            label: o.name, note: o.description || '', wikiPageId: o.wikiPageId,
            link: `/gis?object=${kind}:${id}`
        };
    }
    throw errors.invalid('kind 只能是 market_store / marker / district', 'kind');
}

/* ---------------- XBed 预留：外部地点引用 ---------------- */

async function listPlaceRefs({ externalSystem = null, limit = 100 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const rows = externalSystem
        ? await db.all(`SELECT * FROM gis_place_refs WHERE external_system = ? ORDER BY id DESC LIMIT ?`, [String(externalSystem), lim])
        : await db.all(`SELECT * FROM gis_place_refs ORDER BY id DESC LIMIT ?`, [lim]);
    return rows.map(decoratePlaceRef);
}

function decoratePlaceRef(r) {
    return {
        id: r.id, externalSystem: r.external_system, externalId: r.external_id,
        refKind: r.ref_kind, refId: r.ref_id, worldId: r.world_id, dimension: r.dimension,
        x: r.x, y: r.y, z: r.z, label: r.label || '', note: r.note || '',
        createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at
    };
}

async function createPlaceRef({ externalSystem, externalId, refKind = 'point', refId = null, worldId = null, dimension = null, x = null, y = null, z = null, label = '', note = '' }, ctx = {}) {
    const sys = geo.safeText(externalSystem, 40, 'externalSystem');
    const ext = geo.safeText(externalId, 80, 'externalId');
    if (!sys || !ext) throw errors.invalid('externalSystem / externalId 不能为空');
    if (!['marker', 'district', 'road', 'point', 'market_store'].includes(refKind)) {
        throw errors.invalid('refKind 只能是 marker/district/road/point/market_store', 'refKind');
    }
    const existing = await db.get(`SELECT id FROM gis_place_refs WHERE external_system = ? AND external_id = ?`, [sys, ext]);
    if (existing) {
        await db.run(
            `UPDATE gis_place_refs SET ref_kind = ?, ref_id = ?, world_id = ?, dimension = ?, x = ?, y = ?, z = ?, label = ?, note = ?, updated_at = ?
              WHERE id = ?`,
            [refKind, refId || null, worldId || null, dimension || null,
                Number.isFinite(Number(x)) ? Number(x) : null, Number.isFinite(Number(y)) ? Number(y) : null,
                Number.isFinite(Number(z)) ? Number(z) : null, geo.safeText(label, LIMITS.maxNameLength, 'label'),
                geo.safeText(note, LIMITS.maxNoteLength, 'note'), localTs(), existing.id]);
        const row = await db.get(`SELECT * FROM gis_place_refs WHERE id = ?`, [existing.id]);
        await audit.log('place_ref_update', { actorId: ctx.actorId, ip: ctx.ip, detail: { externalSystem: sys, externalId: ext } });
        return decoratePlaceRef(row);
    }
    const r = await db.run(
        `INSERT INTO gis_place_refs (external_system, external_id, ref_kind, ref_id, world_id, dimension, x, y, z, label, note, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sys, ext, refKind, refId || null, worldId || null, dimension || null,
            Number.isFinite(Number(x)) ? Number(x) : null, Number.isFinite(Number(y)) ? Number(y) : null,
            Number.isFinite(Number(z)) ? Number(z) : null, geo.safeText(label, LIMITS.maxNameLength, 'label'),
            geo.safeText(note, LIMITS.maxNoteLength, 'note'), ctx.actorId || null, localTs(), localTs()]
    );
    const row = await db.get(`SELECT * FROM gis_place_refs WHERE id = ?`, [r.id]);
    await audit.log('place_ref_create', { actorId: ctx.actorId, ip: ctx.ip, detail: { externalSystem: sys, externalId: ext } });
    return decoratePlaceRef(row);
}

async function deletePlaceRef({ externalSystem, externalId }, ctx = {}) {
    const sys = geo.safeText(externalSystem, 40, 'externalSystem');
    const ext = geo.safeText(externalId, 80, 'externalId');
    if (!sys || !ext) throw errors.invalid('externalSystem / externalId 不能为空');
    const row = await db.get(`SELECT id FROM gis_place_refs WHERE external_system = ? AND external_id = ?`, [sys, ext]);
    if (!row) return { ok: true, deleted: false };
    await db.run(`DELETE FROM gis_place_refs WHERE id = ?`, [row.id]);
    await audit.log('place_ref_delete', { actorId: ctx.actorId, ip: ctx.ip, detail: { externalSystem: sys, externalId: ext } });
    return { ok: true, deleted: true };
}

module.exports = {
    listMarketLocations, countMarketLocations, listPlaces, getPlace,
    listPlaceRefs, createPlaceRef, deletePlaceRef
};
