/**
 * GIS 对象核心：District / Road / Marker 的创建、编辑、审核、版本、发布层与空间查询。
 *
 * 三层数据：
 *   gis_*（工作副本，可编辑，DRAFT/REVIEW/PUBLISHED/REJECTED/ARCHIVED）
 *   gis_revisions（不可变版本历史，每次正式修改一条快照）
 *   gis_published（只含 PUBLISHED Revision，客户端/地图只读这一层，带单调 seq 供增量同步）
 *
 * 状态机：DRAFT → REVIEW → PUBLISHED（发布时 revision+1）→ 再次编辑回到 DRAFT；REJECTED / ARCHIVED。
 * 空间：所有对象冗余 bbox（min_x/max_x/min_z/max_z），bbox 查询走索引，禁止整世界扫描。
 */

const db = require('../../database');
const { errors } = require('./errors');
const { LIMITS, MARKER_CATEGORIES, DISTRICT_TYPES, ROAD_TYPES, OBJECT_TYPES } = require('./constants');
const geo = require('./geo');
const audit = require('./audit');
const worlds = require('./worlds');

const TABLES = {
    district: { table: 'gis_districts', editPerm: 'gis.district.edit' },
    road: { table: 'gis_roads', editPerm: 'gis.road.edit' },
    marker: { table: 'gis_markers', editPerm: 'gis.submit' }
};

const localTs = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

function assertType(type) {
    if (!OBJECT_TYPES.includes(type)) throw errors.invalid(`对象类型只能是 ${OBJECT_TYPES.join('/')}`, 'type');
    return type;
}

function tableOf(type) { return TABLES[assertType(type)].table; }

/* ============================ 行 → API 对象 ============================ */

function toApi(type, row, { includeWorking = true } = {}) {
    if (!row) return null;
    const base = {
        type,
        id: row.id,
        worldId: row.world_id,
        dimension: row.dimension,
        name: row.name,
        status: row.status,
        revision: Number(row.revision),
        publishedRevision: Number(row.published_revision) || 0,
        wikiPageId: row.wiki_page_id === null || row.wiki_page_id === undefined ? null : Number(row.wiki_page_id),
        description: row.description || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
    if (type === 'district') {
        const geometry = JSON.parse(row.geometry);
        const m = geo.geometryMeasure(geometry);
        return {
            ...base,
            geometry,
            geometryType: row.geometry_type || geometry.type,
            style: {
                color: row.style_color || '#5b8def',
                opacity: row.style_opacity === null || row.style_opacity === undefined ? 0.25 : Number(row.style_opacity),
                weight: Number(row.style_weight) || 2
            },
            districtType: row.district_type || 'district',
            parentId: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
            metrics: { area: m.area }
        };
    }
    if (type === 'road') {
        const geometry = JSON.parse(row.geometry);
        const m = geo.geometryMeasure(geometry);
        return {
            ...base,
            geometry,
            geometryType: 'LineString',
            width: Number(row.width) || 5,
            roadLevel: Number(row.road_level) || 3,
            isMain: Number(row.is_main) === 1,
            roadType: row.road_type || 'road',
            districtId: row.district_id === null || row.district_id === undefined ? null : Number(row.district_id),
            metrics: { length: m.length }
        };
    }
    return {
        ...base,
        category: row.category,
        point: { x: Number(row.x), y: Number(row.y), z: Number(row.z) },
        submitterId: row.submitter_id === null || row.submitter_id === undefined ? null : Number(row.submitter_id)
    };
}

/** 已发布层 payload 直接就是 API 对象 */
function publishedPayloadToApi(payload) {
    try { return JSON.parse(payload); } catch (e) { return null; }
}

/* ============================ 输入校验 ============================ */

async function validateWorldDimension(worldId, dimension) {
    const world = await worlds.requireWorld(worldId);
    if (!world.dimensions.some((d) => d.dimension === dimension)) {
        throw errors.dimensionMismatch(`世界 ${world.worldKey} 未登记维度 ${dimension}`);
    }
    return world;
}

async function normalizeInput(type, input, existing = null) {
    const b = input || {};
    const worldId = Number(b.worldId !== undefined ? b.worldId : (existing && existing.world_id));
    if (!Number.isInteger(worldId) || worldId <= 0) throw errors.invalid('worldId 必须是正整数', 'worldId');
    const dimension = String(b.dimension !== undefined ? b.dimension : (existing && existing.dimension) || 'overworld');
    await validateWorldDimension(worldId, dimension);

    const name = geo.requiredName(b.name !== undefined ? b.name : (existing && existing.name));
    const description = geo.safeText(b.description !== undefined ? b.description : (existing && existing.description), LIMITS.maxDescLength, 'description');
    const wikiPageId = b.wikiPageId !== undefined ? b.wikiPageId : (existing ? existing.wiki_page_id : null);

    if (type === 'marker') {
        const p = b.point && typeof b.point === 'object' ? b.point : { x: b.x, y: b.y, z: b.z };
        const x = Number(p.x !== undefined ? p.x : (existing && existing.x));
        const y = Number(p.y !== undefined ? p.y : (existing ? existing.y : 64));
        const z = Number(p.z !== undefined ? p.z : (existing && existing.z));
        if (![x, y, z].every(Number.isFinite)) throw errors.invalid('Marker 坐标 x/y/z 必须是数字', 'point');
        if (Math.abs(x) > 30000000 || Math.abs(z) > 30000000) throw errors.invalid('坐标超出 Minecraft 世界边界', 'point');
        if (y < -2048 || y > 4096) throw errors.invalid('Y 超出合理范围（-2048 ~ 4096）', 'point');
        const category = String(b.category !== undefined ? (b.category || 'other') : (existing ? existing.category : 'other'));
        if (!MARKER_CATEGORIES.includes(category)) {
            throw errors.invalid(`Marker 分类只能是 ${MARKER_CATEGORIES.join('/')}`, 'category');
        }
        const bbox = geo.pointBbox(x, z);
        return {
            worldId, dimension, name, description, wikiPageId, category,
            x: geo.round(x), y: geo.round(y), z: geo.round(z),
            geometry: { type: 'Point', coordinates: [geo.round(x), geo.round(z)] },
            bbox
        };
    }

    if (!b.geometry) throw errors.invalid('缺少 geometry', 'geometry');
    const norm = geo.normalizeGeometry(b.geometry);
    if (type === 'road') {
        if (norm.type !== 'LineString') throw errors.invalid('道路几何必须是 LineString', 'geometry');
        const width = Number(b.width !== undefined ? b.width : (existing ? existing.width : 5));
        if (!Number.isFinite(width) || width < 1 || width > 64) throw errors.invalid('道路宽度需在 1~64 方块之间', 'width');
        const roadLevel = Number(b.roadLevel !== undefined ? b.roadLevel : (existing ? existing.road_level : 3));
        if (!Number.isInteger(roadLevel) || roadLevel < 1 || roadLevel > 5) throw errors.invalid('道路等级需为 1~5', 'roadLevel');
        const isMain = b.isMain !== undefined ? (b.isMain ? 1 : 0) : (existing ? Number(existing.is_main) : 0);
        const districtId = b.districtId !== undefined ? b.districtId : (existing ? existing.district_id : null);
        if (districtId !== null && districtId !== undefined && Number(districtId) > 0) {
            const d = await db.get(`SELECT id, world_id, dimension FROM gis_districts WHERE id = ?`, [Number(districtId)]);
            if (!d) throw errors.invalid('所属城区不存在', 'districtId');
            if (Number(d.world_id) !== worldId) throw errors.invalid('所属城区不在同一世界', 'districtId');
        }
        const roadType = String(b.roadType !== undefined ? (b.roadType || 'road') : (existing ? existing.road_type : 'road'));
        if (!ROAD_TYPES.includes(roadType)) throw errors.invalid(`道路类型只能是 ${ROAD_TYPES.join('/')}`, 'roadType');
        return {
            worldId, dimension, name, description, wikiPageId, geometry: norm.geometry, bbox: norm.bbox,
            width: geo.round(width), roadLevel, isMain, roadType,
            districtId: districtId && Number(districtId) > 0 ? Number(districtId) : null
        };
    }

    // district
    if (norm.type !== 'Polygon' && norm.type !== 'MultiPolygon') {
        throw errors.invalid('城区几何必须是 Polygon / MultiPolygon', 'geometry');
    }
    const districtType = String(b.districtType !== undefined ? (b.districtType || 'district') : (existing ? existing.district_type : 'district'));
    if (!DISTRICT_TYPES.includes(districtType)) throw errors.invalid(`城区类型只能是 ${DISTRICT_TYPES.join('/')}`, 'districtType');
    let parentId = b.parentId !== undefined ? b.parentId : (existing ? existing.parent_id : null);
    parentId = parentId && Number(parentId) > 0 ? Number(parentId) : null;
    if (parentId) {
        if (existing && parentId === Number(existing.id)) throw errors.invalid('父级区域不能是自己', 'parentId');
        const parent = await db.get(`SELECT id, world_id, parent_id FROM gis_districts WHERE id = ?`, [parentId]);
        if (!parent) throw errors.invalid('父级区域不存在', 'parentId');
        if (Number(parent.world_id) !== worldId) throw errors.invalid('父级区域不在同一世界', 'parentId');
        // 防止环
        let cursor = parent;
        const seen = new Set([parentId]);
        while (cursor && cursor.parent_id) {
            const nextId = Number(cursor.parent_id);
            if (seen.has(nextId)) throw errors.invalid('父级区域存在循环引用', 'parentId');
            seen.add(nextId);
            cursor = await db.get(`SELECT id, parent_id FROM gis_districts WHERE id = ?`, [nextId]);
        }
        if (existing && seen.has(Number(existing.id))) throw errors.invalid('父级区域不能是自己的子孙', 'parentId');
    }
    const colorRaw = b.styleColor !== undefined ? b.styleColor : (b.style && b.style.color) !== undefined ? (b.style && b.style.color) : (existing ? existing.style_color : '#5b8def');
    const color = String(colorRaw || '#5b8def').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw errors.invalid('颜色必须是 #RRGGBB', 'styleColor');
    const opacityRaw = b.styleOpacity !== undefined ? b.styleOpacity : (b.style && b.style.opacity) !== undefined ? (b.style && b.style.opacity) : (existing ? existing.style_opacity : 0.25);
    const opacity = Number(opacityRaw);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw errors.invalid('透明度需在 0~1 之间', 'styleOpacity');
    const weightRaw = b.styleWeight !== undefined ? b.styleWeight : (b.style && b.style.weight) !== undefined ? (b.style && b.style.weight) : (existing ? existing.style_weight : 2);
    const weight = Number(weightRaw);
    if (!Number.isInteger(weight) || weight < 1 || weight > 12) throw errors.invalid('边框宽度需为 1~12', 'styleWeight');

    return {
        worldId, dimension, name, description, wikiPageId, geometry: norm.geometry, bbox: norm.bbox,
        districtType, parentId, styleColor: color, styleOpacity: geo.round(opacity, 2), styleWeight: weight
    };
}

/* ============================ 版本记录 / 发布层 ============================ */

async function recordRevision({ type, objectId, worldId, dimension, revision, status, action, actorId, note, payload }) {
    const bbox = payload && payload.geometry ? geo.computeBbox(payload.geometry) : {
        minX: payload && payload.point ? payload.point.x : 0, maxX: payload && payload.point ? payload.point.x : 0,
        minZ: payload && payload.point ? payload.point.z : 0, maxZ: payload && payload.point ? payload.point.z : 0
    };
    await db.run(
        `INSERT OR REPLACE INTO gis_revisions
            (object_type, object_id, world_id, dimension, revision, status, action, actor_id, note, snapshot, min_x, max_x, min_z, max_z, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [type, objectId, worldId, dimension, revision, status, action, actorId || null, geo.safeText(note, LIMITS.maxNoteLength, 'note'),
            JSON.stringify(payload), bbox.minX, bbox.maxX, bbox.minZ, bbox.maxZ, localTs()]
    );
}

async function writePublished({ type, objectId, worldId, dimension, revision, payload, deleted = false }) {
    const seqRow = await db.get(`SELECT value FROM gis_seq WHERE name = 'published'`);
    const nextSeq = (Number(seqRow && seqRow.value) || 0) + 1;
    await db.run(`UPDATE gis_seq SET value = ? WHERE name = 'published'`, [nextSeq]);
    const bbox = payload && payload.geometry ? geo.computeBbox(payload.geometry) : {
        minX: payload && payload.point ? payload.point.x : 0, maxX: payload && payload.point ? payload.point.x : 0,
        minZ: payload && payload.point ? payload.point.z : 0, maxZ: payload && payload.point ? payload.point.z : 0
    };
    await db.run(
        `INSERT INTO gis_published (object_type, object_id, world_id, dimension, revision, seq, payload, min_x, max_x, min_z, max_z, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(object_type, object_id) DO UPDATE SET
            world_id = excluded.world_id, dimension = excluded.dimension, revision = excluded.revision,
            seq = excluded.seq, payload = excluded.payload,
            min_x = excluded.min_x, max_x = excluded.max_x, min_z = excluded.min_z, max_z = excluded.max_z,
            deleted = excluded.deleted, updated_at = excluded.updated_at`,
        [type, objectId, worldId, dimension, revision, nextSeq, JSON.stringify(payload || {}),
            bbox.minX, bbox.maxX, bbox.minZ, bbox.maxZ, deleted ? 1 : 0, localTs()]
    );
    return nextSeq;
}

async function logReview({ type, objectId, action, actorId, fromStatus, toStatus, note }) {
    await db.run(
        `INSERT INTO gis_review_log (object_type, object_id, action, actor_id, from_status, to_status, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [type, objectId, action, actorId || null, fromStatus || null, toStatus || null,
            geo.safeText(note, LIMITS.maxNoteLength, 'note'), localTs()]
    );
}

/* ============================ CRUD ============================ */

async function getWorking(type, id) {
    const row = await db.get(`SELECT * FROM ${tableOf(type)} WHERE id = ?`, [Number(id)]);
    return row ? toApi(type, row) : null;
}

async function requireWorking(type, id) {
    const row = await db.get(`SELECT * FROM ${tableOf(type)} WHERE id = ?`, [Number(id)]);
    if (!row) throw errors.notFound('GIS 对象不存在');
    return row;
}

async function getPublished(type, id) {
    const row = await db.get(`SELECT * FROM gis_published WHERE object_type = ? AND object_id = ? AND deleted = 0`, [type, Number(id)]);
    return row ? publishedPayloadToApi(row.payload) : null;
}

/**
 * 创建对象。
 * @param {'district'|'road'|'marker'} type
 * @param {object} input
 * @param {{actorId?:number, isEditor?:boolean, ip?:string, submit?:boolean}} ctx
 */
async function create(type, input, ctx = {}) {
    assertType(type);
    const data = await normalizeInput(type, input);
    const ts = localTs();
    // 玩家提交直接进审核；编辑员创建为草稿，再自行提交/发布
    const status = ctx.isEditor ? 'DRAFT' : 'REVIEW';
    let result;
    if (type === 'marker') {
        result = await db.run(
            `INSERT INTO gis_markers (world_id, dimension, name, category, x, y, z, min_x, max_x, min_z, max_z,
                description, wiki_page_id, status, revision, published_revision, submitter_id, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`,
            [data.worldId, data.dimension, data.name, data.category, data.x, data.y, data.z,
                data.bbox.minX, data.bbox.maxX, data.bbox.minZ, data.bbox.maxZ,
                data.description, data.wikiPageId || null, status,
                ctx.actorId || null, ctx.actorId || null, ts, ts]
        );
    } else if (type === 'road') {
        result = await db.run(
            `INSERT INTO gis_roads (world_id, dimension, name, road_type, geometry, geometry_type,
                min_x, max_x, min_z, max_z, width, road_level, is_main, district_id, description, wiki_page_id,
                status, revision, published_revision, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'LineString', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
            [data.worldId, data.dimension, data.name, data.roadType, JSON.stringify(data.geometry),
                data.bbox.minX, data.bbox.maxX, data.bbox.minZ, data.bbox.maxZ,
                data.width, data.roadLevel, data.isMain, data.districtId, data.description, data.wikiPageId || null,
                status, ctx.actorId || null, ts, ts]
        );
    } else {
        result = await db.run(
            `INSERT INTO gis_districts (world_id, dimension, name, district_type, parent_id, geometry, geometry_type,
                min_x, max_x, min_z, max_z, style_color, style_opacity, style_weight, description, wiki_page_id,
                status, revision, published_revision, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
            [data.worldId, data.dimension, data.name, data.districtType, data.parentId, JSON.stringify(data.geometry),
                data.geometry.type, data.bbox.minX, data.bbox.maxX, data.bbox.minZ, data.bbox.maxZ,
                data.styleColor, data.styleOpacity, data.styleWeight, data.description, data.wikiPageId || null,
                status, ctx.actorId || null, ts, ts]
        );
    }
    const row = await requireWorking(type, result.id);
    const payload = toApi(type, row);
    await recordRevision({
        type, objectId: row.id, worldId: row.world_id, dimension: row.dimension, revision: Number(row.revision),
        status, action: 'create', actorId: ctx.actorId, note: ctx.note, payload
    });
    await logReview({ type, objectId: row.id, action: 'create', actorId: ctx.actorId, fromStatus: null, toStatus: status, note: ctx.note });
    await audit.log('object_create', { actorId: ctx.actorId, worldId: row.world_id, objectType: type, objectId: row.id, ip: ctx.ip });
    return toApi(type, row);
}

async function update(type, id, input, ctx = {}) {
    assertType(type);
    const row = await requireWorking(type, id);
    if (row.status === 'ARCHIVED') throw errors.conflict('对象已归档，不能修改');
    if (input && input.revision !== undefined) {
        const expect = Number(input.revision);
        if (!Number.isInteger(expect) || expect !== Number(row.revision)) {
            throw errors.versionConflict(`版本已更新（当前 ${row.revision}，提交 ${input.revision}），请刷新后重试`,
                { currentRevision: Number(row.revision) });
        }
    }
    const data = await normalizeInput(type, input, row);
    // 编辑已发布对象 → 回到草稿态（published_revision 保留，地图继续显示旧版本）
    const status = 'DRAFT';
    const revision = Number(row.revision) + 1;
    const ts = localTs();
    if (type === 'marker') {
        await db.run(
            `UPDATE gis_markers SET name = ?, category = ?, x = ?, y = ?, z = ?, min_x = ?, max_x = ?, min_z = ?, max_z = ?,
                description = ?, wiki_page_id = ?, world_id = ?, dimension = ?, status = ?, revision = ?, updated_by = ?, updated_at = ?
             WHERE id = ?`,
            [data.name, data.category, data.x, data.y, data.z, data.bbox.minX, data.bbox.maxX, data.bbox.minZ, data.bbox.maxZ,
                data.description, data.wikiPageId || null, data.worldId, data.dimension, status, revision, ctx.actorId || null, ts, row.id]
        );
    } else if (type === 'road') {
        await db.run(
            `UPDATE gis_roads SET name = ?, road_type = ?, geometry = ?, min_x = ?, max_x = ?, min_z = ?, max_z = ?,
                width = ?, road_level = ?, is_main = ?, district_id = ?, description = ?, wiki_page_id = ?,
                world_id = ?, dimension = ?, status = ?, revision = ?, updated_by = ?, updated_at = ?
             WHERE id = ?`,
            [data.name, data.roadType, JSON.stringify(data.geometry), data.bbox.minX, data.bbox.maxX, data.bbox.minZ, data.bbox.maxZ,
                data.width, data.roadLevel, data.isMain, data.districtId, data.description, data.wikiPageId || null,
                data.worldId, data.dimension, status, revision, ctx.actorId || null, ts, row.id]
        );
    } else {
        await db.run(
            `UPDATE gis_districts SET name = ?, district_type = ?, parent_id = ?, geometry = ?, geometry_type = ?,
                min_x = ?, max_x = ?, min_z = ?, max_z = ?, style_color = ?, style_opacity = ?, style_weight = ?,
                description = ?, wiki_page_id = ?, world_id = ?, dimension = ?, status = ?, revision = ?, updated_by = ?, updated_at = ?
             WHERE id = ?`,
            [data.name, data.districtType, data.parentId, JSON.stringify(data.geometry), data.geometry.type,
                data.bbox.minX, data.bbox.maxX, data.bbox.minZ, data.bbox.maxZ,
                data.styleColor, data.styleOpacity, data.styleWeight, data.description, data.wikiPageId || null,
                data.worldId, data.dimension, status, revision, ctx.actorId || null, ts, row.id]
        );
    }
    const fresh = await requireWorking(type, row.id);
    const payload = toApi(type, fresh);
    await recordRevision({
        type, objectId: row.id, worldId: fresh.world_id, dimension: fresh.dimension, revision,
        status, action: 'update', actorId: ctx.actorId, note: ctx.note, payload
    });
    await audit.log('object_update', { actorId: ctx.actorId, worldId: fresh.world_id, objectType: type, objectId: row.id, ip: ctx.ip });
    return toApi(type, fresh);
}

async function submit(type, id, ctx = {}) {
    const row = await requireWorking(type, id);
    if (!['DRAFT', 'REJECTED'].includes(row.status)) {
        throw errors.conflict(`当前状态 ${row.status} 不能提交审核`);
    }
    await db.run(`UPDATE ${tableOf(type)} SET status = 'REVIEW', updated_by = ?, updated_at = ? WHERE id = ?`,
        [ctx.actorId || null, localTs(), row.id]);
    await logReview({ type, objectId: row.id, action: 'submit', actorId: ctx.actorId, fromStatus: row.status, toStatus: 'REVIEW', note: ctx.note });
    return getWorking(type, row.id);
}

/** 发布：REVIEW → PUBLISHED，revision + 1，写发布层（客户端只同步这一层） */
async function publish(type, id, ctx = {}) {
    const row = await requireWorking(type, id);
    if (row.status !== 'REVIEW') throw errors.conflict(`只有待审核（REVIEW）对象可以发布，当前 ${row.status}`);
    const revision = Number(row.revision) + 1;
    const ts = localTs();
    await db.run(
        `UPDATE ${tableOf(type)} SET status = 'PUBLISHED', revision = ?, published_revision = ?, reviewed_by = ?, review_note = ?,
            published_at = ?, updated_at = ? WHERE id = ?`,
        [revision, revision, ctx.actorId || null, geo.safeText(ctx.note, LIMITS.maxNoteLength, 'note'), ts, ts, row.id]
    );
    const fresh = await requireWorking(type, row.id);
    const payload = toApi(type, fresh);
    payload.publishedAt = ts;
    await recordRevision({
        type, objectId: row.id, worldId: fresh.world_id, dimension: fresh.dimension, revision,
        status: 'PUBLISHED', action: 'publish', actorId: ctx.actorId, note: ctx.note, payload
    });
    await writePublished({ type, objectId: row.id, worldId: fresh.world_id, dimension: fresh.dimension, revision, payload });
    await logReview({ type, objectId: row.id, action: 'publish', actorId: ctx.actorId, fromStatus: row.status, toStatus: 'PUBLISHED', note: ctx.note });
    await audit.log('object_publish', { actorId: ctx.actorId, worldId: fresh.world_id, objectType: type, objectId: row.id, ip: ctx.ip });
    return toApi(type, fresh);
}

async function reject(type, id, ctx = {}) {
    const row = await requireWorking(type, id);
    if (!['REVIEW', 'DRAFT'].includes(row.status)) throw errors.conflict(`当前状态 ${row.status} 不能驳回`);
    await db.run(`UPDATE ${tableOf(type)} SET status = 'REJECTED', reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?`,
        [ctx.actorId || null, geo.safeText(ctx.note, LIMITS.maxNoteLength, 'note'), localTs(), row.id]);
    await logReview({ type, objectId: row.id, action: 'reject', actorId: ctx.actorId, fromStatus: row.status, toStatus: 'REJECTED', note: ctx.note });
    return getWorking(type, row.id);
}

/** 回滚：以历史版本内容生成新版本 N+1 并立即发布（历史不覆盖当前，只追加） */
async function rollback(type, id, targetRevision, ctx = {}) {
    const row = await requireWorking(type, id);
    const rev = await db.get(`SELECT * FROM gis_revisions WHERE object_type = ? AND object_id = ? AND revision = ?`,
        [type, row.id, Number(targetRevision)]);
    if (!rev) throw errors.notFound('目标历史版本不存在');
    const snapshot = JSON.parse(rev.snapshot);
    const revision = Number(row.revision) + 1;
    const ts = localTs();
    const bbox = snapshot.geometry ? geo.computeBbox(snapshot.geometry) : geo.pointBbox(snapshot.point.x, snapshot.point.z);

    if (type === 'marker') {
        await db.run(
            `UPDATE gis_markers SET name = ?, category = ?, x = ?, y = ?, z = ?, min_x = ?, max_x = ?, min_z = ?, max_z = ?,
                description = ?, wiki_page_id = ?, status = 'PUBLISHED', revision = ?, published_revision = ?,
                reviewed_by = ?, review_note = ?, published_at = ?, updated_at = ? WHERE id = ?`,
            [snapshot.name, snapshot.category, snapshot.point.x, snapshot.point.y, snapshot.point.z,
                bbox.minX, bbox.maxX, bbox.minZ, bbox.maxZ, snapshot.description || '', snapshot.wikiPageId || null,
                revision, revision, ctx.actorId || null, `回滚到 v${targetRevision}`, ts, ts, row.id]
        );
    } else if (type === 'road') {
        await db.run(
            `UPDATE gis_roads SET name = ?, road_type = ?, geometry = ?, min_x = ?, max_x = ?, min_z = ?, max_z = ?,
                width = ?, road_level = ?, is_main = ?, district_id = ?, description = ?, wiki_page_id = ?,
                status = 'PUBLISHED', revision = ?, published_revision = ?, reviewed_by = ?, review_note = ?,
                published_at = ?, updated_at = ? WHERE id = ?`,
            [snapshot.name, snapshot.roadType || 'road', JSON.stringify(snapshot.geometry),
                bbox.minX, bbox.maxX, bbox.minZ, bbox.maxZ, snapshot.width, snapshot.roadLevel, snapshot.isMain ? 1 : 0,
                snapshot.districtId || null, snapshot.description || '', snapshot.wikiPageId || null,
                revision, revision, ctx.actorId || null, `回滚到 v${targetRevision}`, ts, ts, row.id]
        );
    } else {
        await db.run(
            `UPDATE gis_districts SET name = ?, district_type = ?, parent_id = ?, geometry = ?, geometry_type = ?,
                min_x = ?, max_x = ?, min_z = ?, max_z = ?, style_color = ?, style_opacity = ?, style_weight = ?,
                description = ?, wiki_page_id = ?, status = 'PUBLISHED', revision = ?, published_revision = ?,
                reviewed_by = ?, review_note = ?, published_at = ?, updated_at = ? WHERE id = ?`,
            [snapshot.name, snapshot.districtType || 'district', snapshot.parentId || null,
                JSON.stringify(snapshot.geometry), snapshot.geometry ? snapshot.geometry.type : 'Polygon',
                bbox.minX, bbox.maxX, bbox.minZ, bbox.maxZ,
                (snapshot.style && snapshot.style.color) || '#5b8def',
                (snapshot.style && snapshot.style.opacity) !== undefined ? snapshot.style.opacity : 0.25,
                (snapshot.style && snapshot.style.weight) || 2,
                snapshot.description || '', snapshot.wikiPageId || null,
                revision, revision, ctx.actorId || null, `回滚到 v${targetRevision}`, ts, ts, row.id]
        );
    }
    const fresh = await requireWorking(type, row.id);
    const payload = toApi(type, fresh);
    await recordRevision({
        type, objectId: row.id, worldId: fresh.world_id, dimension: fresh.dimension, revision,
        status: 'PUBLISHED', action: 'rollback', actorId: ctx.actorId, note: `回滚到 v${targetRevision}`, payload
    });
    await writePublished({ type, objectId: row.id, worldId: fresh.world_id, dimension: fresh.dimension, revision, payload });
    await logReview({ type, objectId: row.id, action: 'rollback', actorId: ctx.actorId, fromStatus: row.status, toStatus: 'PUBLISHED', note: `v${targetRevision}` });
    await audit.log('object_rollback', { actorId: ctx.actorId, worldId: fresh.world_id, objectType: type, objectId: row.id, detail: { targetRevision }, ip: ctx.ip });
    return toApi(type, fresh);
}

async function archive(type, id, ctx = {}) {
    const row = await requireWorking(type, id);
    if (row.status === 'ARCHIVED') return getWorking(type, row.id);
    await db.run(`UPDATE ${tableOf(type)} SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE id = ?`,
        [localTs(), localTs(), row.id]);
    const fresh = await requireWorking(type, row.id);
    const payload = toApi(type, fresh);
    await recordRevision({
        type, objectId: row.id, worldId: fresh.world_id, dimension: fresh.dimension, revision: Number(fresh.revision),
        status: 'ARCHIVED', action: 'archive', actorId: ctx.actorId, note: ctx.note, payload
    });
    // 发布层写墓碑（客户端据此删除本地缓存），不回退 seq
    const prev = await db.get(`SELECT revision FROM gis_published WHERE object_type = ? AND object_id = ?`, [type, row.id]);
    if (prev) {
        await writePublished({
            type, objectId: row.id, worldId: fresh.world_id, dimension: fresh.dimension,
            revision: Number(prev.revision), payload: { type, id: row.id, archived: true }, deleted: true
        });
    }
    await logReview({ type, objectId: row.id, action: 'archive', actorId: ctx.actorId, fromStatus: row.status, toStatus: 'ARCHIVED', note: ctx.note });
    await audit.log('object_archive', { actorId: ctx.actorId, worldId: fresh.world_id, objectType: type, objectId: row.id, ip: ctx.ip });
    return getWorking(type, row.id);
}

/** 关联 Wiki 页面（只存 ID，不复制正文）；已发布对象变更立即同步到发布层 */
async function setWiki(type, id, wikiPageId, ctx = {}) {
    const row = await requireWorking(type, id);
    let wikiId = null;
    if (wikiPageId !== null && wikiPageId !== undefined && wikiPageId !== '') {
        wikiId = Number(wikiPageId);
        if (!Number.isInteger(wikiId) || wikiId <= 0) throw errors.invalid('wikiPageId 必须是正整数或 null', 'wikiPageId');
        const page = await db.get(`SELECT id FROM wiki_pages WHERE id = ?`, [wikiId]);
        if (!page) throw errors.invalid('Wiki 页面不存在', 'wikiPageId');
    }
    const revision = Number(row.revision) + 1;
    await db.run(`UPDATE ${tableOf(type)} SET wiki_page_id = ?, revision = ?, updated_at = ? WHERE id = ?`,
        [wikiId, revision, localTs(), row.id]);
    const fresh = await requireWorking(type, row.id);
    const payload = toApi(type, fresh);
    await recordRevision({
        type, objectId: row.id, worldId: fresh.world_id, dimension: fresh.dimension, revision,
        status: fresh.status, action: 'wiki', actorId: ctx.actorId, note: wikiId ? `关联 Wiki #${wikiId}` : '解除 Wiki 关联', payload
    });
    if (Number(fresh.published_revision) > 0 && fresh.status === 'PUBLISHED') {
        await db.run(`UPDATE ${tableOf(type)} SET published_revision = ? WHERE id = ?`, [revision, row.id]);
        payload.publishedRevision = revision;
        await writePublished({ type, objectId: row.id, worldId: fresh.world_id, dimension: fresh.dimension, revision, payload });
    }
    return getWorking(type, row.id);
}

/* ============================ 查询 ============================ */

function encodeCursor(type, id) { return `${type}|${id}`; }
function decodeCursor(cursor) {
    if (!cursor) return null;
    const [type, id] = String(cursor).split('|');
    if (!OBJECT_TYPES.includes(type)) return null;
    const n = Number(id);
    if (!Number.isInteger(n) || n < 0) return null;
    return { type, id: n };
}

/**
 * bbox 查询已发布对象（唯一对外地图数据接口）。
 * 强制 bbox，分页 + 截断标记，永不返回整个世界。
 */
async function queryPublished({ worldId, dimension, bbox, types, limit = LIMITS.objectsPageDefault, cursor = null, zoom = null, detail = false }) {
    const width = Number(worldId);
    if (!Number.isInteger(width) || width <= 0) throw errors.invalid('worldId 必须是正整数', 'worldId');
    if (!require('./constants').DIMENSIONS.includes(dimension)) throw errors.invalid('dimension 不合法', 'dimension');
    const box = geo.parseBbox(bbox);
    const lim = Math.min(Math.max(Number(limit) || LIMITS.objectsPageDefault, 1), LIMITS.objectsPageMax);
    const wanted = (Array.isArray(types) ? types : String(types || '').split(','))
        .map((t) => String(t).trim()).filter((t) => OBJECT_TYPES.includes(t));
    const typeFilter = wanted.length ? wanted : OBJECT_TYPES.slice();

    const where = [`world_id = ?`, `dimension = ?`, `deleted = 0`,
        `min_x <= ?`, `max_x >= ?`, `min_z <= ?`, `max_z >= ?`];
    const params = [width, dimension, box.maxX, box.minX, box.maxZ, box.minZ];
    where.push(`object_type IN (${typeFilter.map(() => '?').join(',')})`);
    params.push(...typeFilter);
    const cur = decodeCursor(cursor);
    if (cur) {
        where.push(`(object_type > ? OR (object_type = ? AND object_id > ?))`);
        params.push(cur.type, cur.type, cur.id);
    }
    const rows = await db.all(
        `SELECT object_type, object_id, revision, payload, min_x, max_x, min_z, max_z
           FROM gis_published WHERE ${where.join(' AND ')}
          ORDER BY object_type ASC, object_id ASC LIMIT ?`,
        [...params, lim + 1]
    );
    const hasMore = rows.length > lim;
    const page = hasMore ? rows.slice(0, lim) : rows;
    const objects = [];
    for (const r of page) {
        const payload = publishedPayloadToApi(r.payload);
        if (!payload) continue;
        if (!detail && payload.geometry) payload.geometry = geo.simplifyGeometry(payload.geometry, zoom);
        objects.push(payload);
    }
    const last = page[page.length - 1];
    return {
        objects,
        hasMore,
        nextCursor: hasMore && last ? encodeCursor(last.object_type, last.object_id) : null,
        truncated: hasMore,
        bbox: box,
        total: objects.length
    };
}

/** 增量同步：seq > since 的发布层变更（含墓碑） */
async function syncPublished({ worldId, dimension, since = 0, limit = 500 }) {
    const width = Number(worldId);
    if (!Number.isInteger(width) || width <= 0) throw errors.invalid('worldId 必须是正整数', 'worldId');
    const sinceSeq = Number.isFinite(Number(since)) ? Number(since) : 0;
    const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);
    const rows = await db.all(
        `SELECT object_type, object_id, revision, seq, payload, deleted FROM gis_published
          WHERE world_id = ? AND dimension = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
        [width, dimension, sinceSeq, lim + 1]
    );
    const hasMore = rows.length > lim;
    const list = hasMore ? rows.slice(0, lim) : rows;
    const objects = [];
    const deleted = [];
    for (const r of list) {
        if (Number(r.deleted) === 1) deleted.push({ type: r.object_type, id: r.object_id, revision: r.revision, seq: r.seq });
        else {
            const payload = publishedPayloadToApi(r.payload);
            if (payload) { payload.seq = r.seq; objects.push(payload); }
        }
    }
    const cursor = list.length ? Number(list[list.length - 1].seq) : sinceSeq;
    return { objects, deleted, cursor, hasMore, revision: cursor };
}

async function listRevisions(type, id, { limit = 100, page = 1 } = {}) {
    const row = await requireWorking(type, id);
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * lim;
    const rows = await db.all(
        `SELECT id, revision, status, action, actor_id, note, created_at, min_x, max_x, min_z, max_z
           FROM gis_revisions WHERE object_type = ? AND object_id = ?
          ORDER BY revision DESC LIMIT ? OFFSET ?`, [type, row.id, lim, offset]);
    const total = await db.get(`SELECT COUNT(*) AS c FROM gis_revisions WHERE object_type = ? AND object_id = ?`, [type, row.id]);
    return { items: rows.map((r) => ({ ...r, objectId: row.id, objectType: type })), total: Number(total.c) || 0 };
}

async function getRevision(type, id, revision) {
    const rev = await db.get(`SELECT * FROM gis_revisions WHERE object_type = ? AND object_id = ? AND revision = ?`,
        [type, Number(id), Number(revision)]);
    if (!rev) throw errors.notFound('历史版本不存在');
    return { ...rev, snapshot: JSON.parse(rev.snapshot) };
}

/** 待审队列 */
async function reviewQueue({ status = 'REVIEW', worldId = null, type = null, limit = 100, page = 1 } = {}) {
    const st = String(status || 'REVIEW').toUpperCase();
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * lim;
    const types = type ? [assertType(type)] : OBJECT_TYPES;
    const items = [];
    for (const t of types) {
        const where = ['status = ?'];
        const params = [st];
        if (worldId) { where.push('world_id = ?'); params.push(Number(worldId)); }
        const rows = await db.all(`SELECT * FROM ${tableOf(t)} WHERE ${where.join(' AND ')} ORDER BY updated_at ASC LIMIT ? OFFSET ?`,
            [...params, lim, offset]);
        for (const r of rows) items.push(toApi(t, r));
    }
    items.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    return { items: items.slice(0, lim), total: items.length, status: st };
}

/** 关联到某 Wiki 页面的 GIS 对象（Wiki 反链） */
async function objectsByWiki(wikiPageId) {
    const id = Number(wikiPageId);
    if (!Number.isInteger(id) || id <= 0) throw errors.invalid('wikiPageId 必须是正整数', 'wikiPageId');
    const out = [];
    for (const t of OBJECT_TYPES) {
        const rows = await db.all(`SELECT * FROM ${tableOf(t)} WHERE wiki_page_id = ? AND status = 'PUBLISHED' ORDER BY id`, [id]);
        for (const r of rows) out.push(toApi(t, r));
    }
    return out;
}

/** 文本 + 空间搜索（只搜已发布） */
async function searchPublished({ q, worldId, dimension, bbox, category, limit = 50 }) {
    const keyword = String(q || '').trim();
    if (!keyword) throw errors.invalid('缺少搜索关键词 q', 'q');
    if (keyword.length > 60) throw errors.invalid('搜索关键词过长', 'q');
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const where = ['deleted = 0', 'payload LIKE ?'];
    const params = [`%${keyword.replace(/[%_]/g, (m) => '\\' + m)}%`];
    if (worldId) { where.push('world_id = ?'); params.push(Number(worldId)); }
    if (dimension) { where.push('dimension = ?'); params.push(String(dimension)); }
    if (bbox) {
        const box = geo.parseBbox(bbox);
        where.push('min_x <= ?', 'max_x >= ?', 'min_z <= ?', 'max_z >= ?');
        params.push(box.maxX, box.minX, box.maxZ, box.minZ);
    }
    if (category) {
        where.push('object_type = ?');
        params.push(category === 'marker' ? 'marker' : (OBJECT_TYPES.includes(category) ? category : 'marker'));
    }
    const rows = await db.all(
        `SELECT object_type, object_id, revision, payload FROM gis_published
          WHERE ${where.join(' AND ')} ORDER BY object_type, object_id LIMIT ?`, [...params, lim * 3]);
    const needle = keyword.toLowerCase();
    const out = [];
    for (const r of rows) {
        const p = publishedPayloadToApi(r.payload);
        if (!p) continue;
        const hay = `${p.name || ''} ${p.description || ''}`.toLowerCase();
        if (!hay.includes(needle)) continue;
        out.push(p);
        if (out.length >= lim) break;
    }
    return { items: out, keyword, total: out.length };
}

/**
 * 点位归属：所在城区（point-in-polygon，取最小面积=最具体）+ 最近道路（宽度缓冲）。
 * 明确返回 hasData：该点是否有任何 GIS 数据。
 */
async function placeAt({ worldId, dimension, x, z }) {
    const px = Number(x);
    const pz = Number(z);
    if (!Number.isFinite(px) || !Number.isFinite(pz)) throw errors.invalid('x/z 必须是数字', 'x');
    const where = [`world_id = ?`, `dimension = ?`, `deleted = 0`, `min_x <= ?`, `max_x >= ?`, `min_z <= ?`, `max_z >= ?`];
    // 查询框外扩 64 方块：道路按宽度缓冲区命中，边界处也能纳入候选
    const PAD = 64;
    const params = [Number(worldId), String(dimension), px + PAD, px - PAD, pz + PAD, pz - PAD];

    const candidates = await db.all(
        `SELECT object_type, object_id, revision, payload FROM gis_published
          WHERE ${where.join(' AND ')} AND object_type IN ('district','road','marker') LIMIT 500`, params);
    let district = null;
    let road = null;
    const markers = [];
    for (const c of candidates) {
        const p = publishedPayloadToApi(c.payload);
        if (!p) continue;
        if (p.type === 'district' && p.geometry && geo.pointInGeometry(px, pz, p.geometry)) {
            const area = (p.metrics && p.metrics.area) || geo.geometryMeasure(p.geometry).area;
            if (!district || area < district.area) district = { id: p.id, name: p.name, area, parentId: p.parentId || null, wikiPageId: p.wikiPageId || null };
        } else if (p.type === 'road' && p.geometry) {
            const r = geo.distanceToLineString(px, pz, p.geometry.coordinates);
            const halfWidth = Math.max((Number(p.width) || 5) / 2, 1);
            if (r.distance <= halfWidth) {
                if (!road || r.distance < road.distance) {
                    road = { id: p.id, name: p.name, width: p.width, distance: geo.round(r.distance, 2), isMain: !!p.isMain, wikiPageId: p.wikiPageId || null };
                }
            }
        } else if (p.type === 'marker' && p.point) {
            const d = Math.hypot(p.point.x - px, p.point.z - pz);
            if (d <= 64) markers.push({ id: p.id, name: p.name, category: p.category, distance: geo.round(d, 2), wikiPageId: p.wikiPageId || null });
        }
    }
    markers.sort((a, b) => a.distance - b.distance);
    let parents = [];
    if (district && district.parentId) {
        let cursor = district.parentId;
        for (let i = 0; i < 8 && cursor; i++) {
            const row = await db.get(`SELECT object_id, payload FROM gis_published WHERE object_type = 'district' AND object_id = ? AND deleted = 0`, [cursor]);
            if (!row) break;
            const p = publishedPayloadToApi(row.payload);
            if (!p) break;
            parents.push({ id: p.id, name: p.name });
            cursor = p.parentId || null;
        }
    }
    return {
        district: district ? { id: district.id, name: district.name, wikiPageId: district.wikiPageId } : null,
        districtPath: district ? [district.name, ...parents.map((p) => p.name)] : [],
        road,
        nearbyMarkers: markers.slice(0, 8),
        hasData: !!(district || road || markers.length)
    };
}

/** 半径内对象（只已发布） */
async function nearby({ worldId, dimension, x, z, radius = 128, limit = 50 }) {
    const px = Number(x);
    const pz = Number(z);
    const r = Math.min(Math.max(Number(radius) || 128, 1), 2048);
    if (!Number.isFinite(px) || !Number.isFinite(pz)) throw errors.invalid('x/z 必须是数字', 'x');
    const box = geo.pointBbox(px, pz, r);
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await db.all(
        `SELECT object_type, object_id, payload FROM gis_published
          WHERE world_id = ? AND dimension = ? AND deleted = 0
            AND min_x <= ? AND max_x >= ? AND min_z <= ? AND max_z >= ?
          LIMIT 2000`,
        [Number(worldId), String(dimension), box.maxX, box.minX, box.maxZ, box.minZ]
    );
    const out = [];
    for (const row of rows) {
        const p = publishedPayloadToApi(row.payload);
        if (!p) continue;
        let dist = Infinity;
        if (p.type === 'marker' && p.point) dist = Math.hypot(p.point.x - px, p.point.z - pz);
        else if (p.geometry) {
            if (p.type === 'district' && geo.pointInGeometry(px, pz, p.geometry)) dist = 0;
            else dist = geo.distanceToGeometry(px, pz, p.geometry).distance;
        }
        if (dist <= r) out.push({ ...p, distance: geo.round(dist, 2) });
    }
    out.sort((a, b) => a.distance - b.distance);
    return { items: out.slice(0, lim), radius: r };
}

module.exports = {
    TABLES,
    toApi,
    create, update, submit, publish, reject, rollback, archive, setWiki,
    getWorking, requireWorking, getPublished,
    queryPublished, syncPublished, listRevisions, getRevision, reviewQueue, objectsByWiki,
    searchPublished, placeAt, nearby,
    recordRevision, writePublished, logReview
};
