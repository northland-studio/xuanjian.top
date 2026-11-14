/**
 * GIS 错误类型与统一响应。
 *
 * 约定（与全站一致）：失败响应 `{ ok:false, error:'<code>', message:'<中文>' }`。
 */

class GisError extends Error {
    constructor(code, message, status = 400, extra = {}) {
        super(message || code);
        this.name = 'GisError';
        this.code = code;
        this.status = status;
        this.extra = extra || {};
    }
}

const errors = {
    unauthorized: (msg) => new GisError('unauthorized', msg || '未登录或认证已失效', 401),
    forbidden: (msg, extra) => new GisError('forbidden', msg || '无权限执行该操作', 403, extra),
    notFound: (msg) => new GisError('not_found', msg || '对象不存在', 404),
    invalid: (msg, field) => new GisError('invalid_argument', msg || '参数不合法', 400, field ? { field } : {}),
    invalidPayload: (msg, extra) => new GisError('invalid_payload', msg || '数据格式错误', 400, extra),
    tooLarge: (msg) => new GisError('payload_too_large', msg || '数据超过大小上限', 413),
    bboxRequired: () => new GisError('bbox_required', '缺少 bbox 参数（禁止一次性拉取整个世界）', 400),
    bboxTooLarge: (msg) => new GisError('bbox_too_large', msg || '请求范围过大，请放大地图后重试', 400),
    serverNotRegistered: (msg) => new GisError('server_not_registered', msg || '该服务器未在玄剑 GIS 注册，不能上传数据', 403),
    worldNotRegistered: (msg) => new GisError('world_not_registered', msg || 'World ID/Key 与服务器绑定不符', 403),
    worldArchived: (msg) => new GisError('world_archived', msg || '该世界已归档/快照，禁止写入', 409),
    dimensionMismatch: (msg) => new GisError('dimension_mismatch', msg || 'Dimension 与该世界注册的维度不符', 409),
    versionConflict: (msg, extra) => new GisError('version_conflict', msg || '版本已过期，请刷新后重试', 409, extra),
    duplicate: (msg) => new GisError('duplicate', msg || '重复请求', 200),
    rateLimited: (msg, retryAfter) => new GisError('rate_limited', msg || '请求过于频繁，请稍后重试', 429, { retryAfter: retryAfter || 60 }),
    dataUnavailable: (msg, extra) => new GisError('data_unavailable', msg || '该区域没有采集到高程数据', 200, extra),
    conflict: (msg) => new GisError('conflict', msg || '状态冲突', 409),
    server: (msg) => new GisError('server_error', msg || '服务端异常', 500)
};

/** 统一发送错误；非 GisError 一律 500 并记录 */
function sendError(res, err, context = 'gis') {
    if (err instanceof GisError) {
        const body = { ok: false, error: err.code, message: err.message, ...err.extra };
        if (err.code === 'rate_limited') res.set('Retry-After', String(err.extra.retryAfter || 60));
        return res.status(err.status).json(body);
    }
    try {
        const logger = require('../logger');
        logger.error(`[${context}] ${err && err.stack ? err.stack : err}`);
    } catch (e) { /* ignore */ }
    return res.status(500).json({ ok: false, error: 'server_error', message: '服务端异常' });
}

/** Express 异步处理器包装：catch 后走 sendError */
function wrap(fn, context = 'gis') {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((e) => sendError(res, e, context));
    };
}

module.exports = { GisError, errors, sendError, wrap };
