(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  // ---------- 날짜 ----------
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const todayKey = () => keyOf(new Date());
  const mondayOf = k => { const d = parse(k); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return keyOf(d); };
  const labelDate = k => { const d = parse(k); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };
  const weekTitle = mon => {
    const thu = parse(addDays(mon, 3));
    return { y: thu.getFullYear(), m: thu.getMonth() + 1, n: Math.ceil(thu.getDate() / 7) };
  };

  // ---------- 상태 ----------
  const now = new Date();
  const state = {
    screen: 'calendar',  // calendar | work | book
    view: 'month',
    year: now.getFullYear(),
    month: now.getMonth(),          // 0~11
    weekStart: mondayOf(todayKey()),
    miniYM: null
  };

  // ---------- 색 ----------
  function textOn(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    const lum = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
    return L > 0.4 ? '#1d2330' : '#ffffff';
  }
  function colorOf(item) {
    const s = Store.settings;
    if (item.kind === 'todo') return s.todoColor;
    const sub = item.sub && s.subColors[`${item.cat}/${item.sub}`];
    return sub || (s.cats[item.cat] || s.cats.c).color;
  }
  const validHex = v => /^#[0-9a-fA-F]{6}$/.test(v);

  // ---------- 일정 배치 ----------
  const timeOf = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? pad(m[1]) + ':' + m[2] : ''; };
  const splitTitle = t => { const m = /^(\d{1,2}:\d{2})\s*(.*)$/.exec(t || ''); return m ? [m[1], m[2]] : ['', t || '']; };

  // start~end 범위 날짜별 표시 목록
  function layout(start, end) {
    const map = {};
    const push = (k, e) => { if (k >= start && k <= end) (map[k] = map[k] || []).push(e); };
    const today = todayKey();
    Store.items().forEach(it => {
      if (it.kind !== 'todo' && it.kind !== 'event') return;
      const last = it.endDate && it.endDate > it.date ? it.endDate : it.date;
      const range = () => {   // 시작일~종료일 매일 표시 (여러 날이면 이어 그리기용 범위 정보)
        if (last < start || it.date > end) return;
        let k = it.date < start ? start : it.date;
        const stop = last > end ? end : last;
        while (k <= stop) { push(k, last > it.date ? { it, late: 0, rs: it.date, re: last } : { it, late: 0 }); k = addDays(k, 1); }
      };
      if (it.kind === 'todo') {
        if (last > it.date && (it.done || last >= today)) range();          // 기간 있는 할 일
        else if (it.done) push(it.doneDate || it.date, { it, late: 0 });
        else if (last >= today) push(it.date, { it, late: 0 });
        else push(today, { it, late: diffDays(last, today) });             // 종료일 지나면 오늘로 넘어오며 밀림
      } else range();
    });
    if (window.Ext) Ext.ruleEntries(start, end).forEach(([k, e]) => push(k, e));
    Object.values(map).forEach(list => list.sort(order));
    return map;
  }
  function order(a, b) {
    const A = a.it, B = b.it;
    const rank = x => x.kind === 'todo' ? 3 : x.cat === 'k' ? 0 : timeOf(x.title) ? 2 : 1;
    return rank(A) - rank(B)
      || timeOf(A.title).localeCompare(timeOf(B.title))
      || (A.kind === 'todo' ? (A.done - B.done) || (b.late - a.late) : 0)
      || splitTitle(A.title)[1].localeCompare(splitTitle(B.title)[1], 'ko');
  }

  const md = k => `${Number(k.slice(5, 7))}/${Number(k.slice(8))}`;
  // 월간 여러 날 조각: piece = { k, wkStart, wkEnd }
  function spanHTML(e, k, wkStart, wkEnd) {
    const it = e.it, first = k === e.rs || k === wkStart, cl = k > e.rs && k !== wkStart, cr = k < e.re && k !== wkEnd;
    const [tm, tx] = splitTitle(it.title);
    const col = colorOf(Object.assign({}, it, { kind: 'event' }));
    if (it.kind === 'todo') {
      const isStart = k === e.rs, isEnd = k === e.re;
      return `<div class="chip box tspan${it.done ? ' done' : ''}${cl ? ' cl' : ''}${cr ? ' cr' : ''}" data-id="${it.id}" style="color:${col}">`
        + (isStart ? `<span class="cb" data-check="${it.id}" role="checkbox" aria-checked="${it.done ? 'true' : 'false'}" aria-label="완료"></span><span class="tx">${esc(tx || '(제목 없음)')}</span>` : (first ? `<span class="tx faint">${esc(tx)}</span>` : ''))
        + `<span class="tline"></span>${isEnd ? '<span class="tarrow"></span>' : ''}</div>`;
    }
    const bg = colorOf(it), fg = textOn(bg);
    return `<div class="chip ${it.cat} span${cl ? ' cl' : ''}${cr ? ' cr' : ''}" data-id="${it.id}" style="background:${bg};color:${fg}">`
      + (first ? (tm ? `<span class="tm">${esc(tm)}</span>` : '') + `<span class="tx">${esc(tx || '(제목 없음)')}</span>` : '<span class="tx">&nbsp;</span>') + `</div>`;
  }
  function chipHTML(e, opts = {}) {
    const it = e.it;
    const bg = colorOf(it), fg = textOn(bg);
    const [tm, tx] = splitTitle(it.title);
    const done = it.kind === 'todo' && it.done && !opts.noDone;
    const box = opts.box && it.kind === 'todo';
    const cls = `chip ${it.kind === 'todo' ? 'todo' : it.cat}${done ? ' done' : ''}${box ? ' box' : ''}`;
    return `<div class="${cls}" data-id="${it.id}" style="${box ? `color:${colorOf(Object.assign({}, it, { kind: 'event' }))}` : `background:${bg};color:${fg}`}">`
      + (box ? `<span class="cb" data-check="${it.id}" role="checkbox" aria-checked="${it.done ? 'true' : 'false'}" aria-label="완료"></span>` : '')
      + (tm ? `<span class="tm">${esc(tm)}</span>` : '')
      + `<span class="tx">${esc(tx || '(제목 없음)')}</span>`
      + (e.late > 0 ? `<span class="late"><span class="lp">+</span>${e.late}<span class="lt">일 밀림</span></span>` : '')
      + (opts.until && e.re ? `<span class="until">~${md(e.re)}</span>` : '')
      + `</div>`;
  }

  // ---------- 렌더 ----------
  const view = $('#view');
  function render() {
    document.documentElement.dataset.theme = Store.settings.theme;
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = Store.settings.theme === 'dark' ? '#16181d' : '#ffffff';
    $('#ico-week').style.display = state.view === 'month' ? '' : 'none';
    $('#ico-month').style.display = state.view === 'week' ? '' : 'none';
    $('#btn-view').setAttribute('aria-label', state.view === 'month' ? '주간 보기' : '월간 보기');
    document.body.dataset.screen = state.screen;
    $('#today-num').textContent = new Date().getDate();
    $$('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === state.screen));
    if (state.screen !== 'calendar' && window.Ext) { Ext.renderScreen(state.screen, view); $('#side').innerHTML = ''; document.body.classList.remove('with-side'); renderDrawerFoot(); syncBack(); return; }
    view.onclick = null;
    if (state.view === 'month') renderMonth(); else renderWeek();
    renderSide();
    renderDrawerFoot();
    syncBack();
  }

  function renderMonth() {
    const narrow = innerWidth < 700;
    $('#title-text').textContent = `${state.year}년 ${state.month + 1}월`;
    const first = keyOf(new Date(state.year, state.month, 1));
    const lastDay = keyOf(new Date(state.year, state.month + 1, 0));
    const start = mondayOf(first);
    const weeks = Math.ceil((diffDays(start, lastDay) + 1) / 7);
    const end = addDays(start, weeks * 7 - 1);
    const map = layout(start, end);
    const today = todayKey();
    const cols = narrow ? 'repeat(7, minmax(0, 1fr))' : '30px repeat(7, minmax(0, 1fr))';

    view.innerHTML = `<div class="wkh" style="--cols:${cols}">${narrow ? '' : '<div></div>'}${['월', '화', '수', '목', '금', '토', '일'].map((w, i) => `<div class="${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">${w}</div>`).join('')}</div><div class="month" id="month" style="--cols:${cols};grid-template-rows:repeat(${weeks},minmax(0,1fr))"></div>`;
    const grid = $('#month');
    const rowH = grid.clientHeight / weeks;
    const baseH = narrow ? 16.5 : 21, ruleTop = narrow ? 30.5 : 32.5;
    const lines = Math.max(1, Math.round((rowH - ruleTop) / baseH));
    const chipH = (rowH - ruleTop) / lines;
    grid.style.setProperty('--rule-h', chipH + 'px');
    const cap = 4; // 하루에 일정·할 일 합쳐 4개까지, 나머지는 날짜 옆 +N

    let html = '';
    for (let w = 0; w < weeks; w++) {
      const mon = addDays(start, w * 7), sun = addDays(mon, 6);
      // 이 주의 여러 날 항목: 시작 빠른 순, 긴 순으로 같은 높이 줄을 배정
      const multi = []; const seen = new Set();
      for (let i = 0; i < 7; i++) (map[addDays(mon, i)] || []).forEach(e => { if (e.rs && !seen.has(e.it.id)) { seen.add(e.it.id); multi.push(e); } });
      multi.sort((a, b) => a.rs.localeCompare(b.rs) || b.re.localeCompare(a.re) || order(a, b));
      const lanes = [];  // lanes[n] = 마지막으로 차지한 날짜
      const laneOf = {};
      multi.forEach(e => { const s = e.rs < mon ? mon : e.rs, en = e.re > sun ? sun : e.re; let n = lanes.findIndex(last => last < s); if (n < 0) { n = lanes.length; lanes.push(en); } else lanes[n] = en; laneOf[e.it.id] = n; });
      html += `<button class="wkno" data-week="${mon}" aria-label="${labelDate(mon)} 주간 보기">${narrow ? '' : weekTitle(mon).n + '주'}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true" style="${narrow ? '' : 'display:none'}"><path d="M9 18l6-6-6-6"/></svg></button>`;
      for (let i = 0; i < 7; i++) {
        const k = addDays(mon, i);
        const d = parse(k);
        const hol = Holidays.get(k);
        const list = map[k] || [];
        let cls = 'day';
        if (d.getMonth() !== state.month) cls += ' out';
        if (d.getDay() === 0 || hol) cls += ' red'; else if (d.getDay() === 6) cls += ' sat';
        if (k === today) cls += ' today';
        if (k === (state.selDay || today) && sideOn()) cls += ' sel';
        // 여러 날 항목을 먼저(같은 주 안에서 같은 순서로), 빈 줄 없이 위로 채움
        const multiHere = list.filter(e => e.rs).sort((a, b) => laneOf[a.it.id] - laneOf[b.it.id]);
        const all = multiHere.concat(list.filter(e => !e.rs));
        const shown = all.slice(0, cap);
        const hidden = all.length - shown.length;
        html += `<div class="${cls}" data-day="${k}"><div class="dh"><span class="dn">${d.getDate()}</span>${hidden > 0 ? `<span class="more">+${hidden}</span>` : ''}${hol ? `<span class="hol">${esc(hol[0])}</span>` : ''}</div>`
          + shown.map(e => (e.rs ? spanHTML(e, k, mon, sun) : chipHTML(e, { box: true }))).join('')
          + `</div>`;
      }
    }
    grid.innerHTML = html;
  }

  function renderWeek() {
    const mon = state.weekStart;
    const wt = weekTitle(mon);
    $('#title-text').textContent = innerWidth < 700 ? `${wt.m}월 ${wt.n}주차` : `${wt.y}년 ${wt.m}월 ${wt.n}주차`;
    const sun = addDays(mon, 6);
    const map = layout(mon, sun);
    const today = todayKey();
    const ym = state.miniYM || { y: wt.y, m: wt.m - 1 };

    // 미니 달력
    const mFirst = keyOf(new Date(ym.y, ym.m, 1));
    const mStart = mondayOf(mFirst);
    const mWeeks = Math.ceil((diffDays(mStart, keyOf(new Date(ym.y, ym.m + 1, 0))) + 1) / 7);
    let mini = `<div class="mini"><div class="mini-head"><button data-mini="-1" aria-label="이전 달">‹</button><span>${ym.y}년 ${ym.m + 1}월</span><button data-mini="1" aria-label="다음 달">›</button></div><div class="mini-grid">${['월', '화', '수', '목', '금', '토', '일'].map(w => `<div class="h">${w}</div>`).join('')}`;
    for (let i = 0; i < mWeeks * 7; i++) {
      const k = addDays(mStart, i), d = parse(k);
      let cls = 'mc';
      if (d.getMonth() !== ym.m) cls += ' out'; else if (d.getDay() === 0 || Holidays.get(k)) cls += ' hold';
      if (k >= mon && k <= sun) { cls += ' sel'; if (k === mon) cls += ' selL'; if (k === sun) cls += ' selR'; }
      mini += `<button class="${cls}" data-goweek="${mondayOf(k)}">${d.getDate()}</button>`;
    }
    mini += `</div></div>`;

    const col = k => {
      const d = parse(k), hol = Holidays.get(k);
      let cls = 'wdh';
      if (d.getDay() === 0 || hol) cls += ' red'; else if (d.getDay() === 6) cls += ' sat';
      if (k === today) cls += ' today';
      const list = map[k] || [];
      return `<div class="wcol"><div class="${cls}" data-day="${k}"><span class="n">${d.getDate()}</span><span class="w">${WD[d.getDay()]}</span>${hol ? `<span class="h">${esc(hol[0])}</span>` : ''}</div>`
        + (list.length ? list.map(e => `<div class="witem">${chipHTML(e, { noDone: true, until: true })}${deptLine(e.it)}${e.it.memo ? `<div class="memo">${esc(e.it.memo)}</div>` : ''}</div>`).join('') : '<div class="empty">일정 없음</div>')
        + `</div>`;
    };

    view.innerHTML = `<div class="week" id="week"><div class="week-top">${mini}<div class="memo-box"><label for="week-memo">이번 주 메모</label><textarea id="week-memo">${esc(Store.weekMemo(mon))}</textarea></div></div>`
      + `<div class="wcols">${[0, 1, 2, 3, 4].map(i => col(addDays(mon, i))).join('')}<div class="wkend">${col(addDays(mon, 5))}${col(sun)}</div></div></div>`;

    let t;
    $('#week-memo').addEventListener('input', e => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => Store.setWeekMemo(mon, v), 400); });
  }

  // 오른쪽 '오늘 일정·할 일' 칸은 쓰지 않음
  // PC 월간: 고른 날짜의 일정·할 일을 오른쪽에 (TimeBlocks 방식)
  const sideOn = () => state.screen === 'calendar' && state.view === 'month' && innerWidth >= 1100;
  const kday = k => { const d = parse(k); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
  function renderSide() {
    const side = $('#side');
    document.body.classList.toggle('with-side', sideOn());
    if (!sideOn()) { side.innerHTML = ''; return; }
    const k = state.selDay || todayKey();
    const d = parse(k), hol = Holidays.get(k);
    const list = layout(k, k)[k] || [];
    side.innerHTML = `<div class="sd-head"><div class="sd-date">${kday(k)} ${WD[d.getDay()]}</div>${hol ? `<div class="sd-hol">${esc(hol.join(' · '))}</div>` : ''}</div>`
      + `<button class="sd-add" data-sdnew><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>생성</button>`
      + `<div class="sd-list">${list.map(e => {
        const it = e.it, col = colorOf(Object.assign({}, it, { kind: 'event' })), todo = it.kind === 'todo';
        const s0 = e.rs || it.date, s1 = e.re || it.endDate || it.date;
        const mark = todo ? `<span class="sd-cb${it.done ? ' on' : ''}" data-sdcheck="${it.id}" style="color:${col}" role="checkbox" aria-checked="${it.done ? 'true' : 'false'}" aria-label="완료"></span>` : `<span class="sd-sq" style="background:${col}"></span>`;
        return `<div class="sd-item${todo && it.done ? ' done' : ''}" data-sdopen="${it.id}">${mark}<div class="sd-main"><div class="sd-t">${esc(it.title || '(제목 없음)')}${e.late > 0 ? ` <span class="sd-late">${e.late}일 밀림</span>` : ''}</div>${!todo || s1 > s0 ? `<div class="sd-r">${kday(s0 > s1 ? s1 : s0)} - ${kday(s1)}</div>` : ''}${it.depts && it.depts.length ? `<div class="sd-r">→ ${esc(it.depts.join(', '))}</div>` : ''}</div></div>`;
      }).join('')}</div>`;
  }

  function renderDrawerFoot() {
    const s = Store.data.savedAt;
    $('#sync-state').textContent = syncLabel();
    $('#drawer-foot').innerHTML = `앱 버전 1.4.1<br>마지막 동기화: ${window.Sync && (Sync.loggedIn || Sync.legacyCode) ? ago(Sync.lastSync) : '로그인 전'}<br>일정 ${Store.items().filter(i => i.kind === 'event' || i.kind === 'todo').length}개`;
  }

  function syncLabel() {
    if (!window.Sync) return '이 기기에만 저장 중';
    if (!Sync.loggedIn && !Sync.legacyCode) return '로그인 전 · 이 기기에만 저장 중';
    const who = Sync.loggedIn ? Sync.email : '예전 동기화 코드';
    return who + ' · ' + (({ on: '동기화됨', connecting: '동기화 중…', offline: '오프라인 · 연결되면 자동으로 맞춰져요', error: '동기화 오류' })[Sync.status] || '동기화됨');
  }
  const ago = iso => { if (!iso) return '-'; const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : new Date(iso).toLocaleString('ko-KR'); };

  // 위쪽 동기화 버튼: 누르면 돌면서 동기화
  const syncBtn = $('#btn-sync');
  function paintSyncBtn() {
    if (!window.Sync) return;
    const off = !Sync.loggedIn && !Sync.legacyCode;
    syncBtn.classList.toggle('warn', off || Sync.status === 'error');
    syncBtn.classList.toggle('spin', Sync.status === 'connecting');
    syncBtn.setAttribute('aria-label', off ? '동기화 꺼짐 · 로그인' : '동기화');
  }
  syncBtn.onclick = async () => {
    if (!window.Sync) return;
    if (!Sync.loggedIn && !Sync.legacyCode) { openSync(); return; }
    if (syncBtn.classList.contains('busy')) return;
    syncBtn.classList.add('busy', 'spin');
    const t0 = Date.now();
    try { await Sync.refresh(); await new Promise(r => setTimeout(r, Math.max(0, 700 - (Date.now() - t0)))); toast('동기화했어요'); }
    catch (e) { toast(e.message); }
    syncBtn.classList.remove('busy'); paintSyncBtn(); renderDrawerFoot();
  };

  // 계정·동기화
  function openSync() {
    let mode = 'login', busy = false;
    const draw = () => {
      if (Sync.loggedIn) {
        return `<div class="m-head"><h2>계정·동기화</h2>${closeBtn}</div>`
          + `<div class="acct"><div class="acct-mail">${esc(Sync.email)}</div><div class="acct-st">${esc(syncLabel().split(' · ').slice(1).join(' · '))} · 마지막 동기화 ${esc(ago(Sync.lastSync))}</div></div>`
          + `<div class="m-actions"><button class="btn primary" data-refresh style="flex:1">지금 동기화</button></div>`
          + (Sync.hasBackup() ? `<div class="legacy-note" style="margin-top:12px">이 기기에 로그인 전 일정 ${Sync.hasBackup()}개가 따로 보관돼 있어요.</div><div class="m-actions"><button class="btn primary" data-restore style="flex:1">이 기기 예전 일정 되살리기</button></div>` : '')
          + (mode === 'pw'
            ? `<div class="field" style="margin-top:14px"><label for="a-cur">지금 비밀번호</label><input type="password" id="a-cur" autocomplete="current-password"></div><div class="field"><label for="a-new">새 비밀번호 (6자 이상)</label><input type="password" id="a-new" autocomplete="new-password"></div><div class="m-actions"><button class="btn" data-mode="login">취소</button><button class="btn primary" data-changepw>비밀번호 바꾸기</button></div>`
            : mode === 'import'
            ? `<div class="field" style="margin-top:14px"><label for="a-code">예전 동기화 코드</label><input type="text" id="a-code" autocomplete="off" autocapitalize="characters"></div><div class="m-actions"><button class="btn" data-mode="login">취소</button><button class="btn primary" data-import>가져오기</button></div>`
            : `<div class="sheet" style="margin-top:10px"><button class="sheet-btn" data-mode="import">예전 동기화 코드에서 일정 가져오기</button><button class="sheet-btn" data-mode="pw">비밀번호 바꾸기</button><button class="sheet-btn danger" data-logout>로그아웃</button></div>`);
      }
      const su = mode === 'signup';
      return `<div class="m-head"><h2>${su ? '가입하기' : '로그인'}</h2>${closeBtn}</div>`
        + (Sync.legacyCode ? `<div class="legacy-note">지금은 예전 동기화 코드로 연결돼 있어요. ${su ? '가입하면' : '로그인하면'} 이 기기의 일정이 계정으로 옮겨져요.</div>` : '')
        + `<div class="field"><label for="a-mail">메일 주소</label><input type="email" id="a-mail" autocomplete="email" inputmode="email" autocapitalize="off"></div>`
        + `<div class="field"><label for="a-pw">비밀번호${su ? ' (6자 이상)' : ''}</label><input type="password" id="a-pw" autocomplete="${su ? 'new-password' : 'current-password'}"></div>`
        + (su ? `<div class="field"><label for="a-pw2">비밀번호 확인</label><input type="password" id="a-pw2" autocomplete="new-password"></div>` : '')
        + `<div class="m-actions"><button class="btn primary" data-go style="flex:1">${su ? '가입하고 시작하기' : '로그인'}</button></div>`
        + `<div class="acct-links">${su ? '<button data-mode="login">이미 가입했어요 · 로그인</button>' : '<button data-mode="signup">처음이에요 · 가입하기</button><button data-forgot>비밀번호를 잊었어요</button>'}</div>`;
    };
    openModal(draw(), m => {
      const keep = () => { const el = $('#a-mail', m); return el ? el.value : ''; };
      const redraw = () => { const mail = keep(); m.innerHTML = draw(); const el = $('#a-mail', m); if (el && mail) el.value = mail; };
      const run = async (btn, fn) => { if (busy) return; busy = true; const t = btn.textContent; btn.textContent = '잠시만요…'; try { await fn(); } catch (e) { toast(e.message); } busy = false; if (btn.isConnected) btn.textContent = t; };
      m.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('#a-pw, #a-pw2')) { const g = $('[data-go]', m); if (g) g.click(); } });
      m.onclick = async e => {
        if (e.target.closest('[data-close]')) return;
        const md = e.target.closest('[data-mode]'); if (md) { mode = md.dataset.mode; redraw(); return; }
        const go = e.target.closest('[data-go]');
        if (go) {
          const mail = $('#a-mail', m).value.trim(), pw = $('#a-pw', m).value;
          if (!mail) { $('#a-mail', m).focus(); return; }
          if (!pw) { $('#a-pw', m).focus(); return; }
          if (mode === 'signup' && pw !== $('#a-pw2', m).value) { toast('비밀번호 확인이 맞지 않아요'); return; }
          run(go, async () => { if (mode === 'signup') await Sync.signUp(mail, pw); else await Sync.signIn(mail, pw); mode = 'login'; m.innerHTML = draw(); render(); toast(Sync.email + '으로 로그인했어요'); });
          return;
        }
        const fg = e.target.closest('[data-forgot]');
        if (fg) {
          const mail = $('#a-mail', m).value.trim(); if (!mail) { toast('메일 주소를 먼저 넣어 주세요'); $('#a-mail', m).focus(); return; }
          run(fg, async () => { await Sync.resetPassword(mail); confirmBox(`${mail}로 비밀번호 재설정 메일을 보냈어요. 메일의 링크에서 새 비밀번호를 정한 뒤 여기서 로그인해 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.`, '확인', () => {}, '닫기'); });
          return;
        }
        const rf = e.target.closest('[data-refresh]');
        if (rf) { run(rf, async () => { await Sync.refresh(); m.innerHTML = draw(); renderDrawerFoot(); toast('동기화했어요'); }); return; }
        const rs = e.target.closest('[data-restore]');
        if (rs) { run(rs, async () => { const n = await Sync.restoreBackup(); m.innerHTML = draw(); render(); toast(n ? `일정 ${n}개를 되살렸어요` : '이미 모두 들어 있어요'); }); return; }
        const im = e.target.closest('[data-import]');
        if (im) { const c = $('#a-code', m).value; if (!c.trim()) { $('#a-code', m).focus(); return; } run(im, async () => { const n = await Sync.importLegacy(c); mode = 'login'; m.innerHTML = draw(); render(); toast(n ? `일정 ${n}개를 가져왔어요` : '이미 모두 들어 있어요'); }); return; }
        const cp = e.target.closest('[data-changepw]');
        if (cp) {
          const cur = $('#a-cur', m).value, nw = $('#a-new', m).value;
          if (!cur) { $('#a-cur', m).focus(); return; }
          if (nw.length < 6) { toast('새 비밀번호는 6자 이상이어야 해요'); $('#a-new', m).focus(); return; }
          run(cp, async () => { await Sync.changePassword(cur, nw); mode = 'login'; m.innerHTML = draw(); toast('비밀번호를 바꿨어요'); });
          return;
        }
        if (e.target.closest('[data-logout]')) {
          confirmBox('로그아웃할까요? 이 기기에서는 일정이 지워지고, 계정에는 그대로 남아요. 다시 로그인하면 돌아와요.', '로그아웃', async () => {
            await Sync.signOut(); Store.resetLocal(); m.innerHTML = draw(); render(); toast('로그아웃했어요');
          });
        }
      };
    });
  }

  // ---------- 이동 ----------
  function go(delta) {
    if (state.view === 'month') {
      const d = new Date(state.year, state.month + delta, 1);
      state.year = d.getFullYear(); state.month = d.getMonth();
    } else {
      state.weekStart = addDays(state.weekStart, delta * 7);
      state.miniYM = null;
    }
    render();
  }
  function goToday() {
    const t = new Date();
    state.year = t.getFullYear(); state.month = t.getMonth();
    state.weekStart = mondayOf(todayKey()); state.miniYM = null;
    render();
  }
  function showWeek(mon) {
    state.view = 'week'; state.weekStart = mon; state.miniYM = null;
    const wt = weekTitle(mon); state.year = wt.y; state.month = wt.m - 1;
    render();
  }
  function showMonth() {
    state.view = 'month';
    const wt = weekTitle(state.weekStart); state.year = wt.y; state.month = wt.m - 1;
    render();
  }

  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer-scrim').classList.remove('open'); syncBack(); }

  // ---------- 모달 ----------
  const wrap = $('#modal-wrap'), modal = $('#modal');
  function openModal(html, onReady) {
    modal.onclick = modal.oninput = modal.onchange = null; modal._guard = null;
    syncBack();
    modal.innerHTML = html;
    wrap.hidden = false;
    if (onReady) onReady(modal);
  }
  function closeModal() { wrap.hidden = true; modal.innerHTML = ''; modal._guard = null; syncBack(); }
  // 입력칸이 있는 창은 바깥을 눌러도 닫히지 않음 (쓰던 내용 보호)
  // 글자를 드래그하다 바깥에서 손을 떼도 닫히지 않게: 누른 곳과 뗀 곳이 모두 바깥일 때만
  let downOnWrap = false;
  wrap.addEventListener('pointerdown', e => { downOnWrap = e.target === wrap; });
  wrap.addEventListener('click', e => { if (e.target === wrap && downOnWrap && !modal.querySelector('input:not([type=checkbox]), textarea, select')) closeModal(); downOnWrap = false; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !wrap.hidden) goBack(); });
  const closeBtn = '<button class="ib" data-close aria-label="닫기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });

  // ---------- 날짜 칸: 20261106 처럼 숫자만 쳐도 2026-11-06 으로, 옆 달력 버튼으로도 고르기 ----------
  const fmtDigits = v => { const d = v.replace(/\D/g, '').slice(0, 8); return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d; };
  const okDate = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + 'T00:00:00'); return !isNaN(d) && keyOf(d) === v; };
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  function enhanceDates(root) {
    $$('input[type=date]:not(.st-date):not(.dt-native)', root).forEach(nat => {
      const txt = document.createElement('input');
      txt.type = 'text'; txt.inputMode = 'numeric'; txt.autocomplete = 'off'; txt.maxLength = 10;
      txt.id = nat.id; txt.className = nat.className + ' dt-text';
      const raw = () => valueDesc.get.call(txt), setRaw = v => valueDesc.set.call(txt, v);
      setRaw(nat.value);
      // 다른 코드가 .value 를 읽으면: 올바른 날짜만, 잘못 쓴 날짜는 빈 값으로 (이상한 날짜가 저장되지 않게)
      Object.defineProperty(txt, 'value', { get: () => (okDate(raw()) ? raw() : ''), set: v => setRaw(v || ''), configurable: true });
      Object.keys(nat.dataset).forEach(k => { txt.dataset[k] = nat.dataset[k]; });
      if (nat.getAttribute('aria-label')) txt.setAttribute('aria-label', nat.getAttribute('aria-label'));
      if (nat.style.cssText) txt.style.cssText = nat.style.cssText;
      const wrap = document.createElement('span'); wrap.className = 'dt';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dt-btn'; btn.setAttribute('aria-label', '달력에서 고르기');
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
      nat.removeAttribute('id'); Object.keys(nat.dataset).forEach(k => delete nat.dataset[k]);
      nat.className = 'dt-native'; nat.tabIndex = -1; nat.setAttribute('aria-hidden', 'true');
      nat.replaceWith(wrap); wrap.append(txt, btn, nat);
      const fire = () => { txt.dispatchEvent(new Event('input', { bubbles: true })); txt.dispatchEvent(new Event('change', { bubbles: true })); };
      txt.addEventListener('input', e => {
        if (e.isTrusted === false && !e.inputType) return;
        const pos = raw().length === txt.selectionStart;
        const f = fmtDigits(raw());
        if (f !== raw() && pos) setRaw(f);
        txt.classList.toggle('bad', raw().length === 10 && !okDate(raw()));
      });
      txt.addEventListener('blur', () => { txt.classList.toggle('bad', !!raw() && !okDate(raw())); });
      btn.addEventListener('click', e => { e.stopPropagation(); nat.value = okDate(raw()) ? raw() : ''; try { nat.showPicker(); } catch (_) { nat.focus(); nat.click(); } });
      nat.addEventListener('change', () => { if (nat.value) { setRaw(nat.value); txt.classList.remove('bad'); fire(); } });
    });
  }
  new MutationObserver(() => enhanceDates(modal)).observe(modal, { childList: true, subtree: true });
  // 잘못 쓴 날짜가 있으면 저장하지 않고 알려 줌
  modal.addEventListener('click', e => {
    if (!e.target.closest('[data-save], [data-savepage], [data-addflex], [data-addlog]')) return;
    const bad = $$('.dt-text', modal).find(el => { const v = valueDesc.get.call(el); return v && !okDate(v); });
    if (bad) { e.stopImmediatePropagation(); e.preventDefault(); bad.classList.add('bad'); bad.focus(); toast('날짜를 확인해 주세요'); }
  }, true);

  // 확인 팝업 (열린 창 위에 겹쳐 뜸)
  const cwrap = $('#confirm-wrap'), cbox = $('#confirm');
  function confirmBox(msg, okLabel, onOk, noLabel) {
    cbox.innerHTML = `<p>${esc(msg)}</p><div class="m-actions"><button class="btn" data-c-no>${esc(noLabel || '취소')}</button><button class="btn primary" data-c-ok>${esc(okLabel || '확인')}</button></div>`;
    cwrap.hidden = false;
    cbox.onclick = e => {
      if (e.target.closest('[data-c-ok]')) { cwrap.hidden = true; syncBack(); onOk(); }
      else if (e.target.closest('[data-c-no]')) { cwrap.hidden = true; syncBack(); }
    };
    syncBack();
  }
  // 여러 개 중 고르기: [[글자, 실행할 함수, 'danger'], ...]
  function chooseBox(msg, opts) {
    cbox.innerHTML = `<p>${esc(msg)}</p><div class="choose">${opts.map((o, i) => `<button class="btn ${o[2] === 'danger' ? 'danger' : ''}" data-c="${i}">${esc(o[0])}</button>`).join('')}</div>`;
    cwrap.hidden = false;
    cbox.onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; cwrap.hidden = true; syncBack(); const fn = opts[b.dataset.c][1]; if (fn) fn(); };
    syncBack();
  }
  cwrap.addEventListener('click', e => { if (e.target === cwrap) { cwrap.hidden = true; syncBack(); } });

  // ---------- 뒤로가기: 창 닫기 → 화면 한 단계 위로 → 달력 → 앱 종료 ----------
  const isRoot = () => state.screen === 'calendar' && state.view === 'month' && wrap.hidden && cwrap.hidden && !$('#drawer').classList.contains('open');
  function goBack() {
    if (!cwrap.hidden) { cwrap.hidden = true; return; }
    if ($('#drawer').classList.contains('open')) { closeDrawer(); return; }
    if (!wrap.hidden) {
      const ask = modal._guard && modal._guard();
      if (ask) { confirmBox(ask, '예', closeModal, '아니오'); return; }
      closeModal(); return;
    }
    if (state.screen !== 'calendar') { if (window.Ext && Ext.back(state.screen)) return; setScreen('calendar'); return; }
    if (state.view === 'week') showMonth();
  }
  const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  let guarded = false, skipPop = false, hb = null;
  function syncBack() {
    if (CapApp) return;
    clearTimeout(hb);
    hb = setTimeout(() => {
      const root = isRoot();
      if (!root && !guarded) { history.pushState({ back: 1 }, ''); guarded = true; }
      else if (root && guarded) { guarded = false; skipPop = true; history.back(); }
    }, 0);
  }
  if (CapApp) CapApp.addListener('backButton', () => { if (isRoot()) CapApp.exitApp(); else goBack(); });
  else addEventListener('popstate', () => { if (skipPop) { skipPop = false; return; } guarded = false; goBack(); syncBack(); });

  function toast(msg, action, fn) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
    t.hidden = false;
    if (action) t.querySelector('button').onclick = () => { fn(); t.hidden = true; };
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  // 칩을 눌렀을 때: 정기업무 → 해당 회차, 회의록 연결 → 이동 여부 묻기
  function openChip(id) {
    if (id.startsWith('r:')) { Ext.openOccurrence(id); return; }
    const it = Store.item(id);
    if (it && it.noteId && Store.item(it.noteId) && !Store.item(it.noteId).deleted) {
      openModal(`<div class="m-head"><h2>연결된 회의록</h2>${closeBtn}</div><p style="margin:0 0 18px;line-height:1.6">이 일정에 연결된 회의록이 있어요. 회의록으로 이동할까요?</p><div class="m-actions"><button class="btn" data-no style="flex:1">아니오</button><button class="btn primary" data-yes>예</button></div>`, m => {
        m.onclick = e => { if (e.target.closest('[data-yes]')) Ext.openPage(it.noteId); else if (e.target.closest('[data-no]')) openItem(id); };
      });
      return;
    }
    openItem(id);
  }

  // 하루 보기
  function openDay(k) {
    const list = layout(k, k)[k] || [];
    const hol = Holidays.get(k);
    openModal(`<div class="m-head"><h2>${labelDate(k)}</h2>${closeBtn}</div>`
      + (hol ? `<div class="hol-line">${esc(hol.join(' · '))}</div>` : '')
      + `<div class="day-list">${list.length ? list.map(e => `<div>${chipHTML(e, { until: true })}${deptLine(e.it)}${e.it.memo ? `<div class="memo">${esc(e.it.memo)}</div>` : ''}</div>`).join('') : '<div class="empty">등록된 일정이 없어요</div>'}</div>`
      + `<div class="m-actions"><button class="btn primary" data-new="event">+ 추가</button></div>`
      + `<div class="m-actions"><button class="btn" style="flex:1" data-weekof="${k}">이 주 위클리 보기</button></div>`, m => {
      m.onclick = e => {
        const n = e.target.closest('[data-new]'); if (n) { openItem(null, { kind: n.dataset.new, date: k }); return; }
        const w = e.target.closest('[data-weekof]'); if (w) { closeModal(); showWeek(mondayOf(k)); return; }
        const c = e.target.closest('.chip[data-id]'); if (c) openChip(c.dataset.id);
      };
    });
  }

  // ---------- 관련부서 (여러 개, 전에 쓴 이름 다시 고르기) ----------
  function deptsUsed() {
    const c = {};
    Store.allItems().forEach(i => { if (!i.deleted) (i.depts || []).forEach(d => { c[d] = (c[d] || 0) + 1; }); });
    return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b, 'ko'));
  }
  function deptHTML(list) {
    return `<div class="field"><label for="f-dept">관련부서</label>`
      + (list.length ? `<div class="dept-chips">${list.map((d, i) => `<span class="dchip">${esc(d)}<button type="button" data-rmdept="${i}" aria-label="${esc(d)} 빼기">✕</button></span>`).join('')}</div>` : '')
      + `<div class="dept-add"><input type="text" id="f-dept" list="dept-list" autocomplete="off"><button type="button" class="btn" data-adddept aria-label="관련부서 추가">+</button></div>`
      + `<datalist id="dept-list">${deptsUsed().filter(d => !list.includes(d)).map(d => `<option value="${esc(d)}"></option>`).join('')}</datalist></div>`;
  }
  function deptPending(m, obj) {
    const el = $('#f-dept', m); if (!el) return;
    const v = el.value.trim(); obj.depts = obj.depts || [];
    if (v && !obj.depts.includes(v)) obj.depts.push(v);
    el.value = '';
  }
  // 창의 클릭·입력에 연결: 처리했으면 true
  function deptClick(e, m, obj, redraw) {
    if (e.target.closest('[data-adddept]')) { deptPending(m, obj); redraw(); setTimeout(() => { const el = $('#f-dept', m); if (el) el.focus(); }, 30); return true; }
    const r = e.target.closest('[data-rmdept]'); if (r) { obj.depts.splice(Number(r.dataset.rmdept), 1); redraw(); return true; }
    return false;
  }
  function deptKeys(m, obj, redraw) {
    m.addEventListener('keydown', e => { if (e.target.id === 'f-dept' && e.key === 'Enter') { e.preventDefault(); if (e.target.value.trim()) { deptPending(m, obj); redraw(); setTimeout(() => { const el = $('#f-dept', m); if (el) el.focus(); }, 30); } } });
    // 목록에서 고르면 바로 추가
    m.addEventListener('input', e => { if (e.target.id === 'f-dept' && (e.inputType === 'insertReplacementText' || !e.inputType) && deptsUsed().includes(e.target.value.trim())) { deptPending(m, obj); redraw(); } });
  }
  const deptLine = it => (it.depts && it.depts.length ? `<div class="dept-line">→ ${esc(it.depts.join(', '))}</div>` : '');

  // 일정·할 일 편집
  function openItem(id, preset = {}) {
    const isNew = !id;
    const it = isNew ? Object.assign({ kind: 'event', title: '', date: todayKey(), endDate: '', cat: 'c', sub: '', depts: [], memo: '', done: false }, preset) : JSON.parse(JSON.stringify(Store.item(id)));
    it.depts = it.depts || [];
    const S = Store.settings;
    const draw = () => {
      const isTodo = it.kind === 'todo';
      const subs = S.cats[it.cat].subs;
      return `<div class="m-head m-head-mini">${closeBtn}</div>`
        + (!isNew && isTodo ? `<button class="btn done-btn ${it.done ? '' : 'primary'}" data-toggle-done>${it.done ? '완료 취소' : '완료로 표시'}</button>` : '')
        + `<div class="field"><label for="f-title">제목</label><input type="text" id="f-title" value="${esc(it.title)}" autocomplete="off"></div>`
        + `<div class="field"><span class="lbl">종류</span><div class="pills"><button class="pill ${!isTodo ? 'on' : ''}" data-kind="event" style="${!isTodo ? 'background:var(--accent);color:var(--accent-text)' : ''}">일정</button><button class="pill ${isTodo ? 'on' : ''}" data-kind="todo" style="${isTodo ? `background:${S.todoColor};color:${textOn(S.todoColor)}` : ''}">할 일</button></div></div>`
        + `<div class="row2"><div class="field"><label for="f-date">시작일</label><input type="date" id="f-date" value="${it.date}"></div>`
        + `<div class="field"><label for="f-end">종료일</label><input type="date" id="f-end" value="${it.endDate || ''}"></div></div>`
        + `<div class="field"><span class="lbl">분류</span><div class="pills">${['k', 'c', 'p'].map(c => { const on = it.cat === c; const col = S.cats[c].color; return `<button class="pill ${on ? 'on' : ''}" data-cat="${c}" style="${on ? `background:${col};color:${textOn(col)}` : ''}"><span class="dot" style="background:${col}"></span>${esc(S.cats[c].name)}</button>`; }).join('')}</div></div>`
        + `<div class="field"><label for="f-sub">세부 분류</label><select id="f-sub"><option value="">없음</option>${subs.map(s => `<option ${s === it.sub ? 'selected' : ''}>${esc(s)}</option>`).join('')}${it.sub && !subs.includes(it.sub) ? `<option selected>${esc(it.sub)}</option>` : ''}</select></div>`
        + deptHTML(it.depts)
        + `<div class="field"><label for="f-memo">세부 메모</label><textarea id="f-memo">${esc(it.memo || '')}</textarea></div>`
        + (it.workId && Store.item(it.workId) ? `<div class="field"><span class="lbl">업무</span><button class="btn" data-openwork>${esc(Store.item(it.workId).title)} 열기</button></div>` : '')
        + (!isNew && !isTodo ? `<div class="field"><span class="lbl">회의록</span><button class="btn" data-meeting>${it.noteId && Store.item(it.noteId) && !Store.item(it.noteId).deleted ? '연결된 회의록 열기' : '이 일정으로 회의록 쓰기'}</button></div>` : '')
        + `<div class="m-actions">${isNew ? '' : '<button class="btn danger" data-del>삭제</button>'}<button class="btn primary" data-save>저장</button></div>`;
    };
    const readForm = m => {
      it.title = $('#f-title', m).value.trim();
      it.date = $('#f-date', m).value || it.date;
      const end = $('#f-end', m); if (end) it.endDate = end.value && end.value > it.date ? end.value : '';
      it.sub = $('#f-sub', m).value;
      it.memo = $('#f-memo', m).value;
      deptPending(m, it);
    };
    openModal(draw(), m => {
      const redraw = () => { readForm(m); m.innerHTML = draw(); };
      deptKeys(m, it, redraw); // 엔터·목록 선택: 부서만 추가하고 쓰던 내용은 그대로
      m.onclick = e => {
        if (e.target.closest('[data-close]')) return;
        if (deptClick(e, m, it, redraw)) return;
        const kb = e.target.closest('[data-kind]');
        if (kb) { readForm(m); it.kind = kb.dataset.kind; m.innerHTML = draw(); return; }
        const cb = e.target.closest('[data-cat]');
        if (cb) { readForm(m); if (it.cat !== cb.dataset.cat) { it.cat = cb.dataset.cat; it.sub = ''; } m.innerHTML = draw(); return; }
        if (e.target.closest('[data-toggle-done]')) {
          readForm(m);
          it.done = !it.done; it.doneDate = it.done ? todayKey() : '';
          Store.save(it); if (window.Ext) Ext.onItemSaved(it); closeModal(); render();
          toast(it.done ? '완료했어요' : '완료를 취소했어요');
          return;
        }
        if (e.target.closest('[data-openwork]')) { Ext.openWork(it.workId); return; }
        if (e.target.closest('[data-meeting]')) { readForm(m); Store.save(it); Ext.meetingFor(it.id); return; }
        if (e.target.closest('[data-save]')) {
          readForm(m);
          if (!it.title) { $('#f-title', m).focus(); return; }
          Store.save(it); if (window.Ext) Ext.onItemSaved(it); closeModal(); render();
          return;
        }
        if (e.target.closest('[data-del]')) {
          Store.remove(it.id); closeModal(); render();
          toast('삭제했어요', '되돌리기', () => { Store.restore(it.id); render(); });
        }
      };
      if (isNew) setTimeout(() => $('#f-title', m).focus(), 50);
      const before = JSON.stringify(it);
      m._guard = () => { if (!$('#f-title', m)) return null; readForm(m); return isNew ? '일정 등록을 취소할까요?' : (JSON.stringify(it) !== before ? '수정한 내용을 저장하지 않고 나갈까요?' : null); };
    });
  }

  function toggleDone(id) {
    if (id.startsWith('r:')) { Ext.toggleOccurrence(id); render(); return; }
    const it = Store.item(id);
    if (!it || it.kind !== 'todo') return;
    it.done = !it.done; it.doneDate = it.done ? todayKey() : '';
    Store.save(it); if (window.Ext) Ext.onItemSaved(it); render();
    toast(it.done ? '완료했어요' : '완료를 취소했어요');
  }

  // 연·월 이동
  function openYM() {
    let y = state.year;
    const draw = () => `<div class="m-head"><h2>연도·월 이동</h2>${closeBtn}</div>`
      + `<div class="ym-year"><button class="ib" data-y="-1" aria-label="이전 해">‹</button><input type="number" id="ym-y" value="${y}" inputmode="numeric" aria-label="연도"><button class="ib" data-y="1" aria-label="다음 해">›</button></div>`
      + `<div class="ym-months">${Array.from({ length: 12 }, (_, i) => `<button data-m="${i}" class="${y === state.year && i === state.month ? 'on' : ''}">${i + 1}월</button>`).join('')}</div>`;
    openModal(draw(), m => {
      m.onclick = e => {
        if (e.target.closest('[data-close]')) return;
        const yb = e.target.closest('[data-y]');
        if (yb) { y = (parseInt($('#ym-y', m).value, 10) || y) + Number(yb.dataset.y); m.innerHTML = draw(); return; }
        const mb = e.target.closest('[data-m]');
        if (mb) {
          y = parseInt($('#ym-y', m).value, 10) || y;
          if (y < 1 || y > 9999) return;
          state.year = y; state.month = Number(mb.dataset.m); state.view = 'month';
          closeModal(); render();
        }
      };
    });
  }

  // 분류·색상 관리
  function openCats() {
    const S = Store.settings;
    const colorField = (val, attr) => `<span class="color-in"><input type="color" value="${val}" ${attr} aria-label="색 고르기"><input type="text" value="${val.toUpperCase()}" ${attr} maxlength="7" aria-label="색상 코드"></span>`;
    const draw = () => `<div class="m-head"><h2>분류·색상 관리</h2>${closeBtn}</div>`
      + ['k', 'c', 'p'].map(c => {
        const cat = S.cats[c];
        return `<div class="cat-block"><div class="cat-head"><span class="preview-chip" style="background:${cat.color};color:${textOn(cat.color)}">${esc(cat.name)}</span><span class="name"></span>${colorField(cat.color, `data-catcolor="${c}"`)}</div>`
          + cat.subs.map((s, i) => {
            const sc = S.subColors[`${c}/${s}`];
            return `<div class="sub-row"><input type="text" class="sub-name" value="${esc(s)}" data-rename="${c}" data-i="${i}" aria-label="세부 분류 이름">${colorField(sc || cat.color, `data-subcolor="${c}" data-i="${i}"`)}${sc ? `<button class="x" data-subreset="${c}" data-i="${i}" aria-label="큰 분류 색으로">↺</button>` : '<span style="width:36px"></span>'}<button class="x" data-subdel="${c}" data-i="${i}" aria-label="삭제">✕</button></div>`;
          }).join('')
          + `<div class="add-sub"><input type="text" data-newsub="${c}" aria-label="새 세부 분류"><button data-addsub="${c}">추가</button></div></div>`;
      }).join('')
      + `<div class="cat-block"><div class="cat-head"><span class="preview-chip" style="background:${S.todoColor};color:${textOn(S.todoColor)}">할 일</span><span class="name"></span>${colorField(S.todoColor, 'data-todocolor')}</div></div>`
      + `<div class="m-actions"><button class="btn" data-resetcolors style="flex:1">기본색으로 되돌리기</button></div>`;
    const apply = (el, v) => {
      if (!validHex(v)) return false;
      v = v.toUpperCase();
      Store.updateSettings(s => {
        if (el.dataset.catcolor) s.cats[el.dataset.catcolor].color = v;
        else if (el.dataset.subcolor) { const c = el.dataset.subcolor; s.subColors[`${c}/${s.cats[c].subs[el.dataset.i]}`] = v; }
        else if (el.hasAttribute('data-todocolor')) s.todoColor = v;
      });
      return true;
    };
    openModal(draw(), m => {
      const redraw = () => { m.innerHTML = draw(); render(); };
      m.oninput = e => {
        const el = e.target;
        if (el.type === 'color') { if (apply(el, el.value)) { el.nextElementSibling.value = el.value.toUpperCase(); render(); } }
        else if (el.type === 'text' && el.maxLength === 7) { let v = el.value.trim(); if (v[0] !== '#') v = '#' + v; if (apply(el, v)) { el.previousElementSibling.value = v; render(); } }
      };
      m.onchange = e => {
        const el = e.target;
        if (el.dataset.rename) {
          const c = el.dataset.rename, i = Number(el.dataset.i), v = el.value.trim();
          const old = S.cats[c].subs[i];
          if (!v || v === old || S.cats[c].subs.includes(v)) { el.value = old; return; }
          Store.updateSettings(s => {
            s.cats[c].subs[i] = v;
            if (s.subColors[`${c}/${old}`]) { s.subColors[`${c}/${v}`] = s.subColors[`${c}/${old}`]; delete s.subColors[`${c}/${old}`]; }
          });
          Store.items().forEach(it => { if (it.cat === c && it.sub === old) { it.sub = v; Store.save(it); } });
          redraw();
        }
        if (el.type === 'color' || el.maxLength === 7) m.innerHTML = draw();
      };
      m.onclick = e => {
        const add = e.target.closest('[data-addsub]');
        if (add) {
          const c = add.dataset.addsub, inp = m.querySelector(`[data-newsub="${c}"]`), v = inp.value.trim();
          if (v && !S.cats[c].subs.includes(v)) { Store.updateSettings(s => s.cats[c].subs.push(v)); redraw(); }
          return;
        }
        const del = e.target.closest('[data-subdel]');
        if (del) {
          const c = del.dataset.subdel, i = Number(del.dataset.i), name = S.cats[c].subs[i];
          if (!confirm(`'${name}' 세부 분류를 삭제할까요?\n이미 등록된 일정은 그대로 남아요.`)) return;
          Store.updateSettings(s => { s.cats[c].subs.splice(i, 1); delete s.subColors[`${c}/${name}`]; });
          redraw(); return;
        }
        const rs = e.target.closest('[data-subreset]');
        if (rs) { const c = rs.dataset.subreset; Store.updateSettings(s => { delete s.subColors[`${c}/${s.cats[c].subs[rs.dataset.i]}`]; }); redraw(); return; }
        if (e.target.closest('[data-resetcolors]')) {
          Store.updateSettings(s => { ['k', 'c', 'p'].forEach(c => { s.cats[c].color = Store.defaults.cats[c].color; }); s.subColors = {}; s.todoColor = Store.defaults.todoColor; });
          redraw();
        }
      };
    });
  }

  function openTheme() {
    const draw = () => { const t = Store.settings.theme; return `<div class="m-head"><h2>테마</h2>${closeBtn}</div><div class="field"><span class="lbl">화면 밝기</span><div class="pills"><button class="pill ${t === 'light' ? 'on' : ''}" data-theme="light" style="${t === 'light' ? 'background:var(--accent);color:var(--accent-text)' : ''}">밝게</button><button class="pill ${t === 'dark' ? 'on' : ''}" data-theme="dark" style="${t === 'dark' ? 'background:var(--accent);color:var(--accent-text)' : ''}">어둡게</button></div></div>`; };
    openModal(draw(), m => {
      m.onclick = e => { const b = e.target.closest('[data-theme]'); if (b) { Store.updateSettings(s => { s.theme = b.dataset.theme; }); render(); m.innerHTML = draw(); } };
    });
  }

  function openBackup() {
    openModal(`<div class="m-head"><h2>백업·가져오기</h2>${closeBtn}</div>`
      + `<p class="hint" style="font-size:13.5px;line-height:1.6;margin:0 0 14px">지금은 일정이 이 기기에만 저장돼요. 동기화를 연결하기 전까지는 가끔 백업 파일을 받아두세요.</p>`
      + `<div class="field"><button class="btn primary" data-export>백업 파일 내려받기</button></div>`
      + `<div class="field"><label for="f-import">백업 파일 불러오기</label><input type="file" id="f-import" accept=".json,application/json"></div>`
      + `<div class="field"><span class="lbl">불러오는 방식</span><div class="pills"><button class="pill on" data-mode="merge" style="background:var(--accent);color:var(--accent-text)">합치기</button><button class="pill" data-mode="replace">전부 바꾸기</button></div></div>`, m => {
      let mode = 'merge';
      m.onclick = e => {
        if (e.target.closest('[data-export]')) {
          const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `내일정-백업-${todayKey()}.json`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          return;
        }
        const mb = e.target.closest('[data-mode]');
        if (mb) { mode = mb.dataset.mode; $$('[data-mode]', m).forEach(b => { const on = b === mb; b.classList.toggle('on', on); b.style.cssText = on ? 'background:var(--accent);color:var(--accent-text)' : ''; }); }
      };
      $('#f-import', m).onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        if (mode === 'replace' && !confirm('지금 일정을 모두 파일 내용으로 바꿀까요?')) return;
        f.text().then(t => { Store.importJSON(t, mode); closeModal(); render(); toast('불러왔어요'); }).catch(() => toast('파일을 읽지 못했어요'));
      };
    });
  }

  // ---------- 메뉴 ----------
  const drawer = $('#drawer'), scrim = $('#drawer-scrim');
  const openDrawer = () => { drawer.classList.add('open'); scrim.classList.add('open'); renderDrawerFoot(); syncBack(); };
  $('#btn-menu').onclick = openDrawer;
  scrim.onclick = closeDrawer;
  drawer.addEventListener('click', e => {
    const b = e.target.closest('.drawer-item'); if (!b) return;
    closeDrawer();
    if (b.dataset.tab) { setScreen(b.dataset.tab); return; }
    const ext = window.Ext || {};
    ({ cats: openCats, theme: openTheme, backup: openBackup, sync: openSync, rules: ext.openRules, attend: ext.openAttend, io: ext.openIO })[b.dataset.open]();
  });

  // ---------- 하단 탭 ----------
  $('.tabbar').addEventListener('click', e => {
    const t = e.target.closest('[data-tab]'); if (!t) return;
    setScreen(t.dataset.tab);
  });
  function setScreen(sc) {
    state.screen = sc;
    if (sc === 'calendar') { showMonth(); return; }
    render();
  }

  // ---------- 상단 버튼 ----------
  $('#btn-prev').onclick = () => go(-1);
  $('#btn-next').onclick = () => go(1);
  $('#btn-today').onclick = goToday;
  $('#btn-title').onclick = openYM;
  $('#btn-view').onclick = () => {
    if (state.view === 'week') { showMonth(); return; }
    const t = todayKey();
    const inMonth = parse(t).getFullYear() === state.year && parse(t).getMonth() === state.month;
    showWeek(inMonth ? mondayOf(t) : mondayOf(keyOf(new Date(state.year, state.month, 1))));
  };
  $('#btn-add').onclick = () => { if (state.screen === 'calendar') openItem(null, {}); else Ext.addOnScreen(state.screen); };

  // ---------- 달력 클릭·길게 누르기·밀기 ----------
  let pressTimer = null, pressed = false, sx = 0, sy = 0, st = 0;
  view.addEventListener('pointerdown', e => {
    const c = e.target.closest('.chip[data-id]');
    pressed = false;
    const isTodoChip = c && (c.dataset.id.startsWith('r:') ? c.classList.contains('todo') : (Store.item(c.dataset.id) && Store.item(c.dataset.id).kind === 'todo'));
    if (isTodoChip) {
      pressTimer = setTimeout(() => { pressed = true; if (navigator.vibrate) navigator.vibrate(20); toggleDone(c.dataset.id); }, 550);
    }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => view.addEventListener(t, () => clearTimeout(pressTimer)));
  view.addEventListener('contextmenu', e => { if (e.target.closest('.chip')) e.preventDefault(); });
  view.addEventListener('click', e => {
    if (pressed) { pressed = false; return; }
    const mini = e.target.closest('[data-mini]');
    if (mini) { const wt = weekTitle(state.weekStart); const cur = state.miniYM || { y: wt.y, m: wt.m - 1 }; const d = new Date(cur.y, cur.m + Number(mini.dataset.mini), 1); state.miniYM = { y: d.getFullYear(), m: d.getMonth() }; renderWeek(); return; }
    const gw = e.target.closest('[data-goweek]'); if (gw) { showWeek(gw.dataset.goweek); return; }
    const wk = e.target.closest('[data-week]'); if (wk) { showWeek(wk.dataset.week); return; }
    if (state.screen !== 'calendar') return;
    const bx = e.target.closest('.chip.box[data-id]'); if (bx && (e.target.closest('[data-check]') || (bx.querySelector('[data-check]') && e.clientX - bx.getBoundingClientRect().left < 18))) { toggleDone(bx.dataset.id); return; }
    const c = e.target.closest('.chip[data-id]'); if (c) { openChip(c.dataset.id); return; }
    const d = e.target.closest('[data-day]');
    if (d) {
      if (sideOn()) { state.selDay = d.dataset.day; $$('.day.sel').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); renderSide(); return; }
      openItem(null, { date: d.dataset.day });
    }
  });
  // PC: 날짜 빈 곳을 두 번 누르면 바로 등록
  view.addEventListener('dblclick', e => { if (!sideOn() || e.target.closest('.chip')) return; const d = e.target.closest('[data-day]'); if (d) openItem(null, { date: d.dataset.day }); });
  $('#side').addEventListener('click', e => {
    const ck = e.target.closest('[data-sdcheck]'); if (ck) { toggleDone(ck.dataset.sdcheck); return; }
    if (e.target.closest('[data-sdnew]')) { openItem(null, { date: state.selDay || todayKey() }); return; }
    const o = e.target.closest('[data-sdopen]'); if (o) openChip(o.dataset.sdopen);
  });
  view.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  view.addEventListener('touchend', e => {
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (state.screen === 'calendar' && Math.abs(dx) > 60 && Math.abs(dy) < 50 && Date.now() - st < 600 && !e.target.closest('textarea')) { clearTimeout(pressTimer); go(dx < 0 ? 1 : -1); }
  }, { passive: true });

  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });
  // 날짜가 바뀌면 다시 그리기 (할 일 이월)
  let lastDay = todayKey();
  setInterval(() => { if (todayKey() !== lastDay) { lastDay = todayKey(); render(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && todayKey() !== lastDay) { lastDay = todayKey(); render(); } });

  // ---------- 앱 설치·업데이트 ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      const ask = w => { $('#update-bar').hidden = false; $('#btn-update').onclick = () => w.postMessage('skipWaiting'); };
      if (reg.waiting) ask(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
      });
      setInterval(() => reg.update(), 30 * 60000);
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }

  window.App = { deptHTML, deptClick, deptKeys, deptPending, deptLine, state, render, openModal, closeModal, closeBtn, confirm: confirmBox, choose: chooseBox, toast, esc, pad, keyOf, parse, addDays, diffDays, todayKey, mondayOf, labelDate, textOn, colorOf, chipHTML, layout, openItem, openChip, setScreen, splitTitle, timeOf, WD };
  if (window.Ext) Ext.init(App);
  render();

  // ---------- 동기화 시작 ----------
  let rr;
  const remoteRender = () => { clearTimeout(rr); rr = setTimeout(render, 80); };
  if (window.Sync) {
    Sync.onStatus(() => { renderDrawerFoot(); paintSyncBtn(); });
    Sync.start(Store, remoteRender).catch(e => console.error(e));
  }
})();
