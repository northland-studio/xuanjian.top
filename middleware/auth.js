/**
 * 鉴权中间件（兼容适配层）
 *
 * 本文件保留原有导出名（authMiddleware / adminMiddleware / superAdminMiddleware /
 * optionalAuthMiddleware / fetchLatestLevel / JWT_SECRET），内部全部切换到
 * lib/permissions 的**实时权限计算**（JWT 只做身份，权限以数据库最新结果为准）。
 *
 * 语义保持不变（渐进式迁移，不破坏现有业务）：
 *  - authMiddleware        登录即可（账号冻结/封禁 → 403 ACCOUNT_FROZEN，立即失效）
 *  - adminMiddleware       Level >= 1（旧接口可继续使用；后续逐模块迁移到 requirePermission）
 *  - superAdminMiddleware  Level >= 2
 *  - optionalAuthMiddleware 公开接口可选登录
 *
 * 新增导出（迁移后的接口使用）：
 *  - requirePermission / requireAnyPermission  细粒度权限（自洽鉴权）
 *  - adminOrPermission                          兼容：Level>=1 或 细粒度权限
 *  - requireLevel / requireEconomy              等级 / 经济资格
 */
const perms = require('../lib/permissions');
const authContext = require('../lib/permissions/auth-context');

const authMiddleware = perms.authenticate;
const adminMiddleware = perms.adminOnly;
const superAdminMiddleware = perms.superAdminOnly;
const optionalAuthMiddleware = perms.optionalAuthenticate;

const {
    requirePermission,
    requireAnyPermission,
    requireLevel,
    adminOrPermission,
    requireEconomy,
    economyGate
} = perms;

module.exports = {
    // ===== 旧接口（兼容）=====
    authMiddleware,
    adminMiddleware,
    superAdminMiddleware,
    optionalAuthMiddleware,
    fetchLatestLevel: authContext.fetchLatestLevel,
    JWT_SECRET: authContext.JWT_SECRET,

    // ===== 新接口（细粒度权限）=====
    requirePermission,
    requireAnyPermission,
    requireLevel,
    adminOrPermission,
    requireEconomy,
    economyGate,

    // ===== 上下文工具 =====
    hasPermission: perms.hasPermission,
    hasAnyPermission: perms.hasAnyPermission,
    resolveUser: perms.resolveUser,
    can: perms.can,
    canAny: perms.canAny
};
