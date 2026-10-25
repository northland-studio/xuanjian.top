/**
 * 玄剑姬 RAG 问答 API
 *
 * 公开部分：
 *   POST /api/faq/ask        游客与登录用户（服务端判定来源，客户端无法伪造）
 *   POST /api/faq/feedback   有用/无用反馈
 *
 * 管理部分（挂在 /api/faq/admin，沿用现有 authMiddleware/adminMiddleware/superAdminMiddleware）：
 *   状态、脱敏配置、连通性测试、问答测试台、索引与任务管理、全量重建、用量与日志
 */
const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const logger = require('../lib/logger');
const db = require('../database');
const { optionalAuthMiddleware, authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');
const ragAsk = require('../lib/rag/ask');
const config = require('../lib/rag/config');
const indexer = require('../lib/rag/indexer');
const retriever = require('../lib/rag/retriever');
const vec = require('../lib/rag/vec');
const embedding = require('../lib/rag/embedding');
const llm = require('../lib/rag/llm');

const router = express.Router();

/* ---------------- 游客身份（匿名 cookie，避免用 IP 当主体） ---------------- */

const GUEST_COOKIE = 'rag_gid';
const GUEST_COOKIE_MAX_AGE = 365 * 24 * 3600;

function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

/** 取（必要时签发）匿名访客 ID；只用于会话归属与限流主体，不含任何个人身份 */
function guestId(req, res) {
    const existing = parseCookies(req.headers.cookie)[GUEST_COOKIE];
    if (/^[a-f0-9]{32}$/.test(String(existing || ''))) return existing;
    const id = crypto.randomBytes(16).toString('hex');
    const attrs = [`${GUEST_COOKIE}=${id}`, 'Path=/', `Max-Age=${GUEST_COOKIE_MAX_AGE}`, 'HttpOnly', 'SameSite=Lax'];
    if (req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https')) attrs.push('Secure');
    res.append('Set-Cookie', attrs.join('; '));
    return id;
}

/** 统一主体串：登录用户按 userId，游客按匿名 cookie */
function subjectOf(req, res) {
    return req.userId ? 'u:' + req.userId : 'g:' + guestId(req, res);
}

/** 限流键：与主体一致，避免 Cloudflare 边缘 IP 导致不同用户共享同一桶 */
function limitKey(req) {
    if (req.userId) return 'u' + req.userId;
    const gid = parseCookies(req.headers.cookie)[GUEST_COOKIE];
    return gid ? 'g' + gid : 'ip' + String(req.ip || 'unknown');
}

const askLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: limitKey,
    message: { ok: false, error: '请求过于频繁，请稍后再试', errorType: 'rate_limited' }
});

const feedbackLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: limitKey,
    message: { ok: false, error: '反馈过于频繁' }
});

const testLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 4,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: '测试过于频繁，请 30 秒后再试' }
});

function errStatus(type) {
    if (type === 'rate_limited') return 429;
    if (type === 'budget_exceeded' || type === 'circuit_open') return 503;
    if (type === 'auth' || type === 'no_key') return 503;
    return 400;
}

/* ==================== 公开问答 ==================== */

router.post('/ask', optionalAuthMiddleware, askLimiter, async (req, res) => {
    try {
        const question = req.body && req.body.question;
        const conversationId = req.body && req.body.conversationId;
        const sourceType = req.userId ? 'web_user' : 'web_guest';
        // 游客用服务端签发的匿名 cookie 作为主体（不经 IP，避免 Cloudflare 边缘 IP 变化）
        const subjectId = subjectOf(req, res);

        const result = await ragAsk.ask({ question, sourceType, subjectId, conversationId });
        if (!result.ok) {
            return res.status(errStatus(result.errorType)).json({
                ok: false,
                error: result.error,
                errorType: result.errorType,
                requestId: result.requestId,
                conversationId: result.conversationId
            });
        }
        return res.json({
            ok: true,
            requestId: result.requestId,
            conversationId: result.conversationId,
            answer: result.answer,
            abstained: result.abstained,
            abstainReason: result.abstainReason,
            sources: result.sources,
            promptVersion: result.promptVersion,
            latencyMs: result.latencyMs,
            cached: result.cached === true
        });
    } catch (e) {
        logger.error('FAQ 问答接口错误: ' + e.message);
        return res.status(500).json({ ok: false, error: '服务内部错误' });
    }
});

router.post('/feedback', optionalAuthMiddleware, feedbackLimiter, async (req, res) => {
    try {
        const { requestId, helpful, reason } = req.body || {};
        if (!requestId) return res.status(400).json({ ok: false, error: '缺少 requestId' });
        const subjectId = subjectOf(req, res);
        const r = await ragAsk.feedback({
            requestId: String(requestId).slice(0, 64),
            sourceType: req.userId ? 'web_user' : 'web_guest',
            subjectId,
            helpful: !!helpful,
            reason
        });
        return res.status(r.ok ? 200 : 404).json(r);
    } catch (e) {
        logger.error('FAQ 反馈接口错误: ' + e.message);
        return res.status(500).json({ ok: false, error: '服务内部错误' });
    }
});

/* ==================== 管理端 ==================== */

const adminOnly = [authMiddleware, adminMiddleware];
const superOnly = [authMiddleware, superAdminMiddleware];

router.get('/admin/status', ...adminOnly, async (req, res) => {
    try {
        const [stats, cfg, usages, secrets, breaker] = await Promise.all([
            indexer.stats(),
            config.getAll(),
            ragAsk.todayUsage(),
            config.secretStatus(),
            ragAsk.breakerStatus(await config.getAll())
        ]);
        const meta = await db.all("SELECT key, value FROM rag_meta WHERE key LIKE '%last%'");
        const recentFail = await db.get(
            "SELECT id, page_id, last_error, attempts, finished_at FROM rag_index_tasks WHERE status = 'failed' ORDER BY id DESC LIMIT 1"
        );
        res.json({
            ok: true,
            service: { ready: true, promptVersion: ragAsk.PROMPT_VERSION, vec: stats.vec, ftsReady: true },
            stats,
            usage: usages,
            budget: { limit: cfg['rag.dailyBudget'], used: usages.cost, alertThreshold: cfg['rag.costAlertThreshold'] },
            tokenBudget: { limit: cfg['rag.dailyTokenLimit'] || 120000, used: usages.llmTokens },
            breaker,
            secrets: { hasMasterKey: secrets.hasMasterKey, embeddingConfigured: secrets.embedding.configured, llmConfigured: secrets.llm.configured },
            lastError: recentFail || null,
            meta: Object.fromEntries(meta.map((m) => [m.key, m.value]))
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/admin/config', ...adminOnly, async (req, res) => {
    try {
        const cfg = await config.getAll();
        const secrets = await config.secretStatus();
        const isSuper = Number(req.userLevel) >= 2;
        const out = {};
        for (const [k, v] of Object.entries(cfg)) {
            // 普通管理员只看运行参数，看得到模型名但不能改密钥/提示词
            out[k] = v;
        }
        res.json({
            ok: true,
            config: out,
            defaults: config.DEFAULTS,
            secrets: {
                hasMasterKey: secrets.hasMasterKey,
                embedding: secrets.embedding,
                llm: secrets.llm
            },
            canEdit: isSuper,
            editableKeys: isSuper ? Object.keys(cfg) : Object.keys(cfg).filter((k) => config.PUBLIC_KEYS.has(k))
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

/** 数字型配置的范围校验：越界直接 400，而不是存进去再出事 */
function validateNumericPatch(patch) {
    const RANGES = {
        'rag.chunkSize': [120, 2000],
        'rag.chunkOverlap': [0, 400],
        'rag.vectorTopK': [1, 200],
        'rag.ftsTopK': [1, 200],
        'rag.rrfK': [1, 200],
        'rag.finalChunkCount': [1, 20],
        'rag.maxContextChars': [500, 20000],
        'rag.maxOutputTokens': [64, 4000],
        'rag.conversationIdleTimeout': [60, 86400],
        'rag.conversationMaxTurns': [0, 20],
        'rag.logRetentionDays': [1, 365],
        'rag.guestPerMinute': [1, 120],
        'rag.guestPerDay': [1, 5000],
        'rag.userPerMinute': [1, 120],
        'rag.userPerDay': [1, 5000],
        'rag.botPerMinute': [1, 600],
        'rag.botPerDay': [1, 20000],
        'rag.maxQuestionLength': [20, 2000],
        'rag.maxConcurrent': [1, 32],
        'rag.dailyBudget': [0, 1000],
        'rag.dailyTokenLimit': [10000, 5000000],
        'rag.costAlertThreshold': [0, 1],
        'rag.circuitFailThreshold': [1, 50],
        'rag.circuitCooldownSeconds': [30, 86400],
        'embedding.dimension': [256, 4096],
        'embedding.batchSize': [1, 64],
        'embedding.maxCharsPerBatch': [500, 50000]
    };
    for (const [k, v] of Object.entries(patch || {})) {
        if (!(k in RANGES)) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) return `${k} 必须是数字`;
        const [min, max] = RANGES[k];
        if (n < min || n > max) return `${k} 需在 ${min} ~ ${max} 之间（当前 ${n}）`;
    }
    return null;
}

router.put('/admin/config', ...superOnly, async (req, res) => {
    try {
        const patch = (req.body && req.body.config) || {};
        const invalid = validateNumericPatch(patch);
        if (invalid) return res.status(400).json({ ok: false, error: invalid });
        const before = await config.getAll();
        const written = await config.setMany(patch);
        await ragAsk.audit(req.userId, 'rag.config.update', {
            keys: written.filter((k) => !config.PUBLIC_KEYS.has(k) || true),
            changed: Object.fromEntries(Object.entries(patch).filter(([k]) => written.includes(k)).map(([k, v]) => [k, String(v).slice(0, 4) + '***']))
        });
        const after = await config.getAll();
        const needRebuild =
            Number(before['embedding.dimension']) !== Number(after['embedding.dimension']) ||
            before['embedding.model'] !== after['embedding.model'];
        res.json({ ok: true, written, needRebuild, rebuildReason: needRebuild ? 'Embedding 模型或维度已变更，必须全量重建索引' : null });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/admin/config/clear-secret', ...superOnly, async (req, res) => {
    try {
        const slot = req.body && req.body.slot;
        const key = slot === 'embedding' ? 'embedding.apiKey' : slot === 'llm' ? 'llm.apiKey' : null;
        if (!key) return res.status(400).json({ ok: false, error: 'slot 必须是 embedding 或 llm' });
        await config.clearSecret(key);
        await ragAsk.audit(req.userId, 'rag.secret.clear', { slot });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/admin/test/connectivity', ...adminOnly, testLimiter, async (req, res) => {
    try {
        const [emb, l] = await Promise.all([embedding.test(), llm.test()]);
        await ragAsk.audit(req.userId, 'rag.test.connectivity', {
            embedding: emb.ok,
            llm: l.ok
        });
        res.json({ ok: emb.ok && l.ok, embedding: emb, llm: l });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/admin/test/ask', ...adminOnly, testLimiter, async (req, res) => {
    try {
        const question = (req.body && req.body.question) || '';
        const result = await ragAsk.ask({
            question,
            sourceType: 'web_user',
            subjectId: 'admin:' + req.userId,
            allowDiagnostics: true
        });
        res.json({ ok: result.ok !== false, result });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/admin/index', ...adminOnly, async (req, res) => {
    try {
        const status = req.query.status ? String(req.query.status) : null;
        const q = req.query.q ? String(req.query.q).trim() : '';
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const params = [];
        let where = '1=1';
        if (status) {
            where += ' AND pi.status = ?';
            params.push(status);
        }
        if (q) {
            where += ' AND (pi.title LIKE ? OR pi.slug LIKE ?)';
            params.push('%' + q + '%', '%' + q + '%');
        }
        const rows = await db.all(
            `SELECT pi.*, p.status AS page_status, p.updated_at AS page_updated_at
               FROM rag_page_index pi LEFT JOIN wiki_pages p ON p.id = pi.page_id
              WHERE ${where} ORDER BY pi.page_id DESC LIMIT ?`,
            [...params, limit]
        );
        res.json({ ok: true, pages: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/admin/index/:pageId/rebuild', ...adminOnly, async (req, res) => {
    try {
        const pageId = Number(req.params.pageId);
        if (!pageId) return res.status(400).json({ ok: false, error: 'pageId 无效' });
        await indexer.markStale(pageId);
        const taskId = await indexer.enqueue(pageId, 'index_page');
        await ragAsk.audit(req.userId, 'rag.index.rebuild', { pageId, taskId });
        res.json({ ok: true, taskId });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/admin/tasks', ...adminOnly, async (req, res) => {
    try {
        const status = req.query.status ? String(req.query.status) : null;
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const rows = status
            ? await db.all('SELECT * FROM rag_index_tasks WHERE status = ? ORDER BY id DESC LIMIT ?', [status, limit])
            : await db.all('SELECT * FROM rag_index_tasks ORDER BY id DESC LIMIT ?', [limit]);
        res.json({ ok: true, tasks: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/admin/tasks/:id/retry', ...adminOnly, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const r = await db.run(
            "UPDATE rag_index_tasks SET status = 'pending', next_retry_at = NULL, attempts = 0, last_error = NULL WHERE id = ? AND status IN ('failed','pending')",
            [id]
        );
        await ragAsk.audit(req.userId, 'rag.task.retry', { id });
        res.json({ ok: true, updated: r.changes });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/admin/process-tasks', ...adminOnly, async (req, res) => {
    try {
        const max = Math.min(20, Math.max(1, Number(req.body && req.body.max) || 5));
        const results = await indexer.processTasks(max);
        res.json({ ok: true, results });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/admin/reconcile', ...adminOnly, async (req, res) => {
    try {
        const r = await indexer.reconcile();
        await ragAsk.audit(req.userId, 'rag.reconcile', r);
        res.json({ ok: true, result: r });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/admin/rebuild', ...superOnly, async (req, res) => {
    try {
        const r = await indexer.startFullRebuild();
        await ragAsk.audit(req.userId, 'rag.rebuild.full', r);
        res.status(r.ok ? 200 : 409).json(r);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/admin/rebuild/status', ...adminOnly, async (req, res) => {
    try {
        const metaKeys = [
            'index.fullRebuildStartedAt', 'index.fullRebuildFinishedAt',
            'index.fullRebuildTotal', 'index.fullRebuildDone', 'index.fullRebuildFailed'
        ];
        const out = {};
        for (const k of metaKeys) out[k] = await config.getMeta(k, null);
        const running = await db.get(
            "SELECT id, status, attempts FROM rag_index_tasks WHERE type = 'full_rebuild' ORDER BY id DESC LIMIT 1"
        );
        res.json({ ok: true, progress: out, task: running || null });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/admin/usage', ...adminOnly, async (req, res) => {
    try {
        const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
        const rows = await db.all(
            'SELECT * FROM rag_usage_daily ORDER BY day DESC LIMIT ?',
            [days * 4]
        );
        res.json({ ok: true, usage: rows, prices: ragAsk.PRICE });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/admin/logs', ...adminOnly, async (req, res) => {
    try {
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const source = req.query.source ? String(req.query.source) : null;
        const status = req.query.status ? String(req.query.status) : null;
        const params = [];
        let where = '1=1';
        if (source) { where += ' AND source_type = ?'; params.push(source); }
        if (status) { where += ' AND status = ?'; params.push(status); }
        const rows = await db.all(
            `SELECT id, request_id, source_type, subject_hash, group_hash, question, answer, abstained,
                    sources, latency_ms, status, error_type, total_tokens, usage_is_real, embedding_tokens, created_at
               FROM rag_qa_logs WHERE ${where} ORDER BY id DESC LIMIT ?`,
            [...params, limit]
        );
        res.json({ ok: true, logs: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/admin/feedback', ...adminOnly, async (req, res) => {
    try {
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const rows = await db.all(
            `SELECT f.*, l.question, l.source_type FROM rag_feedback f
               LEFT JOIN rag_qa_logs l ON l.request_id = f.request_id
              ORDER BY f.id DESC LIMIT ?`,
            [limit]
        );
        res.json({ ok: true, feedback: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/admin/audit', ...superOnly, async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM rag_audit_logs ORDER BY id DESC LIMIT 100');
        res.json({ ok: true, audit: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

/** 诊断用：检索但不调用 LLM（测试台可分开查看） */
router.post('/admin/retrieve', ...adminOnly, async (req, res) => {
    try {
        const question = (req.body && req.body.question) || '';
        if (!question) return res.status(400).json({ ok: false, error: '缺少 question' });
        const { final, diagnostics } = await retriever.retrieve(question);
        res.json({ ok: true, final, diagnostics, vecReady: vec.isReady() });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
