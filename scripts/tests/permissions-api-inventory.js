/**
 * 全站受保护 API 权限迁移状态盘点（静态扫描，只读）
 *
 * 用法：node scripts/tests/permissions-api-inventory.js [--md <输出文件>]
 * 输出：每个路由文件的受保护接口 → 鉴权方式分类（细粒度权限 / Level 兼容层 / 登录用户 / 服务间令牌 / 处理函数内鉴权 / 公开）
 * 用途：交付报告的「全站受保护 API 迁移清单」，防止「前端隐藏按钮、后端无鉴权」。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ROUTES_DIR = path.join(ROOT, 'routes');

const files = fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js')).sort();
const rows = [];

function buildAliasMap(src) {
    const map = {};
    const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\[([^\]]*)\]\s*;/g;
    let m;
    while ((m = re.exec(src))) {
        const name = m[1];
        const body = m[2];
        if (/Middleware|Permission|guard|official|require/i.test(body)) map[name] = body;
    }
    return map;
}

function expandAliases(mw, aliasMap) {
    let out = mw;
    for (const [name, body] of Object.entries(aliasMap)) {
        if (new RegExp(`\\b${name}\\b`).test(out)) out += ' ' + body;
    }
    return out;
}

function classifyAuth(mw, handlerPreview) {
    if (/requirePermission|adminOrPermission/.test(mw)) {
        const req = [...mw.matchAll(/requirePermission\('([^']+)'\)/g)].map(x => x[1]);
        return { auth: '细粒度权限（已迁移）', detail: req.join(', ') };
    }
    if (/superAdminMiddleware/.test(mw)) return { auth: 'Level 兼容层（superAdmin，Level 2）' };
    if (/adminMiddleware/.test(mw)) return { auth: 'Level 兼容层（admin，Level >= 1）' };
    if (/authMiddleware/.test(mw)) return { auth: '登录用户（普通业务/用户自助）' };
    if (/playerAuth|paygateAuth|botAuth|serverAuth|internalAuth|X-Server-Key/i.test(mw)) {
        return { auth: '服务间/玩家令牌鉴权' };
    }
    if (/optionalAuthMiddleware/.test(mw)) return { auth: '可选登录（公开）' };
    if (/Limiter|limiter/.test(mw)) return { auth: '公开（仅限流）' };
    // 处理函数内鉴权（如 mod.js /admin/claims 的 X-Server-Key / Level>=1 判断）
    if (/x-server-key|x-bot-token|isAdminPlayer|isServer|无权限|仅官网管理员|鉴权/.test(handlerPreview)) {
        return { auth: '处理函数内鉴权（服务间令牌/管理员）' };
    }
    return { auth: '公开' };
}

for (const file of files) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const lines = src.split(/\r?\n/);
    const aliasMap = buildAliasMap(src);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/router\.(get|post|put|delete|patch)\(\s*(['"`])([^'"`]+)\2\s*,\s*(.*)$/);
        if (!m) continue;
        let mw = m[4] || '';
        for (let k = 1; k <= 3; k++) {
            if (lines[i + k] && /Middleware|Permission|require|guard|playerAuth|paygateAuth|Limiter/.test(lines[i + k])) {
                mw += ' ' + lines[i + k];
            }
        }
        mw = expandAliases(mw, aliasMap);
        const handlerPreview = lines.slice(i, i + 14).join('\n');
        const { auth, detail } = classifyAuth(mw, handlerPreview);
        rows.push({ file, method: m[1].toUpperCase(), path: m[3], line: i + 1, auth, detail: detail || '' });
    }
}

const groups = {};
for (const r of rows) (groups[r.auth] = groups[r.auth] || []).push(r);

console.log('=== 全站路由鉴权分类统计 ===');
for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${k}: ${v.length}`);
}
console.log('总计:', rows.length);

const adminPaths = rows.filter(r => /\/admin\//.test(r.path));
const publicAdmin = adminPaths.filter(r => r.auth === '公开' || r.auth === '可选登录（公开）');
console.log('\n=== 风险检查 ===');
console.log(`含 admin 路径的接口 ${adminPaths.length} 个，其中未鉴权: ${publicAdmin.length}（应为 0）`);
publicAdmin.forEach(r => console.log('  !!', r.file, r.method, r.path, r.line));

const mdIndex = process.argv.indexOf('--md');
if (mdIndex >= 0) {
    const outFile = process.argv[mdIndex + 1] || path.join(ROOT, 'reports', 'PERMISSIONS-API-INVENTORY.md');
    const order = Object.keys(groups).sort((a, b) => {
        const rank = { '细粒度权限（已迁移）': 0, 'Level 兼容层（admin，Level >= 1）': 1, 'Level 兼容层（superAdmin，Level 2）': 2 };
        return (rank[a] === undefined ? 9 : rank[a]) - (rank[b] === undefined ? 9 : rank[b]);
    });
    let md = '# 全站受保护 API 权限迁移清单（自动生成）\n\n';
    md += `生成时间：${new Date().toISOString()}\n\n`;
    md += '> 由 `scripts/tests/permissions-api-inventory.js` 静态扫描 `routes/*.js` 生成。\n';
    md += '> 「Level 兼容层」接口同样有**真实后端鉴权**（Level >= 1 / Level 2），只是尚未细粒度化，不属于“前端隐藏、后端裸奔”。\n\n';
    md += '## 统计\n\n| 鉴权方式 | 接口数 |\n|---|---|\n';
    for (const k of [...order, ...Object.keys(groups).filter(k => !order.includes(k))]) {
        md += `| ${k} | ${groups[k].length} |\n`;
    }
    md += `| **合计** | **${rows.length}** |\n\n`;
    for (const k of [...order, ...Object.keys(groups).filter(x => !order.includes(x))]) {
        md += `## ${k}（${groups[k].length}）\n\n| 文件 | 方法 | 路径 | 行号 | 细化权限 |\n|---|---|---|---|---|\n`;
        for (const r of groups[k]) {
            md += `| ${r.file} | ${r.method} | \`${r.path}\` | ${r.line} | ${r.detail || ''} |\n`;
        }
        md += '\n';
    }
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, md);
    console.log('\n已写入:', outFile);
}
