/**
 * 101 — 同步权限注册表到 permission_definitions（幂等）
 *
 * 权限定义唯一来源是代码（lib/permissions/registry.js）；
 * 本迁移只把定义写入 DB（供权限中心展示/分配），并在代码移除权限时停用而不物理删除。
 */
module.exports = {
    id: 101,
    name: 'permissions_registry_sync',
    up: async (db) => {
        const { ensureSchema, syncRegistry } = require('../lib/permissions/schema');
        await ensureSchema(db);
        const r = await syncRegistry(db);
        console.log(`  权限定义已同步：${r.active}/${r.total} 个 ACTIVE`);
    }
};
