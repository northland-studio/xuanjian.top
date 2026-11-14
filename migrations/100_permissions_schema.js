/**
 * 100 — 权限体系数据表（幂等）
 *
 * 新表：permission_definitions / permission_roles / permission_role_permissions /
 *       permission_role_members / permission_audit_logs
 * 唯一约束、外键、索引见 lib/permissions/schema.js。
 * 明确不创建任何“单用户直接授权/拒绝”表。
 */
module.exports = {
    id: 100,
    name: 'permissions_schema',
    up: async (db) => {
        const { ensureSchema } = require('../lib/permissions/schema');
        await ensureSchema(db);
    }
};
