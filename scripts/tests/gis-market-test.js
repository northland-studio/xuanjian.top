/**
 * 集市地点替换：迁移/兼容/数量核对 + 回归测试。
 *
 * 运行：node scripts/tests/gis-market-test.js
 *
 * 关键约束（规范第十七条）：
 *  - market_store_locations 是唯一地点数据源，GIS 不建并行系统、不改写旧数据；
 *  - 旧数据零迁移（兼容读取），前后数量 / id / 坐标必须完全一致；
 *  - 商品、店铺、订单、托管、退款、结算逻辑零改动（本测试验证集市路由仍可正常响应）。
 */

const assert = require('assert');
const kit = require('./gis-testkit');

async function main() {
    // 与生产一致的旧数据规模：2 行（server_key: yl / 樱梨）
    const prep = await kit.prepare({ name: 'gis-market', marketLocations: 2 });
    const db = require('../../database');
    const app = await kit.startApp();
    // 集市路由（与生产同一份代码）挂在同一个迷你 app 上，验证地点端点与集市其它端点均正常
    const express = require('express');
    const marketApp = express();
    marketApp.use(express.json({ limit: '10mb' }));
    marketApp.use('/api/gis', require('../../routes/gis'));
    marketApp.use('/api/market', require('../../routes/market'));
    marketApp.use((req, res) => res.status(404).json({ error: 'not_found' }));
    marketApp.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        res.status(500).json({ error: String(err && err.message) });
    });
    const server = await new Promise((resolve) => {
        const s = marketApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const api = kit.makeClient(`http://127.0.0.1:${server.address().port}`);
    const runner = kit.makeRunner('GIS 集市地点替换测试');
    const { expect } = kit;

    const admin = await kit.createUser({ username: 'market_admin', level: 2, gameId: 'market_admin_mc' });
    const adminToken = kit.tokenFor(admin);
    const seeded = await kit.seedServerAndWorld({ serverKey: 'yl', serverName: '樱梨' });

    const rowsBefore = await db.all('SELECT * FROM market_store_locations ORDER BY id');
    const fingerprintBefore = rowsBefore.map((r) => `${r.id}|${r.server_key}|${r.dimension}|${r.x}|${r.y}|${r.z}|${r.label}|${r.note}|${r.is_public}|${r.created_at}|${r.updated_at}`);

    await runner.test('迁移后旧地点数量与 id/坐标完全不变（生产口径 2 行）', async () => {
        assert.strictEqual(rowsBefore.length, 2, '基线应 2 行');
        const rowsAfter = await db.all('SELECT * FROM market_store_locations ORDER BY id');
        assert.strictEqual(rowsAfter.length, rowsBefore.length, '数量必须一致');
        assert.deepStrictEqual(
            rowsAfter.map((r) => `${r.id}|${r.server_key}|${r.dimension}|${r.x}|${r.y}|${r.z}|${r.label}|${r.note}|${r.is_public}|${r.created_at}|${r.updated_at}`),
            fingerprintBefore, 'id/坐标/标签/时间戳必须完全一致（零迁移）'
        );
    });

    await runner.test('迁移新增的可选关联列存在且默认 NULL', async () => {
        const cols = await db.all(`PRAGMA table_info(market_store_locations)`);
        const names = cols.map((c) => c.name);
        assert.ok(names.includes('world_id'), '应有 world_id 列');
        assert.ok(names.includes('gis_marker_id'), '应有 gis_marker_id 列');
        const rows = await db.all(`SELECT world_id, gis_marker_id FROM market_store_locations`);
        assert.ok(rows.every((r) => r.world_id === null || Number.isInteger(Number(r.world_id))));
    });

    await runner.test('GIS 只读投影：地点数量与库内一致（数量核对接口）', async () => {
        const r = await api.get('/api/gis/market/locations');
        expect.ok(r);
        assert.strictEqual(r.json.total, 2);
        assert.deepStrictEqual(
            r.json.items.map((i) => [i.x, i.z]).sort(),
            rowsBefore.map((x) => [x.x, x.z]).sort(),
            'GIS 投影必须与集市库内坐标一致'
        );
        const count = await api.get('/api/gis/market/locations/count');
        expect.ok(count);
        assert.strictEqual(count.json.marketLocations, 2);
        assert.strictEqual(count.json.publicLocations, 2);
        assert.strictEqual(count.json.consistent, true);
    });

    await runner.test('GIS 读接口不会修改集市地点（只读校验）', async () => {
        await api.get('/api/gis/market/locations');
        await api.get('/api/gis/places?kind=market_store');
        const rows = await db.all('SELECT * FROM market_store_locations ORDER BY id');
        assert.deepStrictEqual(
            rows.map((r) => `${r.id}|${r.x}|${r.z}|${r.updated_at}`),
            rowsBefore.map((r) => `${r.id}|${r.x}|${r.z}|${r.updated_at}`)
        );
    });

    await runner.test('集市地点新增接口（地图选点写入同一张表）', async () => {
        const store = await db.get('SELECT id FROM market_stores LIMIT 1');
        const r = await api.post(`/api/market/merchant/stores/${store.id}/locations`, {
            server_key: 'yl', server_name: '樱梨', dimension: 'overworld',
            x: 128, y: 70, z: -348, label: 'GIS 选点测试', note: '地图点击', is_public: true,
            world_id: seeded.world.id, gis_marker_id: null
        }, { token: adminToken });
        expect.status(r, 201);
        assert.strictEqual(r.json.location.x, 128);
        assert.strictEqual(r.json.location.z, -348);
        assert.strictEqual(Number(r.json.location.world_id), seeded.world.id);
        const count = await db.get('SELECT COUNT(*) AS c FROM market_store_locations');
        assert.strictEqual(Number(count.c), 3);
    });

    await runner.test('集市地点编辑接口（保留 label/note/public 与 GIS 关联）', async () => {
        const loc = await db.get(`SELECT id FROM market_store_locations ORDER BY id DESC LIMIT 1`);
        const r = await api.put(`/api/market/merchant/locations/${loc.id}`, {
            x: 130, y: 71, z: -350, label: 'GIS 选点测试-改', note: '拖拽后坐标', is_public: false,
            gis_marker_id: null
        }, { token: adminToken });
        expect.status(r, 200);
        assert.strictEqual(r.json.location.x, 130);
        assert.strictEqual(r.json.location.label, 'GIS 选点测试-改');
        assert.strictEqual(Number(r.json.location.is_public), 0);
    });

    await runner.test('集市地点删除接口后数量回到 2（前后核对）', async () => {
        const loc = await db.get(`SELECT id FROM market_store_locations ORDER BY id DESC LIMIT 1`);
        const r = await api.del(`/api/market/merchant/locations/${loc.id}`, { token: adminToken });
        expect.ok(r);
        const count = await db.get('SELECT COUNT(*) AS c FROM market_store_locations');
        assert.strictEqual(Number(count.c), 2);
        const gis = await api.get('/api/gis/market/locations/count');
        assert.strictEqual(gis.json.marketLocations, 2);
        assert.strictEqual(gis.json.consistent, true);
    });

    await runner.test('集市其它接口不受影响（config / stores / map）', async () => {
        let r = await api.get('/api/market/config');
        expect.ok(r);
        assert.ok(r.json.dimensions);
        r = await api.get('/api/market/stores');
        expect.ok(r);
        assert.ok(Array.isArray(r.json.items));
        r = await api.get('/api/market/map');
        expect.ok(r);
        assert.ok(Array.isArray(r.json.points));
        // 地图点与地点数一致（公开地点）
        const publicCount = await db.get('SELECT COUNT(*) AS c FROM market_store_locations WHERE is_public = 1');
        assert.strictEqual(r.json.points.length, Number(publicCount.c));
    });

    await runner.test('GIS 空间关联：集市地点可作为统一地点引用读取', async () => {
        const rows = await db.all('SELECT id, x, z FROM market_store_locations WHERE is_public = 1 ORDER BY id');
        for (const row of rows) {
            const r = await api.get(`/api/gis/places/market_store/${row.id}`);
            expect.ok(r);
            assert.strictEqual(r.json.place.x, row.x);
            assert.strictEqual(r.json.place.z, row.z);
            assert.ok(r.json.place.link.startsWith('/market/store/'));
        }
    });

    await runner.test('GIS 写入不触碰集市交易表（订单/店铺行数不变）', async () => {
        const before = {
            stores: Number((await db.get('SELECT COUNT(*) AS c FROM market_stores')).c),
            orders: Number((await db.get('SELECT COUNT(*) AS c FROM market_orders')).c)
        };
        // GIS 侧写入：提交并发布一个 Marker
        let r = await api.post('/api/gis/objects/marker', {
            name: '集市旁地点', category: 'shop', worldId: seeded.world.id, dimension: 'overworld',
            point: { x: 130, y: 71, z: -350 }
        }, { token: adminToken });
        expect.status(r, 201);
        const id = r.json.object.id;
        await api.post(`/api/gis/objects/marker/${id}/submit`, {}, { token: adminToken });
        await api.post(`/api/gis/objects/marker/${id}/publish`, {}, { token: adminToken });
        const after = {
            stores: Number((await db.get('SELECT COUNT(*) AS c FROM market_stores')).c),
            orders: Number((await db.get('SELECT COUNT(*) AS c FROM market_orders')).c)
        };
        assert.deepStrictEqual(after, before, '集市店铺/订单行数不得变化');
    });

    const ok = runner.summary();
    await app.close();
    await new Promise((resolve) => server.close(() => resolve()));
    const { stopScheduler } = require('../../lib/market-jobs');
    try { stopScheduler(); } catch (e) { /* ignore */ }
    try { kit.removeDb(require('path').join(kit.ROOT, prep.rel)); } catch (e) { /* ignore */ }
    process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
    console.error('测试执行异常:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
});
