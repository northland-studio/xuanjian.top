/** 修正多账号路由里的辅助函数用法（parseBody / audit 对象签名 / 导入 audit） */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '_notice', 'xuanjian-notice');
const p = path.join(ROOT, 'src', 'routes.mjs');
let s = fs.readFileSync(p, 'utf8');
const log = [];

/* 1. 导入 audit */
if (!/import \{[^}]*\baudit\b[^}]*\} from '\.\/log\.mjs'/.test(s)) {
    s = s.replace(
        "import { log, recentAudit, auditDays, recentLoginLogs } from './log.mjs';",
        "import { audit, log, recentAudit, auditDays, recentLoginLogs } from './log.mjs';"
    );
    log.push('导入 audit');
}

/* 2. readBody → parseBody */
if (s.includes('await readBody(req)')) {
    s = s.replace('const body = await readBody(req);', 'const body = await parseBody(req);');
    log.push('readBody → parseBody');
}

/* 3. audit 调用改为对象签名，并带上 actor/ip */
s = s.replace(
    "        audit(session, 'accounts/active', { id });",
    `        audit({
          event: 'accounts.active',
          actor: { email: session.email, ip: clientIp(req) },
          accountId: id,
        });`
);
if (s.includes("event: 'accounts.active'")) log.push('audit 改为对象签名');

fs.writeFileSync(p, s, 'utf8');
console.log(log.map((l) => '  ✓ ' + l).join('\n') || '  （无改动）');

const { execFileSync } = require('node:child_process');
try {
    execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
    console.log('  ✓ 语法通过');
} catch (e) {
    console.log('  ✗ 语法失败：' + String(e.stderr || e.message).slice(0, 400));
    process.exit(1);
}

/* 4. 检查插入的路由片段 */
const after = fs.readFileSync(p, 'utf8');
const seg = after.slice(after.indexOf("'/accounts'"), after.indexOf("'/accounts'") + 900);
console.log('\n=== 插入的 /accounts 路由片段 ===');
console.log(seg.split('\n').slice(0, 34).map((l) => '  ' + l).join('\n'));
