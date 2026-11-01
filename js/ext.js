// 2·3차 기능: 정기업무, 업무 진척, 근태 현황, 미니북, 가져오기·내보내기
// 모든 데이터는 Store의 항목(kind로 구분)으로 저장되어 동기화가 그대로 적용된다.
//   rule = 정기업무, work = 업무, book = 미니북, page = 미니북 페이지
(function () {
  'use strict';
  let A; // App 공용 함수 (app.js가 init으로 넘겨줌)
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const S = () => Store.settings;
  const byKind = k => Store.items().filter(i => i.kind === k);
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const WDN = ['일', '월', '화', '수', '목', '금', '토'];
  const accentOn = 'background:var(--accent);color:var(--accent-text)';
  const pill = (on, attr, label, style) => `<button class="pill ${on ? 'on' : ''}" ${attr} style="${on ? (style || accentOn) : ''}">${label}</button>`;

  // ======================= 음력 → 양력 =======================
  const Lunar = {
    info(y) {
      const s = (window.LUNAR_YEARS || {})[y]; if (!s) return null;
      const leap = parseInt(s[4], 16);
      const [b36, cnt] = s.slice(5).split('.');
      const bits = parseInt(b36, 36).toString(2).padStart(Number(cnt), '0');
      const months = []; let i = 0;
      for (let m = 1; m <= 12; m++) {
        months.push({ m, leap: false, len: bits[i++] === '1' ? 30 : 29 });
        if (leap === m) months.push({ m, leap: true, len: bits[i++] === '1' ? 30 : 29 });
      }
      return { start: `${y}-${s.slice(0, 2)}-${s.slice(2, 4)}`, months };
    },
    toSolar(y, m, d, leap) {
      const inf = this.info(y); if (!inf) return null;
      let off = 0;
      for (const x of inf.months) {
        if (x.m === m && x.leap === !!leap) return A.addDays(inf.start, off + Math.min(d, x.len) - 1);
        off += x.len;
      }
      return null;
    }
  };

  // ======================= 정기업무 =======================
  const dim = (y, m) => new Date(y, m + 1, 0).getDate(); // m: 0~11
  function ruleOccurs(r, k) {
    if (k < r.start || (r.end && k > r.end) || (r.skip || []).includes(k)) return false;
    const d = A.parse(k);
    switch (r.freq) {
      case 'daily': return true;
      case 'weekly': return (r.days || []).includes(d.getDay());
      case 'monthly':
        if (r.mmode === 'nth') {
          if (d.getDay() !== Number(r.dow)) return false;
          const n = Math.ceil(d.getDate() / 7), last = d.getDate() + 7 > dim(d.getFullYear(), d.getMonth());
          return Number(r.nth) === n || (Number(r.nth) === -1 && last);
        }
        return d.getDate() === Math.min(Number(r.mday) || 1, dim(d.getFullYear(), d.getMonth()));
      case 'yearly':
        if (r.lunar) {
          const y = d.getFullYear();
          return Lunar.toSolar(y, Number(r.month), Number(r.day), false) === k || Lunar.toSolar(y - 1, Number(r.month), Number(r.day), false) === k;
        }
        return d.getMonth() + 1 === Number(r.month) && d.getDate() === Number(r.day);
    }
    return false;
  }
  function occItem(r, k) {
    return { id: `r:${r.id}:${k}`, kind: r.itemKind, title: r.title, cat: r.cat, sub: r.sub, memo: r.memo, done: !!(r.doneMap || {})[k], ruleId: r.id, occ: k };
  }
  function ruleEntries(start, end) {
    const out = [], rules = byKind('rule');
    if (!rules.length) return out;
    let k = start;
    while (k <= end) {
      rules.forEach(r => { if (ruleOccurs(r, k)) out.push([k, { it: occItem(r, k), late: 0 }]); });
      k = A.addDays(k, 1);
    }
    return out;
  }
  function ruleSummary(r) {
    let f = '';
    if (r.freq === 'daily') f = '매일';
    else if (r.freq === 'weekly') f = '매주 ' + (r.days || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => WDN[d]).join('·');
    else if (r.freq === 'monthly') f = r.mmode === 'nth' ? `매월 ${Number(r.nth) === -1 ? '마지막' : r.nth + '번째'} ${WDN[r.dow]}요일` : `매월 ${r.mday}일`;
    else f = `매년 ${r.lunar ? '음력 ' : ''}${r.month}월 ${r.day}일`;
    return `${f} · ${r.itemKind === 'todo' ? '할 일' : '일정'} · ${r.start}부터${r.end ? ' ' + r.end + '까지' : ''}`;
  }
  let ruleFilter = '사용 중';
  function renderRules(view) {
    $('#title-text').textContent = '정기업무';
    const today = A.todayKey();
    const all = byKind('rule');
    const ended = r => r.end && r.end < today;
    const list = all.filter(r => ruleFilter === '전체' || (ruleFilter === '종료' ? ended(r) : !ended(r)))
      .sort((a, b) => a.cat.localeCompare(b.cat) || a.title.localeCompare(b.title, 'ko'));
    const cnt = f => all.filter(r => f === '전체' || (f === '종료' ? ended(r) : !ended(r))).length;
    view.innerHTML = `<div class="screen"><div class="pills filter">${['사용 중', '종료', '전체'].map(f => pill(ruleFilter === f, `data-rf="${f}"`, `${f} ${cnt(f)}`)).join('')}</div>`
      + `<div class="list rules-list">${list.length ? list.map(r => `<button class="lrow" data-rule="${r.id}"><span class="dot" style="background:${A.colorOf({ kind: r.itemKind, cat: r.cat, sub: r.sub })}"></span><span class="lmain"><span class="lt">${A.esc(r.title)}${ended(r) ? ' <em>(종료)</em>' : ''}</span><span class="ls">${A.esc(ruleSummary(r))}</span></span></button>`).join('')
        : `<div class="empty" style="padding:24px 4px">${all.length ? '해당하는 정기업무가 없어요' : '아직 등록된 정기업무가 없어요.<br>매주 회의, 월간 점검, 분기 측정, 생일(음력 포함) 같은 걸 넣으면 달력에 자동으로 표시돼요.'}</div>`}</div></div>`;
    view.onclick = e => {
      const f = e.target.closest('[data-rf]'); if (f) { ruleFilter = f.dataset.rf; renderRules(view); return; }
      const r = e.target.closest('[data-rule]'); if (r) openRuleEdit(r.dataset.rule);
    };
  }
  function openRules() { A.setScreen('rules'); }
  function openRulesOld() {
    const rules = byKind('rule').sort((a, b) => a.title.localeCompare(b.title, 'ko'));
    const today = A.todayKey();
    A.openModal(`<div class="m-head"><h2>정기업무</h2>${A.closeBtn}</div>`
      + ``
      + `<div class="list">${rules.length ? rules.map(r => `<button class="lrow" data-rule="${r.id}"><span class="dot" style="background:${A.colorOf({ kind: r.itemKind, cat: r.cat, sub: r.sub })}"></span><span class="lmain"><span class="lt">${A.esc(r.title)}${r.end && r.end < today ? ' <em>(종료)</em>' : ''}</span><span class="ls">${A.esc(ruleSummary(r))}</span></span></button>`).join('') : '<div class="empty">아직 등록된 정기업무가 없어요</div>'}</div>`
      + `<div class="m-actions"><button class="btn primary" data-newrule>+ 정기업무 추가</button></div>`, m => {
      m.onclick = e => {
        const r = e.target.closest('[data-rule]'); if (r) { openRuleEdit(r.dataset.rule); return; }
        if (e.target.closest('[data-newrule]')) openRuleEdit(null);
      };
    });
  }
  function openRuleEdit(id, back) {
    const isNew = !id;
    const today = A.todayKey(), t = A.parse(today);
    const r = isNew ? { kind: 'rule', itemKind: 'event', title: '', cat: 'c', sub: '', memo: '', freq: 'weekly', days: [t.getDay()], mmode: 'day', mday: t.getDate(), nth: 1, dow: t.getDay(), month: t.getMonth() + 1, day: t.getDate(), lunar: false, start: today, end: '', skip: [], doneMap: {} } : JSON.parse(JSON.stringify(Store.item(id)));
    const draw = () => {
      const cats = S().cats, subs = cats[r.cat].subs;
      let rep = '';
      if (r.freq === 'weekly') rep = `<div class="field"><span class="lbl">요일</span><div class="pills">${[1, 2, 3, 4, 5, 6, 0].map(d => pill((r.days || []).includes(d), `data-day="${d}"`, WDN[d])).join('')}</div></div>`;
      if (r.freq === 'monthly') rep = `<div class="field"><span class="lbl">기준</span><div class="pills">${pill(r.mmode !== 'nth', 'data-mmode="day"', '날짜로')}${pill(r.mmode === 'nth', 'data-mmode="nth"', '몇째 주 요일로')}</div></div>`
        + (r.mmode === 'nth'
          ? `<div class="row2"><div class="field"><label for="r-nth">몇째 주</label><select id="r-nth">${[1, 2, 3, 4, 5, -1].map(n => `<option value="${n}" ${Number(r.nth) === n ? 'selected' : ''}>${n === -1 ? '마지막' : n + '번째'}</option>`).join('')}</select></div><div class="field"><label for="r-dow">요일</label><select id="r-dow">${[1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}" ${Number(r.dow) === d ? 'selected' : ''}>${WDN[d]}요일</option>`).join('')}</select></div></div>`
          : `<div class="field"><label for="r-mday">매월 며칠</label><select id="r-mday">${Array.from({ length: 31 }, (_, i) => `<option ${Number(r.mday) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>`);
      if (r.freq === 'yearly') rep = `<div class="row2"><div class="field"><label for="r-month">월</label><select id="r-month">${Array.from({ length: 12 }, (_, i) => `<option ${Number(r.month) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div><div class="field"><label for="r-day">일</label><select id="r-day">${Array.from({ length: 31 }, (_, i) => `<option ${Number(r.day) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div></div>`
        + `<label class="check"><input type="checkbox" id="r-lunar" ${r.lunar ? 'checked' : ''}>음력 날짜 (음력 생일 등)</label>`;
      return `<div class="m-head"><h2>${isNew ? '정기업무 추가' : '정기업무 수정'}</h2>${A.closeBtn}</div>`
        + `<div class="field"><span class="lbl">종류</span><div class="pills">${pill(r.itemKind === 'event', 'data-ik="event"', '일정')}${pill(r.itemKind === 'todo', 'data-ik="todo"', '할 일 (체크형)')}</div></div>`
        + `<div class="field"><label for="r-title">제목</label><input type="text" id="r-title" value="${A.esc(r.title)}" autocomplete="off"></div>`
        + `<div class="field"><span class="lbl">분류</span><div class="pills">${['k', 'c', 'p'].map(c => { const col = cats[c].color; return pill(r.cat === c, `data-cat="${c}"`, `<span class="dot" style="background:${col}"></span>${A.esc(cats[c].name)}`, `background:${col};color:${A.textOn(col)}`); }).join('')}</div></div>`
        + `<div class="field"><label for="r-sub">세부 분류</label><select id="r-sub"><option value="">없음</option>${subs.map(s => `<option ${s === r.sub ? 'selected' : ''}>${A.esc(s)}</option>`).join('')}</select></div>`
        + `<div class="field"><span class="lbl">반복</span><div class="pills">${[['daily', '매일'], ['weekly', '매주'], ['monthly', '매월'], ['yearly', '매년']].map(([f, l]) => pill(r.freq === f, `data-freq="${f}"`, l)).join('')}</div></div>`
        + rep
        + `<div class="row2"><div class="field"><label for="r-start">시작일</label><input type="date" id="r-start" value="${r.start}"></div><div class="field"><label for="r-end">종료일 (선택)</label><input type="date" id="r-end" value="${r.end || ''}"></div></div>`
        + `<div class="field"><label for="r-memo">세부 메모</label><textarea id="r-memo">${A.esc(r.memo || '')}</textarea></div>`
        + `<div class="m-actions">${isNew ? '' : '<button class="btn danger" data-del>삭제</button>'}<button class="btn primary" data-save>저장</button></div>`;
    };
    const read = m => {
      const v = s => { const el = $(s, m); return el ? el.value : null; };
      r.title = v('#r-title').trim(); r.sub = v('#r-sub'); r.memo = v('#r-memo');
      r.start = v('#r-start') || r.start; r.end = v('#r-end') || '';
      if (v('#r-mday') !== null) r.mday = Number(v('#r-mday'));
      if (v('#r-nth') !== null) { r.nth = Number(v('#r-nth')); r.dow = Number(v('#r-dow')); }
      if (v('#r-month') !== null) { r.month = Number(v('#r-month')); r.day = Number(v('#r-day')); r.lunar = $('#r-lunar', m).checked; }
    };
    A.openModal(draw(), m => {
      m.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.hasAttribute('data-close')) return;
        if (b.dataset.ik) { read(m); r.itemKind = b.dataset.ik; m.innerHTML = draw(); return; }
        if (b.dataset.cat) { read(m); if (r.cat !== b.dataset.cat) { r.cat = b.dataset.cat; r.sub = ''; } m.innerHTML = draw(); return; }
        if (b.dataset.freq) { read(m); r.freq = b.dataset.freq; m.innerHTML = draw(); return; }
        if (b.dataset.mmode) { read(m); r.mmode = b.dataset.mmode; m.innerHTML = draw(); return; }
        if (b.dataset.day !== undefined) { read(m); const d = Number(b.dataset.day); r.days = (r.days || []).includes(d) ? r.days.filter(x => x !== d) : (r.days || []).concat(d); m.innerHTML = draw(); return; }
        if (b.hasAttribute('data-save')) {
          read(m);
          if (!r.title) { $('#r-title', m).focus(); return; }
          if (r.freq === 'weekly' && !(r.days || []).length) { A.toast('요일을 하나 이상 골라주세요'); return; }
          if (r.end && r.end < r.start) { A.toast('종료일이 시작일보다 빨라요'); return; }
          Store.save(r); A.closeModal(); A.render(); if (back) back(); A.toast('저장했어요');
          return;
        }
        if (b.hasAttribute('data-del')) {
          if (!confirm('이 정기업무를 삭제할까요? 달력에서 모든 반복이 사라져요.')) return;
          Store.remove(r.id); A.closeModal(); A.render();
          A.toast('삭제했어요', '되돌리기', () => { Store.restore(r.id); A.render(); });
        }
      };
    });
  }
  function parseOcc(id) { const p = id.split(':'); return { rid: p[1], k: p.slice(2).join(':') }; }
  function openOccurrence(id) {
    const { rid, k } = parseOcc(id);
    const r = Store.item(rid); if (!r) return;
    const done = !!(r.doneMap || {})[k];
    A.openModal(`<div class="m-head"><h2>${A.esc(r.title)}</h2>${A.closeBtn}</div>`
      + `<div class="hint" style="margin:-6px 0 14px;font-size:13.5px">${A.labelDate(k)} · 정기업무<br>${A.esc(ruleSummary(r))}</div>`
      + (r.memo ? `<div class="memo-view">${A.esc(r.memo)}</div>` : '')
      + (r.itemKind === 'todo' ? `<button class="btn done-btn ${done ? '' : 'primary'}" data-done>${done ? '완료 취소' : '완료로 표시'}</button>` : '')
      + `<div class="m-actions"><button class="btn" data-skip style="flex:1">이 날만 빼기</button><button class="btn" data-stop style="flex:1">이 날부터 끝내기</button></div>`
      + `<div class="m-actions"><button class="btn primary" data-edit>정기업무 전체 수정</button></div>`, m => {
      m.onclick = e => {
        if (e.target.closest('[data-done]')) { toggleOccurrence(id); A.closeModal(); A.render(); return; }
        if (e.target.closest('[data-skip]')) { r.skip = (r.skip || []).concat(k); Store.save(r); A.closeModal(); A.render(); A.toast('이 날만 뺐어요', '되돌리기', () => { r.skip = r.skip.filter(x => x !== k); Store.save(r); A.render(); }); return; }
        if (e.target.closest('[data-stop]')) {
          if (!confirm(`${A.labelDate(k)}부터 이 정기업무를 끝낼까요? 이전 기록은 그대로 남아요.`)) return;
          r.end = A.addDays(k, -1); Store.save(r); A.closeModal(); A.render(); A.toast('끝냈어요'); return;
        }
        if (e.target.closest('[data-edit]')) openRuleEdit(rid);
      };
    });
  }
  function toggleOccurrence(id) {
    const { rid, k } = parseOcc(id);
    const r = Store.item(rid); if (!r) return;
    r.doneMap = r.doneMap || {};
    if (r.doneMap[k]) delete r.doneMap[k]; else r.doneMap[k] = A.todayKey();
    Store.save(r);
    A.toast(r.doneMap[k] ? '완료했어요' : '완료를 취소했어요');
  }

  // ======================= 업무 진척 =======================
  const STATUS = ['진행', '대기', '보류', '완료'];
  let workFilter = '진행';
  function curStep(w) { return w.status === '완료' || w.status === '보류' ? null : (w.steps || []).find(s => !s.done && s.title); }
  function syncWorkTodos(w) {
    if (!w || w.deleted) return;
    const cur = curStep(w);
    const linked = Store.items().filter(i => i.kind === 'todo' && i.workId === w.id);
    linked.forEach(t => { if (!t.done && (!cur || t.stepId !== cur.id)) Store.remove(t.id); });
    if (!cur) return;
    const ex = linked.find(t => t.stepId === cur.id && !t.done);
    const date = cur.date || A.todayKey();
    if (!ex) Store.save({ kind: 'todo', title: cur.title, date, endDate: '', cat: w.cat || 'c', sub: '', memo: `업무: ${w.title}`, done: false, workId: w.id, stepId: cur.id });
    else if (ex.title !== cur.title || (cur.date && ex.date !== cur.date) || ex.memo !== `업무: ${w.title}`) { ex.title = cur.title; if (cur.date) ex.date = cur.date; ex.memo = `업무: ${w.title}`; Store.save(ex); }
  }
  function onItemSaved(it) {
    if (it.kind !== 'todo' || !it.workId) return;
    const w = Store.item(it.workId); if (!w || w.deleted) return;
    const st = (w.steps || []).find(s => s.id === it.stepId); if (!st) return;
    if (!!st.done === !!it.done && st.title === it.title && (st.date || '') === (it.date || '')) return;
    st.done = !!it.done; st.doneDate = it.done ? (it.doneDate || A.todayKey()) : '';
    st.title = it.title || st.title;
    st.date = it.date || st.date;
    if (it.done && (w.steps || []).every(s => s.done || !s.title) && w.status !== '완료') A.toast(`'${w.title}'의 모든 단계를 끝냈어요`);
    Store.save(w);
    syncWorkTodos(w);
  }
  function renderWork(view) {
    $('#title-text').textContent = '업무';
    const all = byKind('work');
    const list = all.filter(w => workFilter === '전체' || (w.status || '진행') === workFilter)
      .sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999') || a.title.localeCompare(b.title, 'ko'));
    const count = s => all.filter(w => s === '전체' || (w.status || '진행') === s).length;
    view.innerHTML = `<div class="screen"><div class="pills filter">${['진행', '대기', '보류', '완료', '전체'].map(s => pill(workFilter === s, `data-wf="${s}"`, `${s} ${count(s)}`)).join('')}</div>`
      + `<div class="wlist">${list.length ? list.map(w => {
        const steps = (w.steps || []).filter(s => s.title), done = steps.filter(s => s.done).length, cur = curStep(w);
        const pct = steps.length ? Math.round(done / steps.length * 100) : 0;
        return `<button class="wrow" data-work="${w.id}"><span class="wtop"><span class="wt">${A.esc(w.title)}</span><span class="badge s-${w.status || '진행'}">${w.status || '진행'}</span></span>`
          + `<span class="wmeta">${steps.length ? `${done}/${steps.length}단계` : '단계 없음'}${cur ? ` · 다음: ${A.esc(cur.title)}${cur.date ? ' (' + cur.date.slice(5).replace('-', '/') + ')' : ''}` : ''}${w.start || w.end ? ` · ${w.start ? w.start.slice(2).replace(/-/g, '.') : ''}~${w.end ? w.end.slice(2).replace(/-/g, '.') : ''}` : ''}</span>`
          + `<span class="bar"><span style="width:${pct}%"></span></span></button>`;
      }).join('') : `<div class="empty" style="padding:24px 4px">${workFilter === '전체' ? '아직 등록된 업무가 없어요.' : `'${workFilter}' 상태인 업무가 없어요`}</div>`}</div></div>`;
    view.onclick = e => {
      const f = e.target.closest('[data-wf]'); if (f) { workFilter = f.dataset.wf; renderWork(view); return; }
      const w = e.target.closest('[data-work]'); if (w) openWork(w.dataset.work);
    };
  }
  function openWork(id) {
    const isNew = !id;
    const uidS = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const w = isNew ? { kind: 'work', title: '', start: A.todayKey(), end: '', status: '진행', cat: 'c', steps: [{ id: uidS(), title: '', date: '', done: false }], logs: [], result: '' } : JSON.parse(JSON.stringify(Store.item(id)));
    const draw = () => `<div class="m-head"><h2>${isNew ? '새 업무' : '업무'}</h2>${A.closeBtn}</div>`
      + `<div class="field"><label for="w-title">업무명</label><input type="text" id="w-title" value="${A.esc(w.title)}" autocomplete="off"></div>`
      + `<div class="row2"><div class="field"><label for="w-start">시작</label><input type="date" id="w-start" value="${w.start || ''}"></div><div class="field"><label for="w-end">완료일 (선택)</label><input type="date" id="w-end" value="${w.end || ''}"></div></div>`
      + `<div class="field"><span class="lbl">상태</span><div class="pills">${STATUS.map(s => pill((w.status || '진행') === s, `data-st="${s}"`, s)).join('')}</div></div>`
      + `<div class="field"><span class="lbl">단계</span><div class="steps" id="w-steps">${(w.steps || []).map((s, i) => `<div class="step ${s.done ? 'done' : ''}" data-step="${s.id}"><button class="ck ${s.done ? 'on' : ''}" data-ck="${i}" aria-label="완료">${s.done ? '✓' : i + 1}</button><input type="text" class="st-title" data-i="${i}" value="${A.esc(s.title)}" autocomplete="off"><button class="st-dl" data-pick="${i}">${s.done && s.doneDate ? s.doneDate.slice(5).replace('-', '/') + ' 완료' : s.date ? s.date.slice(5).replace('-', '/') : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-label="날짜"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>'}</button><input type="date" class="st-date" data-i="${i}" value="${s.date || ''}" tabindex="-1" aria-hidden="true"><button class="st-x" data-rm="${i}" aria-label="삭제">✕</button></div>`).join('')}</div><button class="btn" data-addstep>+ 단계 추가</button></div>`
      + `<div class="field"><span class="lbl">진행 기록</span><div class="logs">${(w.logs || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map(l => `<div class="log"><span class="ld">${l.date.slice(5).replace('-', '/')}</span><span class="lx">${A.esc(l.text)}</span><button data-rmlog="${l.id}" aria-label="삭제">✕</button></div>`).join('') || '<div class="empty">기록이 없어요</div>'}</div><div class="add-sub"><input type="date" id="w-ldate" value="${A.todayKey()}" style="flex:none;width:150px"><input type="text" id="w-ltext"><button data-addlog>추가</button></div></div>`
      + `<div class="field"><label for="w-result">메모</label><textarea id="w-result">${A.esc(w.result || '')}</textarea></div>`
      + `<div class="m-actions">${isNew ? '' : '<button class="btn danger" data-del>삭제</button>'}<button class="btn primary" data-save>저장</button></div>`;
    const read = m => {
      w.title = $('#w-title', m).value.trim(); w.start = $('#w-start', m).value; w.end = $('#w-end', m).value;
      $$('.st-title', m).forEach(el => { w.steps[el.dataset.i].title = el.value.trim(); });
      $$('.st-date', m).forEach(el => { w.steps[el.dataset.i].date = el.value; });
      w.result = $('#w-result', m).value;
    };
    A.openModal(draw(), m => {
      const bindSteps = () => pressSort($('#w-steps', m), '.step[data-step]', {
        order: ids => { read(m); w.steps = ids.map(id => w.steps.find(s => s.id === id)); m.innerHTML = draw(); bindSteps(); }
      });
      bindSteps();
      m.onchange = e => { if (e.target.classList.contains('st-date')) { read(m); m.innerHTML = draw(); bindSteps(); } };
      m.onclick = e => {
        if (sortGuard()) return;
        const b = e.target.closest('button'); if (!b || b.hasAttribute('data-close')) return;
        const redraw = () => { m.innerHTML = draw(); bindSteps(); };
        if (b.dataset.st) { read(m); if (b.dataset.st === '완료' && w.status !== '완료') w.end = A.todayKey(); w.status = b.dataset.st; redraw(); return; }
        if (b.dataset.ck !== undefined) { read(m); const s = w.steps[b.dataset.ck]; s.done = !s.done; s.doneDate = s.done ? A.todayKey() : ''; redraw(); return; }
        if (b.dataset.pick !== undefined) { const el = $(`.st-date[data-i="${b.dataset.pick}"]`, m); try { el.showPicker(); } catch (_) { el.focus(); el.click(); } return; }
        if (b.dataset.rm !== undefined) { read(m); w.steps.splice(Number(b.dataset.rm), 1); redraw(); return; }
        if (b.hasAttribute('data-addstep')) { read(m); w.steps.push({ id: uidS(), title: '', date: '', done: false }); redraw(); setTimeout(() => { const ins = $$('.st-title', m); ins[ins.length - 1].focus(); }, 30); return; }
        if (b.hasAttribute('data-addlog')) { const t = $('#w-ltext', m).value.trim(); if (!t) return; read(m); w.logs = (w.logs || []).concat({ id: uidS(), date: $('#w-ldate', m).value || A.todayKey(), text: t }); redraw(); return; }
        if (b.dataset.rmlog) { read(m); w.logs = w.logs.filter(l => l.id !== b.dataset.rmlog); redraw(); return; }
        if (b.hasAttribute('data-save')) {
          read(m);
          if (!w.title) { $('#w-title', m).focus(); return; }
          w.steps = w.steps.filter(s => s.title);
          const saved = Store.save(w); syncWorkTodos(saved);
          A.closeModal(); A.render(); A.toast('저장했어요');
          return;
        }
        if (b.hasAttribute('data-del')) {
          const linked = () => Store.items().filter(i => i.kind === 'todo' && i.workId === w.id);
          A.choose(`'${w.title || '업무'}'을(를) 삭제할까요?`, [
            ['할 일까지 모두 삭제', () => { linked().forEach(i => Store.remove(i.id)); Store.remove(w.id); A.closeModal(); A.render(); A.toast('삭제했어요'); }, 'danger'],
            ['업무만 삭제 (할 일은 남김)', () => { linked().forEach(i => { i.workId = ''; i.stepId = ''; Store.save(i); }); Store.remove(w.id); A.closeModal(); A.render(); A.toast('삭제했어요'); }],
            ['취소', null]
          ]);
        }
      };
      if (isNew) setTimeout(() => $('#w-title', m).focus(), 50);
    });
  }

  // ======================= 근태 현황 =======================
  let attTab = 'leave', attYear = new Date().getFullYear();
  const isWorkday = k => { const d = A.parse(k).getDay(); return d >= 1 && d <= 5 && !Holidays.get(k); };
  const leaveAmount = t => /반반차/.test(t) ? 0.25 : /반차/.test(t) ? 0.5 : 1;
  function leaveUses(year) {
    const out = [];
    Store.items().filter(i => i.kind === 'event' && i.cat === 'k' && (i.sub === '연차' || /연차|반차/.test(i.title || ''))).forEach(i => {
      const amt = leaveAmount(i.title || '');
      let k = i.date; const last = i.endDate && i.endDate > i.date ? i.endDate : i.date;
      while (k <= last) { if (k.startsWith(year + '-') && isWorkday(k)) out.push({ k, title: i.title, amt }); k = A.addDays(k, 1); }
    });
    return out.sort((a, b) => a.k.localeCompare(b.k));
  }
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  function dayHours(k, dayItems) {
    const std = isWorkday(k) ? 8 : 0;
    let s = null, e = null;
    dayItems.forEach(it => {
      const m = /\(\s*(\d{1,2}:\d{2})?\s*~\s*(\d{1,2}:\d{2})\s*\)/.exec(it.title || '');
      if (!m) return;
      const st = toMin(m[1] || '08:30'), en = toMin(m[2]);
      s = s === null ? st : Math.min(s, st); e = e === null ? en : Math.max(e, en);
    });
    if (s === null) return { std, act: std, note: '' };
    if (e <= s) e += 24 * 60; // 자정 넘김
    let mins = e - s;
    const ov = Math.max(0, Math.min(e, 13 * 60) - Math.max(s, 12 * 60)); // 점심 12~13시 제외
    mins -= ov;
    const hh = n => `${pad2(Math.floor(n / 60) % 24)}:${pad2(n % 60)}`;
    return { std, act: mins / 60, note: `${hh(s)}~${hh(e)}` };
  }
  const pad2 = n => String(n).padStart(2, '0');
  const h1 = n => (Math.round(n * 10) / 10).toString().replace(/\.0$/, '');
  function flexReport(p) {
    const start = p.start, end = A.addDays(start, p.weeks * 7 - 1);
    const map = A.layout(start, end);
    const weeks = [];
    for (let w = 0; w < p.weeks; w++) {
      let std = 0, act = 0; const notes = [];
      for (let i = 0; i < 7; i++) {
        const k = A.addDays(start, w * 7 + i);
        const items = (map[k] || []).map(x => x.it);
        const r = dayHours(k, items);
        std += r.std; act += r.act;
        if (r.note) notes.push(`${k.slice(5).replace('-', '/')}(${WDN[A.parse(k).getDay()]}) ${r.note} → ${h1(r.act)}h`);
      }
      weeks.push({ from: A.addDays(start, w * 7), std, act, notes });
    }
    const std = weeks.reduce((a, w) => a + w.std, 0), act = weeks.reduce((a, w) => a + w.act, 0);
    return { start, end, weeks, std, act };
  }
  let flexSel = null;
  function leaveBars(uses) {
    const per = Array(12).fill(0); uses.forEach(u => { per[Number(u.k.slice(5, 7)) - 1] += u.amt; });
    const max = Math.max(1, ...per);
    return `<div class="sec-title">월별 사용</div><div class="mbars">${per.map((v, i) => `<div class="mb"><span class="mv">${v ? h1(v) : ''}</span><span class="mbar"><span style="height:${v / max * 100}%"></span></span><span class="ml">${i + 1}</span></div>`).join('')}</div>`;
  }
  function flexDetail(p, inModal) {
    const rp = flexReport(p), diff = rp.std - rp.act;
    return `<div class="${inModal ? 'm-head' : 'fx-dh'}"><h2>${rp.start.replace(/-/g, '.')} ~ ${rp.end.slice(5).replace('-', '.')} <small>${p.weeks}주</small></h2>${inModal ? A.closeBtn : ''}</div>`
      + `<table class="fx"><thead><tr><th>주</th><th>기준</th><th>근무</th><th>52h까지</th></tr></thead><tbody>${rp.weeks.map((w, i) => `<tr class="${w.act > 52 ? 'over' : ''}"><td>${i + 1}주 <small>${w.from.slice(5).replace('-', '/')}~</small></td><td>${h1(w.std)}h</td><td>${h1(w.act)}h</td><td>${w.act > 52 ? '초과 ' + h1(w.act - 52) + 'h' : h1(52 - w.act) + 'h'}</td></tr>${w.notes.length ? `<tr class="nt"><td colspan="4">${w.notes.map(A.esc).join('<br>')}</td></tr>` : ''}`).join('')}</tbody><tfoot><tr><td>합계</td><td>${h1(rp.std)}h</td><td>${h1(rp.act)}h</td><td></td></tr></tfoot></table>`
      + `<div class="fx-sum ${diff < 0 ? 'neg' : ''}">${diff >= 0 ? `평균 주 40시간 기준으로 <strong>${h1(diff)}시간</strong> 더 근무할 수 있어요` : `평균 주 40시간을 <strong>${h1(-diff)}시간</strong> 넘었어요. 남은 기간에 그만큼 단축해야 해요`}</div>`
      + `<div class="m-actions" style="margin-top:16px"><button class="btn danger" data-rmflex="${p.id}">이 주기 삭제</button></div>`;
  }
  function removeFlex(id) {
    A.confirm('이 탄력 주기를 삭제할까요?', '삭제', () => { Store.updateSettings(s => { s.flex = (s.flex || []).filter(x => x.id !== id); }); if (flexSel === id) flexSel = null; A.closeModal(); A.render(); });
  }
  function renderAttend(view) {
    $('#title-text').textContent = '근태 현황';
    const wide = innerWidth >= 900;
    const top = `<div class="att-top"><div class="pills">${pill(attTab === 'leave', 'data-tab2="leave"', '연차')}${pill(attTab === 'flex', 'data-tab2="flex"', '탄력근무')}</div><div class="yr"><button class="ib" data-yr="-1" aria-label="이전 해">‹</button><strong>${attYear}년</strong><button class="ib" data-yr="1" aria-label="다음 해">›</button></div></div>`;
    let body = '';
    if (attTab === 'leave') {
      const granted = num((S().leave || {})[attYear]);
      const uses = leaveUses(attYear);
      const used = uses.reduce((a, u) => a + u.amt, 0);
      const left = `<div class="stats"><div><span>부여</span><strong>${h1(granted)}일</strong></div><div><span>사용</span><strong>${h1(used)}일</strong></div><div><span>잔여</span><strong class="${granted - used < 0 ? 'neg' : ''}">${h1(granted - used)}일</strong></div></div>`
        + `<div class="field"><label for="lv-granted">${attYear}년 부여 연차 (일)</label><input type="text" inputmode="decimal" id="lv-granted" value="${granted || ''}"></div>`
        + leaveBars(uses);
      const right = `<div class="sec-title">사용 내역</div><div class="list">${uses.length ? uses.map(u => `<div class="lrow static"><span class="lmain"><span class="lt">${u.k.replace(/-/g, '.')} (${WDN[A.parse(u.k).getDay()]})</span><span class="ls">${A.esc(u.title)}</span></span><span class="amt">${h1(u.amt)}일</span></div>`).join('') : '<div class="empty" style="padding:12px 4px">사용 내역이 없어요</div>'}</div>`;
      body = `<div class="att-cols"><div>${left}</div><div>${right}</div></div>`;
    } else {
      const today = A.todayKey();
      const periods = (S().flex || []).filter(p => p.start.startsWith(attYear + '-') || A.addDays(p.start, p.weeks * 7 - 1).startsWith(attYear + '-'))
        .sort((a, b) => b.start.localeCompare(a.start));
      if (wide && periods.length && !periods.some(p => p.id === flexSel)) {
        const now = periods.find(p => today >= p.start && today <= A.addDays(p.start, p.weeks * 7 - 1));
        flexSel = (now || periods[0]).id;
      }
      const list = `<div class="list">${periods.length ? periods.map(p => {
        const rp = flexReport(p), diff = rp.std - rp.act, over52 = rp.weeks.some(w => w.act > 52);
        const now = today >= rp.start && today <= rp.end;
        return `<button class="lrow ${wide && p.id === flexSel ? 'sel' : ''}" data-flex="${p.id}"><span class="lmain"><span class="lt">${rp.start.slice(5).replace('-', '.')} ~ ${rp.end.slice(5).replace('-', '.')} <em>${p.weeks}주${now ? ' · 진행 중' : ''}</em></span><span class="ls">기준 ${h1(rp.std)}h · 근무 ${h1(rp.act)}h${over52 ? ' · 주 52시간 초과 주 있음' : ''}</span></span><span class="amt ${diff < 0 || over52 ? 'neg' : ''}">${diff >= 0 ? `+${h1(diff)}h 여유` : `${h1(-diff)}h 초과`}</span></button>`;
      }).join('') : `<div class="empty" style="padding:24px 4px">${attYear}년에 등록된 탄력 주기가 없어요.</div>`}</div>`;
      const sel = wide && periods.find(p => p.id === flexSel);
      body = wide ? `<div class="att-cols flex"><div>${list}</div><div class="fx-pane">${sel ? flexDetail(sel, false) : ''}</div></div>` : list;
    }
    view.innerHTML = `<div class="screen att">${top}${body}</div>`;
    view.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tab2) { attTab = b.dataset.tab2; renderAttend(view); return; }
      if (b.dataset.yr) { attYear += Number(b.dataset.yr); renderAttend(view); return; }
      if (b.dataset.rmflex) { removeFlex(b.dataset.rmflex); return; }
      if (b.dataset.flex) { if (innerWidth >= 900) { flexSel = b.dataset.flex; renderAttend(view); } else openFlex(b.dataset.flex); }
    };
    view.onchange = e => {
      if (e.target.id === 'lv-granted') { const v = num(e.target.value); Store.updateSettings(s => { s.leave = s.leave || {}; s.leave[attYear] = v; }); renderAttend(view); A.toast('저장했어요'); }
    };
  }
  function openFlex(id) {
    const p = (S().flex || []).find(x => x.id === id); if (!p) return;
    A.openModal(flexDetail(p, true), m => {
      m.onclick = e => { const b = e.target.closest('[data-rmflex]'); if (b) removeFlex(b.dataset.rmflex); };
    });
  }
  function addFlex() {
    A.openModal(`<div class="m-head"><h2>탄력 주기 추가</h2>${A.closeBtn}</div>`
      + `<div class="field"><label for="fx-date">시작 주</label><input type="date" id="fx-date" value="${A.todayKey()}"></div>`
      + `<div class="field"><label for="fx-weeks">기간</label><select id="fx-weeks">${Array.from({ length: 11 }, (_, i) => `<option value="${i + 2}">${i + 2}주</option>`).join('')}</select></div>`
      + `<div class="m-actions"><button class="btn primary" data-addflex>추가</button></div>`, m => {
      m.onclick = e => {
        if (!e.target.closest('[data-addflex]')) return;
        const start = A.mondayOf($('#fx-date', m).value || A.todayKey()), weeks = Number($('#fx-weeks', m).value);
        Store.updateSettings(s => { s.flex = (s.flex || []).concat({ id: Date.now().toString(36), start, weeks }); });
        attTab = 'flex'; attYear = Number(start.slice(0, 4));
        A.closeModal(); A.render(); A.toast(`${start.replace(/-/g, '.')}(월)부터 ${weeks}주로 등록했어요`);
      };
    });
  }
  function openAttend() { A.setScreen('attend'); }

  // ======================= 미니북 =======================
  // 미니북 한 권 = 종류 하나. 만들 때 종류를 정하고, 안에서 + 를 누르면 그 종류로 바로 쓴다.
  const COVERS = ['#2F4A6B', '#7A3533', '#2E5A4C', '#4E8E92', '#B98A6E', '#C77D93', '#5E9BC2', '#4A4744'];
  const FORMATS = { meeting: '회의록', habit: '연간 관리', free: '메모', salary: '연봉' };
  let curBook = null;
  const unlocked = new Set();
  async function hashPin(pin, id) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + ':' + id));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function withUnlock(book, fn) {
    if (!book.pinHash || unlocked.has(book.id)) { fn(); return; }
    A.openModal(`<div class="m-head"><h2>${A.esc(book.title)}</h2>${A.closeBtn}</div><div class="field"><label for="pin">잠금 번호 4자리</label><input type="password" id="pin" inputmode="numeric" maxlength="4" autocomplete="off"></div><div class="m-actions"><button class="btn primary" data-ok>열기</button></div>`, m => {
      const go = async () => { if (await hashPin($('#pin', m).value, book.id) === book.pinHash) { unlocked.add(book.id); A.closeModal(); fn(); } else { A.toast('번호가 맞지 않아요'); $('#pin', m).value = ''; } };
      m.onclick = e => { if (e.target.closest('[data-ok]')) go(); };
      $('#pin', m).onkeydown = e => { if (e.key === 'Enter') go(); };
      setTimeout(() => $('#pin', m).focus(), 50);
    });
  }
  const pagesOf = id => byKind('page').filter(p => p.bookId === id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const bookFormat = b => {
    if (b.format) return b.format;
    const p = byKind('page').find(x => x.bookId === b.id);
    return p ? (p.format === 'table' ? 'salary' : p.format) : 'free';
  };
  const booksSorted = () => byKind('book').sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.createdAt || '').localeCompare(b.createdAt || ''));

  // 예전 '표(연봉)' 페이지를 연도별 연봉 페이지로 바꿈
  function migrateSalary() {
    byKind('page').filter(p => p.format === 'table' && p.template === 'salary').forEach(p => {
      const ci = n => (p.cols || []).indexOf(n);
      (p.rows || []).forEach(r => {
        if (!r.some(v => String(v || '').trim())) return;
        const g = n => (ci(n) >= 0 ? r[ci(n)] || '' : '');
        Store.save({ kind: 'page', bookId: p.bookId, format: 'salary', year: g('연도'), company: g('회사'), rank: g('직급'), period: g('계약기간'), base: g('기본연봉'), allow: g('고정수당'), bonus: g('성과급'), gross: g('원천징수 총급여'), net: g('월 실수령액'), title: g('연도'), date: '' });
      });
      Store.remove(p.id);
    });
  }

  function renderBooks(view) {
    migrateSalary();
    const book = curBook && Store.item(curBook);
    if (book && !book.deleted) return renderBook(view, book);
    curBook = null;
    $('#title-text').textContent = '미니북';
    const books = booksSorted();
    view.innerHTML = `<div class="screen"><div class="bk-grid" id="bk-grid">${books.map(b => `<button class="bk" data-book="${b.id}"><span class="cover" style="background:${b.color}"><span class="ct">${A.esc(b.title)}</span>${b.pinHash ? '<span class="lock" aria-label="잠김"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg></span>' : ''}</span><span class="cs">${FORMATS[bookFormat(b)]}</span></button>`).join('')}<button class="bk add" data-newbook><span class="cover"><span class="ct">+ 새 미니북</span></span></button></div></div>`;
    view.onclick = e => {
      if (sortGuard()) return;
      const b = e.target.closest('[data-book]'); if (b) { const bk = Store.item(b.dataset.book); withUnlock(bk, () => { curBook = bk.id; A.render(); }); return; }
      if (e.target.closest('[data-newbook]')) openBookEdit(null);
    };
    pressSort($('#bk-grid', view), '.bk[data-book]', {
      menu: el => bookMenu(el.dataset.book),
      order: ids => { ids.forEach((id, i) => { const b = Store.item(id); if (b && b.order !== i) { b.order = i; Store.save(b); } }); }
    });
  }
  function bookMenu(id) {
    const b = Store.item(id); if (!b) return;
    A.openModal(`<div class="m-head"><h2>${A.esc(b.title)}</h2>${A.closeBtn}</div><div class="sheet"><button class="sheet-btn" data-edit>수정</button><button class="sheet-btn danger" data-del>삭제</button></div>`, m => {
      m.onclick = e => {
        if (e.target.closest('[data-edit]')) { withUnlock(b, () => openBookEdit(id)); return; }
        if (e.target.closest('[data-del]')) delBook(b);
      };
    });
  }
  function delBook(b) {
    withUnlock(b, () => A.confirm(`'${b.title}' 미니북과 안의 내용을 모두 삭제할까요?`, '삭제', () => {
      pagesOf(b.id).forEach(p => Store.remove(p.id)); Store.remove(b.id); curBook = null; A.closeModal(); A.render();
    }));
  }
  function renderBook(view, book) {
    const f = bookFormat(book);
    $('#title-text').textContent = book.title;
    let body;
    if (f === 'salary') body = salaryList(book);
    else {
      const pages = pagesOf(book.id);
      body = `<div class="list">${pages.map(p => {
        const sub = f === 'habit' ? `${p.year}년 · ${habitCount(p)}일` : (p.date ? p.date.replace(/-/g, '.') : '');
        return `<button class="lrow" data-page="${p.id}"><span class="lmain"><span class="lt">${A.esc(p.title || p.topic || '(제목 없음)')}</span>${sub ? `<span class="ls">${sub}</span>` : ''}</span></button>`;
      }).join('')}</div>`;
    }
    view.innerHTML = `<div class="screen"><div class="bk-bar"><button class="btn" data-back>‹ 미니북</button></div>${body}</div>`;
    view.onclick = e => {
      if (e.target.closest('[data-back]')) { curBook = null; A.render(); return; }
      const p = e.target.closest('[data-page]'); if (p) openPage(p.dataset.page);
    };
  }
  function newPageIn(bookId) {
    const book = Store.item(bookId); const f = bookFormat(book);
    const base = { kind: 'page', bookId, format: f, title: '', date: A.todayKey() };
    if (f === 'meeting') Object.assign(base, { place: '', people: '', topic: '', body: '', rows: [], itemId: '' });
    if (f === 'habit') Object.assign(base, { year: new Date().getFullYear(), cat: '', sub: '', word: '', checks: {} });
    if (f === 'free') Object.assign(base, { body: '', plans: [] });
    if (f === 'salary') {
      const prev = pagesOf(bookId).sort((a, b) => num(b.year) - num(a.year))[0];
      Object.assign(base, { date: '', year: String(prev ? num(prev.year) + 1 : new Date().getFullYear()), company: prev ? prev.company : '', rank: prev ? prev.rank : '', periodStart: '', periodEnd: '', base: '', allow: '', bonus: '', extras: [], gross: '', net: '' });
    }
    openPage(null, base);
  }
  function openBookEdit(id) {
    const isNew = !id;
    const b = isNew ? { kind: 'book', title: '', format: '', color: COVERS[byKind('book').length % COVERS.length], pinHash: '' } : JSON.parse(JSON.stringify(Store.item(id)));
    if (!isNew && !b.format) b.format = bookFormat(b);
    const draw = () => `<div class="m-head"><h2>${isNew ? '새 미니북' : '미니북 수정'}</h2>${A.closeBtn}</div>`
      + `<div class="field"><label for="b-title">이름</label><input type="text" id="b-title" value="${A.esc(b.title)}" autocomplete="off"></div>`
      + `<div class="field"><span class="lbl">종류</span>${isNew ? `<div class="pills">${Object.entries(FORMATS).map(([k, v]) => pill(b.format === k, `data-fmt="${k}"`, v)).join('')}</div>` : `<div class="fixed">${FORMATS[b.format]}</div>`}</div>`
      + `<div class="field"><span class="lbl">표지 색</span><div class="pills">${COVERS.map(c => `<button class="swatch ${b.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="색 ${c}"></button>`).join('')}</div></div>`
      + `<div class="field"><label for="b-pin">잠금 번호 4자리 ${b.pinHash ? '(설정됨 · 바꾸려면 새로 입력)' : '(선택)'}</label><input type="password" id="b-pin" inputmode="numeric" maxlength="4" autocomplete="new-password">${b.pinHash ? '<label class="check"><input type="checkbox" id="b-nopin">잠금 해제하기</label>' : ''}</div>`
      + `<div class="m-actions">${isNew ? '' : '<button class="btn danger" data-del>삭제</button>'}<button class="btn primary" data-save>저장</button></div>`;
    A.openModal(draw(), m => {
      m.onclick = async e => {
        const btn = e.target.closest('button'); if (!btn || btn.hasAttribute('data-close')) return;
        if (btn.dataset.color || btn.dataset.fmt) { b.title = $('#b-title', m).value; if (btn.dataset.color) b.color = btn.dataset.color; else { b.format = btn.dataset.fmt; if (!b.title.trim()) b.title = FORMATS[b.format]; } m.innerHTML = draw(); return; }
        if (btn.hasAttribute('data-save')) {
          b.title = $('#b-title', m).value.trim();
          if (!b.format) { A.toast('종류를 골라 주세요'); return; }
          if (!b.title) b.title = FORMATS[b.format];
          const pin = $('#b-pin', m).value;
          if (pin && !/^\d{4}$/.test(pin)) { A.toast('잠금 번호는 숫자 4자리예요'); return; }
          if (isNew) b.order = byKind('book').length;
          const saved = Store.save(b);
          if ($('#b-nopin', m) && $('#b-nopin', m).checked) saved.pinHash = '';
          else if (pin) { saved.pinHash = await hashPin(pin, saved.id); unlocked.add(saved.id); }
          Store.save(saved);
          A.closeModal(); A.render(); return;
        }
        if (btn.hasAttribute('data-del')) delBook(b);
      };
      if (isNew) setTimeout(() => $('#b-title', m).focus(), 50);
    });
  }

  // ---- 꾹 눌러서: 그대로 놓으면 메뉴, 끌면 순서 바꾸기 ----
  let sortedAt = 0;
  const sortGuard = () => Date.now() - sortedAt < 400;
  function pressSort(box, sel, opt) {
    if (!box) return;
    let timer = null, lifted = null, moved = false, sx = 0, sy = 0, ghost = null, offX = 0, offY = 0;
    const end = () => {
      clearTimeout(timer);
      if (!lifted) return;
      const el = lifted; lifted = null;
      el.classList.remove('lifted'); box.classList.remove('sorting');
      if (ghost) { ghost.remove(); ghost = null; }
      sortedAt = Date.now();
      if (moved) opt.order($$(sel, box).map(x => x.dataset.book || x.dataset.id || x.dataset.step));
      else if (opt.menu) opt.menu(el);
    };
    box.addEventListener('pointerdown', e => {
      const el = e.target.closest(sel); if (!el || e.button > 0) return;
      sx = e.clientX; sy = e.clientY; moved = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        lifted = el; if (navigator.vibrate) navigator.vibrate(15);
        if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
        try { getSelection().removeAllRanges(); } catch (_) {}
        el.classList.add('lifted'); box.classList.add('sorting');
        const r = el.getBoundingClientRect(); offX = sx - r.left; offY = sy - r.top;
        ghost = el.cloneNode(true); ghost.classList.add('ghost'); ghost.style.width = r.width + 'px'; ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
        document.body.appendChild(ghost);
      }, 450);
    });
    box.addEventListener('pointermove', e => {
      if (!lifted) { if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) clearTimeout(timer); return; }
      e.preventDefault();
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 6) moved = true;
      ghost.style.left = (e.clientX - offX) + 'px'; ghost.style.top = (e.clientY - offY) + 'px';
      ghost.style.display = 'none';
      const over = document.elementFromPoint(e.clientX, e.clientY);
      ghost.style.display = '';
      const tgt = over && over.closest(sel);
      if (!tgt || tgt === lifted || tgt.parentNode !== lifted.parentNode) return;
      const items = $$(sel, box);
      if (items.indexOf(tgt) > items.indexOf(lifted)) tgt.after(lifted); else tgt.before(lifted);
    });
    box.addEventListener('touchmove', e => { if (lifted) e.preventDefault(); }, { passive: false });
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', () => { clearTimeout(timer); if (lifted) { moved = true; end(); } });
    box.addEventListener('contextmenu', e => { if (e.target.closest(sel)) e.preventDefault(); });
  }

  // ---- 페이지 편집 ----
  function openPage(id, draft) {
    const src = draft || Store.item(id); if (!src) return;
    const book = Store.item(src.bookId);
    if (book && book.pinHash && !unlocked.has(book.id)) { withUnlock(book, () => openPage(id, draft)); return; }
    const p = JSON.parse(JSON.stringify(src));
    ({ meeting: editMeeting, habit: editHabit, free: editFree, salary: editSalary })[p.format](p, !id);
  }
  function pageActions(isNew) { return `<div class="m-actions">${isNew ? '' : '<button class="btn danger" data-delpage>삭제</button>'}<button class="btn primary" data-savepage>저장</button></div>`; }
  function delPage(p) {
    if (!confirm('이 페이지를 삭제할까요?')) return false;
    if (p.itemId && Store.item(p.itemId)) { const it = Store.item(p.itemId); if (it.noteId === p.id) { it.noteId = ''; Store.save(it); } }
    Store.remove(p.id); A.closeModal(); A.render(); A.toast('삭제했어요', '되돌리기', () => { Store.restore(p.id); A.render(); });
    return true;
  }
  // 회의록
  function editMeeting(p, isNew) {
    const evOpts = () => {
      const list = (A.layout(p.date, p.date)[p.date] || []).filter(x => x.it.kind === 'event' && !x.it.ruleId);
      return `<option value="">연결 안 함</option>` + list.map(x => `<option value="${x.it.id}" ${p.itemId === x.it.id ? 'selected' : ''}>${A.esc(x.it.title)}</option>`).join('')
        + (p.itemId && !list.some(x => x.it.id === p.itemId) && Store.item(p.itemId) ? `<option value="${p.itemId}" selected>${A.esc(Store.item(p.itemId).title)}</option>` : '');
    };
    const draw = () => `<div class="m-head"><h2>회의록</h2>${A.closeBtn}</div>`
      + `<div class="row2"><div class="field"><label for="p-date">날짜</label><input type="date" id="p-date" value="${p.date}"></div><div class="field"><label for="p-place">회의 장소</label><input type="text" id="p-place" value="${A.esc(p.place)}"></div></div>`
      + `<div class="field"><label for="p-people">참석자 (부서)</label><input type="text" id="p-people" value="${A.esc(p.people)}"></div>`
      + `<div class="field"><label for="p-topic">회의 주제</label><input type="text" id="p-topic" value="${A.esc(p.topic)}"></div>`
      + `<div class="field"><label for="p-item">연결할 일정 (그 날짜의 일정)</label><select id="p-item">${evOpts()}</select></div>`
      + `<div class="field"><label for="p-body">내용</label><textarea id="p-body" style="min-height:160px">${A.esc(p.body)}</textarea></div>`
      + `<div class="field"><span class="lbl">결정·협의사항</span><div class="mrows">${(p.rows || []).map((r, i) => `<div class="mrow"><div class="mrow-top"><span class="no">${i + 1}</span><input type="text" class="r-text" data-i="${i}" value="${A.esc(r.text)}" placeholder="내용"><button class="x" data-rmrow="${i}" aria-label="삭제">✕</button></div><div class="mrow-bot"><label>요청일<input type="date" class="r-req" data-i="${i}" value="${r.req || ''}"></label><label>담당<input type="text" class="r-owner" data-i="${i}" value="${A.esc(r.owner || '')}"></label><label>완료일<input type="date" class="r-done" data-i="${i}" value="${r.done || ''}"></label><label class="mine"><input type="checkbox" class="r-mine" data-i="${i}" ${r.mine ? 'checked' : ''}>내 할 일</label></div></div>`).join('')}</div><button class="btn" data-addrow>+ 항목 추가</button></div>`
      + pageActions(isNew);
    const read = m => {
      p.date = $('#p-date', m).value || p.date; p.place = $('#p-place', m).value; p.people = $('#p-people', m).value; p.topic = $('#p-topic', m).value; p.body = $('#p-body', m).value;
      p.itemId = $('#p-item', m).value; p.title = p.topic;
      $$('.r-text', m).forEach(el => { const r = p.rows[el.dataset.i]; r.text = el.value; r.req = $(`.r-req[data-i="${el.dataset.i}"]`, m).value; r.owner = $(`.r-owner[data-i="${el.dataset.i}"]`, m).value; r.done = $(`.r-done[data-i="${el.dataset.i}"]`, m).value; r.mine = $(`.r-mine[data-i="${el.dataset.i}"]`, m).checked; });
    };
    A.openModal(draw(), m => {
      m.onchange = e => { if (e.target.id === 'p-date') { read(m); m.innerHTML = draw(); } };
      m.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.hasAttribute('data-close')) return;
        if (b.hasAttribute('data-addrow')) { read(m); p.rows = (p.rows || []).concat({ text: '', req: '', owner: '', done: '', mine: false }); m.innerHTML = draw(); return; }
        if (b.dataset.rmrow !== undefined) { read(m); const r = p.rows.splice(Number(b.dataset.rmrow), 1)[0]; if (r && r.todoId && Store.item(r.todoId) && !Store.item(r.todoId).done) Store.remove(r.todoId); m.innerHTML = draw(); return; }
        if (b.hasAttribute('data-delpage')) { delPage(p); return; }
        if (b.hasAttribute('data-savepage')) {
          read(m);
          const old = id0(p) && Store.item(p.id);
          const saved = Store.save(p);
          // 일정 연결
          if (old && old.itemId && old.itemId !== saved.itemId && Store.item(old.itemId)) { const it = Store.item(old.itemId); if (it.noteId === saved.id) { it.noteId = ''; Store.save(it); } }
          if (saved.itemId && Store.item(saved.itemId)) { const it = Store.item(saved.itemId); if (it.noteId !== saved.id) { it.noteId = saved.id; Store.save(it); } }
          // 내 할 일
          (saved.rows || []).forEach(r => {
            const ex = r.todoId && Store.item(r.todoId);
            if (r.mine && r.text) {
              if (ex && !ex.deleted) { if (ex.title !== r.text || (r.req && ex.date !== r.req)) { ex.title = r.text; if (r.req) ex.date = r.req; Store.save(ex); } if (r.done && !ex.done) { ex.done = true; ex.doneDate = r.done; Store.save(ex); } }
              else { const t = Store.save({ kind: 'todo', title: r.text, date: r.req || A.todayKey(), endDate: '', cat: 'c', sub: '', memo: `회의록: ${saved.topic || ''}`, done: !!r.done, doneDate: r.done || '', noteId: saved.id }); r.todoId = t.id; }
            } else if (ex && !ex.done && !ex.deleted) { Store.remove(ex.id); r.todoId = ''; }
          });
          Store.save(saved);
          A.closeModal(); A.render(); A.toast('저장했어요');
        }
      };
    });
  }
  const id0 = p => !!p.id;
  function meetingFor(itemId) {
    const it = Store.item(itemId); if (!it) return;
    if (it.noteId && Store.item(it.noteId) && !Store.item(it.noteId).deleted) { openPage(it.noteId); return; }
    let book = booksSorted().find(b => bookFormat(b) === 'meeting');
    if (!book) book = Store.save({ kind: 'book', title: '회의록', format: 'meeting', color: COVERS[0], pinHash: '', order: byKind('book').length });
    openPage(null, { kind: 'page', bookId: book.id, format: 'meeting', title: A.splitTitle(it.title)[1], date: it.date, place: '', people: '', topic: A.splitTitle(it.title)[1], body: '', rows: [], itemId: it.id });
  }
  // 연간 관리
  const habitCount = p => { const auto = habitMatches(p); return new Set(Object.keys(auto).concat(Object.keys(p.checks || {}).filter(k => k.startsWith(p.year + '-')))).size; };
  function habitMatches(p) {
    const set = {};
    if (!p.cat && !p.word) return set;
    const s = `${p.year}-01-01`, e = `${p.year}-12-31`;
    const map = A.layout(s, e);
    Object.entries(map).forEach(([k, list]) => {
      if (list.some(x => x.it.kind === 'event' && (!p.cat || x.it.cat === p.cat) && (!p.sub || x.it.sub === p.sub) && (!p.word || (x.it.title || '').includes(p.word)))) set[k] = true;
    });
    return set;
  }
  function editHabit(p, isNew) {
    const draw = () => {
      const auto = habitMatches(p), cats = S().cats;
      const col = p.cat ? cats[p.cat].color : 'var(--accent)';
      let grid = '<div class="hgrid"><div class="hh"></div>' + Array.from({ length: 31 }, (_, i) => `<div class="hh">${i + 1}</div>`).join('');
      let total = 0;
      for (let mo = 0; mo < 12; mo++) {
        grid += `<div class="hm">${mo + 1}월</div>`;
        const n = dim(p.year, mo);
        for (let d = 1; d <= 31; d++) {
          if (d > n) { grid += '<div class="hc none"></div>'; continue; }
          const k = `${p.year}-${pad2(mo + 1)}-${pad2(d)}`;
          const on = auto[k] ? 'auto' : (p.checks || {})[k] ? 'man' : '';
          if (on) total++;
          grid += `<button class="hc ${on}" data-hk="${k}" style="${on === 'auto' ? `background:${col}` : ''}" aria-label="${mo + 1}월 ${d}일"></button>`;
        }
      }
      grid += '</div>';
      return `<div class="m-head"><h2>연간 관리</h2>${A.closeBtn}</div>`
        + `<div class="row2"><div class="field"><label for="h-title">이름</label><input type="text" id="h-title" value="${A.esc(p.title)}"></div><div class="field" style="flex:0 0 110px"><label for="h-year">연도</label><input type="number" id="h-year" value="${p.year}"></div></div>`
        + `<div class="field"><span class="lbl">달력에서 자동으로 모으기 (선택)</span><div class="row2"><select id="h-cat"><option value="">분류 전체</option>${['k', 'c', 'p'].map(c => `<option value="${c}" ${p.cat === c ? 'selected' : ''}>${A.esc(cats[c].name)}</option>`).join('')}</select><select id="h-sub"><option value="">세부 전체</option>${(p.cat ? cats[p.cat].subs : []).map(s => `<option ${p.sub === s ? 'selected' : ''}>${A.esc(s)}</option>`).join('')}</select></div><input type="text" id="h-word" value="${A.esc(p.word || '')}" placeholder="제목에 들어간 단어" style="margin-top:8px"></div>`
        + `<div class="hcount">${p.year}년 · <strong>${total}일</strong></div>${grid}` + pageActions(isNew);
    };
    const read = m => { p.title = $('#h-title', m).value; p.year = Number($('#h-year', m).value) || p.year; p.cat = $('#h-cat', m).value; p.sub = $('#h-sub', m).value; p.word = $('#h-word', m).value.trim(); };
    A.openModal(draw(), m => {
      m.onchange = e => { if (['h-year', 'h-cat', 'h-sub', 'h-word'].includes(e.target.id)) { if (e.target.id === 'h-cat') $('#h-sub', m).value = ''; read(m); m.innerHTML = draw(); } };
      m.onclick = e => {
        const c = e.target.closest('[data-hk]');
        if (c) { if (c.classList.contains('auto')) return; read(m); p.checks = p.checks || {}; if (p.checks[c.dataset.hk]) delete p.checks[c.dataset.hk]; else p.checks[c.dataset.hk] = true; m.innerHTML = draw(); return; }
        if (e.target.closest('[data-delpage]')) { delPage(p); return; }
        if (e.target.closest('[data-savepage]')) { read(m); if (!p.title) { $('#h-title', m).focus(); return; } Store.save(p); A.closeModal(); A.render(); A.toast('저장했어요'); }
      };
    });
  }
  // 프리노트
  function editFree(p, isNew) {
    const draw = () => `<div class="m-head"><h2>메모</h2>${A.closeBtn}</div>`
      + `<div class="row2"><div class="field"><label for="f2-title">제목</label><input type="text" id="f2-title" value="${A.esc(p.title)}"></div><div class="field" style="flex:0 0 160px"><label for="f2-date">날짜</label><input type="date" id="f2-date" value="${p.date}"></div></div>`
      + `<div class="field"><label for="f2-body">내용</label><textarea id="f2-body" style="min-height:200px">${A.esc(p.body)}</textarea></div>`
      + `<div class="field"><span class="lbl">향후 계획</span><div class="plans">${(p.plans || []).map((x, i) => `<div class="plan"><input type="date" class="pl-date" data-i="${i}" value="${x.date || ''}"><input type="text" class="pl-text" data-i="${i}" value="${A.esc(x.text)}" placeholder="할 일"><select class="pl-kind" data-i="${i}"><option value="todo" ${x.kind !== 'event' ? 'selected' : ''}>할 일</option><option value="event" ${x.kind === 'event' ? 'selected' : ''}>일정</option></select><button class="x" data-rmplan="${i}" aria-label="삭제">✕</button></div>`).join('')}</div><button class="btn" data-addplan>+ 계획 추가</button></div>`
      + pageActions(isNew);
    const read = m => {
      p.title = $('#f2-title', m).value; p.date = $('#f2-date', m).value || p.date; p.body = $('#f2-body', m).value;
      $$('.pl-text', m).forEach(el => { const x = p.plans[el.dataset.i]; x.text = el.value; x.date = $(`.pl-date[data-i="${el.dataset.i}"]`, m).value; x.kind = $(`.pl-kind[data-i="${el.dataset.i}"]`, m).value; });
    };
    A.openModal(draw(), m => {
      m.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.hasAttribute('data-close')) return;
        if (b.hasAttribute('data-addplan')) { read(m); p.plans = (p.plans || []).concat({ date: A.addDays(A.todayKey(), 1), text: '', kind: 'todo' }); m.innerHTML = draw(); return; }
        if (b.dataset.rmplan !== undefined) { read(m); const x = p.plans.splice(Number(b.dataset.rmplan), 1)[0]; if (x && x.itemId && Store.item(x.itemId) && !Store.item(x.itemId).done) Store.remove(x.itemId); m.innerHTML = draw(); return; }
        if (b.hasAttribute('data-delpage')) { delPage(p); return; }
        if (b.hasAttribute('data-savepage')) {
          read(m); if (!p.title) p.title = (p.body || '').split('\n')[0].slice(0, 30) || '메모';
          const saved = Store.save(p);
          (saved.plans || []).forEach(x => {
            if (!x.text || !x.date) return;
            const ex = x.itemId && Store.item(x.itemId);
            if (ex && !ex.deleted) { if (ex.title !== x.text || ex.date !== x.date || ex.kind !== x.kind) { ex.title = x.text; ex.date = x.date; ex.kind = x.kind; Store.save(ex); } }
            else { const it = Store.save({ kind: x.kind, title: x.text, date: x.date, endDate: '', cat: 'c', sub: '', memo: `메모: ${saved.title}`, done: false, noteId: saved.id }); x.itemId = it.id; }
          });
          Store.save(saved); A.closeModal(); A.render(); A.toast('저장했어요');
        }
      };
    });
  }
  // 연봉 (한 해 = 한 건, 세로로 입력)
  //   계약 총액 = 기본연봉 + 고정수당 + 성과급 / 기타 지급(하계휴가비 등)은 여러 줄 / 받은 총액 = 둘의 합
  const MONEY = ['base', 'allow', 'bonus', 'gross', 'net'];
  const LABEL = { year: '연도', company: '회사', rank: '직급', base: '기본연봉', allow: '고정수당', bonus: '성과급', gross: '원천징수 총급여', net: '월 실수령액' };
  const salContract = p => num(p.base) + num(p.allow) + num(p.bonus);
  const salExtra = p => (p.extras || []).reduce((a, x) => a + num(x.amount), 0);
  function salaryRows(bookId) {
    const list = pagesOf(bookId).filter(p => p.format === 'salary').sort((a, b) => num(a.year) - num(b.year));
    return list.map((p, i) => { const c = salContract(p), x = salExtra(p), pv = i ? salContract(list[i - 1]) : 0; return { p, contract: c, extra: x, total: c + x, raise: pv && c ? (c - pv) / pv * 100 : null }; });
  }
  function salaryChart(rows) {
    const pts = rows.filter(r => r.p.year && r.total);
    if (pts.length < 2) return '';
    const W = 560, H = 190, pad = 34, max = Math.max(...pts.map(x => x.total)) * 1.12, step = (W - pad * 2) / pts.length, bw = Math.min(56, step * 0.6);
    const ph = v => (H - 50) * v / max;
    const bars = pts.map((x, i) => { const cx = pad + step * i + step / 2, hc = ph(x.contract), hx = ph(x.extra), base = H - 28;
      return `<rect x="${cx - bw / 2}" y="${base - hc}" width="${bw}" height="${hc}" rx="2" fill="var(--chart)"/>`
        + (x.extra ? `<rect x="${cx - bw / 2}" y="${base - hc - hx}" width="${bw}" height="${hx}" rx="2" fill="var(--chart)" opacity=".45"/>` : '')
        + `<text x="${cx}" y="${H - 10}" text-anchor="middle" class="ax">${A.esc(x.p.year)}</text><text x="${cx}" y="${base - hc - hx - 6}" text-anchor="middle" class="vl">${fmt(x.total)}</text>`; }).join('');
    return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="연도별 받은 총액">${bars}<line x1="${pad / 2}" y1="${H - 28}" x2="${W - pad / 2}" y2="${H - 28}" stroke="var(--line)"/></svg></figure>`;
  }
  function salaryList(book) {
    const rows = salaryRows(book.id);
    return `<div class="sal-wrap">` + salaryChart(rows) + `<div class="list">${rows.slice().reverse().map(r => { const sub = [r.p.company, r.p.rank].filter(Boolean).join(' · ');
      const small = [r.extra ? `계약 ${fmt(r.contract)}` : '', r.raise != null ? `${r.raise >= 0 ? '+' : ''}${r.raise.toFixed(1)}%` : ''].filter(Boolean).join(' · ');
      return `<button class="lrow" data-page="${r.p.id}"><span class="lmain"><span class="lt">${A.esc(r.p.year || '연도 없음')}</span>${sub ? `<span class="ls">${A.esc(sub)}</span>` : ''}</span><span class="sal-r"><span class="amt">${r.total ? fmt(r.total) : '-'}</span>${small ? `<span class="ls">${small}</span>` : ''}</span></button>`; }).join('')}</div></div>`;
  }
  function editSalary(p, isNew) {
    p.extras = (p.extras || []).map(x => ({ name: x.name || '', month: x.month || '', amount: x.amount || '' }));
    const money = v => (num(v) ? fmt(num(v)) : (v || ''));
    const f = k => `<div class="field"><label for="s-${k}">${LABEL[k]}</label><input type="text" id="s-${k}" data-k="${k}" class="s-in" value="${A.esc(MONEY.includes(k) ? money(p[k]) : (p[k] || ''))}" ${MONEY.includes(k) || k === 'year' ? 'inputmode="numeric"' : ''} autocomplete="off"></div>`;
    const draw = () => `<div class="m-head"><h2>연봉</h2>${A.closeBtn}</div>`
      + `<div class="row2">${f('year')}<div class="field"></div></div>`
      + `<div class="field"><span class="lbl">계약기간</span><div class="row2"><input type="date" id="s-ps" value="${p.periodStart || ''}" aria-label="시작"><input type="date" id="s-pe" value="${p.periodEnd || ''}" aria-label="종료"></div></div>`
      + `<div class="row2">${f('company')}${f('rank')}</div>`
      + f('base') + `<div class="row2">${f('allow')}${f('bonus')}</div>`
      + `<div class="sal-total"><span>계약 총액</span><strong id="s-contract"></strong></div>`
      + `<div class="field"><span class="lbl">기타 지급</span><div class="ex-list">${p.extras.length ? `<div class="ex-row ex-h"><span>항목</span><span>월</span><span>금액</span><span></span></div>` : ''}${p.extras.map((x, i) => `<div class="ex-row"><input type="text" class="x-name" data-i="${i}" value="${A.esc(x.name)}" aria-label="항목" autocomplete="off"><select class="x-month" data-i="${i}" aria-label="지급 월"><option value=""></option>${Array.from({ length: 12 }, (_, j) => `<option value="${j + 1}" ${Number(x.month) === j + 1 ? 'selected' : ''}>${j + 1}월</option>`).join('')}</select><input type="text" class="x-amt" data-i="${i}" value="${A.esc(money(x.amount))}" inputmode="numeric" aria-label="금액" autocomplete="off"><button class="x" data-rmx="${i}" aria-label="삭제">✕</button></div>`).join('')}</div><button class="btn" data-addx>+ 항목 추가</button></div>`
      + (p.extras.length ? `<div class="sal-total sub"><span>기타 지급 합계</span><strong id="s-extra"></strong></div>` : '')
      + `<div class="sal-total"><span>올해 받은 총액</span><strong id="s-total"></strong></div>`
      + f('gross') + f('net') + pageActions(isNew);
    const read = m => {
      $$('.s-in', m).forEach(el => { p[el.dataset.k] = el.value.trim(); });
      p.periodStart = $('#s-ps', m).value; p.periodEnd = $('#s-pe', m).value;
      $$('.x-name', m).forEach(el => { const x = p.extras[el.dataset.i]; x.name = el.value.trim(); x.month = $(`.x-month[data-i="${el.dataset.i}"]`, m).value; x.amount = $(`.x-amt[data-i="${el.dataset.i}"]`, m).value.trim(); });
    };
    const sums = m => {
      read(m);
      const c = salContract(p), x = salExtra(p), w = v => (v ? fmt(v) + '원' : '-');
      $('#s-contract', m).textContent = w(c); if ($('#s-extra', m)) $('#s-extra', m).textContent = w(x); $('#s-total', m).textContent = w(c + x);
    };
    A.openModal(draw(), m => {
      sums(m);
      const before = JSON.stringify(p);
      m._guard = () => { if (!$('#s-year', m)) return null; read(m); return isNew || JSON.stringify(p) !== before ? '입력한 내용을 저장하지 않고 나갈까요?' : null; };
      m.oninput = e => { if (e.target.matches('.s-in, .x-amt')) sums(m); };
      m.onchange = e => { if (e.target.matches('.x-month')) read(m); };
      m.addEventListener('focusout', e => { const el = e.target; if (!el.matches) return; if ((el.matches('.s-in') && MONEY.includes(el.dataset.k)) || el.matches('.x-amt')) { if (num(el.value)) el.value = fmt(num(el.value)); } });
      m.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.hasAttribute('data-close')) return;
        if (b.hasAttribute('data-addx')) { read(m); p.extras.push({ name: '', month: '', amount: '' }); m.innerHTML = draw(); sums(m); const ins = $$('.x-name', m); ins[ins.length - 1].focus(); return; }
        if (b.dataset.rmx !== undefined) { read(m); p.extras.splice(Number(b.dataset.rmx), 1); m.innerHTML = draw(); sums(m); return; }
        if (b.hasAttribute('data-delpage')) { delPage(p); return; }
        if (b.hasAttribute('data-savepage')) {
          read(m); if (!p.year) { $('#s-year', m).focus(); return; }
          p.extras = p.extras.filter(x => x.name || num(x.amount));
          p.title = p.year; Store.save(p); A.closeModal(); A.render(); A.toast('저장했어요');
        }
      };
      if (isNew) setTimeout(() => $('#s-base', m).focus(), 50);
    });
  }

  // ======================= 가져오기·내보내기 =======================
  let ioTab = 'in';
  const download = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  function parseICS(text) {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const evs = []; let cur = null;
    const unesc = s => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    lines.forEach(line => {
      if (line === 'BEGIN:VEVENT') { cur = {}; return; }
      if (line === 'END:VEVENT') { if (cur) evs.push(cur); cur = null; return; }
      if (!cur) return;
      const i = line.indexOf(':'); if (i < 0) return;
      const left = line.slice(0, i), val = line.slice(i + 1);
      const [name, ...params] = left.split(';');
      cur[name] = { val: name === 'SUMMARY' || name === 'DESCRIPTION' ? unesc(val) : val, params: params.join(';') };
    });
    return evs;
  }
  function icsDate(v) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v || ''); if (!m) return null;
    if (!m[4]) return { k: `${m[1]}-${m[2]}-${m[3]}`, t: '' };
    let d = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
    if (m[7]) d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]));
    return { k: A.keyOf(d), t: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
  }
  function importICS(text, cat) {
    const evs = parseICS(text);
    const seen = new Set(Store.items().filter(i => i.importUid).map(i => i.importUid));
    let n = 0, r = 0, skip = 0;
    evs.forEach(ev => {
      const uidV = ev.UID && ev.UID.val;
      if (uidV && seen.has(uidV)) { skip++; return; }
      const s = ev.DTSTART && icsDate(ev.DTSTART.val); if (!s) return;
      const e = ev.DTEND && icsDate(ev.DTEND.val);
      let title = (ev.SUMMARY && ev.SUMMARY.val || '(제목 없음)').trim();
      if (s.t && !/^\d{1,2}:\d{2}/.test(title)) title = `${s.t} ${title}`;
      let end = '';
      if (e) { const last = s.t ? e.k : A.addDays(e.k, -1); if (last > s.k) end = last; }
      const memo = ev.DESCRIPTION ? ev.DESCRIPTION.val.trim() : '';
      const rr = ev.RRULE && ev.RRULE.val;
      if (rr) {
        const o = Object.fromEntries(rr.split(';').map(x => x.split('=')));
        const d = A.parse(s.k);
        const rule = { kind: 'rule', itemKind: 'event', title, cat, sub: '', memo, start: s.k, end: o.UNTIL ? (icsDate(o.UNTIL) || {}).k || '' : '', skip: [], doneMap: {}, importUid: uidV || '' };
        const map = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
        if (o.FREQ === 'DAILY') rule.freq = 'daily';
        else if (o.FREQ === 'WEEKLY') { rule.freq = 'weekly'; rule.days = o.BYDAY ? o.BYDAY.split(',').map(x => map[x.slice(-2)]) : [d.getDay()]; }
        else if (o.FREQ === 'MONTHLY') { rule.freq = 'monthly'; rule.mmode = 'day'; rule.mday = d.getDate(); }
        else if (o.FREQ === 'YEARLY') { rule.freq = 'yearly'; rule.month = d.getMonth() + 1; rule.day = d.getDate(); rule.lunar = false; }
        else return;
        Store.save(rule); r++; if (uidV) seen.add(uidV); return;
      }
      Store.save({ kind: 'event', title, date: s.k, endDate: end, cat, sub: '', memo, done: false, importUid: uidV || '' });
      if (uidV) seen.add(uidV);
      n++;
    });
    return { n, r, skip, total: evs.length };
  }
  function importText(text, cat, kind) {
    const y0 = new Date().getFullYear(); let n = 0;
    text.split('\n').forEach(line => {
      line = line.trim(); if (!line) return;
      let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?\s+(.+)$/.exec(line), y, mo, d, t;
      if (m) { [, y, mo, d, t] = m; } else { m = /^(\d{1,2})[/.](\d{1,2})\.?\s+(.+)$/.exec(line); if (!m) return; y = y0; [, mo, d, t] = m; }
      Store.save({ kind, title: t.trim(), date: `${y}-${pad2(mo)}-${pad2(d)}`, endDate: '', cat, sub: '', memo: '', done: false }); n++;
    });
    return n;
  }
  function exportData(fmtType, s, e, cats) {
    const map = A.layout(s, e), seen = new Set(), rows = [];
    Object.keys(map).sort().forEach(k => map[k].forEach(x => {
      const it = x.it;
      const key = it.kind === 'event' && !it.ruleId ? it.id : it.id + '@' + k;
      if (seen.has(key)) return; seen.add(key);
      const c = it.kind === 'todo' ? 'todo' : it.cat;
      if (!cats.includes(c)) return;
      rows.push({ it, k: it.kind === 'event' && !it.ruleId ? it.date : (it.occ || k) });
    }));
    const catName = c => (S().cats[c] || {}).name || '';
    if (fmtType === 'csv') {
      const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const out = ['날짜,종료일,종류,분류,세부 분류,제목,메모,완료'].concat(rows.map(({ it, k }) => [k, it.endDate || '', it.kind === 'todo' ? '할 일' : '일정', catName(it.cat), it.sub || '', it.title, it.memo || '', it.kind === 'todo' ? (it.done ? 'O' : '') : ''].map(q).join(',')));
      download(`내일정-${s}~${e}.csv`, '\uFEFF' + out.join('\r\n'), 'text/csv');
      return rows.length;
    }
    const esc = t => String(t || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const ymd = k => k.replace(/-/g, '');
    const fold = l => { const out = []; while (l.length > 70) { out.push(l.slice(0, 70)); l = ' ' + l.slice(70); } out.push(l); return out.join('\r\n'); };
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//my-calendar//KO', 'CALSCALE:GREGORIAN', 'X-WR-TIMEZONE:Asia/Seoul'];
    rows.forEach(({ it, k }) => {
      const [tm, tx] = A.splitTitle(it.title);
      const sum = (it.kind === 'todo' ? '[할 일] ' : '') + (tx || it.title) + (it.kind === 'todo' && it.done ? ' (완료)' : '');
      lines.push('BEGIN:VEVENT', `UID:${it.id}-${ymd(k)}@my-calendar`, `DTSTAMP:${now}`);
      if (tm && it.kind === 'event') {
        const [h, mi] = tm.split(':').map(Number);
        lines.push(`DTSTART;TZID=Asia/Seoul:${ymd(k)}T${pad2(h)}${pad2(mi)}00`, `DTEND;TZID=Asia/Seoul:${ymd(k)}T${pad2((h + 1) % 24)}${pad2(mi)}00`);
      } else {
        const last = it.kind === 'event' && !it.ruleId && it.endDate ? it.endDate : k;
        lines.push(`DTSTART;VALUE=DATE:${ymd(k)}`, `DTEND;VALUE=DATE:${ymd(A.addDays(last, 1))}`);
      }
      lines.push(fold(`SUMMARY:${esc(sum)}`));
      const desc = [catName(it.cat) + (it.sub ? ' / ' + it.sub : ''), it.memo || ''].filter(Boolean).join('\n');
      if (desc) lines.push(fold(`DESCRIPTION:${esc(desc)}`));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    download(`내일정-${s}~${e}.ics`, lines.join('\r\n'), 'text/calendar');
    return rows.length;
  }
  function openIO() {
    const y = new Date().getFullYear();
    const draw = () => {
      const head = `<div class="m-head"><h2>가져오기·내보내기</h2>${A.closeBtn}</div><div class="pills" style="margin-bottom:14px">${pill(ioTab === 'in', 'data-io="in"', '가져오기')}${pill(ioTab === 'out', 'data-io="out"', '내보내기')}</div>`;
      const catSel = id => `<select id="${id}">${['c', 'p', 'k'].map(c => `<option value="${c}">${A.esc(S().cats[c].name)}</option>`).join('')}</select>`;
      if (ioTab === 'in') return head
        + `<div class="guide"><strong>TimeBlocks 일정 옮기는 법</strong><ol><li>TimeBlocks에서 구글 캘린더를 연동해요.</li><li>PC에서 구글 캘린더 → 설정 → 가져오기/내보내기 → <b>내보내기</b>로 받은 파일(.zip)을 풀어요.</li><li>안에 있는 <b>.ics</b> 파일을 아래에서 고르면 돼요.</li></ol></div>`
        + `<div class="field"><label for="io-cat">가져온 일정의 분류</label>${catSel('io-cat')}</div>`
        + `<div class="field"><label for="io-file">.ics 파일</label><input type="file" id="io-file" accept=".ics,text/calendar"></div>`
        + `<div class="field" style="margin-top:22px"><label for="io-text">텍스트로 붙여넣기 (몇 개만 옮길 때)</label><span class="hint">한 줄에 하나씩, 날짜(2026-11-05 또는 11/5) 뒤에 제목</span><textarea id="io-text"></textarea><div class="row2"><select id="io-tkind"><option value="event">일정으로</option><option value="todo">할 일로</option></select>${catSel('io-tcat')}</div><button class="btn primary" data-intext style="margin-top:8px">붙여넣은 내용 가져오기</button></div>`;
      return head
        + `<div class="row2"><div class="field"><label for="ex-s">시작</label><input type="date" id="ex-s" value="${y}-01-01"></div><div class="field"><label for="ex-e">끝</label><input type="date" id="ex-e" value="${y}-12-31"></div></div>`
        + `<div class="field"><span class="lbl">포함할 분류</span><div class="checks">${['k', 'c', 'p'].map(c => `<label class="check"><input type="checkbox" class="ex-c" value="${c}" checked>${A.esc(S().cats[c].name)}</label>`).join('')}<label class="check"><input type="checkbox" class="ex-c" value="todo" checked>할 일</label></div></div>`
        + `<div class="m-actions"><button class="btn primary" data-ex="ics">.ics 받기 (다른 캘린더 앱용)</button></div><div class="m-actions"><button class="btn" data-ex="csv" style="flex:1">CSV 받기 (엑셀용)</button></div>`
        + ``;
    };
    A.openModal(draw(), m => {
      m.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.hasAttribute('data-close')) return;
        if (b.dataset.io) { ioTab = b.dataset.io; m.innerHTML = draw(); return; }
        if (b.hasAttribute('data-intext')) { const n = importText($('#io-text', m).value, $('#io-tcat', m).value, $('#io-tkind', m).value); A.render(); A.toast(n ? `${n}개를 가져왔어요` : '날짜를 알아볼 수 있는 줄이 없어요'); if (n) $('#io-text', m).value = ''; return; }
        if (b.dataset.ex) {
          const s = $('#ex-s', m).value, en = $('#ex-e', m).value, cats = $$('.ex-c', m).filter(x => x.checked).map(x => x.value);
          if (!s || !en || en < s) { A.toast('기간을 확인해주세요'); return; }
          const n = exportData(b.dataset.ex, s, en, cats); A.toast(`${n}개를 내보냈어요`);
        }
      };
      m.onchange = e => {
        if (e.target.id !== 'io-file') return;
        const f = e.target.files[0]; if (!f) return;
        f.text().then(t => { const r = importICS(t, $('#io-cat', m).value); A.render(); A.toast(`일정 ${r.n}개${r.r ? `, 반복 ${r.r}개` : ''}를 가져왔어요${r.skip ? ` (이미 있는 ${r.skip}개 제외)` : ''}`); }).catch(() => A.toast('파일을 읽지 못했어요'));
      };
    });
  }

  // ======================= 연결 =======================
  window.Ext = {
    init(app) {
      A = app;
      Store.updateSettings && (() => { const s = S(); if (!s.leave) s.leave = {}; if (!s.flex) s.flex = []; })();
    },
    Lunar,
    ruleEntries,
    back(sc) { if (sc === 'book' && curBook) { curBook = null; A.render(); return true; } return false; },
    renderScreen(sc, view) { view.onclick = null; if (sc === 'work') renderWork(view); else if (sc === 'book') renderBooks(view); else if (sc === 'rules') renderRules(view); else if (sc === 'attend') renderAttend(view); },
    addOnScreen(sc) { if (sc === 'rules') { openRuleEdit(null); return; } if (sc === 'attend') { if (attTab === 'flex') addFlex(); else { const el = $('#lv-granted'); if (el) el.focus(); } return; } if (sc === 'work') openWork(null); else if (sc === 'book') { const b = curBook && Store.item(curBook); if (b && !b.deleted) newPageIn(b.id); else openBookEdit(null); } },
    openOccurrence, toggleOccurrence, onItemSaved, openWork, meetingFor, openPage,
    openRules, openAttend, openIO
  };
})();
