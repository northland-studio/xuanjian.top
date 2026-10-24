#!/usr/bin/env node
/**
 * 生产全量重建索引（在服务器上以 node /root/rag-rebuild.js 运行）
 * 输出进度，便于 nohup 后台观察。
 */
const path = require('node:path');
process.chdir('/var/www/xuanjian-guild');
require('dotenv').config({ path: path.join('/var/www/xuanjian-guild', '.env') });

const db = require('/var/www/xuanjian-guild/database');
const vec = require('/var/www/xuanjian-guild/lib/rag/vec');
const indexer = require('/var/www/xuanjian-guild/lib/rag/indexer');
const embedding = require('/var/www/xuanjian-guild/lib/rag/embedding');

(async () => {
    console.log('[rebuild] 开始 ' + new Date().toISOString());
    const v = await vec.load();
    console.log('[rebuild] sqlite-vec: ' + (v.loaded ? v.version : '不可用 ' + v.error));

    const embTest = await embedding.test();
    console.log('[rebuild] Embedding 连通性: ' + (embTest.ok ? `${embTest.model} / ${embTest.dimension} 维` : '失败 ' + embTest.error));
    if (!embTest.ok) { process.exit(1); }

    const pages = await db.all("SELECT id FROM wiki_pages WHERE status = 'published' ORDER BY id");
    console.log('[rebuild] 待索引页面: ' + pages.length);

    const t0 = Date.now();
    let done = 0, failed = 0;
    for (const p of pages) {
        try {
            await indexer.markStale(p.id);
            await indexer.indexPage(p.id);
            done++;
        } catch (e) {
            failed++;
            console.log('[rebuild] 失败 page=' + p.id + ': ' + e.message);
        }
        if (done % 20 === 0) {
            const s = await indexer.stats();
            console.log(`[rebuild] 进度 ${done}/${pages.length} 失败=${failed} 分块=${s.chunks} 向量=${s.vectors} 用时=${((Date.now() - t0) / 1000).toFixed(0)}s`);
        }
    }

    const s = await indexer.stats();
    console.log('[rebuild] 完成 ' + JSON.stringify({ total: pages.length, done, failed, indexed: s.indexedPages, chunks: s.chunks, vectors: s.vectors, status: s.statusBreakdown, seconds: ((Date.now() - t0) / 1000).toFixed(0) }));
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('[rebuild] 异常: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
