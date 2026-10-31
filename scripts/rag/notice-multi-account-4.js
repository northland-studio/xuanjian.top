/**
 * 多账号改造（第三步）：
 *  1. standalone.mjs 启动时把 ctx 注入 routes（setCtx），并打印账号清单
 *  2. webui 顶部加账号切换器（下拉 + 在线状态点）
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '_notice', 'xuanjian-notice');
const log = [];

/* ============ 1. standalone.mjs：注入 ctx ============ */
{
    const p = path.join(ROOT, 'standalone.mjs');
    let s = fs.readFileSync(p, 'utf8');

    if (!s.includes('setCtx')) {
        // 找到 registerRoutes 调用位置
        const m = s.match(/(\n\s*registerRoutes\([^)]*\);)/);
        if (m) {
            s = s.replace(
                m[1],
                `\n  // 把 ctx 注入 routes，供多账号路由使用\n  setCtx(ctx);${m[1]}`
            );
            log.push('standalone 注入 setCtx(ctx)');
        } else {
            // 没有现成调用则自己注册
            s = s.replace(
                'ctx.router && ctx.router.start',
                `registerRoutes(ctx.router || router);\n  setCtx(ctx);\n  ctx.router && ctx.router.start`
            );
            log.push('standalone 注册 routes + setCtx');
        }

        // 引入 setCtx
        s = s.replace(
            "import { createOneBotWs } from './src/onebot-ws.mjs';",
            "import { createOneBotWs } from './src/onebot-ws.mjs';\nimport { setCtx } from './src/routes.mjs';"
        );

        // 启动时打印账号清单
        s = s.replace(
            "console.log(PREFIX, '[accounts] 已启动账号",
            "console.log(PREFIX, '[accounts] 已启动账号"
        );

        // 启动日志里加账号摘要
        s = s.replace(
            "console.log(`   OneBot  ： ${ONEBOT_WS_URL}（token=${ONEBOT_ACCESS_TOKEN ? '已配置' : '未配置'}，超时 ${ONEBOT_TIMEOUT_MS}ms）`);",
            `console.log('   账号     ： ' + ACCOUNT_DEFS.map((a) => a.id + '(' + a.name + ')' + (a.enabled ? '' : '[停用]')).join(' / ') + '，当前活动=' + activeAccountId);
  console.log(\`   OneBot  ： \${ONEBOT_WS_URL}（token=\${ONEBOT_ACCESS_TOKEN ? '已配置' : '未配置'}，超时 \${ONEBOT_TIMEOUT_MS}ms）\`);`
        );
        log.push('启动日志打印账号清单');
    }

    fs.writeFileSync(p, s, 'utf8');
}

/* 语法检查 */
const { execFileSync } = require('node:child_process');
for (const f of ['standalone.mjs', 'src/routes.mjs']) {
    try {
        execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
        console.log('  ✓ 语法通过 ' + f);
    } catch (e) {
        console.log('  ✗ 语法失败 ' + f + '：' + String(e.stderr || e.message).slice(0, 300));
        process.exit(1);
    }
}
console.log(log.map((l) => '  ✓ ' + l).join('\n'));
