/**
 * 权限体系数据库结构（幂等）
 *
 * 由迁移脚本 migrations/100_permissions_schema.js 与运行时 ensureReady() 共同调用，
 * 保证：全新库 / 已升级库 / 重复执行均安全。
 *
 * 表设计（最少必要）：
 *  - permission_definitions      权限定义（代码注册表同步结果；只存定义，不存用户级授权）
 *  - permission_roles            角色（全局/模块，ACTIVE/DISABLED/ARCHIVED，软删除）
 *  - permission_role_permissions 角色 → 权限
 *  - permission_role_members     角色 → 成员
 *  - permission_audit_logs       审计日志
 * 明确不存在任何“单用户直接授权/拒绝”表。
 */
const registry = require('./registry');

function now() {
    const d = new Date();
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d - offset).toISOString().slice(0, 19).replace('T', ' ');
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS permission_definitions (
    key TEXT PRIMARY KEY,
    module TEXT NOT NULL,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_protected INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_permission_definitions_module ON permission_definitions(module, status);

CREATE TABLE IF NOT EXISTS permission_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL CHECK (scope IN ('global', 'module')),
    module TEXT DEFAULT NULL,
    type TEXT NOT NULL DEFAULT 'custom' CHECK (type IN ('system', 'custom')),
    template_key TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
    is_system INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_roles_name ON permission_roles(name);
CREATE INDEX IF NOT EXISTS idx_permission_roles_status ON permission_roles(status, scope, module);

CREATE TABLE IF NOT EXISTS permission_role_permissions (
    role_id INTEGER NOT NULL,
    permission_key TEXT NOT NULL,
    granted_by INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY (role_id, permission_key),
    FOREIGN KEY (role_id) REFERENCES permission_roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_key) REFERENCES permission_definitions(key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_permission_role_permissions_perm ON permission_role_permissions(permission_key);

CREATE TABLE IF NOT EXISTS permission_role_members (
    role_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    granted_by INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY (role_id, user_id),
    FOREIGN KEY (role_id) REFERENCES permission_roles(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_permission_role_members_user ON permission_role_members(user_id);

CREATE TABLE IF NOT EXISTS permission_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    actor_id INTEGER,
    target_type TEXT,
    target_id TEXT,
    before_json TEXT,
    after_json TEXT,
    note TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_permission_audit_actor ON permission_audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_permission_audit_target ON permission_audit_logs(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_permission_audit_created ON permission_audit_logs(created_at);
`;

async function ensureSchema(db) {
    await db.exec(SCHEMA_SQL);
}

/** 把代码注册表同步进 permission_definitions（新增/更新/停用，不物理删除历史） */
async function syncRegistry(db) {
    const ts = now();
    for (const p of registry.PERMISSIONS) {
        const resource = p.resource || (p.key.split('.')[1] || '');
        const action = p.action || (p.key.split('.')[2] || '');
        await db.run(
            `INSERT INTO permission_definitions (key, module, resource, action, description, is_protected, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
                module = excluded.module,
                resource = excluded.resource,
                action = excluded.action,
                description = excluded.description,
                is_protected = excluded.is_protected,
                status = excluded.status,
                updated_at = excluded.updated_at`,
            [p.key, p.module, resource, action, p.description || '', p.protected ? 1 : 0, p.status || 'ACTIVE', ts, ts]
        );
    }
    // 代码里已移除的权限：停用但保留历史（不参与计算、不可分配）
    const keys = registry.PERMISSIONS.map(p => p.key);
    if (keys.length) {
        await db.run(
            `UPDATE permission_definitions SET status = 'DISABLED', updated_at = ?
             WHERE status = 'ACTIVE' AND key NOT IN (${keys.map(() => '?').join(',')})`,
            [ts, ...keys]
        );
    }
    return { total: keys.length, active: registry.listActiveKeys().length };
}

/**
 * 系统角色同步：不存在则创建（type=system, is_system=1）并写入模板权限。
 * 已存在的系统角色不覆盖其权限配置（允许 Level 2 在权限中心微调后保留）。
 */
async function syncSystemRoles(db) {
    const ts = now();
    const created = [];
    for (const tpl of registry.ROLE_TEMPLATES) {
        const exists = await db.get('SELECT id FROM permission_roles WHERE key = ?', [tpl.key]);
        if (exists) continue;
        const r = await db.run(
            `INSERT INTO permission_roles (key, name, description, scope, module, type, template_key, status, is_system, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'system', ?, 'ACTIVE', 1, NULL, ?, ?)`,
            [tpl.key, tpl.name, tpl.description || '', tpl.scope, tpl.module || null, tpl.key, ts, ts]
        );
        for (const perm of tpl.permissions || []) {
            if (!registry.isRegistered(perm)) continue;
            await db.run(
                `INSERT OR IGNORE INTO permission_role_permissions (role_id, permission_key, granted_by, created_at)
                 VALUES (?, ?, NULL, ?)`,
                [r.id, perm, ts]
            );
        }
        created.push({ id: r.id, key: tpl.key, name: tpl.name, permissions: (tpl.permissions || []).length });
    }
    return created;
}

module.exports = { ensureSchema, syncRegistry, syncSystemRoles, now };
