/**
 * Mc 方块彩色地图图层（浏览器端实时渲染，服务端只出区块数据）。
 *
 * 实现要点（见 docs/gis-canvas-map.md）：
 *  - `L.GridLayer` 子类，每个 256×256 tile 用 Canvas 绘制，逐像素着色（ImageData，性能友好）；
 *  - CRS.Simple：`lat = -z, lng = x`，zoom z 时每方块 2^z 像素；
 *    tile 覆盖方块范围 = [tileX*256/2^z, (tileX+1)*256/2^z]，lod = clamp(-z, 0, 6)；
 *  - 仅按视口请求 `/api/gis/map/chunks`（bbox = tile ∩ 数据范围），不会全图加载；
 *  - 双层 LRU：tile canvas（≤256）+ chunk 数据（≤4096），平移回来不重复请求；缺失数据透明；
 *  - 颜色只来自 `/api/gis/map/palette`（服务端唯一配色来源），前端不做硬编码。
 */

const TILE_SIZE = 256;
const MAX_TILE_CACHE = 256;
const MAX_CHUNK_CACHE = 4096;
const MAX_LOD = 6;
const MAX_BBOX_AREA = 4000000;
const MAX_CHUNKS = 512;
const NODATA_I16 = -32768;
const NODATA_U16 = 0xFFFF;

/**
 * 模块级共享区块缓存：跨图层实例复用（关闭/开启图层、切换调色板、世界/维度切换后返回时不重复请求）。
 * key = `${worldId}:${dimension}:${lod}:${cx}:${cz}`，LRU 上限 MAX_CHUNK_CACHE。
 */
const SHARED_CHUNK_CACHE = new Map();
// 便于排障/端到端验收观察缓存规模（只读句柄）
if (typeof window !== 'undefined') window.__GIS_BLOCK_CACHE__ = SHARED_CHUNK_CACHE;
function sharedCacheSet(key, value) {
    if (SHARED_CHUNK_CACHE.has(key)) SHARED_CHUNK_CACHE.delete(key);
    SHARED_CHUNK_CACHE.set(key, value);
    while (SHARED_CHUNK_CACHE.size > MAX_CHUNK_CACHE) {
        SHARED_CHUNK_CACHE.delete(SHARED_CHUNK_CACHE.keys().next().value);
    }
}

/** 颜色 "#RRGGBB" → ABGR uint32（ImageData 小端） */
function hexToU32(hex, alpha = 255) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return 0;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

/** 高度色带取色（palette.heightShade.ramp） */
function makeHeightColor(rampU32) {
    return (y) => {
        if (!rampU32.length) return 0;
        if (y <= rampU32[0].y) return rampU32[0].u32;
        for (let i = 1; i < rampU32.length; i++) {
            if (y <= rampU32[i].y) {
                const a = rampU32[i - 1], b = rampU32[i];
                const t = (y - a.y) / Math.max(1, b.y - a.y);
                return mixU32(a.u32, b.u32, t);
            }
        }
        return rampU32[rampU32.length - 1].u32;
    };
}

function mixU32(a, b, t) {
    const ar = a & 0xFF, ag = (a >>> 8) & 0xFF, ab = (a >>> 16) & 0xFF;
    const br = b & 0xFF, bg = (b >>> 8) & 0xFF, bb = (b >>> 16) & 0xFF;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return ((0xFF << 24) | (bl << 16) | (g << 8) | r) >>> 0;
}

/** 按因子变暗/变亮（用于水面降对比、阴影） */
function shadeU32(u32, factor) {
    const r = Math.round(clamp((u32 & 0xFF) * factor, 0, 255));
    const g = Math.round(clamp(((u32 >>> 8) & 0xFF) * factor, 0, 255));
    const b = Math.round(clamp(((u32 >>> 16) & 0xFF) * factor, 0, 255));
    return ((0xFF << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** 构建一次调色板的运行时索引（颜色→uint32） */
function buildPaletteIndex(palette) {
    if (!palette) return null;
    const blocks = {};
    for (const [hash, color] of Object.entries(palette.blocks || {})) blocks[hash] = hexToU32(color);
    const water = {};
    for (const hash of Object.keys(palette.water || {})) water[hash] = true;
    const materials = {};
    for (const [k, v] of Object.entries(palette.materials || {})) materials[k] = hexToU32(v);
    const biomes = {};
    for (const [k, v] of Object.entries(palette.biomes || {})) biomes[k] = hexToU32(v);
    const ramp = (palette.heightShade && palette.heightShade.ramp ? palette.heightShade.ramp : [])
        .map((r) => ({ y: Number(r.y), u32: hexToU32(r.color) }));
    return {
        blocks, water, materials, biomes, ramp,
        waterU32: materials.water || hexToU32('#3C6ECC'),
        unknownU32: materials.unknown || hexToU32('#7A7A7A'),
        heightColor: makeHeightColor(ramp)
    };
}

/**
 * 创建方块地图图层类（需要 Leaflet 实例 L）。
 * @param {object} L Leaflet 命名空间
 * @param {object} options { worldId, dimension, palette, dataBbox, onStats }
 */
export function createBlockLayer(L, options = {}) {
    const Layer = L.GridLayer.extend({
        options: {
            tileSize: TILE_SIZE,
            minZoom: -8,
            maxZoom: 6,
            updateWhenIdle: true,
            keepBuffer: 2,
            zIndex: 0,
            opacity: 1,
            className: 'gis-block-tiles'
        },

        initialize(opts) {
            L.setOptions(this, opts);
            this._canvasCache = new Map();   // tileKey → canvas
            this._chunkCache = SHARED_CHUNK_CACHE; // 跨实例共享的 chunk 数据 LRU
            this._pending = new Map();       // requestKey → Promise
            this._paletteIndex = buildPaletteIndex(this.options.palette);
            this.stats = { tiles: 0, requests: 0, cacheHits: 0, chunks: 0, lastMs: 0 };
        },

        /** 数据范围（MC 方块）变化时更新并重绘 */
        setDataBbox(bbox) {
            this.options.dataBbox = bbox || null;
            this._canvasCache.clear();
            this.redraw();
        },

        setPaletteIndex(palette) {
            this._paletteIndex = buildPaletteIndex(palette);
            this.options.palette = palette;
            this._canvasCache.clear();
            this.redraw();
        },

        /** LRU 写入 */
        _cacheSet(map, key, value, max) {
            if (map.has(key)) map.delete(key);
            map.set(key, value);
            while (map.size > max) {
                const first = map.keys().next().value;
                map.delete(first);
            }
        },

        _chunkKey(lod, cx, cz) {
            return `${this.options.worldId}:${this.options.dimension || 'overworld'}:${lod}:${cx}:${cz}`;
        },

        /** 计算 tile 对应 MC 方块范围 */
        _tileBBox(coords) {
            const scale = Math.pow(2, coords.z);
            return {
                minX: (coords.x * TILE_SIZE) / scale,
                maxX: ((coords.x + 1) * TILE_SIZE) / scale,
                minZ: (coords.y * TILE_SIZE) / scale,
                maxZ: ((coords.y + 1) * TILE_SIZE) / scale
            };
        },

        /** 请求区块数据（带 chunk 级缓存 + 并发去重） */
        async _loadChunks(tileBBox, lod) {
            const dataBbox = this.options.dataBbox;
            let box = tileBBox;
            if (dataBbox) {
                box = {
                    minX: Math.max(box.minX, dataBbox.minX),
                    maxX: Math.min(box.maxX, dataBbox.maxX),
                    minZ: Math.max(box.minZ, dataBbox.minZ),
                    maxZ: Math.min(box.maxZ, dataBbox.maxZ)
                };
                if (box.minX >= box.maxX || box.minZ >= box.maxZ) return { chunks: [], truncated: false, empty: true };
            }
            // 面积上限 + 区块数上限：超限时收缩到 tile 中心区域（其余透明，放大后自动补全）
            let w = box.maxX - box.minX;
            let h = box.maxZ - box.minZ;
            if (w * h > MAX_BBOX_AREA) {
                const half = Math.sqrt(MAX_BBOX_AREA) / 2;
                const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
                box = { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half };
                w = box.maxX - box.minX; h = box.maxZ - box.minZ;
            }
            const spanChunks = Math.ceil(w / 16) * Math.ceil(h / 16);
            if (spanChunks > MAX_CHUNKS) {
                // 收缩到限制内：以中心取约 22×22 chunk
                const side = Math.floor(Math.sqrt(MAX_CHUNKS)) * 16;
                const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
                box = { minX: cx - side / 2, maxX: cx + side / 2, minZ: cz - side / 2, maxZ: cz + side / 2 };
            }
            const minCx = Math.floor(box.minX / 16), maxCx = Math.floor((box.maxX - 1e-9) / 16);
            const minCz = Math.floor(box.minZ / 16), maxCz = Math.floor((box.maxZ - 1e-9) / 16);
            const missing = [];
            for (let cx = minCx; cx <= maxCx; cx++) {
                for (let cz = minCz; cz <= maxCz; cz++) {
                    if (!this._chunkCache.has(this._chunkKey(lod, cx, cz))) missing.push({ cx, cz });
                }
            }
            // 全命中缓存：0 请求
            if (!missing.length) {
                this.stats.cacheHits++;
                const chunks = [];
                for (let cx = minCx; cx <= maxCx; cx++) {
                    for (let cz = minCz; cz <= maxCz; cz++) {
                        const c = this._chunkCache.get(this._chunkKey(lod, cx, cz));
                        if (c) chunks.push(c);
                    }
                }
                return { chunks, truncated: false, cached: true };
            }
            const qs = new URLSearchParams({
                worldId: String(this.options.worldId),
                dimension: this.options.dimension || 'overworld',
                bbox: `${Math.floor(box.minX)},${Math.floor(box.minZ)},${Math.ceil(box.maxX)},${Math.ceil(box.maxZ)}`,
                lod: String(lod)
            });
            const key = qs.toString();
            if (this._pending.has(key)) return this._pending.get(key);
            const promise = (async () => {
                const resp = await fetch(`/api/gis/map/chunks?${key}`, { headers: { Accept: 'application/json' } });
                if (!resp.ok) {
                    let msg = `HTTP ${resp.status}`;
                    try { const j = await resp.json(); msg = j.message || j.error || msg; } catch (e) { /* ignore */ }
                    throw new Error(msg);
                }
                const data = await resp.json();
                this.stats.requests++;
                const chunks = [];
                for (const c of data.chunks || []) {
                    const decoded = this._decodeChunk(c);
                    if (!decoded) continue;
                    sharedCacheSet(this._chunkKey(lod, c.cx, c.cz), decoded);
                    chunks.push(decoded);
                }
                this.stats.chunks += chunks.length;
                return { chunks, truncated: !!data.truncated };
            })().finally(() => { this._pending.delete(key); });
            this._pending.set(key, promise);
            return promise;
        },

        /** base64 → 采样数组（mode/blocks|heights/biomes） */
        _decodeChunk(c) {
            const perSide = Number(c.samplesPerSide) || 16;
            const size = perSide * perSide;
            const out = { cx: c.cx, cz: c.cz, perSide, mode: c.mode, step: Number(c.step) || 1 };
            try {
                if (c.mode === 'surface' && c.blocks) {
                    const b = atob(c.blocks);
                    const buf = new Uint8Array(b.length);
                    for (let i = 0; i < b.length; i++) buf[i] = b.charCodeAt(i);
                    if (buf.length < size * 2) return null;
                    out.values = new Uint16Array(size);
                    for (let i = 0; i < size; i++) out.values[i] = buf[i * 2] | (buf[i * 2 + 1] << 8);
                } else if (c.heights) {
                    const b = atob(c.heights);
                    const buf = new Uint8Array(b.length);
                    for (let i = 0; i < b.length; i++) buf[i] = b.charCodeAt(i);
                    if (buf.length < size * 2) return null;
                    out.values = new Int16Array(size);
                    for (let i = 0; i < size; i++) {
                        const v = buf[i * 2] | (buf[i * 2 + 1] << 8);
                        out.values[i] = v >= 0x8000 ? v - 0x10000 : v;
                    }
                    if (c.biomes) {
                        const bb = atob(c.biomes);
                        const bbBuf = new Uint8Array(bb.length);
                        for (let i = 0; i < bb.length; i++) bbBuf[i] = bb.charCodeAt(i);
                        if (bbBuf.length >= size * 2) {
                            out.biomes = new Uint16Array(size);
                            for (let i = 0; i < size; i++) out.biomes[i] = bbBuf[i * 2] | (bbBuf[i * 2 + 1] << 8);
                        }
                    }
                } else {
                    return null;
                }
            } catch (e) {
                return null;
            }
            return out;
        },

        /** 绘制一个 tile 到 canvas（异步数据就绪后回调） */
        createTile(coords, done) {
            const tile = document.createElement('canvas');
            tile.width = TILE_SIZE;
            tile.height = TILE_SIZE;
            tile.className = 'gis-block-tile';
            const ctx = tile.getContext('2d', { willReadFrequently: false });
            if (!ctx) { setTimeout(() => done(null, tile), 0); return tile; }

            const tileKey = `${this.options.worldId}:${this.options.dimension}:${coords.z}/${coords.x}/${coords.y}`;
            const cached = this._canvasCache.get(tileKey);
            if (cached) {
                this.stats.cacheHits++;
                ctx.drawImage(cached, 0, 0);
                setTimeout(() => done(null, tile), 0);
                return tile;
            }

            const lod = clamp(-coords.z, 0, MAX_LOD);
            const bbox = this._tileBBox(coords);
            const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

            this._loadChunks(bbox, lod).then((result) => {
                if (!this.options || this.options.enabled === false) { done(null, tile); return; }
                const paintStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                try {
                    this._paint(ctx, bbox, coords.z, result.chunks || []);
                } catch (e) { /* 绘制失败保持透明 */ }
                const paintMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - paintStart;
                const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
                this.stats.lastMs = Math.round(ms * 10) / 10;
                this.stats.paintMs = Math.round(paintMs * 10) / 10;
                this.stats.paintMaxMs = Math.max(this.stats.paintMaxMs || 0, this.stats.paintMs);
                this.stats.tiles++;
                this._cacheSet(this._canvasCache, tileKey, tile, MAX_TILE_CACHE);
                this.stats.chunkCacheSize = this._chunkCache.size;
                if (this.options.onStats) {
                    try { this.options.onStats({ ...this.stats, truncated: !!result.truncated }); } catch (e) { /* ignore */ }
                }
                done(null, tile);
            }).catch(() => { done(null, tile); });
            return tile;
        },

        /** 逐像素着色到 canvas */
        _paint(ctx, tileBBox, zoom, chunks) {
            const p = this._paletteIndex;
            if (!p) return;
            const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
            const px = new Uint32Array(img.data.buffer);
            const blockPx = Math.pow(2, zoom); // 每方块像素（zoom<0 时 <1）
            for (const chunk of chunks) {
                const chunkWorldX = chunk.cx * 16;
                const chunkWorldZ = chunk.cz * 16;
                const basePx = Math.round((chunkWorldX - tileBBox.minX) * blockPx);
                const basePy = Math.round((chunkWorldZ - tileBBox.minZ) * blockPx);
                const sampleBlocks = 16 / chunk.perSide;
                const cellPx = Math.max(1, Math.round(sampleBlocks * blockPx));
                for (let sz = 0; sz < chunk.perSide; sz++) {
                    for (let sx = 0; sx < chunk.perSide; sx++) {
                        const idx = sz * chunk.perSide + sx;
                        let color = 0;
                        if (chunk.mode === 'surface') {
                            const hash = chunk.values[idx];
                            if (hash === NODATA_U16) continue;
                            color = p.blocks[hash];
                            if (!color) color = p.unknownU32;
                            if (p.water[hash]) color = shadeU32(color, 0.78); // 水面降对比
                        } else {
                            const height = chunk.values[idx];
                            if (height === NODATA_I16) continue;
                            const biome = chunk.biomes ? chunk.biomes[idx] : NODATA_U16;
                            color = (biome !== NODATA_U16 && p.biomes[String(biome)]) ? p.biomes[String(biome)] : p.heightColor(height);
                            // 简单明暗：用右/下邻居高差做假阴影（只读同一 chunk，安全）
                            const rightIdx = sx + 1 < chunk.perSide ? idx + 1 : idx;
                            const downIdx = sz + 1 < chunk.perSide ? idx + chunk.perSide : idx;
                            const hr = chunk.values[rightIdx], hd = chunk.values[downIdx];
                            if (hr !== NODATA_I16 && hd !== NODATA_I16) {
                                const diff = (hr - height) + (hd - height);
                                color = shadeU32(color, clamp(1 + diff * 0.012, 0.72, 1.18));
                            }
                        }
                        if (!color) continue;
                        const x0 = basePx + sx * cellPx;
                        const y0 = basePy + sz * cellPx;
                        for (let dy = 0; dy < cellPx; dy++) {
                            const y = y0 + dy;
                            if (y < 0 || y >= TILE_SIZE) continue;
                            const rowOff = y * TILE_SIZE;
                            for (let dx = 0; dx < cellPx; dx++) {
                                const x = x0 + dx;
                                if (x < 0 || x >= TILE_SIZE) continue;
                                px[rowOff + x] = color;
                            }
                        }
                    }
                }
            }
            ctx.putImageData(img, 0, 0);
        }
    });
    return new Layer(options);
}

export const BLOCK_LAYER_CONSTANTS = { TILE_SIZE, MAX_LOD, MAX_BBOX_AREA, MAX_CHUNKS, MAX_TILE_CACHE, MAX_CHUNK_CACHE };
export default createBlockLayer;
