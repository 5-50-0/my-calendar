// 대한민국 공휴일 계산 (그 당시 기준)
// 1949년 이전은 공휴일 없음. 음력 날짜는 lunar-data.js 참고.
(function () {
  const cache = {};
  const pad = n => String(n).padStart(2, '0');
  const k = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const shift = (key, days) => {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    return k(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  };
  const dow = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

  // 선거일·임시공휴일 (확정된 것만)
  const EXTRA = {
    '2017-05-09': '대통령선거일', '2017-10-02': '임시공휴일', '2018-06-13': '지방선거일',
    '2020-04-15': '국회의원선거일', '2020-08-17': '임시공휴일', '2022-03-09': '대통령선거일',
    '2022-06-01': '지방선거일', '2023-10-02': '임시공휴일', '2024-04-10': '국회의원선거일',
    '2024-10-01': '임시공휴일', '2025-01-27': '임시공휴일', '2025-06-03': '대통령선거일',
    '2026-06-03': '지방선거일'
  };

  function build(y) {
    const H = {};
    const add = (key, name) => { (H[key] = H[key] || []).push(name); };
    if (y < 1949) return H;

    // 신정
    add(k(y, 1, 1), '신정');
    if (y <= 1998) add(k(y, 1, 2), '신정 연휴');
    if (y <= 1989) add(k(y, 1, 3), '신정 연휴');

    const L = (window.LUNAR_HOL[y] || '').split(',');
    const lunar = s => s ? k(y, Number(s.slice(0, 2)), Number(s.slice(2))) : null;
    const seol = lunar(L[0]), buddha = lunar(L[1]), chuseok = lunar(L[2]);

    // 설날
    const seolDays = [];
    if (seol && y >= 1989) { seolDays.push(shift(seol, -1), seol, shift(seol, 1)); add(seolDays[0], '설날 연휴'); add(seol, '설날'); add(seolDays[2], '설날 연휴'); }
    else if (seol && y >= 1985) add(seol, '민속의 날');

    add(k(y, 3, 1), '삼일절');
    if (y <= 2005 && y !== 1960) add(k(y, 4, 5), '식목일');
    if (y >= 2026) add(k(y, 5, 1), '노동절');
    if (y >= 1975) add(k(y, 5, 5), '어린이날');
    if (buddha && y >= 1975) add(buddha, '부처님 오신 날');
    if (y >= 1956) add(k(y, 6, 6), '현충일');
    if (y <= 2007 || y >= 2026) add(k(y, 7, 17), '제헌절');
    add(k(y, 8, 15), '광복절');

    // 추석
    const chuDays = [];
    if (chuseok && y >= 1989) { chuDays.push(shift(chuseok, -1), chuseok, shift(chuseok, 1)); add(chuDays[0], '추석 연휴'); add(chuseok, '추석'); add(chuDays[2], '추석 연휴'); }
    else if (chuseok && y >= 1986) { add(shift(chuseok, -1), '추석 연휴'); add(chuseok, '추석'); }
    else if (chuseok) add(chuseok, '추석');

    if (y >= 1956 && y <= 1990) add(k(y, 10, 1), '국군의 날');
    add(k(y, 10, 3), '개천절');
    if (y <= 1990 || y >= 2013) add(k(y, 10, 9), '한글날');
    if (y >= 1950 && y <= 1975) add(k(y, 10, 24), '국제연합일');
    add(k(y, 12, 25), '성탄절');

    Object.keys(EXTRA).forEach(key => { if (key.startsWith(y + '-')) add(key, EXTRA[key]); });

    // 대체공휴일
    if (y >= 2014) {
      const isOff = key => !!H[key] || dow(key) === 0 || dow(key) === 6;
      const nextFree = key => { let c = shift(key, 1); while (isOff(c)) c = shift(c, 1); return c; };
      const subs = [];
      const addSub = (from, name) => { const s = nextFree(from); add(s, `대체공휴일(${name})`); subs.push(s); };
      // 설·추석: 일요일 또는 다른 공휴일과 겹칠 때
      [[seolDays, '설날'], [chuDays, '추석']].forEach(([days, name]) => {
        if (!days.length) return;
        let n = 0;
        days.forEach(d => { if (dow(d) === 0 || H[d].length > 1) n++; });
        let last = days[2];
        for (let i = 0; i < n; i++) { const s = nextFree(last); add(s, `대체공휴일(${name})`); last = s; }
      });
      // 토·일요일 또는 다른 공휴일과 겹칠 때
      // 어린이날만 다른 공휴일과 겹쳐도 대체, 나머지는 토·일요일과 겹칠 때만 (설·추석과 겹치면 위 규칙이 처리)
      const weekendRule = (key, name, from) => {
        if (y < from || !H[key]) return;
        const overlap = name === '어린이날' && H[key].filter(n => !n.startsWith('대체')).length > 1;
        if (dow(key) === 0 || dow(key) === 6 || overlap) addSub(key, name);
      };
      weekendRule(k(y, 5, 5), '어린이날', 2014);
      weekendRule(k(y, 3, 1), '삼일절', 2022);
      weekendRule(k(y, 8, 15), '광복절', 2021);
      weekendRule(k(y, 10, 3), '개천절', 2021);
      weekendRule(k(y, 10, 9), '한글날', 2021);
      if (buddha) weekendRule(buddha, '부처님 오신 날', 2023);
      weekendRule(k(y, 12, 25), '성탄절', 2023);
      weekendRule(k(y, 7, 17), '제헌절', 2026);
    }
    return H;
  }

  window.Holidays = {
    // 'YYYY-MM-DD' → 공휴일 이름 배열 (없으면 null)
    get(key) {
      const y = Number(key.slice(0, 4));
      if (!cache[y]) cache[y] = build(y);
      return cache[y][key] || null;
    },
    year(y) { if (!cache[y]) cache[y] = build(y); return cache[y]; }
  };
})();
