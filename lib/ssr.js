/**
 * SSR / SSG 渲染中间件
 *
 * 架构：
 *   客户端产物  frontend/dist        （纯 SPA，Vite build；入口已打 Rocket Loader 免疫补丁）
 *   服务端产物  frontend/dist-ssr/entry-server.js（Vite SSR build，依赖已内联，单文件）
 *   SSG 产物    frontend/prerender/<路径>.html（scripts/prerender.js 生成，也可按需生成后落盘）
 *
 * 请求处理（server.js 中挂在静态资源之后、SPA 回退之前）：
 *   1) SPA_ONLY=1            → 直接跳过（一键回退纯 SPA）
 *   2) 命中 SSG 路由          → 有静态文件就发文件，没有就现场渲染并落盘；Cache-Control: max-age=600
 *   3) 命中 SSR 路由          → 现场渲染，进程内缓存 60 秒；Cache-Control: max-age=60
 *   4) 其余路由               → 交给 SPA 回退（现状不变）
 *
 * 每页 head（title/description/OG/canonical）由 provider 的可选 head(data) 提供，
 * 没有就退化成站点默认标题。
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const logger = require('./logger');
const prefetch = require('./prefetch');

const ROOT = path.join(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'frontend', 'dist');
const SSR_BUNDLE = process.env.SSR_BUNDLE
    ? path.resolve(ROOT, process.env.SSR_BUNDLE)
    : path.join(ROOT, 'frontend', 'dist-ssr', 'entry-server.js');
const PRERENDER_DIR = path.join(ROOT, 'frontend', 'prerender');
const SITE = process.env.SITE_URL || 'https://xuanjian.top';

const SSG_TTL_MS = 10 * 60 * 1000;      // 边缘/浏览器缓存 10 分钟（用户确认）
const SSR_TTL_MS = 60 * 1000;           // SSR 进程内缓存 60 秒（用户确认）

const SPA_ONLY = String(process.env.SPA_ONLY || '') === '1';
const ENABLED = !SPA_ONLY && String(process.env.SSR_ENABLED || '1') !== '0';

let renderFn = null;                     // 惰性加载的 SSR 渲染函数
let bundleFailedAt = 0;                  // 加载失败时间，避免每次请求都重试
const ssrCache = new Map();              // pathname → { html, at }

/* ==================== 模板与产物 ==================== */

let templateCache = null;

/** 读取客户端 HTML 模板（含 Rocket Loader 免疫的入口自举脚本） */
function getTemplate() {
    if (templateCache) return templateCache;
    const file = path.join(CLIENT_DIR, 'index.html');
    if (!fs.existsSync(file)) throw new Error('找不到客户端产物 frontend/dist/index.html');
    templateCache = fs.readFileSync(file, 'utf8');
    return templateCache;
}

/** 重新加载模板（重新部署前端产物后调用） */
function resetTemplate() {
    templateCache = null;
    ssrCache.clear();
}

async function loadRenderer() {
    if (renderFn) return renderFn;
    if (bundleFailedAt && Date.now() - bundleFailedAt < 30000) return null;   // 30 秒内不重复尝试
    if (!fs.existsSync(SSR_BUNDLE)) {
        bundleFailedAt = Date.now();
        logger.warn('SSR 产物不存在（frontend/dist-ssr/entry-server.js），已自动退回纯 SPA');
        return null;
    }
    try {
        const mod = await import(pathToFileURL(SSR_BUNDLE).href);
        renderFn = mod.render || mod.default;
        if (typeof renderFn !== 'function') throw new Error('SSR 产物没有导出 render');
        logger.info('SSR 渲染器已加载：' + path.relative(ROOT, SSR_BUNDLE));
        return renderFn;
    } catch (e) {
        bundleFailedAt = Date.now();
        logger.error('加载 SSR 产物失败，已退回纯 SPA:', e.message);
        return null;
    }
}

/* ==================== head 组装 ==================== */

function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 默认 head（provider 没给 head() 时用） */
function defaultHead() {
    return { title: '我的世界玄剑公会', description: '玄剑公会官网：公会日报、决策公示、成员档案、贡献点经济与 Minecraft 服务器资料。' };
}

function buildHead(head, url) {
    const h = { ...defaultHead(), ...(head || {}) };
    const canonical = SITE + url.split('?')[0];
    const image = h.image ? (h.image.startsWith('http') ? h.image : SITE + h.image) : SITE + '/icon.png';
    return [
        `<title>${esc(h.title)}</title>`,
        `<meta name="description" content="${esc(h.description)}" />`,
        `<link rel="canonical" href="${esc(canonical)}" />`,
        `<meta property="og:type" content="article" />`,
        `<meta property="og:site_name" content="玄剑公会" />`,
        `<meta property="og:title" content="${esc(h.title)}" />`,
        `<meta property="og:description" content="${esc(h.description)}" />`,
        `<meta property="og:url" content="${esc(canonical)}" />`,
        `<meta property="og:image" content="${esc(image)}" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${esc(h.title)}" />`,
        `<meta name="twitter:description" content="${esc(h.description)}" />`,
        `<meta name="twitter:image" content="${esc(image)}" />`
    ].join('\n    ');
}

/** 把渲染结果塞进模板：替换 <title>、注入 head 与 __SSR_DATA__ */
function assembleHtml({ html: appHtml, data, head, url }) {
    let html = getTemplate();

    // 1) head
    const headTags = buildHead(head, url);
    if (/<title>[\s\S]*?<\/title>/i.test(html)) {
        html = html.replace(/<title>[\s\S]*?<\/title>/i, headTags);
    } else {
        html = html.replace('</head>', `    ${headTags}\n  </head>`);
    }

    // 2) 应用标记 + 预取数据（客户端 hydrate 用同一份数据，保证首屏一致）
    const payload = JSON.stringify(data || null).replace(/</g, '\\u003c');
    const rootRe = /<div id="root">\s*<\/div>/;
    const injection = `<div id="root">${appHtml}</div>\n    <script>window.__SSR_DATA__=${payload};</script>`;
    if (rootRe.test(html)) {
        html = html.replace(rootRe, injection);
    } else {
        logger.warn('客户端模板里找不到 <div id="root"></div>，SSR 注入失败');
        return null;
    }
    return html;
}

/* ==================== SSG 静态文件 ==================== */

/** 路径 → 静态文件名（安全、可读） */
function ssgFile(url) {
    const clean = url.split('?')[0].replace(/^\/+|\/+$/g, '');
    const name = (clean || 'index').replace(/[^A-Za-z0-9._/-]/g, '_').replace(/\//g, '__') + '.html';
    return path.join(PRERENDER_DIR, name);
}

function readSsgFile(url) {
    const file = ssgFile(url);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8');
}

function writeSsgFile(url, html) {
    try {
        fs.mkdirSync(PRERENDER_DIR, { recursive: true });
        fs.writeFileSync(ssgFile(url), html, 'utf8');
        return true;
    } catch (e) {
        logger.error('写入 SSG 文件失败:', e.message);
        return false;
    }
}

/** 让某个 URL 的 SSG 缓存失效（内容变更后调用，下次请求会重新生成） */
function invalidate(url) {
    const file = ssgFile(url);
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { /* 忽略 */ }
    ssrCache.delete(url.split('?')[0]);
}

/** 让某个前缀下所有 SSG 产物失效（分类树变更等全局影响时用） */
function invalidatePrefix(prefix) {
    const clean = String(prefix || '').replace(/^\/+|\/+$/g, '');
    const token = (clean || 'index').replace(/[^A-Za-z0-9._-]/g, '_');
    let removed = 0;
    try {
        if (fs.existsSync(PRERENDER_DIR)) {
            for (const f of fs.readdirSync(PRERENDER_DIR)) {
                if (!f.endsWith('.html')) continue;
                if (f === `${token}.html` || f.startsWith(`${token}__`)) {
                    fs.unlinkSync(path.join(PRERENDER_DIR, f));
                    removed += 1;
                }
            }
        }
    } catch (e) { /* 忽略 */ }
    // 内存缓存也一起清（SSR 缓存按路径前缀匹配）
    for (const k of [...ssrCache.keys()]) {
        if (k === `/${clean}` || k.startsWith(`/${clean}/`)) ssrCache.delete(k);
    }
    return removed;
}

/* ==================== 渲染 ==================== */

async function renderUrl(url, ctx = {}) {
    const pathname = url.split('?')[0];
    const render = await loadRenderer();
    if (!render) return null;

    const { mode, provider, data } = await prefetch.loadData(pathname, ctx);
    if (!mode) return null;
    // provider 明确返回 null = 这个资源不存在（例如草稿/已删除/未发布的 Wiki 页面），
    // 不要服务端渲染，交给 SPA 回退显示「不存在」
    if (data === null) return null;

    const headFn = (prefetch.loadProviders().find(p => p.name === provider) || {}).head;
    let head = null;
    try {
        head = headFn ? await headFn(data || {}, pathname) : null;
    } catch (e) { /* head 失败不影响渲染 */ }

    const { html: appHtml } = render(url, data);
    if (!appHtml) return null;
    return { html: assembleHtml({ html: appHtml, data, head, url }), mode };
}

/**
 * Express 中间件：挂在静态资源之后、SPA 回退之前。
 * SPA_ONLY / SSR_ENABLED 关闭时直接 next()。
 */
function middleware() {
    return async function ssrMiddleware(req, res, next) {
        if (!ENABLED || req.method !== 'GET' && req.method !== 'HEAD') return next();
        // 只处理 HTML 导航请求
        const accept = req.headers.accept || '';
        if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return next();

        const url = req.originalUrl || req.url;
        const pathname = url.split('?')[0];
        if (pathname.startsWith('/api') || pathname.startsWith('/assets') || pathname.includes('.')) return next();

        const hit = prefetch.classify(pathname);
        if (!hit) return next();

        // 1) SSG：优先发静态产物
        if (hit.mode === 'ssg') {
            let html = readSsgFile(pathname);
            if (!html) {
                try {
                    const out = await renderUrl(pathname, { req });
                    if (!out) return next();
                    html = out.html;
                    writeSsgFile(pathname, html);      // 落盘，后续直接命中
                } catch (e) {
                    logger.error('SSG 渲染失败，退回 SPA:', e.message);
                    return next();
                }
            }
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Cache-Control', `public, max-age=${Math.floor(SSG_TTL_MS / 1000)}, stale-while-revalidate=60`);
            res.set('X-Render-Mode', 'ssg');
            return res.send(html);
        }

        // 2) SSR：进程内 60 秒缓存
        const cached = ssrCache.get(url);
        if (cached && Date.now() - cached.at < SSR_TTL_MS) {
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Cache-Control', `public, max-age=${Math.floor(SSR_TTL_MS / 1000)}, stale-while-revalidate=30`);
            res.set('X-Render-Mode', 'ssr-cache');
            return res.send(cached.html);
        }

        try {
            const out = await renderUrl(url, { req });
            if (!out) return next();
            ssrCache.set(url, { html: out.html, at: Date.now() });
            if (ssrCache.size > 300) {
                const now = Date.now();
                for (const [k, v] of ssrCache) if (now - v.at > SSR_TTL_MS) ssrCache.delete(k);
            }
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Cache-Control', `public, max-age=${Math.floor(SSR_TTL_MS / 1000)}, stale-while-revalidate=30`);
            res.set('X-Render-Mode', 'ssr');
            return res.send(out.html);
        } catch (e) {
            logger.error('SSR 渲染失败，退回 SPA:', e.message);
            return next();
        }
    };
}

/** 预热：服务启动时把渲染器加载好，避免首个请求慢 */
async function warmup() {
    if (!ENABLED) return { enabled: false, reason: SPA_ONLY ? 'SPA_ONLY=1' : 'SSR_ENABLED=0' };
    const render = await loadRenderer();
    return { enabled: !!render, routes: prefetch.describe() };
}

module.exports = {
    middleware, warmup, renderUrl, invalidate, invalidatePrefix, ssgFile, writeSsgFile, readSsgFile,
    resetTemplate, getTemplate, assembleHtml,
    get enabled() { return ENABLED; },
    get spaOnly() { return SPA_ONLY; },
    paths: { CLIENT_DIR, SSR_BUNDLE, PRERENDER_DIR, SITE }
};
