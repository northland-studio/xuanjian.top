/**
 * 索引器与持久化任务队列
 *
 * 覆盖任务书第五节：
 *  - 所有 Wiki 变更路径统一走 enqueue()（业务层调用，而不是只在路由里打补丁）
 *  - 内容变更立即 markStale()，旧索引不再进入正式检索
 *  - 任务持久化、去重、指数退避、重启恢复、running 超时回收、幂等删除
 *  - 全量重建有并发保护与进度统计；定期一致性核对
 */
const db = require('../../database');
const config = require('./config');
const chunker = require('./chunker');
const embedding = require('./embedding');
const vec = require('./vec');

const RUNNING_TIMEOUT_SECONDS = 900;

/* ---------------- 页面快照 ---------------- */

async function categoryPathOf(categoryId) {
    if (!categoryId) return '';
    const names = [];
    let cur = categoryId;
    let guard = 0;
    while (cur && guard++ < 12) {
        const row = await db.get('SELECT id, name, parent_id FROM wiki_categories WHERE id = ?', [cur]);
        if (!row) break;
        names.unshift(row.name);
        cur = row.parent_id;
    }
    return names.join(' / ');
}

async function pageSnapshot(pageId) {
    const page = await db.get(
        'SELECT id, title, slug, summary, content, status, category_id, updated_at FROM wiki_pages WHERE id = ?',
        [pageId]
    );
    if (!page) return null;
    const categoryPath = await categoryPathOf(page.category_id);
    const contentHash = chunker.contentHash({
        title: page.title,
        summary: page.summary,
        content: page.content,
        categoryPath
    });
    return { ...page, categoryPath, contentHash };
}

async function ensureRow(pageId, patch = {}) {
    await db.run(
        `INSERT INTO rag_page_index (page_id, slug, title, category_path, content_hash, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(page_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
        [
            pageId,
            patch.slug || null,
            patch.title || null,
            patch.categoryPath || null,
            patch.contentHash || null,
            patch.status || 'pending'
        ]
    );
}

/* ---------------- 变更入口 ---------------- */

/** 内容发生变更：立刻让旧索引不可检索（不等队列跑完） */
async function markStale(pageId, snap = null) {
    const s = snap || (await pageSnapshot(pageId));
    if (!s) {
        await ensureRow(pageId, { status: 'not_public' });
        return;
    }
    await ensureRow(pageId, {
        slug: s.slug,
        title: s.title,
        categoryPath: s.categoryPath,
        contentHash: s.contentHash,
        status: 'stale'
    });
    await db.run(
        `UPDATE rag_page_index
            SET slug = ?, title = ?, category_path = ?, content_hash = ?, status = 'stale', updated_at = CURRENT_TIMESTAMP
          WHERE page_id = ?`,
        [s.slug, s.title, s.categoryPath, s.contentHash, pageId]
    );
}

/** 页面不可公开（草稿/归档/删除）时立即失效 */
async function markNotPublic(pageId) {
    await ensureRow(pageId, { status: 'not_public' });
    await db.run(
        `UPDATE rag_page_index SET status = 'not_public', chunk_count = 0, indexed_hash = NULL,
                updated_at = CURRENT_TIMESTAMP WHERE page_id = ?`,
        [pageId]
    );
}

/** 投递任务：同页未完成任务会被 superseded，避免重复计算 */
async function enqueue(pageId, type = 'index_page', sourceHash = null) {
    if (pageId == null) return null;
    await db.run(
        `UPDATE rag_index_tasks SET status = 'superseded', finished_at = CURRENT_TIMESTAMP
          WHERE page_id = ? AND type = ? AND status IN ('pending','running')`,
        [pageId, type]
    );
    const r = await db.run(
        `INSERT INTO rag_index_tasks (type, page_id, source_hash, status) VALUES (?, ?, ?, 'pending')`,
        [type, pageId, sourceHash]
    );
    return r.id;
}

/** Wiki 业务层统一钩子：写入/修改/分类变化/恢复 */
async function onPageChanged(pageId) {
    const snap = await pageSnapshot(pageId);
    if (!snap) {
        await markNotPublic(pageId);
        await enqueue(pageId, 'delete_page');
        return;
    }
    if (snap.status !== 'published') {
        await markNotPublic(pageId);
        await enqueue(pageId, 'delete_page', snap.contentHash);
        return;
    }
    await markStale(pageId, snap);
    await enqueue(pageId, 'index_page', snap.contentHash);
}

/* ---------------- 任务队列 ---------------- */

async function recoverStaleRunning() {
    await db.run(
        `UPDATE rag_index_tasks
            SET status = 'pending', started_at = NULL
          WHERE status = 'running' AND started_at IS NOT NULL
            AND started_at <= datetime('now', ?)`,
        [`-${RUNNING_TIMEOUT_SECONDS} seconds`]
    );
    await db.run(
        "UPDATE rag_index_tasks SET status = 'superseded', finished_at = CURRENT_TIMESTAMP WHERE status IN ('failed') AND finished_at IS NULL"
    );
}

async function claimNextTask() {
    const row = await db.get(
        `SELECT * FROM rag_index_tasks
          WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
          ORDER BY id LIMIT 1`
    );
    if (!row) return null;
    const r = await db.run(
        `UPDATE rag_index_tasks SET status = 'running', started_at = CURRENT_TIMESTAMP, attempts = attempts + 1
          WHERE id = ? AND status = 'pending'`,
        [row.id]
    );
    if (!r.changes) return null;
    return { ...row, attempts: row.attempts + 1 };
}

async function finishTask(task, ok, error) {
    if (ok) {
        await db.run(
            "UPDATE rag_index_tasks SET status = 'success', finished_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?",
            [task.id]
        );
        return;
    }
    const attempts = task.attempts || 1;
    const giveUp = attempts >= 4;
    if (giveUp) {
        await db.run(
            "UPDATE rag_index_tasks SET status = 'failed', finished_at = CURRENT_TIMESTAMP, last_error = ? WHERE id = ?",
            [String(error || '').slice(0, 500), task.id]
        );
    } else {
        await db.run(
            `UPDATE rag_index_tasks
                SET status = 'pending', started_at = NULL, last_error = ?,
                    next_retry_at = datetime('now', ?)
              WHERE id = ?`,
            [String(error || '').slice(0, 500), `+${Math.min(600, 30 * Math.pow(2, attempts))} seconds`, task.id]
        );
    }
}

/* ---------------- 索引写入 ---------------- */

async function deleteChunksOfPage(pageId) {
    const rows = await db.all('SELECT id FROM rag_chunks WHERE page_id = ?', [pageId]);
    const ids = rows.map((r) => r.id);
    for (const id of ids) {
        if (vec.isReady()) await db.run('DELETE FROM rag_chunks_vec WHERE chunk_id = ?', [id]);
        await db.run('DELETE FROM rag_chunks_fts WHERE chunk_id = ?', [id]);
    }
    await db.run('DELETE FROM rag_chunks WHERE page_id = ?', [pageId]);
    return ids.length;
}

async function removeIndex(pageId) {
    await deleteChunksOfPage(pageId);
    await db.run(
        `UPDATE rag_page_index SET status = 'not_public', chunk_count = 0, indexed_hash = NULL,
                updated_at = CURRENT_TIMESTAMP WHERE page_id = ?`,
        [pageId]
    );
}

async function indexPage(pageId) {
    const snap = await pageSnapshot(pageId);
    if (!snap) {
        await removeIndex(pageId);
        return { status: 'deleted' };
    }
    if (snap.status !== 'published') {
        await removeIndex(pageId);
        return { status: 'not_public' };
    }

    const cfg = await config.getAll();
    const cur = await db.get('SELECT * FROM rag_page_index WHERE page_id = ?', [pageId]);
    const model = cfg['embedding.model'];
    const dim = Number(cfg['embedding.dimension']);
    if (
        cur &&
        cur.status === 'indexed' &&
        cur.indexed_hash === snap.contentHash &&
        cur.chunker_version === chunker.CHUNKER_VERSION &&
        cur.embedding_model === model &&
        Number(cur.embedding_dim) === dim
    ) {
        return { status: 'skipped' };
    }

    const chunks = chunker.chunkPage(snap, {
        chunkSize: cfg['rag.chunkSize'],
        overlap: cfg['rag.chunkOverlap']
    });

    let tokens = 0;
    let vectors = [];
    if (chunks.length && vec.isReady()) {
        const texts = chunks.map((c) =>
            chunker.buildEmbedText({
                title: snap.title,
                categoryPath: snap.categoryPath,
                headingPath: c.headingPath,
                text: c.text
            })
        );
        const r = await embedding.embed(texts);
        vectors = r.vectors;
        tokens = r.tokens;
    }

    await db.transaction(async () => {
        await deleteChunksOfPage(pageId);
        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const textHash = chunker.contentHash({ title: '', summary: '', content: c.text, categoryPath: '' });
            const ins = await db.run(
                `INSERT INTO rag_chunks (page_id, ordinal, heading_path, text, text_hash, char_len, index_version)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [pageId, c.ordinal, c.headingPath, c.text, textHash, c.charLen, chunker.CHUNKER_VERSION]
            );
            const chunkId = ins.id;
            await db.run(
                'INSERT INTO rag_chunks_fts (chunk_id, page_id, heading_path, text) VALUES (?, ?, ?, ?)',
                [chunkId, pageId, c.headingPath || '', c.text]
            );
            if (vec.isReady() && vectors[i]) {
                await db.run('INSERT INTO rag_chunks_vec (chunk_id, embedding) VALUES (?, ?)', [
                    chunkId,
                    JSON.stringify(vectors[i])
                ]);
            }
        }
        await db.run(
            `INSERT INTO rag_page_index
                (page_id, slug, title, category_path, content_hash, indexed_hash, chunk_count, status,
                 embedding_model, embedding_dim, chunker_version, last_success_at, last_failure_at, error, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'indexed', ?, ?, ?, CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP)
             ON CONFLICT(page_id) DO UPDATE SET
                slug = excluded.slug, title = excluded.title, category_path = excluded.category_path,
                content_hash = excluded.content_hash, indexed_hash = excluded.indexed_hash,
                chunk_count = excluded.chunk_count, status = 'indexed',
                embedding_model = excluded.embedding_model, embedding_dim = excluded.embedding_dim,
                chunker_version = excluded.chunker_version,
                last_success_at = CURRENT_TIMESTAMP, error = NULL, updated_at = CURRENT_TIMESTAMP`,
            [pageId, snap.slug, snap.title, snap.categoryPath, snap.contentHash, snap.contentHash, chunks.length, model, dim, chunker.CHUNKER_VERSION]
        );
    });

    // 分块版本/模型变更提示：清掉其他页面的过期待索引标记由 reconcile 负责
    await config.setMeta('index.lastSuccessAt', new Date().toISOString());

    return { status: 'indexed', chunkCount: chunks.length, tokens };
}

async function markFailed(pageId, error) {
    await ensureRow(pageId, { status: 'failed' });
    await db.run(
        `UPDATE rag_page_index SET status = 'failed', last_failure_at = CURRENT_TIMESTAMP, error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE page_id = ?`,
        [String(error || '').slice(0, 500), pageId]
    );
}

async function processTask(task) {
    try {
        if (task.type === 'delete_page') {
            await removeIndex(task.page_id);
            return { ok: true };
        }
        const r = await indexPage(task.page_id);
        return { ok: true, detail: r };
    } catch (e) {
        await markFailed(task.page_id, e.message).catch(() => {});
        return { ok: false, detail: e.message };
    }
}

/** 处理最多 max 个任务（供定时器与管理员手动触发） */
async function processTasks(max = 5) {
    await recoverStaleRunning();
    const results = [];
    for (let i = 0; i < max; i++) {
        const task = await claimNextTask();
        if (!task) break;
        if (task.type === 'reconcile') {
            const r = await reconcile();
            await finishTask(task, true, null);
            results.push({ taskId: task.id, type: task.type, ok: true, detail: r });
            continue;
        }
        if (task.type === 'full_rebuild') {
            const r = await runFullRebuild();
            await finishTask(task, true, null);
            results.push({ taskId: task.id, type: task.type, ok: true, detail: r });
            continue;
        }
        const r = await processTask(task);
        await finishTask(task, r.ok, r.detail);
        results.push({ taskId: task.id, type: task.type, pageId: task.page_id, ok: r.ok, detail: r.detail });
    }
    return results;
}

/* ---------------- 一致性核对 ---------------- */

async function reconcile() {
    const pages = await db.all("SELECT id FROM wiki_pages WHERE status = 'published'");
    let missing = 0;
    let staleCount = 0;
    for (const p of pages) {
        const snap = await pageSnapshot(p.id);
        const row = await db.get('SELECT * FROM rag_page_index WHERE page_id = ?', [p.id]);
        if (!row || row.status !== 'indexed' || row.indexed_hash !== snap.contentHash) {
            await markStale(p.id, snap);
            await enqueue(p.id, 'index_page', snap.contentHash);
            if (!row) missing++;
            else staleCount++;
        }
    }

    // 已不公开的页面必须立即失效
    const nonPublic = await db.all(
        `SELECT pi.page_id FROM rag_page_index pi
           LEFT JOIN wiki_pages p ON p.id = pi.page_id
          WHERE (p.id IS NULL OR p.status <> 'published') AND pi.status = 'indexed'`
    );
    for (const r of nonPublic) await removeIndex(r.page_id);

    // 孤立分块 / 孤立向量清理
    const orphans = await db.all(
        `SELECT c.id FROM rag_chunks c
           LEFT JOIN rag_page_index pi ON pi.page_id = c.page_id AND pi.status = 'indexed'
          WHERE pi.page_id IS NULL`
    );
    let cleaned = 0;
    for (const o of orphans) {
        if (vec.isReady()) await db.run('DELETE FROM rag_chunks_vec WHERE chunk_id = ?', [o.id]);
        await db.run('DELETE FROM rag_chunks_fts WHERE chunk_id = ?', [o.id]);
        await db.run('DELETE FROM rag_chunks WHERE id = ?', [o.id]);
        cleaned++;
    }

    await config.setMeta('index.lastReconcileAt', new Date().toISOString());
    return { published: pages.length, missing, stale: staleCount, nonPublicFixed: nonPublic.length, orphansCleaned: cleaned };
}

/* ---------------- 全量重建 ---------------- */

async function runFullRebuild() {
    const pages = await db.all("SELECT id FROM wiki_pages WHERE status = 'published' ORDER BY id");
    await config.setMeta('index.fullRebuildStartedAt', new Date().toISOString());
    await config.setMeta('index.fullRebuildTotal', String(pages.length));
    await config.setMeta('index.fullRebuildDone', '0');
    let done = 0;
    let failed = 0;
    for (const p of pages) {
        try {
            await markStale(p.id);
            await indexPage(p.id);
            done++;
        } catch {
            failed++;
        }
        await config.setMeta('index.fullRebuildDone', String(done));
    }
    await config.setMeta('index.fullRebuildFinishedAt', new Date().toISOString());
    await config.setMeta('index.fullRebuildFailed', String(failed));
    return { total: pages.length, done, failed };
}

async function startFullRebuild() {
    const running = await db.get(
        "SELECT id FROM rag_index_tasks WHERE type = 'full_rebuild' AND status IN ('pending','running')"
    );
    if (running) return { ok: false, reason: '已有全量重建任务在进行中', taskId: running.id };
    const id = await enqueue(null, 'full_rebuild');
    return { ok: true, taskId: id };
}

/* ---------------- 统计 ---------------- */

async function stats() {
    const byStatus = await db.all('SELECT status, COUNT(*) AS c FROM rag_page_index GROUP BY status');
    const chunkCount = await db.get('SELECT COUNT(*) AS c FROM rag_chunks');
    const vecCount = vec.isReady() ? await db.get('SELECT COUNT(*) AS c FROM rag_chunks_vec') : { c: 0 };
    const tasks = await db.all('SELECT status, COUNT(*) AS c FROM rag_index_tasks GROUP BY status');
    const published = await db.get("SELECT COUNT(*) AS c FROM wiki_pages WHERE status = 'published'");
    const indexed = await db.get("SELECT COUNT(*) AS c FROM rag_page_index WHERE status = 'indexed'");
    const meta = await db.all("SELECT key, value FROM rag_meta WHERE key LIKE 'index.%'");
    const metaMap = {};
    for (const m of meta) metaMap[m.key] = m.value;
    return {
        publishedPages: published.c,
        indexedPages: indexed.c,
        chunks: chunkCount.c,
        vectors: vecCount.c,
        vec: { ready: vec.isReady(), version: vec.state.version, error: vec.state.error },
        statusBreakdown: Object.fromEntries(byStatus.map((r) => [r.status, r.c])),
        tasks: Object.fromEntries(tasks.map((r) => [r.status, r.c])),
        meta: metaMap
    };
}

/* ---------------- 后台定时器 ---------------- */

let timer = null;
let working = false;

function startWorker({ intervalMs = 5000 } = {}) {
    if (timer) return;
    timer = setInterval(async () => {
        if (working) return;
        working = true;
        try {
            await processTasks(3);
        } catch (e) {
            console.error('[rag-worker] 处理任务失败：' + e.message);
        } finally {
            working = false;
        }
    }, intervalMs);
    if (timer.unref) timer.unref();
}

function stopWorker() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = {
    categoryPathOf,
    pageSnapshot,
    markStale,
    markNotPublic,
    enqueue,
    onPageChanged,
    indexPage,
    removeIndex,
    processTasks,
    reconcile,
    runFullRebuild,
    startFullRebuild,
    stats,
    startWorker,
    stopWorker
};
