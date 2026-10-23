/* 바탕달력 아이패드 웹앱 — PC 화면(app.js)이 쓰는 window.api 를 브라우저에서 흉내 냄
   - 데이터: 이 기기 브라우저 저장소(localStorage)
   - 공유: 구글 로그인(drive.file 권한) → 휴대폰 앱과 같은 '바탕달력_공유데이터.json' 을 읽고 씀
   - 합치기 규칙은 PC sync.js / 휴대폰 SyncMerge 와 같음 */
(function () {
  'use strict';
  const VERSION = '1';
  const CLIENT_ID = window.WEB_CLIENT_ID || '';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FILE_NAME = '바탕달력_공유데이터.json', FOLDER_NAME = '바탕달력_공유';
  const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const KEY = 'deskcal-web-data', KCFG = 'deskcal-web-sync';
  const nowIso = () => new Date().toISOString();
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { } },
  };

  /* ───── 데이터 ───── */
  const DEFAULT_SETTINGS = { bgOpacity: 100, dark: false, zoom: 1, weekStart: 0, showHoliday: true, lastCalendarId: 'c1', showSidebar: true,
    sidePanelType: '일', missDot: true, missCarry: true, viewMode: 'month', autoPdf: false };
  const st = ls.get(KEY, null) || {
    calendars: [{ id: 'c1', name: '캘린더', color: '#7986CB' }, { id: 'c2', name: '학교', color: '#E67C73' }],
    events: [], deleted: {}, calUpdated: '', icons: [], settings: {},
  };
  st.settings = { ...DEFAULT_SETTINGS, ...(st.settings || {}) };
  st.events = st.events || []; st.deleted = st.deleted || {}; st.icons = [];
  let push = () => { };
  function saveLocal(changed = true) {
    if (!ls.set(KEY, st)) push({ type: 'syncStatus', payload: status({ error: '이 기기에 저장하지 못했어요 (저장 공간 부족).' }) });
    if (changed) scheduleSync(1500);
  }
  const newId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const applyZoom = () => { document.documentElement.style.zoom = String(st.settings.zoom || 1); };

  /* ───── 합치기 (PC sync.js merge 와 같음) ───── */
  function mergeDeleted(a = {}, b = {}) { const out = { ...a }; for (const [id, t] of Object.entries(b)) if (!out[id] || out[id] < t) out[id] = t; return out; }
  function merge(local, remote) {
    const deleted = mergeDeleted(local.deleted, remote.deleted);
    const byId = new Map();
    for (const e of [...(remote.events || []), ...(local.events || [])]) { const cur = byId.get(e.id); if (!cur || (e.updated || '') >= (cur.updated || '')) byId.set(e.id, e); }
    const events = [...byId.values()].filter(e => !(deleted[e.id] && deleted[e.id] >= (e.updated || '')));
    const lNewer = (local.calUpdated || '') >= (remote.calUpdated || '');
    const base = (lNewer ? local.calendars : remote.calendars) || [], other = (lNewer ? remote.calendars : local.calendars) || [];
    const calendars = [...base];
    for (const c of other) if (!calendars.some(x => x.id === c.id) && !deleted['cal:' + c.id]) calendars.push(c);
    const calUpdated = lNewer ? local.calUpdated : remote.calUpdated;
    const cutoff = new Date(Date.now() - 180 * 864e5).toISOString();
    for (const [id, t] of Object.entries(deleted)) if (t < cutoff) delete deleted[id];
    return { events, calendars: calendars.filter(c => !deleted['cal:' + c.id]), calUpdated, deleted };
  }
  const keyOf = p => (p.events || []).map(e => e.id + '@' + (e.updated || '')).sort().join('|') + '#' +
    (p.calendars || []).map(c => c.id + c.name + c.color + !!c.hidden).join('|') + '#' + Object.keys(p.deleted || {}).sort().join('|');
  // 앞의 JSON 한 덩어리만 (예전 휴대폰 앱이 남긴 꼬리가 있어도 읽기)
  function jsonEnd(t) {
    let i = 0; while (i < t.length && /[\s﻿]/.test(t[i])) i++;
    let depth = 0, inStr = false, esc = false;
    for (; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) return i + 1; }
    }
    return -1;
  }
  function parseShared(text) {
    let raw, broken = false;
    try { raw = JSON.parse(text); } catch (e) { const end = jsonEnd(text); if (end < 0) throw e; raw = JSON.parse(text.slice(0, end).replace(/^﻿/, '')); broken = true; }
    if (!raw || !Array.isArray(raw.events)) throw new Error('공유 파일 형식이 올바르지 않아요.');
    return { raw, broken };
  }
  const sharedPart = () => ({ events: st.events, calendars: st.calendars, calUpdated: st.calUpdated || '', deleted: st.deleted || {} });

  /* ───── 구글 로그인 (주소 이동 방식: 홈 화면 앱에서도 동작) ───── */
  const cfg = ls.get(KCFG, {}) || {};   // { fileId, folder, token, exp, last, error, needLogin }
  const saveCfg = () => ls.set(KCFG, cfg);
  const redirectUri = () => location.origin + location.pathname;
  function login(silent) {
    if (!CLIENT_ID) { cfg.error = '웹 로그인 설정(클라이언트 ID)이 아직 없어요.'; saveCfg(); return false; }
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem('deskcal-oauth-state', state);
    if (silent) sessionStorage.setItem('deskcal-silent-at', String(Date.now()));
    const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE,
      include_granted_scopes: 'true', state, prompt: silent ? 'none' : 'select_account' });
    if (cfg.email) p.set('login_hint', cfg.email);
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
    return true;
  }
  // 로그인에서 돌아왔을 때 (#access_token=…)
  (function takeToken() {
    if (!location.hash || location.hash.length < 2) return;
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.has('access_token') && !h.has('error')) return;
    const okState = h.get('state') && h.get('state') === sessionStorage.getItem('deskcal-oauth-state');
    history.replaceState(null, '', location.pathname + location.search);
    if (!okState) return;
    if (h.get('access_token')) {
      cfg.token = h.get('access_token'); cfg.exp = Date.now() + (Number(h.get('expires_in') || 3600) - 120) * 1000;
      cfg.needLogin = false; cfg.error = ''; cfg.on = true;
    } else {
      cfg.token = ''; cfg.needLogin = true;
      cfg.error = h.get('error') === 'access_denied' ? '구글 로그인을 취소했어요.' : '구글 로그인이 필요해요. ☁ 를 눌러 다시 로그인하세요.';
    }
    saveCfg();
  })();
  const tokenOk = () => cfg.token && cfg.exp && Date.now() < cfg.exp;
  // 공유 중인데 로그인이 만료됐으면, 화면을 그리기 전에 조용히 다시 받아 옴 (2분에 한 번만 시도)
  if (cfg.on && !tokenOk() && !cfg.needLogin && navigator.onLine) {
    const last = +(sessionStorage.getItem('deskcal-silent-at') || 0);
    if (Date.now() - last > 120000) login(true);
  }

  async function call(method, url, body, ctype) {
    const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + cfg.token, ...(ctype ? { 'Content-Type': ctype } : {}) }, body });
    if (r.status === 401) { cfg.token = ''; cfg.needLogin = true; saveCfg(); throw new Error('구글 로그인이 만료됐어요. ☁ 를 눌러 다시 로그인하세요.'); }
    if (!r.ok) { let m = ''; try { m = (await r.json()).error.message; } catch { } throw new Error(`구글 드라이브 오류 (${r.status}) ${m}`); }
    return r;
  }
  const fileText = p => JSON.stringify({ app: '바탕달력', format: 1, savedAt: nowIso(), ...p }, null, 1);

  async function findOrCreate() {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const found = await (await call('GET', `${API}/files?q=${q}&orderBy=modifiedTime%20desc&fields=files(id,parents)&spaces=drive`)).json();
    if (found.files && found.files.length) {
      cfg.fileId = found.files[0].id; cfg.folder = FOLDER_NAME;
      const pid = (found.files[0].parents || [])[0];
      if (pid) try { cfg.folder = (await (await call('GET', `${API}/files/${pid}?fields=name`)).json()).name || FOLDER_NAME; } catch { }
    } else {
      // 휴대폰 앱이 만든 공유 파일을 못 찾았을 때 새로 만들면 일정이 두 갈래로 나뉠 수 있어, 만들지 않고 알림
      throw new Error('구글 드라이브에서 바탕달력_공유데이터.json 을 찾지 못했어요. 휴대폰 앱과 같은 구글 계정으로 로그인했는지 확인하세요.');
      // eslint-disable-next-line no-unreachable
      const folder = await (await call('POST', `${API}/files?fields=id`, JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }), 'application/json')).json();
      const b = 'deskcal' + Date.now();
      const meta = JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', parents: [folder.id] });
      const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${fileText(sharedPart())}\r\n--${b}--`;
      cfg.fileId = (await (await call('POST', `${UPLOAD}/files?uploadType=multipart&fields=id`, body, `multipart/related; boundary=${b}`)).json()).id;
      cfg.folder = FOLDER_NAME;
    }
    saveCfg();
  }

  let busy = false, again = false, syncT = null;
  function status(extra) {
    return { dir: cfg.on ? `구글 드라이브 · ${cfg.folder || FOLDER_NAME}` : null, last: cfg.last || '', error: (extra && extra.error) || cfg.error || '' };
  }
  const tell = () => { push({ type: 'syncStatus', payload: status() }); document.body.classList.toggle('need-login', !!(cfg.on && cfg.needLogin)); };
  function scheduleSync(ms) { if (!cfg.on) return; clearTimeout(syncT); syncT = setTimeout(() => sync(), ms); }
  async function sync() {
    if (!cfg.on) return status();
    if (!tokenOk()) { cfg.needLogin = true; if (!cfg.error) cfg.error = '구글 로그인이 필요해요. ☁ 를 눌러 다시 로그인하세요.'; saveCfg(); tell(); return status(); }
    if (busy) { again = true; return status(); }
    busy = true;
    try {
      if (!cfg.fileId) await findOrCreate();
      const text = await (await call('GET', `${API}/files/${cfg.fileId}?alt=media`)).text();
      const { raw, broken } = parseShared(text);
      const before = keyOf(sharedPart());
      const m = merge(sharedPart(), raw);
      st.events = m.events; st.calendars = m.calendars.length ? m.calendars : st.calendars; st.calUpdated = m.calUpdated; st.deleted = m.deleted;
      saveLocal(false);
      if (keyOf(sharedPart()) !== before) push({ type: 'reload' });
      if (broken || keyOf(sharedPart()) !== keyOf(raw)) await call('PATCH', `${UPLOAD}/files/${cfg.fileId}?uploadType=media`, fileText(sharedPart()), 'application/json');
      cfg.last = nowIso(); cfg.error = ''; cfg.needLogin = false;
    } catch (e) {
      if (/404/.test(String(e.message))) { cfg.fileId = ''; cfg.error = '공유 파일을 찾지 못했어요. [지금 맞추기]를 다시 눌러 보세요.'; }
      else cfg.error = String(e.message || e);
    } finally { busy = false; saveCfg(); tell(); }
    if (again) { again = false; scheduleSync(300); }
    return status();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(300); });
  window.addEventListener('online', () => scheduleSync(500));
  setInterval(() => { if (!document.hidden) sync(); }, 60 * 1000);
  if (cfg.on) setTimeout(() => sync(), 400);

  /* ───── 백업 파일 ───── */
  function download(name, text) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function pickJson() {
    return new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsText(f); };
      inp.click();
    });
  }

  let lastDeleted = null;
  const pad = n => String(n).padStart(2, '0');
  window.WEB = true;
  window.api = {
    getData: async () => st,
    appVersion: async () => VERSION,
    saveEvent: async ev => {
      if (!ev.id) { ev.id = newId(); ev.created = nowIso(); st.events.push(ev); }
      else { const i = st.events.findIndex(x => x.id === ev.id); if (i >= 0) st.events[i] = ev; else st.events.push(ev); }
      ev.updated = nowIso();
      if (st.deleted[ev.id]) delete st.deleted[ev.id];
      st.settings.lastCalendarId = ev.calendarId;
      saveLocal(); return st.events;
    },
    deleteEvent: async (id, onlyDate) => {
      const ev = st.events.find(x => x.id === id); if (!ev) return st.events;
      lastDeleted = { snapshot: JSON.parse(JSON.stringify(ev)) };
      if (onlyDate) { ev.exdates = [...(ev.exdates || []), onlyDate]; ev.updated = nowIso(); }
      else { st.events = st.events.filter(x => x.id !== id); st.deleted = { ...st.deleted, [id]: nowIso() }; }
      saveLocal();
      setTimeout(() => push({ type: 'undoable', payload: { title: ev.title || '(제목 없음)', onlyDate: onlyDate || '' } }), 0);
      return st.events;
    },
    undoDelete: async () => {
      if (!lastDeleted) return null;
      const ev = { ...lastDeleted.snapshot, updated: nowIso() }; lastDeleted = null;
      const i = st.events.findIndex(x => x.id === ev.id); if (i >= 0) st.events[i] = ev; else st.events.push(ev);
      delete st.deleted[ev.id]; saveLocal(); return st.events;
    },
    addMany: async list => {
      const t = nowIso();
      list.forEach((ev, i) => { ev.id = 'e' + Date.now().toString(36) + i.toString(36) + Math.random().toString(36).slice(2, 5); ev.created = ev.updated = t; st.events.push(ev); });
      saveLocal(); return st.events;
    },
    setOrders: async map => {
      const t = nowIso();
      for (const ev of st.events) if (Object.prototype.hasOwnProperty.call(map, ev.id) && ev.order !== map[ev.id]) { ev.order = map[ev.id]; ev.updated = t; }
      saveLocal(); return st.events;
    },
    saveCalendars: async cals => {
      const t = nowIso();
      for (const c of st.calendars) if (!cals.some(x => x.id === c.id)) st.deleted = { ...st.deleted, ['cal:' + c.id]: t };
      st.calendars = cals; st.calUpdated = t; saveLocal(); return cals;
    },
    saveIcons: async () => true,
    setSetting: async (n, v) => { st.settings[n] = v; if (n === 'zoom') applyZoom(); saveLocal(false); push({ type: 'settings', payload: st.settings }); return st.settings; },
    syncGet: async () => { setTimeout(tell, 0); return status(); },
    syncChoose: async () => { cfg.on = true; cfg.needLogin = false; saveCfg(); login(false); return status(); },
    syncNow: async () => { if (cfg.on && !tokenOk()) { login(false); return status(); } return sync(); },
    syncOff: async () => { for (const k of ['on', 'fileId', 'token', 'exp', 'error', 'needLogin', 'last']) delete cfg[k]; saveCfg(); tell(); return status(); },
    pdfNow: async () => ({ error: '아이패드에서는 PDF를 만들지 않아요.' }), pdfReady: () => { },
    exportData: async () => { const d = new Date(); download(`바탕달력_백업_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`, JSON.stringify(st, null, 1)); return true; },
    importData: async () => {
      const text = await pickJson(); if (!text) return null;
      try {
        const r = JSON.parse(text);
        if (!Array.isArray(r.events)) return { error: '바탕달력 백업 파일이 아니에요.' };
        st.events = r.events; st.calendars = (r.calendars && r.calendars.length) ? r.calendars : st.calendars;
        st.deleted = r.deleted || {}; st.calUpdated = nowIso();
        saveLocal(); return st;
      } catch { return { error: '백업 파일을 읽을 수 없어요.' }; }
    },
    openFile: async p => { if (/^https?:\/\//i.test(p)) window.open(p, '_blank', 'noopener'); return ''; },
    fileIcon: async () => null, pickFile: async () => null, pathForFile: () => '',
    hide: () => { }, toBottom: () => { }, edit: () => { }, quit: () => { }, openEditor: () => { }, editorDone: () => { }, editorSize: () => { },
    onPush: cb => { push = cb; },
  };
  applyZoom();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
})();
