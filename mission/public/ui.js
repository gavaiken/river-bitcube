// Mission control v2: the shared shell (docs/mission-ui.md). One ES module, no dependencies, no build step.
// Every page does this:
//
//   <head>
//     <meta charset="utf-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
//     <meta name="color-scheme" content="light dark">
//     <meta name="theme-color" content="#f4f1ea" media="(prefers-color-scheme: light)">
//     <meta name="theme-color" content="#0e141a" media="(prefers-color-scheme: dark)">
//     <title>Status · Mission control</title>
//     <link rel="manifest" href="/manifest.webmanifest">
//     <link rel="icon" href="/icon.svg" type="image/svg+xml">
//     <link rel="apple-touch-icon" href="/icon-192.png">
//     <link rel="stylesheet" href="/v2.css">
//     <script>try { const t = localStorage.getItem('mc-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch {}</script>
//   </head>
//   <body><main>…the page's sections…</main><script type="module" src="/status.js"></script></body>
//
//   import { mountShell, poll, tick, art, fmt, control, confirm, sheet, api, esc, md, mark, chip, WORD, MARK, goto } from '/ui.js';
//   import { derive } from '/model.js';
//   const shell = mountShell({ page: 'status', title: 'Status' });
//   const p = poll('/api/status', { every: 5000,
//     onData: () => { shell.setAge(0); shell.setStale(null); render(); },
//     onError: (e, downForMs) => { shell.setStale(downForMs > 30_000 ? 'down' : downForMs > 12_000 ? 'warning' : null); render(); } });
//   function render() {               // the model judges on the server's clock, carried forward since its last answer (serverNow)
//     const m = p.last ? derive(p.last, serverNow()) : null;
//     art.setSeason(m?.show.weights ?? null);
//     …
//   }
//   tick(() => refreshAges());        // once a second, for ages only; never re-render rows under a thumb
//
// The shell owns: the river art (three fixed layers), the header (wordmark, page title, "Updated N s ago", ⋯),
// the bottom tab bar (Status · Lights · Studio chat; a pill at the top from 900 px), the menu sheet (Who to call
// from GET /api/contacts, Recent from GET /api/history, Check now → POST /api/control/check, Theme, the links,
// Log out with a confirm), one <dialog class="sheet"> every sheet and confirm reuses, and the theme override
// remembered in localStorage 'mc-theme'. After Check now the shell fires `document` event 'mc:check' so a page can
// poll at once; after a theme change, 'mc:theme' (detail: 'auto' | 'light' | 'dark').
import { api as rawApi, esc, md, plainError, noAnswerText, POLL_TIMEOUT_MS } from '/app.js';
import { dur as modelDur, CONTACTS, TZ, ctlInit, ctlStep, ctlView, applyingWords, applyingText, confirmingWords, CONFIRMING_SAID, unconfirmedWords,
  notSentWords, failWords, EXPECT_S, newRequestId, heldWords, heldMaybe, ownVerdict, confirmLimitS, liveNews, byMinute, UNKNOWN_ANSWERS, NOT_RECEIVED,
  neverGotWords, elapsedClock, REMEMBERED_V2_FILE } from '/model.js';

export { esc, md, plainError, noAnswerText };

// ---- vocabulary ------------------------------------------------------------------------------------------------
/** State words by level: ok, warning, down, unknown → OK, Attention, Down, Unknown. */
export const WORD = { ok: 'OK', warning: 'Attention', down: 'Down', unknown: 'Unknown' };
/** Marks by level: ✓ ▲ ✕ ?. */
export const MARK = { ok: '✓', warning: '▲', down: '✕', unknown: '?' };
const LEVELS = ['ok', 'warning', 'down', 'unknown'];
const lv = (level) => (LEVELS.includes(level) ? level : 'unknown');
/** HTML for one mark: a 20 px filled circle with a ring and the level's glyph (aria-hidden; put the word next to it). */
export const mark = (level, extra = '') => `<span class="mk lv-${lv(level)} ${extra}" aria-hidden="true">${MARK[lv(level)]}</span>`;
/** HTML for a chip: mark + state word (or your own word), opaque, in the level's colour. */
export const chip = (level, word = WORD[lv(level)], extra = '') => `<span class="chip lv-${lv(level)} ${extra}">${mark(level)}<span>${esc(word)}</span></span>`;

const LINKS = {
  explainer: ['What is happening (for the press)', '/explainer'],
  map: ['System map (for engineers)', '/map'],
  files: ['Show files', 'https://gavaiken.github.io/river-bitcube/show-files'],
  install: ['Install guide', 'https://gavaiken.github.io/river-bitcube/install'],
  plan: ['The plan', 'https://gavaiken.github.io/river-bitcube/execution-plan'],
};
/** The footer's links, in order: [label, href]. */
export const DOC_LINKS = [LINKS.explainer, LINKS.map, LINKS.files, LINKS.install, LINKS.plan];
// which part of the Help page each page's ? opens
const HELP_SECTION = { status: 'status', lights: 'lights', looks: 'looks', chat: 'chat', remembered: 'remembered', 'remembered-v2': 'remembered', hub75: 'hub75', map: 'status', help: 'toc', explainer: 'big-picture' };
const TABS = [
  ['status', 'Status', '/status', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>'],
  ['lights', 'Lights', '/lights', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.6 1 1.3 1 2.5h6c0-1.2.3-1.9 1-2.5A6 6 0 0 0 12 3z"/></svg>'],
  ['looks', 'Looks', '/looks', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h9"/><path d="M17 16l3 2-3 2z"/></svg>'],
  ['chat', 'Studio chat', '/chat', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>'],
];
// Seven long bezier paths (viewBox 0 0 2400 1000), the flow lines; alternate paths take the second line colour.
const FLOW_PATHS = [
  'M-50,150 C250,90 500,250 800,170 S1300,110 1600,210 S2100,160 2450,190',
  'M-50,330 C300,290 550,420 850,350 S1350,280 1700,380 S2150,320 2450,360',
  'M-50,520 C200,470 520,600 820,540 S1300,460 1650,560 S2120,500 2450,540',
  'M-50,690 C280,650 560,770 860,700 S1380,630 1720,730 S2180,680 2450,700',
  'M-50,860 C260,820 540,940 840,880 S1320,800 1680,900 S2160,850 2450,870',
  'M-50,240 C320,210 620,330 920,270 S1420,200 1780,300 S2220,250 2450,270',
  'M-50,600 C240,560 600,690 900,620 S1400,540 1760,650 S2200,600 2450,620',
];

// ---- small helpers ------------------------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s ?? '');
const nbsp = (s) => String(s).replace(/ /g, ' ');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: lasts for this page */ } } };
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// ---- fmt: durations, ages, clocks, percentages ------------------------------------------------------------------
/** Wall-clock parts in Pacific time (falls back to a fixed -7 h when Intl has no zones). */
function pacific(ms) {
  try {
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms))) p[type] = +value;
    return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute };
  } catch {
    const d = new Date(ms - 7 * 3600e3);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
}
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmt = {
  /** dur(seconds) → "40 s", "12 min", "9 h", "3 days" (model.js's one dur(), so every duration reads the same). */
  dur: (s) => modelDur(s),
  /** ago(ms) → "40 s ago", "12 min ago"; null → "age not known". */
  ago: (ms) => (ms == null || !Number.isFinite(ms) ? 'age not known' : `${modelDur(ms / 1000)} ago`),
  /** clock(ms, now = Date.now()) → "21:04" today, "21:04 yesterday", else "21:04 on 21 Oct": 24 h Pacific. */
  clock(ms, now = Date.now()) {
    if (ms == null || !Number.isFinite(ms)) return 'time not known';
    const p = pacific(ms), q = pacific(now);
    const day = (x) => Date.UTC(x.y, x.mo - 1, x.d) / 86400e3;
    const diff = day(q) - day(p);
    return `${pad(p.h)}:${pad(p.mi)}` + (diff === 0 ? '' : diff === 1 ? ' yesterday' : ` on ${p.d} ${MONTHS[p.mo - 1]}`);
  },
  /** nb(text) keeps a number with its unit on one line ("20 s", "100 %", "3 min", "180 W") with a no-break space. */
  nb: (s) => String(s ?? "").replace(/(\d) (s|min|h|days|W|%|px|of)(?![A-Za-z])/g, "$1\u00a0$2"),
  /** pct(0.9) → "90 %" (a fraction 0–1, or a number over 1 taken as percent already); null → "not known". */
  pct: (x) => (x == null || !Number.isFinite(x) ? 'not known' : `${Math.round(x <= 1 ? x * 100 : x)} %`),
};

// ---- api: POST through app.js, with ok:false a failure and 401 → /login -------------------------------------
/** api(path) GETs, api(path, body) POSTs JSON; a non-2xx, a 401 (→ /login) or `ok: false` throws an Error in words. */
export async function api(path, body, opts) {
  const j = await rawApi(path, body, opts);
  // mission control answered, but bitcube didn't in time (lib/lights.mjs noAnswer): it may or may not have happened. The
  // answer names the change's entry (applying_id), so the page still knows which entry in status.applying is its own
  if (j && j.ok === false && j.maybe === true) throw Object.assign(new Error(j.error || "bitcube didn't answer in time"), { status: 200, maybe: true, posted: true, serverMaybe: true,
    ...(typeof j.applying_id === 'string' ? { applyingId: j.applying_id } : {}) });
  if (j && j.ok === false) throw Object.assign(new Error(j.error || "bitcube didn't answer"), { status: 200 });
  // ropes and panels act through TouchDesigner: its own failure inside an otherwise good answer is a failure too
  if (/\/api\/control\/(ropes|hub75)$/.test(path) && j?.td && j.td.ok === false) throw Object.assign(new Error(j.td.error || "TouchDesigner didn't answer"), { status: 200 });
  return j;
}
// ---- "since": the server's history, only when it can't contradict the words beside it --------------------------------
/** Seconds of every duration a sentence states ("for 30 min", "6 min ago"). */
export function statedS(texts) {
  const U = { s: 1, min: 60, h: 3600, days: 86400 }, out = [];
  for (const t of texts) for (const x of String(t ?? '').matchAll(/(\d+(?:\.\d+)?) (s|min|h|days)\b/g)) out.push(Number(x[1]) * U[x[2]]);
  return out;
}
/** Items whose state bitcube reports (so their "since" can't be longer than bitcube has been up). */
export const NAMES_FROM_BITCUBE = new Set(['touchdesigner', 'seasons', 'ropes', 'rope box 1', 'rope box 2', 'hub75 panels', 'gallery camera', 'river camera', 'router', 'internet', 'modal link', 'recorder', 'people counter']);
/** A "since" from the history (status.since.items[id]) is shown only when it can't contradict the words beside it: never
 *  longer than bitcube has been up (for what bitcube reports; uptime_s from the model's show), never a first sighting
 *  ("over …") next to a duration the sentence states itself, and never shorter than that duration. Status and the map share it. */
export function sinceAgrees(s, texts, behindBitcube, uptime_s) {
  if (behindBitcube && uptime_s != null && s.for_s > uptime_s + 60) return false;
  const stated = statedS(texts);
  if (stated.length && (s.at_least || s.for_s < Math.max(...stated) * 0.75)) return false;
  return true;
}

// ---- headlines --------------------------------------------------------------------------------------------------
/** "cause: consequence" -> [cause, consequence], splitting at the first top-level ":" or ";" (never inside parentheses, never a
 *  clock time's colon: "since 01:02", R9 #4), or at a trailing parenthesis. Status's band and Lights' state line share it. */
export function splitHeadline(h) {
  h = String(h ?? '');
  let depth = 0;
  for (let i = 0; i < h.length; i++) {
    const c = h[i];
    if (c === '(') depth++; else if (c === ')') depth--;
    else if (c === ':' && /\d/.test(h[i - 1] ?? '') && /\d/.test(h[i + 1] ?? '')) continue;
    else if (depth === 0 && (c === ':' || c === ';') && i >= 12) return [h.slice(0, i), h.slice(i + 1).trim()];
  }
  const q = h.indexOf(' (');
  if (q >= 12 && h.endsWith(')')) return [h.slice(0, q), h.slice(q + 2, -1)];
  return [h, ''];
}

// ---- the one-second ticker ----------------------------------------------------------------------------------
const tickers = new Set();
let tickTimer = null;
/** tick(fn) runs fn every second (one shared timer for the page); returns a function that stops it. */
export function tick(fn) {
  tickers.add(fn);
  if (!tickTimer) tickTimer = setInterval(() => { for (const f of tickers) { try { f(); } catch (e) { console.warn('tick', e); } } }, 1000);
  return () => { tickers.delete(fn); if (!tickers.size) { clearInterval(tickTimer); tickTimer = null; } };
}

// ---- poll: the last good payload and when it arrived ----------------------------------------------------------
/** poll(url, { every, onData(payload, receivedAt), onError(err, downForMs) }) → { stop, refresh, last, receivedAt, failedSince }.
 *  `last` is the last good JSON (with `now` filled in when the server sent none), `receivedAt` the performance.now()
 *  it arrived; a page polling /api/status renders derive(p.last, serverNow()). 401 → /login. */
export { POLL_TIMEOUT_MS };          // a request that hangs this long counts as a failure (a phone's handover, a lock mid-fetch): app.js
const lastStatus = { j: null, wall: null, h: null };   // the newest /api/status any poll() on this page received, when (Date.now()), and its poll
let skewMs = null;            // the server's clock minus this phone's, as a page last heard it some other way (noteServerTime)
/** The server's clock now (ms), one helper for every page (Status, Lights, the chat, every control: R8 #35, CR8 #13): the newest
 *  /api/status answer any poll() on this page received, carried forward by that poll's elapsed() (the larger of the monotonic and
 *  the wall clock's view, so a phone that slept never reads an old answer as new); before one, this phone's clock moved by what a
 *  page heard of the server's time (noteServerTime: the chat's history and its stream's pings); else null. */
export function serverClock() {
  const h = lastStatus.h;
  if (h?.last && typeof h.last.now === 'number') return h.last.now + (h.elapsed() ?? 0);
  return skewMs != null ? Date.now() + skewMs : null;
}
/** A time on another clock (ms), as it was when this page noted it (performance.now() and Date.now() then), carried forward to now by
 *  the larger of the monotonic and the wall clock's view, so a phone that slept never reads an old answer as new (Recent's ages on the
 *  history's own clock, R9 #2). */
export function carried(ms, at, wall) { return ms + Math.max(performance.now() - at, wall != null ? Date.now() - wall : 0, 0); }
/** The server's clock now, else the phone's: a control's times are the server's, so they agree with Last done and a 409's
 *  "(started 21:04)" on a phone whose clock is off (R8 #35). */
export function serverNow() { return serverClock() ?? Date.now(); }
/** "21:04" on the server's clock: a moment on it (default now), as fmt.clock says it against the server's today. */
export function sclock(ms = serverNow()) { return fmt.clock(ms, serverNow()); }
/** The server's time as a page heard it outside /api/status (an answer's own `now`, a ping's `t`): serverClock() goes by it until
 *  a status answer comes. */
export function noteServerTime(serverMs) { if (typeof serverMs === 'number' && Number.isFinite(serverMs)) skewMs = serverMs - Date.now(); }
export function poll(url, { every = 5000, onData, onError, timeout = POLL_TIMEOUT_MS } = {}) {
  const h = { last: null, receivedAt: null, receivedWall: null, failedSince: null, startedAt: performance.now(), stop, refresh: () => once(true), elapsed };
  let timer = null, ctrl = null, stopped = false;
  /** ms since the last good answer: the larger of the monotonic and the wall clock's view, so a phone that slept (and
   *  whose monotonic clock may have paused) never reads an old answer as new. null before the first answer. */
  function elapsed() {
    if (h.receivedAt == null) return null;
    return Math.max(performance.now() - h.receivedAt, h.receivedWall != null ? Date.now() - h.receivedWall : 0, 0);
  }
  async function once(force = false) {
    if (stopped) return;
    if (ctrl) { if (!force) return; ctrl.abort(); }       // one request at a time; a forced refresh replaces a hung one
    const mine = (ctrl = new AbortController());
    const t = setTimeout(() => mine.abort(), timeout);
    try {
      const r = await fetch(url, { cache: 'no-store', signal: mine.signal });
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (mine !== ctrl) return;                            // replaced meanwhile: the newer request reports
      if (typeof j.now !== 'number') j.now = Date.now();
      h.last = j; h.receivedAt = performance.now(); h.receivedWall = Date.now(); h.failedSince = null;
      if (/^\/api\/status\b/.test(url)) { lastStatus.j = j; lastStatus.wall = h.receivedWall; lastStatus.h = h; }
      onData?.(j, h.receivedAt);
    } catch (e) {
      if (mine !== ctrl) return;
      h.failedSince ??= performance.now();
      onError?.(e, performance.now() - h.failedSince);
    } finally { clearTimeout(t); if (mine === ctrl) ctrl = null; }
  }
  const onVisible = () => { if (!document.hidden) once(true); };   // back from the background: never wait on a request from before
  document.addEventListener('visibilitychange', onVisible);
  function stop() { stopped = true; clearInterval(timer); ctrl?.abort(); document.removeEventListener('visibilitychange', onVisible); }
  once();
  timer = setInterval(() => once(), every);
  return h;
}
export const WARN_MS = 12_000, LOST_MS = 30_000;   // docs/mission-ui.md: header amber from 12 s, lost contact from 30 s
/** The one staleness rule every page shares, from the time since the last good answer (not from errors, which a hung
 *  request never raises): ages the header ("No answer for N s", amber from 12 s, red from 30 s), toggles body.page-stale,
 *  and calls onLost(lost) when contact is lost or comes back, so the page can re-render greyed. Ticks every second. */
export function watchContact(p, shell, onLost = () => {}) {
  let was = false;
  const check = () => {
    // before the first answer there is no age: the header says "No answer yet · N s", counted from when the page started
    // asking (a hung first request counts as surely as a failed one), amber from 12 s, red from 30 s
    const el = p.last ? p.elapsed() : performance.now() - p.startedAt;
    if (p.last) shell.setAge(el); else { shell.setAge(null); shell.setWaiting(p.startedAt); }
    shell.setStale(el > LOST_MS ? 'down' : el > WARN_MS ? 'warning' : null);
    const lost = el > LOST_MS;
    document.body.classList.toggle('page-stale', lost);
    if (lost !== was) { was = lost; onLost(lost); }
  };
  tick(check);
  return { check, get lost() { return was; } };
}

// ---- theme ---------------------------------------------------------------------------------------------------
/** The remembered theme: 'auto' | 'light' | 'dark'. */
export const getTheme = () => { const t = store.get('mc-theme'); return t === 'light' || t === 'dark' ? t : 'auto'; };
/** Is the page dark right now (the override, else the system)? */
export const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
/** setTheme('auto' | 'light' | 'dark'): applies it, remembers it, re-tints the art, fires 'mc:theme'. */
export function setTheme(t) {
  if (t !== 'light' && t !== 'dark') t = 'auto';
  store.set('mc-theme', t === 'auto' ? null : t);
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  art.setSeason(art.current);
  document.dispatchEvent(new CustomEvent('mc:theme', { detail: t }));
}
(() => { const t = getTheme(); if (t !== 'auto') document.documentElement.dataset.theme = t; })();   // in case the page skipped the head script
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => art.setSeason(art.current));

// ---- the art: three layers, tinted by the season's weights -------------------------------------------------------
// Wash tints (a, b) and flow-line colours (l1, l2) per season and theme (docs/mission-ui.md, "The river art").
const TINT = {
  light: { winter: ['#d6e4f0', '#edf2f6', '#8fb9e0', '#cfe2f2'], spring: ['#cfe6d6', '#cce0de', '#4fae82', '#3c9a95'],
           summer: ['#efdfae', '#f3e7c8', '#d4a63c', '#ecd07f'], autumn: ['#e9d6ba', '#e3c8b2', '#c17f3d', '#b05a30'],
           none:   ['#dde3ea', '#e6e8ec', '#6f87a3', '#8ea3bb'] },
  dark:  { winter: ['#182a3c', '#1c2b37', '#8db6dc', '#cfe3f5'], spring: ['#133029', '#143236', '#5fcf9c', '#49b8af'],
           summer: ['#322c14', '#372e17', '#e9b94a', '#f6d57e'], autumn: ['#35251a', '#38241a', '#d08c48', '#c26a3b'],
           none:   ['#172029', '#1a222c', '#6f87a3', '#8ea3bb'] },
};
const hex = (h) => [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)].map((x) => parseInt(x, 16));
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
export const art = {
  current: null,
  /** mount(): the three fixed layers (wash, seven flow lines, three ripples) behind the page; mountShell calls it. */
  mount() {
    if ($('.art')) return;
    document.body.prepend(el(`<div class="art" aria-hidden="true"><div class="wash"></div>
      <svg class="flow" viewBox="0 0 2400 1000" preserveAspectRatio="none">${FLOW_PATHS.map((d) => `<path d="${d}"/>`).join('')}</svg>
      <div class="ripple r1"></div><div class="ripple r2"></div><div class="ripple r3"></div></div>`));
  },
  /** setSeason(weights | season | null): tints the art from `show.weights` ({ winter, spring, summer, autumn }), a season
   *  word, or null for the neutral slate (unknown); follows the theme; the CSS fades it over 2 s. Never the state. */
  setSeason(w) {
    art.current = w ?? null;
    const t = TINT[isDark() ? 'dark' : 'light'];
    let c;
    if (typeof w === 'string' && t[w]) c = t[w];
    else if (w && typeof w === 'object') {
      const wt = SEASONS.map((k) => (Number(w[k]) > 0 ? Number(w[k]) : 0)), total = wt.reduce((a, b) => a + b, 0);
      c = total > 0 ? [0, 1, 2, 3].map((i) => toHex([0, 1, 2].map((ch) => SEASONS.reduce((s, k, j) => s + hex(t[k][i])[ch] * (wt[j] / total), 0)))) : t.none;
    } else c = t.none;
    const st = document.documentElement.style;
    st.setProperty('--art-a', c[0]); st.setProperty('--art-b', c[1]); st.setProperty('--art-l1', c[2]); st.setProperty('--art-l2', c[3]);
    const season = typeof w === 'string' ? w : w && typeof w === 'object' ? SEASONS.reduce((best, k) => (Number(w[k]) > Number(w[best] ?? -1) ? k : best), null) : null;
    document.documentElement.dataset.season = season ?? 'none';
  },
};

// ---- sheets --------------------------------------------------------------------------------------------------
function dialog() {
  let d = $('dialog.sheet#mc-sheet');
  if (!d) { d = el('<dialog id="mc-sheet" class="sheet" aria-labelledby="mc-sheet-title"></dialog>'); document.body.append(d); sheetRegion(d); }
  return d;
}
// ---- focus that survives a re-render ------------------------------------------------------------------------------
const KEY_ATTRS = ['data-ctl-status', 'data-act', 'data-dark', 'data-mode', 'data-file', 'data-route', 'data-season', 'data-d', 'data-target', 'data-theme', 'data-m', 'data-cal', 'data-rope', 'data-view', 'data-box', 'data-id'];
/** A selector that finds "the same control" again after its markup was replaced (its data-* identity, else its id). */
export function focusKey(node) {
  if (!(node instanceof Element) || node === document.body) return null;
  if (node.id) return `#${CSS.escape(node.id)}`;
  const parts = KEY_ATTRS.filter((a) => node.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(node.getAttribute(a))}"]`);
  if (!parts.length) { const s = node.closest('summary'); return s && s !== node ? focusKey(s) : node.tagName === 'SUMMARY' && node.parentElement?.dataset.id ? `details[data-id="${CSS.escape(node.parentElement.dataset.id)}"] > summary` : null; }
  return node.tagName.toLowerCase() + parts.join('');
}
/** The outermost closed <details> that hides n (its content, not its own summary), or null. Chrome still gives such content
 *  boxes (content-visibility), so getClientRects can't tell; it can't take focus. */
export function closedAround(n) {
  let out = null;
  for (let d = n?.parentElement?.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) {
    if (!d.querySelector(':scope > summary')?.contains(n)) out = d;
  }
  return out;
}
/** Can n take focus where it is: connected, drawn (an empty status line is display: none), not inside a closed <details>? */
export const drawn = (n) => n instanceof Element && n.isConnected && !n.hidden && n.getClientRects().length > 0 && !closedAround(n);
/** Focus an element that isn't a control (a status line, a heading): it gets tabindex -1 so it can hold focus. An element that
 *  isn't drawn can't: false, and the caller tries the next place. */
function focusEl(n) {
  if (!drawn(n)) return false;
  if (!n.matches('a[href], button, input, select, textarea, summary, [tabindex]')) n.setAttribute('tabindex', '-1');
  n.focus({ preventScroll: true });
  return document.activeElement === n;
}
const says = (n) => !!n && !n.hidden && !!n.textContent.trim();
/** Focus t where it is drawn now; when a closed <details> hides it (a row that moved into the collapsed fine list), the summary of
 *  the outermost closed one, so focus is never lost to <body> for want of a drawn place. */
export function focusShown(t) {
  if (!(t instanceof Element) || !t.isConnected) return false;
  const closed = closedAround(t), n = closed ? closed.querySelector(':scope > summary') : t;
  if (!n) return false;
  if (!n.matches('a[href], button, input, select, textarea, summary, [tabindex]')) n.setAttribute('tabindex', '-1');
  n.focus({ preventScroll: true });
  return document.activeElement === n;
}
/** Where focus waits while the control under it is blocked or busy (another phone's change, a calibration, lost contact, its own
 *  request): the line that says why ("Wait: …", "Not possible now: …"), else its status line when that says something, else
 *  `fallback`, else the control's heading, else its box. Never an empty line (it is display: none), never <body> (R6 #2, #7, #28).
 *  Returns whether focus landed. */
export function park(host, fallback = null) {
  if (!(host instanceof Element)) return fallback ? focusEl(fallback) : false;
  const closed = closedAround(host);   // its row moved into a collapsed list: that list's summary
  if (closed) { const sum = closed.querySelector(':scope > summary'); sum?.focus({ preventScroll: true }); return !!sum && document.activeElement === sum; }
  const why = host.querySelector('.ctl-why'), st = host.querySelector('.ctl-status');
  for (const n of [says(why) ? why : null, says(st) ? st : null, fallback, host.querySelector('.ctl-h'), host]) if (n && focusEl(n)) return true;
  return false;
}
/** Puts focus back on the control `key` names inside root, or, when it is disabled now, where it waits (park: its own status line
 *  when that says something, else the line that says why, else `fallback`, also when there is no key). */
export function refocus(key, root = document, fallback = null) {
  if (!key) return fallback ? focusEl(fallback) : false;
  let t = null;
  try { t = root.querySelector(key); } catch { /* a stale key */ }
  if (t && !t.disabled) return focusShown(t);
  const own = t?._mcStatus?.isConnected ? t._mcStatus : null;
  if (says(own) && focusEl(own)) return true;
  return park(t?.closest('.ctl, [data-ctl], .ctl-host') ?? null, fallback);
}
/** sheet({ title, body, actions, focus, row }) opens the bottom sheet (body: HTML string or a Node; actions: [{ label, kind: 'primary'|'danger'|'plain',
 *  onClick, keep }] stacked full width, each closes the sheet unless `keep`); a Close button when there are no actions. The actions are
 *  a row that stays at the sheet's bottom while a long body scrolls under it (R9 #3); row: true sets two of them side by side (a
 *  way back and Close: never a confirm's, which stack).
 *  `focus`: the index of the action that takes focus when it opens (default: its title, which names it; the browser's own choice
 *  when it opens). Returns { close, el }; a click on the backdrop or Escape closes it. A sheet opened over another replaces it, and
 *  focus goes into the new one, never to <body> (R9 #8). On close, focus goes back to what opened it, found again by its data-*
 *  identity when a re-render replaced it meanwhile. */
export function sheet({ title, body = '', actions = null, onClose = null, focus = null, row = false } = {}) {
  const d = dialog();
  const opener = d.open ? d._mcOpener : document.activeElement;
  const openerKey = d.open ? d._mcOpenerKey : focusKey(document.activeElement);
  d._mcReplaced?.();            // the sheet this one replaces: its promise (a confirm) resolves false; the dialog stays open
  // what it showed goes; its own polite region stays, so what is said while it is up is heard (R8 #8)
  for (const n of [...d.childNodes]) if (!(n instanceof Element && n.hasAttribute('data-sheet-live'))) n.remove();
  sheetRegion(d);
  const inner = el('<div class="sheet-in" role="document"></div>');
  if (title) inner.append(el(`<h3 id="mc-sheet-title" tabindex="-1">${esc(title)}</h3>`));
  if (body instanceof Node) inner.append(body); else if (body) inner.insertAdjacentHTML('beforeend', body);
  const desc = inner.querySelector(':scope > p, :scope > div > p');
  if (desc) { desc.id ||= 'mc-sheet-desc'; d.setAttribute('aria-describedby', desc.id); } else d.removeAttribute('aria-describedby');
  if (title) { d.setAttribute('aria-labelledby', 'mc-sheet-title'); d.removeAttribute('aria-label'); } else { d.removeAttribute('aria-labelledby'); d.setAttribute('aria-label', 'Details'); }
  const acts = actions ?? [{ label: 'Close', kind: 'plain' }];
  const stack = el(`<div class="stack sheet-acts${row ? ' row' : ''}"></div>`);
  const btns = [];
  for (const a of acts) {
    const b = el(`<button class="btn ${a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'danger' : ''}" type="button">${esc(a.label)}</button>`);
    b.onclick = async () => { try { await a.onClick?.(b); } finally { if (!a.keep) close(); } };
    stack.append(b); btns.push(b);
  }
  inner.append(stack);
  d.append(inner);
  // the row's height keeps a focused link above it (scroll-padding), and a hairline over it says the body scrolls under it
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    const fit = () => { inner.style.setProperty('--acts-h', `${stack.offsetHeight}px`); inner.classList.toggle('overflows', inner.scrollHeight > inner.clientHeight + 1); };
    ro = new ResizeObserver(fit); ro.observe(stack); ro.observe(inner);
  }
  let closed = false;
  const mine = {};
  d._mcToken = mine; d._mcOpener = opener; d._mcOpenerKey = openerKey;
  d._mcReplaced = () => { if (closed) return; closed = true; ro?.disconnect(); onClose?.(); };
  function close() {
    if (closed) return;
    closed = true;
    ro?.disconnect();
    if (d._mcToken === mine) {
      d._mcToken = null; d._mcReplaced = null; d.onclick = null; d.oncancel = null;
      if (d.open) d.close();
      // the button that opened it may have been replaced by a re-render while the sheet was up: find its successor.
      // A disabled opener (a confirm withdrawn because the control became impossible, a change now applying, a run that
      // ended) can't hold focus: its status line takes it, never <body>, also when the opener has no data-* identity.
      const st = opener instanceof Element && opener._mcStatus?.isConnected ? opener._mcStatus : null;
      if (!(opener instanceof Element && opener.isConnected) || opener.disabled) { if (!refocus(openerKey, document, st) && !(st && focusEl(st))) park(opener instanceof Element ? opener.closest('.ctl, [data-ctl], .ctl-host') : null); }
      // and what takes focus is on screen: a confirmed change's status line, never under the tab bar (landscape, 200 % zoom: R8 #3)
      const a = document.activeElement;
      if (a && a !== document.body && a.closest('main')) bringIntoView(a);
    }
    onClose?.();
  }
  d.onclick = (e) => { if (e.target === d || e.target.closest('[data-sheet="close"]')) close(); };
  d.oncancel = (e) => { e.preventDefault(); close(); };
  const was = d.open;
  if (!was) d.showModal();
  // the browser's initial focus runs only at showModal(): a sheet shown over an open one (Recent, Who to call, Back to the menu)
  // takes focus into itself and names it, by its title, since the button that was pressed went with the old content (R9 #8)
  if (focus != null && btns[focus]) btns[focus].focus();
  else if (was) (inner.querySelector('#mc-sheet-title') ?? btns[0])?.focus();
  return { close, el: inner };
}
/** confirm({ title, body, ok, cancel, destructive }) → Promise<boolean>: a bottom sheet naming the cost, the costly button first
 *  (red-tinted when destructive, default true), then the safe one, which has the focus: a second Enter or a screen
 *  reader's double-tap never confirms by accident. Backdrop and Escape mean no. */
export function confirm({ title, body = '', ok = 'OK', cancel = 'Not now', destructive = true } = {}) {
  let s = null;
  const pr = new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    s = sheet({ title, body: body instanceof Node ? body : `<p>${esc(body)}</p>`, onClose: () => done(false), focus: 1,
      actions: [{ label: ok, kind: destructive ? 'danger' : 'primary', onClick: () => done(true) }, { label: cancel, kind: 'plain', onClick: () => done(false) }] });
  });
  /** close(): withdraw the question (the answer is no), e.g. when what it asks about became impossible meanwhile. */
  pr.close = () => s?.close();
  return pr;
}

// ---- speech: every live region on the page speaks through one queue -------------------------------------------------
// A page has its one polite region (status.html's #ctl-live, else #mc-live, made by mountShell) and the hidden regions that
// carry a verdict's words (Status's band, Lights' state line, the chat's bar, the map's contact line). Two polite regions that
// change within the same moment can cut each other off on iOS VoiceOver, so they all speak through one queue (R8 #11): what is
// said within its short pause is joined into one message, in order, never the first dropped (R7 #10); a message never follows the
// one before by less than SAY_GAP_MS (the second waits, and joins anything else said meanwhile); a message that joins words of
// two regions is written to the page's one region. While a sheet is open (a modal <dialog>: everything outside it is out of the
// accessibility tree) every message goes to the sheet's own region instead, so nothing said meanwhile is lost (R8 #8).
const SAY_PAUSE_MS = 60, SAY_GAP_MS = 1000;
const speech = { queue: [], timer: null, lastAt: -Infinity };   // queue: [{ text, region, parts? }] (region null: the page's one region)
const liveWords = new WeakMap();                                 // a hidden region -> { head, lines }: the words it stands for now (setLive)
/** announce(text, key): says it once through the page's one polite region: a control's applying, done, unconfirmed and failed, a
 *  stepper's new value. Never a ticking time. key: what it is the newest word on (a stepper's value): a newer one with the same key
 *  replaces it while it waits, so three presses of + say "70 %" once, never "50 %. 60 %. 70 %." */
export function announce(text, key = null) {
  if (key) speech.queue = speech.queue.filter((x) => x.key !== key);
  say(text, null, key);
}
/** setLive(region, words, { once }): a hidden region's words (the band's, the state line's, the chat bar's). words: { head, lines }
 *  (a plain text is a head). Only what is new is said (R9 #5): the head (the level and the headline) when it changed, each line
 *  (a change in flight) that wasn't there before; never again when a part only went, never the unchanged headline beside a new
 *  line. once: lines said this time only, never part of the standing words (how another phone's change ended: model.js endedOnce),
 *  so they never ride along with a later change, and the same words are said again for a second change. */
export function setLive(region, words, { once = [] } = {}) {
  if (!(region instanceof Element)) return;
  const w = typeof words === 'string' || words == null ? { head: words ?? '', lines: [] } : words;
  const head = String(w.head ?? '').trim(), lines = (Array.isArray(w.lines) ? w.lines : []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const extra = (Array.isArray(once) ? once : []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const prev = liveWords.get(region);
  liveWords.set(region, { head, lines });
  const queued = speech.queue.find((x) => x.region === region);
  if (!head && !lines.length && !extra.length) { speech.queue = speech.queue.filter((x) => x !== queued); if (region.textContent) region.textContent = ''; return; }   // emptied silently
  const news = liveNews(prev, { head, lines });
  // how a change ended is said before what is new: "Done: the change of the default to the live river. Applying: … the river's
  // year." never the new one first, which makes the ended one sound like it (R10 #21)
  if (queued) {
    // not said yet: what it says once (and the new once lines), then what of it still stands, then what is new
    const kept = (queued.parts ?? []).filter((p) => p.once || p.text === head || lines.includes(p.text));
    const parts = [...kept.filter((p) => p.once), ...extra.map((text) => ({ text, once: true })), ...kept.filter((p) => !p.once)];
    for (const t of news) if (!parts.some((p) => p.text === t)) parts.push({ text: t });
    if (!parts.length) { speech.queue = speech.queue.filter((x) => x !== queued); return; }
    queued.parts = parts; queued.text = joinSaid(parts.map((p) => p.text));
    return;
  }
  const parts = [...extra.map((text) => ({ text, once: true })), ...news.map((text) => ({ text }))];
  if (parts.length) say(joinSaid(parts.map((p) => p.text)), region, null, parts);
}
/** speakBy(fn): the page's other speech takes its turn in the one queue (R9 #10). The chat thread is a log (role="log") that speaks by
 *  its own change to the page, when a card is added or settles: fn makes that change when its turn comes, alone, in the order it was
 *  asked, and nothing is said within SAY_GAP_MS of it either way (the agent's reply is never cut off by "Ready" 60 ms later, and never
 *  overtaken by it). */
export function speakBy(fn) {
  if (typeof fn !== 'function') return;
  speech.queue.push({ run: fn });
  schedule();
}
/** Sentences said together: each ends with its own stop ("Ready" becomes "Ready."). */
const joinSaid = (list) => list.map((x) => (/[.!?:;]$/.test(x) ? x : `${x}.`)).join(' ');
/** unannounce(text): what was queued but not said yet goes (a control's done whose block the next view replaces: the new view
 *  says it, R8 #12). */
export function unannounce(text) {
  const t = String(text ?? '').trim();
  speech.queue = speech.queue.filter((x) => x.text !== t);
}
function say(text, region = null, key = null, parts = null) {
  const t = String(text ?? '').trim();
  if (!t || typeof document === 'undefined') return;
  if (speech.queue.at(-1)?.text !== t) speech.queue.push({ text: t, region, key, ...(parts ? { parts } : {}) });
  schedule();
}
/** The queue's next turn: after its short pause, and never sooner than SAY_GAP_MS after the last words said. */
function schedule() {
  clearTimeout(speech.timer);
  speech.timer = setTimeout(flushSpeech, Math.max(SAY_PAUSE_MS, speech.lastAt + SAY_GAP_MS - performance.now()));
}
function flushSpeech() {
  speech.timer = null;
  if (!speech.queue.length) return;
  // the log's turn (speakBy): it speaks alone, by its own change to the page; what waits behind it is said a gap later
  if (speech.queue[0].run) {
    const { run } = speech.queue.shift();
    speech.lastAt = performance.now();
    try { run(); } catch (e) { console.warn('speakBy', e); }
    if (speech.queue.length) schedule();
    return;
  }
  // the words up to the log's next turn, said together
  const cut = speech.queue.findIndex((x) => x.run), q = cut < 0 ? speech.queue : speech.queue.slice(0, cut);
  speech.queue = cut < 0 ? [] : speech.queue.slice(cut);
  const regions = new Set(q.map((x) => x.region));
  const sheetUp = document.querySelector('dialog[open]');
  const l = sheetUp ? sheetRegion(sheetUp) : regions.size === 1 && q[0].region?.isConnected ? q[0].region : liveRegion();
  if (l) {
    const msg = q.length === 1 ? q[0].text : q.map((x) => (/[.!?:;]$/.test(x.text) ? x.text : `${x.text}.`)).join(' ');
    speech.lastAt = performance.now();
    // the same words twice are read twice: emptied first, then written a moment later
    if (l.textContent === msg) { l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 50); } else l.textContent = msg;
  }
  if (speech.queue.length) schedule();
}
function liveRegion() {
  if (typeof document === 'undefined' || !document.body) return null;
  let l = document.getElementById('ctl-live') ?? document.getElementById('mc-live');
  if (!l) { l = el('<div id="mc-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>'); document.body.append(l); }
  return l;
}
/** The open sheet's own polite region (made with the dialog, kept across the sheets it shows). */
function sheetRegion(d) {
  let l = d.querySelector(':scope > [data-sheet-live]');
  if (!l) { l = el('<div class="sr-only" data-sheet-live role="status" aria-live="polite" aria-atomic="true"></div>'); d.append(l); }
  return l;
}
/** The line above a greyed control: "Not possible now: bitcube is offline." or, for a change in flight elsewhere (the model's
 *  "wait: <label> is being applied"), "Wait: the switch to the live river is being applied." */
export function whyText(why) {
  const w = String(why ?? '').replace(/[.\s]+$/, '');
  return /^wait: /i.test(w) ? `Wait: ${w.slice(6)}.` : `Not possible now: ${w}.`;
}

// ---- controls: the contract's states on the control itself (docs/mission-ui.md "Applying a change") ---------------------
/** control(el, opts) → { button, host, status, show(state, text), update(opts), state, busy }
 *  A button that reports on itself, pessimistically: nothing claims a change until bitcube's reading shows it. Its states are
 *  model.js ctlStep's (tested in node): ready, blocked, confirm, applying, confirming, done, unconfirmed, failed.
 *  `el`: a container (a `.ctl` is best: the eyebrow and the readout are yours) or an existing <button>.
 *  opts:
 *    label, kind ('primary' | 'danger' | 'plain'), before (one line of effect: HTML string or Node, under the eyebrow)
 *    why        the model's reason it can't run now: blocked, "Not possible now: <why>." above the greyed button (a
 *               "wait: <label> is being applied" reads "Wait: …"); an open confirm is withdrawn with "Not sent: <why>"
 *    whyBy      the id of the entry `why` waits for (model controls.<name>.by): when it is this control's own, no "Wait: …"
 *               line about itself (its status line says it: R8 #18); whyOwn: true when it is a sibling's on this page (Lights'
 *               Dry run under its own Start), the same
 *    confirm    a confirm() spec (or a function returning one), asked first; focus starts on the safe button
 *    run({ requestId })  async: POSTs via api() and returns the answer (ok: false or a throw is a failure); requestId: this press's
 *               own id, to send as the body's request_id, so a lost answer's entry is still found (R8 #2)
 *    pending | what   the applying line: `pending` as written, else "Applying: <what>…" (default "Sending to bitcube…"); `what`
 *               (team words: "the rebuild of the river's year") also names the change when it goes unconfirmed
 *    expectS    the change's usual seconds (model.js EXPECT_S): over 20, the applying line shows m:ss and "usually about N" from
 *               the start; a shorter one (10 s when not given) once it runs past it ("usually a few seconds"); the confirming
 *               line gives it too. usual: words of its own for the confirming line instead
 *    action     the change's action ('calibrate', 'rebuild', …): a maybe answer that names its entry holds the lock exactly
 *               when the server's does (model.js heldMaybe: MAYBE_HOLDS, the rule Status follows too, CR8 #10)
 *    serverConfirms  true: the server is the one authority on when it is done (a switch, a restart, a rebuild, a boot-file
 *               change, a calibration's start). The answer names its entry (applying_id); a 2xx waits in "confirming" until
 *               update({ model }) finds that id in status.confirmed (done), or in status.expired (unconfirmed), or its own limit
 *               passes; a maybe answer is unconfirmed until the server confirms it. Never judged from the reading's words: a
 *               restart names the same file before and after (R7 #6, #25). The page's own entry is `entryId`. When that verdict
 *               can't be known (no id: the answer was lost; or no list names it: it aged out, the server restarted), `sent()` →
 *               { action, file, before } (taken at the send) lets a reading taken after the send show it (model.js readingShows:
 *               a switch to another file, a boot-file change; a restart or a rebuild never, CR7 #4)
 *    confirmed(model, { sentAt, result }) → boolean: given, a 2xx waits in "confirming" until update({ model, readAt }) shows it,
 *               or turns "unconfirmed" after max(3 × expectS, 120) s from the answer, but only once a reading taken after that
 *               limit has been judged (readAt: when that reading was taken, Date.now() by default; nothing is judged while the
 *               page has no contact), so a phone that slept through it never goes unconfirmed by its clock alone; an unconfirmed
 *               change a later reading shows ends done. Without it (or serverConfirms), the answer itself is bitcube's reading
 *    holds(model) → boolean   optional: a done line gives way to a newer reading that no longer shows it (once one has, or after
 *               a minute)
 *    done       "Dark" → "Dark · 21:04" (a string, or fn(result) → string); fail "The ropes are unchanged" → "<fail>:
 *               <reason> (21:04). Try again, or check Status."
 *    noAnswer   where to look when it may or may not have happened ("the Now line shows what bitcube reports")
 *    unconfirmed  the same for a change bitcube doesn't show in time (default "look at the Now line, or call Gavin")
 *    onSent(result)  after a 2xx (poll at once); onDone(result) when done (clear a draft); onFail(error)
 *    siblings   buttons held while applying or confirming (default: every button in the nearest .ctl, else the parent)
 *    lock       more elements (or a function returning them), e.g. the inputs: disabled while applying, confirming or blocked
 *  While applying or confirming the host is aria-busy and the button, its siblings and the lock are disabled; focus moves
 *  from the button to its status line (never <body>) and back when it ends. The page's one live region (announce) says
 *  applying, done, unconfirmed and failed once each; the status line itself is not live, so its ticking time is never read.
 *  show(state, text) sets a state by hand ('before'/'ready', 'pending'/'applying', 'done', 'failed', 'unconfirmed').
 *  entryId: the id of the server's entry for this control's last change (null before an answer named one); at: when it entered
 *  its state (Date.now()). */
export function control(target, opts = {}) {
  const o = { label: 'Do it', before: '', why: null, confirm: null, run: null, done: 'Done', fail: 'Nothing changed', onDone: null, kind: 'plain', siblings: null, lock: null, ...opts };
  let button, status, whyEl, beforeEl, host;
  if (target instanceof HTMLButtonElement) {
    button = target; host = target.parentElement;
    status = host.querySelector(':scope > .ctl-status') ?? el('<div class="ctl-status"></div>');
    whyEl = host.querySelector(':scope > .ctl-why') ?? el('<div class="ctl-why"></div>');
    beforeEl = host.querySelector(':scope > .ctl-before') ?? el('<div class="ctl-before"></div>');
    if (!beforeEl.isConnected) button.before(beforeEl);
    if (!whyEl.isConnected) button.before(whyEl);
    if (!status.isConnected) button.after(status);
  } else {
    host = target;
    host.classList.add('ctl-host');
    host.innerHTML = '';
    beforeEl = el('<div class="ctl-before"></div>');
    whyEl = el('<div class="ctl-why"></div>');
    button = el('<button class="btn" type="button"></button>');
    status = el('<div class="ctl-status"></div>');
    host.append(beforeEl, whyEl, button, status);
  }
  // the status line is where focus waits while the button is disabled; it is not a live region (announce() speaks for it)
  status.removeAttribute('aria-live'); if (status.getAttribute('role') === 'status') status.removeAttribute('role');
  status.setAttribute('tabindex', '-1');
  const ident = button.id || host.id || '';
  if (!button.id && host.id) button.id = `${host.id}-go`;          // an identity, so focus finds it again after a re-render
  if (ident && !status.hasAttribute('data-ctl-status')) status.setAttribute('data-ctl-status', ident);
  button._mcStatus = status;     // refocus() and the sheet: where focus goes when this button is disabled under it
  const box = host.closest('.ctl') ?? (host.classList.contains('ctl') ? host : null);
  let s = ctlInit(o.why), text = '', applyText = null, result = null, asking = null, untick = null, judgedAt = null, parked = false, entryId = null, sent = null,
    requestId = null, saidExpired = false, sentServer = null, held = false, lost = false, sendToken = null;
  // a press's standing with mission control (R10 #2, #6): the status answers since it that didn't know its request id, whether one
  // did, its answer lost on the network (it waits for its entry, saying nothing), and the line saying it hasn't been received
  let seenAt = null, unknown = 0, received = false, lostNet = false, lostErr = null, notReceived = false;
  /** Only a control whose press is recorded by its request id (o.action: Lights' Start, Dry run, Rebuild) is looked for by it. */
  const tracked = () => !!o.action && !!requestId;
  const now = () => Date.now();
  const elapsedS = () => (s.sentAt == null ? 0 : (now() - s.sentAt) / 1000);
  const lockEls = () => { const l = typeof o.lock === 'function' ? o.lock() : o.lock; return l ? Array.from(l instanceof Element ? [l] : l).filter((x) => x instanceof Element) : []; };
  const sibs = () => (o.siblings ?? Array.from((box ?? host).querySelectorAll('button'))).filter((b) => b !== button);
  const hold = (els, on, flag) => { for (const b of els) { if (on) { if (!b.disabled) { b.disabled = true; b.dataset[flag] = '1'; } } else if (b.dataset[flag]) { b.disabled = false; delete b.dataset[flag]; } } };
  const busyLine = () => (s.state === 'confirming' ? confirmingWords(elapsedS(), o.usual ?? o.expectS ?? null)
    : notReceived ? `${NOT_RECEIVED} · ${elapsedClock(elapsedS())}`
    : applyingWords(applyText ?? o.pending ?? (o.what ? applyingText(o.what) : 'Sending to bitcube…'), elapsedS(), o.expectS));
  function paint() {
    const v = ctlView(s, o.why);
    button.textContent = o.label;
    button.className = `btn ${o.kind === 'primary' ? 'primary' : o.kind === 'danger' ? 'danger' : ''}`.trim();
    if (o.before instanceof Node) { if (beforeEl.firstChild !== o.before) beforeEl.replaceChildren(o.before); }
    else if (beforeEl.innerHTML !== (o.before || '')) beforeEl.innerHTML = o.before || '';
    beforeEl.hidden = !o.before;
    // while its own change is applying the model may already say "wait: <its own change>": the applying line says it
    // nor a "Wait: …" about this control's own change, whose lock still holds after bitcube didn't answer it (R8 #18)
    // (only while its own line says when it unlocks: a greyed control always has its reason, R9 #29)
    const own = (!!entryId && !!o.whyBy && o.whyBy === entryId && held) || o.whyOwn === true;
    const w = o.why && !v.busy && !own ? whyText(o.why) : '';
    if (whyEl.textContent !== w) whyEl.textContent = w;
    whyEl.hidden = !w;
    // what had focus and is disabled now (the button, a sibling, a locked input: another phone's change arrived, or this one
    // started) can't keep it: the line that says why takes it (its status line while its own change is in flight), never an
    // empty line and never <body>; when the block ends, focus goes back to the button (R6 #2, #7, #28)
    const had = document.activeElement;
    button.disabled = v.disabled;
    box?.classList.toggle('off', !!o.why && !v.busy);
    if (v.busy) host.setAttribute('aria-busy', 'true'); else host.removeAttribute('aria-busy');
    hold(sibs(), v.busy, 'mcHeld');
    hold(lockEls(), v.lockInputs, 'mcLocked');
    if (had && had !== document.body && had.disabled && (had === button || (box ?? host).contains(had) || lockEls().includes(had))) {
      const spot = v.busy ? (says(status) ? status : null) : (says(whyEl) ? whyEl : null);
      if (!(spot && focusEl(spot)) && !park(host, beforeEl)) park(box ?? host);
      if (!v.busy && had === button) parked = true;
    }
    const cls = `ctl-status${v.busy ? ` pending ${s.state}` : ['done', 'failed', 'unconfirmed'].includes(s.state) ? ` ${s.state}` : ''}`;
    if (status.className !== cls) status.className = cls;
    if (v.busy) {
      const line = busyLine(), t = status.querySelector('.t');
      if (!t || !status.querySelector('.spin')) status.innerHTML = `<span class="spin" aria-hidden="true"></span><span class="t">${esc(line)}</span>`;
      else if (t.textContent !== line) t.textContent = line;
    } else {
      const html = text ? `<span class="t">${esc(text)}</span>` : '';
      if (status.innerHTML !== html) status.innerHTML = html;
    }
    // the block that moved focus off the button ended: it takes focus back, unless focus went elsewhere meanwhile
    if (parked && !button.disabled) {
      const a = document.activeElement;
      if (!a || a === document.body || a === whyEl || a === status || a === beforeEl || a === host || a === box || a?.classList?.contains('ctl-h')) button.focus({ preventScroll: true });
      parked = false;
    }
  }
  function ticking(on) {
    if (on && !untick) untick = tick(() => {
      // a control whose block was replaced (Lights' Start once the run shows) is done for: it neither ticks nor speaks
      if (!host.isConnected) { ticking(false); return; }
      // never by the clock alone: not while the page has no contact (a phone waking from sleep), and only once a reading taken
      // after the limit has been judged (R6 #0)
      const contact = lastStatus.wall == null || Date.now() - lastStatus.wall <= LOST_MS;
      if (s.state === 'confirming' && contact) { const n = ctlStep(s, { type: 'tick', expectS: o.expectS, now: now(), readAt: judgedAt }); if (n.state !== s.state) return go(n); }
      paint();
    });
    else if (!on && untick) { untick(); untick = null; }
  }
  /** Move to a new state: its words, the live region once, focus kept on the control, never on <body>. */
  function go(next, words = null) {
    // focus is ours to move only when it is on this control, or nowhere (<body>) as a press starts a change (Safari doesn't
    // focus a clicked button); a change that ends later never pulls focus from elsewhere on the page
    const was = s.state, idle = !document.activeElement || document.activeElement === document.body;
    const focusHere = host.contains(document.activeElement) || (idle && next.state === 'applying');
    s = next;
    const clockNow = sclock();
    // a control no longer on the page (its block moved on: the run's view replaced Start) says nothing: the new view speaks
    const announce = (t) => { if (host.isConnected) say(t); };
    if (s.state === 'applying' && was !== 'applying') { text = ''; judgedAt = null; announce(String(applyText ?? o.pending ?? (o.what ? applyingText(o.what) : 'Sending to bitcube…')).replace(/…$/, '')); }
    else if (s.state === 'confirming' && was !== 'confirming') announce(CONFIRMING_SAID);   // said once, without its time (R6 #9)
    else if (s.state === 'done' && was !== 'done') {
      const d = typeof o.done === 'function' ? o.done(result) : o.done;
      text = words ?? `${d} · ${clockNow}${result?.fixture ? ' (fixture mode: nothing really changed)' : ''}`;
      announce(text);
      try { o.onDone?.(result); } catch (e) { console.warn('onDone', e); }
    } else if (s.state === 'unconfirmed' && was !== 'unconfirmed') {
      if (words == null) saidExpired = true;   // the server gave up on it, or this page did: never said again as "gave up" (R10 #30)
      text = words ?? unconfirmedWords(o.what, sclock(sentServer ?? serverNow()), o.unconfirmed ?? 'look at the Now line, or call Gavin');   // names what was sent (R6 #16)
      announce(text);
    } else if (s.state === 'failed') { text = words ?? text; announce(text); }
    ticking(s.state === 'applying' || s.state === 'confirming');
    paint();
    // focus: a disabled button can't hold it, so its status line does while the change is in flight; when it ends, the button
    // takes it back if it can (a failure keeps focus on the control). Nothing moves while a sheet over it is up (it is modal;
    // its close() puts focus here), but a control inside the sheet (the menu's Check now) is handled like any other.
    const sheetUp = document.querySelector('dialog[open]');
    if (!focusHere || (sheetUp && !sheetUp.contains(host))) return;
    if (button.disabled) focusEl(status);
    else if (document.activeElement === status) button.focus({ preventScroll: true });
    // a press: its status line is on screen, whatever the zoom or the phone's way up (R8 #3)
    if (s.state === 'applying' && was !== 'applying') bringIntoView(status);
  }
  /** One of the page's hooks (onSent, onFail), never letting its slip stop the control. */
  const hook = (name, arg) => { try { o[name]?.(arg); } catch (e) { console.warn(name, e); } };
  /** The failure in model.js's words, the same as Status's; this page has no verdict of its own, so it points at Status. */
  const failText = (e) => failWords(o.fail, plainError(e), sclock(), { tail: 'Try again, or check Status.' });
  async function send(next) {
    applyText = null; entryId = null; saidExpired = false; held = false; lost = false; sentServer = serverNow();
    seenAt = null; unknown = 0; received = false; lostNet = false; lostErr = null; notReceived = false;
    requestId = newRequestId();          // this press's own id, sent with it (R8 #2)
    const token = sendToken = {};        // this press: an answer that comes after the server's verdict ended it changes nothing (R9 #1)
    // what was sent, and when on the server's clock (its last answer carried forward), for when its verdict can't be known (CR7 #4)
    try { sent = typeof o.sent === 'function' ? { ...o.sent(), sentAt: serverClock() } : null; } catch { sent = null; }
    go(next);
    try {
      const r = await o.run?.({ requestId });
      if (sendToken !== token) return;   // ended meanwhile on the server's verdict (R9 #1)
      if (typeof r?.applying_id === 'string') entryId = r.applying_id;
      if (r && r.ok === false && r.maybe === true) throw Object.assign(new Error(r.error || "bitcube didn't answer in time"), { status: 200, maybe: true, posted: true, serverMaybe: true });
      if (r && r.ok === false) throw Object.assign(new Error(r.error || "bitcube didn't answer"), { status: 200 });
      result = r;
    } catch (e) {
      if (sendToken !== token) return;   // ended meanwhile on the server's verdict (R9 #1)
      // its answer lost on the network: nothing said and focus left where it is; the next status answer finds its entry by the request
      // id it sent (update) and says the one state it is in, or that mission control never got it (R10 #6, #22, #31, #32)
      if (e?.network && tracked()) { lostNet = true; lostErr = e; try { lastStatus.h?.refresh?.(); } catch { /* the next poll */ } return; }
      if (typeof e?.applyingId === 'string') entryId = e.applyingId;     // a maybe answer still names its entry
      // no answer in its time, and the status answers since the press never knew its request id: mission control never got it (R10 #2)
      const contact = lastStatus.wall != null && Date.now() - lastStatus.wall <= LOST_MS;
      if (tracked() && e?.noAnswer && !e?.serverMaybe && !received && unknown >= UNKNOWN_ANSWERS && contact) {
        notReceived = false;
        try { o.onFail?.(e); } catch (x) { console.warn('onFail', x); }
        return go(ctlStep(s, { type: 'error', maybe: false, now: now() }), neverGotWords(sclock()));
      }
      notReceived = false;
      const maybe = !!(e?.maybe || (e?.noAnswer && e?.posted));
      lost = maybe && !e?.serverMaybe;   // lost on the network, or no answer in time: its entry may still say where it is (R9 #29)
      try { o.onFail?.(e); } catch (x) { console.warn('onFail', x); }
      // bitcube didn't answer a change whose lock holds (its entry stays to its limit): one state, when the buttons unlock (R8 #18);
      // by its action, the rule Status and the server follow too (model.js heldMaybe, CR8 #10)
      held = heldMaybe(o.action, { maybe, serverMaybe: e?.serverMaybe, entryId });
      return go(ctlStep(s, { type: 'error', maybe, now: now() }), held ? heldWords(o.what, sclock(byMinute(serverNow() + confirmLimitS(o.expectS) * 1000)))
        : maybe ? noAnswerText(e, o.noAnswer ?? 'the page shows what bitcube reports', serverNow()) : failText(e));
    }
    notReceived = false;
    try { o.onSent?.(result); } catch (e) { console.warn('onSent', e); }
    go(ctlStep(s, { type: 'ok', confirmed: typeof o.confirmed === 'function' || o.serverConfirms ? false : null, now: now() }));
  }
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const next = ctlStep(s, { type: 'press', why: o.why, confirm: !!o.confirm, now: now() });
    if (next.effect === 'send') return send(next);
    if (next.effect !== 'confirm') { s = next; paint(); return; }
    s = next; paint();
    const ask = confirm(typeof o.confirm === 'function' ? o.confirm() : o.confirm);
    asking = ask;
    const yes = await ask;
    if (asking !== ask || s.state !== 'confirm') return;   // withdrawn meanwhile (update): it already says "Not sent"
    asking = null;
    // judged again now it is answered: a control that became impossible meanwhile sends nothing
    const ans = ctlStep(s, { type: yes ? 'yes' : 'no', why: o.why, now: now() });
    if (ans.effect === 'send') return send(ans);
    if (ans.notSent) return go(ans, notSentWords(ans.notSent, sclock()));
    s = ans; paint();
  });
  function update(n = {}) {
    const { readAt, ...rest } = n;
    Object.assign(o, rest);
    // this control's own change, by the one rule Status follows too (model.js ownVerdict, CR8 #10): its entry (an answer lost on
    // the way back is found by the request id this press sent, R8 #2); a held change's unlock time by the server's own entry once
    // it is in, so its line and every "Wait: …" agree (R8 #18); the server's verdict on its own entry, by its id: confirmed
    // (done), expired (unconfirmed now), else waiting; when it can't be known, a reading taken after the send that shows it
    // (CR7 #4; sent: only a control that says what it sent, o.sent)
    const own = 'model' in n ? ownVerdict(n.model, { state: s.state, entryId, requestId, sent, serverConfirms: !!o.serverConfirms, held, saidExpired, lost }) : null;
    if (own) entryId = own.entryId;
    // each status answer since the press: does it know this press at all (R10 #2)? An answer lost on the network waits for it, saying
    // nothing (R10 #6, #22, #32); one whose entry left with no verdict, or that mission control never got, ends here
    if (own && s.state === 'applying' && tracked() && !own.judged) {
      // known: the server has an entry with its request id (ownVerdict finds it by that id while it is applying)
      const known = !!own.entryId;
      if (typeof readAt === 'number' && readAt !== seenAt && s.sentAt != null && readAt > s.sentAt) {
        seenAt = readAt;
        if (known) { unknown = 0; received = true; } else unknown += 1;
      }
      const gone = received && !known, never = !received && unknown >= UNKNOWN_ANSWERS;
      if (lostNet && (gone || never || elapsedS() * 1000 > (o.expectS === EXPECT_S.rebuild ? 420_000 : 75_000))) {
        sendToken = null; judgedAt = readAt ?? now(); notReceived = false;
        try { o.onFail?.(lostErr); } catch (x) { console.warn('onFail', x); }
        if (never) return go(ctlStep(s, { type: 'error', maybe: false, now: now() }), neverGotWords(sclock()));
        lost = true;
        return go(ctlStep(s, { type: 'error', maybe: true, now: now() }), noAnswerText(lostErr, o.noAnswer ?? 'the page shows what bitcube reports', serverNow()));
      }
      if (!lostNet && never && !notReceived) { notReceived = true; if (host.isConnected) say(NOT_RECEIVED); }
      else if (known && notReceived) notReceived = false;
    }
    if (own?.unlockAt != null && own.step !== 'held') text = heldWords(o.what, sclock(byMinute(own.unlockAt)));
    // its answer still on the way: the server's verdict on its entry ends it now, never at the POST's own limit (R9 #1); its late
    // answer is dropped (sendToken), so the hooks its page refreshes on run here, as send() would have run them: onSent for done and
    // confirming, onFail (with its entry) for expired and held, so Lights' Start, Dry run and Rebuild ask again (CR9 #10)
    if (own?.judged && s.state === 'applying') {
      sendToken = null; judgedAt = typeof readAt === 'number' ? readAt : now();
      notReceived = false;
      if (own.step === 'done' || own.step === 'confirming') hook('onSent', null);
      else if (own.step === 'expired') hook('onFail', Object.assign(new Error("bitcube didn't show it in time"), { applyingId: own.entryId, expired: true }));
      else if (own.step === 'held') hook('onFail', Object.assign(new Error("bitcube didn't answer in time"), { applyingId: own.entryId, maybe: true, serverMaybe: true }));
      else if (own.step === 'failed') hook('onFail', Object.assign(new Error(own.failed?.error || "bitcube couldn't do it"), { applyingId: own.entryId, status: 200, maybe: !!own.failed?.maybe }));
      // the server saw it fail (refused or failed; a quick one bitcube didn't answer: maybe), said once (R10 #31)
      if (own.step === 'failed') {
        const e = Object.assign(new Error(own.failed?.error || "bitcube couldn't do it"), { status: 200, serverMaybe: !!own.failed?.maybe });
        return go(ctlStep(s, { type: 'error', maybe: !!own.failed?.maybe, now: now() }), own.failed?.maybe ? noAnswerText(e, o.noAnswer ?? 'the page shows what bitcube reports', serverNow()) : failText(e));
      }
      if (own.step === 'done') return go(ctlStep(s, { type: 'model', confirmed: true, now: now() }));
      if (own.step === 'expired') return go(ctlStep(s, { type: 'expired', now: now() }));
      if (own.step === 'confirming') return go(ctlStep(s, { type: 'pending', now: now() }));
      if (own.step === 'held') { held = true; return go(ctlStep(s, { type: 'error', maybe: true, now: now() }), heldWords(o.what, sclock(byMinute(own.unlockAt)))); }
    }
    // its answer was lost, but its entry shows the server answered it: under way (R9 #29)
    if (own?.judged && own.step === 'confirming') { lost = false; text = ''; return go(ctlStep(s, { type: 'pending', now: now() })); }
    if (own?.judged && own.step === 'held') { lost = false; held = true; text = heldWords(o.what, sclock(byMinute(own.unlockAt))); say(text); paint(); return; }
    if (own?.judged) {
      judgedAt = typeof readAt === 'number' ? readAt : now();
      if (own.step === 'done') return go(ctlStep(s, { type: 'model', confirmed: true, now: now() }));
      // one that may or may not have happened, which the server saw fail: it didn't happen (R10 #31)
      if (own.step === 'failed' && !own.failed?.maybe) { lost = false; return go({ ...s, state: 'failed', at: now(), effect: null }, failText(Object.assign(new Error(own.failed?.error || "bitcube couldn't do it"), { status: 200 }))); }
      if (own.step === 'expired') return go(ctlStep(s, { type: 'expired', now: now() }));
      // one that may or may not have happened, which the server then gave up on: bitcube didn't show it (said once)
      if (own.step === 'gave-up') {
        saidExpired = true;
        text = unconfirmedWords(o.what, sclock(sentServer ?? serverNow()), o.unconfirmed ?? 'look at the Now line, or call Gavin');
        if (host.isConnected) say(text);
        paint();
        return;
      }
    } else if ('model' in n && (s.state === 'confirming' || s.state === 'unconfirmed') && typeof o.confirmed === 'function') {
      let yes = false;
      try { yes = !!o.confirmed(n.model, { sentAt: s.sentAt, answeredAt: s.answeredAt, result }); } catch (e) { console.warn('confirmed', e); }
      judgedAt = typeof readAt === 'number' ? readAt : now();   // when the reading just judged was taken
      if (yes) return go(ctlStep(s, { type: 'model', confirmed: true, now: now() }));
    } else if ('model' in n && s.state === 'done' && typeof o.holds === 'function') {
      let holds;
      try { holds = !!o.holds(n.model); } catch (e) { console.warn('holds', e); }
      const r = ctlStep(s, { type: 'reading', holds, why: o.why, now: now() });
      if (r.effect === 'drop') text = '';
      s = r;
    }
    const next = ctlStep(s, { type: 'why', why: o.why, now: now() });
    if (next.effect === 'withdraw') {
      // a confirm still open for a control that just became impossible is withdrawn, with the reason on the control and
      // focus on its status line (the sheet's close() puts it there: the button is disabled now)
      const a = asking; asking = null;
      go(next, notSentWords(next.notSent, sclock()));
      a?.close();
      if (!host.contains(document.activeElement)) focusEl(status);
      return;
    }
    s = next;
    paint();
  }
  /** Set a state by hand (the older names still work: 'before' is ready, 'pending' is applying). */
  function show(st, words = '') {
    if (st === 'before' || st === 'ready' || st === 'blocked') { s = ctlInit(o.why); text = ''; applyText = null; ticking(false); paint(); return; }
    if (st === 'pending' || st === 'applying') { applyText = words || null; s = { ...ctlInit(), state: 'applying', sentAt: now(), at: now() }; text = ''; ticking(true); paint(); return; }
    if (st === 'confirming') { s = { ...s, state: 'confirming', sentAt: s.sentAt ?? now(), at: now() }; ticking(true); paint(); return; }
    s = { ...s, state: CTL_RESULT.has(st) ? st : 'failed', at: now(), effect: null }; text = words; ticking(false); paint();
  }
  paint();
  return { button, host, status, show, update, get state() { return s.state; }, get busy() { return ctlView(s, o.why).busy; }, get entryId() { return entryId; },
           get at() { return s.at; }, get text() { return text; } };
}
const CTL_RESULT = new Set(['done', 'failed', 'unconfirmed']);

// ---- a re-render patches the page in place ---------------------------------------------------------------------------
// A section drawn anew from its markup re-creates every node in it, so the focused tile, button or row was a new node at every poll
// and a screen reader read it out again (R9 #7), the node a screen reader's cursor was on went, a box lost its caret (R8 #29) and a
// picture reloaded. morph() makes the section's content the new markup by patching what is there instead.
const MORPH_KEYS = [...KEY_ATTRS, 'data-rule', 'data-ctl', 'data-still'];
/** An element's identity among its siblings: its id, else its data-* identity (focusKey's attributes and a few more), else null. */
function morphKey(n) {
  if (n.nodeType !== 1) return null;
  if (n.id) return `#${n.id}`;
  let k = '';
  for (const a of MORPH_KEYS) { const v = n.getAttribute(a); if (v != null) k += `[${a}=${v}]`; }
  return k ? n.tagName + k : null;
}
/** Is old node o the same thing as new node n: text with text; an element of the same tag and identity, or, with none, the same
 *  first class (unkeyed elements of different kinds never patch into each other). */
function sameNode(o, n) {
  if (o.nodeType !== n.nodeType) return false;
  if (o.nodeType !== 1) return true;
  if (o.tagName !== n.tagName) return false;
  const k = morphKey(n);
  return k ? morphKey(o) === k : !morphKey(o) && (o.classList[0] ?? null) === (n.classList[0] ?? null);
}
/** morph(el, html): el's content becomes html, patched in place: an element that is the same thing in the new markup (its id or data-*
 *  identity anywhere among its siblings, else its place, tag and first class) stays itself, takes the new markup's attributes and has
 *  its own content patched the same way; only what is new is made and only what went is removed. So the focused tile, button, row or
 *  line is never re-created (a screen reader doesn't read it again: R9 #7), the box being typed in keeps its caret and what was typed
 *  (R8 #29), a screen reader's cursor keeps its place, and a picture whose address is the same never reloads. */
export function morph(el, html) {
  if (!(el instanceof Element)) return;
  const t = document.createElement('template');
  t.innerHTML = html;
  morphKids(el, t.content);
}
function morphKids(op, np) {
  const kept = new Set();                 // old nodes matched, and new nodes put in
  let cur = op.firstChild;                // where the next node goes: before this one
  for (let n = np.firstChild; n;) {
    const next = n.nextSibling;
    let m = null;
    if (morphKey(n)) { for (let c = op.firstChild; c; c = c.nextSibling) if (!kept.has(c) && sameNode(c, n)) { m = c; break; } }
    else if (cur && !kept.has(cur) && sameNode(cur, n)) m = cur;
    if (!m) { op.insertBefore(n, cur); kept.add(n); n = next; continue; }
    kept.add(m);
    if (m === cur) cur = m.nextSibling;
    else if (cur && cur.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) cur = m.nextSibling;   // what it skipped goes, or moves
    else op.insertBefore(m, cur);         // a node skipped earlier, now wanted here (only a reorder moves a node)
    patchNode(m, n);
    n = next;
  }
  for (let c = op.firstChild; c;) { const nx = c.nextSibling; if (!kept.has(c)) c.remove(); c = nx; }
}
/** Old node o takes new node n's text, or its attributes and (patched the same way) its content. What the page gave at run time stays:
 *  the tabindex -1 a line holding focus was given (focusEl: taking it away would drop focus to <body>), and a box's value while it is
 *  being typed in (a box not focused shows the markup's value, as a new one would). */
function patchNode(o, n) {
  if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
  for (const a of [...o.attributes]) if (!n.hasAttribute(a.name) && !(a.name === 'tabindex' && a.value === '-1')) o.removeAttribute(a.name);
  for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  if (o instanceof HTMLInputElement && o !== document.activeElement) { const v = n.getAttribute('value') ?? ''; if (o.value !== v) o.value = v; }
  morphKids(o, n);
}

// ---- keeping what you are working on in view -----------------------------------------------------------------------
/** The part of the window the page shows: between the sticky header and a fixed tab bar or composer at the bottom (their real
 *  heights: the header wraps at 200 % zoom, a landscape phone's bars are lower). { top, bottom } in viewport px. */
function shownBand() {
  const head = document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0;
  const bars = [...document.querySelectorAll('nav.tabs, section.composer')].map((b) => b.getBoundingClientRect()).filter((b) => b.height && b.bottom >= innerHeight - 2 && b.top > innerHeight / 2);
  return { top: Math.max(0, head), bottom: bars.length ? Math.min(...bars.map((b) => b.top)) : innerHeight };
}
/** Is n on screen between the header and a fixed tab bar or composer (any part of it; whole: all of it)? */
export function onScreen(n, { whole = false } = {}) {
  if (!(n instanceof Element) || !n.isConnected) return false;
  const r = n.getBoundingClientRect();
  if (!r.height && !r.width) return false;
  const b = shownBand();
  return whole ? r.top >= b.top - 1 && r.bottom <= b.bottom + 1 : r.bottom > b.top + 4 && r.top < b.bottom - 4;
}
/** The smallest scroll that shows all of n between the header and the bars at the bottom (its top first when it is taller than
 *  that); nothing when it is shown already. */
export function bringIntoView(n) {
  if (!(n instanceof Element) || !drawn(n)) return false;
  // inside a sheet (the menu's Check now): the sheet's own scroll, never the page behind it
  if (n.closest('dialog')) { n.scrollIntoView({ block: 'nearest', behavior: 'auto' }); return true; }
  if (onScreen(n, { whole: true })) return false;
  const r = n.getBoundingClientRect(), b = shownBand(), pad = 8;
  const dy = r.top < b.top + pad || r.height > b.bottom - b.top - 2 * pad ? r.top - (b.top + pad) : r.bottom - (b.bottom - pad);
  if (Math.abs(dy) < 1) return false;
  scrollBy({ top: dy, behavior: 'auto' });
  return true;
}
/** Where n is now, for keepInView: { on (any part on screen), top, height }. */
export function placeOf(n) {
  if (!(n instanceof Element) || !n.isConnected) return null;
  const r = n.getBoundingClientRect();
  return { on: onScreen(n), top: r.top, height: r.height };
}
/** After a re-render that moved n or changed its size (a row that changed group: Ropes → Dark, a restart; a status line that grew
 *  a line), bring all of it back into view when it was on screen before and isn't wholly now: the smallest scroll that shows it,
 *  never a jump to a place the reader scrolled away from (R7 #0, #8), and nothing when it stayed where it was (the reader's own
 *  scroll is theirs). In landscape and at 200 % zoom too (R8 #3): the bars' real heights, not the tokens'. before: placeOf(n)
 *  taken before the re-render (true: it was on screen, moved). */
export function keepInView(n, before) {
  const b = before === true ? { on: true, top: NaN, height: NaN } : before;
  if (!b?.on || !(n instanceof Element) || !drawn(n)) return false;
  const r = n.getBoundingClientRect();
  const moved = !(Math.abs(r.top - b.top) <= 2 && Math.abs(r.height - b.height) <= 2);
  if (!moved || onScreen(n, { whole: true })) return false;
  return bringIntoView(n);
}

// ---- goto: open a card's ancestors, scroll, flash -------------------------------------------------------------
/** goto(id) opens every <details> around the element, scrolls to it and flashes it once. */
export function goto(id) {
  const target = document.getElementById(id);
  if (!target) return false;
  for (let d = target.tagName === 'DETAILS' ? target : target.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 1800);
  return true;
}

// ---- the menu: who to call, recent, check now, theme, links, log out -----------------------------------------------
async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (r.status === 401) { location.href = '/login'; throw new Error('logged out'); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/** The contacts file as the server serves it, in any of the shapes it might take, → [{ key, name, owns, tel }] with model.js's names. */
function normaliseContacts(j) {
  let list = j?.contacts ?? j;
  if (list && !Array.isArray(list) && typeof list === 'object') list = Object.entries(list).map(([k, v]) => (typeof v === 'string' ? { key: k, tel: v } : { key: k, ...v }));
  if (!Array.isArray(list)) list = [];
  const out = [];
  for (const [key, c] of Object.entries(CONTACTS)) {
    const hit = list.find((x) => String(x.key ?? x.id ?? x.name ?? '').toLowerCase() === key || String(x.name ?? '').toLowerCase() === c.name.toLowerCase());
    out.push({ key, name: hit?.name ?? c.name, owns: hit?.owns ?? c.owns, tel: hit?.tel ?? hit?.phone ?? hit?.number ?? null });
  }
  for (const x of list) if (!out.some((o) => o.name.toLowerCase() === String(x.name ?? x.key ?? '').toLowerCase())) out.push({ key: x.key ?? x.name, name: x.name ?? x.key ?? '?', owns: x.owns ?? '', tel: x.tel ?? x.phone ?? x.number ?? null });
  return out;
}
const telHref = (t) => 'tel:' + String(t).replace(/[^\d+]/g, '');
async function openContacts(shell) {
  const s = sheet({ title: 'Who to call', body: '<p class="muted">Looking up the numbers…</p>', actions: [{ label: 'Back to the menu', onClick: () => openMenu(shell) }, { label: 'Close' }], row: true });
  let list, note = '';
  try { list = normaliseContacts(await getJSON('/api/contacts')); }
  catch (e) { list = normaliseContacts(null); note = /404|not found/i.test(e.message) ? "The numbers aren't on this mission control yet: first names and what they own, for now." : `Couldn't fetch the numbers: ${plainError(e)}.`; }
  if (!list.some((c) => c.tel) && !note) note = 'No numbers on file yet.';
  const rows = list.map((c) => c.tel
    ? `<a class="contact" href="${esc(telHref(c.tel))}"><b>Call ${esc(c.name)}</b><span>${esc(c.owns)}</span><span class="tel">${esc(String(c.tel))}</span></a>`
    : `<div class="contact"><b>${esc(c.name)}</b><span>${esc(c.owns)}</span></div>`).join('');
  s.el.querySelector('p').outerHTML = `${note ? `<p class="muted secondary">${esc(note)}</p>` : ''}<div>${rows}</div>`;
}
/** Recent: the history's feed, kept current while the sheet shows it (R9 #2): asked again every 5 s (a request's verdict, a new
 *  line), its ages ticking every second from the server's own clock, never a snapshot that still says "Asked to … 2 s ago" a minute
 *  later. A failed refresh keeps the list it has. */
export const RECENT_EVERY_MS = 5000;
async function openRecent(shell) {
  const s = sheet({ title: 'Recent', body: '<div class="recent-host"><p class="muted">Fetching…</p></div>', actions: [{ label: 'Back to the menu', onClick: () => openMenu(shell) }, { label: 'Close' }], row: true });
  const host = s.el.querySelector('.recent-host');
  const st = { j: null, at: null, wall: null, err: null, busy: false, html: null };
  const showing = () => host.isConnected && !!host.closest('dialog')?.open;
  // ages on the history's own clock (its answer's `now`: the server's real clock, also in fixture mode, where the status clock is the
  // scenario's), carried forward since that answer
  const ages = () => { const now = typeof st.j?.now === 'number' ? carried(st.j.now, st.at, st.wall) : Date.now(); host.querySelectorAll('[data-t]').forEach((x) => { const w = fmt.ago(now - Number(x.dataset.t)); if (x.textContent !== w) x.textContent = w; }); };
  const draw = () => {
    let html;
    if (st.j) {
      const evs = (Array.isArray(st.j) ? st.j : st.j?.events ?? st.j?.recent ?? []).slice(0, 40);
      html = evs.length ? `<div class="recent">${evs.map((e) => {
        const words = e.words ?? e.text ?? e.sentence ?? e.headline ?? e.summary ?? e.note ?? 'Something happened';
        const t = typeof e.t === 'number' ? e.t : typeof e.at === 'number' ? e.at : null;
        return `<div class="ev"><span>${esc(words)}</span><span class="when"${t == null ? '' : ` data-t="${t}"`}></span></div>`; }).join('')}</div>`
        : '<p class="muted">Nothing recorded yet.</p>';
    } else html = `<p class="muted">${/404|not found/i.test(st.err?.message ?? '') ? 'Not available on this mission control yet.' : `Couldn't fetch it: ${esc(plainError(st.err))}.`}</p>`;
    if (st.html !== html) { st.html = html; host.innerHTML = html; }
    ages();
  };
  const load = async () => {
    if (st.busy) return;
    st.busy = true;
    try { const j = await getJSON('/api/history'); st.j = j; st.at = performance.now(); st.wall = Date.now(); st.err = null; }
    catch (e) { st.err = e; }
    finally { st.busy = false; }
    if (showing()) draw();
  };
  await load();
  const timer = setInterval(() => { if (!showing()) { clearInterval(timer); untick(); return; } load(); }, RECENT_EVERY_MS);
  const untick = tick(() => { if (!showing()) { clearInterval(timer); untick(); return; } ages(); });
}
function openMenu(shell) {
  const t = getTheme();
  const body = el(`<div class="stack">
    <div class="menu-row">
      <button class="btn" type="button" data-m="contacts">Who to call <span class="chev" aria-hidden="true">›</span></button>
      <button class="btn" type="button" data-m="recent">Recent <span class="chev" aria-hidden="true">›</span></button>
      <div class="ctl" data-m="check-host"><div class="ctl-h" data-m="check-h">The full check</div><div class="ctl-before"></div><button class="btn" type="button" data-m="check">Check now</button><div class="ctl-status"></div></div>
    </div>
    <div><div class="ctl-h">Theme</div><div class="seg" role="group" aria-label="Theme">${['auto', 'light', 'dark'].map((x) => `<button type="button" data-theme="${x}" class="${t === x ? 'lit' : ''}" aria-pressed="${t === x}">${cap(x)}</button>`).join('')}</div></div>
    <div class="links">${[rememberedLink(), ...DOC_LINKS].map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div>
  </div>`);
  const s = sheet({ title: 'Menu', body, actions: [{ label: 'Log out', onClick: () => logout(shell) }, { label: 'Close' }], row: true });
  body.querySelector('[data-m="contacts"]').onclick = () => openContacts(shell);
  body.querySelector('[data-m="recent"]').onclick = () => openRecent(shell);
  body.querySelector('.seg').onclick = (e) => { const b = e.target.closest('[data-theme]'); if (!b) return; setTheme(b.dataset.theme); body.querySelectorAll('[data-theme]').forEach((x) => { x.classList.toggle('lit', x === b); x.setAttribute('aria-pressed', x === b); }); };
  // the eyebrow over the button says what it does: the full check, or, while bitcube is offline, reaching bitcube (R6 #24)
  const eyebrow = body.querySelector('[data-m="check-h"]');
  const words = (offline) => { eyebrow.textContent = offline ? 'Reach bitcube' : 'The full check'; return checkWords(offline); };
  const check = control(body.querySelector('[data-m="check"]'), { ...words(bitcubeOffline()), fail: "The check didn't start", expectS: EXPECT_S.check,
    run: async () => { shell.setChecking(true); try { return await api('/api/control/check', {}); } finally { shell.setChecking(false); } },
    onDone: () => document.dispatchEvent(new CustomEvent('mc:check')) });
  // a page that doesn't poll the status (the studio chat) asks once, so the button says what it will do
  if (bitcubeOffline() == null) fetchStatus().then((j) => { if (j && !check.busy && check.button.isConnected) check.update(words(j?.bitcube?.value?.online === false)); });
}
/** The menu's link to the Remembered river page that matches the file TouchDesigner runs (remembered-v2-words.js rememberedPage:
 *  /remembered-v2 for river-all-looks-v2.toe, else /remembered), by the newest /api/status this page polled. */
function rememberedLink() {
  const td = lastStatus.j?.probe?.value?.td;
  return td && td.ok !== false && td.file === REMEMBERED_V2_FILE ? ['Remembered river v2 (inputs, overrides)', '/remembered-v2'] : ['Remembered river (debug view)', '/remembered'];
}
/** The menu's Check now, in the same words as Status's: "Try bitcube again" (the quick check) while bitcube is offline. */
function checkWords(offline) {
  return offline ? { label: 'Try bitcube again', before: 'Asks the Mac mini to reach bitcube again now, instead of waiting for its next try.', pending: 'Asking bitcube again…', done: 'Asked bitcube again; the page updates if it answers' }
    : { label: 'Check now', before: 'Asks bitcube to check everything now instead of waiting for the next minute.', pending: 'Asking bitcube to check everything now…', done: 'Check started; the page updates as answers come in' };
}
/** Is bitcube offline, by the newest /api/status this page polled (null: this page doesn't poll it)? */
function bitcubeOffline() { const j = lastStatus.j; return j ? j?.bitcube?.value?.online === false : null; }
async function fetchStatus() {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS);
  try { const r = await fetch('/api/status', { cache: 'no-store', signal: ctrl.signal }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(t); }
}
async function logout() {
  if (!(await confirm({ title: 'Log out?', body: "You'll need the team password to log back in.", ok: 'Log out', cancel: 'Stay logged in', destructive: false }))) return;
  try { await fetch('/logout', { method: 'POST' }); } catch { /* the login page is the answer either way */ }
  location.href = '/login';
}

// ---- mountShell: art, header, tab bar, menu, sheet -----------------------------------------------------------------
/** mountShell({ page: 'status' | 'lights' | 'chat' | 'map', title }) builds the art, the header, the tab bar and the menu;
 *  returns { setAge(ms | null), setStale(level | null), setChecking(bool), openMenu() }. setAge(ms): how old this page's
 *  last good answer is (0 just now; null: nothing yet → "Connecting…"); the header ticks it on by itself. setStale(level):
 *  null/'ok' → "Updated N s ago"; 'warning' (amber, from 12 s) or 'down' (red, from 30 s) → "No answer for N s". */
export function mountShell({ page = 'status', title = '' } = {}) {
  art.mount();
  const titleTag = page === 'status' ? 'span' : 'h1';   // Status's h1 is the verdict; every other page is named by its title
  if (!art.current) art.setSeason(null);
  const header = el(`<header class="top">
    <div class="brand"><span class="wordmark">Mission control</span><${titleTag} class="title">${esc(title || TABS.find((t) => t[0] === page)?.[1] || '')}</${titleTag}></div>
    <div class="fresh" id="mc-fresh">Connecting…</div>
    <a class="help-btn" href="/help#${esc(HELP_SECTION[page] ?? 'toc')}" aria-label="Help" title="Help: how to play with the piece and get ready for the show">?</a>
    <button class="menu-btn" type="button" aria-label="Menu" aria-haspopup="dialog" title="Menu">⋯</button></header>`);
  const main = $('main');
  if (main) main.before(header); else document.body.prepend(header);
  // the System map has no tab of its own: it is reached from Status, so Status is marked as where you are (its parent); the
  // HUB75 simulator and the Remembered river page likewise sit under Lights
  const tabOf = page === 'map' || page === 'explainer' ? 'status' : page === 'hub75' || page === 'remembered' || page === 'remembered-v2' ? 'lights' : page;
  if (!$('nav.tabs')) document.body.append(el(`<nav class="tabs" aria-label="Pages">${TABS.map(([k, l, h, svg]) =>
    `<a href="${h}" class="${k === tabOf ? 'on' : ''}" ${k === tabOf ? `aria-current="${k === page ? 'page' : 'true'}"` : ''}>${svg}${esc(l)}</a>`).join('')}</nav>`));
  // the focus order follows where the tabs are drawn: last on a phone (the bar at the bottom), right after the header from
  // 900 px (the pill at the top), so a keyboard reaches them beside the menu instead of after the whole page
  const nav = $('nav.tabs'), wide = matchMedia('(min-width: 900px)');
  const placeTabs = () => { if (wide.matches) { if (header.nextElementSibling !== nav) header.after(nav); } else if (document.body.lastElementChild !== nav) document.body.append(nav); };
  placeTabs(); wide.addEventListener('change', placeTabs);
  dialog();
  liveRegion();                 // made before anything is said into it, so the first announcement is heard
  // the header's real height (it wraps at 200 % zoom) for the page's scroll padding: a jump or a tab never lands under it (R8 #3)
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => document.documentElement.style.setProperty('--header-real', `${header.offsetHeight}px`)).observe(header);
  const fresh = header.querySelector('#mc-fresh');
  const st = { ageMs: null, setAt: null, stale: null, checking: false, waitingSince: null };
  const shell = {
    setAge(ms) { st.ageMs = ms == null ? null : Math.max(0, ms); st.setAt = performance.now(); if (ms != null) st.waitingSince = null; paint(); },
    /** Before the first answer: when the page started asking (performance.now()), for "No answer yet · N s". */
    setWaiting(since) { st.waitingSince = since ?? null; paint(); },
    setStale(level) { st.stale = level === 'warning' || level === 'down' ? level : null; paint(); },
    setChecking(on) { st.checking = !!on; paint(); },
    openMenu: () => openMenu(shell),
  };
  function age() { return st.ageMs == null ? null : st.ageMs + (performance.now() - st.setAt); }
  function paint() {
    const a = age();
    let text, cls = 'fresh';
    // "Checking…" only before the first answer: while polls succeed the header keeps its age, a check in flight or not (R10 #3)
    if (st.checking && a == null && !st.stale) text = 'Checking…';
    else if (st.stale) { text = a == null ? `No answer yet${st.waitingSince != null ? ` · ${nbsp(modelDur((performance.now() - st.waitingSince) / 1000))}` : ''}` : `No answer for ${nbsp(modelDur(a / 1000))}`; cls += ` lv-${st.stale}`; }
    else text = a == null ? 'Connecting…' : `Updated ${nbsp(modelDur(a / 1000))} ago`;
    if (fresh.textContent !== text) fresh.textContent = text;
    if (fresh.className !== cls) fresh.className = cls;
  }
  tick(paint);
  header.querySelector('.menu-btn').onclick = () => openMenu(shell);
  return shell;
}
