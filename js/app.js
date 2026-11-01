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
      if (it.kind === 'todo') {
        if (it.done) push(it.doneDate || it.date, { it, late: 0 });
        else if (it.date >= today) push(it.date, { it, late: 0 });
        else push(today, { it, late: diffDays(it.date, today) });
      } else {
        const last = it.endDate && it.endDate > it.date ? it.endDate : it.date;
        if (last < start || it.date > end) return;
        let k = it.date < start ? start : it.date;
        const stop = last > end ? end : last;
        while (k <= stop) { push(k, { it, late: 0 }); k = addDays(k, 1); }
      }
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

  function chipHTML(e, opts = {}) {
    const it = e.it;
    const bg = colorOf(it), fg = textOn(bg);
    const [tm, tx] = splitTitle(it.title);
    const done = it.kind === 'todo' && it.done && !opts.noDone;
    const box = opts.box && it.kind === 'todo';
    const cls = `chip ${it.kind === 'todo' ? 'todo' : it.cat}${done ? ' done' : ''}${box ? ' box' : ''}`;
    return `<div class="${cls}" data-id="${it.id}"${box ? '' : ` style="background:${bg};color:${fg}"`}>`
      + (box ? `<span class="cb" data-check="${it.id}" role="checkbox" aria-checked="${it.done ? 'true' : 'false'}" aria-label="완료"></span>` : '')
      + (tm ? `<span class="tm">${esc(tm)}</span>` : '')
      + `<span class="tx">${esc(tx || '(제목 없음)')}</span>`
      + (e.late > 0 ? `<span class="late"><span class="lp">+</span>${e.late}<span class="lt">일 밀림</span></span>` : '')
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
    if (state.screen !== 'calendar' && window.Ext) { Ext.renderScreen(state.screen, view); $('#side').innerHTML = ''; renderDrawerFoot(); syncBack(); return; }
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
    const cap = Math.max(1, Math.floor((rowH - 34) / chipH));

    let html = '';
    for (let w = 0; w < weeks; w++) {
      const mon = addDays(start, w * 7);
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
        const shown = list.length > cap ? list.slice(0, cap - 1) : list;
        html += `<div class="${cls}" data-day="${k}"><div class="dh"><span class="dn">${d.getDate()}</span>${hol ? `<span class="hol">${esc(hol[0])}</span>` : ''}</div>`
          + shown.map(e => chipHTML(e, { box: true })).join('')
          + (list.length > shown.length ? `<div class="more">+${list.length - shown.length}</div>` : '')
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
        + (list.length ? list.map(e => `<div class="witem">${chipHTML(e, { noDone: true })}${e.it.memo ? `<div class="memo">${esc(e.it.memo)}</div>` : ''}</div>`).join('') : '<div class="empty">일정 없음</div>')
        + `</div>`;
    };

    view.innerHTML = `<div class="week" id="week"><div class="week-top">${mini}<div class="memo-box"><label for="week-memo">이번 주 메모</label><textarea id="week-memo" placeholder="이번 주 목표나 메모">${esc(Store.weekMemo(mon))}</textarea></div></div>`
      + `<div class="wcols">${[0, 1, 2, 3, 4].map(i => col(addDays(mon, i))).join('')}<div class="wkend">${col(addDays(mon, 5))}${col(sun)}</div></div></div>`;

    let t;
    $('#week-memo').addEventListener('input', e => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => Store.setWeekMemo(mon, v), 400); });
  }

  function renderSide() {
    const side = $('#side');
    if (innerWidth < 1100) { side.innerHTML = ''; return; }
    const k = todayKey();
    const list = (layout(k, k)[k] || []);
    const ev = list.filter(e => e.it.kind !== 'todo'), td = list.filter(e => e.it.kind === 'todo');
    const hol = Holidays.get(k);
    side.innerHTML = `<div><div class="side-date">${labelDate(k).replace(' (', ' ').replace(')', '요일')}</div><div class="side-sub">${hol ? esc(hol.join(', ')) + ' · ' : ''}일정 ${ev.length} · 할 일 ${td.length}</div></div>`
      + `<div><h3>오늘 일정</h3><div class="side-box">${ev.length ? ev.map(e => chipHTML(e)).join('') : '<div class="empty">일정 없음</div>'}</div></div>`
      + `<div><h3>오늘 할 일</h3><div class="side-box">${td.length ? td.map(e => chipHTML(e)).join('') : '<div class="empty">할 일 없음</div>'}</div></div>`
      + `<div><h3>진행 중 업무</h3><div class="side-note">업무 기능은 2차 제작 때 이 자리에 표시돼요.</div></div>`;
  }

  function renderDrawerFoot() {
    const s = Store.data.savedAt;
    $('#sync-state').textContent = syncLabel();
    $('#drawer-foot').innerHTML = `앱 버전 1.3.0<br>마지막 저장: ${s ? new Date(s).toLocaleString('ko-KR') : '-'}<br>일정 ${Store.items().filter(i => i.kind === 'event' || i.kind === 'todo').length}개`;
  }

  function syncLabel() {
    if (!window.Sync || !Sync.code) return '이 기기에만 저장 중 · 동기화 연결 전';
    return ({ on: '동기화 연결됨', connecting: '동기화 연결 중…', offline: '오프라인 · 연결되면 자동으로 맞춰져요', error: '동기화 오류 · 동기화 코드 메뉴를 확인하세요' })[Sync.status] || '동기화 연결됨';
  }

  // 동기화 코드
  function openSync() {
    const draw = () => {
      if (Sync.code) {
        return `<div class="m-head"><h2>동기화 코드</h2>${closeBtn}</div>`
          + `<p class="hint" style="font-size:13.5px;line-height:1.6;margin:0 0 14px">이 기기는 동기화 중이에요. 다른 기기에서도 같은 코드를 넣으면 같은 일정이 보여요. 코드를 아는 사람은 일정을 볼 수 있으니 남에게 알려주지 마세요.</p>`
          + `<div class="field"><span class="lbl">상태</span><div>${esc(syncLabel())}</div></div>`
          + `<div class="field"><span class="lbl">내 동기화 코드</span><div class="code-box" id="code-box">${esc(Sync.code.slice(0, 4))}-••••-••••-••••-••••-${esc(Sync.code.slice(-4))}</div><button class="btn" data-show>코드 전체 보기</button></div>`
          + `<div class="m-actions"><button class="btn primary" data-copylink>연결 링크 복사</button><button class="btn" data-copycode>코드 복사</button></div>`
          + ``
          + `<div class="m-actions"><button class="btn danger" data-disconnect style="flex:1">이 기기 연결 끊기</button></div>`;
      }
      return `<div class="m-head"><h2>동기화 코드</h2>${closeBtn}</div>`
        + ``
        + `<div class="field"><span class="lbl">처음 쓰는 경우 (이 기기가 첫 기기)</span><button class="btn primary" data-new>새 동기화 코드 만들기</button></div>`
        + `<div class="field" style="margin-top:20px"><label for="f-code">다른 기기에서 이미 쓰는 경우</label><input type="text" id="f-code" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters"><button class="btn primary" data-join>이 코드로 연결</button></div>`;
    };
    const onRemote = () => render();
    const copy = (text, msg) => { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => { prompt('아래 내용을 복사하세요', text); }); };
    openModal(draw(), m => {
      m.onclick = async e => {
        if (e.target.closest('[data-close]')) return;
        if (e.target.closest('[data-new]')) {
          try { await Sync.connect(Store, onRemote, Sync.newCode(), { upload: true }); m.innerHTML = draw(); renderDrawerFoot(); toast('동기화를 시작했어요'); } catch (err) { toast('연결하지 못했어요: ' + err.message); }
          return;
        }
        if (e.target.closest('[data-join]')) {
          const v = $('#f-code', m).value;
          try { await Sync.connect(Store, onRemote, v, { upload: true }); m.innerHTML = draw(); renderDrawerFoot(); toast('연결했어요. 일정을 맞추는 중이에요'); } catch (err) { toast(err.message); }
          return;
        }
        if (e.target.closest('[data-show]')) { $('#code-box', m).textContent = Sync.code; return; }
        if (e.target.closest('[data-copycode]')) { copy(Sync.code, '코드를 복사했어요'); return; }
        if (e.target.closest('[data-copylink]')) { copy(Sync.link(), '연결 링크를 복사했어요'); return; }
        if (e.target.closest('[data-disconnect]')) {
          if (!confirm('이 기기의 동기화를 끊을까요?\n이 기기의 일정은 그대로 남고, 다른 기기의 변경은 더 이상 받지 않아요.\n다시 연결하려면 코드가 필요하니 먼저 복사해두세요.')) return;
          Sync.disconnect(); m.innerHTML = draw(); renderDrawerFoot();
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
  wrap.addEventListener('click', e => { if (e.target === wrap && !modal.querySelector('input:not([type=checkbox]), textarea, select')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !wrap.hidden) closeModal(); });
  const closeBtn = '<button class="ib" data-close aria-label="닫기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });

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
      + `<div class="day-list">${list.length ? list.map(e => `<div>${chipHTML(e)}${e.it.memo ? `<div class="memo">${esc(e.it.memo)}</div>` : ''}</div>`).join('') : '<div class="empty">등록된 일정이 없어요</div>'}</div>`
      + `<div class="m-actions"><button class="btn primary" data-new="event">+ 추가</button></div>`
      + `<div class="m-actions"><button class="btn" style="flex:1" data-weekof="${k}">이 주 위클리 보기</button></div>`, m => {
      m.onclick = e => {
        const n = e.target.closest('[data-new]'); if (n) { openItem(null, { kind: n.dataset.new, date: k }); return; }
        const w = e.target.closest('[data-weekof]'); if (w) { closeModal(); showWeek(mondayOf(k)); return; }
        const c = e.target.closest('.chip[data-id]'); if (c) openChip(c.dataset.id);
      };
    });
  }

  // 일정·할 일 편집
  function openItem(id, preset = {}) {
    const isNew = !id;
    const it = isNew ? Object.assign({ kind: 'event', title: '', date: todayKey(), endDate: '', cat: 'c', sub: '', memo: '', done: false }, preset) : JSON.parse(JSON.stringify(Store.item(id)));
    const S = Store.settings;
    const draw = () => {
      const isTodo = it.kind === 'todo';
      const subs = S.cats[it.cat].subs;
      return `<div class="m-head m-head-mini">${closeBtn}</div>`
        + (!isNew && isTodo ? `<button class="btn done-btn ${it.done ? '' : 'primary'}" data-toggle-done>${it.done ? '완료 취소' : '완료로 표시'}</button>` : '')
        + `<div class="field"><label for="f-title">제목</label><input type="text" id="f-title" value="${esc(it.title)}" autocomplete="off"></div>`
        + `<div class="field"><span class="lbl">종류</span><div class="pills"><button class="pill ${!isTodo ? 'on' : ''}" data-kind="event" style="${!isTodo ? 'background:var(--accent);color:var(--accent-text)' : ''}">일정</button><button class="pill ${isTodo ? 'on' : ''}" data-kind="todo" style="${isTodo ? `background:${S.todoColor};color:${textOn(S.todoColor)}` : ''}">할 일</button></div></div>`
        + `<div class="row2"><div class="field"><label for="f-date">${isTodo ? '날짜' : '시작일'}</label><input type="date" id="f-date" value="${it.date}"></div>`
        + (isTodo ? '' : `<div class="field"><label for="f-end">종료일 (선택)</label><input type="date" id="f-end" value="${it.endDate || ''}"></div>`) + `</div>`
        + `<div class="field"><span class="lbl">분류</span><div class="pills">${['k', 'c', 'p'].map(c => { const on = it.cat === c; const col = S.cats[c].color; return `<button class="pill ${on ? 'on' : ''}" data-cat="${c}" style="${on ? `background:${col};color:${textOn(col)}` : ''}"><span class="dot" style="background:${col}"></span>${esc(S.cats[c].name)}</button>`; }).join('')}</div></div>`
        + `<div class="field"><label for="f-sub">세부 분류</label><select id="f-sub"><option value="">없음</option>${subs.map(s => `<option ${s === it.sub ? 'selected' : ''}>${esc(s)}</option>`).join('')}${it.sub && !subs.includes(it.sub) ? `<option selected>${esc(it.sub)}</option>` : ''}</select></div>`
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
    };
    openModal(draw(), m => {
      m.onclick = e => {
        if (e.target.closest('[data-close]')) return;
        const kb = e.target.closest('[data-kind]');
        if (kb) { readForm(m); it.kind = kb.dataset.kind; if (it.kind === 'todo') it.endDate = ''; m.innerHTML = draw(); return; }
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
          + `<div class="add-sub"><input type="text" placeholder="세부 분류 추가" data-newsub="${c}" aria-label="새 세부 분류"><button data-addsub="${c}">추가</button></div></div>`;
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
    const bx = e.target.closest('.chip.box[data-id]'); if (bx && (e.target.closest('[data-check]') || e.clientX - bx.getBoundingClientRect().left < 18)) { toggleDone(bx.dataset.id); return; }
    const c = e.target.closest('.chip[data-id]'); if (c) { openChip(c.dataset.id); return; }
    const d = e.target.closest('[data-day]'); if (d) openItem(null, { date: d.dataset.day });
  });
  $('#side').addEventListener('click', e => { const c = e.target.closest('.chip[data-id]'); if (c) openChip(c.dataset.id); });
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

  window.App = { state, render, openModal, closeModal, closeBtn, confirm: confirmBox, choose: chooseBox, toast, esc, pad, keyOf, parse, addDays, diffDays, todayKey, mondayOf, labelDate, textOn, colorOf, chipHTML, layout, openItem, openChip, setScreen, splitTitle, timeOf, WD };
  if (window.Ext) Ext.init(App);
  render();

  // ---------- 동기화 시작 ----------
  let rr;
  const remoteRender = () => { clearTimeout(rr); rr = setTimeout(render, 80); };
  if (window.Sync) {
    Sync.onStatus(() => renderDrawerFoot());
    Sync.start(Store, remoteRender).catch(e => console.error(e));
  }
})();
