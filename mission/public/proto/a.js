// Mission control v2, prototype A: one big answer with drill-down. The page renders the status model (/model.js)
// and never judges the payload itself; controls post to /api/control/<action> and show pending, result and failure
// on themselves. Plain ES module: no framework, no build step.
import * as M from '/model.js';
import { api, esc } from '/app.js';

const { derive, dur, clock, POLL_S, PAGE_STALE_S, FILES } = M;
const $ = (sel, root = document) => root.querySelector(sel);
const WORD = { ok: 'OK', warning: 'Attention', down: 'Down', unknown: 'Unknown' };
const MARK = { ok: '✓', warning: '▲', down: '✕', unknown: '?' };
const FROM = { mini: 'the Mac mini', bitcube: 'bitcube', modal: 'Modal' };
// One name per thing (ia.md §3); descriptors live on the card, never in the name.
const NAME = { bitcube: 'bitcube', touchdesigner: 'TouchDesigner', seasons: "The river's year", ropes: 'Ropes',
  'rope box 1': 'Rope box 1 (ropes 1–10)', 'rope box 2': 'Rope box 2 (ropes 11–20)', 'hub75 panels': 'Panels',
  'gallery camera': 'Gallery camera', 'river camera': 'River camera', router: 'Router', internet: 'Internet at Gray Area',
  'modal agent': "Dave's agent", 'modal link': 'Clips to Dave', recorder: 'River recorder', 'people counter': 'People counter',
  'mission control': 'Mission control' };
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const INTENSITY = ['stillness', 'trickle', 'flowing', 'strong', 'torrent'];
const POLL_MS = 5000, STILL_MS = 30_000, OLD_S = 120;
const LINKS = { bitcube: [["See bitcube's screen (needs Tailscale)", 'vnc://100.73.68.60']],
  seasons: [["The river's year page (needs Tailscale)", 'http://100.73.68.60:9981/']],
  router: [['Router admin (from the gallery Wi-Fi)', 'http://192.168.9.1/']],
  'modal agent': [["Dave's app", 'https://to-be-a-river--river.modal.run/']] };
const DOCS = [['System map (for engineers)', '/map'], ['Show files', 'https://gavaiken.github.io/river-bitcube/show-files'],
  ['Install guide', 'https://gavaiken.github.io/river-bitcube/install'], ['The ceiling', 'https://gavaiken.github.io/river-bitcube/ceiling'],
  ['The plan', 'https://gavaiken.github.io/river-bitcube/execution-plan']];
// Who to call: the model's table when it has one (contactFor), else this copy of ia.md's.
const FALLBACK_CONTACTS = { gavin: { name: 'Gavin', owns: 'bitcube, TouchDesigner, the show file and mission control' },
  lilian: { name: 'Lilian', owns: 'the lights and the rigging' }, andi: { name: 'Andi', owns: 'the panels' },
  will: { name: 'Will', owns: 'the network, the cameras and the river site' }, dave: { name: 'Dave', owns: 'his agent on Modal' },
  colin: { name: 'Colin', owns: 'how the piece should look' } };
const FALLBACK_BY_CAUSE = { page: 'gavin', 'bitcube-unchecked': 'gavin', 'bitcube-offline': 'gavin', 'check-failed': 'gavin', 'probe-stale': 'gavin',
  'td-unknown': 'gavin', 'td-frozen': 'gavin', 'td-off': 'gavin', 'td-slow': 'gavin', 'year-page': 'gavin', 'sender-off': 'gavin', 'link-off': 'gavin',
  'link-failing': 'gavin', recorder: 'gavin', disk: 'gavin', 'modal-stale': 'gavin', 'seasons-stale': 'gavin', lights: 'lilian', sender: 'lilian',
  box: 'lilian', panels: 'andi', 'panels-off': 'andi', 'panels-dark': 'andi', 'ropes-dark': 'colin', 'online-file': 'colin', 'river-stale': 'will',
  'no-internet': 'will', router: 'will', 'river-site': 'will', 'gallery-cam': 'will', 'modal-unreachable': 'dave', 'modal-stalled': 'dave', 'modal-not-ok': 'dave' };
const CONTACTS = M.CONTACTS ?? FALLBACK_CONTACTS;
const contactFor = M.contactFor ?? ((cause) => (FALLBACK_BY_CAUSE[cause] ? CONTACTS[FALLBACK_BY_CAUSE[cause]] : null));
// The art's season tints (desaturated, within a few percent of the page background), blended from the year's weights.
const TINT = {
  light: { winter: ['#d6e4f0', '#edf2f6'], spring: ['#cfe6d6', '#cce0de'], summer: ['#efdfae', '#f3e7c8'], autumn: ['#e9d6ba', '#e3c8b2'], none: ['#dde3ea', '#e6e8ec'] },
  dark:  { winter: ['#182a3c', '#1c2b37'], spring: ['#133029', '#143236'], summer: ['#322c14', '#372e17'], autumn: ['#35251a', '#38241a'], none: ['#172029', '#1a222c'] },
};

// ---- state ----------------------------------------------------------------------------------------------------
let last = null;              // { payload, receivedAt }: the last good answer from /api/status
let failedSince = null;       // when /api/status stopped answering (ms on this phone), null while it answers
let model = null;
let checking = false;         // "Check now": a fetch is in flight
let wasStale = false;
const openRows = new Set();   // expanded rows, kept across re-renders
const ctl = {};               // control feedback: name -> { state: 'pending' | 'done' | 'failed', text }
const stills = { gallery: { url: null, takenAt: null, missing: null }, river: { url: null, takenAt: null, missing: null } };
const lastHTML = new Map();   // section -> the HTML it holds (no churn when nothing changed)
let hubDraft = null;          // the brightness stepper, before "Set"
const targetDraft = { season: null, intensity: null };
let riverWatch = null;

// ---- helpers ---------------------------------------------------------------------------------------------------
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s ?? '');
const nb = (s) => String(s ?? '').replace(/ %/g, ' %').replace(/(\d) (s|min|h|W)\b/g, '$1 $2');   // keep a number with its unit
// Short "what they own" for the call line (the full version is in the Contacts sheet).
const OWNS = { Gavin: 'bitcube and the show file', Lilian: 'lights and rigging', Andi: 'the panels', Will: 'network and cameras', Dave: 'his agent', Colin: 'how it should look' };
const rid = (id) => 'r-' + id.replace(/\s+/g, '-');
const elapsedS = () => (last ? (Date.now() - last.receivedAt) / 1000 : 0);
const ageText = (age) => (age == null ? 'age not known' : `${dur(age + elapsedS())} ago`);
// Rendered from the server's age alone (tick() adds the seconds since the answer every second), so the HTML a
// section holds does not change between answers and the rows are not re-created under a thumb.
const ageSpan = (age) => `<span data-age="${age ?? ''}" class="${age != null && age > OLD_S ? 'old' : ''}">${age == null ? 'age not known' : `${dur(age)} ago`}</span>`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
const pend = (name) => ctl[name]?.state === 'pending';
const op = (id) => (openRows.has(id) ? ' open' : '');   // rendered into the markup: a replaced section keeps its height
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const fileLabel = (f) => FILES[f]?.label ?? f;
/** "cause: consequence" -> [cause, consequence], splitting at the first top-level ":" or ";" (or a trailing parenthesis). */
function splitHeadline(h) {
  let depth = 0;
  for (let i = 0; i < h.length; i++) {
    const c = h[i];
    if (c === '(') depth++; else if (c === ')') depth--;
    else if (depth === 0 && (c === ':' || c === ';') && i >= 12) return [h.slice(0, i), h.slice(i + 1).trim()];
  }
  const p = h.indexOf(' (');
  if (p >= 12 && h.endsWith(')')) return [h.slice(0, p), h.slice(p + 2, -1)];
  return [h, ''];
}
/** A failed control's reason in the team's words, never a library's. */
function plainError(msg) {
  const m = String(msg ?? '');
  if (/logged out/i.test(m)) return 'you were logged out';
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(m)) return "mission control didn't answer";
  if (/can't reach bitcube|ssh/i.test(m)) return "bitcube didn't answer";
  if (/took too long|timeout|aborted/i.test(m)) return 'bitcube took too long to answer';
  if (/^HTTP 50\d/.test(m)) return "mission control couldn't reach bitcube";
  return m || 'no answer';
}
function setHTML(el, html) {
  if (lastHTML.get(el) === html) return;
  lastHTML.set(el, html);
  el.innerHTML = html;
  el.querySelectorAll('details[data-id]').forEach((d) => { d.open = openRows.has(d.dataset.id); });
  refreshAges(el);   // the markup carries the server's age; the seconds since its answer go on at once
}
/** Every age on the page, as of this second: the server's age plus the seconds since its answer. */
function refreshAges(root = document) {
  const el = elapsedS();
  root.querySelectorAll('[data-age]').forEach((s) => {
    const a = s.dataset.age === '' ? null : Number(s.dataset.age);
    s.textContent = ageText(a);
    s.classList.toggle('old', a != null && a + el > OLD_S);
  });
  root.querySelectorAll('[data-still]').forEach((s) => {
    const t = stills[s.dataset.still].takenAt;
    if (t) s.textContent = `${dur((Date.now() - t) / 1000)} ago`;
  });
}
const nbs = (s) => String(s).replace(/ /g, ' ');

// ---- fetching ------------------------------------------------------------------------------------------------
async function poll() {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login'; return; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const receivedAt = Date.now();
    if (typeof j.now !== 'number') j.now = receivedAt;    // an older server sends no clock: the moment it answered will do
    last = { payload: j, receivedAt };
    failedSince = null;
  } catch { failedSince ??= Date.now(); }
  checking = false;
  render();
}
async function fetchStill(cam) {
  const s = stills[cam];
  try {
    const r = await fetch(`/api/camera/${cam}.jpg`, { cache: 'no-store' });
    if (r.status === 401) return;
    if (!r.ok) { if (s.url) URL.revokeObjectURL(s.url); stills[cam] = { url: null, takenAt: null, missing: true }; }
    else {
      const blob = await r.blob();
      const taken = Date.parse(r.headers.get('x-taken') || '') || Date.now();
      if (s.url) URL.revokeObjectURL(s.url);
      stills[cam] = { url: URL.createObjectURL(blob), takenAt: taken, missing: false };
    }
  } catch { stills[cam] = { ...s, missing: true }; }
  render();
}

// ---- rendering --------------------------------------------------------------------------------------------------
function render() {
  model = last ? derive(last.payload, last.payload.now + (Date.now() - last.receivedAt)) : null;
  setArt(model);
  renderFresh();
  const v = $('#verdict');
  v.className = `verdict lv-${model ? model.overall.level : 'unknown'}`;
  setHTML(v, model ? verdictHTML(model) : connectingHTML());
  setHTML($('#now-head'), model ? nowHTML(model) : '');
  setHTML($('#now-steer'), model ? steerHTML(model) : '');
  setHTML($('#problems'), model ? problemsHTML(model) : '');
  setHTML($('#fine'), model ? fineHTML(model) : '');
  setHTML($('#installer'), model ? installerHTML(model) : '');
  document.body.classList.toggle('page-stale', !!model && model.overall.cause === 'page');
}
function renderFresh() {
  const f = $('#fresh');
  if (!last) {
    const dead = failedSince && Date.now() - failedSince > PAGE_STALE_S * 1000;
    f.textContent = failedSince ? `No answer for ${nbs(dur((Date.now() - failedSince) / 1000))}` : 'Connecting…';
    f.className = 'fresh' + (dead ? ' bad' : failedSince ? ' warn' : '');
    return;
  }
  const el = elapsedS();
  if (failedSince) { f.textContent = `No answer for ${nbs(dur(el))}`; f.className = 'fresh ' + (el > PAGE_STALE_S ? 'bad' : 'warn'); }
  else { f.textContent = checking ? 'Checking…' : `Updated ${nbs(dur(el))} ago`; f.className = 'fresh'; }
}
function tick() {
  const stale = elapsedS() > PAGE_STALE_S;
  if (stale !== wasStale) { wasStale = stale; render(); return; }
  refreshAges();
  renderFresh();
}

function connectingHTML() {
  const dead = failedSince && Date.now() - failedSince > PAGE_STALE_S * 1000;
  return `<div class="chip"><span class="mark">?</span>Unknown</div>
    <h1>${dead ? "This page can't reach mission control" : 'Connecting to mission control…'}</h1>
    <p class="detail">${dead ? `No answer for ${dur((Date.now() - failedSince) / 1000)}. Nothing about the show is known from here.` : 'The first answer takes a second or two.'}</p>
    ${dead ? '<div class="todo"><div class="label">What to do</div><p class="action">Check your connection. If other sites load, the Mac mini may be down or off its network.</p><p class="call">Call Gavin (mission control)</p></div>' : ''}`;
}

function verdictHTML(m) {
  const o = m.overall, lv = o.level;
  const [big, rest] = splitHeadline(o.headline);
  const c = contactFor(o.cause);
  const todo = o.action
    ? `<div class="todo"><div class="label">What to do</div><p class="action">${esc(o.action)}</p>${actionButtons(o, m)}${c ? `<p class="call">${c.name === 'Colin' ? 'Ask' : 'Call'} ${esc(c.name)} (${esc(OWNS[c.name] ?? c.owns)})</p>` : ''}</div>`
    : '<div class="todo"><p class="nothing">Nothing to do.</p></div>';
  const others = m.problems.slice(1);
  const also = others.length ? `<div class="also"><div class="label">Also</div>${others.map((p) =>
    `<button class="also-item lv-${p.level}" data-act="goto" data-target="g-${esc(p.id)}"><span class="mk">${MARK[p.level]}</span><span>${esc(splitHeadline(p.headline)[0])}</span><span class="chev">›</span></button>`).join('')}</div>` : '';
  const lastSeen = o.cause === 'page' ? `<p class="last-seen">Last answer at ${clock(last.payload.now)}; what is shown is from then.</p>` : '';
  return `<div class="chip"><span class="mark">${MARK[lv]}</span>${WORD[lv]}</div>
    <h1>${esc(big)}</h1>${rest ? `<p class="rest">${esc(cap(rest))}</p>` : ''}
    <p class="detail">${esc(o.detail)}</p>${lastSeen}${todo}${also}${checkLine(m)}`;
}
function actionButtons(o, m) {
  const b = [];
  if (/Ropes → On/.test(o.action)) b.push(['Ropes → On', rid('ropes')]);
  if (/Switch now|switch to the river's year/i.test(o.action)) b.push(['Switch now', rid('touchdesigner')]);
  if (/HUB75 brightness/i.test(o.action)) b.push(['Panels brightness', rid('hub75 panels')]);
  if (o.cause === 'page' || o.cause === 'bitcube-unchecked' || o.cause === 'probe-stale') return '';
  if (!b.length) return '';
  return `<div class="row-btns">${b.map(([l, id]) => `<button class="btn primary" data-act="goto" data-target="${id}">${esc(l)}</button>`).join('')}</div>`;
}
function checkLine(m) {
  const pa = m.overall.checked.probe_age_s;
  const next = pa == null ? null : clamp(POLL_S.probe - pa, 0, POLL_S.probe);
  const txt = pa == null ? "bitcube's full check hasn't answered yet"
    : `Checked from bitcube ${ageSpan(pa)}${m.overall.stale ? '' : next > 0 ? ` · next in about ${dur(next)}` : ' · checking again any moment'}`;
  return `<div class="check-line"><span>${txt}</span><button class="btn small link" data-act="checknow" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check now'}</button></div>`;
}

function nowHTML(m) {
  const s = m.show, item = (id) => m.items.find((x) => x.id === id);
  let head;
  if (s.season) {
    const idx = SEASONS.indexOf(s.season);
    const pos = clamp(s.phase != null ? (((s.phase % 4) + 4) % 4) / 4 * 100 : (idx + 0.5) * 25, 2.5, 97.5);
    const lit = s.intensity ? INTENSITY.indexOf(s.intensity.word) + 1 : 0;
    head = `<div class="season-row"><div class="season-word">${esc(s.season)}</div><div class="mode">${esc(cap(s.mode?.words ?? ''))}</div></div>
      <div class="strip"><span class="w"></span><span class="sp"></span><span class="su"></span><span class="au"></span><span class="marker" style="left:${pos.toFixed(1)}%"></span></div>
      <div class="strip-labels">${SEASONS.map((x) => `<span class="${x === s.season ? 'on' : ''}">${x}</span>`).join('')}</div>
      ${s.intensity ? `<div class="intensity"><span class="lbl">Intensity</span><span class="int-bar">${INTENSITY.map((_, i) => `<i class="${i < lit ? 'on' : ''}"></i>`).join('')}</span><b>${esc(s.intensity.word)}</b></div>` : ''}`;
  } else if (s.file?.kind === 'live') {
    head = `<div class="season-row"><div class="season-word muted">The live river, not the river's year</div></div>
      <div class="strip dim"><span class="w"></span><span class="sp"></span><span class="su"></span><span class="au"></span></div>
      <div class="strip-labels">${SEASONS.map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="intensity"><span class="lbl">The river</span><b>${esc(cap(s.river.words))}</b></div>`;
  } else {
    const why = item('seasons')?.summary ?? 'not known';
    head = `<div class="season-row"><div class="season-word muted">Season not known</div></div>
      <div class="strip dim"><span class="w"></span><span class="sp"></span><span class="su"></span><span class="au"></span></div>
      <div class="strip-labels">${SEASONS.map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="intensity"><b>${esc(why)}</b></div>`;
  }
  const tile = (id, words) => { const x = item(id); return `<button class="tile lv-${x.level}" data-act="goto" data-target="${rid(id)}"><span class="tile-h"><span class="mk">${MARK[x.level]}</span><span class="state">${WORD[x.level]}</span></span><span class="words">${esc(nb(cap(words)))}</span></button>`; };
  return head + `<div class="tiles">${tile('ropes', s.ropes.words)}${tile('hub75 panels', s.panels.words)}${roomHTML(m)}</div>`;
}
function roomHTML(m) {
  const g = stills.gallery, cam = m.items.find((x) => x.id === 'gallery camera'), bc = m.items.find((x) => x.id === 'bitcube');
  const age = g.takenAt ? (Date.now() - g.takenAt) / 1000 : null;
  if (g.url) return `<div class="room ${age > OLD_S ? 'old' : ''}" data-act="still"><img src="${g.url}" alt="The room: the gallery camera's latest still">
    <div class="cap"><span class="mk lv-${cam.level}">${MARK[cam.level]}</span>The room · <span data-still="gallery">${dur(age)} ago</span>${age > OLD_S ? ' · old picture' : ''}</div></div>`;
  const why = g.missing == null ? 'fetching the picture…' : bc.level === 'down' ? 'bitcube is offline, so no picture' : cam.level === 'down' ? "the gallery camera isn't answering"
    : cam.level === 'unknown' ? 'no picture yet' : 'no picture right now';
  return `<div class="room none lv-${cam.level}"><div class="cap-none"><span class="mk">${MARK[cam.level]}</span>The room: ${why}</div></div>`;
}

function steerHTML(m) {
  const s = m.show, c = m.controls;
  if (!s.season && s.file?.kind === 'live') {
    return `<details class="sub" data-id="steer" id="steer"${op('steer')}><summary><span>Switch to the river's year</span><span class="chev">›</span></summary>
      <div class="steer-body"><p class="detail">The live river has no year of seasons and serves no steering page. The year's controls come back when the river's year runs.</p>${showfileCtlHTML(m)}</div></details>`;
  }
  const modeBtn = (id, label) => { const poss = id === 'dynamic' ? c.mode.dynamic.possible : c.mode.possible; return `<button data-act="mode" data-mode="${id}" class="${s.mode?.id === id ? 'lit' : ''}" ${poss && !pend('mode') ? '' : 'disabled'}>${label}</button>`; };
  const manual = s.mode?.id === 'manual';
  const tSeason = targetDraft.season ?? s.target?.season ?? null;
  const tInt = targetDraft.intensity ?? s.target?.intensity ?? s.intensity?.value ?? 0.5;
  const tOff = !c.target.possible || !manual || pend('target');
  const modeWhy = c.mode.why ? `<div class="why">Can't change now: ${esc(c.mode.why)}.</div>` : c.mode.dynamic.why ? `<div class="effect">Dynamic can't be chosen: ${esc(c.mode.dynamic.why)}.</div>` : '';
  const rules = s.season && last?.payload?.seasons?.value?.rules ? rulesHTML(last.payload.seasons.value.rules, c) : '';
  return `<details class="sub" data-id="steer" id="steer"${op('steer')}><summary><span>Steer the year</span><span class="chev">›</span></summary><div class="steer-body">
    <div class="ctl ${c.mode.possible ? '' : 'off'}"><div class="ctl-h">Mode: who steers</div>
      <div class="seg">${modeBtn('automatic', 'Automatic')}${modeBtn('dynamic', 'Dynamic')}${modeBtn('manual', 'Manual')}</div>
      <div class="effect">Automatic turns the year by itself, one season a minute. Dynamic lets the people in the room steer it. Manual takes over by hand: the river travels forward to your target.</div>
      ${modeWhy}${statusLine('mode')}</div>
    <div class="ctl ${tOff ? 'off' : ''}"><div class="ctl-h">Target (manual)</div>
      <div class="target-grid">${SEASONS.map((x) => `<button class="btn ${tSeason === x ? 'primary' : ''}" data-act="tseason" data-season="${x}" ${tOff ? 'disabled' : ''}>${x}</button>`).join('')}</div>
      <div class="stepper"><button class="btn step" data-act="tint" data-d="-0.1" ${tOff || tInt <= 0 ? 'disabled' : ''} aria-label="Less intensity">−</button><output>${esc(M.intensityWord(tInt) ?? '')} (${tInt.toFixed(1)})</output><button class="btn step" data-act="tint" data-d="0.1" ${tOff || tInt >= 1 ? 'disabled' : ''} aria-label="More intensity">+</button>
        <button class="btn primary" data-act="target-set" ${tOff || !tSeason ? 'disabled' : ''}>Send target</button></div>
      <div class="effect">${manual ? 'The river travels forward through the calendar to the target; it never jumps.' : 'Choose Manual first; the target then steers the river by hand.'}</div>
      ${statusLine('target')}</div>
    ${rules}</div></details>`;
}
function rulesHTML(rules, c) {
  const off = !c.rules.possible || pend('rules');
  const rows = Object.entries(rules).map(([k, r]) => `<label class="rule"><span>${esc(r.label)} <span class="unit">(${esc(String(r.min))}–${esc(String(r.max))} ${esc(r.unit)})</span></span>
    <input type="number" name="${esc(k)}" value="${esc(String(r.value))}" data-default="${esc(String(r.default))}" min="${esc(String(r.min))}" max="${esc(String(r.max))}" step="any" ${off ? 'disabled' : ''}></label>`).join('');
  return `<details class="sub" data-id="rules"${op('rules')}><summary><span>Rules (${Object.keys(rules).length} numbers)</span><span class="chev">›</span></summary>
    <form class="ctl rules-form" data-ctl="rules" onsubmit="return false"><div class="rules">${rows}</div>
    <div class="row-btns"><button class="btn primary" data-act="rules-apply" ${off ? 'disabled' : ''}>Apply the changed ones</button><button class="btn" data-act="rules-reset" ${off ? 'disabled' : ''}>Reset all to defaults</button></div>
    <div class="effect">A rule changes the behaviour from now on; it does not move the river. Reset confirms first.</div>
    ${c.rules.why ? `<div class="why">Can't change now: ${esc(c.rules.why)}.</div>` : ''}${statusLine('rules')}</form></details>`;
}

function problemsHTML(m) {
  const bad = m.items.filter((x) => x.level !== 'ok' && !x.muted && x.id !== 'mission control');
  if (!bad.length) return '';
  const placed = new Set();
  const groups = [];
  for (const p of m.problems) {
    if (p.id === 'page') continue;
    const its = p.items.map((id) => m.items.find((x) => x.id === id)).filter((x) => x && x.level !== 'ok' && !x.muted && x.id !== 'mission control' && !placed.has(x.id));
    its.forEach((x) => placed.add(x.id));
    if (its.length) groups.push({ p, its });
  }
  const rest = bad.filter((x) => !placed.has(x.id));
  if (rest.length) groups.push({ p: null, its: rest });
  const n = (lv) => bad.filter((x) => x.level === lv).length;
  const sub = [n('down') ? `${n('down')} down` : '', n('warning') ? `${n('warning')} need${n('warning') === 1 ? 's' : ''} attention` : '', n('unknown') ? `${n('unknown')} can't be checked` : ''].filter(Boolean).join(' · ');
  return `<h2 class="sec">Not OK <span class="sub">${esc(sub)}</span></h2>` + groups.map((g, i) => groupHTML(g, i, m)).join('');
}
function groupHTML({ p, its }, i, m) {
  const head = p ? `<div class="group-h lv-${p.level}"><span class="mk">${MARK[p.level]}</span><div><b>${esc(splitHeadline(p.headline)[0])}</b>${i > 0 && p.action ? `<div class="g-action">${esc(p.action)}</div>` : ''}</div></div>` : '';
  const unk = its.filter((x) => x.level === 'unknown'), known = its.filter((x) => x.level !== 'unknown');
  const rows = known.map((x) => rowHTML(x, m)).join('') + (unk.length >= 3 ? foldHTML(unk, p, m) : unk.map((x) => rowHTML(x, m)).join(''));
  return `<section class="card group" id="g-${esc(p?.id ?? 'other')}">${head}${rows}</section>`;
}
function foldHTML(unk, p, m) {
  return `<details class="row lv-unknown fold" data-id="fold-${esc(p?.id ?? 'other')}"${op(`fold-${p?.id ?? 'other'}`)}><summary><span class="mk">?</span><div>
      <div class="name">${unk.length} things can't be checked <span class="state">· Unknown</span></div>
      <div class="sum">${esc(unk[0].summary)}: ${esc(unk.map((x) => NAME[x.id]).join(', '))}</div></div><span class="chev">›</span></summary>
    <div class="row-body"><p class="detail">${esc(unk[0].detail)}</p>${unk.map((x) => rowHTML(x, m)).join('')}</div></details>`;
}
function rowHTML(x, m) {
  const body = [
    x.detail ? `<p class="detail">${esc(x.detail)}</p>` : '',
    x.action ? `<p class="action">${esc(x.action)}</p>` : '',
    x.id === 'ropes' ? ropesCtlHTML(m) : x.id === 'hub75 panels' ? hubCtlHTML(m) : x.id === 'touchdesigner' ? showfileCtlHTML(m)
      : x.id === 'seasons' && m.show.season ? '<div class="row-btns"><button class="btn" data-act="goto" data-target="steer">Steer the year</button></div>'
      : x.id === 'seasons' && m.show.file?.kind === 'live' ? showfileCtlHTML(m)
      : x.id === 'river camera' ? riverStillHTML(x) : '',
    addrHTML(x, m),
  ].join('');
  return `<details class="row lv-${x.level}${x.stale ? ' stale' : ''}" data-id="${esc(x.id)}" id="${rid(x.id)}"${op(x.id)}><summary>
      <span class="mk">${MARK[x.level]}</span><div><div class="name">${esc(NAME[x.id] ?? x.name)} <span class="state">· ${WORD[x.level]}</span></div>
      <div class="sum">${esc(nb(x.summary))}</div><div class="from">from ${FROM[x.checked_from]} · ${ageSpan(x.age_s)}${x.stale ? ' · last seen' : ''}</div></div><span class="chev">›</span></summary>
    <div class="row-body">${body}</div></details>`;
}
function addrHTML(x, m) {
  const src = x.id === 'bitcube' ? m.sources.bitcube : x.id === 'seasons' ? m.sources.seasons : x.id === 'modal agent' ? m.sources.modal : x.checked_from === 'bitcube' ? m.sources.probe : null;
  const lines = [x.address ? `Address: <code>${esc(x.address)}</code>` : '', `Checked from ${FROM[x.checked_from]} · ${ageSpan(x.age_s)}`, src?.error ? `Raw: <code>${esc(src.error)}</code>` : ''].filter(Boolean);
  const links = [...(LINKS[x.id] ?? []), ['Show on the system map', '/map']];
  return `<div class="addr"><div class="label">Addresses and links (for Will)</div>${lines.map((l) => `<div>${l}</div>`).join('')}
    <div class="links">${links.map(([l, h]) => `<a href="${esc(h)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}</div></div>`;
}
function riverStillHTML(x) {
  const r = stills.river, age = r.takenAt ? (Date.now() - r.takenAt) / 1000 : null;
  if (r.url) return `<div class="room ${age > OLD_S ? 'old' : ''}"><img src="${r.url}" alt="The river: the river camera's latest still"><div class="cap">The river · <span data-still="river">${dur(age)} ago</span>${age > OLD_S ? ' · old picture' : ''}</div></div>`;
  return `<div class="room none lv-${x.level}"><div class="cap-none"><span class="mk">${MARK[x.level]}</span>The river: ${r.missing == null ? 'fetching the picture…' : 'no picture right now'}</div></div>`;
}
function fineHTML(m) {
  const ok = m.items.filter((x) => x.level === 'ok' && x.id !== 'mission control' && !x.muted);
  const muted = m.items.filter((x) => x.muted);
  if (!ok.length && !muted.length) return '';
  const n = ok.length;
  return `<details class="card fine" data-id="fine" id="fine-list"${op('fine')}><summary><span class="mk lv-ok">✓</span><span>${n} thing${n === 1 ? '' : 's'} fine</span>
      <span class="fine-names">${esc(ok.slice(0, 3).map((x) => NAME[x.id]).join(', '))}${ok.length > 3 ? '…' : ''}</span><span class="chev">›</span></summary>
    <div class="fine-list">${ok.map((x) => rowHTML(x, m)).join('')}${muted.map((x) => `<div class="muted-row"><span class="mk lv-unknown">·</span><div><div class="name">${esc(NAME[x.id])}</div><div class="sum">${esc(x.summary)}</div></div></div>`).join('')}</div></details>`;
}
function installerHTML(m) {
  const c = m.controls, s = m.show, route = s.ropes.route, boot = s.boot_file?.name;
  const files = s.show_files.length ? s.show_files : Object.keys(FILES).slice(0, 2);
  const lrOff = !c.lightsroute.possible || pend('lightsroute'), bfOff = !c.bootfile.possible || pend('bootfile');
  return `<details class="card installer" data-id="installer"${op('installer')}><summary><span class="tool">🛠</span><span>Installer</span><span class="note">cabling settings · confirms every change</span><span class="chev">›</span></summary><div class="body">
    <div class="ctl ${lrOff ? 'off' : ''}"><div class="ctl-h">Lighting network port on bitcube</div>
      <div class="seg"><button data-act="lightsroute" data-route="direct" class="${route === 'direct' ? 'lit' : ''}" ${lrOff ? 'disabled' : ''}>LIGHTS port (white)</button><button data-act="lightsroute" data-route="router" class="${route === 'router' ? 'lit' : ''}" ${lrOff ? 'disabled' : ''}>Router port (fallback)</button></div>
      <div class="effect">Now: <b>${route === 'direct' ? "bitcube's LIGHTS port" : route === 'router' ? 'the router port' : 'not known'}</b>. Wrong port = all 20 ropes dark. Only change it after moving the cable.</div>
      ${c.lightsroute.why ? `<div class="why">Can't change now: ${esc(c.lightsroute.why)}.</div>` : ''}${statusLine('lightsroute')}</div>
    <div class="ctl ${bfOff ? 'off' : ''}"><div class="ctl-h">Show file that opens at boot</div>
      <div class="seg">${files.map((f) => `<button data-act="bootfile" data-file="${esc(f)}" class="${boot === f ? 'lit' : ''}" ${bfOff ? 'disabled' : ''}>${esc(cap(fileLabel(f)))}</button>`).join('')}</div>
      <div class="effect">Takes effect at bitcube's next restart; it does not change what is showing now.</div>
      ${c.bootfile.why ? `<div class="why">Can't change now: ${esc(c.bootfile.why)}.</div>` : ''}${statusLine('bootfile')}</div>
    <div class="links"><a class="btn" href="#lights" data-act="lights">Calibrate the lights (Lights tab)</a></div>
    <div class="effect">Also: <a href="/map">the full system map</a> · <a href="${DOCS[2][1]}" target="_blank" rel="noopener">install guide</a> · <a href="${DOCS[3][1]}" target="_blank" rel="noopener">the ceiling</a> · <a href="${DOCS[4][1]}" target="_blank" rel="noopener">the plan</a></div>
  </div></details>`;
}

// ---- controls ---------------------------------------------------------------------------------------------------
function statusLine(name) {
  const c = ctl[name];
  return `<div class="status ${c?.state ?? ''}" aria-live="polite">${c ? `${c.state === 'pending' ? '<span class="spin"></span>' : ''}<span>${esc(c.text)}</span>` : ''}</div>`;
}
function ropesCtlHTML(m) {
  const c = m.controls.ropes, st = m.show.ropes.state, off = !c.possible || pend('ropes');
  return `<div class="ctl ${c.possible ? '' : 'off'}"><div class="ctl-h">Ropes</div>
    <div class="seg"><button data-act="ropes" data-dark="0" class="${st === 'river' ? 'lit' : ''}" ${off ? 'disabled' : ''}>On · showing the river</button><button data-act="ropes" data-dark="1" class="${st === 'dark' ? 'lit' : ''}" ${off ? 'disabled' : ''}>Dark</button></div>
    <div class="effect">Now: <b>${esc(cap(m.show.ropes.words))}</b>. Dark keeps sending black so the ropes stay black instead of playing their own colours; On brings the river back within a few seconds. Dark confirms first.</div>
    ${c.possible ? '' : `<div class="why">Can't change now: ${esc(c.why)}.</div>`}${statusLine('ropes')}</div>`;
}
function hubCtlHTML(m) {
  const c = m.controls.hub75, b = m.show.panels.brightness, cur = b == null ? null : Math.round(b * 100);
  const draft = hubDraft ?? cur, off = !c.possible || pend('hub75');
  return `<div class="ctl ${c.possible ? '' : 'off'}"><div class="ctl-h">Panels brightness</div>
    <div class="stepper"><button class="btn step" data-act="hub-step" data-d="-10" ${off || draft == null || draft <= 0 ? 'disabled' : ''} aria-label="Darker">−</button><output>${draft == null ? '?' : `${draft} %`}</output><button class="btn step" data-act="hub-step" data-d="10" ${off || draft == null || draft >= 100 ? 'disabled' : ''} aria-label="Brighter">+</button>
      <button class="btn primary" data-act="hub-set" ${off || draft == null || draft === cur ? 'disabled' : ''}>Set ${draft ?? ''} %</button>
      <button class="btn" data-act="hub-off" ${off || cur === 0 ? 'disabled' : ''}>Panels off</button></div>
    <div class="effect">Now: <b>${cur == null ? 'not known' : `${cur} %`}</b>. A change shows on the panels within a few seconds. Panels off sets 0 % and confirms first.</div>
    ${c.possible ? '' : `<div class="why">Can't change now: ${esc(c.why)}.</div>`}${statusLine('hub75')}</div>`;
}
function showfileCtlHTML(m) {
  const c = m.controls.switch, s = m.show, files = s.show_files.length ? s.show_files : Object.keys(FILES).slice(0, 2);
  const running = s.file?.name, off = !c.possible || pend('switch');
  const btns = files.map((f) => `<button class="btn ${f === running ? '' : 'primary'}" data-act="switch" data-file="${esc(f)}" ${off ? 'disabled' : ''}>${f === running ? `Restart on ${esc(fileLabel(f))}` : `Switch now → ${esc(fileLabel(f))}`}</button>`).join('');
  return `<div class="ctl ${c.possible ? '' : 'off'}"><div class="ctl-h">Show file</div>
    <div class="effect"><b>${s.file ? `Showing ${esc(s.file.label)}` : 'Not known what is showing'}</b>${s.boot_file ? ` · opens at boot: ${esc(s.boot_file.label)}` : ''}</div>
    <div class="row-btns">${btns}</div>
    <div class="effect">Switch now restarts TouchDesigner on that file: the lights go dark for about a minute and unsaved changes in TouchDesigner are lost. It confirms first.</div>
    ${c.possible ? '' : `<div class="why">Can't change now: ${esc(c.why)}.</div>`}${statusLine('switch')}</div>`;
}
/** Confirm if asked, then post; the control shows pending, the result with a time, or the failure and the next step. */
async function runControl(name, path, body, { confirm = null, done, fail }) {
  if (confirm && !(await confirmSheet(confirm))) return;
  ctl[name] = { state: 'pending', text: 'Sending…' };
  render();
  try {
    const j = await api(path, body);
    if (j && j.ok === false) throw new Error(j.error || 'bitcube did not answer');
    ctl[name] = { state: 'done', text: `${done} · sent ${clock(Date.now())}${j?.fixture ? ' (fixture mode: nothing really changed)' : ''}` };
    if (name === 'hub75') hubDraft = null;
    if (name === 'target') { targetDraft.season = null; targetDraft.intensity = null; }
    setTimeout(poll, 1500);
  } catch (e) {
    ctl[name] = { state: 'failed', text: `${fail}: ${plainError(e.message)} (${clock(Date.now())}). Try again, or look at the verdict above.` };
  }
  render();
}

// ---- sheets ------------------------------------------------------------------------------------------------------
function openSheet(html) {
  const d = $('#sheet');
  d.innerHTML = `<div class="sheet-in" role="document">${html}</div>`;
  d.onclick = (e) => { if (e.target === d || e.target.closest('[data-sheet="close"]')) d.close(); };
  if (!d.open) d.showModal();
}
function confirmSheet({ title, text, yes, no = 'Not now', danger = true }) {
  return new Promise((resolve) => {
    const d = $('#sheet');
    d.innerHTML = `<div class="sheet-in" role="document"><h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="row-btns"><button class="btn ${danger ? 'danger' : 'primary'}" data-sheet="yes">${esc(yes)}</button><button class="btn" data-sheet="no">${esc(no)}</button></div></div>`;
    const finish = (v) => { d.onclick = null; d.oncancel = null; d.close(); resolve(v); };
    d.onclick = (e) => { const b = e.target.closest('[data-sheet]'); if (b) finish(b.dataset.sheet === 'yes'); else if (e.target === d) finish(false); };
    d.oncancel = (e) => { e.preventDefault(); finish(false); };
    d.showModal();
  });
}
function openMenu() {
  const t = (() => { try { return localStorage.getItem('mc-theme') ?? 'auto'; } catch { return 'auto'; } })();
  openSheet(`<h3>Menu</h3>
    <button class="btn wide" data-act="contacts">Contacts: who to call</button>
    <div class="ctl-h">Theme</div><div class="seg">${['auto', 'light', 'dark'].map((x) => `<button data-act="theme" data-theme="${x}" class="${t === x ? 'lit' : ''}">${cap(x)}</button>`).join('')}</div>
    <button class="btn wide" data-act="checknow">Check now</button>
    <div class="ctl-h">Docs</div><div class="links">${DOCS.map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div>
    <div class="row-btns"><button class="btn" data-act="logout">Log out</button><button class="btn" data-sheet="close">Close</button></div>`);
}
function openContacts() {
  openSheet(`<h3>Who to call</h3><p>First names and what they own. The numbers live in the team's contacts file on the Mac mini, not in this prototype.</p>
    ${Object.values(CONTACTS).map((c) => `<div class="contact"><b>${esc(c.name)}</b><span>${esc(c.owns)}</span></div>`).join('')}
    <div class="row-btns"><button class="btn" data-sheet="close">Close</button></div>`);
}
function openLights() {
  openSheet(`<h3>Lights</h3><p>Not in this prototype: the Lights tab draws every LED over the gallery camera still (Map | Live) and holds Calibrate. For now, the Ropes and Panels rows on Status hold the state and the controls.</p>
    <div class="row-btns"><a class="btn" href="/map">System map</a><button class="btn" data-sheet="close">Close</button></div>`);
}
function openStill() {
  const g = stills.gallery;
  if (!g.url) return;
  openSheet(`<h3>The room</h3><img class="still" src="${g.url}" alt="The gallery camera's latest still"><p>Taken <span data-still="gallery">${dur((Date.now() - g.takenAt) / 1000)} ago</span>, fetched through bitcube. The picture refreshes about every 30 s.</p>
    <div class="row-btns"><button class="btn" data-sheet="close">Close</button></div>`);
}
function setTheme(t) {
  try { if (t === 'auto') localStorage.removeItem('mc-theme'); else localStorage.setItem('mc-theme', t); } catch { /* private mode: the choice lasts for this page */ }
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  render();
}
function goto(target) {
  const el = document.getElementById(target);
  if (!el) return;
  for (let d = el.tagName === 'DETAILS' ? el : el.closest('details'); d; d = d.parentElement?.closest('details')) {
    d.open = true;
    if (d.dataset.id) openRows.add(d.dataset.id);
  }
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}

// ---- the art follows the season --------------------------------------------------------------------------------------
const hex = (h) => [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)].map((x) => parseInt(x, 16));
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
function setArt(m) {
  const t = TINT[isDark() ? 'dark' : 'light'];
  const w = m?.show.weights, season = m?.show.season;
  let a, b;
  const total = w ? SEASONS.reduce((s, k) => s + (Number(w[k]) > 0 ? Number(w[k]) : 0), 0) : 0;
  if (total > 0) {
    [a, b] = [0, 1].map((i) => toHex([0, 1, 2].map((ch) => SEASONS.reduce((s, k) => s + hex(t[k][i])[ch] * ((Number(w[k]) > 0 ? Number(w[k]) : 0) / total), 0))));
  } else [a, b] = t[season && t[season] ? season : 'none'];
  const root = document.documentElement.style;
  root.setProperty('--art-a', a); root.setProperty('--art-b', b);
  document.documentElement.dataset.season = season ?? 'none';
}

// ---- events --------------------------------------------------------------------------------------------------------------
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.id) return;
  if (d.open) openRows.add(d.dataset.id); else openRows.delete(d.dataset.id);
  if (d.dataset.id === 'river camera') {
    clearInterval(riverWatch); riverWatch = null;
    if (d.open) { fetchStill('river'); riverWatch = setInterval(() => fetchStill('river'), STILL_MS); }
  }
}, true);
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === 'lights') e.preventDefault();
  switch (act) {
    case 'goto': goto(b.dataset.target); break;
    case 'checknow': checking = true; $('#sheet').close(); renderFresh(); render(); poll(); break;
    case 'menu': openMenu(); break;
    case 'contacts': openContacts(); break;
    case 'lights': openLights(); break;
    case 'still': openStill(); break;
    case 'theme': setTheme(b.dataset.theme); openMenu(); break;
    case 'logout': {
      $('#sheet').close();
      if (await confirmSheet({ title: 'Log out?', text: 'You will need the team password to get back in, in the dark.', yes: 'Log out', danger: false })) {
        await fetch('/logout', { method: 'POST' }); location.href = '/login';
      }
      break;
    }
    case 'ropes': {
      const dark = b.dataset.dark === '1';
      runControl('ropes', '/api/control/ropes', { dark }, {
        confirm: dark ? { title: 'Make the ropes dark?', text: 'The ropes in the gallery go black now and stay black until someone presses On. The panels keep showing the river.', yes: 'Go dark', no: 'Keep showing the river' } : null,
        done: dark ? 'Dark: the ropes go black within a few seconds' : 'On: the ropes show the river again within a few seconds', fail: 'The ropes are unchanged' });
      break;
    }
    case 'hub-step': { const cur = model?.show.panels.brightness == null ? null : Math.round(model.show.panels.brightness * 100); if (cur == null && hubDraft == null) break; hubDraft = clamp((hubDraft ?? cur) + Number(b.dataset.d), 0, 100); render(); break; }
    case 'hub-set': runControl('hub75', '/api/control/hub75', { brightness: hubDraft / 100 }, { done: `Panels set to ${hubDraft} %; it shows within a few seconds`, fail: 'The panels are unchanged' }); break;
    case 'hub-off': runControl('hub75', '/api/control/hub75', { brightness: 0 }, { confirm: { title: 'Switch the panels off?', text: 'The HUB75 panels go dark now (brightness 0 %). Set a brightness to bring them back.', yes: 'Panels off' },
      done: 'Panels off (0 %); set a brightness to bring them back', fail: 'The panels are unchanged' }); break;
    case 'mode': runControl('mode', '/api/control/mode', { mode: b.dataset.mode }, { done: `The year is now ${b.dataset.mode}`, fail: 'The mode is unchanged' }); break;
    case 'tseason': targetDraft.season = b.dataset.season; render(); break;
    case 'tint': { const cur = targetDraft.intensity ?? model?.show.target?.intensity ?? model?.show.intensity?.value ?? 0.5; targetDraft.intensity = Math.round(clamp(cur + Number(b.dataset.d), 0, 1) * 10) / 10; render(); break; }
    case 'target-set': {
      const season = targetDraft.season ?? model?.show.target?.season, intensity = targetDraft.intensity ?? model?.show.target?.intensity ?? model?.show.intensity?.value ?? 0.5;
      runControl('target', '/api/control/target', { season, intensity }, { done: `Target sent: ${season}, ${M.intensityWord(intensity)}; the river travels there`, fail: 'The target is unchanged' });
      break;
    }
    case 'rules-apply': {
      const form = b.closest('form'), changed = {};
      for (const inp of form.querySelectorAll('input[name]')) if (inp.value !== '' && Number(inp.value) !== Number(inp.defaultValue)) changed[inp.name] = Number(inp.value);
      if (!Object.keys(changed).length) { ctl.rules = { state: 'done', text: 'Nothing changed.' }; render(); break; }
      runControl('rules', '/api/control/rules', { rules: changed }, { done: `${Object.keys(changed).length} rule${Object.keys(changed).length === 1 ? '' : 's'} saved`, fail: 'The rules are unchanged; what you typed is kept' });
      break;
    }
    case 'rules-reset': runControl('rules', '/api/control/rules-reset', {}, { confirm: { title: 'Reset every rule to its default?', text: 'All nine numbers go back to their defaults from now on. The river itself does not move.', yes: 'Reset all' },
      done: 'Rules reset to their defaults', fail: 'The rules are unchanged' }); break;
    case 'switch': {
      const f = b.dataset.file, label = fileLabel(f);
      runControl('switch', '/api/control/switch', { file: f }, { confirm: { title: `Switch to ${label} now?`, text: 'Restarts TouchDesigner on that file: the lights go dark for about a minute, and unsaved changes in TouchDesigner are lost.', yes: 'Switch now' },
        done: `TouchDesigner is restarting on ${label}: about a minute dark`, fail: 'The show file is unchanged' });
      break;
    }
    case 'bootfile': { const f = b.dataset.file; runControl('bootfile', '/api/control/bootfile', { file: f }, { done: `${cap(fileLabel(f))} opens at the next restart`, fail: 'The boot file is unchanged' }); break; }
    case 'lightsroute': {
      const route = b.dataset.route;
      runControl('lightsroute', '/api/control/lightsroute', { route }, { confirm: { title: route === 'direct' ? "Use bitcube's LIGHTS port?" : 'Use the router port?', text: 'Moves the lighting network to that port. If the lighting switch is plugged into the other one, all 20 ropes go dark until it is moved back.', yes: 'Change the port' },
        done: `Lighting network on ${route === 'direct' ? "bitcube's LIGHTS port" : 'the router port'}`, fail: 'The port is unchanged' });
      break;
    }
    default: break;
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); fetchStill('gallery'); } });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

// ---- go ------------------------------------------------------------------------------------------------------------
render();
poll();
fetchStill('gallery');
setInterval(poll, POLL_MS);
setInterval(() => fetchStill('gallery'), STILL_MS);
setInterval(tick, 1000);
