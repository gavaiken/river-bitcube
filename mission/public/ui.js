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
import { dur as modelDur, CONTACTS, TZ } from '/model.js';

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
/** Puts focus back on the control `key` names inside root, or, when it is disabled now, on the nearest status line. */
export function refocus(key, root = document, fallback = null) {
  if (!key) return false;
  let t = null;
  try { t = root.querySelector(key); } catch { /* a stale key */ }
  if (t && !t.disabled) {
    if (!t.matches('a[href], button, input, select, textarea, summary, [tabindex]')) t.setAttribute('tabindex', '-1');
    t.focus({ preventScroll: true }); return document.activeElement === t;
  }
  const near = t?.closest('.ctl')?.querySelector('.ctl-status') ?? t?._mcStatus ?? fallback;
  if (near) { if (!near.hasAttribute('tabindex')) near.setAttribute('tabindex', '-1'); near.focus({ preventScroll: true }); return true; }
  return false;
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
      // the button that opened it may have been replaced by a re-render while the sheet was up: find its successor
      // a disabled opener (the run ended while its confirm was up) can't hold focus: its status line takes it, never <body>
      if (!(opener instanceof Element && opener.isConnected) || opener.disabled) refocus(openerKey);
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

// ---- controls: before / confirm / pending / result / failure on the control itself ---------------------------
/** control(el, { label, before, why, confirm, run, done, fail, onDone, kind, siblings })
 *  A button that reports on itself. `el` is a container (a `.ctl` is best: the eyebrow and the readout are yours) or an
 *  existing <button>. `before`: one line of effect and duration under the eyebrow. `why`: a string makes it impossible
 *  ("Not possible now: <why>" above a greyed button). `confirm`: a confirm() spec, asked first. `run()`: async, POSTs via
 *  api() and returns the response (ok:false or a throw is a failure). `done`: "Dark" → "Dark since 21:04" (a string, or
 *  fn(result) → string). `fail`: "The ropes are unchanged" → "The ropes are unchanged: bitcube didn't answer (21:04).
 *  Try again, or check Status." `onDone(result)`: after a success (poll again, clear a draft). `kind`: 'primary' |
 *  'danger' | 'plain'. `siblings`: the buttons disabled while pending (default: every button in the nearest .ctl, else
 *  the parent). Returns { button, update(opts), show(state, text) } where state is 'before' | 'pending' | 'done' | 'failed'. */
export function control(target, opts = {}) {
  const o = { label: 'Do it', before: '', why: null, confirm: null, run: null, done: 'Done', fail: 'Nothing changed', onDone: null, kind: 'plain', siblings: null, ...opts };
  let button, status, whyEl, beforeEl, host;
  if (target instanceof HTMLButtonElement) {
    button = target; host = target.parentElement;
    status = host.querySelector(':scope > .ctl-status') ?? el('<div class="ctl-status" aria-live="polite"></div>');
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
    button = el(`<button class="btn" type="button"></button>`);
    status = el('<div class="ctl-status" aria-live="polite"></div>');
    host.append(beforeEl, whyEl, button, status);
  }
  button._mcStatus = status;     // refocus(): where focus goes when this button is disabled under it (the status may move)
  let state = 'before', asking = null;
  function paint() {
    button.textContent = o.label;
    button.className = `btn ${o.kind === 'primary' ? 'primary' : o.kind === 'danger' ? 'danger' : ''}`.trim();
    beforeEl.innerHTML = o.before ? (o.before instanceof Node ? '' : o.before) : '';
    if (o.before instanceof Node) beforeEl.replaceChildren(o.before);
    beforeEl.hidden = !o.before;
    whyEl.textContent = o.why ? `Not possible now: ${o.why}.` : '';
    whyEl.hidden = !o.why;
    button.disabled = !!o.why || state === 'pending';
  }
  const sibs = () => (o.siblings ?? Array.from((host.closest('.ctl') ?? host).querySelectorAll('button'))).filter((b) => b !== button);
  function show(s, text = '') {
    state = s;
    status.className = `ctl-status ${s === 'before' ? '' : s}`;
    status.innerHTML = s === 'before' ? '' : `${s === 'pending' ? '<span class="spin" aria-hidden="true"></span>' : ''}<span>${esc(text)}</span>`;
    for (const b of sibs()) { if (s === 'pending') { if (!b.disabled) { b.disabled = true; b.dataset.mcHeld = '1'; } } else if (b.dataset.mcHeld) { b.disabled = false; delete b.dataset.mcHeld; } }
    paint();
  }
  button.addEventListener('click', async () => {
    if (button.disabled || state === 'pending') return;
    if (o.confirm) {
      asking = confirm(o.confirm);
      const yes = await asking;
      asking = null;
      if (!yes) return;
    }
    // the confirm may have been open for a while: if the control became impossible meanwhile, nothing is sent
    if (o.why) { show('failed', `Not sent: ${o.why} (${fmt.clock(Date.now())}).`); return; }
    show('pending', o.pending ?? 'Sending to bitcube…');
    try {
      const r = await o.run?.();
      if (r && r.ok === false) throw new Error(r.error || "bitcube didn't answer");
      const text = typeof o.done === 'function' ? o.done(r) : o.done;
      show('done', `${text} · ${fmt.clock(Date.now())}${r?.fixture ? ' (fixture mode: nothing really changed)' : ''}`);
      o.onDone?.(r);
    } catch (e) {
      show('failed', e?.noAnswer && e.posted ? noAnswerText(e, o.noAnswer ?? 'the page shows what bitcube reports') : `${o.fail}: ${plainError(e)} (${fmt.clock(Date.now())}). Try again, or check Status.`);
    }
  });
  paint();
  function update(n) {
    Object.assign(o, n);
    // a confirm still open for a control that just became impossible is withdrawn, with the reason on the control
    if (o.why && asking) { const a = asking; asking = null; show('failed', `Not sent: ${o.why} (${fmt.clock(Date.now())}).`); a.close(); return; }
    paint();
  }
  return { button, host, show, update, get state() { return state; } };
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
      <div class="ctl" data-m="check-host"><div class="ctl-h">The full check</div><div class="ctl-before">Asks bitcube to check everything now instead of waiting for the next minute.</div><button class="btn" type="button" data-m="check">Check now</button><div class="ctl-status" role="status"></div></div>
    </div>
    <div><div class="ctl-h">Theme</div><div class="seg" role="group" aria-label="Theme">${['auto', 'light', 'dark'].map((x) => `<button type="button" data-theme="${x}" class="${t === x ? 'lit' : ''}" aria-pressed="${t === x}">${cap(x)}</button>`).join('')}</div></div>
    <div class="links">${DOC_LINKS.map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div>
  </div>`);
  const s = sheet({ title: 'Menu', body, actions: [{ label: 'Log out', onClick: () => logout(shell) }, { label: 'Close' }] });
  body.querySelector('[data-m="contacts"]').onclick = () => openContacts(shell);
  body.querySelector('[data-m="recent"]').onclick = () => openRecent(shell);
  body.querySelector('.seg').onclick = (e) => { const b = e.target.closest('[data-theme]'); if (!b) return; setTheme(b.dataset.theme); body.querySelectorAll('[data-theme]').forEach((x) => { x.classList.toggle('lit', x === b); x.setAttribute('aria-pressed', x === b); }); };
  control(body.querySelector('[data-m="check"]'), { label: 'Check now', pending: 'Asking bitcube…', done: 'Check started; the page updates as answers come in', fail: "The check didn't start",
    run: async () => { shell.setChecking(true); try { return await api('/api/control/check', {}); } finally { shell.setChecking(false); } },
    onDone: () => document.dispatchEvent(new CustomEvent('mc:check')) });
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
