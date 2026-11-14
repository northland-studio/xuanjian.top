/**
 * 权限解析器：实时计算用户有效权限（不缓存，保证“下一次请求立即生效”）
 *
 * 有效权限 = Level 基础权限 ∪ 所有 ACTIVE 角色权限（并集，无继承、无用户级 allow/deny）
 * 账号被封禁/冻结时：普通业务权限、管理权限、经济操作权限全部立即失效（角色成员关系保留）。
 * 系统账号（level < 0，如集市托管 market_escrow）：不参与任何用户级权限。
 */
const db = require('../../database');
const registry = require('./registry');
const logger = require('../logger');

const ECONOMY_PREFIX = 'economy.contribution_points.';

function economyFlagsOf(permissionSet) {
    const has = (k) => permissionSet.has(ECONOMY_PREFIX + k);
    const access = has('access');
    return {
        access,
        // 后三项普通操作权限必须以 access 为前提
        earn: access && has('earn'),
        spend: access && has('spend'),
        transfer: access && has('transfer'),
        manage: has('manage')
    };
}

/**
 * 解析用户权限
 * @returns {Promise<null|object>} null 表示用户不存在
 */
async function resolveUser(userId) {
    const uid = Number(userId);
    if (!uid) return null;
    const user = await db.get(
        'SELECT id, username, nickname, level, is_frozen, contribution FROM users WHERE id = ?',
        [uid]
    );
    if (!user) return null;

    const level = Number(user.level ?? 0);
    const frozen = Number(user.is_frozen) === 1;
    const isSystemAccount = level < 0;

    // 角色 + 角色权限（一次查询）
    const rows = await db.all(
        `SELECT r.id AS role_id, r.key AS role_key, r.name AS role_name,
                r.scope AS role_scope, r.module AS role_module, r.status AS role_status,
                r.type AS role_type, r.template_key,
                rp.permission_key
           FROM permission_role_members m
           JOIN permission_roles r ON r.id = m.role_id
      LEFT JOIN permission_role_permissions rp ON rp.role_id = r.id
          WHERE m.user_id = ?
          ORDER BY r.id`,
        [uid]
    );

    const roleMap = new Map();
    for (const row of rows) {
        if (!roleMap.has(row.role_id)) {
            roleMap.set(row.role_id, {
                id: row.role_id,
                key: row.role_key,
                name: row.role_name,
                scope: row.role_scope,
                module: row.role_module,
                status: row.role_status,
                type: row.role_type,
                templateKey: row.template_key,
                permissions: []
            });
        }
        if (row.permission_key) roleMap.get(row.role_id).permissions.push(row.permission_key);
    }

    const permissionSet = new Set();
    const sources = {};   // permission -> [source...]
    const activeRoles = [];
    const inactiveRoles = [];
    const deniedPermissions = {}; // permission -> [原因]

    const addSource = (perm, source) => {
        if (!permissionSet.has(perm)) {
            permissionSet.add(perm);
            sources[perm] = [];
        }
        sources[perm].push(source);
    };

    // 1) Level 基础权限
    if (!frozen && !isSystemAccount) {
        const base = registry.basePermissionsOfLevel(level);
        const allActive = base[0] === '*' ? registry.listActiveKeys() : base;
        for (const perm of allActive) {
            if (!registry.isActive(perm)) continue;
            addSource(perm, { type: 'level', level });
        }
    } else {
        for (const k of registry.listActiveKeys()) deniedPermissions[k] = [frozen ? 'account_frozen' : 'system_account'];
    }

    // 2) 角色权限（仅 ACTIVE 角色参与计算；冻结账号不参与）
    for (const role of roleMap.values()) {
        const roleActive = role.status === 'ACTIVE';
        if (!roleActive) {
            for (const perm of role.permissions) {
                if (!registry.isActive(perm)) continue;
                (deniedPermissions[perm] = deniedPermissions[perm] || []).push(
                    role.status === 'DISABLED' ? 'role_disabled' : 'role_archived'
                );
            }
            inactiveRoles.push({
                ...role,
                reason: role.status === 'DISABLED' ? 'role_disabled' : 'role_archived'
            });
        } else {
            activeRoles.push(role);
        }
    }

    if (!frozen && !isSystemAccount) {
        for (const role of activeRoles) {
            for (const perm of role.permissions) {
                if (!registry.isActive(perm)) {
                    // 权限定义已停用：不参与计算
                    continue;
                }
                addSource(perm, {
                    type: 'role', roleId: role.id, roleKey: role.key,
                    roleName: role.name, scope: role.scope, module: role.module
                });
            }
        }
    }

    const permissions = Array.from(permissionSet).sort();
    const economy = frozen || isSystemAccount
        ? { access: false, earn: false, spend: false, transfer: false, manage: false }
        : economyFlagsOf(permissionSet);

    return {
        userId: uid,
        username: user.username,
        nickname: user.nickname,
        level,
        frozen,
        isSystemAccount,
        contribution: Number(user.contribution ?? 0),
        roles: Array.from(roleMap.values()),
        activeRoles,
        inactiveRoles,
        permissions,
        permissionSet,
        sources,
        deniedPermissions,
        economy,
        reason: frozen ? 'account_frozen' : (isSystemAccount ? 'system_account' : null)
    };
}

/** 判定单个权限（实时查库；frozen/系统账号恒 false） */
async function can(userId, permission) {
    try {
        const ctx = await resolveUser(userId);
        if (!ctx) return false;
        return ctx.permissionSet.has(permission) && permissionAllowedWithPrereq(ctx.permissionSet, permission);
    } catch (e) {
        logger.error('权限判定失败:', e.message);
        return false;
    }
}

/** 判定任意一个权限（OR） */
async function canAny(userId, permissions) {
    if (!Array.isArray(permissions)) permissions = [permissions];
    try {
        const ctx = await resolveUser(userId);
        if (!ctx) return false;
        return permissions.some(p => ctx.permissionSet.has(p) && permissionAllowedWithPrereq(ctx.permissionSet, p));
    } catch (e) {
        logger.error('权限判定失败:', e.message);
        return false;
    }
}

/**
 * 经济权限前置约束：earn/spend/transfer 必须以 access 为前提。
 * 用于 requirePermission / can 的统一判定。
 */
function permissionAllowedWithPrereq(permissionSet, permission) {
    if (typeof permission !== 'string') return false;
    if (!permissionSet.has(permission)) return false;
    if (permission.startsWith(ECONOMY_PREFIX)) {
        const action = permission.slice(ECONOMY_PREFIX.length);
        if (action === 'earn' || action === 'spend' || action === 'transfer') {
            return permissionSet.has(ECONOMY_PREFIX + 'access');
        }
    }
    return true;
}

/** 某用户是否权限管理员（Level 2 或持有 admin.permissions.manage） */
function isPermissionAdmin(ctx) {
    if (!ctx) return false;
    return ctx.level >= 2 || ctx.permissionSet.has('admin.permissions.manage');
}

module.exports = {
    ECONOMY_PREFIX,
    resolveUser,
    can,
    canAny,
    permissionAllowedWithPrereq,
    economyFlagsOf,
    isPermissionAdmin
};
