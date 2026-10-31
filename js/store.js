// 데이터 저장소
// 지금은 이 기기(브라우저)에 저장하고, 동기화 저장소가 정해지면 remote 어댑터를 연결한다.
// 데이터 구조가 바뀌면 migrate()에서 기존 데이터를 변환한다 (기존 일정은 지우지 않음).
(function () {
  const KEY = 'mycal-data';
  const SCHEMA = 1;

  const DEFAULT_SETTINGS = {
    cats: {
      k: { name: '근태', color: '#C2410C', subs: ['연차', '탄력', '출장', '교육', '여행'] },
      c: { name: '회사', color: '#B5545C', subs: ['점검', '업무', '회식'] },
      p: { name: '개인', color: '#2F6F7E', subs: ['생일', '약속'] }
    },
    subColors: {},       // { '회사/점검': '#123456' } 세부 분류 색 (없으면 큰 분류 색)
    todoColor: '#646B78',
    theme: 'light'
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = o => JSON.parse(JSON.stringify(o));

  function blank() {
    return { schema: SCHEMA, items: {}, weekMemos: {}, settings: clone(DEFAULT_SETTINGS), savedAt: null };
  }

  function migrate(d) {
    if (!d || typeof d !== 'object') return blank();
    if (!d.schema) d.schema = 1;
    // 앞으로 구조가 바뀌면 여기서 단계별로 변환한다. 변환 전 원본은 백업해 둔다.
    if (d.schema < SCHEMA) {
      try { localStorage.setItem(KEY + '-backup-schema' + d.schema, JSON.stringify(d)); } catch (e) {}
    }
    d.items = d.items || {};
    d.weekMemos = d.weekMemos || {};
    d.settings = Object.assign(clone(DEFAULT_SETTINGS), d.settings || {});
    ['k', 'c', 'p'].forEach(c => { if (!d.settings.cats[c]) d.settings.cats[c] = clone(DEFAULT_SETTINGS.cats[c]); });
    d.settings.subColors = d.settings.subColors || {};
    d.schema = SCHEMA;
    return d;
  }

  let data;
  try { data = migrate(JSON.parse(localStorage.getItem(KEY))); } catch (e) { data = blank(); }

  const listeners = [];
  let saveTimer = null;
  function persist() {
    data.savedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.error('저장 실패', e); }
    if (Store.remote) Store.remote.push(data);
  }
  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 150);
    listeners.forEach(fn => fn());
  }

  const Store = {
    remote: null, // 동기화 어댑터 자리 { push(data), subscribe(cb) }
    on(fn) { listeners.push(fn); },
    get data() { return data; },
    get settings() { return data.settings; },
    items() { return Object.values(data.items).filter(i => !i.deleted); },
    item(id) { return data.items[id]; },
    save(item) {
      const now = new Date().toISOString();
      if (!item.id) { item.id = uid(); item.createdAt = now; }
      item.updatedAt = now;
      data.items[item.id] = item;
      changed();
      return item;
    },
    remove(id) {
      const it = data.items[id];
      if (!it) return;
      it.deleted = true; it.updatedAt = new Date().toISOString();
      changed();
    },
    restore(id) {
      const it = data.items[id];
      if (it) { it.deleted = false; it.updatedAt = new Date().toISOString(); changed(); }
    },
    setWeekMemo(key, text) { data.weekMemos[key] = text; changed(); },
    weekMemo(key) { return data.weekMemos[key] || ''; },
    updateSettings(fn) { fn(data.settings); changed(); },
    exportJSON() { return JSON.stringify(data, null, 2); },
    importJSON(text, mode) {
      const incoming = migrate(JSON.parse(text));
      if (mode === 'replace') {
        try { localStorage.setItem(KEY + '-backup-before-import', JSON.stringify(data)); } catch (e) {}
        data = incoming;
      } else {
        Object.values(incoming.items).forEach(it => {
          const cur = data.items[it.id];
          if (!cur || (it.updatedAt || '') > (cur.updatedAt || '')) data.items[it.id] = it;
        });
        Object.assign(data.weekMemos, incoming.weekMemos);
      }
      changed();
    },
    defaults: DEFAULT_SETTINGS
  };

  window.Store = Store;
})();
