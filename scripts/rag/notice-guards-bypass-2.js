/**
 * webui：在账号切换器旁加「护栏开关」
 *  - 关闭护栏后显示红色横幅，避免误以为仍在保护中
 *  - 复用页面已有的 API_BASE / CSRF
 */
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', '_gwork');
const p = path.join(APP, 'webui', 'index.html');
if (!fs.existsSync(p)) { console.log('  ✗ 找不到 webui/index.html'); process.exit(1); }

let s = fs.readFileSync(p, 'utf8');
if (s.includes('guards-switch')) { console.log('  已存在，跳过'); process.exit(0); }

const snippet = `
  <!-- 护栏开关 + 旁路横幅 -->
  <style>
    #guards-switch{position:fixed;right:16px;top:56px;z-index:9999;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
      background:var(--card,#fff);color:var(--text,#1f2937);border:1px solid var(--border,#d7dee8);border-radius:10px;
      box-shadow:0 6px 20px rgba(15,23,42,.12);padding:8px 10px;display:flex;align-items:center;gap:8px}
    #guards-switch .gs-label{font-weight:600;color:var(--muted,#64748b);white-space:nowrap}
    #guards-switch button{font:inherit;padding:3px 10px;border-radius:6px;border:1px solid var(--border,#d7dee8);background:transparent;color:inherit;cursor:pointer}
    #guards-switch button.on{border-color:#f59e0b;color:#b45309;font-weight:600}
    #guards-switch button.off{border-color:#22c55e;color:#15803d}
    #guards-banner{position:fixed;left:0;right:0;top:0;z-index:10000;background:#dc2626;color:#fff;
      font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;padding:6px 12px;text-align:center;display:none}
    #guards-banner b{font-weight:700}
    html[data-theme="dark"] #guards-switch{background:#1e293b;color:#e2e8f0;border-color:#334155}
  </style>
  <div id="guards-banner">⚠ 护栏已关闭：发送时间窗、每日配额、熔断全部放行 —— 请注意发送量，避免账号被风控</div>
  <div id="guards-switch" hidden>
    <span class="gs-label">发送护栏</span>
    <button id="gs-btn" type="button">加载中…</button>
  </div>
  <script>
  (function () {
    var box = document.getElementById('guards-switch');
    var btn = document.getElementById('gs-btn');
    var banner = document.getElementById('guards-banner');
    if (!box || !btn) return;
    var state = { on: false };

    function base() {
      if (typeof API_BASE === 'string' && API_BASE) return API_BASE;
      return location.pathname.split('/page/')[0] + '/api';
    }
    function token() {
      try { if (typeof CSRF === 'string' && CSRF) return CSRF; } catch (e) {}
      return '';
    }
    function req(path, opts) {
      opts = opts || {};
      var h = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (token()) h['X-CSRF-Token'] = token();
      return fetch(base() + path, Object.assign({ credentials: 'same-origin', headers: h }, opts))
        .then(function (r) { return r.json().catch(function () { return {}; }); });
    }
    function paint(on) {
      state.on = !!on;
      btn.textContent = on ? '已关闭（点击恢复）' : '已开启';
      btn.className = on ? 'on' : 'off';
      banner.style.display = on ? 'block' : 'none';
      box.title = on
        ? '当前：时间窗 / 每日配额 / 熔断 全部放行。内容校验与发送节奏仍然生效。'
        : '当前：时间窗、每日配额、熔断均在生效。';
    }
    function load() {
      req('/auth/session').then(function (s) {
        if (!s || !s.loggedIn) { box.hidden = true; return null; }
        box.hidden = false;
        return req('/guards').then(function (d) {
          paint(d && d.bypass ? d.bypass.on : false);
        });
      }).catch(function () { box.hidden = true; });
    }
    btn.addEventListener('click', function () {
      var next = !state.on;
      var note = '';
      if (next) {
        note = prompt('关闭护栏会让你跳过发送时间窗、每日配额与熔断限制。\\n建议填写原因（会写入审计）：', '管理员临时通知');
        if (note === null) return;
      }
      req('/guards/bypass', { method: 'POST', body: JSON.stringify({ on: next, note: note }) })
        .then(function (r) {
          if (r && r.ok) paint(r.bypass.on);
          else alert('操作失败：' + ((r && r.error) || '未知错误'));
        })
        .catch(function () { alert('操作失败：网络错误'); });
    });
    load();
    setInterval(load, 60000);
  })();
  </script>
`;

s = s.replace('</body>', snippet + '</body>');
fs.writeFileSync(p, s, 'utf8');
console.log('  ✓ webui：护栏开关 + 旁路横幅');
console.log('  ✓ 需要 /guards 返回 bypass 字段（已由 routes 补丁提供）');
