/* 页面详情页：审计表单提交 */
(function () {
  var form = document.querySelector('.audit-form[data-page]');
  if (!form) return;
  var msg = form.querySelector('.form-msg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]');
    var body = {
      page_id: Number(form.getAttribute('data-page')),
      result: form.querySelector('select[name=result]').value,
      note: form.querySelector('textarea[name=note]').value,
      csrf: window.__CSRF || ''
    };
    btn.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = '提交中…';
    fetch('/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF': window.__CSRF || '' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (out) {
        if (out.ok && out.j.ok) {
          msg.className = 'form-msg ok';
          msg.textContent = '✅ 已标记为已审计，正在刷新…';
          setTimeout(function () { location.reload(); }, 600);
        } else {
          msg.className = 'form-msg err';
          msg.textContent = '❌ ' + (out.j.error || '提交失败');
          btn.disabled = false;
        }
      })
      .catch(function () {
        msg.className = 'form-msg err';
        msg.textContent = '❌ 网络错误，请重试';
        btn.disabled = false;
      });
  });
})();
