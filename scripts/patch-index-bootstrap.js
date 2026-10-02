#!/usr/bin/env node
/**
 * 构建产物 index.html 的「Rocket Loader 免疫」补丁
 *
 * 背景：Cloudflare 的 Rocket Loader 会把 HTML 里的
 *   <script type="module" crossorigin src="/assets/index-xxx.js"></script>
 * 改写成
 *   <script type="<随机 hash>-module" crossorigin src="/assets/index-xxx.js"></script>
 * 浏览器不认识这个 type，于是**根本不执行入口脚本** → Vite SPA 整站白屏
 * （Rocket Loader 官方也不支持 module 脚本）。Static 文件里的 modulepreload 不受影响。
 *
 * 做法：把入口脚本改成「经典内联脚本 + 运行时动态创建 module 脚本」。
 * Rocket Loader 只改写 HTML 源码里的标签，运行时由 JS 创建的 <script type="module"> 它碰不到，
 * 因此入口一定能按 ES module 语义执行。内联的经典脚本仍由 RL 正常延迟执行（RL 的本职）。
 *
 * 用法：node scripts/patch-index-bootstrap.js [dist 目录，默认 frontend/dist]
 * 幂等：已打过补丁（含 __RL_BOOTSTRAP__ 标记）就直接退出。
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || path.join(__dirname, '..', 'frontend', 'dist');
const file = path.join(dir, 'index.html');

if (!fs.existsSync(file)) {
    console.error('找不到 index.html：' + file);
    process.exit(1);
}

let html = fs.readFileSync(file, 'utf8');

if (html.includes('__RL_BOOTSTRAP__')) {
    console.log('已打过补丁，跳过：' + file);
    process.exit(0);
}

const entryRe = /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g;
const matches = [...html.matchAll(entryRe)];
if (!matches.length) {
    console.error('没找到入口 module 脚本（构建产物异常？）：' + file);
    process.exit(1);
}

const entry = matches[0][1];
const bootstrap = `<script>
/* __RL_BOOTSTRAP__ Cloudflare Rocket Loader 会把 type="module" 改写成 <hash>-module（浏览器不执行 → 白屏）。
   所以入口脚本改为运行时动态插入：RL 只改写 HTML 源码里的标签，不会碰运行时创建的标签。 */
(function () {
  var s = document.createElement('script');
  s.type = 'module';
  s.crossOrigin = 'anonymous';
  s.src = '${entry}';
  document.head.appendChild(s);
})();
</script>`;

html = html.replace(matches[0][0], bootstrap);
fs.writeFileSync(file, html, 'utf8');
console.log(`已注入入口自举脚本：${entry}（${file}）`);
