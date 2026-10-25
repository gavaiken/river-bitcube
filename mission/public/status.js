// Mission control v2: the Status page (docs/mission-ui.md, "Status"). One big answer, then drill down: the lost-contact
// banner, the verdict band, the piece now (season, ropes, panels, the room), Not OK grouped by cause, the fine list,
// the installer. Every verdict, state word, control reason and sentence comes from model.js's derive(); this file only
// lays it out. The shell (ui.js) owns the art, the header, the tab bar, the menu and the sheets. Plain ES module.
import * as M from '/model.js';
import { mountShell, poll, tick, watchContact, focusKey, refocus, art, fmt, confirm, sheet, api, plainError, noAnswerText, esc, goto, mark, chip, WORD, MARK,
  NAMES_FROM_BITCUBE, sinceAgrees as sinceAgreesWith, splitHeadline, WARN_MS, LOST_MS } from '/ui.js';

const { derive, dur, POLL_S, PAGE_STALE_S, FILES, contactFor, CONTACTS } = M;
const $ = (sel, root = document) => root.querySelector(sel);
const FROM = { mini: 'the Mac mini', bitcube: 'bitcube', modal: "Dave's agent" };
// One name per thing (the copy rules); descriptors live on the card, never in the name.
const NAME = { bitcube: 'bitcube', touchdesigner: 'TouchDesigner', seasons: "The river's year", ropes: 'Ropes',
  'rope box 1': 'Rope box 1 (ropes 1–10)', 'rope box 2': 'Rope box 2 (ropes 11–20)', 'hub75 panels': 'Panels',
  'gallery camera': 'Gallery camera', 'river camera': 'River camera', router: 'Router', internet: 'Internet at Gray Area',
  'modal agent': "Dave's agent", 'modal link': 'Clips to Dave', recorder: 'River recorder', 'people counter': 'People counter',
  'mission control': 'Mission control' };
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const INTENSITY = ['stillness', 'trickle', 'flowing', 'strong', 'torrent'];
const STILL_MS = 30_000, OLD_S = 120;
const LINKS = { bitcube: [["See bitcube's screen (needs Tailscale)", 'vnc://100.73.68.60']],
  seasons: [["The river's year page (needs Tailscale)", 'http://100.73.68.60:9981/']],
  router: [['Router admin (from the gallery Wi-Fi)', 'http://192.168.9.1/']],
  'modal agent': [["Dave's app", 'https://to-be-a-river--river.modal.run/']] };
// The tiles' state words, from the model's ropes/panels state ids.
// Short "what they own" for the Call line (the menu's Who to call has the full version).
const OWNS = { gavin: 'bitcube and the show file', lilian: 'the lights and the rigging', andi: 'the panels', will: 'network and cameras', dave: 'his agent', colin: 'how the piece should look' };
const ROPES_STATE = { river: 'Showing the river', dark: 'Dark on purpose', 'not-reaching': 'Not getting the river', unknown: 'Not known' };
const PANELS_STATE = { unknown: 'Not known', 'no-sender': 'No panel sender', restarting: 'Dark while restarting', frozen: 'Picture frozen',
  gone: 'Nothing drawn', 'no-output': 'No panel output', off: 'Switched off', river: 'Showing the river' };
// What a recorded action reads as on the band's "Last done" line (never a name: the source is a place).
const ACTION_WORDS = {
  ropes: (b) => `Ropes → ${b?.dark ? 'Dark' : 'On'}`, hub75: (b) => `Panels → ${b?.brightness != null ? fmt.pct(b.brightness) : 'set'}`,
  switch: (b) => `Switch to ${FILES[b?.file]?.label ?? b?.file ?? 'a show file'}`, mode: (b) => `Mode → ${cap(b?.mode ?? '')}`,
  target: (b) => `Target → ${b?.season ?? ''}${b?.intensity != null ? `, ${M.intensityWord(b.intensity)}` : ''}`,
  rules: () => 'Rules applied', 'rules-reset': () => 'Rules reset', bootfile: (b) => `Boot file → ${FILES[b?.file]?.label ?? b?.file ?? ''}`,
  lightsroute: (b) => `Lighting port → ${b?.route === 'direct' ? "bitcube's LIGHTS port" : b?.route === 'router' ? 'the router port' : b?.route ?? ''}`,
  check: () => 'Full check of bitcube', calibrate: (b) => `Calibration ${b?.action === 'cancel' ? 'stopped' : b?.action === 'start' ? 'started' : 'looked at'}`,
  rebuild: () => "Rebuilt the river's year with the new LED map",
};

// ---- state ------------------------------------------------------------------------------------------------------
let model = null;
const openRows = new Set();   // expanded rows, kept across re-renders
const ctl = {};               // control feedback: name -> { state: 'pending' | 'done' | 'failed', text }
const stillTried = { gallery: 0, river: 0 }, stillBusy = { gallery: false, river: false };   // Date.now() of the last try; one at a time
const stills = { gallery: { url: null, age_s: null, fetchedAt: null, missing: null }, river: { url: null, age_s: null, fetchedAt: null, missing: null } };
const lastHTML = new Map();   // section -> the HTML it holds (no churn when nothing changed)
let hubDraft = null;          // the brightness stepper, before "Set"
const targetDraft = { season: null, intensity: null };
const rulesDraft = {};        // what was typed into the rules form, kept across re-renders and a failed Apply
let riverWatch = null;
let tels = {};                // contact key -> tel, from GET /api/contacts (never in the repo)
let checkState = null;        // "Check now": { state, text }

// ---- helpers -------------------------------------------------------------------------------------------------------
function cap(s) { return s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s ?? ''; }
const nb = fmt.nb;
const rid = (id) => 'r-' + id.replace(/\s+/g, '-');
const elapsedS = () => (p.last ? p.elapsed() / 1000 : 0);
const pend = (name) => ctl[name]?.state === 'pending';
const op = (id) => (openRows.has(id) ? ' open' : '');   // rendered into the markup: a replaced section keeps its height
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const fileLabel = (f) => FILES[f]?.label ?? f;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const item = (m, id) => m.items.find((x) => x.id === id);
/** Contact with mission control is lost (the model's 'page' problem, whatever else outranks it in the headline). */
const lostContact = (m) => !!m && m.problems.some((x) => x.id === 'page');
/** An age rendered from the server's age alone; refreshAges() adds the seconds since the answer every second. */
const ageSpan = (age) => `<span class="age" data-age="${age ?? ''}">${age == null ? 'age not known' : `${dur(age)} ago`}</span>`;
/** "Down for 9 min" from the server's history (since.items[id]), only when it agrees with the model's level. */
function sinceSpan(id, level, texts = [], x = null) {
  const s = p.last?.since?.items?.[id];
  if (!s || s.level !== level || s.for_s == null || !sinceAgrees(s, texts, NAMES_FROM_BITCUBE.has(id))) return '';
  const pre = `${WORD[level]} for ${s.at_least ? 'over ' : ''}`;
  // a last answer (contact lost, or its source is old): only what was seen holds, so the since stops where the item was last
  // seen and never ticks on ("Down for over 24 min when last seen", not a growing duration nobody observed)
  if (x?.stale) {
    const seen = s.for_s - (x.age_s ?? 0);
    return seen > 0 ? ` · <span class="since">${esc(pre)}${dur(seen)} when last seen</span>` : '';
  }
  return ` · <span class="since" data-for="${s.for_s}" data-pre="${esc(pre)}">${esc(pre)}${dur(s.for_s)}</span>`;
}
/** The shared rule (ui.js sinceAgrees), with this model's uptime. */
const sinceAgrees = (s, texts, behindBitcube) => sinceAgreesWith(s, texts, behindBitcube, model?.show.uptime_s);
// Volatile attributes: values that change between answers without the row changing. When only these differ, the
// existing elements are patched in place instead of re-created, so a row under a thumb stays put.
const VOL = /\b(data-(?:age|for|next))="[^"]*"/g;
function setHTML(el, html) {
  const prev = lastHTML.get(el);
  if (prev === html) return;
  lastHTML.set(el, html);
  if (prev != null && prev.replace(VOL, '$1=""') === html.replace(VOL, '$1=""')) {
    const vals = [...html.matchAll(VOL)];
    const els = el.querySelectorAll('[data-age],[data-for],[data-next]');
    if (els.length === vals.length) {
      els.forEach((e, i) => { const [, name] = vals[i]; e.setAttribute(name, vals[i][0].slice(name.length + 2, -1)); });
      refreshAges(el);
      return;
    }
  }
  // a control under the user's finger or keyboard focus keeps the focus across the re-render (found again by its data-*)
  const active = document.activeElement, had = active && active !== document.body && el.contains(active);
  const key = had ? focusKey(active) : null, ctlName = had ? active.closest('[data-ctl]')?.dataset.ctl : null;
  el.innerHTML = html;
  el.querySelectorAll('details[data-id]').forEach((d) => { d.open = openRows.has(d.dataset.id); });
  refreshAges(el);
  if (had) refocus(key, el, ctlName ? el.querySelector(`[data-ctl="${ctlName}"] .ctl-status`) : null);
}
/** Every age on the page, as of this second: the server's age plus the seconds since its answer. */
function refreshAges(root = document) {
  const el = elapsedS();
  root.querySelectorAll('[data-age]').forEach((s) => {
    const a = s.dataset.age === '' ? null : Number(s.dataset.age);
    s.textContent = a == null ? 'age not known' : nb(`${dur(a + el)} ago`);
    s.classList.toggle('old', a != null && a + el > OLD_S);
  });
  root.querySelectorAll('[data-for]').forEach((s) => { s.textContent = nb(`${s.dataset.pre}${dur(Number(s.dataset.for) + el)}`); });
  root.querySelectorAll('[data-next]').forEach((s) => {
    const pa = Number(s.dataset.next) + el, next = clamp(POLL_S.probe - pa, 0, POLL_S.probe);
    s.textContent = next > 0 ? nb(` · next in about ${dur(next)}`) : ' · checking again any moment';
  });
  root.querySelectorAll('[data-still]').forEach((s) => {
    const a = stillAge(s.dataset.still);
    if (a != null) s.textContent = nb(`${dur(a)} ago`);
  });
}
/** A still's age now: its age when fetched plus the time since, by the larger of the monotonic and the wall clock (a phone
 *  that slept never shows an hour-old picture as seconds old). */
const stillAge = (cam) => { const s = stills[cam]; return s.age_s == null ? null : s.age_s + Math.max((performance.now() - s.fetchedAt) / 1000, s.fetchedWall != null ? (Date.now() - s.fetchedWall) / 1000 : 0, 0); };

// ---- the shell and the poll ------------------------------------------------------------------------------------------
const shell = mountShell({ page: 'status', title: 'Status' });
const p = poll('/api/status', { every: 5000,
  onData: () => {
    shell.setAge(0); shell.setStale(null); render();
    // contact is back (a phone waking with no network missed the wake-up fetch): a picture older than its interval is fetched now
    if (Date.now() - stillTried.gallery > STILL_MS) fetchStill('gallery');
  },
  onError: () => render() });   // before any answer, watchContact's header says "No answer yet · N s" from the first try
document.addEventListener('mc:check', () => p.refresh());
document.addEventListener('mc:theme', () => render());
// the shared rule (ui.js): from the time since the last answer, so a hung request greys the page as surely as an error
watchContact(p, shell, () => render());
tick(() => refreshAges());
fetch('/api/contacts', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
  const list = Array.isArray(j?.contacts) ? j.contacts : j?.contacts && typeof j.contacts === 'object' ? Object.entries(j.contacts).map(([k, v]) => ({ key: k, ...(typeof v === 'string' ? { tel: v } : v) })) : [];
  for (const c of list) if (c.tel && (c.key || c.name)) tels[String(c.key ?? c.name).toLowerCase()] = String(c.tel);
  render();
}).catch(() => {});

// ---- stills ----------------------------------------------------------------------------------------------------------
async function fetchStill(cam) {
  if (stillBusy[cam]) return;
  stillBusy[cam] = true; stillTried[cam] = Date.now();
  const s = stills[cam];
  try {
    const r = await fetch(`/api/camera/${cam}.jpg`, { cache: 'no-store' });
    if (r.status === 401) return;
    if (!r.ok) { if (s.url) URL.revokeObjectURL(s.url); stills[cam] = { url: null, age_s: null, fetchedAt: null, missing: true }; }
    else {
      const blob = await r.blob();
      const hdr = Number(r.headers.get('x-age-s'));
      const taken = Date.parse(r.headers.get('x-taken') || '');
      const age_s = Number.isFinite(hdr) ? hdr : Number.isFinite(taken) ? Math.max(0, (Date.now() - taken) / 1000) : 0;
      if (s.url) URL.revokeObjectURL(s.url);
      stills[cam] = { url: URL.createObjectURL(blob), age_s, fetchedAt: performance.now(), fetchedWall: Date.now(), missing: false };
      // the room's sheet, if open, shows the new picture too: its "Taken N s ago" (data-still) follows the newest still
      const big = cam === 'gallery' ? document.querySelector('dialog.sheet[open] img.still-img') : null;
      if (big) big.src = stills[cam].url;
    }
  } catch { stills[cam] = { ...s, missing: s.url ? s.missing : true }; }
  finally { stillBusy[cam] = false; }
  render();
}

// ---- rendering ----------------------------------------------------------------------------------------------------------
function render() {
  model = p.last ? derive(p.last, p.last.now + p.elapsed()) : null;
  const m = model;
  art.setSeason(m?.show.weights ?? null);
  const pageStale = lostContact(m);
  const banner = $('#banner');
  banner.hidden = !pageStale;
  banner.className = pageStale ? 'banner lv-unknown' : '';
  setHTML(banner, pageStale ? bannerHTML(m) : '');
  const band = $('#band');
  band.className = `band lv-${m ? m.overall.level : 'unknown'}`;
  setHTML(band, m ? bandHTML(m) : connectingHTML());
  // screen readers hear the level and the headline when they change, never the ticking ages
  const said = m ? `${WORD[m.overall.level]}. ${m.overall.headline.replace(/\s*\(no answer for [^()]*\)$/, '')}.` : (performance.now() - p.startedAt > LOST_MS ? "This page can't reach mission control." : '');
  const live = $('#band-live');
  if (live && live.textContent !== said) live.textContent = said;
  $('.card.now').hidden = !m;
  setHTML($('#now-head'), m ? nowHTML(m) : '');
  setHTML($('#now-steer'), m ? steerHTML(m) : '');
  setHTML($('#problems'), m ? problemsHTML(m) : '');
  setHTML($('#fine'), m ? fineHTML(m) : '');
  setHTML($('#installer'), m ? installerHTML(m) : '');
  // a confirm still open for a control that became impossible (bitcube went offline, contact lost, a calibration began)
  if (asking && !m?.controls[asking.name]?.possible) {
    const { name, pr } = asking, w = m?.controls[name]?.why ?? "this page can't reach mission control";
    asking = null;
    ctl[name] = { state: 'failed', text: `Not sent: ${w} (${fmt.clock(Date.now())}).` };
    announce(ctl[name].text);
    pr.close();
    render();
  }
}

function bannerHTML(m) {
  const age = m.overall.checked.page_age_s;
  return `${mark('unknown')}<div><b>No contact with mission control for <span data-for="0" data-pre="">${dur(age)}</span>.</b> Everything below is as it was at ${fmt.clock(p.last.now, p.last.now)}; the controls are off until it answers.</div>`;
}
function connectingHTML() {
  // the header's thresholds (ui.js WARN_MS, LOST_MS), counted from the first try, so a hung request counts too:
  // "Connecting…" under 12 s, "No answer yet · N s" to 30 s, then this page can't reach mission control
  const downMs = performance.now() - p.startedAt, dead = downMs > LOST_MS, slow = downMs > WARN_MS;
  const downFor = downMs / 1000;
  return `<div class="chip-row">${chip('unknown')}</div>
    <h1>${dead ? "This page can't reach mission control" : slow ? 'No answer from mission control yet' : 'Connecting to mission control…'}</h1>
    <p class="detail">${dead ? `No answer for ${nb(dur(downFor))}. Nothing about the show is known from here.` : slow ? `Waiting ${nb(dur(downFor))} so far; it usually answers in a second or two.` : 'The first answer takes a second or two.'}</p>
    ${dead ? `<div class="todo"><div class="label">What to do</div><div class="action">Check your connection. If other sites load, the Mac mini may be down or off its network.</div></div>${callLine('page')}` : ''}`;
}

// The band: chip · since · cause / consequence · detail · checked-from + Check now · WHAT TO DO · jump · Call · Also · last done.
function bandHTML(m) {
  const o = m.overall, lv = o.level;
  const [big, rest] = splitHeadline(o.headline);
  const so = p.last.since?.overall;
  const behind = !['page', 'bitcube-offline', 'bitcube-unchecked', 'modal-unreachable', 'modal-stalled', 'modal-not-ok', 'modal-stale', 'not-checked'].includes(o.cause);
  const since = lv !== 'ok' && so && so.level === lv && so.cause === o.cause && so.for_s != null && sinceAgrees(so, [o.headline, o.detail], behind)
    ? `<span class="since" data-for="${so.for_s}" data-pre="for ${so.at_least ? 'over ' : ''}">for ${so.at_least ? 'over ' : ''}${dur(so.for_s)}</span>` : '';
  const todo = o.action
    ? `<div class="todo${lv === 'unknown' ? ' quiet' : ''}"><div class="label">What to do</div><div class="action">${esc(nb(o.action))}</div></div>${jumpButtons(o, m)}<div class="call-row">${callLine(o.cause)}</div>`
    : '<p class="nothing">Nothing to do.</p>';
  const others = m.problems.filter((x) => x.id !== o.cause);
  const also = others.length ? `<div class="also"><div class="label">Also</div>${others.map((x) =>
    `<button type="button" class="also-item lv-${x.level}" data-act="goto" data-target="g-${esc(x.id)}">${mark(x.level)}<span><span class="sr-only">${WORD[x.level]}: </span>${esc(splitHeadline(x.headline)[0])}</span><span class="chev" aria-hidden="true">›</span></button>`).join('')}</div>` : '';
  const staleNote = lostContact(m) ? '' : o.stale && lv !== 'unknown' ? `<p class="stale-note">Some of this is older than it should be: ${esc(staleWords(m))}.</p>` : '';
  return `<div class="chip-row">${chip(lv)}${since}</div>
    <h1>${esc(nb(big))}</h1>${o.cause === 'page' ? `<p class="rest">No answer for <span data-for="0" data-pre="">${dur(elapsedS())}</span></p>` : rest ? `<p class="rest">${esc(nb(cap(rest)))}</p>` : ''}
    <p class="detail">${esc(nb(o.detail))}</p>${staleNote}${checkLine(m)}${todo}${also}${lastDone()}`;   // Check now above WHAT TO DO: on the first screen even in the busiest bands
}
function staleWords(m) {
  const s = m.sources, out = [];
  if (s.bitcube.stale) out.push("bitcube's quick check");
  if (s.probe.stale && s.probe.present) out.push("bitcube's full check");
  if (s.seasons.stale && s.seasons.ok) out.push("the river's year page");
  if (s.modal.stale) out.push("Dave's agent");
  return out.join(', ') || 'a source';
}
/** The jump button, keyed on the cause. */
function jumpButtons(o, m) {
  const c = o.cause, b = [];
  const first = m.problems.find((x) => x.id === c)?.items?.[0];
  if (c === 'ropes-dark') b.push(['Ropes → On', 'goto', rid('ropes')]);
  else if (['td-frozen', 'td-slow', 'td-off', 'online-file', 'old-file', 'river-stale', 'year-page'].includes(c)) b.push([M.yearPress(m.show.file?.kind), 'goto-switch', '']);   // the advice's own words
  else if (['panels-off', 'panels-dark'].includes(c)) b.push(['Panels brightness', 'goto', rid('hub75 panels')]);
  else if (['coming-up', 'not-checked'].includes(c)) b.push(['Open the studio chat', 'href', '/chat']);
  else if (['page', 'bitcube-unchecked', 'probe-stale', 'bitcube-offline', 'check-failed', 'unknown', 'td-unknown'].includes(c)) return '';
  else if (c === 'calibrating') b.push(['Open Lights', 'href', '/lights']);
  else if (first && m.items.some((x) => x.id === first && x.level !== 'ok')) b.push([`Open ${NAME[first] ?? first} →`, 'goto', `g-${c}`]);
  if (!b.length) return '';
  return `<div class="row-btns">${b.map(([l, act, t]) => act === 'href' ? `<a class="btn primary" href="${esc(t)}">${esc(l)}</a>`
    : `<button type="button" class="btn primary" data-act="${act}" data-target="${esc(t)}">${esc(l)}</button>`).join('')}</div>`;
}
/** "Call Lilian (the lights and the rigging)", a tel: link when the number is known; Colin asks; nobody yet waits. */
function callLine(cause) {
  const c = contactFor(cause);
  if (cause === 'calibrating') return '<span class="call">Nothing to call about: this was started on purpose</span>';
  if (!c) return '<span class="call">Nobody to call yet: wait and look again</span>';
  const key = Object.keys(CONTACTS).find((k) => CONTACTS[k] === c) ?? c.name.toLowerCase();
  const owns = cause === 'page' ? 'mission control and the Mac mini' : OWNS[key] ?? c.owns;
  const text = c.name === 'Colin' ? `If unsure, ask ${c.name} (${owns})` : `Call ${c.name} (${owns})`;
  const tel = tels[key];
  return tel ? `<a class="call" href="tel:${esc(tel.replace(/[^\d+]/g, ''))}">${esc(text)}</a>` : `<span class="call">${esc(text)}</span>`;
}
function checkLine(m) {
  const pa = m.overall.checked.probe_age_s, offline = item(m, 'bitcube')?.level === 'down', failed = !m.sources.probe.ok && m.sources.probe.present;
  const txt = offline ? 'No full check while bitcube is offline'
    : pa == null ? "bitcube's full check hasn't answered yet"
    : failed ? `bitcube's full check failed ${ageSpan(pa)}`
    : `Checked from bitcube ${ageSpan(pa)}${m.overall.stale || lostContact(m) ? '' : `<span data-next="${pa}"></span>`}`;
  const off = lostContact(m) || checkState?.state === 'pending';
  const st = checkState ? `<div class="ctl-status ${checkState.state}">${checkState.state === 'pending' ? '<span class="spin" aria-hidden="true"></span>' : ''}<span>${esc(checkState.text)}</span></div>` : '';
  // while bitcube is offline there is no full check to start: the button asks the quick check again, and says so
  const label = checkState?.state === 'pending' ? 'Checking…' : offline ? 'Try bitcube again' : 'Check now';
  return `<div class="check-line"><span>${txt}</span><button type="button" class="btn link" data-act="checknow" ${off ? 'disabled' : ''}>${label}</button></div>${st}`;
}
/** "Last done: Ropes → Dark · 21:04 · from mission control", from the server's history (never a name). */
function lastDone() {
  const a = p.last?.last_action;
  if (!a || typeof a.t !== 'number') return '';
  const what = ACTION_WORDS[a.action]?.(a.body) ?? a.words ?? a.action;
  const when = fmt.clock(a.t);
  return `<div class="last-done">${a.ok === false ? 'Last tried' : 'Last done'}: <b>${esc(what)}</b> · ${esc(when)} · from ${esc(a.source ?? 'mission control')}${a.ok === false && a.note ? ` · failed: ${esc(plainError(a.note))}` : ''}</div>`;
}

// ---- the piece now: season, tiles, the room ----------------------------------------------------------------------------
function nowHTML(m) {
  const s = m.show;
  let head;
  if (s.season) {
    const idx = SEASONS.indexOf(s.season);
    const pos = clamp(s.phase != null ? (((s.phase % 4) + 4) % 4) / 4 * 100 : (idx + 0.5) * 25, 2.5, 97.5);
    const lit = s.intensity ? INTENSITY.indexOf(s.intensity.word) + 1 : 0;
    head = `<div class="season-row"><div class="season-word">${esc(s.season)}</div><div class="mode">${esc(cap(s.mode?.words ?? ''))}</div></div>
      <div class="strip"><span class="w"></span><span class="sp"></span><span class="su"></span><span class="au"></span><span class="marker" style="left:${pos.toFixed(1)}%"></span></div>
      <div class="strip-labels">${SEASONS.map((x) => `<span class="${x === s.season ? 'on' : ''}">${x}</span>`).join('')}</div>
      ${s.intensity ? `<div class="intensity"><span class="lbl">Intensity</span><span class="int-bar">${INTENSITY.map((_, i) => `<i class="${i < lit ? 'on' : ''}"></i>`).join('')}</span><b>${esc(s.intensity.word)}</b></div>` : ''}`;
  } else if (s.file?.kind === 'live' || s.file?.kind === 'other') {
    head = `<div class="season-row"><div class="season-word muted">${s.file.kind === 'live' ? 'The live river' : cap(s.file.label)}, not the river's year</div></div>
      <div class="strip dim"><span class="w"></span><span class="sp"></span><span class="su"></span><span class="au"></span></div>
      <div class="strip-labels">${SEASONS.map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="intensity"><span class="lbl">The river</span><b>${esc(cap(s.river.words))}</b></div>
      <div class="switch-host" id="switch-now">${showfileCtlHTML(m, 'year')}</div>`;
  } else {
    const why = item(m, 'seasons')?.summary ?? 'not known';
    head = `<div class="season-row"><div class="season-word muted">Season not known</div></div>
      <div class="strip dim"><span class="w"></span><span class="sp"></span><span class="su"></span><span class="au"></span></div>
      <div class="strip-labels">${SEASONS.map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="intensity"><b>${esc(why)}</b></div>`;
  }
  return head + `<div class="tiles">${ropesTile(m)}${panelsTile(m)}${roomHTML(m)}</div>`;
}
/** A tile. A last answer (the item is stale: the full check is old, or contact is lost) is never green: the grey mark and
 *  "Last seen N min ago" in place of its second line. */
function tile(id, label, level, state, words, x = null) {
  const stale = !!x?.stale;
  const lv = stale ? 'unknown' : level;
  const second = stale ? `Last seen ${ageSpan(x.age_s)}` : esc(nb(cap(words)));
  return `<button type="button" class="tile lv-${lv}${stale ? ' stale' : ''}" data-act="goto" data-target="${rid(id)}"><span class="eyebrow">${label}</span><span class="tile-h">${mark(lv)}<span class="state">${esc(nb(state))}</span></span><span class="words">${second}</span></button>`;
}
function ropesTile(m) {
  const x = item(m, 'ropes'), r = m.show.ropes;
  const bothDown = item(m, 'rope box 1')?.level === 'down' && item(m, 'rope box 2')?.level === 'down';
  const state = r.state === 'not-reaching' && bothDown ? 'Not connected' : r.state === 'river' && m.show.file?.kind === 'live' ? cap(r.words.replace(/^the ropes show /, 'showing ')) : ROPES_STATE[r.state] ?? 'Not known';
  // the second line adds something the state word doesn't say
  // the power is a measurement: it stays in the row's Power line (copy rules: a number in a summary only when it is the reason)
  const words = r.state === 'dark' ? 'Someone pressed Dark; nothing is broken'
    : r.state === 'river' && x.level === 'ok' ? (m.show.file?.kind === 'live' && !m.show.river.live ? 'No live frames; sender open' : 'Sender open')
    : x.summary;
  return tile('ropes', 'Ropes', x.level, state, words, x);
}
function panelsTile(m) {
  const x = item(m, 'hub75 panels'), pn = m.show.panels;
  // the state word from the model's own words (the river, the live river or the rain fallback), as the Ropes tile does
  const state = pn.state === 'river' ? cap(pn.words.replace(/^the panels show /, 'showing ')) : PANELS_STATE[pn.state] ?? 'Not known';
  return tile('hub75 panels', 'Panels', x.level, state, pn.state === 'river' && x.level === 'ok' ? 'Panel sender connected' : x.summary, x);
}
function roomHTML(m) {
  const g = stills.gallery, cam = item(m, 'gallery camera'), bc = item(m, 'bitcube');
  const age = stillAge('gallery'), pageStale = lostContact(m);
  // the camera's own state from a last answer (an old full check, contact lost) is never green: the grey mark
  if (g.url) return `<div class="still room ${age > OLD_S ? 'old' : ''}" data-act="still" role="button" tabindex="0"><img src="${g.url}" alt="The room: the gallery camera's latest still">
    <div class="cap">${mark(cam.stale ? 'unknown' : cam.level)}<span>Gallery camera · <span class="age" data-still="gallery">${nb(dur(age) + ' ago')}</span>${pageStale ? ' · no newer picture' : age > OLD_S ? ' · old picture' : ''} · tap to enlarge</span></div></div>`;
  const why = g.missing == null ? 'fetching the picture…' : bc.level === 'down' ? 'bitcube is offline, so no picture' : cam.level === 'down' ? "the gallery camera isn't answering"
    : cam.level === 'unknown' ? 'no picture yet' : 'no picture right now';
  return `<div class="still room none lv-${cam.level}"><div class="cap-none">${mark(cam.level)}The room: ${why}</div></div>`;
}

// ---- steer the year (folded) ----------------------------------------------------------------------------------------
function steerHTML(m) {
  const s = m.show, c = m.controls;
  if (!s.season) return '';
  const modeBtn = (id, label) => { const poss = id === 'dynamic' ? c.mode.dynamic.possible : c.mode.possible; const lit = s.mode?.id === id; return `<button type="button" data-act="mode" data-mode="${id}" class="${lit ? 'lit' : ''}" aria-pressed="${lit}" ${poss && !pend('mode') ? '' : 'disabled'}>${label}</button>`; };
  const manual = s.mode?.id === 'manual';
  const tSeason = targetDraft.season ?? s.target?.season ?? null;
  const tInt = targetDraft.intensity ?? s.target?.intensity ?? s.intensity?.value ?? 0.5;
  const tOff = !c.target.possible || !manual || pend('target');
  const modeWhy = c.mode.why ? why(c.mode.why) : c.mode.dynamic.why ? `<div class="effect">Dynamic can't be chosen: ${esc(c.mode.dynamic.why)}.</div>` : '';
  const rules = p.last?.seasons?.value?.rules ? rulesHTML(p.last.seasons.value.rules, c) : '';
  return `<details class="sub" data-id="steer" id="steer"${op('steer')}><summary><span>Steer the year</span><span class="chev" aria-hidden="true">›</span></summary><div class="sub-body">
    <div class="ctl ${c.mode.possible ? '' : 'off'}" data-ctl="mode"><div class="ctl-h">Mode: who steers</div>${modeWhy}
      <div class="seg" role="group" aria-label="Mode">${modeBtn('automatic', 'Automatic')}${modeBtn('dynamic', 'Dynamic')}${modeBtn('manual', 'Manual')}</div>
      <div class="effect">Automatic turns the year by itself, one season a minute. Dynamic lets the people in the room steer it. Manual takes over by hand: the river travels forward to your target.</div>
      ${statusLine('mode')}</div>
    <div class="ctl ${tOff ? 'off' : ''}" data-ctl="target"><div class="ctl-h">Target</div>${!c.target.possible ? why(c.target.why) : ''}
      <div class="target-grid">${SEASONS.map((x) => `<button type="button" class="btn ${tSeason === x ? 'primary' : ''}" data-act="tseason" data-season="${x}" ${tOff ? 'disabled' : ''}>${x}</button>`).join('')}</div>
      <div class="stepper"><button type="button" class="btn step" data-act="tint" data-d="-0.1" ${tOff || tInt <= 0 ? 'disabled' : ''} aria-label="Less intensity">−</button><output aria-label="Target intensity">${esc(M.intensityWord(tInt) ?? '')} (${tInt.toFixed(1)})</output><button type="button" class="btn step" data-act="tint" data-d="0.1" ${tOff || tInt >= 1 ? 'disabled' : ''} aria-label="More intensity">+</button>
        <button type="button" class="btn primary" data-act="target-set" ${tOff || !tSeason ? 'disabled' : ''}>Send target</button></div>
      <div class="effect">${manual ? 'The river travels forward through the calendar to the target; it never jumps. Takes over by hand.' : 'Choose Manual first; the target then steers the river by hand.'}</div>
      ${statusLine('target')}</div>
    ${rules}</div></details>`;
}
/** A rule's label in plain words: "Length of the year (automatic)" → "Length of the year, in Automatic"; "median of the
 *  last" → "the middle value over the last"; never two parentheses or maths. */
function ruleLabel(l) {
  return String(l ?? '').replace(/\s*\((automatic|dynamic|manual)\)/i, (_m, mode) => `, in ${cap(mode.toLowerCase())}`)
    .replace(/\s*=\s*median of the last/i, ' is the middle value over the last').replace(/median of the last/i, 'the middle value over the last')
    .replace(/\s*\(([^()]*)\)\s*$/, ', $1');
}
/** Its range on a muted second line: "60 s to 30 min", "1.05× to 3× usual". */
function ruleRange(r) {
  const u = String(r.unit ?? '').trim();
  if (u === 's') return `${dur(Number(r.min))} to ${dur(Number(r.max))}`;
  const x = u.match(/^×\s*(.*)$/);
  if (x) return `${r.min}× to ${r.max}×${x[1] ? ` ${x[1]}` : ''}`;
  return `${r.min} to ${r.max}${u ? ` ${u}` : ''}`;
}
function rulesHTML(rules, c) {
  const off = !c.rules.possible || pend('rules');
  const rows = Object.entries(rules).map(([k, r]) => `<label class="rule"><span>${esc(ruleLabel(r.label))}<span class="unit">${esc(nb(ruleRange(r)))}</span></span>
    <input type="number" name="${esc(k)}" value="${esc(String(rulesDraft[k] ?? r.value))}" data-server="${esc(String(r.value))}" data-default="${esc(String(r.default))}" min="${esc(String(r.min))}" max="${esc(String(r.max))}" step="any" ${off ? 'disabled' : ''}></label>`).join('');
  return `<details class="sub" data-id="rules" id="rules"${op('rules')}><summary><span>Rules</span><span class="chev" aria-hidden="true">›</span></summary>
    <form class="ctl rules-form ${off ? 'off' : ''}" data-ctl="rules" onsubmit="return false"><div class="ctl-h">The year's rules</div>${c.rules.why ? why(c.rules.why) : ''}<div class="rules">${rows}</div>
    <div class="row-btns"><button type="button" class="btn primary" data-act="rules-apply" ${off ? 'disabled' : ''}>Apply the changed ones</button><button type="button" class="btn" data-act="rules-reset" ${off ? 'disabled' : ''}>Reset all to defaults</button></div>
    <div class="effect">A rule changes the behaviour from now on; it does not move the river. Reset confirms first.</div>
    ${statusLine('rules')}</form></details>`;
}

// ---- Not OK, grouped by cause ------------------------------------------------------------------------------------------
function problemsHTML(m) {
  const bad = m.items.filter((x) => x.level !== 'ok' && !x.muted && x.id !== 'mission control');
  if (!bad.length) return '';
  const placed = new Set();
  const groups = [];
  for (const pr of m.problems) {
    if (pr.id === 'page') continue;
    const its = pr.items.map((id) => item(m, id)).filter((x) => x && x.level !== 'ok' && !x.muted && x.id !== 'mission control' && !placed.has(x.id));
    its.forEach((x) => placed.add(x.id));
    if (its.length) groups.push({ p: pr, its });
  }
  const rest = bad.filter((x) => !placed.has(x.id));
  if (rest.length) groups.push({ p: null, its: rest });
  return '<h2 class="sec">Not OK</h2>' + groups.map((g) => groupHTML(g, m)).join('');
}
function groupHTML({ p: pr, its }, m) {
  const isHeadline = pr && pr.id === m.overall.cause;
  // the level in words for a screen reader (the mark is aria-hidden), and an h3 so heading navigation goes problem by problem
  const head = pr ? `<div class="group-h lv-${pr.level}">${mark(pr.level)}<div><h3><span class="sr-only">${WORD[pr.level]}: </span>${esc(splitHeadline(pr.headline)[0])}</h3>${!isHeadline && pr.action ? `<div class="g-action">${esc(nb(pr.action))}</div>` : ''}</div></div>` : '';
  const unk = its.filter((x) => x.level === 'unknown'), known = its.filter((x) => x.level !== 'unknown');
  const rows = known.map((x) => rowHTML(x, m)).join('') + (unk.length >= 3 ? foldHTML(unk, pr, m) : unk.map((x) => rowHTML(x, m)).join(''));
  return `<section class="card tight group" id="g-${esc(pr?.id ?? 'other')}">${head}${rows}</section>`;
}
/** "can't be checked" only when something stops the check (bitcube offline, a failed check); "not checked yet" at the start. */
const foldVerb = (pr) => (['not-checked', 'unknown', 'td-unknown'].includes(pr?.id) ? 'not checked yet' : "can't be checked");
function foldHTML(unk, pr, m) {
  const id = `fold-${pr?.id ?? 'other'}`;
  return `<details class="row lv-unknown fold" data-id="${esc(id)}" id="${esc(id)}"${op(id)}><summary>${mark('unknown')}<div>
      <div class="name">${unk.length} things ${foldVerb(pr)} <span class="state">· Unknown</span></div>
      <div class="sum">${esc(unk[0].summary)}: ${esc(unk.map((x) => NAME[x.id]).join(', '))}</div></div><span class="chev" aria-hidden="true">›</span></summary>
    <div class="row-body"><p class="detail">${esc(unk[0].detail)}</p>${unk.map((x) => rowHTML(x, m)).join('')}</div></details>`;
}
function rowHTML(x, m) {
  const body = [
    x.detail ? `<p class="detail">${esc(nb(x.detail))}</p>` : '',
    x.action ? `<div class="todo"><div class="label">What to do</div><div class="action">${esc(nb(x.action))}</div></div>` : '',
    x.id === 'ropes' ? ropesCtlHTML(m) : x.id === 'hub75 panels' ? hubCtlHTML(m) : x.id === 'touchdesigner' ? showfileCtlHTML(m)
      : x.id === 'seasons' && m.show.season ? '<div class="row-btns"><button type="button" class="btn" data-act="goto" data-target="steer">Steer the year</button></div>'
      : x.id === 'seasons' && ['live', 'other'].includes(m.show.file?.kind) ? showfileCtlHTML(m, 'year')
      : x.id === 'river camera' ? riverStillHTML(x) : x.id === 'modal agent' ? daveHTML(m) : '',
    addrHTML(x, m),
  ].join('');
  return `<details class="row lv-${x.level}${x.stale ? ' stale' : ''}" data-id="${esc(x.id)}" id="${rid(x.id)}"${op(x.id)}><summary>
      ${mark(x.level)}<div><div class="name">${esc(NAME[x.id] ?? x.name)} <span class="state">· ${WORD[x.level]}</span></div>
      <div class="sum">${esc(nb(x.summary))}</div><div class="from">from ${FROM[x.checked_from]} · ${ageSpan(x.age_s)}${x.stale ? ' · last seen' : ''}${x.level !== 'ok' ? sinceSpan(x.id, x.level, [x.summary, x.detail], x) : ''}</div></div><span class="chev" aria-hidden="true">›</span></summary>
    <div class="row-body">${body}</div></details>`;
}
/** Dave's card: the clip ages (from Clips to Dave) and whether tonight's file uses his scene. */
function daveHTML(m) {
  const link = item(m, 'modal link'), s = m.show;
  const file = s.file ? (s.file.kind === 'live' ? "Tonight's show file (the live river) shows his scene on the panels." : s.file.kind === 'year' ? "Tonight's show file (the river's year) doesn't use his scene; the room is unaffected by the agent." : `Tonight's show file (${s.file.label}) doesn't use his scene.`) : "Which show file is running isn't known.";
  return `<div class="dave">${link ? `<div><span class="lbl">Clips to Dave:</span> ${link.level !== 'ok' ? `${WORD[link.level]} · ` : ''}${esc(nb(link.summary))}</div>` : ''}
    ${s.scene ? `<div><span class="lbl">His scene:</span> ${esc(s.scene.words)}</div>` : ''}
    <div>${esc(file)}${s.modal?.resting ? ' The agent rests overnight (23:55 to 07:00).' : ''}</div></div>`;
}
function addrHTML(x, m) {
  const src = x.id === 'bitcube' ? m.sources.bitcube : x.id === 'seasons' ? m.sources.seasons : x.id === 'modal agent' ? m.sources.modal : x.checked_from === 'bitcube' ? m.sources.probe : null;
  const lines = [x.address ? `Address: <code>${esc(x.address)}</code>` : '', `Checked from ${FROM[x.checked_from]} · ${ageSpan(x.age_s)}`,
    src?.error ? `raw: <code>${esc(src.error)}</code>` : '', x.raw ? `raw: <code>${esc(x.raw)}</code>` : ''].filter(Boolean);
  const links = [...(LINKS[x.id] ?? []), ['Show on the system map', `/map#${encodeURIComponent(x.id)}`, `Show ${NAME[x.id] ?? x.name} on the system map`]];   // map.js opens that box's sheet
  return `<div class="addr"><div class="label">Addresses and links (for Will)</div>${lines.map((l) => `<div>${l}</div>`).join('')}
    <div class="links">${links.map(([l, h, aria]) => `<a href="${esc(h)}"${aria ? ` aria-label="${esc(aria)}"` : ''} ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div></div>`;
}
function riverStillHTML(x) {
  const r = stills.river, age = stillAge('river');
  if (r.url) return `<div class="still ${age > OLD_S ? 'old' : ''}"><img src="${r.url}" alt="The river: the river camera's latest still"><div class="cap"><span>The river · <span class="age" data-still="river">${nb(dur(age) + ' ago')}</span>${age > OLD_S ? ' · old picture' : ''}</span></div></div>`;
  return `<div class="still none lv-${x.level}"><div class="cap-none">${mark(x.level)}The river: ${r.missing == null ? 'fetching the picture…' : 'no picture right now'}</div></div>`;
}
function fineHTML(m) {
  const ok = m.items.filter((x) => x.level === 'ok' && x.id !== 'mission control' && !x.muted);
  const muted = m.items.filter((x) => x.muted);
  if (!ok.length && !muted.length) return '';
  // fine from a last answer (the full check is old, or contact is lost) is not fine now: the grey mark and "when last seen"
  // (contract rule 3: unknown is never green)
  const n = ok.length, old = ok.filter((x) => x.stale).length, fresh = n - old;
  const s = (k) => (k === 1 ? '' : 's');
  const words = !old ? `${n} thing${s(n)} fine` : !fresh ? `${n} thing${s(n)} fine when last seen` : `${fresh} thing${s(fresh)} fine; ${old} more when last seen`;
  return `<details class="card fine" data-id="fine" id="fine-list"${op('fine')}><summary>${mark(old ? 'unknown' : 'ok')}<span>${words}</span>
      <span class="fine-names">${esc(ok.slice(0, 4).map((x) => NAME[x.id]).join(', '))}${ok.length > 4 ? '…' : ''}</span><span class="chev" aria-hidden="true">›</span></summary>
    <div class="fine-list">${ok.map((x) => rowHTML(x, m)).join('')}${muted.map((x) => `<div class="muted-row"><span class="mk lv-unknown" aria-hidden="true">·</span><div><div class="name">${esc(NAME[x.id])}</div><div class="sum">${esc(x.summary)}</div></div></div>`).join('')}</div></details>`;
}
function installerHTML(m) {
  const c = m.controls, s = m.show, route = s.ropes.route, boot = s.boot_file?.name;
  const files = s.show_files.length ? s.show_files : Object.keys(FILES).slice(0, 2);
  const lrOff = !c.lightsroute.possible || pend('lightsroute'), bfOff = !c.bootfile.possible || pend('bootfile');
  return `<details class="card installer" data-id="installer" id="installer-card"${op('installer')}><summary><span class="tool" aria-hidden="true">🛠</span><span>Installer</span><span class="note">changes cabling settings · confirms every change</span><span class="chev" aria-hidden="true">›</span></summary><div class="body">
    <div class="ctl ${lrOff ? 'off' : ''}" data-ctl="lightsroute"><div class="ctl-h">Lighting network port on bitcube</div>${c.lightsroute.why ? why(c.lightsroute.why) : ''}
      <div class="seg" role="group" aria-label="Lighting network port"><button type="button" data-act="lightsroute" data-route="direct" class="${route === 'direct' ? 'lit' : ''}" aria-pressed="${route === 'direct'}" ${lrOff ? 'disabled' : ''}>LIGHTS port (white)</button><button type="button" data-act="lightsroute" data-route="router" class="${route === 'router' ? 'lit' : ''}" aria-pressed="${route === 'router'}" ${lrOff ? 'disabled' : ''}>Router port (fallback)</button></div>
      <div class="effect">Now: <b>${route === 'direct' ? "bitcube's LIGHTS port" : route === 'router' ? 'the router port' : 'not known'}</b>. The wrong port leaves all 20 ropes dark. Only change it after moving the cable; it asks first.</div>
      ${statusLine('lightsroute')}</div>
    <div class="ctl ${bfOff ? 'off' : ''}" data-ctl="bootfile"><div class="ctl-h">Boot file: the show file that opens at boot</div>${c.bootfile.why ? why(c.bootfile.why) : ''}
      <div class="seg" role="group" aria-label="Boot file">${files.map((f) => `<button type="button" data-act="bootfile" data-file="${esc(f)}" class="${boot === f ? 'lit' : ''}" aria-pressed="${boot === f}" ${bfOff ? 'disabled' : ''}>${esc(cap(fileLabel(f)))}</button>`).join('')}</div>
      <div class="effect">Takes effect at bitcube's next restart; it does not change what is showing now. It asks first.</div>
      ${statusLine('bootfile')}</div>
    <div class="links"><a class="btn" href="/lights">Calibrate the lights → Lights</a></div>
  </div></details>`;
}

// ---- controls: before / confirm / pending / result / failure, on the thing they change -----------------------------------
const why = (w) => `<div class="ctl-why">Not possible now: ${esc(w)}.</div>`;
function statusLine(name) {
  const c = ctl[name];
  return `<div class="ctl-status ${c?.state ?? ''}" data-ctl-status="${name}">${c ? `${c.state === 'pending' ? '<span class="spin" aria-hidden="true"></span>' : ''}<span>${esc(c.text)}</span>` : ''}</div>`;
}
function ropesCtlHTML(m) {
  const c = m.controls.ropes, r = m.show.ropes, st = r.state, off = !c.possible || pend('ropes');
  const boxes = ['rope box 1', 'rope box 2'].map((id) => item(m, id)).filter(Boolean);
  const watts = r.open && Array.isArray(r.watts) && r.watts.every((w) => w != null) ? `<div class="effect">Power: <b>${nb(`${r.watts.join(' + ')} W`)}</b>${r.cap ? ` of ${nb(`${r.cap} W`)} per box` : ''}.</div>` : '';
  return `<div class="ctl ${c.possible ? '' : 'off'}" data-ctl="ropes"><div class="ctl-h">Ropes</div>${c.possible ? '' : why(c.why)}
    <div class="seg" role="group" aria-label="Ropes"><button type="button" data-act="ropes" data-dark="0" class="${st === 'river' ? 'lit' : ''}" aria-pressed="${st === 'river'}" ${off ? 'disabled' : ''}>On · showing the river</button><button type="button" data-act="ropes" data-dark="1" class="${st === 'dark' ? 'lit' : ''}" aria-pressed="${st === 'dark'}" ${off ? 'disabled' : ''}>Dark</button></div>
    <div class="effect">Now: <b>${esc(r.words)}</b>. Dark sends black to all 20 ropes; they follow within a few seconds. Dark asks first.</div>
    ${watts}
    <div class="boxes">${boxes.map((b) => `<div class="box lv-${b.level}">${mark(b.level)}<div><b>${esc(NAME[b.id])}</b> <span class="state">· ${WORD[b.level]}</span><div class="sum">${esc(nb(b.summary))}</div></div></div>`).join('')}</div>
    ${statusLine('ropes')}
    <div class="links"><a href="/lights">See every LED → Lights</a></div></div>`;
}
function hubCtlHTML(m) {
  const c = m.controls.hub75, b = m.show.panels.brightness, cur = b == null ? null : Math.round(b * 100);
  const draft = hubDraft ?? cur, off = !c.possible || pend('hub75');
  return `<div class="ctl ${c.possible ? '' : 'off'}" data-ctl="hub75"><div class="ctl-h">Panels brightness</div>${c.possible ? '' : why(c.why)}
    <div class="readout">Now <b>${cur == null ? 'not known' : nb(`${cur} %`)}</b>${cur != null && m.show.panels.state === 'no-sender' ? ' (no panel sender, so dark)' : ''}</div>
    <div class="stepper"><button type="button" class="btn step" data-act="hub-step" data-d="-10" ${off || draft == null || draft <= 0 ? 'disabled' : ''} aria-label="Darker">−</button><output aria-label="Brightness to set">${draft == null ? '?' : nb(`${draft} %`)}</output><button type="button" class="btn step" data-act="hub-step" data-d="10" ${off || draft == null || draft >= 100 ? 'disabled' : ''} aria-label="Brighter">+</button>
      <button type="button" class="btn primary" data-act="hub-set" ${off || draft == null || draft === cur ? 'disabled' : ''}>${draft == null ? 'Set brightness' : `Set ${nb(`${draft} %`)}`}</button>
      <button type="button" class="btn danger" data-act="hub-off" ${off || cur === 0 ? 'disabled' : ''}>Panels off</button></div>
    <div class="effect">A change shows on the panels within a few seconds. Panels off sets ${nb('0 %')} and asks first.</div>
    ${statusLine('hub75')}</div>`;
}
/** The show-file control: every file (the TouchDesigner row), or only the files of one kind (the Season card: the river's year). */
function showfileCtlHTML(m, onlyKind = null) {
  const c = m.controls.switch, s = m.show, all = s.show_files.length ? s.show_files : Object.keys(FILES).slice(0, 2);
  // only the river's year and the live river: model.js leaves old show files out of show_files (execution plan D27)
  const files = onlyKind ? all.filter((f) => FILES[f]?.kind === onlyKind) : all;
  const running = s.file?.name, off = !c.possible || pend('switch');
  const btns = files.map((f) => `<button type="button" class="btn ${f === running ? '' : 'primary'}" data-act="switch" data-file="${esc(f)}" ${off ? 'disabled' : ''}>${f === running ? `Restart on ${esc(fileLabel(f))}` : `Switch to ${esc(fileLabel(f))}`}</button>`).join('');
  return `<div class="ctl ${c.possible ? '' : 'off'}" data-ctl="switch"><div class="ctl-h">Show file</div>${c.possible ? '' : why(c.why)}
    <div class="readout">${s.file ? `Showing <b>${esc(s.file.label)}</b>` : "What is showing <b>isn't known</b>"}${s.boot_file ? ` · opens at boot: ${esc(s.boot_file.label)}` : ''}</div>
    <div class="row-btns">${btns}</div>
    <div class="effect">Switching restarts TouchDesigner on that file: the lights go dark for about a minute and unsaved changes in TouchDesigner are lost. It asks first.</div>
    ${statusLine('switch')}</div>`;
}
/** One polite live region for the whole page (status.html #ctl-live): what a control is doing and how it ended, and a
 *  stepper's new value. The status lines themselves are re-rendered with the markup, so they can't be live regions. */
function announce(text) { const l = $('#ctl-live'); if (!l) return; l.textContent = ''; setTimeout(() => { l.textContent = text; }, 50); }
/** Confirm if asked, then post; the control shows pending, the result with a time, or the failure and the next step. */
let asking = null;   // the confirm on screen: { name, pr }, withdrawn by render() when its control becomes impossible
async function runControl(name, path, body, { ask = null, done, fail, pending = 'Sending to bitcube…' }) {
  if (ask) {
    asking = { name, pr: confirm(ask) };
    const yes = await asking.pr;
    asking = null;
    if (!yes) return;
  }
  // the confirm may have been open for a while: judge again now, and send nothing if the control became impossible
  model = p.last ? derive(p.last, p.last.now + p.elapsed()) : null;
  const now = model?.controls[name];
  if (!now?.possible) {
    ctl[name] = { state: 'failed', text: `Not sent: ${now?.why ?? "this page can't reach mission control"} (${fmt.clock(Date.now())}).` };
    announce(ctl[name].text); render(); return;
  }
  ctl[name] = { state: 'pending', text: pending };
  announce(pending);
  render();
  try {
    const r = await api(path, body);
    const text = typeof done === 'function' ? done(r) : done;
    ctl[name] = { state: 'done', text: `${text} · ${fmt.clock(Date.now())}${r?.fixture ? ' (fixture mode: nothing really changed)' : ''}` };
    if (name === 'hub75') hubDraft = null;
    if (name === 'target') { targetDraft.season = null; targetDraft.intensity = null; }
    if (name === 'rules') for (const k of Object.keys(rulesDraft)) delete rulesDraft[k];
    setTimeout(() => p.refresh(), 1500);
  } catch (e) {
    const why = plainError(e);
    ctl[name] = { state: 'failed', text: e?.noAnswer ? noAnswerText(e, 'the Now line shows what bitcube reports') : `${fail}: ${why} (${fmt.clock(Date.now())}).${/refused it/.test(why) ? '' : ' Try again, or see the verdict above.'}` };
    if (e?.noAnswer) setTimeout(() => p.refresh(), 500);
  }
  announce(ctl[name].text);
  render();
}
async function checkNow() {
  if (checkState?.state === 'pending') return;
  const offline = !!model && item(model, 'bitcube')?.level === 'down';
  checkState = { state: 'pending', text: offline ? 'Asking bitcube again…' : 'Asking bitcube to check everything now…' };
  announce(checkState.text);
  shell.setChecking(true);
  render();
  try {
    await api('/api/control/check', {});
    checkState = { state: 'done', text: offline ? `Asked bitcube again · ${fmt.clock(Date.now())}; the page updates if it answers` : `Check started · ${fmt.clock(Date.now())}; the page updates as answers come in` };
    setTimeout(() => p.refresh(), 1500);
    setTimeout(() => { if (checkState?.state === 'done') { checkState = null; render(); } }, 20_000);
  } catch (e) {
    checkState = { state: 'failed', text: `The check didn't start: ${plainError(e)} (${fmt.clock(Date.now())}).` };
  } finally { shell.setChecking(false); }
  announce(checkState.text);
  render();
}

// ---- sheets and jumps -----------------------------------------------------------------------------------------------------
function openStill() {
  const g = stills.gallery;
  if (!g.url) return;
  sheet({ title: 'The room', body: `<img class="still-img" src="${g.url}" alt="The gallery camera's latest still"><p class="secondary muted">Taken <span data-still="gallery">${dur(stillAge('gallery'))} ago</span>, fetched through bitcube. The picture refreshes about every 30 s.</p>` });
}
function jump(target) {
  if (!goto(target)) return;
  const el = document.getElementById(target);
  for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) if (d.dataset.id) openRows.add(d.dataset.id);
}
/** "Switch now": the TouchDesigner row when it is not OK, else the Season card's control, else the year's row. */
function jumpSwitch() {
  for (const id of [model && item(model, 'touchdesigner')?.level !== 'ok' ? rid('touchdesigner') : null, 'switch-now', rid('seasons'), rid('touchdesigner')]) {
    if (id && document.getElementById(id)) { jump(id); return; }
  }
}

// ---- events --------------------------------------------------------------------------------------------------------------
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.id) return;
  // a re-render writes a row back with ' open' and fires 'toggle' again: that changes nothing here, and the river
  // camera's watch starts or stops only when its open state really changes (else fetch → render → toggle → fetch loops)
  if (d.open !== openRows.has(d.dataset.id)) { if (d.open) openRows.add(d.dataset.id); else openRows.delete(d.dataset.id); }
  syncRiverWatch();
}, true);
/** The river camera's still is fetched while its row is open: once on opening, then every 30 s; never twice at once. */
function syncRiverWatch() {
  const want = openRows.has('river camera');
  if (want && !riverWatch) { fetchStill('river'); riverWatch = setInterval(() => fetchStill('river'), STILL_MS); }
  else if (!want && riverWatch) { clearInterval(riverWatch); riverWatch = null; }
}
document.addEventListener('input', (e) => {
  const inp = e.target;
  if (inp instanceof HTMLInputElement && inp.closest('form.rules-form') && inp.name) {
    if (inp.value === '' || inp.value === inp.dataset.server) delete rulesDraft[inp.name]; else rulesDraft[inp.name] = inp.value;
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-act="still"]')) { e.preventDefault(); openStill(); }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  switch (act) {
    case 'goto': jump(b.dataset.target); break;
    case 'goto-switch': jumpSwitch(); break;
    case 'checknow': checkNow(); break;
    case 'still': openStill(); break;
    case 'ropes': {
      const dark = b.dataset.dark === '1';
      runControl('ropes', '/api/control/ropes', { dark }, {
        ask: dark ? { title: 'Make the ropes dark?', body: 'The ropes in the gallery go black now and stay black until someone presses On. The panels keep showing the river.', ok: 'Go dark', cancel: 'Keep showing the river' } : null,
        done: dark ? 'Dark: the ropes go black within a few seconds' : 'On: the ropes show the river again within a few seconds', fail: 'The ropes are unchanged' });
      break;
    }
    case 'hub-step': { const cur = model?.show.panels.brightness == null ? null : Math.round(model.show.panels.brightness * 100); if (cur == null && hubDraft == null) break; hubDraft = clamp((hubDraft ?? cur) + Number(b.dataset.d), 0, 100); render(); announce(`${hubDraft} %`); break; }
    case 'hub-set': runControl('hub75', '/api/control/hub75', { brightness: hubDraft / 100 }, { done: `Panels set to ${nb(`${hubDraft} %`)}; it shows within a few seconds`, fail: 'The panels are unchanged' }); break;
    case 'hub-off': runControl('hub75', '/api/control/hub75', { brightness: 0 }, { ask: { title: 'Switch the panels off?', body: `The panels in the gallery go dark now (brightness ${nb('0 %')}). Set a brightness to bring them back.`, ok: 'Panels off', cancel: 'Keep them on' },
      done: `Panels off (${nb('0 %')}); set a brightness to bring them back`, fail: 'The panels are unchanged' }); break;
    case 'mode': runControl('mode', '/api/control/mode', { mode: b.dataset.mode }, { done: `Mode → ${cap(b.dataset.mode)}${b.dataset.mode === 'manual' ? ': taken over by hand' : ''}`, fail: 'The mode is unchanged' }); break;
    case 'tseason': targetDraft.season = b.dataset.season; render(); break;
    case 'tint': { const cur = targetDraft.intensity ?? model?.show.target?.intensity ?? model?.show.intensity?.value ?? 0.5; targetDraft.intensity = Math.round(clamp(cur + Number(b.dataset.d), 0, 1) * 10) / 10; render(); announce(`${M.intensityWord(targetDraft.intensity)} (${targetDraft.intensity.toFixed(1)})`); break; }
    case 'target-set': {
      const season = targetDraft.season ?? model?.show.target?.season, intensity = targetDraft.intensity ?? model?.show.target?.intensity ?? model?.show.intensity?.value ?? 0.5;
      runControl('target', '/api/control/target', { season, intensity }, { done: `Target sent: ${season}, ${M.intensityWord(intensity)}; the river travels there by hand`, fail: 'The target is unchanged' });
      break;
    }
    case 'rules-apply': {
      const form = b.closest('form'), changed = {};
      for (const inp of form.querySelectorAll('input[name]')) if (inp.value !== '' && Number(inp.value) !== Number(inp.dataset.server)) changed[inp.name] = Number(inp.value);
      if (!Object.keys(changed).length) { ctl.rules = { state: 'done', text: 'Nothing changed.' }; render(); break; }
      runControl('rules', '/api/control/rules', { rules: changed }, { done: `${Object.keys(changed).length} rule${Object.keys(changed).length === 1 ? '' : 's'} saved`, fail: 'The rules are unchanged; what you typed is kept' });
      break;
    }
    case 'rules-reset': runControl('rules', '/api/control/rules-reset', {}, { ask: { title: 'Reset every rule to its default?', body: 'All the numbers go back to their defaults from now on. The river itself does not move.', ok: 'Reset all', cancel: 'Keep them' },
      done: 'Rules reset to their defaults', fail: 'The rules are unchanged' }); break;
    case 'switch': {
      const f = b.dataset.file, label = fileLabel(f), verb = f === model?.show.file?.name ? 'Restart on' : 'Switch to';   // the button's own words
      runControl('switch', '/api/control/switch', { file: f }, { ask: { title: `${verb} ${label} now?`, body: 'Restarts TouchDesigner on that file: the lights go dark for about a minute, and unsaved changes in TouchDesigner are lost.', ok: `${verb} ${label}`, cancel: 'Leave it' },
        done: `TouchDesigner is restarting on ${label}: about a minute dark`, fail: 'The show file is unchanged', pending: `Restarting on ${label}, about a minute…` });
      break;
    }
    case 'bootfile': { const f = b.dataset.file; runControl('bootfile', '/api/control/bootfile', { file: f }, { ask: { title: `Open ${fileLabel(f)} at boot?`, body: 'From the next restart of bitcube, TouchDesigner opens this file. What is showing now does not change.', ok: 'Change the boot file', cancel: 'Leave it' },
      done: `${cap(fileLabel(f))} opens at the next restart`, fail: 'The boot file is unchanged' }); break; }
    case 'lightsroute': {
      const route = b.dataset.route;
      runControl('lightsroute', '/api/control/lightsroute', { route }, { ask: { title: route === 'direct' ? "Use bitcube's LIGHTS port?" : 'Use the router port?', body: 'Moves the lighting network to that port. If the lighting switch is plugged into the other one, all 20 ropes go dark until it is moved back.', ok: 'Change the port', cancel: 'Leave it' },
        done: `Lighting network on ${route === 'direct' ? "bitcube's LIGHTS port" : 'the router port'}`, fail: 'The port is unchanged' });
      break;
    }
    default: break;
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchStill('gallery'); });

// ---- go -----------------------------------------------------------------------------------------------------------------
render();
fetchStill('gallery');
setInterval(() => fetchStill('gallery'), STILL_MS);
