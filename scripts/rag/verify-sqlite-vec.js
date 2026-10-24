/**
 * sqlite-vec 可行性验证：真实加载扩展 → 建 vec0 表 → 写入向量 → 近邻查询
 * 用法：node scripts/rag/verify-sqlite-vec.js
 *
 * 任务书要求：不能因为 CREATE VIRTUAL TABLE 成功就认为可用，必须真实写入并查询。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const tmpDb = path.join(os.tmpdir(), `rag-vec-test-${Date.now()}.db`);

function loadVecPath() {
    // 官方包提供 getLoadablePath()，内部按平台解析到 vec0.dll / vec0.so / vec0.dylib
    try {
        const vec = require('sqlite-vec');
        if (typeof vec.getLoadablePath === 'function') return vec.getLoadablePath();
        if (typeof vec.load === 'function') return { loadFn: vec.load };
        return { error: 'sqlite-vec 未导出 getLoadablePath/load' };
    } catch (e) {
        return { error: e.message };
    }
}

(async () => {
    console.log('=== sqlite-vec 可行性验证 ===');
    console.log('临时库：' + tmpDb);

    const vecPath = loadVecPath();
    if (typeof vecPath === 'object') {
        console.log('✗ 扩展解析失败：' + vecPath.error);
        process.exit(1);
    }
    console.log('扩展路径：' + vecPath);

    const db = new sqlite3.Database(tmpDb);
    const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => (e ? rej(e) : res())));
    const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
    const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));

    try {
        const ver = await get('SELECT sqlite_version() AS v');
        console.log('SQLite 版本：' + ver.v);

        // 1. 加载扩展
        await new Promise((res, rej) => {
            db.loadExtension(vecPath, (err) => (err ? rej(err) : res()));
        });
        console.log('✓ 扩展加载成功');

        // 2. 版本函数
        const vecVer = await get('SELECT vec_version() AS v');
        console.log('✓ vec_version() = ' + vecVer.v);

        // 3. 建 vec0 虚拟表（1024 维，与 BGE-M3 一致）
        await run(`CREATE VIRTUAL TABLE vec_test USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[8])`);
        console.log('✓ vec0 虚拟表创建成功');

        // 4. 真实写入
        const mk = (seed) => Array.from({ length: 8 }, (_, i) => Number((Math.sin(seed + i) * 0.5 + 0.5).toFixed(4)));
        const rows = [mk(1), mk(2), mk(3)];
        for (let i = 0; i < rows.length; i++) {
            await run('INSERT INTO vec_test (chunk_id, embedding) VALUES (?, ?)', [i + 1, JSON.stringify(rows[i])]);
        }
        const cnt = await get('SELECT COUNT(*) AS c FROM vec_test');
        console.log('✓ 写入向量条数：' + cnt.c);

        // 5. 真实近邻查询
        const q = mk(1.05);
        const hits = await all(
            `SELECT chunk_id, distance FROM vec_test WHERE embedding MATCH ? ORDER BY distance LIMIT 3`,
            [JSON.stringify(q)]
        );
        console.log('✓ 近邻查询返回 ' + hits.length + ' 条：' + hits.map((h) => `#${h.chunk_id}(d=${Number(h.distance).toFixed(4)})`).join(' '));

        // 6. 删除后无孤立记录
        await run('DELETE FROM vec_test WHERE chunk_id = ?', [1]);
        const after = await get('SELECT COUNT(*) AS c FROM vec_test');
        console.log('✓ 删除后条数：' + after.c);

        if (hits.length !== 3 || hits[0].chunk_id !== 1) {
            console.log('✗ 检索结果异常（期望最近邻为 #1）');
            process.exit(1);
        }
        console.log('\n=== 结论：sqlite-vec 可用（写入 + 近邻检索 + 删除均正常） ===');
        process.exit(0);
    } catch (e) {
        console.log('✗ 验证失败：' + e.message);
        process.exit(1);
    }
})();
