/**
 * 权限体系迁移核对报告（只读）
 *
 * 用法：
 *   node scripts/tests/permissions-migration-verify.js                  # 默认 data/guild.db
 *   DB_FILE=data/xxx.db node scripts/tests/permissions-migration-verify.js
 *
 * 输出迁移前后必须一致的核心数据（用户/经济账户/总余额/流水/转账/角色成员），
 * 以及权限注册表与系统角色同步情况。不修改任何数据。
 */
const path = require('path');

const dbFile = process.env.DB_FILE || 'data/guild.db';
process.env.DB_FILE = process.env.DB_FILE || dbFile;

const db = require(path.join(__dirname, '..', '..', 'database'));
const registry = require(path.join(__dirname, '..', '..', 'lib', 'permissions', 'registry'));

async function main() {
    const out = {};
    out.dbFile = dbFile;

    out.users = (await db.get('SELECT COUNT(*) AS c FROM users')).c;
    out.systemAccounts = (await db.get('SELECT COUNT(*) AS c FROM users WHERE COALESCE(level,0) < 0')).c;
    out.totalBalance = (await db.get('SELECT COALESCE(SUM(COALESCE(contribution,0)),0) AS s FROM users')).s;

    const hasLogs = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='contribution_logs'");
    out.contributionLogs = hasLogs ? (await db.get('SELECT COUNT(*) AS c FROM contribution_logs')).c : null;
    const hasTransfers = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='transfers'");
    out.transfers = hasTransfers ? (await db.get('SELECT COUNT(*) AS c FROM transfers')).c : null;

    out.economyAccounts = (await db.get(`
        SELECT COUNT(*) AS c FROM users u
         WHERE COALESCE(u.level,0) >= 0
           AND (COALESCE(u.contribution,0) != 0
                ${hasLogs ? 'OR EXISTS (SELECT 1 FROM contribution_logs cl WHERE cl.user_id = u.id)' : ''})`)).c;

    const permTable = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='permission_definitions'");
    if (permTable) {
        out.permissionDefinitions = (await db.get('SELECT COUNT(*) AS c FROM permission_definitions')).c;
        out.permissionActive = (await db.get("SELECT COUNT(*) AS c FROM permission_definitions WHERE status='ACTIVE'")).c;
        out.codeRegistry = { total: registry.PERMISSIONS.length, active: registry.listActiveKeys().length };
        out.roles = (await db.all(
            'SELECT id, key, name, scope, module, status, is_system, template_key FROM permission_roles ORDER BY id'
        )).map(r => ({
            ...r,
            permissions: 0,
            members: 0
        }));
        for (const r of out.roles) {
            r.permissions = (await db.get('SELECT COUNT(*) AS c FROM permission_role_permissions WHERE role_id = ?', [r.id])).c;
            r.members = (await db.get('SELECT COUNT(*) AS c FROM permission_role_members WHERE role_id = ?', [r.id])).c;
        }
        const economyRole = await db.get("SELECT id FROM permission_roles WHERE key='economy_member'");
        out.economyMemberCount = economyRole
            ? (await db.get('SELECT COUNT(*) AS c FROM permission_role_members WHERE role_id = ?', [economyRole.id])).c
            : 0;
        out.systemAccountsInRoles = (await db.get(`
            SELECT COUNT(*) AS c FROM permission_role_members m JOIN users u ON u.id = m.user_id
             WHERE COALESCE(u.level,0) < 0`)).c;
        out.auditLogs = (await db.get('SELECT COUNT(*) AS c FROM permission_audit_logs')).c;
        out.migrations = await db.all('SELECT id, name, applied_at FROM schema_migrations ORDER BY id').catch(() => []);
    } else {
        out.roles = null;
        out.warning = '权限表不存在：请先执行 node migrations/run.js --backup';
    }

    console.log(JSON.stringify(out, null, 2));
    console.log('\n核对要点：总余额/流水数/转账数应与迁移前完全一致；系统账号不应出现在普通角色成员中。');
}

main().then(() => process.exit(0)).catch((e) => {
    console.error('核对失败:', e.message);
    process.exit(1);
});
