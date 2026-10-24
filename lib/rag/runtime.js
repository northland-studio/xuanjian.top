/**
 * RAG 运行时：进程启动时加载 sqlite-vec、启动索引 worker、注册定期维护
 *
 * 通过 RAG_DISABLE_WORKER=1 关闭后台任务（测试/脚本环境使用）。
 */
const config = require('./config');
const indexer = require('./indexer');
const vec = require('./vec');
const askCore = require('./ask');

let started = false;
const timers = [];

async function start() {
    if (started) return { started: false, reason: 'already' };
    started = true;

    // 1. 加载向量扩展（失败不阻塞网站启动，Admin 会显示不可用）
    const v = await vec.load();
    if (v.loaded) console.log('[rag] sqlite-vec 已加载：' + v.version);
    else console.warn('[rag] sqlite-vec 加载失败（向量检索不可用）：' + v.error);
    await config.setMeta('vec.enabled', v.loaded ? '1' : '0');
    if (v.error) await config.setMeta('vec.error', v.error);

    // 2. 表/列缺失时给出明确提示（不在此处自动建表，迁移由 scripts/migrate-rag.js 负责）
    try {
        await indexer.stats();
    } catch (e) {
        console.warn('[rag] 索引表未就绪，请先执行 node scripts/migrate-rag.js：' + e.message);
        return { started: true, worker: false };
    }

    if (process.env.RAG_DISABLE_WORKER === '1') {
        console.log('[rag] 后台 worker 已按环境变量关闭');
        return { started: true, worker: false };
    }

    // 3. 索引任务 worker
    indexer.startWorker({ intervalMs: Number(process.env.RAG_WORKER_INTERVAL_MS || 5000) });

    // 4. 定期维护：过期会话 / 30 天日志 / 一致性核对（每小时）
    const hourly = setInterval(async () => {
        try {
            const r = await askCore.cleanupLogs();
            if (r.logsDeleted || r.conversationsDeleted) {
                console.log(`[rag] 维护完成：日志清理 ${r.logsDeleted}，过期会话 ${r.conversationsDeleted}`);
            }
        } catch (e) {
            console.error('[rag] 定期维护失败：' + e.message);
        }
    }, 60 * 60 * 1000);
    if (hourly.unref) hourly.unref();
    timers.push(hourly);

    // 启动 2 分钟后跑一次一致性核对，之后每 6 小时一次
    const reconcileTimer = setInterval(async () => {
        try {
            const r = await indexer.reconcile();
            if (r.missing || r.stale || r.orphansCleaned) console.log('[rag] 一致性核对：' + JSON.stringify(r));
        } catch (e) {
            console.error('[rag] 一致性核对失败：' + e.message);
        }
    }, 6 * 60 * 60 * 1000);
    if (reconcileTimer.unref) reconcileTimer.unref();
    timers.push(reconcileTimer);

    setTimeout(() => {
        indexer.reconcile().catch((e) => console.error('[rag] 首次核对失败：' + e.message));
    }, 120 * 1000).unref?.();

    console.log('[rag] 运行时已启动');
    return { started: true, worker: true };
}

function stop() {
    for (const t of timers) clearInterval(t);
    timers.length = 0;
    indexer.stopWorker();
    started = false;
}

module.exports = { start, stop };
