/**
 * GIS 安全审计：写接口 / 上传 / 权限拒绝。
 * 只记录必要字段，不记录正文与隐私。
 */

const db = require('../../database');

async function log(event, { actorId = null, worldId = null, objectType = null, objectId = null, ip = null, detail = null } = {}) {
    try {
        await db.run(
            `INSERT INTO gis_audit (event, actor_id, world_id, object_type, object_id, ip, detail, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
            [String(event).slice(0, 60), actorId, worldId, objectType, objectId, ip ? String(ip).slice(0, 60) : null,
                detail ? JSON.stringify(detail).slice(0, 2000) : null]
        );
    } catch (e) {
        // 审计失败不影响主流程
    }
}

function clientIp(req) {
    return (req && (req.headers['x-forwarded-for'] || req.ip || '')) ? String(req.headers['x-forwarded-for'] || req.ip).split(',')[0].trim() : null;
}

module.exports = { log, clientIp };
