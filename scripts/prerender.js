#!/usr/bin/env node
/**
 * SSG 预渲染：把 lib/prefetch/* 里登记为 ssg 的路由渲染成静态 HTML
 *
 * 用法（在能访问数据库的环境执行 —— 生产上就是服务器本机）：
 *   node scripts/prerender.js                 # 渲染全部登记路由
 *   node scripts/prerender.js --clean         # 先清空旧产物再渲染
 *   node scripts/prerender.js --only=/wiki    # 只渲染匹配该前缀的路由
 *   node scripts/prerender.js --list          # 只打印将要渲染的路径
 *
 * 产物落在 frontend/prerender/<路径>.html，由 lib/ssr.js 中间件直接返回（Cache-Control 10 分钟）。
 * 内容变更时由业务代码调用 lib/ssr.js 的 invalidate(url) 删除对应文件，下次请求按需重建。
 */
const fs = require('fs');
const path = require('path');
const ssr = require('../lib/ssr');
const prefetch = require('../lib/prefetch');
const logger = require('../lib/logger');

function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : undefined;
}

(async () => {
    const only = arg('--only');
    const clean = !!arg('--clean');
    const listOnly = !!arg('--list');

    const routes = await prefetch.listSsgRoutes();
    const targets = routes.filter(r => !only || r.url.startsWith(String(only)));

    if (listOnly) {
        console.log(`SSG 路由 ${targets.length} 条：`);
        targets.forEach(r => console.log(`  ${r.url}  ← ${r.provider}`));
        process.exit(0);
    }

    if (clean) {
        fs.rmSync(ssr.paths.PRERENDER_DIR, { recursive: true, force: true });
        console.log('已清空旧产物：' + ssr.paths.PRERENDER_DIR);
    }

    console.log(`开始预渲染 ${targets.length} 个页面 → ${ssr.paths.PRERENDER_DIR}`);
    const t0 = Date.now();
    let ok = 0, fail = 0;
    const failed = [];

    for (const r of targets) {
        try {
            const out = await ssr.renderUrl(r.url, {});
            if (!out || !out.html) throw new Error('渲染返回空');
            ssr.writeSsgFile(r.url, out.html);
            ok += 1;
            if (ok % 25 === 0) console.log(`  …已渲染 ${ok}/${targets.length}`);
        } catch (e) {
            fail += 1;
            failed.push(`${r.url} → ${e.message}`);
        }
    }

    // 自检：产物数量与文件大小
    const files = fs.existsSync(ssr.paths.PRERENDER_DIR)
        ? fs.readdirSync(ssr.paths.PRERENDER_DIR).filter(f => f.endsWith('.html'))
        : [];
    const empty = files.filter(f => fs.statSync(path.join(ssr.paths.PRERENDER_DIR, f)).size < 2000);

    console.log('\n--- 预渲染结果 ---');
    console.log(`  成功 ${ok} / 失败 ${fail} / 产物文件 ${files.length} 个，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (empty.length) console.log(`  ⚠ 疑似空壳（<2KB）：${empty.slice(0, 5).join(', ')}`);
    if (failed.length) {
        console.log('  失败明细：');
        failed.slice(0, 10).forEach(f => console.log('   - ' + f));
    }
    process.exit(fail ? 1 : 0);
})().catch(e => {
    logger.error('预渲染失败:', e.message);
    console.error('预渲染失败：' + e.message);
    process.exit(1);
});
