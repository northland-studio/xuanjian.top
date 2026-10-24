/**
 * 迁移：玄剑姬 RAG 问答系统
 *
 * 用法：cd 官网根目录 && node scripts/migrate-rag.js
 * 特性：幂等；不改动任何现有表结构；sqlite-vec 不可用时降级建表并记录状态。
 *
 * 数据结构（逻辑模型见任务书第六节）：
 *   rag_page_index   页面级索引状态（当前/已索引 hash、状态、模型、分块数）
 *   rag_chunks       分块正文（页面内序号、标题路径、hash、切块版本）
 *   rag_chunks_vec   分块密集向量（sqlite-vec vec0，BGE-M3 1024 维）
 *   rag_chunks_fts   分块全文索引（FTS5 trigram，独立于现有 wiki_search）
 *   rag_index_tasks  持久化索引任务队列
 *   rag_conversations / rag_messages  短期会话（按来源隔离）
 *   rag_qa_logs      问答日志（30 天保留）
 *   rag_feedback     用户反馈
 *   rag_audit_logs   管理操作审计
 *   rag_usage_daily  每日用量汇总（长期观察）
 *   rag_meta         索引版本/配置版本等元信息
 */
const db = require('../database');

const CHUNKER_VERSION = 'v1';
const EMBEDDING_MODEL = 'BAAI/bge-m3';
const EMBEDDING_DIM = 1024;

const TABLES = [
    `CREATE TABLE IF NOT EXISTS rag_page_index (
        page_id INTEGER PRIMARY KEY,
        slug TEXT,
        title TEXT,
        category_path TEXT,
        content_hash TEXT,
        indexed_hash TEXT,
        chunk_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending','indexed','failed','stale','not_public')),
        embedding_model TEXT,
        embedding_dim INTEGER,
        chunker_version TEXT,
        last_success_at DATETIME,
        last_failure_at DATETIME,
        error TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS rag_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id INTEGER NOT NULL,
        ordinal INTEGER NOT NULL,
        heading_path TEXT,
        text TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        char_len INTEGER NOT NULL DEFAULT 0,
        index_version TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (page_id, ordinal)
    )`,
    `CREATE TABLE IF NOT EXISTS rag_index_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('index_page','delete_page','reconcile','full_rebuild')),
        page_id INTEGER,
        source_hash TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','failed','superseded')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at DATETIME,
        started_at DATETIME,
        finished_at DATETIME,
        last_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS rag_conversations (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK (source_type IN ('web_guest','web_user','qq_group','qq_private')),
        subject_hash TEXT NOT NULL,
        group_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS rag_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS rag_qa_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL,
        subject_hash TEXT,
        group_hash TEXT,
        question TEXT NOT NULL,
        answer TEXT,
        abstained INTEGER NOT NULL DEFAULT 0,
        sources TEXT,
        diagnostics TEXT,
        embedding_model TEXT,
        llm_model TEXT,
        prompt_version TEXT,
        latency_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'ok',
        error_type TEXT,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        usage_is_real INTEGER DEFAULT 1,
        embedding_tokens INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS rag_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        helpful INTEGER NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (request_id, subject_hash)
    )`,
    `CREATE TABLE IF NOT EXISTS rag_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id INTEGER,
        action TEXT NOT NULL,
        detail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS rag_usage_daily (
        day TEXT NOT NULL,
        source_type TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        llm_tokens INTEGER NOT NULL DEFAULT 0,
        embedding_tokens INTEGER NOT NULL DEFAULT 0,
        cost_estimate REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (day, source_type)
    )`,
    `CREATE TABLE IF NOT EXISTS rag_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
];

const INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_rag_chunks_page ON rag_chunks(page_id, ordinal)',
    'CREATE INDEX IF NOT EXISTS idx_rag_chunks_hash ON rag_chunks(text_hash)',
    'CREATE INDEX IF NOT EXISTS idx_rag_tasks_status ON rag_index_tasks(status, next_retry_at)',
    'CREATE INDEX IF NOT EXISTS idx_rag_tasks_page ON rag_index_tasks(page_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_rag_msgs_conv ON rag_messages(conversation_id, id)',
    'CREATE INDEX IF NOT EXISTS idx_rag_conv_expire ON rag_conversations(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_rag_logs_created ON rag_qa_logs(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_rag_logs_source ON rag_qa_logs(source_type, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_rag_feedback_request ON rag_feedback(request_id)',
    'CREATE INDEX IF NOT EXISTS idx_rag_audit_created ON rag_audit_logs(created_at DESC)'
];

async function ensureVecTable() {
    let vecPath = null;
    try {
        const vec = require('sqlite-vec');
        vecPath = typeof vec.getLoadablePath === 'function' ? vec.getLoadablePath() : null;
    } catch (e) {
        return { ok: false, reason: 'sqlite-vec 包不可用：' + e.message };
    }
    if (!vecPath) return { ok: false, reason: 'sqlite-vec 未提供可加载路径' };

    try {
        // 加载扩展（sqlite3 的 loadExtension）
        await new Promise((resolve, reject) => {
            db.db.loadExtension(vecPath, (err) => (err ? reject(err) : resolve()));
        });
        const ver = await db.get('SELECT vec_version() AS v');
        await db.run(
            `CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_vec USING vec0(
                chunk_id INTEGER PRIMARY KEY,
                embedding float[${EMBEDDING_DIM}]
            )`
        );
        return { ok: true, version: ver && ver.v, path: vecPath };
    } catch (e) {
        return { ok: false, reason: '扩展加载/建表失败：' + e.message };
    }
}

async function ensureFtsTable() {
    try {
        await db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
            chunk_id UNINDEXED,
            page_id UNINDEXED,
            heading_path,
            text,
            tokenize = 'trigram'
        )`);
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

async function setMeta(key, value) {
    await db.run(
        'INSERT INTO rag_meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP',
        [key, String(value)]
    );
}

async function main() {
    console.log('=== 玄剑姬 RAG 迁移开始 ===');

    for (const sql of TABLES) await db.run(sql);
    console.log(`✓ 业务表 ${TABLES.length} 张`);

    for (const sql of INDEXES) await db.run(sql);
    console.log(`✓ 索引 ${INDEXES.length} 个`);

    const vec = await ensureVecTable();
    if (vec.ok) {
        console.log(`✓ sqlite-vec 就绪（${vec.version}）：rag_chunks_vec float[${EMBEDDING_DIM}]`);
        await setMeta('vec.enabled', '1');
        await setMeta('vec.version', vec.version);
        await setMeta('vec.error', '');
    } else {
        console.warn('⚠ sqlite-vec 不可用，向量检索将不可用：' + vec.reason);
        await setMeta('vec.enabled', '0');
        await setMeta('vec.error', vec.reason);
    }

    const fts = await ensureFtsTable();
    if (fts.ok) {
        console.log('✓ rag_chunks_fts 就绪（FTS5 trigram）');
        await setMeta('fts.enabled', '1');
        await setMeta('fts.error', '');
    } else {
        console.warn('⚠ FTS5 分块索引创建失败：' + fts.reason);
        await setMeta('fts.enabled', '0');
        await setMeta('fts.error', fts.reason);
    }

    await setMeta('embedding.model', EMBEDDING_MODEL);
    await setMeta('embedding.dimension', String(EMBEDDING_DIM));
    await setMeta('chunker.version', CHUNKER_VERSION);

    // 迁移后自检：表是否齐、vec 表是否可查
    const tables = await db.all(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name LIKE 'rag_%' ORDER BY name"
    );
    console.log('✓ 实际存在对象：' + tables.map((t) => t.name).join(', '));

    if (vec.ok) {
        const cnt = await db.get('SELECT COUNT(*) AS c FROM rag_chunks_vec');
        console.log('✓ rag_chunks_vec 可查询，当前向量条数：' + cnt.c);
    }

    console.log('=== 迁移完成 ===');
    process.exit(0);
}

main().catch((e) => {
    console.error('迁移失败：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
