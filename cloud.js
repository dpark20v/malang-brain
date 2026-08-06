/* ============================================================
   말랑뇌 · cloud.js
   ------------------------------------------------------------
   Firebase 연결 담당. app.js 는 이 파일이 만들어 주는
   window.MalangCloud 만 보고 동작합니다.

   - 로그인/가입: Firebase Authentication (이메일 + 비밀번호)
   - 기록 저장: Realtime Database  users/<uid>/...

   Firebase 설정이 없거나 인터넷이 끊겨 있으면 available = false 가 되고,
   app.js 는 예전처럼 이 기기 안에만 저장하는 방식으로 동작합니다.
   ============================================================ */

const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';

const Cloud = {
  available: false,      // Firebase 를 쓸 수 있는 상태인가
  ready: null,           // 준비가 끝나면 resolve 되는 약속
  user: null,            // 로그인한 사람 { uid, email }
  _authCallbacks: [],
  _fb: null,             // 불러온 Firebase 함수 모음
  _saveTimer: null,
  _pending: null
};

/* 로그인 상태가 바뀔 때마다 알려 줍니다 */
Cloud.onAuth = function (fn) {
  Cloud._authCallbacks.push(fn);
  if (Cloud.available) fn(Cloud.user);
};

function fireAuth() {
  Cloud._authCallbacks.forEach((fn) => {
    try { fn(Cloud.user); } catch (e) {}
  });
}

/* ---------- 준비 ---------- */
Cloud.ready = (async function init() {
  const cfg = (window.MALANG_CONFIG || {}).FIREBASE;
  if (!cfg || !cfg.apiKey) return false;          // 설정 없음 → 기기 저장만

  try {
    const [appMod, authMod, dbMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-database.js`)
    ]);

    const app = appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);
    const db = dbMod.getDatabase(app);

    Cloud._fb = { auth, db, authMod, dbMod };
    Cloud.available = true;

    /* 새로고침해도 로그인이 유지됩니다 */
    await new Promise((resolve) => {
      let first = true;
      authMod.onAuthStateChanged(auth, (u) => {
        Cloud.user = u ? { uid: u.uid, email: u.email, name: u.displayName || '' } : null;
        if (first) { first = false; resolve(); }
        else fireAuth();
      });
    });

    fireAuth();
    return true;
  } catch (e) {
    console.warn('[말랑뇌] Firebase 연결 실패 — 이 기기에만 저장합니다.', e);
    Cloud.available = false;
    return false;
  }
})();

/* ---------- 가입 ---------- */
Cloud.signUp = async function (email, password, name) {
  const { auth, authMod } = Cloud._fb;
  const cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
  if (name) {
    try { await authMod.updateProfile(cred.user, { displayName: name }); } catch (e) {}
  }
  Cloud.user = { uid: cred.user.uid, email: cred.user.email, name: name || '' };
  return Cloud.user;
};

/* ---------- 로그인 ---------- */
Cloud.signIn = async function (email, password) {
  const { auth, authMod } = Cloud._fb;
  const cred = await authMod.signInWithEmailAndPassword(auth, email, password);
  Cloud.user = {
    uid: cred.user.uid, email: cred.user.email, name: cred.user.displayName || ''
  };
  return Cloud.user;
};

/* ---------- 로그아웃 ---------- */
Cloud.signOut = async function () {
  if (!Cloud.available) return;
  await Cloud.flush();
  const { auth, authMod } = Cloud._fb;
  await authMod.signOut(auth);
  Cloud.user = null;
};

/* ---------- 비밀번호 재설정 메일 ---------- */
Cloud.resetPassword = async function (email) {
  const { auth, authMod } = Cloud._fb;
  await authMod.sendPasswordResetEmail(auth, email);
};

/* ---------- 서버에서 내 기록 읽기 ---------- */
Cloud.load = async function () {
  if (!Cloud.available || !Cloud.user) return null;
  const { db, dbMod } = Cloud._fb;
  const snap = await dbMod.get(dbMod.ref(db, 'users/' + Cloud.user.uid));
  return snap.exists() ? snap.val() : null;
};

/* ---------- 서버에 내 기록 저장 (몰아서 한 번에) ----------
   체크할 때마다 바로 보내면 통신이 잦아지므로,
   마지막 변경 후 1.5초 뒤에 한 번만 보냅니다. */
Cloud.save = function (data) {
  if (!Cloud.available || !Cloud.user) return;
  Cloud._pending = data;
  clearTimeout(Cloud._saveTimer);
  Cloud._saveTimer = setTimeout(() => { Cloud.flush(); }, 1500);
};

Cloud.flush = async function () {
  clearTimeout(Cloud._saveTimer);
  if (!Cloud.available || !Cloud.user || !Cloud._pending) return;
  const data = Cloud._pending;
  Cloud._pending = null;
  try {
    const { db, dbMod } = Cloud._fb;
    data.updatedAt = Date.now();
    await dbMod.set(dbMod.ref(db, 'users/' + Cloud.user.uid), data);
  } catch (e) {
    console.warn('[말랑뇌] 저장 실패 — 기기에는 남아 있습니다.', e);
  }
};

/* 창을 닫기 전에 남은 저장을 마무리 */
window.addEventListener('pagehide', () => { Cloud.flush(); });

/* 오류 코드를 어르신이 알아볼 수 있는 말로 바꿔 줍니다 */
Cloud.message = function (err) {
  const code = (err && err.code) || '';
  switch (code) {
    case 'auth/invalid-email':          return '이메일 주소를 정확히 넣어 주세요.';
    case 'auth/missing-password':       return '비밀번호를 넣어 주세요.';
    case 'auth/weak-password':          return '비밀번호는 6자 이상으로 넣어 주세요.';
    case 'auth/email-already-in-use':   return '이미 가입된 이메일이에요. 비밀번호를 넣고 들어가 주세요.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':     return '이메일이나 비밀번호가 맞지 않아요.';
    case 'auth/too-many-requests':      return '여러 번 틀렸어요. 잠시 뒤에 다시 시도해 주세요.';
    case 'auth/network-request-failed': return '인터넷 연결을 확인해 주세요.';
    case 'auth/unauthorized-domain':    return '이 주소에서는 로그인이 허용되지 않았어요.';
    default:                            return '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.';
  }
};

window.MalangCloud = Cloud;
