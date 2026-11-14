/**
 * 权限体系统一出口
 *
 * 三层模型：
 *   Level（0/1/2 语义完全保留，Level 2 全权限）
 *   + 角色（全局/模块，多角色并集，无继承）
 *   + 代码注册的细粒度权限（模块.资源.操作）
 *
 * 禁止单用户直接授权/拒绝：数据库只有权限定义、角色、角色权限、成员、审计。
 * 所有判定实时查库（无缓存），变更下一次请求立即生效。
 */
const registry = require('./registry');
const resolver = require('./resolver');
const roles = require('./roles');
const audit = require('./audit');
const middleware = require('./middleware');
const economy = require('./economy');
const schema = require('./schema');
const { ensureReady, getReadyInfo } = require('./ready');

module.exports = {
    // 注册表
    registry,
    MODULES: registry.MODULES,
    PERMISSIONS: registry.PERMISSIONS,
    ROLE_TEMPLATES: registry.ROLE_TEMPLATES,
    // 解析
    resolveUser: resolver.resolveUser,
    can: resolver.can,
    canAny: resolver.canAny,
    isPermissionAdmin: resolver.isPermissionAdmin,
    economyFlagsOf: resolver.economyFlagsOf,
    // 角色服务
    roles,
    audit,
    // 中间件
    authenticate: middleware.authenticate,
    authMiddleware: middleware.authenticate,
    optionalAuthenticate: middleware.optionalAuthenticate,
    requirePermission: middleware.requirePermission,
    requireAnyPermission: middleware.requireAnyPermission,
    adminOnly: middleware.adminOnly,
    superAdminOnly: middleware.superAdminOnly,
    requireLevel: middleware.requireLevel,
    adminOrPermission: middleware.adminOrPermission,
    requireEconomy: middleware.requireEconomy,
    assertEconomy: middleware.assertEconomy,
    economyGate: middleware.economyGate,
    hasPermission: middleware.hasPermission,
    hasAnyPermission: middleware.hasAnyPermission,
    // 经济
    economy,
    // 初始化 / schema
    ensureReady,
    getReadyInfo,
    schema
};
