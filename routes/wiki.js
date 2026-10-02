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
const logger = require('../lib/logger');
const db = require('../database');
const wiki = require('../lib/wiki');
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const router = express.Router();

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

/** 按 id 取页面（编辑器用） */
router.get('/id/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const page = await wiki.getPageById(req.params.id);
        if (!page) return res.status(404).json({ error: '页面不存在' });
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

/** 新建页面 */
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        validatePayload(req.body);
        const page = await wiki.createPage(req.body || {}, req.userId);
        if (page.status === 'published' && req.body?.notify) await notifyWikiPublish(page, req.userId);
        res.status(201).json({ ok: true, message: '页面已创建', page });
    } catch (e) {
        fail(res, e, '创建页面失败');
    }
});

/** 编辑器预览：只渲染（内链 + 短代码 + 消毒），不落库 */
router.post('/preview', authMiddleware, adminMiddleware, async (req, res) => {
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

/** 更新页面 */
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        validatePayload(req.body, { requireContent: false });
        const id = parseInt(req.params.id, 10);
        const page = await wiki.updatePage(id, req.body || {}, req.userId, req.body?.revision_note);
        res.json({ ok: true, message: '页面已保存', page });
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

        const [content_html, breadcrumb, related, neighbors] = await Promise.all([
            wiki.renderContent(page.content),
            wiki.categoryBreadcrumb(page.category_id),
            wiki.relatedPages(page.id, 8),
            wiki.getNeighbors(page)
        ]);

        res.json({
            ok: true,
            page: { ...page, content_html },
            content_html,
            breadcrumb,
            related,
            neighbors,
            can_edit: admin
        });
    } catch (e) {
        fail(res, e, '获取页面失败');
    }
});

module.exports = router;
