/**
 * GIS 迁移测试：真实 migrations/run.js + 幂等 + 旧数据零丢失。
 *
 * 运行：node scripts/tests/gis-migration-test.js
 *
 * 断言：
 *  1. 120-126 全部执行成功并记录到 schema_migrations；
 *  2. 重复执行 run.js 不再有 pending，且数据不变；
 *  3. 每个迁移的 up() 单独重复调用也幂等（防止记录表丢失后重放炸库）；
 *  4. market_store_locations 旧数据（数量/id/坐标/时间戳）完全不变；
 *  5. World Registry 种子正确（服务器来自集市旧数据、每服一个 ACTIVE 世界 + 3 维度）。
 */

const assert = require('assert');
const kit = require('./gis-testkit');

async function main() {
    const runner = kit.makeRunner('GIS 迁移测试');
    const { execFileSync } = require('child_process');

    // 基线：2 行集市旧地点（与生产一致）
    const { rel, abs } = kit.dbFile('gis-migration');
    kit.removeDb(abs);
    process.env.DB_FILE = rel; // 必须在 require('../../database') 之前设置
    await kit.createBase(abs, { marketLocations: 2 });

    const sqlite3 = require('sqlite3').verbose();
    const open = () => new sqlite3.Database(abs);
    const query = (conn, sql, params = []) => new Promise((resolve, reject) => conn.all(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
    const close = (conn) => new Promise((resolve) => conn.close(() => resolve()));

    let beforeRows;
    {
        const conn = open();
        beforeRows = await query(conn, `SELECT * FROM market_store_locations ORDER BY id`);
        await close(conn);
        assert.strictEqual(beforeRows.length, 2);
    }

    await runner.test('首次执行 migrations/run.js 成功（120-126 全部应用）', async () => {
        const firstOut = execFileSync(process.execPath, ['migrations/run.js', `--db=${rel}`], { cwd: kit.ROOT, encoding: 'utf8' });
        for (const id of ['120', '121', '122', '123', '124', '125', '126']) {
            assert.ok(firstOut.includes(`[${id}]`), `输出应包含迁移 ${id}`);
        }
        assert.ok(!firstOut.includes('\u2718'), '不应有失败迁移');
        const conn = open();
        const rows = await query(conn, `SELECT id, name FROM schema_migrations ORDER BY CAST(id AS INTEGER)`);
        await close(conn);
        const ids = rows.map((r) => String(r.id));
        for (const id of ['120', '121', '122', '123', '124', '125', '126']) assert.ok(ids.includes(id), `schema_migrations 应记录 ${id}`);
        // 权限组迁移也应在同一 runner 下通过（跨模块兼容）
        assert.ok(ids.includes('100') && ids.includes('101') && ids.includes('102'));
    });

    await runner.test('GIS 表与索引齐备', async () => {
        const conn = open();
        const tables = (await query(conn, `SELECT name FROM sqlite_master WHERE type='table'`)).map((r) => r.name);
        for (const t of ['gis_servers', 'gis_worlds', 'gis_world_dimensions', 'gis_upload_batches', 'gis_seq', 'gis_audit',
            'gis_districts', 'gis_roads', 'gis_markers', 'gis_revisions', 'gis_published', 'gis_review_log',
            'gis_elevation_chunks', 'gis_terrain_cache', 'gis_jobs', 'gis_snapshots', 'gis_snapshot_entries', 'gis_place_refs']) {
            assert.ok(tables.includes(t), `缺少表 ${t}`);
        }
        const indexes = (await query(conn, `SELECT name FROM sqlite_master WHERE type='index'`)).map((r) => r.name);
        for (const i of ['idx_gis_pub_bbox', 'idx_gis_pub_seq', 'idx_gis_rev_obj', 'idx_gis_districts_bbox',
            'idx_gis_roads_bbox', 'idx_gis_markers_bbox', 'idx_gis_elev_lookup']) {
            assert.ok(indexes.includes(i), `缺少索引 ${i}`);
        }
        const seq = await query(conn, `SELECT value FROM gis_seq WHERE name='published'`);
        assert.strictEqual(Number(seq[0].value), 0);
        await close(conn);
    });

    await runner.test('集市旧数据零丢失：数量/id/坐标/标签/时间戳完全一致', async () => {
        const conn = open();
        const rows = await query(conn, `SELECT * FROM market_store_locations ORDER BY id`);
        await close(conn);
        assert.strictEqual(rows.length, beforeRows.length);
        const strip = (r) => `${r.id}|${r.store_id}|${r.server_key}|${r.server_name}|${r.dimension}|${r.x}|${r.y}|${r.z}|${r.label}|${r.note}|${r.is_public}|${r.created_at}|${r.updated_at}`;
        assert.deepStrictEqual(rows.map(strip), beforeRows.map(strip));
        assert.ok(rows.every((r) => r.world_id === null && r.gis_marker_id === null));
    });

    await runner.test('World Registry 种子：服务器来自集市、每服一个 ACTIVE 世界 + 3 维度', async () => {
        const conn = open();
        const servers = await query(conn, `SELECT server_key, upload_policy, status FROM gis_servers ORDER BY server_key`);
        const worlds = await query(conn, `SELECT id, world_key, server_key, status, is_current FROM gis_worlds`);
        const dims = await query(conn, `SELECT world_id, dimension FROM gis_world_dimensions`);
        await close(conn);
        const keys = servers.map((s) => s.server_key).sort();
        const expected = Array.from(new Set(beforeRows.map((r) => r.server_key))).sort();
        assert.deepStrictEqual(keys, expected, '注册服务器应与集市旧数据 server_key 一致');
        assert.ok(servers.every((s) => s.status === 'ACTIVE'));
        assert.ok(servers.every((s) => s.upload_policy === 'member'));
        for (const s of expected) {
            const ws = worlds.filter((w) => w.server_key === s && w.status === 'ACTIVE');
            assert.strictEqual(ws.length, 1, `${s} 应恰好一个 ACTIVE 世界`);
            assert.strictEqual(Number(ws[0].is_current), 1, `${s} 的 ACTIVE 世界应为 current`);
            const ds = dims.filter((d) => d.world_id === ws[0].id).map((d) => d.dimension).sort();
            assert.deepStrictEqual(ds, ['end', 'nether', 'overworld']);
        }
    });

    await runner.test('重复执行 run.js：无 pending、无报错、数据不变', async () => {
        const secondOut = execFileSync(process.execPath, ['migrations/run.js', `--db=${rel}`], { cwd: kit.ROOT, encoding: 'utf8' });
        assert.ok(secondOut.includes('没有待执行的迁移') || secondOut.includes('待应用: 0'), `第二次执行应无 pending，实际：${secondOut}`);
        const conn = open();
        const rows = await query(conn, `SELECT * FROM market_store_locations ORDER BY id`);
        const cnt = await query(conn, `SELECT COUNT(*) AS c FROM schema_migrations`);
        const dup = await query(conn, `SELECT id, COUNT(*) AS c FROM schema_migrations GROUP BY id HAVING c > 1`);
        await close(conn);
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(dup.length, 0, 'schema_migrations 不应有重复记录');
        assert.ok(Number(cnt[0].c) >= 10);
    });

    await runner.test('每个迁移 up() 单独重复执行也幂等（不依赖记录表）', async () => {
        const db = require('../../database');
        const files = ['120_gis_worlds', '121_gis_objects', '122_gis_versions', '123_gis_terrain',
            '124_gis_history', '125_gis_market', '126_gis_seed'];
        for (const f of files) {
            const mod = require(`../../migrations/${f}`);
            assert.strictEqual(typeof mod.up, 'function', `${f} 必须导出 up(db)`);
            assert.ok(mod.id, `${f} 必须导出 id`);
            await mod.up(db);
            await mod.up(db);
        }
        const rows = await db.all(`SELECT * FROM market_store_locations ORDER BY id`);
        assert.strictEqual(rows.length, 2, '重放迁移不得增删旧地点');
        assert.deepStrictEqual(
            rows.map((r) => `${r.id}|${r.x}|${r.z}|${r.updated_at}`),
            beforeRows.map((r) => `${r.id}|${r.x}|${r.z}|${r.updated_at}`),
            '重放迁移不得修改旧地点'
        );
        const worlds = await db.all(`SELECT COUNT(*) AS c FROM gis_worlds`);
        assert.ok(Number(worlds[0].c) >= 2);
    });

    await runner.test('迁移编号无冲突、GIS 只用 120-139、id 与文件名一致', async () => {
        const fs = require('fs');
        const path = require('path');
        const dir = path.join(kit.ROOT, 'migrations');
        const files = fs.readdirSync(dir).filter((f) => /^\d{3,4}[_-].+\.js$/.test(f) && f !== 'run.js');
        const gisFiles = files.filter((f) => Number(f.slice(0, 3)) >= 120 && Number(f.slice(0, 3)) <= 139);
        assert.ok(gisFiles.length >= 7, 'GIS 迁移文件应 >= 7');
        for (const f of gisFiles) {
            const mod = require(path.join(dir, f));
            const num = f.slice(0, 3);
            assert.strictEqual(String(mod.id), num, `${f} 的 id 必须与文件名编号一致`);
        }
        const allNums = files.map((f) => Number(f.slice(0, 3)));
        assert.strictEqual(new Set(allNums).size, allNums.length, '迁移编号不得重复');
    });

    const ok = runner.summary();
    kit.removeDb(abs);
    process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
    console.error('测试执行异常:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
});
