/**
 * 客户端（Minecraft 模组）上传与同步。
 *
 * 契约见 docs/gis-api.md；机器可读版本由 buildContract() 生成，
 * 测试里做契约快照（scripts/tests/gis-api-test.js）防前后端漂移。
 */

const db = require('../../database');
const { errors } = require('./errors');
const {
    CONTRACT_VERSION, DIMENSIONS, DIMENSION_CODE, LIMITS, MARKER_CATEGORIES
} = require('./constants');
const worlds = require('./worlds');
const terrain = require('./terrain');
const objects = require('./objects');
const audit = require('./audit');

const localTs = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

/** 机器可读契约（客户端启动自检用；字段与 docs/gis-api.md 一致） */
function buildContract() {
    return {
        contract: CONTRACT_VERSION,
        product: 'Xuanjian GIS',
        base: '/api/gis',
        auth: {
            type: 'oauth2_bearer',
            bearer: 'Authorization: Bearer <access_token>',
            oauth: '/api/oauth/token',
            pkce: true,
            scopes: ['read:user', 'read:member'],
            permissions: ['gis.access', 'gis.submit', 'gis.road.edit', 'gis.district.edit', 'gis.object.review', 'gis.admin']
        },
        encodings: ['zstd', 'gzip', 'deflate', 'identity'],
        limits: {
            maxChunkBatch: LIMITS.maxChunkBatch,
            maxCompressedBytes: LIMITS.maxCompressedBytes,
            maxDecompressedBytes: LIMITS.maxDecompressedBytes,
            maxSampleSize: LIMITS.maxSampleSize,
            chunkBlocks: LIMITS.chunkBlocks,
            planChunksMax: LIMITS.planChunksMax,
            uploadRatePerMinute: LIMITS.uploadRatePerMinute,
            maxBboxArea: LIMITS.maxBboxArea,
            maxObjectsPerPage: LIMITS.objectsPageMax,
            terrainSyncBboxArea: LIMITS.terrainSyncBboxArea,
            contourIntervals: require('./constants').CONTOUR_INTERVALS
        },
        dimensions: DIMENSIONS.map((d) => ({ dimension: d, code: DIMENSION_CODE[d] })),
        chunkFormat: {
            endianness: 'little',
            magic: 'XJGIS',
            version: 1,
            header: [
                { name: 'magic', type: 'u8[5]' },
                { name: 'version', type: 'u8' },
                { name: 'dimensionCode', type: 'u8' },
                { name: 'chunkCount', type: 'u8' },
                { name: 'worldId', type: 'u32' },
                { name: 'batchSeq', type: 'u64' }
            ],
            headerBytes: 20,
            chunk: [
                { name: 'chunkX', type: 'i32' },
                { name: 'chunkZ', type: 'i32' },
                { name: 'sampleStep', type: 'u8', note: '1..4' },
                { name: 'sampleSize', type: 'u8', note: '必须等于 16/sampleStep' },
                { name: 'minY', type: 'i16' },
                { name: 'maxY', type: 'i16' },
                { name: 'flags', type: 'u8', note: 'bit0=heightMatrix, bit1=biomeMatrix, bit2=blockHist' },
                { name: 'heightMatrix', type: 'i16[sampleSize*sampleSize]', note: '-32768 = 无数据（必须保留缺口，不得填 0）' },
                { name: 'biomeMatrix', type: 'u16[sampleSize*sampleSize]', optional: true, note: '0xFFFF = 未知' },
                { name: 'blockHist', type: 'u8 n, n*(u16 blockId, u32 count)', optional: true }
            ]
        },
        endpoints: {
            bootstrap: 'GET /api/gis/client/bootstrap?serverKey=',
            contract: 'GET /api/gis/client/contract',
            resolveWorld: 'POST /api/gis/client/resolve-world',
            planChunks: 'POST /api/gis/client/chunks/plan',
            uploadChunks: 'POST /api/gis/client/chunks?worldId=&dimension=',
            sync: 'GET /api/gis/client/sync?worldId=&dimension=&since=',
            objects: 'GET /api/gis/objects?worldId=&dimension=&bbox=',
            coverage: 'GET /api/gis/terrain/coverage?worldId=&dimension=&bbox=',
            height: 'GET /api/gis/terrain/height?worldId=&dimension=&x=&z='
        },
        upload: {
            contentType: 'application/octet-stream',
            contentEncodingHeader: 'Content-Encoding',
            idempotencyHeader: 'Idempotency-Key',
            idempotencyPattern: '^[A-Za-z0-9_-]{8,64}$',
            contractHeader: 'X-GIS-Contract',
            serverTokenHeader: 'X-GIS-Server-Token',
            retry: '同一批重试必须复用同一 Idempotency-Key；服务端据此返回 duplicate:true 与首次结果'
        },
        errors: {
            unauthorized: 401, forbidden: 403, not_found: 404, invalid_argument: 400,
            invalid_payload: 400, payload_too_large: 413, bbox_required: 400, bbox_too_large: 400,
            server_not_registered: 403, world_not_registered: 403, world_archived: 409,
            dimension_mismatch: 409, version_conflict: 409, rate_limited: 429,
            data_unavailable: 200, server_error: 500
        },
        markerCategories: MARKER_CATEGORIES
    };
}

/** 客户端启动引导：服务器信息 + 可写世界 + 限额 */
async function bootstrap({ serverKey }) {
    const key = String(serverKey || '').trim();
    if (!key) throw errors.invalid('缺少 serverKey 参数', 'serverKey');
    const server = await worlds.getServer(key);
    if (!server) throw errors.serverNotRegistered(`服务器 ${key} 未在玄剑 GIS 注册，本地地图可用但数据不能上传`);
    const list = await worlds.activeWorldsForServer(key);
    const uploadEnabled = list.length > 0 && server.upload_policy !== 'closed' && server.status === 'ACTIVE';
    return {
        contract: CONTRACT_VERSION,
        serverTime: localTs(),
        server: {
            serverKey: server.server_key,
            serverName: server.server_name || server.server_key,
            mcVersion: server.mc_version || '',
            uploadPolicy: server.upload_policy,
            status: server.status
        },
        // 没有 ACTIVE 世界是**合法状态**：客户端应进入本地模式（采集/HUD 可用、禁止上传）
        uploadEnabled,
        activeWorldCount: list.length,
        reason: uploadEnabled ? null : (list.length === 0 ? 'no_active_world' : (server.upload_policy === 'closed' ? 'upload_closed' : 'server_disabled')),
        localModeHint: uploadEnabled ? null : '当前没有可写的 ACTIVE 世界，客户端进入本地模式：本地采集/地图/HUD 可用，上传被禁止',
        worlds: list.map((w) => ({
            id: w.id, worldKey: w.worldKey, status: w.status, isCurrent: w.isCurrent,
            mcVersion: w.mcVersion || '', dimensions: w.dimensions.map((d) => d.dimension),
            coverage: w.dimensions.reduce((s, d) => s + (d.chunkCount || 0), 0)
        })),
        limits: buildContract().limits,
        sync: { endpoint: '/api/gis/client/sync', cursorField: 'cursor' }
    };
}

/** 校验服务器 ↔ 世界 ↔ 维度绑定 */
async function resolveWorld({ serverKey, worldId, worldKey, dimension }, ctx = {}) {
    const resolved = await worlds.resolveClientWorld({
        serverKey, worldId, worldKey, dimension, actorId: ctx.actorId, ip: ctx.ip
    });
    if (resolved.server.upload_policy === 'token' && ctx.serverToken !== resolved.server.upload_token_hash) {
        // token 策略下必须由服务器管理员下发共享密钥；hash 比对在路由层做，这里仅提示
        throw errors.forbidden('该服务器要求 X-GIS-Server-Token');
    }
    return {
        worldId: resolved.world.id,
        worldKey: resolved.world.worldKey,
        dimension: resolved.dimension,
        writable: resolved.writable,
        worldStatus: resolved.world.status
    };
}

/* ---------------- 上传限流（进程内滑动窗口） ---------------- */

const crypto = require('crypto');
/** 服务器共享上传密钥校验（upload_policy='token' 时启用） */
function serverTokenOk(server, token) {
    if (!server || !server.upload_token_hash) return false;
    if (!token) return false;
    const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const a = Buffer.from(hash);
    const b = Buffer.from(String(server.upload_token_hash));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const rateBuckets = new Map();
function checkUploadRate(userId) {
    const now = Date.now();
    const key = String(userId || 'anon');
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.start > 60000) { bucket = { start: now, count: 0 }; rateBuckets.set(key, bucket); }
    bucket.count++;
    if (rateBuckets.size > 5000) {
        for (const [k, v] of rateBuckets) if (now - v.start > 120000) rateBuckets.delete(k);
    }
    if (bucket.count > LIMITS.uploadRatePerMinute) {
        throw errors.rateLimited(`上传过于频繁（上限 ${LIMITS.uploadRatePerMinute} 次/分钟）`, 60);
    }
}

/** 批次幂等记录查询 */
async function findBatch(idempotencyKey) {
    return db.get(`SELECT * FROM gis_upload_batches WHERE idempotency_key = ?`, [String(idempotencyKey)]);
}

/**
 * 处理 chunk 上传：解压 → 校验 → 幂等 → 事务写入 → 更新覆盖范围。
 * @returns {{payload:object, duplicate:boolean}}
 */
async function uploadChunks({ rawBuffer, contentEncoding, worldId, dimension, idempotencyKey, contributorId, ip, serverToken }) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(idempotencyKey || ''))) {
        throw errors.invalid('Idempotency-Key 必须匹配 [A-Za-z0-9_-]{8,64}', 'Idempotency-Key');
    }
    const existing = await findBatch(idempotencyKey);
    if (existing) {
        let payload = null;
        try { payload = existing.response ? JSON.parse(existing.response) : null; } catch (e) { payload = null; }
        const replay = payload
            ? { ...payload, duplicate: true, replayedAt: localTs() }
            : {
                ok: true, batchId: existing.id, dimension: existing.dimension,
                accepted: existing.chunk_count, storedChunks: existing.chunk_count,
                duplicate: true, serverTime: localTs()
            };
        return { duplicate: true, payload: replay };
    }
    if (!rawBuffer || !rawBuffer.length) throw errors.invalidPayload('请求体为空');
    if (rawBuffer.length > LIMITS.maxCompressedBytes) {
        throw errors.tooLarge(`压缩后 ${rawBuffer.length} 字节，超过上限 ${LIMITS.maxCompressedBytes}`);
    }
    const wid = Number(worldId);
    if (!Number.isInteger(wid) || wid <= 0) throw errors.invalid('worldId 必须是正整数', 'worldId');
    const dim = String(dimension || '');
    // 身份/归属校验（世界必须已注册、属于其 serverKey、状态 ACTIVE、维度已登记）
    const world = await worlds.requireWorld(wid);
    const resolved = await worlds.resolveClientWorld({ serverKey: world.serverKey, worldId: wid, dimension: dim, actorId: contributorId, ip });
    if (resolved.server.upload_policy === 'token' && !serverTokenOk(resolved.server, serverToken)) {
        throw errors.forbidden('该服务器要求 X-GIS-Server-Token（由服务器管理员下发）');
    }
    const decoded = terrain.decodeBatch(rawBuffer, { contentEncoding, worldId: wid, dimension: dim });
    const batchRow = await db.run(
        `INSERT INTO gis_upload_batches
            (idempotency_key, world_id, dimension, contributor_id, chunk_count, compressed_bytes, decompressed_bytes, encoding, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        [idempotencyKey, wid, dim, contributorId || null, decoded.chunks.length, rawBuffer.length,
            decoded.decompressedBytes || rawBuffer.length, String(contentEncoding || 'identity'), localTs()]
    );
    try {
        const stored = await terrain.storeChunks(decoded, { contributorId, batchId: batchRow.id });
        const stats = await worlds.refreshDimensionStats(wid, dim);
        const payload = {
            ok: true,
            batchId: batchRow.id,
            duplicate: false,
            worldId: wid,
            dimension: dim,
            accepted: decoded.chunks.length,
            storedChunks: stored,
            coverage: { chunkCount: stats.chunkCount, bbox: stats.minX === null ? null : { minX: stats.minX, maxX: stats.maxX, minZ: stats.minZ, maxZ: stats.maxZ } },
            serverTime: localTs()
        };
        await db.run(`UPDATE gis_upload_batches SET status = 'OK', response = ? WHERE id = ?`, [JSON.stringify(payload), batchRow.id]);
        await audit.log('chunk_upload', {
            actorId: contributorId, worldId: wid, ip,
            detail: { chunks: decoded.chunks.length, bytes: rawBuffer.length, encoding: contentEncoding, batchId: batchRow.id }
        });
        return { duplicate: false, payload };
    } catch (e) {
        await db.run(`UPDATE gis_upload_batches SET status = 'FAILED' WHERE id = ?`, [batchRow.id]);
        throw e;
    }
}

/** 客户端增量同步（只下发 Published Revision） */
async function sync({ worldId, dimension, since = 0, limit = 500 }) {
    const result = await objects.syncPublished({ worldId, dimension, since, limit });
    return { ...result, serverTime: localTs(), contract: CONTRACT_VERSION };
}

module.exports = { buildContract, bootstrap, resolveWorld, uploadChunks, sync, checkUploadRate, findBatch };
