/**
 * 历史地图：世界快照、按时间/快照重建历史视图、差异对比。
 *
 * 设计取舍（规范第十五条：不要求复杂时间序列数据库，优先复用 SQLite 与版本机制）：
 *  - 快照只记录「对象 → 当时已发布的版本号」（gis_snapshot_entries），不复制几何；
 *  - 历史视图从 gis_revisions 重建，纯只读；
 *  - 历史数据永不写入/覆盖当前工作副本与发布层。
 */

const db = require('../../database');
const { errors } = require('./errors');
const { OBJECT_TYPES, LIMITS } = require('./constants');
const geo = require('./geo');
const audit = require('./audit');

const localTs = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

/** 创建世界快照（记录当前所有已发布对象的版本号） */
async function createSnapshot({ worldId, name, note = '', dimension = null, actorId = null, ip = null }) {
    const width = Number(worldId);
    if (!Number.isInteger(width) || width <= 0) throw errors.invalid('worldId 必须是正整数', 'worldId');
    const title = geo.safeText(name, LIMITS.maxNameLength, 'name');
    if (!title) throw errors.invalid('快照名称不能为空', 'name');
    const dim = dimension ? String(dimension) : null;
    const capturedAt = localTs();
    const snapshotResult = await db.run(
        `INSERT INTO gis_snapshots (world_id, name, note, scope, dimension, object_count, captured_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [width, title, geo.safeText(note, LIMITS.maxNoteLength, 'note'), dim ? 'dimension' : 'world', dim, capturedAt, actorId || null, capturedAt]
    );
    let count = 0;
    for (const type of OBJECT_TYPES) {
        const where = ['world_id = ?', 'deleted = 0', 'revision > 0'];
        const params = [width];
        if (dim) { where.push('dimension = ?'); params.push(dim); }
        const rows = await db.all(`SELECT object_id, revision FROM gis_published WHERE ${where.join(' AND ')}`, params);
        for (const r of rows) {
            await db.run(`INSERT OR REPLACE INTO gis_snapshot_entries (snapshot_id, object_type, object_id, revision) VALUES (?, ?, ?, ?)`,
                [snapshotResult.id, type, r.object_id, r.revision]);
            count++;
        }
    }
    await db.run(`UPDATE gis_snapshots SET object_count = ? WHERE id = ?`, [count, snapshotResult.id]);
    await audit.log('snapshot_create', { actorId, worldId: width, ip, detail: { snapshotId: snapshotResult.id, count } });
    return { id: snapshotResult.id, name: title, objectCount: count, capturedAt, dimension: dim };
}

async function listSnapshots({ worldId, limit = 100 }) {
    const width = Number(worldId);
    if (!Number.isInteger(width) || width <= 0) throw errors.invalid('worldId 必须是正整数', 'worldId');
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const rows = await db.all(
        `SELECT id, world_id, name, note, scope, dimension, object_count, captured_at, created_by, created_at
           FROM gis_snapshots WHERE world_id = ? ORDER BY captured_at DESC, id DESC LIMIT ?`, [width, lim]);
    return rows.map((r) => ({
        id: r.id, worldId: r.world_id, name: r.name, note: r.note || '', scope: r.scope,
        dimension: r.dimension || null, objectCount: Number(r.object_count) || 0,
        capturedAt: r.captured_at, createdBy: r.created_by, createdAt: r.created_at
    }));
}

async function getSnapshot(snapshotId) {
    const row = await db.get(`SELECT * FROM gis_snapshots WHERE id = ?`, [Number(snapshotId)]);
    if (!row) throw errors.notFound('快照不存在');
    return row;
}

/** 由快照条目的版本号取对象快照 */
async function payloadsFromEntries(snapshotId, { bbox = null, types = null } = {}) {
    const where = ['e.snapshot_id = ?'];
    const params = [Number(snapshotId)];
    let box = null;
    if (bbox) {
        box = geo.parseBbox(bbox);
        where.push('r.min_x <= ?', 'r.max_x >= ?', 'r.min_z <= ?', 'r.max_z >= ?');
        params.push(box.maxX, box.minX, box.maxZ, box.minZ);
    }
    const wanted = (types || OBJECT_TYPES).filter((t) => OBJECT_TYPES.includes(t));
    where.push(`e.object_type IN (${wanted.map(() => '?').join(',')})`);
    params.push(...wanted);
    const rows = await db.all(
        `SELECT e.object_type, e.object_id, e.revision, r.snapshot
           FROM gis_snapshot_entries e
           JOIN gis_revisions r ON r.object_type = e.object_type AND r.object_id = e.object_id AND r.revision = e.revision
          WHERE ${where.join(' AND ')} LIMIT 20000`, params);
    const out = [];
    for (const r of rows) {
        try {
            const payload = JSON.parse(r.snapshot);
            if (payload && payload.status !== 'ARCHIVED') {
                out.push({ ...payload, historicalRevision: r.revision, historicalAt: null, snapshotId: Number(snapshotId) });
            }
        } catch (e) { /* 忽略坏快照 */ }
    }
    void box;
    return out;
}

/** 按时间点重建历史视图（严格只读） */
async function objectsAt({ worldId, dimension, asOf = null, bbox = null, types = null, limit = 2000 }) {
    const width = Number(worldId);
    if (!Number.isInteger(width) || width <= 0) throw errors.invalid('worldId 必须是正整数', 'worldId');
    const ts = asOf ? String(asOf) : localTs();
    if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(ts)) {
        throw errors.invalid('asOf 需为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS', 'asOf');
    }
    const tsSql = ts.replace('T', ' ');
    const dim = dimension ? String(dimension) : null;
    const outer = [`r.status IN ('PUBLISHED','ARCHIVED')`];
    const outerParams = [];
    if (dim) { outer.push('r.dimension = ?'); outerParams.push(dim); }
    const wanted = (types || OBJECT_TYPES).filter((t) => OBJECT_TYPES.includes(t));
    outer.push(`r.object_type IN (${wanted.map(() => '?').join(',')})`);
    outerParams.push(...wanted);
    let box = null;
    if (bbox) {
        box = geo.parseBbox(bbox);
        outer.push('r.min_x <= ?', 'r.max_x >= ?', 'r.min_z <= ?', 'r.max_z >= ?');
        outerParams.push(box.maxX, box.minX, box.maxZ, box.minZ);
    }
    const innerParams = [width, tsSql];
    let inner = `SELECT object_type, object_id, MAX(revision) AS rev
                   FROM gis_revisions
                  WHERE world_id = ? AND created_at <= ?`;
    if (dim) { inner += ' AND dimension = ?'; innerParams.push(dim); }
    inner += ' GROUP BY object_type, object_id';

    const rows = await db.all(
        `SELECT r.object_type, r.object_id, r.revision, r.snapshot, r.created_at, r.status
           FROM (${inner}) latest
           JOIN gis_revisions r
             ON r.object_type = latest.object_type AND r.object_id = latest.object_id AND r.revision = latest.rev
          WHERE ${outer.join(' AND ')}
          ORDER BY r.object_type, r.object_id
          LIMIT ?`,
        [...innerParams, ...outerParams, Math.min(Math.max(Number(limit) || 2000, 1), 5000)]
    );
    const objects = [];
    for (const r of rows) {
        try {
            const payload = JSON.parse(r.snapshot);
            if (payload && payload.status !== 'ARCHIVED') {
                objects.push({ ...payload, historicalRevision: r.revision, historicalAt: r.created_at });
            }
        } catch (e) { /* ignore */ }
    }
    return { asOf: tsSql, bbox: box, objects, count: objects.length };
}

/** 差异：快照 vs 快照/当前 */
async function diff({ snapshotId, against = 'current' }) {
    const snapA = await getSnapshot(snapshotId);
    const buildMap = (list) => {
        const m = new Map();
        for (const o of list) m.set(`${o.type}|${o.id}`, o);
        return m;
    };
    const a = buildMap(await payloadsFromEntries(snapA.id));
    let b;
    if (against === 'current' || !against) {
        const rows = await db.all(`SELECT object_type, object_id, revision, payload FROM gis_published
                                    WHERE world_id = ? AND deleted = 0`, [snapA.world_id]);
        b = buildMap(rows.map((r) => { try { return JSON.parse(r.payload); } catch (e) { return null; } }).filter(Boolean));
    } else {
        const snapB = await getSnapshot(against);
        if (Number(snapB.world_id) !== Number(snapA.world_id)) throw errors.invalid('快照不属于同一世界', 'against');
        b = buildMap(await payloadsFromEntries(snapB.id));
    }
    const added = [];
    const removed = [];
    const changed = [];
    for (const [key, obj] of b.entries()) {
        const before = a.get(key);
        if (!before) { added.push(obj); continue; }
        const sigA = JSON.stringify({ n: before.name, g: before.geometry || before.point, r: before.revision, w: before.width, c: before.category });
        const sigB = JSON.stringify({ n: obj.name, g: obj.geometry || obj.point, r: obj.revision, w: obj.width, c: obj.category });
        if (sigA !== sigB) changed.push({ before, after: obj });
    }
    for (const [key, obj] of a.entries()) if (!b.has(key)) removed.push(obj);
    return {
        snapshot: { id: snapA.id, name: snapA.name, capturedAt: snapA.captured_at, worldId: snapA.world_id },
        against: against === 'current' ? 'current' : Number(against),
        added, removed, changed,
        summary: { added: added.length, removed: removed.length, changed: changed.length }
    };
}

module.exports = { createSnapshot, listSnapshots, getSnapshot, payloadsFromEntries, objectsAt, diff };
