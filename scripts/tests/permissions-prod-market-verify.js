/**
 * 集市 market.* 权限增量部署验证（只读）
 * 在应用目录执行：node perm-market-verify.js
 */
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
function check(name, ok, extra) {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra !== undefined ? '  →  ' + JSON.stringify(extra) : ''}`);
}
async function http(method, url, token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { status: res.status, data };
}
const tokenOf = (id, level) => jwt.sign({ userId: id, username: 'verify', level }, JWT_SECRET, { expiresIn: '10m' });

(async () => {
    const home = await fetch(`http://127.0.0.1:${PORT}/market`);
    check('/market 200', home.status === 200, home.status);
    const supers = await all('SELECT id FROM users WHERE level >= 2 ORDER BY id LIMIT 1');
    const admins = await all('SELECT id FROM users WHERE level = 1 ORDER BY id LIMIT 1');
    const lv0 = await all('SELECT id FROM users WHERE COALESCE(level,0) = 0 ORDER BY id DESC LIMIT 1');
    const superTok = supers[0] ? tokenOf(supers[0].id, 2) : null;
    const adminTok = admins[0] ? tokenOf(admins[0].id, 1) : null;
    const lv0Tok = lv0[0] ? tokenOf(lv0[0].id, 0) : null;

    let r = await http('GET', '/api/market/stores');
    check('匿名浏览集市店铺（公开）200', r.status === 200, r.status);
    r = await http('GET', '/api/market/admin/stores');
    check('匿名访问集市管理端 401', r.status === 401, r.status);
    if (adminTok) {
        r = await http('GET', '/api/market/admin/stores', adminTok);
        check('Level 1 保留集市管理能力（兼容层）200', r.status === 200, r.status);
    }
    if (lv0Tok) {
        r = await http('GET', '/api/market/admin/stores', lv0Tok);
        check('Level 0 无角色访问集市管理端 403', r.status === 403, r.status);
    }
    if (superTok) {
        r = await http('GET', '/api/permissions/registry', superTok);
        const marketPerms = (r.data && r.data.permissions || []).filter(p => p.module === 'market');
        check('market.* 权限 6 个已 ACTIVE（注册表）', r.status === 200 && marketPerms.length === 6 && marketPerms.every(p => p.status === 'ACTIVE'),
            marketPerms.map(p => `${p.key}:${p.status}`));
        r = await http('GET', '/api/permissions/roles', superTok);
        check('权限中心角色列表 200（>=9）', r.status === 200 && (r.data.items || []).length >= 9, r.status);
        r = await http('GET', '/api/permissions/roles?module=market', superTok);
        check('集市角色模板可见（>=2）', r.status === 200 && (r.data.items || []).length >= 2, r.status);
    }
    const integrity = (await all('PRAGMA integrity_check'))[0];
    check('数据库 integrity_check=ok', integrity && integrity.integrity_check === 'ok', integrity);

    const failed = results.filter(x => !x.ok);
    console.log(`\n验证结果：通过 ${results.length - failed.length} / 失败 ${failed.length}`);
    if (failed.length) process.exit(1);
    db.close();
    process.exit(0);
})().catch(e => { console.error('验证异常:', e.message); process.exit(1); });
