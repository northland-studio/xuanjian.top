/**
 * Wiki API
 *
 * 公开（游客可读）：首页数据 / 分类树 / 分类页 / 搜索 / 文章 / 相关 / 历史
 * 需要登录：无（Wiki 的写权限直接要求管理员，普通成员只读 —— 见 req.md §7）
 * 需要管理员(level≥1)：新建/编辑/发布/归档/恢复版本/分类增改/草稿箱
 * 需要超级管理员(level≥2)：彻底删除页面、删除分类
 *
 * 说明：路由只做参数校验与响应，业务逻辑全在 lib/wiki.js。
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const logger = require('../lib/logger');
const db = require('../database');
const wiki = require('../lib/wiki');
const glm = require('../lib/glm');
const wikiRender = require('../lib/wiki-render');
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const router = express.Router();

// 自动审核的“审核人”占位 id：0 表示不是人点的通过/驳回
const AUTO_REVIEWER_ID = 0;

// 词条卡片出图的限流与内存缓存（渲染是 CPU 活，别让人刷）
const cardLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '出图太频繁了，请稍后再试' }
});
const cardCache = new Map();
const CARD_CACHE_MAX = 120;

const MAX_CONTENT_LENGTH = 400000;

/** 可选鉴权：带了合法 token 就附上 req.userId（用于「管理员预览草稿」） */
function optionalAuthMiddleware(req, _res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.userId = decoded.userId;
        } catch (e) { /* 游客/过期 token 都按未登录处理 */ }
    }
    next();
}

/** 判断当前请求者是不是管理员（实时查库，不信任 JWT 里的 level） */
async function isAdmin(req) {
    if (!req.userId) return false;
    const row = await db.get('SELECT level FROM users WHERE id = ?', [req.userId]);
    return !!(row && row.level >= 1);
}

function fail(res, e, fallbackMsg = '操作失败') {
    const status = e && e.status ? e.status : 500;
    if (status >= 500) logger.error('Wiki 接口错误:', e.message);
    return res.status(status).json({ error: e.message || fallbackMsg });
}

/** 浏览量去重用的客户端标识：登录用户用 id，否则用 IP */
function clientKey(req) {
    if (req.userId) return `u${req.userId}`;
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    return `ip${ip}`;
}

/** 发布重要文章时的通知（默认不发，管理员在编辑器里勾选） */
async function notifyWikiPublish(page, actorId) {
    try {
        const users = await db.all('SELECT id FROM users WHERE COALESCE(is_frozen, 0) = 0');
        for (const u of users) {
            await createNotification({
                userId: u.id,
                type: 'wiki',
                title: 'Wiki 新内容',
                content: `「${page.title}」已发布到 Wiki${page.category_name ? ` · ${page.category_name}` : ''}`,
                actorId,
                url: `/wiki/${page.slug}`
            });
        }
        logger.info(`Wiki 发布通知已发送 ${users.length} 人：${page.title}`);
        return users.length;
    } catch (e) {
        logger.error('Wiki 发布通知失败:', e.message);
        return 0;
    }
}

/* ==================================================================
 * 静态路径（必须放在 /:slug 之前，否则会被当成 slug 吞掉）
 * ================================================================== */

/** 首页数据：精选 / 最近更新 / 热门 / 最近贡献者 / 分类树 */
router.get('/', optionalAuthMiddleware, async (req, res) => {
    try {
        const data = await wiki.wikiHomeData();
        res.json({ ok: true, ...data });
    } catch (e) {
        fail(res, e, 'Wiki 首页数据加载失败');
    }
});

/** 搜索 */
router.get('/search', optionalAuthMiddleware, async (req, res) => {
    try {
        const q = String(req.query.q || '').slice(0, 100);
        const categorySlug = req.query.category ? String(req.query.category) : '';
        let categoryId = null;
        if (categorySlug) {
            const cat = await wiki.getCategoryBySlug(categorySlug);
            categoryId = cat ? cat.id : -1;
        }
        const result = await wiki.searchWiki(q, {
            categoryId,
            limit: req.query.limit,
            page: req.query.page
        });

        // 搜索结果里的短代码不进列表，统一显示纯文本摘要
        result.pages = result.pages.map(p => ({
            ...p,
            snippet: wiki.htmlToText(p.snippet || '').slice(0, 160)
        }));
        res.json({ ok: true, ...result });
    } catch (e) {
        fail(res, e, 'Wiki 搜索失败');
    }
});

/** 分类树 */
router.get('/categories', optionalAuthMiddleware, async (req, res) => {
    try {
        const includeInactive = String(req.query.all || '') === '1' && await isAdmin(req);
        const tree = await wiki.getCategoryTree({ includeInactive });
        const flat = await wiki.listCategories({ includeInactive });
        res.json({ ok: true, tree, categories: flat });
    } catch (e) {
        fail(res, e, '获取 Wiki 分类失败');
    }
});

/** 编辑器用：标题 → slug 预览（含查重后的实际可用值） */
router.get('/slug-suggest', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const title = String(req.query.title || '');
        const excludeId = req.query.id ? parseInt(req.query.id, 10) : null;
        const slug = await wiki.uniqueSlug(title || 'page', { excludeId });
        res.json({ ok: true, slug, base: wiki.slugify(title || 'page') });
    } catch (e) {
        fail(res, e, '生成 slug 失败');
    }
});

/** 管理端统计 */
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        res.json({ ok: true, stats: await wiki.wikiStats() });
    } catch (e) {
        fail(res, e, '获取 Wiki 统计失败');
    }
});

/** 管理端页面列表（含草稿/归档，支持筛选） */
router.get('/admin/pages', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await wiki.listPages({
            status: req.query.status || 'all',
            categoryId: req.query.category_id || null,
            authorId: req.query.author_id || null,
            q: String(req.query.q || '').slice(0, 100),
            page: req.query.page,
            limit: req.query.limit || 20,
            sort: req.query.sort || 'updated'
        });
        res.json({ ok: true, ...result });
    } catch (e) {
        fail(res, e, '获取 Wiki 页面列表失败');
    }
});

/** 管理端：最近的全站版本记录 */
router.get('/admin/revisions', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        res.json({ ok: true, revisions: await wiki.listRecentRevisions(req.query.limit || 50) });
    } catch (e) {
        fail(res, e, '获取版本记录失败');
    }
});

/** 按 id 取页面（编辑器用）：登录即可读已发布页；草稿/归档仍然只有管理员能看 */
router.get('/id/:id', authMiddleware, async (req, res) => {
    try {
        const page = await wiki.getPageById(req.params.id);
        if (!page) return res.status(404).json({ error: '页面不存在' });
        const isAdminUser = Number(req.userLevel) >= 1;
        if (page.status !== 'published' && !isAdminUser) {
            return res.status(404).json({ error: '页面不存在' });
        }
        const breadcrumb = await wiki.categoryBreadcrumb(page.category_id);
        res.json({ ok: true, page, breadcrumb });
    } catch (e) {
        fail(res, e, '获取页面失败');
    }
});

/** 分类详情（分类页） */
router.get('/categories/:slug', optionalAuthMiddleware, async (req, res) => {
    try {
        const cat = await wiki.getCategoryBySlug(String(req.params.slug));
        if (!cat || (!cat.is_active && !(await isAdmin(req)))) {
            return res.status(404).json({ error: '分类不存在' });
        }
        const children = (await wiki.getCategoryTree({ includeInactive: await isAdmin(req) }))
            .flatMap(function walk(n) { return [n, ...(n.children || []).flatMap(walk)]; })
            .filter(n => n.parent_id === cat.id)
            .map(n => ({ id: n.id, name: n.name, slug: n.slug, page_count: n.page_count }));

        const breadcrumb = await wiki.categoryBreadcrumb(cat.id);
        const pages = await wiki.listPages({
            categoryId: cat.id,
            includeChildCategories: true,
            status: 'published',
            page: req.query.page,
            limit: req.query.limit || 20,
            q: String(req.query.q || '').slice(0, 100),
            sort: req.query.sort || 'updated'
        });
        res.json({ ok: true, category: cat, children, breadcrumb, ...pages });
    } catch (e) {
        fail(res, e, '获取分类失败');
    }
});

/* ==================================================================
 * 写操作
 * ================================================================== */

function validatePayload(body, { requireContent = true } = {}) {
    if (!body || typeof body !== 'object') throw Object.assign(new Error('请求体不合法'), { status: 400 });
    if (body.title !== undefined && String(body.title).length > 200) {
        throw Object.assign(new Error('标题过长（上限 200 字）'), { status: 400 });
    }
    if (body.summary !== undefined && String(body.summary).length > 500) {
        throw Object.assign(new Error('摘要过长（上限 500 字）'), { status: 400 });
    }
    if (requireContent && body.content !== undefined && String(body.content).length > MAX_CONTENT_LENGTH) {
        throw Object.assign(new Error('正文过长（上限 40 万字符）'), { status: 400 });
    }
    if (body.slug !== undefined && body.slug !== null && !/^[a-z0-9-]{0,80}$/.test(String(body.slug).toLowerCase())) {
        throw Object.assign(new Error('slug 只能包含小写字母、数字与短横线'), { status: 400 });
    }
}

/** 新建页面：管理员直接发布；普通用户走审核通道（线上内容不动） */
router.post('/', authMiddleware, async (req, res) => {
    try {
        validatePayload(req.body);
        const body = req.body || {};
        if (req.userLevel >= 1) {
            const page = await wiki.createPage({ ...body, status: body.status || 'published' }, req.userId);
            if (page.status === 'published' && body.notify) await notifyWikiPublish(page, req.userId);
            return res.status(201).json({ ok: true, message: '页面已创建', page });
        }
        const out = await submitForReview({
            kind: 'new', body, userId: req.userId,
            categoryId: body.category_id ? Number(body.category_id) : null
        });
        await notifyAdminsOfSubmission(out.submission);
        res.status(202).json({
            ok: true,
            pending: true,
            decision: out.decision,
            auto: summarizeAuto(out.auto),
            message: out.decision === 'auto_approved' ? '提交已通过自动审核并发布'
                : out.decision === 'auto_rejected' ? '提交未通过自动审核，已通知你' : '提交成功，等待管理员审核',
            submission: publicSubmission(out.submission)
        });
    } catch (e) {
        fail(res, e, '创建页面失败');
    }
});

/** 编辑器预览：只渲染（内链 + 短代码 + 消毒），不落库——普通用户编辑时也要能预览 */
router.post('/preview', authMiddleware, async (req, res) => {
    try {
        const raw = String(req.body?.content || '');
        if (raw.length > MAX_CONTENT_LENGTH) return res.status(400).json({ error: '正文过长' });
        const { html, targetIds, missing } = await wiki.resolveWikiLinks(raw);
        const clean = wiki.sanitizeContent(html);
        const rendered = await wiki.renderContent(clean);
        res.json({
            ok: true,
            html: rendered,
            links: targetIds.length,
            missing: [...new Set(missing)]
        });
    } catch (e) {
        fail(res, e, '预览失败');
    }
});

/** 新建分类 */
router.post('/categories', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const cat = await wiki.createCategory(req.body || {}, req.userId);
        res.status(201).json({ ok: true, message: '分类已创建', category: cat });
    } catch (e) {
        fail(res, e, '创建分类失败');
    }
});

/** 更新分类 */
router.put('/categories/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const cat = await wiki.updateCategory(req.params.id, req.body || {});
        res.json({ ok: true, message: '分类已更新', category: cat });
    } catch (e) {
        fail(res, e, '更新分类失败');
    }
});

/** 删除分类（超管） */
router.delete('/categories/:id', authMiddleware, superAdminMiddleware, async (req, res) => {
    try {
        await wiki.deleteCategory(req.params.id);
        res.json({ ok: true, message: '分类已删除' });
    } catch (e) {
        fail(res, e, '删除分类失败');
    }
});

/** 读取自动审核配置（apiKey 只回显是否已配置 + 末 4 位） */
router.get('/review-config', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        res.json({ ok: true, config: glm.publicConfig(await glm.getConfig()) });
    } catch (e) {
        fail(res, e, '获取审核配置失败');
    }
});

/** 保存自动审核配置（apiKey 传空字符串 = 不改动；传 null = 清空） */
router.put('/review-config', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const b = req.body || {};
        const patch = {};
        for (const k of ['enabled', 'autoApprove', 'autoReject', 'rewardEnabled', 'rewardShadow']) if (b[k] !== undefined) patch[k] = !!b[k];
        for (const k of ['approveThreshold', 'rejectThreshold', 'maxPerDay', 'maxContentLength', 'rewardMax', 'rewardDailyMax']) if (b[k] !== undefined) patch[k] = Number(b[k]);
        for (const k of ['model', 'baseUrl']) if (b[k] !== undefined) patch[k] = String(b[k]).trim();
        if (b.apiKey !== undefined) patch.apiKey = b.apiKey === null ? null : String(b.apiKey).trim();
        const cfg = await glm.saveConfig(patch);
        logger.info(`Wiki 审核配置已更新（操作者 ${req.userId}）：enabled=${cfg.enabled} autoApprove=${cfg.autoApprove} model=${cfg.model} key=${cfg.apiKey ? '已配置' : '空'}`);
        res.json({ ok: true, message: '配置已保存', config: glm.publicConfig(cfg) });
    } catch (e) {
        fail(res, e, '保存审核配置失败');
    }
});

/** 测试 GLM 连通性 */
router.post('/review-config/test', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const r = await glm.testConnection();
        res.json({ ok: r.ok, result: r });
    } catch (e) {
        fail(res, e, '测试失败');
    }
});

/** 更新页面：管理员直接保存；普通用户提交待审修改 */
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        validatePayload(req.body, { requireContent: false });
        const id = parseInt(req.params.id, 10);
        const body = req.body || {};
        const page = await wiki.getPageById(id);
        if (!page) return res.status(404).json({ error: '页面不存在' });

        if (req.userLevel >= 1) {
            const saved = await wiki.updatePage(id, body, req.userId, body.revision_note);
            return res.json({ ok: true, message: '页面已保存', page: saved });
        }

        // 普通用户：正文缺省时用当前线上内容兜底（允许只改标题/摘要/分类）
        const out = await submitForReview({
            kind: 'edit', pageId: id, pageTitle: page.title,
            categoryId: body.category_id !== undefined ? Number(body.category_id) : page.category_id,
            body: {
                title: body.title !== undefined ? body.title : page.title,
                summary: body.summary !== undefined ? body.summary : page.summary,
                content: body.content !== undefined ? body.content : page.content
            },
            userId: req.userId
        });
        await notifyAdminsOfSubmission(out.submission);
        res.status(202).json({
            ok: true,
            pending: true,
            decision: out.decision,
            auto: summarizeAuto(out.auto),
            message: out.decision === 'auto_approved' ? '修改已通过自动审核并生效'
                : out.decision === 'auto_rejected' ? '修改未通过自动审核，已通知你' : '修改已提交，等待管理员审核',
            submission: publicSubmission(out.submission)
        });
    } catch (e) {
        fail(res, e, '保存页面失败');
    }
});

/** 删除页面（超管：彻底删除，连带版本与内链） */
router.delete('/:id', authMiddleware, superAdminMiddleware, async (req, res) => {
    try {
        const page = await wiki.getPageById(req.params.id);
        if (!page) return res.status(404).json({ error: '页面不存在' });
        await wiki.deletePage(req.params.id);
        logger.info(`Wiki 页面已删除：#${page.id} ${page.title}（操作者 ${req.userId}）`);
        res.json({ ok: true, message: '页面已彻底删除' });
    } catch (e) {
        fail(res, e, '删除页面失败');
    }
});

/** 发布 */
router.post('/:id/publish', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const page = await wiki.setPageStatus(req.params.id, 'published', req.userId);
        const notified = req.body?.notify ? await notifyWikiPublish(page, req.userId) : 0;
        res.json({ ok: true, message: '页面已发布', page, notified });
    } catch (e) {
        fail(res, e, '发布失败');
    }
});

/** 归档 */
router.post('/:id/archive', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const page = await wiki.setPageStatus(req.params.id, 'archived', req.userId);
        res.json({ ok: true, message: '页面已归档', page });
    } catch (e) {
        fail(res, e, '归档失败');
    }
});

/** 从归档恢复（回到草稿，管理员再决定是否发布） */
router.post('/:id/restore', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const target = req.body?.status === 'published' ? 'published' : 'draft';
        const page = await wiki.setPageStatus(req.params.id, target, req.userId);
        res.json({ ok: true, message: target === 'published' ? '页面已恢复并发布' : '页面已恢复到草稿', page });
    } catch (e) {
        fail(res, e, '恢复失败');
    }
});

/** 恢复某个历史版本（会生成一条新 revision，不覆盖历史） */
router.post('/:id/revisions/:revisionId/restore', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const page = await wiki.restoreRevision(req.params.id, req.params.revisionId, req.userId);
        logger.info(`Wiki 恢复历史版本：页面 #${req.params.id} ← 版本 #${req.params.revisionId}（操作者 ${req.userId}）`);
        res.json({ ok: true, message: '已恢复到该版本（历史版本仍保留）', page });
    } catch (e) {
        fail(res, e, '恢复历史版本失败');
    }
});

/* ==================================================================
 * 开放编辑：提交 / 审核 / 自动审核配置
 * ================================================================== */

/** 送进模型的内容只做审核，不下发原始 JSON */
function summarizeAuto(auto) {
    if (!auto) return null;
    return {
        ok: !!auto.ok,
        skipped: auto.skipped || null,
        error: auto.error || null,
        decision: auto.decision,
        score: auto.score,
        categories: auto.categories || [],
        reasons: auto.reasons || [],
        // 贡献点建议必须一起转发：漏掉这个字段会让审核台一直显示"未评估"（曾踩过这个坑）
        reward: auto.reward || null,
        model: auto.model,
        ms: auto.ms
    };
}

/** 给提交者看的提交单（不含正文，避免把待审内容当已发布内容下发） */
function publicSubmission(sub) {
    if (!sub) return null;
    return {
        id: sub.id, kind: sub.kind, title: sub.title, status: sub.status,
        page_id: sub.page_id, page_slug: sub.page_slug || null,
        review_note: sub.review_note || '', created_at: sub.created_at, reviewed_at: sub.reviewed_at,
        auto: sub.auto_review ? summarizeAuto(safeJson(sub.auto_review)) : null
    };
}

function safeJson(s) {
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; }
}

/** 每人每日提交上限 */
async function assertSubmitAllowed(userId) {
    const cfg = await glm.getConfig();
    const max = Number(cfg.maxPerDay) || 0;
    if (max > 0) {
        const n = await wiki.countSubmissionsToday(userId);
        if (n >= max) {
            throw Object.assign(new Error(`今天已提交 ${n} 篇，达到每日上限（${max} 篇），请明天再来或联系管理员`), { status: 429 });
        }
    }
    return cfg;
}

/**
 * 建提交 + 触发自动审核 + 按配置决定自动通过/驳回。
 * 自动审核任何异常都只是"转人工"，绝不放行。
 */
async function submitForReview({ kind, pageId = null, categoryId = null, body, userId, pageTitle = '' }) {
    const cfg = await assertSubmitAllowed(userId);
    const sub = await wiki.createSubmission({
        pageId, kind, submitterId: userId, categoryId,
        title: body.title, content: body.content, summary: body.summary
    });

    let auto = null;
    try {
        auto = await glm.reviewContent({
            title: sub.title, summary: sub.summary, content: sub.content, kind, pageTitle: pageTitle || sub.page_title || ''
        });
        await wiki.attachAutoReview(sub.id, auto);
    } catch (e) {
        logger.error('自动审核异常（已转人工）:', e.message);
    }

    let decision = 'pending';
    if (auto && auto.ok) {
        if (cfg.autoApprove && auto.decision === 'approve' && auto.score >= cfg.approveThreshold) {
            await wiki.approveSubmission(sub.id, AUTO_REVIEWER_ID, `GLM 自动通过（${auto.model} · 置信度 ${auto.score}）`);
            decision = 'auto_approved';
        } else if (cfg.autoReject && auto.decision === 'reject' && auto.score >= cfg.rejectThreshold) {
            const why = (auto.reasons || []).join('；') || `命中类别 ${(auto.categories || []).join('、')}`;
            await wiki.rejectSubmission(sub.id, AUTO_REVIEWER_ID, `GLM 自动驳回：${why}`);
            decision = 'auto_rejected';
        }
    }
    return { submission: await wiki.getSubmissionById(sub.id), decision, auto };
}

/** 通知所有管理员有待审投稿 */
async function notifyAdminsOfSubmission(sub) {
    try {
        const admins = await db.all('SELECT id FROM users WHERE level >= 1');
        const who = sub.submitter_nickname || sub.submitter_username || `用户#${sub.submitter_id}`;
        for (const a of admins) {
            if (Number(a.id) === Number(sub.submitter_id)) continue;
            await createNotification({
                userId: a.id,
                type: 'wiki',
                title: sub.kind === 'new' ? 'Wiki 待审核新页面' : 'Wiki 待审核修改',
                content: `「${sub.title}」由 ${who} 提交，等待审核`,
                url: '/admin#wiki/review'
            });
        }
    } catch (e) {
        logger.error('通知管理员失败:', e.message);
    }
}

/** 通知提交人审核结果（带贡献点回赠） */
async function notifySubmitterReviewed(sub, approved, auto = false, points = 0) {
    try {
        const rewardText = points > 0 ? `，并回赠 ${points} 贡献点` : '';
        await createNotification({
            userId: sub.submitter_id,
            type: 'wiki',
            title: approved ? '你的 Wiki 投稿已通过' : '你的 Wiki 投稿未通过',
            content: approved
                ? `「${sub.title}」${auto ? '已通过自动审核并发布' : '已通过审核并发布'}${rewardText}`
                : `「${sub.title}」未通过：${sub.review_note || '未说明原因'}${auto ? '（自动审核）' : ''}`,
            url: sub.page_slug ? `/wiki/${sub.page_slug}` : '/wiki'
        });
    } catch (e) {
        logger.error('通知提交人失败:', e.message);
    }
}

/**
 * 贡献点回赠统一入口（人工通过时 / 事后补发）。
 * 只在管理员点了"通过"或"补发"时调用——自动通过不直接发分（AI 只给建议）。
 */
async function grantReward(sub, { reviewerId, points, note = '' }) {
    const cfg = await glm.getConfig();
    if (!cfg.rewardEnabled) return { skipped: '贡献点回赠已关闭' };
    const auto = safeJson(sub.auto_review) || {};
    const aiPoints = auto && auto.reward ? auto.reward.points : null;
    const aiReason = auto && auto.reward ? auto.reward.reason : '';
    return wiki.awardSubmissionPoints({
        submissionId: sub.id,
        userId: sub.submitter_id,
        pageId: sub.page_id,
        points,
        aiPoints,
        aiReason,
        reviewerId,
        note,
        maxPoints: cfg.rewardMax,
        dailyMax: cfg.rewardDailyMax
    });
}

/** 我的提交记录 */
router.get('/submissions/mine', authMiddleware, async (req, res) => {
    try {
        const out = await wiki.listSubmissions({
            status: req.query.status || 'all',
            limit: req.query.limit || 20,
            page: req.query.page || 1,
            submitterId: req.userId
        });
        res.json({ ok: true, total: out.total, items: out.items.map(publicSubmission) });
    } catch (e) {
        fail(res, e, '获取提交记录失败');
    }
});

/** 待审数量（后台红点 / 导航提示） */
router.get('/submissions/pending-count', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        res.json({ ok: true, count: await wiki.pendingSubmissionCount() });
    } catch (e) {
        fail(res, e, '获取待审数量失败');
    }
});

/** 待审队列 */
router.get('/submissions', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const out = await wiki.listSubmissions({
            status: req.query.status || 'pending',
            limit: req.query.limit || 20,
            page: req.query.page || 1
        });
        res.json({
            ok: true, total: out.total, page: out.page, limit: out.limit,
            items: out.items.map((s) => ({ ...s, auto: s.auto_review ? summarizeAuto(safeJson(s.auto_review)) : null }))
        });
    } catch (e) {
        fail(res, e, '获取待审列表失败');
    }
});

/** 提交单详情（含待审正文与"当前线上正文"，供对比；附作者回赠情况给管理员参考） */
router.get('/submissions/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const sub = await wiki.getSubmissionById(req.params.id);
        if (!sub) return res.status(404).json({ error: '提交不存在' });
        const page = sub.page_id ? await wiki.getPageById(sub.page_id) : null;
        const [author_stats, reward] = await Promise.all([
            wiki.getAuthorRewardStats(sub.submitter_id).catch(() => null),
            wiki.getRewardBySubmission(sub.id).catch(() => null)
        ]);
        res.json({
            ok: true,
            submission: { ...sub, auto: sub.auto_review ? summarizeAuto(safeJson(sub.auto_review)) : null },
            current: page ? { title: page.title, content: page.content, summary: page.summary, category_id: page.category_id, slug: page.slug } : null,
            author_stats,
            reward
        });
    } catch (e) {
        fail(res, e, '获取提交详情失败');
    }
});

/** 通过（可同时发放贡献点回赠；AI 建议只作参考，最终值由管理员定） */
router.post('/submissions/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const out = await wiki.approveSubmission(req.params.id, req.userId, req.body?.note || '');
        let reward = null;
        const points = Number(req.body?.points);
        if (Number.isFinite(points) && points > 0) {
            reward = await grantReward(out.submission, { reviewerId: req.userId, points });
        }
        await notifySubmitterReviewed(out.submission, true, false, reward?.awarded || 0);
        logger.info(`Wiki 投稿通过：#${out.submission.id}「${out.submission.title}」（审核人 ${req.userId}）回赠 ${reward?.awarded || 0} 点`);
        res.json({
            ok: true,
            message: reward && reward.awarded > 0 ? `已通过并发布，回赠 ${reward.awarded} 贡献点` : '已通过并发布',
            page: out.page, submission: publicSubmission(out.submission), reward
        });
    } catch (e) {
        fail(res, e, '审核通过失败');
    }
});

/** 补发贡献点（自动通过的投稿事后由管理员补分；幂等，已发过会返回 already） */
router.post('/submissions/:id/reward', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const sub = await wiki.getSubmissionById(req.params.id);
        if (!sub) return res.status(404).json({ error: '提交不存在' });
        if (sub.status !== 'approved') return res.status(400).json({ error: '只有已通过的投稿才能补发奖励' });
        const points = Number(req.body?.points);
        if (!Number.isFinite(points) || points <= 0) return res.status(400).json({ error: '请填写要补发的贡献点' });
        const reward = await grantReward(sub, { reviewerId: req.userId, points, note: '事后补发' });
        if (reward && reward.already) return res.json({ ok: true, message: '该投稿已经发过奖励，未重复发放', reward });
        await notifySubmitterReviewed(sub, true, false, reward?.awarded || 0);
        logger.info(`Wiki 投稿补发奖励：#${sub.id}「${sub.title}」→ ${reward?.awarded || 0} 点（操作者 ${req.userId}）`);
        res.json({ ok: true, message: `已补发 ${reward?.awarded || 0} 贡献点`, reward });
    } catch (e) {
        fail(res, e, '补发奖励失败');
    }
});

/** 驳回 */
router.post('/submissions/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const sub = await wiki.rejectSubmission(req.params.id, req.userId, req.body?.note || '');
        await notifySubmitterReviewed(sub, false, false);
        logger.info(`Wiki 投稿驳回：#${sub.id}「${sub.title}」（审核人 ${req.userId}）理由：${sub.review_note}`);
        res.json({ ok: true, message: '已驳回并通知提交人', submission: publicSubmission(sub) });
    } catch (e) {
        fail(res, e, '驳回失败');
    }
});

/* ==================================================================
 * 词条卡片（群聊出图，给 QQ 机器人用）
 * ================================================================== */

/**
 * GET /api/wiki/card/:slug.png
 * 公开只读（内容本就是已发布的公开词条，QQ 取图不带请求头，与 #help 卡片一致）。
 * 只出已发布页；按 slug+updated_at 内存缓存；1 分钟 60 次限流。
 */
router.get('/card/:slug.png', cardLimiter, async (req, res) => {
    try {
        const slug = String(req.params.slug || '').trim();
        const page = await wiki.getPageBySlug(slug);   // 默认不含未发布
        if (!page || page.status !== 'published') return res.status(404).json({ error: '词条不存在' });
        const key = `${page.slug}:${page.updated_at}`;
        let buf = cardCache.get(key);
        if (!buf) {
            buf = await wikiRender.renderWikiCard(page);
            cardCache.set(key, buf);
            if (cardCache.size > CARD_CACHE_MAX) cardCache.delete(cardCache.keys().next().value);
        }
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('X-Content-Type-Options', 'nosniff');
        res.send(buf);
    } catch (e) {
        fail(res, e, '生成词条卡片失败');
    }
});

/* ==================================================================
 * 页面评论
 * ================================================================== */

/** 评论列表（公开） */
router.get('/pages/:id/comments', optionalAuthMiddleware, async (req, res) => {
    try {
        const out = await wiki.listComments(req.params.id, { limit: req.query.limit || 50, page: req.query.page || 1 });
        res.json({ ok: true, total: out.total, page: out.page, limit: out.limit, items: out.items });
    } catch (e) {
        fail(res, e, '获取评论失败');
    }
});

/** 发表评论（登录即可；简单频率限制：1 分钟 5 条） */
router.post('/pages/:id/comments', authMiddleware, async (req, res) => {
    try {
        const recent = await db.get(
            `SELECT COUNT(*) AS c FROM wiki_comments
              WHERE user_id = ? AND created_at > DATETIME('now', 'localtime', '-1 minute')`,
            [req.userId]
        );
        if (recent.c >= 5) return res.status(429).json({ error: '评论太快了，请稍后再试' });

        const { comment, page } = await wiki.addComment({
            pageId: req.params.id, userId: req.userId, content: req.body?.content
        });
        if (page.author_id && Number(page.author_id) !== Number(req.userId)) {
            await createNotification({
                userId: page.author_id,
                type: 'wiki',
                title: '你的 Wiki 页面有新评论',
                content: `「${page.title}」：${String(comment.content).slice(0, 60)}`,
                actorId: req.userId,
                url: `/wiki/${page.slug}#comments`
            });
        }
        res.status(201).json({ ok: true, message: '评论已发布', comment });
    } catch (e) {
        fail(res, e, '发表评论失败');
    }
});

/** 删除自己的评论（管理员可删任何评论） */
router.delete('/comments/:id', authMiddleware, async (req, res) => {
    try {
        const c = await wiki.getCommentById(req.params.id);
        if (!c) return res.status(404).json({ error: '评论不存在' });
        const isOwner = Number(c.user_id) === Number(req.userId);
        if (!isOwner && req.userLevel < 1) return res.status(403).json({ error: '只能删除自己的评论' });
        await wiki.setCommentStatus(c.id, 'hidden');
        res.json({ ok: true, message: '评论已删除' });
    } catch (e) {
        fail(res, e, '删除评论失败');
    }
});

/* ==================================================================
 * 动态 slug 路径（放最后）
 * ================================================================== */

/** 文章相关（内链 + 同分类） */
router.get('/:slug/related', optionalAuthMiddleware, async (req, res) => {
    try {
        const page = await wiki.getPageBySlug(String(req.params.slug), { includeUnpublished: await isAdmin(req) });
        if (!page) return res.status(404).json({ error: '页面不存在' });
        res.json({ ok: true, related: await wiki.relatedPages(page.id, 10) });
    } catch (e) {
        fail(res, e, '获取相关文章失败');
    }
});

/** 版本历史 */
router.get('/:slug/history', optionalAuthMiddleware, async (req, res) => {
    try {
        const page = await wiki.getPageBySlug(String(req.params.slug), { includeUnpublished: await isAdmin(req) });
        if (!page) return res.status(404).json({ error: '页面不存在' });
        res.json({ ok: true, page: { id: page.id, title: page.title, slug: page.slug }, revisions: await wiki.listRevisions(page.id, 100) });
    } catch (e) {
        fail(res, e, '获取版本历史失败');
    }
});

/** 单个历史版本 */
router.get('/:slug/history/:revisionId', optionalAuthMiddleware, async (req, res) => {
    try {
        const page = await wiki.getPageBySlug(String(req.params.slug), { includeUnpublished: await isAdmin(req) });
        if (!page) return res.status(404).json({ error: '页面不存在' });
        const rev = await wiki.getRevision(page.id, req.params.revisionId);
        if (!rev) return res.status(404).json({ error: '历史版本不存在' });
        res.json({ ok: true, revision: rev });
    } catch (e) {
        fail(res, e, '获取历史版本失败');
    }
});

/** 文章详情 */
router.get('/:slug', optionalAuthMiddleware, async (req, res) => {
    try {
        const admin = await isAdmin(req);
        const wantPreview = String(req.query.preview || '') === '1';
        const page = await wiki.getPageBySlug(String(req.params.slug), { includeUnpublished: admin || wantPreview });
        if (!page) return res.status(404).json({ error: '页面不存在' });
        // 未发布的页面只有管理员能看；游客拿着 ?preview=1 也不行
        if (page.status !== 'published' && !admin) {
            return res.status(404).json({ error: '页面不存在' });
        }

        if (page.status === 'published' && !admin) wiki.bumpViews(page.id, clientKey(req));

        const [content_html, breadcrumb, related, neighbors, comment_count] = await Promise.all([
            wiki.renderContent(page.content),
            wiki.categoryBreadcrumb(page.category_id),
            wiki.relatedPages(page.id, 8),
            wiki.getNeighbors(page),
            wiki.commentCount(page.id)
        ]);

        // 待审信息：管理员看到"这一页有待审修改"，提交者看到"我的投稿在排队"
        const pending_review = admin ? await wiki.pendingSubmissionForPage(page.id) : null;
        const my_pending = req.userId
            ? await wiki.myPendingSubmission({ pageId: page.id, submitterId: req.userId }).catch(() => null)
            : null;

        res.json({
            ok: true,
            page: { ...page, content_html },
            content_html,
            breadcrumb,
            related,
            neighbors,
            comment_count,
            can_edit: !!req.userId,
            can_review: admin,
            is_admin: admin,
            pending_review,
            my_pending
        });
    } catch (e) {
        fail(res, e, '获取页面失败');
    }
});

module.exports = router;
