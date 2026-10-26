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
//   function render() {               // the model judges on the server's clock, carried forward by this phone's monotonic clock
//     const m = p.last ? derive(p.last, p.last.now + (performance.now() - p.receivedAt)) : null;
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
import { api as rawApi, esc, md, plainError, noAnswerText } from '/app.js';
import { dur as modelDur, CONTACTS, TZ, ctlInit, ctlStep, ctlView, applyingWords, applyingText, confirmingWords, CONFIRMING_SAID, unconfirmedWords,
  notSentWords, failWords, EXPECT_S } from '/model.js';

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
  map: ['System map (for engineers)', '/map'],
  files: ['Show files', 'https://gavaiken.github.io/river-bitcube/show-files'],
  install: ['Install guide', 'https://gavaiken.github.io/river-bitcube/install'],
  plan: ['The plan', 'https://gavaiken.github.io/river-bitcube/execution-plan'],
};
/** The footer's links, in order: [label, href]. */
export const DOC_LINKS = [LINKS.map, LINKS.files, LINKS.install, LINKS.plan];
const TABS = [
  ['status', 'Status', '/status', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>'],
  ['lights', 'Lights', '/lights', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.6 1 1.3 1 2.5h6c0-1.2.3-1.9 1-2.5A6 6 0 0 0 12 3z"/></svg>'],
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
  // mission control answered, but bitcube didn't in time (lib/lights.mjs noAnswer): it may or may not have happened
  if (j && j.ok === false && j.maybe === true) throw Object.assign(new Error(j.error || "bitcube didn't answer in time"), { status: 200, maybe: true, posted: true, serverMaybe: true });
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
/** "cause: consequence" -> [cause, consequence], splitting at the first top-level ":" or ";" (never inside parentheses),
 *  or at a trailing parenthesis. Status's band and Lights' state line share it. */
export function splitHeadline(h) {
  h = String(h ?? '');
  let depth = 0;
  for (let i = 0; i < h.length; i++) {
    const c = h[i];
    if (c === '(') depth++; else if (c === ')') depth--;
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
 *  it arrived, so a page renders derive(p.last, p.last.now + (performance.now() - p.receivedAt)). 401 → /login. */
export const POLL_TIMEOUT_MS = 8000;   // a request that hangs this long counts as a failure (a phone's handover, a lock mid-fetch)
const lastStatus = { j: null, wall: null };   // the newest /api/status any poll() on this page received, and when (Date.now())
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
      if (/^\/api\/status\b/.test(url)) { lastStatus.j = j; lastStatus.wall = h.receivedWall; }
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
  if (!d) { d = el('<dialog id="mc-sheet" class="sheet" aria-labelledby="mc-sheet-title"></dialog>'); document.body.append(d); }
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
/** sheet({ title, body, actions, focus }) opens the bottom sheet (body: HTML string or a Node; actions: [{ label, kind: 'primary'|'danger'|'plain',
 *  onClick, keep }] stacked full width, each closes the sheet unless `keep`); a Close button when there are no actions.
 *  `focus`: the index of the action that takes focus when it opens (default: the browser's choice, the first control).
 *  Returns { close, el }; a click on the backdrop or Escape closes it. A sheet opened over another replaces it. On close,
 *  focus goes back to what opened it, found again by its data-* identity when a re-render replaced it meanwhile. */
export function sheet({ title, body = '', actions = null, onClose = null, focus = null } = {}) {
  const d = dialog();
  const opener = d.open ? d._mcOpener : document.activeElement;
  const openerKey = d.open ? d._mcOpenerKey : focusKey(document.activeElement);
  d._mcReplaced?.();            // the sheet this one replaces: its promise (a confirm) resolves false; the dialog stays open
  d.innerHTML = '';
  const inner = el('<div class="sheet-in" role="document"></div>');
  if (title) inner.append(el(`<h3 id="mc-sheet-title" tabindex="-1">${esc(title)}</h3>`));
  if (body instanceof Node) inner.append(body); else if (body) inner.insertAdjacentHTML('beforeend', body);
  const desc = inner.querySelector(':scope > p, :scope > div > p');
  if (desc) { desc.id ||= 'mc-sheet-desc'; d.setAttribute('aria-describedby', desc.id); } else d.removeAttribute('aria-describedby');
  if (title) { d.setAttribute('aria-labelledby', 'mc-sheet-title'); d.removeAttribute('aria-label'); } else { d.removeAttribute('aria-labelledby'); d.setAttribute('aria-label', 'Details'); }
  const acts = actions ?? [{ label: 'Close', kind: 'plain' }];
  const stack = el('<div class="stack"></div>');
  const btns = [];
  for (const a of acts) {
    const b = el(`<button class="btn ${a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'danger' : ''}" type="button">${esc(a.label)}</button>`);
    b.onclick = async () => { try { await a.onClick?.(b); } finally { if (!a.keep) close(); } };
    stack.append(b); btns.push(b);
  }
  inner.append(stack);
  d.append(inner);
  let closed = false;
  const mine = {};
  d._mcToken = mine; d._mcOpener = opener; d._mcOpenerKey = openerKey;
  d._mcReplaced = () => { if (closed) return; closed = true; onClose?.(); };
  function close() {
    if (closed) return;
    closed = true;
    if (d._mcToken === mine) {
      d._mcToken = null; d._mcReplaced = null; d.onclick = null; d.oncancel = null;
      if (d.open) d.close();
      // the button that opened it may have been replaced by a re-render while the sheet was up: find its successor.
      // A disabled opener (a confirm withdrawn because the control became impossible, a change now applying, a run that
      // ended) can't hold focus: its status line takes it, never <body>, also when the opener has no data-* identity.
      const st = opener instanceof Element && opener._mcStatus?.isConnected ? opener._mcStatus : null;
      if (!(opener instanceof Element && opener.isConnected) || opener.disabled) { if (!refocus(openerKey, document, st) && !(st && focusEl(st))) park(opener instanceof Element ? opener.closest('.ctl, [data-ctl], .ctl-host') : null); }
    }
    onClose?.();
  }
  d.onclick = (e) => { if (e.target === d || e.target.closest('[data-sheet="close"]')) close(); };
  d.oncancel = (e) => { e.preventDefault(); close(); };
  if (!d.open) d.showModal();
  if (focus != null && btns[focus]) btns[focus].focus();
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

// ---- one page-level live region ---------------------------------------------------------------------------------
/** announce(text): says it once through the page's one polite live region (status.html's #ctl-live, else #mc-live, made by
 *  mountShell): a control's applying, done, unconfirmed and failed, a stepper's new value. Never a ticking time. */
export function announce(text) {
  const l = liveRegion();
  if (!l) return;
  clearTimeout(announce.t);
  l.textContent = '';                                   // the same words twice are read twice
  announce.t = setTimeout(() => { l.textContent = String(text ?? ''); }, 60);
}
function liveRegion() {
  if (typeof document === 'undefined' || !document.body) return null;
  let l = document.getElementById('ctl-live') ?? document.getElementById('mc-live');
  if (!l) { l = el('<div id="mc-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>'); document.body.append(l); }
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
 *    confirm    a confirm() spec (or a function returning one), asked first; focus starts on the safe button
 *    run()      async: POSTs via api() and returns the answer (ok: false or a throw is a failure)
 *    pending | what   the applying line: `pending` as written, else "Applying: <what>…" (default "Sending to bitcube…"); `what`
 *               (team words: "the rebuild of the river's year") also names the change when it goes unconfirmed
 *    expectS    the change's usual seconds (model.js EXPECT_S): over 20, the applying line shows m:ss and "usually about N" from
 *               the start; a shorter one (10 s when not given) once it runs past it ("usually a few seconds"); the confirming
 *               line gives it too. usual: words of its own for the confirming line instead
 *    confirmed(model, { sentAt, result }) → boolean: given, a 2xx waits in "confirming" until update({ model, readAt }) shows it,
 *               or turns "unconfirmed" after max(3 × expectS, 120) s, but only once a reading taken after that limit has been
 *               judged (readAt: when that reading was taken, Date.now() by default; nothing is judged while the page has no
 *               contact), so a phone that slept through it never goes unconfirmed by its clock alone; an unconfirmed change a
 *               later reading shows ends done. Without it, the answer itself is bitcube's reading
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
 *  show(state, text) sets a state by hand ('before'/'ready', 'pending'/'applying', 'done', 'failed', 'unconfirmed'). */
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
  let s = ctlInit(o.why), text = '', applyText = null, result = null, asking = null, untick = null, judgedAt = null, parked = false;
  const now = () => Date.now();
  const elapsedS = () => (s.sentAt == null ? 0 : (now() - s.sentAt) / 1000);
  const lockEls = () => { const l = typeof o.lock === 'function' ? o.lock() : o.lock; return l ? Array.from(l instanceof Element ? [l] : l).filter((x) => x instanceof Element) : []; };
  const sibs = () => (o.siblings ?? Array.from((box ?? host).querySelectorAll('button'))).filter((b) => b !== button);
  const hold = (els, on, flag) => { for (const b of els) { if (on) { if (!b.disabled) { b.disabled = true; b.dataset[flag] = '1'; } } else if (b.dataset[flag]) { b.disabled = false; delete b.dataset[flag]; } } };
  const busyLine = () => (s.state === 'confirming' ? confirmingWords(elapsedS(), o.usual ?? o.expectS ?? null)
    : applyingWords(applyText ?? o.pending ?? (o.what ? applyingText(o.what) : 'Sending to bitcube…'), elapsedS(), o.expectS));
  function paint() {
    const v = ctlView(s, o.why);
    button.textContent = o.label;
    button.className = `btn ${o.kind === 'primary' ? 'primary' : o.kind === 'danger' ? 'danger' : ''}`.trim();
    if (o.before instanceof Node) { if (beforeEl.firstChild !== o.before) beforeEl.replaceChildren(o.before); }
    else if (beforeEl.innerHTML !== (o.before || '')) beforeEl.innerHTML = o.before || '';
    beforeEl.hidden = !o.before;
    // while its own change is applying the model may already say "wait: <its own change>": the applying line says it
    const w = o.why && !v.busy ? whyText(o.why) : '';
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
    const clockNow = fmt.clock(now());
    if (s.state === 'applying' && was !== 'applying') { text = ''; judgedAt = null; announce(String(applyText ?? o.pending ?? (o.what ? applyingText(o.what) : 'Sending to bitcube…')).replace(/…$/, '')); }
    else if (s.state === 'confirming' && was !== 'confirming') announce(CONFIRMING_SAID);   // said once, without its time (R6 #9)
    else if (s.state === 'done' && was !== 'done') {
      const d = typeof o.done === 'function' ? o.done(result) : o.done;
      text = words ?? `${d} · ${clockNow}${result?.fixture ? ' (fixture mode: nothing really changed)' : ''}`;
      announce(text);
      try { o.onDone?.(result); } catch (e) { console.warn('onDone', e); }
    } else if (s.state === 'unconfirmed' && was !== 'unconfirmed') {
      text = words ?? unconfirmedWords(o.what, fmt.clock(s.sentAt ?? now()), o.unconfirmed ?? 'look at the Now line, or call Gavin');   // names what was sent (R6 #16)
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
  }
  /** The failure in model.js's words, the same as Status's; this page has no verdict of its own, so it points at Status. */
  const failText = (e) => failWords(o.fail, plainError(e), fmt.clock(now()), { tail: 'Try again, or check Status.' });
  async function send(next) {
    applyText = null;
    go(next);
    try {
      const r = await o.run?.();
      if (r && r.ok === false && r.maybe === true) throw Object.assign(new Error(r.error || "bitcube didn't answer in time"), { status: 200, maybe: true, posted: true, serverMaybe: true });
      if (r && r.ok === false) throw Object.assign(new Error(r.error || "bitcube didn't answer"), { status: 200 });
      result = r;
    } catch (e) {
      const maybe = !!(e?.maybe || (e?.noAnswer && e?.posted));
      try { o.onFail?.(e); } catch (x) { console.warn('onFail', x); }
      return go(ctlStep(s, { type: 'error', maybe, now: now() }), maybe ? noAnswerText(e, o.noAnswer ?? 'the page shows what bitcube reports') : failText(e));
    }
    try { o.onSent?.(result); } catch (e) { console.warn('onSent', e); }
    go(ctlStep(s, { type: 'ok', confirmed: typeof o.confirmed === 'function' ? false : null, now: now() }));
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
    if (ans.notSent) return go(ans, notSentWords(ans.notSent, fmt.clock(now())));
    s = ans; paint();
  });
  function update(n = {}) {
    const { readAt, ...rest } = n;
    Object.assign(o, rest);
    if ('model' in n && (s.state === 'confirming' || s.state === 'unconfirmed') && typeof o.confirmed === 'function') {
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
      go(next, notSentWords(next.notSent, fmt.clock(now())));
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
  return { button, host, status, show, update, get state() { return s.state; }, get busy() { return ctlView(s, o.why).busy; } };
}
const CTL_RESULT = new Set(['done', 'failed', 'unconfirmed']);

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
  const s = sheet({ title: 'Who to call', body: '<p class="muted">Looking up the numbers…</p>', actions: [{ label: 'Back to the menu', onClick: () => openMenu(shell) }] });
  let list, note = '';
  try { list = normaliseContacts(await getJSON('/api/contacts')); }
  catch (e) { list = normaliseContacts(null); note = /404|not found/i.test(e.message) ? "The numbers aren't on this mission control yet: first names and what they own, for now." : `Couldn't fetch the numbers: ${plainError(e)}.`; }
  if (!list.some((c) => c.tel) && !note) note = 'No numbers on file yet.';
  const rows = list.map((c) => c.tel
    ? `<a class="contact" href="${esc(telHref(c.tel))}"><b>Call ${esc(c.name)}</b><span>${esc(c.owns)}</span><span class="tel">${esc(String(c.tel))}</span></a>`
    : `<div class="contact"><b>${esc(c.name)}</b><span>${esc(c.owns)}</span></div>`).join('');
  s.el.querySelector('p').outerHTML = `${note ? `<p class="muted secondary">${esc(note)}</p>` : ''}<div>${rows}</div>`;
}
async function openRecent(shell) {
  const s = sheet({ title: 'Recent', body: '<p class="muted">Fetching…</p>', actions: [{ label: 'Back to the menu', onClick: () => openMenu(shell) }] });
  let html;
  try {
    const j = await getJSON('/api/history');
    const now = typeof j?.now === 'number' ? j.now : Date.now();
    const evs = (Array.isArray(j) ? j : j?.events ?? j?.recent ?? []).slice(0, 40);
    html = evs.length ? `<div class="recent">${evs.map((e) => {
      const words = e.words ?? e.text ?? e.sentence ?? e.headline ?? e.summary ?? e.note ?? 'Something happened';
      const t = typeof e.t === 'number' ? e.t : typeof e.at === 'number' ? e.at : null;
      return `<div class="ev"><span>${esc(words)}</span><span class="when">${t == null ? '' : esc(fmt.ago(now - t))}</span></div>`; }).join('')}</div>`
      : '<p class="muted">Nothing recorded yet.</p>';
  } catch (e) { html = `<p class="muted">${/404|not found/i.test(e.message) ? "Not available on this mission control yet." : `Couldn't fetch it: ${esc(plainError(e))}.`}</p>`; }
  s.el.querySelector('p').outerHTML = html;
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
    <div class="links">${DOC_LINKS.map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div>
  </div>`);
  const s = sheet({ title: 'Menu', body, actions: [{ label: 'Log out', onClick: () => logout(shell) }, { label: 'Close' }] });
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
    <button class="menu-btn" type="button" aria-label="Menu" aria-haspopup="dialog" title="Menu">⋯</button></header>`);
  const main = $('main');
  if (main) main.before(header); else document.body.prepend(header);
  // the System map has no tab of its own: it is reached from Status, so Status is marked as where you are (its parent)
  const tabOf = page === 'map' ? 'status' : page;
  if (!$('nav.tabs')) document.body.append(el(`<nav class="tabs" aria-label="Pages">${TABS.map(([k, l, h, svg]) =>
    `<a href="${h}" class="${k === tabOf ? 'on' : ''}" ${k === tabOf ? `aria-current="${k === page ? 'page' : 'true'}"` : ''}>${svg}${esc(l)}</a>`).join('')}</nav>`));
  // the focus order follows where the tabs are drawn: last on a phone (the bar at the bottom), right after the header from
  // 900 px (the pill at the top), so a keyboard reaches them beside the menu instead of after the whole page
  const nav = $('nav.tabs'), wide = matchMedia('(min-width: 900px)');
  const placeTabs = () => { if (wide.matches) { if (header.nextElementSibling !== nav) header.after(nav); } else if (document.body.lastElementChild !== nav) document.body.append(nav); };
  placeTabs(); wide.addEventListener('change', placeTabs);
  dialog();
  liveRegion();                 // made before anything is said into it, so the first announcement is heard
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
    if (st.checking) text = 'Checking…';
    else if (st.stale) { text = a == null ? `No answer yet${st.waitingSince != null ? ` · ${nbsp(modelDur((performance.now() - st.waitingSince) / 1000))}` : ''}` : `No answer for ${nbsp(modelDur(a / 1000))}`; cls += ` lv-${st.stale}`; }
    else text = a == null ? 'Connecting…' : `Updated ${nbsp(modelDur(a / 1000))} ago`;
    if (fresh.textContent !== text) fresh.textContent = text;
    if (fresh.className !== cls) fresh.className = cls;
  }
  tick(paint);
  header.querySelector('.menu-btn').onclick = () => openMenu(shell);
  return shell;
}
