// Mission control v2, direction C: the verdict, the piece now, then a timeline of what happened, derived on the
// phone from successive /api/status polls (public/proto/c-timeline.js) and the model (public/model.js). Every
// verdict and item on the page is the model's; this file only decides where things go and what the controls do.
import { derive, dur, clock, contactFor, CONTACTS, SEASONS } from '/model.js';
import { digest, observe, merge, newStore, feed, sinceWords, gapWords, STATE_WORD, MARK, shortName } from '/proto/c-timeline.js';
import { api, esc } from '/app.js';

const POLL_MS = 5000, CHAT_MS = 12000, STILL_MS = 30000, STORE_KEY = 'mc-c-timeline-v1', THEME_KEY = 'mc-theme';
const $ = (id) => document.getElementById(id);
const S = { status: null, atPerf: 0, model: null, store: loadStore(), fails: 0, err: null, ctl: {}, chat: { events: [], status: null, at: 0 },
            tab: 'status', controlsOpen: false, view: 'happened', open: new Set(), still: { url: null, taken: null, why: null }, bigStill: false, menuContacts: false };
const FROM = { mini: 'from the Mac mini', bitcube: 'from bitcube', modal: 'from Modal' };
const excerpt = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
const lower1 = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// ---- store (the last hour of events, in localStorage so a reload keeps it) ------------------------------------
function loadStore() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.v === 1 && Array.isArray(s.events) && s.since) return s; } catch { /* no storage */ }
  return newStore(Date.now());
}
function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S.store)); } catch { /* full or blocked: the page still works */ } }

// ---- time: the server's clock plus what has elapsed on the phone, so a phone's skew ages nothing ------------------
const nowMs = () => (S.status?.now != null ? S.status.now + (performance.now() - S.atPerf) : Date.now());
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayTag(t, now) {
  try {
    const a = DAY_FMT.format(new Date(t)), b = DAY_FMT.format(new Date(now));
    if (a === b) return '';
    const days = Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
    if (days === 1) return 'yesterday';
    const [, mo, d] = a.split('-');
    return `${+d} ${MONTHS[+mo - 1]}`;
  } catch { return ''; }
}

// ---- theme and the season's palette ---------------------------------------------------------------------------
const PAL = {
  light: { winter: ['#8fb9e0', '#cfe2f2'], spring: ['#4fae82', '#3c9a95'], summer: ['#d4a63c', '#ecd07f'], autumn: ['#c17f3d', '#b05a30'], none: ['#6f87a3', '#8ea3bb'] },
  dark: { winter: ['#8db6dc', '#cfe3f5'], spring: ['#5fcf9c', '#49b8af'], summer: ['#e9b94a', '#f6d57e'], autumn: ['#d08c48', '#c26a3b'], none: ['#5c7a9c', '#7f97b2'] },
};
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
function applySeason(m) {
  const pal = PAL[isDark() ? 'dark' : 'light'];
  const w = m?.show?.weights, season = m?.show?.season;
  let c = pal.none;
  if (w && SEASONS.some((s) => (w[s] ?? 0) > 0)) {
    const total = SEASONS.reduce((a, s) => a + Math.max(0, w[s] ?? 0), 0);
    c = [0, 1].map((i) => toHex([0, 1, 2].map((ch) => SEASONS.reduce((a, s) => a + Math.max(0, w[s] ?? 0) / total * hex(pal[s][i])[ch], 0))));
  } else if (season && pal[season]) c = pal[season];
  document.documentElement.style.setProperty('--s1', c[0]);
  document.documentElement.style.setProperty('--s2', c[1]);
}
function applyTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch { /* none */ }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  applySeason(S.model);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applySeason(S.model));

// ---- polling and the clock -------------------------------------------------------------------------------------
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const r = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (r.status === 401) { location.href = '/login'; return; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const st = await r.json();
    S.status = st; S.atPerf = performance.now(); S.fails = 0; S.err = null;
    const m = derive(st, nowMs());
    if (!S.store.last && st.now != null) S.store.startedAt = st.now;
    observe(S.store, digest(m, st), m);
    saveStore();
    S.model = m;
    if (st.studio) {
      const wasRunning = !!S.chat.status?.running;
      S.chat.status = st.studio;
      if (wasRunning && !st.studio.running) fetchChat();          // the agent just finished: its reply goes to the feed now
    }
    render();
  } catch (e) {
    S.fails++; S.err = e;
    tick(true);
  } finally { polling = false; }
}
function tick(force = false) {
  if (!S.status) { renderFresh(); return; }
  const m = derive(S.status, nowMs());
  const wasStale = !!S.model?.overall?.stale, lost = m.overall.cause === 'page';
  S.model = m;
  if (lost && S.store.last && S.store.last.cause !== 'page') {              // lost contact: one entry, dated at the last answer
    observe(S.store, { ...digest(m, S.status), t: S.store.last.t ?? Math.round(nowMs()) }, m);
    saveStore();
    render();
  } else if (force || wasStale !== !!m.overall.stale) render();
  else { renderFresh(); renderAges(); }
  if (S.chat.status?.running && performance.now() - S.chat.at > 3000) fetchChat();   // follow a working agent closely
}

// ---- rendering ------------------------------------------------------------------------------------------------------
const last = {};
function set(id, html) { if (last[id] !== html) { last[id] = html; $(id).innerHTML = html; } }
const item = (m, id) => m.items.find((x) => x.id === id);
const mark = (lvl) => `<span class="mark ${esc(lvl)}">${MARK[lvl] ?? '•'}</span>`;
const ageSpan = (s) => (s == null ? '' : `<span data-age="${Math.round(s)}">${esc(dur(s))}</span> ago`);

function render() {
  const m = S.model;
  renderFresh();
  if (!m) return;
  applySeason(m);
  renderStale(m);
  renderBand(m);
  renderTodo(m);
  renderNow(m);
  renderControls(m);
  renderFeed(m);
  renderLights(m);
  renderChatStatus();
  renderNav();
  renderAges();
}

function renderFresh() {
  const f = $('fresh');
  if (!S.status) { f.textContent = S.fails ? `No answer yet (${S.fails} tries)` : 'Loading…'; f.className = `fresh${S.fails > 2 ? ' bad' : ''}`; return; }
  const a = S.model?.overall?.checked?.page_age_s ?? 0;
  f.textContent = a > 30 ? `No answer for ${dur(a)}` : `Updated ${dur(a)} ago`;
  f.className = `fresh${a > 120 ? ' bad' : a > 30 ? ' warn' : ''}`;
}
function renderAges() {
  const page = S.model?.overall?.checked?.page_age_s ?? 0;
  for (const el of document.querySelectorAll('[data-age]')) el.textContent = dur(+el.dataset.age + page);
  const taken = S.still.taken;
  for (const el of document.querySelectorAll('[data-taken]')) {
    const s = taken ? Math.max(0, (nowMs() - taken) / 1000) : null;
    el.textContent = s == null ? '' : `${dur(s)} ago`;
    el.closest('.tile')?.querySelector('.thumb')?.classList.toggle('old', s != null && s > 120);
  }
}

function renderStale(m) {
  const a = m.overall.checked.page_age_s ?? 0;
  const b = $('staleBanner');
  if (a <= 30) { b.hidden = true; return; }
  b.hidden = false;
  b.className = 'stale-banner';
  b.innerHTML = `${mark('unknown')}<div><b>No contact with mission control for ${esc(dur(a))}.</b> Everything below is as it was at ${esc(clock(S.status.now))}; the controls are off until it answers. ${S.err ? `(${esc(plainError(S.err))})` : ''}</div>`;
}

function renderBand(m) {
  const lvl = m.overall.level;
  const since = sinceWords(S.store.since.overall, nowMs());
  const also = m.problems.slice(1);
  set('band', `<div class="row1"><span class="chip ${lvl}"><span class="g">${MARK[lvl]}</span>${STATE_WORD[lvl]}</span><span class="since">${esc(since)}</span></div>
    <h1>${esc(m.overall.headline)}</h1>
    <p class="detail">${esc(m.overall.detail)}</p>
    ${also.length ? `<div class="also"><ul>${also.map((p) => `<li><button data-jump-cause="${esc(p.id)}">${mark(p.level)}Also: ${esc(p.headline)}</button></li>`).join('')}</ul></div>` : ''}`);
  $('band').className = `band ${lvl}`;
}

function renderTodo(m) {
  const a = m.overall.action;
  $('todo').classList.toggle('none', !a);
  if (!a) { set('todo', '<h2>What to do</h2><p class="nothing">Nothing to do.</p>'); return; }
  const c = contactFor(m.overall.cause);
  const jumps = [];
  if (/Ropes → On/.test(a)) jumps.push(`<button class="btn sm" data-jump="ropes">Ropes → On (showing the river)</button>`);
  if (/Switch now/.test(a)) jumps.push(`<button class="btn sm" data-jump="file">Switch now</button>`);
  if (/HUB75 brightness/.test(a)) jumps.push(`<button class="btn sm" data-jump="panels">Panels brightness</button>`);
  if (/studio chat/i.test(a)) jumps.push(`<button class="btn sm" data-tab="chat">Open the studio chat</button>`);
  set('todo', `<h2>What to do</h2><p class="action">${esc(a)}</p>
    ${c ? `<p class="call">${c.name === 'Colin' ? 'If unsure, ask' : 'Call'} <b>${esc(c.name)}</b> (${esc(c.owns)})</p>` : '<p class="call dim">Nobody to call yet: wait and look again.</p>'}
    ${jumps.length ? `<div class="jump">${jumps.join('')}</div>` : ''}`);
}

const PANEL_WORDS = { unknown: 'Not known', 'no-sender': 'No panel sender', restarting: 'Dark while TouchDesigner restarts', frozen: 'Picture frozen',
  gone: 'Nothing drawn', 'no-output': 'No panel output in this file', off: 'Switched off' };
/** The panels tile's words from the model's state: "Showing the river at 100 %", "Picture frozen", "No panel sender". */
function panelWords(m) {
  const p = m.show.panels;
  if (p.state === 'river' && p.words) return cap(p.words.replace(/^the panels show /, 'showing '));
  if (p.state === 'off' && p.brightness === 0) return 'Dark: brightness 0 %';
  return PANEL_WORDS[p.state] ?? 'Not known';
}
/** The ropes tile's words from the model's: "Showing the river", "Showing the rain fallback", "Dark on purpose". */
function ropeWords(m) {
  const w = m.show.ropes.words;
  return w ? cap(w.replace(/^the ropes show /, 'showing ').replace(/^the ropes are /, '')) : 'Not known';
}

function renderNow(m) {
  const se = item(m, 'seasons'), ro = item(m, 'ropes'), pa = item(m, 'hub75 panels'), ga = item(m, 'gallery camera');
  const season = m.show.season;
  const seasonV = season ? season : se?.level === 'unknown' ? 'Not known' : m.show.file?.kind === 'live' ? 'Live river'
    : /not answering|not served|frozen/i.test(se?.summary ?? '') ? 'Not answering' : 'Not running';
  const seasonM = season ? `${cap(m.show.mode?.words ?? '')}${m.show.intensity ? ` · ${m.show.intensity.word}` : ''}` : (se?.summary ?? '');
  const ropesV = ropeWords(m);
  const ropesM = ro && !ro.summary.toLowerCase().startsWith(ropesV.toLowerCase()) ? ro.summary : '';
  const paV = panelWords(m);
  const paM = pa && !pa.summary.toLowerCase().startsWith(paV.toLowerCase()) ? pa.summary : '';
  const still = S.still;
  const roomTxt = still.url ? `<div class="v">Gallery camera</div><div class="m"><span data-taken="1"></span> · tap to enlarge</div>`
    : `<div class="v">No picture</div><div class="m">${esc(still.why ?? ga?.summary ?? 'the gallery camera has not answered yet')}</div>`;
  set('now', `<h2>The piece now</h2>
    <div class="tiles">
      <div class="tile season"><div class="txt"><div class="k">${mark(se?.level ?? 'unknown')}Season</div><div class="v big">${esc(cap(seasonV))}</div></div><div class="m">${esc(excerpt(seasonM, 90))}</div></div>
      <div class="tile"><div class="k">${mark(ro?.level ?? 'unknown')}Ropes</div><div class="v">${esc(ropesV)}</div>${ropesM ? `<div class="m">${esc(excerpt(ropesM, 60))}</div>` : ''}</div>
      <div class="tile"><div class="k">${mark(pa?.level ?? 'unknown')}Panels</div><div class="v">${esc(paV)}</div>${paM ? `<div class="m">${esc(excerpt(paM, 60))}</div>` : ''}</div>
      <div class="tile room" data-still-toggle="1">${still.url ? `<img class="thumb" src="${still.url}" alt="The room, from the gallery camera">` : `<div class="thumb none" aria-hidden="true"></div>`}<div class="txt"><div class="k">${mark(ga?.level ?? 'unknown')}The room</div>${roomTxt}</div></div>
    </div>
    ${S.bigStill && still.url ? `<div class="still-big"><img src="${still.url}" alt="The room, from the gallery camera, larger"></div>` : ''}
    <div class="foot"><div class="fresh-line">${ro?.age_s != null ? `${esc(FROM[ro.checked_from] ?? '')} · checked ${ageSpan(ro.age_s)}` : 'Not checked yet'}</div>
      <button class="btn ${S.controlsOpen ? 'lit' : ''}" data-controls-toggle="1" aria-expanded="${S.controlsOpen}">${S.controlsOpen ? 'Hide controls' : 'Controls'}</button></div>`);
}

// ---- controls: what each will do, confirm when disruptive, pending and result on the control itself ---------------
function ctlResult(g) {
  const r = S.ctl[g];
  if (!r) return '';
  return `<div class="result ${r.level}">${mark(r.level)}<span>${esc(r.msg)}</span></div>`;
}
function why(c) { return c.possible ? '' : `<p class="why">Not possible now: ${esc(c.why)}.</p>`; }
function renderControls(m) {
  const el = $('controls');
  el.hidden = !S.controlsOpen;
  if (!S.controlsOpen) { set('controls', ''); return; }
  const c = m.controls, sh = m.show;
  const busy = (g) => !!S.ctl[g]?.pending;
  const dis = (g, ok) => (busy(g) || !ok ? 'disabled' : '');
  const ropes = sh.ropes.state;
  const bright = sh.panels.brightness;
  const pct = bright != null ? Math.round(bright * 100) : null;
  const mode = sh.mode?.id ?? null, manual = mode === 'manual';
  const target = sh.target?.season ?? null, tInt = sh.target?.intensity ?? null;
  const files = sh.show_files.filter((f) => f !== sh.file?.name);
  const fileLabel = (f) => ({ 'river-local-oct-22-seasons.toe': "the river's year", 'river-online-oct-20.toe': 'the live river', 'river-local-oct-18.toe': 'the live river (old file name)' }[f] ?? f);
  const route = sh.ropes.route, boot = sh.boot_file;
  set('controls', `<h2>Controls</h2>
    <div class="group" data-g="ropes">
      <div class="gh"><b>Ropes</b><span class="state">now: ${esc(lower1(ropeWords(m)))}</span></div>
      <p class="effect">Dark keeps sending black so the ropes stay off (not a fault). Showing the river brings it back within a few seconds.</p>
      ${why(c.ropes)}
      <div class="seg"><button class="btn ${ropes === 'river' ? 'lit' : ''}" data-ctl="ropes-on" ${dis('ropes', c.ropes.possible)}>Showing the river</button><button class="btn ${ropes === 'dark' ? 'lit' : ''}" data-ctl="ropes-dark" ${dis('ropes', c.ropes.possible)}>Dark</button></div>
      ${ctlResult('ropes')}
    </div>
    <div class="group" data-g="panels">
      <div class="gh"><b>Panels</b><span class="state">brightness ${pct != null ? `${pct} %` : 'not known'}</span></div>
      <p class="effect">Each step changes the panels' brightness by 10 % at once. Panels off turns them black.</p>
      ${why(c.hub75)}
      <div class="row"><div class="stepper"><button class="btn" data-ctl="hub-down" ${dis('panels', c.hub75.possible && pct != null)} aria-label="Dimmer">−</button><span class="val">${pct != null ? `${pct} %` : '—'}</span><button class="btn" data-ctl="hub-up" ${dis('panels', c.hub75.possible && pct != null)} aria-label="Brighter">+</button></div>
        <button class="btn danger" data-ctl="hub-off" ${dis('panels', c.hub75.possible)}>Panels off</button></div>
      ${ctlResult('panels')}
    </div>
    <div class="group" data-g="year">
      <div class="gh"><b>The river's year</b><span class="state">${sh.season ? `${esc(sh.season)} · ${esc(sh.mode?.id ?? '')}` : 'not running'}</span></div>
      <p class="effect">Automatic: the clock turns the year, one season a minute. Manual: the river travels forward to the season and intensity you choose (it takes over by hand). Dynamic: people in the room steer it.</p>
      ${why(c.mode)}
      <div class="seg"><button class="btn ${mode === 'automatic' ? 'lit' : ''}" data-ctl="mode-automatic" ${dis('year', c.mode.possible)}>Automatic</button><button class="btn ${mode === 'dynamic' ? 'lit' : ''}" data-ctl="mode-dynamic" ${dis('year', c.mode.dynamic.possible)} title="${esc(c.mode.dynamic.why ?? '')}">Dynamic</button><button class="btn ${manual ? 'lit' : ''}" data-ctl="mode-manual" ${dis('year', c.mode.possible)}>Manual</button></div>
      ${!c.mode.dynamic.possible && c.mode.possible ? `<p class="effect" style="margin-top:6px">Dynamic can't be chosen: ${esc(c.mode.dynamic.why)}.</p>` : ''}
      <p class="effect" style="margin-top:10px">Target${manual ? '' : ' (choose Manual first)'}: where the river should end up.</p>
      <div class="chips">${SEASONS.map((s) => `<button class="btn sm ${manual && target === s ? 'lit' : ''}" data-ctl="target-${s}" ${dis('year', c.target.possible && manual)}>${s}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px"><span class="small dim">Intensity</span><div class="stepper"><button class="btn" data-ctl="int-down" ${dis('year', c.target.possible && manual)} aria-label="Calmer">−</button><span class="val">${manual && tInt != null ? `${Math.round(tInt * 100)} %` : '—'}</span><button class="btn" data-ctl="int-up" ${dis('year', c.target.possible && manual)} aria-label="Stronger">+</button></div></div>
      ${ctlResult('year')}
    </div>
    <div class="group" data-g="file">
      <div class="gh"><b>Show file</b><span class="state">${sh.file ? `now: ${esc(sh.file.label)}` : 'not known'}</span></div>
      <p class="effect">Switch now restarts TouchDesigner on the other file: the lights go dark for about a minute and unsaved changes in TouchDesigner are lost.</p>
      ${why(c.switch)}
      <div class="row">${(files.length ? files : sh.show_files).map((f) => `<button class="btn" data-ctl="switch" data-file="${esc(f)}" ${dis('file', c.switch.possible)}>Switch now → ${esc(fileLabel(f))}</button>`).join('') || '<span class="small dim">No other show file is listed yet.</span>'}</div>
      ${ctlResult('file')}
    </div>
    <details class="installer"><summary>&#128295; Installer settings (cabling)</summary>
      <div class="group" data-g="route">
        <div class="gh"><b>Lighting network port</b><span class="state">now: ${route === 'direct' ? "bitcube's LIGHTS port" : route === 'router' ? 'the router port' : 'not known'}</span></div>
        <p class="effect">Where the lighting switch is plugged in. The wrong choice blacks out all 20 ropes.</p>
        ${why(c.lightsroute)}
        <div class="seg"><button class="btn ${route === 'direct' ? 'lit' : ''}" data-ctl="route-direct" ${dis('route', c.lightsroute.possible)}>bitcube's LIGHTS port (white)</button><button class="btn ${route === 'router' ? 'lit' : ''}" data-ctl="route-router" ${dis('route', c.lightsroute.possible)}>The router port (fallback)</button></div>
        ${ctlResult('route')}
      </div>
      <div class="group" data-g="boot">
        <div class="gh"><b>Opens when bitcube starts</b><span class="state">now: ${boot ? esc(boot.label) : 'not known'}</span></div>
        <p class="effect">Which show file TouchDesigner opens after a restart. Nothing changes until then.</p>
        ${why(c.bootfile)}
        <div class="row">${sh.show_files.map((f) => `<button class="btn ${boot?.name === f ? 'lit' : ''}" data-ctl="boot" data-file="${esc(f)}" ${dis('boot', c.bootfile.possible)}>${esc(cap(fileLabel(f)))}</button>`).join('')}</div>
        ${ctlResult('boot')}
      </div>
    </details>`);
}

function plainError(e) {
  const s = String(e?.message ?? e ?? '');
  if (/timeout|aborted/i.test(s)) return 'no answer in time';
  if (/fetch failed|Failed to fetch|NetworkError|Load failed/i.test(s)) return 'the connection failed';
  if (/logged out/i.test(s)) return 'logged out';
  return s || 'no answer';
}
async function act(g, label, action, body, effect, unchanged) {
  const t = Math.round(nowMs());
  S.ctl[g] = { pending: true, level: 'unknown', msg: `Sending ${label}…`, t };
  const ev = { key: `control:${t}`, t, kind: 'control', level: 'unknown', who: 'you, from this page', title: `${label}`, detail: `${effect} Sending…` };
  merge(S.store, ev); saveStore(); render();
  try {
    const r = await api(`/api/control/${action}`, body);
    if (r && r.ok === false) throw new Error(r.error || 'bitcube did not answer');
    const note = r?.fixture ? 'Fixture mode: nothing was changed.' : 'Done.';
    const when = clock(nowMs());
    S.ctl[g] = { pending: false, level: 'ok', msg: `${label}: done at ${when}. ${note} The next check shows the result.`, t };
    Object.assign(ev, { level: 'ok', detail: `${effect} Done at ${when}. ${note}` });
  } catch (e) {
    const w = plainError(e);
    S.ctl[g] = { pending: false, level: 'down', msg: `${label} failed: ${w}. ${unchanged} Try again, or check the list.`, t };
    Object.assign(ev, { level: 'down', detail: `Failed: ${w}. ${unchanged}` });
  }
  merge(S.store, ev); saveStore(); render();
  setTimeout(poll, 1500);
}
function confirmSheet({ title, body, yes, no = 'Not now', danger = false }) {
  return new Promise((resolve) => {
    const root = $('sheet');
    root.innerHTML = `<div class="scrim" data-sheet-close="1"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><h3 id="sheetTitle">${esc(title)}</h3><p>${esc(body)}</p>
      <div class="actions"><button class="btn primary ${danger ? 'danger' : ''}" data-sheet-yes="1">${esc(yes)}</button><button class="btn" data-sheet-close="1">${esc(no)}</button></div></div></div>`;
    root.onclick = (e) => {
      if (e.target.closest('[data-sheet-yes]')) { root.innerHTML = ''; root.onclick = null; resolve(true); }
      else if (e.target.closest('[data-sheet-close]') && !e.target.closest('.sheet') || e.target.closest('.actions [data-sheet-close]')) { root.innerHTML = ''; root.onclick = null; resolve(false); }
    };
  });
}
async function control(key, btn) {
  const m = S.model; if (!m) return;
  const sh = m.show;
  const ROPES = 'Ropes';
  switch (key) {
    case 'ropes-on': return act('ropes', 'Ropes → Showing the river', 'ropes', { dark: false }, 'The sender shows the river again; the ropes follow within a few seconds.', 'The ropes are unchanged.');
    case 'ropes-dark': {
      if (!await confirmSheet({ title: 'Make the ropes dark?', body: 'The ropes in the gallery go black now. The sender keeps sending black, so they stay off until someone presses Showing the river. The panels keep showing the river.', yes: 'Go dark', no: 'Keep showing the river', danger: true })) return;
      return act('ropes', `${ROPES} → Dark`, 'ropes', { dark: true }, 'The ropes go black and stay black on purpose.', 'The ropes are unchanged.');
    }
    case 'hub-up': case 'hub-down': {
      const b = sh.panels.brightness ?? 1;
      const next = Math.max(0, Math.min(1, Math.round((b + (key === 'hub-up' ? .1 : -.1)) * 10) / 10));
      if (next === 0 && !await confirmSheet({ title: 'Panels off?', body: 'Brightness 0 % turns the panels black until someone raises it again.', yes: 'Turn the panels off', danger: true })) return;
      return act('panels', `Panels → ${Math.round(next * 100)} %`, 'hub75', { brightness: next }, `The panels go to ${Math.round(next * 100)} % at once.`, 'The panels are unchanged.');
    }
    case 'hub-off': {
      if (!await confirmSheet({ title: 'Panels off?', body: 'The panels go black now and stay black until someone raises the brightness again.', yes: 'Turn the panels off', danger: true })) return;
      return act('panels', 'Panels → off', 'hub75', { brightness: 0 }, 'The panels go black.', 'The panels are unchanged.');
    }
    case 'mode-automatic': case 'mode-dynamic': case 'mode-manual': {
      const mode = key.slice(5);
      return act('year', `Mode → ${mode}`, 'mode', { mode }, mode === 'manual' ? 'The year is steered by hand from now on.' : mode === 'automatic' ? 'The clock turns the year again, one season a minute.' : 'People in the room steer the year.', 'The mode is unchanged.');
    }
    case 'int-up': case 'int-down': {
      const cur = sh.target?.intensity ?? sh.intensity?.value ?? .5;
      const next = Math.max(0, Math.min(1, Math.round((cur + (key === 'int-up' ? .1 : -.1)) * 10) / 10));
      return act('year', `Target intensity → ${Math.round(next * 100)} %`, 'target', { intensity: next }, 'The river travels to that intensity (by hand).', 'The target is unchanged.');
    }
    case 'switch': {
      const f = btn.dataset.file, label = { 'river-local-oct-22-seasons.toe': "the river's year", 'river-online-oct-20.toe': 'the live river' }[f] ?? f;
      if (!await confirmSheet({ title: `Switch now to ${label}?`, body: `TouchDesigner restarts on ${label}: the lights go dark for about a minute, and unsaved changes in TouchDesigner are lost. It comes back by itself.`, yes: 'Switch now', danger: true })) return;
      return act('file', `Switch now → ${label}`, 'switch', { file: f }, `TouchDesigner restarts on ${label}; about a minute dark.`, 'TouchDesigner was not restarted.');
    }
    case 'boot': {
      const f = btn.dataset.file, label = { 'river-local-oct-22-seasons.toe': "the river's year", 'river-online-oct-20.toe': 'the live river' }[f] ?? f;
      if (!await confirmSheet({ title: `Open ${label} at the next start?`, body: 'Only the next restart of bitcube is affected; nothing changes now.', yes: 'Set it' })) return;
      return act('boot', `Opens at start → ${label}`, 'bootfile', { file: f }, `After the next restart TouchDesigner opens ${label}.`, 'The start-up file is unchanged.');
    }
    case 'route-direct': case 'route-router': {
      const r = key.slice(6), label = r === 'direct' ? "bitcube's LIGHTS port (white)" : 'the router port (fallback)';
      if (!await confirmSheet({ title: `Lighting network on ${label}?`, body: `Only if the lighting switch is really plugged into ${label}. The wrong choice blacks out all 20 ropes until it is set back.`, yes: 'Use this port', danger: true })) return;
      return act('route', `Lighting port → ${r === 'direct' ? 'LIGHTS' : 'router'}`, 'lightsroute', { route: r }, `The sender moves to ${label}.`, 'The port is unchanged.');
    }
    default: if (key.startsWith('target-')) {
      const season = key.slice(7);
      return act('year', `Target → ${season}`, 'target', { season }, `The river travels forward to ${season} (by hand).`, 'The target is unchanged.');
    }
  }
}

// ---- the feed and everything now --------------------------------------------------------------------------------
function evHtml(e, now) {
  const lvl = e.level ?? 'info';
  const changes = (e.changes ?? []).map((c) => `${c.name} → ${STATE_WORD[c.to] ?? 'gone'}`);
  const detail = [e.detail, changes.length ? `Also: ${changes.slice(0, 4).join(', ')}${changes.length > 4 ? ` and ${changes.length - 4} more` : ''}.` : ''].filter(Boolean);
  const who = [e.who, gapWords(e.away)].filter(Boolean).join(' · ');
  const day = dayTag(e.t, now);
  const muted = ['tick', 'season'].includes(e.kind) ? ' muted' : '';
  return `<li class="ev ${esc(e.kind)}${e.away ? ' away' : ''}${muted}"><time>${esc(clock(e.t))}${day ? `<small>${esc(day)}</small>` : ''}</time><div>
    <div class="t">${['verdict', 'items', 'control', 'start'].includes(e.kind) ? mark(lvl) : '<span class="mark info">•</span>'}${esc(e.title)}</div>
    ${detail.length ? `<div class="d">${detail.map(esc).join(' ')}</div>` : ''}${who ? `<div class="w">${esc(who)}</div>` : ''}</div></li>`;
}
function renderFeed(m) {
  const now = nowMs();
  const f = feed(S.store, now);
  const seg = `<div class="feedhead"><div class="seg"><button class="btn sm ${S.view === 'happened' ? 'lit' : ''}" data-view="happened">What happened</button><button class="btn sm ${S.view === 'items' ? 'lit' : ''}" data-view="items">Everything now</button></div></div>`;
  if (S.view === 'items') { set('feed', seg + itemsHtml(m, now)); return; }
  const startLine = f.start ? `<p class="startline">${esc(`Watching since ${clock(f.start.t)}${dayTag(f.start.t, now) ? ` (${dayTag(f.start.t, now)})` : ''}. Found: ${f.start.title}. What happened before isn't known here; the dated entries above come from bitcube, the river's year and Dave's agent themselves.`)}</p>` : '';
  const list = f.events.length ? `<ol>${f.events.map((e) => evHtml(e, now)).join('')}</ol>` : `<p class="empty">Nothing has changed in the last hour that this page has seen.</p>`;
  const earlier = f.earlier.length ? `<div class="earlier"><h3>Earlier</h3><ol>${f.earlier.map((e) => evHtml(e, now)).join('')}</ol></div>` : '';
  set('feed', `${seg}${list}${earlier}${startLine}`);
}
function itemsHtml(m, now) {
  const items = m.items.filter((x) => x.id !== 'mission control' || x.level !== 'ok');
  const groups = [];
  for (const p of m.problems) {
    const its = items.filter((x) => x.cause === p.id);
    groups.push({ p, its });
  }
  const rest = items.filter((x) => !x.cause);
  const row = (it) => {
    const open = S.open.has(it.id);
    const s = S.store.since.items[it.id];
    const since = s ? lower1(sinceWords(s, now)) : '';
    return `<div class="item${it.muted ? ' muted' : ''}" data-cause-item="${esc(it.id)}"><button data-item="${esc(it.id)}" aria-expanded="${open}">
      ${mark(it.level)}<span class="nm">${esc(shortName(it.name))}</span><span class="st word ${it.level}">${STATE_WORD[it.level]}</span>
      <span class="sm">${esc(it.summary)}</span>
      <span class="fr">${esc(FROM[it.checked_from] ?? '')}${it.age_s != null ? ` · ${ageSpan(it.age_s)}` : ''}${since ? ` · ${esc(since)}` : ''}${it.stale ? ' · stale' : ''}</span></button>
      ${open ? `<div class="more"><p>${esc(it.detail || '')}</p>${it.action ? `<p><b>What to do:</b> ${esc(it.action)}</p>` : ''}
        <div class="addr"><b>Addresses and links (for Will)</b><br>${esc(it.name)} · ${it.address ? `at ${esc(it.address)} · ` : ''}checked ${esc(FROM[it.checked_from] ?? '')}${it.id === 'bitcube' && m.sources.probe.error ? `<br>Full check: <span class="raw">${esc(m.sources.probe.error)}</span>` : ''}${it.id === 'seasons' && m.sources.seasons.error ? `<br>Raw: <span class="raw">${esc(m.sources.seasons.error)}</span>` : ''}${it.id === 'modal agent' && m.sources.modal.error ? `<br>Raw: <span class="raw">${esc(m.sources.modal.error)}</span>` : ''}<br><a href="/map/" target="_blank" rel="noopener">Show on the system map</a></div></div>` : ''}</div>`;
  };
  return `<div class="items">${groups.map(({ p, its }) => `<div class="cause" data-cause="${esc(p.id)}"><div class="h">${mark(p.level)}<span>${esc(p.headline)}</span></div>${p.action && p.id !== m.overall.cause ? `<p class="small" style="margin:2px 0 6px 28px">${esc(p.action)}</p>` : ''}${its.map(row).join('')}</div>`).join('')}
    ${rest.length ? `<div class="cause"><div class="h">${mark('ok')}<span>Fine</span></div>${rest.map(row).join('')}</div>` : ''}</div>`;
}

function renderLights(m) {
  const ro = item(m, 'ropes'), pa = item(m, 'hub75 panels');
  set('lights', `<p><b>Ropes:</b> ${esc(ropeWords(m))}${ro ? ` · ${esc(ro.summary)}` : ''}</p>
    <p><b>Panels:</b> ${esc(panelWords(m))}${pa ? ` · ${esc(pa.summary)}` : ''}</p>
    <p class="dim">This prototype stubs the Lights page: the LED map over the gallery still, the live view and Calibrate live in the Lights prototype. For engineers, the <a href="/map/" target="_blank" rel="noopener">system map</a> is still there.</p>`);
}

// ---- tabs, menu, clicks ------------------------------------------------------------------------------------------
const TABS = [['status', 'Status', '●'], ['lights', 'Lights', '☀'], ['chat', 'Studio chat', '✉']];
function renderNav() {
  set('tabs', TABS.map(([k, l, ic]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}" aria-current="${S.tab === k ? 'page' : 'false'}"><span class="ic" aria-hidden="true">${ic}</span>${l}</button>`).join(''));
  set('navWide', TABS.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join(''));
}
function setTab(k) {
  S.tab = TABS.some(([t]) => t === k) ? k : 'status';
  for (const [t] of TABS) $(`tab-${t}`).classList.toggle('on', t === S.tab);
  if (location.hash !== `#${S.tab}`) history.replaceState(null, '', `#${S.tab}`);
  renderNav();
  if (S.tab === 'chat') fetchChat();
  window.scrollTo(0, 0);
}
function openMenu() {
  const root = $('sheet');
  let theme = 'auto';
  try { theme = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* none */ }
  const contacts = Object.values(CONTACTS).map((c) => `<li><span><b>${esc(c.name)}</b></span><span>${esc(c.owns)}</span></li>`).join('');
  root.innerHTML = `<div class="scrim" data-sheet-close="1"><div class="sheet" role="dialog" aria-modal="true">
    <h3>Menu</h3>
    <ul class="menu-list">
      <li><button data-menu="contacts">&#9742; Who to call ${S.menuContacts ? '&#9652;' : '&#9662;'}</button>${S.menuContacts ? `<ul class="contacts">${contacts}</ul><p class="tiny dim">Numbers live on the Mac mini, never in the repo.</p>` : ''}</li>
      <li><div style="padding:8px 4px"><div class="small dim" style="margin-bottom:6px">Theme</div><div class="seg">${['auto', 'light', 'dark'].map((t) => `<button class="btn sm ${theme === t ? 'lit' : ''}" data-theme-set="${t}">${cap(t)}</button>`).join('')}</div></div></li>
      <li><button data-menu="check">&#8635; Check now</button></li>
      <li><button data-menu="forget">&#128465; Clear this page's history (the last hour)</button></li>
      <li><a href="/map/" target="_blank" rel="noopener">&#128506; System map (for engineers)</a></li>
      <li><a href="https://gavaiken.github.io/river-bitcube/" target="_blank" rel="noopener">&#128214; Project site and docs</a></li>
      <li><button data-menu="logout">&#9099; Log out</button></li>
    </ul></div></div>`;
}
document.addEventListener('click', async (e) => {
  const t = e.target;
  const tab = t.closest('[data-tab]'); if (tab) { setTab(tab.dataset.tab); return; }
  if (t.closest('#menuBtn')) { openMenu(); return; }
  const menu = t.closest('[data-menu]');
  if (menu) {
    const k = menu.dataset.menu;
    if (k === 'contacts') { S.menuContacts = !S.menuContacts; openMenu(); }
    else if (k === 'check') { $('sheet').innerHTML = ''; poll(); fetchChat(); fetchStill(); }
    else if (k === 'forget') { S.store = newStore(S.status?.now ?? Date.now()); saveStore(); $('sheet').innerHTML = ''; if (S.status) { observe(S.store, digest(S.model, S.status), S.model); saveStore(); } render(); }
    else if (k === 'logout') { $('sheet').innerHTML = ''; if (await confirmSheet({ title: 'Log out?', body: 'The team password will be needed to get back in.', yes: 'Log out' })) { await fetch('/logout', { method: 'POST' }); location.href = '/login'; } }
    return;
  }
  const th = t.closest('[data-theme-set]');
  if (th) { try { if (th.dataset.themeSet === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, th.dataset.themeSet); } catch { /* none */ } applyTheme(); openMenu(); return; }
  if (t.closest('[data-sheet-close]') && !t.closest('.sheet')) { $('sheet').innerHTML = ''; return; }
  if (t.closest('[data-controls-toggle]')) { S.controlsOpen = !S.controlsOpen; render(); return; }
  if (t.closest('[data-still-toggle]') && S.still.url) { S.bigStill = !S.bigStill; render(); return; }
  const jump = t.closest('[data-jump]');
  if (jump) { S.controlsOpen = true; render(); const g = document.querySelector(`[data-g="${jump.dataset.jump}"]`); if (g) { g.closest('details')?.setAttribute('open', ''); g.scrollIntoView({ behavior: 'smooth', block: 'center' }); g.classList.add('flash'); setTimeout(() => g.classList.remove('flash'), 1700); } return; }
  const jc = t.closest('[data-jump-cause]');
  if (jc) { S.view = 'items'; render(); document.querySelector(`[data-cause="${CSS.escape(jc.dataset.jumpCause)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const view = t.closest('[data-view]'); if (view) { S.view = view.dataset.view; render(); return; }
  const it = t.closest('[data-item]'); if (it) { const id = it.dataset.item; S.open.has(id) ? S.open.delete(id) : S.open.add(id); render(); return; }
  const c = t.closest('[data-ctl]'); if (c && !c.disabled) { control(c.dataset.ctl, c); }
});

// ---- the room: the gallery still, with its age from the server -----------------------------------------------------
async function fetchStill() {
  try {
    const r = await fetch('/api/camera/gallery.jpg', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); S.still = { url: null, taken: null, why: j.error === 'no picture from that camera right now' ? null : j.error }; }
    else {
      const blob = await r.blob();
      if (S.still.url) URL.revokeObjectURL(S.still.url);
      const taken = Date.parse(r.headers.get('x-taken') || '');
      S.still = { url: URL.createObjectURL(blob), taken: Number.isFinite(taken) ? taken : null, why: null };
    }
  } catch (e) { S.still = { url: null, taken: null, why: `no picture: ${plainError(e)}` }; }
  if (S.model) { renderNow(S.model); renderAges(); }
}

// ---- studio chat: the last reply lands in the feed; the tab shows the shared conversation ---------------------------
async function fetchChat() {
  S.chat.at = performance.now();
  try {
    const h = await api('/api/chat/history?limit=60');
    S.chat.events = h.events ?? []; S.chat.status = h.status ?? S.chat.status;
    const texts = S.chat.events.filter((x) => x.kind === 'text' && x.text);
    const lastText = texts[texts.length - 1];
    if (lastText) {
      const ask = [...S.chat.events].reverse().find((x) => x.kind === 'user' && x.id === lastText.id);
      merge(S.store, { key: `chat:${lastText.t ?? 0}`, t: lastText.t ?? Math.round(nowMs()), kind: 'chat', level: 'info', who: 'studio chat',
        title: `The agent replied${ask ? ` to “${excerpt(ask.text, 60)}”` : ''}`, detail: excerpt(lastText.text, 200) });
      saveStore();
    }
    renderChat(); if (S.model) renderFeed(S.model);
  } catch (e) { $('chatErr').textContent = `The chat history didn't load: ${plainError(e)}.`; }
}
function renderChatStatus() {
  const st = S.chat.status;
  const el = $('chatStatus');
  const working = !!st?.running;
  el.className = `chat-status${working ? ' working' : ''}`;
  const q = st?.queue?.length ?? 0;
  el.innerHTML = `<span class="pulse"></span><span class="txt">${working ? `Working on: “${esc(excerpt(st.current?.text, 50))}”` : 'Ready'}${q ? ` · ${q} waiting` : ''}</span>${working || q ? `<button class="btn sm danger" data-chat-stop="1">Stop${q ? ' and clear the queue' : ''}</button>` : ''}`;
}
function renderChat() {
  renderChatStatus();
  const now = nowMs();
  const rows = S.chat.events.slice(-40).map((e) => {
    const when = e.t ? `${clock(e.t)}${dayTag(e.t, now) ? ` ${dayTag(e.t, now)}` : ''}` : '';
    if (e.kind === 'user') return `<li class="user"><div class="q">Someone on the team · ${esc(when)}${e.queued ? ' · queued' : ''}</div>${esc(e.text)}</li>`;
    if (e.kind === 'text') return `<li class="text">${String(e.text).split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')}</li>`;
    if (e.kind === 'activity') return `<li class="activity">· ${esc(e.text)}</li>`;
    if (e.kind === 'result') return `<li class="result">${e.ok === false ? 'Failed' : 'Done'} ${esc(when)}</li>`;
    if (e.kind === 'error') return `<li class="error">Failed: ${esc(e.text)}</li>`;
    if (e.kind === 'stopped') return `<li class="stopped">Stopped ${esc(when)}</li>`;
    if (e.kind === 'notice') return `<li class="notice">${esc(e.text)}</li>`;
    return '';
  }).join('');
  set('chatLog', rows || '<li class="notice">No conversation yet.</li>');
}
$('chatSend').onclick = async () => {
  const text = $('chatText').value.trim();
  if (!text) return;
  $('chatSend').disabled = true;
  try { await api('/api/chat/send', { text }); $('chatText').value = ''; $('chatErr').textContent = ''; await fetchChat(); }
  catch (e) { $('chatErr').textContent = `Not sent: ${plainError(e)}. Your message is still in the box.`; }
  finally { $('chatSend').disabled = false; }
};
document.addEventListener('click', async (e) => { if (e.target.closest('[data-chat-stop]')) { try { await api('/api/chat/stop', {}); } catch { /* shown by the next status */ } fetchChat(); } });

// ---- go --------------------------------------------------------------------------------------------------------------
applyTheme();
renderNav();
setTab((location.hash || '#status').slice(1));
window.addEventListener('hashchange', () => setTab((location.hash || '#status').slice(1)));
poll(); fetchStill(); fetchChat();
setInterval(poll, POLL_MS);
setInterval(tick, 1000);
setInterval(fetchStill, STILL_MS);
setInterval(fetchChat, CHAT_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); fetchStill(); } });
