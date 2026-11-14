/**
 * 角色 / 成员 / 角色权限管理（权限中心后端服务）
 *
 * 核心边界：
 *  - 角色只有 ACTIVE 参与有效权限计算；DISABLED/ARCHIVED 保留成员与审计历史，但不能分配新成员。
 *  - 模块角色只能配置本模块权限；全局角色可配置普通业务模块权限；禁止跨模块。
 *  - protected（核心）权限只有 Level 2 能授予角色；系统角色（type=system）只有 Level 2 能改名/改权限/改状态。
 *  - 权限管理员不得操作 Level 2 用户，不得修改自己的角色/角色权限（防止自我提权）。
 *  - 不存在的“单用户直接授权”：成员只能通过角色获得权限。
 */
const db = require('../../database');
const registry = require('./registry');
const resolver = require('./resolver');
const audit = require('./audit');
const { now } = require('./schema');

const ROLE_STATUSES = ['ACTIVE', 'DISABLED', 'ARCHIVED'];

function httpError(status, code, message) {
    const e = new Error(message || code);
    e.status = status;
    e.code = code;
    return e;
}

function isSuper(actor) {
    return !!actor && Number(actor.level) >= 2;
}

function hasPerm(actor, key) {
    return !!actor && actor.permissionSet instanceof Set && actor.permissionSet.has(key);
}

function makeActor(ctx) {
    if (!ctx) return null;
    return {
        userId: ctx.userId,
        level: ctx.level,
        permissions: ctx.permissions,
        permissionSet: ctx.permissionSet,
        frozen: ctx.frozen,
        roles: ctx.roles || [],
        isSuper: Number(ctx.level) >= 2
    };
}

function actorIsPermissionAdmin(actor) {
    return isSuper(actor) || hasPerm(actor, 'admin.permissions.manage');
}

function isMemberOfRole(actor, roleId) {
    return (actor.roles || []).some(r => Number(r.id) === Number(roleId));
}

function roleActorLabel(actor) {
    return `#${actor.userId}`;
}

function genRoleKey() {
    return 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizeKeys(keys) {
    if (!Array.isArray(keys)) return [];
    return [...new Set(keys.map(k => String(k || '').trim()).filter(Boolean))];
}

/**
 * 校验角色权限集合（scope + protected + 防止自我提权）
 * @param {object} actor makeActor 结果
 * @param {object} role { id?, scope, module }
 * @param {string[]} keys
 * @returns {{keys: string[], added: string[], removed: string[]}}
 */
function validatePermissionKeys(actor, role, keys) {
    const unique = normalizeKeys(keys);
    const invalid = unique.filter(k => !registry.isRegistered(k) || !registry.isActive(k));
    if (invalid.length) {
        throw httpError(400, 'VALIDATION_ERROR', `权限不存在或已停用：${invalid.join('、')}`);
    }
    const isSystemRole = !!role.is_system || role.type === 'system';
    if (isSystemRole && !isSuper(actor)) {
        throw httpError(403, 'SUPER_ADMIN_PROTECTED', '系统角色的权限只能由超级管理员修改');
    }
    if (role.id && isMemberOfRole(actor, role.id) && !isSuper(actor)) {
        throw httpError(403, 'SELF_ESCALATION', '不能修改自己所属角色的权限（防止自我提权）');
    }
    for (const key of unique) {
        const def = registry.getDefinition(key);
        // 模块角色只能配置所属模块权限
        if (role.scope === 'module' && def.module !== role.module) {
            throw httpError(400, 'SCOPE_VIOLATION', `模块角色「${role.module}」不能授予其他模块权限：${key}`);
        }
        if (def.module === 'admin' && role.scope !== 'global') {
            throw httpError(400, 'SCOPE_VIOLATION', `管理后台权限只能配置在全局角色：${key}`);
        }
        // 核心权限只有 Level 2 可授予
        if (def.protected && !isSuper(actor)) {
            throw httpError(403, 'PROTECTED_PERMISSION', `核心权限只能由超级管理员授予：${key}`);
        }
        // 权限管理员不能把「自己都没有的管理后台权限」授出去（防止横向提权）
        if (!isSuper(actor) && def.module === 'admin' && !hasPerm(actor, key)) {
            throw httpError(403, 'SELF_ESCALATION', `不能授予自己不具备的管理后台权限：${key}`);
        }
    }
    return unique;
}

function assertRoleExists(role) {
    if (!role) throw httpError(404, 'ROLE_NOT_FOUND', '角色不存在');
    return role;
}

async function getRoleRow(id) {
    if (!id) return null;
    return db.get('SELECT * FROM permission_roles WHERE id = ?', [Number(id)]);
}

async function getRoleById(id) {
    const role = await getRoleRow(id);
    if (!role) return null;
    const perms = await db.all(
        `SELECT rp.permission_key, d.module, d.resource, d.action, d.description, d.is_protected, d.status
           FROM permission_role_permissions rp
      LEFT JOIN permission_definitions d ON d.key = rp.permission_key
          WHERE rp.role_id = ?
       ORDER BY d.module, rp.permission_key`,
        [role.id]
    );
    return {
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description || '',
        scope: role.scope,
        module: role.module,
        type: role.type,
        templateKey: role.template_key,
        status: role.status,
        isSystem: !!role.is_system,
        createdBy: role.created_by,
        createdAt: role.created_at,
        updatedAt: role.updated_at,
        archivedAt: role.archived_at,
        permissions: perms.map(p => ({
            key: p.permission_key,
            module: p.module || registry.getDefinition(p.permission_key)?.module || '',
            description: p.description || registry.getDefinition(p.permission_key)?.description || '',
            protected: !!p.is_protected
        })),
        permissionKeys: perms.map(p => p.permission_key)
    };
}

async function listRoles({ search = '', status = '', scope = '', module = '', page = 1, limit = 50 } = {}) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const where = [];
    const params = [];
    if (search) {
        where.push('(r.name LIKE ? OR r.key LIKE ? OR r.description LIKE ?)');
        const kw = `%${String(search).trim()}%`;
        params.push(kw, kw, kw);
    }
    if (status && ROLE_STATUSES.includes(status)) { where.push('r.status = ?'); params.push(status); }
    if (scope && ['global', 'module'].includes(scope)) { where.push('r.scope = ?'); params.push(scope); }
    if (module) { where.push('r.module = ?'); params.push(String(module)); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await db.get(`SELECT COUNT(*) AS c FROM permission_roles r ${whereSql}`, params);
    const rows = await db.all(
        `SELECT r.*,
                (SELECT COUNT(*) FROM permission_role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
                (SELECT COUNT(*) FROM permission_role_members m WHERE m.role_id = r.id) AS member_count
           FROM permission_roles r
           ${whereSql}
       ORDER BY r.is_system DESC, r.id ASC
          LIMIT ? OFFSET ?`,
        [...params, l, (p - 1) * l]
    );
    return {
        items: rows.map(r => ({
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description || '',
            scope: r.scope,
            module: r.module,
            type: r.type,
            templateKey: r.template_key,
            status: r.status,
            isSystem: !!r.is_system,
            permissionCount: r.permission_count,
            memberCount: r.member_count,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        })),
        total: total.c,
        page: p,
        limit: l
    };
}

async function checkRoleName(name, excludeId = null) {
    const row = await db.get(
        'SELECT id FROM permission_roles WHERE name = ? COLLATE NOCASE AND id != ?',
        [String(name).trim(), excludeId || -1]
    );
    if (row) throw httpError(400, 'ROLE_NAME_TAKEN', '角色名称已存在');
}

/**
 * 创建角色（可基于模板复制；复制后独立）
 * body: { name, description, scope, module, template_key, permissions[] }
 */
async function createRole(actor, body = {}, { ip = null } = {}) {
    if (!actorIsPermissionAdmin(actor)) throw httpError(403, 'PERMISSION_DENIED', '需要权限管理员权限');
    const tpl = body.template_key ? registry.getTemplate(String(body.template_key)) : null;
    if (body.template_key && !tpl) throw httpError(400, 'VALIDATION_ERROR', '角色模板不存在');

    const scope = tpl ? tpl.scope : (body.scope === 'global' ? 'global' : 'module');
    const moduleName = tpl ? (tpl.module || null) : (scope === 'module' ? String(body.module || '') : null);
    if (scope === 'module') {
        if (!moduleName || !registry.MODULES[moduleName] || moduleName === 'admin') {
            throw httpError(400, 'VALIDATION_ERROR', '模块角色必须指定有效业务模块');
        }
        if (!registry.moduleAvailable(moduleName)) {
            throw httpError(400, 'VALIDATION_ERROR', `模块「${moduleName}」尚未接入，不能创建角色`);
        }
    }
    let name = String(body.name || '').trim();
    if (!name && tpl) name = `${tpl.name}（副本）`;
    if (name.length < 2 || name.length > 40) throw httpError(400, 'VALIDATION_ERROR', '角色名称需为 2-40 个字符');
    await checkRoleName(name);

    const permissionKeys = validatePermissionKeys(actor, { scope, module: moduleName },
        Array.isArray(body.permissions) ? body.permissions : (tpl ? tpl.permissions : []));

    const ts = now();
    const inserted = await db.transaction(async () => {
        const r = await db.run(
            `INSERT INTO permission_roles (key, name, description, scope, module, type, template_key, status, is_system, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'custom', ?, 'ACTIVE', 0, ?, ?, ?)`,
            [genRoleKey(), name, String(body.description || '').slice(0, 500), scope, moduleName,
                tpl ? tpl.key : null, actor.userId, ts, ts]
        );
        for (const key of permissionKeys) {
            await db.run(
                `INSERT INTO permission_role_permissions (role_id, permission_key, granted_by, created_at)
                 VALUES (?, ?, ?, ?)`,
                [r.id, key, actor.userId, ts]
            );
        }
        await audit.record({
            actorId: actor.userId, action: 'role_create', targetType: 'role', targetId: r.id,
            after: { name, scope, module: moduleName, permissions: permissionKeys, template: tpl ? tpl.key : null },
            note: `创建角色「${name}」`, ip
        });
        return r;
    });
    return getRoleById(inserted.id);
}

/** 修改角色基础信息（系统角色仅 Level 2 可改） */
async function updateRole(actor, roleId, body = {}, { ip = null } = {}) {
    if (!actorIsPermissionAdmin(actor)) throw httpError(403, 'PERMISSION_DENIED', '需要权限管理员权限');
    const role = assertRoleExists(await getRoleRow(roleId));
    if (role.is_system && !isSuper(actor)) {
        throw httpError(403, 'SUPER_ADMIN_PROTECTED', '系统角色只能由超级管理员修改');
    }
    const before = { name: role.name, description: role.description };
    const patch = {};
    if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (name.length < 2 || name.length > 40) throw httpError(400, 'VALIDATION_ERROR', '角色名称需为 2-40 个字符');
        await checkRoleName(name, role.id);
        patch.name = name;
    }
    if (body.description !== undefined) patch.description = String(body.description || '').slice(0, 500);
    if (!Object.keys(patch).length) return getRoleById(role.id);

    await db.transaction(async () => {
        const sets = Object.keys(patch).map(k => `${k} = ?`).join(', ');
        await db.run(
            `UPDATE permission_roles SET ${sets}, updated_at = ? WHERE id = ?`,
            [...Object.values(patch), now(), role.id]
        );
        await audit.record({
            actorId: actor.userId, action: 'role_update', targetType: 'role', targetId: role.id,
            before, after: { ...before, ...patch }, note: `修改角色「${role.name}」`, ip
        });
    });
    return getRoleById(role.id);
}

/** 覆盖式修改角色权限（高风险操作，需前端二次确认） */
async function setRolePermissions(actor, roleId, permissionKeys, { ip = null } = {}) {
    if (!actorIsPermissionAdmin(actor)) throw httpError(403, 'PERMISSION_DENIED', '需要权限管理员权限');
    const role = assertRoleExists(await getRoleRow(roleId));
    if (role.status === 'ARCHIVED') throw httpError(400, 'ROLE_ARCHIVED', '已归档角色请先恢复再修改权限');
    const keys = validatePermissionKeys(actor, role, permissionKeys);
    const beforeKeys = (await db.all('SELECT permission_key FROM permission_role_permissions WHERE role_id = ?', [role.id]))
        .map(r => r.permission_key);
    const added = keys.filter(k => !beforeKeys.includes(k));
    const removed = beforeKeys.filter(k => !keys.includes(k));
    if (!added.length && !removed.length) return getRoleById(role.id);

    const ts = now();
    await db.transaction(async () => {
        await db.run('DELETE FROM permission_role_permissions WHERE role_id = ?', [role.id]);
        for (const key of keys) {
            await db.run(
                `INSERT INTO permission_role_permissions (role_id, permission_key, granted_by, created_at)
                 VALUES (?, ?, ?, ?)`,
                [role.id, key, actor.userId, ts]
            );
        }
        await db.run('UPDATE permission_roles SET updated_at = ? WHERE id = ?', [ts, role.id]);
        await audit.record({
            actorId: actor.userId, action: 'role_permissions_update', targetType: 'role', targetId: role.id,
            before: { permissions: beforeKeys }, after: { permissions: keys, added, removed },
            note: `修改角色「${role.name}」权限`, ip
        });
    });
    return getRoleById(role.id);
}

/** 角色状态变更（高风险：禁用/归档/恢复，需二次确认） */
async function setRoleStatus(actor, roleId, status, { ip = null } = {}) {
    if (!actorIsPermissionAdmin(actor)) throw httpError(403, 'PERMISSION_DENIED', '需要权限管理员权限');
    if (!ROLE_STATUSES.includes(status)) throw httpError(400, 'VALIDATION_ERROR', '无效的角色状态');
    const role = assertRoleExists(await getRoleRow(roleId));
    if (role.status === status) return getRoleById(role.id);
    if (role.is_system && !isSuper(actor)) {
        throw httpError(403, 'SUPER_ADMIN_PROTECTED', '系统角色只能由超级管理员启用/禁用/归档');
    }
    if (!isSuper(actor) && isMemberOfRole(actor, role.id)) {
        throw httpError(403, 'SELF_ESCALATION', '不能修改自己所属角色的状态');
    }
    const ts = now();
    await db.transaction(async () => {
        await db.run(
            `UPDATE permission_roles SET status = ?, updated_at = ?, archived_at = ? WHERE id = ?`,
            [status, ts, status === 'ARCHIVED' ? ts : null, role.id]
        );
        await audit.record({
            actorId: actor.userId, action: 'role_status', targetType: 'role', targetId: role.id,
            before: { status: role.status }, after: { status },
            note: `角色「${role.name}」状态 ${role.status} → ${status}`, ip
        });
    });
    return getRoleById(role.id);
}

/** 校验“能不能操作这个目标用户”（权限管理员不得碰 Level 2 / 系统账号 / 自己） */
async function assertCanOperateTargetUser(actor, targetUserId, { allowSelf = false } = {}) {
    const uid = Number(targetUserId);
    if (!uid) throw httpError(400, 'VALIDATION_ERROR', '用户 ID 无效');
    const target = await db.get('SELECT id, username, nickname, level, is_frozen FROM users WHERE id = ?', [uid]);
    if (!target) throw httpError(404, 'USER_NOT_FOUND', '用户不存在');
    if (Number(target.level) < 0) throw httpError(400, 'SYSTEM_ACCOUNT', '系统账号不参与角色体系');
    if (!isSuper(actor)) {
        if (Number(target.level) >= 2) throw httpError(403, 'SUPER_ADMIN_PROTECTED', '不能修改超级管理员的角色');
        if (!allowSelf && Number(target.id) === Number(actor.userId)) {
            throw httpError(403, 'SELF_ESCALATION', '不能修改自己的角色（防止自我提权）');
        }
    }
    return target;
}

/** 校验角色是否可被 actor 分配（系统角色可分配成员；含核心权限的角色仅 Level 2 可分配） */
async function assertCanAssignRole(actor, role) {
    assertRoleExists(role);
    if (role.status !== 'ACTIVE') {
        throw httpError(400, 'ROLE_NOT_ACTIVE', `角色「${role.name}」当前非启用状态，不能分配新成员`);
    }
    if (!isSuper(actor)) {
        const rolePerms = await db.all('SELECT permission_key FROM permission_role_permissions WHERE role_id = ?', [role.id]);
        for (const rp of rolePerms) {
            if (registry.isProtected(rp.permission_key)) {
                throw httpError(403, 'PROTECTED_PERMISSION', `角色「${role.name}」包含核心权限，只能由超级管理员分配`);
            }
            const def = registry.getDefinition(rp.permission_key);
            if (def && def.module === 'admin' && !hasPerm(actor, rp.permission_key)) {
                throw httpError(403, 'SELF_ESCALATION', `不能分配含自己不具备的管理后台权限的角色「${role.name}」`);
            }
        }
    }
    return role;
}

/**
 * 给角色批量添加成员（逐条结果，单个失败不影响其他）
 * @returns {{results: Array, successCount: number, failCount: number}}
 */
async function addRoleMembers(actor, roleId, userIds, { ip = null } = {}) {
    if (!actorIsPermissionAdmin(actor)) throw httpError(403, 'PERMISSION_DENIED', '需要权限管理员权限');
    const role = assertRoleExists(await getRoleRow(roleId));
    const ids = normalizeKeys(Array.isArray(userIds) ? userIds : [userIds]).map(Number).filter(n => n > 0);
    if (!ids.length) throw httpError(400, 'VALIDATION_ERROR', '请选择要添加的用户');
    const results = [];
    let success = 0;
    let fail = 0;
    const ts = now();
    await db.transaction(async () => {
        for (const uid of ids) {
            try {
                await assertCanAssignRole(actor, role);
                await assertCanOperateTargetUser(actor, uid);
                const exists = await db.get(
                    'SELECT 1 AS x FROM permission_role_members WHERE role_id = ? AND user_id = ?', [role.id, uid]
                );
                if (exists) {
                    results.push({ userId: uid, ok: true, already: true });
                    success++;
                    continue;
                }
                await db.run(
                    `INSERT INTO permission_role_members (role_id, user_id, granted_by, created_at) VALUES (?, ?, ?, ?)`,
                    [role.id, uid, actor.userId, ts]
                );
                results.push({ userId: uid, ok: true });
                success++;
            } catch (e) {
                results.push({ userId: uid, ok: false, error: e.message, code: e.code || 'ERROR' });
                fail++;
            }
        }
        await audit.record({
            actorId: actor.userId, action: ids.length > 1 ? 'role_member_batch' : 'role_member_add',
            targetType: 'role', targetId: role.id,
            after: { added: results.filter(r => r.ok && !r.already).map(r => r.userId), results },
            note: `向角色「${role.name}」添加成员（成功 ${success} / 失败 ${fail}）`, ip
        });
    });
    return { results, successCount: success, failCount: fail };
}

/** 从角色移除成员（逐条结果；单个失败不影响其他） */
async function removeRoleMembers(actor, roleId, userIds, { ip = null } = {}) {
    if (!actorIsPermissionAdmin(actor)) throw httpError(403, 'PERMISSION_DENIED', '需要权限管理员权限');
    const role = assertRoleExists(await getRoleRow(roleId));
    const ids = normalizeKeys(Array.isArray(userIds) ? userIds : [userIds]).map(Number).filter(n => n > 0);
    if (!ids.length) throw httpError(400, 'VALIDATION_ERROR', '请选择要移除的用户');
    const results = [];
    let success = 0;
    let fail = 0;
    await db.transaction(async () => {
        for (const uid of ids) {
            try {
                await assertCanOperateTargetUser(actor, uid);
                const r = await db.run(
                    'DELETE FROM permission_role_members WHERE role_id = ? AND user_id = ?', [role.id, uid]
                );
                results.push({ userId: uid, ok: true, removed: r.changes > 0 });
                success++;
            } catch (e) {
                results.push({ userId: uid, ok: false, error: e.message, code: e.code || 'ERROR' });
                fail++;
            }
        }
        await audit.record({
            actorId: actor.userId, action: ids.length > 1 ? 'role_member_batch' : 'role_member_remove',
            targetType: 'role', targetId: role.id,
            before: { removed: results.filter(r => r.ok && r.removed).map(r => r.userId) },
            after: { results },
            note: `从角色「${role.name}」移除成员（成功 ${success} / 失败 ${fail}）`, ip
        });
    });
    return { results, successCount: success, failCount: fail };
}

/** 角色成员列表 */
async function listRoleMembers(roleId, { page = 1, limit = 20, search = '' } = {}) {
    const role = assertRoleExists(await getRoleRow(roleId));
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const where = ['m.role_id = ?'];
    const params = [role.id];
    if (search) {
        where.push('(u.username LIKE ? OR u.nickname LIKE ? OR CAST(u.id AS TEXT) = ?)');
        params.push(`%${search}%`, `%${search}%`, String(search));
    }
    const whereSql = where.join(' AND ');
    const total = await db.get(
        `SELECT COUNT(*) AS c FROM permission_role_members m JOIN users u ON u.id = m.user_id WHERE ${whereSql}`, params
    );
    const rows = await db.all(
        `SELECT u.id, u.username, u.nickname, u.avatar, u.level, u.is_frozen, m.created_at, m.granted_by
           FROM permission_role_members m JOIN users u ON u.id = m.user_id
          WHERE ${whereSql} ORDER BY m.created_at DESC, u.id ASC LIMIT ? OFFSET ?`,
        [...params, l, (p - 1) * l]
    );
    return {
        role: { id: role.id, name: role.name, scope: role.scope, module: role.module, status: role.status },
        items: rows.map(r => ({
            id: r.id, username: r.username, nickname: r.nickname, avatar: r.avatar,
            level: r.level, frozen: Number(r.is_frozen) === 1,
            joinedAt: r.created_at, grantedBy: r.granted_by
        })),
        total: total.c, page: p, limit: l
    };
}

/** 用户当前角色（含状态） */
async function listUserRoles(userId) {
    const rows = await db.all(
        `SELECT r.id, r.key, r.name, r.scope, r.module, r.status, r.type, r.template_key, m.created_at
           FROM permission_role_members m JOIN permission_roles r ON r.id = m.role_id
          WHERE m.user_id = ? ORDER BY r.id`,
        [Number(userId)]
    );
    return rows.map(r => ({
        id: r.id, key: r.key, name: r.name, scope: r.scope, module: r.module,
        status: r.status, type: r.type, templateKey: r.template_key, joinedAt: r.created_at,
        active: r.status === 'ACTIVE'
    }));
}

/**
 * 覆盖式设置某用户的角色（双向成员管理的“用户详情页”入口，复用同一服务）
 * 只做增/删差集，逐条结果；不允许单用户直接授权。
 */
async function setUserRoles(actor, targetUserId, roleIds, { ip = null } = {}) {
    if (!actorIsPermissionAdmin(actor)) throw httpError(403, 'PERMISSION_DENIED', '需要权限管理员权限');
    const target = await assertCanOperateTargetUser(actor, targetUserId);
    const desired = [...new Set((Array.isArray(roleIds) ? roleIds : []).map(Number).filter(n => n > 0))];
    const currentRows = await db.all('SELECT role_id FROM permission_role_members WHERE user_id = ?', [target.id]);
    const current = currentRows.map(r => r.role_id);
    const toAdd = desired.filter(id => !current.includes(id));
    const toRemove = current.filter(id => !desired.includes(id));
    const results = [];
    let success = 0;
    let fail = 0;
    const ts = now();
    await db.transaction(async () => {
        for (const rid of toAdd) {
            try {
                const role = await getRoleRow(rid);
                await assertCanAssignRole(actor, role);
                await db.run(
                    `INSERT INTO permission_role_members (role_id, user_id, granted_by, created_at) VALUES (?, ?, ?, ?)`,
                    [rid, target.id, actor.userId, ts]
                );
                results.push({ roleId: rid, action: 'add', ok: true });
                success++;
            } catch (e) {
                results.push({ roleId: rid, action: 'add', ok: false, error: e.message, code: e.code || 'ERROR' });
                fail++;
            }
        }
        for (const rid of toRemove) {
            try {
                const role = await getRoleRow(rid);
                if (role && role.is_system && !isSuper(actor)) {
                    // 允许移除系统角色成员（权限管理员的管理范围），仅记录
                }
                await db.run('DELETE FROM permission_role_members WHERE role_id = ? AND user_id = ?', [rid, target.id]);
                results.push({ roleId: rid, action: 'remove', ok: true });
                success++;
            } catch (e) {
                results.push({ roleId: rid, action: 'remove', ok: false, error: e.message, code: e.code || 'ERROR' });
                fail++;
            }
        }
        await audit.record({
            actorId: actor.userId, action: 'user_roles_update', targetType: 'user', targetId: target.id,
            before: { roles: current }, after: { roles: desired, results },
            note: `修改用户「${target.nickname || target.username}」的角色（成功 ${success} / 失败 ${fail}）`, ip
        });
    });
    return { results, successCount: success, failCount: fail, roles: await listUserRoles(target.id) };
}

/**
 * 用户权限溯源：解释“为什么有/没有某项权限”
 */
async function getUserPermissionTrace(userId) {
    const ctx = await resolver.resolveUser(userId);
    if (!ctx) throw httpError(404, 'USER_NOT_FOUND', '用户不存在');
    const baseKeys = registry.basePermissionsOfLevel(ctx.level);
    const isAll = baseKeys[0] === '*';
    const baseLabel = ctx.level >= 2 ? 'Level 2 全部权限' : (ctx.level === 1 ? 'Level 1 管理员基础权限' : 'Level 0 无基础管理权限');

    const effSet = ctx.permissionSet;
    // 候选权限：Level 基础 + 所有角色（含失效角色）里配置的权限
    const candidates = new Set();
    if (isAll) { for (const k of registry.listActiveKeys()) candidates.add(k); }
    else for (const k of baseKeys) candidates.add(k);
    for (const role of ctx.roles) for (const k of role.permissions) candidates.add(k);

    const reasons = [];
    const pushReason = (perm, reason, detail) => reasons.push({ permission: perm, reason, detail });

    const effectivePermissions = [];
    for (const key of [...candidates].sort()) {
        if (!registry.isRegistered(key)) {
            pushReason(key, 'unknown_permission', '权限未在代码注册表中注册');
            continue;
        }
        const def = registry.getDefinition(key);
        const src = ctx.sources[key];
        if (effSet.has(key) && src) {
            effectivePermissions.push({
                key,
                module: def.module,
                description: def.description,
                protected: !!def.protected,
                sources: src.map(s => s.type === 'level'
                    ? { type: 'level', label: `Level ${s.level}` }
                    : { type: 'role', roleId: s.roleId, roleName: s.roleName, roleKey: s.roleKey, label: `角色「${s.roleName}」` })
            });
            continue;
        }
        // 未生效：解释原因
        if (ctx.frozen) pushReason(key, 'account_frozen', '账号已被冻结/封禁，所有权限立即失效（角色关系保留）');
        else if (ctx.isSystemAccount) pushReason(key, 'system_account', '系统账号不参与用户权限体系');
        else if (def.status !== 'ACTIVE') pushReason(key, 'permission_disabled', '权限定义已停用，不参与计算');
        else if (baseKeys.includes('*')) pushReason(key, 'unknown_permission', '超级管理员应拥有全部权限（异常，请检查权限注册表同步）');
        else {
            const inactive = ctx.inactiveRoles.filter(r => r.permissions.includes(key));
            if (inactive.length) {
                for (const r of inactive) {
                    pushReason(key, r.status === 'DISABLED' ? 'role_disabled' : 'role_archived',
                        `角色「${r.name}」${r.status === 'DISABLED' ? '已禁用' : '已归档'}，不参与权限计算`);
                }
            } else if (!ctx.roles.some(r => r.permissions.includes(key)) && !baseKeys.includes(key)) {
                pushReason(key, 'no_grant', '没有任何 Level 基础权限或 ACTIVE 角色授予该权限');
            }
        }
    }
    // 属于角色但未生效的权限也解释一遍（避免“候选里没有”导致缺解释）
    for (const role of ctx.inactiveRoles) {
        for (const key of role.permissions) {
            if (effSet.has(key)) continue;
            if (!reasons.some(r => r.permission === key && r.reason === (role.status === 'DISABLED' ? 'role_disabled' : 'role_archived'))) {
                pushReason(key, role.status === 'DISABLED' ? 'role_disabled' : 'role_archived',
                    `角色「${role.name}」${role.status === 'DISABLED' ? '已禁用' : '已归档'}，不参与权限计算`);
            }
        }
    }

    return {
        user: {
            id: ctx.userId,
            username: ctx.username,
            nickname: ctx.nickname,
            level: ctx.level,
            levelLabel: ctx.level >= 2 ? '超级管理员' : (ctx.level === 1 ? '管理员' : (ctx.level === 0 ? '成员' : '系统账号')),
            frozen: ctx.frozen,
            isSystemAccount: ctx.isSystemAccount,
            reason: ctx.reason
        },
        level: {
            value: ctx.level,
            label: baseLabel,
            basePermissions: isAll ? ['*'] : baseKeys
        },
        roles: ctx.roles.map(r => ({
            id: r.id, key: r.key, name: r.name, scope: r.scope, module: r.module,
            status: r.status, type: r.type,
            active: r.status === 'ACTIVE',
            permissions: r.permissions
        })),
        activeRoles: ctx.activeRoles.map(r => ({ id: r.id, name: r.name, scope: r.scope, module: r.module })),
        inactiveRoles: ctx.inactiveRoles.map(r => ({
            id: r.id, name: r.name, status: r.status,
            reason: r.status === 'DISABLED' ? 'role_disabled' : 'role_archived'
        })),
        effectivePermissions,
        reasons,
        economy: ctx.economy,
        summary: {
            roleCount: ctx.roles.length,
            activeRoleCount: ctx.activeRoles.length,
            effectivePermissionCount: effSet.size,
            isPermissionAdmin: resolver.isPermissionAdmin(ctx)
        }
    };
}

/** 审计日志（透传 audit.list，角色维度过滤用 targetType/targetId） */
async function listAudit(options = {}) {
    return audit.list(options);
}

/** 角色模板列表 + 对应系统角色 id */
async function listTemplates() {
    const rows = await db.all('SELECT id, key, name, scope, module, status FROM permission_roles WHERE template_key IS NOT NULL');
    const byKey = new Map(rows.map(r => [r.template_key, r]));
    return registry.ROLE_TEMPLATES.map(t => ({
        key: t.key,
        name: t.name,
        description: t.description,
        scope: t.scope,
        module: t.module,
        permissions: t.permissions,
        systemRole: byKey.get(t.key) ? {
            id: byKey.get(t.key).id,
            status: byKey.get(t.key).status
        } : null
    }));
}

module.exports = {
    ROLE_STATUSES,
    makeActor,
    isSuper,
    hasPerm,
    actorIsPermissionAdmin,
    listRoles,
    getRoleById,
    getRoleRow,
    createRole,
    updateRole,
    setRolePermissions,
    setRoleStatus,
    addRoleMembers,
    removeRoleMembers,
    listRoleMembers,
    listUserRoles,
    setUserRoles,
    getUserPermissionTrace,
    listAudit,
    listTemplates,
    validatePermissionKeys
};
