/**
 * 102 — 创建系统角色模板（幂等）
 *
 * 9 个系统模板：Wiki 编辑员 / Wiki 管理员 / GIS 编辑员 / GIS 管理员 /
 *               集市审核员 / 集市管理员 / 经济成员（玄剑经济成员）/ 经济管理员 / 权限管理员
 * 系统角色受保护：普通权限管理员不能改名/改权限/改状态，只能管理成员；
 * 模板可复制为自定义角色（复制后独立）。
 */
module.exports = {
    id: 102,
    name: 'permissions_system_roles',
    up: async (db) => {
        const { ensureSchema, syncRegistry, syncSystemRoles } = require('../lib/permissions/schema');
        await ensureSchema(db);
        await syncRegistry(db);
        const created = await syncSystemRoles(db);
        console.log(`  新建系统角色 ${created.length} 个${created.length ? '：' + created.map(c => c.name).join('、') : ''}`);
    }
};
