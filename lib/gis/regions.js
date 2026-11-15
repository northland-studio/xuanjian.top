/**
 * GIS 数据区域（region）聚类。
 *
 * 背景：一个世界/维度里可能有多块**合法但相距很远**的采集区域（例如主城区 + 紫雪城区）。
 * 若把整体 bbox 当成「数据范围」，地图定位会缩放到十几万方块、绝大部分是空的 → 用户看到「一片黑」。
 * 因此按 chunk 连通性聚类成 region，前端默认定位到**最大区域**，并提供区域切换。
 *
 * 聚类规则：chunk 网格上相邻/间隔 ≤ 8 个 chunk（128 方块）视为同一区域（Chebyshev 距离）。
 * 说明：不是过滤/删除数据，远区数据完整保留，只是分开呈现。
 */

const db = require('../../database');
const { LIMITS } = require('./constants');

const CHUNK = LIMITS.chunkBlocks; // 16
const ADJ = 8;                     // 邻接阈值（chunk）
const BUCKET = ADJ + 1;            // 分桶边长：保证邻接块一定落在同桶或相邻桶
const MAX_SCAN = 200000;           // 单次聚类最多扫描 chunk 数（防御性上限）
const CACHE_TTL_MS = 60 * 1000;

const cache = new Map(); // key → { signature, at, value }

const keyOf = (cx, cz) => `${cx},${cz}`;

/** 并查集 */
function makeUnionFind() {    const parent = new Map();
    const find = (x) => {
        let p = parent.get(x);
        if (p === undefined) { parent.set(x, x); return x; }
        while (p !== x) {
            const gp = parent.get(p);
            parent.set(x, gp);
            x = p;
            p = gp;
        }
        return x;
    };
    const union = (a, b) => {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    };
    return { find, union, parent };
}

/* ---------------- 几何工具（district bbox 命名） ---------------- */

/** 从 GeoJSON geometry 计算 bbox（支持 Polygon / MultiPolygon）；无有效坐标返回 null */
function geometryBbox(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const visit = (coords) => {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
            const x = Number(coords[0]), z = Number(coords[1]);
            if (!Number.isFinite(x) || !Number.isFinite(z)) return;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
            return;
        }
        for (const item of coords) visit(item);
    };
    visit(geometry.coordinates);
    if (!Number.isFinite(minX)) return null;
    return { minX, minZ, maxX, maxZ };
}

function pointInBbox(x, z, b) {
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

/** 两个 bbox 的交集面积（无交集返回 0） */
function intersectionArea(a, b) {
    const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const h = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    if (w <= 0 || h <= 0) return 0;
    return w * h;
}

/** 读取某维度所有 chunk 的 (cx, cz, hasSurface, firstSeen) */
async function loadChunks(worldId, dimension) {
    const rows = await db.all(
        `SELECT chunk_x, chunk_z,
                CASE WHEN block_hist LIKE '%"surface":"%' THEN 1 ELSE 0 END AS has_surface,
                COALESCE(created_at, updated_at) AS first_seen
           FROM gis_elevation_chunks
          WHERE world_id = ? AND dimension = ?
          ORDER BY chunk_z, chunk_x
          LIMIT ?`,
        [Number(worldId), String(dimension), MAX_SCAN]
    );
    return rows.map((r) => ({
        cx: Number(r.chunk_x),
        cz: Number(r.chunk_z),
        hasSurface: Number(r.has_surface) === 1,
        firstSeen: r.first_seen || null
    }));
}

/**
 * 计算区域聚类。
 * @returns {Promise<{regions:Array, bbox:object|null, chunkCount:number, outlierChunks:number, truncated:boolean}>}
 */
async function computeRegions({ worldId, dimension }) {
    const width = Number(worldId);
    const dim = String(dimension || '');
    if (!Number.isInteger(width) || width <= 0) return { regions: [], bbox: null, chunkCount: 0, outlierChunks: 0, truncated: false };

    // 轻量签名 + 缓存（60s）：避免每次 index 请求都扫描全量 chunk。
    // 签名同时包含 published 对象数（城区/道路/标记变化时缓存要失效）。
    const [sigRow, districtSigRow] = await Promise.all([
        db.get(
            `SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), '') AS t
               FROM gis_elevation_chunks WHERE world_id = ? AND dimension = ?`,
            [width, dim]),
        db.get(
            `SELECT COUNT(*) AS c, COALESCE(SUM(seq), 0) AS s
               FROM gis_published WHERE world_id = ? AND dimension = ? AND deleted = 0`,
            [width, dim]).catch(() => null)
    ]);
    const signature = `${Number(sigRow && sigRow.c) || 0}|${(sigRow && sigRow.t) || ''}|d${Number(districtSigRow && districtSigRow.c) || 0}:${Number(districtSigRow && districtSigRow.s) || 0}`;
    const cacheKey = `${width}:${dim}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.signature === signature && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const chunks = await loadChunks(width, dim);
    const truncated = chunks.length >= MAX_SCAN;

    if (!chunks.length) {
        const empty = { regions: [], bbox: null, chunkCount: 0, outlierChunks: 0, truncated: false };
        cache.set(cacheKey, { signature, at: Date.now(), value: empty });
        return empty;
    }

    // 分桶（bucket 大小 9：邻接 ≤8 的 chunk 必在同桶或相邻桶）
    const buckets = new Map();
    const uf = makeUnionFind();
    for (const c of chunks) {
        uf.find(keyOf(c.cx, c.cz));
        const bx = Math.floor(c.cx / BUCKET), bz = Math.floor(c.cz / BUCKET);
        const bk = `${bx},${bz}`;
        if (!buckets.has(bk)) buckets.set(bk, []);
        buckets.get(bk).push(c);
    }
    for (const chunk of chunks) {
        const bx = Math.floor(chunk.cx / BUCKET), bz = Math.floor(chunk.cz / BUCKET);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const list = buckets.get(`${bx + dx},${bz + dz}`);
                if (!list) continue;
                for (const other of list) {
                    if (other === chunk) continue;
                    if (Math.abs(other.cx - chunk.cx) <= ADJ && Math.abs(other.cz - chunk.cz) <= ADJ) {
                        uf.union(keyOf(chunk.cx, chunk.cz), keyOf(other.cx, other.cz));
                    }
                }
            }
        }
    }

    // 归组
    const groups = new Map();
    for (const chunk of chunks) {
        const root = uf.find(keyOf(chunk.cx, chunk.cz));
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(chunk);
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const raw = [];
    for (const list of groups.values()) {
        let rMinX = Infinity, rMaxX = -Infinity, rMinZ = Infinity, rMaxZ = -Infinity;
        let surfaceChunks = 0;
        let sumCx = 0, sumCz = 0;
        let firstSeen = null;
        for (const c of list) {
            const bMinX = c.cx * CHUNK, bMaxX = c.cx * CHUNK + CHUNK;
            const bMinZ = c.cz * CHUNK, bMaxZ = c.cz * CHUNK + CHUNK;
            if (bMinX < rMinX) rMinX = bMinX;
            if (bMaxX > rMaxX) rMaxX = bMaxX;
            if (bMinZ < rMinZ) rMinZ = bMinZ;
            if (bMaxZ > rMaxZ) rMaxZ = bMaxZ;
            if (c.hasSurface) surfaceChunks++;
            sumCx += c.cx; sumCz += c.cz;
            if (c.firstSeen && (!firstSeen || c.firstSeen < firstSeen)) firstSeen = c.firstSeen;
        }
        if (rMinX < minX) minX = rMinX;
        if (rMaxX > maxX) maxX = rMaxX;
        if (rMinZ < minZ) minZ = rMinZ;
        if (rMaxZ > maxZ) maxZ = rMaxZ;
        raw.push({
            bbox: { minX: rMinX, minZ: rMinZ, maxX: rMaxX, maxZ: rMaxZ },
            chunkCount: list.length,
            centerX: Math.round((sumCx / list.length) * CHUNK + CHUNK / 2),
            centerZ: Math.round((sumCz / list.length) * CHUNK + CHUNK / 2),
            surfaceChunks,
            fallbackChunks: list.length - surfaceChunks,
            firstSeen
        });
    }
    raw.sort((a, b) => b.chunkCount - a.chunkCount || a.bbox.minX - b.bbox.minX);

    // 区域命名（可选）：用 published district 的几何 bbox 与区域 bbox **相交/包含** 判定，
    // 命中则带上 districtId/districtName；没有命中的区域保持中性名（不编造）。
    // 同时统计每个区域内的已发布对象数（districts/roads/markers），用于前端挑选「主城区」默认视野。
    const publishedRows = await db.all(
        `SELECT object_type, object_id, payload FROM gis_published
          WHERE world_id = ? AND dimension = ? AND deleted = 0`,
        [width, dim]).catch(() => []);
    const districts = [];
    const publishedObjects = [];
    for (const row of publishedRows) {
        let payload;
        try { payload = JSON.parse(row.payload); } catch (e) { continue; }
        if (!payload || payload.deleted) continue;
        if (payload.status && String(payload.status).toUpperCase() !== 'PUBLISHED') continue;
        const bbox = geometryBbox(payload.geometry);
        if (!bbox) continue;
        publishedObjects.push({ type: String(row.object_type), bbox });
        if (String(row.object_type) === 'district') {
            districts.push({ id: Number(row.object_id), name: payload.name ? String(payload.name) : null, bbox });
        }
    }
    const regions = raw.map((r, i) => {
        let districtName = null;
        let districtId = null;
        let bestScore = -1;
        for (const d of districts) {
            const inter = intersectionArea(r.bbox, d.bbox);
            const regionArea = (r.bbox.maxX - r.bbox.minX) * (r.bbox.maxZ - r.bbox.minZ);
            const centerInside = pointInBbox(r.centerX, r.centerZ, d.bbox);
            if (inter <= 0 && !centerInside) continue;
            const ratio = regionArea > 0 ? inter / regionArea : 0;
            // 未达到 1% 相交且中心不在 district 内 → 不认定为该城区
            if (!centerInside && ratio < 0.01) continue;
            // 取与区域重叠面积最大的 district；同分取面积更小的（更精确）
            const score = inter + (centerInside ? 1e-6 : 0);
            if (score > bestScore) {
                bestScore = score;
                districtId = d.id;
                districtName = d.name;
            }
        }
        // 区域内的已发布对象数（含城区/道路/地点标记）：点状对象按几何 bbox（点）判断是否落在区域内
        let objectCount = 0;
        for (const obj of publishedObjects) {
            const pointInside = pointInBbox((obj.bbox.minX + obj.bbox.maxX) / 2, (obj.bbox.minZ + obj.bbox.maxZ) / 2, r.bbox);
            if (pointInside || intersectionArea(r.bbox, obj.bbox) > 0) objectCount++;
        }
        return { id: i + 1, ...r, districtId, districtName, objectCount };
    });

    const value = {
        regions,
        bbox: { minX, minZ, maxX, maxZ },
        chunkCount: chunks.length,
        // 非最大区域的 chunk 数（保留字段名 outlierChunks，语义=「其他区域」而非脏数据）
        outlierChunks: chunks.length - regions[0].chunkCount,
        truncated
    };
    cache.set(cacheKey, { signature, at: Date.now(), value });
    return value;
}

module.exports = { computeRegions, ADJ, CHUNK };
