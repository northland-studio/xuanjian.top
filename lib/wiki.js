/**
 * Wiki 服务层
 *
 * 职责（路由只做参数校验与响应，业务都放这里）：
 *  - 分类树：无限级、排序、路径/面包屑
 *  - 页面：slug 生成（中文转拼音）、增删改查、状态流转（draft/published/archived）
 *  - 版本：每次正式保存都留 revision；恢复历史 = 生成一条「恢复」revision 再应用，不覆盖历史
 *  - 内链：解析 [[页面名]] 与已渲染的 /wiki/<slug> 链接，维护 wiki_page_links
 *  - 短代码：{{member:123}} / {{generation:第五期}} 在「读取时」渲染成卡片（保证成员信息是最新的）
 *  - 搜索：FTS5（trigram，适配中文）+ LIKE 兜底
 *  - 浏览计数：进程内 30 分钟去重，避免刷新刷量
 *  - 内容消毒：sanitize-html 白名单（XSS / HTML 注入）
 */
const path = require('path');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { pinyin } = require('pinyin-pro');
const sanitizeHtml = require('sanitize-html');
const logger = require('./logger');

const STATUSES = ['draft', 'published', 'archived'];
const VIEW_DEDUP_MS = 30 * 60 * 1000;

/* ==================== 工具 ==================== */

function now() {
    return getLocalTimestamp();
}

function toInt(v, fallback = null) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
}

function clampText(v, max) {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return s.length > max ? s.slice(0, max) : s;
}

/** 标题 → slug：中文走拼音，英文走短横线；结果只含 [a-z0-9-] */
function slugify(title) {
    const raw = String(title || '').trim();
    if (!raw) return 'page';
    let base = '';
    if (/[\u4e00-\u9fa5]/.test(raw)) {
        try {
            base = pinyin(raw, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('-');
        } catch (e) {
            base = '';
        }
    } else {
        base = raw;
    }
    base = base
        .toLowerCase()
        .replace(/['"’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
    if (!base) base = 'page';
    return base.slice(0, 80).replace(/-+$/g, '') || 'page';
}

function isFtsReady() {
    return ftsReady;
}
let ftsReady = true;   // 迁移失败时置 false，搜索自动退回 LIKE

/** 生成唯一 slug（同名自动加 -2/-3…） */
async function uniqueSlug(title, { excludeId = null, table = 'wiki_pages' } = {}) {
    const base = slugify(title);
    let candidate = base;
    let i = 1;
    // 最多试 200 次，之后用时间戳兜底，保证不无限循环
    while (i < 200) {
        const row = await db.get(
            `SELECT id FROM ${table} WHERE slug = ?${excludeId ? ' AND id != ?' : ''}`,
            excludeId ? [candidate, excludeId] : [candidate]
        );
        if (!row) return candidate;
        i += 1;
        candidate = `${base}-${i}`;
    }
    return `${base}-${Date.now().toString(36)}`;
}

/** 纯文本（供全文索引/摘要/片段用） */
function htmlToText(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 自动摘要：没有手填 summary 时取正文前 N 字 */
function autoSummary(html, max = 120) {
    const text = htmlToText(html);
    return text.length > max ? text.slice(0, max) + '…' : text;
}

/* ==================== 内容消毒 ==================== */

const ALLOWED_TAGS = [
    'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'sub', 'sup', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li',
    'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'span', 'div', 'input'
];

const ALLOWED_ATTRS = {
    a: ['href', 'title', 'target', 'rel', 'class', 'data-wiki', 'data-wiki-missing'],
    img: ['src', 'alt', 'title', 'width', 'height', 'class', 'loading'],
    span: ['class', 'data-type', 'data-member', 'data-generation'],
    div: ['class', 'data-type', 'data-callout'],
    input: ['type', 'checked', 'disabled'],
    th: ['colspan', 'rowspan', 'style'],
    td: ['colspan', 'rowspan', 'style'],
    code: ['class'],
    pre: ['class'],
    '*': ['class']
};

/** 白名单消毒：去脚本/事件属性/危险协议 */
function sanitizeContent(html) {
    return sanitizeHtml(String(html || ''), {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: ALLOWED_ATTRS,
        allowedSchemes: ['http', 'https', 'mailto'],
        allowedSchemesByTag: { img: ['http', 'https', 'data'] },
        allowProtocolRelative: false,
        disallowedTagsMode: 'discard',
        transformTags: {
            a: (tagName, attribs) => {
                const href = attribs.href || '';
                const isInternal = href.startsWith('/wiki/') || href.startsWith('/');
                return {
                    tagName: 'a',
                    attribs: {
                        ...attribs,
                        ...(isInternal ? {} : { target: '_blank', rel: 'noopener noreferrer' })
                    }
                };
            }
        },
        // 只保留 style 里的少量安全属性（表格对齐）
        allowedStyles: {
            '*': {
                'text-align': [/^left$|^right$|^center$/],
                'width': [/^\d{1,3}(px|%)$/]
            }
        }
    });
}

/* ==================== 内链与短代码 ==================== */

const WIKI_LINK_RE = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;
const MEMBER_RE = /\{\{\s*member\s*:\s*([^}]+?)\s*\}\}/g;
const GENERATION_RE = /\{\{\s*generation\s*:\s*([^}]+?)\s*\}\}/g;

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 解析内容里的 Wiki 链接：
 *  - 已渲染成 /wiki/<slug> 的 <a> 直接收集
 *  - 原始 [[页面名]] / [[页面名|显示文本]] 转成 <a>，目标不存在时标成「待创建」（红链）
 * 返回 { html, targetIds, missing }
 */
async function resolveWikiLinks(html) {
    let out = String(html || '');
    const targetIds = new Set();
    const missing = [];

    // 1) 已有锚点：href="/wiki/<slug>"
    const hrefRe = /href="\/wiki\/([a-z0-9-]+)"/g;
    let m;
    while ((m = hrefRe.exec(out))) {
        const row = await db.get('SELECT id FROM wiki_pages WHERE slug = ?', [m[1]]);
        if (row) targetIds.add(row.id);
    }

    // 2) 原始 [[...]] 语法
    const raws = [...out.matchAll(WIKI_LINK_RE)];
    for (const hit of raws) {
        const title = String(hit[1]).trim();
        const label = (hit[2] || title).trim();
        if (!title) continue;
        const page = await db.get(
            'SELECT id, slug, title, status FROM wiki_pages WHERE title = ? OR slug = ? ORDER BY (status = \'published\') DESC LIMIT 1',
            [title, slugify(title)]
        );
        if (page && page.status !== 'archived') {
            targetIds.add(page.id);
            out = out.replace(hit[0],
                `<a href="/wiki/${page.slug}" class="wiki-link" data-wiki="${page.slug}">${escapeHtml(label)}</a>`);
        } else {
            missing.push(title);
            out = out.replace(hit[0],
                `<a href="/wiki/editor?title=${encodeURIComponent(title)}" class="wiki-link wiki-link-missing" data-wiki-missing="1">${escapeHtml(label)}</a>`);
        }
    }

    return { html: out, targetIds: [...targetIds], missing };
}

/** 把 {{member:...}} / {{generation:...}} 渲染成卡片（读取时渲染，成员信息始终最新） */
async function renderShortcodes(html) {
    let out = String(html || '');
    const { resolveGeneration } = require('./generation');

    const memberHits = [...out.matchAll(MEMBER_RE)];
    for (const hit of memberHits) {
        const key = String(hit[1]).trim();
        const user = /^\d+$/.test(key)
            ? await db.get('SELECT id, username, nickname, avatar, game_id, contribution, created_at, generation FROM users WHERE id = ?', [toInt(key)])
            : await db.get('SELECT id, username, nickname, avatar, game_id, contribution, created_at, generation FROM users WHERE username = ?', [key]);
        if (!user) {
            out = out.replace(hit[0], `<span class="wiki-member-card wiki-member-missing">成员「${escapeHtml(key)}」不存在</span>`);
            continue;
        }
        const gen = await resolveGeneration(user).catch(() => null);
        const name = escapeHtml(user.nickname || user.username);
        out = out.replace(hit[0],
            `<a class="wiki-member-card" data-member="${user.id}" href="/profile/${encodeURIComponent(user.username)}">` +
            `<img src="${escapeHtml(user.avatar || '/images/default-avatar.png')}" alt="${name}" loading="lazy" />` +
            `<span class="wiki-member-meta"><b>${name}</b>` +
            `<i>用户ID ${escapeHtml(user.username)} · 账号ID ${user.id}${gen ? ' · ' + escapeHtml(gen.name) : ''}</i>` +
            (user.game_id ? `<i>游戏ID ${escapeHtml(user.game_id)}</i>` : '') +
            `</span></a>`);
    }

    const genHits = [...out.matchAll(GENERATION_RE)];
    for (const hit of genHits) {
        const name = String(hit[1]).trim();
        const row = await db.get('SELECT * FROM generations WHERE name = ? ORDER BY sort_order LIMIT 1', [name]);
        if (!row) {
            out = out.replace(hit[0], `<span class="wiki-gen-card wiki-gen-missing">代系「${escapeHtml(name)}」不存在</span>`);
            continue;
        }
        const cnt = await db.get('SELECT COUNT(*) AS c FROM users WHERE generation = ?', [row.name]);
        const range = row.start_date
            ? `${String(row.start_date).slice(0, 10)} ~ ${row.end_date ? String(row.end_date).slice(0, 10) : '至今'}`
            : '';
        out = out.replace(hit[0],
            `<span class="wiki-gen-card" data-generation="${escapeHtml(row.name)}" style="--gen-color:${escapeHtml(row.color || '#004AAD')}">` +
            `<b>${escapeHtml(row.name)}</b>` +
            `<i>${range ? escapeHtml(range) : '未设置区间'} · 手动指定 ${cnt?.c || 0} 人</i>` +
            `</span>`);
    }

    return out;
}

/** 读取时对正文做的完整处理：内链 + 短代码 */
async function renderContent(html) {
    const { html: linked } = await resolveWikiLinks(html);
    return renderShortcodes(linked);
}

/* ==================== 分类 ==================== */

async function listCategories({ includeInactive = false } = {}) {
    const where = includeInactive ? '' : 'WHERE is_active = 1';
    return db.all(
        `SELECT c.*, (SELECT COUNT(*) FROM wiki_pages p WHERE p.category_id = c.id AND p.status = 'published') AS page_count
         FROM wiki_categories c ${where}
         ORDER BY c.sort_order, c.id`
    );
}

/** 分类树（无限级） */
async function getCategoryTree({ includeInactive = false } = {}) {
    const flat = await listCategories({ includeInactive });
    const byId = new Map(flat.map(c => [c.id, { ...c, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
        if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id).children.push(node);
        else roots.push(node);
    }
    return roots;
}

async function getCategoryBySlug(slug) {
    return db.get('SELECT * FROM wiki_categories WHERE slug = ?', [slug]);
}

async function getCategoryById(id) {
    return db.get('SELECT * FROM wiki_categories WHERE id = ?', [id]);
}

/** 分类面包屑（从根到当前） */
async function categoryBreadcrumb(categoryId) {
    const chain = [];
    let cur = categoryId ? await getCategoryById(categoryId) : null;
    let guard = 0;
    while (cur && guard < 20) {
        chain.unshift({ id: cur.id, name: cur.name, slug: cur.slug });
        cur = cur.parent_id ? await getCategoryById(cur.parent_id) : null;
        guard += 1;
    }
    return chain;
}

async function createCategory(data, userId) {
    const name = clampText(data.name, 60).trim();
    if (!name) throw Object.assign(new Error('分类名称不能为空'), { status: 400 });
    const parentId = toInt(data.parent_id);
    if (parentId) {
        const parent = await getCategoryById(parentId);
        if (!parent) throw Object.assign(new Error('父分类不存在'), { status: 400 });
    }
    const slug = data.slug
        ? String(data.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-')
        : await uniqueSlug(name, { table: 'wiki_categories' });
    const dup = await db.get('SELECT id FROM wiki_categories WHERE slug = ?', [slug]);
    if (dup) throw Object.assign(new Error('该分类标识已存在'), { status: 409 });

    const r = await db.run(
        `INSERT INTO wiki_categories (name, slug, description, icon, parent_id, sort_order, is_active, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, slug, clampText(data.description, 500), clampText(data.icon, 60), parentId || null,
            toInt(data.sort_order, 0), data.is_active === false ? 0 : 1, userId || null, now(), now()]
    );
    return getCategoryById(r.id);
}

async function updateCategory(id, patch) {
    const cat = await getCategoryById(id);
    if (!cat) throw Object.assign(new Error('分类不存在'), { status: 404 });
    const parentId = patch.parent_id === undefined ? cat.parent_id : toInt(patch.parent_id);
    if (parentId) {
        if (parentId === Number(id)) throw Object.assign(new Error('父分类不能是自己'), { status: 400 });
        // 防止把分类挂到自己的子孙下面造成环
        const descendants = await collectDescendantIds(id);
        if (descendants.includes(parentId)) throw Object.assign(new Error('父分类不能是自己的子分类'), { status: 400 });
    }
    const slug = patch.slug ? String(patch.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-') : cat.slug;
    if (slug !== cat.slug) {
        const dup = await db.get('SELECT id FROM wiki_categories WHERE slug = ? AND id != ?', [slug, id]);
        if (dup) throw Object.assign(new Error('该分类标识已存在'), { status: 409 });
    }
    await db.run(
        `UPDATE wiki_categories SET name = ?, slug = ?, description = ?, icon = ?, parent_id = ?, sort_order = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
        [
            patch.name !== undefined ? clampText(patch.name, 60).trim() : cat.name,
            slug,
            patch.description !== undefined ? clampText(patch.description, 500) : cat.description,
            patch.icon !== undefined ? clampText(patch.icon, 60) : cat.icon,
            parentId || null,
            patch.sort_order !== undefined ? toInt(patch.sort_order, 0) : cat.sort_order,
            patch.is_active !== undefined ? (patch.is_active ? 1 : 0) : cat.is_active,
            now(), id
        ]
    );
    return getCategoryById(id);
}

async function collectDescendantIds(id) {
    const all = await db.all('SELECT id, parent_id FROM wiki_categories');
    const byParent = new Map();
    for (const c of all) {
        if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
        byParent.get(c.parent_id).push(c.id);
    }
    const out = [];
    const walk = (pid) => {
        for (const cid of byParent.get(pid) || []) {
            out.push(cid);
            walk(cid);
        }
    };
    walk(Number(id));
    return out;
}

/** 删除分类：有子分类或有页面时拒绝（避免把页面变成孤儿） */
async function deleteCategory(id) {
    const cat = await getCategoryById(id);
    if (!cat) throw Object.assign(new Error('分类不存在'), { status: 404 });
    const children = await db.get('SELECT COUNT(*) AS c FROM wiki_categories WHERE parent_id = ?', [id]);
    if (children.c > 0) throw Object.assign(new Error('该分类下还有子分类，请先处理子分类'), { status: 400 });
    const pages = await db.get('SELECT COUNT(*) AS c FROM wiki_pages WHERE category_id = ?', [id]);
    if (pages.c > 0) throw Object.assign(new Error(`该分类下还有 ${pages.c} 篇文章，请先移动或删除`), { status: 400 });
    await db.run('DELETE FROM wiki_categories WHERE id = ?', [id]);
    return true;
}

/* ==================== 页面 ==================== */

const PAGE_LIST_COLUMNS = `p.id, p.category_id, p.title, p.slug, p.summary, p.cover_image, p.author_id,
    p.last_editor_id, p.status, p.is_featured, p.is_pinned, p.views, p.created_at, p.updated_at, p.published_at`;

async function listPages({
    categoryId = null, includeChildCategories = false, status = 'published', authorId = null,
    featured = null, q = '', page = 1, limit = 20, sort = 'updated'
} = {}) {
    const where = ['1=1'];
    const params = [];

    if (categoryId) {
        if (includeChildCategories) {
            const ids = [Number(categoryId), ...(await collectDescendantIds(categoryId))];
            where.push(`p.category_id IN (${ids.map(() => '?').join(',')})`);
            params.push(...ids);
        } else {
            where.push('p.category_id = ?');
            params.push(Number(categoryId));
        }
    }
    if (status && status !== 'all') {
        where.push('p.status = ?');
        params.push(status);
    }
    if (authorId) {
        where.push('p.author_id = ?');
        params.push(Number(authorId));
    }
    if (featured === true) where.push('p.is_featured = 1');
    if (q) {
        where.push('(p.title LIKE ? OR p.summary LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
    }

    const orderBy = sort === 'views' ? 'p.views DESC, p.updated_at DESC'
        : sort === 'created' ? 'p.created_at DESC'
            : sort === 'title' ? 'p.title ASC'
                : 'p.updated_at DESC';

    const total = (await db.get(`SELECT COUNT(*) AS c FROM wiki_pages p WHERE ${where.join(' AND ')}`, params))?.c || 0;
    const safePage = Math.max(1, toInt(page, 1));
    const safeLimit = Math.min(100, Math.max(1, toInt(limit, 20)));
    const offset = (safePage - 1) * safeLimit;

    const rows = await db.all(
        `SELECT ${PAGE_LIST_COLUMNS}, u.nickname AS author_name, u.username AS author_username,
                c.name AS category_name, c.slug AS category_slug
         FROM wiki_pages p
         LEFT JOIN users u ON u.id = p.author_id
         LEFT JOIN wiki_categories c ON c.id = p.category_id
         WHERE ${where.join(' AND ')}
         ORDER BY p.is_pinned DESC, ${orderBy}
         LIMIT ? OFFSET ?`,
        [...params, safeLimit, offset]
    );

    return {
        pages: rows,
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(total / safeLimit))
    };
}

async function getPageById(id) {
    return db.get(
        `SELECT p.*, u.nickname AS author_name, u.username AS author_username,
                e.nickname AS editor_name, e.username AS editor_username,
                c.name AS category_name, c.slug AS category_slug
         FROM wiki_pages p
         LEFT JOIN users u ON u.id = p.author_id
         LEFT JOIN users e ON e.id = p.last_editor_id
         LEFT JOIN wiki_categories c ON c.id = p.category_id
         WHERE p.id = ?`,
        [Number(id)]
    );
}

async function getPageBySlug(slug, { includeUnpublished = false } = {}) {
    const where = includeUnpublished ? '' : "AND p.status = 'published'";
    return db.get(
        `SELECT p.*, u.nickname AS author_name, u.username AS author_username,
                e.nickname AS editor_name, e.username AS editor_username,
                c.name AS category_name, c.slug AS category_slug
         FROM wiki_pages p
         LEFT JOIN users u ON u.id = p.author_id
         LEFT JOIN users e ON e.id = p.last_editor_id
         LEFT JOIN wiki_categories c ON c.id = p.category_id
         WHERE p.slug = ? ${where}`,
        [slug]
    );
}

/** 同分类相邻文章（上一篇/下一篇，按 updated_at） */
async function getNeighbors(page) {
    if (!page) return { prev: null, next: null };
    const prev = await db.get(
        `SELECT id, title, slug FROM wiki_pages
         WHERE status = 'published' AND category_id IS ? AND updated_at < ?
         ORDER BY updated_at DESC LIMIT 1`,
        [page.category_id, page.updated_at]
    );
    const next = await db.get(
        `SELECT id, title, slug FROM wiki_pages
         WHERE status = 'published' AND category_id IS ? AND updated_at > ?
         ORDER BY updated_at ASC LIMIT 1`,
        [page.category_id, page.updated_at]
    );
    return { prev: prev || null, next: next || null };
}

/** 相关文章：内链（双向）优先，其次同分类最新 */
async function relatedPages(pageId, limit = 10) {
    const linked = await db.all(
        `SELECT p.id, p.title, p.slug, p.summary, p.updated_at, 'link' AS reason
         FROM wiki_page_links l JOIN wiki_pages p ON p.id = l.target_page_id
         WHERE l.page_id = ? AND p.status = 'published'
         UNION
         SELECT p.id, p.title, p.slug, p.summary, p.updated_at, 'backlink' AS reason
         FROM wiki_page_links l JOIN wiki_pages p ON p.id = l.page_id
         WHERE l.target_page_id = ? AND p.status = 'published'
         LIMIT ?`,
        [Number(pageId), Number(pageId), Number(limit)]
    );
    if (linked.length >= limit) return linked.slice(0, limit);

    const page = await getPageById(pageId);
    if (!page) return linked;
    const same = await db.all(
        `SELECT id, title, slug, summary, updated_at, 'same_category' AS reason
         FROM wiki_pages
         WHERE status = 'published' AND id != ? AND category_id IS ?
         ORDER BY updated_at DESC LIMIT ?`,
        [Number(pageId), page.category_id, Number(limit)]
    );
    const seen = new Set(linked.map(l => l.id));
    for (const s of same) {
        if (linked.length >= limit) break;
        if (!seen.has(s.id)) { linked.push(s); seen.add(s.id); }
    }
    return linked;
}

/** 写入/更新全文索引 */
async function reindexPage(pageId) {
    if (!ftsReady) return;
    const page = await db.get('SELECT id, title, summary, content, status FROM wiki_pages WHERE id = ?', [pageId]);
    try {
        await db.run('DELETE FROM wiki_search WHERE page_id = ?', [Number(pageId)]);
        if (page && page.status !== 'archived') {
            await db.run(
                'INSERT INTO wiki_search (page_id, title, summary, content) VALUES (?, ?, ?, ?)',
                [page.id, page.title, page.summary || '', htmlToText(page.content)]
            );
        }
    } catch (e) {
        logger.error('Wiki 全文索引写入失败:', e.message);
    }
}

async function reindexAll() {
    if (!ftsReady) return 0;
    const rows = await db.all("SELECT id FROM wiki_pages WHERE status != 'archived'");
    for (const r of rows) await reindexPage(r.id);
    return rows.length;
}

/** 维护内链表 */
async function syncLinks(pageId, targetIds) {
    await db.run('DELETE FROM wiki_page_links WHERE page_id = ?', [Number(pageId)]);
    for (const tid of targetIds) {
        if (Number(tid) === Number(pageId)) continue;   // 不记录自链接
        try {
            await db.run('INSERT OR IGNORE INTO wiki_page_links (page_id, target_page_id) VALUES (?, ?)', [Number(pageId), Number(tid)]);
        } catch (e) { /* 忽略重复 */ }
    }
}

async function createPage(data, userId) {
    const title = clampText(data.title, 200).trim();
    if (!title) throw Object.assign(new Error('标题不能为空'), { status: 400 });
    const rawContent = String(data.content || '');
    if (!rawContent.trim()) throw Object.assign(new Error('正文不能为空'), { status: 400 });
    if (rawContent.length > 400000) throw Object.assign(new Error('正文过长（上限 40 万字符）'), { status: 400 });

    const status = STATUSES.includes(data.status) ? data.status : 'draft';
    const categoryId = toInt(data.category_id);
    if (categoryId) {
        const cat = await getCategoryById(categoryId);
        if (!cat) throw Object.assign(new Error('分类不存在'), { status: 400 });
    }
    const slug = data.slug
        ? String(data.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
        : await uniqueSlug(title);
    if (!slug) throw Object.assign(new Error('slug 不合法'), { status: 400 });
    const dupSlug = await db.get('SELECT id FROM wiki_pages WHERE slug = ?', [slug]);
    if (dupSlug) throw Object.assign(new Error('该 slug 已被占用'), { status: 409 });

    const { html, targetIds } = await resolveWikiLinks(rawContent);
    const content = sanitizeContent(html);
    const publishedAt = status === 'published' ? now() : null;

    const result = await db.transaction(async () => {
        const r = await db.run(
            `INSERT INTO wiki_pages (category_id, title, slug, summary, content, cover_image, author_id, last_editor_id,
                status, is_featured, is_pinned, views, created_at, updated_at, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            [categoryId || null, title, slug, clampText(data.summary, 500) || autoSummary(content), content,
                clampText(data.cover_image, 500), userId, userId, status,
                data.is_featured ? 1 : 0, data.is_pinned ? 1 : 0, now(), now(), publishedAt]
        );
        await db.run(
            `INSERT INTO wiki_revisions (page_id, title, content, summary, editor_id, revision_note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [r.id, title, content, clampText(data.summary, 500) || autoSummary(content), userId, '创建页面', now()]
        );
        return r.id;
    });

    await syncLinks(result, targetIds);
    await reindexPage(result);
    return getPageById(result);
}

async function updatePage(id, patch, userId, revisionNote = '') {
    const page = await getPageById(id);
    if (!page) throw Object.assign(new Error('页面不存在'), { status: 404 });

    const title = patch.title !== undefined ? clampText(patch.title, 200).trim() : page.title;
    if (!title) throw Object.assign(new Error('标题不能为空'), { status: 400 });
    const rawContent = patch.content !== undefined ? String(patch.content) : page.content;
    if (!rawContent.trim()) throw Object.assign(new Error('正文不能为空'), { status: 400 });

    const categoryId = patch.category_id === undefined ? page.category_id : toInt(patch.category_id);
    const status = patch.status !== undefined && STATUSES.includes(patch.status) ? patch.status : page.status;
    // slug 保持稳定：只有显式传 slug 才改（req.md §9：改标题不动旧链接）
    let slug = page.slug;
    if (patch.slug !== undefined && String(patch.slug).trim()) {
        const wanted = String(patch.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
        if (wanted && wanted !== page.slug) {
            const dup = await db.get('SELECT id FROM wiki_pages WHERE slug = ? AND id != ?', [wanted, id]);
            if (dup) throw Object.assign(new Error('该 slug 已被占用'), { status: 409 });
            slug = wanted;
        }
    }

    const { html, targetIds } = await resolveWikiLinks(rawContent);
    const content = sanitizeContent(html);
    const summary = patch.summary !== undefined
        ? (clampText(patch.summary, 500) || autoSummary(content))
        : (page.summary || autoSummary(content));
    const publishedAt = status === 'published' ? (page.published_at || now()) : page.published_at;

    await db.transaction(async () => {
        await db.run(
            `UPDATE wiki_pages SET category_id = ?, title = ?, slug = ?, summary = ?, content = ?, cover_image = ?,
                last_editor_id = ?, status = ?, is_featured = ?, is_pinned = ?, updated_at = ?, published_at = ?
             WHERE id = ?`,
            [categoryId || null, title, slug, summary, content,
                patch.cover_image !== undefined ? clampText(patch.cover_image, 500) : page.cover_image,
                userId, status,
                patch.is_featured !== undefined ? (patch.is_featured ? 1 : 0) : page.is_featured,
                patch.is_pinned !== undefined ? (patch.is_pinned ? 1 : 0) : page.is_pinned,
                now(), publishedAt, id]
        );
        // 每次正式保存都留一个版本（内容未变则跳过，避免灌水版本）
        if (content !== page.content || title !== page.title || summary !== page.summary) {
            await db.run(
                `INSERT INTO wiki_revisions (page_id, title, content, summary, editor_id, revision_note, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, title, content, summary, userId, clampText(revisionNote, 200) || '编辑更新', now()]
            );
        }
    });

    await syncLinks(id, targetIds);
    await reindexPage(id);
    return getPageById(id);
}

/** 状态流转 */
async function setPageStatus(id, status, userId) {
    if (!STATUSES.includes(status)) throw Object.assign(new Error('状态不合法'), { status: 400 });
    const page = await getPageById(id);
    if (!page) throw Object.assign(new Error('页面不存在'), { status: 404 });
    await db.run(
        'UPDATE wiki_pages SET status = ?, published_at = ?, last_editor_id = ?, updated_at = ? WHERE id = ?',
        [status, status === 'published' ? (page.published_at || now()) : page.published_at, userId, now(), id]
    );
    if (status === 'archived') {
        if (ftsReady) await db.run('DELETE FROM wiki_search WHERE page_id = ?', [Number(id)]).catch(() => {});
    } else {
        await reindexPage(id);
    }
    return getPageById(id);
}

/** 彻底删除（超级管理员）：连带 revisions / links / 索引 */
async function deletePage(id) {
    const page = await getPageById(id);
    if (!page) throw Object.assign(new Error('页面不存在'), { status: 404 });
    await db.transaction(async () => {
        await db.run('DELETE FROM wiki_revisions WHERE page_id = ?', [Number(id)]);
        await db.run('DELETE FROM wiki_page_links WHERE page_id = ? OR target_page_id = ?', [Number(id), Number(id)]);
        await db.run('DELETE FROM wiki_pages WHERE id = ?', [Number(id)]);
    });
    if (ftsReady) await db.run('DELETE FROM wiki_search WHERE page_id = ?', [Number(id)]).catch(() => {});
    return true;
}

/* ==================== 版本历史 ==================== */

async function listRevisions(pageId, limit = 100) {
    return db.all(
        `SELECT r.id, r.page_id, r.title, r.summary, r.editor_id, r.revision_note, r.created_at,
                u.nickname AS editor_name, u.username AS editor_username,
                LENGTH(r.content) AS content_length
         FROM wiki_revisions r
         LEFT JOIN users u ON u.id = r.editor_id
         WHERE r.page_id = ?
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ?`,
        [Number(pageId), Number(limit)]
    );
}

async function getRevision(pageId, revisionId) {
    return db.get(
        `SELECT r.*, u.nickname AS editor_name, u.username AS editor_username
         FROM wiki_revisions r LEFT JOIN users u ON u.id = r.editor_id
         WHERE r.id = ? AND r.page_id = ?`,
        [Number(revisionId), Number(pageId)]
    );
}

/** 全站最近的版本记录（后台「历史版本」分页用） */
async function listRecentRevisions(limit = 50) {
    return db.all(
        `SELECT r.id, r.page_id, r.title, r.revision_note, r.created_at, r.editor_id,
                u.nickname AS editor_name, u.username AS editor_username,
                p.slug AS page_slug, p.status AS page_status
         FROM wiki_revisions r
         LEFT JOIN users u ON u.id = r.editor_id
         LEFT JOIN wiki_pages p ON p.id = r.page_id
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ?`,
        [Math.min(200, Number(limit) || 50)]
    );
}

/**
 * 恢复历史版本：把旧内容写成一条「新的」revision 再应用（不覆盖、不删除任何历史）
 */
async function restoreRevision(pageId, revisionId, userId) {
    const rev = await getRevision(pageId, revisionId);
    if (!rev) throw Object.assign(new Error('历史版本不存在'), { status: 404 });
    const page = await getPageById(pageId);
    if (!page) throw Object.assign(new Error('页面不存在'), { status: 404 });

    await db.transaction(async () => {
        await db.run(
            `INSERT INTO wiki_revisions (page_id, title, content, summary, editor_id, revision_note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [pageId, rev.title, rev.content, rev.summary || autoSummary(rev.content), userId,
                `恢复自版本 #${rev.id}（${rev.created_at}）`, now()]
        );
        await db.run(
            `UPDATE wiki_pages SET title = ?, content = ?, summary = ?, last_editor_id = ?, updated_at = ? WHERE id = ?`,
            [rev.title, rev.content, rev.summary || autoSummary(rev.content), userId, now(), pageId]
        );
    });

    const { targetIds } = await resolveWikiLinks(rev.content);
    await syncLinks(pageId, targetIds);
    await reindexPage(pageId);
    return getPageById(pageId);
}

/* ==================== 搜索 ==================== */

function escapeFts(q) {
    return `"${String(q).replace(/"/g, '""')}"`;
}

/**
 * 搜索：≥3 字走 FTS5（trigram），<3 字退回 LIKE；结果都限流。
 */
async function searchWiki(q, { categoryId = null, limit = 20, page = 1 } = {}) {
    const keyword = String(q || '').trim();
    const safeLimit = Math.min(50, Math.max(1, toInt(limit, 20)));
    const safePage = Math.max(1, toInt(page, 1));
    const offset = (safePage - 1) * safeLimit;

    if (!keyword) {
        // 空搜索：返回最近更新
        const r = await listPages({ status: 'published', page: safePage, limit: safeLimit, sort: 'updated' });
        return { ...r, mode: 'recent', q: '' };
    }

    const catFilter = categoryId
        ? ` AND p.category_id IN (${[Number(categoryId), ...(await collectDescendantIds(categoryId))].map(() => '?').join(',')})`
        : '';
    const catParams = categoryId ? [Number(categoryId), ...(await collectDescendantIds(categoryId))] : [];

    if (ftsReady && keyword.length >= 3) {
        try {
            const rows = await db.all(
                `SELECT p.id, p.title, p.slug, p.summary, p.category_id, p.updated_at, p.views,
                        c.name AS category_name, c.slug AS category_slug,
                        snippet(wiki_search, 2, '「', '」', '…', 16) AS snippet
                 FROM wiki_search
                 JOIN wiki_pages p ON p.id = wiki_search.page_id
                 LEFT JOIN wiki_categories c ON c.id = p.category_id
                 WHERE wiki_search MATCH ? AND p.status = 'published'${catFilter}
                 ORDER BY rank LIMIT ? OFFSET ?`,
                [escapeFts(keyword), ...catParams, safeLimit, offset]
            );
            const total = (await db.get(
                `SELECT COUNT(*) AS c FROM wiki_search JOIN wiki_pages p ON p.id = wiki_search.page_id
                 WHERE wiki_search MATCH ? AND p.status = 'published'${catFilter}`,
                [escapeFts(keyword), ...catParams]
            ))?.c || 0;
            return {
                pages: rows, total, page: safePage, limit: safeLimit,
                totalPages: Math.max(1, Math.ceil(total / safeLimit)), mode: 'fts', q: keyword
            };
        } catch (e) {
            logger.error('Wiki FTS 搜索失败，退回 LIKE:', e.message);
        }
    }

    // LIKE 兜底（短词 / FTS 不可用）
    const like = `%${keyword}%`;
    const rows = await db.all(
        `SELECT p.id, p.title, p.slug, p.summary, p.category_id, p.updated_at, p.views,
                c.name AS category_name, c.slug AS category_slug,
                substr(p.content, 1, 160) AS snippet
         FROM wiki_pages p LEFT JOIN wiki_categories c ON c.id = p.category_id
         WHERE p.status = 'published' AND (p.title LIKE ? OR p.summary LIKE ? OR p.content LIKE ?)${catFilter}
         ORDER BY (p.title LIKE ?) DESC, p.updated_at DESC
         LIMIT ? OFFSET ?`,
        [like, like, like, ...catParams, like, safeLimit, offset]
    );
    const total = (await db.get(
        `SELECT COUNT(*) AS c FROM wiki_pages p
         WHERE p.status = 'published' AND (p.title LIKE ? OR p.summary LIKE ? OR p.content LIKE ?)${catFilter}`,
        [like, like, like, ...catParams]
    ))?.c || 0;
    return {
        pages: rows.map(r => ({ ...r, snippet: htmlToText(r.snippet) })),
        total, page: safePage, limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)), mode: 'like', q: keyword
    };
}

/* ==================== 浏览计数 ==================== */

const viewCache = new Map();   // pageId -> Map<clientKey, ts>

/**
 * 浏览 +1（同一 IP/用户在 30 分钟内只算一次）。
 * req.md §16 允许「进程内缓存即可」，重启后计数缓存清空是可接受的。
 */
function bumpViews(pageId, clientKey = 'anon') {
    const id = Number(pageId);
    let bucket = viewCache.get(id);
    if (!bucket) { bucket = new Map(); viewCache.set(id, bucket); }
    const last = bucket.get(clientKey) || 0;
    const t = Date.now();
    if (t - last < VIEW_DEDUP_MS) return false;
    bucket.set(clientKey, t);
    // 顺手清理过期条目，避免 Map 无限增长
    if (bucket.size > 5000) {
        for (const [k, v] of bucket) if (t - v > VIEW_DEDUP_MS) bucket.delete(k);
    }
    db.run('UPDATE wiki_pages SET views = COALESCE(views, 0) + 1 WHERE id = ?', [id])
        .catch(e => logger.error('Wiki 浏览量更新失败:', e.message));
    return true;
}

/* ==================== 首页/统计 ==================== */

async function wikiHomeData() {
    const [featured, recent, popular, contributors, categories, total] = await Promise.all([
        db.all(
            `SELECT ${PAGE_LIST_COLUMNS}, c.name AS category_name, c.slug AS category_slug
             FROM wiki_pages p LEFT JOIN wiki_categories c ON c.id = p.category_id
             WHERE p.status = 'published' AND p.is_featured = 1
             ORDER BY p.updated_at DESC LIMIT 6`
        ),
        db.all(
            `SELECT ${PAGE_LIST_COLUMNS}, c.name AS category_name, c.slug AS category_slug
             FROM wiki_pages p LEFT JOIN wiki_categories c ON c.id = p.category_id
             WHERE p.status = 'published' ORDER BY p.updated_at DESC LIMIT 10`
        ),
        db.all(
            `SELECT ${PAGE_LIST_COLUMNS}, c.name AS category_name, c.slug AS category_slug
             FROM wiki_pages p LEFT JOIN wiki_categories c ON c.id = p.category_id
             WHERE p.status = 'published' ORDER BY p.views DESC, p.updated_at DESC LIMIT 10`
        ),
        db.all(
            `SELECT u.id, u.username, u.nickname, u.avatar, COUNT(*) AS edits, MAX(p.updated_at) AS last_at
             FROM wiki_pages p JOIN users u ON u.id = p.last_editor_id
             WHERE p.status = 'published' GROUP BY u.id ORDER BY last_at DESC LIMIT 8`
        ),
        getCategoryTree(),
        (await db.get("SELECT COUNT(*) AS c FROM wiki_pages WHERE status = 'published'"))?.c || 0
    ]);
    return { featured, recent, popular, contributors, categories, totalPages: total };
}

async function wikiStats() {
    const byStatus = await db.all('SELECT status, COUNT(*) AS c FROM wiki_pages GROUP BY status');
    const statusMap = { draft: 0, published: 0, archived: 0 };
    for (const r of byStatus) statusMap[r.status] = r.c;

    const categories = (await db.get('SELECT COUNT(*) AS c FROM wiki_categories'))?.c || 0;
    const totalViews = (await db.get('SELECT COALESCE(SUM(views), 0) AS v FROM wiki_pages'))?.v || 0;
    const updated30 = (await db.get(
        "SELECT COUNT(*) AS c FROM wiki_pages WHERE updated_at >= datetime('now','localtime','-30 day')"
    ))?.c || 0;
    const editors = await db.all(
        `SELECT u.id, u.username, u.nickname, COUNT(*) AS edits
         FROM wiki_revisions r JOIN users u ON u.id = r.editor_id
         WHERE r.created_at >= datetime('now','localtime','-30 day')
         GROUP BY u.id ORDER BY edits DESC LIMIT 10`
    );
    const revisions = (await db.get('SELECT COUNT(*) AS c FROM wiki_revisions'))?.c || 0;

    return {
        total: statusMap.draft + statusMap.published + statusMap.archived,
        published: statusMap.published,
        draft: statusMap.draft,
        archived: statusMap.archived,
        categories,
        totalViews,
        updated30,
        revisions,
        editors,
        fts: ftsReady
    };
}

module.exports = {
    // 工具
    slugify, uniqueSlug, htmlToText, autoSummary, sanitizeContent, escapeHtml,
    // 分类
    listCategories, getCategoryTree, getCategoryBySlug, getCategoryById, categoryBreadcrumb,
    createCategory, updateCategory, deleteCategory, collectDescendantIds,
    // 页面
    listPages, getPageById, getPageBySlug, getNeighbors, relatedPages,
    createPage, updatePage, setPageStatus, deletePage,
    // 版本
    listRevisions, getRevision, restoreRevision, listRecentRevisions,
    // 内链/短代码
    resolveWikiLinks, renderShortcodes, renderContent, syncLinks,
    // 搜索/索引
    searchWiki, reindexPage, reindexAll, isFtsReady,
    // 计数/统计
    bumpViews, wikiHomeData, wikiStats,
    STATUSES
};
