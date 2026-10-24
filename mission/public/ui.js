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
import { api as rawApi, esc, md } from '/app.js';
import { dur as modelDur, CONTACTS, TZ } from '/model.js';

export { esc, md };

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
  nb: (s) => String(s ?? "").replace(/(\d) (s|min|h|days|W|%|px|of)\b/g, "$1\u00a0$2"),
  /** pct(0.9) → "90 %" (a fraction 0–1, or a number over 1 taken as percent already); null → "not known". */
  pct: (x) => (x == null || !Number.isFinite(x) ? 'not known' : `${Math.round(x <= 1 ? x * 100 : x)} %`),
};

// ---- api: POST through app.js, with ok:false a failure and 401 → /login -------------------------------------
/** api(path) GETs, api(path, body) POSTs JSON; a non-2xx, a 401 (→ /login) or `ok: false` throws an Error in words. */
export async function api(path, body) {
  const j = await rawApi(path, body);
  if (j && j.ok === false) throw new Error(j.error || "bitcube didn't answer");
  return j;
}
/** A failed request's reason in the team's words, never a library's ("mission control didn't answer"). */
export function plainError(msg) {
  const m = String(msg?.message ?? msg ?? '');
  if (/logged out/i.test(m)) return 'you were logged out';
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(m)) return "mission control didn't answer";
  if (/can't reach bitcube|ssh/i.test(m)) return "bitcube didn't answer";
  if (/took too long|timeout|timed out|aborted/i.test(m)) return 'bitcube took too long to answer';
  if (/^HTTP 404/.test(m) || /not found/i.test(m)) return "this mission control can't do that yet";
  if (/^HTTP 50\d/.test(m)) return "mission control couldn't reach bitcube";
  if (/^HTTP 4\d\d/.test(m)) return "mission control didn't accept it";
  return m.replace(/[.\s]+$/, '') || 'no answer';
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
export function poll(url, { every = 5000, onData, onError } = {}) {
  const h = { last: null, receivedAt: null, failedSince: null, stop, refresh: once };
  let timer = null, inflight = false, stopped = false;
  async function once() {
    if (inflight || stopped) return;
    inflight = true;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (typeof j.now !== 'number') j.now = Date.now();
      h.last = j; h.receivedAt = performance.now(); h.failedSince = null;
      onData?.(j, h.receivedAt);
    } catch (e) {
      h.failedSince ??= performance.now();
      onError?.(e, performance.now() - h.failedSince);
    } finally { inflight = false; }
  }
  const onVisible = () => { if (!document.hidden) once(); };
  document.addEventListener('visibilitychange', onVisible);
  function stop() { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); }
  once();
  timer = setInterval(once, every);
  return h;
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
  if (!d) { d = el('<dialog id="mc-sheet" class="sheet" aria-label="Sheet"></dialog>'); document.body.append(d); }
  return d;
}
/** sheet({ title, body, actions }) opens the bottom sheet (body: HTML string or a Node; actions: [{ label, kind: 'primary'|'danger'|'plain',
 *  onClick, keep }] stacked full width, each closes the sheet unless `keep`); a Close button when there are no actions.
 *  Returns { close, el }; a click on the backdrop or Escape closes it. A sheet opened over another replaces it. */
export function sheet({ title, body = '', actions = null, onClose = null } = {}) {
  const d = dialog();
  d._mcReplaced?.();            // the sheet this one replaces: its promise (a confirm) resolves false; the dialog stays open
  d.innerHTML = '';
  const inner = el('<div class="sheet-in" role="document"></div>');
  if (title) inner.append(el(`<h3>${esc(title)}</h3>`));
  if (body instanceof Node) inner.append(body); else if (body) inner.insertAdjacentHTML('beforeend', body);
  const acts = actions ?? [{ label: 'Close', kind: 'plain' }];
  const stack = el('<div class="stack"></div>');
  for (const a of acts) {
    const b = el(`<button class="btn ${a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'danger' : ''}" type="button">${esc(a.label)}</button>`);
    b.onclick = async () => { try { await a.onClick?.(b); } finally { if (!a.keep) close(); } };
    stack.append(b);
  }
  inner.append(stack);
  d.append(inner);
  let closed = false;
  const mine = {};
  d._mcToken = mine;
  d._mcReplaced = () => { if (closed) return; closed = true; onClose?.(); };
  function close() {
    if (closed) return;
    closed = true;
    if (d._mcToken === mine) { d._mcToken = null; d._mcReplaced = null; d.onclick = null; d.oncancel = null; if (d.open) d.close(); }
    onClose?.();
  }
  d.onclick = (e) => { if (e.target === d || e.target.closest('[data-sheet="close"]')) close(); };
  d.oncancel = (e) => { e.preventDefault(); close(); };
  if (!d.open) d.showModal();
  return { close, el: inner };
}
/** confirm({ title, body, ok, cancel, destructive }) → Promise<boolean>: a bottom sheet naming the cost, the costly button first
 *  (red-tinted when destructive, default true), then the safe one; backdrop and Escape mean no. */
export function confirm({ title, body = '', ok = 'OK', cancel = 'Not now', destructive = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    sheet({ title, body: body instanceof Node ? body : `<p>${esc(body)}</p>`, onClose: () => done(false),
      actions: [{ label: ok, kind: destructive ? 'danger' : 'primary', onClick: () => done(true) }, { label: cancel, kind: 'plain', onClick: () => done(false) }] });
  });
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
  let state = 'before';
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
    if (o.confirm && !(await confirm(o.confirm))) return;
    show('pending', o.pending ?? 'Sending to bitcube…');
    try {
      const r = await o.run?.();
      if (r && r.ok === false) throw new Error(r.error || "bitcube didn't answer");
      const text = typeof o.done === 'function' ? o.done(r) : o.done;
      show('done', `${text} · ${fmt.clock(Date.now())}${r?.fixture ? ' (fixture mode: nothing really changed)' : ''}`);
      o.onDone?.(r);
    } catch (e) {
      show('failed', `${o.fail}: ${plainError(e)} (${fmt.clock(Date.now())}). Try again, or check Status.`);
    }
  });
  paint();
  return { button, host, show, update(n) { Object.assign(o, n); paint(); }, get state() { return state; } };
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
      <button class="btn" type="button" data-m="contacts">Who to call <span class="chev">›</span></button>
      <button class="btn" type="button" data-m="recent">Recent <span class="chev">›</span></button>
      <div class="ctl" data-m="check-host"><div class="ctl-h">The full check</div><div class="ctl-before">Asks bitcube to check everything now instead of waiting for the next minute.</div><button class="btn" type="button" data-m="check">Check now</button><div class="ctl-status" aria-live="polite"></div></div>
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
  if (!(await confirm({ title: 'Log out?', body: 'You will need the team password to get back in, in the dark.', ok: 'Log out', cancel: 'Stay logged in', destructive: false }))) return;
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
  if (!art.current) art.setSeason(null);
  const header = el(`<header class="top">
    <div class="brand"><span class="wordmark">Mission control</span><span class="title">${esc(title || TABS.find((t) => t[0] === page)?.[1] || '')}</span></div>
    <div class="fresh" id="mc-fresh" aria-live="polite">Connecting…</div>
    <button class="menu-btn" type="button" aria-label="Menu" aria-haspopup="dialog" title="Menu">⋯</button></header>`);
  const main = $('main');
  if (main) main.before(header); else document.body.prepend(header);
  if (!$('nav.tabs')) document.body.append(el(`<nav class="tabs" aria-label="Pages">${TABS.map(([k, l, h, svg]) =>
    `<a href="${h}" class="${k === page ? 'on' : ''}" ${k === page ? 'aria-current="page"' : ''}>${svg}${esc(l)}</a>`).join('')}</nav>`));
  dialog();
  const fresh = header.querySelector('#mc-fresh');
  const st = { ageMs: null, setAt: null, stale: null, checking: false };
  const shell = {
    setAge(ms) { st.ageMs = ms == null ? null : Math.max(0, ms); st.setAt = performance.now(); paint(); },
    setStale(level) { st.stale = level === 'warning' || level === 'down' ? level : null; paint(); },
    setChecking(on) { st.checking = !!on; paint(); },
    openMenu: () => openMenu(shell),
  };
  function age() { return st.ageMs == null ? null : st.ageMs + (performance.now() - st.setAt); }
  function paint() {
    const a = age();
    let text, cls = 'fresh';
    if (st.checking) text = 'Checking…';
    else if (st.stale) { text = a == null ? 'No answer yet' : `No answer for ${nbsp(modelDur(a / 1000))}`; cls += ` lv-${st.stale}`; }
    else text = a == null ? 'Connecting…' : `Updated ${nbsp(modelDur(a / 1000))} ago`;
    if (fresh.textContent !== text) fresh.textContent = text;
    if (fresh.className !== cls) fresh.className = cls;
  }
  tick(paint);
  header.querySelector('.menu-btn').onclick = () => openMenu(shell);
  return shell;
}
