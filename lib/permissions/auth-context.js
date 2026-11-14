/**
 * 认证上下文构建：JWT 只做身份认证，权限实时从数据库计算（不信任 token 里的 level 快照）。
 *
 * 兼容旧行为：token 内 level 仅作兜底（当权限表不可用时），正常路径始终以数据库为准。
 */
const jwt = require('jsonwebtoken');
const logger = require('../logger');
const db = require('../../database');
const resolver = require('./resolver');
const { ensureReady } = require('./ready');

if (!process.env.JWT_SECRET) {
    // 与旧 middleware/auth.js 保持一致：缺少 JWT_SECRET 直接拒绝启动
    logger.error('错误: 未配置 JWT_SECRET 环境变量，请在 .env 文件中设置');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

function extractToken(req) {
    const header = req.headers && req.headers.authorization;
    if (!header) return null;
    const parts = String(header).split(' ');
    if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) return null;
    return parts[1] || null;
}

/** 仅解析 token，不查库 */
function verifyToken(token) {
    if (!token) return null;
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

/** 降级上下文：权限表不可用时，至少保留 Level 兼容鉴权语义（细粒度权限为空 → 一律拒绝） */
function degradedContext(decoded) {
    const level = Number(decoded && decoded.level) || 0;
    return {
        userId: Number(decoded.userId),
        username: decoded.username || '',
        nickname: '',
        level,
        frozen: false,
        isSystemAccount: level < 0,
        contribution: 0,
        roles: [],
        activeRoles: [],
        inactiveRoles: [],
        permissions: [],
        permissionSet: new Set(),
        sources: {},
        deniedPermissions: {},
        economy: { access: false, earn: false, spend: false, transfer: false, manage: false },
        reason: null,
        degraded: true
    };
}

function attach(req, ctx) {
    req.userId = ctx.userId;
    req.userLevel = ctx.level;
    req.user = ctx;
    req.permissions = ctx.permissions;
    req.permissionSet = ctx.permissionSet;
    req.roles = ctx.roles;
    req.economy = ctx.economy;
    req.permCtx = ctx;
    return ctx;
}

/**
 * 构建请求的认证上下文（幂等：同一请求只解析一次）
 * @returns {Promise<{ctx: object|null, error: string|null}>}
 */
async function buildAuthContext(req) {
    if (req.permCtx) return { ctx: req.permCtx, error: null };
    const token = extractToken(req);
    if (!token) return { ctx: null, error: 'no_token' };
    const decoded = verifyToken(token);
    if (!decoded || !decoded.userId) return { ctx: null, error: 'invalid_token' };

    let ready = true;
    try {
        await ensureReady();
    } catch (e) {
        ready = false;
    }

    let ctx = null;
    try {
        ctx = await resolver.resolveUser(decoded.userId);
    } catch (e) {
        logger.error('解析用户权限失败:', e.message);
        ctx = degradedContext(decoded);
    }
    if (!ctx) return { ctx: null, error: 'user_not_found' };
    if (!ready && !ctx.degraded) ctx.degraded = false;
    attach(req, ctx);
    return { ctx, error: null };
}

/** 当前请求是否已认证（不触发二次查库） */
function hasAuthContext(req) {
    return !!req.permCtx;
}

function contextHasPermission(ctx, permission) {
    if (!ctx || !ctx.permissionSet) return false;
    return ctx.permissionSet.has(permission) && resolver.permissionAllowedWithPrereq(ctx.permissionSet, permission);
}

/** 同步判定：基于已解析的 req.permCtx */
function hasPermission(req, permission) {
    return contextHasPermission(req && req.permCtx, permission);
}

function hasAnyPermission(req, permissions) {
    const list = Array.isArray(permissions) ? permissions : [permissions];
    return list.some(p => hasPermission(req, p));
}

async function fetchLatestLevel(userId) {
    try {
        const user = await db.get('SELECT level FROM users WHERE id = ?', [userId]);
        return user ? user.level : -1;
    } catch (e) {
        logger.error('查询用户等级错误:', e.message);
        return -1;
    }
}

module.exports = {
    JWT_SECRET,
    extractToken,
    verifyToken,
    buildAuthContext,
    hasAuthContext,
    contextHasPermission,
    hasPermission,
    hasAnyPermission,
    fetchLatestLevel,
    attach
};
