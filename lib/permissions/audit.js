/**
 * 权限审计日志
 *
 * 只记录“管理动作”（创建/修改角色、改权限、状态变化、成员分配/移除、批量操作结果、Level 调整、人工调整贡献点），
 * 不记录每一次普通权限检查（否则日志会被刷爆）。
 */
const db = require('../../database');
const { now } = require('./schema');

const ACTION_LABELS = {
    role_create: '创建角色',
    role_update: '修改角色',
    role_permissions_update: '修改角色权限',
    role_status: '角色状态变更',
    role_member_add: '添加角色成员',
    role_member_remove: '移除角色成员',
    role_member_batch: '批量角色成员操作',
    user_roles_update: '修改用户角色',
    user_level_update: '调整用户等级',
    economy_adjust: '人工调整贡献点',
    registry_sync: '同步权限注册表'
};

function safeJson(value) {
    try {
        return value === undefined ? null : JSON.stringify(value);
    } catch (e) {
        return null;
    }
}

/**
 * 写一条审计日志（可在事务中调用，与业务改动同事务提交）
 * @param {object} opts { actorId, action, targetType, targetId, before, after, note, ip, dbConn }
 */
async function record(opts) {
    const {
        actorId = null, action, targetType = null, targetId = null,
        before = null, after = null, note = '', ip = null, dbConn = null
    } = opts || {};
    const conn = dbConn || db;
    try {
        await conn.run(
            `INSERT INTO permission_audit_logs
                (action, actor_id, target_type, target_id, before_json, after_json, note, ip, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [action, actorId, targetType, targetId === null ? null : String(targetId),
                safeJson(before), safeJson(after), note || '', ip ? String(ip).slice(0, 100) : null, now()]
        );
    } catch (e) {
        // 审计失败不应破坏主流程，但必须留下错误日志
        const logger = require('../logger');
        logger.error('写入权限审计日志失败:', e.message);
    }
}

/** 分页查询审计日志（权限中心展示） */
async function list({ page = 1, limit = 20, action = null, actorId = null, targetType = null, targetId = null } = {}) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const where = [];
    const params = [];
    if (action) { where.push('action = ?'); params.push(String(action)); }
    if (actorId) { where.push('actor_id = ?'); params.push(Number(actorId)); }
    if (targetType) { where.push('target_type = ?'); params.push(String(targetType)); }
    if (targetId !== null && targetId !== undefined && targetId !== '') {
        where.push('target_id = ?'); params.push(String(targetId));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await db.get(`SELECT COUNT(*) AS c FROM permission_audit_logs ${whereSql}`, params);
    const rows = await db.all(
        `SELECT a.*, u.nickname AS actor_nickname, u.username AS actor_username
           FROM permission_audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
           ${whereSql}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`,
        [...params, l, (p - 1) * l]
    );
    const items = rows.map(r => {
        let before = null;
        let after = null;
        try { before = r.before_json ? JSON.parse(r.before_json) : null; } catch (e) { /* 忽略损坏的旧记录 */ }
        try { after = r.after_json ? JSON.parse(r.after_json) : null; } catch (e) { /* 忽略 */ }
        return {
            id: r.id,
            action: r.action,
            actionLabel: ACTION_LABELS[r.action] || r.action,
            actorId: r.actor_id,
            actorName: r.actor_nickname || r.actor_username || (r.actor_id ? `#${r.actor_id}` : '系统'),
            targetType: r.target_type,
            targetId: r.target_id,
            before,
            after,
            note: r.note || '',
            ip: r.ip || '',
            createdAt: r.created_at
        };
    });
    return { items, total: total.c, page: p, limit: l, actionLabels: ACTION_LABELS };
}

module.exports = { record, list, ACTION_LABELS };
