// 동기화: 메일 주소 + 비밀번호로 로그인 (Firebase Authentication)
// 저장 위치: users/{계정ID} 문서(설정·주간 메모) + users/{계정ID}/items/{일정ID}
// 규칙상 로그인한 본인만 읽고 쓸 수 있다.
// 예전 방식(동기화 코드, calendars/{코드})은 로그인 전까지만 그대로 동작하고, 로그인하면 일정이 계정으로 옮겨진다.
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, setDoc, collection, onSnapshot, writeBatch, getDocsFromServer, getDocFromServer, waitForPendingWrites
} from 'firebase/firestore';
import {
  getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from 'firebase/auth';

const config = {
  apiKey: 'AIzaSyDSYeIGMnBWGFt_ZmbsEATV6oHl2DX6ulo',
  authDomain: 'my-calendar-6313d.firebaseapp.com',
  projectId: 'my-calendar-6313d',
  storageBucket: 'my-calendar-6313d.firebasestorage.app',
  messagingSenderId: '858844703530',
  appId: '1:858844703530:web:d327d221ae0bf9147e4c53'
};

const CODE_KEY = 'mycal-sync-code';   // 예전 동기화 코드
const LAST_KEY = 'mycal-last-sync';

let app = null, db = null, auth = null;
let user = null, legacy = null, unsubs = [], status = 'off', statusCb = () => {};
let S = null, onRemote = () => {};
const setStatus = s => { status = s; statusCb(s); };
const strip = o => JSON.parse(JSON.stringify(o)); // undefined 값 제거
const clean = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');

function ensure() {
  if (app) return;
  app = initializeApp(config);
  try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) }); }
  catch (e) { db = initializeFirestore(app, {}); }
  auth = getAuth(app);
  auth.languageCode = 'ko';
}
// 현재 저장 위치
const base = () => (user ? ['users', user.uid] : legacy ? ['calendars', legacy] : null);
const itemsCol = () => collection(db, ...base(), 'items');
const metaDoc = () => doc(db, ...base());
const markSynced = () => { try { localStorage.setItem(LAST_KEY, new Date().toISOString()); } catch (e) {} };

async function pushAll(withMeta = true) {
  const items = S.allItems();
  for (let i = 0; i < items.length; i += 400) {
    const b = writeBatch(db);
    items.slice(i, i + 400).forEach(it => b.set(doc(db, ...base(), 'items', it.id), strip(it)));
    await b.commit();
  }
  if (withMeta) await setDoc(metaDoc(), strip(S.meta()), { merge: true });
}

function stop() { unsubs.forEach(u => u()); unsubs = []; }
function listen() {
  stop();
  if (!base()) { setStatus('off'); return; }
  setStatus('connecting');
  unsubs.push(onSnapshot(itemsCol(), { includeMetadataChanges: true }, snap => {
    let changed = false;
    snap.docChanges().forEach(ch => { if (ch.type !== 'removed' && S.applyRemoteItem(ch.doc.data())) changed = true; });
    const live = !snap.metadata.fromCache;
    setStatus(live ? 'on' : 'offline');
    if (live && !snap.metadata.hasPendingWrites) markSynced();
    if (changed) onRemote();
  }, err => { console.error(err); setStatus('error'); }));
  unsubs.push(onSnapshot(metaDoc(), snap => {
    if (snap.exists() && S.applyRemoteMeta(snap.data())) onRemote();
  }, err => { console.error(err); setStatus('error'); }));
}

// 로그인 직후: 계정이 비어 있으면 이 기기 일정을 올리고(옛 코드 일정 옮기기),
// 계정에 이미 일정이 있으면 이 기기의 옛 일정은 백업만 하고 계정 일정을 받는다.
async function afterLogin() {
  // 이 기기 일정은 절대 버리지 않고 계정과 합친다 (같은 일정은 최근 수정본)
  const snap = await getDocsFromServer(collection(db, 'users', user.uid, 'items'));
  snap.forEach(d => S.applyRemoteItem(d.data()));
  await pushAll(snap.empty);
  onRemote();
  legacy = null; try { localStorage.removeItem(CODE_KEY); } catch (e) {}
  listen();
}

const MSG = {
  'auth/invalid-email': '메일 주소 형식이 맞지 않아요',
  'auth/missing-password': '비밀번호를 넣어 주세요',
  'auth/weak-password': '비밀번호는 6자 이상이어야 해요',
  'auth/email-already-in-use': '이미 가입된 메일이에요. 로그인을 눌러 주세요',
  'auth/invalid-credential': '메일 주소나 비밀번호가 맞지 않아요',
  'auth/wrong-password': '비밀번호가 맞지 않아요',
  'auth/user-not-found': '가입되지 않은 메일이에요',
  'auth/too-many-requests': '시도가 너무 많아요. 잠시 뒤에 다시 해 주세요',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요',
  'auth/operation-not-allowed': '서버에서 메일 로그인이 아직 켜지지 않았어요',
  'auth/requires-recent-login': '보안을 위해 지금 비밀번호를 한 번 더 넣어 주세요'
};
const friendly = e => new Error(MSG[e && e.code] || (e && e.message) || '문제가 생겼어요');

const Sync = {
  get status() { return status; },
  get email() { return user ? user.email : ''; },
  get loggedIn() { return !!user; },
  get legacyCode() { return legacy; },
  get lastSync() { try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } },
  onStatus(fn) { statusCb = fn; fn(status); },
  clean,

  // 앱 시작 시 호출
  start(Store, onRemoteFn) {
    S = Store; onRemote = onRemoteFn;
    ensure();
    Store.hook('item', it => { if (base()) setDoc(doc(db, ...base(), 'items', it.id), strip(it)).catch(e => { console.error(e); setStatus('error'); }); });
    Store.hook('meta', m => { if (base()) setDoc(metaDoc(), strip(m), { merge: true }).catch(e => { console.error(e); setStatus('error'); }); });
    try { legacy = localStorage.getItem(CODE_KEY) || null; } catch (e) {}
    return new Promise(resolve => {
      let first = true;
      setPersistence(auth, browserLocalPersistence).catch(() => {}).finally(() => {
        onAuthStateChanged(auth, u => {
          const was = user && user.uid; user = u;
          if (first) { first = false; listen(); resolve(!!u); return; }
          if ((u && u.uid) !== was && !u) listen();
        });
      });
    });
  },
  async signUp(email, pw) {
    ensure();
    try { const c = await createUserWithEmailAndPassword(auth, email.trim(), pw); user = c.user; }
    catch (e) { throw friendly(e); }
    await afterLogin();
  },
  async signIn(email, pw) {
    ensure();
    try { const c = await signInWithEmailAndPassword(auth, email.trim(), pw); user = c.user; }
    catch (e) { throw friendly(e); }
    await afterLogin();
  },
  async signOut() { stop(); await signOut(auth); user = null; setStatus('off'); },
  async resetPassword(email) {
    ensure();
    try { await sendPasswordResetEmail(auth, email.trim()); } catch (e) { throw friendly(e); }
  },
  async changePassword(currentPw, newPw) {
    if (!user) throw new Error('로그인되어 있지 않아요');
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPw));
      await updatePassword(user, newPw);
    } catch (e) { throw friendly(e); }
  },
  // 로그인할 때 따로 빼 둔 이 기기의 예전 일정 되살리기
  hasBackup() { try { const b = JSON.parse(localStorage.getItem('mycal-data-backup-before-login') || 'null'); return b && b.items ? Object.keys(b.items).length : 0; } catch (e) { return 0; } },
  async restoreBackup() {
    if (!user) throw new Error('먼저 로그인해 주세요');
    const raw = localStorage.getItem('mycal-data-backup-before-login'); if (!raw) throw new Error('되살릴 백업이 없어요');
    const b = JSON.parse(raw); let n = 0, wb = writeBatch(db), k = 0;
    for (const it of Object.values(b.items || {})) {
      const cur = S.item(it.id);
      if (!cur || (it.updatedAt || '') > (cur.updatedAt || '')) { S.applyRemoteItem(it); wb.set(doc(db, 'users', user.uid, 'items', it.id), strip(it)); n++; k++; }
      if (k >= 400) { await wb.commit(); wb = writeBatch(db); k = 0; }
    }
    if (k) await wb.commit();
    if (b.settings) {
      // 백업에 있던 설정(분류·연차·탄력)도 비어 있는 항목만 채움
      S.updateSettings(s => {
        Object.keys(b.settings).forEach(key => { const v = s[key]; if (v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) s[key] = b.settings[key]; });
        if (b.settings.flex && Array.isArray(s.flex)) { const ids = new Set(s.flex.map(x => x.id)); b.settings.flex.forEach(x => { if (!ids.has(x.id)) s.flex.push(x); }); }
        if (b.settings.leave) s.leave = Object.assign({}, b.settings.leave, s.leave || {});
        if (b.settings.subColors) s.subColors = Object.assign({}, b.settings.subColors, s.subColors || {});
        if (b.settings.cats && s.cats) Object.keys(b.settings.cats).forEach(c => { if (s.cats[c] && b.settings.cats[c].subs) { const set = new Set(s.cats[c].subs); b.settings.cats[c].subs.forEach(x => { if (!set.has(x)) s.cats[c].subs.push(x); }); } });
      });
    }
    if (b.weekMemos) Object.entries(b.weekMemos).forEach(([wk, t]) => { if (t && !S.weekMemo(wk)) S.setWeekMemo(wk, t); });
    onRemote();
    return n;
  },
  // 예전 동기화 코드에 있던 일정을 지금 계정으로 가져오기 (같은 일정은 최근 수정본이 남음)
  async importLegacy(c) {
    if (!user) throw new Error('먼저 로그인해 주세요');
    const code = clean(c);
    if (code.replace(/-/g, '').length < 24) throw new Error('코드를 다시 확인해 주세요');
    let snap;
    try { snap = await getDocsFromServer(collection(db, 'calendars', code, 'items')); }
    catch (e) { throw new Error('가져오지 못했어요. 인터넷 연결을 확인해 주세요'); }
    if (snap.empty) throw new Error('그 코드에는 일정이 없어요');
    let n = 0, b = writeBatch(db), inBatch = 0;
    for (const d of snap.docs) {
      const it = d.data();
      if (S.applyRemoteItem(it)) { b.set(doc(db, 'users', user.uid, 'items', it.id), strip(it)); n++; inBatch++; }
      if (inBatch >= 400) { await b.commit(); b = writeBatch(db); inBatch = 0; }
    }
    if (inBatch) await b.commit();
    onRemote();
    return n;
  },
  // 동기화 버튼: 못 보낸 변경을 보내고, 서버의 최신 내용을 다시 받는다
  async refresh() {
    if (!base()) throw new Error('로그인되어 있지 않아요');
    setStatus('connecting');
    try {
      await Promise.race([waitForPendingWrites(db), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
      const [snap, m] = await Promise.all([getDocsFromServer(itemsCol()), getDocFromServer(metaDoc())]);
      let changed = false;
      snap.forEach(d => { if (S.applyRemoteItem(d.data())) changed = true; });
      if (m.exists() && S.applyRemoteMeta(m.data())) changed = true;
      if (changed) onRemote();
      markSynced(); setStatus('on');
      return true;
    } catch (e) {
      console.error(e); setStatus(navigator.onLine === false || e.message === 'timeout' || (e.code || '').includes('unavailable') ? 'offline' : 'error');
      throw new Error(navigator.onLine === false ? '인터넷 연결을 확인해 주세요' : '동기화하지 못했어요. 잠시 뒤에 다시 해 주세요');
    }
  }
};

window.Sync = Sync;
