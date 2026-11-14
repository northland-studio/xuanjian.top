/**
 * 权限体系运行时初始化（进程内只执行一次）
 *
 * 保证“数据库启动时同步权限注册表”：即使部署时忘记跑迁移，
 * 第一次受保护请求也会幂等建表 + 同步注册表 + 同步系统角色。
 * 初始化失败时降级为“仅 Level 兼容鉴权 + 细粒度权限一律拒绝”（安全优先，不影响旧业务可用性）。
 */
const db = require('../../database');
const logger = require('../logger');
const { ensureSchema, syncRegistry, syncSystemRoles } = require('./schema');

let readyPromise = null;
let readyInfo = null;

async function init() {
    await ensureSchema(db);
    const reg = await syncRegistry(db);
    const roles = await syncSystemRoles(db);
    readyInfo = {
        permissions: reg,
        createdSystemRoles: roles.length,
        initializedAt: new Date().toISOString()
    };
    if (roles.length) {
        logger.info(`权限体系初始化完成：注册权限 ${reg.active}/${reg.total} 个，创建系统角色 ${roles.length} 个`);
    }
    return readyInfo;
}

/** 幂等初始化；失败后下一次调用会重试 */
function ensureReady() {
    if (readyPromise) return readyPromise;
    readyPromise = init().catch((e) => {
        logger.error('权限体系初始化失败（降级为 Level 兼容模式）:', e.message);
        readyPromise = null;
        throw e;
    });
    return readyPromise;
}

function getReadyInfo() {
    return readyInfo;
}

module.exports = { ensureReady, getReadyInfo };
