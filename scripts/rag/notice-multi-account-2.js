/**
 * notice 多账号改造（第二步）：新增 /accounts 路由
 *  - GET  /accounts        列出账号（id/name/enabled/active/connected）
 *  - POST /accounts/active 切换活动账号（需会话 + CSRF）
 *  - /status 里附带 accounts 摘要，便于前端一次拿全
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '_notice', 'xuanjian-notice');
const p = path.join(ROOT, 'src', 'routes.mjs');
let s = fs.readFileSync(p, 'utf8');
const log = [];

/* 1. 在 /status 返回里加 accounts 摘要 */
if (!s.includes('accounts: ctxAccounts()')) {
    // 先在 registerRoutes 内定义取 ctx.accounts 的小工具
    s = s.replace(
        'export function registerRoutes(router) {\n  const cfg = getConfig();',
        `export function registerRoutes(router) {
  const cfg = getConfig();
  /** ctx.accounts 由 standalone.mjs 注入（插件模式下可能不存在，做降级） */
  const ctxAccounts = () => {
    try {
      const a = ctxRef && ctxRef.accounts;
      return a ? a.list() : [];
    } catch {
      return [];
    }
  };`
    );
    s = s.replace(
        'const login = await bot().getLoginInfo();',
        'const login = await bot().getLoginInfo();'
    );
    s = s.replace(
        "          bot: login ? { user_id: String(login.user_id ?? ''), nickname: String(login.nickname ?? '') } : null,",
        `          bot: login ? { user_id: String(login.user_id ?? ''), nickname: String(login.nickname ?? '') } : null,
          accounts: ctxAccounts(),`
    );
    log.push('/status 附带 accounts');
}

/* 2. 提供 ctx 引用：在文件顶部加一个可注入的模块级变量 */
if (!s.includes('let ctxRef = null')) {
    s = s.replace(
        "/* ==================== 小工具 ==================== */",
        `/* ctx 引用（standalone.mjs 启动时调用 setCtx 注入；插件模式下为 null） */
let ctxRef = null;
export function setCtx(c) {
  ctxRef = c || null;
}

/* ==================== 小工具 ==================== */`
    );
    log.push('新增 setCtx(ctxRef)');
}

/* 3. 新增 /accounts 路由（放在 /status 之后） */
if (!s.includes("'/accounts'")) {
    s = s.replace(
        `  /* ---------- 群 / 成员 ---------- */`,
        `  /* ---------- 账号（多账号切换）---------- */

  noAuth.get(
    '/accounts',
    guard('accounts', (req, res) => {
      const session = requireSession(req, res);
      if (!session) return;
      return ok(res, { accounts: ctxAccounts(), activeId: ctxRef && ctxRef.accounts ? ctxRef.accounts.activeId() : null });
    }),
  );

  noAuth.post(
    '/accounts/active',
    guard('accounts-active', async (req, res) => {
      const session = requireSession(req, res);
      if (!session) return;
      if (!requireCsrf(req, res, session)) return;
      if (!ctxRef || !ctxRef.accounts) return bad(res, 400, '当前运行模式不支持账号切换');
      const body = await readBody(req);
      const id = String((body && body.id) || '');
      if (!id) return bad(res, 400, '缺少 id');
      try {
        const list = ctxRef.accounts.setActive(id);
        audit(session, 'accounts/active', { id });
        return ok(res, { accounts: list, activeId: id });
      } catch (e) {
        return bad(res, 400, e.message);
      }
    }),
  );

  /* ---------- 群 / 成员 ---------- */`
    );
    log.push('新增 GET /accounts 与 POST /accounts/active');
}

fs.writeFileSync(p, s, 'utf8');
console.log(log.map((l) => '  ✓ ' + l).join('\n') || '  （无改动）');

/* 自检 */
const { execFileSync } = require('node:child_process');
try {
    execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
    console.log('  ✓ 语法通过');
} catch (e) {
    console.log('  ✗ 语法失败：' + String(e.stderr || e.message).slice(0, 400));
    process.exit(1);
}
const after = fs.readFileSync(p, 'utf8');
console.log('  ' + (after.includes("'/accounts'") ? '✓' : '✗') + ' 路由已注册');
console.log('  ' + (after.includes('let ctxRef = null') ? '✓' : '✗') + ' ctxRef 已加入');
