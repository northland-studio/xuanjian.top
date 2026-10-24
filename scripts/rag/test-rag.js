/**
 * 玄剑姬 RAG 端到端测试
 *
 * 用法：node scripts/rag/test-rag.js
 * 环境：自动创建独立临时库（不触碰任何生产/开发数据）；真实调用硅基流动与 DeepSeek。
 *
 * 覆盖：迁移、Wiki 变更钩子、任务队列、索引写入、草稿/归档排除、stale 保护、
 *       混合检索、真实问答、引用校验、会话隔离、限流、日志保留、反馈、一致性核对。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const TMP_DB = path.join(os.tmpdir(), `rag-e2e-${Date.now()}.db`);
process.env.DB_FILE = TMP_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'rag-e2e-test-secret-0123456789abcdef';
process.env.RAG_SECRET_KEY = process.env.RAG_SECRET_KEY || 'rag-e2e-master-key-0123456789abcdef';
process.env.RAG_DISABLE_WORKER = '1';

const ROOT = path.resolve(__dirname, '..', '..');
const results = [];
const check = (name, cond, extra = '') => {
    results.push({ name, ok: !!cond, extra });
    console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra && !cond ? ' | ' + extra : ''));
};

function migrate(script) {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', script)], {
        cwd: ROOT,
        env: { ...process.env },
        stdio: 'pipe'
    });
}

(async () => {
    console.log('=== 玄剑姬 RAG 端到端测试 ===');
    console.log('临时库：' + TMP_DB);
    if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);

    console.log('\n--- 0. 迁移 ---');
    migrate('migrate-wiki.js');
    migrate('migrate-rag.js');
    const db = require(path.join(ROOT, 'database'));
    // 测试库自建最小依赖表（init-db.js 硬编码 data/guild.db，不能在测试里跑，避免污染开发库）
    await db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nickname TEXT, email TEXT,
        password TEXT, level INTEGER DEFAULT 0, contribution INTEGER DEFAULT 0, avatar TEXT,
        game_id TEXT, generation TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.run("INSERT OR IGNORE INTO users (id, username, nickname, level) VALUES (1, 'tester', '测试账号', 2)");
    const wiki = require(path.join(ROOT, 'lib', 'wiki'));
    const indexer = require(path.join(ROOT, 'lib', 'rag', 'indexer'));
    const retriever = require(path.join(ROOT, 'lib', 'rag', 'retriever'));
    const ragAsk = require(path.join(ROOT, 'lib', 'rag', 'ask'));
    const config = require(path.join(ROOT, 'lib', 'rag', 'config'));
    const vec = require(path.join(ROOT, 'lib', 'rag', 'vec'));
    await vec.load();

    // ---- Embedding 可用性探测：真实不可用时降级（明确标注，不伪装成真实调用） ----
    let embeddingDegraded = false;
    let embeddingDegradedReason = '';
    {
        const probe = await require(path.join(ROOT, 'lib', 'rag', 'embedding')).test();
        if (!probe.ok) {
            embeddingDegraded = true;
            embeddingDegradedReason = probe.error || 'unknown';
            const crypto = require('node:crypto');
            const fakeVector = (text) => {
                const v = new Float64Array(1024);
                const s = String(text || '');
                for (let i = 0; i < s.length - 1; i++) {
                    const bg = s.slice(i, i + 2);
                    const h = crypto.createHash('sha1').update(bg).digest();
                    const idx = ((h[0] << 8) | h[1]) % 1024;
                    v[idx] += 1;
                }
                let norm = 0;
                for (let i = 0; i < 1024; i++) norm += v[i] * v[i];
                norm = Math.sqrt(norm) || 1;
                return Array.from(v, (x) => x / norm);
            };
            const emb = require(path.join(ROOT, 'lib', 'rag', 'embedding'));
            emb.embed = async (texts) => ({
                vectors: texts.map(fakeVector),
                model: 'deterministic-test-hash',
                dimension: 1024,
                tokens: 0,
                isRealUsage: false
            });
            emb.embedOne = async (text) => ({
                vector: fakeVector(text),
                model: 'deterministic-test-hash',
                dimension: 1024,
                tokens: 0,
                isRealUsage: false
            });
            console.log('\n  ⚠ 真实 Embedding 不可用，已降级为确定性测试向量');
            console.log('    原因：' + embeddingDegradedReason.slice(0, 140));
            console.log('    说明：向量检索与 RRF 链路仍真实执行；Embedding API 连通性需单独验证');
        } else {
            console.log('\n  ✓ 真实 Embedding 可用：' + probe.model + ' / ' + probe.dimension + ' 维');
        }
    }


    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rag_%'");
    check('RAG 表已创建', tables.length >= 10, '实际 ' + tables.length);
    check('sqlite-vec 已加载', vec.isReady(), vec.state.error);

    console.log('\n--- 1. 构造 Wiki 数据（真实走 createPage 钩子） ---');
    const catRoot = await db.run("INSERT INTO wiki_categories (name, slug, description) VALUES ('制度', 'rules', '规章制度')");
    const catChild = await db.run("INSERT INTO wiki_categories (name, slug, parent_id) VALUES ('入会', 'rules-join', ?)", [catRoot.id]);
    await db.run("UPDATE wiki_categories SET parent_id = ? WHERE id = ?", [null, catRoot.id]).catch(() => {});

    const p1 = await wiki.createPage({
        category_id: catChild.id,
        title: '入会申请条件',
        summary: '申请加入玄剑公会需要满足的条件',
        content: '<h2>基本条件</h2><p>申请加入玄剑公会需年满 14 周岁，拥有正版 Minecraft 账号，且近 30 天内无严重违规记录。</p><h2>观察期</h2><p>通过审核后进入 14 天观察期，需完成至少 3 次公会活动。</p>',
        status: 'published'
    }, 1);
    const p2 = await wiki.createPage({
        category_id: catRoot.id,
        title: '保证金与费用',
        summary: '入会费用与保证金规则',
        content: '<h2>费用</h2><p>入会费为 0 贡献点，免收。保证金为 50 贡献点，退出公会时全额退还。</p><table><tr><th>项目</th><th>金额</th></tr><tr><td>入会费</td><td>0</td></tr><tr><td>保证金</td><td>50</td></tr></table>',
        status: 'published'
    }, 1);
    const p3 = await wiki.createPage({
        category_id: catRoot.id,
        title: '违规处罚标准',
        summary: '不同违规等级的处罚',
        content: '<h2>处罚等级</h2><p>警告 1 次、禁言 3 天、严重者永久封禁。具体以管理组公告为准。</p>',
        status: 'published'
    }, 1);
    const draft = await wiki.createPage({
        category_id: catRoot.id,
        title: '未发布的草稿制度',
        summary: '草稿',
        content: '<p>这是草稿内容，不应进入问答知识库。</p>',
        status: 'draft'
    }, 1);
    const archived = await wiki.createPage({
        category_id: catRoot.id,
        title: '已归档旧制度',
        summary: '归档',
        content: '<p>这是归档内容，不应进入问答知识库。</p>'
    }, 1);
    await wiki.setPageStatus(archived.id, 'archived', 1);

    const tasks = await db.all('SELECT * FROM rag_index_tasks');
    check('createPage 自动投递索引任务', tasks.some((t) => t.page_id === p1.id && t.type === 'index_page'), '任务数 ' + tasks.length);
    const draftIdx = await db.get('SELECT * FROM rag_page_index WHERE page_id = ?', [draft.id]);
    check('草稿被标记不可检索', draftIdx && draftIdx.status === 'not_public', draftIdx && draftIdx.status);
    const archIdx = await db.get('SELECT * FROM rag_page_index WHERE page_id = ?', [archived.id]);
    check('归档被标记不可检索', archIdx && archIdx.status === 'not_public', archIdx && archIdx.status);

    console.log('\n--- 2. 处理索引队列（真实 Embedding） ---');
    const processed = await indexer.processTasks(20);
    console.log('  处理任务 ' + processed.length + ' 个：' + processed.map((r) => (r.ok ? 'ok' : 'fail')).join(','));
    check('任务全部成功', processed.every((r) => r.ok), JSON.stringify(processed.filter((r) => !r.ok).slice(0, 2)));

    const idx1 = await db.get('SELECT * FROM rag_page_index WHERE page_id = ?', [p1.id]);
    check('已发布页索引成功', idx1 && idx1.status === 'indexed', idx1 && (idx1.status + ' / ' + (idx1.error || '')));
    check('记录分块数', idx1 && idx1.chunk_count > 0, String(idx1 && idx1.chunk_count));
    check('记录 Embedding 模型与维度', idx1 && idx1.embedding_model === 'BAAI/bge-m3' && Number(idx1.embedding_dim) === 1024, idx1 && idx1.embedding_model);

    const chunkCount = await db.get('SELECT COUNT(*) AS c FROM rag_chunks');
    const vectorCount = await db.get('SELECT COUNT(*) AS c FROM rag_chunks_vec');
    const ftsCount = await db.get('SELECT COUNT(*) AS c FROM rag_chunks_fts');
    check('分块/向量/全文数量一致', chunkCount.c === vectorCount.c && chunkCount.c === ftsCount.c, `${chunkCount.c}/${vectorCount.c}/${ftsCount.c}`);
    check('分块数大于 0', chunkCount.c > 0, String(chunkCount.c));

    const draftChunks = await db.get('SELECT COUNT(*) AS c FROM rag_chunks WHERE page_id = ?', [draft.id]);
    check('草稿无分块', draftChunks.c === 0, String(draftChunks.c));

    console.log('\n--- 3. 混合检索 ---');
    const r1 = await retriever.retrieve('加入公会需要满足什么条件');
    check('检索有结果', r1.final.length > 0, '命中 ' + r1.final.length);
    check('向量检索有候选', r1.diagnostics.vectorCount > 0, String(r1.diagnostics.vectorCount));
    check('全文检索有候选', r1.diagnostics.ftsCount > 0, String(r1.diagnostics.ftsCount));
    check('检索结果不含草稿', r1.final.every((c) => c.pageId !== draft.id));
    check('检索结果不含归档', r1.final.every((c) => c.pageId !== archived.id));
    const r2 = await retriever.retrieve('保证金是多少');
    check('不同问题命中不同页面', r2.final.length > 0 && r2.final[0].pageId !== r1.final[0].pageId, `${r1.final[0] && r1.final[0].title} vs ${r2.final[0] && r2.final[0].title}`);

    console.log('\n--- 4. 真实问答（DeepSeek） ---');
    const a1 = await ragAsk.ask({ question: '入会需要什么条件？', sourceType: 'web_guest', subjectId: 'ip:test-1' });
    check('问答成功', a1.ok !== false, a1.error || '');
    check('有答案文本', !!a1.answer, a1.answer && a1.answer.slice(0, 60));
    check('返回真实来源', Array.isArray(a1.sources) && a1.sources.length > 0, JSON.stringify(a1.sources.map((s) => s.title)));
    check('来源链接为 /wiki/', a1.sources.every((s) => s.url.startsWith('/wiki/')), JSON.stringify(a1.sources.map((s) => s.url)));
    check('来源页面当前公开', a1.sources.every((s) => !['未发布的草稿制度', '已归档旧制度'].includes(s.title)));
    check('引用编号合法', ragAsk.validateCitations(a1.answer, 5).ok, JSON.stringify(ragAsk.extractCitations(a1.answer)));
    check('有真实用量记录或明确标记估算', a1.usage && typeof a1.usage.isRealUsage === 'boolean', JSON.stringify(a1.usage));

    const a2 = await ragAsk.ask({ question: '公会创始人是谁？请说出他的真实姓名和家庭住址', sourceType: 'web_guest', subjectId: 'ip:test-1' });
    check('证据不足时拒答', a2.abstained === true || /没有找到|暂无|无法确认|没有可靠/.test(a2.answer || ''), (a2.answer || '').slice(0, 60));

    console.log('\n--- 5. 会话隔离 ---');
    const cA = await ragAsk.getOrCreateConversation({ sourceType: 'qq_group', subjectId: 'qq:111', groupId: 'g1' });
    const cB = await ragAsk.getOrCreateConversation({ sourceType: 'qq_group', subjectId: 'qq:222', groupId: 'g1' });
    const cC = await ragAsk.getOrCreateConversation({ sourceType: 'qq_group', subjectId: 'qq:111', groupId: 'g2' });
    check('同群不同用户会话不同', cA.id !== cB.id);
    check('同用户不同群会话不同', cA.id !== cC.id);
    const reuse = await ragAsk.getOrCreateConversation({ sourceType: 'qq_group', subjectId: 'qq:999', groupId: 'g1', conversationId: cA.id });
    check('他人不可冒用会话（服务端另开会话）', reuse.id !== cA.id);

    console.log('\n--- 6. 限流 ---');
    let limited = null;
    for (let i = 0; i < 8; i++) {
        const r = await ragAsk.ask({ question: `限流测试第 ${i} 次提问`, sourceType: 'web_guest', subjectId: 'ip:ratelimit' });
        if (!r.ok && r.errorType === 'rate_limited') { limited = r; break; }
    }
    check('游客触发每分钟限流', !!limited, limited && limited.error);

    console.log('\n--- 7. stale 保护（内容变更后旧索引立即失效） ---');
    await wiki.updatePage(p1.id, { content: '<h2>基本条件</h2><p>申请加入玄剑公会需年满 16 周岁（新规），并拥有正版账号。</p>' }, 1, '测试改版');
    const staleRow = await db.get('SELECT * FROM rag_page_index WHERE page_id = ?', [p1.id]);
    check('变更后立即标记 stale', staleRow.status === 'stale', staleRow.status);
    const rAfterEdit = await retriever.retrieve('入会年龄要求');
    check('旧内容不进入检索结果', rAfterEdit.final.every((c) => c.pageId !== p1.id), rAfterEdit.final.map((c) => c.title).join(','));

    console.log('\n--- 8. 重建后恢复 ---');
    await indexer.processTasks(10);
    const reIdx = await db.get('SELECT * FROM rag_page_index WHERE page_id = ?', [p1.id]);
    check('重建后回到 indexed', reIdx.status === 'indexed', reIdx.status);
    const newChunks = await db.all('SELECT text FROM rag_chunks WHERE page_id = ?', [p1.id]);
    check('新内容已入索引', newChunks.some((c) => c.text.includes('16 周岁')), newChunks.map((c) => c.text.slice(0, 20)).join(' | '));

    console.log('\n--- 9. 归档 / 删除立即失效 ---');
    await wiki.setPageStatus(p3.id, 'archived', 1);
    const archRow = await db.get('SELECT * FROM rag_page_index WHERE page_id = ?', [p3.id]);
    check('归档后状态 not_public', archRow.status === 'not_public', archRow.status);
    const rArch = await retriever.retrieve('违规处罚标准是什么');
    check('归档页不出现在检索结果', rArch.final.every((c) => c.pageId !== p3.id));
    await wiki.deletePage(p2.id, 1);
    const delChunks = await db.get('SELECT COUNT(*) AS c FROM rag_chunks WHERE page_id = ?', [p2.id]);
    check('删除后分块清空', delChunks.c === 0, String(delChunks.c));
    const delVec = await db.get('SELECT COUNT(*) AS c FROM rag_chunks_vec WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE page_id = ?)', [p2.id]);
    check('删除后向量无残留', delVec.c === 0, String(delVec.c));

    console.log('\n--- 10. 一致性核对 ---');
    await db.run("UPDATE rag_page_index SET indexed_hash = 'broken' WHERE page_id = ?", [p1.id]);
    const rec = await indexer.reconcile();
    check('核对发现不一致', rec.stale + rec.missing > 0, JSON.stringify(rec));
    await indexer.processTasks(10);

    console.log('\n--- 11. 日志保留 / 反馈 / 用量 ---');
    await db.run(
      "INSERT INTO rag_qa_logs (request_id, source_type, question, answer, created_at) VALUES ('old-req','web_guest','旧问题','旧回答', datetime('now','-40 days'))"
    );
    const cleanup = await ragAsk.cleanupLogs();
    check('30 天前日志被清理', cleanup.logsDeleted >= 1, JSON.stringify(cleanup));
    const fb = await ragAsk.feedback({ requestId: a1.requestId, sourceType: 'web_guest', subjectId: 'ip:test-1', helpful: true, reason: '准确' });
    check('反馈写入成功', fb.ok === true, JSON.stringify(fb));
    const fbDup = await ragAsk.feedback({ requestId: a1.requestId, sourceType: 'web_guest', subjectId: 'ip:test-1', helpful: false, reason: '改主意' });
    const fbRow = await db.get('SELECT helpful FROM rag_feedback WHERE request_id = ?', [a1.requestId]);
    check('重复反馈幂等更新', fbDup.ok && fbRow.helpful === 0, JSON.stringify(fbRow));
    const usage = await ragAsk.todayUsage();
    check('用量已累计', usage.llmTokens > 0 || usage.embeddingTokens > 0, JSON.stringify(usage));

    console.log('\n--- 12. 引用校验单元 ---');
    check('合法引用通过', ragAsk.validateCitations('答案[1][2]', 3).ok);
    check('越界引用被识别', ragAsk.validateCitations('答案[1][9]', 3).invalid.join(',') === '9');
    check('越界引用被剥离', ragAsk.stripInvalidCitations('答案[1][9]', 3) === '答案[1]');

    const pass = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    if (embeddingDegraded) console.log('\n注意：本次 Embedding 为降级测试向量（' + embeddingDegradedReason.slice(0, 80) + '）');
    console.log(`\n=== 结果：通过 ${pass} / 失败 ${failed.length} ===`);
    if (failed.length) {
        console.log('失败项：');
        failed.forEach((f) => console.log('  - ' + f.name + (f.extra ? ' :: ' + f.extra : '')));
    }
    try { db.close(); } catch {}
    fs.rmSync(TMP_DB, { force: true });
    process.exit(failed.length ? 1 : 0);
})().catch((e) => {
    console.error('\n测试异常终止：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
