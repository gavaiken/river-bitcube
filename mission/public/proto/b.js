// Mission control v2, prototype B: the room and the signal chain first. Every verdict, state word and reason on this
// page comes from derive() in /model.js; the page only groups the model's items into the boxes and links of the chain
// and never reads the payload itself. Plain ES module, no build, no framework, no external scripts.
import * as M from '/model.js';
const { derive, dur, clock, LEVELS, FILES } = M;
import { api, esc } from '/app.js';

const POLL_MS = 3000, LIGHTS_MS = 2500, STILL_MS = 30_000;
const WORDS = { ok: 'OK', warning: 'Attention', down: 'Down', unknown: 'Unknown' };
const MARKS = { ok: '✓', warning: '▲', down: '✕', unknown: '?' };
const FROM = { mini: 'the Mac mini', bitcube: 'bitcube', modal: 'Modal' };
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const DOCS = 'https://gavaiken.github.io/river-bitcube/';
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
const $ = (sel) => document.querySelector(sel);
const fileLabel = (f) => FILES[f]?.label ?? f;

// The chain: a handful of boxes (each holding the model's items for that piece) and the links between them.
const BOXES = [
  { id: 'gallery', name: 'Gallery camera', items: ['gallery camera'], lead: 'Watches the room: the still, clips to Dave, and the people counter when it exists. On our router\'s Wi-Fi.' },
  { id: 'river', name: 'River camera', items: ['river camera', 'recorder'], lead: 'At the real river, on solar power and Starlink. Only the live river file shows it; the recorder and the clips to Dave use it in any file.' },
  { id: 'internet', name: 'Internet', items: ['internet', 'router'], lead: "Gray Area's uplink through our router in the ceiling. The show runs without it; clips to Dave and the river camera need it." },
  { id: 'bitcube', name: 'bitcube', items: ['bitcube', 'touchdesigner', 'seasons', 'people counter'], lead: 'The show PC in the ceiling: TouchDesigner runs the show file and drives the ropes and the panels.' },
  { id: 'ropes', name: 'Ropes', items: ['ropes', 'rope box 1', 'rope box 2'], lead: "The 20 LED ropes, fed from bitcube's LIGHTS port through the two rope boxes (ropes 1–10 and 11–20)." },
  { id: 'panels', name: 'Panels', items: ['hub75 panels'], lead: "The HUB75 LED panels, fed from bitcube's HDMI through the panel sender." },
  { id: 'dave', name: "Dave's agent", items: ['modal agent', 'modal link'], lead: 'Dave\'s agent on Modal gets clips from both cameras and makes a scene. Only the live river file shows the scene.' },
];
const LINKS = [
  { from: 'gallery', to: 'bitcube', item: 'gallery camera' },
  { from: 'river', to: 'bitcube', item: 'river camera' },
  { from: 'internet', to: 'bitcube', item: 'internet' },
  { from: 'bitcube', to: 'ropes', item: 'ropes' },
  { from: 'bitcube', to: 'panels', item: 'hub75 panels' },
  { from: 'bitcube', to: 'dave', item: 'modal link' },
];
const BOX_OF = {};
for (const b of BOXES) for (const id of b.items) BOX_OF[id] = b.id;

// Who to call, by the model's cause id. First names and what they own only: the numbers live in a contacts file on
// the Mac mini, never in the repo.
const PEOPLE = { Lilian: 'lights and rigging', Andi: 'the panels', Will: 'network and cameras', Dave: "Dave's agent",
                 Gavin: 'bitcube, TouchDesigner, the show file and mission control', Colin: 'how the piece should look' };
const CALL = {
  lights: 'Lilian', sender: 'Lilian', box: 'Lilian', 'sender-off': 'Lilian',
  panels: 'Andi', 'panels-off': 'Andi', 'panels-dark': 'Andi',
  'gallery-cam': 'Will', 'no-internet': 'Will', router: 'Will', 'river-site': 'Will', 'river-stale': 'Will', 'link-off': 'Will', 'link-failing': 'Will',
  'modal-stalled': 'Dave', 'modal-unreachable': 'Dave', 'modal-not-ok': 'Dave', 'modal-stale': 'Dave',
  'bitcube-offline': 'Gavin', 'td-frozen': 'Gavin', 'td-off': 'Gavin', 'check-failed': 'Gavin', 'probe-stale': 'Gavin', 'bitcube-unchecked': 'Gavin',
  'td-slow': 'Gavin', 'online-file': 'Gavin', 'year-page': 'Gavin', disk: 'Gavin', recorder: 'Gavin', page: 'Gavin', 'td-unknown': 'Gavin', 'seasons-stale': 'Gavin',
};
// coming-up, not-checked, td-restarting, ropes-dark and unknown: wait or press a button; nobody to call.
function whoToCall(cause) {
  if (!cause) return null;
  if (typeof M.contactFor === 'function') { const c = M.contactFor(cause); return c ? { name: c.name, owns: c.owns } : null; }
  const n = CALL[cause]; return n ? { name: n, owns: PEOPLE[n] } : null;
}

// The art follows the season of the piece: two wash colours and a line colour per season and theme, blended by the
// model's season weights. Desaturated and close to the background, so it can never read as a status colour.
const ART = {
  winter: { light: ['#cfe0f2', '#e9f0f8', '#7a9fc6'], dark: ['#15253a', '#101a27', '#7a9fc6'] },
  spring: { light: ['#cfe8da', '#e4f2ea', '#4c9d7e'], dark: ['#10302a', '#0f211e', '#4c9d7e'] },
  summer: { light: ['#f4e1b5', '#f9eed9', '#c4902f'], dark: ['#3a2b0e', '#231a08', '#c4902f'] },
  autumn: { light: ['#efd5bd', '#f5e3d3', '#b6652f'], dark: ['#3a2213', '#23160c', '#b6652f'] },
  none: { light: ['#d9e0e8', '#e9edf1', '#6b7a8c'], dark: ['#172028', '#111820', '#6b7a8c'] },
};

// ---- state ------------------------------------------------------------------------------------------------------
const S = {
  last: null, receivedAt: 0, failSince: null, model: null, checking: false,
  lights: null, lightsErr: null, lightsAt: 0,
  still: { url: null, at: null, err: null },
  sheet: null, sheetHtml: '', bandHtml: '', nodesHtml: '', listHtml: '', instHtml: '',
  pending: {}, draft: {}, calib: null, scenarios: null, detailOpen: false,
};

// ---- the model: the server's clock, moved on by the time since its answer (a phone's skew can't age anything) ----
function model() {
  if (!S.last) return null;
  const serverNow = typeof S.last.now === 'number' ? S.last.now : S.receivedAt;
  return derive(S.last, serverNow + (Date.now() - S.receivedAt));
}

async function poll() {
  try { const j = await api('/api/status'); S.last = j; S.receivedAt = Date.now(); S.failSince = null; }
  catch (e) { if (e.message === 'logged out') return; S.failSince ??= Date.now(); }
  render();
}

function render() {
  const m = (S.model = model());
  renderFresh();
  if (!m) { renderConnecting(); return; }
  setArt(m);
  document.body.classList.toggle('page-stale', !!(m.overall.cause === 'page' || (S.failSince && Date.now() - S.failSince > 30_000)));
  renderBand(m); renderChain(m); renderLightsCaption(); renderRoom(); renderList(m); renderInstaller(m);
  if (S.sheet) renderSheet();
}

// ---- header freshness: the page's own last good fetch, counted on the phone ------------------------------------
function renderFresh() {
  const el = $('#fresh');
  if (S.checking) { el.textContent = 'Checking…'; el.className = 'fresh'; return; }
  if (!S.last) {
    const f = S.failSince ? Math.round((Date.now() - S.failSince) / 1000) : 0;
    el.textContent = f > 5 ? `No answer for ${dur(f)}` : 'Connecting…';
    el.className = 'fresh' + (f > 30 ? ' bad' : '');
    return;
  }
  const age = Math.round((Date.now() - S.receivedAt) / 1000);
  el.textContent = S.failSince ? `No answer for ${dur(age)}` : `Updated ${dur(age)} ago`;
  el.className = 'fresh' + (age > 30 ? ' bad' : age > 10 ? ' warn' : '');
}

function renderConnecting() {
  const f = S.failSince ? Math.round((Date.now() - S.failSince) / 1000) : 0;
  const lost = f > 30;
  const band = $('#band');
  band.className = 'band lvl-unknown';
  band.innerHTML = `<div class="chip"><i class="mark" aria-hidden="true">?</i>Unknown</div>
    <h1 class="headline">${lost ? `This page can't reach mission control (no answer for ${dur(f)})` : 'Connecting to mission control…'}</h1>
    <p class="detail">${lost ? 'Nothing on this page is known until it answers.' : 'The first answer takes a moment.'}</p>
    <div class="todo">${lost ? '<span class="todo-k">What to do</span><span class="todo-v">Check your connection. If other sites load, the Mac mini may be down or off its network.</span>' : '<span class="nothing">Wait a moment.</span>'}</div>`;
  if (!S.nodesHtml) {
    $('#nodes').innerHTML = '<svg class="links" id="links" aria-hidden="true"></svg>' + BOXES.map((b) => `<button type="button" class="node ${b.id} lvl-unknown" data-box="${b.id}">
      <span class="nname">${esc(b.name)}</span><span class="nstate"><i class="mark">?</i>Unknown</span><span class="nsum">Not known yet</span></button>`).join('');
  }
}

// ---- the season art --------------------------------------------------------------------------------------------
function themeSetting() { try { return localStorage.getItem('mc-theme') || 'auto'; } catch { return 'auto'; } }
function applyTheme() {
  const t = themeSetting();
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  if (S.model) setArt(S.model);
}
function effectiveTheme() { const t = themeSetting(); return t !== 'auto' ? t : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
function setArt(m) {
  const theme = effectiveTheme();
  const w = m.show.weights && Object.entries(m.show.weights).filter(([k, v]) => ART[k] && v > 0);
  const total = w?.reduce((s, [, v]) => s + v, 0) || 0;
  const pick = (i) => {
    if (!total) return ART.none[theme][i];
    const acc = [0, 0, 0];
    for (const [k, v] of w) hex(ART[k][theme][i]).forEach((x, j) => { acc[j] += x * v / total; });
    return toHex(acc);
  };
  const r = document.documentElement.style;
  r.setProperty('--art-a', pick(0)); r.setProperty('--art-b', pick(1)); r.setProperty('--art-line', pick(2));
  document.documentElement.dataset.season = m.show.season ?? 'none';
}

// ---- the verdict band --------------------------------------------------------------------------------------------
// Where the action's button lives, by the model's cause id: the chip opens that box's sheet, controls included.
const GOTO = { 'ropes-dark': ['ropes', 'Ropes'], 'sender-off': ['ropes', 'Ropes'], lights: ['ropes', 'Ropes'], sender: ['ropes', 'Ropes'], box: ['ropes', 'Ropes'],
  panels: ['panels', 'Panels'], 'panels-off': ['panels', 'Panels'], 'panels-dark': ['panels', 'Panels'],
  'td-frozen': ['bitcube', 'Show file'], 'td-off': ['bitcube', 'Show file'], 'td-slow': ['bitcube', 'Show file'], 'online-file': ['bitcube', 'Show file'], 'year-page': ['bitcube', 'Show file'],
  'river-stale': ['river', 'River camera'], 'river-site': ['river', 'River camera'], 'gallery-cam': ['gallery', 'Gallery camera'],
  'no-internet': ['internet', 'Internet'], router: ['internet', 'Internet'],
  'modal-stalled': ['dave', "Dave's agent"], 'modal-unreachable': ['dave', "Dave's agent"], 'modal-not-ok': ['dave', "Dave's agent"], 'link-off': ['dave', "Dave's agent"], 'link-failing': ['dave', "Dave's agent"] };
function gotoChips(cause) {
  const g = GOTO[cause];
  return g ? `<div class="goto"><button type="button" class="btn" data-act="open" data-arg="${g[0]}">Open ${esc(g[1])} →</button></div>` : '';
}
function renderBand(m) {
  let o = m.overall;
  // Prototype only: a running calibration shows as Attention so nobody panics at ropes flashing patterns. In the real
  // thing the model derives this from the capture's status file.
  if (S.calib && !S.calib.done) o = { ...o, level: o.level === 'ok' ? 'warning' : o.level, headline: `Calibrating the lights: the ropes are in patterns for about ${S.calib.minsLeft} more min`,
    detail: `${S.calib.stage}. The show is interrupted meanwhile and comes back by itself.`, action: "Keep people out of the gallery camera's view. Stop from the Ropes box if it must end early.", cause: 'calibrating' };
  const lvl = o.level, person = whoToCall(o.cause);
  const html = `<div class="chip"><i class="mark" aria-hidden="true">${MARKS[lvl]}</i>${WORDS[lvl]}</div>
    <h1 class="headline">${esc(o.headline)}</h1>
    <p class="detail ${S.detailOpen || o.detail.length < 150 ? '' : 'clamp'}" data-act="detail">${esc(o.detail)}</p>
    <div class="todo">${o.action ? `<span class="todo-k">What to do</span><span class="todo-v">${esc(o.action)}</span>${person ? `<span class="call">Call ${esc(person.name)} (${esc(person.owns)})</span>` : ''}${gotoChips(o.cause)}`
                              : '<span class="nothing">Nothing to do.</span>'}</div>
    ${o.also.length ? `<div class="also"><span class="todo-k">Also</span><ul>${o.also.map((h, i) => {
      const p = m.problems[i + 1], box = p && BOX_OF[p.items[0]];
      return `<li><button type="button" class="linklike" data-act="open" data-arg="${box ?? 'bitcube'}">${esc(h)}</button></li>`; }).join('')}</ul></div>` : ''}`;
  const band = $('#band');
  band.className = `band lvl-${lvl}`;
  if (html !== S.bandHtml) { band.innerHTML = html; S.bandHtml = html; }
}

// ---- the signal chain ---------------------------------------------------------------------------------------------
const worstOf = (its) => [...its].filter((x) => x && !x.muted).sort((a, b) => LEVELS[a.level] - LEVELS[b.level])[0] ?? null;
function boxItems(m, box) { return box.items.map((id) => m.items.find((x) => x.id === id)).filter(Boolean); }
function boxLine(m, box, worst) {
  if (!worst) return 'Not known yet';
  if (worst.level === 'unknown' && /^Behind bitcube/.test(worst.summary)) return 'Behind bitcube: not known while it is offline';
  if (box.id === 'bitcube' && worst.level === 'unknown') { const bc = m.items.find((x) => x.id === 'bitcube'); if (bc && bc.level === 'ok') return bc.summary; }
  if (box.id === 'bitcube' && worst.level === 'ok' && m.show.file) {
    return `${cap(m.show.file.label)}${m.show.season ? ` · ${m.show.season}` : ''}${m.show.mode ? ` · ${m.show.mode.id}` : ''}${m.show.intensity ? ` · ${m.show.intensity.word}` : ''}`;
  }
  if (box.id === 'ropes' && worst.level === 'ok') return cap(m.show.ropes.words);
  if (box.id === 'internet' && worst.level === 'ok') return 'Online';
  if (box.id === 'dave' && worst.level === 'ok' && m.show.file) return `${worst.summary} · scene ${m.show.file.kind === 'live' ? 'on the panels' : 'not used tonight'}`;
  return worst.summary;
}
function renderChain(m) {
  let html = '<svg class="links" id="links" aria-hidden="true"></svg>';
  for (const b of BOXES) {
    const worst = worstOf(boxItems(m, b)), lvl = worst?.level ?? 'unknown';
    html += `<button type="button" class="node ${b.id} lvl-${lvl}" data-box="${b.id}" aria-haspopup="dialog" aria-label="${esc(b.name)}: ${WORDS[lvl]}. ${esc(boxLine(m, b, worst))}">
      <span class="nname">${esc(b.name)}</span><span class="nstate"><i class="mark" aria-hidden="true">${MARKS[lvl]}</i>${WORDS[lvl]}</span>
      <span class="nsum">${esc(boxLine(m, b, worst))}</span></button>`;
  }
  if (html !== S.nodesHtml) { $('#nodes').innerHTML = html; S.nodesHtml = html; }
  requestAnimationFrame(drawLinks);
}
function linkLabel(l, it, m) {
  if (!it) return 'not known';
  const L = it.level, s = it.summary;
  if (L === 'unknown') return 'not known';
  switch (l.item) {
    case 'gallery camera': return L === 'ok' ? 'answers' : L === 'down' ? 'no answer' : 'see details';
    case 'river camera': return m.show.river.live === true ? 'live frames' : /no frames/i.test(s) ? 'no frames' : L === 'down' ? 'unreachable' : L === 'ok' ? 'answers' : 'see details';
    case 'internet': return L === 'ok' ? 'online' : L === 'down' ? 'no internet' : 'see details';
    case 'ropes': { const st = m.show.ropes.state;
      return st === 'dark' ? 'sending black' : st === 'not-reaching' ? (/frozen|not running/i.test(s) ? 'not driven' : /restart|starts/i.test(s) ? 'dark, restarting' : 'not reaching')
        : L === 'warning' ? (/slowly|frames a second/i.test(s) ? 'jerky' : 'see details') : 'sender open'; }
    case 'hub75 panels': return L === 'down' ? 'no display' : /frozen/i.test(s) ? 'picture frozen' : L === 'warning' ? (/dark|off|brightness 0/i.test(s) ? 'dark' : 'see details') : 'LED display';
    case 'modal link': return /not running|not started/i.test(s) ? 'not running' : /failing/i.test(s) ? 'clips failing' : /sync/i.test(s) ? 'sync quiet' : L === 'ok' ? 'clips posting' : 'see details';
  }
  return WORDS[L].toLowerCase();
}
function drawLinks() {
  const m = S.model, svg = $('#links'), wrap = $('#nodes');
  if (!svg || !wrap) return;
  const W = wrap.offsetWidth, H = wrap.offsetHeight;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  const base = wrap.getBoundingClientRect();
  const rect = (id) => { const r = wrap.querySelector(`[data-box="${id}"]`).getBoundingClientRect(); return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let out = `<defs>${['ok', 'warning', 'down', 'unknown'].map((l) => `<marker id="arrow-${l}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow-${l}" d="M0,0 L10,5 L0,10 z"/></marker>`).join('')}</defs>`;
  const pills = [];
  for (const l of LINKS) {
    const a = rect(l.from), b = rect(l.to), it = m ? m.items.find((x) => x.id === l.item) : null;
    const lvl = it?.level ?? 'unknown';
    const vertical = Math.abs((b.y + b.h / 2) - (a.y + a.h / 2)) > Math.abs((b.x + b.w / 2) - (a.x + a.w / 2));
    let x1, y1, x2, y2;
    if (vertical) {
      const down = b.y > a.y, cx = a.w <= b.w ? a.x + a.w / 2 : b.x + b.w / 2;
      x1 = clamp(cx, a.x + 20, a.x + a.w - 20); x2 = clamp(cx, b.x + 20, b.x + b.w - 20);
      y1 = down ? a.y + a.h : a.y; y2 = down ? b.y : b.y + b.h;
    } else {
      const right = b.x > a.x, cy = a.h <= b.h ? a.y + a.h / 2 : b.y + b.h / 2;
      y1 = clamp(cy, a.y + 16, a.y + a.h - 16); y2 = clamp(cy, b.y + 16, b.y + b.h - 16);
      x1 = right ? a.x + a.w : a.x; x2 = right ? b.x : b.x + b.w;
    }
    const d = vertical ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}` : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
    out += `<path class="lk lk-${lvl}" d="${d}" marker-end="url(#arrow-${lvl})"/>`;
    pills.push({ lvl, x: (x1 + x2) / 2, y: (y1 + y2) / 2, text: m ? linkLabel(l, it, m) : 'not known' });
  }
  for (const p of pills) out += `<g class="pill pill-${p.lvl}"><rect rx="9"/><text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central">${esc(p.text)}</text></g>`;
  svg.innerHTML = out;
  for (const g of svg.querySelectorAll('g.pill')) {
    const t = g.querySelector('text'), r = g.querySelector('rect'), bb = t.getBBox();
    r.setAttribute('x', bb.x - 7); r.setAttribute('y', bb.y - 3); r.setAttribute('width', bb.width + 14); r.setAttribute('height', bb.height + 6);
  }
}
addEventListener('resize', () => requestAnimationFrame(drawLinks));

// ---- what the lights are showing: the simulator, from GET /api/lights (contract in lib/fixtures.mjs) --------------
const offR = document.createElement('canvas'), offP = document.createElement('canvas');
function bytesToCanvas(b64, w, h, cv) {
  const bin = atob(b64), n = w * h, img = new ImageData(w, h), d = img.data;
  for (let i = 0; i < n; i++) { d[i * 4] = bin.charCodeAt(i * 3); d[i * 4 + 1] = bin.charCodeAt(i * 3 + 1); d[i * 4 + 2] = bin.charCodeAt(i * 3 + 2); d[i * 4 + 3] = 255; }
  cv.width = w; cv.height = h; cv.getContext('2d').putImageData(img, 0, 0);
}
async function pollLights() {
  try {
    const r = await fetch('/api/lights');
    if (r.status === 401) { location.href = '/login'; return; }
    const j = await r.json().catch(() => ({}));
    const f = j && typeof j === 'object' && j.frames && typeof j.frames === 'object' ? j.frames : j;   // lib/lights.mjs wraps the real frames
    if (!r.ok || j.ok === false || !f?.ropes?.rgb || !f?.panels?.rgb) { S.lights = null; S.lightsErr = j.error || f?.ropes?.error || f?.panels?.error || `HTTP ${r.status}`; }
    else { S.lights = f; S.lightsErr = null; S.lightsAt = Date.now(); }
  } catch { S.lightsErr = 'no answer from mission control'; }     // keep the last frame; the caption says how old it is
  drawLights(); renderLightsCaption();
}
function drawLights() {
  const l = S.lights, rc = $('#ropesCanvas'), pc = $('#panelsCanvas');
  const rctx = rc.getContext('2d'), pctx = pc.getContext('2d');
  rctx.clearRect(0, 0, rc.width, rc.height); pctx.clearRect(0, 0, pc.width, pc.height);
  if (!l) return;
  bytesToCanvas(l.ropes.rgb, l.ropes.w, l.ropes.h, offR);
  bytesToCanvas(l.panels.rgb, l.panels.w, l.panels.h, offP);
  const n = l.ropes.w, gap = 8, sw = (rc.width - gap * (n - 1)) / n;
  rctx.imageSmoothingEnabled = true;
  for (let r = 0; r < n; r++) {
    rctx.drawImage(offR, r, 0, 1, l.ropes.h, Math.round(r * (sw + gap)), 0, Math.round(sw), rc.height);   // LED 0 at the top: the plug end, in the ceiling
    if (l.source === 'black') { rctx.strokeStyle = 'rgba(140,150,160,0.45)'; rctx.lineWidth = 2; rctx.strokeRect(Math.round(r * (sw + gap)) + 1, 1, Math.round(sw) - 2, rc.height - 2); }
  }
  const q = 4, qw = l.panels.w / q, gw = (pc.width - gap * (q - 1)) / q;
  for (let i = 0; i < q; i++) pctx.drawImage(offP, i * qw, 0, qw, l.panels.h, Math.round(i * (gw + gap)), 0, Math.round(gw), pc.height);
}
function renderLightsCaption() {
  const m = S.model, cap_ = $('#lightsCaption'), note = $('#simNote'), ageEl = $('#lightsAge'), sec = $('#lights');
  const age = S.lights ? Math.round((Date.now() - S.lightsAt) / 1000) : null;
  const old = age != null && age > 15;
  sec.classList.toggle('stale', old || (!S.lights && !!S.lightsErr));
  ageEl.textContent = S.lights ? (old ? `last frame ${dur(age)} ago` : `${dur(age)} ago`) : '';
  if (S.lights) {
    const src = S.lights.source === 'black' ? 'The ropes are dark on purpose: TouchDesigner sends black. The panels still show the river.'
      : m?.show.file ? `${cap(m.show.file.label)}${m.show.season ? `: ${m.show.season}` : ''}${m.show.intensity ? `, ${m.show.intensity.word}` : ''}. What TouchDesigner sends to each LED and panel, from bitcube.` : 'What TouchDesigner sends to each LED and panel, from bitcube.';
    cap_.textContent = src;
    note.className = 'simnote' + (old ? ' bad' : '');
    note.textContent = old ? `No new frame for ${dur(age)}${S.lightsErr ? `: ${S.lightsErr}` : ''}. The picture above is the last one received.` : '';
  } else {
    const why = m ? (m.show.ropes.state === 'unknown' ? m.items.find((x) => x.id === 'ropes')?.summary : m.items.find((x) => x.id === 'touchdesigner')?.summary) : null;
    cap_.textContent = 'What TouchDesigner sends to each LED and panel.';
    note.className = 'simnote bad';
    note.textContent = `Can't show the lights: ${S.lightsErr ?? 'no frames yet'}${why ? ` (${why.toLowerCase()})` : ''}.`;
  }
}

// ---- the room: the gallery camera's latest still --------------------------------------------------------------------
async function pollStill() {
  try {
    const r = await fetch('/api/camera/gallery.jpg?t=' + Date.now());
    if (r.status === 401) { location.href = '/login'; return; }
    if (r.ok) {
      const url = URL.createObjectURL(await r.blob());
      if (S.still.url) URL.revokeObjectURL(S.still.url);
      S.still = { url, at: Date.parse(r.headers.get('x-taken') || '') || Date.now(), err: null };
    } else { const j = await r.json().catch(() => ({})); S.still = { ...S.still, err: j.error || `HTTP ${r.status}` }; }
  } catch { S.still = { ...S.still, err: 'no answer from mission control' }; }
  renderRoom();
}
function renderRoom() {
  const m = S.model, it = m?.items.find((x) => x.id === 'gallery camera');
  const body = $('#roomBody'), ageEl = $('#stillAge');
  const age = S.still.at ? Math.max(0, Math.round((Date.now() - S.still.at) / 1000)) : null;
  const old = age != null && age > 120;
  ageEl.textContent = S.still.url ? `${old ? 'old picture: ' : ''}${dur(age)} ago` : '';
  if (S.still.url) {
    let img = body.querySelector('img');
    if (!img) { body.innerHTML = '<img alt="The gallery camera\'s latest still of the room">'; img = body.querySelector('img'); }
    if (img.src !== S.still.url) img.src = S.still.url;
    img.className = old ? 'old' : '';
    const note = body.querySelector('p') ?? body.appendChild(document.createElement('p'));
    note.className = 'sub';
    note.textContent = S.still.err ? `No newer picture: ${S.still.err}.` : it ? `Gallery camera: ${it.summary}` : '';
  } else {
    const why = it && it.level !== 'ok' ? `${it.summary}.` : (S.still.err ? `${cap(S.still.err)}.` : 'Fetching the still…');
    body.innerHTML = `<div class="nopic"><span>No picture of the room.<br>${esc(why)}</span></div>`;
  }
}

// ---- everything, worst first ---------------------------------------------------------------------------------------
function renderList(m) {
  const html = m.items.filter((x) => x.id !== 'mission control').map((it) => `<li class="${it.muted ? 'muted' : ''}"><button type="button" data-act="open" data-arg="${BOX_OF[it.id] ?? 'bitcube'}" data-item="${esc(it.id)}">
    <i class="mark m-${it.level}" aria-hidden="true">${MARKS[it.level]}</i><span class="iname">${esc(it.name.replace(/ \(.*\)$/, ''))}</span><span class="iword w-${it.level}">${WORDS[it.level]}</span>
    <span class="isum">${esc(it.summary)} <span class="iage">· from ${FROM[it.checked_from]}${it.age_s != null ? ` · ${dur(it.age_s)} ago` : ''}${it.stale ? ' · stale' : ''}</span></span></button></li>`).join('');
  if (html !== S.listHtml) { $('#itemList').innerHTML = html; S.listHtml = html; }
}

// ---- controls -----------------------------------------------------------------------------------------------------
const busy = (key) => S.pending[key]?.state === 'sending';
const ctlResult = (key) => (S.pending[key] ? `<p class="ctl-result ${S.pending[key].state}" role="status">${esc(S.pending[key].text)}</p>` : '');
function ropesControls(m) {
  const c = m.controls.ropes, st = m.show.ropes.state, dis = !c.possible || busy('ropes') ? 'disabled' : '';
  return `<div class="ctl"><div class="ctl-h">Ropes <span class="now">${esc(cap(m.show.ropes.words))}</span></div>
    <div class="seg"><button type="button" class="btn ${st === 'river' ? 'lit' : ''}" data-act="ropes-on" ${dis}>Showing the river</button>
      <button type="button" class="btn ${st === 'dark' ? 'lit' : 'danger'}" data-act="ropes-dark" ${dis}>Dark</button></div>
    <p class="ctl-why ${c.possible ? '' : 'cant'}">${c.possible ? 'Dark sends black to all 20 ropes, so the boxes stay dark instead of playing their own colours; the ropes follow within a few seconds. Dark asks first.' : `Can't be changed now: ${esc(c.why)}.`}</p>${ctlResult('ropes')}</div>`;
}
function panelsControls(m) {
  const c = m.controls.hub75, b = m.show.panels.brightness, now = b != null ? Math.round(b * 100) : null;
  S.draft.hub ??= now ?? 100;
  const dis = !c.possible || busy('hub75') ? 'disabled' : '';
  return `<div class="ctl"><div class="ctl-h">Panel brightness <span class="now">${now != null ? `now ${now} %` : 'not known'}</span></div>
    <div class="stepper"><button type="button" class="btn sq" data-act="hub-dec" ${dis} aria-label="Lower by 10 %">−</button><span class="val">${S.draft.hub} %</span>
      <button type="button" class="btn sq" data-act="hub-inc" ${dis} aria-label="Raise by 10 %">+</button>
      <button type="button" class="btn primary" data-act="hub-set" ${dis || S.draft.hub === now ? 'disabled' : ''}>Set brightness</button></div>
    <p class="ctl-why ${c.possible ? '' : 'cant'}">${c.possible ? 'Set changes the panels at once. Panels off is brightness 0 and asks first.' : `Can't be changed now: ${esc(c.why)}.`}</p>
    <div class="row"><button type="button" class="btn danger" data-act="hub-off" ${dis}>Panels off</button></div>${ctlResult('hub75')}</div>`;
}
function yearControls(m) {
  const c = m.controls.mode, mode = m.show.mode?.id ?? null, t = m.show.target;
  S.draft.int ??= t?.intensity ?? m.show.intensity?.value ?? 0.5;
  const dis = !c.possible || busy('year') ? 'disabled' : '';
  const seasonNow = m.show.season ? `${m.show.season}, ${m.show.intensity?.word ?? ''}` : 'not running';
  return `<div class="ctl"><div class="ctl-h">The river's year <span class="now">${esc(seasonNow)}</span></div>
    <div class="seg">${['automatic', 'dynamic', 'manual'].map((x) => `<button type="button" class="btn ${mode === x ? 'lit' : ''}" data-act="mode" data-arg="${x}" ${x === 'dynamic' && !c.dynamic?.possible ? 'disabled' : dis}>${cap(x)}</button>`).join('')}</div>
    <p class="ctl-why ${c.possible ? '' : 'cant'}">${c.possible ? `${esc(cap(m.show.mode?.words ?? ''))}.${c.dynamic?.possible ? '' : ` Dynamic can't be chosen: ${esc(c.dynamic?.why ?? '')}.`}` : `Can't be steered now: ${esc(c.why)}.`}</p>
    <div class="ctl-h">Target <span class="now">${mode === 'manual' ? 'set by hand' : 'choosing one takes over by hand'}</span></div>
    <div class="seg">${SEASONS.map((s) => `<button type="button" class="btn ${t?.season === s ? 'lit' : ''}" data-act="target-season" data-arg="${s}" ${dis}>${cap(s)}</button>`).join('')}</div>
    <div class="stepper"><span class="muted">Intensity</span><button type="button" class="btn sq" data-act="int-dec" ${dis} aria-label="Less intense">−</button><span class="val">${S.draft.int.toFixed(2)}</span>
      <button type="button" class="btn sq" data-act="int-inc" ${dis} aria-label="More intense">+</button><button type="button" class="btn primary" data-act="target-int" ${dis}>Set intensity</button></div>
    <p class="ctl-why">The river travels forward through the calendar to a target; it never jumps there. Stillness is 0, turbulence is 1.</p>${ctlResult('year')}</div>`;
}
function showFileControls(m) {
  const c = m.controls.switch, cur = m.show.file?.name, boot = m.show.boot_file?.name;
  const files = m.show.show_files.length ? m.show.show_files : Object.keys(FILES).slice(0, 2);
  const dis = !c.possible || busy('switch') ? 'disabled' : '';
  return `<div class="ctl"><div class="ctl-h">Show file <span class="now">${m.show.file ? `now: ${esc(m.show.file.label)}` : 'not known'}</span></div>
    ${files.map((f) => `<div class="row"><span style="flex:1 1 150px;align-self:center;font-size:15px">${esc(cap(fileLabel(f)))}${f === cur ? ' <span class="muted">· running now</span>' : ''}${f === boot ? ' <span class="muted">· opens at boot</span>' : ''}</span>
      <button type="button" class="btn ${f === cur ? '' : 'primary'}" data-act="switch" data-arg="${esc(f)}" ${dis}>Switch now</button></div>`).join('')}
    <p class="ctl-why ${c.possible ? '' : 'cant'}">${c.possible ? 'Switch now restarts TouchDesigner on that file: the lights go dark for about a minute and unsaved changes in TouchDesigner are lost. It asks first.' : `Can't switch now: ${esc(c.why)}.`}</p>${ctlResult('switch')}</div>`;
}
function installerControls(m) {
  const c = m.controls.lightsroute, route = m.show.ropes.route, dis = !c.possible || busy('lightsroute') ? 'disabled' : '';
  const b = m.controls.bootfile, boot = m.show.boot_file?.name, disB = !b.possible || busy('bootfile') ? 'disabled' : '';
  const files = m.show.show_files.length ? m.show.show_files : Object.keys(FILES).slice(0, 2);
  return `<div class="ctl"><div class="ctl-h">Lighting network port <span class="now">${route === 'direct' ? "now: bitcube's LIGHTS port" : route === 'router' ? 'now: the router port' : 'not known'}</span></div>
    <div class="seg"><button type="button" class="btn ${route === 'direct' ? 'lit' : ''}" data-act="route" data-arg="direct" ${dis}>bitcube's LIGHTS port (white)</button>
      <button type="button" class="btn ${route === 'router' ? 'lit' : ''}" data-act="route" data-arg="router" ${dis}>The router port (fallback)</button></div>
    <p class="ctl-why ${c.possible ? '' : 'cant'}">${c.possible ? 'Moves the lighting address to the other port. Wrong, it blacks out all 20 ropes; both ways ask first.' : `Can't be changed now: ${esc(c.why)}.`}</p>${ctlResult('lightsroute')}</div>
  <div class="ctl"><div class="ctl-h">Show file at boot <span class="now">${m.show.boot_file ? `now: ${esc(m.show.boot_file.label)}` : 'not known'}</span></div>
    <div class="seg">${files.map((f) => `<button type="button" class="btn ${f === boot ? 'lit' : ''}" data-act="bootfile" data-arg="${esc(f)}" ${disB}>${esc(cap(fileLabel(f)))}</button>`).join('')}</div>
    <p class="ctl-why ${b.possible ? '' : 'cant'}">${b.possible ? 'Which file TouchDesigner opens when bitcube starts. Nothing changes until the next restart; it asks first.' : `Can't be changed now: ${esc(b.why)}.`}</p>${ctlResult('bootfile')}</div>`;
}
function renderInstaller(m) {
  const html = installerControls(m);
  if (html !== S.instHtml) { $('#installerBody').innerHTML = html; S.instHtml = html; }
}

// Calibrate (prototype): the portal side of tools/pixelmap on bitcube. The run here is faked on the client; the real
// one is launched by a whitelisted control and reports progress through a status file the full check reads.
function calibrateBlock(m) {
  const ok = (id) => m.items.find((x) => x.id === id)?.level === 'ok';
  const checks = [['TouchDesigner answering', ok('touchdesigner')], ['both rope boxes answering', ok('rope box 1') && ok('rope box 2')], ['the gallery camera reachable', ok('gallery camera')]];
  const failing = checks.find(([, v]) => !v);
  const c = S.calib;
  let body;
  if (c && !c.done) {
    body = `<div class="ctl-h">Calibrating <span class="now">${Math.round((Date.now() - c.started) / 1000)} s · about ${c.minsLeft} min left</span></div>
      <div class="prog"><i style="width:${Math.round(c.frac * 100)}%"></i></div>
      <div>${esc(c.stage)}${c.retakes ? ` · ${c.retakes} retake${c.retakes > 1 ? 's' : ''} (someone walked through)` : ''}</div>
      <div class="row"><button type="button" class="btn danger" data-act="calib-stop">Stop and restore the ropes</button></div>`;
  } else if (c?.done) {
    body = c.stopped ? `<div class="ctl-h">Stopped</div><div>The ropes are back on the river. No map was written.</div><div class="row"><button type="button" class="btn" data-act="calib-dismiss">OK</button></div>`
      : `<div class="ctl-h">Map made ${c.result.when}</div>
      <div>${c.result.found} of 20 ropes found · ropes ${c.result.dark.join(' and ')} not found (dark) · ${c.result.seen.toLocaleString()} LEDs seen, the rest placed along the rope · camera drift ${c.result.drift} (fine) · panel quad 1 found.</div>
      <div>The ropes are back on the river. The show file still uses the old map until it is rebuilt.</div>
      <div class="row"><button type="button" class="btn primary" data-act="calib-rebuild">Use this map: rebuild the show file</button><button type="button" class="btn" data-act="calib-dismiss">Keep the old map</button></div>${ctlResult('calib')}`;
  } else {
    body = `<div>Finds where every LED and the panels are, using the gallery camera. The ropes flash black-and-white patterns for about five minutes (the show is interrupted) and come back by themselves.</div>
      <ul>${checks.map(([t, v]) => `<li>${v ? '✓' : '✕'} ${esc(t)}</li>`).join('')}<li>the room dark and nobody in the camera's view (you check)</li></ul>
      <div class="row"><button type="button" class="btn primary" data-act="calib-start" ${failing ? 'disabled' : ''}>Calibrate the lights</button></div>
      ${failing ? `<div class="ctl-why cant">Can't start: ${esc(failing[0].replace(/answering|reachable/, (w) => (w === 'answering' ? "isn't answering" : "isn't reachable")))}.</div>` : ''}`;
  }
  return `<div class="calib"><div class="ctl-h">🛠 Calibrate the lights <span class="now">installer</span></div>${body}</div>`;
}
const CALIB_STAGES = [['Checking the camera', 2], ['Settling', 2], ['Pass A', 29], ['Pass B', 29], ['Retaking 2 patterns', 3], ['Restoring the show', 2], ['Decoding', 3], ['Finding the panels', 2]];
function calibTick() {
  const c = S.calib; if (!c || c.done) return;
  c.step++;
  let acc = 0, total = CALIB_STAGES.reduce((s, [, n]) => s + n, 0);
  for (const [name, n] of CALIB_STAGES) {
    if (c.step < acc + n) { const i = c.step - acc + 1; c.stage = /Pass/.test(name) ? `${name}: pattern ${i} of ${n}` : name; if (name.startsWith('Retaking')) c.retakes = 2; break; }
    acc += n;
  }
  c.frac = Math.min(1, c.step / total); c.minsLeft = Math.max(1, Math.ceil((total - c.step) * 0.4 / 60 * 10));   // the real run takes about 5 min; this demo about 30 s
  if (c.step >= total) { c.done = true; clearInterval(c.timer); c.result = { when: `today ${clock(Date.now())}`, found: 18, dark: [9, 17], seen: 2103, drift: 13 }; }
  renderSheet(true); if (S.model) renderBand(S.model);
}

// ---- the details sheet ---------------------------------------------------------------------------------------------
function openSheet(id, itemId) { S.sheet = id; S.sheetHtml = ''; renderSheet(true); $('#sheetWrap').hidden = false; $('#sheet').scrollTop = 0; if (itemId) $('#sheet').querySelector(`[data-item-row="${itemId}"]`)?.scrollIntoView({ block: 'center' }); }
function closeSheet() { S.sheet = null; $('#sheetWrap').hidden = true; }
function renderSheet(force) {
  const m = S.model, box = BOXES.find((b) => b.id === S.sheet);
  if (!box) return;
  const its = m ? boxItems(m, box) : [], worst = worstOf(its), lvl = worst?.level ?? 'unknown';
  let html = `<div class="grab"></div><div class="sheet-h"><h2>${esc(box.name)}</h2><span class="lvl-${lvl}"><span class="chip"><i class="mark" aria-hidden="true">${MARKS[lvl]}</i>${WORDS[lvl]}</span></span>
    <button type="button" class="iconbtn close" data-act="close" aria-label="Close">×</button></div><p class="lead">${esc(box.lead)}</p>`;
  html += '<div class="items">' + its.map((it) => `<div class="irow ${it.muted ? 'muted' : ''}" data-item-row="${esc(it.id)}"><div class="top-line"><i class="mark m-${it.level}" aria-hidden="true">${MARKS[it.level]}</i><span>${esc(it.name)}</span><span class="word w-${it.level}">${WORDS[it.level]}</span></div>
    <div class="summary">${esc(it.summary)}</div>${it.detail ? `<div class="detail">${esc(it.detail)}</div>` : ''}
    ${it.action ? `<div class="action"><span class="todo-k">What to do</span>${esc(it.action)}</div>` : ''}
    <div class="from ${it.stale ? 'stale' : ''}">from ${FROM[it.checked_from]}${it.age_s != null ? ` · ${dur(it.age_s)} ago` : ''}${it.stale ? ' · stale: older than it should be' : ''}</div></div>`).join('') + '</div>';
  if (m) {
    const ctls = [];
    if (box.id === 'ropes') { ctls.push(ropesControls(m)); ctls.push(`<p class="sub">Lighting network port: ${m.show.ropes.route === 'direct' ? "bitcube's LIGHTS port (white)" : m.show.ropes.route === 'router' ? 'the router port (fallback)' : 'not known'} · change it under Installer settings on the Status page.</p>`); ctls.push(calibrateBlock(m)); }
    if (box.id === 'panels') ctls.push(panelsControls(m));
    if (box.id === 'bitcube') { ctls.push(yearControls(m)); ctls.push(showFileControls(m)); ctls.push(`<div class="row"><button type="button" class="btn" data-act="check-now">Check now</button><span class="sub" style="align-self:center">bitcube is checked every 5 s, in full about once a minute.</span></div>`); }
    if (box.id === 'gallery') ctls.push(S.still.url ? `<img class="still" src="${S.still.url}" alt="The gallery camera's latest still"><p class="sub">${S.still.at ? `Taken ${dur(Math.max(0, (Date.now() - S.still.at) / 1000))} ago` : ''}${S.still.err ? ` · no newer picture: ${esc(S.still.err)}` : ''}</p>` : `<p class="sub">No picture: ${esc(S.still.err ?? 'not fetched yet')}.</p>`);
    if (box.id === 'river') ctls.push(`<p class="sub">${esc(cap(m.show.river.words))}.</p>`);
    if (box.id === 'dave') ctls.push(`<p class="sub">${m.show.scene ? `Scene: ${esc(m.show.scene.words)}. ` : ''}${m.show.file ? (m.show.file.kind === 'live' ? "Tonight's file (the live river) shows the scene on the panels." : "Tonight's file (the river's year) doesn't use the scene; the room is unaffected by the agent.") : ''}${m.show.modal ? ` Mood ${esc(m.show.modal.mood ?? '?')}, tick ${m.show.modal.tick ?? '?'}${m.show.modal.resting ? ', resting overnight' : ''}.` : ''}</p>`);
    if (ctls.length) html += `<div class="ctls">${ctls.join('')}</div>`;
    const addr = its.map((it) => `<div>${esc(it.name)}: ${esc(it.address ?? 'no address')} · checked from ${FROM[it.checked_from]}</div>`).join('');
    const raw = Object.entries(m.sources).filter(([k, s]) => s.error && ((box.id === 'bitcube' && k !== 'modal') || (box.id === 'dave' && k === 'modal'))).map(([k, s]) => `<div>raw ${k}: ${esc(s.error)}</div>`).join('');
    const links = { bitcube: `<a href="/map/">Show on the system map</a> · <a href="${DOCS}show-files.html" target="_blank" rel="noopener">The show files</a>`, ropes: `<a href="${DOCS}install.html" target="_blank" rel="noopener">Install guide</a> · <a href="/map/">System map</a>`,
      panels: `<a href="${DOCS}install.html" target="_blank" rel="noopener">Install guide</a>`, internet: `<a href="${DOCS}ceiling.html" target="_blank" rel="noopener">The ceiling page</a> · <a href="/map/">System map</a>`, gallery: `<a href="/map/">System map</a>`, river: `<a href="/map/">System map</a>`, dave: `<a href="/map/">System map</a>` };
    html += `<details class="will"><summary>Addresses and links (for Will)</summary><div class="addr">${addr}${raw}<div>${links[box.id] ?? ''}</div></div></details>`;
  }
  if (force || html !== S.sheetHtml) { $('#sheet').innerHTML = html; S.sheetHtml = html; }
}

// ---- confirm ------------------------------------------------------------------------------------------------------
function confirmBox({ title, body, yes, no = 'Not now', danger = true }) {
  return new Promise((resolve) => {
    const wrap = $('#confirmWrap'), box = $('#confirm');
    box.innerHTML = `<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row"><button type="button" class="btn" data-c="no">${esc(no)}</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-c="yes">${esc(yes)}</button></div>`;
    wrap.hidden = false;
    const done = (v) => { wrap.hidden = true; box.innerHTML = ''; resolve(v); };
    box.querySelector('[data-c="yes"]').onclick = () => done(true);
    box.querySelector('[data-c="no"]').onclick = () => done(false);
    wrap.onclick = (e) => { if (e.target === wrap) done(false); };
    box.querySelector('[data-c="no"]').focus();
  });
}

async function control(key, [action, body], { confirm: c, done }) {
  if (c && !(await confirmBox({ danger: true, ...c }))) return;
  S.pending[key] = { state: 'sending', text: 'Sending to bitcube… (the controls wait for its answer)', at: Date.now() };
  renderSheet(true); if (S.model) renderInstaller(S.model);
  try {
    const r = await api(`/api/control/${action}`, body);
    if (r && r.ok === false) throw new Error(r.error || 'bitcube said no');      // the real server answers 200 with ok:false when the probe fails
    const text = typeof done === 'function' ? done(r) : done;
    S.pending[key] = { state: 'done', text: `${text}${/\bsince\b/.test(text) ? '' : ` · ${clock(Date.now())}`}${r?.fixture ? ' (fixture mode: nothing was really changed)' : ''}`, at: Date.now() };
    poll();
  } catch (e) {
    if (e.message === 'logged out') return;
    S.pending[key] = { state: 'failed', text: `bitcube didn't answer (${e.message}). Nothing changed: try again, or look at bitcube in the chain.`, at: Date.now() };
  }
  renderSheet(true); if (S.model) renderInstaller(S.model);
}

// ---- menu -------------------------------------------------------------------------------------------------------------
async function openMenu() {
  $('#menuWrap').hidden = false; renderMenu();
  if (S.last?.fixture && !S.scenarios) { try { S.scenarios = (await api('/fixtures')).scenarios; renderMenu(); } catch { /* not fixture mode */ } }
}
function renderMenu() {
  const t = themeSetting();
  $('#menu').innerHTML = `<div class="grab"></div><div class="sheet-h"><h2>Mission control</h2><button type="button" class="iconbtn close" data-act="close-menu" aria-label="Close">×</button></div>
    <div class="sec">Theme</div><div class="seg">${['auto', 'light', 'dark'].map((x) => `<button type="button" class="btn ${t === x ? 'lit' : ''}" data-act="theme" data-arg="${x}">${cap(x)}${x === 'auto' ? ' (phone)' : ''}</button>`).join('')}</div>
    <div class="sec">Checks</div><div class="row"><button type="button" class="btn" data-act="check-now">Check now</button></div>
    <p class="sub">Mission control checks bitcube every 5 s and runs a full check about once a minute; Check now fetches the latest answer again.</p>
    <div class="sec">Who to call</div><div class="people">${(M.CONTACTS ? Object.values(M.CONTACTS).map((c) => [c.name, c.owns]) : Object.entries(PEOPLE)).map(([n, w]) => `<div><b>${esc(n)}</b>: ${esc(w)}</div>`).join('')}</div>
    <p class="sub">Numbers are on the contacts sheet on the Mac mini, never on this page.</p>
    ${S.last?.fixture ? `<div class="sec">Scenario (fixture mode)</div><select id="scenarioSel" aria-label="Scenario">${(S.scenarios ?? [{ name: S.last.fixture, title: S.last.fixture }]).map((s) => `<option value="${esc(s.name)}" ${s.name === S.last.fixture ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select>` : ''}
    <div class="sec">Session</div><div class="row"><button type="button" class="btn danger" data-act="logout">Log out</button><a class="btn" href="/status">Old pages</a></div>`;
  const sel = $('#scenarioSel');
  if (sel) sel.onchange = () => { document.cookie = `scenario=${sel.value}; Path=/; SameSite=Lax`; location.reload(); };
}

// ---- actions ------------------------------------------------------------------------------------------------------------
async function doAction(act, arg, el) {
  switch (act) {
    case 'open': return openSheet(arg, el?.dataset.item);
    case 'close': return closeSheet();
    case 'close-menu': $('#menuWrap').hidden = true; return;
    case 'detail': S.detailOpen = !S.detailOpen; S.bandHtml = ''; if (S.model) renderBand(S.model); return;
    case 'theme': try { localStorage.setItem('mc-theme', arg); } catch { /* fine */ } applyTheme(); renderMenu(); return;
    case 'check-now': S.checking = true; renderFresh(); await Promise.all([poll(), pollLights(), pollStill()]); S.checking = false; renderFresh(); return;
    case 'logout': if (await confirmBox({ title: 'Log out?', body: 'You will need the team password to get back in.', yes: 'Log out' })) { await fetch('/logout', { method: 'POST' }); location.href = '/login'; } return;
    case 'ropes-on': return control('ropes', ['ropes', { dark: false }], { done: 'The ropes are showing the river again; they follow within a few seconds' });
    case 'ropes-dark': return control('ropes', ['ropes', { dark: true }], { confirm: { title: 'Make the ropes dark?', body: 'All 20 ropes in the gallery go black now and stay black until someone presses Showing the river. The panels keep showing the river.', yes: 'Go dark', no: 'Keep showing the river' }, done: () => `Dark since ${clock(Date.now())}` });
    case 'hub-dec': S.draft.hub = Math.max(0, S.draft.hub - 10); return renderSheet(true);
    case 'hub-inc': S.draft.hub = Math.min(100, S.draft.hub + 10); return renderSheet(true);
    case 'hub-set': if (S.draft.hub === 0) return doAction('hub-off'); return control('hub75', ['hub75', { brightness: S.draft.hub / 100 }], { done: `Panel brightness set to ${S.draft.hub} %` });
    case 'hub-off': return control('hub75', ['hub75', { brightness: 0 }], { confirm: { title: 'Switch the panels off?', body: 'The HUB75 panels go dark now (brightness 0) until someone sets a brightness again. The ropes keep showing the river.', yes: 'Panels off' }, done: () => { S.draft.hub = 0; return 'Panels off (brightness 0)'; } });
    case 'mode': return control('year', ['mode', { mode: arg }], { done: `Mode set to ${arg}` });
    case 'target-season': return control('year', ['target', { season: arg }], { done: `Heading for ${arg}, set by hand (manual)` });
    case 'int-dec': S.draft.int = Math.max(0, Math.round((S.draft.int - 0.05) * 100) / 100); return renderSheet(true);
    case 'int-inc': S.draft.int = Math.min(1, Math.round((S.draft.int + 0.05) * 100) / 100); return renderSheet(true);
    case 'target-int': return control('year', ['target', { intensity: S.draft.int }], { done: `Target intensity ${S.draft.int.toFixed(2)}, set by hand (manual)` });
    case 'switch': return control('switch', ['switch', { file: arg }], { confirm: { title: `Switch to ${fileLabel(arg)} now?`, body: 'Restarts TouchDesigner on that file. The lights go dark for about a minute, and unsaved changes in TouchDesigner are lost.', yes: 'Switch now' }, done: `Restarting TouchDesigner on ${fileLabel(arg)}: about a minute dark` });
    case 'bootfile': return control('bootfile', ['bootfile', { file: arg }], { confirm: { title: `Open ${fileLabel(arg)} at boot?`, body: 'From the next restart of bitcube, TouchDesigner opens this file. Nothing changes now.', yes: 'Set boot file', danger: false }, done: `${cap(fileLabel(arg))} opens at the next boot` });
    case 'route': return control('lightsroute', ['lightsroute', { route: arg }], { confirm: { title: arg === 'direct' ? "Lights on bitcube's LIGHTS port?" : 'Lights on the router port?', body: arg === 'direct' ? 'Moves the lighting address to the white LIGHTS port. If the lighting switch is not plugged into it, all 20 ropes go dark.' : 'Moves the lighting address to the router port, the fallback. If the lighting switch is not plugged into the router, all 20 ropes go dark.', yes: 'Move it' }, done: `Lighting network on ${arg === 'direct' ? "bitcube's LIGHTS port" : 'the router port'}` });
    case 'calib-start': if (await confirmBox({ title: 'Start calibration?', body: "The ropes go into patterns now, for about five minutes, and the show stops meanwhile. Keep people out of the camera's view.", yes: 'Start' })) {
      S.calib = { started: Date.now(), step: -1, stage: 'Checking the camera', frac: 0, minsLeft: 5, retakes: 0, done: false }; S.calib.timer = setInterval(calibTick, 400); calibTick(); } return;
    case 'calib-stop': if (S.calib) { clearInterval(S.calib.timer); S.calib = { done: true, stopped: true }; renderSheet(true); if (S.model) renderBand(S.model); } return;
    case 'calib-dismiss': S.calib = null; renderSheet(true); return;
    case 'calib-rebuild': return control('calib', ['switch', { file: 'river-local-oct-22-seasons.toe' }], { confirm: { title: 'Rebuild the show file with this map?', body: "Bakes the new LED map into the river's year and restarts TouchDesigner on it: the lights go dark for about a minute.", yes: 'Rebuild' }, done: 'Rebuilding the show file with the new map: about a minute dark' });
  }
}

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) { e.preventDefault(); doAction(act.dataset.act, act.dataset.arg, act).catch((err) => console.error(err)); return; }
  const box = e.target.closest('[data-box]');
  if (box) { openSheet(box.dataset.box); return; }
  if (e.target === $('#sheetWrap')) closeSheet();
  if (e.target === $('#menuWrap')) $('#menuWrap').hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); $('#menuWrap').hidden = true; } });
$('#menuBtn').addEventListener('click', openMenu);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---- go --------------------------------------------------------------------------------------------------------------
applyTheme();
poll(); pollLights(); pollStill();
setInterval(poll, POLL_MS);
setInterval(() => { if (!document.hidden) pollLights(); }, LIGHTS_MS);
setInterval(pollStill, STILL_MS);
setInterval(() => { renderFresh(); if (S.model) { renderLightsCaption(); renderRoom(); } }, 1000);
