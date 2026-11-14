/**
 * 地形与等高线：真实高程 chunk 的解析/存储/采样，以及等高线、坡度、剖面、阴影、统计。
 *
 * 真实性原则（规范第十四条）：
 *  - 高程只来自客户端上传的真实区块采样；
 *  - 未采集的采样点一律视为缺失（-32768），绝不填 0 / 平均值伪造平地；
 *  - 所有分析接口都返回 missing 标记或 missingRects / missingRanges，前端必须显式画出「无数据」。
 *
 * 性能原则（2G2H）：
 *  - 计算按需 + 服务端缓存（gis_terrain_cache + 进程内 LRU），重活走 gis_jobs 异步任务；
 *  - 单次同步计算面积与采样点都有硬上限。
 */

const zlib = require('zlib');
const db = require('../../database');
const { errors } = require('./errors');
const { LIMITS, DIMENSIONS, DIMENSION_CODE, DIMENSION_FROM_CODE, CONTOUR_INTERVALS } = require('./constants');
const audit = require('./audit');

const MAGIC = 'XJGIS';
const MAGIC_BYTES = Buffer.from(MAGIC, 'ascii');
const NODATA = -32768;
const CHUNK = LIMITS.chunkBlocks;
const localTs = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

/* ============================ 二进制协议 ============================ */

/**
 * 解压上传体并按 v1 协议解析成 chunk 列表。
 * @returns {{worldId:number, dimension:string, batchSeq:bigint, chunks:Array}}
 */
function decodeBatch(rawBuffer, { contentEncoding = 'identity', worldId = null, dimension = null } = {}) {
    if (!rawBuffer || !rawBuffer.length) throw errors.invalidPayload('请求体为空');
    let buf;
    const enc = String(contentEncoding || 'identity').toLowerCase();
    try {
        if (enc === 'zstd') buf = zlib.zstdDecompressSync(rawBuffer);
        else if (enc === 'gzip' || enc === 'x-gzip') buf = zlib.gunzipSync(rawBuffer);
        else if (enc === 'deflate') buf = zlib.inflateSync(rawBuffer);
        else if (enc === 'identity' || enc === '') buf = rawBuffer;
        else throw errors.invalidPayload(`不支持的 Content-Encoding：${contentEncoding}`);
    } catch (e) {
        if (e && e.name === 'GisError') throw e;
        throw errors.invalidPayload(`解压失败：${e.message}`);
    }
    if (buf.length > LIMITS.maxDecompressedBytes) {
        throw errors.tooLarge(`解压后 ${buf.length} 字节，超过上限 ${LIMITS.maxDecompressedBytes}`);
    }
    if (buf.length < 20) throw errors.invalidPayload('载荷过短，缺少报文头');
    if (!buf.slice(0, 5).equals(MAGIC_BYTES)) throw errors.invalidPayload('magic 不是 XJGIS');
    const version = buf.readUInt8(5);
    if (version !== 1) throw errors.invalidPayload(`不支持的载荷版本 ${version}`);
    const dimensionCode = buf.readUInt8(6);
    if (dimensionCode > 3) throw errors.invalidPayload(`dimensionCode 非法：${dimensionCode}`);
    const payloadDimension = DIMENSION_FROM_CODE[dimensionCode];
    if (dimension && payloadDimension !== dimension) {
        throw errors.dimensionMismatch(`载荷维度 ${payloadDimension} 与请求维度 ${dimension} 不一致`);
    }
    const chunkCount = buf.readUInt8(7);
    if (chunkCount < 1 || chunkCount > LIMITS.maxChunkBatch) {
        throw errors.invalidPayload(`chunkCount 需在 1~${LIMITS.maxChunkBatch}，当前 ${chunkCount}`);
    }
    const payloadWorldId = buf.readUInt32LE(8);
    if (worldId !== null && worldId !== undefined && Number(worldId) !== payloadWorldId) {
        throw errors.invalidPayload('载荷 worldId 与请求 worldId 不一致');
    }
    const batchSeq = buf.readBigUInt64LE(12);

    let offset = 20;
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
        if (offset + 15 > buf.length) throw errors.invalidPayload('载荷被截断（chunk 头不完整）', { chunkIndex: i });
        const chunkX = buf.readInt32LE(offset); offset += 4;
        const chunkZ = buf.readInt32LE(offset); offset += 4;
        const sampleStep = buf.readUInt8(offset); offset += 1;
        const sampleSize = buf.readUInt8(offset); offset += 1;
        const minY = buf.readInt16LE(offset); offset += 2;
        const maxY = buf.readInt16LE(offset); offset += 2;
        const flags = buf.readUInt8(offset); offset += 1;

        if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ) || Math.abs(chunkX) > 1 << 22 || Math.abs(chunkZ) > 1 << 22) {
            throw errors.invalidPayload(`chunk 坐标非法（index ${i}）`, { chunkIndex: i });
        }
        if (sampleStep < 1 || sampleStep > 4) throw errors.invalidPayload(`sampleStep 需在 1~4（index ${i}）`, { chunkIndex: i });
        if (sampleSize !== CHUNK / sampleStep) {
            throw errors.invalidPayload(`sampleSize 必须等于 ${CHUNK}/${sampleStep}=${CHUNK / sampleStep}（index ${i}）`, { chunkIndex: i });
        }
        if (minY > maxY) throw errors.invalidPayload(`minY > maxY（index ${i}）`, { chunkIndex: i });
        const cells = sampleSize * sampleSize;

        let heights = null;
        if (flags & 1) {
            const bytes = cells * 2;
            if (offset + bytes > buf.length) throw errors.invalidPayload('载荷被截断（heightMatrix）', { chunkIndex: i });
            heights = Buffer.from(buf.slice(offset, offset + bytes));
            offset += bytes;
        } else {
            throw errors.invalidPayload(`chunk ${i} 缺少 heightMatrix（v1 必须提供真实高程）`, { chunkIndex: i });
        }
        let biome = null;
        if (flags & 2) {
            const bytes = cells * 2;
            if (offset + bytes > buf.length) throw errors.invalidPayload('载荷被截断（biomeMatrix）', { chunkIndex: i });
            biome = Buffer.from(buf.slice(offset, offset + bytes));
            offset += bytes;
        }
        let blockHist = null;
        if (flags & 4) {
            if (offset + 1 > buf.length) throw errors.invalidPayload('载荷被截断（blockHist）', { chunkIndex: i });
            const n = buf.readUInt8(offset); offset += 1;
            const entries = [];
            for (let k = 0; k < n; k++) {
                if (offset + 6 > buf.length) throw errors.invalidPayload('载荷被截断（blockHist entry）', { chunkIndex: i });
                entries.push({ blockId: buf.readUInt16LE(offset), count: buf.readUInt32LE(offset + 2) });
                offset += 6;
            }
            blockHist = entries;
        }

        // 真实高度范围与缺口统计（以矩阵实际值修正 minY/maxY，避免客户端报错值）
        let realMin = Infinity, realMax = -Infinity, gaps = 0;
        for (let k = 0; k < cells; k++) {
            const v = heights.readInt16LE(k * 2);
            if (v === NODATA) { gaps++; continue; }
            if (v < realMin) realMin = v;
            if (v > realMax) realMax = v;
        }
        if (realMin === Infinity) { realMin = NODATA; realMax = NODATA; }
        chunks.push({
            chunkX, chunkZ, sampleStep, sampleSize,
            minY: realMin === NODATA ? minY : realMin,
            maxY: realMax === NODATA ? maxY : realMax,
            heights, biome, blockHist, hasGaps: gaps > 0 ? 1 : 0
        });
    }
    if (offset !== buf.length) throw errors.invalidPayload(`载荷尾部有 ${buf.length - offset} 字节多余数据`);
    return { worldId: payloadWorldId, dimension: payloadDimension, batchSeq, decompressedBytes: buf.length, chunks };
}

/** 参考编码器（供客户端/测试对齐协议；服务端不参与上传编码） */
function encodeBatch({ worldId, dimension, batchSeq = 0n, chunks }) {
    const parts = [];
    const header = Buffer.alloc(20);
    MAGIC_BYTES.copy(header, 0);
    header.writeUInt8(1, 5);
    header.writeUInt8(DIMENSION_CODE[dimension] === undefined ? 0 : DIMENSION_CODE[dimension], 6);
    header.writeUInt8(chunks.length, 7);
    header.writeUInt32LE(worldId, 8);
    header.writeBigUInt64LE(BigInt(batchSeq), 12);
    parts.push(header);
    for (const c of chunks) {
        const sampleSize = c.sampleSize || CHUNK / (c.sampleStep || 1);
        const head = Buffer.alloc(15);
        head.writeInt32LE(c.chunkX, 0);
        head.writeInt32LE(c.chunkZ, 4);
        head.writeUInt8(c.sampleStep || 1, 8);
        head.writeUInt8(sampleSize, 9);
        head.writeInt16LE(c.minY === undefined ? -64 : c.minY, 10);
        head.writeInt16LE(c.maxY === undefined ? 320 : c.maxY, 12);
        let flags = 1;
        if (c.biome) flags |= 2;
        if (c.blockHist) flags |= 4;
        head.writeUInt8(flags, 14);
        parts.push(head);
        const cells = sampleSize * sampleSize;
        const heights = Buffer.alloc(cells * 2);
        for (let k = 0; k < cells; k++) heights.writeInt16LE(c.heights[k], k * 2);
        parts.push(heights);
        if (c.biome) {
            const biome = Buffer.alloc(cells * 2);
            for (let k = 0; k < cells; k++) biome.writeUInt16LE(c.biome[k] || 0, k * 2);
            parts.push(biome);
        }
        if (c.blockHist && c.blockHist.length) {
            const n = Math.min(c.blockHist.length, 255);
            parts.push(Buffer.from([n]));
            for (let k = 0; k < n; k++) {
                const e = Buffer.alloc(6);
                e.writeUInt16LE(c.blockHist[k].blockId, 0);
                e.writeUInt32LE(c.blockHist[k].count, 2);
                parts.push(e);
            }
        }
    }
    return Buffer.concat(parts);
}

/* ============================ 存储 ============================ */

/** 已存在哪些 chunk（断点续传） */
async function planChunks(worldId, dimension, chunks) {
    const list = Array.isArray(chunks) ? chunks : [];
    if (!list.length) throw errors.invalid('chunks 不能为空', 'chunks');
    if (list.length > LIMITS.planChunksMax) throw errors.invalid(`单次最多查询 ${LIMITS.planChunksMax} 个 chunk`, 'chunks');
    const have = [];
    const missing = [];
    for (const c of list) {
        const cx = Number(c && (c.x !== undefined ? c.x : c.chunkX));
        const cz = Number(c && (c.z !== undefined ? c.z : c.chunkZ));
        if (!Number.isInteger(cx) || !Number.isInteger(cz)) throw errors.invalid('chunk 坐标必须是整数', 'chunks');
        const row = await db.get(
            `SELECT id FROM gis_elevation_chunks WHERE world_id = ? AND dimension = ? AND chunk_x = ? AND chunk_z = ?`,
            [Number(worldId), String(dimension), cx, cz]);
        if (row) have.push({ x: cx, z: cz });
        else missing.push({ x: cx, z: cz });
    }
    return { have, missing };
}

/** 补齐 chunk 的派生字段（minY/maxY/hasGaps），保证直接调用 lib 也安全 */
function normalizeChunkForStore(c) {
    const sampleStep = Number(c.sampleStep) || 1;
    const sampleSize = Number(c.sampleSize) || CHUNK / sampleStep;
    const cells = sampleSize * sampleSize;
    let heights = c.heights;
    if (!Buffer.isBuffer(heights)) {
        const src = heights || new Array(cells).fill(NODATA);
        const buf = Buffer.alloc(cells * 2);
        for (let k = 0; k < cells; k++) {
            const v = Number(src[k]);
            buf.writeInt16LE(Number.isFinite(v) ? Math.max(-32767, Math.min(32767, Math.round(v))) : NODATA, k * 2);
        }
        heights = buf;
    }
    let minY = c.minY;
    let maxY = c.maxY;
    let hasGaps = c.hasGaps;
    if (minY === undefined || maxY === undefined || hasGaps === undefined) {
        let realMin = Infinity, realMax = -Infinity, gaps = 0;
        for (let k = 0; k < cells; k++) {
            const v = heights.readInt16LE(k * 2);
            if (v === NODATA) { gaps++; continue; }
            if (v < realMin) realMin = v;
            if (v > realMax) realMax = v;
        }
        if (realMin === Infinity) { realMin = NODATA; realMax = NODATA; }
        minY = realMin;
        maxY = realMax;
        hasGaps = gaps > 0 ? 1 : 0;
    }
    return {
        chunkX: Number(c.chunkX), chunkZ: Number(c.chunkZ), sampleStep, sampleSize,
        minY, maxY, heights,
        biome: c.biome || null,
        blockHist: c.blockHist ? (typeof c.blockHist === 'string' ? c.blockHist : JSON.stringify(c.blockHist)) : null,
        hasGaps: Number(hasGaps) ? 1 : 0
    };
}

/** 批量写入 chunk（幂等 upsert，一个事务内） */
async function storeChunks(batch, { contributorId = null, batchId = null } = {}) {
    const { worldId, dimension, chunks } = batch;
    const ts = localTs();
    let stored = 0;
    for (const raw of chunks) {
        const c = normalizeChunkForStore(raw);
        await db.run(
            `INSERT INTO gis_elevation_chunks
                (world_id, dimension, chunk_x, chunk_z, sample_step, sample_size, min_y, max_y, heights, biome, block_hist,
                 has_gaps, contributor_id, batch_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(world_id, dimension, chunk_x, chunk_z) DO UPDATE SET
                sample_step = excluded.sample_step, sample_size = excluded.sample_size,
                min_y = excluded.min_y, max_y = excluded.max_y, heights = excluded.heights,
                biome = excluded.biome, block_hist = excluded.block_hist, has_gaps = excluded.has_gaps,
                contributor_id = excluded.contributor_id, batch_id = excluded.batch_id, updated_at = excluded.updated_at`,
            [worldId, dimension, c.chunkX, c.chunkZ, c.sampleStep, c.sampleSize, c.minY, c.maxY,
                c.heights, c.biome, c.blockHist,
                c.hasGaps, contributorId, batchId, ts, ts]
        );
        stored++;
    }
    return stored;
}

/** 覆盖范围（含缺失 chunk 列表） */
async function coverage(worldId, dimension, bbox = null) {
    const where = ['world_id = ?', 'dimension = ?'];
    const params = [Number(worldId), String(dimension)];
    let box = null;
    if (bbox) {
        const geo = require('./geo');
        box = geo.parseBbox(bbox, { required: false });
        if (box) {
            // chunk 坐标范围
            const minCx = Math.floor(box.minX / CHUNK), maxCx = Math.floor((box.maxX - 1e-9) / CHUNK);
            const minCz = Math.floor(box.minZ / CHUNK), maxCz = Math.floor((box.maxZ - 1e-9) / CHUNK);
            where.push('chunk_x >= ?', 'chunk_x <= ?', 'chunk_z >= ?', 'chunk_z <= ?');
            params.push(minCx, maxCx, minCz, maxCz);
            box.chunkRange = { minCx, maxCx, minCz, maxCz };
        }
    }
    const rows = await db.all(
        `SELECT chunk_x, chunk_z, min_y, max_y, has_gaps FROM gis_elevation_chunks WHERE ${where.join(' AND ')} LIMIT 20000`, params);
    const chunks = rows.map((r) => ({ chunkX: r.chunk_x, chunkZ: r.chunk_z, minY: r.min_y, maxY: r.max_y, hasGaps: Number(r.has_gaps) === 1 }));
    let missing = [];
    let ratio = chunks.length ? 1 : 0;
    let outBbox = null;
    if (chunks.length) {
        outBbox = {
            minX: Math.min(...chunks.map((c) => c.chunkX)) * CHUNK,
            maxX: Math.max(...chunks.map((c) => c.chunkX)) * CHUNK + CHUNK,
            minZ: Math.min(...chunks.map((c) => c.chunkZ)) * CHUNK,
            maxZ: Math.max(...chunks.map((c) => c.chunkZ)) * CHUNK + CHUNK
        };
    }
    if (box) {
        const have = new Set(chunks.map((c) => `${c.chunkX}|${c.chunkZ}`));
        const r = box.chunkRange;
        const total = (r.maxCx - r.minCx + 1) * (r.maxCz - r.minCz + 1);
        // 缺失列表最多返回 5000 条（前端只需画大致范围），但覆盖率按真实总数计算
        for (let cx = r.minCx; cx <= r.maxCx && missing.length < 5000; cx++) {
            for (let cz = r.minCz; cz <= r.maxCz && missing.length < 5000; cz++) {
                if (!have.has(`${cx}|${cz}`)) missing.push({ chunkX: cx, chunkZ: cz });
            }
        }
        ratio = total ? Math.round((Math.min(chunks.length, total) / total) * 100000) / 100000 : 0;
    }
    return {
        chunks,
        missing,
        coverage: ratio,
        chunkCount: chunks.length,
        bbox: outBbox,
        hasData: chunks.length > 0,
        truncated: rows.length >= 20000
    };
}

/* ============================ 采样 ============================ */

/** 加载 bbox 范围内的 chunk 行，构建查表结构 */
async function loadChunkMap(worldId, dimension, box) {
    const minCx = Math.floor(box.minX / CHUNK), maxCx = Math.floor((box.maxX - 1e-9) / CHUNK);
    const minCz = Math.floor(box.minZ / CHUNK), maxCz = Math.floor((box.maxZ - 1e-9) / CHUNK);
    const rows = await db.all(
        `SELECT chunk_x, chunk_z, sample_step, sample_size, min_y, max_y, heights, has_gaps
           FROM gis_elevation_chunks
          WHERE world_id = ? AND dimension = ? AND chunk_x >= ? AND chunk_x <= ? AND chunk_z >= ? AND chunk_z <= ?
          LIMIT 80000`,
        [Number(worldId), String(dimension), minCx, maxCx, minCz, maxCz]
    );
    const map = new Map();
    for (const r of rows) {
        map.set(`${r.chunk_x}|${r.chunk_z}`, {
            chunkX: r.chunk_x, chunkZ: r.chunk_z, step: Number(r.sample_step) || 1,
            size: Number(r.sample_size) || CHUNK, minY: r.min_y, maxY: r.max_y,
            heights: Buffer.isBuffer(r.heights) ? r.heights : Buffer.from(r.heights || []),
            hasGaps: Number(r.has_gaps) === 1
        });
    }
    return { map, chunkRange: { minCx, maxCx, minCz, maxCz } };
}

function heightAt(chunkMap, bx, bz) {
    const cx = Math.floor(bx / CHUNK);
    const cz = Math.floor(bz / CHUNK);
    const chunk = chunkMap.get(`${cx}|${cz}`);
    if (!chunk) return null;
    const lx = bx - cx * CHUNK;
    const lz = bz - cz * CHUNK;
    const col = Math.floor(lx / chunk.step);
    const row = Math.floor(lz / chunk.step);
    if (col < 0 || row < 0 || col >= chunk.size || row >= chunk.size) return null;
    const idx = row * chunk.size + col;
    if (idx * 2 + 2 > chunk.heights.length) return null;
    const v = chunk.heights.readInt16LE(idx * 2);
    return v === NODATA ? null : v;
}

/** 单点高程查询：无数据必须返回 null + missing:true */
async function sampleHeight({ worldId, dimension, x, z }) {
    const px = Number(x), pz = Number(z);
    if (!Number.isFinite(px) || !Number.isFinite(pz)) throw errors.invalid('x/z 必须是数字', 'x');
    const bx = Math.floor(px), bz = Math.floor(pz);
    const box = { minX: bx, maxX: bx + 1, minZ: bz, maxZ: bz + 1 };
    const { map } = await loadChunkMap(worldId, dimension, box);
    const height = heightAt(map, bx, bz);
    const chunkX = Math.floor(bx / CHUNK), chunkZ = Math.floor(bz / CHUNK);
    if (height === null) {
        return { x: px, z: pz, height: null, sampled: false, missing: true, dimension, chunkX, chunkZ };
    }
    return { x: px, z: pz, height, sampled: true, missing: false, dimension, chunkX, chunkZ, chunkStep: (map.get(`${chunkX}|${chunkZ}`) || {}).step || 1 };
}

/**
 * 构建采样网格（内部计算用，最多 LIMITS.terrainMaxSamples 个采样点）。
 * @returns {{width:number,height:number,step:number,originX:number,originZ:number,
 *            values:Int16Array, missing:Uint8Array, hasData:boolean, dataCount:number}}
 */
function buildGrid(chunkMap, box, { maxSamples = LIMITS.terrainMaxSamples, minStep = 1 } = {}) {
    const spanX = Math.max(box.maxX - box.minX, 1);
    const spanZ = Math.max(box.maxZ - box.minZ, 1);
    let step = Math.max(minStep, Math.ceil(Math.sqrt((spanX * spanZ) / maxSamples)));
    const originX = Math.floor(box.minX / step) * step;
    const originZ = Math.floor(box.minZ / step) * step;
    const width = Math.floor((box.maxX - originX) / step) + 1;
    const height = Math.floor((box.maxZ - originZ) / step) + 1;
    const total = width * height;
    const values = new Int16Array(total).fill(NODATA);
    const missing = new Uint8Array(total).fill(1);
    let dataCount = 0;
    for (let rz = 0; rz < height; rz++) {
        const bz = originZ + rz * step;
        for (let rx = 0; rx < width; rx++) {
            const bx = originX + rx * step;
            const v = heightAt(chunkMap, bx, bz);
            const idx = rz * width + rx;
            if (v === null) continue;
            values[idx] = v;
            missing[idx] = 0;
            dataCount++;
        }
    }
    return { width, height, step, originX, originZ, values, missing, hasData: dataCount > 0, dataCount };
}

/** 数据指纹：用于缓存失效（覆盖范围/内容变化即失效） */
async function dataSignature(worldId, dimension, box) {
    const minCx = Math.floor(box.minX / CHUNK), maxCx = Math.floor((box.maxX - 1e-9) / CHUNK);
    const minCz = Math.floor(box.minZ / CHUNK), maxCz = Math.floor((box.maxZ - 1e-9) / CHUNK);
    const row = await db.get(
        `SELECT COUNT(*) AS c, COALESCE(MAX(updated_at),'') AS t, COALESCE(SUM(id),0) AS s
           FROM gis_elevation_chunks
          WHERE world_id = ? AND dimension = ? AND chunk_x >= ? AND chunk_x <= ? AND chunk_z >= ? AND chunk_z <= ?`,
        [Number(worldId), String(dimension), minCx, maxCx, minCz, maxCz]);
    return `${row.c}|${row.t}|${row.s}`;
}

/* ---------------- 进程内 LRU（等高线等重型结果） ---------------- */

const memoryCache = new Map();
function cacheGet(key) {
    const hit = memoryCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > 10 * 60 * 1000) { memoryCache.delete(key); return null; }
    memoryCache.delete(key);
    memoryCache.set(key, hit);
    return hit.value;
}
function cacheSet(key, value) {
    memoryCache.set(key, { at: Date.now(), value });
    while (memoryCache.size > LIMITS.contourCacheEntries) {
        const first = memoryCache.keys().next().value;
        memoryCache.delete(first);
    }
}

/* ============================ 等高线（marching squares） ============================ */

function interpolate(h1, h2, level) {
    if (h2 === h1) return 0.5;
    return (level - h1) / (h2 - h1);
}

/**
 * 在网格上生成等值线段，并串成折线。
 * @returns {{lines:Array<{level:number,coordinates:Array}>, segments:number, truncated:boolean, levels:number[]}}
 */
function marchingSquares(grid, interval, maxSegments = LIMITS.maxContourSegments) {
    const { width, height, step, originX, originZ, values, missing } = grid;
    const lines = [];
    const levelsSet = new Set();
    let segments = 0;
    let truncated = false;

    // 每个等值层收集线段，再串联
    const byLevel = new Map();
    const pushSeg = (level, x1, z1, x2, z2) => {
        if (segments >= maxSegments) { truncated = true; return; }
        segments++;
        if (!byLevel.has(level)) byLevel.set(level, []);
        byLevel.get(level).push([[originX + x1 * step, originZ + z1 * step], [originX + x2 * step, originZ + z2 * step]]);
    };

    for (let rz = 0; rz < height - 1 && !truncated; rz++) {
        for (let rx = 0; rx < width - 1; rx++) {
            const i00 = rz * width + rx;
            const i10 = i00 + 1;
            const i01 = i00 + width;
            const i11 = i01 + 1;
            if (missing[i00] || missing[i10] || missing[i01] || missing[i11]) continue;
            const h00 = values[i00], h10 = values[i10], h01 = values[i01], h11 = values[i11];
            const cellMin = Math.min(h00, h10, h01, h11);
            const cellMax = Math.max(h00, h10, h01, h11);
            if (cellMax - cellMin === 0) continue;
            const startLevel = Math.ceil(cellMin / interval) * interval;
            for (let level = startLevel; level <= cellMax; level += interval) {
                if (level <= cellMin) continue;
                levelsSet.add(level);
                // 四个角是否高于 level（注意网格行方向：rz 对应 z，rx 对应 x）
                const b00 = h00 >= level, b10 = h10 >= level, b01 = h01 >= level, b11 = h11 >= level;
                const code = (b00 ? 8 : 0) | (b10 ? 4 : 0) | (b11 ? 2 : 0) | (b01 ? 1 : 0);
                if (code === 0 || code === 15) continue;
                // 边上的插值点：T=上(x,z) 边 00-10, R=右 10-11, B=下 01-11, L=左 00-01
                const top = [rx + interpolate(h00, h10, level), rz];
                const bottom = [rx + interpolate(h01, h11, level), rz + 1];
                const left = [rx, rz + interpolate(h00, h01, level)];
                const right = [rx + 1, rz + interpolate(h10, h11, level)];
                const seg = (a, b) => pushSeg(level, a[0], a[1], b[0], b[1]);
                switch (code) {
                    case 1: case 14: seg(left, bottom); break;
                    case 2: case 13: seg(bottom, right); break;
                    case 3: case 12: seg(left, right); break;
                    case 4: case 11: seg(top, right); break;
                    case 6: case 9: seg(top, bottom); break;
                    case 7: case 8: seg(left, top); break;
                    case 5: seg(left, top); seg(bottom, right); break;
                    case 10: seg(top, right); seg(left, bottom); break;
                    default: break;
                }
                if (truncated) break;
            }
            if (truncated) break;
        }
    }

    for (const [level, segList] of byLevel.entries()) {
        for (const coords of chainSegments(segList)) {
            lines.push({ level, coordinates: coords.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]) });
        }
    }
    return { lines, segments, truncated, levels: Array.from(levelsSet).sort((a, b) => a - b) };
}

/** 把线段串成折线（端点按 0.01 精度合并） */
function chainSegments(segs) {
    const key = (p) => `${Math.round(p[0] * 100)}|${Math.round(p[1] * 100)}`;
    const adj = new Map();
    for (let i = 0; i < segs.length; i++) {
        const [a, b] = segs[i];
        for (const [from, to] of [[a, b], [b, a]]) {
            const k = key(from);
            if (!adj.has(k)) adj.set(k, []);
            adj.get(k).push({ to, idx: i });
        }
    }
    const used = new Uint8Array(segs.length);
    const out = [];
    for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        const line = [segs[i][0], segs[i][1]];
        // 向后延伸
        for (;;) {
            const last = line[line.length - 1];
            const cands = adj.get(key(last)) || [];
            const next = cands.find((c) => !used[c.idx]);
            if (!next) break;
            used[next.idx] = 1;
            line.push(next.to);
        }
        // 向前延伸
        for (;;) {
            const first = line[0];
            const cands = adj.get(key(first)) || [];
            const prev = cands.find((c) => !used[c.idx]);
            if (!prev) break;
            used[prev.idx] = 1;
            line.unshift(prev.to);
        }
        out.push(line);
    }
    return out;
}

/** 等高线接口（服务端缓存 + 按缩放调密度） */
async function contours({ worldId, dimension, bbox, interval = 10, zoom = null }) {
    const geo = require('./geo');
    const iv = Number(interval);
    if (!CONTOUR_INTERVALS.includes(iv)) {
        throw errors.invalid(`等高距只能是 ${CONTOUR_INTERVALS.join('/')} 米`, 'interval');
    }
    const box = geo.parseBbox(bbox, { maxArea: LIMITS.terrainSyncBboxArea });
    const z = Number.isFinite(Number(zoom)) ? Number(zoom) : 20;
    // 缩放级别越低，采样步长越大（密度自适应）
    let minStep = 1;
    if (z <= 1) minStep = 8;
    else if (z <= 3) minStep = 4;
    else if (z <= 5) minStep = 2;

    const sig = await dataSignature(worldId, dimension, box);
    const cacheKey = `contours|${worldId}|${dimension}|${iv}|${minStep}|${box.minX}|${box.minZ}|${box.maxX}|${box.maxZ}`;
    const mem = cacheGet(cacheKey);
    if (mem && mem.signature === sig) return { ...mem.value, cached: true };
    const dbHit = await db.get(`SELECT payload, data_signature, created_at FROM gis_terrain_cache WHERE cache_key = ?`, [cacheKey]);
    if (dbHit && dbHit.data_signature === sig) {
        const value = JSON.parse(dbHit.payload);
        cacheSet(cacheKey, { signature: sig, value });
        return { ...value, cached: true };
    }

    const { map } = await loadChunkMap(worldId, dimension, box);
    const grid = buildGrid(map, box, { minStep });
    if (!grid.hasData) {
        const empty = {
            worldId, dimension, interval: iv, bbox: box, lines: [], levels: [],
            data: { available: false, coverage: 0, dataCount: 0, missingRects: [[box.minX, box.minZ, box.maxX, box.maxZ]], generatedAt: localTs() },
            truncated: false, cached: false
        };
        return empty;
    }
    const result = marchingSquares(grid, iv);
    const missingRects = computeMissingRects(grid, box);
    const value = {
        worldId: Number(worldId), dimension, interval: iv, bbox: box,
        lines: result.lines, levels: result.levels,
        data: {
            available: true,
            coverage: grid.width * grid.height ? Math.round((grid.dataCount / (grid.width * grid.height)) * 1000) / 1000 : 0,
            dataCount: grid.dataCount,
            sampleStep: grid.step,
            missingRects,
            generatedAt: localTs()
        },
        truncated: result.truncated,
        cached: false
    };
    cacheSet(cacheKey, { signature: sig, value });
    try {
        await db.run(`INSERT INTO gis_terrain_cache (cache_key, kind, world_id, dimension, payload, data_signature, created_at)
                      VALUES (?, 'contours', ?, ?, ?, ?, ?)
                      ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, data_signature = excluded.data_signature, created_at = excluded.created_at`,
            [cacheKey, Number(worldId), String(dimension), JSON.stringify(value), sig, localTs()]);
    } catch (e) { /* 缓存失败不影响结果 */ }
    return value;
}

/** 无数据区块矩形（按 16x16 chunk 合并成矩形，供前端显式画出「无数据」） */
function computeMissingRects(grid, box) {
    const rects = [];
    const step = grid.step;
    const cellBlocks = Math.max(1, Math.floor(16 / Math.max(1, step)) * Math.max(1, step));
    const seen = new Set();
    for (let rz = 0; rz < grid.height; rz += Math.max(1, Math.ceil(cellBlocks / step))) {
        for (let rx = 0; rx < grid.width; rx += Math.max(1, Math.ceil(cellBlocks / step))) {
            const idx = rz * grid.width + rx;
            if (!grid.missing[idx]) continue;
            const wx = grid.originX + rx * step;
            const wz = grid.originZ + rz * step;
            const key = `${Math.floor(wx / cellBlocks)}|${Math.floor(wz / cellBlocks)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rects.push([wx, wz, wx + cellBlocks, wz + cellBlocks]);
            if (rects.length >= 400) return rects;
        }
    }
    void box;
    return rects;
}

/* ============================ 网格 / 坡度 / 剖面 / 阴影 / 统计 ============================ */

/** 响应型网格上限：JSON 体积受控（约 256×256） */
const RESPONSE_MAX_SAMPLES = 65536;

async function gridData({ worldId, dimension, bbox, resolution = null, maxSamples = RESPONSE_MAX_SAMPLES }) {
    const geo = require('./geo');
    const box = geo.parseBbox(bbox, { maxArea: LIMITS.terrainSyncBboxArea });
    const minStep = Number(resolution) > 0 ? Math.max(1, Math.floor(Number(resolution))) : 1;
    const { map } = await loadChunkMap(worldId, dimension, box);
    const grid = buildGrid(map, box, { minStep, maxSamples });
    return { box, grid };
}

async function terrainGrid(opts) {
    const { box, grid } = await gridData(opts);
    const heights = new Array(grid.width * grid.height);
    for (let i = 0; i < heights.length; i++) heights[i] = grid.missing[i] ? null : grid.values[i];
    return {
        bbox: box,
        origin: { x: grid.originX, z: grid.originZ },
        width: grid.width, height: grid.height, step: grid.step,
        heights,
        missing: Array.from(grid.missing),
        hasData: grid.hasData,
        dataCount: grid.dataCount,
        nodataValue: NODATA
    };
}

async function slopeAnalysis(opts) {
    const { box, grid } = await gridData(opts);
    const degree = new Array(grid.width * grid.height).fill(null);
    const step = grid.step;
    let min = Infinity, max = -Infinity, sum = 0, count = 0;
    for (let rz = 0; rz < grid.height; rz++) {
        for (let rx = 0; rx < grid.width; rx++) {
            const idx = rz * grid.width + rx;
            if (grid.missing[idx]) continue;
            const hx1 = rx > 0 ? grid.values[idx - 1] : null;
            const hx2 = rx < grid.width - 1 ? grid.values[idx + 1] : null;
            const hz1 = rz > 0 ? grid.values[idx - grid.width] : null;
            const hz2 = rz < grid.height - 1 ? grid.values[idx + grid.width] : null;
            const missH = (v) => v === null || v === undefined || v === NODATA;
            const dx = (!missH(hx1) && !missH(hx2)) ? (hx2 - hx1) / (2 * step) : (!missH(hx2) ? (hx2 - grid.values[idx]) / step : (!missH(hx1) ? (grid.values[idx] - hx1) / step : null));
            const dz = (!missH(hz1) && !missH(hz2)) ? (hz2 - hz1) / (2 * step) : (!missH(hz2) ? (hz2 - grid.values[idx]) / step : (!missH(hz1) ? (grid.values[idx] - hz1) / step : null));
            if (dx === null || dz === null) continue;
            const deg = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
            degree[idx] = Math.round(deg * 100) / 100;
            if (deg < min) min = deg;
            if (deg > max) max = deg;
            sum += deg; count++;
        }
    }
    return {
        bbox: box, width: grid.width, height: grid.height, step: grid.step,
        origin: { x: grid.originX, z: grid.originZ },
        degree,
        min: count ? Math.round(min * 100) / 100 : null,
        max: count ? Math.round(max * 100) / 100 : null,
        mean: count ? Math.round((sum / count) * 100) / 100 : null,
        count, hasData: count > 0
    };
}

async function hillshade(opts) {
    const azimuth = Number(opts.azimuth);
    const altitude = Number(opts.altitude);
    const az = Number.isFinite(azimuth) ? azimuth : 315;
    const alt = Number.isFinite(altitude) ? altitude : 45;
    const { box, grid } = await gridData(opts);
    const intensity = new Array(grid.width * grid.height).fill(null);
    const azRad = (az * Math.PI) / 180;
    const altRad = (alt * Math.PI) / 180;
    const step = grid.step;
    for (let rz = 0; rz < grid.height; rz++) {
        for (let rx = 0; rx < grid.width; rx++) {
            const idx = rz * grid.width + rx;
            if (grid.missing[idx]) continue;
            const hx2 = rx < grid.width - 1 && !grid.missing[idx + 1] ? grid.values[idx + 1] : grid.values[idx];
            const hx1 = rx > 0 && !grid.missing[idx - 1] ? grid.values[idx - 1] : grid.values[idx];
            const hz2 = rz < grid.height - 1 && !grid.missing[idx + grid.width] ? grid.values[idx + grid.width] : grid.values[idx];
            const hz1 = rz > 0 && !grid.missing[idx - grid.width] ? grid.values[idx - grid.width] : grid.values[idx];
            const dzdx = (hx2 - hx1) / (2 * step);
            const dzdz = (hz2 - hz1) / (2 * step);
            const slopeRad = Math.atan(Math.hypot(dzdx, dzdz));
            const aspect = Math.atan2(dzdz, -dzdx);
            const shade = Math.cos(altRad) * Math.cos(slopeRad) + Math.sin(altRad) * Math.sin(slopeRad) * Math.cos(azRad - aspect);
            intensity[idx] = Math.max(0, Math.min(255, Math.round(shade * 255)));
        }
    }
    return {
        bbox: box, width: grid.width, height: grid.height, step: grid.step,
        origin: { x: grid.originX, z: grid.originZ },
        azimuth: az, altitude: alt,
        intensity, hasData: grid.hasData
    };
}

/** 剖面：沿折线等距采样，缺失段用 null + missingRanges 显式标记 */
async function profileAnalysis({ worldId, dimension, points, samples = 100 }) {
    const geo = require('./geo');
    const list = Array.isArray(points) ? points : null;
    if (!list || list.length < 2) throw errors.invalid('points 至少需要 2 个 [x,z] 点', 'points');
    if (list.length > 32) throw errors.invalid('剖面折线最多 32 个点', 'points');
    let total = 0;
    const pts = list.map((p) => {
        if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(Number(p[0])) || !Number.isFinite(Number(p[1]))) {
            throw errors.invalid('points 每项必须是 [x,z] 数字对', 'points');
        }
        return [Number(p[0]), Number(p[1])];
    });
    for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (total <= 0) throw errors.invalid('剖面长度必须大于 0', 'points');
    const n = Math.min(Math.max(Number(samples) || 100, 2), 512);
    if (total > 20000) throw errors.invalid('剖面长度上限 20000 方块', 'points');

    const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
    const minZ = Math.min(...pts.map((p) => p[1])), maxZ = Math.max(...pts.map((p) => p[1]));
    const box = { minX, maxX: Math.max(maxX, minX + 1), minZ, maxZ: Math.max(maxZ, minZ + 1) };
    if (geo.bboxArea(box) > LIMITS.terrainStatsBboxArea) throw errors.bboxTooLarge('剖面范围过大');
    const { map } = await loadChunkMap(worldId, dimension, box);

    const samplePoints = [];
    for (let i = 0; i < n; i++) {
        const d = (i / (n - 1)) * total;
        let remaining = d;
        let x = pts[0][0], z = pts[0][1];
        for (let k = 0; k < pts.length - 1; k++) {
            const segLen = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
            if (remaining <= segLen || k === pts.length - 2) {
                const t = segLen > 0 ? Math.min(1, remaining / segLen) : 0;
                x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t;
                z = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t;
                break;
            }
            remaining -= segLen;
        }
        const h = heightAt(map, Math.floor(x), Math.floor(z));
        samplePoints.push({ distance: Math.round(d * 100) / 100, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, height: h, hasData: h !== null });
    }
    const missingRanges = [];
    let start = null;
    for (let i = 0; i < samplePoints.length; i++) {
        if (!samplePoints[i].hasData) { if (start === null) start = samplePoints[i].distance; }
        else if (start !== null) { missingRanges.push([start, samplePoints[i - 1].distance]); start = null; }
    }
    if (start !== null) missingRanges.push([start, samplePoints[samplePoints.length - 1].distance]);
    const heights = samplePoints.filter((p) => p.hasData).map((p) => p.height);
    return {
        points: pts, length: Math.round(total * 100) / 100, samples: samplePoints,
        min: heights.length ? Math.min(...heights) : null,
        max: heights.length ? Math.max(...heights) : null,
        hasData: heights.length > 0,
        missingRanges
    };
}

/** 高程分布直方图 */
async function distribution({ worldId, dimension, bbox, bucket = 5 }) {
    const geo = require('./geo');
    const box = geo.parseBbox(bbox, { maxArea: LIMITS.terrainStatsBboxArea });
    const { map } = await loadChunkMap(worldId, dimension, box);
    const grid = buildGrid(map, box, { maxSamples: LIMITS.terrainMaxSamples });
    const b = Math.max(1, Number(bucket) || 5);
    const bins = new Map();
    let min = Infinity, max = -Infinity, count = 0;
    for (let i = 0; i < grid.values.length; i++) {
        if (grid.missing[i]) continue;
        const v = grid.values[i];
        count++;
        if (v < min) min = v;
        if (v > max) max = v;
        const key = Math.floor(v / b) * b;
        bins.set(key, (bins.get(key) || 0) + 1);
    }
    const list = Array.from(bins.entries()).map(([from, c]) => ({ from, to: from + b, count: c })).sort((a, c) => a.from - c.from);
    return {
        bbox: box, bucket: b, bins: list,
        min: count ? min : null, max: count ? max : null,
        mean: count ? Math.round((list.reduce((s, x) => s + (x.from + b / 2) * x.count, 0) / count) * 100) / 100 : null,
        sampleCount: count, hasData: count > 0,
        missingSamples: grid.values.length - count
    };
}

/** 区域高程统计 */
async function stats({ worldId, dimension, bbox }) {
    const geo = require('./geo');
    const box = geo.parseBbox(bbox, { maxArea: LIMITS.terrainStatsBboxArea });
    const { map } = await loadChunkMap(worldId, dimension, box);
    const grid = buildGrid(map, box, { maxSamples: LIMITS.terrainMaxSamples });
    const vals = [];
    for (let i = 0; i < grid.values.length; i++) if (!grid.missing[i]) vals.push(grid.values[i]);
    if (!vals.length) {
        return {
            bbox: box, hasData: false, count: 0, min: null, max: null, mean: null, p50: null, p90: null, stdev: null,
            coverage: 0, sampleCount: grid.values.length, missingSamples: grid.values.length, sampleStep: grid.step
        };
    }
    vals.sort((a, b) => a - b);
    const sum = vals.reduce((s, v) => s + v, 0);
    const mean = sum / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length;
    const pick = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * (vals.length - 1))))];
    return {
        bbox: box, hasData: true, count: vals.length,
        min: vals[0], max: vals[vals.length - 1],
        mean: Math.round(mean * 100) / 100,
        p50: pick(0.5), p90: pick(0.9),
        stdev: Math.round(Math.sqrt(variance) * 100) / 100,
        coverage: Math.round((vals.length / grid.values.length) * 1000) / 1000,
        sampleCount: grid.values.length,
        missingSamples: grid.values.length - vals.length,
        sampleStep: grid.step
    };
}

/** 写入审计（上传） */
async function auditUpload(entry) {
    return audit.log('chunk_upload', entry);
}

module.exports = {
    MAGIC, NODATA, CHUNK,
    decodeBatch, encodeBatch,
    planChunks, storeChunks, coverage, loadChunkMap, heightAt,
    sampleHeight, buildGrid, dataSignature,
    contours, marchingSquares,
    terrainGrid, slopeAnalysis, profileAnalysis, distribution, stats, hillshade,
    cacheGet, cacheSet, auditUpload
};
