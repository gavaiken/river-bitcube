// Mission control v2: the Status page (docs/mission-ui.md, "Status"). One big answer, then drill down: the lost-contact
// banner, the verdict band, the piece now (season, ropes, panels, the room), Not OK grouped by cause, the fine list,
// the installer. Every verdict, state word, control reason and sentence comes from model.js's derive(); this file only
// lays it out. The shell (ui.js) owns the art, the header, the tab bar, the menu and the sheets. Plain ES module.
// Every control follows the contract's states (docs/mission-ui.md "Applying a change": ready, blocked, confirm, applying,
// confirming, done, unconfirmed, failed) through model.js's ctlStep/ctlView; the words and the forms' rules are in
// status-words.js, where node's tests check them.
import * as M from '/model.js';
import { mountShell, poll, tick, watchContact, focusKey, refocus, park, focusShown, drawn, art, fmt, confirm, sheet, api, plainError, noAnswerText, esc, goto, mark, chip, WORD, MARK,
  NAMES_FROM_BITCUBE, sinceAgrees as sinceAgreesWith, splitHeadline, WARN_MS, LOST_MS, announce, setLive, whyText, POLL_TIMEOUT_MS, onScreen, keepInView, closedAround } from '/ui.js';
import { rulesForm, targetForm, modeEffect, switchWords, switchShows, bootShows, bootWords, controlLine, failText, notSentText, applyingLine,
  ropesTile as ropesTileWords, panelsTile as panelsTileWords, stillDue, rowFromHash, lastDoneParts, lastDoneWhat, fromWords } from '/status-words.js';

const { derive, dur, POLL_S, PAGE_STALE_S, FILES, contactFor, CONTACTS, ctlInit, ctlStep, ctlView, EXPECT_S, BOOT_USUAL, CONFIRMING_SAID, unconfirmedWords, serverJudged, changeLabel, bandSaid,
  entryIdOf, newRequestId, heldWords, MAYBE_HOLDS, confirmLimitS } = M;
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
// Short "what they own" for the Call line (the menu's Who to call has the full version).
const OWNS = { gavin: 'bitcube and the show file', lilian: 'the lights and the rigging', andi: 'the panels', will: 'network and cameras', dave: 'his agent', colin: 'how the piece should look' };

// ---- state ------------------------------------------------------------------------------------------------------
let model = null;
const openRows = new Set();   // expanded rows, kept across re-renders
// Each control's state (model.js ctlStep): name -> { s, text, applyText, expectS, o (what it was asked to do), result, key (the
// pressed button's focus key), host (its .ctl's id), asking (the open confirm), refreshAt, entryId (its change's entry on the
// server, applying_id: the band leaves it out, and a switch or boot-file change is done when status.confirmed names it) }.
// Rules and its reset share the form.
const ctl = {};
const SHARE = { rules: ['rules-reset'], 'rules-reset': ['rules'] };
const stillTried = { gallery: 0, river: 0 }, stillBusy = { gallery: false, river: false };   // Date.now() of the last try; one at a time
const stillNet = { gallery: false, river: false };   // the last try failed for want of a network (not "no picture"): try again on contact
const stills = { gallery: { url: null, age_s: null, fetchedAt: null, missing: null }, river: { url: null, age_s: null, fetchedAt: null, missing: null } };
const lastHTML = new Map();   // section -> the HTML it holds (no churn when nothing changed)
let hubDraft = null;          // the brightness stepper, before "Set"
const targetDraft = { season: null, intensity: null };
const rulesDraft = {};        // what was typed into the rules form, kept across re-renders and a failed Apply
let riverWatch = null;
let tels = {};                // contact key -> tel, from GET /api/contacts (never in the repo)
let deepLinked = false;       // a link to /status#r-<item> (the System map's sheets) is followed once, after the first answer
// Focus under a control that became blocked (another phone's change, a calibration, lost contact) waits on the line that says why,
// and goes back to the control when it unlocks (R6 #2, #7, #28): { key } of the control while it waits. A control whose row moved
// to another section (into the fine list) is found once every section is drawn: pendingFocus.
let parked = null, pendingFocus = null;
const ruleSaid = {};          // a rule box's error said once (R6 #10): key -> the error last said
let ruleSayTimer = null;

// ---- helpers -------------------------------------------------------------------------------------------------------
function cap(s) { return s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s ?? ''; }
const nb = fmt.nb;
const rid = (id) => 'r-' + id.replace(/\s+/g, '-');
const elapsedS = () => (p.last ? p.elapsed() / 1000 : 0);
/** The server's clock now (its last answer carried forward), else the phone's: every time a control line states is the server's,
 *  so it agrees with Last done and a 409's "(started 21:04)" on a phone whose clock is off (R8 #35). */
const serverNow = () => (p.last ? p.last.now + p.elapsed() : Date.now());
/** "21:04" on the server's clock. */
const sclock = (ms = serverNow()) => fmt.clock(ms, serverNow());
const C = (name) => (ctl[name] ??= { s: ctlInit(), text: '' });
/** A request of this control is in flight or awaiting bitcube's reading: it, its siblings and its inputs are locked. */
const busy = (name) => !!ctl[name] && ctlView(ctl[name].s).busy;
/** Why a control can't run now (the model's words; "wait: <label> is being applied" while another change blocks it), or null. */
function whyOf(name) {
  if (name === 'check') return lostContact(model) ? "this page can't reach mission control" : null;
  return model ? model.controls[name]?.why ?? null : "this page can't reach mission control";
}
const off = (name) => !!whyOf(name) || busy(name);
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
const VOL = /\b(data-(?:age|for|next|el))="[^"]*"/g;
function setHTML(el, html) {
  const prev = lastHTML.get(el);
  if (prev === html) return;
  lastHTML.set(el, html);
  if (prev != null && prev.replace(VOL, '$1=""') === html.replace(VOL, '$1=""')) {
    const vals = [...html.matchAll(VOL)];
    const els = el.querySelectorAll('[data-age],[data-for],[data-next],[data-el]');
    if (els.length === vals.length) {
      els.forEach((e, i) => { const [, name] = vals[i]; e.setAttribute(name, vals[i][0].slice(name.length + 2, -1)); });
      refreshAges(el);
      return;
    }
  }
  // a control under the user's finger or keyboard focus keeps the focus across the re-render (found again by its data-*)
  const active = document.activeElement, had = active && active !== document.body && el.contains(active);
  const key = had ? focusKey(active) : null, hostEl = had ? active.closest('[data-ctl]') : null, hostId = hostEl?.id ?? null;
  el.innerHTML = html;
  el.querySelectorAll('details[data-id]').forEach((d) => { d.open = openRows.has(d.dataset.id); });
  refreshAges(el);
  if (had) placeFocus(key, hostId, el, hostEl?.dataset.ctl ?? null);
}
/** Can t hold focus where it is (enabled, drawn: not inside a closed <details>)? */
const usable = (t) => !!t && !t.disabled && drawn(t);
/** After a re-render: focus back on the control `key` names, or, when it is blocked now, on its host's line that says why (never an
 *  empty line, never <body>: ui.js park), remembering the control so focus comes back when it unlocks. A control not drawn yet
 *  (its row moved to a section drawn later) is found by render() once every section is drawn. */
function placeFocus(key, hostId, root, name = null) {
  let t = null;
  try { t = key ? root.querySelector(key) ?? document.querySelector(key) : null; } catch { /* a stale key */ }
  if (usable(t) && focusShown(t)) return;
  const host = (hostId && document.getElementById(hostId)) || t?.closest('[data-ctl]') || null;
  const onLine = !!key && /^#(why|st)-/.test(key);              // focus already waited on a line, for a control remembered in parked
  if (key && !onLine && host) parked = { key };
  if (host && park(host, host.id === 'ctl-check' ? document.querySelector('#band h1') : null)) return;
  if (key || name) pendingFocus = { key, name };
}
/** Focus whose control's host was removed (the Season card's Switch now once the year runs: R7 #7) goes to another host of the same
 *  control, opened where it sits (the TouchDesigner row), its line that says what is happening; else the band's headline. Never
 *  <body>. */
function rescueFocus(name) {
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected) return;
  const hosts = name ? [...document.querySelectorAll(`[data-ctl="${CSS.escape(name)}"]`)] : [];
  const h = hosts.find((x) => drawn(x)) ?? hosts[0] ?? null;
  if (h) {
    for (let d = closedAround(h); d; d = closedAround(h)) { d.open = true; if (d.dataset.id) openRows.add(d.dataset.id); }
    const st = h.querySelector('.ctl-status');
    if (st && st.textContent.trim() && drawn(st)) { st.focus({ preventScroll: true }); if (document.activeElement === st) return; }
    if (park(h)) return;
  }
  const band = document.getElementById('band-h');
  if (band) { band.setAttribute('tabindex', '-1'); band.focus({ preventScroll: true }); }
}
/** Once every section is drawn: a control whose row moved gets focus back where it is now (or the closed list it went into), and a
 *  control that unlocked takes focus back from the line it waited on, unless focus went somewhere else meanwhile. */
function restoreFocus() {
  const a = document.activeElement, lost = !a || a === document.body || !a.isConnected;
  if (pendingFocus) {
    const { key, name } = pendingFocus; pendingFocus = null;
    let t = null; try { t = key ? document.querySelector(key) : null; } catch { /* a stale key */ }
    if (lost && t) { if (t.disabled || !focusShown(t)) { const h = t.closest('[data-ctl]'); if (h) { if (t.disabled && drawn(h)) parked = { key }; park(h); } } }
    else if (lost) rescueFocus(name ?? t?.closest('[data-ctl]')?.dataset.ctl ?? null);
  }
  if (!parked) return;
  const b = document.activeElement, waiting = !b || b === document.body || b.matches('.ctl-why, .ctl-status, .ctl-h, [data-ctl], #band h1');
  if (!waiting) { parked = null; return; }                     // focus went elsewhere: it isn't ours to move
  let t = null; try { t = document.querySelector(parked.key); } catch { /* a stale key */ }
  if (usable(t) && focusShown(t)) parked = null;
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
  // another phone's change in flight (the band): "Applying: the switch to the live river · 0:23 · usually about 1 min"
  root.querySelectorAll('[data-el]').forEach((s) => {
    // a maybe reads as one (R8 #17), and a start or a boot file with the sending phone's usual time (R8 #22)
    const t = applyingLine({ label: s.dataset.label, expect_s: s.dataset.exp === '' ? null : Number(s.dataset.exp), phase: s.dataset.phase, source: s.dataset.source || null,
                             maybe: s.dataset.maybe === '1', action: s.dataset.action || null }, Number(s.dataset.el) + el);
    if (s.textContent !== t) s.textContent = t;
  });
  // a control applying or confirming: its line ticks (m:ss) without re-rendering the control under a thumb
  root.querySelectorAll('[data-ctl-line]').forEach((s) => {
    const c = ctl[s.dataset.ctlLine];
    if (!c || !ctlView(c.s).busy) return;
    const t = controlLine(c, Date.now()).text;
    if (s.textContent !== t) s.textContent = t;
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
    // contact is back: the room's picture is fetched now when the last try failed for want of a network (a phone waking with
    // none: its wake-up try failed) or is older than its interval
    if (stillDue({ now: Date.now(), tried: stillTried.gallery, netFailed: stillNet.gallery }, STILL_MS)) fetchStill('gallery');
    // a link to /status#r-<item> (the System map's sheets): that row, opened, once the first answer has drawn it
    if (!deepLinked && model) { deepLinked = true; const id = rowFromHash(location.hash); if (id && document.getElementById(id)) jump(id); }
  },
  onError: () => render() });   // before any answer, watchContact's header says "No answer yet · N s" from the first try
document.addEventListener('mc:check', () => p.refresh());
document.addEventListener('mc:theme', () => render());
// the shared rule (ui.js): from the time since the last answer, so a hung request greys the page as surely as an error
watchContact(p, shell, () => render());
tick(() => { tickControls(); refreshAges(); });
fetch('/api/contacts', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
  const list = Array.isArray(j?.contacts) ? j.contacts : j?.contacts && typeof j.contacts === 'object' ? Object.entries(j.contacts).map(([k, v]) => ({ key: k, ...(typeof v === 'string' ? { tel: v } : v) })) : [];
  for (const c of list) if (c.tel && (c.key || c.name)) tels[String(c.key ?? c.name).toLowerCase()] = String(c.tel);
  render();
}).catch(() => {});

// ---- stills ----------------------------------------------------------------------------------------------------------
/** One still at a time per camera, with a time limit (a request that hangs never keeps the next one waiting: R5 #0). */
async function fetchStill(cam) {
  if (stillBusy[cam]) return;
  stillBusy[cam] = true; stillTried[cam] = Date.now();
  const s = stills[cam];
  const ctrl = new AbortController(), limit = setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS);
  try {
    const r = await fetch(`/api/camera/${cam}.jpg`, { cache: 'no-store', signal: ctrl.signal });
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
    stillNet[cam] = false;
  } catch { stills[cam] = { ...s, missing: s.url ? s.missing : true }; stillNet[cam] = true; }
  finally { clearTimeout(limit); stillBusy[cam] = false; }
  render();
}

// ---- rendering ----------------------------------------------------------------------------------------------------------
/** What this phone is working on: the focused control (or the line focus waits on), else the status line of its own change in flight
 *  or just ended, so a re-render that moves its row (into Not OK while TouchDesigner restarts, back to the fine list) can bring it
 *  back into view (R7 #0, #8). */
function workingOn() {
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected && a.closest('main') && !a.closest('dialog')) return { key: focusKey(a), el: a, focus: true };
  const now = Date.now();
  const name = Object.keys(ctl).filter((n) => busy(n) || (['done', 'failed', 'unconfirmed'].includes(ctl[n].s.state) && now - (ctl[n].s.at ?? 0) < 15_000))
    .sort((x, y) => (ctl[y].s.at ?? 0) - (ctl[x].s.at ?? 0))[0];
  const st = name ? statusEl(name) : null;
  return st ? { key: st.id ? `#${CSS.escape(st.id)}` : null, el: st, focus: false, name } : null;
}
function render() {
  const w = workingOn(), wasOn = !!w && onScreen(w.el);
  renderNow();
  if (!w || !wasOn) return;
  // the same thing after the re-render: what has focus now (placeFocus found it again), else the line found by its id
  let n = w.focus ? document.activeElement : null;
  if (!n || n === document.body) { try { n = w.key ? document.querySelector(w.key) : null; } catch { n = null; } }
  if (!n && w.name) n = statusEl(w.name);
  keepInView(n, wasOn);
}
function renderNow() {
  model = p.last ? derive(p.last, p.last.now + p.elapsed()) : null;
  const m = model;
  const { withdrawn, ended } = settleControls();
  art.setSeason(m?.show.weights ?? null);
  const pageStale = lostContact(m);
  const banner = $('#banner');
  banner.hidden = !pageStale;
  banner.className = pageStale ? 'banner lv-unknown' : '';
  setHTML(banner, pageStale ? bannerHTML(m) : '');
  const band = $('#band');
  band.className = `band lv-${m ? m.overall.level : 'unknown'}`;
  setHTML(band, m ? bandHTML(m) : connectingHTML());
  // screen readers hear the level and the headline when they change, never a time (R6 #8; not even the first time, R7 #13), and
  // each change in flight from another phone or the studio chat by name and source (R7 #12): this phone's own is said on its control
  const own = ownChanges();
  // and, once, how another phone's change ended (R8 #9)
  const said = m ? bandSaid(m, own, serverNow()) : (performance.now() - p.startedAt > LOST_MS ? "This page can't reach mission control." : '');
  setLive($('#band-live'), said);   // through the page's one queue: never in the same moment as the page's region (R8 #11)
  $('.card.now').hidden = !m;
  setHTML($('#now-head'), m ? nowHTML(m) : '');
  setHTML($('#now-steer'), m ? steerHTML(m) : '');
  setHTML($('#problems'), m ? problemsHTML(m) : '');
  setHTML($('#fine'), m ? fineHTML(m) : '');
  setHTML($('#installer'), m ? installerHTML(m) : '');
  // a withdrawn confirm: focus goes to its control's status line, never to the page
  restoreFocus();
  for (const name of withdrawn) focusStatus(name);
  for (const name of ended) afterEnd(name);
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
    <h1 id="band-h">${dead ? "This page can't reach mission control" : slow ? 'No answer from mission control yet' : 'Connecting to mission control…'}</h1>
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
  const elsewhere = othersApplying(m);
  return `<div class="chip-row">${chip(lv)}${since}</div>
    <h1 id="band-h">${esc(nb(big))}</h1>${o.cause === 'page' ? `<p class="rest">No answer for <span data-for="0" data-pre="">${dur(elapsedS())}</span></p>` : rest ? `<p class="rest">${esc(nb(cap(rest)))}</p>` : ''}
    <p class="detail">${esc(nb(o.detail))}</p>${staleNote}${applyingHTML(elsewhere)}${checkLine(m)}${todo}${also}${lastDone(elsewhere)}`;   // Check now above WHAT TO DO: on the first screen even in the busiest bands
}
/** Changes in flight from another phone or the studio chat (status.applying): a quiet ticking line each, so a greyed control's
 *  "Wait: …" has its cause in view. This page's own change in flight is said on its control instead. */
/** This phone's own changes: its entries by id, whatever its control shows now (confirming, or unconfirmed while the server still
 *  holds it), and, without an id, by its action while its control is applying, confirming or unconfirmed (an entry begun before it
 *  gave up): model.js ownEntries (R7 #15, CR7 #10). A control's name is its action. */
function ownChanges() {
  return M.ownEntries(model, Object.entries(ctl).map(([action, c]) => ({ action, state: c.s.state, entryId: c.entryId ?? null, at: c.s.at })), Date.now());
}
/** The changes in flight the band says (another phone's, the studio chat's): never this phone's own, which its control says, and none
 *  while contact is lost. */
function othersApplying(m) {
  // this phone's own change is said on its control only: never two states for one change (R6 #4)
  const { ownIds, ownActions } = ownChanges();
  if (lostContact(m)) return [];
  return (m.show.applying ?? []).filter((a) => !(a.id && ownIds.includes(a.id)) && !ownActions.includes(a.action));
}
function applyingHTML(others) {
  if (!others.length) return '';
  return `<div class="applying-now">${others.map((a) => `<div class="applying-line"><span class="spin" aria-hidden="true"></span><span data-el="${a.started_at != null ? Math.max(0, Math.round((p.last.now - a.started_at) / 1000)) : a.elapsed_s}" data-label="${esc(a.label)}" data-exp="${a.expect_s ?? ''}" data-phase="${esc(a.phase ?? 'applying')}" data-source="${esc(a.source ?? '')}" data-maybe="${a.maybe ? '1' : ''}" data-action="${esc(a.action)}"></span></div>`).join('')}</div>`;
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
  else if (['td-frozen', 'td-slow', 'td-off', 'online-file', 'old-file', 'river-stale', 'year-page'].includes(c)) {
    // while a change in flight holds the switch (a restart bitcube didn't answer in time: R8 #16), the line that says so, never a
    // live-looking button that jumps to a greyed one
    const w = m.controls.switch?.why;
    if (w && /^wait: /i.test(w)) return `<p class="ctl-why jump-wait">${esc(nb(whyText(w)))}</p>`;
    b.push([M.yearPress(m.show.file?.kind), 'goto-switch', '']);   // the advice's own words
  }
  else if (['panels-off', 'panels-dark'].includes(c)) b.push(['Panels brightness', 'goto', rid('hub75 panels')]);
  else if (['coming-up', 'not-checked'].includes(c)) b.push(['Open the studio chat', 'href', '/chat']);
  else if (['page', 'bitcube-unchecked', 'probe-stale', 'bitcube-offline', 'check-failed', 'unknown', 'td-unknown'].includes(c)) return '';
  else if (c === 'calibrating') b.push(['Open Lights', 'href', '/lights']);
  else if (c === 'sender' || c === 'sender-taken') b.push(['Open Ropes →', 'goto', rid('ropes')]);   // the sender's words and both boxes
  else if (first && m.items.some((x) => x.id === first && x.level !== 'ok')) b.push([`Open ${NAME[first] ?? first} →`, 'goto', rid(first)]);   // the named card, opened (R6 #5)
  if (!b.length) return '';
  return `<div class="row-btns">${b.map(([l, act, t]) => act === 'href' ? `<a class="btn primary" href="${esc(t)}">${esc(l)}</a>`
    : `<button type="button" class="btn primary" data-act="${act}" data-target="${esc(t)}">${esc(l)}</button>`).join('')}</div>`;
}
/** "Call Lilian (the lights and the rigging)", a tel: link when the number is known; Colin asks; nobody yet waits. */
function callLine(cause, m = model) {
  const c = contactFor(cause);
  // a calibration, or a switch, restart or rebuild someone chose here (status.applying holds it): started on purpose (R7 #18)
  if (cause === 'calibrating' || (cause === 'td-restarting' && m?.show.restart?.chosen)) return '<span class="call">Nothing to call about: this was started on purpose</span>';
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
  // while bitcube is offline there is no full check to start: the button asks the quick check again, and says so
  const label = busy('check') ? 'Checking…' : offline ? 'Try bitcube again' : 'Check now';
  return `<div class="check-line" id="ctl-check" data-ctl="check"><span>${txt}</span><button type="button" class="btn link" id="ctl-check-go" data-act="checknow" ${off('check') ? 'disabled' : ''}>${label}</button>${statusLine('ctl-check', ['check'])}</div>`;
}
/** "Last done: Ropes → Dark · 21:04 · from mission control", from the server's history (never a name); "Last sent: … · waiting
 *  for bitcube to show it" while the server is still confirming that change (its entry is in status.applying), "… didn't show it
 *  in time" when it gave up (status-words.js lastDoneParts: never "done" before the server says so, R7 #3, #16, #28). */
function lastDone(others = []) {
  const a = p.last?.last_action;
  if (!a || typeof a.t !== 'number') return '';
  // while the band's applying line says this very change, the Last line would say it again: it comes back when the entry ends, as
  // "Last done" or "Last sent … didn't show it in time" (R8 #23)
  if (typeof a.applying_id === 'string' && others.some((x) => x.id === a.applying_id)) return '';
  // the change's one name (the same as its entry on every phone) in one form, and "from the studio chat" as every line says it (R7 #19)
  const what = lastDoneWhat(a), when = fmt.clock(a.t);      // the history's own clock (the server's real one, also in fixture mode)
  const { head, tail } = lastDoneParts(a, p.last);
  return `<div class="last-done">${head}: <b>${esc(nb(what))}</b> · ${esc(when)} · ${esc(fromWords(a.source))}${esc(tail)}</div>`;
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
      <div class="switch-host" id="switch-now">${showfileCtlHTML(m, 'year', 'now')}</div>`;
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
/** The tiles: a state word and a second line that adds something (status-words.js: never the state word again; a calibration
 *  says how long it has left and where to stop it). */
function ropesTile(m) {
  const x = item(m, 'ropes');
  const bothDown = item(m, 'rope box 1')?.level === 'down' && item(m, 'rope box 2')?.level === 'down';
  const { state, words } = ropesTileWords(m, x, bothDown);
  return tile('ropes', 'Ropes', x.level, state, words, x);
}
function panelsTile(m) {
  const x = item(m, 'hub75 panels');
  const { state, words } = panelsTileWords(m, x);
  return tile('hub75 panels', 'Panels', x.level, state, words, x);
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
  const rules = p.last?.seasons?.value?.rules ?? null;
  const modeOff = off('mode');
  const modeBtn = (id, label) => { const poss = id === 'dynamic' ? !c.mode.dynamic.why : true; const lit = s.mode?.id === id; return `<button type="button" id="ctl-mode-${id}" data-act="mode" data-mode="${id}" class="${lit ? 'lit' : ''}" aria-pressed="${lit}" ${poss && !modeOff ? '' : 'disabled'}>${label}</button>`; };
  const manual = s.mode?.id === 'manual';
  const t = targetForm(s.target, targetDraft, s.intensity?.value ?? 0.5);
  const tOff = off('target') || !manual;
  const modeWhy = whyLine('mode') || (c.mode.dynamic.why && !c.mode.why ? `<div class="effect">Dynamic can't be chosen: ${esc(c.mode.dynamic.why)}.</div>` : '');
  return `<details class="sub" data-id="steer" id="steer"${op('steer')}><summary><span>Steer the year</span><span class="chev" aria-hidden="true">›</span></summary><div class="sub-body">
    <div class="ctl ${whyOf('mode') && !busy('mode') ? 'off' : ''}" id="ctl-mode" data-ctl="mode"${busy('mode') ? ' aria-busy="true"' : ''}><div class="ctl-h">Mode: who steers</div>${modeWhy}
      <div class="seg" role="group" aria-label="Mode">${modeBtn('automatic', 'Automatic')}${modeBtn('dynamic', 'Dynamic')}${modeBtn('manual', 'Manual')}</div>
      <div class="effect">${esc(modeEffect(rules))}</div>
      ${statusLine('ctl-mode', ['mode'])}</div>
    <div class="ctl ${(whyOf('target') && !busy('target')) || !manual ? 'off' : ''}" id="ctl-target" data-ctl="target"${busy('target') ? ' aria-busy="true"' : ''}><div class="ctl-h">Target</div>${whyLine('target')}
      <div class="target-grid" role="group" aria-label="Target season" aria-describedby="target-now-season">${M.SEASONS.map((x) => `<button type="button" id="ctl-target-${x}" class="btn ${t.season === x ? 'primary' : ''}" aria-pressed="${t.season === x}" data-act="tseason" data-season="${x}" ${tOff ? 'disabled' : ''}>${x}</button>`).join('')}</div>
      <div class="now-on" id="target-now-season">${t.nowSeason ? esc(t.nowSeason) : ''}</div>
      <div class="stepper"><button type="button" class="btn step" id="ctl-target-less" data-act="tint" data-d="-0.1" ${tOff || t.intensity <= 0 ? 'disabled' : ''} aria-label="Less intensity" aria-describedby="target-now-int">−</button><output id="target-int" aria-label="Target intensity, 0 (stillness) to 1 (torrent)" aria-describedby="target-now-int">${esc(M.intensityWord(t.intensity) ?? '')} (${t.intensity.toFixed(1)})</output><button type="button" class="btn step" id="ctl-target-more" data-act="tint" data-d="0.1" ${tOff || t.intensity >= 1 ? 'disabled' : ''} aria-label="More intensity" aria-describedby="target-now-int">+</button></div>
      <div class="now-on" id="target-now-int">${t.nowIntensity ? esc(t.nowIntensity) : ''}</div>
      <div class="row-btns"><button type="button" class="btn primary" id="ctl-target-apply" data-act="target-set" ${tOff || !t.canApply ? 'disabled' : ''}>${esc(t.label)}</button></div>
      <div class="effect">${manual ? 'Intensity runs from 0 (stillness) to 1 (torrent). The river travels forward through the calendar to the target; it never jumps. Takes over by hand.' : 'Choose Manual first; the target then steers the river by hand.'}</div>
      ${statusLine('ctl-target', ['target'])}</div>
    ${rules ? rulesHTML(rules) : ''}</div></details>`;
}
/** The Rules form (docs/mission-ui.md "Forms"): the unit beside every box, the range in the box's unit, an out-of-range value
 *  said under its box with aria-invalid, Apply only when something changed and all is valid ("Apply 2 changes"), the boxes
 *  locked while a change applies; what was typed is kept on a failure and through another phone's change ("now 240 s on
 *  bitcube" under it), and cleared once applied. patchRules() keeps it current as you type, without re-rendering the boxes. */
function rulesHTML(rules) {
  const f = rulesForm(rules, rulesDraft);
  const either = busy('rules') || busy('rules-reset');
  const inOff = either || !!whyOf('rules');
  const w = either ? '' : whyOf('rules') ? whyLine('rules') : whyLine('rules-reset', 'ctl-rules');
  const rows = Object.entries(f.fields).map(([k, fd]) => `<div class="rule${fd.error ? ' bad' : ''}" data-rule="${esc(k)}">
      <div class="rule-l"><label for="rule-${esc(k)}">${esc(fd.label)}</label><span class="range" id="rule-${esc(k)}-range">${esc(nb(fd.range))}</span></div>
      <div class="box"><input type="text" inputmode="decimal" autocomplete="off" id="rule-${esc(k)}" name="${esc(k)}" value="${esc(fd.shown)}" aria-describedby="rule-${esc(k)}-range rule-${esc(k)}-err rule-${esc(k)}-now"${fd.error ? ' aria-invalid="true"' : ''} ${inOff ? 'disabled' : ''}><span class="u" aria-hidden="true">${esc(fd.unit)}</span></div>
      <div class="err" id="rule-${esc(k)}-err">${fd.error ? esc(nb(fd.error)) : ''}</div><div class="now-on" id="rule-${esc(k)}-now">${fd.now ? esc(nb(fd.now)) : ''}</div></div>`).join('');
  return `<details class="sub" data-id="rules" id="rules"${op('rules')}><summary><span>Rules</span><span class="chev" aria-hidden="true">›</span></summary>
    <form class="ctl rules-form ${(whyOf('rules') && !either) ? 'off' : ''}" id="ctl-rules" data-ctl="rules" onsubmit="return false"${either ? ' aria-busy="true"' : ''}><div class="ctl-h">The year's rules</div>${w}<div class="rules">${rows}</div>
    <div class="row-btns"><button type="button" class="btn primary" id="ctl-rules-apply" data-act="rules-apply" ${inOff || !f.canApply ? 'disabled' : ''}>${esc(f.label)}</button><button type="button" class="btn" id="ctl-rules-reset" data-act="rules-reset" ${either || whyOf('rules-reset') ? 'disabled' : ''}>Reset all to defaults</button></div>
    <div class="effect">A rule changes the behaviour from now on; it does not move the river. Reset asks first.</div>
    ${statusLine('ctl-rules', ['rules', 'rules-reset'])}</form></details>`;
}
/** As you type: each box's error and "now N on bitcube", and Apply's count, patched in place (the box under your fingers is
 *  never re-created); the section's remembered markup follows, so the next answer doesn't redraw it either. */
function patchRules() {
  const form = $('#ctl-rules'), rules = p.last?.seasons?.value?.rules;
  if (!form || !rules || !model) return;
  const f = rulesForm(rules, rulesDraft), inOff = busy('rules') || busy('rules-reset') || !!whyOf('rules');
  for (const [k, fd] of Object.entries(f.fields)) {
    const row = form.querySelector(`[data-rule="${CSS.escape(k)}"]`), inp = $(`#rule-${CSS.escape(k)}`);
    if (!row || !inp) continue;
    row.classList.toggle('bad', !!fd.error);
    if (fd.error) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
    inp.setAttribute('value', fd.shown);
    $(`#rule-${CSS.escape(k)}-err`).textContent = fd.error ? nb(fd.error) : '';
    $(`#rule-${CSS.escape(k)}-now`).textContent = fd.now ? nb(fd.now) : '';
  }
  const apply = $('#ctl-rules-apply');
  if (apply) { apply.textContent = f.label; apply.disabled = inOff || !f.canApply; }
  const steer = $('#now-steer');
  if (steer && model.show.season) lastHTML.set(steer, steerHTML(model));
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
  // from a last answer the since already ends "when last seen": the tag isn't said twice (R5 #25)
  // a piece dark while TouchDesigner restarts keeps its level before the restart in the history (Recent says the restart once),
  // so its since would be the old state's ("Attention for 3 min" on a restart seconds old): none, the band's chip says it (R7 #4)
  const since = x.level !== 'ok' && x.cause !== 'td-restarting' ? sinceSpan(x.id, x.level, [x.summary, x.detail], x) : '';
  return `<details class="row lv-${x.level}${x.stale ? ' stale' : ''}" data-id="${esc(x.id)}" id="${rid(x.id)}"${op(x.id)}><summary>
      ${mark(x.level)}<div><div class="name">${esc(NAME[x.id] ?? x.name)} <span class="state">· ${WORD[x.level]}</span></div>
      <div class="sum">${esc(nb(x.summary))}</div><div class="from">from ${FROM[x.checked_from]} · ${ageSpan(x.age_s)}${x.stale && !since ? ' · last seen' : ''}${since}</div></div><span class="chev" aria-hidden="true">›</span></summary>
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
  // map.js opens that box's sheet; the name starts with the visible words, so a voice command for what is seen matches (R5 #15)
  const links = [...(LINKS[x.id] ?? []), ['Show on the system map', `/map#${encodeURIComponent(x.id)}`, `Show on the system map: ${NAME[x.id] ?? x.name}`]];
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
  const s = m.show, route = s.ropes.route, boot = s.boot_file?.name;
  const files = s.show_files.length ? s.show_files : Object.keys(FILES).slice(0, 2);
  const lrOff = off('lightsroute'), bfOff = off('bootfile'), seen = nowOr(item(m, 'ropes'));
  return `<details class="card installer" data-id="installer" id="installer-card"${op('installer')}><summary><span class="tool" aria-hidden="true">🛠</span><span>Installer</span><span class="note">changes cabling and boot settings · confirms every change</span><span class="chev" aria-hidden="true">›</span></summary><div class="body">
    <div class="ctl ${whyOf('lightsroute') && !busy('lightsroute') ? 'off' : ''}" id="ctl-lightsroute" data-ctl="lightsroute"${busy('lightsroute') ? ' aria-busy="true"' : ''}><div class="ctl-h">Lighting network port on bitcube</div>${whyLine('lightsroute')}
      <div class="seg" role="group" aria-label="Lighting network port"><button type="button" id="ctl-lightsroute-direct" data-act="lightsroute" data-route="direct" class="${route === 'direct' ? 'lit' : ''}" aria-pressed="${route === 'direct'}" ${lrOff ? 'disabled' : ''}>LIGHTS port (white)</button><button type="button" id="ctl-lightsroute-router" data-act="lightsroute" data-route="router" class="${route === 'router' ? 'lit' : ''}" aria-pressed="${route === 'router'}" ${lrOff ? 'disabled' : ''}>Router port (spare)</button></div>
      <div class="effect">${seen.pre}: <b>${route === 'direct' ? "bitcube's LIGHTS port" : route === 'router' ? 'the spare router port' : 'not known'}</b>${seen.tail}. The wrong port leaves all 20 ropes dark. Only change it after moving the cable; it asks first.</div>
      ${statusLine('ctl-lightsroute', ['lightsroute'])}</div>
    <div class="ctl ${whyOf('bootfile') && !busy('bootfile') ? 'off' : ''}" id="ctl-bootfile" data-ctl="bootfile"${busy('bootfile') ? ' aria-busy="true"' : ''}><div class="ctl-h">Boot file: the show file that opens at boot</div>${whyLine('bootfile')}
      <div class="seg" role="group" aria-label="Boot file">${files.map((f) => `<button type="button" id="ctl-bootfile-${FILES[f]?.kind ?? 'other'}" data-act="bootfile" data-file="${esc(f)}" class="${boot === f ? 'lit' : ''}" aria-pressed="${boot === f}" ${bfOff ? 'disabled' : ''}>${esc(cap(fileLabel(f)))}</button>`).join('')}</div>
      <div class="effect">${seen.pre}: <b>${esc(bootWords(s.boot_file))}</b> opens at boot${seen.tail}. A change takes effect at bitcube's next restart and does not change what is showing now; a show-file switch sets it too. It asks first.</div>
      ${statusLine('ctl-bootfile', ['bootfile'])}</div>
    <div class="links"><a class="btn" href="/lights">Calibrate the lights → Lights</a></div>
  </div></details>`;
}

// ---- controls: the contract's states on the thing they change (docs/mission-ui.md "Applying a change") ------------------
/** "Not possible now: bitcube is offline." or "Wait: the switch to the live river is being applied." above the greyed control;
 *  never while its own change is in flight (its status line says that). */
function whyLine(name, host = `ctl-${name}`) { const w = busy(name) || ownBlock(name) ? null : whyOf(name); return w ? `<div class="ctl-why" id="why-${host}" tabindex="-1">${esc(whyText(w))}</div>` : ''; }
/** The change that blocks this control is its own (its entry still holds the lock: bitcube didn't answer it in time): its status
 *  line says so, never a "Wait: …" line about itself beside it (R8 #18). */
const ownBlock = (name) => !!model && !!ctl[name]?.entryId && model.controls[name]?.by === ctl[name].entryId;
/** A readout's lead-in: "Now" from a fresh reading; from a last answer (its item stale: an old full check, or contact lost) "Last
 *  seen", with its age after the value, never "Now" (R8 #33). */
const nowOr = (x) => (x?.stale ? { pre: 'Last seen', tail: ` · ${ageSpan(x.age_s)}` } : { pre: 'Now', tail: '' });
/** One status line per control host (its id: st-<host>), for whichever of its controls is in flight or acted last. Its ticking
 *  time is filled in by refreshAges(); it is not a live region (announce() speaks for it), and focus waits on it (tabindex -1)
 *  while its button is disabled. */
function statusLine(host, names) {
  const live = names.filter((n) => ctl[n]);
  const name = live.find(busy) ?? live.sort((a, b) => (ctl[b].s.at ?? 0) - (ctl[a].s.at ?? 0))[0] ?? names[0];
  const c = ctl[name], v = c ? controlLine(c, Date.now()) : { cls: '', spin: false, text: '' };
  const inner = !c || (!v.spin && !v.text) ? '' : v.spin ? `<span class="spin" aria-hidden="true"></span><span class="t" data-ctl-line="${esc(name)}"></span>` : `<span class="t">${esc(v.text)}</span>`;
  return `<div class="ctl-status ${v.cls}" id="st-${host}" data-ctl-status="${esc(name)}" tabindex="-1">${inner}</div>`;
}
function ropesCtlHTML(m) {
  const r = m.show.ropes, st = r.state, o = off('ropes'), seen = nowOr(item(m, 'ropes'));
  const boxes = ['rope box 1', 'rope box 2'].map((id) => item(m, id)).filter(Boolean);
  const watts = r.open && Array.isArray(r.watts) && r.watts.every((w) => w != null) ? `<div class="effect">Power${item(m, 'ropes')?.stale ? ' when last seen' : ''}: <b>${nb(`${r.watts.join(' + ')} W`)}</b>${r.cap ? ` of ${nb(`${r.cap} W`)} per box` : ''}.</div>` : '';
  return `<div class="ctl ${whyOf('ropes') && !busy('ropes') ? 'off' : ''}" id="ctl-ropes" data-ctl="ropes"${busy('ropes') ? ' aria-busy="true"' : ''}><div class="ctl-h">Ropes</div>${whyLine('ropes')}
    <div class="seg" role="group" aria-label="Ropes"><button type="button" id="ctl-ropes-on" data-act="ropes" data-dark="0" class="${st === 'river' ? 'lit' : ''}" aria-pressed="${st === 'river'}" ${o ? 'disabled' : ''}>On · showing the river</button><button type="button" id="ctl-ropes-dark" data-act="ropes" data-dark="1" class="${st === 'dark' ? 'lit' : ''}" aria-pressed="${st === 'dark'}" ${o ? 'disabled' : ''}>Dark</button></div>
    <div class="effect">${seen.pre}: <b>${esc(r.words)}</b>${seen.tail}. Dark sends black to all 20 ropes; they follow within a few seconds. Dark asks first.</div>
    ${watts}
    <div class="boxes">${boxes.map((b) => `<div class="box lv-${b.level}">${mark(b.level)}<div><b>${esc(NAME[b.id])}</b> <span class="state">· ${WORD[b.level]}</span><div class="sum">${esc(nb(b.summary))}</div></div></div>`).join('')}</div>
    ${statusLine('ctl-ropes', ['ropes'])}
    <div class="links"><a href="/lights">See every LED → Lights</a></div></div>`;
}
function hubCtlHTML(m) {
  const b = m.show.panels.brightness, cur = b == null ? null : Math.round(b * 100);
  const draft = hubDraft ?? cur, o = off('hub75'), seen = nowOr(item(m, 'hub75 panels'));
  return `<div class="ctl ${whyOf('hub75') && !busy('hub75') ? 'off' : ''}" id="ctl-hub75" data-ctl="hub75"${busy('hub75') ? ' aria-busy="true"' : ''}><div class="ctl-h">Panels brightness</div>${whyLine('hub75')}
    <div class="readout">${seen.pre}: <b>${cur == null ? 'not known' : nb(`${cur} %`)}</b>${cur != null && m.show.panels.state === 'no-sender' ? ' (no panel sender, so dark)' : ''}${seen.tail}</div>
    <div class="stepper"><button type="button" class="btn step" id="ctl-hub75-less" data-act="hub-step" data-d="-10" ${o || draft == null || draft <= 0 ? 'disabled' : ''} aria-label="Darker">−</button><output id="hub-draft" aria-label="Brightness to set, 0 to 100 %">${draft == null ? '?' : nb(`${draft} %`)}</output><button type="button" class="btn step" id="ctl-hub75-more" data-act="hub-step" data-d="10" ${o || draft == null || draft >= 100 ? 'disabled' : ''} aria-label="Brighter">+</button>
      <button type="button" class="btn primary" id="ctl-hub75-set" data-act="hub-set" ${o || draft == null || draft === cur ? 'disabled' : ''}>${draft == null ? 'Set brightness' : `Set ${nb(`${draft} %`)}`}</button>
      <button type="button" class="btn danger" id="ctl-hub75-off" data-act="hub-off" ${o || cur === 0 ? 'disabled' : ''}>Panels off</button></div>
    <div class="effect">A change shows on the panels within a few seconds. Panels off sets ${nb('0 %')} and asks first.</div>
    ${statusLine('ctl-hub75', ['hub75'])}</div>`;
}
/** The show-file control: every file (the TouchDesigner row: where 'td'), or only the files of one kind (the Season card and
 *  the year's row: the river's year). A switch also sets the boot file (probe.ps1 writes boot-file.txt), and says so. */
function showfileCtlHTML(m, onlyKind = null, where = onlyKind ? 'year' : 'td') {
  const s = m.show, all = s.show_files.length ? s.show_files : Object.keys(FILES).slice(0, 2);
  // only the river's year and the live river: model.js leaves old show files out of show_files (execution plan D27)
  const files = onlyKind ? all.filter((f) => FILES[f]?.kind === onlyKind) : all;
  const running = s.file?.name, o = off('switch'), host = `ctl-switch-${where}`, td = item(m, 'touchdesigner');
  const btns = files.map((f) => `<button type="button" id="${host}-${FILES[f]?.kind ?? 'other'}" class="btn ${f === running ? '' : 'primary'}" data-act="switch" data-file="${esc(f)}" ${o ? 'disabled' : ''}>${f === running ? `Restart on ${esc(fileLabel(f))}` : `Switch to ${esc(fileLabel(f))}`}</button>`).join('');
  return `<div class="ctl ${whyOf('switch') && !busy('switch') ? 'off' : ''}" id="${host}" data-ctl="switch"${busy('switch') ? ' aria-busy="true"' : ''}><div class="ctl-h">Show file</div>${whyLine('switch', host)}
    <div class="readout">${readoutWords(s, td)}</div>
    <div class="row-btns">${btns}</div>
    <div class="effect">Switching restarts TouchDesigner on that file: the lights go dark for about a minute and unsaved changes in TouchDesigner are lost. That file then also opens at boot. It asks first.</div>
    ${statusLine(host, ['switch'])}</div>`;
}

/** The Show file readout: "Now showing the river's year · opens at boot: …"; "Restarting on …" while TouchDesigner restarts (R7 #18);
 *  "Maybe restarting on …" while a restart bitcube didn't answer in time holds the lock and TouchDesigner is seen down (R8 #16);
 *  from a last answer "Last seen: showing … · 15 min ago", never "Now" (R8 #33). */
function readoutWords(s, td) {
  const boot = s.boot_file ? ` · opens at boot: ${esc(bootWords(s.boot_file))}` : '';
  if (td?.stale && s.file) return `Last seen: showing <b>${esc(s.file.label)}</b>${boot} · ${ageSpan(td.age_s)}`;
  if (s.file) return `Now showing <b>${esc(s.file.label)}</b>${boot}`;
  if (s.restart) return `Restarting on <b>${esc(s.restart.on)}</b>${boot}`;
  if (s.held) return `Maybe restarting on <b>${esc(s.held.on)}</b>: bitcube didn't answer in time${boot}`;
  return `What is showing <b>isn't known</b>${boot}`;
}
/** Where focus waits for a control: its host's status line (the host the press came from). */
function statusEl(name) {
  const c = ctl[name], own = c?.host ? document.getElementById(`st-${c.host}`) : null;
  if (own) return own;
  // its host is gone (the Season card's Switch now once the year runs): the same control's line where it is drawn (R7 #7)
  const all = [...document.querySelectorAll(`.ctl-status[data-ctl-status="${CSS.escape(name)}"]`)];
  return all.find((x) => drawn(x)) ?? all[0] ?? null;
}
function focusStatus(name) { const st = statusEl(name); if (st && st.isConnected) st.focus({ preventScroll: true }); }
/** A change ended: focus that waited on its status line (or was nowhere) goes back to the button that started it, when it can
 *  hold it again; a failure keeps focus on the control. A change that ends never pulls focus from elsewhere on the page. */
function afterEnd(name) {
  const c = ctl[name], a = document.activeElement, st = statusEl(name);
  if (!c || busy(name)) return;
  if (!(a === st || !a || a === document.body || !a.isConnected)) return;
  if (document.querySelector('dialog[open]')) return;
  if (c.key) refocus(c.key, document, st);
  rescueFocus(name);              // never left on <body> when the button that started it is gone (R7 #7)
}
/** Before every render: a change confirming (or unconfirmed: a phone that slept through it, a lost answer) is done when a reading
 *  taken after it answered shows it; a done line gives way to a newer reading that no longer shows what it claims; a confirm left
 *  open for a control that became impossible is withdrawn ("Not sent at 21:04: <why>"). Returns the controls withdrawn (focus
 *  goes to their status line) and ended (focus that waited there goes back to the button). */
function settleControls() {
  const withdrawn = [], ended = [], now = Date.now();
  for (const [name, c] of Object.entries(ctl)) {
    // only a reading taken after the answer can confirm the change or take a done line away
    const fresh = !!model && !lostContact(model) && p.receivedAt != null && c.refreshAt != null && p.receivedAt > c.refreshAt;
    const waiting = c.s.state === 'confirming' || c.s.state === 'unconfirmed';
    // an answer lost on the way back named no entry: the request id this page sent finds it (R8 #2)
    if (fresh && waiting && !c.entryId && c.requestId) c.entryId = entryIdOf(model, c.requestId);
    // a held change says when its lock ends by the server's own entry once it is in, so its line and every other "Wait: …" agree
    if (c.held && c.s.state === 'unconfirmed' && model) {
      const e = model.show.applying.find((x) => x.id === c.entryId);
      if (e?.unlock_at != null) c.text = heldWords(c.o?.what, sclock(e.unlock_at));
    }
    if (fresh && waiting && (c.o?.serverConfirms || (c.s.state === 'unconfirmed' && c.entryId))) {
      // the server's verdict on this control's own entry (by id): never the reading's words, which name the same file before and
      // after a restart (R7 #6, #25). When it can't be known (no id: an answer that never came; or no list names it: over 10 min,
      // a restart of the server), a switch to another file or a boot-file change is done once a reading taken after the send
      // shows it (c.sent, CR7 #4); a restart or a rebuild only by its own limit. A quick change whose answer was lost (ropes,
      // panels, the year's) is done once its entry, found by its request id, is confirmed (R8 #2)
      const v = serverJudged(model, c.entryId, c.sent);   // c.sent: only a switch or boot-file change says what it sent
      c.judgedWall = p.receivedWall;
      if (v === 'confirmed') { c.s = ctlStep(c.s, { type: 'model', confirmed: true, now }); finish(name); ended.push(name); }
      else if (v === 'expired' && c.s.state === 'confirming') { c.s = ctlStep(c.s, { type: 'expired', now }); unconfirm(name); ended.push(name); }
      // one that may or may not have happened, which the server then gave up on: bitcube didn't show it (said once)
      else if (v === 'expired' && !c.saidExpired) { c.saidExpired = true; unconfirm(name); ended.push(name); }
    } else if (fresh && (c.s.state === 'confirming' || c.s.state === 'unconfirmed') && typeof c.o?.confirmed === 'function') {
      let yes = false;
      try { yes = !!c.o.confirmed(model); } catch (e) { console.warn('confirmed', e); }
      c.judgedWall = p.receivedWall;          // the tick may turn it unconfirmed only after a reading past its limit was judged
      if (yes) { c.s = ctlStep(c.s, { type: 'model', confirmed: true, now }); finish(name); ended.push(name); }
    } else if (fresh && c.s.state === 'done' && typeof c.o?.holds === 'function') {
      let holds;
      try { holds = !!c.o.holds(model); } catch (e) { console.warn('holds', e); }
      const next = ctlStep(c.s, { type: 'reading', holds, why: whyOf(name), now });
      if (next.effect === 'drop') c.text = '';   // "Now on …" beside a Now line that says dark: the claim goes (R6 #30)
      c.s = next;
    } else if (c.s.state === 'confirm' && c.asking) {
      const w = whyOf(name);
      const next = ctlStep(c.s, { type: 'why', why: w, now });
      if (next.effect === 'withdraw') {
        const a = c.asking; c.asking = null;
        c.s = next; c.text = notSentText(w, sclock());
        announce(c.text);
        a.close();
        withdrawn.push(name);
      }
    }
  }
  return { withdrawn, ended };
}
/** Every second: a change confirming too long turns unconfirmed (never "unchanged": it may yet show), but only once a reading
 *  taken after its limit has been judged: never by the clock alone, so a phone that slept through it (its clock jumps on waking)
 *  or has no contact waits for the next reading (R6 #0). */
function tickControls() {
  let changed = false;
  if (!p.last || p.elapsed() > LOST_MS || lostContact(model)) return;
  for (const [name, c] of Object.entries(ctl)) {
    if (c.s.state !== 'confirming') continue;
    const n = ctlStep(c.s, { type: 'tick', expectS: c.expectS, now: Date.now(), readAt: c.judgedWall ?? null });
    if (n.state === c.s.state) continue;
    c.s = n;
    unconfirm(name);
    changed = true;
    queueMicrotask(() => afterEnd(name));
  }
  if (changed) render();
}
/** Unconfirmed: it names what was sent, "The boot file change to the live river was sent at 21:13, but bitcube doesn't show it yet:
 *  …" (R6 #16), said once. */
function unconfirm(name) {
  const c = ctl[name];
  c.text = unconfirmedWords(c.o?.what, sclock(c.sentServer ?? serverNow()), c.o?.unconfirmed ?? 'look at the Now line, or call Gavin');
  announce(c.text);
}
/** Done: "<done> · 21:04" (the server's clock), said once; the form's draft cleared. */
function finish(name) {
  const c = ctl[name], r = c.result;
  const d = typeof c.o.done === 'function' ? c.o.done(r) : c.o.done;
  c.text = `${d} · ${sclock()}${r?.fixture ? ' (fixture mode: nothing really changed)' : ''}`;
  announce(c.text);
  try { c.o.onDone?.(r); } catch (e) { console.warn('onDone', e); }
}
/** Press → (confirm) → applying → done, or confirming until bitcube's reading shows it, or failed / unconfirmed; on the control
 *  itself, with one announcement each. o: { btn, ask, what, pending, done, fail, kept, confirmed(model), noAnswer, unconfirmed, onDone }. */
async function runControl(name, path, body, o) {
  const c = C(name);
  if (c.asking || busy(name)) return;
  c.key = o.btn ? focusKey(o.btn) : null;
  c.host = o.btn?.closest('[data-ctl]')?.id ?? null;
  const ask = typeof o.ask === 'function' ? o.ask() : o.ask;
  let next = ctlStep(c.s, { type: 'press', why: whyOf(name), confirm: !!ask, now: Date.now() });
  if (next.effect === 'confirm') {
    c.s = next;
    const pr = confirm(ask);
    c.asking = pr;
    const yes = await pr;
    if (c.asking !== pr) return;               // withdrawn meanwhile (settleControls): it already says "Not sent"
    c.asking = null;
    // judged again now it is answered: a control that became impossible meanwhile sends nothing
    model = p.last ? derive(p.last, p.last.now + p.elapsed()) : null;
    next = ctlStep(c.s, { type: yes ? 'yes' : 'no', why: whyOf(name), now: Date.now() });
    if (next.notSent) { c.s = next; c.text = notSentText(next.notSent, sclock()); announce(c.text); render(); focusStatus(name); return; }
  }
  if (next.effect !== 'send') { c.s = next; render(); return; }
  // applying: the control, its siblings and its inputs locked; focus waits on its status line
  // what was sent, and when on the server's clock, for when the server's verdict can't be known (CR7 #4)
  let sent = null;
  try { sent = typeof o.sent === 'function' ? { ...o.sent(model), sentAt: p.last ? p.last.now + p.elapsed() : null } : null; } catch { sent = null; }
  // the page's own id for this press, sent with it: a page whose answer is lost still finds its entry and verdict by it (R8 #2)
  const requestId = name === 'check' ? null : newRequestId();
  Object.assign(c, { s: next, text: '', o: { holds: o.confirmed, ...o }, result: null, refreshAt: null, judgedWall: null, entryId: null, requestId, saidExpired: false, held: false, sent,
    sentServer: serverNow(), expectS: EXPECT_S[name] ?? null, usual: name === 'bootfile' ? BOOT_USUAL : null, applyText: o.pending ?? M.applyingText(o.what) });
  for (const other of SHARE[name] ?? []) if (ctl[other] && !busy(other)) ctl[other] = { s: ctlInit(), text: '' };
  const a = document.activeElement, idle = !a || a === document.body, here = !!(a && c.host && document.getElementById(c.host)?.contains(a));
  announce(c.applyText.replace(/…$/, ''));     // said once, never with a ticking time
  if (name === 'check') shell.setChecking(true);
  render();
  if (idle || here) focusStatus(name);
  // the server records the change as it arrives: ask for the status at once, so the lock (and "Wait: …" on what it blocks)
  // shows on this page within a second, not at the next poll
  setTimeout(() => p.refresh(), 300);
  let r;
  try { r = await api(path, requestId ? { ...body, request_id: requestId } : body); }
  catch (e) {
    c.entryId = typeof e?.applyingId === 'string' ? e.applyingId : null;   // a maybe answer still names its entry
    const maybe = !!(e?.maybe || (e?.noAnswer && e?.posted));
    c.s = ctlStep(c.s, { type: 'error', maybe, now: Date.now() });
    // bitcube didn't answer a change whose lock holds (the server keeps its entry to its limit): one state on the control, when
    // the buttons unlock, never a "Wait: …" about itself above it (R8 #18)
    const held = maybe && e?.serverMaybe && c.entryId && MAYBE_HOLDS.includes(name);
    c.held = !!held;
    c.text = held ? heldWords(o.what, sclock(serverNow() + confirmLimitS(EXPECT_S[name]) * 1000))
      : maybe ? noAnswerText(e, o.noAnswer ?? 'the Now line shows what bitcube reports', serverNow()) : failText(o.fail, e, sclock(), o.kept);
    announce(c.text);
    if (name === 'check') shell.setChecking(false);
    c.refreshAt = performance.now(); p.refresh();
    render(); afterEnd(name);
    return;
  }
  if (name === 'check') shell.setChecking(false);
  c.result = r;
  c.entryId = typeof r?.applying_id === 'string' ? r.applying_id : null;
  c.s = ctlStep(c.s, { type: 'ok', confirmed: typeof o.confirmed === 'function' || o.serverConfirms ? false : null, now: Date.now() });
  if (c.s.state === 'done') finish(name);
  else if (c.s.state === 'confirming') announce(CONFIRMING_SAID);   // said once, never with its time (R6 #9)
  // a reading asked for from now on is taken after the answer: only such a reading can confirm the change
  c.refreshAt = performance.now(); p.refresh();
  render(); afterEnd(name);
}

// ---- sheets and jumps -----------------------------------------------------------------------------------------------------
function openStill() {
  const g = stills.gallery;
  if (!g.url) return;
  sheet({ title: 'The room', body: `<img class="still-img" src="${g.url}" alt="The gallery camera's latest still"><p class="secondary muted">Taken <span data-still="gallery">${dur(stillAge('gallery'))} ago</span>, fetched through bitcube. The picture refreshes about every 30 s.</p>` });
}
function jump(target) {
  if (!goto(target)) return false;
  const el = document.getElementById(target);
  for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) if (d.dataset.id) openRows.add(d.dataset.id);
  return true;
}
/** "Switch now": the TouchDesigner row when it is not OK, else the Season card's control, else the year's row. Returns where. */
function jumpSwitch() {
  for (const id of [model && item(model, 'touchdesigner')?.level !== 'ok' ? rid('touchdesigner') : null, 'switch-now', rid('seasons'), rid('touchdesigner')]) {
    if (id && document.getElementById(id)) { jump(id); return id; }
  }
  return null;
}
/** After a jump from the band (or a tile, or an Also item), keyboard and screen-reader focus go with it, not only the scroll (R7 #9):
 *  the button the jump names ("Restart on the river's year") when it can be pressed, else the line that says why it can't; for a
 *  row or a group, its summary or heading. */
function jumpFocus(target, label = null) {
  const el = target && document.getElementById(target);
  if (!el) return;
  if (label) {
    const btn = [...el.querySelectorAll('button[data-act="switch"]')].find((x) => x.textContent.trim() === label);
    if (btn && !btn.disabled && focusShown(btn)) return;
    const host = (btn ?? el).closest('[data-ctl]') ?? el.querySelector('[data-ctl="switch"]');
    if (host && park(host)) return;
  }
  const f = el.matches('details') ? el.querySelector(':scope > summary') : el.querySelector('details > summary, h3, h2, summary') ?? el;
  focusShown(f);
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
    const server = p.last?.seasons?.value?.rules?.[inp.name]?.value;
    // what is typed is kept as typed (an empty box too: it says what it must be); back to bitcube's value, it is no change
    if (server != null && inp.value.trim() !== '' && Number(inp.value) === Number(server)) delete rulesDraft[inp.name]; else rulesDraft[inp.name] = inp.value;
    patchRules();
    // a new error under the box is said once, after a pause in typing (never at every keystroke) (R6 #10)
    clearTimeout(ruleSayTimer);
    const k = inp.name;
    ruleSayTimer = setTimeout(() => {
      const fd = rulesForm(p.last?.seasons?.value?.rules, rulesDraft).fields[k];
      if (!fd?.error) { delete ruleSaid[k]; return; }
      if (ruleSaid[k] === fd.error || document.activeElement?.name !== k) return;
      ruleSaid[k] = fd.error;
      announce(`${fd.label}: ${fd.error[0].toLowerCase()}${fd.error.slice(1)}.`);
    }, 900);
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-act="still"]')) { e.preventDefault(); openStill(); }
  // Enter in a rule's box applies the form when it can, as a form would
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.closest('form.rules-form')) { e.preventDefault(); const b = $('#ctl-rules-apply'); if (b && !b.disabled) b.click(); }
});
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act, m = model;
  switch (act) {
    case 'goto': if (jump(b.dataset.target)) jumpFocus(b.dataset.target); break;
    case 'goto-switch': jumpFocus(jumpSwitch(), b.textContent.trim()); break;
    case 'still': openStill(); break;
    case 'checknow': {
      const offline = !!m && item(m, 'bitcube')?.level === 'down';
      runControl('check', '/api/control/check', {}, { btn: b, pending: offline ? 'Asking bitcube again…' : 'Asking bitcube to check everything now…',
        done: offline ? 'Asked bitcube again; the page updates if it answers' : 'Check started; the page updates as answers come in', fail: "The check didn't start",
        noAnswer: 'the page updates if it ran',
        onDone: () => setTimeout(() => { if (ctl.check?.s.state === 'done') { ctl.check = { s: ctlInit(), text: '' }; render(); } }, 20_000) });
      break;
    }
    case 'ropes': {
      const dark = b.dataset.dark === '1';
      runControl('ropes', '/api/control/ropes', { dark }, { btn: b,
        ask: dark ? { title: 'Make the ropes dark?', body: 'The ropes in the gallery go black now and stay black until someone presses On. The panels keep showing the river.', ok: 'Go dark', cancel: 'Keep showing the river' } : null,
        what: changeLabel('ropes', { dark }), done: dark ? 'Now dark: the ropes go black within a few seconds' : 'Now on: the ropes show the river again within a few seconds', fail: 'The ropes are unchanged',
        holds: (mm) => mm.show.ropes.state === (dark ? 'dark' : 'river') });
      break;
    }
    case 'hub-step': { const cur = m?.show.panels.brightness == null ? null : Math.round(m.show.panels.brightness * 100); if (cur == null && hubDraft == null) break; hubDraft = clamp((hubDraft ?? cur) + Number(b.dataset.d), 0, 100); render(); announce(`${hubDraft} %`); break; }
    case 'hub-set': { const v = hubDraft; runControl('hub75', '/api/control/hub75', { brightness: v / 100 }, { btn: b, what: changeLabel('hub75', { brightness: v / 100 }), done: `Now ${nb(`${v} %`)}: it shows on the panels within a few seconds`, fail: 'The panels are unchanged',
      holds: (mm) => mm.show.panels.brightness != null && Math.round(mm.show.panels.brightness * 100) === v, onDone: () => { hubDraft = null; } }); break; }
    case 'hub-off': runControl('hub75', '/api/control/hub75', { brightness: 0 }, { btn: b, ask: { title: 'Switch the panels off?', body: `The panels in the gallery go dark now (brightness ${nb('0 %')}). Set a brightness to bring them back.`, ok: 'Panels off', cancel: 'Keep them on' },
      what: changeLabel('hub75', { brightness: 0 }), done: `Now off (${nb('0 %')}); set a brightness to bring them back`, fail: 'The panels are unchanged',
      holds: (mm) => mm.show.panels.brightness === 0, onDone: () => { hubDraft = null; } }); break;
    case 'mode': { const md = b.dataset.mode; runControl('mode', '/api/control/mode', { mode: md }, { btn: b, what: changeLabel('mode', { mode: md }), done: `Now ${cap(md)}${md === 'manual' ? ': taken over by hand' : ''}`, fail: 'The mode is unchanged',
      noAnswer: 'the lit Mode button and the Season card show the mode bitcube reports', holds: (mm) => mm.show.mode?.id === md }); break; }
    case 'tseason': targetDraft.season = b.dataset.season; render(); break;
    case 'tint': { const t = targetForm(m?.show.target, targetDraft, m?.show.intensity?.value ?? 0.5); targetDraft.intensity = Math.round(clamp(t.intensity + Number(b.dataset.d), 0, 1) * 10) / 10; render(); announce(`${M.intensityWord(targetDraft.intensity)} (${targetDraft.intensity.toFixed(1)})`); break; }
    case 'target-set': {
      const t = targetForm(m?.show.target, targetDraft, m?.show.intensity?.value ?? 0.5);
      if (!t.canApply) break;
      const word = M.intensityWord(t.intensity);
      runControl('target', '/api/control/target', { season: t.season, intensity: t.intensity }, { btn: b, what: changeLabel('target', { season: t.season, intensity: t.intensity }),
        done: `Now heading for ${t.season}, ${word}: the river travels there by hand`, fail: 'The target is unchanged', kept: 'Your choice is kept.',
        noAnswer: 'the Season card says where bitcube is heading', holds: (mm) => mm.show.target?.season === t.season && Math.abs((mm.show.target?.intensity ?? -1) - t.intensity) < 0.05,
        onDone: () => { targetDraft.season = null; targetDraft.intensity = null; } });
      break;
    }
    case 'rules-apply': {
      const f = rulesForm(p.last?.seasons?.value?.rules, rulesDraft);
      if (!f.canApply) break;
      const n = Object.keys(f.changed).length, sent = { ...rulesDraft };
      runControl('rules', '/api/control/rules', { rules: f.changed }, { btn: b, what: changeLabel('rules', { rules: f.changed }), done: `${plural(n, 'rule')} changed; ${n === 1 ? 'it applies' : 'they apply'} from now on`,
        fail: 'The rules are unchanged', kept: 'What you typed is kept.', noAnswer: 'a box whose value bitcube doesn\'t have says "now … on bitcube" under it',
        holds: () => Object.entries(f.changed).every(([k, v]) => Number(p.last?.seasons?.value?.rules?.[k]?.value) === v),
        // only what was sent is cleared: a box typed into meanwhile keeps its draft
        onDone: () => { for (const [k, v] of Object.entries(sent)) if (rulesDraft[k] === v) delete rulesDraft[k]; } });
      break;
    }
    case 'rules-reset': runControl('rules-reset', '/api/control/rules-reset', {}, { btn: b, ask: { title: 'Reset every rule to its default?', body: 'All the numbers go back to their defaults from now on. The river itself does not move.', ok: 'Reset all', cancel: 'Keep them' },
      what: changeLabel('rules-reset'), done: 'Every rule is back at its default, from now on', fail: 'The rules are unchanged', noAnswer: 'the boxes show the values bitcube has', onDone: () => { for (const k of Object.keys(rulesDraft)) delete rulesDraft[k]; } }); break;
    case 'switch': {
      const f = b.dataset.file, w = switchWords(f, m?.show.file?.name, m?.show.boot_file);   // the button's own words
      runControl('switch', '/api/control/switch', { file: f }, { btn: b, ask: () => { const x = switchWords(f, model?.show.file?.name, model?.show.boot_file); return { title: x.title, body: x.body, ok: x.ok, cancel: 'Leave it' }; },
        what: w.what, done: w.done, fail: 'The show file is unchanged', serverConfirms: true, holds: (mm) => switchShows(mm, f),
        sent: (mm) => ({ action: 'switch', file: f, before: mm?.show.file?.name ?? null }),
        noAnswer: 'the Now line shows what bitcube reports', unconfirmed: 'look at the Now line, or call Gavin' });
      break;
    }
    case 'bootfile': {
      const f = b.dataset.file, label = fileLabel(f);
      runControl('bootfile', '/api/control/bootfile', { file: f }, { btn: b, ask: { title: `Open ${label} at boot?`, body: 'From the next restart of bitcube, TouchDesigner opens this file. What is showing now does not change.', ok: 'Change the boot file', cancel: 'Leave it' },
        what: changeLabel('bootfile', { file: f }), done: `Now ${label} opens at boot, from bitcube's next restart`, fail: 'The boot file is unchanged', serverConfirms: true, holds: (mm) => bootShows(mm, f),
        sent: (mm) => ({ action: 'bootfile', file: f, before: mm?.show.boot_file?.name ?? null }),
        noAnswer: 'the Now line shows what bitcube reports' });
      break;
    }
    case 'lightsroute': {
      const route = b.dataset.route, where = route === 'direct' ? "bitcube's LIGHTS port" : 'the spare router port';
      runControl('lightsroute', '/api/control/lightsroute', { route }, { btn: b, ask: { title: route === 'direct' ? "Use bitcube's LIGHTS port?" : 'Use the spare router port?', body: 'Moves the lighting network to that port. If the lighting switch is plugged into the other one, all 20 ropes go dark until it is moved back.', ok: 'Change the port', cancel: 'Leave it' },
        // done on the server's verdict: an answer that reads another port, or none in time, waits for a full check that shows it (R8 #31)
        what: changeLabel('lightsroute', { route }), done: `Now the lighting network is on ${where}`, fail: 'The port is unchanged', serverConfirms: true, holds: (mm) => mm.show.ropes.route === route });
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
