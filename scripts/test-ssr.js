#!/usr/bin/env node
/**
 * 三层渲染架构自检（SSG / SSR / SPA）
 *
 * 只读：不写数据库、不生成 SSG 静态产物；渲染全部走 lib/ssr.renderUrl()。
 *
 * 断言：
 *   [1] lib/prefetch.describe() 里每个 provider 至少声明了 ssg 或 ssr
 *   [2] 所有已注册的 SSG / SSR 路由逐个 renderUrl()：
 *         非 null、HTML ≥ 8KB、含 __SSR_DATA__、<title> 不是站点默认标题（/ 首页类豁免）、
 *         并按需校验真实数据特征串（真实帖子标题 / 成员昵称 / 模组名…）
 *         未注册渲染模式的路由 **跳过**（其它页面 provider 可能还在并行开发）
 *   [3] 不存在的资源（如 /post/99999999、/wiki/not-exist-slug）必须返回 null —— 交回 SPA 显示「不存在」
 *   [4] 带查询参数的非预取形态（如 /rankings?type=contribution）不参与预取（用生产形态的
 *         ctx = { req: { originalUrl } }，provider 能从 ctx 看到 query）：
 *         未注册的路径必须返回 null；provider 明确不看 query 的路径（如 /daily?page=2）服务端按
 *         pathname 命中，返回的必须与无参数版 HTML 完全一致（翻页/筛选交给客户端接管）
 *
 * 用法：
 *   node scripts/test-ssr.js
 *   $env:DB_FILE='data/guild-prod-copy.db'                    # 默认就用这个只读副本
 *   $env:SSR_BUNDLE='frontend/dist-ssr-s/entry-server.js'     # 默认自动挑存在的 dist-ssr / dist-ssr-*
 *   $env:SSG_TEST_LIMIT=50                                    # 可选：限制 enumerated SSG 路由的校验条数
 *   $env:SSR_TEST_IGNORE_PROVIDERS='members'                  # 可选：模拟某个 provider 还没落地
 *                                                             #（对应路由计入「跳过」而不是失败）
 *
 * 前置产物：
 *   frontend/dist/index.html                 （npm run build + patch-index-bootstrap.js）
 *   frontend/dist-ssr[-*]/entry-server.js    （vite build --ssr src/entry-server.jsx）
 *
 * 退出码：0 = 全部通过；1 = 有失败（或环境缺产物）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIN_HTML_BYTES = 8 * 1024;
const DEFAULT_TITLE = '我的世界玄剑公会';           // = lib/ssr.js defaultHead().title
const TEMPLATE_REL = 'frontend/dist/index.html';
const MAX_ENUMERATED = Number(process.env.SSG_TEST_LIMIT || 200);

/** 站点已知的内容路由：provider 还没落地时，这些路由计入「跳过」而不是失败 */
const KNOWN_ROUTES = [
    '/', '/daily', '/decision', '/mods', '/projections', '/wiki',
    '/gmirs', '/gdars', '/rankings', '/donation'
];

/* ==================== 环境准备（必须在 require lib/ssr / database 之前） ==================== */

const DB_REL = process.env.DB_FILE || 'data/guild-prod-copy.db';
process.env.DB_FILE = DB_REL;                        // database.js 在 require 时读取

/** 自动挑 SSR 产物：frontend/dist-ssr 优先，其次任意 frontend/dist-ssr-* */
function findBundle() {
    if (process.env.SSR_BUNDLE) return process.env.SSR_BUNDLE;
    const candidates = ['frontend/dist-ssr/entry-server.js'];
    let names = [];
    try {
        names = fs.readdirSync(path.join(ROOT, 'frontend')).filter(n => n.startsWith('dist-ssr')).sort();
    } catch { /* 目录不存在时由下面的环境检查报错 */ }
    for (const n of names) {
        const rel = path.posix.join('frontend', n, 'entry-server.js');
        if (!candidates.includes(rel)) candidates.push(rel);
    }
    return candidates.find(rel => fs.existsSync(path.join(ROOT, rel))) || null;
}
const BUNDLE_REL = findBundle();

const preflight = [];
if (!fs.existsSync(path.join(ROOT, DB_REL))) preflight.push(`数据库不存在：${DB_REL}（可用 DB_FILE 指定只读副本）`);
if (!BUNDLE_REL) preflight.push('SSR 产物不存在：frontend/dist-ssr[-*]/entry-server.js（先 cd frontend && npx vite build --ssr src/entry-server.jsx --outDir dist-ssr）');
else if (!fs.existsSync(path.join(ROOT, BUNDLE_REL))) preflight.push(`SSR 产物不存在：${BUNDLE_REL}`);
if (!fs.existsSync(path.join(ROOT, TEMPLATE_REL))) preflight.push(`客户端模板不存在：${TEMPLATE_REL}（先 cd frontend && npm run build && node scripts/patch-index-bootstrap.js frontend/dist）`);
if (preflight.length) {
    console.error('环境检查失败：');
    preflight.forEach(p => console.error('  - ' + p));
    process.exit(1);
}
process.env.SSR_BUNDLE = BUNDLE_REL;

const ssr = require('../lib/ssr');
const prefetch = require('../lib/prefetch');
const db = require('../database');

/* ==================== 结果记录 ==================== */

const results = { pass: 0, fail: 0, skip: 0, failures: [] };

function pass(label, detail = '') {
    results.pass += 1;
    console.log(`  ✓ ${label}${detail ? '  ' + detail : ''}`);
}
function fail(label, detail = '') {
    results.fail += 1;
    results.failures.push(`${label}${detail ? ' → ' + detail : ''}`);
    console.log(`  ✗ ${label}${detail ? '  ' + detail : ''}`);
}
function skip(label, detail = '') {
    results.skip += 1;
    console.log(`  - ${label}${detail ? '  ' + detail : ''}`);
}
function section(title) {
    console.log('\n' + title);
}

/* ==================== 渲染与校验 ==================== */

function kb(bytes) { return (bytes / 1024).toFixed(1) + 'KB'; }

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function tryRender(url, ctx = {}) {
    const t0 = Date.now();
    try {
        const out = await ssr.renderUrl(url, ctx);
        return { out, ms: Date.now() - t0, error: null };
    } catch (e) {
        return { out: null, ms: Date.now() - t0, error: (e && e.message) || String(e) };
    }
}

/**
 * 生产形态的 ctx：server.js 里 ssr.middleware() 传给 renderUrl 的是 { req }，
 * 而 lib/ssr.js 只把 pathname 交给 provider.load —— provider 想看 query 只能靠 ctx.req.originalUrl。
 * 带查询参数的用例必须用这个 ctx，否则测不出「有 query 就不预取」的行为。
 */
function prodCtx(url) {
    return { req: { originalUrl: url, url } };
}

/** 通用 HTML 校验 → { errs, bytes, title } */
function inspectHtml(html, { allowDefaultTitle = false, expectAny = [] } = {}) {
    const errs = [];
    const bytes = Buffer.byteLength(html, 'utf8');
    if (bytes < MIN_HTML_BYTES) errs.push(`HTML 仅 ${kb(bytes)}（要求 ≥ 8KB）`);
    if (!html.includes('__SSR_DATA__')) errs.push('缺少 window.__SSR_DATA__ 注入');
    const title = ((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    if (!title) errs.push('没有 <title>');
    else if (!allowDefaultTitle && title === DEFAULT_TITLE) errs.push(`<title> 仍是站点默认标题「${DEFAULT_TITLE}」`);

    const needles = expectAny.filter(Boolean).flatMap(s => [String(s), esc(s)]);
    if (needles.length && !needles.some(s => html.includes(s))) {
        errs.push(`未命中真实数据特征串（应为：${expectAny.filter(Boolean).slice(0, 2).join(' / ')}）`);
    }
    return { errs, bytes, title };
}

/* ==================== 路由样本（真实数据 + 正则反推） ==================== */

/** 从只读副本里取真实样本值，保证渲染的是「存在的资源」 */
async function loadSamples(enumerated) {
    const one = async (sql, params = []) => { try { return await db.get(sql, params); } catch { return null; } };
    const many = async (sql, params = []) => { try { return await db.all(sql, params); } catch { return []; } };

    const post = await one("SELECT id, title FROM posts WHERE status='active' ORDER BY id DESC LIMIT 1");
    const user = await one(
        `SELECT u.username, u.nickname FROM users u
          WHERE u.is_frozen = 0
            AND EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id AND p.status = 'active')
          ORDER BY u.contribution DESC, u.id ASC LIMIT 1`
    ) || await one('SELECT username, nickname FROM users WHERE is_frozen = 0 ORDER BY id ASC LIMIT 1');

    // wiki 分类 / 文章 slug 直接取 enumerate 出来的真实路径，避免猜表结构
    const catUrl = enumerated.find(r => /^\/wiki\/category\/[^/]+$/.test(r.url));
    const pageUrl = enumerated.find(r => /^\/wiki\/[a-z0-9-]+$/.test(r.url) && !r.url.startsWith('/wiki/category/'));

    const daily = await one("SELECT title FROM posts WHERE status='active' AND type='daily' ORDER BY is_pinned DESC, created_at DESC LIMIT 1");
    const decision = await one("SELECT title FROM posts WHERE status='active' AND type='decision' ORDER BY is_pinned DESC, created_at DESC LIMIT 1");
    const projection = await one('SELECT title FROM projections ORDER BY id DESC LIMIT 1');

    // 每条 wiki 路径 → 自己的标题（逐页校验，不能用同一个标题）
    const wikiTitles = {};
    for (const row of await many("SELECT slug, title FROM wiki_pages WHERE status = 'published'")) {
        if (row && row.slug) wikiTitles[`/wiki/${row.slug}`] = row.title;
    }
    const catNames = {};
    for (const row of await many('SELECT slug, name FROM wiki_categories')) {
        if (row && row.slug) catNames[`/wiki/category/${row.slug}`] = row.name;
    }

    const pageSlug = pageUrl ? pageUrl.url.split('/').pop() : 'about';

    return {
        postId: post ? post.id : 1,
        postTitle: post && post.title,
        username: user ? user.username : 'admin',
        nickname: user && user.nickname,
        catSlug: catUrl ? catUrl.url.split('/').pop() : 'category',
        pageSlug,
        wikiTitle: wikiTitles[`/wiki/${pageSlug}`],
        wikiTitles,
        catNames,
        dailyTitle: daily && daily.title,
        decisionTitle: decision && decision.title,
        projectionTitle: projection && projection.title
    };
}

/**
 * describe() 给的是 String(regex)（形如 `/^\/post\/\d+$/`，含首尾斜杠），这里还原成真正的 RegExp。
 * 解析不出来返回 null（该 provider 的这条路由就不参与样本反推）。
 */
function parseRegex(str) {
    const s = String(str);
    const m = /^\/([\s\S]*)\/([gimsuy]*)$/.exec(s);
    try {
        return m ? new RegExp(m[1], m[2]) : new RegExp(s);
    } catch {
        return null;
    }
}

/**
 * 把 provider 的正则反推成一个具体路径（`/post/\d+` → `/post/143`）。
 * 反推不出来（含复杂分组）时返回 null → 该条跳过，不算失败。
 */
function sampleFromRegex(re, s) {
    let src = re.source;
    if (src.startsWith('^')) src = src.slice(1);
    if (src.endsWith('$')) src = src.slice(0, -1);
    src = src.replace(/\\\//g, '/');
    src = src.replace(/\(\?:[^()]*\)/g, 'x');

    const isWiki = /wiki/.test(re.source);

    src = src.replace(/\[0-9\]\+|\\d\+/g, String(s.postId));
    src = src.replace(/\[a-z0-9-\]\+|\[a-z0-9_-\]\+/g, s.pageSlug);
    src = src.replace(/\[A-Za-z0-9_-\]\+/g, isWiki ? s.pageSlug : s.username);
    // `[^/]+`：Wiki 路径用分类 slug，其余（/profile/:username 等）用真实用户名
    src = src.replace(/\[\^\/\]\+|\[a-z\]\+|\[A-Za-z\]\+/g, isWiki ? s.catSlug : s.username);
    src = src.replace(/\/\?/g, '');                 // `/wiki/?` → `/wiki`
    src = src.replace(/\/{2,}/g, '/');

    if (/[\\()|+*?[\]{}^$]/.test(src)) return null; // 还有正则元字符 → 反推失败
    if (!src.startsWith('/')) src = '/' + src;
    return src.replace(/\/+$/, '') || '/';
}

/**
 * 已知路由的真实数据特征串（任一命中即通过）。
 * 只对本仓库内已落地、SQL 与 API 对齐的 provider 断言内容特征；
 * 其它并行开发中的页面（/gmirs、/gdars、/rankings、/donation…）只做结构断言，
 * 避免把测试绑死在别人的页面文案上。
 */
function expectedFor(url, s) {
    const clean = url.split('?')[0];
    if (clean === '/') return ['玄剑'];
    if (/^\/posts?\/\d+$/.test(clean)) return [s.postTitle];
    if (/^\/profile\/[^/]+$/.test(clean)) return [s.username, s.nickname];
    if (clean === '/mods') return ['游戏模组', 'xuanjianmod'];   // 纯静态页：页面自身文案
    if (clean === '/daily') return [s.dailyTitle];
    if (clean === '/decision') return [s.decisionTitle];
    if (clean === '/projections') return [s.projectionTitle];
    if (clean === '/wiki' || clean === '/wiki/') return ['玄剑 Wiki'];
    if (/^\/wiki\/category\/[^/]+$/.test(clean)) return [s.catNames[clean]];
    if (/^\/wiki\/[a-z0-9-]+$/.test(clean)) return [s.wikiTitles[clean]];
    return [];
}

/* ==================== 主流程 ==================== */

(async () => {
    const providers = prefetch.describe();
    const ignored = String(process.env.SSR_TEST_IGNORE_PROVIDERS || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    const enumerated = (await prefetch.listSsgRoutes()).filter(r => !ignored.includes(r.provider));
    const samples = await loadSamples(enumerated);

    console.log('=== 三层渲染自检（SSG / SSR / SPA） ===');
    console.log('  数据库        ' + DB_REL);
    console.log('  SSR 产物      ' + BUNDLE_REL);
    console.log('  客户端模板    ' + TEMPLATE_REL);
    console.log('  测试数据      ' + `post#${samples.postId}（${samples.postTitle || '?'}）`
        + ` / profile@${samples.username} / wiki「${samples.wikiTitle || samples.pageSlug}」`);
    if (ignored.length) console.log(`  ⚠ 已按 SSR_TEST_IGNORE_PROVIDERS 忽略：${ignored.join(', ')}（对应路由计入跳过）`);

    /* ---------- [1] Provider 注册表 ---------- */
    section(`[1/5] Provider 注册表（${providers.length} 个）`);
    if (!providers.length) fail('一个 provider 都没注册（lib/prefetch/*.js）');
    for (const p of providers) {
        const label = `${p.name}（${p.file}）`;
        if (ignored.includes(p.name)) { skip(label, '按 SSR_TEST_IGNORE_PROVIDERS 忽略（模拟未落地）'); continue; }
        if (!p.name) { fail(label, '缺少 name'); continue; }
        if (!p.ssg.length && !p.ssr.length) { fail(label, 'ssg 与 ssr 都为空（必须至少声明一种）'); continue; }
        pass(label, `ssg=${p.ssg.length} ssr=${p.ssr.length} enumerate=${p.enumerable ? 'yes' : 'no'}`);
    }

    /* ---------- [2] 已注册路由逐个渲染 ---------- */
    // 候选 = 站点已知路由 + enumerate 出来的具体 SSG 路由 + 所有 provider 正则反推出的样本。
    // 站点已知路由是固定的：哪个 provider 还没落地，它的路由就会被计入「跳过」而不是失败。
    const candidates = [];          // { url, source }
    const seen = new Set();
    const pushCandidate = (url, source) => {
        const clean = url.split('?')[0];
        if (seen.has(clean)) return;
        seen.add(clean);
        candidates.push({ url: clean, source });
    };

    for (const url of KNOWN_ROUTES) pushCandidate(url, 'known');
    pushCandidate(`/post/${samples.postId}`, 'known');
    pushCandidate(`/posts/${samples.postId}`, 'known');
    pushCandidate(`/profile/${samples.username}`, 'known');

    let listed = enumerated;
    let capped = 0;
    if (listed.length > MAX_ENUMERATED) {
        const step = Math.ceil(listed.length / MAX_ENUMERATED);
        capped = listed.length - Math.ceil(listed.length / step);
        listed = listed.filter((_, i) => i % step === 0);
    }
    for (const r of listed) pushCandidate(r.url, `enumerate(${r.provider})`);

    let unbuildable = [];
    for (const p of providers) {
        for (const [kind, list] of [['ssg', p.ssg], ['ssr', p.ssr]]) {
            for (const reSrc of list) {
                const re = parseRegex(reSrc);
                if (!re) { unbuildable.push(`${p.name}.${kind} ${reSrc}（正则解析失败）`); continue; }
                const sample = sampleFromRegex(re, samples);
                if (!sample) { unbuildable.push(`${p.name}.${kind} ${reSrc}`); continue; }
                if (!re.test(sample)) { unbuildable.push(`${p.name}.${kind} ${reSrc} → ${sample}（反推结果不匹配）`); continue; }
                pushCandidate(sample, `${p.name}.${kind}`);
            }
        }
    }

    section(`[2/5] 已注册路由渲染（${candidates.length} 条候选，未注册的跳过）`);
    if (capped) console.log(`  （enumerated SSG 路由过多，已按间隔抽样，跳过 ${capped} 条）`);
    if (unbuildable.length) console.log(`  （${unbuildable.length} 条正则无法反推样本，见末尾备注）`);

    for (const c of candidates) {
        const label = `${c.url}  ← ${c.source}`;
        const hit = prefetch.classify(c.url);

        if (!hit) {
            const fromEnumerate = c.source.startsWith('enumerate');
            if (fromEnumerate) fail(label, 'enumerate() 登记了这条路由，但 classify() 认不出渲染模式');
            else skip(label, '未注册渲染模式（保持 SPA，对应 provider 未落地时属正常）');
            continue;
        }
        if (ignored.includes(hit.provider.name)) {
            skip(label, `provider ${hit.provider.name} 未落地（按 SSR_TEST_IGNORE_PROVIDERS 模拟）`);
            continue;
        }
        if (c.source.startsWith('enumerate') && hit.mode !== 'ssg') {
            fail(label, `enumerate() 登记为 SSG，但 classify() 判成 ${hit.mode}`);
            continue;
        }

        const { out, ms, error } = await tryRender(c.url);
        if (error) { fail(label, '渲染抛异常：' + error); continue; }
        if (!out || !out.html) {
            fail(label, `renderUrl() 返回 null（mode=${hit.mode}）—— 存在的资源必须能服务端渲染`);
            continue;
        }
        const { errs, bytes, title } = inspectHtml(out.html, {
            allowDefaultTitle: c.url === '/' || c.url === '/home',
            expectAny: expectedFor(c.url, samples)
        });
        if (errs.length) { fail(label, errs.join('；')); continue; }
        pass(label, `${kb(bytes)} ${out.mode}/${ms}ms title=${title}`);
    }

    /* ---------- [3] 不存在的资源必须返回 null ---------- */
    section('[3/5] 不存在的资源必须返回 null（交回 SPA）');
    const missing = [
        '/post/99999999',
        '/posts/99999999',
        '/wiki/not-exist-slug',
        '/profile/no-such-user-20261003'
    ];
    for (const url of missing) {
        const hit = prefetch.classify(url);
        const { out, error } = await tryRender(url);
        if (error) { fail(url, '渲染抛异常：' + error); continue; }
        if (out) {
            fail(url, `不存在的资源却渲染出了 ${kb(Buffer.byteLength(out.html, 'utf8'))} HTML（mode=${out.mode}）`);
            continue;
        }
        pass(url, hit ? `provider 返回 null（mode=${hit.mode}）` : '未注册渲染模式，renderUrl() 返回 null');
    }

    /* ---------- [4] 带查询参数的非预取形态 ---------- */
    section('[4/5] 带查询参数的非预取形态（生产形态 ctx：req.originalUrl 带 query）');
    const queryForms = [
        '/rankings?type=contribution',
        '/rankings?type=online',
        '/gmirs?keyword=x',
        '/daily?page=2',
        '/decision?search=玄剑',
        '/wiki/search?q=玄剑',
        '/no-such-page-20261003?x=1'
    ];
    for (const url of queryForms) {
        const pathname = url.split('?')[0];
        const hit = prefetch.classify(pathname);
        if (hit && ignored.includes(hit.provider.name)) {
            skip(url, `provider ${hit.provider.name} 未落地（按 SSR_TEST_IGNORE_PROVIDERS 模拟）`);
            continue;
        }
        const { out, error } = await tryRender(url, prodCtx(url));
        if (error) { fail(url, '渲染抛异常：' + error); continue; }
        if (!hit) {
            // 未注册：必须彻底是 null，绝不能凭空渲染
            if (out) fail(url, `未注册的路径却渲染出了 ${kb(Buffer.byteLength(out.html, 'utf8'))} HTML`);
            else pass(url, '未注册渲染模式 → null（保持 SPA）');
            continue;
        }
        if (!out) {
            pass(url, `provider 返回 null（mode=${hit.mode}）→ 交回 SPA`);
            continue;
        }
        // 已注册的 pathname：provider 不看 query（如 content-list.js 的有意设计），
        // 服务端按 pathname 命中、发的是「无参数首版」，翻页/筛选由客户端接管 ——
        // 此时必须与无参数版逐字节一致，否则首屏会错位。
        const base = await tryRender(pathname, prodCtx(pathname));
        if (!base.out) {
            fail(url, `带查询参数返回了 HTML，但无参数版 ${pathname} 返回 null，行为不一致`);
            continue;
        }
        if (base.out.html !== out.html) {
            fail(url, `带查询参数的 HTML 与无参数版 ${pathname} 不一致（查询参数不应参与服务端预取）`);
            continue;
        }
        pass(url, `已注册（${hit.mode}）但不看 query：输出 = ${pathname} 的无参数首版，翻页/筛选交给客户端`);
    }

    /* ---------- [5] 汇总 ---------- */
    section('[5/5] 汇总');
    if (unbuildable.length) {
        console.log('  备注：以下正则无法反推样本路径（未参与断言）：');
        unbuildable.forEach(u => console.log('   - ' + u));
    }
    console.log(`  通过 ${results.pass} / 失败 ${results.fail}`);
    console.log(`  跳过 ${results.skip} 条（未注册渲染模式的路由属正常跳过）`);
    if (results.failures.length) {
        console.log('  失败明细：');
        results.failures.forEach(f => console.log('   - ' + f));
    }
    try { db.close(); } catch { /* 忽略 */ }
    process.exit(results.fail ? 1 : 0);
})().catch(e => {
    console.error('测试脚本异常：' + (e && e.stack ? e.stack : e));
    try { db.close(); } catch { /* 忽略 */ }
    process.exit(1);
});
