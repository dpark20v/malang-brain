/* ============================================================
   우리 동네 치매안심센터 찾기 (대한민국)

   동네 이름(예: 한남동)을 넣으면 그 동네가 어느 시·군·구에 속하는지 찾아
   「○○구 치매안심센터」를 알려 줍니다.

   왜 전화번호와 주소를 직접 적어 두지 않았나요?
   센터의 번호·위치는 바뀔 수 있고, 틀린 번호를 보여 드리면 급할 때
   오히려 해가 됩니다. 그래서 이름만 정확히 찾아 드리고, 실제 번호와
   위치는 지도와 국가 콜센터(1899-9988)로 이어 드립니다.

   자료: 전국 행정동 3,516개 (동 → 시·군·구). data/areas.json 에 있고,
   검색을 처음 누를 때만 내려받습니다(44KB).
   ============================================================ */
(function () {
  'use strict';

  var HOTLINE = '1899-9988';
  var DATA_URL = 'data/areas.json';

  var form = document.getElementById('finderForm');
  var input = document.getElementById('finderInput');
  var out = document.getElementById('finderOut');
  if (!form || !input || !out) return;

  /* i18n 이 준비되기 전이라도 죽지 않도록 */
  function t(key, vars) {
    return (typeof window.t === 'function') ? window.t(key, vars) : key;
  }

  var areas = null;        // [{sido, sgg, dongs:[...]}]
  var loading = null;      // 내려받는 중인 약속(Promise)

  function load() {
    if (areas) return Promise.resolve(areas);
    if (loading) return loading;
    loading = fetch(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        areas = d.a.map(function (row) {
          return { sido: row[0], sgg: row[1], dongs: row[2].split(',') };
        });
        return areas;
      })
      .catch(function (e) { loading = null; throw e; });
    return loading;
  }

  /* 「역삼1동」과 「역삼동」이 같은 곳을 가리키도록 숫자를 지웁니다.
     「용산2가동」처럼 숫자 뒤에 글자가 더 있는 이름은 건드리지 않습니다. */
  function base(name) {
    return name.replace(/(\D)\d+동$/, '$1동');
  }
  function norm(s) {
    return s.replace(/\s+/g, '').toLowerCase();
  }

  /* 시·군·구 이름에서 센터 이름을 만듭니다.
     「고양시 덕양구」 → 「덕양구」 처럼 마지막 조각이 센터 이름이 됩니다. */
  function centerName(sgg) {
    var last = sgg.split(' ').pop();
    return last + ' 치매안심센터';
  }

  /* 세종처럼 시·도와 시·군·구가 같은 곳은 이름을 두 번 쓰지 않습니다 */
  function placeName(a) {
    return a.sido === a.sgg ? a.sido : a.sido + ' ' + a.sgg;
  }

  function find(qRaw) {
    var q = norm(qRaw);
    var qb = norm(base(qRaw));
    var hits = [];
    var seen = {};

    function push(a, why) {
      var key = a.sido + '|' + a.sgg;
      if (seen[key]) return;
      seen[key] = 1;
      hits.push({ area: a, why: why });
    }

    /* 1) 동·읍·면 이름이 정확히 같은 곳 */
    areas.forEach(function (a) {
      a.dongs.forEach(function (d) {
        if (norm(d) === q || norm(base(d)) === qb) push(a, d);
      });
    });
    if (hits.length) return { kind: 'dong', hits: hits };

    /* 2) 시·군·구 이름이 정확히 같은 곳 */
    areas.forEach(function (a) {
      if (norm(a.sgg) === q || norm(a.sgg.split(' ').pop()) === q) push(a, null);
    });
    if (hits.length) return { kind: 'sgg', hits: hits };

    /* 3) 시·군·구 이름의 일부만 넣은 경우 (예: 「용산」) */
    areas.forEach(function (a) {
      if (norm(a.sgg).indexOf(q) >= 0) push(a, null);
    });
    if (hits.length) return { kind: 'sgg', hits: hits };

    /* 4) 동 이름의 일부만 넣은 경우 */
    areas.forEach(function (a) {
      a.dongs.forEach(function (d) {
        if (norm(d).indexOf(q) >= 0) push(a, d);
      });
    });
    if (hits.length) return { kind: 'dong', hits: hits };

    /* 5) 시·도만 넣은 경우 — 더 좁혀 달라고 안내 */
    var sido = null;
    areas.forEach(function (a) {
      if (!sido && (norm(a.sido).indexOf(q) >= 0 || q.indexOf(norm(a.sido)) >= 0)) sido = a.sido;
    });
    if (sido) return { kind: 'sido', sido: sido, hits: [] };

    return { kind: 'none', hits: [] };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cardHTML(hit) {
    var a = hit.area;
    var name = centerName(a.sgg);
    var place = placeName(a);
    var mapQ = encodeURIComponent(place + ' 치매안심센터');
    var where = hit.why ? t('fd.of', { dong: hit.why, place: place }) : place;

    return '' +
      '<div class="fcard">' +
        '<p class="fcard__n">🏥 ' + esc(name) + '</p>' +
        '<p class="fcard__w">' + esc(where) + '</p>' +
        '<div class="fcard__btns">' +
          '<a class="btn btn--ghost" target="_blank" rel="noopener"' +
            ' href="https://map.naver.com/p/search/' + mapQ + '">' + esc(t('fd.map')) + '</a>' +
          '<a class="btn btn--primary" href="tel:' + HOTLINE + '">' +
            esc(t('fd.call', { tel: HOTLINE })) + '</a>' +
        '</div>' +
      '</div>';
  }

  function render(res, q) {
    if (res.kind === 'none') {
      out.innerHTML = '<p class="finder__msg">' + esc(t('fd.none', { q: q })) + '</p>';
      return;
    }
    if (res.kind === 'sido') {
      out.innerHTML = '<p class="finder__msg">' + esc(t('fd.sido', { sido: res.sido })) + '</p>';
      return;
    }

    var hits = res.hits.slice(0, 8);
    var head = '<p class="finder__msg">' + esc(t('fd.hit', { n: res.hits.length })) + '</p>';
    var more = res.hits.length > hits.length
      ? '<p class="finder__msg">' + esc(t('fd.more', { n: res.hits.length - hits.length })) + '</p>' : '';
    var note = '<p class="finder__note">' + esc(t('fd.note')) + '</p>';
    out.innerHTML = head + hits.map(cardHTML).join('') + more + note;
  }

  function run() {
    var q = input.value.trim();
    if (!q) {
      out.innerHTML = '<p class="finder__msg">' + esc(t('fd.empty')) + '</p>';
      input.focus();
      return;
    }
    out.innerHTML = '<p class="finder__msg">' + esc(t('fd.loading')) + '</p>';
    load().then(function () {
      render(find(q), q);
    }).catch(function () {
      out.innerHTML = '<p class="finder__msg">' + esc(t('fd.err')) + '</p>';
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    run();
  });

  /* 언어를 바꾸면 이미 보여 준 결과도 그 언어로 다시 그립니다 */
  window.addEventListener('malang:langchange', function () {
    if (out.innerHTML.trim() && input.value.trim() && areas) {
      render(find(input.value.trim()), input.value.trim());
    }
  });
})();
