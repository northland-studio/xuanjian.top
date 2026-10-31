/** 修正账号切换器：复用页面已有的 API_BASE 与 CSRF 变量（而非读 cookie） */
const fs = require('node:fs');
const path = require('node:path');

const p = path.join(__dirname, '..', '..', '_notice', 'xuanjian-notice', 'webui', 'index.html');
let s = fs.readFileSync(p, 'utf8');

const oldStart = s.indexOf('  <script>\n  (function () {\n    var BASE');
const oldEnd = s.indexOf('  </script>', oldStart);
if (oldStart < 0 || oldEnd < 0) {
    console.log('  ✗ 未找到注入片段');
    process.exit(1);
}

const newScript = `  <script>
  (function () {
    // 复用页面已有变量：API_BASE（接口前缀）与 CSRF（会话 CSRF token，由 /auth/session 下发）
    var box = document.getElementById('account-switcher');
    var sel = document.getElementById('as-select');
    var dot = document.getElementById('as-dot');
    var tip = document.getElementById('as-tip');
    if (!box) return;

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
      var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (token()) headers['X-CSRF-Token'] = token();
      return fetch(base() + path, Object.assign({ credentials: 'same-origin', headers: headers }, opts))
        .then(function (r) { return r.json().catch(function () { return {}; }); });
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
      tip.title = active.id + (active.connected ? '' : '（该账号 OneBot 未连接或需重新登录）');
    }
    function load() {
      // 未登录时不显示
      req('/auth/session').then(function (s) {
        if (!s || !s.loggedIn) { box.hidden = true; return null; }
        return req('/accounts').then(render);
      }).catch(function () { box.hidden = true; });
    }
    sel.addEventListener('change', function () {
      req('/accounts/active', { method: 'POST', body: JSON.stringify({ id: sel.value }) })
        .then(function (r) {
          if (r && r.ok) render(r);
          else { alert('切换失败：' + ((r && r.error) || '未知错误')); load(); }
        })
        .catch(function () { alert('切换失败：网络错误'); load(); });
    });
    load();
    setInterval(load, 30000);
  })();
`;
s = s.slice(0, oldStart) + newScript + s.slice(oldEnd);
fs.writeFileSync(p, s, 'utf8');
console.log('  ✓ 账号切换器已改为复用 API_BASE / CSRF');
console.log('  ✓ 未登录时自动隐藏');
