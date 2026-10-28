// Mission control v2: the Lights page (docs/mission-ui.md, "Lights" and "Calibrate"). For Colin, Andi, Gavin and Will:
// does it look right, where is every LED, calibrating. Every verdict and sentence comes from derive() in /model.js and the
// page's own words from /lights-words.js; this page only lays them out, draws the LED map (GET /api/pixelmap) and what
// TouchDesigner is sending (GET /api/lights), and runs the Calibrate block from GET /api/calibration. Its controls (Calibrate,
// Dry run, Stop, Use this map) follow the contract in "Applying a change" through ui.js control(). Every fetch has a time
// limit, and what couldn't be read is asked for again by itself. Plain ES module, no build step, no framework.
import { mountShell, poll, tick, watchContact, art, fmt, control, api, esc, mark, plainError, DOC_LINKS, splitHeadline, announce, unannounce, setLive, goto, bringIntoView,
  WARN_MS, LOST_MS, POLL_TIMEOUT_MS, serverNow, serverClock } from '/ui.js';
import { fetchTimed } from '/app.js';
import { derive, changeLabel, dur, FILES, CAL_STAGE_S, CAL_TOTAL_S, CAL_STAGE_WORDS, CAL_STAGES, EXPECT_S, ownEntries, endedOnce, START_USUAL, calDryRun, calStep, ownMemory } from '/model.js';
import { decodeLights, fitCanvas, paintStrips, paintScreens, paintEmpty } from '/frames-view.js';
import { calChecklist, ROOM_CHECK, startWhy, dryWhy, calView, rebuiltFor, runNote, nextLine, captureWhen, driftWords, resultWords,
  mapMissing, placeLabels, DRIFT_FINE_PX, NO_CONTACT, calRead, calLeft, changeSince, stateLevel, applyingNow, stateParts, CAL_COPY, runFine,
  resultHead, CAL_CTL, calNewer, stateWords } from '/lights-words.js';

const N_ROPES = 20, LEDS = 400;
const LIGHTS_MS = 10_000, CAL_MS = 5_000, STILL_MS = 30_000, FRAME_OLD_S = 30, PROBE_OLD_S = 120;
const MAP_RETRY_MS = 30_000, MAP_RETRY_MIN_MS = 10_000;   // the LED map, until it loads: on a good status answer (10 s apart), else every 30 s
const INSTALL_DAY = '20261022';           // the lift at Gray Area: a map captured before this day was made elsewhere (Agape)
const OLD_RUN_S = 15 * 60;                // a run that ended this long before the page opened is not shown as a result
// one set of stage words with the Status band (model.js CAL_STAGE_WORDS)
const STAGE_WORDS = { ...Object.fromEntries(Object.entries(CAL_STAGE_WORDS).map(([k, v]) => [k, v[0].toUpperCase() + v.slice(1)])), done: 'Done' };
const STAGE_ORDER = [...CAL_STAGES, 'done'];
const YEAR_FILE = Object.keys(FILES).find((f) => FILES[f].kind === 'year');
const $ = (sel) => document.querySelector(sel);
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s ?? '');
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
/** Seconds since a moment recorded as { at: performance.now(), wall: Date.now() }: the larger of the monotonic and the wall
 *  clock's view, so a phone that slept (its monotonic clock paused) never shows an hour-old picture as seconds old. */
const since = (at, wall) => Math.max(0, (performance.now() - at) / 1000, wall != null ? (Date.now() - wall) / 1000 : 0);
const ropeHue = (r) => `hsl(${(r * 137.5) % 360} 85% 62%)`;   // golden-angle spacing: neighbours never share a hue
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- state ------------------------------------------------------------------------------------------------------
const S = {
  m: null,                                   // the model, from the last /api/status
  lights: { frames: null, at: null, age_s: null, error: null, failedAt: null, bytes: null, panelBytes: null, dark: null, fetching: false },
  map: { map: null, screens: null, still: null, error: null, ropes: null, loaded: false, askedAt: performance.now(), fetching: false, triedAt: null },
  // the calibration: p the last good progress, heardAt/heardWall when it was read, error the last read's failure (null: fine),
  // rebuilt the server's last rebuild { at, map, file }
  cal: { p: null, heardAt: null, heardWall: null, error: null, timer: null, rebuilt: null, old: false, seenStarted: false, pending: false, fetching: false, announceOk: false },
  room: { on: false, url: null, age_s: null, at: null, error: null, timer: null, fetching: false },
  view: 'auto',                              // 'auto' (Live while frames flow, else Map) | 'map' | 'live'
  hi: null,                                  // the highlighted rope (0-based) or null
  html: {},                                  // last rendered HTML per part: never re-render under a thumb
  calCtl: {},                                // the Calibrate block's live controls: { start, dry } | { stop } | { rebuild }
  chips: [],                                 // each rope chip's last inner HTML (the buttons stay; only what changed is painted)
  rebuildingElsewhere: false,                // a rebuild in status.applying: when it ends, /api/calibration says which map is in use
};
// this page's own changes: the server's entries its answers named (applying_id) and the request ids it sent (R8 #2), never "another
// phone's" (R7 #14, R9 #6); kept as Status keeps its own (model.js ownMemory: the newest 20 of each, CR9 #15)
const mine = ownMemory();
// how another phone's change ended, said once by its id, never on the page's first answer (R9 #5, #17, #30)
const endedNews = endedOnce();

const shell = mountShell({ page: 'lights', title: 'Lights' });
const status = poll('/api/status', { every: 5000,
  onData: () => { shell.setAge(0); shell.setStale(null); S.m = model(); render(); judgeControls(); watchCalibration(); watchRebuilds(); retryMap(false); calArrival(); },
  onError: () => { S.m = model(); render(); } });   // before any answer, watchContact's header says "No answer yet · N s"
/** The model, with the calibration from a newer progress read when that shows the run ended (the status's copy can be up to a
 *  poll behind): Rebuild on a run's result is never blocked by the run that just ended (R7 #31). */
function model() { return status.last ? derive(calNewer(status.last, S.cal.p), serverNow()) : null; }
/** Each new status answer: the Calibrate block's controls that wait for the server's verdict on their own entry (a start held as
 *  'starting', a rebuild while TouchDesigner restarts) are judged on it (ui.js control serverConfirms). */
function judgeControls() {
  if (!S.m || pageDown()) return;
  for (const c of Object.values(S.calCtl)) if (c?.button.isConnected) c.update({ model: S.m, readAt: status.receivedWall });
  if (S.testCtl?.button.isConnected) S.testCtl.update({ model: S.m, readAt: status.receivedWall });
}
// the shared rule (ui.js): greyed and bannered from the time since the last answer, so a hung request counts too
const contact = watchContact(status, shell, () => { S.m = model(); render(); });
const pageDown = () => contact.lost;

// ---- render: every part, in page order -----------------------------------------------------------------------------
function render() {
  const m = S.m;
  art.setSeason(m?.show.weights ?? null);
  // which changes in flight are this page's own: once a render, for the state line and Calibrate's reasons alike (CR9 #17)
  const own = ownChanges();
  renderStateLine(own); renderMapCard(); renderChips(); renderStrips(); renderProvenance(); renderTest(own); renderCalibrate(own); renderFooter();
}
const put = (id, html) => { if (S.html[id] !== html) { S.html[id] = html; const el = document.getElementById(id); if (el) el.innerHTML = html; } };

/** The probe's age as of now: the model's age (the server's clock) plus the time since that answer arrived, so it ticks. */
function probeAge() { const a = S.m?.overall.checked.probe_age_s; return a == null || status.receivedAt == null ? a ?? null : a + status.elapsed() / 1000; }

// ---- the state line: show.ropes.words · show.panels.words · from bitcube · N s ago ---------------------------------------
function renderStateLine(own = null) {
  const m = S.m;
  if (!m) {
    // the header's thresholds (ui.js WARN_MS, LOST_MS), from when the page started asking: one fact, one wording everywhere
    const ms = performance.now() - status.startedAt;
    put('state-words', ms > LOST_MS ? "This page can't reach mission control." : ms > WARN_MS ? `No answer from mission control yet · ${fmt.nb(dur(ms / 1000))}` : 'Connecting to mission control…');
    put('state-from', ''); put('state-next', ''); paintApplying([]); sayState(ms > LOST_MS ? "This page can't reach mission control." : ''); return;
  }
  // show.ropes.words says "in calibration patterns" during a run (the model's own state), so the line needs no exception
  // a restart's dark ropes and panels said once (R8 #24)
  const words = stateWords(m);
  const lost = m.overall.cause === 'page' || pageDown();
  const ropesItem = m.items.find((x) => x.id === 'ropes');
  // one rule with Status and the map: the item's own stale flag says whether this is a last answer
  const stale = !lost && !!ropesItem?.stale;
  // the line speaks for the ropes and the panels, so its mark is the worse of the two; a last answer is never green, and nor
  // is a reading from before a change in flight that alters the lights (a restart: the ropes go dark meanwhile)
  const a = probeAge(), pr = m.sources.probe;
  const levels = [levelOf('ropes'), levelOf('hub75 panels')];
  const change = lost || stale ? null : changeSince(m, a);
  const before = !!change && stateLevel({ levels }) === 'ok';   // the model still says all is well: say the reading is older
  const lv = stateLevel({ levels, lost, stale, change });
  put('state-words', `<span class="lv-${lv}">${mark(lv)}</span> ${esc(fmt.nb(words))}`);   // "100 %" never splits
  const from = lost ? `No contact with mission control for ${fmt.nb(dur(status.elapsed() / 1000))}: this is how it was at ${fmt.clock(status.last.now, status.last.now)}`
    : m.overall.cause === 'bitcube-offline' ? 'bitcube is offline'
    : a == null ? 'Not checked yet'
    : pr.present && !pr.ok ? `bitcube's full check failed · ${fmt.nb(dur(a))} ago`
    : stale ? `last seen from bitcube ${fmt.nb(dur(a))} ago: this is how it was then`
    : before ? `from bitcube · ${fmt.nb(dur(a))} ago, before ${change.label}`
    : `from bitcube · ${fmt.nb(dur(a))} ago`;
  const el = $('#state-from');
  el.textContent = from;
  el.className = `from muted${lost || stale || (a != null && a > PROBE_OLD_S) ? ' old' : ''}`;
  // when it isn't OK, the band's headline cause (once: not when the line above says it) and where to act (Lights has no band)
  const nx = lost ? null : nextLine(m, from, splitHeadline, words);
  put('state-next', nx ? `${nx.text ? `<span>${esc(fmt.nb(nx.text))}</span> ` : ''}${nx.href ? `<a href="${nx.href}"${nx.href.startsWith('#') ? ' data-jump="calibrate"' : ''}>${esc(nx.link)}</a>` : ''}` : '');
  // the band's quiet line for a change in flight from another phone or the chat (this page's own is said on its control)
  own ??= ownChanges();
  const lines = lost ? [] : applyingNow(m, own);
  paintApplying(lines);
  // and, once by its id, how another phone's change ended (R8 #9, R9 #5)
  // a calibration's or a dry run's start that showed its run is said by the Calibrate block's new view ("Dry run started; …"), never
  // also as "Done: the dry run start." in the same breath (R10 #20); one bitcube didn't show in time still is
  const ended = lost || !status.last ? [] : endedNews(m, { ownIds: own.ids, skip: (e, verdict) => e.action === 'calibrate' && verdict === 'confirmed' }, serverClock());
  sayState(stateParts({ words, lost, stale, applying: lines }), ended);
}
/** Screen readers hear the state line's words when they change, never a ticking time (lights.html #state-live; lights-words
 *  stateParts drops "for about 40 s more" and the changes' m:ss); only what is new (R9 #5), and how a change ended once. */
function sayState(t, once = []) { setLive($('#state-live'), t, { once }); }   // through the page's one queue (R8 #11)
/** This page's own changes: their controls say them, so the state line doesn't. Its entries by id (R7 #14), and, without an id,
 *  by its action while its control is applying, confirming or unconfirmed (an entry begun before it gave up): model.js
 *  ownEntries (CR7 #10). */
const ownChanges = () => {
  const ctls = [['calibrate', S.calCtl.start], ['calibrate', S.calCtl.dry], ['rebuild', S.calCtl.rebuild], ['test', S.testCtl]].filter(([, c]) => c)
    .map(([action, c]) => ({ action, state: c.state, entryId: c.entryId ?? null, at: c.at }));
  const o = ownEntries(S.m, ctls, Date.now(), mine.mine);
  return { ids: o.ownIds, actions: o.ownActions };
};
/** "Applying: the restart on the river's year · 0:05 · usually about 1 min" under the state line, one line per change; the
 *  m:ss is painted in place each second, so the spinner never restarts. */
function paintApplying(lines) {
  const host = $('#state-applying');
  if (!host) return;
  const key = lines.map((l) => l.label).join('\n');
  if (host.dataset.key !== key) {
    host.dataset.key = key;
    host.innerHTML = lines.map(() => '<div class="applying-line"><span class="spin" aria-hidden="true"></span><span class="t"></span></div>').join('');
  }
  host.querySelectorAll('.t').forEach((t, i) => { const w = fmt.nb(lines[i].line); if (t.textContent !== w) t.textContent = w; });
}
function levelOf(id) { return S.m?.items.find((x) => x.id === id)?.level ?? 'unknown'; }
// "Progress and Stop → Calibrate": open the block, bring it into view, and put focus in it (its heading or first control)
$('#state-next').addEventListener('click', (e) => {
  const a = e.target.closest('[data-jump="calibrate"]');
  if (!a) return;
  e.preventDefault();
  goto('calibrate');
  calFocusTarget()?.focus({ preventScroll: true });
});

// ---- the LED map: GET /api/pixelmap, asked again until it loads (and again after a calibration writes a map) ----------------
async function loadMap() {
  if (S.map.fetching) return;
  S.map.fetching = true;
  try {
    const { r, body: j } = await fetchTimed('/api/pixelmap', undefined, POLL_TIMEOUT_MS, { idle: true });
    if (!r.ok || !j || j.error || j.map?.error) throw Object.assign(new Error(mapError(j?.error || j?.map?.error || `HTTP ${r.status}`)), { status: r.status });
    S.map = { ...S.map, map: j.map ?? null, screens: j.screens ?? null, still: j.still ?? null, error: null, ropes: prepareRopes(j.map), loaded: true };
  } catch (e) {
    // a map already on the page stays (a refresh after a calibration that failed); otherwise it "hasn't loaded yet"
    S.map = { ...S.map, error: plainError(e), loaded: true };
  } finally { S.map.fetching = false; S.map.triedAt = performance.now(); }
  render();
  calArrival(true);   // the map above drew: the Calibrate block a link brought you to stays where it was put
}
/** Ask for the LED map again while the last ask failed: on a good /api/status answer (at most every 10 s), every 30 s, and when
 *  the tab comes back. A page that couldn't read it never says there is none. A calibration's newer map than the one shown
 *  (mission control serves bitcube's once its full check names it) is asked for on the 30 s timer only: it is a big answer. */
function retryMap(force) {
  if (S.map.fetching || !S.map.loaded) return;                  // the first ask is still out (it has its own time limit)
  const failed = !!S.map.error, newer = newerMap();
  if (!failed && !(newer && force)) return;
  if (!force && S.map.triedAt != null && performance.now() - S.map.triedAt < MAP_RETRY_MIN_MS) return;
  loadMap();
}
/** A finished calibration wrote a newer map than the one on the page. */
function newerMap() {
  const p = S.cal.p, map = S.map.map;
  return !!(map && p && !p.running && p.ok === true && p.result && !p.result.dry_run && p.result.map && p.result.map > (map.file ?? ''));
}
/** A map error in the team's words: never a file name or a parser's message (the raw text stays in the server's answer). */
function mapError(raw) {
  const s = String(raw ?? '');
  if (/unreadable|JSON|Unexpected|parse/i.test(s)) return "the LED map file can't be read";
  if (/could not fetch|fetch failed|ssh|can't reach/i.test(s)) return "bitcube didn't send it";
  return s;
}
/** The map's 8000 points grouped by rope, as fractions of the frame (y already flipped: v runs bottom → top).
 *  A multi-view map (meta.space: several camera views stitched, tools/pixelmap/sphere.py) keeps u, v in its own stitched
 *  frame; this page draws over the gallery cam's live picture, so it uses each LED's place in that view (hu, hv) instead.
 *  LEDs above the picture (the rope tops) land above it; one behind the camera (hu null) is left out. */
function prepareRopes(map) {
  if (!map || !Array.isArray(map.points)) return null;
  const home = !!map.meta?.space;
  const ropes = Array.from({ length: N_ROPES }, () => []);
  for (const p of map.points) {
    if (!p || typeof p.rope !== 'number' || p.rope < 0 || p.rope >= N_ROPES) continue;
    if (home && (typeof p.hu !== 'number' || typeof p.hv !== 'number')) continue;
    ropes[p.rope].push({ px: p.px, x: home ? p.hu : p.u, y: 1 - (home ? p.hv : p.v), visible: p.visible === true });
  }
  for (const r of ropes) r.sort((a, b) => a.px - b.px);
  return ropes;
}
/** The four screens' corners as fractions (y flipped), from the screens file, else quad 1 from the map. */
function screenQuads() {
  const flip = (q) => ({ tl: [q.tl[0], 1 - q.tl[1]], tr: [q.tr[0], 1 - q.tr[1]], br: [q.br[0], 1 - q.br[1]], bl: [q.bl[0], 1 - q.bl[1]] });
  const out = [];
  const sc = S.map.screens?.screens;
  if (sc && typeof sc === 'object') {
    // a multi-view screens file also gives each screen's corners in the gallery cam's own view (home): the picture this page draws over
    for (let n = 1; n <= 4; n++) { const q = sc[String(n)], c = q?.home?.tl ? q.home : q; out.push(c && c.tl ? { n, ...flip(c), estimated: q.estimated === true, from: q.from ?? null, located: true } : { n, located: false }); }
    return out;
  }
  const q1 = S.map.map?.hub75_quad1;
  for (let n = 1; n <= 4; n++) out.push(n === 1 && q1?.tl ? { n, ...flip(q1), estimated: false, located: true } : { n, located: false });
  return out;
}
/** Why the map isn't drawn (lights-words.js mapMissing), or null. */
const missing = () => mapMissing({ loaded: S.map.loaded, map: S.map.map, error: S.map.error, waitS: (performance.now() - S.map.askedAt) / 1000 });

// ---- what TouchDesigner is sending: GET /api/lights every 10 s while this page is visible -------------------------------
async function pollLights() {
  if (document.hidden || S.lights.fetching) return;
  S.lights.fetching = true;
  try {
    const { r, body } = await fetchTimed('/api/lights');
    const j = body ?? {};
    const f = j?.frames;
    if (!r.ok || j.ok === false || !f?.ropes?.rgb || !f?.panels?.rgb) {
      S.lights.error = lightsError(j?.error || f?.ropes?.error || f?.panels?.error, r.status);
      S.lights.failedAt ??= performance.now();
    } else {
      // decoded, and each rope's darkness (every LED black: max channel under 8), by the shared frames-view.js
      const { bytes, panelBytes, dark, scr } = decodeLights(f);
      S.lights = { frames: f, at: performance.now(), wall: Date.now(), age_s: typeof j.age_s === 'number' ? j.age_s : 0, error: null, failedAt: null, bytes, panelBytes, dark, scr, fetching: true };
    }
  } catch (e) { S.lights.error = lightsError(e); S.lights.failedAt ??= performance.now(); }
  finally { S.lights.fetching = false; }
  render();
}
/** Why the lights can't be shown, in the team's words: the server's plain sentence, else plainError's; never "HTTP 502" or
 *  a frame's byte count. */
function lightsError(e, status) {
  const m = String(e?.message ?? e ?? '').replace(/:\s*no frames$/i, '');
  if (!m) return status ? plainError(`HTTP ${status}`) : 'no frames yet';
  if (/rgb holds|bytes, expected|bad frame|missing|cut short/i.test(m)) return 'a frame from bitcube arrived incomplete';
  if (/not cooked|has not cooked/i.test(m)) return 'TouchDesigner has not drawn a frame yet';
  return plainError(typeof e === 'object' && e ? e : m);
}
const frameAgeS = () => (S.lights.frames ? S.lights.age_s + since(S.lights.at, S.lights.wall) : null);
const frameOld = () => { const a = frameAgeS(); return a != null && a > FRAME_OLD_S; };
const ledRGB = (c, y) => { const b = S.lights.bytes, w = S.lights.frames.ropes.w, i = (y * w + c) * 3; return [b[i], b[i + 1], b[i + 2]]; };
const isBlack = ([r, g, b]) => r <= 8 && g <= 8 && b <= 8;

// ---- the map card -----------------------------------------------------------------------------------------------------
const liveView = () => (S.view === 'live' || (S.view === 'auto' && !!S.lights.frames && !frameOld()));
/** The room picture's words in the caption: "the room's picture is 28 s old" (never "the room still is", read as "still"). */
function roomWords() {
  if (!S.room.on || stillUrl(S.map.still)) return '';
  return S.room.url ? ` · the room's picture is ${esc(fmt.nb(dur(roomAgeS())))} old` : S.room.error ? ` · no picture of the room: ${esc(S.room.error)}` : " · fetching the room's picture…";
}
function renderMapCard() {
  const live = liveView(), hasMap = !!S.map.ropes;
  for (const b of document.querySelectorAll('#view-seg [data-view]')) { const on = (b.dataset.view === 'live') === live; b.classList.toggle('lit', on); b.setAttribute('aria-pressed', on); }
  const quads = screenQuads(), estimated = quads.filter((q) => q.located && q.estimated).length, located = quads.filter((q) => q.located).length;
  const zoomed = zoomBox(...frameSize()).zoomed;
  put('map-legend', live ? `Each LED in the colour TouchDesigner is sending it; the screens show their picture.${estimated ? ` Screens marked ~ are estimated.` : ''}${zoomed ? ' Zoomed to the piece.' : ''}`
    : `Each rope in its own colour, numbered at its plug end; dots are LEDs the camera saw.${located ? ` Screens outlined${estimated ? `, ${estimated} of them estimated (dashed)` : ''}.` : ''}${zoomed ? ' Zoomed to the piece.' : ''}`);
  // the still behind: the calibration's own frame when the map ships one, else the room still on request
  const img = $('#room-img'), toggle = $('#room-toggle');
  const mapStill = stillUrl(S.map.still);
  if (mapStill) { toggle.hidden = true; if (img.src !== mapStill) img.src = mapStill; img.hidden = false; }
  else { toggle.hidden = false; $('#room-check').checked = S.room.on; img.hidden = !(S.room.on && S.room.url); if (S.room.on && S.room.url && img.src !== S.room.url) img.src = S.room.url; }
  // the note over the canvas: no map, or no frames
  const note = $('#map-note');
  let noteHtml = '';
  // what TouchDesigner sends is not what the room shows when the lights aren't connected: said over the map, and dimmed
  const ropesSt = S.m?.show.ropes.state, panelsSt = S.m?.show.panels.state;
  const notGetting = [ropesSt === 'not-reaching' ? "the ropes aren't getting it" : ropesSt === 'not-driven' ? "the ropes aren't being driven" : ropesSt === 'restarting' ? 'the ropes are dark while TouchDesigner restarts' : '',
    panelsSt === 'no-sender' ? 'the panels have no sender' : ''].filter(Boolean);
  const unsent = live && !!S.lights.frames && !pageDown() && !frameOld() && notGetting.length > 0;
  const miss = hasMap ? null : missing();
  if (miss) noteHtml = `${mark('unknown')}<span>${esc(fmt.nb(miss.note))}</span>`;
  else if (live && !S.lights.frames) noteHtml = `${mark(S.m?.overall.cause === 'bitcube-offline' ? 'down' : 'unknown')}<span>${esc(S.lights.error && /:/.test(S.lights.error) ? `Can't show the lights. ${cap(S.lights.error)}` : `Can't show the lights: ${S.lights.error ?? 'no frames yet'}`)}.</span>`;
  else if (live && pageDown()) noteHtml = `${mark('unknown')}<span>No contact with mission control: this is the last frame it sent.</span>`;
  else if (live && frameOld()) noteHtml = `${mark('warning')}<span>No new frame for ${esc(fmt.nb(dur(frameAgeS())))}${S.lights.error ? `: ${esc(S.lights.error)}` : ''}. This is the last one.</span>`;
  else if (unsent) noteHtml = `${mark('warning')}<span>What TouchDesigner sends; ${esc(notGetting.join(' and '))}.</span>`;
  if (S.html['map-note'] !== noteHtml) { S.html['map-note'] = noteHtml; note.innerHTML = noteHtml; note.className = `mapnote ${/lv-down/.test(noteHtml) ? 'lv-down' : /lv-warning/.test(noteHtml) ? 'lv-warning' : 'lv-unknown'}`; }
  note.hidden = !noteHtml;
  $('#mapwrap').classList.toggle('dim', live && !!S.lights.frames && (frameOld() || pageDown() || unsent));
  // the caption
  let capHtml;
  if (live && S.lights.frames) capHtml = `<b>Live</b> · what TouchDesigner is sending · from bitcube · ${esc(fmt.nb(dur(frameAgeS())))} ago`;
  else if (live) capHtml = `<b>Live</b> · waiting for a frame from bitcube`;
  else capHtml = hasMap ? `<b>Map</b> · ${zoomed ? 'the piece, as the camera sees it' : "the camera's whole picture"}`
    : miss?.chip === 'Not known yet' ? `<b>Map</b> · ${S.map.loaded || (performance.now() - S.map.askedAt) > LOST_MS ? "the LED map hasn't loaded yet" : 'loading'}` : `<b>Map</b> · nothing to draw yet`;
  if (mapStill) capHtml += ' · over the still from the calibration';
  S.capBase = capHtml;
  put('map-cap', capHtml + roomWords());
  const wrap = $('#mapwrap'), [FW, FH] = frameSize(), frameAspect = FW / FH;
  const zb = zoomBox(FW, FH), aspect = zb.zoomed ? Math.min(frameAspect, Math.max(0.8, zb.aspect)) : frameAspect;
  const want = `${Math.round(aspect * 1000)} / 1000`;
  if (wrap.style.aspectRatio !== want) { wrap.style.aspectRatio = want; wrap.style.setProperty('--ar', (Math.round(aspect * 1000) / 1000).toString()); }
  drawMap(live);
}
function stillUrl(still) {
  if (!still) return null;
  if (typeof still === 'string') return still;
  if (still.url) return still.url;
  if (still.jpeg || still.base64) return `data:${still.type || 'image/jpeg'};base64,${still.jpeg || still.base64}`;
  return null;
}
/** Draws `img` (a canvas) onto the triangle d0-d1-d2 of the context, with the image's triangle s0-s1-s2 mapped onto it. */
function drawTri(ctx, img, [x0, y0], [x1, y1], [x2, y2], [u0, v0], [u1, v1], [u2, v2]) {
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!det) return;
  const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3, grow = (p) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.7, p[1] + dy / l * 0.7]; };
  const [g0, g1, g2] = [grow([u0, v0]), grow([u1, v1]), grow([u2, v2])];   // a little past the edge: no hairline seam between the two triangles
  ctx.save();
  ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath(); ctx.clip();
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det, b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det, d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  ctx.transform(a, b, c, d, u0 - a * x0 - c * y0, v0 - b * x0 - d * y0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
const LABEL_FONT = (size) => `700 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
function drawMap(live) {
  const cv = $('#map-canvas'), fit = fitCanvas(cv);
  if (!fit) return;
  const { ctx, w: W, h: H } = fit;
  ctx.clearRect(0, 0, W, H);
  const ropes = S.map.ropes;
  if (!ropes) return;
  const narrow = W < 500, dot = narrow ? 2.2 : 3, hi = S.hi;
  const useFrame = live && !!S.lights.frames;
  const alphaFor = (r) => (hi == null || hi === r ? 1 : 0.22);
  // By ratio always (x = u × W, y = (1 − v) × H). With a still behind, the whole frame; without one, zoomed to the piece
  // (the same scale both ways, so nothing is stretched): the ropes fill a narrow middle of the camera's frame.
  const [FW, FH] = frameSize(), z = zoomBox(W, H), X = (x) => (x * FW - z.cx) * z.k + W / 2, Y = (y) => (y * FH - z.cy) * z.k + H / 2;
  const P = (p) => [X(p[0]), Y(p[1])];
  const placed = [];   // label boxes already drawn: later labels move off them, never under them
  const screenLabels = [];   // drawn after the ropes, so no rope is painted over a screen's number
  // the screens first, under the ropes
  // each screen's own picture, upright as seen, onto its corners as the camera sees them (cell n-1 = screen n)
  const scr = useFrame ? S.lights.scr : null, panels = scr?.img ?? null, qw = scr?.cw ?? 1, ph = scr?.ch ?? 1;
  for (const q of screenQuads()) {
    if (!q.located) continue;
    const tl = P(q.tl), tr = P(q.tr), br = P(q.br), bl = P(q.bl), i = q.n - 1;
    if (panels) {
      drawTri(ctx, panels, [i * qw, 0], [(i + 1) * qw, 0], [(i + 1) * qw, ph], tl, tr, br);
      drawTri(ctx, panels, [i * qw, 0], [(i + 1) * qw, ph], [i * qw, ph], tl, br, bl);
    } else { ctx.fillStyle = 'rgba(124, 195, 232, 0.12)'; ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.lineTo(...br); ctx.lineTo(...bl); ctx.closePath(); ctx.fill(); }
    ctx.save();
    ctx.setLineDash(q.estimated ? [6, 4] : []);
    ctx.lineWidth = 1.5; ctx.strokeStyle = panels ? 'rgba(228, 233, 238, 0.7)' : '#7cc3e8';
    ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.lineTo(...br); ctx.lineTo(...bl); ctx.closePath(); ctx.stroke();
    ctx.restore();
    if (!useFrame || hi == null) screenLabels.push([(tl[0] + br[0]) / 2, (tl[1] + br[1]) / 2, `${q.n}${q.estimated ? ' ~' : ''}`]);
  }
  // the ropes: a polyline through the filled points, dots on the visible ones
  for (let r = 0; r < N_ROPES; r++) {
    const pts = ropes[r];
    if (!pts.length) continue;
    ctx.globalAlpha = alphaFor(r);
    const bold = hi === r;
    if (useFrame) {
      ctx.lineWidth = bold ? 3 : 1.6; ctx.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const c = ledRGB(r, Math.min(LEDS - 1, pts[i].px));
        ctx.strokeStyle = isBlack(c) ? 'rgba(90, 100, 112, 0.6)' : `rgb(${c[0]} ${c[1]} ${c[2]})`;
        ctx.beginPath(); ctx.moveTo(X(pts[i - 1].x), Y(pts[i - 1].y)); ctx.lineTo(X(pts[i].x), Y(pts[i].y)); ctx.stroke();
      }
      for (const p of pts) if (p.visible) {
        const c = ledRGB(r, Math.min(LEDS - 1, p.px));
        ctx.fillStyle = '#05080b'; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), dot + 1, 0, 7); ctx.fill();
        ctx.fillStyle = isBlack(c) ? '#3a4048' : `rgb(${c[0]} ${c[1]} ${c[2]})`; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), dot, 0, 7); ctx.fill();
      }
    } else {
      const col = ropeHue(r);
      ctx.strokeStyle = col; ctx.lineWidth = bold ? 2.6 : 1.2; ctx.lineJoin = 'round';
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)))); ctx.stroke();
      for (const p of pts) if (p.visible) {
        ctx.fillStyle = '#05080b'; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), dot + 1, 0, 7); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), dot, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  for (const [x, y, t] of screenLabels) label(ctx, x, y, t, 14, '#7cc3e8', placed);
  // numbers at the plug ends (Map view, or the highlighted rope), placed so none sits nearer another rope's plug end without a
  // thin leader line to its own (lights-words.js placeLabels)
  const only = new Set(hi != null ? [hi] : useFrame ? [] : ropes.map((_, r) => r));
  if (!only.size) return;
  const anchors = ropes.map((pts) => (pts.length ? { x: X(pts[0].x), y: Y(pts[0].y) } : null));
  ctx.save(); ctx.font = LABEL_FONT(14);
  const widths = anchors.map((_, r) => ctx.measureText(String(r + 1)).width + 8);
  ctx.restore();
  const boxes = placeLabels(anchors, widths, { h: 20, W, H, taken: placed, only });
  boxes.forEach((b, r) => { if (b?.leader) leaderLine(ctx, anchors[r], b, ropeHue(r)); });
  boxes.forEach((b, r) => { if (b) pill(ctx, b.x, b.y, b.w, b.h, String(r + 1), 14, ropeHue(r)); });
}
/** A thin line from a plug end to the edge of its number's pill, with a dot at the plug end. */
function leaderLine(ctx, a, b, color) {
  const dx = a.x - b.x, dy = a.y - b.y;
  const t = Math.min(Math.abs(dx) > 0 ? (b.w / 2) / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? (b.h / 2) / Math.abs(dy) : Infinity, 1);
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.95;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x + dx * t, b.y + dy * t); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(a.x, a.y, 2.4, 0, 7); ctx.fill();
  ctx.restore();
}
function pill(ctx, x, y, w, h, text, size, color) {
  ctx.save();
  ctx.font = LABEL_FONT(size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(5, 8, 11, 0.85)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 5); ctx.fill();
  ctx.fillStyle = color; ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}
/** The frame's size in its own pixels (meta.frame_size, else 1440 × 808). */
function frameSize() { const fs = S.map.map?.meta?.frame_size; return Array.isArray(fs) && fs[0] > 0 && fs[1] > 0 ? [fs[0], fs[1]] : [1440, 808]; }
/** How the camera's frame lands on a W × H canvas, one scale both ways: the whole frame when a still is behind it, else
 *  the box around every point and screen (with a margin), so a tall thin piece is not a sliver. { k, cx, cy } in frame px. */
function zoomBox(W, H) {
  const [FW, FH] = frameSize();
  const whole = { k: Math.min(W / FW, H / FH), cx: FW / 2, cy: FH / 2, zoomed: false, aspect: FW / FH };
  const stillShown = !!stillUrl(S.map.still) || (S.room.on && !!S.room.url);
  if (stillShown || !S.map.ropes) return whole;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (x, y) => { x0 = Math.min(x0, x * FW); y0 = Math.min(y0, y * FH); x1 = Math.max(x1, x * FW); y1 = Math.max(y1, y * FH); };
  for (const pts of S.map.ropes) for (const p of pts) take(p.x, p.y);
  for (const q of screenQuads()) if (q.located) for (const c of [q.tl, q.tr, q.br, q.bl]) take(c[0], c[1]);
  if (!Number.isFinite(x0)) return whole;
  // more room above than below: the plug ends hang from the ceiling, and their numbers sit above them
  const mx = Math.max(40, (x1 - x0) * 0.14), my = Math.max(30, (y1 - y0) * 0.05), myTop = Math.max(60, (y1 - y0) * 0.12);
  const bw = x1 - x0 + 2 * mx, bh = y1 - y0 + my + myTop;
  const k = Math.min(W / bw, H / bh);
  return { k, cx: (x0 + x1) / 2, cy: (y0 - myTop + y1 + my) / 2, zoomed: k > whole.k * 1.02 || bw / bh < (FW / FH) * 0.9, aspect: bw / bh };
}
/** A screen's number in a dark pill at (x, y), moved to the nearest free spot (down, up, then sideways) when it would cover a
 *  label already drawn (`placed`, the boxes so far). */
function label(ctx, x, y, text, size, color, placed = []) {
  ctx.save();
  const cw = ctx.canvas.clientWidth || ctx.canvas.width, ch = ctx.canvas.clientHeight || ctx.canvas.height;
  ctx.font = LABEL_FONT(size);
  const w = ctx.measureText(text).width + 8, h = size + 6;
  ctx.restore();
  const fit = (px, py) => [Math.min(cw - w / 2 - 1, Math.max(w / 2 + 1, px)), Math.min(ch - h / 2 - 1, Math.max(h / 2 + 1, py))];
  const hits = (px, py) => placed.some((b) => Math.abs(b.x - px) < (b.w + w) / 2 + 2 && Math.abs(b.y - py) < (b.h + h) / 2 + 2);
  let best = fit(x, y);
  if (hits(...best)) {
    const steps = [];
    for (let k = 1; k <= 6; k++) steps.push([0, k * (h + 2)], [0, -k * (h + 2)], [k * (w + 2), 0], [-k * (w + 2), 0], [k * (w + 2), k * (h + 2)], [-k * (w + 2), -k * (h + 2)]);
    for (const [dx, dy] of steps) { const c = fit(x + dx, y + dy); if (!hits(...c)) { best = c; break; } }
  }
  placed.push({ x: best[0], y: best[1], w, h });
  pill(ctx, best[0], best[1], w, h, text, size, color);
}

// ---- the room still (optional, behind the map) ---------------------------------------------------------------------------
const roomAgeS = () => (S.room.at == null ? null : (S.room.age_s ?? 0) + since(S.room.at, S.room.wall));
async function pollRoom() {
  if (!S.room.on || document.hidden || S.room.fetching) return;
  S.room.fetching = true;
  try {
    const { r, body } = await fetchTimed('/api/camera/gallery.jpg?t=' + Date.now(), (res) => (res.ok ? res.blob() : res.json()));
    if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
    if (!(body instanceof Blob)) throw new Error('the picture arrived incomplete');
    const url = URL.createObjectURL(body);
    if (S.room.url) URL.revokeObjectURL(S.room.url);
    S.room = { ...S.room, url, age_s: Number(r.headers.get('x-age-s')) || 0, at: performance.now(), wall: Date.now(), error: null };
  } catch (e) { S.room.error = plainError(e); }
  finally { S.room.fetching = false; }
  render();
}
function setRoom(on) {
  S.room.on = on;
  clearInterval(S.room.timer); S.room.timer = null;
  if (on) { pollRoom(); S.room.timer = setInterval(pollRoom, STILL_MS); }
  render();
}

// ---- the 20 rope chips ------------------------------------------------------------------------------------------------
function ropeState(r) {
  const m = S.m, found = S.map.map?.ropes?.[String(r)], seen = found?.visible ?? null;
  const darkNow = S.lights.dark?.[r] === true && m?.show.ropes.state === 'river' && !frameOld();
  if (darkNow) return { level: 'warning', word: 'Dark now', seen };
  // before the LED map has answered (or when it couldn't be fetched) nothing is known: "Not mapped yet" claims calibration is missing
  const miss = missing();
  if (miss) return { level: 'unknown', word: miss.chip, seen: null };
  // what calibration found is not the rope's state now: a neutral mark, never a green ✓ (that would read "this rope is OK")
  if (seen > 0) return { level: 'unknown', neutral: true, word: 'Found at calibration', seen };
  return { level: 'warning', word: 'Not found at calibration', seen: seen ?? 0 };
}
/** The chips are 20 buttons made once; a render paints only what changed in each (its class, aria-pressed, name, words), so a
 *  focused chip keeps focus and a screen reader hears "pressed" on the button it pressed. */
function renderChips() {
  const host = $('#rope-chips');
  if (host.children.length !== N_ROPES) {
    host.innerHTML = Array.from({ length: N_ROPES }, (_, r) => `<button type="button" class="rope" data-rope="${r}" aria-pressed="false"></button>`).join('');
    S.chips = [];
  }
  for (let r = 0; r < N_ROPES; r++) {
    const b = host.children[r], n = r + 1, box = n <= 10 ? 1 : 2, out = ((n - 1) % 10) + 1, st = ropeState(r);
    const cls = `rope lv-${st.level}${st.neutral ? ' neutral' : ''}`;
    if (b.className !== cls) b.className = cls;
    const pressed = String(S.hi === r);
    if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed);
    const name = `Rope ${n}, box ${box} out ${out}: ${st.word}${st.seen == null ? '' : `, ${st.seen} of ${LEDS} seen`}`;
    if (b.getAttribute('aria-label') !== name) b.setAttribute('aria-label', name);
    const seen = st.seen == null ? '' : `${esc(fmt.nb(`${st.seen} of ${LEDS}`))} seen · `;
    const inner = `${st.neutral ? '<span class="mk lv-unknown" aria-hidden="true">·</span>' : mark(st.level)}<span class="rname">Rope ${n} <span class="out">box ${box} · OUT ${out}</span></span>
      <span class="rline">${seen}<span class="state">${esc(st.word)}</span></span>`;
    if (S.chips[r] !== inner) { S.chips[r] = inner; b.innerHTML = inner; }
  }
  const found = S.map.map ? Object.values(S.map.map.ropes ?? {}).filter((v) => (v?.visible ?? 0) > 0).length : null;
  put('ropes-sub', found == null ? 'tap one to pick it out' : `${found} of ${N_ROPES} found at calibration · tap one to pick it out`);
  const miss = missing();
  if (miss) { put('screens-line', esc(miss.screens)); return; }
  const quads = screenQuads(), located = quads.filter((q) => q.located);
  const list = (ns) => (ns.length > 1 ? `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}` : String(ns[0]));
  const measured = located.filter((q) => !q.estimated).map((q) => q.n), est = located.filter((q) => q.estimated).map((q) => q.n), absent = quads.filter((q) => !q.located).map((q) => q.n);
  const parts = [measured.length ? `${measured.length > 1 ? 'Screens' : 'Screen'} ${list(measured)} located` : '', est.length ? `${measured.length ? '' : `${est.length > 1 ? 'Screens' : 'Screen'} `}${list(est)} estimated` : '', absent.length ? `${list(absent)} not located yet` : ''].filter(Boolean);
  put('screens-line', !located.length ? 'Screens: not located yet.' : `${parts.join('; ')}.`);
}
/** After picking a rope on a phone, the map it lights up on is above the chips, often off the screen: bring it into view. */
function showMap() {
  const wrap = $('#mapwrap'), rc = wrap.getBoundingClientRect();
  const top = $('header.top')?.getBoundingClientRect().bottom ?? 0;
  const tabs = $('nav.tabs'), tb = tabs ? tabs.getBoundingClientRect() : null;
  const bottom = tb && tb.top > innerHeight / 2 ? tb.top : innerHeight;
  if (rc.top >= top - 1 && rc.bottom <= bottom + 1) return;
  wrap.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
}
$('#rope-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rope]');
  if (!b) return;
  const r = Number(b.dataset.rope);
  S.hi = S.hi === r ? null : r;
  renderChips(); renderMapCard(); renderStrips();
  if (S.hi != null) showMap();
});
$('#view-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) { S.view = b.dataset.view; renderMapCard(); } });
$('#room-check').addEventListener('change', (e) => setRoom(e.target.checked));

// ---- rope by rope: B's strips and the four quads --------------------------------------------------------------------------
function renderStrips() {
  const l = S.lights, m = S.m;
  const sec = $('#strips');
  const old = frameOld() || (!l.frames && !!l.error);
  sec.classList.toggle('dim', !!l.frames && frameOld());
  put('strip-nums', Array.from({ length: N_ROPES }, (_, r) => `<span class="${S.hi === r ? 'hi' : ''}${r === 0 || (r + 1) % 5 === 0 ? ' key' : ''}">${r + 1}</span>`).join(''));
  const note = $('#strips-note');
  let text = '', bad = false;
  if (l.frames) {
    const dark = l.frames.source === 'black' || l.frames.ropes?.source === 'black';
    const testing = l.frames.source === 'test' || l.frames.ropes?.source === 'test' || l.frames.panels?.source === 'test';
    text = testing ? 'The test pattern, as TouchDesigner sends it: colours wiping down from the plug end, and each screen with its number in white squares.'
      : dark ? 'The ropes are dark on purpose: TouchDesigner sends black. The panels still show the river.' : 'What TouchDesigner sends to each LED and screen, from bitcube.';
    if (!dark && m?.show.ropes.state === 'not-reaching') {
      // the reason once, in the model's words without its own lead ("Not reaching the lights: sender retrying, both boxes silent"),
      // lower case after the colon unless it starts with a name
      const s = m.show.ropes.summary.replace(/\.$/, ''), w = s.includes(': ') ? s.slice(s.indexOf(': ') + 2) : s;
      const why = /^(TouchDesigner|bitcube|Rope box|Will)/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1);
      text += ` The ropes aren't getting it: ${why}.`;
    } else if (!dark && m?.show.ropes.state === 'not-driven') text += ` ${cap(m.show.ropes.words)}.`;   // never the cable words (R9 #36)
    else if (!dark && m?.show.ropes.state === 'restarting') text += ` ${cap(m.show.ropes.words)}: they come back with it, in about a minute.`;   // R7 #18
    if (frameOld()) { text = `No new frame for ${fmt.nb(dur(frameAgeS()))}${l.error ? `: ${l.error}` : ''}. This is the last one received.`; bad = true; }
  } else {
    text = l.error && /:/.test(l.error) ? `Can't show the lights. ${cap(l.error)}.` : `Can't show the lights: ${l.error ?? 'no frames yet'}.`;
    bad = !!l.error && !/not checked yet/.test(l.error);
    if (!l.error && m && m.overall.cause && m.overall.cause !== 'page') text = `Can't show the lights yet: ${m.show.ropes.words}.`;
  }
  if (note.textContent !== text) note.textContent = text;
  note.className = `muted secondary${bad && old ? ' bad' : ''}`;
  drawStrips();
}
function drawStrips() {
  const fr = fitCanvas($('#strips-canvas')), fq = fitCanvas($('#quads-canvas'));
  if (!fr || !fq) return;
  const l = S.lights;
  if (!l.frames) { paintEmpty(fr, fq, N_ROPES); return; }   // empty outlines: the strips stay readable as 20 places, not a blank box
  paintStrips(fr, l, { hi: S.hi });
  paintScreens(fq, l.scr);
}

// ---- provenance: "Map made 23 Oct 12:24 at Gray Area · 20 of 20 ropes · the camera moved 10 px (fine)" -------------------
function renderProvenance() {
  const sec = $('#prov'), warn = $('#prov-warn');
  const map = S.map.map;
  if (!map) { put('prov-words', esc(fmt.nb(missing()?.prov ?? ''))); warn.hidden = true; sec.classList.remove('old'); return; }
  const when = captureWhen(map.meta?.capture, map.file), fromHere = when.day == null || when.day >= INSTALL_DAY;
  const found = Object.values(map.ropes ?? {}).filter((v) => (v?.visible ?? 0) > 0).length;
  const drift = typeof map.meta?.drift === 'number' ? map.meta.drift : null;
  const moved = drift == null ? '' : ` · ${driftWords(drift)}`;
  const sc = S.map.screens, quads = screenQuads().filter((q) => q.located), est = quads.filter((q) => q.estimated).length;
  const scWhen = sc ? captureWhen(sc.meta?.capture, sc.file) : null;
  const screensWords = sc ? ` · screens from ${scWhen.words}${est ? ` (${quads.length - est} located, ${est} estimated)` : ''}` : quads.length ? ' · screen 1 from the map' : '';
  put('prov-words', esc(fmt.nb(`Map made ${when.words} at ${fromHere ? 'Gray Area' : 'Agape'} · ${found} of ${N_ROPES} ropes${moved}${screensWords}`)));
  // amber when it doesn't match: made at another site, or a calibration since then wrote a newer map
  const p = S.cal.p, newer = newerMap();
  let w = '';
  if (!fromHere) w = `This map was made at Agape; it doesn't match the gallery camera here. Calibrate to make a new one.`;
  else if (newer) w = `A calibration made a newer map (${captureWhen(p.result.capture, p.result.map).words}) than the one shown here; this page asks for it again by itself, or reload the page.`;
  else if (drift != null && drift >= DRIFT_FINE_PX) w = `The camera moved ${Math.round(drift)} px during the capture: the dots may sit off the ropes. Calibrate again with the camera fixed.`;
  warn.hidden = !w;
  if (w) warn.innerHTML = `${mark('warning')}<span>${esc(w)}</span>`;
  sec.classList.toggle('old', !!w);
}

// ---- Calibrate: GET /api/calibration (every 5 s while a run is on), start / cancel / rebuild -----------------------------------
async function pollCal() {
  if (S.cal.fetching) return;
  S.cal.fetching = true;
  try {
    const { r, body } = await fetchTimed('/api/calibration');
    // only mission control's progress answer is a read: a 2xx that isn't it (a cut-off body, a proxy's page) is a failed
    // one, like a 503 or no answer: the last good progress, Stop and when bitcube was last heard all stay
    const read = calRead({ ok: r.ok, status: r.status, body }, { running: S.cal.p?.running === true, heardS: heardS() });
    if (!read.good) throw new Error(read.error);
    const j = body;
    const wasRunning = S.cal.p?.running === true;
    S.cal.p = read.p; S.cal.heardAt = performance.now(); S.cal.heardWall = Date.now(); S.cal.error = null;
    if (read.rebuilt !== undefined) S.cal.rebuilt = read.rebuilt;
    // the run just ended: the model takes the ended copy now (model() calNewer), so the result's Rebuild isn't blocked by the run
    // that ended, and the status is asked again so every lock follows (R7 #31)
    if (wasRunning && !j.running) { S.m = model(); status.refresh(); }
    // ended before this page opened: show only a recent one, judged on the server's clock (never this phone's)
    const at = serverClock(), nowS = typeof j.age_s === 'number' ? null : at != null ? at / 1000 : null;   // the server's clock (ui.js, CR8 #13)
    if (!wasRunning && !j.running && !S.cal.seenStarted) S.cal.old = typeof j.age_s === 'number' ? j.age_s > OLD_RUN_S : nowS != null && typeof j.updated === 'number' && nowS - j.updated > OLD_RUN_S;
    if (j.running) { S.cal.old = false; S.cal.seenStarted = true; }
    if (wasRunning && !j.running && j.ok === true && j.result && !j.result.dry_run) loadMap();   // a new map: draw it
  } catch (e) {
    // the last good progress stays: one failed read is never a lost run (only bitcube offline or a dead job is: calView)
    S.cal.error = plainError(e);
  } finally { S.cal.fetching = false; }
  watchCalibration();
  renderCalibrate(); renderProvenance();
  S.cal.announceOk = true;   // from now on a new view is announced (not the one the page opened on)
  calArrival();
}
/** Status's band links here during a calibration (/lights#calibrate): once the block knows the run and the status has answered, the
 *  Calibrate block opens and comes into view with Stop on screen, and focus goes to Stop (else the block's Start or heading), never
 *  the top of the page 4 screens above it (R8 #6). The map loading above it later puts it back, until the reader moves. */
const calLink = { wanted: location.hash === '#calibrate', done: false, at: 0, moved: false };
for (const ev of ['wheel', 'touchmove', 'keydown']) addEventListener(ev, () => { calLink.moved = true; }, { passive: true, once: true });
function calArrival(again = false) {
  if (!calLink.wanted || !S.m || S.cal.heardAt == null) return;
  if (again ? !calLink.done || calLink.moved || performance.now() - calLink.at > 15_000 : calLink.done) return;
  const d = $('#calibrate');
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ block: 'start', behavior: 'auto' });
  const stop = S.calCtl.stop?.button, target = stop?.isConnected && !stop.disabled ? stop : calFocusTarget();
  if (target) { bringIntoView(target); if (!again) target.focus({ preventScroll: true }); }
  if (!again) { calLink.done = true; calLink.at = performance.now(); }
}
/** Poll every 5 s while a run is on (ours, or one the model reports from bitcube's full check) or while this phone's rebuild
 *  waits for the map in use to show. */
function watchCalibration() {
  const modelSays = !!S.m?.problems.some((p) => p.id === 'calibrating');
  const on = S.cal.p?.running === true || modelSays || !!S.calCtl.rebuild?.busy;
  if (on && !S.cal.timer) S.cal.timer = setInterval(pollCal, CAL_MS);
  if (!on && S.cal.timer) { clearInterval(S.cal.timer); S.cal.timer = null; }
  if (modelSays && !S.cal.p?.running && !S.cal.pending && !S.cal.fetching) pollCal();   // a run started elsewhere (the chat): fetch it
}
/** A rebuild from any phone (status.applying) that just ended: ask which map the river's year uses now, so every phone shows
 *  "Map in use" and none offers a second rebuild (another minute dark). */
function watchRebuilds() {
  const now = !!S.m?.show.applying?.some((a) => a.action === 'rebuild');
  if (S.rebuildingElsewhere && !now) { pollCal(); setTimeout(pollCal, 3000); }
  S.rebuildingElsewhere = now;
}
const dismissed = () => String(store.get('mc-cal-dismissed') ?? '').split(',').filter(Boolean);
/** OK on a view, remembered on this phone: '<started>' a result, '<started>~lost' a lost run (that never hides its result). */
function dismiss(key) { if (key == null) return; store.set('mc-cal-dismissed', [...dismissed().slice(-7), String(key)].join(',')); renderCalibrate(); }

/** How far along the run is, 0–1, by the stages' typical lengths and the step within the stage. */
function runFraction(p) {
  const stages = STAGE_ORDER.filter((s) => CAL_STAGE_S[s]);
  const i = stages.indexOf(p.stage);
  if (p.stage === 'done') return 1;
  if (i < 0) return 0;
  let done = 0; for (let k = 0; k < i; k++) done += CAL_STAGE_S[stages[k]];
  let within = p.of > 0 ? Math.min(1, (p.step ?? 0) / p.of) : 0;
  if (p.stage === 'ropes-capture' && p.pass) within = (p.pass === 'B' ? 0.5 : 0) + within / 2;   // two passes of the patterns
  // camera views (calibrate.py views.json): each capture stage photographs every view in turn; its typical length is per view
  const views = p.views > 1 && (p.stage === 'ropes-capture' || p.stage === 'hub75-capture') ? p.views : 1;
  if (views > 1) within = Math.min(1, ((p.view_index ?? 0) + within) / views);
  return Math.min(1, (done + CAL_STAGE_S[p.stage] * within) / CAL_TOTAL_S);
}
/** The LEDs the map on this page saw, when it is the map a result names (an older result doesn't say), else null. */
const seenOnPage = (res) => (S.map.map && S.map.map.file === res.map ? Object.values(S.map.map.ropes ?? {}).reduce((s, v) => s + (v?.visible ?? 0), 0) : null);
const heardS = () => (S.cal.heardAt == null ? null : since(S.cal.heardAt, S.cal.heardWall));

/** The Calibrate block. Each view (before, run, lost, stopped, failed, done, in use) is built once (lights-words.js calView);
 *  while it stays, its parts are painted in place and its controls are kept and updated, never re-mounted: a confirm left
 *  open is withdrawn by its own control when that becomes impossible (ui.js control().update), and Stop keeps its applying
 *  and failed words across the run's every pattern. Leaving a view withdraws any confirm its controls still have open; when
 *  focus was in the block it moves to the new view's heading (or first control), and the new view's first line is said once. */
function renderCalibrate(own = null) {
  const m = S.m, p = S.cal.p, body = $('#cal-body');
  const v = calView({ p, m, dismissed: (k) => dismissed().includes(String(k)), old: S.cal.old, rebuiltAt: rebuiltFor(p, S.cal.rebuilt) });
  const { view, key, dry } = v;
  if (S.html['cal-body'] !== key) {
    const first = S.html['cal-body'] == null;
    // a control whose change just ended and made this view (Rebuild → "Map in use", Stop → "Stopped"): the new view's first line
    // says it, so its own done isn't said too, in the same breath (R8 #12)
    if (!first) for (const c of Object.values(S.calCtl)) if (c?.state === 'done' && Date.now() - (c.at ?? 0) < 2000) unannounce(c.text);
    leaveCalView(view, dry);
    const had = !first && body.contains(document.activeElement);
    S.html['cal-body'] = key; S.html['cal-checks'] = null; S.html['cal-stages'] = null;
    body.innerHTML = calHtml(v, p);
    if (view === 'run') S.calCtl.stop = mountStop(dry);
    else if (view === 'done' && !dry) S.calCtl.rebuild = mountRebuild(p);
    else if (view === 'before') Object.assign(S.calCtl, mountStart(m));
    paintCal(view, p, own);
    if (had) calFocusTarget()?.focus({ preventScroll: false });
    if (!first && S.cal.announceOk && view !== 'before') announce(calLine(view, v, p));
    return;
  }
  paintCal(view, p, own);
}
/** Each view's markup; the heading (or the before view's lead) is #cal-head, where focus goes when the view changes. */
function calHtml({ view, dry, lost }, p) {
  const res = p?.result;
  switch (view) {
    case 'lost': return lost === 'stale'
      ? `<div class="cal-result lv-down"><div class="h" id="cal-head" tabindex="-1">${mark('down')}<span>Calibration stopped without finishing</span></div>
        <p class="r-words">The calibration stopped on bitcube before it finished: the ropes may still show a pattern; press Ropes → On on the Status page.</p>
        <div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss-lost">OK</button><a class="btn" href="/status">Open Status</a></div></div>`
      : `<div class="cal-result lv-down"><div class="h" id="cal-head" tabindex="-1">${mark('down')}<span>Calibration interrupted</span></div>
        <p class="r-words">bitcube went offline during the run: the ropes may still be in patterns; they come back when TouchDesigner reloads.</p>
        <div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss-lost">OK</button></div></div>`;
    case 'run': return `<div class="cal-run" id="cal-run">
        <div class="cal-stage" id="cal-head" tabindex="-1">${dry ? 'A dry run: the lights stay as they are' : 'Calibrating'}</div>
        <div class="stages" id="cal-stages"></div>
        <div class="prog ${dry ? 'dry' : ''}" id="cal-prog" role="progressbar" aria-label="${dry ? 'How far the dry run is' : 'How far the calibration is'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="cal-bar" style="width:0%"></i></div>
        <div class="cal-line" id="cal-line"></div>
        <div class="cal-left" id="cal-left"></div>
        <p class="cal-note" id="cal-note" hidden></p>
      </div>
      <div class="cal-ctls"><div class="ctl" id="cal-stop"></div></div>
      <p class="cal-fine">${esc(runFine({ started: fmt.clock(p.started * 1000), cam: p.cam, dry }))}</p>`;
    case 'stopped': {
      const forced = p.restored === false && !dry;
      return `<div class="cal-result lv-unknown"><div class="h" id="cal-head" tabindex="-1">${mark('unknown')}<span>${dry ? 'Dry run stopped' : 'Stopped'}</span></div>
        <p class="r-words">${dry ? 'Nothing changed; the lights were never touched.' : forced ? 'It had to be forced, so the ropes may still show a pattern. Press Ropes → On on the Status page. No map was written.' : CAL_COPY.stopped}</p>
        <div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">OK</button>${forced ? '<a class="btn" href="/status">Open Status</a>' : ''}</div></div>`;
    }
    case 'failed': {
      const err = calFailure(p);
      return `<div class="cal-result lv-down"><div class="h" id="cal-head" tabindex="-1">${mark('down')}<span>Calibration failed</span></div>
        <p class="r-words">${esc(err.replace(/\.?$/, '.'))}${p.restored === false ? ' The ropes may still show a pattern: press Ropes → On on the Status page.' : /back on the river|back to what they showed|the map was not saved/i.test(err) ? '' : ` ${CAL_COPY.restored}`}</p>
        <div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">OK</button><button type="button" class="btn primary" data-cal="again">Back to Calibrate</button></div></div>`;
    }
    case 'inuse': {
      // rebuilt: the map is in the river's year now; nothing more to press (a second rebuild is another minute dark)
      const at = rebuiltFor(p, S.cal.rebuilt);
      return `<div class="cal-result lv-ok"><div class="h" id="cal-head" tabindex="-1">${mark('ok')}<span>Map in use</span></div>
        <p class="r-words">The river's year now uses this map (rebuilt ${esc(fmt.clock(at))}).${res ? ` <span class="muted">${esc(fmt.nb(resultWords(res, seenOnPage(res))))}</span>` : ''}</p>
        <div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">OK</button></div></div>`;
    }
    case 'done': return `<div class="cal-result lv-ok"><div class="h" id="cal-head" tabindex="-1">${mark('ok')}<span>${resultHead(dry)}</span></div>
      <p class="r-words">${res ? esc(fmt.nb(resultWords(res, seenOnPage(res)))) : 'The run finished.'}${dry ? ' <span class="muted">A dry run describes the newest existing map; the lights were not changed and nothing was written.</span>' : " The river's year still uses the old map until it is rebuilt."}</p>
      ${dry ? '<div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">OK</button></div>'
        : '<div class="cal-ctls"><div class="ctl" id="cal-rebuild"></div></div><div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">Keep the old map</button></div>'}</div>`;
    default: return `<p class="cal-lead" id="cal-head" tabindex="-1">Finds where every LED and the panels are, using the gallery camera. The ropes flash black-and-white patterns for about five minutes (the show is interrupted) and come back by themselves.</p>
      <ul class="checklist" id="cal-checks"></ul>
      <div class="cal-ctls"><div class="ctl" id="cal-start"></div><div class="ctl quiet" id="cal-dry"></div></div>`;
  }
}
/** The view's first line, said once when it appears: "Map made: Map made 23 Oct …" reads badly, so the heading and the words. */
function calLine(view, { dry }, p) {
  if (view === 'run') { const st = CAL_STAGE_WORDS[p?.stage]; return dry ? 'Dry run started; the lights stay as they are.' : st ? `Calibrating: ${st}.` : 'Calibration started: the ropes go into patterns now.'; }
  const head = Array.from($('#cal-head')?.querySelectorAll('span:not(.mk)') ?? []).map((x) => x.textContent).join(' ').trim();
  const rw = $('#cal-body .r-words')?.cloneNode(true);
  rw?.querySelectorAll('.muted').forEach((x) => x.remove());
  const words = rw?.textContent.trim().replace(/\s+/g, ' ') ?? '';
  return words.toLowerCase().startsWith(head.toLowerCase()) ? words : `${head}: ${words.replace(/^./, (c) => c.toLowerCase())}`;
}
/** Where focus goes in the Calibrate block: the before view's Start when it can be pressed, else the view's heading. */
function calFocusTarget() {
  const start = S.calCtl.start?.button;
  if (start?.isConnected && !start.disabled) return start;
  return $('#cal-head');
}
/** The parts that change while a view stays, painted in place: the checklist and the buttons' reasons, a run's progress. */
function paintCal(view, p, own = null) {
  const m = S.m;
  // this page's own changes, once a paint (the render's, else asked for here), for each control's reason (CR9 #17)
  const ownIds = view === 'before' || view === 'done' ? (own ?? ownChanges()).ids : [];
  if (view === 'before') {
    const lis = `${calChecklist(m).map((c) => `<li class="lv-${c.level}">${mark(c.level)}<span>${esc(c.text)}</span></li>`).join('')}
        <li class="you"><span class="mk" aria-hidden="true">·</span><span>${esc(ROOM_CHECK)}</span></li>`;
    const ul = $('#cal-checks');
    if (ul && S.html['cal-checks'] !== lis) { S.html['cal-checks'] = lis; ul.innerHTML = lis; }
    setWhy(S.calCtl.start, startWhy(m), m?.controls.calibrate.by, ownIds); setWhy(S.calCtl.dry, dryWhy(m), m?.controls.calibrate.dry?.by, ownIds);
  }
  if (view === 'run') { paintRun(p); tickCalibrate(); }
  if (view === 'done') setWhy(S.calCtl.rebuild, m ? m.controls.rebuild.why : NO_CONTACT, m?.controls.rebuild.by, ownIds);   // confirming ends on the server's verdict (judgeControls)
}
/** A control's reason, given only when it changed (paint is cheap, but every repaint rewrites its words); by: the entry it waits
 *  for, so a control whose own change holds the lock says it once, never "Wait: …" about itself too (R8 #18); ownIds: this page's
 *  own changes, worked out once a paint (CR9 #17). */
function setWhy(c, why, by = null, ownIds = []) {
  if (!c?.button.isConnected) return;
  // a sibling's own change on this page (Start's, under Dry run) is said by that control, never as a Wait line here too
  const own = !!by && ownIds.includes(by);
  if (c._why !== why || c._by !== (by ?? null) || c._own !== own) { c._why = why; c._by = by ?? null; c._own = own; c.update({ why, whyBy: by ?? null, whyOwn: own }); }
}
/** Leaving a view: a confirm its controls still hold open (Start, Dry run, Rebuild) is withdrawn, so a press on it can't send
 *  anything for a block that is gone; a control already sending is left to finish, and one that isn't asking anything is left as
 *  it is (a done Rebuild never says "Not possible now: …", nor takes focus there, on its way out: R8 #12). */
function leaveCalView(next, dry = false) {
  const why = next === 'run' ? (dry ? 'a dry run started meanwhile' : 'a calibration started meanwhile') : next === 'lost' ? 'bitcube went offline during the run' : 'the calibration changed meanwhile';
  for (const c of Object.values(S.calCtl)) if (c?.state === 'confirm') c.update({ why });
  S.calCtl = {};
}
/** The run's progress, painted in place (the stage words, the bar, "Pass A: pattern 12 of 29 · 1 pattern photographed again"). */
function paintRun(p) {
  const line = p.pass && p.of > 0 ? `Pass ${p.pass}: pattern ${p.step} of ${p.of}`
    : p.stage === 'ropes-decode' && p.of > 0 && p.step >= 1 ? `Rope ${p.step} of ${p.of}`       // never "Rope 0 of 20": it reads as an error
    : p.stage === 'ropes-capture' && p.of > 0 && p.step > 0 ? `Pass ${p.step} of ${p.of} done` : '';
  const again = p.retakes ? `${p.retakes} ${p.retakes === 1 ? 'pattern' : 'patterns'} photographed again` : '';
  const view = p.views > 1 && p.view_index != null && (p.stage === 'ropes-capture' || p.stage === 'hub75-capture')
    ? `Camera view ${p.view_index + 1} of ${p.views}` : '';
  const text = fmt.nb([view, line, again].filter(Boolean).join(' · '));
  const el = $('#cal-line'); if (el && el.textContent !== text) el.textContent = text;
  // a dry run touches no lights and no camera: its stages are steps (R9 #19); what a dry run is and its steps, one rule with the
  // band and the history (model.js calDryRun, calStep: CR9 #7, #8, #16)
  const dry = calDryRun(p);
  const stages = STAGE_ORDER.map((s) => `<span class="${s === p.stage ? 'now' : STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(p.stage ?? 'ropes-capture') ? 'done' : ''}">${s !== 'done' && dry ? calStep(s).label : STAGE_WORDS[s]}</span>`).join('<span aria-hidden="true">→</span>');
  const st = $('#cal-stages'); if (st && S.html['cal-stages'] !== stages) { S.html['cal-stages'] = stages; st.innerHTML = stages; }
  const pct = Math.round(runFraction(p) * 100), prog = $('#cal-prog'), bar = $('#cal-bar');
  const vt = `${pct} %, ${dry && calStep(p.stage) ? `at ${calStep(p.stage).words}` : CAL_STAGE_WORDS[p.stage] ?? (p.stage === 'done' ? 'done' : 'starting')}`;
  if (prog && prog.getAttribute('aria-valuetext') !== vt) { prog.setAttribute('aria-valuenow', String(pct)); prog.setAttribute('aria-valuetext', vt); bar.style.width = `${pct}%`; }
}
/** Why a run failed, in the team's words: calibrate.py's plain `reason` (from 24 Oct), else its error when that is already
 *  plain, else the stage it failed in; never a step id, a file name, an exit code or a traceback. */
function calFailure(p) {
  const plain = (s) => !!s && !/Traceback|exit \d|\.py\b|\bOUT\b|bridge|Error:|[A-Z][a-z]+Error\b|\|/.test(s);
  if (p?.reason && plain(p.reason)) return String(p.reason);
  const e = String(p?.error ?? '');
  if (plain(e)) return e || 'the run ended with an error';
  const stage = /ropes-capture/.test(e) ? 'Photographing the ropes failed' : /ropes-decode/.test(e) ? 'Working out where each rope is failed'
    : /hub75-capture/.test(e) ? 'Photographing the panels failed' : /hub75-locate/.test(e) ? 'Finding the panels failed' : 'The run stopped with an error';
  return `${stage}; run it again when the room is empty, or ask Gavin`;
}
/** Once a second: the model's time left, and the "last heard" note (a run not heard from for 30 s greys, and its time left goes). */
function tickCalibrate() {
  const p = S.cal.p, left = $('#cal-left'), runEl = $('#cal-run'), noteEl = $('#cal-note');
  if (!p?.running || !left) return;
  const n = runNote({ heardS: heardS(), failing: !!S.cal.error });
  runEl?.classList.toggle('quiet', n.grey);
  if (noteEl) { const t = fmt.nb(n.text); if (noteEl.textContent !== t) noteEl.textContent = t; noteEl.hidden = !t; }
  // the model's time left (S.m is derived again every second), the same number as the state line above and the Status page
  const t = n.grey ? '' : fmt.nb(calLeft({ cal: S.m?.show.calibration, dry: calDryRun(p) }));
  if (left.textContent !== t) left.textContent = t;
  left.hidden = !t;
}
/** POST a start; a refusal's reason without its "calibration can't start" (the control frames it), every field of the original
 *  error kept so the control says the right thing (maybe, serverMaybe, unreadable, notOurs, noAnswer, applyingId: "bitcube
 *  didn't answer in time", never "No answer in a while" after an answer that came at once: R7 #2). */
function startRun(dry_run, requestId = null) {
  S.cal.pending = true;
  mine.request(requestId);
  return api('/api/control/calibrate', { action: 'start', dry_run: !!dry_run, ...(requestId ? { request_id: requestId } : {}) }).catch((e) => {
    const reason = String(e.message || e).replace(/:\s*calibration can't start$/i, '');
    const out = new Error(/^[A-Z][a-z]/.test(reason) && !/^TouchDesigner/.test(reason) ? reason[0].toLowerCase() + reason.slice(1) : reason);
    for (const k of Object.keys(e)) out[k] = e[k];
    mine.id(e?.applyingId);
    throw out;
  }).finally(() => { S.cal.pending = false; });
}
/** A start answered: its progress copy (when it is newer than the one this page has: a start still 'starting' may answer with
 *  the run before's file), and ask again at once. Done only when the server confirms the run showed up (R7 #27). */
function afterStart(r) {
  mine.id(r?.applying_id);
  const c = r?.calibration, p = S.cal.p;
  if (c && typeof c === 'object' && (!p || !(typeof p.updated === 'number' && typeof c.updated === 'number' && c.updated < p.updated))) {
    S.cal.p = c; S.cal.heardAt = performance.now(); S.cal.heardWall = Date.now(); S.cal.error = null;
  }
  S.cal.old = false; S.cal.seenStarted = true;
  watchCalibration(); renderCalibrate(); pollCal(); status.refresh();
}
function mountStart(m) {
  const pair = [];   // Start and Dry run hold each other while one of them is applying
  const start = control($('#cal-start'), { label: 'Calibrate the lights', kind: 'primary', why: startWhy(m), siblings: pair,
    before: 'Starts the real run: patterns on the ropes for about five minutes, then a new LED map to look at before anything changes. Asks first.',
    confirm: { title: 'Start calibration?', body: "The ropes go into patterns now, for about five minutes, and the show stops meanwhile. Keep people out of the camera's view.", ok: 'Start', cancel: 'Not now', destructive: true },
    ...CAL_CTL.start, expectS: EXPECT_S.calibrate, usual: START_USUAL, run: ({ requestId } = {}) => startRun(false, requestId), done: 'Calibration started', fail: "Calibration didn't start",
    noAnswer: 'this block shows the run if it started', unconfirmed: 'this block shows the run if it starts; if none does, try again or call Gavin',
    serverConfirms: true, onSent: afterStart, onFail: () => pollCal() });
  const dry = control($('#cal-dry'), { label: 'Dry run: the lights stay as they are', kind: 'plain', why: dryWhy(m), siblings: pair,
    before: 'Walks the same steps without touching the lights or the camera, about a minute, to show that bitcube can run one.',
    ...CAL_CTL.dry, expectS: EXPECT_S.calibrate, usual: START_USUAL, run: ({ requestId } = {}) => startRun(true, requestId), done: 'Dry run started', fail: "The dry run didn't start",
    noAnswer: 'this block shows the run if it started', unconfirmed: 'this block shows the run if it starts; if none does, try again or call Gavin',
    serverConfirms: true, onSent: afterStart, onFail: () => pollCal() });
  pair.push(start.button, dry.button);
  start._why = startWhy(m); dry._why = dryWhy(m);
  return { start, dry };
}
/** Stop, mounted once per run (its applying and failed words stay while the patterns move on). Never blocked: a cancel always
 *  gets through on the server too. A dry run touches no lights. */
function mountStop(dry) {
  return control($('#cal-stop'), { label: dry ? 'Stop the dry run' : 'Stop and restore the ropes', kind: 'danger',
    before: dry ? 'Ends the dry run now.' : CAL_COPY.stopBefore,
    ...(dry ? CAL_CTL.stopDry : CAL_CTL.stop), run: () => api('/api/control/calibrate', { action: 'cancel' }), fail: "It didn't stop",
    noAnswer: 'the progress above shows whether it is still running',
    done: (r) => (r?.forced && !dry ? 'Stopped, but it had to be forced' : r?.cancelled === false ? 'Nothing was running' : 'Stopped'),
    onDone: (r) => { if (r?.calibration) { S.cal.p = r.calibration; S.cal.heardAt = performance.now(); S.cal.heardWall = Date.now(); if (r.forced) S.cal.p.restored = false; } watchCalibration(); renderCalibrate(); pollCal(); status.refresh(); },
    onFail: () => pollCal() });
}
/** Use this map: rebuild the river's year. Long (EXPECT_S.rebuild), blocked by the model's rebuild reason (a calibration, another
 *  change being applied anywhere, the river's year not running…), and done only when the server confirms its entry (TouchDesigner
 *  answering on the rebuilt file): the server records the map in use (GET /api/calibration rebuilt) only then, and every phone's
 *  card says "Map in use"; one the server gives up on ends unconfirmed, "… call Gavin" (R7 #26). */
function mountRebuild(p) {
  const keep = Array.from($('#cal-body').querySelectorAll('[data-cal]'));
  const c = control($('#cal-rebuild'), { label: "Use this map: rebuild the river's year", kind: 'primary', why: S.m ? S.m.controls.rebuild.why : NO_CONTACT, siblings: keep,
    before: `Bakes the new LED map (${esc(captureWhen(p.result?.capture, p.result?.map).words)}) into the river's year and restarts TouchDesigner on it: about a minute dark. Asks first.`,
    confirm: { title: "Rebuild the river's year with this map?", body: "Bakes the new LED map into the river's year and restarts TouchDesigner on it: about a minute dark.", ok: 'Rebuild', cancel: 'Not now', destructive: true },
    ...CAL_CTL.rebuild, expectS: EXPECT_S.rebuild, run: ({ requestId } = {}) => { mine.request(requestId); return api('/api/control/rebuild', { file: YEAR_FILE, ...(requestId ? { request_id: requestId } : {}) }); }, serverConfirms: true,
    done: "The river's year uses the new map", fail: "The river's year is unchanged",
    noAnswer: 'this card says "Map in use" if it did',
    unconfirmed: "mission control hasn't confirmed which map the river's year uses; call Gavin",
    onSent: (r) => { mine.id(r?.applying_id); watchCalibration(); pollCal(); status.refresh(); },
    onDone: () => { pollCal(); renderCalibrate(); loadMap(); },
    onFail: (e) => { mine.id(e?.applyingId); pollCal(); status.refresh(); } });
  c._why = S.m ? S.m.controls.rebuild.why : NO_CONTACT;
  return c;
}
// ---- the test pattern ------------------------------------------------------------------------------------------
/** Lights → Test pattern: one button that switches the ropes and the panels into the test pattern and back (td/ropes/artnet_out.py
 *  test_frame, td/panels/panel_test.glsl). It reads Start or Stop from the full check (show.test), and changes only while it isn't
 *  sending, so the press in flight keeps its words and focus stays on the same button. Blocked by the model's test reason (a
 *  calibration, TouchDesigner not answering, a change in flight). */
const TEST_COPY = {
  off: { label: 'Start the test pattern', kind: 'primary', done: 'Test pattern on', fail: "The test pattern didn't start",
    before: 'Every rope fills red, green, blue, then white, each wiping down from the plug end, so every LED shows every colour. Each screen shows four coloured panels with its number in white squares in the red one, which also shows which way up it is. The river stops until you press Stop. Asks first.',
    confirm: { title: 'Start the test pattern?', body: 'The ropes and the panels leave the river for the test pattern until someone presses Stop.', ok: 'Start', cancel: 'Not now', destructive: true } },
  on: { label: 'Stop the test pattern', kind: 'danger', done: 'Back to the river', fail: 'The test pattern is still on', confirm: null,
    before: 'The test pattern is on: colours wipe down every rope, and each screen shows its number in white squares. Stop puts back what the ropes and panels showed before.' },
};
function renderTest(own = null) {
  const m = S.m, on = !!m?.show.test?.on;
  if (!S.testCtl) {
    S.testCtl = control($('#test-ctl'), { action: 'test', expectS: EXPECT_S.test, noAnswer: 'this card says whether the test pattern is on',
      run: ({ requestId } = {}) => { const want = S.testWant; mine.request(requestId); return api('/api/control/test', { on: want, ...(requestId ? { request_id: requestId } : {}) }); },
      onSent: (r) => { mine.id(r?.applying_id); status.refresh(); pollLights(); },
      onFail: (e) => { mine.id(e?.applyingId); status.refresh(); } });
    S.testOn = null;
  }
  const c = S.testCtl;
  if (S.testOn !== on && !c.busy && c.state !== 'confirm') {
    S.testOn = on; S.testWant = !on;
    const t = TEST_COPY[on ? 'on' : 'off'];
    c.update({ ...t, what: changeLabel('test', { on: !on }) });
  }
  setWhy(c, m ? m.controls.test.why : NO_CONTACT, m?.controls.test.by, (own ?? ownChanges()).ids);
}

$('#cal-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cal]');
  if (!b || b.disabled) return;
  const started = S.cal.p?.started;
  if (b.dataset.cal === 'dismiss' || b.dataset.cal === 'again') dismiss(started);
  else if (b.dataset.cal === 'dismiss-lost') dismiss(`${started}~lost`);
});

// ---- footer -------------------------------------------------------------------------------------------------------
function renderFooter() {
  put('foot', `<div class="links">${[['Remembered river (debug view)', '/remembered'], ['HUB75 simulator (experiment)', '/hub75'], ...DOC_LINKS].map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div>`);
}

// ---- go ----------------------------------------------------------------------------------------------------------
loadMap(); pollLights(); pollCal();
setInterval(pollLights, LIGHTS_MS);
setInterval(() => retryMap(true), MAP_RETRY_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollLights(); retryMap(true); if (S.room.on) pollRoom(); if (S.cal.p?.running || S.calCtl.rebuild?.busy) pollCal(); } });
document.addEventListener('mc:check', () => { status.refresh(); pollLights(); pollCal(); retryMap(true); });
document.addEventListener('mc:theme', () => render());
addEventListener('resize', () => { drawMap(liveView()); drawStrips(); });
tick(() => {   // ages only: the state line's "from bitcube", the captions, the time left; the rows stay put
  if (S.m) { S.m = model(); renderStateLine(); } else renderStateLine();   // before the first answer: the wait's words tick too
  const live = liveView(), cap_ = $('#map-cap');
  if (live && S.lights.frames && cap_) {
    const t = `<b>Live</b> · what TouchDesigner is sending · from bitcube · ${esc(fmt.nb(dur(frameAgeS())))} ago${roomWords()}`;
    if (S.html['map-cap'] !== t) put('map-cap', t);
    if ((frameOld() || pageDown()) !== $('#mapwrap').classList.contains('dim')) renderMapCard();
  } else if (S.room.on && S.room.url && S.capBase != null) put('map-cap', S.capBase + roomWords());   // the room picture's age ticks in the Map caption too
  if (S.lights.frames && frameOld() !== $('#strips').classList.contains('dim')) renderStrips();
  if (!S.map.loaded) renderMapCard();   // "Loading the LED map…", then "hasn't loaded yet: no answer for N s" ticking
  tickCalibrate();
});
