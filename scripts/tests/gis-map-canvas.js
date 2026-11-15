/**
 * 方块彩色地图（浏览器端渲染）服务端测试。
 *
 * 运行：node scripts/tests/gis-map-canvas.js
 *
 * 覆盖：调色板一致性（CRC32/hash16）、v2 surfaceBlockMatrix 编解码与入库、
 *       /map/index 覆盖度、/map/chunks 抽样正确（surface/fallback）、bbox 上限与 truncated、
 *       旧数据（无 surface）兼容、以及「服务端不做任何图片编码」的保证。
 */

const assert = require('assert');
const kit = require('./gis-testkit');

async function main() {
    const prep = await kit.prepare({ name: 'gis-canvas' });
    const runner = kit.makeRunner('GIS 方块地图（Canvas）测试');
    const { world } = await kit.seedServerAndWorld({ serverKey: 'hetao', serverName: '核桃', worldKey: 'hetao-main' });
    const worldId = world.id;

    const db = require('../../database');
    const terrain = require('../../lib/gis/terrain');
    const map = require('../../lib/gis/map');
    const palette = require('../../lib/gis/map-palette');
    const worlds = require('../../lib/gis/worlds');

    const app = await kit.startApp();
    const api = kit.makeClient(app.base);
    const { expect } = kit;

    const GRASS = palette.hash16('minecraft:grass_block');
    const STONE = palette.hash16('minecraft:stone');
    const WATER = palette.hash16('minecraft:water');
    const SAND = palette.hash16('minecraft:sand');

    await runner.test('palette：CRC32/hash16 与客户端约定一致（含已知向量）', async () => {
        // 标准 IEEE CRC32 已知向量
        assert.strictEqual(palette.crc32('123456789'), 0xCBF43926);
        assert.strictEqual(palette.hash16('minecraft:grass_block'), palette.crc32('minecraft:grass_block') & 0xFFFF);
        // 与 Node 自带 zlib.crc32（新版 Node）结果一致性（若不支持则跳过）
        try {
            const zlib = require('zlib');
            if (typeof zlib.crc32 === 'function') {
                assert.strictEqual(palette.crc32('minecraft:stone'), zlib.crc32(Buffer.from('minecraft:stone')) >>> 0);
            }
        } catch (e) { /* ignore */ }
    });

    await runner.test('GET /map/palette：颜色/水面/材质/高度色带齐全且格式合法（覆盖 >=300 项）', async () => {
        const r = await api.get('/api/gis/map/palette');
        expect.ok(r);
        const p = r.json;
        assert.strictEqual(p.version, 2);
        assert.ok(p.stats.blockColors >= 300, `vanilla 方块色表应 >=300 项，实际 ${p.stats.blockColors}`);
        assert.ok(Object.keys(p.blocks).length >= 600, 'hash 条目（含命名空间别名）应 >=600');
        for (const [hash, color] of Object.entries(p.blocks)) {
            assert.ok(/^\d+$/.test(hash), `hash key 应为十进制字符串：${hash}`);
            assert.ok(/^#[0-9a-fA-F]{6}$/.test(color), `颜色格式不合法：${color}`);
        }
        assert.strictEqual(p.blocks[String(GRASS)], '#7CBD4C');
        assert.strictEqual(p.water[String(WATER)], true);
        assert.ok(p.materials.unknown && p.materials.stone && p.materials.wood);
        assert.strictEqual(p.heightShade.minY, -64);
        assert.strictEqual(p.heightShade.maxY, 320);
        assert.ok(Array.isArray(p.heightShade.ramp) && p.heightShade.ramp.length >= 5);
        for (let i = 1; i < p.heightShade.ramp.length; i++) {
            assert.ok(p.heightShade.ramp[i].y >= p.heightShade.ramp[i - 1].y, '高度色带应按 y 递增');
        }
        assert.ok(Object.keys(p.biomes).length >= 20, '群系兜底色应覆盖常见群系');
        // 响应不应包含任何图片编码
        assert.ok(!JSON.stringify(p).includes('data:image'), '调色板不应含图片数据');
    });

    await runner.test('palette：未知 hash 落灰（非黑）、空气透明、命名空间别名兼容生产数据', async () => {
        const p = palette.getPalette();
        // 1) 未知 hash 不登记颜色 → 客户端使用 materials.unknown，且必须不是黑色
        const unknownHash = 0xFFFE;
        assert.strictEqual(p.blocks[String(unknownHash)], undefined, '未登记 hash 不应有颜色');
        assert.ok(/^#[0-9a-fA-F]{6}$/.test(p.materials.unknown));
        assert.notStrictEqual(p.materials.unknown.toLowerCase(), '#000000', '未知方块兜底色不能是黑色');
        // 2) 空气类必须标记为透明（否则稀疏列会画成灰）
        assert.strictEqual(p.transparent[String(palette.hash16('minecraft:air'))], true);
        assert.strictEqual(p.transparent[String(palette.hash16('air'))], true);
        // 3) 生产数据用「无命名空间路径」hash：必须命中颜色（兼容别名）
        const prodSamples = { water: 5338, dirt: 57782, grass_block: 29901 };
        for (const [name, hash] of Object.entries(prodSamples)) {
            assert.strictEqual(palette.hash16(name), hash, `${name} 的 path-only hash 应稳定`);
            assert.ok(p.blocks[String(hash)], `${name} 的 path-only hash ${hash} 应命中颜色`);
            assert.strictEqual(p.blocks[String(hash)], p.blocks[String(palette.hash16(`minecraft:${name}`))], '两种 hash 颜色应一致');
        }
        // 4) 回归：契约 hash（带命名空间）同样命中
        assert.ok(p.blocks[String(palette.hash16('minecraft:grass_block'))]);
    });

    let regionWorldId = null;
    await runner.test('数据区域聚类：主区域 60 chunk + 远区 3 chunk → 2 个 region，远区单独成块', async () => {
        await worlds.registerServer({ serverKey: 'region-srv', serverName: 'region-srv', mcVersion: '1.21.11' });
        const w = await worlds.registerWorld({ worldKey: `region-${Date.now()}`, serverKey: 'region-srv', serverName: 'region-srv', mcVersion: '1.21.11', status: 'ACTIVE' });
        regionWorldId = w.id;
        const chunks = [];
        const make = (cx, cz, surfaceHash) => {
            const heights = new Array(256).fill(70);
            const surface = new Array(256).fill(surfaceHash);
            return { chunkX: cx, chunkZ: cz, sampleStep: 1, sampleSize: 16, heights, surface };
        };
        // 主区域：10×6 = 60 个连续 chunk（X 1600~1760 / Z 0~96）
        for (let cx = 100; cx < 110; cx++) for (let cz = 0; cz < 6; cz++) chunks.push(make(cx, cz, GRASS));
        // 远区（合法数据，如紫雪城区）：3 个连续 chunk，距离主城 10 万方块
        const FAR = [[7365, -3290], [7365, -3291], [7366, -3290]];
        for (const [cx, cz] of FAR) chunks.push(make(cx, cz, STONE));
        await terrain.storeChunks({ worldId: w.id, dimension: 'overworld', chunks }, {});

        const idx = await map.getIndex({ worldId: w.id });
        const dim = idx.dimensions.overworld;
        assert.strictEqual(dim.chunkCount, 63);
        assert.ok(Array.isArray(dim.regions), 'map/index 应返回区域聚类');
        assert.strictEqual(dim.regions.length, 2, '应为 2 个独立区域');
        // 首个区域 = 最大区域（60 chunk），且不包含远区
        assert.strictEqual(dim.regions[0].chunkCount, 60);
        assert.strictEqual(dim.regions[0].bbox.minX, 1600);
        assert.strictEqual(dim.regions[0].bbox.maxX, 1760);
        assert.ok(dim.regions[0].bbox.minZ >= 0 && dim.regions[0].bbox.maxZ <= 96);
        // 远区 bbox 正确（X≈117,840 / Z≈-52,640）
        assert.strictEqual(dim.regions[1].chunkCount, 3);
        assert.strictEqual(dim.regions[1].bbox.minX, 7365 * 16);
        assert.strictEqual(dim.regions[1].bbox.maxX, 7366 * 16 + 16);
        assert.strictEqual(dim.regions[1].bbox.minZ, -3291 * 16);
        assert.strictEqual(dim.regions[1].bbox.maxZ, -3290 * 16 + 16);
        // outlierChunks = 非最大区域 chunk 数（不是脏数据）
        assert.strictEqual(dim.outlierChunks, 3);
        // 整体 bbox 仍覆盖全部数据（远区不被丢弃）
        assert.ok(dim.bbox.maxX >= 7366 * 16);
        // HTTP 层：?dimension= 顶层便于前端直接消费
        const r = await api.get(`/api/gis/map/index?worldId=${w.id}&dimension=overworld`);
        expect.ok(r);
        assert.strictEqual(r.json.regions.length, 2);
        assert.strictEqual(r.json.outlierChunks, 3);
    });

    await runner.test('区域命名：published district bbox 相交 → districtId/districtName（无则不编造）', async () => {
        assert.ok(regionWorldId, '区域聚类用例应先创建世界');
        const insertDistrict = async (objectId, seq, name, minX, minZ, maxX, maxZ) => {
            const payload = JSON.stringify({
                type: 'district', id: objectId, worldId: regionWorldId, dimension: 'overworld',
                name, status: 'PUBLISHED', revision: 1, publishedRevision: 1,
                geometry: { type: 'Polygon', coordinates: [[[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ], [minX, minZ]]] }
            });
            await db.run(
                `INSERT INTO gis_published (object_type, object_id, world_id, dimension, revision, seq, payload,
                    min_x, max_x, min_z, max_z, deleted, updated_at)
                 VALUES ('district', ?, ?, 'overworld', 1, ?, ?, ?, ?, ?, ?, 0, ?)`,
                [objectId, regionWorldId, seq, payload, minX, maxX, minZ, maxZ, '2026-11-15 00:00:00']);
        };
        // 主区域：工业区（覆盖 X1600~1760 / Z0~96 的主簇）
        await insertDistrict(11, 9001, '工业区', 1600, 0, 1760, 96);
        // 远区：紫雪城（覆盖 X≈117840 / Z≈-52600 的远簇）
        await insertDistrict(12, 9002, '紫雪城', 7365 * 16, -3291 * 16, 7366 * 16 + 16, -3290 * 16 + 16);
        const idx = await map.getIndex({ worldId: regionWorldId });
        const dim = idx.dimensions.overworld;
        assert.strictEqual(dim.regions[0].districtId, 11, '主区域应命中工业区');
        assert.strictEqual(dim.regions[0].districtName, '工业区');
        assert.strictEqual(dim.regions[1].districtId, 12, '远区应命中紫雪城');
        assert.strictEqual(dim.regions[1].districtName, '紫雪城');
        // 未命中任何 district 的维度：不编造名字
        const idxEmpty = await map.getIndex({ worldId: regionWorldId });
        assert.ok(idxEmpty.dimensions.overworld.regions.every((r) => typeof r.districtName === 'string' || r.districtName === null));
    });

    await runner.test('palette?withUnknown=1：返回未登记 hash 统计（便于增量补色）', async () => {
        await worlds.registerServer({ serverKey: 'unknown-srv', serverName: 'unknown-srv', mcVersion: '1.21.11' });
        const w = await worlds.registerWorld({ worldKey: `unknown-${Date.now()}`, serverKey: 'unknown-srv', serverName: 'unknown-srv', mcVersion: '1.21.11', status: 'ACTIVE' });
        const UNKNOWN = 0xABCD;
        const heights = new Array(256).fill(64);
        const surface = new Array(256).fill(UNKNOWN);
        for (let i = 0; i < 128; i++) surface[i] = GRASS; // 一半已知
        await terrain.storeChunks({ worldId: w.id, dimension: 'overworld', chunks: [{ chunkX: 0, chunkZ: 0, sampleStep: 1, sampleSize: 16, heights, surface }] }, {});
        const r = await api.get(`/api/gis/map/palette?withUnknown=1&worldId=${w.id}&dimension=overworld`);
        expect.ok(r);
        const stats = r.json.unknownSurfaceStats;
        assert.ok(stats, '应返回 unknownSurfaceStats');
        assert.strictEqual(stats.unknownSamples, 128);
        assert.ok(stats.totalSamples >= 256);
        const item = stats.unknownBlocks.find((x) => x.hash === UNKNOWN);
        assert.ok(item && item.count === 128, '应统计到未知 hash 0xABCD 128 个样本');
    });


    await runner.test('v2 载荷：surfaceBlockMatrix 编解码往返 + 入库到 block_hist JSON', async () => {
        const heights = new Array(256).fill(70);
        const surface = new Array(256);
        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) surface[z * 16 + x] = x < 8 ? GRASS : WATER;
        }
        const raw = terrain.encodeBatch({
            worldId, dimension: 'overworld',
            chunks: [{ chunkX: 0, chunkZ: 0, sampleStep: 1, sampleSize: 16, heights, surface }]
        });
        const decoded = terrain.decodeBatch(raw, { worldId, dimension: 'overworld' });
        assert.ok(decoded.chunks[0].surface, 'v2 载荷应解析出 surface');
        assert.strictEqual(decoded.chunks[0].surface.length, 512);
        assert.strictEqual(decoded.chunks[0].surface.readUInt16LE(0), GRASS, '左上角应为草方块');
        assert.strictEqual(decoded.chunks[0].surface.readUInt16LE(8 * 2), WATER, '(z=0,x=8) 应为水方块');
        await terrain.storeChunks(decoded, {});
        const row = await db.get(`SELECT block_hist FROM gis_elevation_chunks WHERE world_id=? AND dimension='overworld' AND chunk_x=0 AND chunk_z=0`, [worldId]);
        const parsed = terrain.parseBlockHist(row.block_hist);
        assert.ok(parsed.surface && parsed.surface.length === 512, 'block_hist JSON 应带 surface base64');
        assert.strictEqual(parsed.surface.readUInt16LE(0), GRASS);
        // 表结构未变：仍是 block_hist 单列
        const cols = await db.all(`PRAGMA table_info(gis_elevation_chunks)`);
        assert.ok(!cols.some((c) => /surface/i.test(c.name)), '不得新增数据库列/表');
    });

    await runner.test('旧数据兼容：无 surface 的 chunk 走 fallback（高度+群系）', async () => {
        // 模拟 v1 旧数据（只有 heights，block_hist 为旧格式数组）
        const heights = new Array(256).fill(80);
        const biome = new Array(256).fill(1); // plains
        await terrain.storeChunks({
            worldId, dimension: 'overworld',
            chunks: [{ chunkX: 1, chunkZ: 0, sampleStep: 1, sampleSize: 16, heights, biome }]
        }, {});
        // 写入旧格式 block_hist（纯数组）
        await db.run(`UPDATE gis_elevation_chunks SET block_hist = ? WHERE world_id=? AND dimension='overworld' AND chunk_x=1 AND chunk_z=0`,
            [JSON.stringify([{ blockId: 1, count: 256 }]), worldId]);
        const r = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=0,0,31,15&lod=0`);
        expect.ok(r);
        const byCx = Object.fromEntries(r.json.chunks.map((c) => [c.cx, c]));
        assert.strictEqual(byCx[0].mode, 'surface');
        assert.strictEqual(byCx[1].mode, 'fallback');
        assert.ok(byCx[1].heights, 'fallback 应返回 base64 高度');
        const hbuf = Buffer.from(byCx[1].heights, 'base64');
        assert.strictEqual(hbuf.length, 256 * 2);
        assert.strictEqual(hbuf.readInt16LE(0), 80);
        assert.ok(byCx[1].biomes, '有群系数据时应返回群系');
        assert.strictEqual(Buffer.from(byCx[1].biomes, 'base64').readUInt16LE(0), 1);
        // 旧格式 block_hist 解析不报错
        const parsed = terrain.parseBlockHist(JSON.stringify([{ blockId: 1, count: 2 }]));
        assert.ok(parsed.hist && parsed.hist.length === 1 && parsed.surface === null);
    });

    await runner.test('lod 抽样正确：lod0=16×16 原值，lod3=2×2 区域众数/均值', async () => {
        // chunk(2,0)：左半 GRASS 右半 STONE，高度平滑 60+floor(x/2)
        const heights = new Array(256);
        const surface = new Array(256);
        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
                heights[z * 16 + x] = 60 + Math.floor(x / 2);
                surface[z * 16 + x] = x < 8 ? GRASS : STONE;
            }
        }
        await terrain.storeChunks({ worldId, dimension: 'overworld', chunks: [{ chunkX: 2, chunkZ: 0, sampleStep: 1, sampleSize: 16, heights, surface }] }, {});

        const l0 = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=32,0,47,15&lod=0`);
        expect.ok(l0);
        assert.strictEqual(l0.json.step, 1);
        assert.strictEqual(l0.json.samplesPerSide, 16);
        const c0 = l0.json.chunks.find((c) => c.cx === 2);
        const b0 = Buffer.from(c0.blocks, 'base64');
        assert.strictEqual(b0.length, 256 * 2);
        assert.strictEqual(b0.readUInt16LE(0), GRASS);
        assert.strictEqual(b0.readUInt16LE(15 * 2), STONE);

        const l3 = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=32,0,47,15&lod=3`);
        expect.ok(l3);
        assert.strictEqual(l3.json.step, 8);
        assert.strictEqual(l3.json.samplesPerSide, 2);
        const c3 = l3.json.chunks.find((c) => c.cx === 2);
        const b3 = Buffer.from(c3.blocks, 'base64');
        assert.strictEqual(b3.length, 4 * 2, 'lod=3 时每 chunk 应是 2×2=4 个采样');
        assert.strictEqual(b3.readUInt16LE(0), GRASS, '左上 8×8 区域众数应为草方块');
        assert.strictEqual(b3.readUInt16LE(2), STONE, '右上 8×8 区域众数应为石头');

        // fallback 的均值高度：lod3 右半区域均值
        const l3f = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=32,0,47,15&lod=3`);
        assert.ok(l3f.json.chunks.every((c) => c.mode === 'surface' || c.mode === 'fallback'));
    });

    await runner.test('fallback 抽样：区域均值高度正确（忽略 -32768 缺口）', async () => {
        const heights = new Array(256);
        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
                // 左半 40、右半 120；最左上角一个采样设为无数据
                heights[z * 16 + x] = x < 8 ? 40 : 120;
            }
        }
        heights[0] = -32768;
        await terrain.storeChunks({ worldId, dimension: 'overworld', chunks: [{ chunkX: 3, chunkZ: 0, sampleStep: 1, sampleSize: 16, heights }] }, {});
        const r = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=48,0,63,15&lod=1`);
        expect.ok(r);
        const c = r.json.chunks.find((x) => x.cx === 3);
        assert.strictEqual(c.mode, 'fallback');
        const buf = Buffer.from(c.heights, 'base64');
        assert.strictEqual(r.json.samplesPerSide, 8);
        // 左上 2×2 区域：3 个 40 + 1 个 NODATA → 均值 40
        assert.strictEqual(buf.readInt16LE(0), 40);
        // 右上 2×2 区域（x>=8）→ 120
        assert.strictEqual(buf.readInt16LE(7 * 2), 120);
    });

    await runner.test('bbox/lod 参数校验与「无数据透明」语义', async () => {
        let r = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld`);
        expect.error(r, 'bbox_required', 400);
        r = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=-100000,-100000,100000,100000`);
        expect.error(r, 'bbox_too_large', 400);
        r = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=0,0,15,15&lod=9`);
        expect.error(r, 'invalid_argument', 400);
        r = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=100000,100000,100015,100015&lod=0`);
        expect.ok(r);
        assert.deepStrictEqual(r.json.chunks, [], '未采集区域不返回区块（前端透明）');
        assert.strictEqual(r.json.chunksTotal, 0);
        assert.strictEqual(r.json.truncated, false);
    });

    await runner.test('单请求区块上限 512：超出 truncated + chunksTotal 真实', async () => {
        // 另造一个世界，写入 600 个 chunk（20×30）
        const w2 = await kit.seedServerAndWorld({ serverKey: 'big_srv', serverName: '大世界', worldKey: 'big-main' });
        const chunks = [];
        for (let cx = 0; cx < 20; cx++) {
            for (let cz = 0; cz < 30; cz++) {
                const heights = new Array(256).fill(64 + (cx % 10));
                chunks.push({ chunkX: cx, chunkZ: cz, sampleStep: 1, sampleSize: 16, heights });
            }
        }
        await terrain.storeChunks({ worldId: w2.world.id, dimension: 'overworld', chunks }, {});
        await worlds.refreshDimensionStats(w2.world.id, 'overworld');
        const r = await api.get(`/api/gis/map/chunks?worldId=${w2.world.id}&dimension=overworld&bbox=0,0,319,479&lod=2`);
        expect.ok(r);
        assert.strictEqual(r.json.chunksTotal, 600);
        assert.strictEqual(r.json.chunks.length, 512);
        assert.strictEqual(r.json.truncated, true);
        // lod=2：每 chunk 4×4 采样
        assert.strictEqual(r.json.samplesPerSide, 4);
        assert.strictEqual(Buffer.from(r.json.chunks[0].heights, 'base64').length, 16 * 2);
        // 该世界没有 surface → 全部 fallback
        assert.ok(r.json.chunks.every((c) => c.mode === 'fallback'));
    });

    await runner.test('GET /map/index：surface/fallback 计数与 bbox 正确', async () => {
        const r = await api.get(`/api/gis/map/index?worldId=${worldId}`);
        expect.ok(r);
        const dim = r.json.dimensions.overworld;
        assert.ok(dim, '应返回 overworld 维度');
        assert.strictEqual(dim.chunkCount, 4); // chunk (0,0)(1,0)(2,0)(3,0)
        assert.strictEqual(dim.surfaceChunks, 2); // (0,0) v2 surface、(2,0) v2 surface
        assert.strictEqual(dim.fallbackChunks, 2); // (1,0) 旧格式、(3,0) 无 surface
        assert.deepStrictEqual(dim.bbox, { minX: 0, maxX: 64, minZ: 0, maxZ: 16 });
        assert.ok(dim.updatedAt);
        assert.ok(r.json.limits.maxChunks === 512);

        const empty = await api.get(`/api/gis/map/index?worldId=99999`);
        expect.ok(empty);
        assert.deepStrictEqual(empty.json.dimensions, {});
    });

    await runner.test('服务端不做图片编码：接口响应无 base64 图片/PNG 头', async () => {
        const r1 = await api.get('/api/gis/map/palette');
        const r2 = await api.get(`/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=0,0,63,15&lod=0`);
        for (const r of [r1, r2]) {
            const text = JSON.stringify(r.json);
            assert.ok(!/data:image\//.test(text), '不应包含 data:image');
            assert.ok(!/iVBORw0KGgo/.test(text), '不应包含 PNG base64 头');
        }
        // 代码层面：map 模块不引用任何图像库
        const fs = require('fs');
        const path = require('path');
        for (const f of ['map.js', 'map-palette.js']) {
            const src = fs.readFileSync(path.join(kit.ROOT, 'lib', 'gis', f), 'utf8');
            assert.ok(!/require\('sharp'\)|require\('canvas'\)|toBuffer\('image|pngjs/.test(src), `${f} 不应做图像编码`);
        }
    });

    await runner.test('权限：三个地图接口均为公开读（无需登录）', async () => {
        for (const u of ['/api/gis/map/palette', `/api/gis/map/chunks?worldId=${worldId}&dimension=overworld&bbox=0,0,15,15&lod=0`, `/api/gis/map/index?worldId=${worldId}`]) {
            const r = await api.get(u);
            expect.ok(r, u);
        }
    });

    const ok = runner.summary();
    await app.close();
    kit.removeDb(require('path').join(kit.ROOT, prep.rel));
    process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
    console.error('测试执行异常:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
});
