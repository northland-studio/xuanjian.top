/**
 * 混合检索：向量候选 + FTS5 候选 + RRF 融合 + 版本/状态过滤
 *
 * 关键约束（任务书 4.5 / 5.3）：
 *  - 旧分块不得占用 Top-K 后再被过滤掉，因此过滤条件下推到 SQL（JOIN rag_page_index / wiki_pages）
 *  - 只有 status=indexed 且 indexed_hash=content_hash（内容与索引一致）、
 *    分块版本与 Embedding 模型/维度匹配的分块才可检索
 */
const db = require('../../database');
const config = require('./config');
const chunker = require('./chunker');
const embedding = require('./embedding');
const vec = require('./vec');

/** 可检索分块的统一过滤条件 */
const VALID_CHUNK_SQL = `
    pi.status = 'indexed'
    AND pi.indexed_hash IS NOT NULL
    AND pi.indexed_hash = pi.content_hash
    AND pi.chunker_version = ?
    AND p.status = 'published'
`;

function escapeFts(q) {
    const s = String(q || '').replace(/["'*]/g, ' ').trim();
    return s ? `"${s}"` : '';
}

async function vectorTopK(queryVector, k) {
    if (!vec.isReady()) return [];
    if (!Array.isArray(queryVector) || !queryVector.length) return [];
    // vec0 KNN：MATCH 参数为查询向量 JSON，ORDER BY distance 升序
    const hits = await db
        .all(
            `SELECT chunk_id AS chunkId, distance FROM rag_chunks_vec
              WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
            [JSON.stringify(queryVector), k]
        )
        .catch((e) => {
            throw new Error('向量检索失败：' + e.message);
        });
    return hits;
}

/**
 * 组装 FTS 查询串：
 * trigram 分词下，整句加引号会被当成连续短语（几乎必然 0 命中），
 * 因此按标点/空格切分，中文再取 3 字滑窗关键词，用 OR 组合，交给 bm25 排序。
 */
function buildFtsQuery(question) {
    const src = String(question || '').replace(/[，。？！、；：""''（）()\[\]{}<>《》!?.,;:]/g, ' ');
    const terms = new Set();
    for (const seg of src.split(/\s+/)) {
        const s = seg.trim();
        if (!s) continue;
        if (/^[a-zA-Z0-9-]{3,}$/.test(s)) {
            terms.add(s);
            continue;
        }
        // 中文：3 字滑窗（trigram 最小可检索单位），逐字滑动以最大化召回
        const cjk = s.replace(/[^\u4e00-\u9fa5]/g, '');
        if (cjk.length >= 3) {
            for (let i = 0; i + 3 <= cjk.length && terms.size < 30; i += 1) {
                terms.add(cjk.slice(i, i + 3));
            }
        } else if (cjk.length > 0) {
            terms.add(cjk);
        }
    }
    if (!terms.size) return '';
    return [...terms].map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

async function ftsTopK(question, k) {
    const matcher = buildFtsQuery(question);
    if (!matcher) return [];
    const hits = await db
        .all(
            `SELECT f.chunk_id AS chunkId, bm25(rag_chunks_fts) AS score
               FROM rag_chunks_fts f
              WHERE rag_chunks_fts MATCH ?
              ORDER BY score LIMIT ?`,
            [matcher, k]
        )
        .catch(() => []);
    if (hits.length) return hits;

    // 兜底：极短查询用 LIKE（trigram 无法命中 <3 字）
    const like = '%' + String(question).trim() + '%';
    return db.all(`SELECT id AS chunkId, 0 AS score FROM rag_chunks WHERE text LIKE ? LIMIT ?`, [like, k]);
}

function rrf(lists, k = 60) {
    const scores = new Map();
    const ranks = new Map();
    lists.forEach((list, listIdx) => {
        list.forEach((item, idx) => {
            const id = Number(item.chunkId);
            scores.set(id, (scores.get(id) || 0) + 1 / (k + idx + 1));
            if (!ranks.has(id)) ranks.set(id, {});
            ranks.get(id)[listIdx] = idx + 1;
        });
    });
    return [...scores.entries()]
        .map(([chunkId, score]) => ({ chunkId, rrfScore: score, sourceRanks: ranks.get(chunkId) || {} }))
        .sort((a, b) => b.rrfScore - a.rrfScore);
}

async function loadChunks(ids) {
    if (!ids.length) return new Map();
    const cfg = await config.getAll();
    const placeholders = ids.map(() => '?').join(',');
    // 关键：可检索性过滤必须下推到 SQL，避免 stale / 不可公开 / 版本不符的分块进入候选
    const rows = await db.all(
        `SELECT c.id, c.page_id AS pageId, c.ordinal, c.heading_path AS headingPath, c.text, c.char_len AS charLen,
                pi.slug, pi.title, pi.category_path AS categoryPath, p.updated_at AS updatedAt
           FROM rag_chunks c
           JOIN rag_page_index pi ON pi.page_id = c.page_id
           JOIN wiki_pages p ON p.id = c.page_id
          WHERE c.id IN (${placeholders})
            AND ${VALID_CHUNK_SQL}
            AND pi.embedding_model = ?
            AND pi.embedding_dim = ?`,
        [
            ...ids,
            chunker.CHUNKER_VERSION,
            cfg['embedding.model'],
            Number(cfg['embedding.dimension'])
        ]
    );
    return new Map(rows.map((r) => [r.id, r]));
}

/**
 * 检索主入口
 * @returns {{final:Array, diagnostics:object}}
 */
async function retrieve(question, opts = {}) {
    const cfg = await config.getAll();
    const vectorK = Number(opts.vectorTopK || cfg['rag.vectorTopK']);
    const ftsK = Number(opts.ftsTopK || cfg['rag.ftsTopK']);
    const rrfK = Number(opts.rrfK || cfg['rag.rrfK']);
    const finalCount = Number(opts.finalChunkCount || cfg['rag.finalChunkCount']);
    const maxChars = Number(opts.maxContextChars || cfg['rag.maxContextChars']);

    const t0 = Date.now();
    let queryVector = null;
    let embedError = null;
    let embeddingTokens = 0;
    if (vec.isReady()) {
        // 失败重试一次：Embedding 偶发超时不应直接让本轮问答退化为「没有记载」
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const r = await embedding.embedOne(String(question).slice(0, 1000));
                queryVector = r.vector;
                embeddingTokens = r.tokens;
                embedError = null;
                break;
            } catch (e) {
                embedError = e.message;
                if (attempt === 1) await new Promise((res) => setTimeout(res, 400));
            }
        }
    }

    const vecHits = queryVector ? await vectorTopK(queryVector, vectorK) : [];
    const ftsHits = await ftsTopK(question, ftsK);
    const fused = rrf([vecHits, ftsHits], rrfK);

    // 版本/状态过滤（下推到 SQL 之后再次校验，防止旧索引混入）
    const candidateIds = fused.slice(0, Math.max(finalCount * 8, 40)).map((f) => f.chunkId);
    const chunkMap = await loadChunks(candidateIds);

    const allowed = [];
    for (const f of fused) {
        const c = chunkMap.get(f.chunkId);
        if (!c) continue;
        allowed.push({ ...f, chunk: c });
        if (allowed.length >= finalCount) break;
    }

    // 组装上下文：去重同页相邻块，限制总字数
    const final = [];
    let usedChars = 0;
    const seenPages = new Map();
    for (const a of allowed) {
        const c = a.chunk;
        const prevOrdinal = seenPages.get(c.pageId);
        if (prevOrdinal != null && Math.abs(prevOrdinal - c.ordinal) > 1) {
            // 同页但不相邻：保留（可能是不同章节），但避免一个页面霸占全部名额
            const pageCount = final.filter((x) => x.pageId === c.pageId).length;
            if (pageCount >= 2) continue;
        }
        if (usedChars + (c.charLen || c.text.length) > maxChars) continue;
        final.push({
            chunkId: c.id,
            pageId: c.pageId,
            ordinal: c.ordinal,
            headingPath: c.headingPath,
            text: c.text,
            charLen: c.charLen || c.text.length,
            slug: c.slug,
            title: c.title,
            categoryPath: c.categoryPath,
            updatedAt: c.updatedAt,
            rrfScore: a.rrfScore,
            sourceRanks: a.sourceRanks
        });
        seenPages.set(c.pageId, c.ordinal);
        usedChars += c.charLen || c.text.length;
    }

    return {
        final,
        diagnostics: {
            question,
            elapsedMs: Date.now() - t0,
            vectorReady: vec.isReady(),
            vectorCount: vecHits.length,
            ftsCount: ftsHits.length,
            fusedCount: fused.length,
            embeddingTokens,
            embedError,
            vectorTopK: vecHits.slice(0, 10),
            ftsTopK: ftsHits.slice(0, 10),
            rrfTop: fused.slice(0, 10),
            chunkerVersion: chunker.CHUNKER_VERSION,
            embeddingModel: cfg['embedding.model'],
            embeddingDim: cfg['embedding.dimension'],
            params: { vectorK, ftsK, rrfK, finalCount, maxChars }
        }
    };
}

module.exports = { retrieve, rrf, vectorTopK, ftsTopK, VALID_CHUNK_SQL };
