/**
 * World Registry：服务器注册、世界注册、维度绑定、上传身份校验、覆盖范围统计。
 *
 * 安全要点（规范第六 / 十九条）：
 *  1. 世界只能由管理员注册（客户端不能创建或指定他人世界）；
 *  2. 上传前必须通过 resolveClientWorld() 校验 服务器注册 → 世界归属 → worldKey → 状态 → 维度；
 *  3. 已归档（ARCHIVED）只读，快照（SNAPSHOT）只读；
 *  4. 每次拒绝都写 gis_audit。
 */

const db = require('../../database');
const { errors } = require('./errors');
const { DIMENSIONS, WORLD_STATUS, LIMITS } = require('./constants');
const { safeText } = require('./geo');
const audit = require('./audit');

const localTs = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

/* ---------------- 服务器 ---------------- */

async function listServers() {
    return db.all(`SELECT server_key, server_name, mc_version, upload_policy, status, description, created_at, updated_at
                     FROM gis_servers ORDER BY server_key`);
}

async function getServer(serverKey) {
    return db.get(`SELECT * FROM gis_servers WHERE server_key = ?`, [String(serverKey || '')]);
}

async function registerServer({ serverKey, serverName, mcVersion, uploadPolicy, description, actorId }) {
    const key = safeText(serverKey, 40, 'serverKey');
    if (!key) throw errors.invalid('serverKey 不能为空', 'serverKey');
    if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,40}$/.test(key)) throw errors.invalid('serverKey 只能包含字母、数字、下划线、连字符或中文', 'serverKey');
    const policy = ['member', 'token', 'closed'].includes(uploadPolicy) ? uploadPolicy : 'member';
    const existing = await getServer(key);
    if (existing) {
        await db.run(`UPDATE gis_servers SET server_name = ?, mc_version = ?, upload_policy = ?, description = ?, updated_at = ? WHERE server_key = ?`,
            [safeText(serverName, 60, 'serverName') || existing.server_name, safeText(mcVersion, 20, 'mcVersion'),
                policy, safeText(description, 500, 'description'), localTs(), key]);
        await audit.log('server_update', { actorId, detail: { serverKey: key } });
        return getServer(key);
    }
    await db.run(`INSERT INTO gis_servers (server_key, server_name, mc_version, upload_policy, status, description, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        [key, safeText(serverName, 60, 'serverName') || key, safeText(mcVersion, 20, 'mcVersion'), policy,
            safeText(description, 500, 'description'), localTs(), localTs()]);
    await audit.log('server_register', { actorId, detail: { serverKey: key } });
    return getServer(key);
}

/* ---------------- 世界 ---------------- */

function decorateWorld(row, dims) {
    return {
        id: row.id,
        worldKey: row.world_key,
        serverKey: row.server_key,
        serverId: row.server_key,
        serverName: row.server_name || row.server_key,
        mcVersion: row.mc_version || '',
        status: row.status,
        isCurrent: Number(row.is_current) === 1,
        description: row.description || '',
        dimensions: (dims || []).map((d) => ({
            dimension: d.dimension,
            chunkCount: Number(d.chunk_count) || 0,
            bbox: d.min_x === null || d.min_x === undefined ? null
                : { minX: d.min_x, maxX: d.max_x, minZ: d.min_z, maxZ: d.max_z },
            updatedAt: d.updated_at || null
        })),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function worldDimensions(worldId) {
    return db.all(`SELECT * FROM gis_world_dimensions WHERE world_id = ? ORDER BY dimension`, [worldId]);
}

async function listWorlds({ status, serverKey, includeDimensions = true } = {}) {
    const where = [];
    const params = [];
    if (status) {
        const list = String(status).split(',').map((s) => s.trim().toUpperCase()).filter((s) => WORLD_STATUS.includes(s));
        if (list.length) { where.push(`status IN (${list.map(() => '?').join(',')})`); params.push(...list); }
    }
    if (serverKey) { where.push('server_key = ?'); params.push(String(serverKey)); }
    const sql = `SELECT * FROM gis_worlds ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY is_current DESC, id ASC`;
    const rows = await db.all(sql, params);
    if (!includeDimensions) return rows.map((r) => decorateWorld(r, []));
    const out = [];
    for (const r of rows) out.push(decorateWorld(r, await worldDimensions(r.id)));
    return out;
}

async function getWorld(worldId) {
    const row = await db.get(`SELECT * FROM gis_worlds WHERE id = ?`, [Number(worldId)]);
    if (!row) return null;
    return decorateWorld(row, await worldDimensions(row.id));
}

async function requireWorld(worldId) {
    const w = await getWorld(worldId);
    if (!w) throw errors.notFound('世界不存在');
    return w;
}

async function getWorldByKey(worldKey) {
    const row = await db.get(`SELECT * FROM gis_worlds WHERE world_key = ?`, [String(worldKey || '')]);
    if (!row) return null;
    return decorateWorld(row, await worldDimensions(row.id));
}

/** 世界创建/更新（管理员）。幂等：同 world_key 视为更新。 */
async function registerWorld({ worldKey, serverKey, serverName, mcVersion, status, description, actorId }) {
    const key = safeText(worldKey, 80, 'worldKey');
    if (!key) throw errors.invalid('worldKey 不能为空', 'worldKey');
    const server = await getServer(serverKey);
    if (!server) throw errors.serverNotRegistered(`服务器 ${serverKey} 未注册，请先在 GIS 注册服务器`);
    const st = WORLD_STATUS.includes(String(status || '').toUpperCase()) ? String(status).toUpperCase() : 'ACTIVE';

    const existing = await db.get(`SELECT * FROM gis_worlds WHERE world_key = ?`, [key]);
    if (existing) {
        if (existing.server_key !== server.server_key) {
            throw errors.invalid('worldKey 已被其它服务器占用', 'worldKey');
        }
        await db.run(`UPDATE gis_worlds SET server_name = ?, mc_version = ?, status = ?, description = ?, updated_at = ? WHERE id = ?`,
            [safeText(serverName, 60, 'serverName') || server.server_name || server.server_key,
                safeText(mcVersion, 20, 'mcVersion') || existing.mc_version || '',
                st, safeText(description, 500, 'description'), localTs(), existing.id]);
        await audit.log('world_update', { actorId, worldId: existing.id, detail: { worldKey: key, status: st } });
        return getWorld(existing.id);
    }

    const r = await db.run(
        `INSERT INTO gis_worlds (world_key, server_key, server_name, mc_version, status, is_current, description, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [key, server.server_key, safeText(serverName, 60, 'serverName') || server.server_name || server.server_key,
            safeText(mcVersion, 20, 'mcVersion') || server.mc_version || '', st,
            safeText(description, 500, 'description'), actorId || null, localTs(), localTs()]
    );
    for (const dim of DIMENSIONS.slice(0, 3)) {
        await db.run(`INSERT OR IGNORE INTO gis_world_dimensions (world_id, dimension, created_at, updated_at) VALUES (?, ?, ?, ?)`,
            [r.id, dim, localTs(), localTs()]);
    }
    await audit.log('world_register', { actorId, worldId: r.id, detail: { worldKey: key, serverKey: server.server_key } });
    return getWorld(r.id);
}

/**
 * 更新世界状态（ACTIVE / ARCHIVED / SNAPSHOT），可设为当前世界。
 * 归档只改状态，不删除任何 GIS 数据 —— 历史不覆盖当前。
 */
async function updateWorld(worldId, patch = {}, actorId) {
    const world = await requireWorld(worldId);
    const sets = [];
    const params = [];
    if (patch.status !== undefined) {
        const st = String(patch.status).toUpperCase();
        if (!WORLD_STATUS.includes(st)) throw errors.invalid(`世界状态只能是 ${WORLD_STATUS.join('/')}`, 'status');
        sets.push('status = ?'); params.push(st);
        if (st !== 'ACTIVE' && world.isCurrent) { sets.push('is_current = 0'); }
    }
    if (patch.serverName !== undefined) { sets.push('server_name = ?'); params.push(safeText(patch.serverName, 60, 'serverName')); }
    if (patch.mcVersion !== undefined) { sets.push('mc_version = ?'); params.push(safeText(patch.mcVersion, 20, 'mcVersion')); }
    if (patch.description !== undefined) { sets.push('description = ?'); params.push(safeText(patch.description, 500, 'description')); }
    if (patch.isCurrent === true) {
        // 同一服务器只能有一个 current
        await db.run(`UPDATE gis_worlds SET is_current = 0 WHERE server_key = ?`, [world.serverKey]);
        sets.push('is_current = 1');
        sets.push(`status = 'ACTIVE'`);
    }
    if (!sets.length) return getWorld(worldId);
    sets.push('updated_at = ?'); params.push(localTs(), worldId);
    await db.run(`UPDATE gis_worlds SET ${sets.join(', ')} WHERE id = ?`, params);
    await audit.log('world_update', { actorId, worldId, detail: patch });
    return getWorld(worldId);
}

/** 确保维度行存在（客户端首次向某维度上传时调用） */
async function ensureDimension(worldId, dimension) {
    if (!DIMENSIONS.includes(dimension)) throw errors.invalid(`不支持的维度：${dimension}`, 'dimension');
    await db.run(`INSERT OR IGNORE INTO gis_world_dimensions (world_id, dimension, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        [worldId, dimension, localTs(), localTs()]);
}

/**
 * 客户端上传身份校验：服务器注册 → 世界归属 → worldKey → 状态 → 维度。
 * 返回可用于后续写入的 { world, dimension, writable }。
 */
async function resolveClientWorld({ serverKey, worldId, worldKey, dimension, actorId, ip }) {
    const server = await getServer(serverKey);
    if (!server || server.status !== 'ACTIVE') {
        await audit.log('upload_denied', { actorId, ip, detail: { reason: 'server_not_registered', serverKey } });
        throw errors.serverNotRegistered(`服务器 ${serverKey || '(空)'} 未在玄剑 GIS 注册，本地地图可继续使用，但不能上传`);
    }
    if (server.upload_policy === 'closed') {
        await audit.log('upload_denied', { actorId, ip, detail: { reason: 'server_closed', serverKey } });
        throw errors.forbidden('该服务器已关闭 GIS 上传');
    }
    const world = await getWorld(worldId);
    if (!world) {
        await audit.log('upload_denied', { actorId, ip, detail: { reason: 'world_not_found', worldId } });
        throw errors.worldNotRegistered('World ID 未注册');
    }
    if (world.serverKey !== server.server_key) {
        await audit.log('upload_denied', { actorId, ip, worldId, detail: { reason: 'world_server_mismatch', serverKey } });
        throw errors.worldNotRegistered('该世界不属于当前服务器，禁止上传');
    }
    if (worldKey && String(worldKey) !== world.worldKey) {
        await audit.log('upload_denied', { actorId, ip, worldId, detail: { reason: 'world_key_mismatch' } });
        throw errors.worldNotRegistered('worldKey 与服务器分配的世界不符');
    }
    if (!DIMENSIONS.includes(String(dimension || ''))) {
        throw errors.invalid(`不支持的维度：${dimension}`, 'dimension');
    }
    const dims = world.dimensions.map((d) => d.dimension);
    if (dims.length && !dims.includes(dimension)) {
        await audit.log('upload_denied', { actorId, ip, worldId, detail: { reason: 'dimension_mismatch', dimension } });
        throw errors.dimensionMismatch(`世界 ${world.worldKey} 未登记维度 ${dimension}`);
    }
    const writable = world.status === 'ACTIVE';
    if (!writable) {
        await audit.log('upload_denied', { actorId, ip, worldId, detail: { reason: 'world_' + world.status.toLowerCase(), dimension } });
        throw errors.worldArchived(`世界 ${world.worldKey} 当前状态为 ${world.status}，只读`);
    }
    return { world, server, dimension, writable };
}

/** 归档：批量把某服务器除 keepWorldId 外的 ACTIVE 世界改为 ARCHIVED（旧服世界归档） */
async function archiveServerWorlds(serverKey, keepWorldId, actorId) {
    const rows = await db.all(`SELECT id FROM gis_worlds WHERE server_key = ? AND status = 'ACTIVE' AND id != ?`, [serverKey, Number(keepWorldId) || 0]);
    for (const r of rows) {
        await db.run(`UPDATE gis_worlds SET status = 'ARCHIVED', is_current = 0, updated_at = ? WHERE id = ?`, [localTs(), r.id]);
    }
    await audit.log('world_archive_batch', { actorId, detail: { serverKey, archived: rows.map((r) => r.id) } });
    return rows.map((r) => r.id);
}

/** 依据高程 chunk 重算维度覆盖范围（chunkCount / bbox） */
async function refreshDimensionStats(worldId, dimension) {
    const stat = await db.get(
        `SELECT COUNT(*) AS c, MIN(chunk_x) AS minCx, MAX(chunk_x) AS maxCx, MIN(chunk_z) AS minCz, MAX(chunk_z) AS maxCz
           FROM gis_elevation_chunks WHERE world_id = ? AND dimension = ?`, [worldId, dimension]);
    const size = LIMITS.chunkBlocks;
    const c = Number(stat && stat.c) || 0;
    const row = {
        chunkCount: c,
        minX: c ? stat.minCx * size : null,
        maxX: c ? stat.maxCx * size + size : null,
        minZ: c ? stat.minCz * size : null,
        maxZ: c ? stat.maxCz * size + size : null
    };
    await db.run(
        `INSERT INTO gis_world_dimensions (world_id, dimension, chunk_count, min_x, max_x, min_z, max_z, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(world_id, dimension) DO UPDATE SET
            chunk_count = excluded.chunk_count, min_x = excluded.min_x, max_x = excluded.max_x,
            min_z = excluded.min_z, max_z = excluded.max_z, updated_at = excluded.updated_at`,
        [worldId, dimension, row.chunkCount, row.minX, row.maxX, row.minZ, row.maxZ, localTs(), localTs()]
    );
    return row;
}

/** 当前服务器可写的 ACTIVE 世界（客户端 bootstrap 用） */
async function activeWorldsForServer(serverKey) {
    const rows = await db.all(
        `SELECT * FROM gis_worlds WHERE server_key = ? AND status = 'ACTIVE' ORDER BY is_current DESC, id ASC`, [serverKey]);
    const out = [];
    for (const r of rows) out.push(decorateWorld(r, await worldDimensions(r.id)));
    return out;
}

module.exports = {
    localTs,
    listServers, getServer, registerServer,
    listWorlds, getWorld, requireWorld, getWorldByKey, registerWorld, updateWorld,
    ensureDimension, resolveClientWorld, archiveServerWorlds, refreshDimensionStats,
    activeWorldsForServer, worldDimensions, decorateWorld
};
