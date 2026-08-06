/* ============================================================
   말랑뇌 · 설정 파일
   ============================================================ */

window.MALANG_CONFIG = {

  /* ------------------------------------------------------------
     Firebase (기기 간 기록 동기화 + 로그인)
     ------------------------------------------------------------
     이 값들은 비밀이 아닙니다. 웹사이트 코드에 공개되도록 만들어진
     값이라 남이 봐도 괜찮아요. 실제 보안은 Firestore "규칙"이 담당합니다.
     (규칙은 firestore.rules 파일 참고)

     FIREBASE 를 비워 두면(null) 예전처럼 이 기기 안에만 저장됩니다.
     ------------------------------------------------------------ */
  FIREBASE: {
    apiKey: 'AIzaSyDT98GhjNmi3PXZUYKjUWGom98mroADJXU',
    authDomain: 'malang-brain.firebaseapp.com',
    projectId: 'malang-brain',
    /* Realtime Database 주소 (싱가포르 지역).
       이 줄이 없으면 미국 서버를 찾다가 저장이 실패합니다. */
    databaseURL: 'https://malang-brain-default-rtdb.asia-southeast1.firebasedatabase.app',
    storageBucket: 'malang-brain.firebasestorage.app',
    messagingSenderId: '449876722930',
    appId: '1:449876722930:web:57e7429b40627bb75fbc6b'
  },

  /* ------------------------------------------------------------
     구글 계정으로 로그인 (선택)
     비워 두면 로그인 화면에 구글 버튼이 나타나지 않습니다.
     ------------------------------------------------------------ */
  GOOGLE_CLIENT_ID: '',

  /* 하루에 몇 개를 해내면 그날을 "달성"으로 볼지 (말랑 스트리크 기준) */
  STREAK_GOAL: 3
};
