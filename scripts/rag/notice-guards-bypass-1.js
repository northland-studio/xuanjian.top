/**
 * notice：新增「取消护栏」开关
 *
 * 设计原则：
 *  - 开关**只影响三类限制**：发送时间窗、每日配额、熔断（不含内容校验与发送节奏，后者是防封号的）
 *  - 状态持久化到 data/bypass.json，重启不丢；环境变量 GUARDS_BYPASS=on 可作默认值
 *  - 每次开启/关闭都写审计（actor/ip/备注），页面上有红色横幅提示
 *  - 关闭后所有检查返回"已放行"，但仍在响应里带 bypassed:true，便于前端与审计追溯
 */
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', '_gwork');
const G = path.join(APP, 'guards.mjs');
const R = path.join(APP, 'routes.mjs');
const log = [];

/* ================= 1. guards.mjs ================= */
let g = fs.readFileSync(G, 'utf8');

if (!g.includes('bypassState')) {
    /* 1.1 模块级状态 + 文件路径 */
    g = g.replace(
        'export function initGuards({ dataDir, tripHandler }) {',
        `/* ---------------- 护栏旁路开关 ---------------- */
/** { on:boolean, since:string|null, by:string|null, note:string|null } */
let bypass = { on: false, since: null, by: null, note: null };
let fileBypass = '';

function loadBypass() {
  try {
    bypass = JSON.parse(fs.readFileSync(fileBypass, 'utf8'));
  } catch {
    bypass = { on: String(process.env.GUARDS_BYPASS || '').toLowerCase() === 'on', since: null, by: 'env', note: '来自 GUARDS_BYPASS' };
  }
}

function saveBypass() {
  try {
    fs.writeFileSync(fileBypass, JSON.stringify(bypass, null, 2));
  } catch (e) {
    log.error('护栏开关写入失败：' + (e?.message || e));
  }
}

/** 当前旁路状态（页面/接口展示用） */
export function bypassState() {
  return { ...bypass };
}

/** 开启/关闭旁路；返回最新状态 */
export function setBypassState(on, actor, note) {
  bypass = {
    on: !!on,
    since: new Date().toISOString(),
    by: actor || 'unknown',
    note: note ? String(note).slice(0, 200) : null,
  };
  saveBypass();
  log.warn('护栏旁路 ' + (on ? '已开启' : '已关闭') + '（操作人：' + bypass.by + '）');
  return { ...bypass };
}

export function initGuards({ dataDir, tripHandler }) {`
    );

    /* 1.2 initGuards 里加载 */
    g = g.replace(
        "  fileBreaker = path.join(dataDir, 'breaker.json');",
        "  fileBreaker = path.join(dataDir, 'breaker.json');\n  fileBypass = path.join(dataDir, 'bypass.json');\n  loadBypass();"
    );
    g = g.replace(
        '  loadQuota();\n  loadBreaker();',
        `  loadQuota();
  loadBreaker();
  if (bypass.on) log.warn('护栏旁路处于开启状态：时间窗 / 每日配额 / 熔断 均已放行');`
    );

    /* 1.3 时间窗放行 */
    g = g.replace(
        `export function windowState(ts = Date.now()) {
  const cfg = getConfig();
  const sh = shanghaiNow(ts);`,
        `export function windowState(ts = Date.now()) {
  const cfg = getConfig();
  const sh = shanghaiNow(ts);
  if (bypass.on) {
    return { open: true, reason: null, window: \`\${cfg.window.start}-\${cfg.window.end}\`, nowText: sh.timeText, dateKey: sh.dateKey, bypassed: true };
  }`
    );

    /* 1.4 配额放行 */
    g = g.replace(
        `export function checkQuota(kind, count) {
  const cfg = getConfig();
  const q = rollover();`,
        `export function checkQuota(kind, count) {
  const cfg = getConfig();
  const q = rollover();
  if (bypass.on) return { ok: true, errors: [], snapshot: quotaSnapshot(), bypassed: true };`
    );

    /* 1.5 熔断放行 */
    g = g.replace(
        `export function breakerBlock() {
  const s = breakerState();`,
        `export function breakerBlock() {
  if (bypass.on) return null;
  const s = breakerState();`
    );

    log.push('guards.mjs：新增 bypass 开关 + 时间窗/配额/熔断放行');
}

fs.writeFileSync(G, g, 'utf8');

/* ================= 2. routes.mjs ================= */
let r = fs.readFileSync(R, 'utf8');

if (!r.includes("'/guards/bypass'")) {
    /* 2.1 导入 */
    r = r.replace(
        "import { breakerBlock, breakerReset, breakerState, checkQuota, quotaSnapshot, resetQuota, windowState, validateContent } from './guards.mjs';",
        "import { breakerBlock, breakerReset, breakerState, bypassState, checkQuota, quotaSnapshot, resetQuota, setBypassState, windowState, validateContent } from './guards.mjs';"
    );

    /* 2.2 在 /guards 路由里附带 bypass */
    r = r.replace(
        `          breaker: breakerState(),`,
        `          breaker: breakerState(),
          bypass: bypassState(),`
    );

    /* 2.3 新增写接口 */
    r = r.replace(
        `  /* ---------- 账号（多账号切换）---------- */`,
        `  /* ---------- 护栏旁路开关 ---------- */

  noAuth.post(
    '/guards/bypass',
    guard('guards-bypass', async (req, res) => {
      const session = requireSession(req, res);
      if (!session) return;
      if (!requireCsrf(req, res, session)) return;
      const body = await parseBody(req);
      const on = body && (body.on === true || body.on === 'true' || body.on === 1);
      const note = body && body.note ? String(body.note) : '';
      const st = setBypassState(on, session.email, note);
      audit({
        event: on ? 'guards.bypass.on' : 'guards.bypass.off',
        actor: { email: session.email, ip: clientIp(req) },
        note,
      });
      return ok(res, { bypass: st });
    }),
  );

  /* ---------- 账号（多账号切换）---------- */`
    );
    log.push('routes.mjs：GET /guards 带 bypass + POST /guards/bypass');
}

fs.writeFileSync(R, r, 'utf8');

/* ================= 3. 语法检查 ================= */
const { execFileSync } = require('node:child_process');
for (const f of [G, R]) {
    try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
        console.log('  ✓ 语法通过 ' + path.basename(f));
    } catch (e) {
        console.log('  ✗ 语法失败 ' + path.basename(f) + '：' + String(e.stderr || e.message).slice(0, 300));
        process.exit(1);
    }
}
console.log(log.map((l) => '  ✓ ' + l).join('\n'));
