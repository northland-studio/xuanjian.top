/**
 * 权限升级生产验证（只读，无副作用）
 * 在应用目录执行：node /root/perm-deploy/perm-verify.js
 */
const fs = require('fs');
const path = require('path');

const APP = process.cwd();
require(path.join(APP, 'node_modules', 'dotenv')).config({ path: path.join(APP, '.env') });
const sqlite3 = require(path.join(APP, 'node_modules', 'sqlite3')).verbose();
const jwt = require(path.join(APP, 'node_modules', 'jsonwebtoken'));
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3000;

if (!JWT_SECRET) { console.error('缺少 JWT_SECRET'); process.exit(1); }

const db = new sqlite3.Database(path.join(APP, 'data', 'guild.db'));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
const get = async (sql, p = []) => (await all(sql, p))[0] || {};

const results = [];
function check(name, ok, extra) {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined && !ok ? '  →  ' + JSON.stringify(extra) : ''}`);
    return ok;
}
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
const tokenOf = (userId, level) => jwt.sign({ userId, username: 'verify', level }, JWT_SECRET, { expiresIn: '10m' });

(async () => {
    // ===== 1. 站点可用性 =====
    for (const [label, url] of [['首页', '/'], ['/admin', '/admin'], ['/market', '/market']]) {
        const r = await fetch(`http://127.0.0.1:${PORT}${url}`);
        check(`${label} 200`, r.status === 200, r.status);
    }

    // ===== 2. 匿名鉴权语义 =====
    let r = await http('GET', '/api/permissions/roles');
    check('匿名 /api/permissions/roles → 401 UNAUTHORIZED', r.status === 401 && r.data && r.data.code === 'UNAUTHORIZED', r);
    r = await http('GET', '/api/auth/me');
    check('匿名 /api/auth/me → 401', r.status === 401, r.status);
    r = await http('GET', '/api/gis/client/contract');
    check('匿名 /api/gis/client/contract → 200 或 401（装好 GIS 路由）', r.status === 200 || r.status === 401, r.status);
    // 确认不是 404（路由缺失会导致 404）
    check('GIS 路由已挂载（非 404）', r.status !== 404, r.status);

    // ===== 3. 账号与权限 =====
    const supers = await all('SELECT id, username FROM users WHERE level >= 2 ORDER BY id LIMIT 1');
    const admins = await all('SELECT id, username FROM users WHERE level = 1 ORDER BY id LIMIT 1');
    const level0 = await all('SELECT id, username FROM users WHERE COALESCE(level,0) = 0 ORDER BY id LIMIT 1');
    check('存在 Level 2 超级管理员', supers.length === 1, supers.length);
    check('存在 Level 1 管理员（回归验证）', admins.length === 1, admins.length);
    const superTok = supers[0] ? tokenOf(supers[0].id, 2) : null;
    const adminTok = admins[0] ? tokenOf(admins[0].id, 1) : null;
    const lv0Tok = level0[0] ? tokenOf(level0[0].id, 0) : null;

    if (superTok) {
        r = await http('GET', '/api/auth/me', superTok);
        check('/api/auth/me 含 permissions 数组', r.status === 200 && Array.isArray(r.data.permissions) && r.data.permissions.length > 0, r.status);
        check('/api/auth/me 含 roles/economy 字段', r.data && Array.isArray(r.data.roles) && r.data.economy && typeof r.data.economy.access === 'boolean', r.data && { roles: r.data.roles && r.data.roles.length });
        r = await http('GET', '/api/permissions/roles', superTok);
        check('Level 2 可进入权限中心（角色列表 200，>=9 个角色）', r.status === 200 && (r.data.items || []).length >= 9, r.status);
        r = await http('GET', '/api/permissions/registry', superTok);
        check('权限注册表 >= 39 项（38 + admin.permissions.view）', r.status === 200 && r.data.total >= 39, r.data && r.data.total);
        r = await http('GET', '/api/permissions/me', superTok);
        check('权限管理员标识 isPermissionAdmin=true', r.status === 200 && r.data.isPermissionAdmin === true, r.data && r.data.isPermissionAdmin);
    }
    if (adminTok) {
        r = await http('GET', '/api/admin/users', adminTok);
        check('Level 1 保留用户管理（200）', r.status === 200, r.status);
        r = await http('GET', '/api/contributions/all-logs', adminTok);
        check('Level 1 保留全局贡献点流水（200）', r.status === 200, r.status);
        r = await http('GET', '/api/wiki/admin/pages', adminTok);
        check('Level 1 保留 Wiki 管理（200）', r.status === 200, r.status);
        r = await http('GET', '/api/permissions/roles', adminTok);
        check('Level 1 可进权限中心（只读 200）', r.status === 200, r.status);
        r = await http('POST', '/api/permissions/roles', adminTok, { name: 'verify-should-fail', scope: 'module', module: 'wiki', permissions: [] });
        check('Level 1 不可修改权限（创建角色 403）', r.status === 403, r.status);
    }
    if (lv0Tok) {
        r = await http('GET', '/api/admin/users', lv0Tok);
        check('Level 0 无法访问用户管理（403）', r.status === 403, r.status);
    }

    // ===== 4. 封禁立即失效 =====
    const frozen = await all('SELECT id FROM users WHERE is_frozen = 1 ORDER BY id LIMIT 1');
    if (frozen.length) {
        r = await http('GET', '/api/auth/me', tokenOf(frozen[0].id, 0));
        check('封禁账号 403 ACCOUNT_FROZEN', r.status === 403 && r.data && r.data.code === 'ACCOUNT_FROZEN', r);
    } else {
        check('封禁账号 403 ACCOUNT_FROZEN（生产暂无封禁账号，跳过）', true);
    }

    // ===== 5. 经济资格 =====
    const econRole = await get("SELECT id FROM permission_roles WHERE key='economy_member'");
    const econMembers = econRole.id ? await all(`
        SELECT u.id, u.username, COALESCE(u.contribution,0) AS contribution
          FROM permission_role_members m JOIN users u ON u.id = m.user_id
         WHERE m.role_id = ? AND COALESCE(u.level,0) >= 0 AND COALESCE(u.is_frozen,0) = 0
         ORDER BY u.id LIMIT 3`, [econRole.id]) : [];
    const nonEcon = await all(`
        SELECT u.id FROM users u
         WHERE COALESCE(u.level,0) >= 0 AND COALESCE(u.is_frozen,0) = 0 AND COALESCE(u.contribution,0) = 0
           AND NOT EXISTS (SELECT 1 FROM permission_role_members m WHERE m.user_id = u.id)
         ORDER BY u.id DESC LIMIT 1`);
    if (econMembers.length) {
        r = await http('GET', '/api/auth/me', tokenOf(econMembers[0].id, 0));
        check('经济成员 /me 余额可见（数字）', r.status === 200 && typeof r.data.contribution === 'number', r.data && r.data.contribution);
        r = await http('GET', '/api/contributions/logs', tokenOf(econMembers[0].id, 0));
        check('经济成员可查自己的流水（200）', r.status === 200, r.status);
    } else {
        check('存在经济成员（用于验证）', false, 'no economy member');
    }
    if (nonEcon.length) {
        const nTok = tokenOf(nonEcon[0].id, 0);
        r = await http('GET', '/api/auth/me', nTok);
        check('无经济资格 /me 不返回余额（null）', r.status === 200 && r.data.contribution === null, r.data && r.data.contribution);
        r = await http('GET', '/api/contributions/logs', nTok);
        check('无经济资格查流水 403 ECONOMY_ACCESS_REQUIRED', r.status === 403 && r.data && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r);
        r = await http('POST', '/api/contributions/transfer', nTok, {});
        check('无经济资格转账 403', r.status === 403, r.status);
        r = await http('POST', '/api/market/orders', nTok, { store_id: 1, items: [] });
        check('无经济资格集市下单 403 ECONOMY_ACCESS_REQUIRED', r.status === 403 && r.data && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r);
    } else {
        check('存在无经济资格账号（用于验证）', false, 'no non-economy user');
    }

    // ===== 6. 模组通道经济校验 =====
    const binding = await get("SELECT uuid, user_id FROM mod_bindings WHERE status='confirmed' ORDER BY id DESC LIMIT 1");
    if (binding) {
        const isMember = econRole.id ? await get('SELECT 1 AS x FROM permission_role_members WHERE role_id = ? AND user_id = ?', [econRole.id, binding.user_id]) : null;
        r = await http('GET', `/api/mod/balance?uuid=${encodeURIComponent(binding.uuid)}`);
        if (isMember) check('模组余额：经济成员可见（200）', r.status === 200, r.status);
        else check('模组余额：无经济资格 403', r.status === 403 && r.data && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r);
    } else {
        check('模组通道验证（生产暂无已确认绑定，跳过）', true);
    }

    // ===== 7. 数据完整性 =====
    const integrity = await get('PRAGMA integrity_check');
    check('数据库 integrity_check = ok', integrity.integrity_check === 'ok', integrity.integrity_check);
    const memberCount = econRole.id ? (await get('SELECT COUNT(*) AS c FROM permission_role_members WHERE role_id = ?', [econRole.id])).c : null;
    const roleCount = (await get('SELECT COUNT(*) AS c FROM permission_roles')).c;
    const defs = (await get('SELECT COUNT(*) AS c FROM permission_definitions')).c;
    const sysInRoles = (await get(`SELECT COUNT(*) AS c FROM permission_role_members m JOIN users u ON u.id = m.user_id WHERE COALESCE(u.level,0) < 0`)).c;
    check('系统角色 >= 9 个', roleCount >= 9, roleCount);
    check('权限定义 >= 39 个', defs >= 39, defs);
    check('系统账号未加入角色', sysInRoles === 0, sysInRoles);
    console.log(JSON.stringify({ economyMemberCount: memberCount, roleCount, permissionDefinitions: defs, sysInRoles }));

    const failed = results.filter(x => !x.ok);
    console.log(`\n验证结果：通过 ${results.length - failed.length} / 失败 ${failed.length}`);
    if (failed.length) {
        console.log('失败项：' + failed.map(f => f.name).join('；'));
        process.exit(1);
    }
    db.close();
    process.exit(0);
})().catch((e) => {
    console.error('验证脚本异常:', e.message);
    process.exit(1);
});
