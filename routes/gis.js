/**
 * 玄剑 GIS API（/api/gis）。
 *
 * 契约：[docs/gis-api.md](../docs/gis-api.md)；机器可读版本：GET /api/gis/client/contract。
 *
 * 安全约定（规范第十九条）：
 *  - 所有写接口后端鉴权，前端隐藏按钮不算安全控制；
 *  - 上传校验 OAuth 身份 / 服务器注册 / 世界归属 / worldKey / Dimension / 尺寸格式 / 幂等键；
 *  - bbox 必填 + 面积上限，严禁一次性返回整个世界；
 *  - 地形计算有 bbox/采样上限，重活走异步任务。
 */

const express = require('express');
const router = express.Router();

const gis = require('../lib/gis');
const { constants, errors, geo, worlds, objects, terrain, history, places, jobs, client, audit } = gis;
const { map, mapPalette } = gis;
const { LIMITS, PERMISSIONS, DIMENSIONS, MARKER_CATEGORIES, MARKER_CATEGORY_LABEL, CONTOUR_INTERVALS, OBJECT_TYPES, DIMENSION_LABEL } = constants;
const { wrap } = errors;

// 鉴权：统一走 middleware/auth（内部转发 lib/permissions 的实时权限计算，自洽鉴权）
const { requirePermission, optionalAuthMiddleware } = require('../middleware/auth');
const { hasPermission } = require('../lib/permissions');

const EDIT_PERM = { marker: PERMISSIONS.submit, road: PERMISSIONS.roadEdit, district: PERMISSIONS.districtEdit };
const TYPE_LABEL = { marker: 'Marker', road: '道路', district: '城区' };
const optionalAuth = optionalAuthMiddleware;

// 每种对象类型的编辑权限中间件（预构建，避免每请求 new）
const TYPE_PERM_MIDDLEWARE = {
    marker: requirePermission(PERMISSIONS.submit),
    road: requirePermission(PERMISSIONS.roadEdit),
    district: requirePermission(PERMISSIONS.districtEdit)
};

/** 按 :type 取编辑权限的中间件（自洽鉴权，无需先挂 authMiddleware） */
function requireTypePermission(req, res, next) {
    const mw = TYPE_PERM_MIDDLEWARE[req.params.type];
    if (!mw) return res.status(400).json({ ok: false, error: 'invalid_argument', message: '对象类型只能是 district/road/marker' });
    return mw(req, res, next);
}

function ctxOf(req, extra = {}) {
    return {
        actorId: req.userId || null,
        ip: audit.clientIp(req),
        note: extra.note || (req.body && req.body.note) || '',
        isEditor: extra.isEditor === true,
        ...extra
    };
}

/* ==================================================================
 * 元信息 / 配置
 * ================================================================== */

/** GIS 前端初始化配置（公开） */
router.get('/config', wrap(async (req, res) => {
    const servers = await worlds.listServers();
    const dims = DIMENSIONS.map((d) => ({ key: d, label: DIMENSION_LABEL[d] }));
    res.json({
        ok: true,
        contract: constants.CONTRACT_VERSION,
        dimensions: dims,
        servers: servers.map((s) => ({ serverKey: s.server_key, serverName: s.server_name, uploadPolicy: s.upload_policy, status: s.status })),
        markerCategories: MARKER_CATEGORIES.map((k) => ({ key: k, label: MARKER_CATEGORY_LABEL[k] })),
        objectTypes: OBJECT_TYPES,
        contourIntervals: CONTOUR_INTERVALS,
        limits: {
            maxBboxArea: LIMITS.maxBboxArea,
            objectsPageMax: LIMITS.objectsPageMax,
            terrainSyncBboxArea: LIMITS.terrainSyncBboxArea,
            terrainStatsBboxArea: LIMITS.terrainStatsBboxArea,
            maxGeometryPoints: LIMITS.maxGeometryPoints
        }
    });
}));

/** 客户端契约（公开，机器可读；测试里有契约快照防漂移） */
router.get('/client/contract', (req, res) => {
    res.json({ ok: true, ...client.buildContract() });
});

/* ==================================================================
 * World Registry（读公开 / 写管理员）
 * ================================================================== */

router.get('/worlds', wrap(async (req, res) => {
    const list = await worlds.listWorlds({ status: req.query.status, serverKey: req.query.serverKey });
    res.json({ ok: true, worlds: list });
}));

router.get('/worlds/:id', wrap(async (req, res) => {
    const world = await worlds.requireWorld(geo.parseId(req.params.id, 'id'));
    res.json({ ok: true, world });
}));

router.get('/servers', wrap(async (req, res) => {
    res.json({ ok: true, servers: await worlds.listServers() });
}));

/* ---------------- 管理台：服务器 / 世界 ---------------- */

router.get('/admin/servers', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    res.json({ ok: true, servers: await worlds.listServers() });
}));

router.post('/admin/servers', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const server = await worlds.registerServer({
        serverKey: req.body.serverKey, serverName: req.body.serverName, mcVersion: req.body.mcVersion,
        uploadPolicy: req.body.uploadPolicy, description: req.body.description, actorId: req.userId
    });
    res.json({ ok: true, server });
}));

router.get('/admin/worlds', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const list = await worlds.listWorlds({ status: req.query.status, serverKey: req.query.serverKey });
    res.json({ ok: true, worlds: list });
}));

router.post('/admin/worlds', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const world = await worlds.registerWorld({
        worldKey: req.body.worldKey, serverKey: req.body.serverKey, serverName: req.body.serverName,
        mcVersion: req.body.mcVersion, status: req.body.status, description: req.body.description, actorId: req.userId
    });
    res.status(201).json({ ok: true, world });
}));

router.put('/admin/worlds/:id', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const world = await worlds.updateWorld(geo.parseId(req.params.id, 'id'), req.body || {}, req.userId);
    res.json({ ok: true, world });
}));

/** 归档某服务器的旧世界（旧服世界归档，新世界成为当前） */
router.post('/admin/servers/:serverKey/archive-worlds', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const keep = req.body && req.body.keepWorldId ? Number(req.body.keepWorldId) : 0;
    const archived = await worlds.archiveServerWorlds(String(req.params.serverKey), keep, req.userId);
    res.json({ ok: true, archived });
}));

/** 管理台统计 */
router.get('/admin/stats', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const worldRows = await worlds.listWorlds({});
    const perWorld = [];
    for (const w of worldRows) {
        const counts = { worldId: w.id, worldKey: w.worldKey, serverKey: w.serverKey, status: w.status };
        for (const t of OBJECT_TYPES) {
            const table = objects.TABLES[t].table;
            const row = await require('../database').get(
                `SELECT COUNT(*) AS c, SUM(CASE WHEN status='PUBLISHED' THEN 1 ELSE 0 END) AS pub,
                        SUM(CASE WHEN status='REVIEW' THEN 1 ELSE 0 END) AS review
                   FROM ${table} WHERE world_id = ?`, [w.id]);
            counts[t] = { total: Number(row.c) || 0, published: Number(row.pub) || 0, review: Number(row.review) || 0 };
        }
        const chunks = await require('../database').get(
            `SELECT COUNT(*) AS c FROM gis_elevation_chunks WHERE world_id = ?`, [w.id]);
        counts.elevationChunks = Number(chunks.c) || 0;
        perWorld.push(counts);
    }
    const reviewPending = await objects.reviewQueue({ status: 'REVIEW', limit: 200 });
    const dbFile = require('fs');
    let dbSize = 0;
    try {
        dbSize = dbFile.statSync(require('path').join(__dirname, '..', 'data', 'guild.db')).size;
    } catch (e) { /* ignore */ }
    res.json({
        ok: true,
        worlds: perWorld,
        reviewPending: reviewPending.total,
        servers: (await worlds.listServers()).length,
        dbSize,
        jobs: await jobs.listJobs({ limit: 10 })
    });
}));

router.get('/admin/audit', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const lim = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const rows = await require('../database').all(
        `SELECT id, event, actor_id, world_id, object_type, object_id, ip, detail, created_at
           FROM gis_audit ORDER BY id DESC LIMIT ?`, [lim]);
    res.json({ ok: true, items: rows });
}));

/* ==================================================================
 * 客户端（Minecraft 模组）
 * ================================================================== */

// 客户端引导只需要「提交数据」资格（gis.submit）：普通成员（Level 0 基础权限）即可启动采集/上传客户端，
// 不需要 gis.access（那是对管理数据的访问）。
router.get('/client/bootstrap', requirePermission(PERMISSIONS.submit), wrap(async (req, res) => {
    const data = await client.bootstrap({ serverKey: req.query.serverKey });
    res.json({ ok: true, ...data });
}));

router.post('/client/resolve-world', requirePermission(PERMISSIONS.submit), wrap(async (req, res) => {
    const data = await client.resolveWorld({
        serverKey: req.body.serverKey,
        worldId: req.body.worldId,
        worldKey: req.body.worldKey,
        dimension: req.body.dimension
    }, ctxOf(req));
    res.json({ ok: true, ...data });
}));

router.post('/client/chunks/plan', requirePermission(PERMISSIONS.submit), wrap(async (req, res) => {
    const worldId = geo.parseId(req.body.worldId, 'worldId');
    const dimension = String(req.body.dimension || '');
    const world = await worlds.requireWorld(worldId);
    if (world.status !== 'ACTIVE') throw errors.worldArchived();
    const plan = await terrain.planChunks(worldId, dimension, req.body.chunks);
    const cov = await terrain.coverage(worldId, dimension);
    res.json({
        ok: true, have: plan.have, missing: plan.missing,
        coverage: { chunkCount: cov.chunkCount, bbox: cov.bbox }
    });
}));

/**
 * 读取原始请求体（客户端上传是压缩二进制，不能走 express.json/raw：
 * body-parser 不认识 zstd，会 415）。
 */
function readRawBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let done = false;
        req.on('data', (chunk) => {
            if (done) return;
            total += chunk.length;
            if (total > limit) {
                done = true;
                req.resume();
                reject(errors.tooLarge(`请求体超过上限 ${limit} 字节`));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
        req.on('error', (e) => { if (!done) { done = true; reject(e); } });
    });
}

router.post('/client/chunks',
    requirePermission(PERMISSIONS.submit),
    wrap(async (req, res) => {
        if (req.headers['x-gis-contract'] && String(req.headers['x-gis-contract']) !== String(constants.CONTRACT_VERSION)) {
            throw errors.invalid(`客户端契约版本 ${req.headers['x-gis-contract']} 与服务端 ${constants.CONTRACT_VERSION} 不一致，请更新模组`, 'X-GIS-Contract');
        }
        client.checkUploadRate(req.userId);
        const raw = await readRawBody(req, LIMITS.maxCompressedBytes);
        const result = await client.uploadChunks({
            rawBuffer: raw,
            contentEncoding: req.headers['content-encoding'] || 'identity',
            worldId: req.query.worldId,
            dimension: req.query.dimension,
            idempotencyKey: req.headers['idempotency-key'],
            contributorId: req.userId,
            ip: audit.clientIp(req),
            serverToken: req.headers['x-gis-server-token']
        });
        res.json(result.payload);
    })
);

router.get('/client/sync', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    const worldId = geo.parseId(req.query.worldId, 'worldId');
    const dimension = String(req.query.dimension || '');
    if (!DIMENSIONS.includes(dimension)) throw errors.invalid('dimension 不合法', 'dimension');
    const data = await client.sync({ worldId, dimension, since: req.query.since, limit: req.query.limit });
    res.json({ ok: true, ...data });
}));

/* ==================================================================
 * GIS 对象（读：公开已发布；写：按类型权限）
 * ================================================================== */

/** 可视区域对象（bbox 必填，分页） */
router.get('/objects', optionalAuth, wrap(async (req, res) => {
    const result = await objects.queryPublished({
        worldId: req.query.worldId,
        dimension: req.query.dimension,
        bbox: req.query.bbox,
        types: req.query.types,
        limit: req.query.limit,
        cursor: req.query.cursor,
        zoom: req.query.zoom,
        detail: String(req.query.detail || '') === '1'
    });
    res.json({ ok: true, revision: result.nextCursor ? null : 0, ...result, serverTime: worlds.localTs() });
}));

/** 对象详情：优先已发布版本；有权限时附工作副本信息 */
router.get('/objects/:type/:id', optionalAuth, wrap(async (req, res) => {
    const type = String(req.params.type);
    const id = geo.parseId(req.params.id, 'id');
    if (!EDIT_PERM[type]) throw errors.invalid('type 只能是 district/road/marker', 'type');
    const published = await objects.getPublished(type, id);
    const canRead = req.userId ? await hasPermission(req, PERMISSIONS.access) : false;
    const working = canRead ? await objects.getWorking(type, id) : null;
    if (!published && !working) throw errors.notFound('GIS 对象不存在或未发布');
    if (!published && working && working.status === 'REVIEW') {
        const canReview = req.userId ? await hasPermission(req, PERMISSIONS.review) : false;
        if (!canReview) throw errors.notFound('该对象尚未发布');
    }
    res.json({ ok: true, object: published || working, published: !!published, working });
}));

/** 版本历史 */
router.get('/objects/:type/:id/revisions', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    const type = String(req.params.type);
    if (!EDIT_PERM[type]) throw errors.invalid('type 只能是 district/road/marker', 'type');
    const data = await objects.listRevisions(type, geo.parseId(req.params.id, 'id'), { limit: req.query.limit, page: req.query.page });
    res.json({ ok: true, ...data });
}));

router.get('/objects/:type/:id/revisions/:rev', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    const type = String(req.params.type);
    if (!EDIT_PERM[type]) throw errors.invalid('type 只能是 district/road/marker', 'type');
    const data = await objects.getRevision(type, geo.parseId(req.params.id, 'id'), geo.parseId(req.params.rev, 'rev'));
    res.json({ ok: true, revision: data });
}));

/** 创建对象（Marker=玩家提交，道路/城区=编辑员绘制） */
router.post('/objects/:type', requireTypePermission, wrap(async (req, res) => {
    const type = String(req.params.type);
    const isEditor = (await hasPermission(req, PERMISSIONS.review))
        || (await hasPermission(req, PERMISSIONS.roadEdit))
        || (await hasPermission(req, PERMISSIONS.districtEdit))
        || (await hasPermission(req, PERMISSIONS.admin));
    const created = await objects.create(type, req.body || {}, ctxOf(req, { isEditor }));
    res.status(201).json({ ok: true, object: created, status: created.status });
}));

router.put('/objects/:type/:id', requireTypePermission, wrap(async (req, res) => {
    const updated = await objects.update(String(req.params.type), geo.parseId(req.params.id, 'id'), req.body || {}, ctxOf(req));
    res.json({ ok: true, object: updated });
}));

router.post('/objects/:type/:id/submit', requireTypePermission, wrap(async (req, res) => {
    const object = await objects.submit(String(req.params.type), geo.parseId(req.params.id, 'id'), ctxOf(req));
    res.json({ ok: true, object });
}));

router.post('/objects/:type/:id/publish', requirePermission(PERMISSIONS.review), wrap(async (req, res) => {
    const object = await objects.publish(String(req.params.type), geo.parseId(req.params.id, 'id'), ctxOf(req));
    res.json({ ok: true, object });
}));

router.post('/objects/:type/:id/reject', requirePermission(PERMISSIONS.review), wrap(async (req, res) => {
    const object = await objects.reject(String(req.params.type), geo.parseId(req.params.id, 'id'), ctxOf(req));
    res.json({ ok: true, object });
}));

router.post('/objects/:type/:id/rollback', requirePermission(PERMISSIONS.review), wrap(async (req, res) => {
    const object = await objects.rollback(
        String(req.params.type), geo.parseId(req.params.id, 'id'),
        geo.parseId(req.body.revision, 'revision'), ctxOf(req));
    res.json({ ok: true, object });
}));

router.delete('/objects/:type/:id', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const object = await objects.archive(String(req.params.type), geo.parseId(req.params.id, 'id'), ctxOf(req));
    res.json({ ok: true, object });
}));

/** Wiki 关联（只存 wikiPageId，不复制正文；传 null 解除） */
router.post('/objects/:type/:id/wiki', requireTypePermission, wrap(async (req, res) => {
    const object = await objects.setWiki(
        String(req.params.type), geo.parseId(req.params.id, 'id'),
        req.body.wikiPageId === undefined ? null : req.body.wikiPageId, ctxOf(req));
    res.json({ ok: true, object });
}));

/** 待审队列 */
router.get('/review/queue', requirePermission(PERMISSIONS.review), wrap(async (req, res) => {
    const data = await objects.reviewQueue({
        status: req.query.status || 'REVIEW',
        worldId: req.query.worldId || null,
        type: req.query.type || null,
        limit: req.query.limit,
        page: req.query.page
    });
    res.json({ ok: true, ...data });
}));

/** Wiki 反链：某 Wiki 页面关联的 GIS 对象 */
router.get('/wiki/:wikiPageId/objects', optionalAuth, wrap(async (req, res) => {
    const items = await objects.objectsByWiki(geo.parseId(req.params.wikiPageId, 'wikiPageId'));
    res.json({ ok: true, items, total: items.length });
}));

/** 空间+文本搜索 */
router.get('/search', optionalAuth, wrap(async (req, res) => {
    const data = await objects.searchPublished({
        q: req.query.q, worldId: req.query.worldId, dimension: req.query.dimension,
        bbox: req.query.bbox, category: req.query.category, limit: req.query.limit
    });
    res.json({ ok: true, ...data });
}));

/** 点位归属（城区/道路/附近 Marker） */
router.get('/place', wrap(async (req, res) => {
    const data = await objects.placeAt({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension,
        x: req.query.x, z: req.query.z
    });
    res.json({ ok: true, ...data, dimension: req.query.dimension });
}));

router.get('/nearby', wrap(async (req, res) => {
    const data = await objects.nearby({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension,
        x: req.query.x, z: req.query.z,
        radius: req.query.radius, limit: req.query.limit
    });
    res.json({ ok: true, ...data });
}));

/* ==================================================================
 * 地形 / 等高线（公开读；重活异步）
 * ================================================================== */

router.get('/terrain/coverage', wrap(async (req, res) => {
    const data = await terrain.coverage(geo.parseId(req.query.worldId, 'worldId'), req.query.dimension, req.query.bbox);
    res.json({ ok: true, worldId: Number(req.query.worldId), dimension: req.query.dimension, ...data });
}));

router.get('/terrain/height', wrap(async (req, res) => {
    const data = await terrain.sampleHeight({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension, x: req.query.x, z: req.query.z
    });
    res.json({ ok: true, ...data, dataUnavailable: data.missing });
}));

router.get('/terrain/contours', wrap(async (req, res) => {
    const data = await terrain.contours({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension, bbox: req.query.bbox,
        interval: req.query.interval, zoom: req.query.zoom
    });
    res.json({ ok: true, ...data });
}));

router.get('/terrain/grid', wrap(async (req, res) => {
    const data = await terrain.terrainGrid({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension, bbox: req.query.bbox, resolution: req.query.resolution
    });
    res.json({ ok: true, ...data });
}));

router.get('/terrain/slope', wrap(async (req, res) => {
    const data = await terrain.slopeAnalysis({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension, bbox: req.query.bbox, resolution: req.query.resolution
    });
    res.json({ ok: true, ...data });
}));

router.get('/terrain/hillshade', wrap(async (req, res) => {
    const data = await terrain.hillshade({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension, bbox: req.query.bbox, resolution: req.query.resolution,
        azimuth: req.query.azimuth, altitude: req.query.altitude
    });
    res.json({ ok: true, ...data });
}));

router.get('/terrain/profile', wrap(async (req, res) => {
    let points = req.query.points;
    if (typeof points === 'string') {
        try { points = JSON.parse(points); } catch (e) { points = null; }
    }
    if (!points && req.query.x1 !== undefined) {
        points = [[Number(req.query.x1), Number(req.query.z1)], [Number(req.query.x2), Number(req.query.z2)]];
    }
    const data = await terrain.profileAnalysis({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension, points, samples: req.query.samples
    });
    res.json({ ok: true, ...data });
}));

router.get('/terrain/distribution', wrap(async (req, res) => {
    const data = await terrain.distribution({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension, bbox: req.query.bbox, bucket: req.query.bucket
    });
    res.json({ ok: true, ...data });
}));

router.get('/terrain/stats', wrap(async (req, res) => {
    const data = await terrain.stats({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension, bbox: req.query.bbox
    });
    res.json({ ok: true, ...data });
}));

/** 异步地形任务（等高线预热 / 区域统计） */
router.post('/terrain/jobs', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    const kind = String(req.body.kind || '');
    if (!['contour-prewarm', 'terrain-stats'].includes(kind)) throw errors.invalid('kind 只能是 contour-prewarm / terrain-stats', 'kind');
    geo.parseBbox(req.body.bbox, { maxArea: LIMITS.terrainStatsBboxArea });
    const job = await jobs.enqueue({
        kind,
        worldId: geo.parseId(req.body.worldId, 'worldId'),
        dimension: req.body.dimension || 'overworld',
        params: { worldId: Number(req.body.worldId), dimension: req.body.dimension || 'overworld', bbox: req.body.bbox, interval: req.body.interval || 10, zoom: req.body.zoom || 20 },
        actorId: req.userId
    });
    res.status(202).json({ ok: true, job });
}));

router.get('/jobs', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    res.json({ ok: true, items: await jobs.listJobs({ status: req.query.status, limit: req.query.limit }) });
}));

router.get('/jobs/:id', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    res.json({ ok: true, job: await jobs.getJob(geo.parseId(req.params.id, 'id')) });
}));

/* ==================================================================
 * 方块彩色地图数据（浏览器端渲染，服务端只出数据、不做任何图片编码）
 * 契约：docs/gis-canvas-map.md
 * ================================================================== */

/** 调色板：hash16 → 颜色 / 水面 / 群系兜底 / 高度色带（公开读，可长缓存） */
router.get('/map/palette', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('ETag', `W/"gis-palette-v${mapPalette.PALETTE_VERSION}"`);
    res.json({ ok: true, ...mapPalette.getPalette() });
});

/** 视野区块数据：bbox 必填 + lod 抽样；只返回已采集区块，未采集透明 */
router.get('/map/chunks', wrap(async (req, res) => {
    const worldId = geo.parseId(req.query.worldId, 'worldId');
    const dimension = String(req.query.dimension || '');
    const data = await map.queryChunks({
        worldId, dimension, bbox: req.query.bbox, lod: req.query.lod
    });
    // 浏览器端渲染，数据随覆盖度变化；短缓存便于平移复用
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ ok: true, ...data, serverTime: worlds.localTs() });
}));

/** 覆盖度索引：判断方块底图是否可用（该维度 chunkCount=0 时前端自动隐藏图层） */
router.get('/map/index', wrap(async (req, res) => {
    const worldId = geo.parseId(req.query.worldId, 'worldId');
    const data = await map.getIndex({ worldId });
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, ...data, limits: { maxBboxArea: map.MAP_MAX_BBOX_AREA, maxChunks: map.MAP_MAX_CHUNKS, maxLod: map.MAP_MAX_LOD } });
}));

/* ==================================================================
 * 历史地图
 * ================================================================== */

router.get('/history/snapshots', wrap(async (req, res) => {
    const items = await history.listSnapshots({ worldId: geo.parseId(req.query.worldId, 'worldId'), limit: req.query.limit });
    res.json({ ok: true, items, total: items.length });
}));

router.post('/history/snapshots', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const snap = await history.createSnapshot({
        worldId: req.body.worldId, name: req.body.name, note: req.body.note,
        dimension: req.body.dimension || null, actorId: req.userId, ip: audit.clientIp(req)
    });
    res.status(201).json({ ok: true, snapshot: snap });
}));

router.get('/history/at', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    const asOf = req.query.asOf || req.query.snapshotId ? req.query.asOf : req.query.asOf;
    if (req.query.snapshotId) {
        const snap = await history.getSnapshot(geo.parseId(req.query.snapshotId, 'snapshotId'));
        const items = await history.payloadsFromEntries(snap.id, { bbox: req.query.bbox, types: req.query.types ? String(req.query.types).split(',') : null });
        return res.json({ ok: true, asOf: snap.captured_at, snapshot: { id: snap.id, name: snap.name }, objects: items, count: items.length });
    }
    const data = await history.objectsAt({
        worldId: geo.parseId(req.query.worldId, 'worldId'),
        dimension: req.query.dimension || null,
        asOf: asOf || null,
        bbox: req.query.bbox || null,
        types: req.query.types ? String(req.query.types).split(',') : null,
        limit: req.query.limit
    });
    res.json({ ok: true, ...data });
}));

router.get('/history/diff', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    const data = await history.diff({
        snapshotId: geo.parseId(req.query.snapshotId, 'snapshotId'),
        against: req.query.against || 'current'
    });
    res.json({ ok: true, ...data });
}));

/** 归档世界（历史数据保留，当前数据不被覆盖） */
router.post('/history/archive', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const world = await worlds.updateWorld(geo.parseId(req.body.worldId, 'worldId'), { status: 'ARCHIVED' }, req.userId);
    res.json({ ok: true, world });
}));

/* ==================================================================
 * 地点引用（集市 / XBed 预留）
 * ================================================================== */

router.get('/places', wrap(async (req, res) => {
    const data = await places.listPlaces({
        worldId: req.query.worldId || null, dimension: req.query.dimension || null,
        bbox: req.query.bbox || null, kind: req.query.kind || null
    });
    res.json({ ok: true, ...data });
}));

router.get('/places/:kind/:refId', wrap(async (req, res) => {
    res.json({ ok: true, place: await places.getPlace(String(req.params.kind), req.params.refId) });
}));

/** 集市地点（只读投影，供 GIS 地图图层与空间关联；不改集市数据） */
router.get('/market/locations', wrap(async (req, res) => {
    const data = await places.listMarketLocations({
        serverKey: req.query.serverKey || null, dimension: req.query.dimension || null,
        bbox: req.query.bbox || null, limit: req.query.limit
    });
    res.json({ ok: true, ...data });
}));

/** 集市地点数量核对（迁移/回归验证用） */
router.get('/market/locations/count', wrap(async (req, res) => {
    res.json({ ok: true, ...(await places.countMarketLocations()) });
}));

/** XBed 预留：外部系统地点引用 */
router.get('/places-refs', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    res.json({ ok: true, items: await places.listPlaceRefs({ externalSystem: req.query.externalSystem || null, limit: req.query.limit }) });
}));

router.post('/places-refs', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    const ref = await places.createPlaceRef(req.body || {}, ctxOf(req));
    res.status(201).json({ ok: true, ref });
}));

router.delete('/places-refs/:externalSystem/:externalId', requirePermission(PERMISSIONS.admin), wrap(async (req, res) => {
    res.json({ ok: true, ...(await places.deletePlaceRef({ externalSystem: req.params.externalSystem, externalId: req.params.externalId }, ctxOf(req))) });
}));

/** 审计（自己的写操作记录） */
router.get('/audit/me', requirePermission(PERMISSIONS.access), wrap(async (req, res) => {
    const rows = await require('../database').all(
        `SELECT id, event, world_id, object_type, object_id, detail, created_at FROM gis_audit WHERE actor_id = ? ORDER BY id DESC LIMIT 100`,
        [req.userId]);
    res.json({ ok: true, items: rows });
}));

module.exports = router;
module.exports.TYPE_LABEL = TYPE_LABEL;
