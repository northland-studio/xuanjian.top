#!/usr/bin/env node
/**
 * 玄剑公会官网 API 文档生成器
 *
 * 用法：node scripts/gen-api-docs.js [输出路径，默认 docs/API.md]
 *
 * 为什么用生成而不是手写：官网有 35 个路由文件、数百个端点，手写必然与代码漂移。
 * 这里直接从 server.js 的挂载关系 + 各 routes/*.js 的 router.xxx() 定义解析出来，
 * 说明文字取路由上方紧邻的注释；改完接口只要重跑本脚本。
 *
 * 解析约定（与仓库现有风格一致）：
 *   - 挂载：app.use('/api/xxx', xxxRoutes)
 *   - 路由：router.<method>('<path>', [中间件...], async (req, res) => {...})
 *   - 说明：路由上方紧邻的 // 注释行（多行会合并；去掉行首的 //）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'API.md');

/* ---------------- 鉴权说明 ---------------- */
const AUTH_LABELS = {
    authMiddleware: 'JWT 登录',
    adminMiddleware: '管理员（需 JWT）',
    superAdminMiddleware: '超级管理员（需 JWT）',
    optionalAuthMiddleware: '登录可选',
    playerAuth: 'X-Server-Key（可选）+ uuid 已绑定',
    serverKeyAuth: 'X-Server-Key',
    requireServerKey: 'X-Server-Key'
};

/* ---------------- 1. 解析 server.js 的挂载关系 ---------------- */
function parseMounts() {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const mounts = new Map();      // 变量名 -> 挂载路径
    const unmounted = [];
    for (const rawLine of src.split('\n')) {
        const line = rawLine.trim();
        const m = line.match(/^app\.use\(\s*'([^']+)'\s*,\s*([A-Za-z0-9_]+)\s*\)\s*;/);
        if (m) {
            mounts.set(m[2], m[1]);
            continue;
        }
        // 被注释掉的挂载（例如 stock），单独列出来提示
        const c = line.match(/^\/\/\s*app\.use\(\s*'([^']+)'\s*,\s*([A-Za-z0-9_]+)\s*\)\s*;/);
        if (c) unmounted.push({ mount: c[1], variable: c[2] });
    }
    return { mounts, unmounted };
}

/**
 * 从 server.js 的 require 语句推导「路由文件名 -> 变量名」。
 * 例如 const modRoutes = require('./routes/mod');  → mod.js -> modRoutes
 * 比在代码里硬编码文件名映射可靠得多（新增路由文件不用改生成器）。
 */
function parseRequires() {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const map = new Map();
    for (const line of src.split('\n')) {
        const m = line.match(/const\s+([A-Za-z0-9_]+)\s*=\s*require\(\s*'\.\/routes\/([A-Za-z0-9_-]+)'\s*\)/)
            || line.match(/const\s*\{\s*router\s*:\s*([A-Za-z0-9_]+)\s*\}\s*=\s*require\(\s*'\.\/routes\/([A-Za-z0-9_-]+)'\s*\)/);
        if (m) map.set(m[2], m[1]);
    }
    return map;
}

/* ---------------- 2. 解析单个路由文件 ---------------- */
function parseRoutes(file, mount) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/router\.(get|post|put|delete|patch)\(\s*'([^']*)'/);
        if (!m) continue;

        const method = m[1].toUpperCase();
        const sub = m[2];

        // 取紧邻上方的注释作为说明：优先 /** ... */ 文档注释，其次连续的 // 行注释
        const notes = [];
        if (i > 0 && lines[i - 1].trim() === '*/') {
            const block = [];
            for (let j = i - 2; j >= 0; j--) {
                const t = lines[j].trim();
                if (t.startsWith('/**')) break;
                block.unshift(t.replace(/^\*\s?/, '').trim());
                if (j === 0) break;
            }
            if (block.join('').indexOf('====') < 0) {
                notes.push(...block.filter(x => x));
            }
        }
        if (notes.length === 0) {
            for (let j = i - 1; j >= 0; j--) {
                const t = lines[j].trim();
                if (t.startsWith('//')) {
                    notes.unshift(t.replace(/^\/\/\s?/, ''));
                } else if (t === '') {
                    if (notes.length === 0 && j === i - 1) continue;
                    break;
                } else {
                    break;
                }
            }
        }

        // 中间件：路径参数之后、形如 xxx, 的标识符（最多往下看 2 行，兼容换行写法）
        const window = lines.slice(i, i + 3).join(' ');
        const afterPath = window.slice(window.indexOf(`'${sub}'`) + sub.length + 2);
        const args = afterPath.split(/,\s*/);
        const middlewares = [];
        for (const a of args) {
            const name = a.trim().split(/[\s(]/)[0];
            if (AUTH_LABELS[name]) {
                const label = AUTH_LABELS[name];
                // admin/superAdmin 是链在 authMiddleware 之后的，本身已含 JWT：
                // 出现时就地把前面的「JWT 登录」去掉，避免显示成「JWT 登录 + 管理员（需 JWT）」
                if (name === 'adminMiddleware' || name === 'superAdminMiddleware') {
                    const idx = middlewares.indexOf(AUTH_LABELS.authMiddleware);
                    if (idx >= 0) middlewares.splice(idx, 1);
                }
                middlewares.push(label);
            }
            else if (/^(async\s*)?\(?\s*(req|_req)/.test(a.trim()) || a.includes('=>')) break;
        }

        out.push({
            method,
            full: mount + sub,
            auth: middlewares.length ? Array.from(new Set(middlewares)).join(' + ') : '公开',
            note: notes.join(' / ') || ''
        });
    }
    return out;
}

/* ---------------- 3. 生成文档 ---------------- */
const { mounts, unmounted } = parseMounts();
const requires = parseRequires();
const routeFiles = fs.readdirSync(path.join(ROOT, 'routes')).filter(f => f.endsWith('.js')).sort();

const modules = [];
for (const file of routeFiles) {
    const base = file.replace(/\.js$/, '');
    const variable = requires.get(base) || null;
    // 挂载路径优先用 server.js 的真实挂载；没有的按 '/api/<name>' 推测并标注
    let mount = mounts.get(variable);
    let note = '';
    if (!mount) {
        if (unmounted.some(u => u.variable === variable)) {
            mount = unmounted.find(u => u.variable === variable).mount;
            note = '（未挂载）';
        } else {
            mount = '/api/' + file.replace('.js', '');
            note = '（挂载路径未在 server.js 找到，按文件名推测）';
        }
    }
    const routes = parseRoutes(path.join(ROOT, 'routes', file), mount).sort((a, b) =>
        a.full.localeCompare(b.full) || a.method.localeCompare(b.method));
    if (routes.length) modules.push({ file, mount, note, routes });
}

const total = modules.reduce((s, m) => s + m.routes.length, 0);

const head = `# 玄剑公会官网 API 参考

> 本文件由 \`scripts/gen-api-docs.js\` 从 \`server.js\` 与 \`routes/*.js\` 自动生成，
> 请勿手工编辑：改完接口后在仓库根目录执行 \`node scripts/gen-api-docs.js\` 重新生成。
>
> 生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC ｜ 共 ${modules.length} 个模块、${total} 个端点

## 通用约定

| 项 | 说明 |
|---|---|
| Base URL | \`https://xuanjian.top\`（本地开发为 \`http://127.0.0.1:3000\`） |
| 请求/响应格式 | JSON（\`Content-Type: application/json\`）；文件上传用 \`multipart/form-data\` |
| 时间格式 | 字符串 \`YYYY-MM-DD HH:MM:SS\`，**UTC+8 本地时间**（服务端 \`getLocalTimestamp()\`） |
| 错误格式 | \`{ "error": "中文原因" }\`；HTTP 400 参数错误 / 401 未认证 / 403 无权限 / 404 不存在 / 429 触发限流 / 500 服务端异常 |
| 限流 | 全站 \`/api/\` 前缀有 express-rate-limit；登录、验证码等接口另有更严格的独立限流 |
| 鉴权-JWT | 请求头 \`Authorization: Bearer <token>\`（登录接口返回），用于官网前端 |
| 鉴权-Server-Key | 请求头 \`X-Server-Key: <key>\`，取自后台「服务器密钥」（\`mod_servers.server_key\`），用于模组/插件等服务端调用 |
| 鉴权-玩家级 | 模组接口在 Server-Key 之外还要求 \`uuid\`（query/body/header \`X-Player-Uuid\`）且该角色已绑定官网账号 |

## 模块索引

| 挂载路径 | 路由文件 | 端点数 | 备注 |
|---|---|---|---|
${modules.map(m => `| \`${m.mount}\` | \`routes/${m.file}\` | ${m.routes.length} | ${m.note || '—'} |`).join('\n')}
`;

const body = modules.map(m => {
    const rows = m.routes.map(r =>
        `| \`${r.method}\` | \`${r.full}\` | ${r.auth} | ${(r.note || '—').replace(/\|/g, '\\|')} |`
    ).join('\n');
    return `## ${m.mount}${m.note ? ' ' + m.note : ''}\n\n文件：\`routes/${m.file}\`（${m.routes.length} 个端点）\n\n| 方法 | 路径 | 鉴权 | 说明 |\n|---|---|---|---|\n${rows}\n`;
}).join('\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, head + '\n' + body, 'utf8');
console.log(`已生成 ${OUT}`);
console.log(`模块 ${modules.length} 个，端点 ${total} 个`);
for (const m of modules) console.log(`  ${m.mount.padEnd(26)} ${m.routes.length} 条  ${m.note}`);
if (unmounted.length) console.log('未挂载（server.js 中被注释）：' + unmounted.map(u => u.mount).join(', '));
