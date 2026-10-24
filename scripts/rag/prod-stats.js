#!/usr/bin/env node
/**
 * 生产索引统计（在服务器 /var/www/xuanjian-guild 下运行）
 */
const path = require('node:path');
const APP = '/var/www/xuanjian-guild';
process.chdir(APP);
require('dotenv').config({ path: path.join(APP, '.env') });

const db = require(path.join(APP, 'database'));
const vec = require(path.join(APP, 'lib', 'rag', 'vec'));

(async () => {
    await vec.load();
    const q = async (sql, p = []) => db.get(sql, p);

    const rows = {
        published: (await q("SELECT COUNT(*) c FROM wiki_pages WHERE status='published'")).c,
        indexed: (await q("SELECT COUNT(*) c FROM rag_page_index WHERE status='indexed'")).c,
        stale: (await q("SELECT COUNT(*) c FROM rag_page_index WHERE status='stale'")).c,
        failed: (await q("SELECT COUNT(*) c FROM rag_page_index WHERE status='failed'")).c,
        notPublic: (await q("SELECT COUNT(*) c FROM rag_page_index WHERE status='not_public'")).c,
        chunks: (await q('SELECT COUNT(*) c FROM rag_chunks')).c,
        vectors: (await q('SELECT COUNT(*) c FROM rag_chunks_vec')).c,
        fts: (await q('SELECT COUNT(*) c FROM rag_chunks_fts')).c,
        qaLogs: (await q('SELECT COUNT(*) c FROM rag_qa_logs')).c,
        convs: (await q('SELECT COUNT(*) c FROM rag_conversations')).c,
        tasksPending: (await q("SELECT COUNT(*) c FROM rag_index_tasks WHERE status='pending'")).c,
        tasksFailed: (await q("SELECT COUNT(*) c FROM rag_index_tasks WHERE status='failed'")).c
    };

    console.log('sqlite-vec: ' + (vec.isReady() ? vec.version : '不可用'));
    console.log(JSON.stringify(rows, null, 2));

    const mis = await db.all(
        `SELECT page_id, status, content_hash, indexed_hash FROM rag_page_index
          WHERE status='indexed' AND (indexed_hash IS NULL OR indexed_hash <> content_hash) LIMIT 5`
    );
    console.log('hash 不一致的已索引页（应为空）: ' + (mis.length ? JSON.stringify(mis) : '无'));

    const orphan = await db.get(
        `SELECT COUNT(*) c FROM rag_chunks c LEFT JOIN rag_page_index pi ON pi.page_id=c.page_id AND pi.status='indexed' WHERE pi.page_id IS NULL`
    );
    console.log('孤立分块（应为 0）: ' + orphan.c);

    const dup = await db.get(
        `SELECT COUNT(*) c FROM (SELECT chunk_id FROM rag_chunks_fts GROUP BY chunk_id HAVING COUNT(*)>1)`
    );
    console.log('FTS 重复 chunk（应为 0）: ' + dup.c);

    const sample = await db.all(
        `SELECT pi.page_id, pi.title, pi.chunk_count, pi.status FROM rag_page_index pi WHERE pi.status='indexed' ORDER BY pi.chunk_count DESC LIMIT 3`
    );
    console.log('分块最多的页面: ' + JSON.stringify(sample));
    process.exit(0);
})().catch((e) => {
    console.error('统计失败: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
