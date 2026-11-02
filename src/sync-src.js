// 동기화: Firebase Firestore에 일정을 올리고, 다른 기기의 변경을 실시간으로 받는다.
// 구조: calendars/{동기화코드} 문서(설정·주간 메모) + calendars/{코드}/items/{일정ID}
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, setDoc, collection, onSnapshot, writeBatch, getDocs, getDocsFromServer, getDocFromServer, waitForPendingWrites
} from 'firebase/firestore';

const config = {
  apiKey: 'AIzaSyDSYeIGMnBWGFt_ZmbsEATV6oHl2DX6ulo',
  authDomain: 'my-calendar-6313d.firebaseapp.com',
  projectId: 'my-calendar-6313d',
  storageBucket: 'my-calendar-6313d.firebasestorage.app',
  messagingSenderId: '858844703530',
  appId: '1:858844703530:web:d327d221ae0bf9147e4c53'
};

const CODE_KEY = 'mycal-sync-code';
const LAST_KEY = 'mycal-last-sync';
const markSynced = () => { try { localStorage.setItem(LAST_KEY, new Date().toISOString()); } catch (e) {} };
let S = null, onR = () => {};
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0 O 1 I L) 제외

let db = null, code = null, unsubs = [], status = 'off', statusCb = () => {};
const setStatus = s => { status = s; statusCb(s); };

function ensureDb() {
  if (db) return db;
  const app = initializeApp(config);
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) });
  } catch (e) {
    db = initializeFirestore(app, {});
  }
  return db;
}

function newCode() {
  const r = new Uint32Array(24);
  crypto.getRandomValues(r);
  let s = '';
  for (let i = 0; i < 24; i++) { s += ALPHA[r[i] % ALPHA.length]; if (i % 4 === 3 && i < 23) s += '-'; }
  return s; // 예: K7QF-2M9X-....  (29자)
}
const clean = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');

const strip = o => JSON.parse(JSON.stringify(o)); // undefined 값 제거

async function pushAll(Store) {
  const items = Store.allItems();
  for (let i = 0; i < items.length; i += 400) {
    const b = writeBatch(db);
    items.slice(i, i + 400).forEach(it => b.set(doc(db, 'calendars', code, 'items', it.id), strip(it)));
    await b.commit();
  }
  // 설정(분류·연차·탄력·주간 메모)은 저장소에 이미 있으면 덮어쓰지 않고 받아온다
  let remote = null;
  try { remote = await getDocFromServer(doc(db, 'calendars', code)); } catch (e) { remote = null; }
  if (remote && remote.exists()) { Store.applyRemoteMeta(remote.data(), true); onR(); }
  else if (remote) await setDoc(doc(db, 'calendars', code), strip(Store.meta()), { merge: true });
}

function listen(Store, onRemote) {
  unsubs.forEach(u => u()); unsubs = [];
  unsubs.push(onSnapshot(collection(db, 'calendars', code, 'items'), snap => {
    let changed = false;
    snap.docChanges().forEach(ch => { if (ch.type !== 'removed' && Store.applyRemoteItem(ch.doc.data())) changed = true; });
    setStatus(snap.metadata.fromCache ? 'offline' : 'on');
    if (!snap.metadata.fromCache) markSynced();
    if (changed) onRemote();
  }, err => { console.error(err); setStatus('error'); }));
  unsubs.push(onSnapshot(doc(db, 'calendars', code), snap => {
    if (snap.exists() && Store.applyRemoteMeta(snap.data())) onRemote();
  }, err => { console.error(err); setStatus('error'); }));
}

const Sync = {
  get code() { return code; },
  get status() { return status; },
  onStatus(fn) { statusCb = fn; fn(status); },
  newCode,
  clean,
  // 앱 시작 시 호출
  start(Store, onRemote) {
    S = Store; onR = onRemote;
    Store.hook('item', it => { if (code) setDoc(doc(ensureDb(), 'calendars', code, 'items', it.id), strip(it)).catch(e => { console.error(e); setStatus('error'); }); });
    Store.hook('meta', m => { if (code) setDoc(doc(ensureDb(), 'calendars', code), strip(m), { merge: true }).catch(e => { console.error(e); setStatus('error'); }); });
    const fromLink = /[#&]sync=([A-Za-z0-9-]+)/.exec(location.hash);
    if (fromLink) { localStorage.setItem(CODE_KEY, clean(fromLink[1])); history.replaceState(null, '', location.pathname + location.search); }
    const saved = localStorage.getItem(CODE_KEY);
    if (saved) return this.connect(Store, onRemote, saved, { upload: false });
    return Promise.resolve(false);
  },
  // 코드로 연결. 이 기기의 일정은 올리고(최신 수정본 우선), 저장소의 일정은 받아온다.
  async connect(Store, onRemote, c, opts = {}) {
    code = clean(c);
    if (code.length < 24) { code = null; throw new Error('코드가 너무 짧아요'); }
    localStorage.setItem(CODE_KEY, code);
    ensureDb();
    setStatus('connecting');
    if (opts.checkExists) {
      const snap = await getDocs(collection(db, 'calendars', code, 'items'));
      if (snap.empty) { /* 빈 저장소일 수도 있어 그대로 진행 */ }
    }
    if (opts.upload !== false) pushAll(Store).catch(e => { console.error(e); setStatus('error'); });
    listen(Store, onRemote);
    return true;
  },
  disconnect() {
    unsubs.forEach(u => u()); unsubs = [];
    code = null; localStorage.removeItem(CODE_KEY); setStatus('off');
  },
  get lastSync() { try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } },
  // 동기화 버튼: 못 보낸 변경을 보내고, 서버의 최신 내용을 다시 받는다
  async refresh() {
    if (!code) throw new Error('동기화가 연결되어 있지 않아요');
    setStatus('connecting');
    try {
      await Promise.race([waitForPendingWrites(db), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
      const [snap, m] = await Promise.all([getDocsFromServer(collection(db, 'calendars', code, 'items')), getDocFromServer(doc(db, 'calendars', code))]);
      let changed = false;
      snap.forEach(d => { if (S.applyRemoteItem(d.data())) changed = true; });
      if (m.exists() && S.applyRemoteMeta(m.data())) changed = true;
      if (changed) onR();
      markSynced(); setStatus('on'); return true;
    } catch (e) {
      console.error(e); setStatus(navigator.onLine === false || e.message === 'timeout' ? 'offline' : 'error');
      throw new Error(navigator.onLine === false ? '인터넷 연결을 확인해 주세요' : '동기화하지 못했어요. 잠시 뒤에 다시 해 주세요');
    }
  },
  link() { return code ? `${location.origin}${location.pathname}#sync=${code}` : ''; }
};

window.Sync = Sync;
