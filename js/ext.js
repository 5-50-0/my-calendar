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
        : `<div class="empty" style="padding:24px 4px">${all.length ? '해당하는 정기업무가 없어요' : '아직 등록된 정기업무가 없어요. 오른쪽 위 + 로 추가하세요.<br>매주 회의, 월간 점검, 분기 측정, 생일(음력 포함) 같은 걸 넣으면 달력에 자동으로 표시돼요.'}</div>`}</div></div>`;
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
      + `<p class="hint" style="margin:0 0 12px;line-height:1.6">반복되는 일정·할 일·생일을 등록하면 달력에 자동으로 표시돼요. 종료일이 지나면 더 이상 나타나지 않아요.</p>`
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
          : `<div class="field"><label for="r-mday">매월 며칠</label><select id="r-mday">${Array.from({ length: 31 }, (_, i) => `<option ${Number(r.mday) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select><span class="hint">그 달에 없는 날짜(31일 등)는 말일에 표시돼요.</span></div>`);
      if (r.freq === 'yearly') rep = `<div class="row2"><div class="field"><label for="r-month">월</label><select id="r-month">${Array.from({ length: 12 }, (_, i) => `<option ${Number(r.month) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div><div class="field"><label for="r-day">일</label><select id="r-day">${Array.from({ length: 31 }, (_, i) => `<option ${Number(r.day) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div></div>`
        + `<label class="check"><input type="checkbox" id="r-lunar" ${r.lunar ? 'checked' : ''}>음력 날짜 (음력 생일 등)</label>`;
      return `<div class="m-head"><h2>${isNew ? '정기업무 추가' : '정기업무 수정'}</h2>${A.closeBtn}</div>`
        + `<div class="field"><span class="lbl">종류</span><div class="pills">${pill(r.itemKind === 'event', 'data-ik="event"', '일정')}${pill(r.itemKind === 'todo', 'data-ik="todo"', '할 일 (체크형)')}</div></div>`
        + `<div class="field"><label for="r-title">제목</label><input type="text" id="r-title" value="${A.esc(r.title)}" placeholder="예) 10:00 토양 월간 점검 / 엄마 생일" autocomplete="off"></div>`
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
    if (!!st.done === !!it.done && st.title === it.title) return;
    st.done = !!it.done; st.doneDate = it.done ? (it.doneDate || A.todayKey()) : '';
    st.title = it.title || st.title;
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
      }).join('') : `<div class="empty" style="padding:24px 4px">${workFilter === '전체' ? '아직 등록된 업무가 없어요. 오른쪽 위 + 로 추가하세요.' : `'${workFilter}' 상태인 업무가 없어요`}</div>`}</div></div>`;
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
      + `<div class="field"><label for="w-title">업무명</label><input type="text" id="w-title" value="${A.esc(w.title)}" placeholder="예) 2026 협력업체 평가" autocomplete="off"></div>`
      + `<div class="row2"><div class="field"><label for="w-start">시작</label><input type="date" id="w-start" value="${w.start || ''}"></div><div class="field"><label for="w-end">마감 (선택)</label><input type="date" id="w-end" value="${w.end || ''}"></div></div>`
      + `<div class="field"><span class="lbl">상태</span><div class="pills">${STATUS.map(s => pill((w.status || '진행') === s, `data-st="${s}"`, s)).join('')}</div></div>`
      + `<div class="field"><span class="lbl">단계 (순서대로 · 지금 단계만 달력의 할 일로 올라가요)</span><div class="steps">${(w.steps || []).map((s, i) => `<div class="step ${s.done ? 'done' : ''}"><button class="ck ${s.done ? 'on' : ''}" data-ck="${i}" aria-label="완료">${s.done ? '✓' : i + 1}</button><input type="text" class="st-title" data-i="${i}" value="${A.esc(s.title)}" placeholder="할 일"><input type="date" class="st-date" data-i="${i}" value="${s.date || ''}" aria-label="날짜 (선택)"><span class="st-btns"><button data-up="${i}" aria-label="위로">↑</button><button data-dn="${i}" aria-label="아래로">↓</button><button data-rm="${i}" aria-label="삭제">✕</button></span>${s.done && s.doneDate ? `<span class="st-done">${s.doneDate.slice(5).replace('-', '/')} 완료</span>` : ''}</div>`).join('')}</div><button class="btn" data-addstep>+ 단계 추가</button><span class="hint">날짜를 비워두면 앞 단계를 끝낸 날 할 일로 올라와요.</span></div>`
      + `<div class="field"><span class="lbl">진행 기록</span><div class="logs">${(w.logs || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map(l => `<div class="log"><span class="ld">${l.date.slice(5).replace('-', '/')}</span><span class="lx">${A.esc(l.text)}</span><button data-rmlog="${l.id}" aria-label="삭제">✕</button></div>`).join('') || '<div class="empty">기록이 없어요</div>'}</div><div class="add-sub"><input type="date" id="w-ldate" value="${A.todayKey()}" style="flex:none;width:150px"><input type="text" id="w-ltext" placeholder="예) 광주 평가 완료, 지적 2건"><button data-addlog>추가</button></div></div>`
      + `<div class="field"><label for="w-result">성과</label><textarea id="w-result" placeholder="예) 10개 업체 평가, 지적 15건 개선 완료">${A.esc(w.result || '')}</textarea></div>`
      + `<div class="m-actions">${isNew ? '' : '<button class="btn danger" data-del>삭제</button>'}<button class="btn primary" data-save>저장</button></div>`;
    const read = m => {
      w.title = $('#w-title', m).value.trim(); w.start = $('#w-start', m).value; w.end = $('#w-end', m).value;
      $$('.st-title', m).forEach(el => { w.steps[el.dataset.i].title = el.value.trim(); });
      $$('.st-date', m).forEach(el => { w.steps[el.dataset.i].date = el.value; });
      w.result = $('#w-result', m).value;
    };
    A.openModal(draw(), m => {
      m.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.hasAttribute('data-close')) return;
        const redraw = () => { m.innerHTML = draw(); };
        if (b.dataset.st) { read(m); w.status = b.dataset.st; redraw(); return; }
        if (b.dataset.ck !== undefined) { read(m); const s = w.steps[b.dataset.ck]; s.done = !s.done; s.doneDate = s.done ? A.todayKey() : ''; redraw(); return; }
        if (b.dataset.up !== undefined) { read(m); const i = Number(b.dataset.up); if (i > 0) [w.steps[i - 1], w.steps[i]] = [w.steps[i], w.steps[i - 1]]; redraw(); return; }
        if (b.dataset.dn !== undefined) { read(m); const i = Number(b.dataset.dn); if (i < w.steps.length - 1) [w.steps[i + 1], w.steps[i]] = [w.steps[i], w.steps[i + 1]]; redraw(); return; }
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
          if (!confirm('이 업무를 삭제할까요? 달력에 올라간 이 업무의 할 일도 함께 지워져요.')) return;
          Store.items().filter(i => i.workId === w.id && !i.done).forEach(i => Store.remove(i.id));
          Store.remove(w.id); A.closeModal(); A.render(); A.toast('삭제했어요');
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
  function openAttend() {
    const draw = () => {
      const head = `<div class="m-head"><h2>근태 현황</h2>${A.closeBtn}</div><div class="pills" style="margin-bottom:14px">${pill(attTab === 'leave', 'data-tab2="leave"', '연차')}${pill(attTab === 'flex', 'data-tab2="flex"', '탄력근무')}</div>`;
      if (attTab === 'leave') {
        const granted = num((S().leave || {})[attYear]);
        const uses = leaveUses(attYear);
        const used = uses.reduce((a, u) => a + u.amt, 0);
        return head + `<div class="ym-year"><button class="ib" data-yr="-1" aria-label="이전 해">‹</button><strong style="font-size:20px">${attYear}년</strong><button class="ib" data-yr="1" aria-label="다음 해">›</button></div>`
          + `<div class="stats"><div><span>부여</span><strong>${h1(granted)}일</strong></div><div><span>사용</span><strong>${h1(used)}일</strong></div><div><span>잔여</span><strong class="${granted - used < 0 ? 'neg' : ''}">${h1(granted - used)}일</strong></div></div>`
          + `<div class="field"><label for="lv-granted">${attYear}년 부여 연차 (일)</label><input type="text" inputmode="decimal" id="lv-granted" value="${granted || ''}" placeholder="예) 15"></div>`
          + `<div class="field"><span class="lbl">사용 내역</span><div class="list">${uses.length ? uses.map(u => `<div class="lrow static"><span class="lmain"><span class="lt">${u.k.replace(/-/g, '.')} (${WDN[A.parse(u.k).getDay()]})</span><span class="ls">${A.esc(u.title)}</span></span><span class="amt">${h1(u.amt)}일</span></div>`).join('') : '<div class="empty">사용 내역이 없어요</div>'}</div>`
          + `<span class="hint">근태 분류에 '연차'(세부 분류) 또는 제목에 연차·반차·반반차가 들어간 일정을 세요. 주말·공휴일은 빼고 계산해요.</span></div>`;
      }
      const periods = (S().flex || []).slice().sort((a, b) => b.start.localeCompare(a.start));
      return head + `<div class="field"><span class="lbl">새 탄력 주기</span><div class="row2"><div class="field" style="margin:0"><label for="fx-date">시작 주 (아무 날짜나 고르면 그 주 월요일로 맞춰져요)</label><input type="date" id="fx-date" value="${A.todayKey()}"></div><div class="field" style="margin:0;flex:0 0 110px"><label for="fx-weeks">기간</label><select id="fx-weeks">${Array.from({ length: 11 }, (_, i) => `<option value="${i + 2}">${i + 2}주</option>`).join('')}</select></div></div><button class="btn" data-addflex style="margin-top:8px">주기 추가</button></div>`
        + (periods.length ? periods.map(p => {
          const rp = flexReport(p), diff = rp.std - rp.act;
          return `<div class="fx-card"><div class="fx-head"><strong>${rp.start.replace(/-/g, '.')} ~ ${rp.end.slice(5).replace('-', '.')}</strong><span>${p.weeks}주</span><button class="x" data-rmflex="${p.id}" aria-label="주기 삭제">✕</button></div>`
            + `<table class="fx"><thead><tr><th>주</th><th>기준</th><th>근무</th><th>52h까지</th></tr></thead><tbody>${rp.weeks.map((w, i) => `<tr class="${w.act > 52 ? 'over' : ''}"><td>${i + 1}주 <small>${w.from.slice(5).replace('-', '/')}~</small></td><td>${h1(w.std)}h</td><td>${h1(w.act)}h</td><td>${w.act > 52 ? '초과 ' + h1(w.act - 52) + 'h' : h1(52 - w.act) + 'h'}</td></tr>${w.notes.length ? `<tr class="nt"><td colspan="4">${w.notes.map(A.esc).join('<br>')}</td></tr>` : ''}`).join('')}</tbody>`
            + `<tfoot><tr><td>합계</td><td>${h1(rp.std)}h</td><td>${h1(rp.act)}h</td><td></td></tr></tfoot></table>`
            + `<div class="fx-sum ${diff < 0 ? 'neg' : ''}">${diff >= 0 ? `평균 주 40시간 기준으로 <strong>${h1(diff)}시간</strong> 더 근무할 수 있어요` : `평균 주 40시간을 <strong>${h1(-diff)}시간</strong> 넘었어요. 남은 기간에 그만큼 단축해야 해요`}</div></div>`;
        }).join('') : '<div class="empty">등록된 탄력 주기가 없어요</div>')
        + `<p class="hint" style="line-height:1.6">일정 제목에 <b>(~21:00)</b>처럼 끝난 시각을 쓰면 08:30부터, <b>(08:30~16:00)</b>처럼 쓰면 그 시간으로 계산해요. 점심 12:00~13:00은 빼요. 평일은 기본 8시간, 주말·공휴일은 0시간이에요. 연차는 근무한 것으로 봐요.</p>`;
    };
    A.openModal(draw(), m => {
      m.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.hasAttribute('data-close')) return;
        if (b.dataset.tab2) { attTab = b.dataset.tab2; m.innerHTML = draw(); return; }
        if (b.dataset.yr) { attYear += Number(b.dataset.yr); m.innerHTML = draw(); return; }
        if (b.hasAttribute('data-addflex')) {
          const start = A.mondayOf($('#fx-date', m).value || A.todayKey()), weeks = Number($('#fx-weeks', m).value);
          Store.updateSettings(s => { s.flex = (s.flex || []).concat({ id: Date.now().toString(36), start, weeks }); });
          m.innerHTML = draw(); A.toast(`${start.replace(/-/g, '.')}(월)부터 ${weeks}주로 등록했어요`); return;
        }
        if (b.dataset.rmflex) { if (!confirm('이 탄력 주기를 지울까요?')) return; Store.updateSettings(s => { s.flex = (s.flex || []).filter(p => p.id !== b.dataset.rmflex); }); m.innerHTML = draw(); }
      };
      m.onchange = e => {
        if (e.target.id === 'lv-granted') { const v = num(e.target.value); Store.updateSettings(s => { s.leave = s.leave || {}; s.leave[attYear] = v; }); m.innerHTML = draw(); }
      };
    });
  }

  // ======================= 미니북 =======================
  const COVERS = ['#2F4A6B', '#7A3533', '#2E5A4C', '#4E8E92', '#B98A6E', '#C77D93', '#5E9BC2', '#4A4744'];
  const FORMATS = { meeting: '회의록', habit: '해빗트래커', free: '프리노트', table: '표' };
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
  function renderBooks(view) {
    const book = curBook && Store.item(curBook);
    if (book && !book.deleted) return renderBook(view, book);
    curBook = null;
    $('#title-text').textContent = '미니북';
    const books = byKind('book').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    view.innerHTML = `<div class="screen"><div class="bk-grid">${books.map(b => `<button class="bk" data-book="${b.id}"><span class="cover" style="background:${b.color}"><span class="ct">${A.esc(b.title)}</span>${b.pinHash ? '<span class="lock" aria-label="잠김"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg></span>' : ''}</span><span class="cs">${A.esc(b.sub || '')}</span><span class="cn">${pagesOf(b.id).length}쪽</span></button>`).join('')}<button class="bk add" data-newbook><span class="cover"><span class="ct">+ 새 미니북</span></span></button></div></div>`;
    view.onclick = e => {
      const b = e.target.closest('[data-book]'); if (b) { const bk = Store.item(b.dataset.book); withUnlock(bk, () => { curBook = bk.id; A.render(); }); return; }
      if (e.target.closest('[data-newbook]')) openBookEdit(null);
    };
  }
  function renderBook(view, book) {
    $('#title-text').textContent = book.title;
    const pages = pagesOf(book.id);
    view.innerHTML = `<div class="screen"><div class="bk-bar"><button class="btn" data-back>‹ 미니북</button><span style="flex:1"></span><button class="btn" data-editbook>책 설정</button></div>`
      + `<div class="list">${pages.length ? pages.map(p => `<button class="lrow" data-page="${p.id}"><span class="fmt f-${p.format}">${FORMATS[p.format]}</span><span class="lmain"><span class="lt">${A.esc(p.title || p.topic || '(제목 없음)')}</span><span class="ls">${p.date ? p.date.replace(/-/g, '.') : ''}${p.format === 'habit' ? ` · ${p.year}년` : ''}</span></span></button>`).join('') : '<div class="empty" style="padding:20px 4px">아직 페이지가 없어요. 오른쪽 위 + 로 추가하세요.</div>'}</div></div>`;
    view.onclick = e => {
      if (e.target.closest('[data-back]')) { curBook = null; A.render(); return; }
      if (e.target.closest('[data-editbook]')) { openBookEdit(book.id); return; }
      const p = e.target.closest('[data-page]'); if (p) openPage(p.dataset.page);
    };
  }
  function openBookEdit(id) {
    const isNew = !id;
    const b = isNew ? { kind: 'book', title: '', sub: '', color: COVERS[byKind('book').length % COVERS.length], pinHash: '' } : JSON.parse(JSON.stringify(Store.item(id)));
    const draw = () => `<div class="m-head"><h2>${isNew ? '새 미니북' : '책 설정'}</h2>${A.closeBtn}</div>`
      + `<div class="field"><label for="b-title">제목</label><input type="text" id="b-title" value="${A.esc(b.title)}" placeholder="예) 연봉 기록 / 회의록 / 2027 목표"></div>`
      + `<div class="field"><label for="b-sub">설명 (선택)</label><input type="text" id="b-sub" value="${A.esc(b.sub || '')}"></div>`
      + `<div class="field"><span class="lbl">표지 색</span><div class="pills">${COVERS.map(c => `<button class="swatch ${b.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="색 ${c}"></button>`).join('')}</div></div>`
      + `<div class="field"><label for="b-pin">잠금 번호 4자리 ${b.pinHash ? '(설정됨 · 바꾸려면 새로 입력, 빈칸으로 두면 유지)' : '(선택)'}</label><input type="password" id="b-pin" inputmode="numeric" maxlength="4" autocomplete="new-password">${b.pinHash ? '<label class="check"><input type="checkbox" id="b-nopin">잠금 해제하기</label>' : ''}<span class="hint">연봉처럼 민감한 내용은 잠가두세요. 번호를 잊으면 열 수 없어요.</span></div>`
      + `<div class="m-actions">${isNew ? '' : '<button class="btn danger" data-del>삭제</button>'}<button class="btn primary" data-save>저장</button></div>`;
    A.openModal(draw(), m => {
      m.onclick = async e => {
        const btn = e.target.closest('button'); if (!btn || btn.hasAttribute('data-close')) return;
        if (btn.dataset.color) { b.title = $('#b-title', m).value; b.sub = $('#b-sub', m).value; b.color = btn.dataset.color; m.innerHTML = draw(); return; }
        if (btn.hasAttribute('data-save')) {
          b.title = $('#b-title', m).value.trim(); b.sub = $('#b-sub', m).value.trim();
          if (!b.title) { $('#b-title', m).focus(); return; }
          const pin = $('#b-pin', m).value;
          if (pin && !/^\d{4}$/.test(pin)) { A.toast('잠금 번호는 숫자 4자리예요'); return; }
          const saved = Store.save(b);
          if ($('#b-nopin', m) && $('#b-nopin', m).checked) saved.pinHash = '';
          else if (pin) { saved.pinHash = await hashPin(pin, saved.id); unlocked.add(saved.id); }
          Store.save(saved);
          A.closeModal(); A.render(); return;
        }
        if (btn.hasAttribute('data-del')) {
          if (!confirm(`'${b.title}' 미니북과 안의 페이지를 모두 삭제할까요?`)) return;
          pagesOf(b.id).forEach(p => Store.remove(p.id)); Store.remove(b.id); curBook = null; A.closeModal(); A.render();
        }
      };
    });
  }
  function newPageIn(bookId) {
    A.openModal(`<div class="m-head"><h2>새 페이지</h2>${A.closeBtn}</div><div class="fmt-grid">${Object.entries(FORMATS).map(([k, v]) => `<button class="fmt-btn" data-f="${k}"><strong>${v}</strong><span>${{ meeting: '날짜·참석자·결정사항, 일정과 연결', habit: '1년 달력에 체크, 일정과 자동 연동', free: '자유 메모 + 향후 계획을 달력에', table: '연봉 추이 등 표와 그래프' }[k]}</span></button>`).join('')}</div>`, m => {
      m.onclick = e => {
        const f = e.target.closest('[data-f]'); if (!f) return;
        const base = { kind: 'page', bookId, format: f.dataset.f, title: '', date: A.todayKey() };
        if (f.dataset.f === 'meeting') Object.assign(base, { place: '', people: '', topic: '', body: '', rows: [], itemId: '' });
        if (f.dataset.f === 'habit') Object.assign(base, { title: '', year: new Date().getFullYear(), cat: '', sub: '', word: '', checks: {} });
        if (f.dataset.f === 'free') Object.assign(base, { body: '', plans: [] });
        if (f.dataset.f === 'table') Object.assign(base, salaryTemplate());
        openPage(null, base);
      };
    });
  }

  // ---- 페이지 편집 ----
  function openPage(id, draft) {
    const src = draft || Store.item(id); if (!src) return;
    const book = Store.item(src.bookId);
    if (book && book.pinHash && !unlocked.has(book.id)) { withUnlock(book, () => openPage(id, draft)); return; }
    const p = JSON.parse(JSON.stringify(src));
    ({ meeting: editMeeting, habit: editHabit, free: editFree, table: editTable })[p.format](p, !id);
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
      + `<div class="field"><label for="p-people">참석자 (부서)</label><input type="text" id="p-people" value="${A.esc(p.people)}" placeholder="예) 발전2팀 김OO, 안전환경팀"></div>`
      + `<div class="field"><label for="p-topic">회의 주제</label><input type="text" id="p-topic" value="${A.esc(p.topic)}"></div>`
      + `<div class="field"><label for="p-item">연결할 일정 (그 날짜의 일정)</label><select id="p-item">${evOpts()}</select><span class="hint">연결하면 달력에서 그 일정을 눌렀을 때 회의록으로 갈지 물어봐요.</span></div>`
      + `<div class="field"><label for="p-body">내용</label><textarea id="p-body" style="min-height:160px">${A.esc(p.body)}</textarea></div>`
      + `<div class="field"><span class="lbl">결정·협의사항</span><div class="mrows">${(p.rows || []).map((r, i) => `<div class="mrow"><div class="mrow-top"><span class="no">${i + 1}</span><input type="text" class="r-text" data-i="${i}" value="${A.esc(r.text)}" placeholder="내용"><button class="x" data-rmrow="${i}" aria-label="삭제">✕</button></div><div class="mrow-bot"><label>요청일<input type="date" class="r-req" data-i="${i}" value="${r.req || ''}"></label><label>담당<input type="text" class="r-owner" data-i="${i}" value="${A.esc(r.owner || '')}"></label><label>완료일<input type="date" class="r-done" data-i="${i}" value="${r.done || ''}"></label><label class="mine"><input type="checkbox" class="r-mine" data-i="${i}" ${r.mine ? 'checked' : ''}>내 할 일</label></div></div>`).join('')}</div><button class="btn" data-addrow>+ 항목 추가</button><span class="hint">'내 할 일'을 체크하면 요청일(없으면 오늘)에 할 일로 올라가요.</span></div>`
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
    let book = byKind('book').find(b => b.title === '회의록');
    if (!book) book = Store.save({ kind: 'book', title: '회의록', sub: '', color: COVERS[0], pinHash: '' });
    openPage(null, { kind: 'page', bookId: book.id, format: 'meeting', title: A.splitTitle(it.title)[1], date: it.date, place: '', people: '', topic: A.splitTitle(it.title)[1], body: '', rows: [], itemId: it.id });
  }
  // 해빗트래커
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
      return `<div class="m-head"><h2>해빗트래커</h2>${A.closeBtn}</div>`
        + `<div class="row2"><div class="field"><label for="h-title">이름</label><input type="text" id="h-title" value="${A.esc(p.title)}" placeholder="예) 올해 여행 / 대정비 / 운동"></div><div class="field" style="flex:0 0 110px"><label for="h-year">연도</label><input type="number" id="h-year" value="${p.year}"></div></div>`
        + `<div class="field"><span class="lbl">달력에서 자동으로 모으기 (선택)</span><div class="row2"><select id="h-cat"><option value="">분류 전체</option>${['k', 'c', 'p'].map(c => `<option value="${c}" ${p.cat === c ? 'selected' : ''}>${A.esc(cats[c].name)}</option>`).join('')}</select><select id="h-sub"><option value="">세부 전체</option>${(p.cat ? cats[p.cat].subs : []).map(s => `<option ${p.sub === s ? 'selected' : ''}>${A.esc(s)}</option>`).join('')}</select></div><input type="text" id="h-word" value="${A.esc(p.word || '')}" placeholder="제목에 들어간 단어 (예: 대정비, PT)" style="margin-top:8px"><span class="hint">조건에 맞는 일정이 있는 날은 분류 색으로 칠해져요. 칸을 눌러 직접 체크할 수도 있어요.</span></div>`
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
    const draw = () => `<div class="m-head"><h2>프리노트</h2>${A.closeBtn}</div>`
      + `<div class="row2"><div class="field"><label for="f2-title">제목</label><input type="text" id="f2-title" value="${A.esc(p.title)}"></div><div class="field" style="flex:0 0 160px"><label for="f2-date">날짜</label><input type="date" id="f2-date" value="${p.date}"></div></div>`
      + `<div class="field"><label for="f2-body">내용</label><textarea id="f2-body" style="min-height:200px">${A.esc(p.body)}</textarea></div>`
      + `<div class="field"><span class="lbl">향후 계획 (저장하면 달력에 올라가요)</span><div class="plans">${(p.plans || []).map((x, i) => `<div class="plan"><input type="date" class="pl-date" data-i="${i}" value="${x.date || ''}"><input type="text" class="pl-text" data-i="${i}" value="${A.esc(x.text)}" placeholder="할 일"><select class="pl-kind" data-i="${i}"><option value="todo" ${x.kind !== 'event' ? 'selected' : ''}>할 일</option><option value="event" ${x.kind === 'event' ? 'selected' : ''}>일정</option></select><button class="x" data-rmplan="${i}" aria-label="삭제">✕</button></div>`).join('')}</div><button class="btn" data-addplan>+ 계획 추가</button></div>`
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
  // 표 (연봉 등)
  function salaryTemplate() {
    return { title: '연봉 추이', template: 'salary', cols: ['연도', '회사', '직급', '계약기간', '기본연봉', '고정수당', '성과급', '총액', '인상률', '원천징수 총급여', '월 실수령액'], rows: [['', '', '', '', '', '', '', '', '', '', '']] };
  }
  function salaryCalc(p) {
    if (p.template !== 'salary') return p.rows;
    const ci = n => p.cols.indexOf(n);
    const rows = p.rows.map(r => r.slice());
    rows.forEach(r => { const t = num(r[ci('기본연봉')]) + num(r[ci('고정수당')]) + num(r[ci('성과급')]); r[ci('총액')] = t ? fmt(t) : ''; });
    const order = rows.map((r, i) => i).sort((a, b) => num(rows[a][0]) - num(rows[b][0]));
    order.forEach((idx, j) => {
      const r = rows[idx];
      if (j === 0) { r[ci('인상률')] = ''; return; }
      const prev = num(rows[order[j - 1]][ci('총액')]), cur = num(r[ci('총액')]);
      r[ci('인상률')] = prev && cur ? `${((cur - prev) / prev * 100).toFixed(1)}%` : '';
    });
    return rows;
  }
  function salaryChart(p, rows) {
    if (p.template !== 'salary') return '';
    const ci = p.cols.indexOf('총액');
    const pts = rows.map(r => ({ y: r[0], v: num(r[ci]) })).filter(x => x.y && x.v).sort((a, b) => num(a.y) - num(b.y));
    if (pts.length < 2) return '<p class="hint">연도와 금액을 두 해 이상 넣으면 추이 그래프가 나와요.</p>';
    const W = 560, H = 190, pad = 34, max = Math.max(...pts.map(x => x.v)) * 1.12, bw = Math.min(56, (W - pad * 2) / pts.length * 0.6);
    const step = (W - pad * 2) / pts.length;
    const bars = pts.map((x, i) => { const h = (H - 50) * x.v / max, cx = pad + step * i + step / 2; return `<rect x="${cx - bw / 2}" y="${H - 28 - h}" width="${bw}" height="${h}" rx="3" fill="var(--chart)"/><text x="${cx}" y="${H - 10}" text-anchor="middle" class="ax">${A.esc(x.y)}</text><text x="${cx}" y="${H - 34 - h}" text-anchor="middle" class="vl">${fmt(x.v)}</text>`; }).join('');
    return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="연도별 총액 추이">${bars}<line x1="${pad / 2}" y1="${H - 28}" x2="${W - pad / 2}" y2="${H - 28}" stroke="var(--line)"/></svg><figcaption>연도별 총액</figcaption></figure>`;
  }
  function editTable(p, isNew) {
    const auto = new Set(p.template === 'salary' ? ['총액', '인상률'] : []);
    const draw = () => {
      const rows = salaryCalc(p);
      return `<div class="m-head"><h2>표</h2>${A.closeBtn}</div>`
        + `<div class="field"><label for="t-title">제목</label><input type="text" id="t-title" value="${A.esc(p.title)}"></div>`
        + `<div id="t-chart">${salaryChart(p, rows)}</div>`
        + `<div class="tbl-wrap"><table class="tbl"><thead><tr>${p.cols.map((c, j) => `<th>${p.template === 'salary' ? A.esc(c) : `<input type="text" class="t-col" data-j="${j}" value="${A.esc(c)}">`}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((r, i) => `<tr>${p.cols.map((c, j) => auto.has(c) ? `<td class="auto" data-a="${i}-${j}">${A.esc(r[j] || '')}</td>` : `<td><input type="text" class="t-cell" data-i="${i}" data-j="${j}" value="${A.esc(p.rows[i][j] || '')}" ${/연봉|수당|성과급|급여|실수령/.test(c) ? 'inputmode="numeric"' : ''}></td>`).join('')}<td><button class="x" data-rmr="${i}" aria-label="행 삭제">✕</button></td></tr>`).join('')}</tbody></table></div>`
        + `<div class="m-actions" style="margin-bottom:10px"><button class="btn" data-addr>+ 행 추가</button>${p.template === 'salary' ? '' : '<button class="btn" data-addc>+ 열 추가</button>'}</div>`
        + (p.template === 'salary' ? '<p class="hint">금액은 원 단위 숫자로 넣으세요(쉼표는 있어도 돼요). 총액과 인상률은 자동으로 계산돼요.</p>' : '')
        + (isNew ? `<div class="field"><span class="lbl">양식</span><div class="pills">${pill(p.template === 'salary', 'data-tpl="salary"', '연봉 양식')}${pill(p.template !== 'salary', 'data-tpl="custom"', '빈 표')}</div></div>` : '')
        + pageActions(isNew);
    };
    const read = m => {
      p.title = $('#t-title', m).value;
      $$('.t-col', m).forEach(el => { p.cols[el.dataset.j] = el.value; });
      $$('.t-cell', m).forEach(el => { p.rows[el.dataset.i][el.dataset.j] = el.value; });
    };
    A.openModal(draw(), m => {
      // 입력 중에는 화면을 다시 그리지 않고 자동 계산 칸과 그래프만 바꾼다 (포커스 유지)
      m.oninput = e => {
        if (!e.target.classList.contains('t-cell') || p.template !== 'salary') return;
        read(m);
        const rows = salaryCalc(p);
        $$('td.auto', m).forEach(td => { const [i, j] = td.dataset.a.split('-').map(Number); td.textContent = (rows[i] || [])[j] || ''; });
        $('#t-chart', m).innerHTML = salaryChart(p, rows);
      };
      m.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.hasAttribute('data-close')) return;
        if (b.hasAttribute('data-addr')) { read(m); p.rows.push(p.cols.map(() => '')); m.innerHTML = draw(); return; }
        if (b.hasAttribute('data-addc')) { read(m); p.cols.push('새 열'); p.rows.forEach(r => r.push('')); m.innerHTML = draw(); return; }
        if (b.dataset.rmr !== undefined) { read(m); p.rows.splice(Number(b.dataset.rmr), 1); if (!p.rows.length) p.rows.push(p.cols.map(() => '')); m.innerHTML = draw(); return; }
        if (b.dataset.tpl) { if (b.dataset.tpl === 'salary') Object.assign(p, salaryTemplate()); else Object.assign(p, { title: '', template: 'custom', cols: ['항목', '값'], rows: [['', '']] }); auto.clear(); if (p.template === 'salary') { auto.add('총액'); auto.add('인상률'); } m.innerHTML = draw(); return; }
        if (b.hasAttribute('data-delpage')) { delPage(p); return; }
        if (b.hasAttribute('data-savepage')) { read(m); if (!p.title) p.title = '표'; const rows = salaryCalc(p); if (p.template === 'salary') p.rows = rows; Store.save(p); A.closeModal(); A.render(); A.toast('저장했어요'); }
      };
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
        + `<div class="field"><label for="io-cat">가져온 일정의 분류</label>${catSel('io-cat')}<span class="hint">가져온 뒤 일정마다 분류를 바꿀 수 있어요. 같은 파일을 두 번 가져와도 겹치지 않아요.</span></div>`
        + `<div class="field"><label for="io-file">.ics 파일</label><input type="file" id="io-file" accept=".ics,text/calendar"></div>`
        + `<div class="field" style="margin-top:22px"><label for="io-text">텍스트로 붙여넣기 (몇 개만 옮길 때)</label><textarea id="io-text" placeholder="한 줄에 하나씩&#10;2026-11-05 14:00 방지시설 점검&#10;11/12 BCK 업무협의"></textarea><div class="row2"><select id="io-tkind"><option value="event">일정으로</option><option value="todo">할 일로</option></select>${catSel('io-tcat')}</div><button class="btn primary" data-intext style="margin-top:8px">붙여넣은 내용 가져오기</button></div>`;
      return head
        + `<div class="row2"><div class="field"><label for="ex-s">시작</label><input type="date" id="ex-s" value="${y}-01-01"></div><div class="field"><label for="ex-e">끝</label><input type="date" id="ex-e" value="${y}-12-31"></div></div>`
        + `<div class="field"><span class="lbl">포함할 분류</span><div class="checks">${['k', 'c', 'p'].map(c => `<label class="check"><input type="checkbox" class="ex-c" value="${c}" checked>${A.esc(S().cats[c].name)}</label>`).join('')}<label class="check"><input type="checkbox" class="ex-c" value="todo" checked>할 일</label></div></div>`
        + `<div class="m-actions"><button class="btn primary" data-ex="ics">.ics 받기 (다른 캘린더 앱용)</button></div><div class="m-actions"><button class="btn" data-ex="csv" style="flex:1">CSV 받기 (엑셀용)</button></div>`
        + `<p class="hint" style="line-height:1.6">.ics는 구글·삼성·애플 캘린더에서 가져올 수 있어요. 할 일은 '[할 일]'이 붙은 종일 일정으로 들어가요. 정기업무는 기간 안의 날짜마다 하나씩 들어가요.</p>`;
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
    renderScreen(sc, view) { view.onclick = null; if (sc === 'work') renderWork(view); else if (sc === 'book') renderBooks(view); else if (sc === 'rules') renderRules(view); },
    addOnScreen(sc) { if (sc === 'rules') { openRuleEdit(null); return; } if (sc === 'work') openWork(null); else if (sc === 'book') { const b = curBook && Store.item(curBook); if (b && !b.deleted) newPageIn(b.id); else openBookEdit(null); } },
    openOccurrence, toggleOccurrence, onItemSaved, openWork, meetingFor, openPage,
    openRules, openAttend, openIO
  };
})();
