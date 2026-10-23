/* 학사일정 붙여넣기 해석
   지원하는 모양 (엑셀·한글·메모장에서 복사한 것)
   - "3월 2일(월) 입학식"   "3.2 입학식"   "2027-03-02 입학식"   "3/2 입학식"
   - 기간: "3.2~3.4 수련회"   "3월 2일 ~ 4일 수련회"   "7.20(화)~8.15(일) 여름방학"
   - 엑셀 칸: "3 ⇥ 2 ⇥ 월 ⇥ 입학식" (월·일·요일·행사)   "입학식 ⇥ 3.2" (행사가 앞)
   - 연도가 없으면 학년도 기준: 3~12월은 그해, 1~2월은 다음 해 */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const WEEK = '(?:\\s*[\\(（]\\s*[월화수목금토일](?:요일)?\\s*[\\)）])?';
  const DATE = '(?:(\\d{4})\\s*[.\\-/년]\\s*)?(\\d{1,2})\\s*[.\\-/월]\\s*(\\d{1,2})\\s*일?\\.?' + WEEK;
  const RANGE_TAIL = '\\s*[~∼〜\\-–—]\\s*(?:' + DATE + '|(\\d{1,2})\\s*일?' + WEEK + ')';
  const reStart = new RegExp('^\\s*' + DATE + '(?:' + RANGE_TAIL + ')?\\s*[:：\\-–|·]?\\s*(.*)$');
  const reWhole = new RegExp('^\\s*' + DATE + '(?:' + RANGE_TAIL + ')?\\s*$');
  const HOLIDAY = /(재량\s*휴업|휴업일|개교\s*기념|대체\s*공휴|임시\s*공휴|휴무일)/;

  function ymdOf(y, m, d, schoolYear) {
    m = +m; d = +d;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const yy = y ? +y : (m >= 3 ? schoolYear : schoolYear + 1);
    const dt = new Date(yy, m - 1, d);
    if (dt.getMonth() !== m - 1) return null;          // 2월 30일 같은 날짜 거르기
    return `${yy}-${pad(m)}-${pad(d)}`;
  }
  // 정규식 결과 → { start, end }
  function datesFrom(g, schoolYear) {
    const s = ymdOf(g[1], g[2], g[3], schoolYear);
    if (!s) return null;
    let e = s;
    if (g[5] !== undefined && g[6] !== undefined) e = ymdOf(g[4] || g[1], g[5], g[6], schoolYear) || s;        // ~4.3
    else if (g[7] !== undefined) e = ymdOf(g[1], g[2], g[7], schoolYear) || s;                                   // ~4일 (같은 달)
    if (e < s) e = s;
    return { start: s, end: e };
  }
  const clean = t => t.replace(/\s+/g, ' ').replace(/^[\s:：\-–|·,]+|[\s,]+$/g, '').trim();

  function parseLine(line, schoolYear) {
    const cells = line.split('\t').map(c => c.trim()).filter(c => c !== '');
    if (!cells.length) return null;
    // ① 엑셀: 월 ⇥ 일 ⇥ (요일) ⇥ 행사
    if (cells.length >= 3 && /^\d{1,2}(월)?$/.test(cells[0]) && /^\d{1,2}(일)?$/.test(cells[1])) {
      const s = ymdOf(null, parseInt(cells[0], 10), parseInt(cells[1], 10), schoolYear);
      let rest = cells.slice(2);
      if (rest.length && /^[월화수목금토일](요일)?$/.test(rest[0])) rest = rest.slice(1);
      const title = clean(rest.join(' '));
      return s && title ? { start: s, end: s, title } : null;
    }
    // ② 줄 맨 앞에 날짜
    const joined = cells.join(' ');
    const g = joined.match(reStart);
    if (g) {
      const d = datesFrom(g, schoolYear);
      const title = clean(g[g.length - 1] || '');
      if (d && title) return { ...d, title };
    }
    // ③ 날짜가 다른 칸에 있음: "입학식 ⇥ 3.2"
    for (let i = 0; i < cells.length; i++) {
      const m = cells[i].match(reWhole);
      if (!m) continue;
      const d = datesFrom(m, schoolYear);
      const title = clean(cells.filter((_, j) => j !== i && !/^[월화수목금토일](요일)?$/.test(cells[j])).join(' '));
      if (d && title) return { ...d, title };
    }
    return null;
  }

  // 결과: [{ start, end, title, holiday, line }], 못 읽은 줄: skipped
  function parse(text, schoolYear) {
    const rows = [], skipped = [];
    let lastMonth = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.replace(/ /g, ' ');
      if (!line.trim()) continue;
      let r = parseLine(line, schoolYear);
      // 엑셀에서 '월' 칸이 병합되어 비어 있는 경우: "⇥ 5 ⇥ 화 ⇥ 행사" → 바로 위 줄의 월 사용
      if (!r && lastMonth) {
        const cells = line.split('\t').map(c => c.trim()).filter(c => c !== '');
        if (cells.length >= 2 && /^\d{1,2}(일)?$/.test(cells[0])) r = parseLine(`${lastMonth}\t${line.trim()}`, schoolYear);
      }
      if (r) { r.holiday = HOLIDAY.test(r.title); r.line = line.trim(); rows.push(r); lastMonth = +r.start.slice(5, 7); }
      else skipped.push(line.trim());
    }
    return { rows, skipped };
  }

  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SchoolImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
