/**
 * GIS 地形单元测试：二进制协议、真实高程采样、等高线、坡度/剖面/统计的正确性与「无数据不伪造」。
 *
 * 运行：node scripts/tests/gis-terrain-test.js
 */

const assert = require('assert');
const kit = require('./gis-testkit');

async function main() {
    const prep = await kit.prepare({ name: 'gis-terrain' });
    const runner = kit.makeRunner('GIS 地形测试');
    const { world } = await kit.seedServerAndWorld({ serverKey: 'yl', serverName: '樱梨' });
    const worldId = world.id;
    const terrain = require('../../lib/gis/terrain');
    const geo = require('../../lib/gis/geo');
    const worlds = require('../../lib/gis/worlds');

    // 一块 4x4 chunk（64x64 方块）的平滑斜坡：高度 = 64 + floor(x/2)（约 26.57°）
    const rampChunks = () => {
        const chunks = [];
        for (let cx = 0; cx < 4; cx++) {
            for (let cz = 0; cz < 4; cz++) {
                const heights = new Array(256);
                for (let z = 0; z < 16; z++) {
                    for (let x = 0; x < 16; x++) {
                        const wx = cx * 16 + x;
                        heights[z * 16 + x] = 64 + Math.floor(wx / 2);
                    }
                }
                chunks.push({ chunkX: cx, chunkZ: cz, sampleStep: 1, sampleSize: 16, heights });
            }
        }
        return chunks;
    };

    await runner.test('二进制协议 encode/decode 往返：数值与 -32768 缺口都保留（zstd/gzip）', async () => {
        const heights = new Array(256).fill(0);
        for (let i = 0; i < 256; i++) heights[i] = i < 10 ? -32768 : (60 + i);
        const chunks = [{ chunkX: -3, chunkZ: 7, sampleStep: 1, sampleSize: 16, heights }];
        const raw = terrain.encodeBatch({ worldId, dimension: 'overworld', chunks });
        const z = require('zlib').zstdCompressSync(raw);
        const gz = require('zlib').gzipSync(raw);
        for (const [buf, enc] of [[z, 'zstd'], [gz, 'gzip']]) {
            const decoded = terrain.decodeBatch(buf, { contentEncoding: enc, worldId, dimension: 'overworld' });
            assert.strictEqual(decoded.chunks.length, 1);
            const c = decoded.chunks[0];
            assert.strictEqual(c.chunkX, -3);
            assert.strictEqual(c.chunkZ, 7);
            assert.strictEqual(c.hasGaps, 1, '缺口必须被记录');
            for (let i = 0; i < 10; i++) assert.strictEqual(c.heights.readInt16LE(i * 2), -32768, '缺口必须保持 NODATA');
            for (let i = 10; i < 256; i++) assert.strictEqual(c.heights.readInt16LE(i * 2), 60 + i);
        }
    });

    await runner.test('协议校验：magic/version/sampleSize/sampleStep/截断 都被拒', async () => {
        const good = terrain.encodeBatch({
            worldId, dimension: 'overworld',
            chunks: [{ chunkX: 0, chunkZ: 0, sampleStep: 1, sampleSize: 16, heights: new Array(256).fill(64) }]
        });
        // magic
        const badMagic = Buffer.from(good);
        badMagic.write('XXXXX', 0, 'ascii');
        assert.throws(() => terrain.decodeBatch(badMagic), /magic/);
        // version
        const badVersion = Buffer.from(good);
        badVersion.writeUInt8(9, 5);
        assert.throws(() => terrain.decodeBatch(badVersion), /载荷版本/);
        // sampleSize 与 sampleStep 不匹配（16/2=8），字段偏移：chunk 记录起点 20 + 8
        const badSize = Buffer.from(good);
        badSize.writeUInt8(2, 20 + 8);   // sampleStep=2
        assert.throws(() => terrain.decodeBatch(badSize), /sampleSize/);
        // 截断
        assert.throws(() => terrain.decodeBatch(good.slice(0, good.length - 20)), /截断|多余|sampleSize|invalid/i);
        // 多余尾部
        assert.throws(() => terrain.decodeBatch(Buffer.concat([good, Buffer.from([0])])), /多余/);
        // 缺 heightMatrix
        const noHeights = terrain.encodeBatch({
            worldId, dimension: 'overworld',
            chunks: [{ chunkX: 0, chunkZ: 0, sampleStep: 1, sampleSize: 16, heights: new Array(256).fill(64) }]
        });
        // flags 置 0 模拟旧客户端不传高程
        noHeights.writeUInt8(0, 20 + 14);
        assert.throws(() => terrain.decodeBatch(noHeights), /heightMatrix/);
    });

    await runner.test('批量入库后 coverage / 覆盖 bbox 正确', async () => {
        const batch = terrain.decodeBatch(
            terrain.encodeBatch({ worldId, dimension: 'overworld', chunks: rampChunks() }));
        const stored = await terrain.storeChunks(batch);
        assert.strictEqual(stored, 16);
        const stats = await worlds.refreshDimensionStats(worldId, 'overworld');
        assert.strictEqual(stats.chunkCount, 16);
        assert.strictEqual(stats.minX, 0);
        assert.strictEqual(stats.maxX, 64);
        const cov = await terrain.coverage(worldId, 'overworld', '0,0,63,63');
        assert.strictEqual(cov.coverage, 1);
        assert.strictEqual(cov.missing.length, 0);
        assert.strictEqual(cov.hasData, true);
        const cov2 = await terrain.coverage(worldId, 'overworld', '0,0,127,63');
        assert.ok(cov2.missing.length > 0, '未采集范围必须出现在 missing 中');
    });

    await runner.test('单点高程：真实值可查，未采集区返回 null+missing', async () => {
        let h = await terrain.sampleHeight({ worldId, dimension: 'overworld', x: 20, z: 3 });
        assert.strictEqual(h.sampled, true);
        assert.strictEqual(h.height, 64 + Math.floor(20 / 2));
        h = await terrain.sampleHeight({ worldId, dimension: 'overworld', x: 500, z: 3 });
        assert.strictEqual(h.height, null);
        assert.strictEqual(h.missing, true);
        assert.strictEqual(h.chunkX, 31);
    });

    await runner.test('等高线来自真实高程：斜坡处出现水平等值线', async () => {
        // 坡度只在 x 方向：等高线应为接近南北向（x 恒定）的折线
        const res = await terrain.contours({ worldId, dimension: 'overworld', bbox: '0,0,63,63', interval: 10 });
        assert.strictEqual(res.data.available, true);
        assert.ok(res.lines.length > 0, '应有等高线');
        const levels = res.levels;
        assert.ok(levels.length >= 3, `高度范围 64~95，10m 等高距应 >= 3 层，实际 ${levels.join(',')}`);
        const line = res.lines[0];
        const xs = line.coordinates.map((c) => c[0]);
        const spread = Math.max(...xs) - Math.min(...xs);
        assert.ok(spread < 6, `斜坡等高线应接近南北向，x 跨度应小，实际 ${spread}`);
        // 所有水平值都落在等高距网格上
        for (const l of levels) assert.strictEqual(l % 10, 0);
    });

    await runner.test('等高距 5/10/20/50/100 层级数单调递减', async () => {
        const counts = [];
        for (const interval of [5, 10, 20, 50, 100]) {
            const r = await terrain.contours({ worldId, dimension: 'overworld', bbox: '0,0,63,63', interval });
            counts.push(r.levels.length);
        }
        for (let i = 1; i < counts.length; i++) {
            assert.ok(counts[i] <= counts[i - 1], `等高距变大层级数应不增：${counts.join(',')}`);
        }
        // 缓存命中
        const r1 = await terrain.contours({ worldId, dimension: 'overworld', bbox: '0,0,63,63', interval: 10 });
        const r2 = await terrain.contours({ worldId, dimension: 'overworld', bbox: '0,0,63,63', interval: 10 });
        assert.strictEqual(r2.cached, true);
        assert.strictEqual(r1.lines.length, r2.lines.length);
    });

    await runner.test('未采集区域等高线：available=false 且 missingRects 覆盖全图（不伪造平地）', async () => {
        const r = await terrain.contours({ worldId, dimension: 'overworld', bbox: '2000,2000,2031,2031', interval: 10 });
        assert.strictEqual(r.data.available, false);
        assert.strictEqual(r.lines.length, 0);
        assert.strictEqual(r.data.coverage, 0);
        assert.ok(r.data.missingRects.length >= 1);
    });

    await runner.test('坡度：斜坡按真实高差计算（约 26.57 度）且不超过 90 度', async () => {
        // 每 2 格抬升 1 → 梯度 0.5 → atan(0.5) ≈ 26.57 度
        const slope = await terrain.slopeAnalysis({ worldId, dimension: 'overworld', bbox: '8,8,55,55' });
        assert.ok(slope.count > 0);
        assert.ok(slope.max > 25 && slope.max < 28, `斜坡应约 26.57 度，实际 ${slope.max}`);
        assert.ok(slope.min >= 0 && slope.mean > 0);
    });

    await runner.test('剖面：沿斜坡的真实高程序列单调不减，缺失段显式标记', async () => {
        const r = await terrain.profileAnalysis({
            worldId, dimension: 'overworld',
            points: [[0, 8], [63, 8]], samples: 17
        });
        assert.strictEqual(r.samples.length, 17);
        assert.strictEqual(r.hasData, true);
        const heights = r.samples.filter((s) => s.hasData).map((s) => s.height);
        assert.ok(heights.length === 17);
        for (let i = 1; i < heights.length; i++) assert.ok(heights[i] >= heights[i - 1], '斜坡剖面应单调不减');
        assert.strictEqual(r.missingRanges.length, 0);
        // 一半无数据的剖面
        const partial = await terrain.profileAnalysis({
            worldId, dimension: 'overworld', points: [[0, 8], [300, 8]], samples: 31
        });
        assert.ok(partial.missingRanges.length >= 1, '缺失段必须显式返回');
        assert.ok(partial.samples.some((s) => !s.hasData && s.height === null));
    });

    await runner.test('统计：真实值范围正确，未采集区分母为 0 不伪造', async () => {
        const s = await terrain.stats({ worldId, dimension: 'overworld', bbox: '0,0,63,63' });
        assert.strictEqual(s.hasData, true);
        assert.ok(s.min >= 64 && s.max <= 120);
        assert.ok(s.p50 <= s.p90);
        assert.ok(s.stdev >= 0);
        assert.ok(s.coverage > 0.99);
        const empty = await terrain.stats({ worldId, dimension: 'overworld', bbox: '5000,5000,5031,5031' });
        assert.strictEqual(empty.hasData, false);
        assert.strictEqual(empty.count, 0);
        assert.strictEqual(empty.coverage, 0);
    });

    await runner.test('网格自适应用步长：大范围请求采样点不超上限', async () => {
        const big = await terrain.terrainGrid({ worldId, dimension: 'overworld', bbox: '0,0,511,511' });
        const samples = big.width * big.height;
        assert.ok(samples <= 262144, `采样点应受上限约束，实际 ${samples}`);
        assert.ok(big.step >= 1);
        // 未采集区域在网格里是 null（不是 0）
        const outside = await terrain.terrainGrid({ worldId, dimension: 'overworld', bbox: '4000,4000,4015,4015' });
        assert.ok(outside.heights.every((h) => h === null), '未采集区必须为 null');
        assert.strictEqual(outside.hasData, false);
    });

    await runner.test('山体阴影强度在 0~255 且缺失区为 null', async () => {
        const hs = await terrain.hillshade({ worldId, dimension: 'overworld', bbox: '0,0,63,63' });
        assert.ok(hs.intensity.some((v) => typeof v === 'number' && v >= 0 && v <= 255));
        const empty = await terrain.hillshade({ worldId, dimension: 'overworld', bbox: '4000,4000,4015,4015' });
        assert.ok(empty.intensity.every((v) => v === null));
    });

    await runner.test('高程分布直方图计数之和等于采样数', async () => {
        const d = await terrain.distribution({ worldId, dimension: 'overworld', bbox: '0,0,63,63', bucket: 8 });
        const sum = d.bins.reduce((s, b) => s + b.count, 0);
        assert.strictEqual(sum, d.sampleCount);
        assert.ok(d.bins.length >= 2);
    });

    await runner.test('数据更新使缓存失效（等高线重新计算）', async () => {
        const before = await terrain.contours({ worldId, dimension: 'overworld', bbox: '0,0,63,63', interval: 10 });
        // 覆写 chunk (0,0)，抬高地形：200 + 5x（200~275，10m 等高距应产生 210/220/.../270 层）
        const heights = new Array(256);
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) heights[z * 16 + x] = 200 + 5 * x;
        await terrain.storeChunks({ worldId, dimension: 'overworld', chunks: [{ chunkX: 0, chunkZ: 0, sampleStep: 1, sampleSize: 16, heights }] }, {});
        const after = await terrain.contours({ worldId, dimension: 'overworld', bbox: '0,0,15,15', interval: 10 });
        assert.strictEqual(after.cached, false, '数据变化后不应命中旧缓存');
        assert.ok(after.levels.some((l) => l > 120), `新地形 200 高度应产生更高等高线，实际 ${after.levels.slice(-5).join(',')}`);
        void before;
    });

    await runner.test('几何工具：bbox 解析/点面判断/距离/简化', async () => {
        const box = geo.parseBbox('-10,-20,30,40');
        assert.deepStrictEqual(box, { minX: -10, minZ: -20, maxX: 30, maxZ: 40 });
        assert.throws(() => geo.parseBbox('1,2,3'), /bbox/);
        assert.throws(() => geo.parseBbox('0,0,0,0'), /面积/);
        assert.throws(() => geo.parseBbox('0,0,5000,5000'), /bbox_too_large|超过上限/);
        const poly = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
        assert.strictEqual(geo.pointInGeometry(5, 5, poly), true);
        assert.strictEqual(geo.pointInGeometry(15, 5, poly), false);
        const hole = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
        assert.strictEqual(geo.pointInGeometry(5, 5, hole), false, '洞内不算在面内');
        assert.strictEqual(geo.pointInGeometry(2, 2, hole), true);
        const line = { type: 'LineString', coordinates: [[0, 0], [10, 0]] };
        assert.ok(Math.abs(geo.distanceToGeometry(5, 3, line).distance - 3) < 1e-6);
        const simplified = geo.simplifyGeometry({ type: 'LineString', coordinates: [[0, 0], [0.1, 0], [0.2, 0], [10, 0]] }, 1);
        assert.ok(simplified.coordinates.length < 4, '低缩放应简化几何');
        const m = geo.geometryMeasure(poly);
        assert.strictEqual(m.area, 100);
        assert.strictEqual(geo.geometryMeasure(line).length, 10);
    });

    const ok = runner.summary();
    kit.removeDb(require('path').join(kit.ROOT, prep.rel));
    process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
    console.error('测试执行异常:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
});
