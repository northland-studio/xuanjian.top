/**
 * 权限中间件：统一 401 / 403 语义与稳定错误码
 *
 *  - 未登录：401 { code: 'UNAUTHORIZED' }
 *  - 已登录但无权限：403 { code: 'PERMISSION_DENIED', required }
 *  - 账号冻结/封禁：403 { code: 'ACCOUNT_FROZEN' }
 *  - 无经济资格：403 { code: 'ECONOMY_ACCESS_REQUIRED' | 'ECONOMY_PERMISSION_REQUIRED' }
 *
 * 所有判定都基于 buildAuthContext 的**实时数据库计算**（无缓存），因此：
 * 角色成员/角色权限/角色状态/Level/封禁状态变更都会在下一次请求立即生效。
 */
const {
    buildAuthContext, hasPermission, hasAnyPermission, contextHasPermission
} = require('./auth-context');
const economy = require('./economy');
const resolver = require('./resolver');
const registry = require('./registry');

function sendUnauthorized(res, message) {
    return res.status(401).json({ ok: false, error: message || '未登录或认证已失效', code: 'UNAUTHORIZED' });
}

function sendForbidden(res, code, message, extra = {}) {
    return res.status(403).json({ ok: false, error: message || '权限不足', code, ...extra });
}

function sendFrozen(res) {
    return res.status(403).json({ ok: false, error: '账号已被冻结，请联系管理员', code: 'ACCOUNT_FROZEN', frozen: true });
}

/** 认证（实时解析权限并挂到 req.user / req.permissions / req.roles / req.economy） */
async function authenticate(req, res, next) {
    let out;
    try {
        out = await buildAuthContext(req);
    } catch (e) {
        return sendUnauthorized(res, '认证失败，请重新登录');
    }
    if (!out.ctx) {
        if (out.error === 'user_not_found') return sendUnauthorized(res, '用户不存在或已被删除');
        if (out.error === 'invalid_token') return sendUnauthorized(res, '无效的认证令牌');
        return sendUnauthorized(res, '未提供认证令牌');
    }
    if (out.ctx.frozen) return sendFrozen(res);
    next();
}

/** 可选认证：有 token 则解析并挂上下文，无 token 也放行（公开页面按需登录） */
async function optionalAuthenticate(req, res, next) {
    try {
        await buildAuthContext(req);
    } catch (e) { /* 可选认证失败不影响公开访问 */ }
    next();
}

/**
 * 细粒度权限中间件（自洽：不要求前面先挂 authMiddleware）
 * @param {string|string[]} keys 单个权限或权限数组（数组 = OR）
 */
function requirePermission(keys) {
    const list = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean);
    const required = list.length === 1 ? list[0] : list;
    return async function permissionMiddleware(req, res, next) {
        let out;
        try {
            out = await buildAuthContext(req);
        } catch (e) {
            return sendUnauthorized(res, '认证失败，请重新登录');
        }
        if (!out.ctx) {
            if (out.error === 'user_not_found') return sendUnauthorized(res, '用户不存在或已被删除');
            if (out.error === 'invalid_token') return sendUnauthorized(res, '无效的认证令牌');
            return sendUnauthorized(res);
        }
        if (out.ctx.frozen) return sendFrozen(res);
        const ok = list.some(k => contextHasPermission(out.ctx, k));
        if (!ok) {
            return sendForbidden(res, 'PERMISSION_DENIED', '权限不足', { required });
        }
        next();
    };
}

/** 任意一个权限（requirePermission 的别名，语义清晰） */
function requireAnyPermission(keys) {
    return requirePermission(keys);
}

/** Level 兼容鉴权：adminMiddleware 的实时版（Level >= 1，语义与旧版一致） */
async function adminOnly(req, res, next) {
    let out;
    try {
        out = await buildAuthContext(req);
    } catch (e) {
        return sendUnauthorized(res, '认证失败，请重新登录');
    }
    if (!out.ctx) return sendUnauthorized(res);
    if (out.ctx.frozen) return sendFrozen(res);
    if (Number(out.ctx.level) < 1) {
        return sendForbidden(res, 'LEVEL_REQUIRED', '权限不足，需要管理员权限', { requiredLevel: 1 });
    }
    next();
}

/** Level 兼容鉴权：superAdminMiddleware 的实时版（Level >= 2） */
async function superAdminOnly(req, res, next) {
    let out;
    try {
        out = await buildAuthContext(req);
    } catch (e) {
        return sendUnauthorized(res, '认证失败，请重新登录');
    }
    if (!out.ctx) return sendUnauthorized(res);
    if (out.ctx.frozen) return sendFrozen(res);
    if (Number(out.ctx.level) < 2) {
        return sendForbidden(res, 'LEVEL_REQUIRED', '权限不足，需要超级管理员权限', { requiredLevel: 2 });
    }
    next();
}

/** Level >= min 的通用版本（Level 2 始终通过） */
function requireLevel(minLevel) {
    const min = Number(minLevel) || 1;
    return async function levelMiddleware(req, res, next) {
        let out;
        try {
            out = await buildAuthContext(req);
        } catch (e) {
            return sendUnauthorized(res, '认证失败，请重新登录');
        }
        if (!out.ctx) return sendUnauthorized(res);
        if (out.ctx.frozen) return sendFrozen(res);
        if (Number(out.ctx.level) < min) {
            return sendForbidden(res, 'LEVEL_REQUIRED', `权限不足，需要 Level ${min} 及以上权限`, { requiredLevel: min });
        }
        next();
    };
}

/**
 * 兼容适配器：旧 adminMiddleware 接口 = Level >= 1 或 细粒度权限（任一）
 * 用于渐进迁移期间“不得因迁移丢失 Level 1 现有能力”，同时允许模块角色（低 Level）进入已迁移的业务管理面。
 */
function adminOrPermission(keys) {
    const list = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean);
    return async function adminOrPermissionMiddleware(req, res, next) {
        let out;
        try {
            out = await buildAuthContext(req);
        } catch (e) {
            return sendUnauthorized(res, '认证失败，请重新登录');
        }
        if (!out.ctx) return sendUnauthorized(res);
        if (out.ctx.frozen) return sendFrozen(res);
        if (Number(out.ctx.level) >= 1) return next();
        if (list.some(k => contextHasPermission(out.ctx, k))) return next();
        return sendForbidden(res, 'PERMISSION_DENIED', '权限不足', {
            required: list.length === 1 ? list[0] : list
        });
    };
}

/**
 * 经济资格中间件（显式挂在单个路由上时使用；全局兜底是 economyGate）
 * @param {'access'|'earn'|'spend'|'transfer'|'manage'} perm
 */
function requireEconomy(perm) {
    const action = perm || 'access';
    return async function economyMiddleware(req, res, next) {
        let out;
        try {
            out = await buildAuthContext(req);
        } catch (e) {
            return sendUnauthorized(res, '认证失败，请重新登录');
        }
        if (!out.ctx) return sendUnauthorized(res);
        if (out.ctx.frozen) return sendFrozen(res);
        if (!out.ctx.economy[action]) {
            return economyDenied(res, out.ctx, action);
        }
        next();
    };
}

function economyDenied(res, ctx, action) {
    // 没有 access（经济账户准入）时，任何经济操作统一返回 ECONOMY_ACCESS_REQUIRED，
    // 避免把“不是经济成员”误报成“缺少某项操作权限”。
    if (action !== 'manage' && (!ctx.economy || !ctx.economy.access)) {
        return res.status(403).json({
            ok: false,
            error: '当前账号没有贡献点经济资格',
            code: 'ECONOMY_ACCESS_REQUIRED',
            required: `${economy.ECON}.access`
        });
    }
    return res.status(403).json({
        ok: false,
        error: `缺少贡献点经济操作权限（${economy.PERM_LABEL[action] || action}）`,
        code: 'ECONOMY_PERMISSION_REQUIRED',
        required: `${economy.ECON}.${action}`
    });
}

/**
 * 全局经济闸门：挂在所有业务路由之前（app.use('/api', economyGate)）。
 * 只拦截规则表命中的贡献点变更/读取入口，其余请求直接放行；未登录请求交给后续 authMiddleware 返回 401。
 */
async function economyGate(req, res, next) {
    try {
        const pathname = String(req.originalUrl || req.url || '').split('?')[0];
        const rule = economy.matchRule(req.method, pathname);
        if (!rule) return next();
        // 已是解析过的上下文（例如挂载顺序变化）直接用；否则自行解析
        let ctx = req.permCtx;
        if (!ctx) {
            const token = require('./auth-context').extractToken(req);
            if (!token) return next(); // 未登录：交给路由的 authMiddleware 返回 401
            const out = await buildAuthContext(req).catch(() => ({ ctx: null }));
            ctx = out && out.ctx;
            if (!ctx) return next(); // token 无效：交给路由返回 401
        }
        if (ctx.frozen) return sendFrozen(res);
        if (!ctx.economy || !ctx.economy[rule.perm]) {
            return economyDenied(res, ctx, rule.perm);
        }
        return next();
    } catch (e) {
        const logger = require('../logger');
        logger.error('经济资格闸门异常:', e.message);
        // 闸门自身异常时放行，由具体路由的业务校验与后台监控兜底（避免整站不可用）
        return next();
    }
}

/** 服务端断言：在非路由/服务层调用（如 lib 内部二次校验） */
async function assertEconomy(userId, perm) {
    const ctx = await resolver.resolveUser(userId);
    if (!ctx) {
        const e = new Error('用户不存在');
        e.status = 401;
        e.code = 'UNAUTHORIZED';
        throw e;
    }
    if (ctx.frozen) {
        const e = new Error('账号已被冻结');
        e.status = 403;
        e.code = 'ACCOUNT_FROZEN';
        throw e;
    }
    if (!ctx.economy[perm || 'access']) {
        const action = perm || 'access';
        const noAccess = action !== 'manage' && !ctx.economy.access;
        const e = new Error(noAccess ? '当前账号没有贡献点经济资格' : '缺少贡献点经济操作权限');
        e.status = 403;
        e.code = noAccess ? 'ECONOMY_ACCESS_REQUIRED' : 'ECONOMY_PERMISSION_REQUIRED';
        throw e;
    }
    return ctx;
}

module.exports = {
    authenticate,
    optionalAuthenticate,
    requirePermission,
    requireAnyPermission,
    adminOnly,
    superAdminOnly,
    requireLevel,
    adminOrPermission,
    requireEconomy,
    economyGate,
    assertEconomy,
    hasPermission,
    hasAnyPermission,
    sendUnauthorized,
    sendForbidden,
    sendFrozen,
    economyDenied,
    registry
};
