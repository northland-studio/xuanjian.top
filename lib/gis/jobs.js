/**
 * GIS 异步任务队列（进程内，单并发）。
 *
 * 2G2H 约束：等高线/区域统计等重计算不能阻塞普通 API 请求，
 * 一律走 gis_jobs 异步任务；普通读接口只做「不超过 bbox/采样上限」的按需计算 + 缓存。
 *
 * 说明：单进程 pm2 fork 模式，不需要外部队列；任务状态持久化在 SQLite，
 * 进程重启后残留的 RUNNING 任务会被重置为 PENDING。
 */

const db = require('../../database');
const { errors } = require('./errors');

const localTs = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

const handlers = new Map();
let running = false;
let started = false;
const disabled = () => process.env.GIS_DISABLE_JOBS === '1';

function register(kind, handler) {
    handlers.set(kind, handler);
}

async function enqueue({ kind, worldId = null, dimension = null, params = {}, actorId = null }) {
    if (!handlers.has(kind)) throw errors.invalid(`未知任务类型：${kind}`, 'kind');
    const r = await db.run(
        `INSERT INTO gis_jobs (kind, status, world_id, dimension, params, progress, created_by, created_at)
         VALUES (?, 'PENDING', ?, ?, ?, 0, ?, ?)`,
        [kind, worldId, dimension, JSON.stringify(params || {}), actorId, localTs()]
    );
    if (!disabled()) {
        ensureStarted();
        setImmediate(() => { drain().catch(() => { }); });
    }
    return getJob(r.id);
}

async function getJob(id) {
    const row = await db.get(`SELECT * FROM gis_jobs WHERE id = ?`, [Number(id)]);
    if (!row) throw errors.notFound('任务不存在');
    return decorate(row);
}

function decorate(row) {
    let params = {};
    let result = null;
    try { params = JSON.parse(row.params || '{}'); } catch (e) { /* ignore */ }
    try { result = row.result ? JSON.parse(row.result) : null; } catch (e) { result = null; }
    return {
        id: row.id, kind: row.kind, status: row.status, worldId: row.world_id, dimension: row.dimension,
        params, progress: Number(row.progress) || 0, result, error: row.error || null,
        createdBy: row.created_by, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at
    };
}

async function listJobs({ status = null, limit = 50 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = status
        ? await db.all(`SELECT * FROM gis_jobs WHERE status = ? ORDER BY id DESC LIMIT ?`, [String(status).toUpperCase(), lim])
        : await db.all(`SELECT * FROM gis_jobs ORDER BY id DESC LIMIT ?`, [lim]);
    return rows.map(decorate);
}

async function updateJob(id, patch) {
    const sets = [];
    const params = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.progress !== undefined) { sets.push('progress = ?'); params.push(Number(patch.progress) || 0); }
    if (patch.result !== undefined) { sets.push('result = ?'); params.push(patch.result === null ? null : JSON.stringify(patch.result)); }
    if (patch.error !== undefined) { sets.push('error = ?'); params.push(patch.error); }
    if (patch.startedAt !== undefined) { sets.push('started_at = ?'); params.push(patch.startedAt); }
    if (patch.finishedAt !== undefined) { sets.push('finished_at = ?'); params.push(patch.finishedAt); }
    if (!sets.length) return;
    params.push(Number(id));
    await db.run(`UPDATE gis_jobs SET ${sets.join(', ')} WHERE id = ?`, params);
}

/** 处理所有 PENDING 任务（单并发，一次一个） */
async function drain() {
    if (running) return;
    running = true;
    try {
        for (;;) {
            const job = await db.get(`SELECT * FROM gis_jobs WHERE status = 'PENDING' ORDER BY id ASC LIMIT 1`);
            if (!job) break;
            const handler = handlers.get(job.kind);
            if (!handler) {
                await updateJob(job.id, { status: 'FAILED', error: `未知任务类型 ${job.kind}`, finishedAt: localTs() });
                continue;
            }
            await updateJob(job.id, { status: 'RUNNING', startedAt: localTs(), progress: 0.05 });
            try {
                const params = JSON.parse(job.params || '{}');
                const result = await handler(params, {
                    jobId: job.id,
                    progress: async (p) => updateJob(job.id, { progress: Math.max(0, Math.min(1, p)) }),
                    worldId: job.world_id, dimension: job.dimension
                });
                await updateJob(job.id, { status: 'DONE', progress: 1, result: result || null, finishedAt: localTs() });
            } catch (e) {
                await updateJob(job.id, { status: 'FAILED', error: String(e && e.message ? e.message : e).slice(0, 2000), finishedAt: localTs() });
            }
        }
    } finally {
        running = false;
    }
}

/** 启动时修复残留任务 + 起后台循环 */
async function init() {
    if (started || disabled()) return;
    started = true;
    try {
        await db.run(`UPDATE gis_jobs SET status = 'PENDING', started_at = NULL WHERE status = 'RUNNING'`);
    } catch (e) { /* 表可能还不存在 */ }
    ensureStarted();
}

function ensureStarted() {
    if (disabled()) return;
    if (ensureStarted.timer) return;
    ensureStarted.timer = setInterval(() => { drain().catch(() => { }); }, 5000);
    if (ensureStarted.timer.unref) ensureStarted.timer.unref();
}

/** 测试用：同步跑完当前所有 PENDING */
async function runPendingSync() {
    await drain();
}

module.exports = { register, enqueue, getJob, listJobs, init, drain, runPendingSync, decorate };
