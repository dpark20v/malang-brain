/* ============================================================
   오늘 딱 하나만 — 체크 저장
   ------------------------------------------------------------
   배우기의 네 주제에서 하나씩 뽑아 온 「오늘 딱 하나만」 목록입니다.
   체크한 것은 그날 날짜로 저장되고, 자정이 지나면 빈 목록으로 새로 시작합니다.

   저장 칸은 app.js 의 「기기 공통 설정」과 같은 malang:pref: 칸을 씁니다.
   계정을 바꿔도 오늘 표시가 사라지지 않게 하려는 것입니다. 이 목록은
   말랑 스트리크와 달리 기록을 남기지 않고 오늘 하루만 보여 줍니다.
   ============================================================ */
(function () {
  'use strict';

  var KEY_BASE = 'malang:pref:one:';

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY_BASE + todayKey());
      return raw === null ? {} : JSON.parse(raw);
    } catch (e) { return {}; }
  }

  function write(state) {
    try {
      localStorage.setItem(KEY_BASE + todayKey(), JSON.stringify(state));
    } catch (e) {}
    tidy();
  }

  /* 어제까지의 기록은 쓸 일이 없으므로 지웁니다 (칸을 깨끗하게 유지) */
  function tidy() {
    var keep = KEY_BASE + todayKey();
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(KEY_BASE) === 0 && k !== keep) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  function boxes() {
    return Array.prototype.slice.call(document.querySelectorAll('#oneList input[data-one]'));
  }

  function say(key, vars) {
    var i18n = window.MALANG_I18N;
    return i18n ? i18n.t(key, vars) : '';
  }

  /* 몇 개 했는지 알려 주는 한 줄 */
  function renderMessage() {
    var msg = document.getElementById('oneDone');
    if (!msg) return;
    var all = boxes();
    var done = all.filter(function (b) { return b.checked; }).length;

    if (done === 0)            msg.textContent = say('one.done0');
    else if (done >= all.length) msg.textContent = say('one.doneAll');
    else                       msg.textContent = say('one.doneN', { n: done, all: all.length });
  }

  function render() {
    var state = read();
    boxes().forEach(function (b) { b.checked = !!state[b.getAttribute('data-one')]; });
    renderMessage();
  }

  function init() {
    var list = document.getElementById('oneList');
    if (!list) return;

    list.addEventListener('change', function (e) {
      var box = e.target;
      if (!box || !box.matches('input[data-one]')) return;
      var state = read();
      var id = box.getAttribute('data-one');
      if (box.checked) state[id] = true; else delete state[id];
      write(state);
      renderMessage();
    });

    /* 언어를 바꾸면 i18n 이 <html lang> 을 고칩니다. 그때 이 줄도 다시 씁니다. */
    new MutationObserver(renderMessage)
      .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    /* 자정을 넘겨 놓아둔 창에서도 날짜가 바뀌면 새 목록이 되도록 */
    window.addEventListener('focus', render);
    window.addEventListener('hashchange', function () {
      if (location.hash.indexOf('learn-today') !== -1) render();
    });

    tidy();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
