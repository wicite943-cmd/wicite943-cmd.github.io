/* 바탕달력 Ver2 — 화면: 스케두 디자인 / 동작: CalendarTask 방식 */
(async function () {
  const R = window.Recur;
  const $ = s => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const api = window.api || makeMock();
  const WEB = !!window.WEB;   // 아이패드 웹앱 (web/webapi.js) — 늘 편집 상태, 터치 조작
  const EDITOR = location.hash === '#editor';      // 입력 전용 창
  if (EDITOR) document.body.classList.add('editor');
  if (location.hash === '#solid') document.body.classList.add('solid');
  const PRINT = location.hash === '#print';         // 공유 폴더 PDF용 화면
  if (PRINT) document.body.classList.add('print');
  let changed = false;
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  // 스케두(구글 캘린더) 색상표
  const PALETTE = [['#7986CB', '라벤더'], ['#33B679', '세이지'], ['#8E24AA', '포도'], ['#E67C73', '홍학'], ['#F6BF26', '바나나'], ['#F4511E', '귤'],
    ['#039BE5', '공작'], ['#616161', '흑연'], ['#3F51B5', '블루베리'], ['#0B8043', '바질'], ['#D50000', '토마토']];

  let D = await api.getData();
  let S = D.settings;
  // PDF용: 저장된 설정은 건드리지 않고 이 화면에서만 — 밝은 테마, 불투명, 사이드바 '주' 목록
  if (PRINT) S = { ...S, dark: false, bgOpacity: 100, showSidebar: true, sidePanelType: '주' };
  const now = new Date();
  let cur = { y: now.getFullYear(), m: now.getMonth() };
  let mode = 'background';            // background | quick | edit
  if (WEB) { mode = 'edit'; document.body.classList.add('editing', 'web'); }
  let iconMode = false, selIcon = null, selDate = null;
  let sideDate = R.parseYmd(R.ymd(now));
  const occOf = new WeakMap();

  /* ───────── 설정 반영 ───────── */
  function applySettings() {
    document.documentElement.classList.toggle('dark', !!S.dark);
    document.documentElement.style.setProperty('--a', (S.bgOpacity / 100).toFixed(2));
    document.body.classList.toggle('locked', !!S.locked);
    $('#btn-pin').classList.toggle('on', !!S.locked);
    $('#btn-pin').title = S.locked ? '고정 해제' : '위치 고정';
    $('#btn-side').classList.toggle('on', !!S.showSidebar);
    $('#side').hidden = !S.showSidebar;
    $('#opacity').value = S.bgOpacity;
    $('#side-type').value = S.sidePanelType || '일';
  }
  async function setS(name, value) { S[name] = value; applySettings(); const r = await api.setSetting(name, value); if (r) Object.assign(S, r); }

  const calOf = id => D.calendars.find(c => c.id === id) || D.calendars[0] || { color: '#7986CB', name: '캘린더' };
  const colorOf = ev => ev.color || calOf(ev.calendarId).color;
  // 보기 방식: month(한 달) / rolling(5주: 이번 주가 항상 2번째 줄 — 지난주 1줄 + 이번 주 + 다음 3주)
  const ROLL_BEFORE = 1;   // 이번 주 위에 보여줄 지난 주 수
  let rollOff = 0;   // 5주 보기에서 이번 주로부터 몇 주 이동했는지
  const rolling = () => S.viewMode === 'rolling';
  const weekStartOf = d => R.addDays(R.parseYmd(R.ymd(d)), -((d.getDay() - S.weekStart + 7) % 7));
  const anchorWeek = () => R.addDays(weekStartOf(new Date()), rollOff * 7);
  const monthKey = () => { if (rolling()) { const a = R.addDays(anchorWeek(), 3); return `${a.getFullYear()}-${R.pad(a.getMonth() + 1)}`; } return `${cur.y}-${R.pad(cur.m + 1)}`; };
  const isBlock = o => o.event.allDay || o.start !== o.end;
  function fmtT(t) { if (!t) return ''; const [h, m] = t.split(':').map(Number); const ap = h < 12 ? '오전' : '오후'; const hh = h % 12 || 12; return m ? `${ap} ${hh}:${R.pad(m)}` : `${ap} ${hh}시`; }
  function isPast(o) {
    const t = R.ymd(new Date());
    if (o.end < t) return true;
    if (o.end === t && !o.event.allDay) { const n = new Date(); return R.timeOf(o.event.end) <= `${R.pad(n.getHours())}:${R.pad(n.getMinutes())}`; }
    return false;
  }
  // 같은 날 일정 순서 (사용자가 정한 order가 있으면 우선)
  function ordCmp(a, b) { const x = a.event.order, y = b.event.order; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return x - y; }
  const spanOf = o => R.dayDiff(R.parseYmd(o.start), R.parseYmd(o.end));
  // 그날 순서를 바꿀 수 있는 묶음: 그날 시작하는 종일·여러 날 일정 / 시간 일정
  function dayGroup(k, o) {
    const d = R.parseYmd(k);
    const all = R.occurrences(visibleEvents(), d, d);
    if (isBlock(o)) return all.filter(x => isBlock(x) && x.start === k).sort((a, b) => ordCmp(a, b) || spanOf(b) - spanOf(a));
    return all.filter(x => !isBlock(x)).sort((a, b) => ordCmp(a, b) || ((a.time || '') < (b.time || '') ? -1 : 1));
  }
  async function moveOrder(o, dir, toIdx) {
    const k = o.start, g = dayGroup(k, o);
    const i = g.findIndex(x => x.event.id === o.event.id);
    if (i < 0) return;
    if (g.length < 2) { toast('같은 날 일정이 하나뿐이에요.'); return; }
    let j = toIdx !== undefined ? toIdx : dir === 'top' ? 0 : dir === 'bottom' ? g.length - 1 : dir === 'up' ? i - 1 : i + 1;
    j = Math.max(0, Math.min(g.length - 1, j));
    if (j === i) return;
    const [it] = g.splice(i, 1); g.splice(j, 0, it);
    const map = {}; g.forEach((x, n) => { map[x.event.id] = n * 10; });
    D.events = await api.setOrders(map); changed = true;
    render(); if (!$('#ev-modal').hidden) paintOrder();
  }
  function paintOrder() {
    if (!editing) { $('#order-row').hidden = true; return; }
    const o = editing.occ, g = dayGroup(o.start, o), i = g.findIndex(x => x.event.id === o.event.id);
    $('#order-row').hidden = g.length < 2 || i < 0;
    $('#ord-pos').textContent = i >= 0 ? `${i + 1} / ${g.length}번째` : '';
  }
  document.querySelectorAll('.ord button').forEach(b => b.onclick = () => editing && moveOrder(editing.occ, b.dataset.dir));
  const visibleEvents = () => D.events.filter(e => !calOf(e.calendarId).hidden);

  /* ───────── 달력 ───────── */
  function gridRange() {
    if (rolling()) { const start = R.addDays(anchorWeek(), -7 * ROLL_BEFORE); return { start, end: R.addDays(start, 34), rows: 5 }; }
    const first = new Date(cur.y, cur.m, 1);
    const off = (first.getDay() - S.weekStart + 7) % 7;
    const days = new Date(cur.y, cur.m + 1, 0).getDate();
    const rows = Math.ceil((off + days) / 7);
    const start = R.addDays(first, -off);
    return { start, end: R.addDays(start, rows * 7 - 1), rows };
  }

  function render() {
    renderDdays();   // D-day 줄을 먼저 그려야 달력 칸 높이·막대 제목 위치가 맞음
    if (rolling()) {
      const a = R.addDays(anchorWeek(), -7 * ROLL_BEFORE), z = R.addDays(a, 34);
      // 짧게: 같은 해(올해)면 '10월 4일 ~ 11월 7일', 해가 다르면 '2026.12.27 ~ 2027.1.30'
      const ty = new Date().getFullYear();
      $('#title').textContent = a.getFullYear() === z.getFullYear() && a.getFullYear() === ty
        ? `${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${z.getMonth() + 1}월 ${z.getDate()}일`
        : a.getFullYear() === z.getFullYear() ? `${a.getFullYear()}년 ${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${z.getMonth() + 1}월 ${z.getDate()}일`
        : `${a.getFullYear()}.${a.getMonth() + 1}.${a.getDate()} ~ ${z.getFullYear()}.${z.getMonth() + 1}.${z.getDate()}`;
      $('#title').title = `${a.getFullYear()}년 ${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${z.getFullYear()}년 ${z.getMonth() + 1}월 ${z.getDate()}일 (누르면 오늘로)`;
    } else $('#title').textContent = `${cur.y}년 ${cur.m + 1}월`;
    document.querySelectorAll('#vm button').forEach(b => b.classList.toggle('on', b.dataset.v === (S.viewMode || 'month')));
    // 오늘이 화면에 없으면 '오늘' 버튼을 파랗게 강조
    { const t = new Date(), g = gridRange(); $('#today').classList.toggle('away', R.ymd(t) < R.ymd(g.start) || R.ymd(t) > R.ymd(g.end) || (!rolling() && (t.getMonth() !== cur.m || t.getFullYear() !== cur.y))); }
    const wd = $('#weekdays'); wd.innerHTML = '';
    for (let i = 0; i < 7; i++) { const d = (i + S.weekStart) % 7; wd.appendChild(el('div', d === 0 ? 'sun' : d === 6 ? 'sat' : '', WD[d])); }

    const { start, end, rows } = gridRange();
    const grid = $('#grid'); grid.innerHTML = '';
    grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    const occAll = R.occurrences(visibleEvents(), start, end);
    // 휴일로 지정한 일정: 막대로 그리지 않고 날짜 옆 빨간 이름으로 표시
    const customHol = {};
    for (const o of occAll) if (o.event.holiday) for (let d = R.parseYmd(o.start); d <= R.parseYmd(o.end); d = R.addDays(d, 1)) customHol[R.ymd(d)] = customHol[R.ymd(d)] || o;
    const occ = occAll.filter(o => !o.event.holiday);
    const todayKey = R.ymd(new Date());
    // 못 끝낸 일정 (지난 30일, 한 번짜리, 체크 안 함) → 오늘 칸으로 넘겨 보이기
    const since = R.ymd(R.addDays(new Date(), -30));
    const missed = S.missCarry === false ? [] : visibleEvents().filter(e => !R.isRepeat(e) && !e.done && !e.holiday)
      .map(e => ({ event: e, start: e.start.slice(0, 10), end: (e.end || e.start).slice(0, 10), time: e.allDay ? '' : R.timeOf(e.start) }))
      .filter(o => o.end < todayKey && o.end >= since).sort((a, b) => a.start < b.start ? -1 : 1);
    const cellH = (grid.clientHeight - (rows - 1)) / rows;
    const fit = Math.max(0, Math.floor((cellH - 4 - (WEB ? 30 : 28)) / (WEB ? 23 : 19.7)));   // 칸이 너무 낮으면 0줄 (개수만 표시) · 웹(터치)은 줄이 더 높음

    for (let w = 0; w < rows; w++) {
      const ws = R.addDays(start, w * 7), we = R.addDays(ws, 6);
      const wsKey = R.ymd(ws), weKey = R.ymd(we);
      // 여러 날·종일 일정: 주 단위로 줄(lane) 배정 → 막대가 칸을 이어서 보이게
      const segs = occ.filter(o => isBlock(o) && o.end >= wsKey && o.start <= weKey).map(o => ({
        o, s: Math.max(0, R.dayDiff(ws, R.parseYmd(o.start))), e: Math.min(6, R.dayDiff(ws, R.parseYmd(o.end))),
      })).sort((a, b) => a.s - b.s || (a.o.start < b.o.start ? -1 : a.o.start > b.o.start ? 1 : 0) || ordCmp(a.o, b.o) || (b.e - b.s) - (a.e - a.s));
      const laneEnd = [], lanes = [...Array(7)].map(() => []);
      for (const g of segs) {
        let L = laneEnd.findIndex(x => x < g.s); if (L < 0) { L = laneEnd.length; laneEnd.push(-1); }
        laneEnd[L] = g.e;
        for (let c = g.s; c <= g.e; c++) lanes[c][L] = { ...g, c };
      }
      const timedByCol = [...Array(7)].map(() => []);
      for (const o of occ) if (!isBlock(o) && o.start >= wsKey && o.start <= weKey) timedByCol[R.dayDiff(ws, R.parseYmd(o.start))].push(o);

      for (let c = 0; c < 7; c++) {
        const d = R.addDays(ws, c), k = R.ymd(d), dow = d.getDay();
        const cust = customHol[k];
        const hol = [S.showHoliday ? Holidays(k) : '', cust ? (cust.event.title || '휴일') : ''].filter(Boolean).join(' · ');
        const cell = el('div', 'cell');
        if (dow === 0) cell.classList.add('sun'); if (dow === 6) cell.classList.add('sat');
        if (hol) cell.classList.add('hol');
        if (k === todayKey) cell.classList.add('today');
        if (k === selDate) cell.classList.add('sel');
        cell.dataset.date = k;
        const h = el('div', 'dhead');
        h.appendChild(el('time', 'dnum', rolling() && (d.getDate() === 1 || (w === 0 && c === 0)) ? `${d.getMonth() + 1}월 ${d.getDate()}일` : d.getDate()));
        if (hol) { const hn = el('span', 'hname', hol); if (cust) { occOf.set(hn, cust); hn.classList.add('custom'); hn.title = `${cust.event.title} (더블클릭: 수정)`; } h.appendChild(hn); }   // 날짜 옆 공휴일·휴일 이름
        if (rolling() && R.ymd(weekStartOf(d)) === R.ymd(weekStartOf(new Date()))) cell.classList.add('curweek');
        cell.appendChild(h);

        const evs = el('div', 'evs');
        const laneItems = lanes[c];
        const timed = timedByCol[c].sort((a, b) => ordCmp(a, b) || ((a.time || '') < (b.time || '') ? -1 : 1));
        const items = [];
        for (let L = 0; L < laneItems.length; L++) items.push(laneItems[L] ? { bar: laneItems[L] } : { gap: true });
        while (items.length && items[items.length - 1].gap) items.pop();
        for (const o of timed) items.push({ timed: o });
        if (k === todayKey) for (const o of missed) items.push({ carry: o });   // 오늘 일정이 먼저, 넘어온 일정은 그 아래
        const real = items.filter(x => !x.gap).length;
        let shown = items;
        if (items.length > fit) shown = items.slice(0, Math.max(0, fit - 1));
        for (const it of shown) {
          if (it.gap) { evs.appendChild(el('div', 'gap')); continue; }
          if (it.bar) {
            const { o, s, e, c: col } = it.bar;
            const b = el('button', 'bar'); b.type = 'button';
            b.style.background = colorOf(o.event);
            if (col === s && k === o.start) b.classList.add('s');
            if (col === e && k === o.end) b.classList.add('e');
            if (col === s && k !== o.start) b.style.marginLeft = '0';
            if (col === s) {
              // 네이버 캘린더처럼 제목 앞 체크박스 → 누르면 완료
              const cb = el('span', 'cb', R.isDone(o) ? '✓' : ''); cb.title = R.isDone(o) ? '완료 취소' : '완료'; occOf.set(cb, o);
              b.append(cb, el('span', 't', o.event.title || '(제목 없음)'));
            } else b.textContent = ' ';
            if (isPast(o)) b.classList.add('past');
            if (R.isDone(o)) b.classList.add('done');
            else if (isPast(o) && S.missDot !== false) { b.classList.add('miss'); if (col === e) b.classList.add('missdot'); }
            b.dataset.seg = `${w}|${o.event.id}|${o.start}`; b.dataset.col = col;
            b.title = (R.isDone(o) ? '[완료] ' : '') + (o.event.title || '');
            if (col === s) b.draggable = true;
            occOf.set(b, o); evs.appendChild(b); continue;
          }
          if (it.carry) {
            const o = it.carry, d0 = R.parseYmd(o.start);
            const t = el('div', 'tev carry'); t.style.setProperty('--c', colorOf(o.event));
            const cb = el('span', 'cb'); cb.title = '완료'; occOf.set(cb, o);
            t.append(cb, el('span', '', `${d0.getMonth() + 1}/${d0.getDate()} ${o.event.title || '(제목 없음)'}`));
            t.title = `못 끝낸 일정 (${o.start}) — 체크하면 완료돼요`;
            occOf.set(t, o); evs.appendChild(t); continue;
          }
          const o = it.timed;
          const t = el('div', 'tev'); t.style.setProperty('--c', colorOf(o.event));
          const cb = el('span', 'cb', R.isDone(o) ? '✓' : ''); cb.title = R.isDone(o) ? '완료 취소' : '완료'; occOf.set(cb, o);
          t.append(cb, el('span', '', `${fmtT(o.time)} ${o.event.title || '(제목 없음)'}`));
          if (isPast(o)) t.classList.add('past');
          if (R.isDone(o)) t.classList.add('done');
          else if (isPast(o) && S.missDot !== false) t.classList.add('miss');
          t.title = `${fmtT(o.time)} ${o.event.title || ''}${o.event.location ? ' · ' + o.event.location : ''}`;
          t.draggable = true;
          occOf.set(t, o); evs.appendChild(t);
        }
        const hidden = real - shown.filter(x => !x.gap).length;
        if (hidden > 0) { const m = el('div', 'more', shown.length ? `${hidden}개 더보기` : `일정 ${hidden}개`); m.dataset.date = k; evs.appendChild(m); }
        cell.appendChild(evs);
        // 스티커: 그날 시작하는 일정에 붙인 스티커를 칸 오른쪽 아래에 크게
        const stk = stickerOf(k, [...laneItems.map(x => x && x.o), ...timed]);
        if (stk) { cell.classList.add('has-stk'); h.insertBefore(el('span', 'stk', stk), h.children[1] || null); }
        grid.appendChild(cell);
      }
    }
    layoutBarLabels();
    renderIcons();
    renderSide();
  }


  // 여러 날 막대: 제목이 칸에서 잘리지 않게 막대 전체 길이로 표시
  function layoutBarLabels() {
    const lay = $('#bar-labels'); lay.innerHTML = '';
    const br = $('#board').getBoundingClientRect();
    const groups = {};
    document.querySelectorAll('#grid .bar[data-seg]').forEach(b => (groups[b.dataset.seg] = groups[b.dataset.seg] || []).push(b));
    for (const g of Object.values(groups)) {
      const first = g[0], t = first.querySelector('.t');
      if (!t) continue;
      let last = first;   // 이어진 칸까지만 (가운데가 '더보기'로 가려지면 거기서 멈춤)
      for (let i = 1; i < g.length; i++) { if (+g[i].dataset.col === +last.dataset.col + 1) last = g[i]; else break; }
      if (last === first) continue;
      const fr = first.getBoundingClientRect(), lr = last.getBoundingClientRect(), tr = t.getBoundingClientRect();
      const cr = first.closest('.cell').getBoundingClientRect();
      if (fr.bottom > cr.bottom + 1) continue;   // 칸 밖으로 잘린 막대는 제목을 띄우지 않음
      const lab = el('div', 'bar-label', t.textContent);
      ['past', 'done'].forEach(c => first.classList.contains(c) && lab.classList.add(c));
      lab.style.left = (tr.left - br.left) + 'px'; lab.style.top = (fr.top - br.top) + 'px';
      lab.style.width = Math.max(0, lr.right - tr.left - 8) + 'px'; lab.style.height = fr.height + 'px'; lab.style.lineHeight = fr.height + 'px';
      t.style.visibility = 'hidden';
      lay.appendChild(lab);
    }
  }

  // D-day 카드: 일정 입력창에서 'D-day' 켠 일정 중 다가오는 것
  function nextDday(ev, today) {
    if (!R.isRepeat(ev)) {
      const s0 = ev.start.slice(0, 10), e0 = (ev.end || ev.start).slice(0, 10);
      if (e0 < R.ymd(today) || ev.done) return null;
      return { date: s0, diff: Math.max(0, R.dayDiff(today, R.parseYmd(s0))) };
    }
    const o = R.occurrences([ev], today, R.addDays(today, 400)).find(x => !R.isDone(x));
    return o ? { date: o.start, diff: Math.max(0, R.dayDiff(today, R.parseYmd(o.start))) } : null;
  }
  function renderDdays() {
    const box = $('#ddays'); if (!box) return; box.innerHTML = '';
    const today = R.parseYmd(R.ymd(new Date()));
    const list = visibleEvents().filter(e => e.dday).map(e => ({ e, n: nextDday(e, today) })).filter(x => x.n).sort((a, b) => a.n.diff - b.n.diff);
    for (const { e, n } of list.slice(0, 5)) {
      const c = el('button', 'dd' + (n.diff === 0 ? ' today' : n.diff <= 7 ? ' soon' : '')); c.type = 'button';
      const dot = el('i'); dot.style.background = colorOf(e);
      c.append(dot, el('span', 'nm', e.title || '(제목 없음)'), el('b', '', n.diff === 0 ? 'D-DAY' : `D-${n.diff}`));
      c.title = `${e.title} · ${n.date}`;
      c.onclick = () => { const d = R.parseYmd(n.date); rollOff = Math.round(R.dayDiff(weekStartOf(new Date()), weekStartOf(d)) / 7); cur = { y: d.getFullYear(), m: d.getMonth() }; render(); selectDate(n.date); };
      box.appendChild(c);
    }
  }
  // 달력 마우스 동작 (스케두: 칸 더블클릭=추가, 일정 클릭=선택, 일정 더블클릭=수정)
  function selectDate(k) { selDate = k; document.querySelectorAll('.cell.sel').forEach(c => c.classList.remove('sel')); const c = document.querySelector(`.cell[data-date="${k}"]`); if (c) c.classList.add('sel'); }
  function actClick(target) {
    const ckb = target.closest('.ck,.cb'); if (ckb && occOf.get(ckb)) { toggleDone(occOf.get(ckb)); return; }
    if (WEB && webTap(target)) return;
    const ev = target.closest('.bar,.tev,.si'); const cell = target.closest('.cell');
    if (target.closest('.more')) { const k = target.closest('.more').dataset.date; sideDate = R.parseYmd(k); if (!S.showSidebar) setS('showSidebar', true); S.sidePanelType = '일'; setS('sidePanelType', '일'); renderSide(); return; }
    if (ev && occOf.get(ev)) { selectDate(occOf.get(ev).start); return; }
    if (cell) selectDate(cell.dataset.date);
  }
  function actDbl(target) {
    if (target.closest('.ck,.cb')) return true;
    const ev = target.closest('.bar,.tev,.si,.hname.custom');
    if (ev && occOf.get(ev)) { openForm({ occ: occOf.get(ev) }); return true; }
    const cell = target.closest('.cell');
    if (cell) { openForm({ date: cell.dataset.date }); return true; }
    return false;
  }
  // 웹(터치): 일정 누르면 바로 수정 · 칸 누르면 그날 목록 · 같은 칸을 한 번 더 누르면 새 일정
  function webTap(target) {
    if (longFired) { longFired = false; return true; }
    if (target.closest('.more')) return false;
    const ev = target.closest('.bar,.tev,.si,.hname.custom');
    if (ev && occOf.get(ev)) { openForm({ occ: occOf.get(ev) }); return true; }
    const cell = target.closest('.cell'); if (!cell) return false;
    const k = cell.dataset.date;
    if (selDate === k) { openForm({ date: k }); return true; }
    selectDate(k); sideDate = R.parseYmd(k);
    if (S.showSidebar && (S.sidePanelType || '일') !== '일') setS('sidePanelType', '일').then(renderSide); else renderSide();
    return true;
  }
  // 웹(터치): 일정을 길게 누르면 메뉴 / 달력을 옆으로 쓸면 달 넘기기
  let longT = null, longFired = false, tStart = null;
  function evMenu(o, x, y) {
    ctxMenu(x, y, [[R.isDone(o) ? '완료 취소' : '완료', () => toggleDone(o)], ['수정', () => openForm({ occ: o })], ['복사해서 새로 만들기', () => openForm({ copy: { ...o.event }, date: o.start })], '-',
      ['맨 위로', () => moveOrder(o, 'top')], ['위로', () => moveOrder(o, 'up')], ['아래로', () => moveOrder(o, 'down')], ['맨 아래로', () => moveOrder(o, 'bottom')]]);
  }
  if (WEB) {
    for (const host of [$('#board'), $('#side-list')]) {
      host.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) { tStart = null; clearTimeout(longT); return; }
        const t = e.touches[0]; tStart = { x: t.clientX, y: t.clientY, at: Date.now(), host };
        const ev = e.target.closest('.bar,.tev,.si'); longFired = false; clearTimeout(longT);
        if (ev && occOf.get(ev)) longT = setTimeout(() => { longFired = true; tStart = null; evMenu(occOf.get(ev), t.clientX, t.clientY); }, 520);
      }, { passive: true });
      host.addEventListener('touchmove', e => {
        if (!tStart) return; const t = e.touches[0];
        if (Math.abs(t.clientX - tStart.x) > 10 || Math.abs(t.clientY - tStart.y) > 10) clearTimeout(longT);
      }, { passive: true });
      host.addEventListener('touchend', e => {
        clearTimeout(longT); if (!tStart || tStart.host !== $('#board')) { tStart = null; return; }
        const t = e.changedTouches[0], dx = t.clientX - tStart.x, dy = t.clientY - tStart.y; tStart = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) { longFired = true; setTimeout(() => { longFired = false; }, 400); go(dx < 0 ? 1 : -1); }
      }, { passive: true });
    }
  }
  if (WEB) {
    const add = $('#web-add'); if (add) add.onclick = () => openForm({ date: selDate || R.ymd(new Date()) });
    $('#sync-ind').onclick = async () => { paintSync(await api.syncNow()); };
  }
  $('#grid').addEventListener('click', e => actClick(e.target));
  $('#grid').addEventListener('dblclick', e => actDbl(e.target));
  $('#side-list').addEventListener('click', e => actClick(e.target));
  $('#side-list').addEventListener('dblclick', e => actDbl(e.target));

  /* ───────── 사이드바 ───────── */
  function renderSide() {
    if (!S.showSidebar) return;
    const list = $('#side-list'); list.innerHTML = '';
    const q = $('#q').value.trim();
    const type = S.sidePanelType || '일';
    let from = sideDate, to = sideDate, label;
    if (q) {
      $('#side-date').textContent = '검색결과';
      const hits = D.events.filter(e => [e.title, e.memo, e.location].some(v => (v || '').includes(q)))
        .sort((a, b) => a.start < b.start ? -1 : 1).slice(0, 30);
      if (!hits.length) list.appendChild(el('div', 'empty', '검색 결과가 없습니다.'));
      for (const e of hits) list.appendChild(sideItem({ event: e, start: e.start.slice(0, 10), end: (e.end || e.start).slice(0, 10), time: e.allDay ? '' : R.timeOf(e.start) }, true));
      if (hits.length === 30) list.appendChild(el('div', 'empty', '검색 결과는 30개까지만 표시됩니다.'));
      return;
    }
    if (type === '주') { from = R.addDays(sideDate, -((sideDate.getDay() - S.weekStart + 7) % 7)); to = R.addDays(from, 6); label = `${from.getMonth() + 1}월 ${from.getDate()}일 ~ ${to.getMonth() + 1}월 ${to.getDate()}일`; }
    else if (type === '월') { from = new Date(sideDate.getFullYear(), sideDate.getMonth(), 1); to = new Date(sideDate.getFullYear(), sideDate.getMonth() + 1, 0); label = `${from.getFullYear()}년 ${from.getMonth() + 1}월`; }
    else label = `${sideDate.getFullYear()}년 ${sideDate.getMonth() + 1}월 ${sideDate.getDate()}일`;
    $('#side-date').textContent = label;
    // 날짜별로 묶어서: 같은 날 안에서는 완료하지 않은 일정이 위, 완료한 일정은 맨 아래
    const fk = R.ymd(from), dayOf = o => (o.start < fk ? fk : o.start);
    const occ = R.occurrences(visibleEvents(), from, to).sort((a, b) => {
      const da = dayOf(a), db = dayOf(b); if (da !== db) return da < db ? -1 : 1;
      const xa = R.isDone(a) ? 1 : 0, xb = R.isDone(b) ? 1 : 0; if (xa !== xb) return xa - xb;
      const ta = isBlock(a) ? '' : a.time, tb = isBlock(b) ? '' : b.time; return ta < tb ? -1 : ta > tb ? 1 : ordCmp(a, b);
    });
    if (!occ.length) { list.appendChild(el('div', 'empty', '일정이 없습니다.')); return; }
    const putDays = arr => {
      let lastDay = '';
      for (const o of arr) {
        const day = dayOf(o);
        if (type !== '일' && day !== lastDay) { const d = R.parseYmd(day); list.appendChild(el('div', 'sh', `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`)); lastDay = day; }
        list.appendChild(sideItem(o, false));
      }
    };
    if (type === '일') { putDays(occ); return; }
    // 주·월: [진행 중 일정] 날짜순 → [완료된 일정] 날짜순 (지난 날 완료한 것도 모두 아래로)
    const todo = occ.filter(o => !R.isDone(o)), done = occ.filter(o => R.isDone(o));
    const sec = (name, n, cls) => list.appendChild(el('div', 'sec ' + cls, `${name} ${n}`));
    sec('진행 중 일정', todo.length, 'todo');
    if (todo.length) putDays(todo); else list.appendChild(el('div', 'empty', '모두 완료했어요.'));
    if (done.length) { sec('완료된 일정', done.length, 'fin'); putDays(done); }
  }
  function sideItem(o, withDate) {
    const it = el('div', 'si'); const cal = calOf(o.event.calendarId);
    if (!o.event.allDay && o.start === o.end) it.classList.add('c2');
    if (isPast(o)) it.classList.add('past');
    const meta = el('div', 'meta');
    const tag = el('span', 'tag', cal.name); tag.style.background = colorOf(o.event); meta.appendChild(tag);
    let tm = o.event.allDay ? '종일' : `${fmtT(R.timeOf(o.event.start))}-${fmtT(R.timeOf(o.event.end)).replace(/^오[전후] /, '')}`;
    if (withDate) tm = `${o.start.slice(5).replace('-', '/')} ${tm}`;
    meta.appendChild(el('span', 'tm', tm));
    if (R.isDone(o)) it.classList.add('done');
    const ck = el('button', 'ck', R.isDone(o) ? '✓' : ''); ck.type = 'button'; ck.title = R.isDone(o) ? '완료 취소' : '완료';
    it.append(meta, el('div', 'tt', o.event.title || '(제목 없음)'), ck);
    if (o.event.sticker) { it.classList.add('has-stk'); it.appendChild(el('span', 'stk', o.event.sticker)); }
    occOf.set(it, o); occOf.set(ck, o);
    return it;
  }
  const sideGo = n => {
    const t = S.sidePanelType || '일';
    sideDate = t === '월' ? new Date(sideDate.getFullYear(), sideDate.getMonth() + n, 1) : R.addDays(sideDate, t === '주' ? 7 * n : n);
    renderSide();
  };
  $('#s-prev').onclick = () => sideGo(-1);
  $('#s-next').onclick = () => sideGo(1);
  $('#side-type').onchange = () => setS('sidePanelType', $('#side-type').value).then(renderSide);
  $('#q').oninput = renderSide;

  /* ───────── 일정 입력창 (스케두 형식) ───────── */
  const form = $('#ev-form');
  let editing = null, pickCal = null, pickColor = null;

  function fillRepeat(dateStr) {
    const d = R.parseYmd(dateStr);
    const opts = [['none', '없음'], ['daily', '매일'], ['weekdays', '주중 매일(월~금)'], ['weekly', `매주 ${WD[d.getDay()]}요일`],
      ['biweekly', `격주 ${WD[d.getDay()]}요일`], ['monthly', `매월 ${d.getDate()}일`], ['yearly', `매년 ${d.getMonth() + 1}월 ${d.getDate()}일`]];
    const sel = $('#f-repeat'), v = sel.value; sel.innerHTML = '';
    for (const [k, t] of opts) { const o = el('option', '', t); o.value = k; sel.appendChild(o); }
    sel.value = v || 'none';
  }
  function fillAlarm(allDay) {
    const sel = $('#f-alarm'), v = sel.value;
    const opts = allDay ? [[-1, '없음'], [0, '당일'], [1440, '1'], [2880, '2'], [4320, '3'], [10080, '7']]
      : [[-1, '없음'], [0, '정각'], [5, '5'], [10, '10'], [15, '15'], [30, '30'], [60, '60']];
    sel.innerHTML = '';
    for (const [k, t] of opts) { const o = el('option', '', t); o.value = k; sel.appendChild(o); }
    sel.value = opts.some(o => String(o[0]) === v) ? v : '-1';
    syncAlarmUnit();
  }
  function syncAlarmUnit() { const v = +$('#f-alarm').value; $('#alarm-unit').textContent = $('#f-allday').checked ? (v > 0 ? '일전 (오전 9시)' : v === 0 ? '오전 9시' : '일전') : (v > 0 ? '분전' : v === 0 ? '' : '분전'); }
  $('#f-alarm').onchange = syncAlarmUnit;
  function paintCal() {
    const c = calOf(pickCal);
    const b = $('#f-calbtn'); b.querySelector('i').style.background = c.color; b.querySelector('span').textContent = c.name;
    $('#f-colbtn i').style.background = pickColor || c.color;
  }
  $('#f-calbtn').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    ctxMenu(r.left, r.bottom + 4, D.calendars.map(c => { const b = el('button', 'it'); const i = el('i'); i.style.background = c.color; b.append(i, document.createTextNode(c.name)); b.onclick = () => { pickCal = c.id; hideCtx(); paintCal(); }; return b; }));
  };
  $('#f-colbtn').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const box = el('div', 'swatches');
    const none = el('button'); none.title = '캘린더 색상'; none.style.background = calOf(pickCal).color; if (!pickColor) none.classList.add('on');
    none.onclick = () => { pickColor = null; hideCtx(); paintCal(); }; box.appendChild(none);
    for (const [c, n] of PALETTE) { const b = el('button'); b.title = n; b.style.background = c; if (pickColor === c) b.classList.add('on'); b.onclick = () => { pickColor = c; hideCtx(); paintCal(); }; box.appendChild(b); }
    ctxMenu(r.left - 100, r.bottom + 4, [box]);
  };
  function syncAllDay() {
    const ad = $('#f-allday').checked;
    $('#f-stime').hidden = $('#f-etime').hidden = ad;
    fillAlarm(ad);
  }
  $('#f-allday').onchange = syncAllDay;
  $('#f-sdate').onchange = () => { const s = $('#f-sdate').value, e = $('#f-edate').value; if (!e || e < s) $('#f-edate').value = s; fillRepeat(s); };
  $('#f-repeat').onchange = () => { $('#until-row').hidden = $('#f-repeat').value === 'none'; if (EDITOR && !$('#ev-modal').hidden) requestAnimationFrame(() => api.editorSize(form.scrollHeight + 2)); };
  // 시간: 24시간제 글자 입력 (930 → 09:30, 15 → 15:00)
  function normTime(v) {
    v = (v || '').replace(/[^0-9:]/g, '');
    let h, m;
    if (v.includes(':')) [h, m] = v.split(':'); else if (v.length <= 2) { h = v; m = '0'; } else { h = v.slice(0, v.length - 2); m = v.slice(-2); }
    h = Math.min(23, parseInt(h || '0', 10) || 0); m = Math.min(59, parseInt(m || '0', 10) || 0);
    return `${R.pad(h)}:${R.pad(m)}`;
  }
  for (const id of ['#f-stime', '#f-etime']) $(id).addEventListener('blur', () => { if ($(id).value) $(id).value = normTime($(id).value); $(id).dispatchEvent(new Event('change')); });
  for (const id of ['#f-sdate', '#f-edate', '#f-until']) $(id).addEventListener('click', () => { try { $(id).showPicker(); } catch { } });
  $('#f-stime').onchange = () => {
    const st = normTime($('#f-stime').value); $('#f-stime').value = st;
    const et = $('#f-etime').value ? normTime($('#f-etime').value) : '';
    if ($('#f-sdate').value === $('#f-edate').value && (!et || et <= st)) {
      const [h, m] = st.split(':').map(Number); $('#f-etime').value = `${R.pad(Math.min(23, h + 1))}:${R.pad(m)}`;
    }
  };
  $('#f-locsearch').onclick = () => { const q = $('#f-loc').value.trim(); if (q) api.openFile('https://map.naver.com/p/search/' + encodeURIComponent(q)); };

  function openForm({ date, occ, copy }) {
    if (!EDITOR && mode === 'background') {
      api.openEditor(occ ? { eventId: occ.event.id, start: occ.start, end: occ.end, time: occ.time } : { date });
      return;
    }
    closeAll(false);
    // copy: 기존 일정 내용을 그대로 채운 '새 일정' (복사)
    const ev = occ ? occ.event : null, src = ev || copy || null;
    editing = ev ? { ev, occ, scope: null } : null;
    document.body.classList.toggle('ev-edit', !!ev);
    $('#b-save').textContent = ev ? '수정' : '추가';
    $('#b-del').hidden = !ev;
    $('#b-done').hidden = !ev;
    paintOrder();
    if (ev) { const dn = R.isDone(occ); $('#b-done').textContent = dn ? '완료 취소' : '완료'; $('#b-done').classList.toggle('undo', dn); }
    // 반복 일정은 '누른 그 날짜'를 보여 준다 (반복 시작일이 아니라)
    const sd = occ ? occ.start : copy ? (date || copy.start.slice(0, 10)) : date;
    const span = src ? R.dayDiff(R.parseYmd(src.start), R.parseYmd(src.end || src.start)) : 0;
    $('#f-title').value = src ? src.title : '';
    $('#f-allday').checked = src ? !!src.allDay : true;
    $('#f-sdate').value = sd;
    $('#f-edate').value = occ ? occ.end : R.ymd(R.addDays(R.parseYmd(sd), span));
    $('#f-stime').value = src && !src.allDay ? R.timeOf(src.start) : '09:00';
    $('#f-etime').value = src && !src.allDay ? R.timeOf(src.end) : '10:00';
    $('#f-repeat').value = 'none'; fillRepeat(sd);
    $('#f-repeat').value = (ev && ev.repeat && ev.repeat.freq) || 'none';
    $('#f-until').value = (ev && ev.repeat && ev.repeat.until) || '';
    $('#b-copy').hidden = !ev;
    $('#f-repeat').onchange();
    syncAllDay();
    $('#f-alarm').value = String(ev && ev.alarm !== undefined ? ev.alarm : -1); if (!$('#f-alarm').value) $('#f-alarm').value = '-1';
    syncAlarmUnit();
    pickCal = src ? src.calendarId : (D.calendars.some(c => c.id === S.lastCalendarId) ? S.lastCalendarId : D.calendars[0].id);
    pickColor = src ? src.color || null : null;
    paintCal();
    $('#f-loc').value = src ? src.location || '' : '';
    $('#f-memo').value = src ? src.memo || '' : '';
    $('#f-dday').checked = !!(src && src.dday);
    $('#f-holiday').checked = !!(src && src.holiday);
    pickSticker = (src && src.sticker) || ''; paintSticker(); $('#stk-pop').hidden = true;
    $('#ev-modal').hidden = false;
    if (EDITOR) requestAnimationFrame(() => api.editorSize(form.scrollHeight + 2));
    setTimeout(() => $('#f-title').focus(), 60);
  }

  /* 스티커 (네이버 캘린더처럼 제목 오른쪽 버튼 → 고르기) */
  const STICKERS = [
    ['자주', ['🎂', '🎉', '🎁', '❤️', '⭐', '✈️', '🏖️', '📚', '✏️', '🏫', '🎓', '💼', '📌', '⚠️', '✅', '🍀']],
    ['학교', ['🏫', '🎓', '📚', '✏️', '📝', '📖', '🧪', '🔬', '🎨', '🎵', '⚽', '🏃', '📢', '🍱', '🚌', '🏆']],
    ['기념일', ['🎂', '🎉', '🎁', '🎊', '💐', '💍', '❤️', '👶', '🎄', '🎃', '🧧', '🎆', '🌸', '🌕', '🥂', '🕯️']],
    ['생활', ['🏠', '🛒', '🍽️', '☕', '🍰', '🍺', '💊', '🏥', '💇', '🧹', '💰', '💳', '📦', '🚗', '📞', '🐶']],
    ['여행·취미', ['✈️', '🧳', '🏖️', '⛰️', '🏕️', '🚆', '🎬', '🎤', '🎮', '📷', '🎣', '🏊', '⛳', '🎾', '🚴', '🧘']],
    ['기호', ['⭐', '❗', '❓', '✅', '❌', '📌', '🔔', '⏰', '🔥', '💡', '🌈', '☀️', '☔', '❄️', '🌙', '💯']],
  ];
  let pickSticker = '', stkTab = 0;
  function paintSticker() {
    const b = $('#f-sticker'); b.classList.toggle('has', !!pickSticker); b.querySelector('.em').textContent = pickSticker;
  }
  function paintStkPop() {
    const tabs = $('#stk-pop .stk-tabs'), grid = $('#stk-pop .stk-grid'); tabs.innerHTML = ''; grid.innerHTML = '';
    STICKERS.forEach(([nm], i) => { const t = el('button', i === stkTab ? 'on' : '', nm); t.type = 'button'; t.onclick = () => { stkTab = i; paintStkPop(); }; tabs.appendChild(t); });
    for (const e of STICKERS[stkTab][1]) {
      const b = el('button', e === pickSticker ? 'on' : '', e); b.type = 'button';
      b.onclick = () => { pickSticker = e; paintSticker(); toggleStkPop(false); };
      grid.appendChild(b);
    }
    $('#stk-pop .stk-clear').hidden = !pickSticker;
  }
  function toggleStkPop(show) {
    const p = $('#stk-pop'); p.hidden = !(show ?? p.hidden);
    if (!p.hidden) paintStkPop();
    if (EDITOR) requestAnimationFrame(() => api.editorSize(form.scrollHeight + 2));
  }
  $('#f-sticker').onclick = () => toggleStkPop();
  $('#stk-pop .stk-clear').onclick = () => { pickSticker = ''; paintSticker(); toggleStkPop(false); };
  const stickerOf = (k, items) => { for (const o of items) if (o && o.start === k && o.event.sticker) return o.event.sticker; return ''; };

  form.onsubmit = async e => {
    e.preventDefault();
    const allDay = $('#f-allday').checked;
    const sd = $('#f-sdate').value, ed = $('#f-edate').value || sd;
    if (!sd) return toast('날짜를 입력해주세요.');
    const st = normTime($('#f-stime').value || '09:00'), et = normTime($('#f-etime').value || $('#f-stime').value || '10:00');
    const start = allDay ? sd : `${sd}T${st}`;
    const end = allDay ? ed : `${ed}T${et}`;
    if (end < start) return toast('일정 종료일시는 시작일시보다 늦어야 합니다.');
    const freq = $('#f-repeat').value;
    const fields = {
      title: $('#f-title').value.trim(), allDay, start, end,
      repeat: { freq, until: freq === 'none' ? '' : $('#f-until').value },
      alarm: Number($('#f-alarm').value), dday: $('#f-dday').checked, holiday: $('#f-holiday').checked,
      calendarId: pickCal, color: pickColor, location: $('#f-loc').value.trim(), memo: $('#f-memo').value,
      sticker: pickSticker || '',
    };
    const series = editing ? (D.events.find(x => x.id === editing.ev.id) || editing.ev) : null;
    // 반복 일정을 고칠 때는 '이 날짜만' 또는 '반복 전체' 중에서 고르기
    if (series && R.isRepeat(series) && !editing.scope) {
      const r = $('#b-save').getBoundingClientRect();
      ctxMenu(r.left, r.top - 96, [
        [`이 날짜(${editing.occ.start.slice(5).replace('-', '/')})만 수정`, () => { editing.scope = 'one'; form.requestSubmit(); }],
        ['반복 일정 전체 수정', () => { editing.scope = 'all'; form.requestSubmit(); }],
      ]);
      return;
    }
    const isNew = !editing;
    if (series && editing.scope === 'one') {
      // 이 날짜만: 반복에서 그 날짜를 빼고, 고친 내용으로 한 번짜리 일정을 새로 만든다
      const occ = editing.occ;
      await api.saveEvent({ ...series, exdates: [...(series.exdates || []), occ.start], doneDates: (series.doneDates || []).filter(x => x !== occ.start) });
      D.events = await api.saveEvent({ ...fields, repeat: { freq: 'none', until: '' }, order: series.order, done: R.isDone(occ) });
    } else if (series && editing.scope === 'all') {
      // 반복 전체: 날짜를 옮겼다면 그만큼 반복 시작일도 옮긴다
      const delta = R.dayDiff(R.parseYmd(editing.occ.start), R.parseYmd(sd));
      const ns = R.ymd(R.addDays(R.parseYmd(series.start), delta)), ne = R.ymd(R.addDays(R.parseYmd(ns), R.dayDiff(R.parseYmd(sd), R.parseYmd(ed))));
      const ev = { ...series, ...fields, start: allDay ? ns : `${ns}T${st}`, end: allDay ? ne : `${ne}T${et}` };
      if (freq === 'none') delete ev.exdates;
      D.events = await api.saveEvent(ev);
    } else {
      const ev = { ...(series || {}), ...fields };
      if (freq === 'none') delete ev.exdates;
      D.events = await api.saveEvent(ev);
    }
    changed = true;
    S.lastCalendarId = pickCal;
    render();
    toast(isNew ? '일정을 추가했습니다.' : '수정되었습니다.');
    closeAll(true);
  };
  $('#f-memo').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });

  // 완료 / 완료 취소 (반복 일정은 그 날짜만)
  async function toggleDone(o) {
    const ev = D.events.find(e => e.id === o.event.id); if (!ev) return;
    const was = R.isDone({ event: ev, start: o.start });
    if (R.isRepeat(ev)) { const s = new Set(ev.doneDates || []); was ? s.delete(o.start) : s.add(o.start); ev.doneDates = [...s]; }
    else ev.done = !was;
    D.events = await api.saveEvent(ev); changed = true;
    render(); toast(was ? '완료를 취소했습니다.' : '완료했습니다.');
  }
  $('#b-done').onclick = async () => { await toggleDone(editing.occ); closeAll(true); };
  // 복사: 지금 일정 내용을 채운 '새 일정' 창으로 (날짜만 바꿔서 추가)
  $('#b-copy').onclick = () => {
    const src = { ...(D.events.find(x => x.id === editing.ev.id) || editing.ev) }, d = editing.occ.start;
    openForm({ copy: src, date: d });
    toast('복사했어요. 날짜를 바꾸고 [추가]를 누르세요.');
    setTimeout(() => { $('#f-sdate').focus(); try { $('#f-sdate').showPicker(); } catch { } }, 120);
  };

  // 2) 일정을 다른 날짜로 옮기기 / 복사 (반복 일정은 그 날짜 것만 떼어 냄)
  const shiftStr = (s, n) => R.ymd(R.addDays(R.parseYmd(s), n)) + s.slice(10);
  async function moveOrCopy(o, fromK, toK, copy) {
    const n = R.dayDiff(R.parseYmd(fromK), R.parseYmd(toK)); if (!n) return;
    const series = D.events.find(x => x.id === o.event.id); if (!series) return;
    if (R.isRepeat(series)) {
      const t1 = series.allDay ? '' : 'T' + R.timeOf(series.start), t2 = series.allDay ? '' : 'T' + R.timeOf(series.end);
      const one = { ...series, id: undefined, created: undefined, exdates: undefined, doneDates: undefined, repeat: { freq: 'none', until: '' },
        start: shiftStr(o.start + t1, n), end: shiftStr(o.end + t2, n), done: false };
      if (!copy) await api.saveEvent({ ...series, exdates: [...(series.exdates || []), o.start] });
      D.events = await api.saveEvent(one);
    } else if (copy) {
      D.events = await api.saveEvent({ ...series, id: undefined, created: undefined, order: undefined, done: false, start: shiftStr(series.start, n), end: shiftStr(series.end || series.start, n) });
    } else {
      D.events = await api.saveEvent({ ...series, start: shiftStr(series.start, n), end: shiftStr(series.end || series.start, n) });
    }
    changed = true; render();
    const d = R.parseYmd(toK); toast(`${d.getMonth() + 1}월 ${d.getDate()}일로 ${copy ? '복사했어요' : '옮겼어요'}.`);
  }
  // 편집 모드: 같은 칸 안에서 끌어서 순서 바꾸기
  let dragOcc = null;
  $('#grid').addEventListener('dragstart', e => {
    const t = e.target.closest && e.target.closest('.bar,.tev');
    if (!t || !occOf.get(t) || mode === 'background') { if (t) e.preventDefault(); return; }
    dragOcc = { o: occOf.get(t), k: t.closest('.cell').dataset.date };
    e.dataTransfer.setData('application/x-evorder', '1'); e.dataTransfer.effectAllowed = 'copyMove';   // 옮기기·복사(Ctrl) 모두 허용
  });
  const clearDrop = () => document.querySelectorAll('.drop-to,.drop-cell').forEach(x => x.classList.remove('drop-to', 'drop-cell'));
  $('#grid').addEventListener('dragover', e => {
    if (!dragOcc) return;
    const t = e.target.closest('.bar,.tev'), cell = e.target.closest('.cell'); clearDrop();
    if (!cell) return;
    if (cell.dataset.date !== dragOcc.k) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'; cell.classList.add('drop-cell'); return; }
    if (t && occOf.get(t) && isBlock(occOf.get(t)) === isBlock(dragOcc.o)) { e.preventDefault(); e.stopPropagation(); t.classList.add('drop-to'); }
  });
  $('#grid').addEventListener('drop', e => {
    if (!dragOcc) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.target.closest('.bar,.tev'), cell = e.target.closest('.cell'); const src = dragOcc; dragOcc = null;
    clearDrop();
    if (cell && cell.dataset.date !== src.k) { moveOrCopy(src.o, src.k, cell.dataset.date, e.ctrlKey); return; }
    if (!t || !occOf.get(t)) return;
    const g = dayGroup(src.k, src.o), j = g.findIndex(x => x.event.id === occOf.get(t).event.id);
    if (j >= 0) moveOrder({ ...src.o, start: src.k }, null, j);
  });
  $('#grid').addEventListener('dragend', () => { dragOcc = null; clearDrop(); });
  $('#grid').addEventListener('contextmenu', e => {
    const t = e.target.closest('.bar,.tev'); if (!t || !occOf.get(t)) return; e.preventDefault();
    const o = occOf.get(t);
    ctxMenu(e.clientX, e.clientY, [[R.isDone(o) ? '완료 취소' : '완료', () => toggleDone(o)], ['수정', () => openForm({ occ: o })], ['복사해서 새로 만들기', () => openForm({ copy: { ...o.event }, date: o.start })], '-',
      ['맨 위로', () => moveOrder(o, 'top')], ['위로', () => moveOrder(o, 'up')], ['아래로', () => moveOrder(o, 'down')], ['맨 아래로', () => moveOrder(o, 'bottom')]]);
  });
  $('#b-del').onclick = ev => {
    const { ev: e, occ } = editing;
    const doDel = async only => { D.events = await api.deleteEvent(e.id, only); changed = true; render(); toast('일정이 삭제되었습니다.'); closeAll(true); };
    const items = e.repeat && e.repeat.freq !== 'none'
      ? [['이 날짜의 일정만 삭제', () => doDel(occ.start)], ['반복 일정 전체 삭제', () => doDel()]]
      : [['삭제하기', () => doDel()], ['취소', () => { }]];
    ctxMenu(ev.clientX - 60, ev.clientY - 90, items);
  };

  /* ───────── 공통 ───────── */
  // userClosed: 사용자가 닫음 → '빠른 입력'이었으면 다시 바탕화면 층으로
  function closeAll(userClosed = true) {
    const wasOpen = [...document.querySelectorAll('.backdrop')].some(b => !b.hidden);
    document.querySelectorAll('.backdrop').forEach(b => b.hidden = true); hideCtx();
    // 입력 전용 창: 사용자가 닫을 때만 창을 닫는다 (다른 날짜로 다시 열 때는 닫지 않음)
    if (EDITOR) { if (userClosed && wasOpen) { const c = changed; changed = false; setTimeout(() => api.editorDone(c), c ? 700 : 0); } return; }
    if (userClosed && wasOpen && mode === 'quick') setTimeout(() => api.toBottom(), 250);
  }
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeAll(true)));
  document.querySelectorAll('.backdrop').forEach(b => b.addEventListener('mousedown', e => { if (e.target === b) closeAll(true); }));
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 1600); }
  function ctxMenu(x, y, items) {
    const c = $('#ctx'); c.innerHTML = '';
    for (const it of items) {
      if (it === '-') { c.appendChild(el('hr')); continue; }
      if (it instanceof HTMLElement) { c.appendChild(it); continue; }
      const b = el('button', 'it', it[0]); b.type = 'button'; b.onclick = () => { hideCtx(); it[1](); }; c.appendChild(b);
    }
    c.hidden = false;
    const r = c.getBoundingClientRect();
    c.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
    c.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
  }
  function hideCtx() { $('#ctx').hidden = true; }
  document.addEventListener('mousedown', e => { if (!e.target.closest('#ctx')) hideCtx(); });
  const modalOpen = () => [...document.querySelectorAll('.backdrop')].some(b => !b.hidden);

  /* ───────── 헤더 ───────── */
  const go = n => { if (rolling()) { rollOff += n; render(); return; } cur.m += n; while (cur.m < 0) { cur.m += 12; cur.y--; } while (cur.m > 11) { cur.m -= 12; cur.y++; } render(); };
  // 보기 방식 전환 (한 달 ↔ 5주)
  document.querySelectorAll('#vm button').forEach(b => b.onclick = async () => {
    if ((S.viewMode || 'month') === b.dataset.v) return;
    rollOff = 0; const t = new Date(); cur = { y: t.getFullYear(), m: t.getMonth() };
    await setS('viewMode', b.dataset.v); render();
  });
  $('#prev').onclick = () => go(-1);
  $('#next').onclick = () => go(1);
  $('#today').onclick = () => $('#title').onclick();
  $('#title').onclick = () => { const t = new Date(); rollOff = 0; cur = { y: t.getFullYear(), m: t.getMonth() }; sideDate = R.parseYmd(R.ymd(t)); render(); };
  $('#opacity').oninput = () => { S.bgOpacity = +$('#opacity').value; applySettings(); };
  $('#opacity').onchange = () => setS('bgOpacity', +$('#opacity').value);
  $('#btn-pin').onclick = () => { setS('locked', !S.locked); toast(S.locked ? '위치와 크기를 고정했어요.' : '고정을 풀었어요.'); };
  $('#btn-hide').onclick = () => api.hide();
  $('#btn-set').onclick = openSettings;
  $('#btn-side').onclick = () => setS('showSidebar', !S.showSidebar).then(() => requestAnimationFrame(render));
  $('#btn-icons').onclick = () => setIconMode(!iconMode);
  $('#btn-done').onclick = () => api.toBottom();
  // 마우스 휠로 달 넘기기 (달력 칸 위에서만, 너무 빨리 넘어가지 않게 간격 둠)
  let wheelT = 0;
  function wheel(dy) { const t = Date.now(); if (t - wheelT < 280) return; wheelT = t; go(dy > 0 ? 1 : -1); }
  $('#board').addEventListener('wheel', e => { if (iconMode && e.target.closest('.dicon')) return; if (Math.abs(e.deltaY) >= 20) wheel(e.deltaY); }, { passive: true });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('#ctx').hidden) hideCtx(); else if (modalOpen()) closeAll(true); else if (iconMode) setIconMode(false); else if (mode !== 'background') api.toBottom();
      return;
    }
    if (e.target.matches('input,textarea,select') || modalOpen()) return;
    if (iconMode && selIcon && (e.key === 'Delete' || e.key === 'Backspace')) { removeIcon(selIcon); return; }
    if (iconMode && selIcon && e.key.startsWith('Arrow')) {
      const ic = D.icons.find(i => i.id === selIcon); const b = $('#board').getBoundingClientRect(); const st = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') ic.x -= st / b.width; if (e.key === 'ArrowRight') ic.x += st / b.width;
      if (e.key === 'ArrowUp') ic.y -= st / b.height; if (e.key === 'ArrowDown') ic.y += st / b.height;
      clampIcon(ic); renderIcons(); saveIcons(); e.preventDefault(); return;
    }
    if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1);
  });

  /* ───────── 바탕화면에서 온 마우스 (CalendarTask 방식) ───────── */
  function iconAt(x, y) {
    for (const n of [...document.querySelectorAll('.dicon.sc')].reverse()) {
      const r = n.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return D.icons.find(i => i.id === n.dataset.id);
    }
    return null;
  }
  function onDesktop({ kind, x, y, delta }) {
    if (mode !== 'background') return;
    const t = document.elementFromPoint(x, y); if (!t) return;
    if (kind === 'wheel') {
      // 사이드바 위: 목록 스크롤 / 달력 칸 위: 달 넘기기
      const list = t.closest('#side-list'); if (list) { list.scrollBy({ top: -delta * 0.6 }); return; }
      if (t.closest('#board')) wheel(-delta);
      return;
    }
    if (kind === 'dbl') {
      const ic = iconAt(x, y); if (ic && ic.path) { openIcon(ic); return; }
      actDbl(t); return;
    }
    // 한 번 클릭: 헤더·사이드바 버튼, 일정 선택
    const btn = t.closest('#prev,#next,#title,#btn-side,#s-prev,#s-next,#btn-hide,#vm button,.dd,#today,#undo-btn');
    if (btn) { btn.click(); return; }
    if (t.closest('#btn-set')) { api.edit('edit'); setTimeout(openSettings, 150); return; }
    if (t.closest('#btn-icons')) { api.edit('edit'); setTimeout(() => setIconMode(true), 150); return; }
    if (t.closest('#btn-pin')) { $('#btn-pin').click(); return; }
    if (t.closest('#side-type')) { const o = ['일', '주', '월']; setS('sidePanelType', o[(o.indexOf(S.sidePanelType || '일') + 1) % 3]).then(renderSide); return; }
    if (t.closest('#q,#opacity')) { api.edit('edit'); if (t.closest('#q')) setTimeout(() => $('#q').focus(), 150); return; }
    actClick(t);
  }

  /* ───────── 아이콘 자유 배치 ───────── */
  const PAL = {
    '학교': '📚 ✏️ 📝 📖 🎓 🏫 🔔 📢 🧪 📐 🖍️ 📎 📌 📋 🗂️ 🗓️ 💯 🏆 🎒 🧑‍🏫 👩‍🎓 🎤 🎨 🎵 ⚽ 🏃'.split(' '),
    '일정': '⭐ ❗ ❓ ✅ ❌ 🔴 🟠 🟡 🟢 🔵 🟣 ⏰ ⌛ 🎉 🎂 🎁 ✈️ 🚌 🚗 🏖️ ⛺ 🏥 💊 💼 💰 🛒 🍽️ ☕ 🍰'.split(' '),
    '기분·날씨': '😀 😊 🥰 😎 🤔 😴 😢 😡 🥳 💪 👍 👏 🙏 ❤️ 💙 💚 💛 🔥 💡 ✨ 🌈 ☀️ ⛅ 🌧️ ❄️ 🌙 🌸 🍀 🍁 🎄'.split(' '),
    '기호': '★ ☆ ● ○ ◆ ◇ ■ □ ▲ △ ♥ ♡ ✔ ✖ ➜ ⬅ ⬆ ⬇ ♪ ✿ ❀ ☎ ✉ ✂ ⚑ ⚠ ① ② ③ ④ ⑤'.split(' '),
  };
  let palTab = '학교';
  function renderPalette() {
    const tabs = $('#pal-tabs'); tabs.innerHTML = '';
    for (const k of Object.keys(PAL)) { const b = el('button', k === palTab ? 'on' : '', k); b.onclick = () => { palTab = k; renderPalette(); }; tabs.appendChild(b); }
    const g = $('#pal-grid'); g.innerHTML = '';
    for (const ch of PAL[palTab]) {
      const p = el('div', 'pi', ch); p.draggable = true; p.title = '끌어서 달력 위에 놓기 (클릭하면 가운데에)';
      p.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-deskicon', ch); e.dataTransfer.effectAllowed = 'copy'; });
      p.onclick = () => addIcon({ type: 'emoji', glyph: ch, size: 40 }, .5, .5);
      g.appendChild(p);
    }
  }
  function setIconMode(on) {
    if (on && mode === 'background') api.edit('edit');
    iconMode = on; selIcon = null;
    document.body.classList.toggle('iconmode', on);
    $('#palette').hidden = !on; $('#btn-icons').classList.toggle('on', on);
    if (on) renderPalette();
    requestAnimationFrame(render);
  }
  $('#pal-done').onclick = () => setIconMode(false);
  const scopeMonth = () => $('#pal-month').checked ? monthKey() : null;
  function clampIcon(ic) { ic.x = Math.min(1, Math.max(0, ic.x)); ic.y = Math.min(1, Math.max(0, ic.y)); }
  let saveT = null;
  function saveIcons() { clearTimeout(saveT); saveT = setTimeout(() => api.saveIcons(D.icons), 200); }
  function addIcon(props, x, y) {
    const ic = { x, y, size: 40, month: scopeMonth(), ...props, id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) };
    clampIcon(ic); D.icons.push(ic); selIcon = ic.id; renderIcons(); saveIcons(); return ic;
  }
  function removeIcon(id) { D.icons = D.icons.filter(i => i.id !== id); if (selIcon === id) selIcon = null; renderIcons(); saveIcons(); }
  function renderIcons() {
    const layer = $('#icon-layer'); layer.innerHTML = '';
    const mk = monthKey();
    for (const ic of D.icons) {
      if (ic.month && ic.month !== mk) continue;
      const n = el('div', 'dicon'); n.dataset.id = ic.id;
      if (ic.type === 'file' || ic.type === 'link') n.classList.add('sc');
      if (ic.id === selIcon) n.classList.add('sel');
      n.style.left = (ic.x * 100) + '%'; n.style.top = (ic.y * 100) + '%';
      const gl = el('div', 'gl'); gl.style.width = gl.style.height = ic.size + 'px';
      if (ic.type === 'emoji') { gl.textContent = ic.glyph; gl.style.fontSize = Math.round(ic.size * .84) + 'px'; }
      else if (ic.src) { const im = el('img'); im.src = ic.src; im.draggable = false; gl.appendChild(im); }
      else { gl.textContent = ic.type === 'link' ? '🌐' : '📄'; gl.style.fontSize = Math.round(ic.size * .8) + 'px'; }
      n.appendChild(gl);
      if (ic.label && ic.showLabel !== false) { const cap = el('div', 'cap', ic.label); cap.style.maxWidth = Math.max(70, ic.size * 2) + 'px'; n.appendChild(cap); }
      if (ic.month) n.appendChild(el('span', 'mo', '이번 달'));
      n.appendChild(el('span', 'x', '✕')); n.appendChild(el('span', 'rs', '◢'));
      n.title = ic.path ? `${ic.label}\n${ic.path}\n(더블클릭: 열기)` : '';
      layer.appendChild(n);
    }
  }
  const layer = $('#icon-layer');
  layer.addEventListener('pointerdown', e => {
    const n = e.target.closest('.dicon'); if (!n || e.button !== 0 || !iconMode) return;
    const ic = D.icons.find(i => i.id === n.dataset.id); if (!ic) return;
    e.preventDefault();
    if (e.target.classList.contains('x')) { removeIcon(ic.id); return; }
    selIcon = ic.id; layer.querySelectorAll('.dicon.sel').forEach(x => x.classList.remove('sel')); n.classList.add('sel');
    const b = $('#board').getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, ox = ic.x, oy = ic.y, os = ic.size;
    const resizing = e.target.classList.contains('rs'); const gl = n.querySelector('.gl');
    n.setPointerCapture(e.pointerId);
    const mv = ev => {
      if (resizing) { ic.size = Math.round(Math.min(260, Math.max(14, os + Math.max(ev.clientX - sx, ev.clientY - sy)))); gl.style.width = gl.style.height = ic.size + 'px'; if (!ic.src) gl.style.fontSize = Math.round(ic.size * .84) + 'px'; }
      else { ic.x = ox + (ev.clientX - sx) / b.width; ic.y = oy + (ev.clientY - sy) / b.height; clampIcon(ic); n.style.left = (ic.x * 100) + '%'; n.style.top = (ic.y * 100) + '%'; }
    };
    const up = () => { n.removeEventListener('pointermove', mv); n.removeEventListener('pointerup', up); saveIcons(); };
    n.addEventListener('pointermove', mv); n.addEventListener('pointerup', up);
  });
  layer.addEventListener('dblclick', e => { const n = e.target.closest('.dicon'); if (!n) return; const ic = D.icons.find(i => i.id === n.dataset.id); if (ic && ic.path) openIcon(ic); e.stopPropagation(); });
  async function openIcon(ic) { const r = await api.openFile(ic.path); if (r) toast('열 수 없어요: ' + r); }
  layer.addEventListener('contextmenu', e => {
    const n = e.target.closest('.dicon'); if (!n) return; e.preventDefault();
    const ic = D.icons.find(i => i.id === n.dataset.id); if (!ic) return;
    const items = [];
    if (ic.path) items.push(['열기', () => openIcon(ic)]);
    if (ic.type !== 'emoji') {
      const box = el('div'); box.style.padding = '4px 6px';
      const inp = el('input', 'inp'); inp.value = ic.label || ''; inp.placeholder = '이름'; inp.style.height = '30px';
      inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ic.label = inp.value.trim(); renderIcons(); saveIcons(); hideCtx(); } };
      inp.onchange = () => { ic.label = inp.value.trim(); renderIcons(); saveIcons(); };
      box.appendChild(inp); items.push(box);
      items.push([ic.showLabel === false ? '이름 보이기' : '이름 숨기기', () => { ic.showLabel = ic.showLabel === false; renderIcons(); saveIcons(); }]);
    }
    items.push('-');
    items.push([ic.month ? '매달 표시하기' : `이번 달(${cur.m + 1}월)에만 표시`, () => { ic.month = ic.month ? null : monthKey(); renderIcons(); saveIcons(); }]);
    items.push(['크게', () => { ic.size = Math.min(260, Math.round(ic.size * 1.25)); renderIcons(); saveIcons(); }]);
    items.push(['작게', () => { ic.size = Math.max(14, Math.round(ic.size / 1.25)); renderIcons(); saveIcons(); }]);
    items.push(['복제', () => addIcon({ ...ic, x: ic.x + .03, y: ic.y + .03 }, ic.x + .03, ic.y + .03)]);
    items.push('-'); items.push(['삭제', () => removeIcon(ic.id)]);
    ctxMenu(e.clientX, e.clientY, items);
  });
  const board = $('#board');
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => e.preventDefault());
  board.addEventListener('dragover', e => { e.preventDefault(); if ([...e.dataTransfer.types].includes('Files')) board.classList.add('dragover'); });
  board.addEventListener('dragleave', e => { if (!board.contains(e.relatedTarget)) board.classList.remove('dragover'); });
  board.addEventListener('drop', async e => {
    e.preventDefault(); board.classList.remove('dragover');
    const b = board.getBoundingClientRect(); let x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    const glyph = e.dataTransfer.getData('application/x-deskicon');
    if (glyph) { addIcon({ type: 'emoji', glyph, size: 40 }, x, y); return; }
    const files = [...e.dataTransfer.files];
    if (files.length) { for (const f of files) { const p = api.pathForFile(f); if (!p) continue; await addShortcut(p, x, y); x += .06; } return; }
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
    if (/^https?:\/\//i.test(url)) addLink(url, x, y);
  });
  async function addShortcut(p, x, y) {
    const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
    return addIcon({ type: 'file', path: p, label: name.replace(/\.(lnk|url|exe)$/i, ''), src: await api.fileIcon(p), size: 36 }, x, y);
  }
  function addLink(url, x, y) { let host = url; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { } return addIcon({ type: 'link', path: url, label: host, size: 34 }, x, y); }
  $('#pal-image').onclick = async () => { const r = await api.pickFile('image'); if (!r) return; if (r.error) return toast(r.error); addIcon({ type: 'image', src: r.dataUrl, size: 64 }, .5, .5); };
  $('#pal-file').onclick = async () => { const r = await api.pickFile('file'); if (r) addShortcut(r.path, .5, .5); };
  $('#pal-folder').onclick = async () => { const r = await api.pickFile('folder'); if (r) addShortcut(r.path, .5, .5); };
  $('#pal-link').onclick = () => {
    const box = el('div'); box.style.padding = '6px';
    const inp = el('input', 'inp'); inp.placeholder = 'https://… 입력 후 Enter'; inp.style.width = '260px';
    inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { let u = inp.value.trim(); if (!u) return; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; addLink(u, .5, .5); hideCtx(); } };
    box.appendChild(inp); const r = $('#pal-link').getBoundingClientRect(); ctxMenu(r.left, r.top - 50, [box]); setTimeout(() => inp.focus(), 20);
  };

  /* ───────── 설정 ───────── */
  function segBind(id, key, conv) {
    const seg = $(id);
    const paint = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', conv(b.dataset.v) === S[key]));
    seg.querySelectorAll('button').forEach(b => b.onclick = async () => { await setS(key, conv(b.dataset.v)); paint(); render(); });
    paint();
  }
  function openSettings() {
    closeAll(false);
    if (mode === 'background') api.edit('edit');
    segBind('#s-theme', 'dark', v => v === '1');
    segBind('#s-zoom', 'zoom', Number);
    segBind('#s-week', 'weekStart', Number);
    segBind('#s-view', 'viewMode', String);
    const chk = (id, key, after) => { const c = $(id); c.checked = !!S[key]; c.onchange = async () => { await setS(key, c.checked); if (after) after(); }; };
    chk('#s-holiday', 'showHoliday', render); chk('#s-sound', 'alarmSound'); chk('#s-auto', 'autostart'); chk('#s-desk', 'desktopInput'); chk('#s-missdot', 'missDot', render); chk('#s-misscarry', 'missCarry', render);
    renderCalList();
    api.syncGet().then(paintSync);
    { const c = $('#s-autopdf'); c.checked = S.autoPdf === true; c.onchange = () => setS('autoPdf', c.checked); paintPdf(); }
    // 실제 등록된 편집 단축키로 안내 (스케두와 겹치면 Ctrl+Alt+X)
    const hk = S.hotkey === '' ? '트레이 아이콘 더블클릭' : (S.hotkey || 'Ctrl+Shift+X');
    $('#set-hint').innerHTML = $('#set-hint').innerHTML.replace(/(Ctrl\+(Shift|Alt)\+X|트레이 아이콘 더블클릭)/, hk);
    api.appVersion().then(v => { const n = String(v || '').split('.')[0]; $('#app-ver').textContent = n ? (WEB ? `아이패드 Ver${n}` : `바탕달력 Ver${n}`) : ''; $('#app-ver').title = `버전 ${v}`; }).catch(() => { });
    $('#set-modal').hidden = false;
  }
  function renderCalList() {
    const box = $('#s-cals'); box.innerHTML = '';
    for (const c of D.calendars) {
      const row = el('div', 'ci');
      const col = el('button', 'pill'); col.style.cssText = `width:30px;height:30px;padding:0;background:${c.color};border-color:${c.color}`; col.title = '색상';
      col.onclick = () => {
        const r = col.getBoundingClientRect(); const sw = el('div', 'swatches');
        for (const [hex, n] of PALETTE) { const b = el('button'); b.title = n; b.style.background = hex; if (c.color === hex) b.classList.add('on'); b.onclick = () => { c.color = hex; api.saveCalendars(D.calendars); hideCtx(); renderCalList(); render(); }; sw.appendChild(b); }
        ctxMenu(r.left, r.bottom + 4, [sw]);
      };
      const nm = el('input', 'inp'); nm.value = c.name; nm.onchange = () => { c.name = nm.value.trim() || c.name; api.saveCalendars(D.calendars); render(); };
      const hideB = el('label', 'chk'); const hc = el('input'); hc.type = 'checkbox'; hc.checked = !c.hidden; hc.onchange = () => { c.hidden = !hc.checked; api.saveCalendars(D.calendars); render(); }; hideB.append(hc, document.createTextNode('보기'));
      const del = el('button', 'hb sm'); del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'; del.title = '캘린더 삭제';
      del.onclick = () => {
        if (D.calendars.length <= 1) return toast('캘린더는 하나 이상 있어야 해요.');
        const n = D.events.filter(e => e.calendarId === c.id).length, other = D.calendars.find(x => x !== c);
        const r = del.getBoundingClientRect();
        ctxMenu(r.left - 160, r.bottom, [[n ? `삭제 (일정 ${n}개는 '${other.name}'로 이동)` : '삭제', async () => {
          for (const e of D.events) if (e.calendarId === c.id) { e.calendarId = other.id; await api.saveEvent(e); }
          D.calendars = D.calendars.filter(x => x !== c); await api.saveCalendars(D.calendars); renderCalList(); render();
        }], ['취소', () => { }]]);
      };
      row.append(col, nm, hideB, del); box.appendChild(row);
    }
    const add = el('button', 'pill', '+ 캘린더 추가'); add.style.alignSelf = 'flex-start';
    add.onclick = () => { D.calendars.push({ id: 'c' + Date.now().toString(36), name: '새 캘린더', color: PALETTE[(D.calendars.length * 3) % PALETTE.length][0] }); api.saveCalendars(D.calendars); renderCalList(); };
    box.appendChild(add);
  }
  /* ───────── 5) 학사일정 한 번에 넣기 ───────── */
  let impRows = [];
  function openImport() {
    closeAll(false);
    if (mode === 'background') api.edit('edit');
    const t = new Date(), sy = t.getMonth() >= 2 ? t.getFullYear() : t.getFullYear() - 1;   // 3월부터 새 학년도
    const ys = $('#imp-year'); ys.innerHTML = '';
    for (const y of [sy - 1, sy, sy + 1]) { const o = el('option', '', `${y}학년도 (${y}.3 ~ ${y + 1}.2)`); o.value = y; ys.appendChild(o); }
    ys.value = sy + (t.getMonth() >= 10 || t.getMonth() <= 1 ? 1 : 0);   // 11월~2월에는 다가오는 학년도(3월 시작)를 기본으로
    const cs = $('#imp-cal'); cs.innerHTML = '';
    for (const c of D.calendars) { const o = el('option', '', c.name); o.value = c.id; cs.appendChild(o); }
    cs.value = D.calendars.some(c => c.id === S.lastCalendarId) ? S.lastCalendarId : D.calendars[0].id;
    $('#imp-text').value = ''; impRows = []; paintImport();
    $('#imp-modal').hidden = false; setTimeout(() => $('#imp-text').focus(), 80);
  }
  function paintImport() {
    const r = SchoolImport.parse($('#imp-text').value, +$('#imp-year').value);
    // 이미 있는 일정(같은 날·같은 제목)은 기본으로 빼 둠
    impRows = r.rows.map(x => ({ ...x, on: !D.events.some(e => e.title === x.title && e.start.slice(0, 10) === x.start), dup: D.events.some(e => e.title === x.title && e.start.slice(0, 10) === x.start) }));
    const list = $('#imp-list'); list.innerHTML = '';
    const fmt = k => { const d = R.parseYmd(k); return `${d.getFullYear() % 100}.${d.getMonth() + 1}.${d.getDate()}(${WD[d.getDay()]})`; };
    impRows.forEach((x, i) => {
      const row = el('div', 'imp-row' + (x.on ? '' : ' off'));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = x.on; cb.onchange = () => { x.on = cb.checked; row.classList.toggle('off', !x.on); sumImport(); };
      const hl = el('label', 'h'); const hc = el('input'); hc.type = 'checkbox'; hc.checked = x.holiday; hc.onchange = () => { x.holiday = hc.checked; }; hl.append(hc, document.createTextNode('휴일'));
      const t = el('div', 't', x.title); if (x.dup) t.appendChild(el('span', 'dup', '  (이미 있음)'));
      row.append(cb, el('div', 'd', x.start === x.end ? fmt(x.start) : `${fmt(x.start)}~${fmt(x.end).replace(/^\d+\./, '')}`), t, hl);
      list.appendChild(row);
    });
    if (r.skipped.length) list.appendChild(el('div', 'imp-skip', `날짜를 못 찾은 줄 ${r.skipped.length}개는 빼고 넣어요: ${r.skipped.slice(0, 3).join(' / ')}${r.skipped.length > 3 ? ' …' : ''}`));
    sumImport();
  }
  function sumImport() {
    const n = impRows.filter(x => x.on).length, h = impRows.filter(x => x.on && x.holiday).length;
    $('#imp-sum').innerHTML = impRows.length ? `일정 <b>${impRows.length}</b>개를 찾았어요. 그중 <b>${n}</b>개를 넣어요${h ? ` (휴일 ${h}개 포함)` : ''}. 넣지 않을 줄은 체크를 빼세요.` : '붙여넣으면 아래에 미리보기가 나와요.';
    $('#imp-go').disabled = !n; $('#imp-go').textContent = n ? `${n}개 넣기` : '넣기';
  }
  let impT = null;
  $('#imp-text').addEventListener('input', () => { clearTimeout(impT); impT = setTimeout(paintImport, 150); });
  $('#imp-year').onchange = paintImport;
  $('#imp-go').onclick = async () => {
    const cal = $('#imp-cal').value;
    const list = impRows.filter(x => x.on).map(x => ({ title: x.title, allDay: true, start: x.start, end: x.end, repeat: { freq: 'none', until: '' }, alarm: -1, calendarId: cal, holiday: !!x.holiday, memo: '', location: '' }));
    if (!list.length) return;
    D.events = await api.addMany(list);
    closeAll(true); render(); toast(`학사일정 ${list.length}개를 넣었어요.`);
  };
  $('#s-import-school').onclick = openImport;

  /* ───────── 6) 여러 컴퓨터 공유 (구글 드라이브 폴더) ───────── */
  const fmtTime = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${R.pad(d.getHours())}:${R.pad(d.getMinutes())}`; };
  function paintSync(st) {
    st = st || {};
    const box = $('#sync-state'), ind = $('#sync-ind');
    ind.hidden = !st.dir; ind.classList.toggle('err', !!st.error);
    ind.title = st.error ? `공유 오류: ${st.error}` : `여러 컴퓨터 공유 중 (마지막 맞춤 ${fmtTime(st.last)})`;
    if (!box) return;
    box.innerHTML = '';
    if (!st.dir) { box.textContent = WEB ? '지금은 이 아이패드에만 저장하고 있어요.' : '지금은 이 컴퓨터에만 저장하고 있어요.'; $('#s-sync-now').hidden = $('#s-sync-off').hidden = true; $('#s-sync-choose').textContent = WEB ? '구글 로그인으로 연결' : '공유 폴더 고르기'; return; }
    box.append(el('span', st.error ? 'err' : 'ok', st.error ? '⚠ 공유 오류 ' : '● 공유 중 '), document.createTextNode(st.dir));
    box.appendChild(el('div', '', st.error ? st.error : `마지막으로 맞춘 시각: ${fmtTime(st.last)}`));
    $('#s-sync-now').hidden = $('#s-sync-off').hidden = false; $('#s-sync-choose').textContent = WEB ? '다시 로그인' : '다른 폴더로 바꾸기';
  }
  $('#s-sync-choose').onclick = async () => { const st = await api.syncChoose(); paintSync(st); if (st && st.dir && !st.error) toast('공유를 시작했어요. 다른 컴퓨터에서도 같은 폴더를 고르세요.'); };
  function paintPdf() { const st = $('#pdf-state'); if (st) st.textContent = S.lastPdf ? `마지막으로 만든 시각: ${fmtTime(S.lastPdf)}` : ''; }
  $('#s-pdf-now').onclick = async () => {
    $('#pdf-state').textContent = 'PDF 만드는 중…';
    const r = await api.pdfNow();
    if (r && r.ok) { S.lastPdf = r.at; paintPdf(); toast('공유 폴더에 PDF를 저장했어요.'); }
    else { $('#pdf-state').textContent = (r && r.error) || 'PDF를 만들지 못했어요.'; }
  };
  $('#s-sync-now').onclick = async () => { paintSync(await api.syncNow()); toast('맞췄어요.'); };
  $('#s-sync-off').onclick = e => ctxMenu(e.clientX, e.clientY, [[WEB ? '공유 끄기 (이 아이패드 일정은 그대로 남아요)' : '공유 끄기 (이 컴퓨터 일정은 그대로 남아요)', async () => { paintSync(await api.syncOff()); toast('공유를 껐어요.'); }], ['취소', () => { }]]);

  $('#s-export').onclick = async () => { if (await api.exportData()) toast('백업 파일을 저장했어요.'); };
  $('#s-import').onclick = async () => { const r = await api.importData(); if (!r) return; if (r.error) return toast(r.error); D = r; S = D.settings; applySettings(); closeAll(false); render(); toast('백업을 불러왔어요.'); };
  $('#s-clear-icons').onclick = e => ctxMenu(e.clientX, e.clientY, [['아이콘을 모두 지우기', () => { D.icons = []; renderIcons(); saveIcons(); }], ['취소', () => { }]]);
  $('#s-quit').onclick = e => ctxMenu(e.clientX, e.clientY, [['바탕달력 종료하기', () => api.quit()], ['취소', () => { }]]);

  /* ───────── 메인 프로세스 신호 ───────── */
  api.onPush(({ type, payload }) => {
    if (type === 'mode') {
      mode = payload;
      document.body.classList.toggle('editing', mode !== 'background');
      document.body.classList.toggle('full', mode === 'edit');
      if (mode === 'background') { closeAll(false); if (iconMode) setIconMode(false); $('#q').blur(); }
    }
    if (type === 'desktop') onDesktop(payload);
    if (type === 'syncStatus') paintSync(payload);
    if (type === 'undoable') {
      $('#undo-msg').textContent = `'${payload.title}'${payload.onlyDate ? ` (${payload.onlyDate.slice(5).replace('-', '/')})` : ''} 삭제됨`;
      $('#undo').hidden = false; clearTimeout(undoT); undoT = setTimeout(() => $('#undo').hidden = true, 8000);
    }
    if (type === 'activated' && modalOpen()) {
      // 창이 실제로 활성화된 뒤 입력칸 포커스를 다시 잡아 한글 입력기(IME)를 연결
      const a = document.activeElement;
      if (a && a.matches('input:not([type=date]),textarea')) { a.blur(); setTimeout(() => a.focus(), 0); } else $('#f-title').focus();
    }
    if (type === 'reload') { api.getData().then(d => { D = d; S = D.settings; applySettings(); render(); }); }
    if (type === 'editorOpen') {
      api.getData().then(d => {
        D = d; S = D.settings; applySettings();
        if (payload.eventId) { const ev = D.events.find(e => e.id === payload.eventId); if (ev) return openForm({ occ: { event: ev, start: payload.start, end: payload.end, time: payload.time } }); }
        openForm({ date: payload.date || R.ymd(new Date()) });
      });
    }
    if (type === 'iconMode') setIconMode(true);
    if (type === 'openSettings') openSettings();
    if (type === 'settings') { if (PRINT) return; Object.assign(S, payload); applySettings(); paintPdf(); }
    if (type === 'dayChanged') render();
    if (type === 'gotoDate') { const d = R.parseYmd(payload); rollOff = Math.round(R.dayDiff(weekStartOf(new Date()), weekStartOf(d)) / 7); cur = { y: d.getFullYear(), m: d.getMonth() }; sideDate = d; render(); selectDate(payload); }
  });
  // 3) 삭제 되돌리기
  let undoT = null;
  $('#undo-btn').onclick = async () => {
    clearTimeout(undoT); $('#undo').hidden = true;
    const r = await api.undoDelete(); if (!r) return;
    D.events = r; render(); toast('삭제를 되돌렸어요.');
  };
  let rt = null;
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !EDITOR) render(); });
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 60); });
  setInterval(() => render(), 5 * 60 * 1000); // 지난 일정 흐리게 갱신
  applySettings();
  if (!EDITOR) api.syncGet().then(paintSync).catch(() => { });
  await document.fonts.ready;
  if (!EDITOR) render();
  if (PRINT) {
    const n = new Date();
    $('#print-stamp').textContent = `${n.getMonth() + 1}월 ${n.getDate()}일 ${R.pad(n.getHours())}:${R.pad(n.getMinutes())} 기준`;
    setTimeout(() => { render(); setTimeout(() => api.pdfReady(), 300); }, 300);
  }

  /* ───────── 브라우저 미리보기용 가짜 API ───────── */
  function makeMock() {
    const t = new Date(), k = n => R.ymd(R.addDays(t, n));
    let push = () => { };
    const st = {
      calendars: [{ id: 'c1', name: '캘린더', color: '#7986CB' }, { id: 'c2', name: '학교', color: '#E67C73' }],
      events: [
        { id: 'a', title: '2학기 중간고사', allDay: true, start: k(1), end: k(3), calendarId: 'c2', repeat: { freq: 'none' }, alarm: 0 },
        { id: 'b', title: '부장회의', allDay: false, start: k(0) + 'T15:30', end: k(0) + 'T16:30', calendarId: 'c2', repeat: { freq: 'none' }, alarm: 10, location: '본관 2층 회의실' },
        { id: 'c', title: '국제교류 화상회의', allDay: false, start: k(-4) + 'T09:00', end: k(-4) + 'T10:00', calendarId: 'c1', repeat: { freq: 'none' }, alarm: -1 },
        { id: 'd', title: '방과후(4)', allDay: true, start: k(-2), end: k(-2), calendarId: 'c1', repeat: { freq: 'none' } },
        { id: 'e', title: '제안 설명회', allDay: false, start: k(-2) + 'T11:00', end: k(-2) + 'T12:00', calendarId: 'c1', repeat: { freq: 'none' } },
        { id: 'f', title: '좋은 수업(5교시)', allDay: false, start: k(-2) + 'T13:50', end: k(-2) + 'T14:40', calendarId: 'c2', repeat: { freq: 'none' } },
        { id: 'g', title: '야영수련회', allDay: true, start: k(5), end: k(6), calendarId: 'c2', repeat: { freq: 'none' } },
        { id: 'h', title: '사전답사', allDay: true, start: k(5), end: k(5), calendarId: 'c1', repeat: { freq: 'none' } },
        { id: 'j', title: '수학여행', allDay: true, start: k(6), end: k(6), calendarId: 'c1', repeat: { freq: 'none' } },
        { id: 'i', title: '세특 입력 마감', allDay: true, start: k(9), end: k(9), calendarId: 'c2', repeat: { freq: 'none' }, color: '#F6BF26' },
        { id: 'l', title: '학부모 상담', allDay: false, start: k(-13) + 'T16:00', end: k(-13) + 'T17:00', calendarId: 'c1', repeat: { freq: 'none' } },
      ],
      icons: [{ id: 'i1', type: 'emoji', glyph: '📚', x: .64, y: .5, size: 40 }],
      settings: { bgOpacity: 100, dark: false, zoom: 1, locked: false, autostart: true, weekStart: 0, showHoliday: true, alarmSound: true, lastCalendarId: 'c1', showSidebar: false, sidePanelType: '일', desktopInput: true, missDot: true, missCarry: true },
    };
    window.__push = m => push(m); window.__mockStore = st;   // 미리보기·시험용 (실제 프로그램에서는 쓰지 않음)
    return {
      getData: async () => st,
      saveEvent: async ev => { if (!ev.id) { ev.id = 'm' + Math.random(); st.events.push(ev); } else st.events = st.events.map(x => x.id === ev.id ? ev : x); return st.events; },
      deleteEvent: async (id, only) => { const e = st.events.find(x => x.id === id); if (!e) return st.events; st._undo = JSON.parse(JSON.stringify(e)); if (only) e.exdates = [...(e.exdates || []), only]; else st.events = st.events.filter(x => x.id !== id); push({ type: 'undoable', payload: { title: e.title, onlyDate: only || '' } }); return st.events; },
      addMany: async list => { list.forEach((e, i) => { e.id = 'imp' + i + Math.random(); st.events.push(e); }); return st.events; },
      appVersion: async () => '28.0.0',
      pdfNow: async () => ({ ok: true, at: new Date().toISOString() }), pdfReady: () => { window.__pdfReady = true; },
      syncGet: async () => st._sync || {}, syncChoose: async () => (st._sync = { dir: 'G:\\내 드라이브\\바탕달력', last: new Date().toISOString(), error: '' }), syncNow: async () => st._sync, syncOff: async () => (st._sync = {}),
      undoDelete: async () => { if (!st._undo) return null; const u = st._undo; st._undo = null; const i = st.events.findIndex(x => x.id === u.id); if (i >= 0) st.events[i] = u; else st.events.push(u); return st.events; },
      setOrders: async map => { for (const e of st.events) if (map[e.id] !== undefined) e.order = map[e.id]; return st.events; },
      saveCalendars: async c => c, saveIcons: async () => true, setSetting: async (n, v) => { st.settings[n] = v; return st.settings; },
      fileIcon: async () => null, openFile: async () => '', pickFile: async () => null, pathForFile: f => f.name,
      exportData: async () => true, importData: async () => null, hide: () => { }, quit: () => { },
      toBottom: () => push({ type: 'mode', payload: 'background' }), edit: kind => push({ type: 'mode', payload: kind || 'edit' }),
      openEditor: p => { push({ type: 'mode', payload: 'quick' }); push({ type: 'editorOpen', payload: p }); }, editorDone: c => { push({ type: 'mode', payload: 'background' }); if (c) push({ type: 'reload' }); },
      onPush: cb => { push = cb; },
    };
  }
})();
