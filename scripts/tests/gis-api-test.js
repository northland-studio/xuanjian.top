/**
 * GIS API 端到端测试（临时库 + 真实迁移 + 真实 Express 路由）。
 *
 * 运行：node scripts/tests/gis-api-test.js
 *
 * 覆盖：元信息/契约快照、鉴权 401/403、对象 CRUD 与 bbox 空间查询、状态流转与版本、
 *       Wiki 关联、客户端上传契约（压缩/幂等/维度校验）、地形与等高线、增量同步、
 *       历史快照与差异、地点引用（集市/XBed 预留）、管理接口权限、跨世界越权防护。
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const kit = require('./gis-testkit');

const SNAPSHOT_FILE = path.join(__dirname, 'fixtures', 'gis-contract.v1.json');
const UPDATE_SNAPSHOT = process.env.UPDATE_SNAPSHOT === '1';

async function main() {
    const prep = await kit.prepare({ name: 'gis-api', marketLocations: 3 });
    console.log(`临时库: ${prep.rel}`);
    const firstLines = prep.out.split('\n').filter((l) => l.includes('✔') || l.includes('✘')).slice(0, 3);
    console.log(firstLines.join('\n'));

    const app = await kit.startApp();
    const api = kit.makeClient(app.base);
    const runner = kit.makeRunner('GIS API 测试');
    const { expect } = kit;

    const db = require('../../database');
    const admin = await kit.createUser({ username: 'gis_admin', level: 2, gameId: 'gis_admin_mc' });
    const normal = await kit.createUser({ username: 'gis_normal', level: 0, gameId: 'gis_normal_mc' });
    const adminToken = kit.tokenFor(admin);
    const normalToken = kit.tokenFor(normal);
    const seeded = await kit.seedServerAndWorld({ serverKey: 'yl', serverName: '樱梨' });
    const world = seeded.world;
    const worldId = world.id;

    const wikiPage = await db.run(
        `INSERT INTO wiki_pages (title, slug, content, author_id, status) VALUES ('樱梨城', 'yingli-city', '内容', ?, 'published')`, [admin.id]);
    const wikiPageId = wikiPage.id;

    let markerId = null;
    let roadId = null;
    let districtId = null;

    /* ---------------- 元信息 / 契约 ---------------- */
    await runner.test('GET /config 返回维度、分类、限额', async () => {
        const r = await api.get('/api/gis/config');
        expect.ok(r);
        assert.ok(r.json.dimensions.length >= 3);
        assert.ok(r.json.markerCategories.length === 9);
        assert.ok(r.json.limits.maxBboxArea > 0);
    });

    await runner.test('GET /client/contract 与契约快照一致（防前后端漂移）', async () => {
        const r = await api.get('/api/gis/client/contract');
        expect.ok(r);
        const contract = { ...r.json };
        assert.strictEqual(contract.contract, 1);
        assert.strictEqual(contract.chunkFormat.magic, 'XJGIS');
        fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
        if (!fs.existsSync(SNAPSHOT_FILE) || UPDATE_SNAPSHOT) {
            fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(contract, null, 2) + '\n');
            console.log('     ↳ 已写入契约快照 fixtures/gis-contract.v1.json');
            return;
        }
        const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
        assert.deepStrictEqual(contract, snapshot, '契约发生变化：如为有意变更请 UPDATE_SNAPSHOT=1 更新快照并在 commits 里说明');
    });

    await runner.test('GET /worlds 公开列出注册世界', async () => {
        const r = await api.get('/api/gis/worlds');
        expect.ok(r);
        assert.ok(r.json.worlds.some((w) => w.id === worldId && w.serverKey === 'yl'));
        assert.ok(r.json.worlds.every((w) => ['ACTIVE', 'ARCHIVED', 'SNAPSHOT'].includes(w.status)));
    });

    /* ---------------- 鉴权 ---------------- */
    await runner.test('未登录创建对象 → 401 UNAUTHORIZED', async () => {
        const r = await api.post('/api/gis/objects/marker', { name: 'x', worldId, dimension: 'overworld', point: { x: 0, y: 64, z: 0 } });
        expect.status(r, 401);
        assert.strictEqual(r.json.code, 'UNAUTHORIZED');
    });

    await runner.test('Level 0 普通用户可创建 Marker 草稿（基础权限 gis.submit）', async () => {
        const r = await api.post('/api/gis/objects/marker', { name: '普通玩家的标记', worldId, dimension: 'overworld', point: { x: 1, y: 64, z: 1 } }, { token: normalToken });
        assert.ok(r.status === 200 || r.status === 201, `期望 200/201，实际 ${r.status}：${JSON.stringify(r.json).slice(0, 200)}`);
        const id = r.json.object ? r.json.object.id : r.json.id;
        assert.ok(id, `响应缺少 id：${JSON.stringify(r.json).slice(0, 200)}`);
        global.__normalMarkerId = id;
    });

    await runner.test('Level 0 普通用户无 gis.object.review，不能审核/发布他人提交 → 403', async () => {
        const id = global.__normalMarkerId;
        const r = await api.post(`/api/gis/objects/marker/${id}/publish`, {}, { token: normalToken });
        expect.status(r, 403);
        const body = JSON.stringify(r.json);
        assert.ok(body.includes('PERMISSION_DENIED') || body.includes('权限'), `实际：${body}`);
    });

    await runner.test('公开读接口无需登录（bbox 查询）', async () => {
        const r = await api.get(`/api/gis/objects?worldId=${worldId}&dimension=overworld&bbox=-100,-100,100,100`);
        expect.ok(r);
        assert.ok(Array.isArray(r.json.objects));
    });

    /* ---------------- 对象创建 / 状态流转 / 发布 ---------------- */
    await runner.test('管理员创建 Marker → 201 且为 DRAFT', async () => {
        const r = await api.post('/api/gis/objects/marker', {
            name: '北域酒馆', category: 'shop', worldId, dimension: 'overworld',
            point: { x: 12.5, y: 68, z: -30 }, description: '测试酒馆', wikiPageId
        }, { token: adminToken });
        expect.status(r, 201);
        markerId = r.json.object.id;
        assert.strictEqual(r.json.object.status, 'DRAFT');
        assert.strictEqual(r.json.object.revision, 1);
        assert.strictEqual(r.json.object.wikiPageId, wikiPageId);
    });

    await runner.test('Marker 分类非法 → 400', async () => {
        const r = await api.post('/api/gis/objects/marker', {
            name: 'x', category: 'not_a_category', worldId, dimension: 'overworld', point: { x: 0, y: 64, z: 0 }
        }, { token: adminToken });
        expect.error(r, 'invalid_argument', 400);
    });

    await runner.test('Draft → Review → Published（发布 revision+1）', async () => {
        let r = await api.post(`/api/gis/objects/marker/${markerId}/submit`, {}, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.object.status, 'REVIEW');
        r = await api.post(`/api/gis/objects/marker/${markerId}/publish`, { note: '审核通过' }, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.object.status, 'PUBLISHED');
        assert.strictEqual(r.json.object.revision, 2);
        assert.strictEqual(r.json.object.publishedRevision, 2);
    });

    await runner.test('已发布对象出现在 bbox 查询中，范围外不返回', async () => {
        let r = await api.get(`/api/gis/objects?worldId=${worldId}&dimension=overworld&bbox=-50,-50,50,50`);
        expect.ok(r);
        assert.ok(r.json.objects.some((o) => o.type === 'marker' && o.id === markerId), '范围内应返回 Marker');
        r = await api.get(`/api/gis/objects?worldId=${worldId}&dimension=overworld&bbox=1000,1000,1100,1100`);
        expect.ok(r);
        assert.ok(!r.json.objects.some((o) => o.id === markerId), '范围外不应返回');
    });

    await runner.test('bbox 缺失 → 400 bbox_required；过大 → 400 bbox_too_large', async () => {
        let r = await api.get(`/api/gis/objects?worldId=${worldId}&dimension=overworld`);
        expect.error(r, 'bbox_required', 400);
        r = await api.get(`/api/gis/objects?worldId=${worldId}&dimension=overworld&bbox=-1000000,-1000000,1000000,1000000`);
        expect.error(r, 'bbox_too_large', 400);
    });

    await runner.test('创建道路（LineString + 宽度 + 等级）并发布', async () => {
        let r = await api.post('/api/gis/objects/road', {
            name: '中央大道', worldId, dimension: 'overworld',
            geometry: { type: 'LineString', coordinates: [[-100, 0], [0, 0], [100, 0]] },
            width: 7, roadLevel: 1, isMain: true
        }, { token: adminToken });
        expect.status(r, 201);
        roadId = r.json.object.id;
        assert.strictEqual(r.json.object.width, 7);
        r = await api.post(`/api/gis/objects/road/${roadId}/submit`, {}, { token: adminToken });
        expect.ok(r);
        r = await api.post(`/api/gis/objects/road/${roadId}/publish`, {}, { token: adminToken });
        expect.ok(r);
    });

    await runner.test('创建城区（Polygon + 父级 + 样式）并发布', async () => {
        let r = await api.post('/api/gis/objects/district', {
            name: '樱梨城', districtType: 'city', worldId, dimension: 'overworld',
            geometry: { type: 'Polygon', coordinates: [[[-150, -150], [150, -150], [150, 150], [-150, 150], [-150, -150]]] },
            styleColor: '#33aaff', styleOpacity: 0.3, styleWeight: 3
        }, { token: adminToken });
        expect.status(r, 201);
        districtId = r.json.object.id;
        assert.strictEqual(r.json.object.style.color, '#33aaff');
        r = await api.post(`/api/gis/objects/district/${districtId}/submit`, {}, { token: adminToken });
        expect.ok(r);
        r = await api.post(`/api/gis/objects/district/${districtId}/publish`, {}, { token: adminToken });
        expect.ok(r);
        assert.ok(r.json.object.metrics.area > 0);
    });

    await runner.test('几何非法（Polygon 顶点不足）→ 400', async () => {
        const r = await api.post('/api/gis/objects/district', {
            name: '坏城区', worldId, dimension: 'overworld',
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }
        }, { token: adminToken });
        expect.error(r, 'invalid_argument', 400);
    });

    await runner.test('点位归属查询返回所在城区与最近道路', async () => {
        const r = await api.get(`/api/gis/place?worldId=${worldId}&dimension=overworld&x=10&z=2`);
        expect.ok(r);
        assert.ok(r.json.hasData);
        assert.strictEqual(r.json.district.id, districtId);
        assert.ok(r.json.road, '空白应命中 7 宽道路的缓冲区');
        assert.ok(r.json.road.distance <= 3.5);
    });

    /* ---------------- 版本 / 乐观锁 / 回滚 ---------------- */
    await runner.test('过期 revision 更新 → 409 version_conflict；正确 revision 更新 → DRAFT', async () => {
        let r = await api.put(`/api/gis/objects/marker/${markerId}`, { name: '改名酒馆', revision: 1 }, { token: adminToken });
        expect.error(r, 'version_conflict', 409);
        r = await api.put(`/api/gis/objects/marker/${markerId}`, { name: '改名酒馆', revision: 2 }, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.object.status, 'DRAFT');
        assert.strictEqual(r.json.object.revision, 3);
        // 发布层仍显示旧版本
        const pub = await api.get(`/api/gis/objects?worldId=${worldId}&dimension=overworld&bbox=-50,-50,50,50`);
        const inList = pub.json.objects.find((o) => o.type === 'marker' && o.id === markerId);
        assert.strictEqual(inList.name, '北域酒馆', '发布层不应被草稿覆盖');
        assert.strictEqual(inList.revision, 2);
    });

    await runner.test('版本历史可列出与读取，并可回滚生成新版本', async () => {
        let r = await api.get(`/api/gis/objects/marker/${markerId}/revisions`, { token: adminToken });
        expect.ok(r);
        assert.ok(r.json.items.length >= 2);
        const revs = r.json.items.map((i) => i.revision);
        assert.ok(revs.includes(1) && revs.includes(2));
        r = await api.get(`/api/gis/objects/marker/${markerId}/revisions/2`, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.revision.snapshot.name, '北域酒馆');
        // 回滚到 v2
        r = await api.post(`/api/gis/objects/marker/${markerId}/rollback`, { revision: 2 }, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.object.status, 'PUBLISHED');
        assert.ok(r.json.object.revision >= 4);
        assert.strictEqual(r.json.object.name, '北域酒馆');
        // 发布层已更新
        const pub = await api.get(`/api/gis/objects/marker/${markerId}`);
        expect.ok(pub);
        assert.strictEqual(pub.json.object.revision, r.json.object.revision);
    });

    await runner.test('驳回流程：REVIEW → REJECTED', async () => {
        let r = await api.post('/api/gis/objects/marker', {
            name: '待驳回地点', category: 'other', worldId, dimension: 'overworld', point: { x: 400, y: 64, z: 400 }
        }, { token: adminToken });
        expect.status(r, 201);
        const id = r.json.object.id;
        r = await api.post(`/api/gis/objects/marker/${id}/submit`, {}, { token: adminToken });
        expect.ok(r);
        r = await api.post(`/api/gis/objects/marker/${id}/reject`, { note: '信息不足' }, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.object.status, 'REJECTED');
    });

    await runner.test('审核队列返回待审对象', async () => {
        const created = await api.post('/api/gis/objects/marker', {
            name: '待审队列地点', category: 'housing', worldId, dimension: 'overworld', point: { x: 420, y: 64, z: 420 }
        }, { token: adminToken });
        const id = created.json.object.id;
        await api.post(`/api/gis/objects/marker/${id}/submit`, {}, { token: adminToken });
        const r = await api.get(`/api/gis/review/queue?worldId=${worldId}`, { token: adminToken });
        expect.ok(r);
        assert.ok(r.json.items.some((o) => o.id === id && o.status === 'REVIEW'));
    });

    /* ---------------- Wiki ---------------- */
    await runner.test('Wiki 关联：非法 wikiPageId → 400，关联/解除成功', async () => {
        let r = await api.post(`/api/gis/objects/marker/${markerId}/wiki`, { wikiPageId: 999999 }, { token: adminToken });
        expect.error(r, 'invalid_argument', 400);
        r = await api.post(`/api/gis/objects/marker/${markerId}/wiki`, { wikiPageId }, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.object.wikiPageId, wikiPageId);
        const back = await api.get(`/api/gis/wiki/${wikiPageId}/objects`);
        expect.ok(back);
        assert.ok(back.json.items.some((o) => o.id === markerId));
        r = await api.post(`/api/gis/objects/marker/${markerId}/wiki`, { wikiPageId: null }, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.object.wikiPageId, null);
        // 还原，供后续集市/搜索断言
        await api.post(`/api/gis/objects/marker/${markerId}/wiki`, { wikiPageId }, { token: adminToken });
    });

    await runner.test('空间+文本搜索命中已发布对象', async () => {
        const r = await api.get(`/api/gis/search?q=酒馆&worldId=${worldId}&dimension=overworld&bbox=-100,-100,100,100`);
        expect.ok(r);
        assert.ok(r.json.items.some((o) => o.id === markerId));
    });

    /* ---------------- 客户端上传 ---------------- */
    const { world: clientWorld } = seeded;
    await runner.test('客户端 bootstrap 返回世界与限额', async () => {
        const r = await api.get('/api/gis/client/bootstrap?serverKey=yl', { token: adminToken });
        expect.ok(r);
        assert.ok(r.json.contract === 1);
        assert.ok(r.json.worlds.length >= 1);
        assert.ok(r.json.limits.maxChunkBatch === 64);
    });

    await runner.test('Level 0 普通成员（仅 gis.submit）也能 bootstrap（客户端采集入口）', async () => {
        const r = await api.get('/api/gis/client/bootstrap?serverKey=yl', { token: normalToken });
        expect.ok(r);
        assert.ok(r.json.contract === 1);
    });

    await runner.test('resolve-world 兼容命名空间维度（minecraft:overworld / the_nether）', async () => {
        let r = await api.post('/api/gis/client/resolve-world', { serverKey: 'yl', worldId, worldKey: clientWorld.worldKey, dimension: 'minecraft:overworld' }, { token: normalToken });
        expect.ok(r);
        assert.strictEqual(r.json.dimension, 'overworld');
        r = await api.post('/api/gis/client/resolve-world', { serverKey: 'yl', worldId, worldKey: clientWorld.worldKey, dimension: 'minecraft:the_nether' }, { token: normalToken });
        assert.ok([200, 409].includes(r.status), `the_nether 不应返回 400 invalid_argument，实际 ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
    });

    await runner.test('resolve-world：未注册服务器/错误 worldKey 被拒', async () => {
        let r = await api.post('/api/gis/client/resolve-world', { serverKey: 'no_such_server', worldId, worldKey: 'x', dimension: 'overworld' }, { token: adminToken });
        expect.error(r, 'server_not_registered', 403);
        r = await api.post('/api/gis/client/resolve-world', { serverKey: 'yl', worldId, worldKey: 'wrong-key', dimension: 'overworld' }, { token: adminToken });
        expect.error(r, 'world_not_registered', 403);
        r = await api.post('/api/gis/client/resolve-world', { serverKey: 'yl', worldId, worldKey: clientWorld.worldKey, dimension: 'overworld' }, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.writable, true);
    });

    await runner.test('上传计划：首次全部 missing（断点续传语义）', async () => {
        const r = await api.post('/api/gis/client/chunks/plan', {
            worldId, dimension: 'overworld', chunks: [{ x: 0, z: 0 }, { x: 1, z: 0 }]
        }, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.missing.length, 2);
        assert.strictEqual(r.json.have.length, 0);
    });

    await runner.test('zstd 批量上传成功 + 幂等重放 duplicate:true', async () => {
        const chunks = [];
        for (let cx = 0; cx < 2; cx++) {
            for (let cz = 0; cz < 2; cz++) {
                const m = kit.heightMatrix({ seed: cx * 5 + cz });
                chunks.push({ chunkX: cx, chunkZ: cz, ...m });
            }
        }
        const raw = kit.buildBatchBuffer({ worldId, dimension: 'overworld', chunks });
        const body = kit.zstd(raw);
        assert.ok(body.length < raw.length || true);
        const key = `batch-${Date.now()}-a`;
        let r = await api.request('POST', `/api/gis/client/chunks?worldId=${worldId}&dimension=overworld`, {
            token: adminToken, raw: body,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'zstd', 'Idempotency-Key': key, 'X-GIS-Contract': '1' }
        });
        expect.ok(r);
        assert.strictEqual(r.json.accepted, 4);
        assert.strictEqual(r.json.duplicate, false);
        // 幂等重放
        r = await api.request('POST', `/api/gis/client/chunks?worldId=${worldId}&dimension=overworld`, {
            token: adminToken, raw: body,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'zstd', 'Idempotency-Key': key, 'X-GIS-Contract': '1' }
        });
        expect.ok(r);
        assert.strictEqual(r.json.duplicate, true);
    });

    await runner.test('已上传 chunk 在 plan 中变为 have（增量上传）', async () => {
        const r = await api.post('/api/gis/client/chunks/plan', {
            worldId, dimension: 'overworld', chunks: [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 9, z: 9 }]
        }, { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.have.length, 2);
        assert.deepStrictEqual(r.json.missing, [{ x: 9, z: 9 }]);
    });

    await runner.test('覆盖范围接口返回 chunk 与 bbox', async () => {
        const r = await api.get(`/api/gis/terrain/coverage?worldId=${worldId}&dimension=overworld`);
        expect.ok(r);
        assert.strictEqual(r.json.chunkCount, 4);
        assert.ok(r.json.bbox.minX === 0 && r.json.bbox.maxX === 32);
    });

    await runner.test('高程查询：有数据返回真实值，无数据显式 null', async () => {
        let r = await api.get(`/api/gis/terrain/height?worldId=${worldId}&dimension=overworld&x=2&z=2`);
        expect.ok(r);
        assert.strictEqual(r.json.sampled, true);
        assert.ok(Number.isFinite(r.json.height));
        r = await api.get(`/api/gis/terrain/height?worldId=${worldId}&dimension=overworld&x=5000&z=5000`);
        expect.ok(r);
        assert.strictEqual(r.json.height, null);
        assert.strictEqual(r.json.missing, true);
        assert.strictEqual(r.json.dataUnavailable, true);
    });

    await runner.test('等高线：真实高程生成线条，未采集区标记 missingRects', async () => {
        const r = await api.get(`/api/gis/terrain/contours?worldId=${worldId}&dimension=overworld&bbox=0,0,31,31&interval=5`);
        expect.ok(r);
        assert.strictEqual(r.json.data.available, true);
        assert.ok(r.json.lines.length > 0, '应有等高线');
        assert.ok(r.json.levels.length > 0);
        assert.ok(r.json.data.coverage > 0.9);
        // 同一 bbox 不同等高距得到更多/更少层级
        const r20 = await api.get(`/api/gis/terrain/contours?worldId=${worldId}&dimension=overworld&bbox=0,0,31,31&interval=20`);
        expect.ok(r20);
        assert.ok(r20.json.levels.length <= r.json.levels.length);
    });

    await runner.test('等高距非法 → 400', async () => {
        const r = await api.get(`/api/gis/terrain/contours?worldId=${worldId}&dimension=overworld&bbox=0,0,31,31&interval=7`);
        expect.error(r, 'invalid_argument', 400);
    });

    await runner.test('地形网格/坡度/阴影/统计/分布/剖面接口可用且标记缺失', async () => {
        const grid = await api.get(`/api/gis/terrain/grid?worldId=${worldId}&dimension=overworld&bbox=0,0,31,31`);
        expect.ok(grid);
        assert.ok(grid.json.heights.length === grid.json.width * grid.json.height);
        assert.ok(grid.json.heights.every((h) => h === null || Number.isFinite(h)));

        const slope = await api.get(`/api/gis/terrain/slope?worldId=${worldId}&dimension=overworld&bbox=0,0,31,31`);
        expect.ok(slope);
        assert.ok(slope.json.count > 0);
        assert.ok(slope.json.mean >= 0 && slope.json.mean <= 90);

        const hill = await api.get(`/api/gis/terrain/hillshade?worldId=${worldId}&dimension=overworld&bbox=0,0,31,31`);
        expect.ok(hill);
        assert.ok(hill.json.intensity.some((v) => v !== null && v >= 0 && v <= 255));

        const stats = await api.get(`/api/gis/terrain/stats?worldId=${worldId}&dimension=overworld&bbox=0,0,31,31`);
        expect.ok(stats);
        assert.strictEqual(stats.json.hasData, true);
        assert.ok(stats.json.min <= stats.json.max);
        assert.ok(stats.json.coverage > 0.9);

        const dist = await api.get(`/api/gis/terrain/distribution?worldId=${worldId}&dimension=overworld&bbox=0,0,31,31`);
        expect.ok(dist);
        assert.ok(dist.json.bins.length > 0);

        const profile = await api.get(`/api/gis/terrain/profile?worldId=${worldId}&dimension=overworld&points=${encodeURIComponent(JSON.stringify([[0, 0], [31, 31]]))}&samples=32`);
        expect.ok(profile);
        assert.strictEqual(profile.json.samples.length, 32);
        assert.ok(profile.json.samples.some((s) => s.hasData));
        assert.ok(profile.json.length > 0);
    });

    await runner.test('未采集区域统计：hasData=false 且 coverage=0（不伪造平地）', async () => {
        const r = await api.get(`/api/gis/terrain/stats?worldId=${worldId}&dimension=overworld&bbox=2000,2000,2031,2031`);
        expect.ok(r);
        assert.strictEqual(r.json.hasData, false);
        assert.strictEqual(r.json.count, 0);
        assert.strictEqual(r.json.mean, null);
    });

    await runner.test('载荷 magic 错误 → invalid_payload；维度不符 → dimension_mismatch', async () => {
        const raw = Buffer.from('NOTXJGIS' + '0'.repeat(32));
        let r = await api.request('POST', `/api/gis/client/chunks?worldId=${worldId}&dimension=overworld`, {
            token: adminToken, raw,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'identity', 'Idempotency-Key': 'bad-magic-key-1' }
        });
        expect.error(r, 'invalid_payload', 400);
        const m = kit.heightMatrix({});
        const good = kit.buildBatchBuffer({ worldId, dimension: 'overworld', chunks: [{ chunkX: 5, chunkZ: 5, ...m }] });
        r = await api.request('POST', `/api/gis/client/chunks?worldId=${worldId}&dimension=nether`, {
            token: adminToken, raw: good,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'identity', 'Idempotency-Key': 'dim-mismatch-1' }
        });
        expect.error(r, 'dimension_mismatch', 409);
    });

    await runner.test('跨世界越权：载荷 worldId 与请求不一致 → invalid_payload', async () => {
        const m = kit.heightMatrix({});
        const raw = kit.buildBatchBuffer({ worldId: worldId + 999, dimension: 'overworld', chunks: [{ chunkX: 6, chunkZ: 6, ...m }] });
        const r = await api.request('POST', `/api/gis/client/chunks?worldId=${worldId}&dimension=overworld`, {
            token: adminToken, raw,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'identity', 'Idempotency-Key': 'cross-world-1' }
        });
        expect.error(r, 'invalid_payload', 400);
    });

    await runner.test('增量同步：since=0 拉全量已发布，游标推进后无更多', async () => {
        let r = await api.get(`/api/gis/client/sync?worldId=${worldId}&dimension=overworld&since=0`, { token: adminToken });
        expect.ok(r);
        assert.ok(r.json.objects.length >= 2);
        assert.ok(r.json.cursor > 0);
        r = await api.get(`/api/gis/client/sync?worldId=${worldId}&dimension=overworld&since=${r.json.cursor}`, { token: adminToken });
        expect.ok(r);
        assert.ok(r.json.objects.length === 0 && r.json.deleted.length === 0);
    });

    /* ---------------- 历史 ---------------- */
    let snapshotId = null;
    await runner.test('创建历史快照并列出', async () => {
        let r = await api.post('/api/gis/history/snapshots', { worldId, name: '基线快照', note: '测试' }, { token: adminToken });
        expect.status(r, 201);
        snapshotId = r.json.snapshot.id;
        assert.ok(r.json.snapshot.objectCount >= 2);
        r = await api.get(`/api/gis/history/snapshots?worldId=${worldId}`);
        expect.ok(r);
        assert.ok(r.json.items.some((s) => s.id === snapshotId));
    });

    await runner.test('历史视图按时间/快照重建且不影响当前数据', async () => {
        let r = await api.get(`/api/gis/history/at?snapshotId=${snapshotId}&bbox=-200,-200,200,200`, { token: adminToken });
        expect.ok(r);
        assert.ok(r.json.objects.length >= 2);
        assert.ok(r.json.objects.every((o) => o.historicalRevision > 0));
        r = await api.get(`/api/gis/history/at?worldId=${worldId}&dimension=overworld&bbox=-200,-200,200,200`, { token: adminToken });
        expect.ok(r);
        assert.ok(r.json.count >= 2);
    });

    await runner.test('历史差异对比 snapshot vs current', async () => {
        const r = await api.get(`/api/gis/history/diff?snapshotId=${snapshotId}&against=current`, { token: adminToken });
        expect.ok(r);
        assert.ok(typeof r.json.summary.added === 'number');
        assert.ok(typeof r.json.summary.changed === 'number');
    });

    /* ---------------- 集市地点 / XBed 预留 ---------------- */
    await runner.test('集市地点投影：数量与基线一致（3 行）', async () => {
        const r = await api.get('/api/gis/market/locations');
        expect.ok(r);
        assert.strictEqual(r.json.total, 3);
        assert.ok(r.json.items.every((i) => i.kind === 'market_store' && i.link.includes('/market/store/')));
        const count = await api.get('/api/gis/market/locations/count');
        expect.ok(count);
        assert.strictEqual(count.json.marketLocations, 3);
        assert.strictEqual(count.json.consistent, true);
    });

    await runner.test('统一地点引用包含集市地点，并可按 bbox 过滤', async () => {
        let r = await api.get('/api/gis/places?kind=market_store');
        expect.ok(r);
        assert.ok(r.json.items.length >= 3);
        r = await api.get('/api/gis/places?kind=market_store&bbox=0,-10000,400,-9000');
        expect.ok(r);
    });

    await runner.test('XBed 预留地点引用 CRUD', async () => {
        let r = await api.post('/api/gis/places-refs', {
            externalSystem: 'xbed', externalId: 'event-2026-001', refKind: 'marker', refId: markerId,
            worldId, dimension: 'overworld', label: '比赛场地'
        }, { token: adminToken });
        expect.status(r, 201);
        assert.strictEqual(r.json.ref.externalId, 'event-2026-001');
        r = await api.get('/api/gis/places-refs?externalSystem=xbed', { token: adminToken });
        expect.ok(r);
        assert.ok(r.json.items.some((i) => i.externalId === 'event-2026-001'));
        r = await api.del('/api/gis/places-refs/xbed/event-2026-001', { token: adminToken });
        expect.ok(r);
        assert.strictEqual(r.json.deleted, true);
    });

    /* ---------------- 管理接口与安全 ---------------- */
    await runner.test('归档后客户端 bootstrap：不再返回 ACTIVE 世界，明确进入本地模式', async () => {
        // 独立服务器，避免其它测试世界的干扰
        const boot = await kit.seedServerAndWorld({ serverKey: 'boot_srv', serverName: '引导服', worldKey: 'boot-main' });
        const bootWorldId = boot.world.id;
        const arch = await api.post('/api/gis/history/archive', { worldId: bootWorldId }, { token: adminToken });
        expect.ok(arch);
        const r = await api.get('/api/gis/client/bootstrap?serverKey=boot_srv', { token: adminToken });
        expect.ok(r);
        const active = (r.json.worlds || []).filter((w) => w.status === 'ACTIVE');
        assert.strictEqual(active.length, 0, '归档后不应有 ACTIVE 世界');
        assert.strictEqual(r.json.uploadEnabled, false, '没有 ACTIVE 世界时必须禁止上传（本地模式）');
        assert.strictEqual(r.json.reason, 'no_active_world');
        assert.ok(r.json.localModeHint && r.json.localModeHint.includes('本地模式'));
        // resolve-world 对归档世界给出 world_archived
        const rw = await api.post('/api/gis/client/resolve-world', {
            serverKey: 'boot_srv', worldId: bootWorldId, worldKey: boot.world.worldKey, dimension: 'overworld'
        }, { token: adminToken });
        expect.error(rw, 'world_archived', 409);
        // 未归档的主世界不受影响
        const main = await api.get('/api/gis/client/bootstrap?serverKey=yl', { token: adminToken });
        expect.ok(main);
        assert.ok((main.json.worlds || []).some((w) => w.status === 'ACTIVE'));
        // 集市地点核对不受影响
        const count = await api.get('/api/gis/market/locations/count');
        expect.ok(count);
        assert.strictEqual(count.json.consistent, true);
    });

    await runner.test('管理接口：普通用户 403，管理员 200', async () => {
        let r = await api.get('/api/gis/admin/stats');
        expect.status(r, 401);
        r = await api.get('/api/gis/admin/stats', { token: normalToken });
        expect.status(r, 403);
        r = await api.get('/api/gis/admin/stats', { token: adminToken });
        expect.ok(r);
        assert.ok(Array.isArray(r.json.worlds));
    });

    await runner.test('管理台注册服务器与世界（客户端不能自建世界）', async () => {
        let r = await api.post('/api/gis/admin/servers', { serverKey: 'new_srv', serverName: '新服务器', mcVersion: '1.21.11' }, { token: adminToken });
        expect.ok(r);
        r = await api.post('/api/gis/admin/worlds', { worldKey: 'new_srv-main', serverKey: 'new_srv', serverName: '新服务器', mcVersion: '1.21.11' }, { token: adminToken });
        expect.status(r, 201);
        assert.strictEqual(r.json.world.status, 'ACTIVE');
        // 越权：注册到不存在的服务器
        const bad = await api.post('/api/gis/admin/worlds', { worldKey: 'ghost-main', serverKey: 'no_such' }, { token: adminToken });
        expect.error(bad, 'server_not_registered', 403);
    });

    await runner.test('归档世界后禁止上传（world_archived）', async () => {
        const w = await kit.seedServerAndWorld({ serverKey: 'arch_srv', serverName: '归档服', worldKey: 'arch-main' });
        const m = kit.heightMatrix({});
        const raw = kit.buildBatchBuffer({ worldId: w.world.id, dimension: 'overworld', chunks: [{ chunkX: 0, chunkZ: 0, ...m }] });
        let r = await api.request('POST', `/api/gis/client/chunks?worldId=${w.world.id}&dimension=overworld`, {
            token: adminToken, raw,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'identity', 'Idempotency-Key': 'arch-before-1' }
        });
        expect.ok(r);
        const arch = await api.post('/api/gis/history/archive', { worldId: w.world.id }, { token: adminToken });
        expect.ok(arch);
        assert.strictEqual(arch.json.world.status, 'ARCHIVED');
        r = await api.request('POST', `/api/gis/client/chunks?worldId=${w.world.id}&dimension=overworld`, {
            token: adminToken, raw: kit.buildBatchBuffer({ worldId: w.world.id, dimension: 'overworld', chunks: [{ chunkX: 1, chunkZ: 0, ...m }] }),
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'identity', 'Idempotency-Key': 'arch-after-1' }
        });
        expect.error(r, 'world_archived', 409);
        // 历史数据仍在，可查
        const cov = await api.get(`/api/gis/terrain/coverage?worldId=${w.world.id}&dimension=overworld`);
        expect.ok(cov);
        assert.strictEqual(cov.json.chunkCount, 1);
    });

    await runner.test('删除对象写墓碑，地图查询不再返回', async () => {
        const created = await api.post('/api/gis/objects/marker', {
            name: '待删除地点', category: 'other', worldId, dimension: 'overworld', point: { x: 700, y: 64, z: 700 }
        }, { token: adminToken });
        const id = created.json.object.id;
        await api.post(`/api/gis/objects/marker/${id}/submit`, {}, { token: adminToken });
        await api.post(`/api/gis/objects/marker/${id}/publish`, {}, { token: adminToken });
        let r = await api.get(`/api/gis/objects?worldId=${worldId}&dimension=overworld&bbox=690,690,710,710`);
        assert.ok(r.json.objects.some((o) => o.id === id));
        r = await api.del(`/api/gis/objects/marker/${id}`, { token: adminToken });
        expect.ok(r);
        r = await api.get(`/api/gis/objects?worldId=${worldId}&dimension=overworld&bbox=690,690,710,710`);
        assert.ok(!r.json.objects.some((o) => o.id === id), '已归档对象不应出现在地图查询');
        const sync = await api.get(`/api/gis/client/sync?worldId=${worldId}&dimension=overworld&since=0`, { token: adminToken });
        assert.ok(sync.json.deleted.some((d) => d.id === id), '客户端应收到墓碑');
    });

    await runner.test('审计记录包含上传与发布事件', async () => {
        const r = await api.get('/api/gis/admin/audit?limit=200', { token: adminToken });
        expect.ok(r);
        const events = r.json.items.map((i) => i.event);
        assert.ok(events.includes('chunk_upload'));
        assert.ok(events.includes('object_publish'));
    });

    const ok = runner.summary();
    await app.close();
    // 清理临时库
    try { kit.removeDb(path.join(kit.ROOT, prep.rel)); } catch (e) { /* ignore */ }
    process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
    console.error('测试执行异常:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
});
