/* 批阅模式：像改卷子一样，一份一份来，改完自动下一份 */
(function () {
  var form = document.querySelector('.grade-form[data-page]');
  if (!form) return;
  var note = form.querySelector('.grade-note');
  var msg = form.querySelector('.form-msg');
  var pageId = Number(form.getAttribute('data-page'));
  var busy = false;

  function submit(result) {
    if (busy) return;
    busy = true;
    msg.className = 'form-msg';
    msg.textContent = '提交中…';
    var body = { page_id: pageId, result: result, note: note ? note.value : '', csrf: window.__CSRF || '' };
    fetch('/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF': window.__CSRF || '' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (out) {
        if (out.ok && out.j.ok) {
          msg.className = 'form-msg ok';
          msg.textContent = '✅ ' + (out.j.message || '已标记') + '，正在下一份…';
          location.href = out.j.nextUrl || '/grade';
        } else if (out.j && out.j.error && /审计过/.test(out.j.error)) {
          msg.className = 'form-msg err';
          msg.textContent = '⚠ ' + out.j.error + '，自动跳过…';
          setTimeout(function () { location.href = '/grade'; }, 900);
        } else {
          msg.className = 'form-msg err';
          msg.textContent = '❌ ' + ((out.j && out.j.error) || '提交失败');
          busy = false;
        }
      })
      .catch(function () {
        msg.className = 'form-msg err';
        msg.textContent = '❌ 网络错误，请重试';
        busy = false;
      });
  }

  form.querySelectorAll('button[data-result]').forEach(function (btn) {
    btn.addEventListener('click', function () { submit(btn.getAttribute('data-result')); });
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      // 备注框内：Ctrl+Enter 提交通过
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit('pass'); }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); submit('pass'); }
    else if (e.key === '2') { e.preventDefault(); submit('issue'); }
    else if (e.key === 'ArrowRight' || e.key === 'n') { e.preventDefault(); location.href = '/grade?skip=' + pageId; }
  });
})();
