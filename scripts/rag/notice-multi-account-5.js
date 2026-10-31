/**
 * 多账号改造（第四步）：
 *  1. standalone.mjs：在 await plugin_init(ctx) 之后注入 setCtx(ctx)
 *  2. webui/index.html：追加自包含的「账号切换器」（浮动卡片，不改动既有布局）
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '_notice', 'xuanjian-notice');
const log = [];

/* ---------- 1. standalone：插件初始化后注入 ctx ---------- */
{
    const p = path.join(ROOT, 'standalone.mjs');
    let s = fs.readFileSync(p, 'utf8');
    if (!s.includes('setCtx(ctx);')) {
        s = s.replace(
            'await plugin_init(ctx);',
            'await plugin_init(ctx);\n/* 多账号：把 ctx 注入 routes，供 /accounts 路由读取账号池 */\nsetCtx(ctx);'
        );
        fs.writeFileSync(p, s, 'utf8');
        log.push('standalone：plugin_init 之后 setCtx(ctx)');
    }
}

/* ---------- 2. webui：账号切换器 ---------- */
{
    const p = path.join(ROOT, 'webui', 'index.html');
    let s = fs.readFileSync(p, 'utf8');

    if (!s.includes('account-switcher')) {
        const snippet = `
  <!-- 多账号切换器（自包含，不改动既有布局） -->
  <style>
    #account-switcher{position:fixed;right:16px;top:12px;z-index:9999;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
      background:var(--card,#fff);color:var(--text,#1f2937);border:1px solid var(--border,#d7dee8);border-radius:10px;
      box-shadow:0 6px 20px rgba(15,23,42,.12);padding:8px 10px;display:flex;align-items:center;gap:8px;max-width:420px}
    #account-switcher .as-label{font-weight:600;color:var(--muted,#64748b);white-space:nowrap}
    #account-switcher select{font:inherit;padding:3px 6px;border:1px solid var(--border,#d7dee8);border-radius:6px;background:transparent;color:inherit;max-width:200px}
    #account-switcher .as-dot{width:8px;height:8px;border-radius:50%;background:#cbd5e1;flex:0 0 auto}
    #account-switcher .as-dot.on{background:#22c55e}
    #account-switcher .as-dot.off{background:#ef4444}
    #account-switcher .as-tip{color:var(--muted,#64748b);font-size:12px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    html[data-theme="dark"] #account-switcher{background:#1e293b;color:#e2e8f0;border-color:#334155}
  </style>
  <div id="account-switcher" hidden>
    <span class="as-label">发信账号</span>
    <span class="as-dot" id="as-dot"></span>
    <select id="as-select" title="选择用哪个 QQ 号发送"></select>
    <span class="as-tip" id="as-tip"></span>
  </div>
  <script>
  (function () {
    var BASE = location.pathname.replace(/\\/?(index\\.html)?$/, '') + '/api';
    var box = document.getElementById('account-switcher');
    var sel = document.getElementById('as-select');
    var dot = document.getElementById('as-dot');
    var tip = document.getElementById('as-tip');
    if (!box) return;

    function csrf() {
      var m = document.cookie.match(/(?:^|;\\s*)(?:xb_csrf|csrf)=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    }
    function api(path, opts) {
      opts = opts || {};
      return fetch(BASE + path, Object.assign({
        credentials: 'same-origin',
        headers: Object.assign({ 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() }, opts.headers || {})
      }, opts)).then(function (r) { return r.json().catch(function () { return {}; }); });
    }
    function render(d) {
      if (!d || !d.accounts || !d.accounts.length) { box.hidden = true; return; }
      box.hidden = false;
      var active = d.accounts.filter(function (a) { return a.active; })[0] || d.accounts[0];
      sel.innerHTML = d.accounts.map(function (a) {
        return '<option value="' + a.id + '"' + (a.id === active.id ? ' selected' : '') +
          (a.enabled ? '' : ' disabled') + '>' + a.name + (a.enabled ? '' : '（停用）') + '</option>';
      }).join('');
      dot.className = 'as-dot ' + (active.connected ? 'on' : 'off');
      tip.textContent = active.connected ? '在线' : '未连接';
      tip.title = active.id + (active.connected ? '' : '（该账号的 OneBot 未连接或需重新登录）');
    }
    function load() {
      api('/accounts').then(render).catch(function () { box.hidden = true; });
    }
    sel.addEventListener('change', function () {
      var id = sel.value;
      api('/accounts/active', { method: 'POST', body: JSON.stringify({ id: id }) })
        .then(function (r) {
          if (r && r.ok) { render(r); }
          else { alert('切换失败：' + ((r && r.error) || '未知错误')); load(); }
        })
        .catch(function () { alert('切换失败：网络错误'); load(); });
    });
    load();
    setInterval(load, 30000);
  })();
  </script>
`;
        s = s.replace('</body>', snippet + '</body>');
        fs.writeFileSync(p, s, 'utf8');
        log.push('webui：账号切换器');
    }

    /* 3. 前端调用需要 CSRF cookie：检查 auth.mjs 是否已下发 */
    const a = path.join(ROOT, 'src', 'auth.mjs');
    const asrc = fs.readFileSync(a, 'utf8');
    const hasCsrfCookie = /set-cookie[^\n]*csrf/i.test(asrc) || /xb_csrf/.test(asrc);
    log.push('CSRF cookie 下发：' + (hasCsrfCookie ? '已存在' : '⚠ 需确认（前端会带 X-CSRF-Token）'));
}

/* 语法检查 */
const { execFileSync } = require('node:child_process');
try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, 'standalone.mjs')], { stdio: 'pipe' });
    console.log('  ✓ standalone.mjs 语法通过');
} catch (e) {
    console.log('  ✗ 语法失败：' + String(e.stderr || e.message).slice(0, 300));
    process.exit(1);
}
console.log(log.map((l) => '  ✓ ' + l).join('\n'));
