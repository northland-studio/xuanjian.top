/**
 * 部署前后计数（只读）：用于迁移前后核对。
 * 用法（在应用目录执行）：node /root/xxx/perm-counts.js
 * 输出单行 JSON。
 */
const path = require('path');
const APP = process.cwd();
const sqlite3 = require(path.join(APP, 'node_modules', 'sqlite3')).verbose();
const db = new sqlite3.Database(path.join(APP, 'data', 'guild.db'));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
const get = async (sql, p = []) => (await all(sql, p))[0] || {};

(async () => {
    const tables = new Set((await all("SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name));
    const out = {};
    out.users = (await get('SELECT COUNT(*) AS c FROM users')).c;
    out.totalContribution = (await get('SELECT COALESCE(ROUND(SUM(COALESCE(contribution,0)),2),0) AS s FROM users')).s;
    out.wikiPages = tables.has('wiki_pages') ? (await get('SELECT COUNT(*) AS c FROM wiki_pages')).c : null;
    out.marketStoreLocations = tables.has('market_store_locations') ? (await get('SELECT COUNT(*) AS c FROM market_store_locations')).c : null;
    out.contributionLogs = tables.has('contribution_logs') ? (await get('SELECT COUNT(*) AS c FROM contribution_logs')).c : null;
    out.systemAccounts = (await get('SELECT COUNT(*) AS c FROM users WHERE COALESCE(level,0) < 0')).c;
    if (tables.has('permission_roles')) {
        out.permissionRoles = (await get('SELECT COUNT(*) AS c FROM permission_roles')).c;
        out.permissionDefinitions = (await get('SELECT COUNT(*) AS c FROM permission_definitions')).c;
        const econ = await get("SELECT id FROM permission_roles WHERE key='economy_member'");
        out.economyMemberCount = econ.id ? (await get('SELECT COUNT(*) AS c FROM permission_role_members WHERE role_id = ?', [econ.id])).c : null;
        out.economyAccounts = (await get(`
            SELECT COUNT(*) AS c FROM users u
             WHERE COALESCE(u.level,0) >= 0
               AND (COALESCE(u.contribution,0) != 0 ${tables.has('contribution_logs') ? 'OR EXISTS (SELECT 1 FROM contribution_logs cl WHERE cl.user_id = u.id)' : ''})`)).c;
        out.auditLogs = (await get('SELECT COUNT(*) AS c FROM permission_audit_logs')).c;
    }
    out.integrity = (await get('PRAGMA integrity_check')).integrity_check;
    console.log(JSON.stringify(out));
    db.close();
})().catch(e => { console.error('counts error:', e.message); process.exit(1); });
