// The Lights page's words and decisions (docs/mission-ui.md, "Lights" and "Calibrate"): the Calibrate checklist and why its
// buttons can't run, which view the Calibrate block shows, whether the river's year uses a run's map, the run's "last heard"
// note, the state line's next line, the LED map's provenance words, and where the rope numbers sit on the map. Pure ES
// module, no DOM: lights.js uses it in the browser and test/lights-words.test.mjs under node --test.
import { dur, entryWords, entrySaid, untimed, changeLabel } from './model.js';

const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s ?? '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const N_ROPES = 20;
export const DRIFT_FINE_PX = 30;          // calibrate.py's default --max-drift
export const CAL_QUIET_S = 30;            // a run not heard from for this long greys its progress
export const NO_CONTACT = "this page hasn't heard from mission control yet";

// ---- the checklist and why Start and Dry run can't run ------------------------------------------------------------
/** The Calibrate checklist from the model, each line a sentence: { level, text, why } (why: the control's reason when this line
 *  blocks the start, lowercase for "Not possible now: …"). The last line, the room, is the installer's own check. */
export function calChecklist(m) {
  const item = (id) => m?.items.find((x) => x.id === id) ?? null;
  const lv = (id) => item(id)?.level ?? 'unknown';
  const both = [lv('rope box 1'), lv('rope box 2')];
  const boxLevel = both.every((l) => l === 'ok') ? 'ok' : both.includes('down') ? 'down' : both.includes('warning') ? 'warning' : 'unknown';
  const boxWhy = boxLevel === 'unknown' ? "the rope boxes haven't been checked yet"
    : both[0] !== 'ok' && both[1] !== 'ok' ? 'neither rope box is answering' : both[0] !== 'ok' ? "rope box 1 isn't answering" : "rope box 2 isn't answering";
  const td = item('touchdesigner'), tdSum = td?.summary ?? '';
  const tdWhy = !td || td.level === 'unknown' ? "TouchDesigner hasn't been checked yet"
    : td.level === 'down' ? (/not running/i.test(tdSum) ? "TouchDesigner isn't running" : "TouchDesigner isn't answering")
    : /slow/i.test(tdSum) ? `TouchDesigner is running slowly (${tdSum.replace(/^Running slowly: /i, '')})`
    : /restart|start/i.test(tdSum) ? 'TouchDesigner is still starting' : "TouchDesigner isn't ready";
  const cam = lv('gallery camera');
  const camWhy = cam === 'unknown' ? "the gallery camera hasn't been checked yet" : "the gallery camera isn't reachable";
  const line = (level, ok, why) => ({ level, why, text: level === 'ok' ? ok : cap(why) });
  return [
    line(lv('touchdesigner'), 'TouchDesigner answers', tdWhy),
    line(boxLevel, 'Both rope boxes answer', boxWhy),
    line(cam, 'The gallery camera is reachable', camWhy),
  ];
}
export const ROOM_CHECK = "The room is dark and nobody is in the camera's view (you check)";

/** Why Calibrate can't start now: the model's reason for a calibration's start (a run already on, another change being
 *  applied, TouchDesigner, the gallery camera), else the checklist's first failing line (the rope boxes); null when it can. */
export function startWhy(m) {
  if (!m) return NO_CONTACT;
  return m.controls.calibrate.why ?? calChecklist(m).find((c) => c.level !== 'ok')?.why ?? null;
}
/** The reasons that stop a dry run too: no contact, bitcube itself, another change being applied, a run already on. A dry run
 *  touches no lights and no camera and runs nothing on TouchDesigner (calibrate.py --dry-run), so those reasons don't. */
const DRY_STOPS = [/^wait: /, /^a calibration is already running$/, /^a dry run is already running$/, /^this page can't reach mission control$/, /^bitcube is offline$/,
  /^bitcube hasn't been checked yet$/, /^mission control hasn't checked bitcube for /];
export function dryWhy(m) {
  if (!m) return NO_CONTACT;
  const w = m.controls.calibrate.why;
  return w && DRY_STOPS.some((re) => re.test(w)) ? w : null;
}

// ---- which view the Calibrate block shows ---------------------------------------------------------------------
/** Why a run that the last good read showed running is lost to this page: bitcube is offline (the model says so), or its job
 *  died without a final write (the progress file's stale). A read that failed while bitcube answers is not a lost run. */
export function lostWhy(p, m) {
  if (p?.running !== true) return null;
  if (p.stale === true) return 'stale';
  if (m?.overall.cause === 'bitcube-offline') return 'offline';
  return null;
}
/** The view: 'before' | 'run' | 'lost' | 'stopped' | 'failed' | 'done' | 'inuse', and its key (a new key means a new view).
 *  p: the last good progress (null: none); dismissed(key): the installer pressed OK on it on this phone ('<started>' a result,
 *  '<started>~lost' a lost run, so OK on a lost run never hides the result of the same run later); old: a result that ended
 *  long before the page opened; rebuiltAt: when the river's year was rebuilt with this run's map (ms), or null. */
export function calView({ p, m, dismissed = () => false, old = false, rebuiltAt = null }) {
  const dry = !!(p?.dry_run || p?.mode === 'dry-run' || p?.result?.dry_run);
  if (p?.running === true) {
    const lost = lostWhy(p, m);
    if (!lost) return { view: 'run', key: `run:${p.started}:${dry}`, dry };
    if (!dismissed(`${p.started}~lost`)) return { view: 'lost', key: `lost:${p.started}:${lost}`, dry, lost };
    return { view: 'before', key: 'before', dry: false };
  }
  if (p && !old && !dismissed(String(p.started))) {
    if (p.cancelled) return { view: 'stopped', key: `stopped:${p.started}:${p.restored}:${dry}`, dry };
    if (p.ok === false) return { view: 'failed', key: `failed:${p.started}:${p.error}`, dry };
    if (p.ok === true) return rebuiltAt != null && !dry ? { view: 'inuse', key: `inuse:${p.started}:${rebuiltAt}`, dry } : { view: 'done', key: `done:${p.started}:${dry}`, dry };
  }
  return { view: 'before', key: 'before', dry: false };
}
/** When the river's year was rebuilt with this run's map (ms on mission control's clock), else null: GET /api/calibration's
 *  rebuilt { at, map, file } names the same map and is later than the run's end (a run writes the day's map file again, so
 *  an earlier rebuild of a file with the same name baked the old map). The same on every phone. */
export function rebuiltFor(p, rebuilt) {
  const map = p?.result?.map, end = typeof p?.updated === 'number' ? p.updated * 1000 : null;
  if (!map || p.running || p.ok !== true || p.result.dry_run || !rebuilt || typeof rebuilt.at !== 'number') return null;
  // the server names the run it rebuilt (its started stamp, bitcube's clock): match that exactly, never the mini's clock
  // against bitcube's; an older record without it falls back to the map and the times
  if (typeof rebuilt.run === 'number') return rebuilt.map === map && rebuilt.run === p.started ? rebuilt.at : null;
  return rebuilt.map === map && (end == null || rebuilt.at > end) ? rebuilt.at : null;
}

// ---- a run's progress: heard from or not -----------------------------------------------------------------------
/** The note under a run's progress: { grey, text } from the seconds since the last good read (heardS) and whether the last
 *  read failed. One failed read keeps the run (and Stop) on screen with "can't be read just now"; 30 s without a good read
 *  greys the progress. The time left is not shown while it is grey (it would count down on nothing). */
export function runNote({ heardS, failing }) {
  const grey = heardS != null && heardS >= CAL_QUIET_S;
  const ago = heardS == null ? '' : ` · last heard from bitcube ${dur(heardS)} ago`;
  if (failing) return { grey, text: `Progress can't be read just now${ago}` };
  return grey ? { grey, text: `Last heard from bitcube ${dur(heardS)} ago` } : { grey: false, text: '' };
}

/** One read of GET /api/calibration: { good: true, p, rebuilt } (p null for "no job"; rebuilt undefined when the answer has
 *  none), or { good: false, error }. A good read is mission control's progress answer, which always carries a boolean
 *  `running`; anything else (a 2xx that isn't JSON, a cut-off body, a proxy's page, a refusal) is a failed read, so the last
 *  good progress and Stop stay (R6 #29). */
export function calRead({ ok, status, body }) {
  const j = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (ok && j && typeof j.running === 'boolean') return { good: true, p: j.none ? null : j, rebuilt: 'rebuilt' in j ? j.rebuilt ?? null : undefined };
  const said = j && typeof j.error === 'string' && j.error.trim() ? j.error.trim().replace(/^Can't read the calibration:\s*/i, '') : '';
  return { good: false, status, error: said || (!ok ? "mission control didn't answer" : "mission control's answer couldn't be read") };
}
/** The Calibrate card's time left: the model's (show.calibration: left_words, else left_s), the one time the state line, the
 *  Status band and the Ropes tile give, never a second reckoning (R6 #13): "About 4 min left", "Nearly done". '' while the
 *  model doesn't know the run. */
export function calLeft({ cal, dry }) {
  if (dry) return 'A dry run takes about a minute.';
  const w = typeof cal?.left_words === 'string' ? cal.left_words.trim() : '';
  const more = /^about (.+) more$/.exec(w);
  if (more) return `About ${more[1]} left`;
  if (w) return cap(w);
  return typeof cal?.left_s === 'number' ? `About ${dur(cal.left_s)} left` : '';
}

// ---- the state line --------------------------------------------------------------------------------------------
/** The changes that alter what the ropes or the panels show: a switch or a rebuild restarts TouchDesigner (the lights go dark),
 *  the ropes, the panels, the lighting port, a calibration's start. A mode, target or rules change only steers the river. */
export const LIGHTS_CHANGES = ['switch', 'rebuild', 'ropes', 'hub75', 'lightsroute', 'calibrate'];
/** The first change in flight (show.applying: any phone, or the studio chat) that alters what the lights show and began after
 *  bitcube's reading on the state line (readingAgeS: that reading's age, s), else null: the reading may no longer hold. */
export function changeSince(m, readingAgeS) {
  if (!m || typeof readingAgeS !== 'number') return null;
  return (m.show.applying ?? []).find((a) => LIGHTS_CHANGES.includes(a.action) && typeof a.elapsed_s === 'number' && a.elapsed_s < readingAgeS) ?? null;
}
const RANK = { down: 0, warning: 1, unknown: 2, ok: 3 };
/** The state line's mark: the worse of the ropes and the panels (it speaks for both); grey for a last answer (stale, or contact
 *  lost); and never green while a change that alters the lights runs past a reading from before it (R6 #3: "✓ The ropes show
 *  the river" during a restart). A worse level stays: the model knows something is wrong. */
export function stateLevel({ levels, lost = false, stale = false, change = null }) {
  if (lost || stale) return 'unknown';
  const worst = [...levels].sort((a, b) => (RANK[a] ?? 2) - (RANK[b] ?? 2))[0] ?? 'unknown';
  return worst === 'ok' && change ? 'unknown' : worst;
}
/** The band's quiet line for each change in flight, under the state line (Lights has no band): [{ label, line, said }], line
 *  "Applying: the restart on the river's year · 0:05 · usually about 1 min" (model.js entryWords, the band's own words, which
 *  say "Waiting for bitcube to show …" once the request has answered; else applyingWords), said the same without its times.
 *  own: this page's own changes (their controls say them): { ids } the entries its controls hold (applying_id: the change is
 *  this page's whatever its control shows now, confirming or unconfirmed), { actions } a request still in flight that has no id
 *  yet; a plain list is actions. */
export function applyingNow(m, own = []) {
  const ids = Array.isArray(own) ? [] : own?.ids ?? [], actions = Array.isArray(own) ? own : own?.actions ?? [];
  return (m?.show.applying ?? []).filter((a) => !actions.includes(a.action) && !(a.id && ids.includes(a.id))).map((a) => {
    // said with its source, as Status's band region says it: "Applying: <label>, from the studio chat." (R7 #12)
    return { label: a.label, line: entryWords(a, a.elapsed_s), said: entrySaid(a) };
  });
}
/** The status with its calibration taken from a newer progress read that shows the run ended (p: GET /api/calibration's
 *  progress), so the controls a finished run blocked (Rebuild, the ropes) unlock with the result card, not up to a poll later
 *  (R7 #31). Anything else (an older copy, a run still going, no copy) leaves the status as it is. Never changes its argument. */
export function calNewer(status, p) {
  const pv = status?.probe?.value, cur = pv?.calibration;
  if (!pv || typeof pv !== 'object' || !p || typeof p !== 'object' || p.running !== false || typeof p.updated !== 'number') return status;
  if (cur && typeof cur === 'object' && (cur.running !== true || (typeof cur.updated === 'number' && cur.updated >= p.updated))) return status;
  return { ...status, probe: { ...status.probe, value: { ...pv, calibration: p } } };
}
/** A text without its ticking times ("for about 40 s more", "for 3 min", "6 min ago"): what a live region may say (model.js,
 *  shared with Status's band region). */
export { untimed };
/** What the state line's hidden polite region says: its words without a ticking time, and each change in flight by name, so
 *  a screen reader hears it again only when the state changes, never at every poll of a calibration (R6 #8). */
export function stateLive({ words, lost = false, stale = false, applying = [] }) {
  const w = untimed(words);
  const head = lost ? `No contact with mission control. ${w}` : stale ? `Last seen: ${w}` : w;
  return [head, ...(lost ? [] : applying.map((a) => a.said ?? `Applying: ${a.label}.`))].join(' ');
}

// ---- the Calibrate block's own words ------------------------------------------------------------------------------
/** calibrate.py puts back what capture.py found (Active, Source, Brightness): the ropes return to what they showed before the
 *  run, which is dark when they were dark on purpose, never always "the river" (R6 #22). */
export const CAL_COPY = {
  stopBefore: 'Ends the run now; the ropes go back to what they showed before within a few seconds. No map is written.',
  stopped: 'Stopped; the ropes are back to what they showed before. No map was written.',
  restored: 'The ropes are back to what they showed before; no map was written.',
};
/** The run's fine print: "Started 21:14, using the gallery camera. When it ends, …" (a dry run touches no camera). */
export function runFine({ started, cam, dry }) {
  return dry ? `Started ${started}. The lights stay as they are.`
    : `Started ${started}${cam ? `, using the ${cam} camera` : ''}. When it ends, the ropes go back to what they showed before, by themselves.`;
}
/** A finished run's heading: not "Map made" over a line that starts "Map made 23 Oct …" (R6 #24). */
export const resultHead = (dry) => (dry ? 'Dry run finished' : 'New LED map');
/** What each Calibrate control is applying, for ui.js control()'s own "Applying: <what>…" line and announcement: the change's
 *  one name (model.js changeLabel, as lib/applying.mjs labels it for the other phones, R7 #19). Stop is no change in flight
 *  anyone else sees: it says what it does, "Stopping the calibration…", never "Applying: the stop of …". */
export const CAL_CTL = {
  start: { what: changeLabel('calibrate', { action: 'start' }) },
  dry: { what: changeLabel('calibrate', { action: 'start', dry_run: true }) },
  stop: { what: 'the stop of the calibration', pending: 'Stopping the calibration…' },
  stopDry: { what: 'the stop of the dry run', pending: 'Stopping the dry run…' },
  rebuild: { what: changeLabel('rebuild', { file: 'river-local-oct-22-seasons.toe' }) },
};

// ---- the state line's next line --------------------------------------------------------------------------------
/** Under the state line when the verdict isn't OK: the band's headline cause and where to act ({ text, href, link }), or null.
 *  The cause is left out when the line above already says it ("bitcube is offline" once, not twice). During a calibration
 *  the place to act is the Calibrate block below (its progress and Stop), not Status, which sends you back here.
 *  split: ui.js splitHeadline (the band's split). */
export function nextLine(m, from, split) {
  if (!m) return null;
  const o = m.overall;
  if (o.level === 'ok' || o.cause === 'page') return null;
  const [cause] = split(o.headline);
  const head = /^Checking$/i.test(cause.trim()) ? o.headline : cause;
  const text = head.replace(/[.\s]+$/, '');
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[.\s]+$/, '').trim();
  const same = norm(text) === norm(from);
  if (o.cause === 'calibrating') return { text: same ? '' : `${cap(text)}.`, href: '#calibrate', link: 'Progress and Stop → Calibrate' };
  return { text: same ? '' : `${cap(text)}.`, href: '/status', link: 'What to do → Status' };
}

// ---- provenance and a run's result ------------------------------------------------------------------------------
/** "pixelmap-20261023-122417" → { day: '20261023', words: '23 Oct 12:24' } (else the date in a file name, else "an unknown day"). */
export function captureWhen(capture, file) {
  const m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(capture || '');
  if (m) return { day: m[1] + m[2] + m[3], words: `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[4]}:${m[5]}` };
  const f = /(\d{4})-(\d{2})-(\d{2})/.exec(file || '');
  return f ? { day: f[1] + f[2] + f[3], words: `${Number(f[3])} ${MONTHS[Number(f[2]) - 1]}` } : { day: null, words: 'an unknown day' };
}
/** How far the camera moved while the map was made, in plain words: "the camera moved 10 px (fine)". */
export function driftWords(px) {
  if (typeof px !== 'number' || !Number.isFinite(px)) return '';
  return `the camera moved ${Math.round(px)} px (${px < DRIFT_FINE_PX ? 'fine' : 'too much'})`;
}
const list = (ns) => (ns.length > 1 ? `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}` : String(ns[0]));
/** A finished run's result in one line: "Map made 23 Oct 21:14 · 18 of 20 ropes found · ropes 9 and 17 not found (dark) ·
 *  2,103 LEDs seen, the rest placed along the rope · the camera moved 13 px (fine) · screen 1 found". seenOnPage: the LEDs
 *  the map on the page saw, for an older result that doesn't say (null when the page's map is another one). */
export function resultWords(res, seenOnPage = null) {
  const when = res.date || res.capture ? captureWhen(res.capture, res.map) : { words: 'today' };
  const dark = Array.isArray(res.ropes_dark) ? res.ropes_dark : [];
  const darkWords = dark.length ? ` · ${dark.length === 1 ? 'rope' : 'ropes'} ${list(dark)} not found (dark)` : '';
  const ropesFound = Array.isArray(res.ropes_found) ? res.ropes_found.length : N_ROPES - dark.length;
  const quads = Array.isArray(res.hub75_quads) && res.hub75_quads.length ? ` · ${res.hub75_quads.length === 1 ? 'screen 1 found' : `${res.hub75_quads.length} screens found`}` : '';
  const drift = typeof res.drift_px === 'number' ? ` · ${driftWords(res.drift_px)}` : '';
  const seen = typeof res.seen === 'number' ? res.seen : seenOnPage;
  const points = seen != null ? ` · ${seen.toLocaleString('en-US')} LEDs seen, the rest placed along the rope` : typeof res.points === 'number' ? ` · ${res.points.toLocaleString('en-US')} LEDs placed` : '';
  return `Map made ${when.words} · ${ropesFound} of ${N_ROPES} ropes found${darkWords}${points}${drift}${quads}.`;
}

// ---- the LED map's own state --------------------------------------------------------------------------------------
/** Why the LED map isn't on the page, never "there is none" unless mission control answered that there is none:
 *  { level, note (over the map), prov (the provenance card), screens (the screens line) } or null when it is there.
 *  st: { loaded, map, error, waitS } (waitS: seconds this attempt has waited). */
export function mapMissing({ loaded, map, error, waitS }) {
  if (map) return null;
  if (!loaded || error) {
    const why = error ? `: ${error}` : waitS != null && waitS > 30 ? `: no answer for ${dur(waitS)}` : '';
    const asking = !loaded && !(waitS > 30) ? 'Loading the LED map…' : `The LED map hasn't loaded yet${why}. This page asks again by itself.`;
    return { level: 'unknown', note: asking, prov: asking, screens: 'Screens: not known yet.', chip: 'Not known yet' };
  }
  return { level: 'unknown', note: 'No LED map yet: calibrate to make one. Rope by rope below shows what is being sent.', prov: 'No LED map yet. Calibrate to make one.',
           screens: 'Screens: not located yet.', chip: 'Not mapped yet' };
}

// ---- the rope numbers on the map --------------------------------------------------------------------------------
/** Where each rope's number goes: near its plug end, never over another label or over any plug end, and placed so that its own
 *  plug end is the nearest one; when no such spot is free, the nearest free spot with a leader line to its plug end. Nothing
 *  is ever nearer another rope's plug end without a line.
 *  anchors: [{ x, y } | null] per rope (canvas px); widths: per rope; h: label height; W, H: the canvas; taken: boxes already
 *  drawn ({ x, y, w, h }, centred: the screens' numbers); only: the ropes to number (a Set; default all), the rest still count
 *  as plug ends a number must not sit nearer to. Returns [{ x, y, w, h, leader } | null] per rope. */
export function placeLabels(anchors, widths, { h = 20, W = Infinity, H = Infinity, taken = [], gap = 15, only = null } = {}) {
  const placed = taken.map((b) => ({ ...b }));
  const pts = anchors.map((a, i) => (a ? { i, x: a.x, y: a.y } : null)).filter(Boolean);
  const out = anchors.map(() => null);
  // above first (the plug ends hang from the ceiling: below them are the ropes themselves), then beside, then below
  const DIRS = [[0, -1], [0.71, -0.71], [-0.71, -0.71], [1, 0], [-1, 0], [0, 1], [0.71, 0.71], [-0.71, 0.71]];
  const RINGS = [1, 1.6, 2.3, 3.1, 4, 5, 6.2, 7.5, 9, 11, 13.5, 16];
  for (const a of pts) {
    if (only && !only.has(a.i)) continue;
    const w = widths[a.i] ?? 24;
    const fit = (x, y) => [Math.min(W - w / 2 - 1, Math.max(w / 2 + 1, x)), Math.min(H - h / 2 - 1, Math.max(h / 2 + 1, y))];
    const hitsBox = (x, y) => placed.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 2 && Math.abs(b.y - y) < (b.h + h) / 2 + 2);
    const coversDot = (x, y) => pts.some((q) => Math.abs(q.x - x) < w / 2 + 3 && Math.abs(q.y - y) < h / 2 + 3);
    const ownNearest = (x, y) => { const d = Math.hypot(a.x - x, a.y - y); return pts.every((q) => q === a || Math.hypot(q.x - x, q.y - y) > d + 2); };
    let best = null, fallback = null;
    for (const r of RINGS) {
      for (let k = 0; k < DIRS.length; k++) {
        const dist = gap * r + (DIRS[k][0] ? w / 2 * Math.abs(DIRS[k][0]) : 0);
        const [x, y] = fit(a.x + DIRS[k][0] * dist, a.y + DIRS[k][1] * dist);
        if (hitsBox(x, y) || coversDot(x, y)) continue;
        if (ownNearest(x, y)) { best = [x, y]; break; }
        fallback ??= [x, y];
      }
      if (best) break;
    }
    const [x, y] = best ?? fallback ?? fit(a.x, a.y - gap);
    const d = Math.hypot(a.x - x, a.y - y);
    const leader = !ownNearest(x, y) || d > h + gap;
    const box = { x, y, w, h, leader };
    placed.push(box); out[a.i] = box;
  }
  return out;
}
