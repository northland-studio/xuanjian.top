/**
 * GIS 几何工具：校验、包围盒、点面关系、距离、简化。
 *
 * 坐标约定：2D 地图几何只用 Minecraft X / Z；本模块中所有点写作 [x, z]，
 * 与 GeoJSON 的 [经度, 纬度] 位置一致（因此可直接输出 GeoJSON 给 Leaflet）。
 */

const { LIMITS } = require('./constants');
const { errors } = require('./errors');

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, p = 3) => {
    const f = Math.pow(10, p);
    return Math.round(v * f) / f;
};

function assertPoint(p, where) {
    if (!Array.isArray(p) || p.length < 2 || !isNum(Number(p[0])) || !isNum(Number(p[1]))) {
        throw errors.invalid(`${where} 坐标必须是 [x, z] 数字对`, 'geometry');
    }
    return [Number(p[0]), Number(p[1])];
}

function countPoints(coords, type) {
    const out = [];
    const walk = (arr) => {
        if (!Array.isArray(arr)) return;
        if (arr.length >= 2 && typeof arr[0] === 'number') { out.push(arr); return; }
        for (const a of arr) walk(a);
    };
    walk(coords);
    return out;
}

/**
 * 校验并规范化 GeoJSON 几何。
 * @returns {{ geometry: object, type: string, bbox: {minX,maxX,minZ,maxZ}, points: number }}
 */
function normalizeGeometry(raw) {
    if (!raw || typeof raw !== 'object') throw errors.invalid('缺少 geometry', 'geometry');
    const type = String(raw.type || '');
    const coords = raw.coordinates;
    if (!coords) throw errors.invalid('geometry.coordinates 缺失', 'geometry');

    let geometry;
    if (type === 'Point') {
        const p = assertPoint(coords, 'Point');
        geometry = { type: 'Point', coordinates: [round(p[0]), round(p[1])] };
    } else if (type === 'LineString') {
        if (!Array.isArray(coords) || coords.length < 2) throw errors.invalid('LineString 至少需要 2 个点', 'geometry');
        geometry = { type, coordinates: coords.map((p) => assertPoint(p, 'LineString').map((v) => round(v))) };
    } else if (type === 'Polygon') {
        if (!Array.isArray(coords) || coords.length < 1) throw errors.invalid('Polygon 至少需要 1 个环', 'geometry');
        geometry = { type, coordinates: coords.map((ring) => normalizeRing(ring)) };
    } else if (type === 'MultiPolygon') {
        if (!Array.isArray(coords) || coords.length < 1) throw errors.invalid('MultiPolygon 至少需要 1 个多边形', 'geometry');
        geometry = { type, coordinates: coords.map((poly) => poly.map((ring) => normalizeRing(ring))) };
    } else {
        throw errors.invalid(`不支持的几何类型：${type || '(空)'}（仅 Point/LineString/Polygon/MultiPolygon）`, 'geometry');
    }

    const pts = countPoints(geometry.coordinates, type);
    if (pts.length > LIMITS.maxGeometryPoints) {
        throw errors.invalid(`几何顶点数超过上限 ${LIMITS.maxGeometryPoints}`, 'geometry');
    }
    const json = JSON.stringify(geometry);
    if (Buffer.byteLength(json, 'utf8') > LIMITS.maxGeometryBytes) {
        throw errors.tooLarge(`几何序列化后超过 ${LIMITS.maxGeometryBytes} 字节`);
    }
    return { geometry, type, bbox: computeBbox(geometry), points: pts.length };
}

/** 环：至少 3 点、首尾闭合、去掉连续重复点 */
function normalizeRing(ring) {
    if (!Array.isArray(ring) || ring.length < 3) throw errors.invalid('Polygon 环至少需要 3 个点', 'geometry');
    const pts = [];
    for (const p of ring) {
        const q = assertPoint(p, 'Polygon').map((v) => round(v));
        const last = pts[pts.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
    }
    if (pts.length < 3) throw errors.invalid('Polygon 去重后顶点不足 3 个', 'geometry');
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
    if (Math.abs(ringArea(pts)) < 1) throw errors.invalid('Polygon 面积过小（<1 方块²），无法保存', 'geometry');
    return pts;
}

/** 多边形面积（鞋带公式，方块²，绝对值） */
function ringArea(ring) {
    if (!ring || ring.length < 3) return 0;
    let sum = 0;
    for (let i = 0, n = ring.length - 1; i < n; i++) {
        sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return sum / 2;
}

function computeBbox(geometry) {
    const pts = countPoints(geometry.coordinates, geometry.type);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1];
        if (p[1] > maxZ) maxZ = p[1];
    }
    if (!Number.isFinite(minX)) throw errors.invalid('geometry 无有效坐标', 'geometry');
    return { minX: round(minX), maxX: round(maxX), minZ: round(minZ), maxZ: round(maxZ) };
}

function pointBbox(x, z, pad = 0) {
    return { minX: round(x - pad), maxX: round(x + pad), minZ: round(z - pad), maxZ: round(z + pad) };
}

const bboxArea = (b) => Math.max(0, (b.maxX - b.minX)) * Math.max(0, (b.maxZ - b.minZ));

function bboxIntersects(a, b) {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}

/**
 * 解析 bbox 查询参数 `minX,minZ,maxX,maxZ`（也接受对象）。
 * 强制要求 bbox —— 严禁整世界查询。
 */
function parseBbox(raw, { required = true, maxArea = LIMITS.maxBboxArea } = {}) {
    if (raw === undefined || raw === null || raw === '') {
        if (required) throw errors.bboxRequired();
        return null;
    }
    let arr;
    if (typeof raw === 'string') {
        arr = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    } else if (Array.isArray(raw)) {
        arr = raw;
    } else if (typeof raw === 'object') {
        arr = [raw.minX, raw.minZ, raw.maxX, raw.maxZ];
    } else {
        throw errors.invalid('bbox 格式应为 minX,minZ,maxX,maxZ', 'bbox');
    }
    if (arr.length !== 4) throw errors.invalid('bbox 需要 4 个数字：minX,minZ,maxX,maxZ', 'bbox');
    const nums = arr.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) throw errors.invalid('bbox 含非数字', 'bbox');
    const b = { minX: nums[0], minZ: nums[1], maxX: nums[2], maxZ: nums[3] };
    if (b.minX > b.maxX) { const t = b.minX; b.minX = b.maxX; b.maxX = t; }
    if (b.minZ > b.maxZ) { const t = b.minZ; b.minZ = b.maxZ; b.maxZ = t; }
    if (b.maxX - b.minX <= 0 || b.maxZ - b.minZ <= 0) throw errors.invalid('bbox 面积必须大于 0', 'bbox');
    if (maxArea && bboxArea(b) > maxArea) {
        throw errors.bboxTooLarge(`bbox 面积 ${Math.round(bboxArea(b))} 超过上限 ${maxArea}，请放大后重试`);
    }
    return b;
}

/** 点是否在环内（射线法） */
function pointInRing(x, z, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], zi = ring[i][1];
        const xj = ring[j][0], zj = ring[j][1];
        const intersect = ((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/** 点是否在多边形内（支持洞） */
function pointInPolygon(x, z, rings) {
    if (!rings || !rings.length) return false;
    if (!pointInRing(x, z, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(x, z, rings[i])) return false;
    return true;
}

function pointInGeometry(x, z, geometry) {
    if (!geometry) return false;
    switch (geometry.type) {
        case 'Point': return Math.abs(geometry.coordinates[0] - x) < 1e-6 && Math.abs(geometry.coordinates[1] - z) < 1e-6;
        case 'LineString': return distanceToLineString(x, z, geometry.coordinates).distance < 1e-6;
        case 'Polygon': return pointInPolygon(x, z, geometry.coordinates);
        case 'MultiPolygon': return geometry.coordinates.some((poly) => pointInPolygon(x, z, poly));
        default: return false;
    }
}

function distanceToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cz = az + t * dz;
    return { distance: Math.hypot(px - cx, pz - cz), t, x: cx, z: cz };
}

/** 点到折线的最短距离（返回距离与最近点） */
function distanceToLineString(x, z, coords) {
    let best = { distance: Infinity, x, z, segment: -1 };
    for (let i = 0; i < coords.length - 1; i++) {
        const r = distanceToSegment(x, z, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
        if (r.distance < best.distance) best = { distance: r.distance, x: r.x, z: r.z, segment: i };
    }
    return best;
}

/** 折线长度（方块） */
function lineLength(coords) {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += Math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1]);
    }
    return total;
}

/** 几何长度（LineString / MultiLineString）或面积（Polygon） */
function geometryMeasure(geometry) {
    if (!geometry) return { length: 0, area: 0 };
    if (geometry.type === 'LineString') return { length: round(lineLength(geometry.coordinates), 2), area: 0 };
    if (geometry.type === 'Polygon') {
        const outer = Math.abs(ringArea(geometry.coordinates[0]));
        const holes = geometry.coordinates.slice(1).reduce((s, r) => s + Math.abs(ringArea(r)), 0);
        return { length: 0, area: round(outer - holes, 2) };
    }
    if (geometry.type === 'MultiPolygon') {
        let area = 0, length = 0;
        for (const poly of geometry.coordinates) {
            area += Math.abs(ringArea(poly[0])) - poly.slice(1).reduce((s, r) => s + Math.abs(ringArea(r)), 0);
            poly.forEach((r) => { length += lineLength(r); });
        }
        return { length: round(length, 2), area: round(area, 2) };
    }
    return { length: 0, area: 0 };
}

/* ---------------- 几何简化（Douglas-Peucker） ---------------- */

function simplifyLine(points, tolerance) {
    if (points.length <= 2 || tolerance <= 0) return points;
    const sqTol = tolerance * tolerance;
    const keep = new Array(points.length).fill(false);
    keep[0] = true;
    keep[points.length - 1] = true;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop();
        let maxDist = -1, index = -1;
        for (let i = first + 1; i < last; i++) {
            const r = distanceToSegment(points[i][0], points[i][1], points[first][0], points[first][1], points[last][0], points[last][1]);
            const d = r.distance * r.distance;
            if (d > maxDist) { maxDist = d; index = i; }
        }
        if (maxDist > sqTol && index > 0) {
            keep[index] = true;
            stack.push([first, index], [index, last]);
        }
    }
    return points.filter((_, i) => keep[i]);
}

function simplifyRing(ring, tolerance) {
    if (ring.length <= 4 || tolerance <= 0) return ring;
    const open = ring.slice(0, ring.length - 1);
    const simplified = simplifyLine(open, tolerance);
    if (simplified.length < 3) return ring;
    const out = simplified.map((p) => p);
    out.push([out[0][0], out[0][1]]);
    return out;
}

/** 按缩放级别简化几何（zoom 越低简化越狠） */
function simplifyGeometry(geometry, zoom) {
    if (!geometry) return geometry;
    const z = Number.isFinite(Number(zoom)) ? Number(zoom) : 20;
    if (z >= 18) return geometry;
    const tolerance = Math.max(0.5, Math.pow(2, 18 - Math.max(0, z)) * 0.35);
    const mapLine = (line) => simplifyLine(line, tolerance);
    const mapRing = (ring) => simplifyRing(ring, tolerance);
    switch (geometry.type) {
        case 'LineString': return { type: 'LineString', coordinates: mapLine(geometry.coordinates) };
        case 'Polygon': return { type: 'Polygon', coordinates: geometry.coordinates.map(mapRing) };
        case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((p) => p.map(mapRing)) };
        default: return geometry;
    }
}

/** bbox 转多边形（供面积类查询使用） */
function bboxToPolygon(b) {
    return [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ], [b.minX, b.minZ]];
}

/** 两个对象的几何是否相交（用于重复检测：同一世界/维度/类型内 bbox 相交 + 几何相交） */
function geometriesIntersect(a, b) {
    if (!a || !b) return false;
    if (!bboxIntersects(computeBbox(a), computeBbox(b))) return false;
    const bboxPoly = (g) => {
        const bb = computeBbox(g);
        return { type: 'Polygon', coordinates: [bboxToPolygon(bb)] };
    };
    if (a.type === 'Point') {
        const [x, z] = a.coordinates;
        return pointInGeometry(x, z, b) || distanceToGeometry(x, z, b).distance < 1;
    }
    if (b.type === 'Point') return geometriesIntersect(b, a);
    if (a.type === 'Polygon' || a.type === 'MultiPolygon') {
        const polys = a.type === 'Polygon' ? [a.coordinates] : a.coordinates;
        const pts = countPoints((b.type === 'LineString' ? b.coordinates : b.coordinates), b.type);
        if (b.type === 'LineString') {
            for (const p of b.coordinates) if (polys.some((poly) => pointInPolygon(p[0], p[1], poly))) return true;
            for (const pp of polys) for (const p of pp[0]) if (pointInGeometry(p[0], p[1], b)) return true;
            return bboxIntersects(computeBbox(bboxPoly(a)), computeBbox(b)) && false;
        }
        const otherPolys = b.type === 'Polygon' ? [b.coordinates] : b.coordinates;
        for (const pa of polys) for (const pb of otherPolys) {
            if (pointInPolygon(pa[0][0][0], pa[0][0][1], pb)) return true;
            if (pointInPolygon(pb[0][0][0], pb[0][0][1], pa)) return true;
        }
        void pts;
        return false;
    }
    if (a.type === 'LineString' && b.type === 'LineString') {
        for (const p of a.coordinates) if (distanceToLineString(p[0], p[1], b.coordinates).distance < 1e-6) return true;
        for (const p of b.coordinates) if (distanceToLineString(p[0], p[1], a.coordinates).distance < 1e-6) return true;
    }
    return false;
}

function distanceToGeometry(x, z, geometry) {
    if (!geometry) return { distance: Infinity };
    if (geometry.type === 'Point') {
        return { distance: Math.hypot(geometry.coordinates[0] - x, geometry.coordinates[1] - z), x: geometry.coordinates[0], z: geometry.coordinates[1] };
    }
    if (geometry.type === 'LineString') return distanceToLineString(x, z, geometry.coordinates);
    if (geometry.type === 'Polygon') {
        let best = { distance: Infinity };
        for (const ring of geometry.coordinates) {
            for (let i = 0; i < ring.length - 1; i++) {
                const r = distanceToSegment(x, z, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
                if (r.distance < best.distance) best = { distance: r.distance, x: r.x, z: r.z };
            }
        }
        return best;
    }
    if (geometry.type === 'MultiPolygon') {
        let best = { distance: Infinity };
        for (const poly of geometry.coordinates) {
            const r = distanceToGeometry(x, z, { type: 'Polygon', coordinates: poly });
            if (r.distance < best.distance) best = r;
        }
        return best;
    }
    return { distance: Infinity };
}

/* ---------------- 文本清洗 ---------------- */

function safeText(v, max, field) {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string' && typeof v !== 'number') throw errors.invalid(`${field} 必须是字符串`, field);
    let s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    if (max && s.length > max) s = s.slice(0, max);
    return s;
}

function requiredName(v) {
    const s = safeText(v, LIMITS.maxNameLength, 'name');
    if (!s) throw errors.invalid('名称不能为空', 'name');
    if (s.length < 1) throw errors.invalid('名称至少 1 个字符', 'name');
    return s;
}

function parseId(v, field = 'id') {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw errors.invalid(`${field} 必须是正整数`, field);
    return n;
}

function parsePage(query = {}) {
    const { LIMITS } = require('./constants');
    let limit = Number(query.limit);
    if (!Number.isFinite(limit) || limit <= 0) limit = LIMITS.objectsPageDefault;
    limit = Math.min(Math.floor(limit), LIMITS.objectsPageMax);
    let page = Number(query.page);
    if (!Number.isFinite(page) || page <= 0) page = 1;
    return { limit, page, offset: (Math.floor(page) - 1) * limit };
}

module.exports = {
    isNum, round, normalizeGeometry, computeBbox, pointBbox, bboxArea, bboxIntersects, bboxToPolygon,
    parseBbox, pointInRing, pointInPolygon, pointInGeometry, distanceToSegment, distanceToLineString,
    distanceToGeometry, lineLength, ringArea, geometryMeasure, simplifyGeometry, geometriesIntersect,
    safeText, requiredName, parseId, parsePage
};
