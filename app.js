/* ============================================================
   말랑뇌 · app.js
   - 글자 크기 조절
   - 두뇌 게임 6종
   - 오늘의 실천 체크리스트 (기기 내 저장)
   외부 라이브러리 없음. 모든 데이터는 localStorage에만 저장됩니다.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 공통 도구 ---------- */
  const $  = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const CFG = window.MALANG_CONFIG || {};
  const STREAK_GOAL = CFG.STREAK_GOAL || 3;      // 하루 몇 개를 해내면 "달성"인지

  const readJSON = (fullKey, fallback) => {
    try {
      const raw = localStorage.getItem(fullKey);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  };
  const writeJSON = (fullKey, value) => {
    try { localStorage.setItem(fullKey, JSON.stringify(value)); } catch (e) {}
  };

  /* 기기 공통 설정 (글자 크기, 로그인 세션) — 계정이 바뀌어도 유지 */
  const prefs = {
    get: (k, d) => readJSON('malang:pref:' + k, d),
    set: (k, v) => writeJSON('malang:pref:' + k, v),
    del: (k) => { try { localStorage.removeItem('malang:pref:' + k); } catch (e) {} }
  };

  /* 사용자별 저장소.
     로그인하면 칸이 그 계정 전용으로 바뀌어서, 한 기기를 여러 사람이 써도
     기록이 섞이지 않습니다. (로그인 전에는 'guest' 칸을 씁니다) */
  let userId = 'guest';
  const store = {
    prefix: () => 'malang:u:' + userId + ':',
    get: (k, d) => readJSON(store.prefix() + k, d),
    set: (k, v) => { writeJSON(store.prefix() + k, v); scheduleCloudSave(); },
    keys: () => Object.keys(localStorage).filter(k => k.indexOf(store.prefix()) === 0),
    isEmpty: () => store.keys().length === 0,
    clear: () => store.keys().forEach(k => { try { localStorage.removeItem(k); } catch (e) {} })
  };

  /* 예전 버전(계정 구분이 없던 때)의 기록을 게스트 칸으로 한 번만 옮깁니다 */
  function migrateLegacy() {
    const old = Object.keys(localStorage).filter(k =>
      k.indexOf('malang:') === 0 &&
      k.indexOf('malang:u:') !== 0 &&
      k.indexOf('malang:pref:') !== 0
    );
    old.forEach((k) => {
      const name = k.replace('malang:', '');
      const target = 'malang:u:guest:' + name;
      if (name === 'font') {                       // 글자 크기는 기기 설정으로
        if (localStorage.getItem('malang:pref:font') === null) {
          localStorage.setItem('malang:pref:font', localStorage.getItem(k));
        }
      } else if (localStorage.getItem(target) === null) {
        localStorage.setItem(target, localStorage.getItem(k));
      }
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pick = (arr, n) => shuffle(arr).slice(0, n);
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /* 게임이 만든 타이머를 한곳에서 정리 */
  let timers = [];
  const after = (ms, fn) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const every = (ms, fn) => { const id = setInterval(fn, ms); timers.push(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.forEach(clearInterval); timers = []; };

  /* 살짝 나는 소리 (실패해도 게임엔 지장 없음) */
  let audioCtx = null;
  function beep(freq, ms) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + ms / 1000);
    } catch (e) {}
  }

  /* ============================================================
     0-A. 알림 토스트
     ============================================================ */
  let toastTimer = null;
  function toast(message, ms) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
  }

  /* ============================================================
     0-B. 구글 계정으로 로그인
     ------------------------------------------------------------
     구글이 보내준 신분증(ID 토큰) 안의 이름·사진을 꺼내 화면에 쓰고,
     계정 고유번호(sub)로 저장 칸을 나눕니다.
     ※ 서버가 없는 사이트라 기록은 "이 기기 + 이 계정"에만 남습니다.
       다른 기기에서 같은 계정으로 들어가도 기록은 따라오지 않아요.
     ============================================================ */
  let currentUser = null;      // { id, name, email, picture }

  /* --- 프로필 목록 (기기에 저장) --- */
  const loadProfiles = () => prefs.get('profiles', []);
  const saveProfiles = (list) => prefs.set('profiles', list);

  function upsertProfile(p) {
    const list = loadProfiles();
    const i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i] = Object.assign({}, list[i], p);
    else list.push(p);
    saveProfiles(list);
  }

  function avatarHtml(p, cls) {
    return p && p.picture
      ? `<img class="${cls}" src="${p.picture}" alt="" referrerpolicy="no-referrer" />`
      : `<span class="${cls}">${(p && p.avatar) || '👤'}</span>`;
  }

  /* --- 들어가기 / 나가기 --- */
  function signIn(profile, isFresh) {
    profile.lastUsed = Date.now();
    upsertProfile(profile);

    currentUser = profile;
    prefs.set('session', profile.id);

    const guestHadData = Object.keys(localStorage).some(k => k.indexOf('malang:u:guest:') === 0);
    userId = profile.id;

    /* 이름을 만들기 전에 게스트로 쌓아 둔 기록이 있으면 옮겨 줍니다 */
    if (isFresh && guestHadData && store.isEmpty()) {
      Object.keys(localStorage)
        .filter(k => k.indexOf('malang:u:guest:') === 0)
        .forEach((k) => {
          const name = k.replace('malang:u:guest:', '');
          localStorage.setItem(store.prefix() + name, localStorage.getItem(k));
        });
      Object.keys(localStorage)
        .filter(k => k.indexOf('malang:u:guest:') === 0)
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      toast('그동안의 기록을 가져왔어요 📦');
    } else {
      toast(`${profile.name}님, 반가워요! 👋`);
    }

    refreshAll();
  }

  function signOut(silent) {
    try {
      if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.disableAutoSelect();
      }
    } catch (e) {}
    /* 서버에 저장된 계정이면, 이 기기에 남은 사본은 지웁니다.
       (여러 사람이 함께 쓰는 태블릿에서 앞사람 기록이 남지 않도록)
       인터넷 없이 쓰는 예비 방식에서는 이게 유일한 사본이라 지우지 않습니다. */
    if (cloud && cloud.user && currentUser && currentUser.kind === 'firebase') {
      store.clear();
      try { cloud.signOut(); } catch (e) {}
    }

    currentUser = null;
    prefs.del('session');
    userId = 'guest';
    refreshAll();
    if (!silent) toast('나왔어요. 다시 로그인해 주세요.');
  }

  /* ------------------------------------------------------------
     Firebase 동기화
     ------------------------------------------------------------
     화면은 늘 이 기기의 저장소를 보고 그립니다(빠르고, 인터넷이 끊겨도 동작).
     서버는 뒤에서 조용히 맞춰 줍니다.
       로그인할 때  : 서버 기록을 가져와 이 기기 기록과 합칩니다
       기록이 바뀌면 : 잠시 뒤 서버로 올립니다
     ------------------------------------------------------------ */
  let cloud = null;              // window.MalangCloud (준비되면 채워짐)

  const LOWER_IS_BETTER = ['memory'];   // 짝 맞추기는 횟수가 적을수록 좋음

  async function waitForCloud() {
    for (let i = 0; i < 80; i++) {
      if (window.MalangCloud) {
        await window.MalangCloud.ready;
        return window.MalangCloud.available ? window.MalangCloud : null;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  /* 이 기기의 기록을 서버에 보낼 모양으로 모읍니다 */
  function collectLocal() {
    const check = {};
    store.keys().forEach((k) => {
      const name = k.replace(store.prefix(), '');
      if (name.indexOf('check:') === 0) check[name.slice(6)] = store.get(name, {});
    });

    const best = {};
    GAMES.forEach((g) => {
      const v = store.get('best:' + g.id, 0);
      if (v) best[g.id] = v;
    });

    return {
      profile: {
        name: (currentUser && currentUser.name) || '',
        loginId: (currentUser && currentUser.loginId) || ''
      },
      log: store.get('log', {}),
      check: check,
      best: best,
      bestStreak: store.get('bestStreak', 0)
    };
  }

  /* 서버 기록을 이 기기 기록과 합칩니다 (어느 쪽 것도 잃지 않게) */
  function applyCloud(data) {
    if (!data) return;

    /* 날짜별 실천 개수: 큰 쪽을 남김 */
    const log = store.get('log', {});
    Object.keys(data.log || {}).forEach((d) => {
      log[d] = Math.max(log[d] || 0, data.log[d] || 0);
    });
    writeJSON(store.prefix() + 'log', log);

    /* 그날 체크한 항목: 한쪽이라도 했으면 한 것으로 */
    Object.keys(data.check || {}).forEach((d) => {
      const merged = store.get('check:' + d, {});
      const remote = data.check[d] || {};
      Object.keys(remote).forEach((t) => { if (remote[t]) merged[t] = true; });
      writeJSON(store.prefix() + 'check:' + d, merged);
    });

    /* 게임 최고 기록 */
    Object.keys(data.best || {}).forEach((g) => {
      const mine = store.get('best:' + g, null);
      const theirs = data.best[g];
      let win;
      if (mine === null) win = theirs;
      else win = LOWER_IS_BETTER.indexOf(g) >= 0
        ? Math.min(mine, theirs)
        : Math.max(mine, theirs);
      writeJSON(store.prefix() + 'best:' + g, win);
    });

    /* 최고 연속 기록 */
    if (typeof data.bestStreak === 'number') {
      writeJSON(store.prefix() + 'bestStreak',
        Math.max(store.get('bestStreak', 0), data.bestStreak));
    }
  }

  function scheduleCloudSave() {
    if (!cloud || !cloud.user || !currentUser) return;
    /* 로그아웃·계정 전환 중에는 저장 칸과 로그인 계정이 어긋날 수 있습니다.
       이때 올리면 남의(또는 빈) 기록이 서버를 덮어쓰므로 건너뜁니다. */
    if (userId !== 'fb' + cloud.user.uid) return;
    cloud.save(collectLocal());
  }

  /* 로그인이 끝난 뒤 공통 처리 */
  async function afterCloudLogin(extra) {
    const u = cloud.user;
    const guestHadData = Object.keys(localStorage).some(k => k.indexOf('malang:u:guest:') === 0);

    userId = 'fb' + u.uid;

    let remote = null;
    try { remote = await cloud.load(); } catch (e) { /* 인터넷 문제면 기기 기록으로 진행 */ }

    currentUser = {
      id: userId,
      uid: u.uid,
      kind: 'firebase',
      email: u.email,
      name: (extra && extra.name) || (remote && remote.profile && remote.profile.name) || u.name || (u.email || '').split('@')[0],
      loginId: (extra && extra.loginId) || (remote && remote.profile && remote.profile.loginId) || ''
    };

    /* 로그인 전에 게스트로 쌓아 둔 기록이 있으면 가져옵니다 */
    if (guestHadData) {
      Object.keys(localStorage)
        .filter(k => k.indexOf('malang:u:guest:') === 0)
        .forEach((k) => {
          const name = k.replace('malang:u:guest:', '');
          if (localStorage.getItem(store.prefix() + name) === null) {
            localStorage.setItem(store.prefix() + name, localStorage.getItem(k));
          }
        });
      Object.keys(localStorage)
        .filter(k => k.indexOf('malang:u:guest:') === 0)
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    }

    applyCloud(remote);

    upsertProfile(currentUser);
    prefs.set('session', userId);
    refreshAll();
    cloud.save(collectLocal());        // 합친 결과를 서버에도 올려 둡니다

    toast(`${currentUser.name}님, 반가워요! 👋`);
  }

  /* 시작할 때: 이미 로그인되어 있으면 그대로 이어 갑니다 */
  async function initCloud() {
    cloud = await waitForCloud();
    if (!cloud) { refreshAll(); return; }

    if (cloud.user) {
      await afterCloudLogin();
    } else {
      /* 서버 로그인이 풀렸는데 화면은 로그인 상태로 남아 있는 경우 정리 */
      if (currentUser && currentUser.kind === 'firebase') {
        currentUser = null;
        prefs.del('session');
        userId = 'guest';
      }
      refreshAll();
    }

    cloud.onAuth((u) => {
      if (!u && currentUser && currentUser.kind === 'firebase') {
        currentUser = null;
        prefs.del('session');
        userId = 'guest';
        refreshAll();
      }
    });
  }

  /* ------------------------------------------------------------
     이메일 계정 (Firebase 를 못 쓸 때 쓰는 예비 방식)
     ------------------------------------------------------------
     이메일을 계정 열쇠로 씁니다. 나중에 서버(Firebase 등)를 붙일 때
     이메일을 그대로 서버 계정 키로 이어 쓸 수 있습니다.

     ※ 비밀번호는 절대 그대로 저장하지 않고 PBKDF2로 해시해 둡니다.
       다만 서버가 없으므로 이 로그인은 "누구인지 구분"하는 장치일 뿐,
       기기를 만질 수 있는 사람으로부터 기록을 지켜 주지는 못합니다.
     ------------------------------------------------------------ */
  const MIN_PW = 6;              // Firebase 규정에 맞춘 최소 길이
  const emailKey = (email) => 'e' + String(email).trim().toLowerCase();
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());

  const toHex = (buf) =>
    Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = (hex) =>
    new Uint8Array((hex.match(/.{2}/g) || []).map(h => parseInt(h, 16)));

  function cryptoReady() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
  }

  async function hashPassword(password, saltHex) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromHex(saltHex), iterations: 150000, hash: 'SHA-256' },
      key, 256
    );
    return toHex(bits);
  }

  function newSalt() {
    return toHex(crypto.getRandomValues(new Uint8Array(16)));
  }

  const findByEmail = (email) => loadProfiles().find(p => p.id === emailKey(email));

  /* 가입: 이메일 + 비밀번호 + 아이디 + 이름 */
  async function registerAccount(email, password, loginId, name) {
    const salt = newSalt();
    const hash = await hashPassword(password, salt);
    signIn({
      id: emailKey(email),
      kind: 'email',
      email: String(email).trim(),
      loginId: String(loginId).trim(),
      name: String(name).trim(),
      salt: salt,
      hash: hash
    }, true);
  }

  /* 로그인: 비밀번호가 맞는지 확인 */
  async function verifyPassword(profile, password) {
    if (!profile || !profile.salt || !profile.hash) return false;
    const hash = await hashPassword(password, profile.salt);
    return hash === profile.hash;
  }

  /* --- 구글 로그인 (설정했을 때만 보이는 선택지) --- */
  function decodeIdToken(token) {
    const part = token.split('.')[1];
    if (!part) throw new Error('형식이 올바르지 않은 토큰');
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = atob(base64);
    const json = decodeURIComponent(
      bytes.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(json);
  }

  function handleCredentialResponse(response) {
    try {
      const p = decodeIdToken(response.credential);
      const id = 'g' + p.sub;
      const known = loadProfiles().some(x => x.id === id);
      signIn({
        id: id, name: p.given_name || p.name, avatar: '👤',
        kind: 'google', email: p.email, picture: p.picture
      }, !known);
      location.hash = '#me';
    } catch (e) {
      toast('로그인 정보를 읽지 못했어요. 다시 시도해 주세요.');
    }
  }

  function googleReady() {
    return !!(CFG.GOOGLE_CLIENT_ID && window.google && window.google.accounts && google.accounts.id);
  }

  let gsiInited = false;
  function initGoogle() {
    if (gsiInited || !googleReady()) return;
    try {
      google.accounts.id.initialize({
        client_id: CFG.GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse
      });
      gsiInited = true;
    } catch (e) {
      gsiInited = false;
    }
  }

  /* 로그인 버튼은 화면에 보일 때 그려야 크기가 제대로 잡힙니다 */
  function renderGoogleButton() {
    const box = $('#gsiButton');
    if (!box) return;
    initGoogle();
    if (!gsiInited) return;
    box.innerHTML = '';
    try {
      google.accounts.id.renderButton(box, {
        type: 'standard', theme: 'outline', size: 'large',
        shape: 'pill', text: 'signin_with', locale: 'ko', width: 280
      });
    } catch (e) {}
  }

  function initAuth() {
    /* 새로고침해도 마지막에 들어와 있던 사람을 그대로 유지합니다 */
    const savedId = prefs.get('session', null);
    if (savedId) {
      const found = loadProfiles().find(p => p.id === savedId);
      if (found) {
        currentUser = found;
        userId = found.id;
      } else {
        prefs.del('session');
      }
    }

    if (!CFG.GOOGLE_CLIENT_ID) return;   // 구글 로그인을 안 쓰면 여기서 끝

    /* 구글 스크립트는 늦게 도착할 수 있어 잠깐 기다렸다가 버튼을 그립니다 */
    let tries = 0;
    const wait = setInterval(() => {
      tries++;
      if (googleReady()) {
        clearInterval(wait);
        initGoogle();
        if (currentPage() === 'me') renderGoogleButton();
      } else if (tries > 20) {
        clearInterval(wait);
      }
    }, 250);
  }

  /* ============================================================
     0. 페이지 이동 (스크롤 대신 페이지 전환)
     주소의 #뒤 이름으로 어떤 페이지를 보여줄지 정합니다.
     예) #play → 두뇌게임 페이지. 뒤로가기·새로고침도 그대로 유지돼요.
     ============================================================ */
  const PAGES = ['home', 'learn', 'play', 'streak', 'help', 'me'];
  const ALIASES = { today: 'streak', login: 'me' };   // 예전 주소도 계속 열리도록

  function currentPage() {
    let id = decodeURIComponent(location.hash).replace(/^#\/?/, '');
    if (ALIASES[id]) id = ALIASES[id];
    return PAGES.includes(id) ? id : 'home';
  }

  function showPage() {
    const id = currentPage();

    PAGES.forEach((p) => {
      const el = document.getElementById(p);
      if (el) el.classList.toggle('is-active', p === id);
    });

    $$('.nav a').forEach((a) => {
      const target = (a.getAttribute('href') || '').replace('#', '');
      if (target === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (modal && !modal.hidden) closeModal();   // 게임 중에 메뉴를 눌러도 안전하게
    window.scrollTo(0, 0);

    if (id === 'streak') renderStreak();        // 날짜가 바뀌었을 수 있으니 새로 그림
    if (id === 'me') { renderMe(); renderGoogleButton(); }

    const page = document.getElementById(id);
    if (page) page.focus({ preventScroll: true });  // 화면 낭독기 사용자를 위해
  }

  function initRouter() {
    window.addEventListener('hashchange', showPage);

    const skip = $('#skipLink');       // 메뉴를 건너뛰고 본문으로
    if (skip) skip.addEventListener('click', () => {
      const page = document.getElementById(currentPage());
      if (page) page.focus();
    });

    showPage();
  }

  /* ============================================================
     1. 글자 크기 조절
     ============================================================ */
  function initFontControl() {
    const saved = String(prefs.get('font', '1'));
    setFont(saved);
    $$('[data-font-set]').forEach((btn) => {
      btn.addEventListener('click', () => setFont(btn.dataset.fontSet));
    });
    function setFont(level) {
      document.documentElement.setAttribute('data-font', level);
      prefs.set('font', level);
      $$('[data-font-set]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.fontSet === level));
      });
    }
  }

  /* ============================================================
     2. 모달 (게임 창)
     ============================================================ */
  const modal = $('#modal');
  const modalTitle = $('#modalTitle');
  const gameRoot = $('#gameRoot');
  let lastFocused = null;

  function openModal(title, mountFn) {
    lastFocused = document.activeElement;
    modalTitle.textContent = title;
    gameRoot.innerHTML = '';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    mountFn(gameRoot);
    const focusable = gameRoot.querySelector('button, [href], input');
    (focusable || $('.modal__close')).focus();
  }

  function closeModal() {
    clearTimers();
    modal.hidden = true;
    gameRoot.innerHTML = '';
    document.body.style.overflow = '';
    renderGameCards();          // 최고 기록 갱신 반영
    if (lastFocused) lastFocused.focus();
  }

  modal.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-close')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  /* 게임 안에서 쓰는 결과 화면 */
  function showResult(root, { emoji, title, desc, retry, close }) {
    markTaskDone('game');           // 한 판 끝내면 오늘의 실천에 자동 표시
    root.innerHTML = `
      <div class="result">
        <span class="result__emoji">${emoji}</span>
        <p class="result__title">${title}</p>
        <p class="result__desc">${desc}</p>
        <div class="result__actions">
          <button type="button" class="btn btn--primary btn--big" id="rsRetry">🔄 한 번 더</button>
          <button type="button" class="btn btn--ghost btn--big" id="rsClose">그만하기</button>
        </div>
      </div>`;
    $('#rsRetry', root).onclick = retry;
    $('#rsClose', root).onclick = close || closeModal;
  }

  /* 최고 기록 저장 (클수록 좋은 기록) */
  function saveBest(id, value) {
    const prev = store.get('best:' + id, 0);
    if (value > prev) { store.set('best:' + id, value); return true; }
    return false;
  }
  /* 최고 기록 저장 (작을수록 좋은 기록) */
  function saveBestLow(id, value) {
    const prev = store.get('best:' + id, null);
    if (prev === null || value < prev) { store.set('best:' + id, value); return true; }
    return false;
  }

  /* ============================================================
     3. 게임 1 — 거꾸로 숫자 말하기
     ============================================================ */
  function gameReverse(root) {
    let level = 3;

    intro();

    function intro() {
      root.innerHTML = `
        <div class="stage">
          <p class="stage__hint">숫자가 하나씩 나타납니다.</p>
          <p class="stage__lead">모두 외운 다음 <b>거꾸로</b> 눌러 주세요.<br />
            예) <b>3 → 7 → 1</b> 이 나오면 <b>1 7 3</b> 이라고 입력해요.</p>
          <button type="button" class="btn btn--primary btn--big" id="go">시작하기</button>
        </div>`;
      $('#go', root).onclick = () => sequence();
    }

    function sequence() {
      const digits = Array.from({ length: level }, () => rand(0, 9));
      root.innerHTML = `
        <div class="stage">
          <div class="hud"><span class="hud__item"><b>${level}</b>자리</span></div>
          <p class="stage__hint">잘 보고 기억하세요</p>
          <div class="bigdigit" id="d">준비</div>
        </div>`;
      const cell = $('#d', root);
      let i = 0;
      const step = () => {
        if (i < digits.length) {
          cell.textContent = digits[i];
          cell.classList.remove('pop');
          void cell.offsetWidth;
          cell.classList.add('pop');
          beep(520 + i * 40, 120);
          i++;
          after(1000, step);
        } else {
          cell.textContent = '🤔';
          after(600, () => askAnswer(digits));
        }
      };
      after(900, step);
    }

    function askAnswer(digits) {
      const answer = digits.slice().reverse().join('');
      let typed = '';
      root.innerHTML = `
        <div class="stage">
          <p class="stage__hint">거꾸로 눌러 주세요</p>
          <div class="answer-box" id="ans"></div>
          <div class="keypad">
            ${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" class="key" data-n="${n}">${n}</button>`).join('')}
            <button type="button" class="key key--fn" data-act="del">← 지우기</button>
            <button type="button" class="key" data-n="0">0</button>
            <button type="button" class="key key--go" data-act="ok">확인 ✓</button>
          </div>
        </div>`;
      const box = $('#ans', root);
      $$('.key', root).forEach((btn) => {
        btn.onclick = () => {
          if (btn.dataset.n !== undefined) {
            if (typed.length < digits.length) { typed += btn.dataset.n; beep(660, 70); }
          } else if (btn.dataset.act === 'del') {
            typed = typed.slice(0, -1);
          } else {
            return judge();
          }
          box.textContent = typed;
        };
      });

      function judge() {
        if (typed.length === 0) return;
        if (typed === answer) {
          beep(880, 220);
          const best = level;
          const isNew = saveBest('reverse', best);
          showResult(root, {
            emoji: '🎉',
            title: `${level}자리 성공!`,
            desc: `정답은 <b>${answer}</b> 였어요.<br />${isNew ? '🏆 새로운 최고 기록이에요!<br />' : ''}다음은 ${level + 1}자리에 도전해 볼까요?`,
            retry: () => { level += 1; sequence(); }
          });
        } else {
          beep(220, 300);
          showResult(root, {
            emoji: '🌱',
            title: '아쉬워요!',
            desc: `정답은 <b>${answer}</b> 였어요. 입력하신 답은 ${typed} 였습니다.<br />
                   틀려도 괜찮아요 — 애쓰는 순간에 뇌가 가장 많이 자랍니다.`,
            retry: () => { level = Math.max(3, level); sequence(); }
          });
        }
      }
    }
  }

  /* ============================================================
     4. 게임 2 — 카드 짝 맞추기
     ============================================================ */
  function gameMemory(root) {
    const FACES = ['🍎', '🐶', '🌻', '🚗', '🐟', '🎵'];
    start();

    function start() {
      const deck = shuffle(FACES.concat(FACES));
      let opened = [];
      let matched = 0;
      let moves = 0;
      let seconds = 0;
      let locked = false;

      root.innerHTML = `
        <div class="stage">
          <div class="hud">
            <span class="hud__item">뒤집은 횟수 <b id="mv">0</b>번</span>
            <span class="hud__item">시간 <b id="tm">0</b>초</span>
          </div>
          <div class="memory-grid" id="grid">
            ${deck.map((f, i) => `<button type="button" class="mcard" data-i="${i}" data-face="${f}" aria-label="카드 ${i + 1}">${f}</button>`).join('')}
          </div>
        </div>`;

      every(1000, () => { seconds++; const t = $('#tm', root); if (t) t.textContent = seconds; });

      $$('.mcard', root).forEach((card) => {
        card.onclick = () => {
          if (locked || card.classList.contains('is-flipped') || card.classList.contains('is-matched')) return;
          card.classList.add('is-flipped');
          beep(700, 80);
          opened.push(card);
          if (opened.length < 2) return;

          moves++;
          $('#mv', root).textContent = moves;
          const [a, b] = opened;

          if (a.dataset.face === b.dataset.face) {
            after(320, () => {
              a.classList.add('is-matched');
              b.classList.add('is-matched');
              beep(920, 160);
              matched++;
              opened = [];
              if (matched === FACES.length) finish(moves, seconds);
            });
          } else {
            locked = true;
            after(750, () => {
              a.classList.remove('is-flipped');
              b.classList.remove('is-flipped');
              opened = [];
              locked = false;
            });
          }
        };
      });
    }

    function finish(moves, seconds) {
      clearTimers();
      const isNew = saveBestLow('memory', moves);
      showResult(root, {
        emoji: '🎊',
        title: '모두 찾았어요!',
        desc: `${moves}번 만에, ${seconds}초 걸렸어요.<br />
               ${isNew ? '🏆 가장 적은 횟수 기록을 세웠어요!' : `지금까지 최고 기록은 ${store.get('best:memory', moves)}번이에요.`}`,
        retry: start
      });
    }
  }

  /* ============================================================
     5. 게임 3 — 암산 훈련 (60초)
     ============================================================ */
  function gameMath(root) {
    start();

    function start() {
      let score = 0, left = 60, locked = false;

      root.innerHTML = `
        <div class="stage quiz">
          <div class="hud">
            <span class="hud__item">맞힌 개수 <b id="sc">0</b></span>
            <span class="hud__item">남은 시간 <b id="tm">60</b>초</span>
          </div>
          <div class="quiz__q" id="q">…</div>
          <div class="choices" id="ch"></div>
        </div>`;

      every(1000, () => {
        left--;
        const t = $('#tm', root);
        if (t) t.textContent = left;
        if (left <= 0) finish(score);
      });

      nextQuestion();

      function nextQuestion() {
        const ops = ['+', '-', '×'];
        const op = ops[rand(0, 2)];
        let a, b, answer;
        if (op === '+')      { a = rand(11, 89); b = rand(11, 89); answer = a + b; }
        else if (op === '-') { a = rand(30, 99); b = rand(5, 29);  answer = a - b; }
        else                 { a = rand(2, 9);   b = rand(2, 9);   answer = a * b; }

        /* 오답 보기 3개 만들기 (어떤 경우에도 멈추지 않도록 시도 횟수를 제한) */
        const wrongs = new Set();
        for (let tries = 0; wrongs.size < 3 && tries < 60; tries++) {
          const delta = rand(1, 12) * (Math.random() < 0.5 ? -1 : 1);
          const w = answer + delta;
          if (w !== answer && w >= 0) wrongs.add(w);
        }
        for (let d = 1; wrongs.size < 3; d++) {          // 그래도 모자라면 순서대로 채움
          if (answer + d !== answer) wrongs.add(answer + d);
        }
        const options = shuffle([answer, ...wrongs]);

        $('#q', root).textContent = `${a} ${op} ${b} = ?`;
        const box = $('#ch', root);
        box.innerHTML = options.map(v => `<button type="button" class="choice" data-v="${v}">${v}</button>`).join('');

        $$('.choice', box).forEach((btn) => {
          btn.onclick = () => {
            if (locked) return;
            locked = true;
            const good = Number(btn.dataset.v) === answer;
            btn.classList.add(good ? 'is-right' : 'is-wrong');
            if (good) { score++; $('#sc', root).textContent = score; beep(880, 120); }
            else {
              beep(220, 200);
              const right = $$('.choice', box).find(c => Number(c.dataset.v) === answer);
              if (right) right.classList.add('is-right');
            }
            after(good ? 350 : 800, () => { locked = false; if (left > 0) nextQuestion(); });
          };
        });
      }
    }

    function finish(score) {
      clearTimers();
      const isNew = saveBest('math', score);
      showResult(root, {
        emoji: score >= 15 ? '🏅' : '🌼',
        title: `60초 동안 ${score}문제 정답!`,
        desc: isNew
          ? '🏆 새로운 최고 기록이에요! 내일도 이 시간에 만나요.'
          : `지금까지 최고 기록은 ${store.get('best:math', score)}문제예요.`,
        retry: start
      });
    }
  }

  /* ============================================================
     6. 게임 4 — 장보기 목록 외우기
     ============================================================ */
  function gameShopping(root) {
    const POOL = [
      ['🥬', '배추'], ['🧅', '양파'], ['🥔', '감자'], ['🐟', '고등어'],
      ['🥚', '계란'], ['🍚', '쌀'],   ['🧄', '마늘'], ['🥛', '우유'],
      ['🍎', '사과'], ['🌶️', '고추'], ['🧻', '휴지'], ['🫘', '두부'],
      ['🍄', '버섯'], ['🥕', '당근'], ['🍜', '라면'], ['🧂', '소금']
    ];
    start();

    function start() {
      const targets = pick(POOL, 5);
      let left = 10;

      root.innerHTML = `
        <div class="stage">
          <p class="stage__hint">🛒 오늘 장 볼 물건 5가지예요</p>
          <p class="countdown" id="cd">${left}초 뒤에 사라져요</p>
          <div class="items-grid">
            ${targets.map(([e, n]) => `<span class="item-chip item-chip--static"><em>${e}</em>${n}</span>`).join('')}
          </div>
          <button type="button" class="btn btn--ghost" id="skip">다 외웠어요 →</button>
        </div>`;

      const tick = every(1000, () => {
        left--;
        const cd = $('#cd', root);
        if (cd) cd.textContent = `${left}초 뒤에 사라져요`;
        if (left <= 0) { clearInterval(tick); askAnswer(targets); }
      });
      $('#skip', root).onclick = () => { clearInterval(tick); askAnswer(targets); };
    }

    function askAnswer(targets) {
      const names = targets.map(t => t[1]);
      const decoys = POOL.filter(p => !names.includes(p[1]));
      const options = shuffle(targets.concat(pick(decoys, 5)));
      const picked = new Set();

      root.innerHTML = `
        <div class="stage">
          <p class="stage__hint">🧺 아까 본 물건 <b>5개</b>를 골라 주세요</p>
          <div class="items-grid" id="opts">
            ${options.map(([e, n]) => `<button type="button" class="item-chip" data-n="${n}"><em>${e}</em>${n}</button>`).join('')}
          </div>
          <button type="button" class="btn btn--primary btn--big" id="done" disabled>확인하기 (0/5)</button>
        </div>`;

      const doneBtn = $('#done', root);
      $$('.item-chip', root).forEach((chip) => {
        chip.onclick = () => {
          const name = chip.dataset.n;
          if (picked.has(name)) { picked.delete(name); chip.classList.remove('is-picked'); }
          else if (picked.size < 5) { picked.add(name); chip.classList.add('is-picked'); beep(700, 70); }
          doneBtn.textContent = `확인하기 (${picked.size}/5)`;
          doneBtn.disabled = picked.size !== 5;
        };
      });

      doneBtn.onclick = () => {
        let correct = 0;
        $$('.item-chip', root).forEach((chip) => {
          const name = chip.dataset.n;
          const isTarget = names.includes(name);
          const isPicked = picked.has(name);
          chip.classList.remove('is-picked');
          chip.disabled = true;
          if (isTarget && isPicked) { chip.classList.add('is-right'); correct++; }
          else if (isPicked)        { chip.classList.add('is-miss'); }
          else if (isTarget)        { chip.classList.add('is-right'); }
        });
        beep(correct >= 4 ? 880 : 330, 200);
        const isNew = saveBest('shopping', correct);
        after(1600, () => {
          showResult(root, {
            emoji: correct === 5 ? '🏆' : correct >= 3 ? '👏' : '🌱',
            title: `5개 중 ${correct}개 맞혔어요!`,
            desc: `정답은 <b>${names.join(', ')}</b> 였어요.<br />
                   ${isNew ? '새로운 최고 기록이에요!<br />' : ''}
                   실제로 장 보러 갈 때도 종이 대신 머리로 외워 보세요 🛒`,
            retry: start
          });
        });
      };
    }
  }

  /* ============================================================
     7. 게임 5 — 색깔 맞추기 (스트룹)
     ============================================================ */
  function gameStroop(root) {
    const COLORS = [
      { name: '빨강', hex: '#e2574c' },
      { name: '파랑', hex: '#4b7be5' },
      { name: '초록', hex: '#3d9e78' },
      { name: '노랑', hex: '#d9a127' }
    ];
    start();

    function start() {
      let score = 0, left = 45, locked = false;

      root.innerHTML = `
        <div class="stage quiz">
          <div class="hud">
            <span class="hud__item">맞힌 개수 <b id="sc">0</b></span>
            <span class="hud__item">남은 시간 <b id="tm">45</b>초</span>
          </div>
          <p class="stage__hint">글자의 <b>뜻</b>이 아니라 <b>색깔</b>을 고르세요!</p>
          <div class="stroop-word" id="w">준비</div>
          <div class="choices" id="ch"></div>
        </div>`;

      every(1000, () => {
        left--;
        const t = $('#tm', root);
        if (t) t.textContent = left;
        if (left <= 0) finish(score);
      });

      nextQuestion();

      function nextQuestion() {
        const wordColor = COLORS[rand(0, 3)];
        let inkColor;
        if (Math.random() < 0.75) {              // 75%는 일부러 글자 뜻과 색을 다르게
          const others = COLORS.filter(c => c.name !== wordColor.name);
          inkColor = others[rand(0, others.length - 1)];
        } else {
          inkColor = COLORS[rand(0, 3)];
        }
        const word = $('#w', root);
        word.textContent = wordColor.name;
        word.style.color = inkColor.hex;

        const box = $('#ch', root);
        box.innerHTML = shuffle(COLORS)
          .map(c => `<button type="button" class="choice" data-n="${c.name}">${c.name}</button>`).join('');

        $$('.choice', box).forEach((btn) => {
          btn.onclick = () => {
            if (locked) return;
            locked = true;
            const good = btn.dataset.n === inkColor.name;
            btn.classList.add(good ? 'is-right' : 'is-wrong');
            if (good) { score++; $('#sc', root).textContent = score; beep(880, 110); }
            else {
              beep(220, 200);
              const right = $$('.choice', box).find(c => c.dataset.n === inkColor.name);
              if (right) right.classList.add('is-right');
            }
            after(good ? 320 : 800, () => { locked = false; if (left > 0) nextQuestion(); });
          };
        });
      }
    }

    function finish(score) {
      clearTimers();
      const isNew = saveBest('stroop', score);
      showResult(root, {
        emoji: score >= 20 ? '🏅' : '🎨',
        title: `45초 동안 ${score}개 정답!`,
        desc: isNew
          ? '🏆 새로운 최고 기록이에요!<br />헷갈리는 걸 참아내는 힘(억제력)이 좋아지고 있어요.'
          : `지금까지 최고 기록은 ${store.get('best:stroop', score)}개예요.`,
        retry: start
      });
    }
  }

  /* ============================================================
     8. 게임 6 — 순서 기억하기
     ============================================================ */
  function gameSequence(root) {
    const TONES = [392, 523, 659, 784];
    let best = 0;
    start();

    function start() {
      const order = [];
      let round = 0;
      build();
      nextRound();

      function build() {
        root.innerHTML = `
          <div class="stage">
            <div class="hud">
              <span class="hud__item">단계 <b id="rd">1</b></span>
              <span class="hud__item">최고 <b>${store.get('best:sequence', 0)}</b>단계</span>
            </div>
            <p class="stage__hint" id="hint">불빛 순서를 잘 보세요</p>
            <div class="pads" id="pads">
              ${[0,1,2,3].map(i => `<button type="button" class="pad pad--${i}" data-i="${i}" aria-label="${i + 1}번 칸"></button>`).join('')}
            </div>
          </div>`;
      }

      function light(i, ms) {
        const pad = root.querySelector(`.pad[data-i="${i}"]`);
        if (!pad) return;
        pad.classList.add('is-on');
        beep(TONES[i], ms);
        after(ms, () => pad.classList.remove('is-on'));
      }

      function nextRound() {
        round++;
        order.push(rand(0, 3));
        const rd = $('#rd', root); if (rd) rd.textContent = round;
        const hint = $('#hint', root); if (hint) hint.textContent = '불빛 순서를 잘 보세요 👀';
        setPadsEnabled(false);

        const speed = Math.max(360, 700 - round * 25);
        order.forEach((v, idx) => after(600 + idx * (speed + 180), () => light(v, speed)));
        after(600 + order.length * (speed + 180) + 200, () => {
          const h = $('#hint', root); if (h) h.textContent = '이제 똑같이 눌러 주세요 👆';
          listen();
        });
      }

      function setPadsEnabled(on) {
        $$('.pad', root).forEach(p => { p.disabled = !on; });
      }

      function listen() {
        let step = 0;
        setPadsEnabled(true);
        $$('.pad', root).forEach((pad) => {
          pad.onclick = () => {
            const i = Number(pad.dataset.i);
            light(i, 260);
            if (i === order[step]) {
              step++;
              if (step === order.length) {
                setPadsEnabled(false);
                best = round;
                after(600, nextRound);
              }
            } else {
              setPadsEnabled(false);
              after(500, () => gameOver(round));
            }
          };
        });
      }
    }

    function gameOver(round) {
      clearTimers();
      const reached = Math.max(0, round - 1);
      const isNew = saveBest('sequence', reached);
      showResult(root, {
        emoji: reached >= 6 ? '🌟' : '🍀',
        title: `${reached}단계까지 기억했어요!`,
        desc: isNew
          ? '🏆 새로운 최고 기록이에요!'
          : `지금까지 최고 기록은 ${store.get('best:sequence', reached)}단계예요.<br />보통 4~5단계면 아주 좋아요.`,
        retry: start
      });
    }
  }

  /* ============================================================
     9. 게임 목록 & 카드
     ============================================================ */
  const GAMES = [
    {
      id: 'reverse', emoji: '🔢', title: '거꾸로 숫자',
      desc: '나온 숫자를 거꾸로 입력해요. 정보를 붙잡고 뒤집는 <b>작업기억</b> 훈련.',
      bestLabel: (v) => v ? `🏆 최고 ${v}자리` : '아직 기록이 없어요',
      mount: gameReverse
    },
    {
      id: 'memory', emoji: '🃏', title: '짝 맞추기',
      desc: '같은 그림 카드를 찾아요. 위치를 떠올리는 <b>단기 기억</b> 훈련.',
      bestLabel: (v) => v ? `🏆 최소 ${v}번` : '아직 기록이 없어요',
      mount: gameMemory
    },
    {
      id: 'math', emoji: '➕', title: '암산 훈련',
      desc: '60초 동안 계산기 없이 풀어요. <b>주의력과 처리 속도</b> 훈련.',
      bestLabel: (v) => v ? `🏆 최고 ${v}문제` : '아직 기록이 없어요',
      mount: gameMath
    },
    {
      id: 'shopping', emoji: '🛒', title: '장보기 기억',
      desc: '장 볼 물건 5개를 외웠다가 찾아요. 실생활에 가장 가까운 훈련.',
      bestLabel: (v) => v ? `🏆 최고 ${v}개` : '아직 기록이 없어요',
      mount: gameShopping
    },
    {
      id: 'stroop', emoji: '🎨', title: '색깔 맞추기',
      desc: '글자 뜻 말고 <b>색깔</b>을 골라요. 헷갈림을 참는 <b>억제력</b> 훈련.',
      bestLabel: (v) => v ? `🏆 최고 ${v}개` : '아직 기록이 없어요',
      mount: gameStroop
    },
    {
      id: 'sequence', emoji: '💡', title: '순서 기억',
      desc: '불빛이 켜진 순서대로 눌러요. <b>순서 기억력</b> 훈련.',
      bestLabel: (v) => v ? `🏆 최고 ${v}단계` : '아직 기록이 없어요',
      mount: gameSequence
    }
  ];

  function renderGameCards() {
    const grid = $('#gameGrid');
    if (!grid) return;
    grid.innerHTML = GAMES.map((g) => {
      const best = store.get('best:' + g.id, 0);
      return `
        <article class="gcard">
          <span class="gcard__emoji" aria-hidden="true">${g.emoji}</span>
          <h3 class="gcard__title">${g.title}</h3>
          <p class="gcard__desc">${g.desc}</p>
          <span class="gcard__best">${g.bestLabel(best)}</span>
          <button type="button" class="btn btn--primary" data-game="${g.id}">시작하기 →</button>
        </article>`;
    }).join('');

    $$('[data-game]', grid).forEach((btn) => {
      btn.onclick = () => {
        const g = GAMES.find(x => x.id === btn.dataset.game);
        clearTimers();
        openModal(`${g.emoji} ${g.title}`, g.mount);
      };
    });
  }

  /* ============================================================
     10. 오늘의 실천 체크리스트
     ============================================================ */
  const TASKS = [
    { id: 'walk',   emoji: '🚶', text: '20~30분 걷기',        sub: '10분씩 나눠서 해도 좋아요' },
    { id: 'talk',   emoji: '💬', text: '누군가와 대화하기',    sub: '전화나 영상통화도 괜찮아요' },
    { id: 'game',   emoji: '🎮', text: '두뇌게임 한 가지 하기', sub: '위 게임 중 아무거나 하나' },
    { id: 'sleep',  emoji: '😴', text: '어젯밤 7시간 이상 잤어요', sub: '자는 동안 뇌가 청소를 해요' },
    { id: 'water',  emoji: '💧', text: '물 6잔 이상 마시기',   sub: '탈수는 기억력을 떨어뜨려요' },
    { id: 'hand',   emoji: '🪥', text: '반대 손으로 무언가 하기', sub: '양치질, 숟가락질 등' },
    { id: 'road',   emoji: '🗺️', text: '새로운 길로 다녀오기',  sub: '평소와 다른 길 한 번' },
    { id: 'veggie', emoji: '🥗', text: '채소·생선 챙겨 먹기',   sub: '견과류 한 줌도 좋아요' }
  ];

  const dayKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /* 오늘 체크한 개수 */
  function todayCount() {
    const state = store.get('check:' + todayKey(), {});
    return TASKS.filter(t => state[t.id]).length;
  }

  /* 체크 하나를 켜고 기록에 반영 (게임 완료 시에도 씁니다) */
  function markTaskDone(taskId) {
    const key = todayKey();
    const state = store.get('check:' + key, {});
    if (state[taskId]) return;                 // 이미 되어 있으면 그대로
    state[taskId] = true;
    store.set('check:' + key, state);
    saveDayCount(key, TASKS.filter(t => state[t.id]).length);
    initToday();
    renderStreak();
  }

  function saveDayCount(key, count) {
    const log = store.get('log', {});
    const was = (log[key] || 0) >= STREAK_GOAL;
    log[key] = count;
    store.set('log', log);

    /* 오늘 처음 목표를 넘긴 순간 축하 */
    if (!was && count >= STREAK_GOAL) {
      const s = calcStreak();
      updateBestStreak(s);
      const hit = MILESTONES.find(m => m.days === s);
      if (hit) toast(`${hit.emoji} ${hit.name} 배지 획득! ${s}일 연속이에요!`, 4500);
      else toast(`🔥 오늘 달성! ${s}일 연속이에요`, 3600);
      beep(880, 160);
      after(160, () => beep(1170, 220));
    }
  }

  function initToday() {
    const list = $('#checklist');
    if (!list) return;
    const key = todayKey();
    const state = store.get('check:' + key, {});

    list.innerHTML = TASKS.map((t) => `
      <li>
        <label class="check">
          <input type="checkbox" data-task="${t.id}" ${state[t.id] ? 'checked' : ''} />
          <span class="check__box" aria-hidden="true">✓</span>
          <span class="check__emoji" aria-hidden="true">${t.emoji}</span>
          <span class="check__text">${t.text}<small>${t.sub}</small></span>
        </label>
      </li>`).join('');

    $$('[data-task]', list).forEach((input) => {
      input.addEventListener('change', () => {
        state[input.dataset.task] = input.checked;
        store.set('check:' + key, state);
        const count = TASKS.filter(t => state[t.id]).length;
        saveDayCount(key, count);
        if (input.checked) beep(760, 110);
        paint(count);
        renderStreak();
      });
    });

    const d = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dateEl = $('#todayDate');
    if (dateEl) dateEl.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;

    paint(TASKS.filter(t => state[t.id]).length);
  }

  function paint(count) {
    const ring = $('#ring');
    if (!ring) return;
    $('#ringNum').textContent = count;
    ring.style.setProperty('--p', Math.round((count / TASKS.length) * 100));

    const msgs = [
      '오늘 하나만이라도 시작해 볼까요? 🌱',
      '좋아요, 첫 걸음을 뗐어요! 👏',
      '하나만 더 하면 오늘 달성이에요 🙂',
      '오늘 달성! 불꽃이 하루 늘었어요 🔥',
      '벌써 절반이에요! 대단해요 ✨',
      '오늘 정말 잘하고 계세요 🌷',
      '뇌가 아주 신났겠는데요? 🧠',
      '거의 다 왔어요! 조금만 더 💪',
      '오늘의 실천 완성! 최고예요 🏆'
    ];
    $('#todayMsg').textContent = msgs[Math.min(count, msgs.length - 1)];
  }

  /* ============================================================
     11. 말랑 스트리크
     ------------------------------------------------------------
     하루 STREAK_GOAL개 이상 실천한 날 = "달성".
     달성한 날이 연달아 이어진 수가 스트리크입니다.
     오늘은 아직 안 했어도 자정까지 시간이 남았으므로 끊긴 것으로 보지 않고,
     어제가 비어 있으면 그때 끊긴 것으로 봅니다. (스냅챗 방식과 같아요)
     ============================================================ */
  const MILESTONES = [
    { days: 3,   emoji: '🌱', name: '새싹' },
    { days: 7,   emoji: '🔥', name: '일주일' },
    { days: 14,  emoji: '⭐', name: '2주' },
    { days: 30,  emoji: '🏆', name: '한 달' },
    { days: 50,  emoji: '💎', name: '50일' },
    { days: 100, emoji: '💯', name: '100일' }
  ];

  function calcStreak() {
    const log = store.get('log', {});
    const d = new Date();
    if ((log[dayKey(d)] || 0) < STREAK_GOAL) d.setDate(d.getDate() - 1);  // 오늘은 아직 기회가 있음

    let streak = 0;
    for (let i = 0; i < 1000; i++) {
      if ((log[dayKey(d)] || 0) >= STREAK_GOAL) { streak++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return streak;
  }

  function updateBestStreak(current) {
    if (current > store.get('bestStreak', 0)) store.set('bestStreak', current);
  }

  function hoursLeftToday() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return Math.max(0, Math.ceil((midnight - now) / 3600000));
  }

  function renderStreak() {
    const box = $('#flamebox');
    if (!box) return;

    /* 오늘 기록을 체크리스트에 맞춰 둡니다.
       (페이지를 켜 둔 채 자정을 넘긴 경우처럼 둘이 어긋날 수 있어요) */
    const log = store.get('log', {});
    const count = todayCount();
    const tk = todayKey();
    if ((count > 0 || log[tk] !== undefined) && log[tk] !== count) {
      log[tk] = count;
      store.set('log', log);
    }

    const streak = calcStreak();
    updateBestStreak(streak);

    const doneToday = count >= STREAK_GOAL;
    const total = Object.keys(log).filter(k => log[k] >= STREAK_GOAL).length;

    /* 불꽃 */
    box.classList.toggle('is-cold', streak === 0);
    $('#flameNum').textContent = streak;
    $('#flameEmoji').textContent = doneToday ? '🔥' : (streak > 0 ? '⌛' : '🕯️');
    $('#flameLabel').textContent = streak > 0 ? '일 연속 실천 중!' : '아직 불꽃이 없어요';

    let status;
    if (doneToday) {
      status = `오늘 실천 완료! 내일도 이어가면 ${streak + 1}일이 돼요 ✨`;
    } else if (streak > 0) {
      status = `⌛ 오늘 ${STREAK_GOAL - count}가지만 더 하면 불꽃이 이어져요 (자정까지 약 ${hoursLeftToday()}시간)`;
    } else {
      status = `오늘 ${STREAK_GOAL}가지를 실천하면 불꽃이 시작돼요 🔥`;
    }
    $('#flameStatus').textContent = status;

    /* 요약 */
    const best = store.get('bestStreak', 0);
    const next = MILESTONES.find(m => m.days > streak);
    $('#statBest').textContent = best;
    $('#statTotal').textContent = total;
    $('#statToday').textContent = `${count}/${TASKS.length}`;
    $('#statNext').textContent = next ? `${next.emoji} ${next.days - streak}일` : '전부 달성!';
    const goalEl = $('#goalCount');
    if (goalEl) goalEl.textContent = STREAK_GOAL;

    /* 배지 */
    $('#badges').innerHTML = MILESTONES.map((m) => {
      const earned = best >= m.days;
      return `
        <li class="badge-item ${earned ? 'is-earned' : ''}">
          <em>${earned ? m.emoji : '🔒'}</em>
          <b>${m.name}</b>
          <span>${m.days}일 연속</span>
        </li>`;
    }).join('');

    /* 최근 4주 달력 */
    const cal = $('#calendar');
    const start = new Date();
    start.setDate(start.getDate() - 27);
    const pad = start.getDay();                 // 요일 칸 맞추기
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push('<li><span class="calcell calcell--empty"></span></li>');
    for (let i = 0; i < 28; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = dayKey(d);
      const c = log[k] || 0;
      const cls = c >= STREAK_GOAL ? 'calcell--full' : (c > 0 ? 'calcell--part' : '');
      const isToday = k === todayKey() ? ' calcell--today' : '';
      cells.push(
        `<li><span class="calcell ${cls}${isToday}" title="${k} · ${c}가지 실천">${d.getDate()}</span></li>`
      );
    }
    cal.innerHTML = cells.join('');
  }

  /* ============================================================
     12. 계정 칩 · 내 기록 페이지
     ============================================================ */
  function renderAccount() {
    const box = $('#account');
    if (!box) return;
    const streak = calcStreak();

    if (currentUser) {
      box.innerHTML = `
        <a class="account__btn" href="#me">
          ${avatarHtml(currentUser, 'account__avatar')}
          <span class="account__name">${currentUser.name}</span>
          <span class="account__flame">🔥${streak}</span>
        </a>`;
    } else {
      box.innerHTML = `
        <a class="account__btn" href="#me">
          <span class="account__avatar">👤</span>
          <span class="account__name">로그인</span>
        </a>`;
    }

    /* 홈 인사말도 이름에 맞춰 바꿔 줍니다 */
    const greet = $('#heroGreeting');
    if (greet) {
      greet.textContent = currentUser
        ? `🌿 ${currentUser.name}님, 오늘도 반가워요` + (streak ? ` · 🔥${streak}일째` : '')
        : '🌿 하루 15분, 집에서 시작하는 뇌 건강';
    }
  }

  function renderMe() {
    const body = $('#meBody');
    if (!body) return;

    const streak = calcStreak();
    const best = store.get('bestStreak', 0);
    const log = store.get('log', {});
    const total = Object.keys(log).filter(k => log[k] >= STREAK_GOAL).length;

    const records = GAMES.map((g) => {
      const v = store.get('best:' + g.id, 0);
      return `<li><b>${v || '-'}</b><span>${g.emoji} ${g.title}</span></li>`;
    }).join('');

    if (currentUser) {
      $('#meTitle').textContent = '👤 내 기록';
      $('#meDesc').textContent = '지금까지 쌓은 기록이에요.';
      body.innerHTML = `
        <div class="mecard">
          <div class="profile">
            ${avatarHtml(currentUser, 'profile__pic')}
            <div>
              <p class="profile__name">${currentUser.name}</p>
              ${currentUser.loginId ? `<p class="profile__id">@${currentUser.loginId}</p>` : ''}
              <p class="profile__mail">${currentUser.email || ''}</p>
            </div>
          </div>
          <div class="me__actions">
            <button type="button" class="btn btn--ghost" id="btnSignOut">🚪 로그아웃</button>
          </div>
        </div>

        <div class="mecard">
          <h3>🔥 말랑 스트리크</h3>
          <ul class="recordlist">
            <li><b>${streak}</b><span>지금 연속</span></li>
            <li><b>${best}</b><span>최고 기록</span></li>
            <li><b>${total}</b><span>총 달성일</span></li>
          </ul>
        </div>

        <div class="mecard">
          <h3>🎮 게임 최고 기록</h3>
          <ul class="recordlist">${records}</ul>
        </div>

        <div class="mecard">
          <p>${cloud && cloud.user
            ? '기록이 <b>서버에 안전하게 저장</b>돼요.<br />휴대폰이든 컴퓨터든 같은 이메일로 들어오면 그대로 보입니다.'
            : '기록은 <b>지금 쓰는 이 기기 안에만</b> 저장돼요.<br />다른 휴대폰이나 컴퓨터에서는 보이지 않습니다.'}</p>
          <div class="me__actions">
            <button type="button" class="btn btn--danger" id="btnReset">기록 모두 지우기</button>
          </div>
        </div>`;
    } else {
      $('#meTitle').textContent = '👋 로그인';
      $('#meDesc').textContent = '이메일을 넣어 주세요. 처음이시면 그 자리에서 바로 만들어 드려요.';
      renderLoginFlow(body);
    }

    const outBtn = $('#btnSignOut');
    if (outBtn) outBtn.onclick = () => { signOut(); location.hash = '#home'; };

    const resetBtn = $('#btnReset');
    if (resetBtn) resetBtn.onclick = async () => {
      if (!window.confirm(`${currentUser.name}님의 스트리크와 게임 기록이 모두 지워집니다. 정말 지울까요?`)) return;
      store.clear();
      /* 서버에도 빈 상태를 올려야 다른 기기에서 되살아나지 않습니다 */
      if (cloud && cloud.user) {
        cloud.save(collectLocal());
        try { await cloud.flush(); } catch (e) {}
      }
      refreshAll();
      toast('기록을 모두 지웠어요.');
    };
  }

  /* ------------------------------------------------------------
     로그인 화면 — 이메일 → 비밀번호 → (처음이면) 아이디·이름
     ------------------------------------------------------------ */
  function renderLoginFlow(body) {
    let step = 1;
    let email = '';
    let existing = null;      // 이미 가입한 사람이면 그 프로필

    body.innerHTML = `
      <div class="mecard mecard--signin">
        <ol class="steps" id="steps">
          <li class="is-on">이메일</li>
          <li>비밀번호</li>
          <li>이름</li>
        </ol>
        <div id="stepBody"></div>
        <p class="mecard__hint">로그인하지 않아도 모든 기능은 그대로 쓸 수 있어요 🙂</p>
      </div>

      <div class="mecard" id="googleCard" hidden>
        <p class="mecard__hint">또는</p>
        <div class="gsi" id="gsiButton"></div>
      </div>`;

    if (CFG.GOOGLE_CLIENT_ID) $('#googleCard').hidden = false;

    const stepBody = $('#stepBody');
    const marks = $$('#steps li', body);

    function setStep(n) {
      step = n;
      marks.forEach((li, i) => {
        li.classList.toggle('is-on', i === n - 1);
        li.classList.toggle('is-done', i < n - 1);
      });
    }

    /* --- 1단계: 이메일 --- */
    function stepEmail() {
      setStep(1);
      stepBody.innerHTML = `
        <label class="fieldlabel" for="fEmail">이메일</label>
        <input type="email" class="bigfield" id="fEmail" inputmode="email"
               autocomplete="username" placeholder="example@gmail.com" value="${email}" />
        <p class="fieldhelp">평소 쓰시는 이메일 주소를 그대로 넣으시면 돼요.</p>
        <div class="me__actions">
          <button type="button" class="btn btn--primary btn--big" id="fNext">다음 →</button>
        </div>`;
      const input = $('#fEmail');
      input.focus();
      const go = () => {
        const v = input.value.trim();
        if (!isEmail(v)) { toast('이메일 주소를 정확히 넣어 주세요.'); input.focus(); return; }
        email = v;
        existing = findByEmail(v);
        stepPassword();
      };
      $('#fNext').onclick = go;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }

    /* --- 2단계: 비밀번호 --- */
    function stepPassword() {
      setStep(2);
      /* Firebase 를 쓸 때는 가입 여부를 미리 알 수 없으므로 중립적으로 묻습니다 */
      const isNew = cloud ? false : !existing;
      const neutral = !!cloud;
      stepBody.innerHTML = `
        <p class="whoami">${email}</p>
        <label class="fieldlabel" for="fPw">비밀번호</label>
        <div class="pwwrap">
          <input type="password" class="bigfield" id="fPw"
                 autocomplete="${isNew ? 'new-password' : 'current-password'}"
                 placeholder="${MIN_PW}자 이상" />
          <button type="button" class="pweye" id="fEye" aria-label="비밀번호 보기">👁️</button>
        </div>
        <p class="fieldhelp">${neutral
          ? '처음이시면 여기 넣으신 비밀번호로 계정을 만들어 드려요.'
          : '이 사이트에서 쓰실 비밀번호를 정해 주세요.'}</p>
        <p class="warnbox">
          ⚠️ <b>이 사이트에서만 쓰는 비밀번호예요.</b><br />
          구글·은행·카카오에서 쓰시는 비밀번호는 넣지 마세요.
        </p>
        <div class="me__actions">
          <button type="button" class="btn btn--primary btn--big" id="fNext">
            ${neutral ? '다음 →' : (isNew ? '다음 →' : '들어가기 →')}
          </button>
          <button type="button" class="btn btn--ghost" id="fBack">← 뒤로</button>
        </div>`;

      const input = $('#fPw');
      input.focus();

      $('#fEye').onclick = () => {
        input.type = input.type === 'password' ? 'text' : 'password';
      };
      $('#fBack').onclick = stepEmail;

      const restore = () => {
        const btn = $('#fNext');
        if (btn) { btn.disabled = false; btn.textContent = existing ? '들어가기 →' : '다음 →'; }
      };

      const go = async () => {
        const pw = input.value;
        if (pw.length < MIN_PW) {
          toast(`비밀번호는 ${MIN_PW}자 이상으로 넣어 주세요.`); input.focus(); return;
        }
        const btn = $('#fNext');
        btn.disabled = true;
        btn.textContent = '잠시만요…';

        /* --- Firebase 를 쓸 수 있을 때 --- */
        if (cloud) {
          try {
            await cloud.signIn(email, pw);
            await afterCloudLogin();
            location.hash = '#streak';
          } catch (err) {
            const code = (err && err.code) || '';
            if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' ||
                code === 'auth/wrong-password') {
              stepAskNew(pw);                    // 처음인지 되물어봅니다
            } else {
              toast(cloud.message(err), 4200);
              input.value = ''; input.focus();
              restore();
            }
          }
          return;
        }

        /* --- 예비 방식 (인터넷이 없거나 Firebase 설정이 없을 때) --- */
        if (!cryptoReady()) {
          toast('이 브라우저에서는 로그인을 쓸 수 없어요. 인터넷 연결을 확인해 주세요.', 5000);
          restore();
          return;
        }
        try {
          if (existing) {
            const ok = await verifyPassword(existing, pw);
            if (!ok) {
              toast('비밀번호가 맞지 않아요. 다시 넣어 주세요.');
              input.value = ''; input.focus();
              restore();
              return;
            }
            signIn(existing, false);
            location.hash = '#streak';
          } else {
            stepName(pw);
          }
        } catch (e) {
          toast('로그인 처리 중 문제가 생겼어요. 다시 시도해 주세요.');
          restore();
        }
      };
      $('#fNext').onclick = go;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }

    /* --- 로그인 실패: 처음 오신 분인지 되묻기 --- */
    function stepAskNew(password) {
      setStep(2);
      stepBody.innerHTML = `
        <p class="whoami">${email}</p>
        <p class="askbox">
          이 이메일로 <b>가입된 계정이 없거나</b>,<br />비밀번호가 다른 것 같아요.
        </p>
        <div class="me__actions me__actions--stack">
          <button type="button" class="btn btn--primary btn--big" id="fMake">
            처음이에요 · 새로 만들기 →
          </button>
          <button type="button" class="btn btn--ghost btn--big" id="fRetry">
            비밀번호를 다시 넣을게요
          </button>
        </div>`;
      $('#fMake').onclick = () => stepName(password);
      $('#fRetry').onclick = () => stepPassword();
    }

    /* --- 3단계: 아이디 + 이름 (처음 오신 분만) --- */
    function stepName(password) {
      setStep(3);
      stepBody.innerHTML = `
        <p class="whoami">${email}</p>
        <label class="fieldlabel" for="fId">아이디</label>
        <input type="text" class="bigfield" id="fId" maxlength="20"
               autocomplete="off" placeholder="예) sunja77" />
        <p class="fieldhelp">영어나 숫자로 짧게 지으시면 돼요.</p>

        <label class="fieldlabel" for="fName">이름</label>
        <input type="text" class="bigfield" id="fName" maxlength="12"
               autocomplete="name" placeholder="예) 김순자" />
        <p class="fieldhelp">화면에 표시될 이름이에요.</p>

        <div class="me__actions">
          <button type="button" class="btn btn--primary btn--big" id="fDone">시작하기 →</button>
          <button type="button" class="btn btn--ghost" id="fBack">← 뒤로</button>
        </div>`;

      const idInput = $('#fId');
      const nameInput = $('#fName');
      idInput.focus();
      $('#fBack').onclick = stepPassword;

      const go = async () => {
        const loginId = idInput.value.trim();
        const name = nameInput.value.trim();
        if (!loginId) { toast('아이디를 넣어 주세요.'); idInput.focus(); return; }
        if (!name) { toast('이름을 넣어 주세요.'); nameInput.focus(); return; }

        const btn = $('#fDone');
        btn.disabled = true;
        btn.textContent = '만드는 중…';
        try {
          if (cloud) {
            await cloud.signUp(email, password, name);
            await afterCloudLogin({ name: name, loginId: loginId });
          } else {
            await registerAccount(email, password, loginId, name);
          }
          location.hash = '#streak';
        } catch (err) {
          const code = (err && err.code) || '';
          if (cloud && code === 'auth/email-already-in-use') {
            toast('이미 가입된 이메일이에요. 비밀번호를 다시 넣어 주세요.', 4200);
            stepPassword();
            return;
          }
          toast(cloud ? cloud.message(err) : '계정을 만들지 못했어요. 다시 시도해 주세요.', 4200);
          btn.disabled = false;
          btn.textContent = '시작하기 →';
        }
      };
      $('#fDone').onclick = go;
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }

    stepEmail();
  }

  /* 로그인/로그아웃 등으로 저장 칸이 바뀌면 화면 전체를 다시 그립니다 */
  function refreshAll() {
    renderGameCards();
    initToday();
    renderStreak();
    renderAccount();
    if (currentPage() === 'me') renderMe();
  }

  /* ============================================================
     13. 시작
     ============================================================ */
  migrateLegacy();
  initFontControl();
  initAuth();            // 예비 방식(기기 저장)의 로그인 정보 복구
  refreshAll();
  initRouter();          // 페이지 표시는 맨 마지막에 (다른 준비가 끝난 뒤)
  initCloud();           // Firebase 는 준비되는 대로 이어서 붙습니다
})();
