// 데이터 저장소
// 지금은 이 기기(브라우저)에 저장하고, 동기화 저장소가 정해지면 remote 어댑터를 연결한다.
// 데이터 구조가 바뀌면 migrate()에서 기존 데이터를 변환한다 (기존 일정은 지우지 않음).
(function () {
  const KEY = 'mycal-data';
  const SCHEMA = 1;

  const DEFAULT_SETTINGS = {
    cats: {
      k: { name: '근태', color: '#F0561D', subs: ['연차', '탄력', '출장', '교육', '여행'] },
      c: { name: '회사', color: '#CE8886', subs: ['점검', '업무', '회식'] },
      p: { name: '개인', color: '#3F7D8C', subs: ['생일', '약속'] }
    },
    subColors: {},       // { '회사/점검': '#123456' } 세부 분류 색 (없으면 큰 분류 색)
    todoColor: '#6E6E6B',
    theme: 'dark'
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
    // 예전 기본색을 그대로 쓰고 있으면 새 기본색으로 바꾼다 (직접 바꾼 색은 유지)
    const OLD = { k: '#C2410C', c: '#B5545C', p: '#2F6F7E' };
    ['k', 'c', 'p'].forEach(c => { if ((d.settings.cats[c].color || '').toUpperCase() === OLD[c]) d.settings.cats[c].color = DEFAULT_SETTINGS.cats[c].color; });
    if ((d.settings.todoColor || '').toUpperCase() === '#646B78') d.settings.todoColor = DEFAULT_SETTINGS.todoColor;
    d.schema = SCHEMA;
    return d;
  }

  let data;
  try { data = migrate(JSON.parse(localStorage.getItem(KEY))); } catch (e) { data = blank(); }

  const listeners = [];
  const hooks = { item: [], meta: [] };   // 동기화 어댑터가 듣는 변경 알림
  const emitItem = it => hooks.item.forEach(fn => fn(it));
  const emitMeta = () => { data.metaUpdatedAt = new Date().toISOString(); hooks.meta.forEach(fn => fn(meta())); };
  const meta = () => ({ settings: data.settings, weekMemos: data.weekMemos, metaUpdatedAt: data.metaUpdatedAt || '' });
  let saveTimer = null;
  function persist() {
    data.savedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.error('저장 실패', e); }
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
      changed(); emitItem(item);
      return item;
    },
    remove(id) {
      const it = data.items[id];
      if (!it) return;
      it.deleted = true; it.updatedAt = new Date().toISOString();
      changed(); emitItem(it);
    },
    restore(id) {
      const it = data.items[id];
      if (it) { it.deleted = false; it.updatedAt = new Date().toISOString(); changed(); emitItem(it); }
    },
    setWeekMemo(key, text) { data.weekMemos[key] = text; changed(); emitMeta(); },
    weekMemo(key) { return data.weekMemos[key] || ''; },
    updateSettings(fn) { fn(data.settings); changed(); emitMeta(); },
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
      changed(); emitMeta();
      Object.values(data.items).forEach(emitItem);
    },
    defaults: DEFAULT_SETTINGS,
    // ---- 동기화용 ----
    hook(kind, fn) { hooks[kind].push(fn); },
    meta,
    allItems() { return Object.values(data.items); },
    applyRemoteItem(it) {
      const cur = data.items[it.id];
      if (cur && (cur.updatedAt || '') >= (it.updatedAt || '')) return false;
      data.items[it.id] = it; changed(); return true;
    },
    // 로그인한 계정에 이미 일정이 있으면, 이 기기의 옛 일정은 백업만 해 두고 비운다
    resetLocal() {
      try { localStorage.setItem(KEY + '-backup-before-login', JSON.stringify(data)); } catch (e) {}
      data = blank(); changed();
    },
    applyRemoteMeta(m) {
      if (!m || (data.metaUpdatedAt || '') >= (m.metaUpdatedAt || '')) return false;
      data.settings = Object.assign(clone(DEFAULT_SETTINGS), m.settings || {});
      data.weekMemos = m.weekMemos || {};
      data.metaUpdatedAt = m.metaUpdatedAt;
      changed(); return true;
    }
  };

  window.Store = Store;
})();
