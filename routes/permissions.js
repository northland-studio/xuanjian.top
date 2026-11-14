/**
 * 权限中心 API（并入现有 /admin，不新建独立后台）
 *
 * 权限边界：
 *  - 管理接口（角色/权限/成员/审计）= admin.permissions.manage（权限管理员，由 Level 2 指定；Level 2 天然拥有）
 *  - 用户权限溯源 = admin.users.view（Level 1 基础权限）或 admin.permissions.manage
 *  - 未登录 401；已登录无权限 403（稳定 code）
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const perms = require('../lib/permissions');
const { authMiddleware, requirePermission, requireLevel, adminOrPermission } = require('../middleware/auth');
const router = express.Router();

const roles = perms.roles;

function handle(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((e) => {
            const status = e.status || 500;
            if (status >= 500) logger.error('[permissions]', e.message, e.stack ? e.stack.split('\n')[0] : '');
            res.status(status).json({ ok: false, error: e.message || '操作失败', code: e.code || 'ERROR' });
        });
    };
}

function actorOf(req) {
    return roles.makeActor(req.permCtx);
}

function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    return (fwd ? String(fwd).split(',')[0] : (req.ip || '')).trim().slice(0, 100);
}

const requireManager = requirePermission('admin.permissions.manage');
/** 权限中心只读访问：权限管理员，或 Level 1 管理员基础权限（admin.permissions.view） */
const requireViewer = requirePermission(['admin.permissions.manage', 'admin.permissions.view']);

/* ============ 我的有效权限（前端刷新权限状态用） ============ */
router.get('/me', authMiddleware, handle(async (req, res) => {
    const ctx = req.permCtx;
    res.json({
        ok: true,
        userId: ctx.userId,
        level: ctx.level,
        frozen: ctx.frozen,
        permissions: ctx.permissions,
        roles: ctx.roles.map(r => ({
            id: r.id, key: r.key, name: r.name, scope: r.scope, module: r.module,
            status: r.status, active: r.status === 'ACTIVE'
        })),
        economy: ctx.economy,
        isPermissionAdmin: perms.isPermissionAdmin(ctx),
        generatedAt: new Date().toISOString()
    });
}));

/* ============ 权限注册表 / 模板 ============ */
router.get('/registry', requireViewer, handle(async (req, res) => {
    const rows = await db.all(
        `SELECT key, module, resource, action, description, is_protected, status FROM permission_definitions ORDER BY module, key`
    );
    const permissions = rows.map(r => ({
        key: r.key,
        module: r.module,
        resource: r.resource,
        action: r.action,
        description: r.description,
        protected: !!r.is_protected,
        status: r.status
    }));
    res.json({
        ok: true,
        modules: perms.MODULES,
        permissions,
        levelBase: perms.registry.LEVEL_BASE,
        total: permissions.length,
        active: permissions.filter(p => p.status === 'ACTIVE').length
    });
}));

router.get('/templates', requireViewer, handle(async (req, res) => {
    res.json({ ok: true, templates: await roles.listTemplates() });
}));

/** 手动重新同步注册表（开发者操作；仅 Level 2） */
router.post('/registry/sync', requireLevel(2), handle(async (req, res) => {
    const r = await perms.schema.syncRegistry(db);
    res.json({ ok: true, ...r });
}));

/* ============ 角色 ============ */
router.get('/roles', requireViewer, handle(async (req, res) => {
    const out = await roles.listRoles({
        search: req.query.search || '',
        status: req.query.status || '',
        scope: req.query.scope || '',
        module: req.query.module || '',
        page: req.query.page,
        limit: req.query.limit
    });
    res.json({ ok: true, ...out });
}));

router.post('/roles', requireManager, handle(async (req, res) => {
    const role = await roles.createRole(actorOf(req), req.body || {}, { ip: clientIp(req) });
    res.status(201).json({ ok: true, message: '角色已创建', role });
}));

router.get('/roles/:id', requireViewer, handle(async (req, res) => {
    const role = await roles.getRoleById(req.params.id);
    if (!role) return res.status(404).json({ ok: false, error: '角色不存在', code: 'ROLE_NOT_FOUND' });
    res.json({ ok: true, role });
}));

router.put('/roles/:id', requireManager, handle(async (req, res) => {
    const role = await roles.updateRole(actorOf(req), req.params.id, req.body || {}, { ip: clientIp(req) });
    res.json({ ok: true, message: '角色已更新', role });
}));

/** 覆盖式修改角色权限（高风险，前端需二次确认） */
router.put('/roles/:id/permissions', requireManager, handle(async (req, res) => {
    const list = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
    if (!list) return res.status(400).json({ ok: false, error: 'permissions 必须是数组', code: 'VALIDATION_ERROR' });
    const role = await roles.setRolePermissions(actorOf(req), req.params.id, list, { ip: clientIp(req) });
    res.json({ ok: true, message: '角色权限已保存（下一次请求立即生效）', role });
}));

/** 角色状态（ACTIVE / DISABLED / ARCHIVED，高风险：禁用/归档/恢复需二次确认） */
router.post('/roles/:id/status', requireManager, handle(async (req, res) => {
    const status = String(req.body?.status || '').toUpperCase();
    const role = await roles.setRoleStatus(actorOf(req), req.params.id, status, { ip: clientIp(req) });
    res.json({ ok: true, message: '角色状态已更新（下一次请求立即生效）', role });
}));

/* ============ 角色成员（双向成员管理的角色侧） ============ */
router.get('/roles/:id/members', requireViewer, handle(async (req, res) => {
    const out = await roles.listRoleMembers(req.params.id, {
        page: req.query.page, limit: req.query.limit, search: req.query.search || ''
    });
    res.json({ ok: true, ...out });
}));

router.post('/roles/:id/members', requireManager, handle(async (req, res) => {
    const userIds = req.body?.user_ids || req.body?.userIds || req.body?.user_id;
    const out = await roles.addRoleMembers(actorOf(req), req.params.id, userIds, { ip: clientIp(req) });
    res.json({ ok: true, message: `操作完成：成功 ${out.successCount}，失败 ${out.failCount}`, ...out });
}));

router.delete('/roles/:id/members/:userId', requireManager, handle(async (req, res) => {
    const out = await roles.removeRoleMembers(actorOf(req), req.params.id, [req.params.userId], { ip: clientIp(req) });
    res.json({ ok: true, message: `操作完成：成功 ${out.successCount}，失败 ${out.failCount}`, ...out });
}));

/* ============ 用户侧（双向成员管理 + 权限溯源） ============ */
/** 用户搜索（成员选择器用；权限管理员也需要） */
router.get('/users/search', requireViewer, handle(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const params = [];
    let where = 'COALESCE(level, 0) >= 0';
    if (q) {
        where += ' AND (username LIKE ? OR nickname LIKE ? OR CAST(id AS TEXT) = ?)';
        params.push(`%${q}%`, `%${q}%`, q);
    }
    const rows = await db.all(
        `SELECT id, username, nickname, avatar, level, is_frozen FROM users WHERE ${where} ORDER BY id ASC LIMIT ?`,
        [...params, limit]
    );
    res.json({
        ok: true,
        users: rows.map(u => ({
            id: u.id, username: u.username, nickname: u.nickname, avatar: u.avatar,
            level: u.level, frozen: Number(u.is_frozen) === 1
        }))
    });
}));

router.get('/users/:id/permissions', adminOrPermission(['admin.users.view']), handle(async (req, res) => {
    const trace = await roles.getUserPermissionTrace(req.params.id);
    res.json({ ok: true, trace });
}));

router.get('/users/:id/roles', adminOrPermission(['admin.users.view']), handle(async (req, res) => {
    const list = await roles.listUserRoles(req.params.id);
    res.json({ ok: true, roles: list });
}));

/** 覆盖式设置用户角色（双向成员管理的用户侧，逐条结果） */
router.put('/users/:id/roles', requireManager, handle(async (req, res) => {
    const roleIds = req.body?.role_ids || req.body?.roleIds || req.body?.roles || [];
    const out = await roles.setUserRoles(actorOf(req), req.params.id, roleIds, { ip: clientIp(req) });
    res.json({ ok: true, message: `操作完成：成功 ${out.successCount}，失败 ${out.failCount}`, ...out });
}));

/* ============ 审计日志 ============ */
router.get('/audit', requireViewer, handle(async (req, res) => {
    const out = await roles.listAudit({
        page: req.query.page,
        limit: req.query.limit,
        action: req.query.action || null,
        actorId: req.query.actor_id || null,
        targetType: req.query.target_type || null,
        targetId: req.query.target_id || null
    });
    res.json({ ok: true, ...out });
}));

module.exports = router;
