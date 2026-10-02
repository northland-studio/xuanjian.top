/**
 * 预取 Provider 注册表
 *
 * 每个 lib/prefetch/<name>.js 导出：
 *   {
 *     name: 'wiki',                          // 数据 key（页面用 useServerData('wikiHome') 取）
 *     ssg: [/^\/wiki$/],                     // 需要预渲染成静态 HTML 的路由（构建/发布时生成）
 *     ssr: [/^\/post\/\d+$/],                // 需要按请求服务端渲染的路由
 *     load(pathname, ctx) -> object|null,    // 返回 { [key]: data }，会合并进 __SSR_DATA__
 *     enumerate() -> string[]                // 可选：SSG 需要生成的完整路径列表（动态路由用）
 *   }
 *
 * 新增页面渲染模式时**只需要加一个文件**，不用改 lib/ssr.js 或 server.js。
 */
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

let cache = null;

function loadProviders() {
    if (cache) return cache;
    cache = [];
    for (const file of fs.readdirSync(__dirname).sort()) {
        if (file === 'index.js' || !file.endsWith('.js')) continue;
        try {
            const mod = require(path.join(__dirname, file));
            if (mod && mod.name && (mod.ssg || mod.ssr)) {
                cache.push({ ...mod, file });
            } else {
                logger.warn(`lib/prefetch/${file} 缺少 name/ssg/ssr，已忽略`);
            }
        } catch (e) {
            logger.error(`加载 lib/prefetch/${file} 失败:`, e.message);
        }
    }
    return cache;
}

/** 判断某路径属于哪种渲染模式：'ssg' | 'ssr' | null（null = 保持纯 SPA） */
function classify(pathname) {
    const providers = loadProviders();
    for (const p of providers) {
        if ((p.ssg || []).some(re => re.test(pathname))) return { mode: 'ssg', provider: p };
    }
    for (const p of providers) {
        if ((p.ssr || []).some(re => re.test(pathname))) return { mode: 'ssr', provider: p };
    }
    return null;
}

/** 取某路径服务端渲染所需的数据（合并成一个 { [key]: data } 对象） */
async function loadData(pathname, ctx = {}) {
    const hit = classify(pathname);
    if (!hit) return { mode: null, data: null, provider: null };
    let data = null;
    try {
        data = await hit.provider.load(pathname, ctx);
    } catch (e) {
        logger.error(`预取数据失败（${hit.provider.name} ${pathname}）:`, e.message);
        data = null;
    }
    return { mode: hit.mode, provider: hit.provider.name, data: data || null };
}

/** 汇总所有 SSG 路由（用于 scripts/prerender.js） */
async function listSsgRoutes() {
    const out = [];
    for (const p of loadProviders()) {
        if (!(p.ssg || []).length) continue;
        if (typeof p.enumerate === 'function') {
            const paths = await p.enumerate();
            for (const url of paths || []) out.push({ url, provider: p.name });
        }
    }
    return out;
}

/** 调试用：列出所有 provider 及其路由 */
function describe() {
    return loadProviders().map(p => ({
        name: p.name,
        file: p.file,
        ssg: (p.ssg || []).map(String),
        ssr: (p.ssr || []).map(String),
        enumerable: typeof p.enumerate === 'function'
    }));
}

module.exports = { classify, loadData, listSsgRoutes, describe, loadProviders };
