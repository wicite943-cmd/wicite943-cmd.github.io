/* 날짜·반복 일정 계산 (메인/렌더러 공용) */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dayDiff = (a, b) => Math.round((parseYmd(ymd(b)) - parseYmd(ymd(a))) / 86400000);
  const timeOf = s => (s && s.length > 10 ? s.slice(11, 16) : '');

  // 반복 규칙에 해당하는 날인지 (d: 후보일, s: 원래 시작일)
  function matches(freq, d, s) {
    switch (freq) {
      case 'daily': return true;
      case 'weekdays': { const w = d.getDay(); return w >= 1 && w <= 5; }
      case 'weekly': return d.getDay() === s.getDay();
      case 'biweekly': return d.getDay() === s.getDay() && (dayDiff(s, d) / 7) % 2 === 0;
      case 'monthly': return d.getDate() === s.getDate();
      case 'yearly': return d.getDate() === s.getDate() && d.getMonth() === s.getMonth();
      default: return false;
    }
  }

  /* 범위 [from, to] (Date) 안에 걸치는 모든 발생을 반환
     반환: [{ event, start:'YYYY-MM-DD', end:'YYYY-MM-DD', time:'HH:mm' }] (end는 포함일) */
  function occurrences(events, from, to) {
    const out = [];
    for (const ev of events) {
      const s = parseYmd(ev.start), e = parseYmd(ev.end || ev.start);
      const span = Math.max(0, dayDiff(s, e));
      const freq = (ev.repeat && ev.repeat.freq) || 'none';
      const exdates = ev.exdates || [];
      if (freq === 'none') {
        if (e >= from && s <= to) out.push({ event: ev, start: ymd(s), end: ymd(e), time: ev.allDay ? '' : timeOf(ev.start) });
        continue;
      }
      const until = ev.repeat.until ? parseYmd(ev.repeat.until) : null;
      let d = addDays(from, -span);
      if (d < s) d = new Date(s);
      for (; d <= to; d = addDays(d, 1)) {
        if (until && d > until) break;
        if (!matches(freq, d, s)) continue;
        const key = ymd(d);
        if (exdates.includes(key)) continue;
        out.push({ event: ev, start: key, end: ymd(addDays(d, span)), time: ev.allDay ? '' : timeOf(ev.start) });
      }
    }
    return out;
  }

  // 완료 여부: 반복 일정은 날짜별(doneDates), 한 번짜리는 done
  const isRepeat = ev => !!(ev.repeat && ev.repeat.freq && ev.repeat.freq !== 'none');
  const isDone = o => isRepeat(o.event) ? (o.event.doneDates || []).includes(o.start) : !!o.event.done;
  const api = { pad, ymd, parseYmd, addDays, dayDiff, timeOf, occurrences, isRepeat, isDone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recur = api;
})(typeof window !== 'undefined' ? window : globalThis);
