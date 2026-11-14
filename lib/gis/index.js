/**
 * 玄剑 GIS — 服务端模块聚合入口。
 *
 * 目录：
 *   constants.js  枚举与限额（前后端共用口径）
 *   errors.js     统一错误码与响应
 *   geo.js        几何校验/包围盒/点面关系/简化
 *   auth.js       鉴权薄包装（过渡 shim，最终切换 middleware/auth 的 requirePermission）
 *   audit.js      安全审计
 *   worlds.js     World Registry（服务器/世界/维度/上传校验）
 *   objects.js    District/Road/Marker + 版本 + 发布层 + bbox 空间查询
 *   terrain.js    高程 chunk 协议/存储/采样 + 等高线/坡度/剖面/阴影/统计
 *   history.js    快照/历史视图/差异
 *   places.js     集市地点只读引用 + XBed 地点引用预留
 *   jobs.js       异步任务队列
 *   client.js     客户端 bootstrap/resolve-world/上传/增量同步
 */

const constants = require('./constants');
const errors = require('./errors');
const geo = require('./geo');
const audit = require('./audit');
const worlds = require('./worlds');
const objects = require('./objects');
const terrain = require('./terrain');
const history = require('./history');
const places = require('./places');
const jobs = require('./jobs');
const client = require('./client');

/* ---------------- 注册异步任务处理器 ---------------- */

jobs.register('contour-prewarm', async (params, ctx) => {
    if (!params.worldId) throw new Error('缺少 worldId');
    const result = await terrain.contours({
        worldId: params.worldId, dimension: params.dimension || 'overworld',
        bbox: params.bbox, interval: params.interval || 10, zoom: params.zoom || 20
    });
    await ctx.progress(1);
    return { lines: result.lines.length, levels: result.levels.length, coverage: result.data.coverage, truncated: result.truncated };
});

jobs.register('terrain-stats', async (params, ctx) => {
    if (!params.worldId) throw new Error('缺少 worldId');
    const result = await terrain.stats({ worldId: params.worldId, dimension: params.dimension || 'overworld', bbox: params.bbox });
    await ctx.progress(1);
    return result;
});

jobs.register('snapshot', async (params, ctx) => {
    if (!params.worldId) throw new Error('缺少 worldId');
    const result = await history.createSnapshot({
        worldId: params.worldId, name: params.name || `快照 ${new Date().toISOString().slice(0, 10)}`,
        note: params.note || '', dimension: params.dimension || null, actorId: params.actorId || null
    });
    await ctx.progress(1);
    return result;
});

/** 启动异步任务循环（幂等；GIS_DISABLE_JOBS=1 时禁用，供测试手动驱动） */
function startJobs() {
    return jobs.init().catch(() => { });
}

module.exports = {
    constants, errors, geo, audit, worlds, objects, terrain, history, places, jobs, client,
    startJobs
};
