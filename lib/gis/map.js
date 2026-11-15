/**
 * 方块彩色地图数据查询（服务端只出数据，绝不做图片编码）。
 *
 * 契约：docs/gis-canvas-map.md
 *  - GET /api/gis/map/palette  → 调色板（lib/gis/map-palette.js）
 *  - GET /api/gis/map/chunks   → 按 bbox + lod 抽样的区块地表/高程数据（base64 小端二进制）
 *  - GET /api/gis/map/index    → 各维度覆盖度（判断底图是否可用）
 *
 * 数据来源：gis_elevation_chunks（payload 在 block_hist JSON 里带可选 surface，v2 客户端上传）。
 * 旧数据没有 surface → mode:"fallback"，浏览器用高度 + 群系兜底着色。
 */

const db = require('../../database');
const { errors } = require('./errors');
const { LIMITS } = require('./constants');
const geo = require('./geo');
const terrain = require('./terrain');
const palette = require('./map-palette');
const regions = require('./regions');

const CHUNK = LIMITS.chunkBlocks; // 16
const MAP_MAX_BBOX_AREA = 4000000; // 方块²（约 2000×2000）
const MAP_MAX_CHUNKS = 512;        // 单次返回区块上限
const MAP_MAX_LOD = 6;             // 每像素 64 方块
const NODATA_I16 = -32768;
const NODATA_U16 = 0xFFFF;

function parseLod(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    if (!Number.isInteger(n) || n < 0 || n > MAP_MAX_LOD) {
        throw errors.invalid(`lod 必须是 0~${MAP_MAX_LOD} 的整数`, 'lod');
    }
    return n;
}

/**
 * 覆盖度索引：各维度 chunk 总数 / surface 数 / fallback 数 / 区域聚类。
 *
 * `regions` 是按 chunk 连通性聚类出的「数据区域」（合法远区各自成块）；
 * `bbox` 仍为整体范围；`outlierChunks` = 除最大区域外的 chunk 数（不是脏数据，只是分布在不同区域）。
 */
async function getIndex({ worldId }) {
    const width = geo.parseId(worldId, 'worldId');
    const rows = await db.all(
        `SELECT dimension,
                COUNT(*) AS chunk_count,
                SUM(CASE WHEN block_hist LIKE '%"surface":"%' THEN 1 ELSE 0 END) AS surface_chunks,
                MIN(chunk_x) AS min_cx, MAX(chunk_x) AS max_cx,
                MIN(chunk_z) AS min_cz, MAX(chunk_z) AS max_cz,
                MAX(updated_at) AS updated_at
           FROM gis_elevation_chunks
          WHERE world_id = ?
          GROUP BY dimension
          ORDER BY dimension`, [width]);
    const dimensions = {};
    for (const r of rows) {
        const count = Number(r.chunk_count) || 0;
        const surfaceChunks = Number(r.surface_chunks) || 0;
        const clustered = count ? await regions.computeRegions({ worldId: width, dimension: r.dimension }) : null;
        dimensions[r.dimension] = {
            chunkCount: count,
            surfaceChunks,
            fallbackChunks: Math.max(0, count - surfaceChunks),
            regions: clustered ? clustered.regions : [],
            outlierChunks: clustered ? clustered.outlierChunks : 0,
            bbox: count ? {
                minX: Number(r.min_cx) * CHUNK,
                maxX: Number(r.max_cx) * CHUNK + CHUNK,
                minZ: Number(r.min_cz) * CHUNK,
                maxZ: Number(r.max_cz) * CHUNK + CHUNK
            } : null,
            updatedAt: r.updated_at || null
        };
    }
    return { worldId: width, dimensions };
}

/** 解析一行 chunk 的矩阵（heights 必有；surface 在 block_hist JSON 里，可选） */
function decodeRow(row) {
    const sampleStep = Number(row.sample_step) || 1;
    const sampleSize = Number(row.sample_size) || CHUNK / sampleStep;
    const heights = Buffer.isBuffer(row.heights) ? row.heights : Buffer.from(row.heights || []);
    const biome = row.biome ? (Buffer.isBuffer(row.biome) ? row.biome : Buffer.from(row.biome)) : null;
    const parsed = terrain.parseBlockHist(row.block_hist);
    return { sampleStep, sampleSize, heights, biome, surface: parsed.surface, hist: parsed.hist };
}

/** 矩阵坐标映射：chunk 内 block 局部坐标 → 矩阵行列（支持 sampleStep>1 的稀疏采样） */
function matrixIndexRange(sampleStep, sampleSize, from, to) {
    // 目标区域 [from, to)（chunk 内 local block 坐标，0~15）
    let start = Math.floor(from / sampleStep);
    let end = Math.ceil(to / sampleStep) - 1;
    if (end < start) end = start;
    start = Math.max(0, Math.min(sampleSize - 1, start));
    end = Math.max(0, Math.min(sampleSize - 1, end));
    return { start, end };
}

/** 区域内出现最多的 u16 值（忽略 0xFFFF） */
function regionModeU16(buf, sampleStep, sampleSize, x0, x1, z0, z1) {
    const xs = matrixIndexRange(sampleStep, sampleSize, x0, x1);
    const zs = matrixIndexRange(sampleStep, sampleSize, z0, z1);
    const counts = new Map();
    let best = NODATA_U16, bestCount = 0;
    for (let rz = zs.start; rz <= zs.end; rz++) {
        for (let rx = xs.start; rx <= xs.end; rx++) {
            const idx = (rz * sampleSize + rx) * 2;
            if (idx + 2 > buf.length) continue;
            const v = buf.readUInt16LE(idx);
            if (v === NODATA_U16) continue;
            const c = (counts.get(v) || 0) + 1;
            counts.set(v, c);
            if (c > bestCount) { bestCount = c; best = v; }
        }
    }
    return { value: best, count: bestCount };
}

/** 区域高度平均值（忽略 -32768），无有效值返回 -32768 */
function regionMeanI16(buf, sampleStep, sampleSize, x0, x1, z0, z1) {
    const xs = matrixIndexRange(sampleStep, sampleSize, x0, x1);
    const zs = matrixIndexRange(sampleStep, sampleSize, z0, z1);
    let sum = 0, count = 0;
    for (let rz = zs.start; rz <= zs.end; rz++) {
        for (let rx = xs.start; rx <= xs.end; rx++) {
            const idx = (rz * sampleSize + rx) * 2;
            if (idx + 2 > buf.length) continue;
            const v = buf.readInt16LE(idx);
            if (v === NODATA_I16) continue;
            sum += v; count++;
        }
    }
    return count ? Math.round(sum / count) : NODATA_I16;
}

/** 每区块每边采样点数：lod=0 → 16，1 → 8，2 → 4，3 → 2，4+ → 1 */
function samplesPerSide(lod) {
    return Math.max(1, CHUNK >> lod);
}

/**
 * 视野区块查询（按 bbox + lod 抽样）。
 * @returns {{worldId:number,dimension:string,lod:number,step:number,bbox:object,
 *            chunks:Array,truncated:boolean,chunksTotal:number,samplesPerSide:number}}
 */
async function queryChunks({ worldId, dimension, bbox, lod = 0 }) {
    const width = geo.parseId(worldId, 'worldId');
    const dim = String(dimension || '');
    if (!require('./constants').DIMENSIONS.includes(dim)) throw errors.invalid('dimension 不合法', 'dimension');
    const box = geo.parseBbox(bbox, { maxArea: MAP_MAX_BBOX_AREA });
    const level = parseLod(lod);
    const step = 1 << level;
    const perSide = samplesPerSide(level);

    const minCx = Math.floor(box.minX / CHUNK);
    const maxCx = Math.floor((box.maxX - 1e-9) / CHUNK);
    const minCz = Math.floor(box.minZ / CHUNK);
    const maxCz = Math.floor((box.maxZ - 1e-9) / CHUNK);

    const totalRow = await db.get(
        `SELECT COUNT(*) AS c FROM gis_elevation_chunks
          WHERE world_id = ? AND dimension = ? AND chunk_x >= ? AND chunk_x <= ? AND chunk_z >= ? AND chunk_z <= ?`,
        [width, dim, minCx, maxCx, minCz, maxCz]);
    const chunksTotal = Number(totalRow && totalRow.c) || 0;
    if (!chunksTotal) {
        return { worldId: width, dimension: dim, lod: level, step, bbox: box, chunks: [], truncated: false, chunksTotal: 0, samplesPerSide: perSide };
    }

    const rows = await db.all(
        `SELECT chunk_x, chunk_z, sample_step, sample_size, heights, biome, block_hist
           FROM gis_elevation_chunks
          WHERE world_id = ? AND dimension = ? AND chunk_x >= ? AND chunk_x <= ? AND chunk_z >= ? AND chunk_z <= ?
          ORDER BY chunk_z ASC, chunk_x ASC LIMIT ?`,
        [width, dim, minCx, maxCx, minCz, maxCz, MAP_MAX_CHUNKS]);

    const chunks = [];
    for (const row of rows) {
        const d = decodeRow(row);
        const entry = {
            cx: Number(row.chunk_x),
            cz: Number(row.chunk_z),
            size: CHUNK,
            samplesPerSide: perSide,
            step
        };
        if (d.surface && d.surface.length >= d.sampleSize * d.sampleSize * 2) {
            // surface 模式：每采样区域取出现最多的地表方块
            entry.mode = 'surface';
            const out = Buffer.alloc(perSide * perSide * 2);
            for (let sz = 0; sz < perSide; sz++) {
                for (let sx = 0; sx < perSide; sx++) {
                    const x0 = sx * step, x1 = Math.min(CHUNK, x0 + step);
                    const z0 = sz * step, z1 = Math.min(CHUNK, z0 + step);
                    const r = regionModeU16(d.surface, d.sampleStep, d.sampleSize, x0, x1, z0, z1);
                    out.writeUInt16LE(r.value, (sz * perSide + sx) * 2);
                }
            }
            entry.blocks = out.toString('base64');
        } else {
            // fallback 模式：只有高度（旧数据）→ 区域均值高度 + 可选群系
            entry.mode = 'fallback';
            const out = Buffer.alloc(perSide * perSide * 2);
            for (let sz = 0; sz < perSide; sz++) {
                for (let sx = 0; sx < perSide; sx++) {
                    const x0 = sx * step, x1 = Math.min(CHUNK, x0 + step);
                    const z0 = sz * step, z1 = Math.min(CHUNK, z0 + step);
                    const h = regionMeanI16(d.heights, d.sampleStep, d.sampleSize, x0, x1, z0, z1);
                    out.writeInt16LE(h, (sz * perSide + sx) * 2);
                }
            }
            entry.heights = out.toString('base64');
            if (d.biome && d.biome.length >= d.sampleSize * d.sampleSize * 2) {
                const bio = Buffer.alloc(perSide * perSide * 2);
                for (let sz = 0; sz < perSide; sz++) {
                    for (let sx = 0; sx < perSide; sx++) {
                        const x0 = sx * step, x1 = Math.min(CHUNK, x0 + step);
                        const z0 = sz * step, z1 = Math.min(CHUNK, z0 + step);
                        const r = regionModeU16(d.biome, d.sampleStep, d.sampleSize, x0, x1, z0, z1);
                        bio.writeUInt16LE(r.value === NODATA_U16 ? 0xFFFF : r.value, (sz * perSide + sx) * 2);
                    }
                }
                entry.biomes = bio.toString('base64');
            }
        }
        chunks.push(entry);
    }

    return {
        worldId: width,
        dimension: dim,
        lod: level,
        step,
        bbox: box,
        chunks,
        truncated: chunksTotal > chunks.length,
        chunksTotal,
        samplesPerSide: perSide
    };
}

/* ==================================================================
 * 调色板未登记 hash 诊断（GET /api/gis/map/palette?withUnknown=1）
 * ================================================================== */

const unknownCache = new Map(); // key → { at, value }
const UNKNOWN_CACHE_TTL = 60 * 1000;

/**
 * 扫描当前库里的 surface 数据，统计「palette 未登记」的 hash 及其样本数，便于增量补色。
 * @param {{worldId?:number|null, dimension?:string|null, limitChunks?:number}} opts
 */
async function getUnknownSurfaceStats({ worldId = null, dimension = null, limitChunks = 2000 } = {}) {
    const where = [`block_hist LIKE '%"surface":"%'`];
    const params = [];
    if (worldId) { where.push('world_id = ?'); params.push(Number(worldId)); }
    if (dimension) { where.push('dimension = ?'); params.push(String(dimension)); }
    const cacheKey = `${worldId || 'all'}:${dimension || 'all'}`;
    const hit = unknownCache.get(cacheKey);
    if (hit && Date.now() - hit.at < UNKNOWN_CACHE_TTL) return hit.value;

    const rows = await db.all(
        `SELECT chunk_x, chunk_z, block_hist FROM gis_elevation_chunks
          WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`,
        [...params, Math.min(Math.max(Number(limitChunks) || 2000, 1), 5000)]
    );
    const counts = new Map();
    let totalSamples = 0;
    let scannedChunks = 0;
    for (const row of rows) {
        let parsed;
        try { parsed = JSON.parse(row.block_hist); } catch (e) { continue; }
        if (!parsed || typeof parsed.surface !== 'string' || !parsed.surface) continue;
        scannedChunks++;
        const buf = Buffer.from(parsed.surface, 'base64');
        for (let i = 0; i + 1 < buf.length; i += 2) {
            const h = buf.readUInt16LE(i);
            if (h === NODATA_U16) continue;
            totalSamples++;
            if (palette.isKnownHash(h)) continue;
            counts.set(h, (counts.get(h) || 0) + 1);
        }
    }
    const unknownBlocks = [...counts.entries()]
        .map(([hash, count]) => ({ hash, count, hex: '0x' + hash.toString(16).toUpperCase() }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 100);
    const unknownSamples = unknownBlocks.reduce((s, x) => s + x.count, 0);
    const value = {
        scannedChunks,
        totalSamples,
        unknownSamples,
        unknownRate: totalSamples ? Math.round((unknownSamples / totalSamples) * 10000) / 10000 : 0,
        unknownBlocks,
        hint: '把 hash 补进 lib/gis/block-colors.json（或 map-palette.js 的 BLOCK_COLORS）即可，无需改客户端'
    };
    unknownCache.set(cacheKey, { at: Date.now(), value });
    return value;
}

module.exports = {
    MAP_MAX_BBOX_AREA,
    MAP_MAX_CHUNKS,
    MAP_MAX_LOD,
    getIndex,
    queryChunks,
    getUnknownSurfaceStats,
    samplesPerSide,
    parseLod,
    // 供测试使用的内部工具
    regionModeU16,
    regionMeanI16
};
