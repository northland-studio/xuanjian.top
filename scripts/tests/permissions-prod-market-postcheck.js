/**
 * market.* 增量部署后的“防覆盖/防回归”补充验证（只读 + 无副作用请求）
 * 在应用目录执行：node market-postcheck.js
 */
const fs = require('fs');
const path = require('path');
const APP = process.cwd();
require(path.join(APP, 'node_modules', 'dotenv')).config({ path: path.join(APP, '.env') });
const sqlite3 = require(path.join(APP, 'node_modules', 'sqlite3')).verbose();
const jwt = require(path.join(APP, 'node_modules', 'jsonwebtoken'));
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3000;
const db = new sqlite3.Database(path.join(APP, 'data', 'guild.db'));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
const results = [];
const check = (name, ok, extra) => {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra !== undefined ? '  →  ' + JSON.stringify(extra) : ''}`);
};
async function http(method, url, token, body) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { status: res.status, data };
}
const tokenOf = (id, level) => jwt.sign({ userId: id, username: 'postcheck', level }, JWT_SECRET, { expiresIn: '10m' });

(async () => {
    // 1) 部署文件完整性：必须包含 GIS 提交的 world_id / gis_marker_id 字段
    const marketSrc = fs.readFileSync(path.join(APP, 'routes', 'market.js'), 'utf8');
    check('routes/market.js 含 GIS world_id 字段引用', /world_id/.test(marketSrc), null);
    check('routes/market.js 含 GIS gis_marker_id 字段引用', /gis_marker_id/.test(marketSrc), null);
    check('routes/market.js 含 market.access 权限点', /market\.access/.test(marketSrc), null);
    check('routes/market.js 含 adminOrPermission 细粒度权限', /adminOrPermission/.test(marketSrc), null);
    // 统计权限覆盖数量
    const adminOrCount = (marketSrc.match(/adminOrPermission\('/g) || []).length;
    check('market.js 细粒度权限接入点 >= 40（20 admin + 20 merchant）', adminOrCount >= 40, adminOrCount);

    // 2) 集市地点数据未被破坏
    const locCols = (await all('PRAGMA table_info(market_store_locations)')).map(c => c.name);
    check('market_store_locations 保留 world_id/gis_marker_id 列',
        locCols.includes('world_id') && locCols.includes('gis_marker_id'), locCols);
    const locRows = await all('SELECT id, store_id, x, y, z, world_id, gis_marker_id FROM market_store_locations ORDER BY id');
    check('集市地点仍为 2 条且坐标未变',
        locRows.length === 2 && locRows[0].x === 0 && locRows[0].y === 64 && locRows[1].x === -12530 && locRows[1].z === -2400,
        locRows);
    check('集市地点新列值为 NULL（未误写）', locRows.every(r => r.world_id === null && r.gis_marker_id === null), locRows);

    // 3) 页面与公开接口
    let r = await fetch(`http://127.0.0.1:${PORT}/market`);
    check('/market 页面 200', r.status === 200, r.status);
    r = await http('GET', '/api/market/stores?limit=5');
    check('集市店铺列表 200（公开接口正常；当前生产无上架店铺时 total=0 属业务状态）',
        r.status === 200 && r.data && Array.isArray(r.data.items), r.status);
    r = await http('GET', '/api/market/products?limit=5');
    check('集市商品列表 200', r.status === 200 && r.data && Array.isArray(r.data.items), r.status);
    r = await http('GET', '/api/gis/market/locations/count');
    check('GIS 集市地点统计 marketLocations=2 且 consistent（未被权限变更破坏）',
        r.status === 200 && r.data && r.data.marketLocations === 2 && r.data.consistent === true, r);

    // 集市业务表数据量与部署前备份一致（不变量：本次只改鉴权，不应动任何集市数据）
    const backupFile = process.argv[2];
    if (backupFile && fs.existsSync(backupFile)) {
        const bdb = new sqlite3.Database(backupFile);
        const ball = (sql) => new Promise((res, rej) => bdb.all(sql, (e, rr) => (e ? rej(e) : res(rr))));
        const tables = ['market_stores', 'market_products', 'market_orders', 'market_order_items', 'market_store_locations'];
        for (const tb of tables) {
            const cur = (await all(`SELECT COUNT(*) AS c FROM ${tb}`))[0].c;
            const old = (await ball(`SELECT COUNT(*) AS c FROM ${tb}`))[0].c;
            check(`集市表 ${tb} 数量与部署前一致（${old}）`, cur === old, { before: old, after: cur });
        }
        await new Promise((resolve) => bdb.close(() => resolve()));
    }

    // 4) 下单经济资格（只读语义：非经济成员被拒；经济成员进入业务校验但不创建订单）
    const econ = await all("SELECT id FROM permission_roles WHERE key='economy_member'");
    const nonEconUser = (await all(`
        SELECT u.id FROM users u
         WHERE COALESCE(u.level,0) >= 0 AND COALESCE(u.is_frozen,0) = 0 AND COALESCE(u.contribution,0) = 0
           AND NOT EXISTS (SELECT 1 FROM permission_role_members m WHERE m.user_id = u.id)
         ORDER BY u.id DESC LIMIT 1`))[0];
    const econUser = (await all(`
        SELECT u.id FROM users u JOIN permission_role_members m ON m.user_id = u.id
         WHERE m.role_id = ? AND COALESCE(u.level,0) >= 0 AND COALESCE(u.is_frozen,0) = 0
         ORDER BY u.id LIMIT 1`, [econ[0].id]))[0];
    if (nonEconUser) {
        r = await http('POST', '/api/market/orders', tokenOf(nonEconUser.id, 0), { store_id: 1, items: [] });
        check('非经济成员下单 403 ECONOMY_ACCESS_REQUIRED',
            r.status === 403 && r.data && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r);
    }
    if (econUser) {
        // 空购物车会在服务层最先被拒绝（400 购物车为空），绝不创建订单
        r = await http('POST', '/api/market/orders', tokenOf(econUser.id, 0), { store_id: 1, items: [] });
        check('经济成员通过经济闸门（非 403，业务层 400 空购物车）', r.status !== 403 && r.status === 400, { status: r.status, code: r.data && r.data.code });
    }

    // 5) 权限中心 market 权限状态
    const supers = await all('SELECT id FROM users WHERE level >= 2 ORDER BY id LIMIT 1');
    if (supers.length) {
        r = await http('GET', '/api/permissions/registry', tokenOf(supers[0].id, 2));
        const marketPerms = (r.data && r.data.permissions || []).filter(p => p.module === 'market');
        check('registry market.* 6 项且全部 ACTIVE', marketPerms.length === 6 && marketPerms.every(p => p.status === 'ACTIVE'),
            marketPerms.map(p => `${p.key}:${p.status}`));
    }
    const integrity = (await all('PRAGMA integrity_check'))[0];
    check('数据库 integrity_check=ok', integrity && integrity.integrity_check === 'ok', integrity);

    const failed = results.filter(x => !x.ok);
    console.log(`\n补充验证：通过 ${results.length - failed.length} / 失败 ${failed.length}`);
    if (failed.length) process.exit(1);
    db.close();
    process.exit(0);
})().catch(e => { console.error('补充验证异常:', e.message); process.exit(1); });
