// Mission control's status model: derive(status, nowMs) turns one GET /api/status payload into everything the
// pages say, so every verdict on screen comes from one place that the fixtures test (test/model.test.mjs).
// Pure ES module, no static imports: it runs in the browser and under node --test. The one outside input is the show
// registry (shows.json at the repo root, docs/shows.md), read once at load: from disk under node, from GET /shows.json in a page. Long version of the shape and the
// rules: ~/claude/local/ui-shots/design/model.md.
//
// derive(status, nowMs) -> {
//   overall: { level, headline, detail, action, stale, cause, also, checked }
//     level     'ok' | 'warning' | 'down' | 'unknown': what it means for the show (not the worst dot on the page)
//     headline  one line of plain words: the one thing that matters
//     detail    one or two sentences: why, since when
//     action    what to do, or null when there is nothing to do
//     stale     a source the verdict needs is older than it should be, or the page could not fetch
//     cause     the id of the problem behind the headline (null when all is well)
//     also      the other problems' headlines, most important first
//     checked   { page_age_s, bitcube_age_s, seasons_age_s, modal_age_s, probe_age_s }: seconds, or null
//   problems: [ { id, level, headline, detail, action, items } ]   one per cause, the headline's first
//   show: what the piece is doing: { file, boot_file, show_files, season, phase, weights, intensity, mode, target,
//         presence, ropes, panels, river, scene, modal, fresh, calibration, applying, words }, each with plain words for the page
//         (ropes and panels carry { state, words, summary }: a state word, a sentence, and the item's summary)
//   items: [ { id, name, level, summary, detail, action, checked_from, age_s, stale, address, cause, muted } ]
//     one per piece of equipment or link, what matters most first and OK items last. `level` is the state of
//     that piece itself (a down camera is down even when the show does not need it; `overall` says what it
//     means), `cause` the problem it belongs to, `muted` a piece with nothing to show (the people counter).
//   controls: { mode, target, rules, ropes, hub75, switch, bootfile, lightsroute }: { possible, why }
//   sources: { bitcube, seasons, modal, probe }: { present, ok, error, age_s, stale }
// }

// ---- the rules, as constants --------------------------------------------------------------------------------
export const POLL_S = { bitcube: 5, seasons: 5, modal: 30, probe: 60 };   // mission.mjs's timers
export const STALE_FACTOR = 3;                  // a source is stale after three missed polls
export const PAGE_STALE_S = 30;                 // the page could not fetch for this long: it cannot see the show
export const TD_SLOW_FPS = 30;                  // under this the river visibly jerks (the timeline is 60)
export const COMING_UP_H = 0.25;                // bitcube up for less than this: still starting
export const MODAL_LATE_MIN = 15;               // Dave's agent ticks every 5 min; this many daytime minutes late is a fault
export const MODAL_REST = { from: 23 * 60 + 55, to: 7 * 60 };   // it rests 23:55-07:00 Pacific (01:55-09:00 Central)
export const CLIP_LATE_S = 5 * 60;              // the Modal link posts a clip every 20-70 s; none for 5 min = failing
export const DISK_LOW_GB = 20;
export const TZ = 'America/Los_Angeles';        // bitcube, the mini and the team keep Pacific time
// ---- the show registry (shows.json, docs/shows.md) ------------------------------------------------------------------
/** shows.json as read at load ({ boot_default, shows: [...] }), or null when it couldn't be read (nothing is then offered). */
export const REGISTRY = await loadRegistry();
async function loadRegistry() {
  const ok = (r) => (r && typeof r === 'object' && Array.isArray(r.shows) ? r : null);
  try {
    if (typeof window === 'undefined' && typeof process !== 'undefined') {
      const { readFileSync, existsSync } = await import('node:fs');
      const { main, extra } = registryPaths(process.env, existsSync);
      const reg = ok(JSON.parse(readFileSync(main, 'utf8')));
      if (reg && extra) reg.shows = [...reg.shows, ...JSON.parse(readFileSync(extra, 'utf8')).shows];
      return reg;
    }
    const r = await fetch('/shows.json', { cache: 'no-cache' });
    return r.ok ? ok(await r.json()) : null;
  } catch { return null; }
}
/** Where the server (and model.js under node) reads the registry: main is MISSION_SHOWS_FILE, else shows.json at the repo
 *  root; extra, shows added on top for tests and fixture mode (a test visualization: test/fixtures/build.mjs), is
 *  MISSION_SHOWS_EXTRA, else in fixture mode the fixtures' _shows.extra.json, else none. The server serves the result. */
export function registryPaths(env, exists) {
  const main = env.MISSION_SHOWS_FILE || new URL('../../shows.json', import.meta.url);
  const fx = env.MISSION_FIXTURES ? `${env.MISSION_FIXTURES.replace(/\/+$/, '')}/_shows.extra.json` : null;
  return { main, extra: env.MISSION_SHOWS_EXTRA || (fx && exists(fx) ? fx : null) };
}
/** Every show file mission control can name: { kind, label, offered, show }. kind is the show's role for the page's
 *  verdicts ('year': the river's year, serves the year page; 'live': the live river and Dave's agent; 'other': anything else, a
 *  new visualization too); label its words in a sentence ("the river's year"; GLOSSARY.md); show its registry entry (the preview
 *  card's facts). Retired show files (execution plan D27: old-..., and the names before the rename) are never offered. */
export const FILES = {};
for (const sh of REGISTRY?.shows ?? []) {
  if (!sh || typeof sh.file !== 'string') continue;
  FILES[sh.file] = { kind: sh.role === 'year' || sh.role === 'live' ? sh.role : 'other', label: String(sh.label || sh.title || sh.file.replace(/\.toe$/i, '')),
                     offered: sh.offered === true, show: sh };
}
for (const old of ['old-river-online-oct-20.toe', 'old-river.toe', 'river-online-oct-20.toe', 'river-local-oct-18.toe', 'river.toe']) {
  FILES[old] ??= { kind: 'other', label: 'an old show file', offered: false, show: null };
}
const UNLISTED = 'an unlisted show file';       // a file mission control doesn't list: its name (a .toe) stays in raw
// probe.ps1 reports this when boot-file.txt is missing: Start-River.cmd then opens the seasons file, else the online one
export const BOOT_DEFAULT = 'Start-River.cmd default';
/** shows.json's boot_default: the file Start-River.cmd opens when boot-file.txt names no listed show. */
export const BOOT_DEFAULT_FILE = typeof REGISTRY?.boot_default === 'string' ? REGISTRY.boot_default : null;
const YEAR_FILE = Object.keys(FILES).find((k) => FILES[k].kind === 'year'), LIVE_FILE = Object.keys(FILES).find((k) => FILES[k].kind === 'live');
/** The preview card for a show file, before anyone switches to it (docs/mission-ui.md "Show file"): its registry facts in
 *  plain fields, or null for a file the registry doesn't list. */
export function showCard(file) {
  const f = FILES[file], sh = f?.show;
  if (!sh) return null;
  const str = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  return { file, label: f.label, title: str(sh.title) ?? f.label, kind: str(sh.kind), description: str(sh.description),
           inputs: Array.isArray(sh.inputs) ? sh.inputs.filter((x) => typeof x === 'string' && x.trim()) : [],
           created_by: str(sh.created_by), created: str(sh.created), updated_by: str(sh.updated_by), updated: str(sh.updated),
           last_change: str(sh.last_change) };
}
export const CAL_STAGE_S = { 'ropes-capture': 170, 'ropes-decode': 40, 'hub75-capture': 35, 'hub75-locate': 10 };   // calibrate.py EXPECTED_S
export const CAL_TOTAL_S = Object.values(CAL_STAGE_S).reduce((a, b) => a + b, 0);
export const CAL_STAGE_WORDS = { 'ropes-capture': 'photographing the ropes', 'ropes-decode': 'working out where each rope is', 'hub75-capture': 'photographing the panels', 'hub75-locate': 'finding the panels' };
/** A run's stages, in order (calibrate.py STAGES). */
export const CAL_STAGES = Object.keys(CAL_STAGE_S);
/** What a dry run walks at each stage, without the camera (it photographs nothing, so never "photographing the ropes": R9 #19), and
 *  never a bare step number (R10 #18): [the stage list's name, the words "it is at … now" uses]. */
export const DRY_STAGE_WORDS = { 'ropes-capture': ['Ropes', 'the ropes'], 'ropes-decode': ['Rope map', 'the rope map'], 'hub75-capture': ['Panels', 'the panels'],
  'hub75-locate': ['Panel places', "the panels' places"] };
/** A dry run's stage: { n, of, label: "Rope map", words: "the rope map" }, or null for what is no stage (starting, done). One helper
 *  for derive(), Lights and the history (CR9 #16), in words, never "step 2 of 4" (R10 #18). */
export function calStep(stage) {
  const i = CAL_STAGES.indexOf(stage), w = DRY_STAGE_WORDS[stage];
  return i < 0 || !w ? null : { n: i + 1, of: CAL_STAGES.length, label: w[0], words: w[1] };
}
/** A run that is a dry run by name (calibrate.py --dry-run: its own flag, or its mode): "the dry run", its stop "the dry run stop"
 *  (R8 #21), its stages steps (calStep). A decode of earlier photos is not one: it is "a calibration from earlier photos", whose stage
 *  is real work (working out where each rope is from the photos) and whose stop is the calibration stop. One rule for derive(),
 *  Lights, the history, the server's record of a Stop and the agent's step lines (CR9 #7, #8). c: a progress copy, a history event
 *  (its mode) or a start's body (dry_run). */
export const calDryRun = (c) => !!c && typeof c === 'object' && (c.dry_run === true || c.mode === 'dry-run');
/** A run that touches no lights, camera or TouchDesigner: a dry run, or a decode of earlier photos (calibrate.py --decode-only). It
 *  locks nothing on them, on the pages, on the server and on bitcube (R7 #20; probe.ps1 the same). */
export const calNoLights = (c) => calDryRun(c) || (!!c && typeof c === 'object' && (c.mode === 'decode-only' || !!c.decode_only));
// Applying a change (docs/mission-ui.md): what a change in flight blocks, when the server's entry names no blocks of its own.
// A switch or a rebuild restarts TouchDesigner on the year: everything that touches either waits; a boot-file change only
// the file controls (and a calibration's start); a lighting port change the lights; the rest only a second copy of itself.
const TD_TOUCHING = ['overlay', 'ropes', 'hub75', 'test', 'mode', 'target', 'rules', 'rules-reset', 'lightsroute', 'switch', 'rebuild', 'bootfile', 'calibrate'];
export const APPLY_BLOCKS = {
  switch: TD_TOUCHING, rebuild: TD_TOUCHING, bootfile: ['switch', 'rebuild', 'bootfile', 'calibrate'], lightsroute: ['ropes', 'hub75', 'test', 'lightsroute', 'calibrate'],
  overlay: ['overlay'], ropes: ['ropes', 'test'], hub75: ['hub75'], test: ['test', 'ropes', 'calibrate'], mode: ['mode'], target: ['target'], rules: ['rules', 'rules-reset'], 'rules-reset': ['rules-reset', 'rules'],
  calibrate: ['ropes', 'hub75', 'test', 'switch', 'lightsroute', 'rebuild', 'calibrate', 'overlay'],   // a calibration's start: what a running one blocks, and a second start
};
/** The changes that wait for the server's verdict before they are done, and what shows each on bitcube: a full check's reading
 *  (TouchDesigner answering on its file, the boot file, the lighting port: R8 #31, #32) or the run's own progress (a calibration,
 *  recorded only for its start). One table for the server and the pages (CR8 #12): a maybe keeps its lock for these (MAYBE_HOLDS),
 *  a reading confirms the 'reading' ones (lib/applying.mjs CONFIRMED_BY_READING), Recent says they were asked for until their
 *  verdict (lib/history.mjs awaitsVerdict), Last done never calls one done without it (status-words.js lastDoneParts), another
 *  phone hears how one ended (endedSaid), and the history keeps their verdicts for 12 h whatever came after (verdicts, CR8 #1). */
export const AWAITED = Object.freeze({ switch: 'reading', rebuild: 'reading', bootfile: 'reading', lightsroute: 'reading', calibrate: 'progress' });
/** Whether a change (its action and checked body) waits for the server's verdict: one in AWAITED, a calibration only for its start. */
export const awaited = (action, body) => typeof action === 'string' && Object.hasOwn(AWAITED, action) && (action !== 'calibrate' || body?.action === 'start');
/** A calibration start that touches no lights, camera or TouchDesigner: a dry run, or a decode of earlier photos (calibrate.py
 *  --dry-run, --decode-only; CR7 #6). Its entry locks only a second start, and it waits only for one (CR7 #7). */
export const dryStart = (action, body) => action === 'calibrate' && !!body && typeof body === 'object' && body.action === 'start'
  && (body.dry_run === true || (typeof body.decode_only === 'string' && body.decode_only !== ''));
/** The team's words for a change in flight when the server's entry has no label of its own (an older server). */
export const APPLY_LABEL = { switch: 'a show-file switch', rebuild: "the rebuild of the river's year", bootfile: 'the change of the default', lightsroute: 'the change of the lighting port',
  overlay: 'the change of the overlay', ropes: 'the change of the ropes', hub75: 'the change of the panels', mode: 'the change of the mode', target: 'the change of the target', rules: 'the change of the rules',
  'rules-reset': 'the reset of the rules', calibrate: 'the calibration start', test: 'the test pattern' };
/** One name per change (R7 #19), made here for the server's entries (lib/applying.mjs), this phone's own applying
 *  line, every other phone's band, Last done and the unconfirmed line: a noun phrase that names what it changes to, and reads in
 *  every frame ("Applying: …", "Wait: … is being applied.", "Waiting for bitcube to show …", "Last done: …", "… was sent at
 *  21:04"). Never one that reads as a clause ("the ropes change to dark is being applied", "Last done: the rules reset") nor as no
 *  one talks ("the stop of the calibration"): "the change of the ropes to dark", "the reset of the rules", "the calibration stop"
 *  (R8 #20); a dry run's stop by its own name, from the run the server held (R8 #21). `running`: the show file TouchDesigner runs
 *  now, so a switch to it is the button's "the restart on …". */
export function changeLabel(action, body = {}, { running = null } = {}) {
  const b = obj(body) ?? {}, f = typeof b.file === 'string' ? b.file : null, fl = FILES[f]?.label ?? 'a show file';
  const x = num(typeof b.brightness === 'string' ? Number(b.brightness) : b.brightness);
  switch (action) {
    case 'switch': return f && f === running ? `the restart on ${fl}` : `the switch to ${fl}`;
    case 'rebuild': return `the rebuild of ${fl}`;
    case 'bootfile': return f ? `the change of the default to ${fl}` : 'the change of the default';
    case 'lightsroute': return b.route === 'direct' ? "the change of the lighting port to bitcube's LIGHTS port" : b.route === 'router' ? 'the change of the lighting port to the spare router port' : 'the change of the lighting port';
    case 'ropes': return b.dark === true ? 'the change of the ropes to dark' : 'the change of the ropes to the river';   // as planControl: only a real true goes dark
    case 'test': return b.on === true ? 'the test pattern start' : 'the test pattern stop';   // as planControl: only a real true starts it
    case 'overlay': return `the change of Dave's overlay to ${Math.round(Number(b.strength) * 100)} %${b.framing ? '; river framing: ' + b.framing : ''}`;
    case 'hub75': return x != null ? `the change of the panels to ${Math.round(Math.min(1, Math.max(0, x)) * 100)} %` : 'the change of the panels';
    case 'mode': return typeof b.mode === 'string' && b.mode ? `the change of the mode to ${cap(b.mode)}` : 'the change of the mode';
    case 'target': {
      const i = num(typeof b.intensity === 'string' && b.intensity !== '' ? Number(b.intensity) : b.intensity), w = i != null ? intensityWord(Math.min(1, Math.max(0, i))) : null;
      const to = [typeof b.season === 'string' ? b.season : null, w].filter(Boolean).join(', ');
      return to ? `the change of the target to ${to}` : 'the change of the target';
    }
    case 'rules': { const n = Object.keys(obj(b.rules) ?? {}).length; return n ? `the change of ${n} rule${n === 1 ? '' : 's'}` : 'the change of the rules'; }
    case 'rules-reset': return 'the reset of the rules';
    case 'calibrate': return b.action === 'cancel' ? (b.dry_run === true ? 'the dry run stop' : 'the calibration stop') : b.action === 'status' ? 'a look at the calibration'
      : b.dry_run === true ? 'the dry run start' : 'the calibration start';
    case 'check': return 'the full check of bitcube';
    default: return 'a change';
  }
}
/** The usual time of each change, in seconds, until bitcube's reading shows it: the server's own table (lib/applying.mjs EXPECT_S,
 *  kept equal by test/model.test.mjs), so a page can say "usually about 1 min" for its own change before status.applying has it. */
export const EXPECT_S = { overlay: 15, switch: 60, rebuild: 150, bootfile: 15, lightsroute: 20, ropes: 15, hub75: 15, test: 15, mode: 3, target: 3, rules: 3, 'rules-reset': 3, calibrate: 10,
  check: 30 };   // the full check (an SSH round trip): never a lock (lib/applying.mjs records only what APPLY_BLOCKS names), only its usual time
/** What the boot file's confirming line says in place of a usual time: its reading comes with bitcube's next full check. */
export const BOOT_USUAL = "bitcube's full check shows it within a minute";
/** What a calibration start's confirming line says in place of a usual time: the run shows itself in its progress file. */
export const START_USUAL = 'a run usually shows within a minute';
export const SHORT_CHANGE_S = 10;               // a change with no usual time of its own: past this, its line shows m:ss and "usually a few seconds"
export const NEARLY_DONE_S = 45;                // a calibration's last 45 s (or last quarter, for a short scripted run) are "nearly done" on every page
export const CONFIRM_MIN_S = 120;               // a change not shown by bitcube's reading within max(3 × its usual time, this) is "unconfirmed"
export const LONG_CHANGE_S = 20;                // a change usually longer than this shows its elapsed m:ss and the usual time
/** Why the lights can't be changed while a calibration that touches them runs: the server's 409 (lib/mission.mjs calBlocked) and
 *  bitcube's (probe.ps1) in the same words; one sentence per thought (R7 #20). */
export const CAL_RUNNING = 'a calibration is running. Stop it on the Lights page first';
/** The test pattern (Lights → Test pattern): what it blocks says this, on the pages and in the server's 409 (lib/mission.mjs
 *  testBlocked). The ropes button and a calibration would fight it for the ropes, and a calibration would put it back after. */
export const TEST_ON = 'the test pattern is on. Stop it on the Lights page first';
/** Whether the full check's reading (probe.ps1's answer) shows the test pattern on the ropes or the panels: one rule for derive()
 *  and the server's 409. */
export function testShowing(pr) {
  const td = obj(obj(pr)?.td);
  if (!td || td.ok === false) return false;
  return obj(td.ropes)?.source === 'test' || obj(obj(td.ropes)?.status)?.source === 'test' || obj(td.hub75)?.source === 'test';
}
/** How long a change may go unconfirmed (and an entry in status.applying stay a lock): 3 × its usual time, at least 2 min. */
export function confirmLimitS(expectS) { return Math.max(3 * (num(expectS) ?? 0), CONFIRM_MIN_S); }
/** Why a control waits for a change in flight: "wait: <label> is being applied", or, for one bitcube didn't answer in time
 *  (maybe: its lock holds to its confirm limit), "wait: <label> got no answer from bitcube in time; it unlocks by 21:07" (R8 #16,
 *  #17). The server's 409 (lib/applying.mjs waitError) and every page's "Wait: …" line say it. unlockMs: when the lock ends, on
 *  the server's clock. */
export function waitWords(label, { maybe = false, unlockMs = null } = {}) {
  return maybe ? `wait: ${label} got no answer from bitcube in time${num(unlockMs) != null ? `; it unlocks by ${clock(byMinute(unlockMs))}` : ''}`
    : `wait: ${label} is being applied`;
}
/** A deadline said with "by" (a lock's end: "it unlocks by 21:05", "the buttons unlock … by 21:05"), rounded up to the next whole
 *  minute, so the time said is never before the lock really ends (R9 #13, #33). "At" and "started" times keep their minute. */
export const byMinute = (ms) => (num(ms) == null ? ms : Math.ceil(ms / 60000) * 60000);
export const INTENSITY_WORDS = [[0.1, 'stillness'], [0.3, 'trickle'], [0.6, 'flowing'], [0.8, 'strong'], [Infinity, 'torrent']];
export const LEVELS = { down: 0, warning: 1, unknown: 2, ok: 3 };   // what wins the headline (after a stale page), and the items' order
export const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
/** The season a phase of the year falls in (seasons.py: the rounded phase, wrapped to four), or null. */
export function seasonOfPhase(phase) {
  return typeof phase === 'number' && Number.isFinite(phase) ? SEASONS[Math.round(((phase % 4) + 4) % 4) % 4] : null;
}
// Who to call, by the cause behind the headline (ia.md, "What to do"): first names and what they own. The numbers
// live in an untracked file on the mini and never in the repo. A cause mapped to null means "wait and look again".
export const CONTACTS = {
  gavin: { name: 'Gavin', owns: 'bitcube, TouchDesigner, the show file and mission control' },
  lilian: { name: 'Lilian', owns: 'the lights and the rigging' },
  andi: { name: 'Andi', owns: 'the panels' },
  will: { name: 'Will', owns: 'the network, the cameras and the river site' },
  dave: { name: 'Dave', owns: 'his agent' },
  colin: { name: 'Colin', owns: 'how the piece should look' },
};
const CONTACT_BY_CAUSE = {
  page: 'gavin', 'bitcube-unchecked': 'gavin', 'bitcube-offline': 'gavin', 'check-failed': 'gavin', 'probe-stale': 'gavin',
  'td-unknown': 'gavin', 'td-frozen': 'gavin', 'td-off': 'gavin', 'td-slow': 'gavin', 'year-page': 'gavin', 'sender-off': 'gavin', 'sender-taken': 'gavin',
  'link-off': 'gavin', 'link-failing': 'gavin', recorder: 'gavin', disk: 'gavin', 'modal-stale': 'gavin', 'seasons-stale': 'gavin',
  lights: 'lilian', sender: 'lilian', box: 'lilian',
  panels: 'andi', 'panels-off': 'andi', 'panels-dark': 'andi',
  'ropes-dark': 'colin', 'online-file': 'colin', 'old-file': 'gavin',
  'river-stale': 'will', 'no-internet': 'will', router: 'will', 'river-site': 'will', 'gallery-cam': 'will',
  'modal-unreachable': 'dave', 'modal-stalled': 'dave', 'modal-not-ok': 'dave',
  'td-restarting': null, 'coming-up': null, 'not-checked': null, calibrating: null, unknown: null,
};
/** The show-file button the advice names, by what runs now: "Restart on the river's year" when it runs, else "Switch to
 *  the river's year" (status.js labels the band's jump button and the show-file control's buttons the same way). */
export function yearPress(kind) { return kind === 'year' ? "Restart on the river's year" : "Switch to the river's year"; }
export function contactFor(cause) { const k = CONTACT_BY_CAUSE[cause]; return k ? CONTACTS[k] : null; }
// Actions said in more than one place, in the show's words.
const GALLERY_ACTION = "Turn the gallery camera's power off and on again (leave its network cable out: it works on Wi-Fi), then call Will.";
const INTERNET_ACTION = "Check the router's internet connection (the venue's staff Wi-Fi, or the wired connection) from its admin page. The show keeps running meanwhile; clips resume by themselves.";
const DAVE_LATE_ACTION = "Tell Dave his agent has stopped updating. Nothing to do in the gallery.";
// WinError 10048: another program on bitcube (Will's RopeLights app, or a second sender) holds the ropes' connection; no cable fixes it.
// Only Gavin stops Will's rope lights (CLAUDE.md), so the studio chat would have to refuse: it is never offered (R6 #21).
const TAKEN_ACTION = "Call Gavin to stop the other lights program (Will's rope lights) on bitcube; the sender picks up by itself once it has stopped.";
const ROPE_BOX = { 'rope box 1': ['2.0.0.10', '1–10'], 'rope box 2': ['2.0.0.11', '11–20'] };
/** The lighting port probe.ps1 reports (lights_route), as a kind: 'direct' (bitcube's LIGHTS port), 'router' (the spare router
 *  port), 'both' (the lighting address on both: 'BOTH'), 'none' (on neither), 'other' (a value mission control doesn't know), or
 *  null (not reported). Its words: one name for the spare port everywhere (R9 #25), and plain words for both and neither (R9 #35). */
const routeKind = (raw) => { const r = typeof raw === 'string' ? raw.trim() : ''; return !r ? null : r === 'direct' || r === 'router' ? r : /^both$/i.test(r) ? 'both' : /^none$/i.test(r) ? 'none' : 'other'; };
const ROUTE_WORDS = { direct: "bitcube's LIGHTS port", router: 'the spare router port', both: 'both ports', none: 'neither port', other: 'another port' };
/** The Installer's whole readout for both ports or neither: one instruction, the same as the Ropes row's (R10 #27). */
const ROUTE_NOTE = { both: 'the lighting network is set on both ports; press the port the lighting switch is plugged into',
  none: "the lighting network is set on neither port, so the ropes can't be reached; press the port the lighting switch is plugged into" };
const ROUTE_DETAIL = { ...ROUTE_WORDS, both: 'both ports: under Installer, press the port the lighting switch is plugged into',
  none: "neither port, so the ropes can't be reached: under Installer, press the port the lighting switch is plugged into" };
// name, where it is checked from, address for the details drawer
const NAMES = {
  'mission control': ['Mission control (the Mac mini)', 'mini', 'gav-m1-mini.tailddc624.ts.net'],
  bitcube: ['bitcube (the show PC)', 'mini', '100.73.68.60 (Tailscale)'],
  touchdesigner: ['TouchDesigner', 'bitcube', 'on bitcube'],
  seasons: ["The river's year", 'mini', 'bitcube:9981'],
  ropes: ['Ropes (the sender)', 'bitcube', "2.0.0.8 (bitcube's LIGHTS port)"],
  'rope box 1': ['Rope box 1 (ropes 1–10)', 'bitcube', '2.0.0.10'],
  'rope box 2': ['Rope box 2 (ropes 11–20)', 'bitcube', '2.0.0.11'],
  'hub75 panels': ['Panels', 'bitcube', 'HDMI from bitcube, through the panel sender'],
  'gallery camera': ['Gallery camera', 'bitcube', '192.168.9.76'],
  'river camera': ['River camera (the river site)', 'bitcube', '192.168.8.217 (Starlink)'],
  router: ['Router', 'bitcube', '192.168.9.1 (Wi-Fi gray-river)'],
  internet: ['Internet at Gray Area', 'bitcube', null],
  'modal agent': ["Dave's agent", 'modal', 'to-be-a-river--river.modal.run'],
  'modal link': ['Clips to Dave', 'bitcube', 'on bitcube (the Modal link)'],
  recorder: ['River recorder', 'bitcube', 'on bitcube'],
  'people counter': ['People counter', 'bitcube', null],
};
// Importance within one level: the show first, then what feeds it, then the mini itself.
const ORDER = ['bitcube', 'touchdesigner', 'ropes', 'rope box 1', 'rope box 2', 'hub75 panels', 'seasons', 'river camera',
  'gallery camera', 'modal agent', 'modal link', 'internet', 'router', 'recorder', 'people counter', 'mission control'];
const BEHIND = ORDER.filter((id) => NAMES[id][1] === 'bitcube');   // everything the full check reports

// ---- small helpers ------------------------------------------------------------------------------------------
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);   // bitcube is spelt lowercase
/** A duration in words: "40 s", "12 min", "9 h", "3 days". */
export function dur(s) {
  if (s == null) return 'a while';
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}
/** How fast Automatic turns the year, from the year-length rule (cycle_seconds; four seasons a year): "one season a minute",
 *  "one season every 30 s", "one season every 2.5 min"; null when the rule isn't known. */
export function seasonPace(cycleS) {
  const per = typeof cycleS === 'number' && Number.isFinite(cycleS) && cycleS > 0 ? cycleS / 4 : null;
  if (per == null) return null;
  if (Math.abs(per - 60) < 0.5) return 'one season a minute';
  if (per < 90) return `one season every ${Math.round(per)} s`;
  const min = Math.round(per / 30) / 2;
  return `one season every ${Number.isInteger(min) ? min : min.toFixed(1)} min`;
}
export function intensityWord(x) { return x == null ? null : INTENSITY_WORDS.find(([max]) => x < max)[1]; }
/** Wall-clock parts in the installation's zone (falls back to a fixed -7 h if Intl has no zones). */
function pacific(ms) {
  try {
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))) p[type] = +value;
    return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
  } catch {
    const d = new Date(ms - 7 * 3600e3);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
}
const localMs = (ms) => { const p = pacific(ms); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s); };   // the wall clock as if it were UTC
export const clock = (ms) => { const p = pacific(ms); return `${pad(p.h)}:${pad(p.mi)}`; };
/** "17:58", "17:58 yesterday" or "17:58 on 21 Oct", relative to now. */
function clockDay(ms, now) {
  const dayDiff = Math.floor(localMs(now) / 86400e3) - Math.floor(localMs(ms) / 86400e3);   // local calendar days between
  const p = pacific(ms), MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return clock(ms) + (dayDiff === 0 ? '' : dayDiff === 1 ? ' yesterday' : ` on ${p.d} ${MONTHS[p.mo - 1]}`);
}
const inRest = (ms) => { const p = pacific(ms), t = p.h * 60 + p.mi; return t >= MODAL_REST.from || t < MODAL_REST.to; };
/** Daytime (07:00-23:55 Pacific) minutes between two moments: how many ticks Dave's agent owed. */
export function daytimeMinutes(a, b) {
  if (!(b > a)) return 0;
  const la = localMs(a), lb = localMs(b), DAY = 86400e3;
  let sum = 0;
  for (let day = Math.floor(la / DAY) * DAY; day < lb && sum < 1e6; day += DAY) {
    const from = Math.max(la, day + MODAL_REST.to * 60e3), to = Math.min(lb, day + MODAL_REST.from * 60e3);
    if (to > from) sum += (to - from) / 60e3;
  }
  return sum;
}
/** Age in seconds of a log line "HH:MM:SS INFO ..." against the probe's own clock "YYYY-MM-DDTHH:MM:SS" (both bitcube's).
 *  The probe stamps its time when it starts and reads the logs up to a minute later, so a line a little after
 *  that stamp is brand new, not a day old. */
function lineAge(line, probeTime) {
  const l = /^(\d{2}):(\d{2}):(\d{2})/.exec(line || ''), t = /T(\d{2}):(\d{2}):(\d{2})/.exec(probeTime || '');
  if (!l || !t) return null;
  const tod = (x) => +x[1] * 3600 + +x[2] * 60 + +x[3];
  const diff = tod(t) - tod(l);
  return diff < 0 && diff > -600 ? 0 : (diff % 86400 + 86400) % 86400;
}
/** mission.mjs's fetch errors in plain words, as a clause with its subject (a closed port and an unreachable host both read
 *  "fetch failed"): the river's year's page ("its page didn't answer"), or a service on the internet (remote: Dave's agent). */
function fetchWords(e, remote = false) {
  const who = remote ? 'it' : 'its page';
  if (!e) return `${who} gave no answer`;
  if (/timeout|aborted/i.test(e)) return `${who} didn't answer in time`;
  if (/fetch failed/i.test(e)) return remote ? 'the connection failed' : "its page didn't answer";
  return `${who} answered with an error`;   // "HTTP 500" and the like: the raw text stays in sources.*.error (Addresses and links)
}
/** Why bitcube's full check failed (mission.mjs sshProbe), in the team's words: never SSH, the probe or an exit code. */
function probeWords(e) {
  if (!e) return "the check didn't answer";
  if (/took too long|timeout|timed out/i.test(e)) return "bitcube didn't answer the check in time";
  if (/can't reach bitcube|ssh/i.test(e)) return "the check couldn't log in to bitcube";   // port 22 answers: it reached bitcube
  return "bitcube couldn't run the check";
}
/** One source of the snapshot: { at, value | error, age_s } -> freshness and content. */
function source(raw, name, serverNow) {
  const r = obj(raw);
  if (!r) return { present: false, ok: false, value: null, error: null, at: null, age_s: null, failing_s: null, stale: false };
  const at = num(r.at);
  const age_s = serverNow != null && at != null ? Math.max(0, Math.round((serverNow - at) / 1000)) : num(r.age_s);   // the server's clock, never the phone's
  const error = typeof r.error === 'string' && r.error ? r.error : null;
  const value = error ? null : r.value ?? null;
  // a failing source keeps the time of its first failure in a row (mission.mjs failing_since): "failing for 52 min"
  const fs = num(r.failing_since), failing_s = error && fs != null && serverNow != null ? Math.max(0, Math.round((serverNow - fs) / 1000)) : null;
  return { present: true, ok: value != null, value, error: error ?? (value == null ? 'no answer' : null), at, age_s, failing_s,
           stale: age_s != null && age_s > POLL_S[name] * STALE_FACTOR };
}

/** The boot file probe.ps1 reports, in glossary words: "Start-River.cmd default" (an older probe, no boot-file.txt) is the file
 *  Start-River.cmd then opens (shows.json's boot_default); a name mission control doesn't list is "an unlisted show file". */
function bootFile(pr) {
  const raw = typeof pr?.boot_file === 'string' ? pr.boot_file.trim() : null;
  if (!raw) return null;
  if (raw === BOOT_DEFAULT) {
    const name = BOOT_DEFAULT_FILE;
    return name ? { name, kind: FILES[name]?.kind ?? 'other', label: FILES[name]?.label ?? UNLISTED, default: true, reported: raw } : null;
  }
  return { name: raw, kind: FILES[raw]?.kind ?? 'other', label: FILES[raw]?.label ?? UNLISTED, default: pr.boot_file_chosen === false, reported: raw };
}

// ---- the model ----------------------------------------------------------------------------------------------
export function derive(status, nowMs) {
  const st = obj(status) ?? {};
  const serverNow = num(st.now), pageNow = num(nowMs);
  const now = serverNow ?? pageNow ?? Date.now();
  const page_age_s = serverNow != null && pageNow != null ? Math.max(0, Math.round((pageNow - serverNow) / 1000)) : 0;
  // the unrounded age, by the same > 30 s rule as ui.js watchContact, so the verdict flips in the same second as the header
  const pageStale = serverNow != null && pageNow != null && pageNow - serverNow > PAGE_STALE_S * 1000;
  const S = {};
  for (const k of Object.keys(POLL_S)) S[k] = source(st[k], k, serverNow);
  const { bitcube: bc, seasons: se, modal: md, probe: pb } = S;

  // ---- changes being applied (status.applying, from every phone and the studio chat) -------------------------------------
  // Each entry is a lock on the actions in its blocks until its request ends (a switch or a rebuild: until TouchDesigner answers
  // on its file, the server's phase 'confirming'); one older than its limit is a request that never ended and is ignored.
  // Elapsed time is on the server's clock carried forward by this phone's (as page_age_s), so it ticks.
  const applyNow = pageNow ?? now;
  const applying = (Array.isArray(st.applying) ? st.applying : []).map(obj).filter((a) => a && typeof a.action === 'string').map((a) => {
    const raw = num(a.started_at), started = raw == null ? null : raw < 1e12 ? raw * 1000 : raw;   // ms (seconds accepted)
    const rawA = num(a.answered_at), answered = rawA == null ? null : rawA < 1e12 ? rawA * 1000 : rawA;
    const expect_s = num(a.expect_s) ?? 60, elapsed = started != null ? Math.max(0, (applyNow - started) / 1000) : 0;
    const label = typeof a.label === 'string' && a.label.trim() ? a.label.trim() : APPLY_LABEL[a.action] ?? 'a change';
    const blocks = Array.isArray(a.blocks) ? a.blocks.filter((b) => typeof b === 'string') : APPLY_BLOCKS[a.action] ?? [a.action];
    // when its lock ends (its confirm limit, from the answer once there is one), on the server's clock: a maybe's "it unlocks by 21:07"
    const unlock_at = (answered ?? started) != null ? (answered ?? started) + confirmLimitS(expect_s) * 1000 : null;
    return { id: a.id ?? null, request_id: typeof a.request_id === 'string' ? a.request_id : null, action: a.action, label, file: typeof a.file === 'string' ? a.file : null,
             started_at: started, answered_at: answered, unlock_at, expect_s, elapsed_s: Math.round(elapsed), blocks,
             phase: a.phase === 'confirming' ? 'confirming' : 'applying', source: typeof a.source === 'string' ? a.source : null, maybe: a.maybe === true, dry: a.dry === true,
             words: `${cap(label)} is being applied${started != null ? ` (started ${clock(started)})` : ''}`,
             // its limit runs from the answer once there is one (lib/applying.mjs #prune): a slow rebuild keeps its whole limit
             old: (answered ?? started) != null && (applyNow - (answered ?? started)) / 1000 > confirmLimitS(expect_s) };
  }).filter((a) => !a.old).map(({ old: _o, ...a }) => a);
  // The server's verdict on the changes it saw through (status.confirmed) or gave up on (status.expired) in the last 10 min: a
  // page confirms its own switch, restart, rebuild or boot-file change by its entry's id here (entryVerdict), never from a file
  // name: a restart names the same file before and after (R7 #6, #25).
  const ended = (list) => (Array.isArray(list) ? list : []).map(obj).filter((e) => e && typeof e.id === 'string' && typeof e.action === 'string')
    .map((e) => ({ id: e.id, request_id: typeof e.request_id === 'string' ? e.request_id : null, action: e.action, file: typeof e.file === 'string' ? e.file : null,
                   label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : APPLY_LABEL[e.action] ?? 'a change', source: typeof e.source === 'string' ? e.source : null,
                   maybe: e.maybe === true, at: num(e.at), ...(typeof e.error === 'string' && e.error ? { error: e.error } : {}) }));
  // and the ones it saw fail (refused, failed, a quick change bitcube didn't answer: maybe), so a page whose answer was lost learns
  // its change failed, by its request id, at once (R10 #31)
  const confirmedList = ended(st.confirmed), expiredList = ended(st.expired), failedList = ended(st.failed);
  // The verdicts the server's history kept (status.verdicts: the last few changes that waited for one, for hours and across a
  // restart of the server), so a phone that slept past the lists' 10 min still learns the verdict on its own change (R8 #0)
  const verdictList = (Array.isArray(st.verdicts) ? st.verdicts : []).map(obj)
    .filter((v) => v && typeof v.id === 'string' && (v.verdict === 'confirmed' || v.verdict === 'expired'))
    .map((v) => ({ id: v.id, request_id: typeof v.request_id === 'string' ? v.request_id : null, verdict: v.verdict }));
  // A switch or a rebuild (it ends in a switch to the river's year) restarts TouchDesigner: until it answers on the file, the full
  // check sees it not running (the launcher waits 10 s), then not answering while the file loads. That is the restart, never a
  // fault to press Switch for (a second switch kills the half-opened file: another minute dark) (R6 #26).
  // A maybe (no answer in time) may never have run, so it explains nothing: a crash or a freeze meanwhile is said as it is.
  const restartBy = applying.find((a) => !a.maybe && (a.action === 'switch' || a.action === 'rebuild')) ?? null;
  // One bitcube didn't answer in time holds the lock to its limit all the same: while it does, the show-file buttons are locked, so
  // advice for a TouchDesigner seen down never names one of them as if it could be pressed now (R8 #16, below)
  const heldBy = applying.find((a) => a.maybe && a.phase === 'confirming' && (a.action === 'switch' || a.action === 'rebuild')) ?? null;

  // What each source says, defensively: a half-written payload must never throw.
  const online = typeof obj(bc.value)?.online === 'boolean' ? bc.value.online : null;      // null = not checked
  const pr = obj(pb.value), td = obj(pr?.td), dv = obj(pr?.devices), link = obj(pr?.modal_link), rec = obj(pr?.recorder);
  const tdErr = td && td.ok === false ? String(td.error || 'not answering') : null;
  const tdOk = !!td && td.ok !== false && typeof td.file === 'string';
  const byEntry = !!tdErr && !!restartBy && !/restarting/i.test(tdErr);   // not running or not answering, while a switch restarts it
  const frozen = !!tdErr && !byEntry && !/not running|restarting/i.test(tdErr);
  const tdOff = !!tdErr && !byEntry && /not running/i.test(tdErr);
  const tdRestarting = !!tdErr && (byEntry || /restarting/i.test(tdErr));
  // TouchDesigner seen not running or not answering while a switch or rebuild that got no answer holds the lock: perhaps that
  // restart under way, perhaps a fault. The cause stays the fault's (a maybe explains nothing), but its advice says when the
  // restart got no answer and what to do once the buttons unlock, never "press Switch" while the button is greyed (R8 #16)
  const held = heldBy && (tdOff || frozen) ? heldBy : null;
  const heldAt = held ? held.answered_at ?? held.started_at : null;
  // said once, when the buttons unlock ("by", rounded up: R9 #13, #18), and the button for the file it was going to: one held on
  // the live river says to try that again, or the river's year if the live river isn't wanted tonight (R9 #12). The band's line
  // above says it got no answer; this only says what to do (R9 #18)
  const heldPress = !held ? null : (held.file ?? YEAR_FILE) === LIVE_FILE
    ? "Switch to the live river below to try again, or Switch to the river's year if the live river isn't needed tonight" : "Switch to the river's year below";
  const heldBy_ = held?.unlock_at != null ? ` (by ${clock(byMinute(held.unlock_at))})` : '';
  const heldAction = (how) => (!held ? null : how === 'off' ? `If TouchDesigner still isn't running when the buttons unlock${heldBy_}, press ${heldPress} (about a minute).`
    : `If TouchDesigner still isn't answering when the buttons unlock${heldBy_}, look at bitcube's screen over screen sharing and answer the dialog, or press ${heldPress.replace(/ below\b/, '')} (about a minute dark).`);
  const restartingOn = !tdRestarting ? null : byEntry ? FILES[restartBy.file ?? YEAR_FILE]?.label ?? 'a show file' : FILES[/on (\S+)/.exec(tdErr)?.[1]]?.label ?? 'a show file';
  const file = tdOk ? FILES[td.file] ?? { kind: 'other', label: UNLISTED } : null;
  const kind = file?.kind ?? null, label = file?.label ?? null;
  // a show the registry offers that is neither the year nor the live river (a new visualization, the template): not a fault
  const listedShow = kind === 'other' && file?.offered === true;
  // One name for the button the advice points at: the show-file control says "Restart on the river's year" when it already
  // runs, and "Switch to the river's year" when another file (or nothing known) runs. status.js labels its jump the same way.
  const YEAR_PRESS = yearPress(kind);
  const y = obj(se.value);                                                   // the seasons page's /state
  const year = (y && !se.stale ? y : null) ?? obj(td?.seasons) ?? y;        // the year, from whichever report is fresher
  const yearOk = !!year && typeof year.season === 'string';
  const m = obj(md.value);
  const fps = tdOk ? num(td.fps) : null, tdErrors = tdOk ? num(td.errors) ?? 0 : 0;
  const slow = fps != null && fps < TD_SLOW_FPS;
  const uptimeH = num(pr?.uptime_h), upS = uptimeH != null ? uptimeH * 3600 + (pb.age_s ?? 0) : null;
  const booted = uptimeH != null && uptimeH < COMING_UP_H;                  // bitcube itself just restarted
  const tdStarting = tdOk && fps == null;                                    // first check since TouchDesigner (re)started
  const tdOffBooting = tdOff && booted;                                      // not up yet, but bitcube only just started: wait, not a fault
  const comingUp = !!pr && (booted || tdStarting);
  const ro = obj(td?.ropes), rs = obj(ro?.status), senderKnown = !!rs && typeof rs.open === 'boolean';
  const senderErr = senderKnown && !!rs.error ? String(rs.error) : null;
  const senderOpen = senderKnown && rs.open === true && !senderErr;
  const senderOff = senderKnown && rs.active === false;
  const senderTaken = /10048/.test(senderErr || '');   // the ropes' connection held by another program (Will's rope lights)
  // the test pattern (Lights → Test pattern) on the ropes or the panels: on purpose, never a fault, and never "dark"
  const testOn = tdOk && testShowing(pr);
  const ropesDark = tdOk && !testOn && (ro?.source === 'black' || rs?.source === 'black');
  const box = { 'rope box 1': dv ? dv.psac10_1 === true : null, 'rope box 2': dv ? dv.psac10_2 === true : null };
  const boxesDown = Object.keys(box).filter((k) => box[k] === false);
  const displays = Array.isArray(pr?.displays) ? pr.displays : null;
  const led = displays ? displays.some((d) => /^LED/i.test(String(d))) : null;
  const realDisplays = displays ? displays.map((d) => String(d ?? '').replace(/\u0000/g, '').trim()).filter(Boolean) : [];   // the list can hold only a NUL
  const ledMissing = led === false;
  const hub = obj(td?.hub75);
  const internetDown = dv?.internet === false, routerDown = dv?.router === false;
  const galleryDown = dv?.gallery_cam === false, riverDown = dv?.river_cam === false;
  const relay = obj(td?.river_cam);                                          // only the live river file has one
  const relayAge = relay ? num(relay.last_frame_age_s) : null;
  const riverStale = !!relay && relay.running !== false && relay.fresh !== true && !riverDown;
  const relayAgeNow = relayAge != null ? relayAge + (pb.age_s ?? 0) : null;
  const counter = yearOk ? obj(year.presence)?.available === true : null;
  const diskGb = num(pr?.disk_free_gb), diskLow = diskGb != null && diskGb < DISK_LOW_GB;
  // A calibration run (lib/lights.mjs: the probe carries the job's progress file): the ropes are in patterns on purpose.
  // Time left: the stage's expected_s scaled to the whole run by the stages' typical lengths, minus what has elapsed.
  // The copy's own age: mission control serves the newest copy there is (Lights' reads every 5 s, inside an older full check), so
  // it is aged by its own read time (read_age_s, or read_at on the served clock), else as old as the full check that carried it;
  // then by the seconds since this answer, so it counts down between answers as the Lights card does (R6 #33).
  const cal = obj(pr?.calibration), calibrating = !!cal && cal.running === true && cal.stale !== true;
  const calTotalS = calibrating && num(cal.expected_s) != null && CAL_STAGE_S[cal.stage] ? CAL_TOTAL_S / CAL_STAGE_S[cal.stage] * cal.expected_s : CAL_TOTAL_S;
  const calReadAge = !calibrating ? null : num(cal.read_age_s) ?? (num(cal.read_at) != null && serverNow != null ? Math.max(0, (serverNow - cal.read_at) / 1000) : null) ?? pb.age_s ?? 0;
  const sinceAnswerS = serverNow != null && pageNow != null ? Math.max(0, (pageNow - serverNow) / 1000) : 0;
  const calLeftS = calibrating ? Math.max(0, Math.round(calTotalS - (num(cal.elapsed_s) ?? 0) - calReadAge - sinceAnswerS)) : null;
  const calNearly = calibrating && calLeftS < Math.min(NEARLY_DONE_S, calTotalS / 4);
  const calLeftWords = calibrating ? (calNearly ? 'nearly done' : `about ${dur(calLeftS)} more`) : null;
  // a dry run (or a decode of earlier photos) touches no lights; a full run has the ropes in patterns from start to end, and
  // the panels in their own stages: then they are "in calibration patterns", never "showing the river" or "dark on purpose"
  const calQuiet = calibrating && calNoLights(cal), calDry = calibrating && calDryRun(cal);
  const calRopes = calibrating && !calQuiet, calPanels = calRopes && /^hub75-/.test(String(cal.stage ?? ''));
  const calWords = calRopes ? (calNearly ? 'in calibration patterns, nearly done' : `in calibration patterns for ${calLeftWords}`) : null;
  // a dry run touches no lights and no camera: its stage is a step, never "photographing the ropes" (R9 #19); a decode of earlier
  // photos is real work, so its stage is said as a run's is (one rule, model.js calDryRun, calStep: CR9 #8, #16)
  const calStageWords = !calibrating ? null : calDry ? calStep(cal.stage)?.words ?? null : CAL_STAGE_WORDS[cal.stage] ?? 'at work';

  // Dave's agent: a past next tick is a fault only by day (it rests overnight), measured in daytime minutes.
  const finMs = m ? Date.parse(m.finished_at) : NaN, nextMs = m && num(m.next_tick_epoch) != null ? m.next_tick_epoch * 1000 : null;
  const lateMin = nextMs != null ? daytimeMinutes(nextMs, now) : 0;
  const modalOverdue = !!m && lateMin > MODAL_LATE_MIN;
  const modalUnreachable = md.present && !m;
  const sinceTickS = Number.isFinite(finMs) ? (now - finMs) / 1000 : null;

  // The Modal link's clips, per camera: the last good clip is the last INFO line; failures only touch the file. A fresh check
  // judges them now (their ages grow with the check's own age); a stale one as of its own time, so the last answer's verdict
  // is kept and only greyed, never turned into "posting" by an age nobody saw.
  const probeAge = pb.age_s ?? 0, probeFresh = !pb.stale;
  const at = (ageS) => (ageS == null ? 'an unknown time' : clockDay(now - ageS * 1000, now));   // a moment, never an age that freezes
  const clips = {};
  for (const cam of ['gallery', 'river']) {
    const l = obj(link?.[cam]);
    if (!l) { clips[cam] = { present: false }; continue; }
    // a line is never newer than its file: the time of day alone wraps at 24 h, so a log not written since yesterday's
    // same minute would read as seconds old; the file's own age (log_age_s) is the floor
    const lineA = l.last == null ? null : lineAge(l.last, pr?.time), fileA = num(l.log_age_s);
    const age = lineA == null ? null : Math.max(lineA, fileA ?? 0);
    const ageNow = age != null ? age + probeAge : null;
    const judged = probeFresh ? ageNow : age, fileJudged = (fileA ?? 0) + (probeFresh ? probeAge : 0);
    const sinceClock = l.last ? String(l.last).slice(0, 5) : null;
    const quiet = fileJudged > CLIP_LATE_S;   // nothing written at all: not posting
    clips[cam] = { present: true, age_s: ageNow, since: sinceClock, failing: l.last == null || judged == null || judged > CLIP_LATE_S || quiet,
                   quiet, last: l.last ?? null };
  }
  const linkProcs = link ? num(link.processes) ?? 0 : null;
  const linkDown = linkProcs === 0;
  const failing = ['gallery', 'river'].filter((c) => clips[c].present && clips[c].failing && !linkDown);
  const syncLine = obj(link?.sync), syncAge = syncLine?.last ? lineAge(syncLine.last, pr?.time) : null;
  const syncAgeNow = syncAge != null ? syncAge + probeAge : null;
  const syncOld = (probeFresh ? syncAgeNow : syncAge) != null && (probeFresh ? syncAgeNow : syncAge) > MODAL_LATE_MIN * 60;
  const recLast = rec && rec.last != null ? String(rec.last) : null;
  const recErr = !!recLast && !/\bdone\b/i.test(recLast) && /no video|connection|timed out|error|failed/i.test(recLast);

  // Why the things behind bitcube cannot be judged (null when the full check answered).
  const behind = online === false ? ['Behind bitcube, which is offline', "It is checked from bitcube, so nothing is known while bitcube is offline."]
    : !pb.present ? ['Not checked yet', "bitcube's full check runs about once a minute; the first one is still to come."]
    : !pr ? ['Not known: the full check of bitcube failed', `The last full check failed: ${probeWords(pb.error)}.`]
    : null;

  // ---- items ------------------------------------------------------------------------------------------------
  const items = [];
  const it = (id, level, summary, detail, extra = {}) => {
    const [name, from, address] = NAMES[id];
    const srcKey = extra.source ?? (from === 'mini' ? null : 'probe');
    const src = srcKey ? S[srcKey] : null;
    const stale = pageStale || (src ? src.stale && !(srcKey === 'probe' && online === false) : false);
    items.push({ id, name, level, summary, detail, action: extra.action ?? null, checked_from: from,
                 age_s: extra.age_s ?? src?.age_s ?? null, stale, address: extra.address ?? address, cause: null, muted: !!extra.muted,
                 raw: extra.raw ?? null,   // raw text for "Addresses and links (for Will)", never the main view
                 ...(extra.waits ? { waits: extra.waits } : {}) });   // its advice says when a held change unlocks: no Wait line beside it (R10 #16)
  };
  const unknown = (id, [summary, detail], extra) => it(id, 'unknown', summary, detail, extra);

  it('mission control', pageStale ? 'unknown' : 'ok', pageStale ? `No answer for ${dur(page_age_s)}` : 'Serving this page',
    pageStale ? `This page last heard from mission control ${dur(page_age_s)} ago. Your connection, or the Mac mini, may be down.`
              : 'It checks bitcube every 5 s and runs a full check about once a minute.', { age_s: page_age_s });

  const upWords = uptimeH == null ? 'a while' : dur(uptimeH * 3600);   // dur()'s form, like every other duration
  if (online === false) it('bitcube', 'down', 'Offline: not reachable',   // the row's source line says from where (R10 #33)
    `The Mac mini could not connect to bitcube${pb.error ? `; its full check has been failing for ${dur(pb.failing_s ?? pb.age_s)}` : ''}. The show may still be running by itself.`,
    { source: 'bitcube', action: "Someone at Gray Area checks bitcube's power light and the router; a restart takes about a minute and it comes back by itself." });
  else if (online === true && pr) it('bitcube', 'ok', `Online; up ${upWords}${diskLow ? `, only ${diskGb} GB of disk free` : ''}`,   // the disk only when it is the reason
    `${comingUp ? 'Restarted recently and still coming up. ' : ''}Its full check answered${diskGb != null ? `; ${diskGb} GB of disk free` : ''}.`,
    { source: 'bitcube', raw: Array.isArray(pr.addresses) && pr.addresses.length ? `addresses: ${pr.addresses.map((a) => `${a?.nic} ${a?.ip}`).join(', ')}` : null });
  else if (online === true && pb.present) it('bitcube', 'warning', 'Reachable, but its full check failed',
    `bitcube accepts connections, but the full check from the Mac mini failed: ${probeWords(pb.error)}.`, { source: 'bitcube', raw: pb.error, action: 'Wait a minute; the check runs again by itself. If it keeps failing, ask the studio chat to look at bitcube.' });
  else if (online === true) it('bitcube', 'ok', 'Reachable; full check still to come', 'bitcube answers the Mac mini; its first full check takes up to a minute.', { source: 'bitcube' });
  else unknown('bitcube', ['Not checked yet', 'Mission control has not checked bitcube yet.'], { source: 'bitcube' });

  if (behind) unknown('touchdesigner', behind);
  else if (!td) unknown('touchdesigner', ['Not reported by the full check', 'The full check answered without a word about TouchDesigner.']);
  else if (tdOffBooting) it('touchdesigner', 'warning', 'Not started yet: bitcube just restarted', `bitcube has been up for ${dur(upS)}; TouchDesigner opens by itself about a minute after it.`, { action: 'Wait a minute and look again.' });
  else if (tdOff) it('touchdesigner', 'down', 'Not running on bitcube', 'bitcube is up but TouchDesigner is not running, so nothing is driving the lights.',
    { action: heldAction('off') ?? "Start it with Switch to the river's year below (about a minute).", ...(held ? { waits: held.id } : {}) });
  else if (tdRestarting) it('touchdesigner', 'warning', `Restarting on ${restartingOn}`, 'The lights are dark for about a minute while it opens.', { action: 'Wait a minute and look again.', raw: tdErr });
  else if (frozen) it('touchdesigner', 'down', 'Frozen: not answering', 'TouchDesigner did not answer within 15 s, which usually means a dialog is blocking it. The lights are not being driven: the rope boxes play their own colour cycle and the panels keep their last picture.',
    { action: heldAction('frozen') ?? `Look at bitcube's screen over screen sharing and answer the dialog, or press ${YEAR_PRESS} (about a minute dark).`, ...(held ? { waits: held.id } : {}) });
  else if (fps == null) it('touchdesigner', 'ok', `Running ${label}; frame rate not known yet`, 'The first check after a start cannot measure the frame rate; the next one can.', { raw: `file: ${td.file}` });
  else if (slow) it('touchdesigner', 'warning', `Running slowly: ${Math.round(fps)} of 60 frames a second`,
    `${cap(label)} at ${fps} frames a second, where it should run at 60${tdErrors ? `, with ${tdErrors} errors in the file` : ''}: the river moves in jerks.`,
    { action: `Look at bitcube's screen for what is slow or erroring; if it does not recover in a few minutes, press ${YEAR_PRESS} (about a minute dark).` });
  else it('touchdesigner', 'ok', `Running ${label} at ${Math.round(fps)} frames a second`, `${cap(label)}: ${fps} frames a second, ${tdErrors ? `${tdErrors} errors in the file` : 'no errors'}.`, { raw: `file: ${td.file}` });

  const intensity = yearOk ? num(year.intensity) : null;
  // Automatic's pace from the year-length rule (the seasons page's rules; the full check's copy of the year has none)
  const pace = seasonPace(num(obj(obj(year?.rules)?.cycle_seconds)?.value) ?? num(obj(obj(y?.rules)?.cycle_seconds)?.value));
  const modeWords = !yearOk ? '' : year.mode === 'manual' ? `set by hand, heading for ${year.target ?? obj(year.manual)?.season ?? 'a season'}`
    : year.mode === 'dynamic' ? (year.effective_mode === 'dynamic' ? 'people are steering it' : 'dynamic, but running automatic while the people counter is unavailable')
    : ['the clock turns the year', pace].filter(Boolean).join(', ');
  if (y && yearOk) it('seasons', 'ok', `${cap(y.mode)}, ${y.season}, ${intensityWord(intensity)}`,
    `${cap(modeWords)}. ${Array.isArray(y.history) && y.history.length === 0 ? 'The year has just started. ' : ''}${counter ? '' : 'There is no people counter yet; that is normal.'}`,
    { source: 'seasons' });
  else if (online === false) unknown('seasons', ['Behind bitcube, which is offline', 'Its page could not be fetched because bitcube is offline, not because the year is not running.'], { source: 'seasons' });
  else if (!se.present) unknown('seasons', ['Not checked yet', 'Mission control has not asked its page yet.'], { source: 'seasons' });
  else if (tdOffBooting || tdRestarting) it('seasons', 'warning', `Not served while TouchDesigner ${tdRestarting ? 'restarts' : 'starts'}`, 'Its page comes up with TouchDesigner, in about a minute.', { source: 'seasons' });
  else if (frozen || tdOff) it('seasons', 'down', frozen ? 'Page not answering: TouchDesigner is frozen' : 'Page not served: TouchDesigner is not running',
    `The river's year page is served by TouchDesigner, so it ${frozen ? 'froze' : 'went'} with it.`, { source: 'seasons' });
  else if (kind === 'live') it('seasons', 'warning', 'Not running: TouchDesigner is showing the live river',
    "The live river has no year of seasons and no year page, so the year's controls are unavailable until the river's year runs.",
    { source: 'seasons', action: "Press Switch to the river's year if the year is wanted (the lights go dark for about a minute)." });
  else if (kind === 'year') it('seasons', 'warning', 'Page not answering', `TouchDesigner runs the river's year, but ${fetchWords(se.error)}.`,
    { source: 'seasons', action: `Wait a minute; if it stays down, press ${YEAR_PRESS}.` });
  // a show from the registry (a new visualization, the template): chosen on purpose; it simply has no year
  else if (listedShow) it('seasons', 'ok', `Not used: ${label} has no year`, "This show has no year of seasons and no year page; the river's year controls come back when it runs.",
    { source: 'seasons' });
  else if (kind === 'other') it('seasons', 'warning', `Not running: TouchDesigner is showing ${label}`, 'That show file serves no year page.',
    { source: 'seasons', action: "Press Switch to the river's year (the lights go dark for about a minute)." });
  else it('seasons', 'warning', 'Page not answering', `${cap(fetchWords(se.error))}; waiting for the full check of bitcube to say why.`, { source: 'seasons' });

  const watts = Array.isArray(rs?.watts) ? rs.watts.map(num) : null, capW = num(ro?.box_watts_cap);
  const wattsWords = watts ? `${watts.join(' + ')} W${capW ? ` of ${capW} W per box` : ''}` : 'sender open';
  const showing = kind === 'live' ? (relay?.fresh ? 'Showing the live river' : 'Showing the rain fallback: no live frames') : 'Showing the river';
  const boxWords = (k) => `rope box ${k.slice(-1)} (ropes ${ROPE_BOX[k][1]})`;
  if (behind) unknown('ropes', behind);
  else if (!td) unknown('ropes', ['Not reported by the full check', 'The full check answered without a word about TouchDesigner, which drives the ropes.']);
  else if (tdRestarting || tdOffBooting) it('ropes', 'warning', `Dark while TouchDesigner ${tdRestarting ? 'restarts' : 'starts'}`, 'The sender comes back with TouchDesigner, in about a minute.');
  else if (!tdOk) it('ropes', 'down', `Not being driven: TouchDesigner is ${tdOff ? 'not running' : 'frozen'}`,
    `With nothing sending, the boxes ${boxesDown.length === 2 ? 'are silent too' : 'play their own colour cycle'}.`);
  else if (!senderKnown) it('ropes', 'warning', 'Sender state not reported', rs?.error ? `The sender's status could not be read: ${rs.error}` : 'This show file has no rope sender.');
  else if (senderErr || !rs.open) {
    const why = /10049/.test(senderErr || '') ? "bitcube's LIGHTS port has no link (nothing is plugged into it)" : senderTaken ? "another lights program on bitcube (Will's rope lights, or a second sender) is using the ropes' connection; the two must never run at once" : 'it cannot open its connection on the lighting network';
    const both = boxesDown.length === 2;
    it('ropes', both ? 'down' : 'warning', both ? `Not reaching the lights: sender ${rs.retrying ? 'retrying' : 'closed'}, both boxes silent` : senderTaken ? "Another program on bitcube is using the ropes' connection" : `Sender can't open its port${boxesDown.length ? `; ${boxWords(boxesDown[0])} silent` : ''}`,
      `The sender is ${rs.retrying ? 'retrying' : 'stopped'}: ${why}.${both ? ' Expected before the lights are connected; it picks up by itself once they are.' : ''}`,
      { action: both ? "In the ceiling: plug the lighting switch into bitcube's LIGHTS port; the sender picks up by itself." : senderTaken ? TAKEN_ACTION : "Check the lighting switch and the cable into bitcube's LIGHTS port.", raw: senderErr });
  } else if (senderOff) it('ropes', 'warning', 'Sender switched off', 'The sender is not active, so the ropes get nothing.', { action: 'Press Ropes → On to turn it back on.' });
  else if (calRopes && boxesDown.length < 2) it('ropes', 'warning', cap(calWords), `The calibration is ${calStageWords}; the ropes go back to what they showed before, by themselves, when it ends.`,
    { action: 'If the room is needed now, stop it on the Lights page: the ropes go back at once.' });
  else if (ropesDark) it('ropes', 'warning', 'Dark on purpose: sending black', 'The sender is open and sending black; both boxes stay dark instead of playing their own colour cycle. Not a fault.',
    { action: 'Press Ropes → On to show the river again; they follow within a few seconds.', raw: watts ? wattsWords : null });
  else if (boxesDown.length === 2) it('ropes', 'down', 'Both rope boxes are silent: the ropes are dark', 'The sender is open but neither box answers over the lighting network.', { action: 'Check power to the rope boxes and the lighting switch.' });
  else if (boxesDown.length === 1) it('ropes', 'warning', `${cap(boxWords(boxesDown[0]))} silent: those ropes may be dark`, `The sender is open (${wattsWords}) but ${boxWords(boxesDown[0])} does not answer.`, { action: 'Check power to that box and its cable to the lighting switch.' });
  else if (testOn && (ro?.source === 'test' || rs?.source === 'test')) it('ropes', 'warning', 'Test pattern: colours wipe down every rope',
    `Someone started the test pattern on the Lights page: red, green, blue, then white run down each rope from the plug end, so every LED shows every colour. Not a fault${watts ? `; ${wattsWords}` : ''}.`,
    { action: 'Stop the test pattern on the Lights page; the river comes back at once.' })
  else if (slow) it('ropes', 'warning', `Driven at only ${Math.round(fps)} frames a second`, `TouchDesigner is slow, so the river moves in jerks on the ropes. Sender open, ${wattsWords}.`);
  else it('ropes', 'ok', showing, `Sender open, ${wattsWords}${routeKind(pr.lights_route) ? `; lighting network on ${ROUTE_DETAIL[routeKind(pr.lights_route)]}` : ''}.`);

  for (const k of Object.keys(ROPE_BOX)) {
    const [addr] = ROPE_BOX[k];
    if (behind) unknown(k, behind);
    else if (box[k] == null) unknown(k, ['Not reported by the full check', 'No answer from the full check about this box.']);
    else if (box[k]) it(k, 'ok', 'Answers', `Answers from bitcube over the lighting network${!tdOk ? `, but nothing is driving it: TouchDesigner is ${tdOff ? 'not running' : tdRestarting || tdOffBooting ? 'starting' : 'frozen'}` : ''}.`);
    else it(k, 'down', 'Not answering', "No answer over the lighting network: no power, or the lighting switch is not connected to bitcube's LIGHTS port.");
  }

  const brightness = hub ? num(hub.brightness) : null;
  if (behind) unknown('hub75 panels', behind);
  else if (led == null) unknown('hub75 panels', ['Not reported by the full check', 'The full check did not list bitcube\'s displays.']);
  else if (ledMissing) it('hub75 panels', 'down', 'No panel sender: bitcube does not see one', `bitcube sees ${realDisplays.length === 1 ? 'only its own small screen' : realDisplays.length ? `only ${realDisplays.length} other screens` : 'no display at all'}, no panel sender. The panels get their picture over HDMI through the panel sender; until bitcube sees it they stay dark.${boxesDown.length === 2 ? ' Expected before the lights are connected.' : ''}`,
    { action: "Plug the panel sender into bitcube's HDMI; bitcube then sees it.", raw: realDisplays.length ? `displays: ${realDisplays.join(', ')}` : null });   // never an empty "displays:" line
  else if (!td) unknown('hub75 panels', ['Panel sender present; picture not reported', 'The full check answered without a word about TouchDesigner, which draws the picture.']);
  else if (tdRestarting || tdOffBooting) it('hub75 panels', 'warning', `Panel sender present; dark while TouchDesigner ${tdRestarting ? 'restarts' : 'starts'}`, 'The picture comes back with TouchDesigner.');
  else if (!tdOk) it('hub75 panels', 'warning', `Panel sender present, but the picture is ${frozen ? 'frozen' : 'gone'}`, frozen ? 'TouchDesigner is frozen, so the panels keep their last picture.' : 'TouchDesigner is not running, so nothing is drawn.');
  else if (!hub) it('hub75 panels', 'warning', 'Panel sender present; this file has no panel output', 'TouchDesigner reports no panels in this show file.');
  else if (calPanels) it('hub75 panels', 'warning', cap(calWords), `The calibration is ${calStageWords}; the panels go back to what they showed before, by themselves, when it ends.`,
    { action: 'If the room is needed now, stop it on the Lights page: the lights come back at once.' });
  else if (hub.source === 'test') it('hub75 panels', 'warning', "Test pattern: four coloured panels, the screen's number in white squares",
    "Someone started the test pattern on the Lights page: each screen shows red, green, blue and yellow panels, with as many white squares in its red panel as its number. Not a fault.",
    { action: 'Stop the test pattern on the Lights page; the river comes back at once.' });
  else if (hub.output === false) it('hub75 panels', 'warning', 'Panel sender present, but the panel output is off', 'The panels are switched off in the show file.');
  else if (brightness === 0) it('hub75 panels', 'warning', "At 0 %, so they're dark", 'Someone turned the panels down to nothing.', { action: 'Raise the panels brightness below.' });
  else it('hub75 panels', 'ok', `Panel sender present, brightness ${brightness != null ? `${Math.round(brightness * 100)} %` : 'not known'}`, `${ropesDark ? 'Still showing the river while the ropes are dark. ' : ''}bitcube sees the panel sender.`, { raw: realDisplays.length ? `displays: ${realDisplays.join(', ')}` : null });

  const noClip = (c) => (c.since ? `no clips to Dave since ${c.since}` : 'no clips to Dave lately');
  const clipWords = (cam) => { const c = clips[cam]; return !c.present ? '' : c.failing ? `; ${noClip(c)}` : probeFresh ? `; clips posting (last at ${at(c.age_s)})` : `; last clip at ${at(c.age_s)}`; };
  if (behind) unknown('gallery camera', behind);
  else if (!dv) unknown('gallery camera', ['Not reported by the full check', '']);
  else if (galleryDown) it('gallery camera', 'down', 'Not answering', `No answer from the camera${clipWords('gallery')}; no picture can be fetched.`,
    { action: GALLERY_ACTION });
  else it('gallery camera', 'ok', `Reachable${clips.gallery.present && !clips.gallery.failing && probeFresh ? '; clips posting' : ''}`, `Answers${clipWords('gallery')}.`);

  if (behind) unknown('river camera', behind);
  else if (!dv) unknown('river camera', ['Not reported by the full check', '']);
  else if (riverDown && internetDown) it('river camera', 'down', 'Unreachable: no internet at Gray Area', 'The river camera is reached over the internet (Starlink at the river); without internet bitcube cannot see it.');
  else if (riverDown) it('river camera', 'down', 'Not answering: the river site is down', `The river site runs on solar power and Starlink and goes down when the battery is flat. ${kind === 'live' ? 'The show is running on the rain fallback' : "The river's year does not use it"}${clipWords('river')}.`,
    { action: 'The river site needs sun; nothing to do from here.' });
  else if (relay && relay.running === false) it('river camera', 'warning', "Reachable, but TouchDesigner isn't reading it", "The camera answers, but TouchDesigner's reader for it has stopped.");
  else if (relay && relay.fresh) it('river camera', 'ok', `Live: fresh frames${relay.night ? ' (infrared, night)' : ''}`, `Last frame at ${at(relayAgeNow)}${clipWords('river')}.`, { raw: num(relay.frames) ? `${relay.frames} frames so far` : null });
  else if (relay) it('river camera', 'warning', `Answers, but no frames for ${dur(relayAgeNow)}`, `The camera accepts connections but has sent nothing for ${dur(relayAgeNow)}; the panels and ropes show the rain fallback meanwhile${clipWords('river')}.`,
    { action: "Ask Will to restart the river camera, or wait for the Starlink link to settle. If the live river isn't needed tonight, switch to the river's year, which doesn't use it." });
  else it('river camera', 'ok', `Reachable${clips.river.present && !clips.river.failing && probeFresh ? '; clips posting' : ''}`, `Answers over Starlink${clipWords('river')}. The river's year does not use it; the recorder and clips to Dave do.`);

  if (behind) unknown('router', behind);
  else if (!dv) unknown('router', ['Not reported by the full check', '']);
  else if (routerDown) it('router', 'down', 'Not answering', 'bitcube cannot reach the router; the gallery camera and the internet go through it.', { action: 'Check the router\'s power; it comes back by itself in about two minutes.' });
  else it('router', 'ok', 'Answers', 'bitcube reaches the router, on the gray-river Wi-Fi.');

  if (behind) unknown('internet', behind);
  else if (!dv) unknown('internet', ['Not reported by the full check', '']);
  // the row's source line says "from bitcube": the summary doesn't say it again (R10 #33)
  else if (internetDown) it('internet', 'down', 'No internet', routerDown ? 'The router is not answering either.' : "The router answers, so its internet connection has gone (the venue's staff Wi-Fi, or the wired connection). Mission control still reaches bitcube.",
    { action: INTERNET_ACTION });
  else it('internet', 'ok', 'bitcube reaches the internet', 'A connection out of Gray Area works.');

  if (!md.present) unknown('modal agent', ['Not checked yet', "Mission control has not asked Dave's agent yet."], { source: 'modal' });
  else if (!m) it('modal agent', 'warning', 'Unreachable from the Mac mini', `The Mac mini asked Dave's agent and ${fetchWords(md.error, true)}.`, { source: 'modal', action: "Tell Dave if it stays unreachable; the room is unaffected while the river's year runs." });
  else if (m.ok === false) it('modal agent', 'warning', 'Reports a problem', "Dave's agent says something is wrong on its side.", { source: 'modal', action: 'Tell Dave.', raw: `mood ${m.mood}, tick ${m.tick}` });
  else if (modalOverdue) it('modal agent', 'warning', `Hasn't updated for ${dur(sinceTickS)}`,
    `It last updated at ${Number.isFinite(finMs) ? clockDay(finMs, now) : 'an unknown time'}. It updates every 5 minutes by day and rests overnight; it has missed ${dur(lateMin * 60)} of daytime updates, though it doesn't report a problem itself.`,
    { source: 'modal', action: DAVE_LATE_ACTION });
  else if (nextMs != null && nextMs < now) it('modal agent', 'ok', `${inRest(now) ? 'Resting overnight' : 'Update due'}; last update ${Number.isFinite(finMs) ? clockDay(finMs, now) : 'not known'}`,
    inRest(now) ? 'It rests from 23:55 to 07:00 Pacific, so a missed update is normal at this hour.' : 'An update is due; it gets 15 minutes of daytime before that counts as a fault.', { source: 'modal' });
  else it('modal agent', 'ok', 'Updating on schedule', `${Number.isFinite(finMs) ? `Last updated at ${clockDay(finMs, now)}` : 'Last update time not known'}${nextMs != null ? `; next update due at ${clockDay(nextMs, now)}` : ''}${obj(m.scene) ? `; its scene is ${m.scene.animation} / ${m.scene.palette}` : ''}.`, { source: 'modal', raw: `tick ${m.tick}, mood ${m.mood ?? 'none'}` });

  const sinceWords = (c) => (c.since ? `since ${c.since}` : 'for a while');
  if (behind) unknown('modal link', behind);
  else if (!link) unknown('modal link', ['Not reported by the full check', '']);
  else if (linkDown) it('modal link', 'warning', comingUp ? 'Not started yet: bitcube just restarted' : 'Not running on bitcube',
    `Nothing on bitcube is sending clips to Dave; it last posted at ${at(Math.max(...['gallery', 'river', 'sync'].map((c) => num(obj(link[c])?.log_age_s) ?? 0)) + probeAge)}.`,
    { action: comingUp ? 'Wait two minutes; if it is still not running after five, ask the studio chat to start it.' : 'Ask the studio chat to start it on bitcube.' });
  else if (failing.length === 2) it('modal link', 'down', `Clips failing for both cameras ${sinceWords(clips.gallery)}`, `Gallery ${sinceWords(clips.gallery)}, river ${sinceWords(clips.river)}${syncOld ? `; nothing new has come back from Dave's agent for ${dur(syncAgeNow)}` : ''}. ${internetDown ? 'Without internet nothing can be posted.' : 'Both cameras answer, so the link itself or the upload is failing.'}`);
  else if (failing.length === 1) it('modal link', 'warning', `${cap(failing[0])} clips failing ${sinceWords(clips[failing[0]])}; ${failing[0] === 'gallery' ? 'river' : 'gallery'} fine`,
    `${cap(failing[0])} clips: ${clips[failing[0]].last ? `last good one at ${clips[failing[0]].since}` : 'no good clip lately'}; the other camera posts normally.`, { raw: `${linkProcs} processes` });
  else if (modalOverdue && syncOld) it('modal link', 'warning', `Nothing new from Dave's agent for ${dur(syncAgeNow)}`, "Clips are posting fine; nothing comes back until Dave's agent changes something, and it has not.");
  else it('modal link', 'ok', probeFresh ? 'Posting' : 'Clips fine at the last check', `Gallery clip at ${at(clips.gallery.age_s)}, river clip at ${at(clips.river.age_s)}${syncAgeNow != null ? `; Dave's agent last sent something back at ${at(syncAgeNow)}` : ''}.`, { raw: `${linkProcs} processes` });

  const recClips = num(rec?.clips) ?? 0, recAt = /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/.exec(recLast || '')?.[1];
  if (behind) unknown('recorder', behind);
  else if (!rec) unknown('recorder', ['Not reported by the full check', '']);
  else if (recLast == null) it('recorder', 'ok', `${recClips} clips; no log yet`, 'The hourly recorder has not written a log line.');
  else if (recErr) it('recorder', 'warning', riverDown || internetDown ? "Current run can't reach the river camera" : "Current run can't get video", `${recClips} clips so far; this hour's recording got no video from the river camera.`, { action: riverDown || internetDown ? null : 'It retries every hour; check the river camera.', raw: recLast });
  else if (/\bdone\b/i.test(recLast)) it('recorder', 'ok', `${recClips} clips; last run finished${recAt ? ` at ${recAt}` : ''}`, 'It records the river for an hour at a time.', { raw: recLast });
  else it('recorder', 'ok', `${recClips} clips; recording`, 'It records the river for an hour at a time.', { raw: recLast });

  const presence = yearOk ? obj(year.presence) : null;
  if (presence?.available) it('people counter', 'ok', `${presence.now} people now; usual ${presence.usual}`, `Relative presence ${presence.relative}× usual; empty for ${dur(presence.empty_for_s)}.`, { source: y ? 'seasons' : 'probe' });
  else if (yearOk) it('people counter', 'ok', 'Not available yet (normal)', 'There is no people counter yet, so presence is unavailable and dynamic mode cannot be chosen. The year runs without it.', { source: y ? 'seasons' : 'probe', muted: true });
  else if (behind) unknown('people counter', behind, { muted: true });
  else it('people counter', 'ok', 'Not available yet (normal)', 'There is no people counter yet; that is normal. The river\'s year runs without it.', { source: 'probe', muted: true });   // planned: never "not known"

  // ---- problems: one per cause, each explaining several items --------------------------------------------------
  const P = [];
  let fromProbe = false;   // set while adding the problems read from the full check (they are as old as it is)
  const add = (id, level, pri, headline, detail, action, ids) => P.push({ id, level, pri, headline, detail, action: action ?? null, items: ids.filter(Boolean), fromProbe });
  const tdWords = tdOk ? `TouchDesigner runs ${label}${fps != null ? ` at ${Math.round(fps)} frames a second` : ''}` : '';
  if (pageStale) add('page', 'unknown', 100, `This page can't reach mission control (no answer for ${dur(page_age_s)})`, 'What is shown is the last answer, not now.',
    'Check your connection. If other sites load, the Mac mini may be down or off its network.', ['mission control']);
  if (bc.present && bc.stale) add('bitcube-unchecked', 'unknown', 95, `Mission control hasn't checked bitcube for ${dur(bc.age_s)}`, 'Its own polling has stalled; what is shown is the last answer.',
    'Wait a minute. If it stays this way, mission control needs a restart (ask the studio chat).', ['bitcube']);
  const unseen = [...BEHIND, y ? null : 'seasons', m ? null : 'modal agent'];     // what the headline leaves unknown
  if (online === false) add('bitcube-offline', 'down', 90, 'bitcube is offline: nothing behind it can be checked',
    `The Mac mini can't reach bitcube${pb.error ? `; its full check has failed for ${dur(pb.failing_s ?? pb.age_s)}` : ''}. The show may still be running by itself.`,
    "Someone at Gray Area checks bitcube's power light and the router; a restart takes about a minute and bitcube comes back by itself. Nothing can be done from here, and every control would fail.", ['bitcube', ...unseen]);
  else if (online === true && pb.present && !pr) add('check-failed', 'warning', 85, 'bitcube answers, but its full check failed',
    `${cap(probeWords(pb.error))}${pb.failing_s != null && pb.failing_s >= 120 ? `; it has failed for ${dur(pb.failing_s)}` : ''}. TouchDesigner, the lights and the cameras can't be judged until it works.`, 'Wait a minute; the check runs again by itself. If it keeps failing, ask the studio chat to look at bitcube.', ['bitcube', ...unseen]);
  else if (!pb.present) add('not-checked', 'unknown', 70, online === true ? 'Checking: bitcube answers; everything else is not known yet' : online === null ? 'Checking: nothing is known yet' : 'Checking',
    'Mission control has just started; the full check of bitcube takes up to a minute.', 'Wait a minute. Nothing is wrong yet, and nothing is known to be right either.', unseen);
  else if (pr && pb.stale && online !== false) add('probe-stale', 'unknown', 80, `Mission control hasn't heard from bitcube for ${dur(pb.age_s)}`,
    'bitcube answers, but its last full check is old; the lights and cameras below are as they were then.', 'Wait a minute. If it stays this way the check is stuck: ask the studio chat.', ['bitcube', ...BEHIND]);

  if (pr && online !== false) {
    fromProbe = true;
    if (!td) add('td-unknown', 'unknown', 75, "bitcube answers, but its check says nothing about TouchDesigner", 'The full check came back without the TouchDesigner part, so the lights cannot be judged.', 'Wait for the next check; if it keeps happening, ask the studio chat.', ['touchdesigner', 'ropes', 'hub75 panels', y ? null : 'seasons']);
    if (frozen) add('td-frozen', 'down', 80, 'TouchDesigner is frozen: the lights are not being driven',
      "It has not answered bitcube's check; a dialog on its screen is probably blocking it. The rope boxes play their own colour cycle and the panels keep their last picture.",
      heldAction('frozen') ?? `Look at bitcube's screen over screen sharing and answer the dialog, or press ${YEAR_PRESS} (about a minute dark).`, ['touchdesigner', 'seasons', 'ropes', 'hub75 panels']);
    else if (tdOff && !booted) add('td-off', 'down', 80, 'TouchDesigner is not running: the lights are not being driven', 'bitcube is up, but TouchDesigner is not running on it.',
      heldAction('off') ?? "Start it with Switch to the river's year below (about a minute).", ['touchdesigner', 'seasons', 'ropes', 'hub75 panels']);
    else if (tdRestarting) add('td-restarting', 'warning', 60, `TouchDesigner is restarting on ${restartingOn}`, 'The lights are dark for about a minute while the file opens.', 'Wait a minute and look again.', ['touchdesigner', 'seasons', 'ropes', 'hub75 panels']);
    if (comingUp) add('coming-up', 'warning', 44, booted ? `bitcube restarted ${dur(upS)} ago and is still coming up` : 'TouchDesigner has just restarted and is still coming up',
      `${tdOk ? `${tdWords}${yearOk ? `, in ${year.season}` : ''}` : "TouchDesigner hasn't started yet"}${tdStarting ? '; its frame rate is not known yet' : ''}${linkDown ? "; clips to Dave haven't started yet" : ''}.`,
      `Wait two minutes and look again.${linkDown ? " If clips to Dave still haven't started after 5 minutes, ask the studio chat to start them." : ''}`,
      ['bitcube', 'touchdesigner', tdOk ? null : 'seasons', tdOk ? null : 'ropes', tdOk ? null : 'hub75 panels', linkDown ? 'modal link' : null]);
    if (tdOk) {
      const both = boxesDown.length === 2, senderBad = senderKnown && (senderErr || !rs.open);
      const senderWhy = /10049/.test(senderErr || '') ? "bitcube's LIGHTS port has no link" : senderTaken ? "another program on bitcube is using the ropes' connection" : "the sender can't use bitcube's LIGHTS port";
      if (both) add('lights', 'down', 70, `The lights aren't connected: neither rope box answers${ledMissing ? ' and bitcube sees no panel sender' : ''}`,
        `${senderBad ? `${cap(senderWhy)}${ledMissing ? ': expected before the lights are connected' : ''}. ` : ''}${tdWords}; the ropes${ledMissing ? ' and the panels' : ''} are dark.`,
        "In the ceiling: plug the lighting switch into bitcube's LIGHTS port and the panel sender into bitcube's HDMI. The ropes pick up by themselves; then check here that both boxes answer and bitcube sees the panel sender.",
        ['ropes', 'rope box 1', 'rope box 2', ledMissing ? 'hub75 panels' : null]);
      else if (senderBad && senderTaken) add('sender-taken', 'warning', 66, "Another program on bitcube is using the ropes' connection: the ropes aren't getting the river",
        `${tdWords}, but the rope sender is ${rs.retrying ? 'retrying' : 'stopped'}: another lights program (Will's rope lights, or a second sender) holds the connection, and the two must never run at once.`,
        TAKEN_ACTION, ['ropes', ...boxesDown]);
      else if (senderBad) add('sender', 'warning', 66, "The rope sender can't use bitcube's LIGHTS port: the ropes aren't getting the river", `${tdWords}, but the sender is ${rs.retrying ? 'retrying' : 'stopped'}${boxesDown.length ? `; ${boxWords(boxesDown[0])} is silent too` : '; both boxes answer'}.`,
        "Check the lighting switch and the cable into bitcube's LIGHTS port; the sender picks up by itself.", ['ropes', ...boxesDown]);
      else if (boxesDown.length) add('box', 'warning', 64, `${cap(boxWords(boxesDown[0]))} isn't answering: those ropes may be dark`, `${tdWords} and the sender is open, but the box does not answer.`,
        'Check power to that box and its cable to the lighting switch.', ['ropes', boxesDown[0]]);
      else if (senderOff) add('sender-off', 'warning', 62, 'The rope sender is switched off', `${tdWords}, but its sender is not active, so the ropes get nothing.`, 'Press Ropes → On.', ['ropes']);
      if (ledMissing && !both) add('panels', 'down', 65, 'The panels have no sender: bitcube sees no panel sender', 'The panels get their picture over HDMI through the panel sender; bitcube does not see it, so they are dark.',
        "Check the HDMI cable from bitcube to the panel sender and the sender's power.", ['hub75 panels']);
      else if (hub && hub.output === false) add('panels-off', 'warning', 58, "The panels' output is switched off in the show file", 'The show file has its panel output off.', 'Ask the studio chat to turn it on.', ['hub75 panels']);
      else if (hub && brightness === 0) add('panels-dark', 'warning', 58, "The panels are at 0 %, so they're dark", 'Someone turned the panels down to nothing.', 'Raise the panels brightness below.', ['hub75 panels']);
      if (slow) add('td-slow', 'warning', 60, 'TouchDesigner is running slowly: the river will look jerky', `${cap(label)} at ${fps} frames a second instead of 60${tdErrors ? `, with ${tdErrors} errors in the file` : ''}.`,
        `Look at bitcube's screen for what is slow or erroring; if it doesn't recover in a few minutes, press ${YEAR_PRESS} (about a minute dark).`, ['touchdesigner', 'ropes']);
      if (calibrating && calDry) add('calibrating', 'warning', 61, "Calibration dry run: the lights stay as they are",
        `It walks the calibration's steps without touching the lights${calStageWords ? `; it is at ${calStageWords} now,` : ','} and ends by itself in about a minute.`,
        'Nothing to do; it ends by itself. To end it now, stop it on the Lights page.', ['ropes']);
      // a decode of earlier photos: a calibration, never "a dry run", that touches no lights (CR9 #8)
      else if (calibrating && calQuiet) add('calibrating', 'warning', 61, 'Calibrating from earlier photos: the lights stay as they are',
        `The calibration is ${calStageWords}, from photos taken earlier, without touching the lights, and ends by itself.`,
        'Nothing to do; it ends by itself. To end it now, stop it on the Lights page.', ['ropes']);
      else if (calibrating) add('calibrating', 'warning', 61, `Calibrating the lights: the ropes${calPanels ? ' and the panels are' : ' are'} in patterns${calNearly ? ', nearly done' : ` for ${calLeftWords}`}`,
        `The calibration is ${calStageWords}; the ropes${calPanels ? ' and the panels' : ''} go back to what they showed before, by themselves, when it ends.`,
        "Keep people out of the camera's view. If the room is needed now, stop it on the Lights page: the ropes go back at once.", ['ropes', calPanels ? 'hub75 panels' : null]);
      else if (testOn) add('test-pattern', 'warning', 43, 'The test pattern is on: the ropes and panels are not showing the river',
        'Someone started it on the Lights page to check every LED and screen: colours wipe down the ropes, and each screen shows four coloured panels with its number in white squares.',
        "When the check is done, press Stop the test pattern on the Lights page; the river comes back at once. Nothing is broken.", ['ropes', 'hub75 panels']);
      else if (ropesDark) add('ropes-dark', 'warning', 42, 'The ropes are dark on purpose; everything else is up',
        'Someone pressed Ropes → Dark: the sender keeps sending black, so the boxes stay dark instead of playing their own colour cycle. The panels still show the river.',
        'If the ropes should be showing the river, press Ropes → On; they follow within a few seconds. Nothing is broken.', ['ropes']);
      if (kind === 'live') add('online-file', 'warning', 40, "TouchDesigner is showing the live river, not the river's year: the year and its controls are unavailable",
        `The live river has no year of seasons and no year page.${FILES[pr.boot_file]?.kind === 'year' ? " The river's year opens at the next restart." : ''}`,
        "If nobody chose this on purpose, press Switch to the river's year below; the lights go dark for about a minute. If the live river is wanted tonight, leave it.", ['seasons']);
      else if (kind === 'other' && !listedShow) add('old-file', 'warning', 40, `TouchDesigner is showing ${label}, not the river's year: the year and its controls are unavailable`,
        `It is neither the river's year nor the live river.${FILES[pr.boot_file]?.kind === 'year' ? " The river's year opens at the next restart." : ''}`,
        "Press Switch to the river's year below; the lights go dark for about a minute.", ['seasons']);
      else if (kind === 'year' && !y && se.present) add('year-page', 'warning', 46, "The river's year page isn't answering, though TouchDesigner runs it", `${cap(fetchWords(se.error))}; the year's controls come back when it answers properly.`,
        `Wait a minute; if it stays down, press ${YEAR_PRESS} (about a minute dark).`, ['seasons']);
      if (riverStale) add('river-stale', 'warning', 55, `The river camera has sent no frames for ${dur(relayAgeNow)}: the show is running on the rain fallback`,
        `The camera answers but sends nothing${clips.river.present && clips.river.failing ? `; no clips to Dave ${sinceWords(clips.river)}` : ''}.`,
        "Ask Will to restart the river camera, or wait for the Starlink link to settle. If the live river isn't needed tonight, switch to the river's year, which doesn't use it.",
        ['river camera', clips.river.failing ? 'modal link' : null, recErr ? 'recorder' : null]);
    } else if (td) {
      // TouchDesigner restarting, starting, not running or frozen: the rope boxes and the panel sender are read by bitcube itself, so
      // a cabling fault is still known, and still a fault of its own: a restart never ranks above it, nor files it under itself (R10 #29)
      const after = tdRestarting || tdOffBooting ? 'after it restarts' : 'when it is back';
      if (boxesDown.length === 2) add('lights', 'down', 70, `The lights aren't connected: neither rope box answers${ledMissing ? ' and bitcube sees no panel sender' : ''}`,
        `Both rope boxes are silent${ledMissing ? ' and bitcube sees no panel sender' : ''}: that is the cabling, not TouchDesigner, so the ropes${ledMissing ? ' and the panels' : ''} stay dark ${after}.`,
        "In the ceiling: plug the lighting switch into bitcube's LIGHTS port and the panel sender into bitcube's HDMI. The ropes pick up by themselves; then check here that both boxes answer and bitcube sees the panel sender.",
        ['rope box 1', 'rope box 2', ledMissing ? 'hub75 panels' : null]);
      else if (boxesDown.length) add('box', 'warning', 64, `${cap(boxWords(boxesDown[0]))} isn't answering: those ropes may be dark`, `The box does not answer bitcube, whatever TouchDesigner is doing.`,
        'Check power to that box and its cable to the lighting switch.', [boxesDown[0]]);
      if (ledMissing && boxesDown.length < 2) add('panels', 'down', 65, 'The panels have no sender: bitcube sees no panel sender', 'The panels get their picture over HDMI through the panel sender; bitcube does not see it, so they are dark.',
        "Check the HDMI cable from bitcube to the panel sender and the sender's power.", ['hub75 panels']);
    }
    if (internetDown) add('no-internet', 'warning', 54, routerDown ? "The router isn't answering: no internet and no gallery camera, but the show runs by itself"
                                                     : "No internet at Gray Area: the show runs, but clips can't reach Dave's agent and the river site is unreachable",
      `${routerDown ? 'bitcube cannot reach the router, so nothing behind it answers.' : "The router answers, so its internet connection has gone (the venue's staff Wi-Fi, or the wired connection)."}${kind === 'year' ? " The river's year needs no network." : kind === 'live' ? ' The live river has fallen back to the rain.' : ''}${failing.length ? ` Clips to Dave have been failing ${sinceWords(clips[failing[0]])}.` : ''}`,
      routerDown ? "Check the router's power; it comes back by itself in about two minutes. The show keeps running meanwhile." : INTERNET_ACTION,
      ['internet', routerDown ? 'router' : null, routerDown && galleryDown ? 'gallery camera' : null, 'modal link', riverDown ? 'river camera' : null, recErr ? 'recorder' : null]);
    else if (routerDown) add('router', 'warning', 52, "The router isn't answering; bitcube is still reachable", 'bitcube cannot reach the router, so the gallery camera and the internet may be gone with it.',
      "Check the router's power; it comes back by itself in about two minutes.", ['router', galleryDown ? 'gallery camera' : null]);
    else if (riverDown) add('river-site', 'warning', 50, `The river site is down${kind === 'live' ? ': the show is running on the rain fallback' : "; the river's year doesn't use it"}`,
      `The river camera does not answer${clips.river.present && clips.river.failing ? `; no clips to Dave ${sinceWords(clips.river)}` : ''}${recErr ? '; the recorder cannot get video' : ''}.`,
      `The river site needs sun; nothing to do from here.${kind === 'live' ? " If the live river isn't needed tonight, switch to the river's year." : ''}`, ['river camera', clips.river.failing ? 'modal link' : null, recErr ? 'recorder' : null]);
    if (galleryDown && !routerDown) add('gallery-cam', 'warning', 48, "The gallery camera is down: no picture of the room and no clips to Dave's agent; the show itself is unaffected",
      `No answer from the camera${clips.gallery.present && clips.gallery.failing ? `; no clips to Dave ${sinceWords(clips.gallery)}` : ''}.`,
      GALLERY_ACTION, ['gallery camera', clips.gallery.failing ? 'modal link' : null]);
    const unexplained = failing.filter((c) => !internetDown && !(c === 'gallery' && galleryDown) && !(c === 'river' && (riverDown || riverStale)));
    if (linkDown && !comingUp) add('link-off', 'warning', 35, "Clips to Dave aren't running on bitcube", 'Nothing on bitcube is sending clips; the cameras are fine but nothing reaches Dave.',
      'Ask the studio chat to start clips to Dave on bitcube.', ['modal link']);
    else if (unexplained.length) add('link-failing', 'warning', 34, `Clips from the ${unexplained.join(' and ')} camera${unexplained.length > 1 ? 's' : ''} aren't reaching Dave's agent, ${sinceWords(clips[unexplained[0]])}`,
      'The camera answers and the internet works, so the link itself is failing.', 'Ask the studio chat to look at clips to Dave on bitcube.', ['modal link']);
    if (recErr && !riverDown && !riverStale && !internetDown) add('recorder', 'warning', 30, "The river recorder can't get video from the river camera", "This hour's recording got no video from the river camera.", 'It retries every hour; check the river camera.', ['recorder']);
    if (diskLow) add('disk', 'warning', 32, `bitcube's disk is nearly full (${diskGb} GB free)`, 'Recordings and clips fill it up.', 'Ask the studio chat to clear old recordings.', ['bitcube']);
    fromProbe = false;
  }
  const modalPri = kind === 'live' ? 58 : 45;   // Dave's scene is on the panels only in the live river file
  const roomWords = kind === 'live' ? ': the panels keep his last scene' : " (the room is unaffected: the river's year doesn't use its scene)";
  if (modalUnreachable) add('modal-unreachable', 'warning', modalPri, `Dave's agent is unreachable from the Mac mini${roomWords}`, `${cap(fetchWords(md.error, true))} when the Mac mini asked.`, 'Tell Dave if it stays unreachable.', ['modal agent']);
  else if (modalOverdue) add('modal-stalled', 'warning', modalPri, `Dave's agent hasn't updated for ${dur(sinceTickS)}${roomWords}`,
    `It last updated at ${Number.isFinite(finMs) ? clockDay(finMs, now) : 'an unknown time'}. It updates every 5 minutes by day and rests overnight; it has missed ${dur(lateMin * 60)} of daytime updates.${syncOld ? ` Nothing new has come back to bitcube for ${dur(syncAgeNow)}.` : ''}`,
    DAVE_LATE_ACTION, ['modal agent', syncOld ? 'modal link' : null]);
  else if (m && m.ok === false) add('modal-not-ok', 'warning', modalPri, `Dave's agent reports a problem${roomWords}`, 'It says something is wrong on its side.', 'Tell Dave.', ['modal agent']);
  if (md.present && md.stale) add('modal-stale', 'unknown', 15, `Mission control hasn't checked Dave's agent for ${dur(md.age_s)}`, 'What is shown about it is the last answer.', 'Wait a minute; if it stays this way, mission control needs a look.', ['modal agent']);
  if (se.present && se.stale && y && online !== false && !pageStale) add('seasons-stale', 'unknown', 20, `Mission control hasn't checked the river's year page for ${dur(se.age_s)}`, 'The season and intensity shown are the last answer.', 'Wait a minute; if it stays this way, mission control needs a look.', ['seasons']);

  // A switch, restart or rebuild in flight (not a maybe) is what happens next: advice that would press the show-file button again
  // (its lock greys it) says to wait instead, and that it was started on purpose, nothing to call about (R9 #16); one bitcube didn't
  // answer in time that holds the lock says when the buttons unlock in its own advice (heldAction): the band then leaves out its
  // jump's "Wait: …" line, which would say the same again (waits: the entry the advice names; R9 #18)
  const PRESSES = /\b(?:press|start it with) (?:restart on|switch to)\b|\bswitch to the river's year\b/i;
  if (restartBy) {
    const fl = FILES[restartBy.file ?? YEAR_FILE]?.label ?? 'a show file';
    const what = restartBy.action === 'rebuild' ? `rebuilding ${fl}` : /^the restart on /.test(restartBy.label) ? `restarting TouchDesigner on ${fl}` : `switching TouchDesigner to ${fl}`;
    // a rebuild builds and saves before it restarts: a few minutes, never "a minute" under "usually about 2.5 min" (R10 #13)
    const wait = `Someone is ${what} now: wait ${restartBy.action === 'rebuild' ? 'a few minutes' : 'a minute'} and look again.`;
    // only where the change in flight is the remedy the advice names (R10 #13): any restart for TouchDesigner slow, not running or
    // frozen; one that ends on the river's year for the live river or an old file showing, the year's page and the river camera's
    // rain. A restart of the live river never fixes a dead camera: that advice, and its call line, stay the cause's own
    const toYear = (restartBy.file ?? YEAR_FILE) === YEAR_FILE;
    const remedy = (id) => ['td-slow', 'td-off', 'td-frozen', 'touchdesigner'].includes(id) || toYear;
    for (const p of P) if (p.action && PRESSES.test(p.action) && remedy(p.id)) Object.assign(p, { action: wait, waits: restartBy.id, chosen: true });
    for (const x of items) if (x.action && PRESSES.test(x.action) && remedy(x.id)) x.action = wait;
  } else if (held) for (const p of P) if (p.id === 'td-off' || p.id === 'td-frozen') p.waits = held.id;
  // Unknown must never look like OK: anything still unknown that no cause explains gets a cause of its own.
  const explained = new Set(P.flatMap((p) => p.items));
  const orphans = items.filter((x) => x.level === 'unknown' && !x.muted && !explained.has(x.id));
  if (orphans.length) add('unknown', 'unknown', 10, `Not known yet: ${orphans.map((x) => x.name.replace(/ \(.*\)$/, '')).join(', ')}`, 'Mission control has no answer about these yet.', 'Wait a minute and look again.', orphans.map((x) => x.id));
  // A page that can't reach mission control knows nothing current, so it heads the list whatever else was wrong last time
  // (docs/mission-ui.md thresholds: 30 s without an answer, the band goes Unknown); otherwise down > warning > unknown, then priority.
  // When the full check itself is old (or mission control's polling stalled), a warning read from that same old check is not
  // news: "hasn't heard from bitcube" heads the band over it (a Down still wins: it was true then and matters most).
  const staleHead = P.some((p) => p.id === 'probe-stale' || p.id === 'bitcube-unchecked');
  const rank = (p) => (staleHead && p.fromProbe && p.level === 'warning' ? LEVELS.unknown + 0.5 : LEVELS[p.level]);
  P.sort((a, b) => (b.id === 'page') - (a.id === 'page') || rank(a) - rank(b) || b.pri - a.pri);
  const causeOf = {};
  for (const p of P) for (const id of p.items) causeOf[id] ??= p.id;
  for (const x of items) x.cause = causeOf[x.id] ?? null;
  items.sort((a, b) => LEVELS[a.level] - LEVELS[b.level] || ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

  const top = P[0] ?? null;
  const okHeadline = kind === 'live' ? 'Everything is up: the live river is showing; lights and cameras fine'
    : listedShow ? `Everything is up: ${label} is showing; lights and cameras fine`
    : yearOk ? `Everything is up: the river's year is in ${year.season}; lights and cameras fine` : 'Everything is up';
  const overall = {
    level: top?.level ?? 'ok',
    headline: top?.headline ?? okHeadline,
    detail: top?.detail ?? (tdWords ? `${cap(tdWords)}.` : 'Every check answered.'),   // freshness has its own line; it isn't the problem here
    action: top?.action ?? null,
    stale: pageStale || bc.stale || (online === true && pb.present && pb.stale) || (md.present && md.stale) || (se.present && se.stale && !!y && online !== false),
    cause: top?.id ?? null,
    also: P.slice(1).map((p) => p.headline),
    waits: top?.waits ?? null,     // the entry its advice says to wait for (R9 #16, #18): the band shows no jump of its own then
    chosen: !!top?.chosen,         // its advice is to wait for a change someone chose here: nothing to call about (R9 #16)
    checked: { page_age_s, bitcube_age_s: bc.age_s, seasons_age_s: se.age_s, modal_age_s: md.age_s, probe_age_s: pb.age_s },
  };

  // both ways: a change in flight blocks what it names, and an action that would block it waits for it (a switch restarts
  // TouchDesigner, so it waits for a ropes change still in flight), as the server's Applying.conflict does
  // A dry run's start touches no lights: nothing waits for it but a second start (its entry's blocks), R7 #20
  const waitEntry = (action) => applying.find((x) => x.blocks.includes(action) || (!x.dry && (APPLY_BLOCKS[action] ?? []).includes(x.action))) ?? null;
  // one bitcube didn't answer in time says when its lock ends, not "is being applied" (R8 #17)
  const waitOf = (a) => (a ? waitWords(a.label, { maybe: a.maybe && a.phase === 'confirming', unlockMs: a.unlock_at }) : null);
  const waitFor = (action) => waitOf(waitEntry(action));
  // a dry run's or a decode's start touches nothing a change in flight does: it waits only for another calibration start (CR7 #7)
  const waitStart = () => waitOf(applying.find((x) => x.action === 'calibrate'));

  // ---- show: what the piece is doing -----------------------------------------------------------------------------
  // a restart (a switch, a rebuild, TouchDesigner opening a file at boot) has the ropes dark for a minute: never "not getting the
  // river", the words for a cable or sender fault (R7 #18)
  // TouchDesigner frozen or not running: the ropes aren't being driven, never "not getting the river", the words for a cable or a
  // sender fault (R9 #36)
  const ropesState = !pr || online === false || !td ? 'unknown' : tdRestarting || tdOffBooting ? 'restarting' : frozen || tdOff ? 'not-driven'
    : !tdOk || !senderKnown || senderErr || !rs.open || senderOff || boxesDown.length === 2 ? 'not-reaching' : calRopes ? 'calibrating' : testOn && (ro?.source === 'test' || rs?.source === 'test') ? 'test' : ropesDark ? 'dark' : 'river';
  const ropesWords = { test: 'the ropes run the test pattern', river: kind === 'live' ? (relay?.fresh ? 'the ropes show the live river' : 'the ropes show the rain fallback') : 'the ropes show the river',
                       dark: 'the ropes are dark on purpose', 'not-reaching': 'the ropes are not getting the river', unknown: 'the ropes are not known',
                       'not-driven': `the ropes are not being driven: TouchDesigner is ${tdOff ? 'not running' : 'frozen'}`,
                       restarting: `the ropes are dark while TouchDesigner ${tdRestarting ? 'restarts' : 'starts'}`,
                       calibrating: `the ropes are ${calWords}` }[ropesState];
  const ropesItem = items.find((x) => x.id === 'ropes');
  // The panels, the same way: a state word for the page and plain words, beside the item's summary.
  const riverWords = kind === 'live' ? (relay?.fresh ? 'the live river' : 'the rain fallback') : 'the river';
  const panelsState = !pr || online === false || led == null ? 'unknown' : ledMissing ? 'no-sender' : !td ? 'unknown'
    : tdRestarting || tdOffBooting ? 'restarting' : frozen ? 'frozen' : !tdOk ? 'gone' : !hub ? 'no-output'
    : calPanels ? 'calibrating' : hub.source === 'test' ? 'test' : hub.output === false || brightness === 0 ? 'off' : 'river';
  const panelsWords = { unknown: 'the panels are not known', 'no-sender': 'the panels have no sender: dark', restarting: 'the panels are dark while TouchDesigner restarts',
    frozen: 'the panels hold a frozen picture', gone: 'the panels show nothing: TouchDesigner is not running', 'no-output': 'this show file has no panel output',
    off: 'the panels are switched off', test: 'the panels show the test pattern', calibrating: `the panels are ${calWords}`, river: `the panels show ${riverWords}${brightness != null ? ` at ${Math.round(brightness * 100)} %` : ''}` }[panelsState];
  const manual = yearOk ? obj(year.manual) : null;
  const showFiles = (Array.isArray(pr?.show_files) ? pr.show_files : []).filter((f) => FILES[f]?.offered === true);
  const bootNow = bootFile(pr);
  const backToBoot = tdOk && bootNow?.name && bootNow.name !== td.file && showFiles.includes(bootNow.name)
    ? { file: bootNow.name, label: bootNow.label } : null;
  const show = {
    file: tdOk ? { name: td.file, kind, label, words: `TouchDesigner is showing ${label}` } : null,
    combined: tdOk && td.file === 'river-combined-v0.toe' ? obj(td.combined) : null,
    boot_file: bootNow,
    // the files a switch or "Set as default" offers (shows.json offered, and on bitcube)
    show_files: showFiles,
    // one tap back to what opens at boot, when something else is showing (and the boot file is one a switch may open)
    back_to_boot: backToBoot,
    season: yearOk ? year.season : null, phase: yearOk ? num(year.phase) : null, weights: yearOk ? obj(year.weights) : null,
    intensity: intensity != null ? { value: intensity, word: intensityWord(intensity), words: `${intensityWord(intensity)} (${intensity.toFixed(2)})` } : null,
    mode: yearOk ? { id: year.mode, effective: year.effective_mode ?? year.mode, words: modeWords } : null,
    target: yearOk && year.mode === 'manual' ? { season: year.target ?? manual?.season ?? null, intensity: num(manual?.intensity) } : null,
    presence: presence ? { available: presence.available === true, now: num(presence.now), usual: num(presence.usual), relative: num(presence.relative),
      words: presence.available ? `${presence.now} people (usual ${presence.usual})` : 'people counter not available' } : null,
    ropes: { state: ropesState, words: ropesWords, summary: ropesItem?.summary ?? 'not known', source: rs?.source ?? ro?.source ?? null, open: senderKnown ? rs.open : null, watts, cap: capW, route: pr?.lights_route ?? null,
             route_words: ROUTE_WORDS[routeKind(pr?.lights_route)] ?? null, route_note: ROUTE_NOTE[routeKind(pr?.lights_route)] ?? null },
    panels: { present: led, brightness, output: hub ? hub.output !== false : null, state: panelsState, words: panelsWords,
              summary: items.find((x) => x.id === 'hub75 panels')?.summary ?? 'not known' },
    river: relay ? { live: relay.fresh === true, last_frame_age_s: relayAge, night: relay.night ?? null, words: relay.fresh ? 'live frames from the river' : `no live frames for ${dur(relayAgeNow)}: the rain fallback` }
                 : { live: null, last_frame_age_s: null, night: null, words: kind === 'year' ? "the river library (the live river isn't used)" : 'not known' },
    scene: m && obj(m.scene) ? { ...m.scene, set_at: m.set_at ?? null, words: `${m.scene.animation ?? '?'} / ${m.scene.palette ?? '?'}${m.set_at && Number.isFinite(Date.parse(m.set_at)) ? `, set ${clockDay(Date.parse(m.set_at), now)}` : ''}` } : null,
    modal: m ? { tick: m.tick ?? null, mood: m.mood ?? null, ok: m.ok !== false, resting: inRest(now), overdue_min: Math.round(lateMin), last_tick_ms: Number.isFinite(finMs) ? finMs : null, next_tick_ms: nextMs } : null,
    fresh: { seasons_age_s: se.age_s, probe_age_s: pb.age_s, stale: overall.stale },
    // the year's recent path (the seasons page keeps a point every 10 s): when each season began, for a timeline
    history: Array.isArray(y?.history) ? y.history.map(obj).filter((h) => h && num(h.t) != null)
      .map((h) => ({ t_ms: h.t * 1000, phase: num(h.phase), season: seasonOfPhase(num(h.phase)), intensity: num(h.intensity) })) : [],
    // a calibration run: its time left (on the server's clock), its stage, and whether it is a dry run that touches no lights
    // left_s is the one number every page shows (the band, the tiles, Lights' state line and its card); left_words says it
    // the test pattern (Lights → Test pattern): on the ropes, the panels, or both
    test: { on: testOn, ropes: testOn && (ro?.source === 'test' || rs?.source === 'test'), panels: testOn && hub?.source === 'test' },
    calibration: calibrating ? { left_s: calLeftS, left_words: calLeftWords, stage: typeof cal.stage === 'string' ? cal.stage : null, dry: calDry, words: calStageWords } : null,
    uptime_s: upS != null ? Math.round(upS) : null,   // bitcube's uptime as of the server's clock (its restart = now - uptime)
    // TouchDesigner restarting: on which file, and whether someone chose it here (a switch or a rebuild in status.applying): then
    // it was started on purpose, and the Show file readout says "Restarting on …", never "What is showing isn't known" (R7 #18)
    restart: tdRestarting ? { on: restartingOn, chosen: !!restartBy } : null,
    // TouchDesigner not running or not answering while a switch or rebuild bitcube didn't answer in time holds the lock (R8 #16):
    // perhaps restarting on its file. The Show file readout says so ("Maybe restarting on …"), never "isn't known"
    held: held ? { label: held.label, on: FILES[held.file ?? YEAR_FILE]?.label ?? 'a show file', answered_at: heldAt, unlock_at: held.unlock_at } : null,
    applying,   // [{ id, action, label, file, started_at (ms), expect_s, elapsed_s, blocks, phase, words }]: changes in flight, from any phone
    confirmed: confirmedList,   // [{ id, request_id, action, file, label, source, maybe, at }]: changes the server confirmed in the last 10 min (entryVerdict)
    expired: expiredList,       // the same, for changes it gave up on (no reading showed them within their limit)
    verdicts: verdictList,      // [{ id, request_id, verdict }]: the verdicts the history kept, for longer (R8 #0)
    failed: failedList,         // [{ …, error?, maybe }]: changes refused or failed (or a quick one bitcube didn't answer: maybe) (R10 #31)
    words: tdOk ? `${cap(tdWords)}${yearOk ? `: ${year.season}, ${intensityWord(intensity)}, ${modeWords}` : ''}. ${cap(ropesWords)}.` : (top?.headline ?? ''),
  };

  // ---- controls: possible now, or why not ------------------------------------------------------------------------
  const ctl = (why, extra = {}) => ({ possible: !why, why: why ?? null, ...extra });
  const cantPage = pageStale ? "this page can't reach mission control" : null;
  const cantBitcube = online === false ? 'bitcube is offline' : online == null ? "bitcube hasn't been checked yet" : bc.stale ? `mission control hasn't checked bitcube for ${dur(bc.age_s)}` : null;
  const cantTd = !pr ? (pb.present ? 'the full check of bitcube failed' : "bitcube's full check hasn't run yet") : tdOff ? "TouchDesigner isn't running" : tdRestarting ? 'TouchDesigner is restarting' : frozen ? "TouchDesigner isn't answering" : pb.stale ? `mission control hasn't heard from bitcube for ${dur(pb.age_s)}` : null;
  const cantYear = y ? (se.stale ? `mission control hasn't checked the river's year page for ${dur(se.age_s)}` : null)
    : kind === 'live' || kind === 'other' ? "the river's year isn't running: switch to it first" : frozen ? "TouchDesigner isn't answering" : tdOff ? "TouchDesigner isn't running" : tdRestarting ? 'TouchDesigner is restarting'
    : se.present ? "the river's year page isn't answering" : "the river's year page hasn't been checked yet";
  const cantUnknown = !pr ? (pb.present ? 'the full check of bitcube failed' : "bitcube's full check hasn't run yet") : null;   // what it would change isn't known
  // a dry run (or a decode of earlier photos) touches no lights, no camera and no TouchDesigner: it locks nothing on them (R7 #20)
  const cantCal = calibrating && !calQuiet ? CAL_RUNNING : null;
  const cantOld = pr && pb.stale ? `mission control hasn't heard from bitcube for ${dur(pb.age_s)}` : null;
  // never a second switch while TouchDesigner is opening a file: it kills the half-opened one (another minute dark), and
  // while bitcube's own login is still opening it, a second TouchDesigner could start beside it
  // (by an entry: the restart it holds; else the full check's own reading, the very rule the server refuses by: tdStartingWhy)
  const tdBusy = byEntry ? TD_RESTARTING_WHY : tdStartingWhy(pb.value);
  // first the page's contact and bitcube itself, then a change in flight anywhere (status.applying), then the model's own reasons
  const first = (action) => cantPage ?? cantBitcube ?? waitFor(action);
  const calOn = calibrating ? (calDry ? 'a dry run is already running' : 'a calibration is already running') : null;
  const notYear = kind === 'year' ? null : kind ? "the river's year isn't running: switch to it first" : "what TouchDesigner is running isn't known";
  const controls = {
    mode: ctl(first('mode') ?? cantYear, { dynamic: ctl(first('mode') ?? cantYear ?? (counter ? null : "the people counter isn't available yet")) }),
    target: ctl(first('target') ?? cantYear),
    rules: ctl(first('rules') ?? cantYear),
    'rules-reset': ctl(first('rules-reset') ?? cantYear),
    ropes: ctl(first('ropes') ?? cantTd ?? cantCal ?? (testOn ? TEST_ON : null)),
    // the test pattern: through TouchDesigner, never during a calibration (it photographs the ropes and panels); its Stop the same,
    // so a test pattern TouchDesigner can't take back off says why
    test: ctl(first('test') ?? cantTd ?? cantCal ?? (tdOk ? null : "TouchDesigner isn't answering")),
    overlay: ctl(first('overlay') ?? cantTd ?? cantCal ?? (testOn ? TEST_ON : null)
      ?? (td?.file === 'river-combined-v0.toe' && typeof td.combined?.overlay === 'number' ? null : 'combined-v0 is not running or has not answered')),
    hub75: ctl(first('hub75') ?? cantTd ?? cantCal),   // the camera is photographing the panels and ropes
    // never while TouchDesigner is restarting (a second switch kills the half-opened file: another minute dark), and never on
    // a full check too old to say what runs now (the buttons' labels come from it)
    // starting: TouchDesigner opening a file by itself (bitcube's own boot, a crash relaunch: no entry holds it), which the server
    // refuses too (tdStarting, R9 #34)
    switch: ctl(first('switch') ?? cantUnknown ?? tdBusy ?? cantOld ?? cantCal, { starting: tdBusy }),
    bootfile: ctl(first('bootfile') ?? cantUnknown),
    lightsroute: ctl(first('lightsroute') ?? cantUnknown ?? cantOld ?? cantCal),
    // a rebuild bakes the LED map into the river's year and ends in a switch: the switch's reasons, and only on the river's year
    rebuild: ctl(first('rebuild') ?? cantUnknown ?? tdBusy ?? cantOld ?? cantCal ?? (frozen ? "TouchDesigner isn't answering" : null) ?? notYear, { starting: tdBusy }),
    // a calibration's start: TouchDesigner answering on a show file, the gallery camera reachable, nothing running already
    // dry: a dry run's start (no lights, no camera, nothing on TouchDesigner): only contact, bitcube, another start, a run on
    calibrate: ctl(first('calibrate') ?? calOn ?? cantTd ?? (tdOk ? null : "TouchDesigner isn't answering") ?? (testOn ? TEST_ON : null)
      ?? (galleryDown ? "the gallery camera isn't reachable" : null), { dry: ctl(cantPage ?? cantBitcube ?? waitStart() ?? calOn) }),
  };
  // by: the id of the entry a control waits for (its why is that entry's "wait: …"), so the page that sent it can leave out a
  // "Wait: …" line about its own change: its control says it (R8 #18)
  for (const [k, c] of Object.entries(controls)) { const a = c.why && /^wait: /.test(c.why) ? waitEntry(k) : null; c.by = a?.id ?? null; }
  { const a = controls.calibrate.dry.why && /^wait: /.test(controls.calibrate.dry.why) ? applying.find((x) => x.action === 'calibrate') : null; controls.calibrate.dry.by = a?.id ?? null; }

  const sources = {};
  // at: when that source's reading was taken, on the server's clock (ms): a page judges its own change only by a reading after it
  for (const k of Object.keys(S)) sources[k] = { present: S[k].present, ok: S[k].ok, error: S[k].error, at: S[k].at, age_s: S[k].age_s, failing_s: S[k].failing_s, stale: S[k].stale };
  return { overall, problems: P.map(({ pri, fromProbe: _f, waits: _w, chosen: _c, ...p }) => p), show, items, controls, sources };
}

/** Why a switch or a rebuild must wait while TouchDesigner is starting or restarting (a second one kills the half-opened file:
 *  another minute dark), in the pages' words, or null. One small rule on the full check's reading itself (pr: probe.ps1's answer,
 *  the snapshot's probe.value), for derive()'s controls and the server's 409 alike (lib/mission.mjs startingBlocked, R9 #34; never
 *  the whole page model on the server: CR9 #11): restarting on a file; not running yet, or answering with no frame rate yet, while
 *  bitcube has only just booted. No reading at all (none yet, or the check failed) says nothing (the pages have their own reasons,
 *  and bitcube answers a switch itself); a reading that can't say (no td, an uptime that isn't a number) is TD_UNREADABLE_WHY: a
 *  switch then waits for a check that can. A change in flight that restarts TouchDesigner is derive()'s to add (byEntry). */
// in the band's own words for the same state (bitcube just booted: "still coming up"), one colon after "Not possible now:" (R10 #15)
export const TD_STARTING_WHY = 'bitcube is still coming up; wait a minute';
export const TD_RESTARTING_WHY = 'TouchDesigner is restarting; wait a minute';
export const TD_UNREADABLE_WHY = "bitcube's full check can't say whether TouchDesigner is starting; wait a minute and try again";
export function tdStartingWhy(pr) {
  if (pr == null) return null;
  const p = obj(pr), td = obj(p?.td), up = p?.uptime_h;
  if (!p || !td || (up != null && num(up) == null)) return TD_UNREADABLE_WHY;
  const err = td.ok === false ? String(td.error || 'not answering') : null, booted = num(up) != null && up < COMING_UP_H;
  if (err) return /restarting/i.test(err) ? TD_RESTARTING_WHY : /not running/i.test(err) && booted ? TD_STARTING_WHY : null;
  return typeof td.file === 'string' && num(td.fps) == null && booted ? TD_STARTING_WHY : null;
}
/** tdStartingWhy for a GET /api/status payload (its probe source: a failed check is no reading). */
export function tdStarting(status) {
  const p = obj(obj(status)?.probe);
  return tdStartingWhy(p && !p.error ? p.value ?? null : null);
}

// ---- one control's state (docs/mission-ui.md "Applying a change") -----------------------------------------------------
// The pure rules ui.js control() follows (and status.js can): ready, blocked, confirm, applying, confirming, done,
// unconfirmed, failed. Nothing on screen claims a change until bitcube's reading shows it.
export const CTL_STATES = ['ready', 'blocked', 'confirm', 'applying', 'confirming', 'done', 'unconfirmed', 'failed'];
const BUSY = new Set(['confirm', 'applying', 'confirming']);
/** A control before anything was pressed: ready, or blocked with the model's why. */
export function ctlInit(why = null) { return { state: why ? 'blocked' : 'ready', sentAt: null, answeredAt: null, at: null, before: null, effect: null, notSent: null, seen: false }; }
/** A done line stands this long without a reading that shows it; once one has, the first that differs takes it away. */
export const DONE_HOLD_S = 60;
/** One event on one control → its next state (a new object; `effect` says what the page must do now: 'confirm' open the sheet,
 *  'send' POST, 'withdraw' close the sheet, else null). Every event carries `now` (ms).
 *    press { why, confirm }  ready/done/failed/unconfirmed → confirm (asks first) or applying (send); blocked or busy: nothing
 *    yes { why }             confirm → applying (send), or failed "Not sent: <why>" when it became impossible meanwhile
 *    no { why }              confirm → what it was before (ready ↔ blocked by the why now)
 *    why { why }             the model's reason changed: ready ↔ blocked; an open confirm is withdrawn (failed, notSent)
 *    ok { confirmed }        applying → done, or confirming when confirmed === false (the reading doesn't show it yet)
 *    error { maybe }         applying → failed, or unconfirmed when it may have happened (no answer, an unreadable one)
 *    model { confirmed }     confirming, unconfirmed or applying → done when the server's verdict or bitcube's reading shows it (a phone that slept through
 *                            confirming, or a request whose answer was lost, still ends done when the change shows: R6 #0)
 *    expired {}              confirming (or applying) → unconfirmed: the server gave up on it (its entry is in status.expired)
 *    pending {}              applying or unconfirmed → confirming: the server's entry for it (found by its request id while its
 *                            answer stalls or after it was lost) shows the server answered and is waiting for bitcube (R9 #1, #29)
 *    tick { expectS, readAt } confirming → unconfirmed after max(3 × expectS, 120) s since it was answered, but only once a reading
 *                            taken after that limit has been judged (readAt: the wall time of the newest reading judged; null:
 *                            none yet, so a phone waking from sleep, or out of contact, never turns it unconfirmed by its clock
 *                            alone; undefined: a caller that tracks no readings goes by the clock)
 *    reading { holds, why }  done → its line gives way (state ready or blocked, effect 'drop') when a newer reading no longer
 *                            shows what it claims, once one has shown it (seen) or DONE_HOLD_S after it (R6 #30) */
export function ctlStep(s, ev) {
  s = s ?? ctlInit();
  const now = ev?.now ?? null, why = ev?.why ?? null;
  const to = (state, extra = {}) => ({ ...s, state, effect: null, at: now, ...extra });
  const rest = (st) => (st === 'ready' || st === 'blocked' || st == null ? (why ? 'blocked' : 'ready') : st);
  const same = { ...s, effect: null };
  switch (ev?.type) {
    case 'press':
      if (BUSY.has(s.state) || why) return s.state === 'ready' && why ? to('blocked') : same;
      return ev.confirm ? { ...to('confirm', { before: s.state, seen: false }), effect: 'confirm' } : { ...to('applying', { sentAt: now, answeredAt: null, notSent: null, seen: false }), effect: 'send' };
    case 'yes':
      if (s.state !== 'confirm') return same;
      return why ? to('failed', { notSent: why }) : { ...to('applying', { sentAt: now, answeredAt: null, notSent: null, seen: false }), effect: 'send' };
    case 'no': return s.state === 'confirm' ? to(rest(s.before)) : same;
    case 'why':
      if (s.state === 'confirm' && why) return { ...to('failed', { notSent: why }), effect: 'withdraw' };
      if (s.state === 'ready' && why) return to('blocked');
      if (s.state === 'blocked' && !why) return to('ready');
      return same;
    case 'ok': return s.state !== 'applying' ? same : ev.confirmed === false ? to('confirming', { answeredAt: now }) : to('done', { answeredAt: now });
    case 'error': return s.state !== 'applying' ? same : to(ev.maybe ? 'unconfirmed' : 'failed', { answeredAt: now });
    // the server's verdict ends it whenever it is known: also while its own answer is still on the way (R9 #1)
    case 'model': return (s.state === 'confirming' || s.state === 'unconfirmed' || s.state === 'applying') && ev.confirmed === true ? to('done', { seen: true }) : same;
    case 'expired': return s.state === 'confirming' || s.state === 'applying' ? to('unconfirmed') : same;
    // the server's entry shows it answered (still confirming): an answer that stalls or was lost is no reason to say less (R9 #1, #29)
    case 'pending': return s.state === 'applying' || s.state === 'unconfirmed' ? to('confirming', { answeredAt: now }) : same;
    case 'tick': {
      if (s.state !== 'confirming' || now == null) return same;
      // from the answer, as the server counts its lock (a slow rebuild keeps its whole limit); from the press before one
      const limitMs = confirmLimitS(ev.expectS) * 1000, sent = s.answeredAt ?? s.sentAt ?? now;
      if (now - sent <= limitMs) return same;
      if (ev.readAt !== undefined && !(num(ev.readAt) != null && ev.readAt - sent > limitMs)) return same;
      return to('unconfirmed');
    }
    case 'reading': {
      if (s.state !== 'done' || typeof ev.holds !== 'boolean') return same;
      if (ev.holds) return s.seen ? same : { ...s, seen: true, effect: null };
      return s.seen || (now != null && s.at != null && now - s.at > DONE_HOLD_S * 1000) ? { ...to(why ? 'blocked' : 'ready', { seen: false }), effect: 'drop' } : same;
    }
    default: return same;
  }
}
/** What a control in state s shows with the model's why now: the contract's state name, whether the button is disabled,
 *  whether its inputs are locked (applying, confirming, or blocked), and busy (a request in flight or awaiting the reading). */
export function ctlView(s, why = null) {
  const st = s?.state ?? 'ready';
  const busy = st === 'applying' || st === 'confirming';
  return { state: st === 'ready' || st === 'blocked' ? (why ? 'blocked' : 'ready') : st, busy, disabled: busy || !!why, lockInputs: busy || !!why };
}
/** Elapsed seconds as m:ss ("0:34", "12:05"). */
export function elapsedClock(s) { s = Math.max(0, Math.floor(num(s) ?? 0)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; }
// ---- the words of a change in flight: one set for every page (status.js, ui.js control(), Lights, the chat) -----------------
const NB = '\u00a0';                                // a number keeps its unit on one line ("1 min", never "1" / "min")
/** The usual time in words: "usually a few seconds" (up to 20 s, or not known), "usually about 45 s", "usually about 1 min",
 *  "usually about 2.5 min" (half minutes: a rebuild's 150 s is 2.5 min, never 3). */
export function usualWords(expectS) {
  const x = num(expectS);
  if (x == null || x <= LONG_CHANGE_S) return 'usually a few seconds';
  if (x < 55) return `usually about ${Math.round(x)}${NB}s`;
  const min = Math.round(x / 30) / 2;
  return `usually about ${Number.isInteger(min) ? min : min.toFixed(1)}${NB}min`;
}
/** "Applying: <what>…", the applying line before any time is added (and, without the "…", what the live region says). */
export function applyingText(what) { return `Applying: ${what}…`; }
/** The applying line: a long change (usually over 20 s) adds its elapsed m:ss and the usual time from the start; a short one
 *  once it runs past its usual time (10 s when it has none), so a request that hangs never looks like a live spinner for a
 *  minute: "Applying: ropes dark · 0:16 · usually a few seconds" (R6 #1). */
export function applyingWords(text, elapsedS, expectS) {
  const usual = num(expectS) ?? SHORT_CHANGE_S, long = usual > LONG_CHANGE_S;
  // the line goes on after its words, so their "…" goes: "Applying: the switch · 0:34 · usually about 1 min"
  return long || (num(elapsedS) ?? 0) > usual ? `${String(text).replace(/…$/, '')} · ${elapsedClock(elapsedS)} · ${usualWords(expectS)}` : text;
}
/** The confirming line: sent, waiting for bitcube's reading to show it, the time since it was sent and the usual time (seconds,
 *  or words of its own: the boot file's BOOT_USUAL). */
export function confirmingWords(elapsedS, usual = null) {
  const u = typeof usual === 'string' ? usual : num(usual) != null ? usualWords(usual) : '';
  return `Sent · waiting for bitcube to show it · ${elapsedClock(elapsedS)}${u ? ` · ${u}` : ''}`;
}
/** Words without their numbers ("for about 40 s more" and "for about 35 s more" read the same): a live region says a headline
 *  again only when this changes, so a ticking time is never re-announced (R6 #8; Status's band and Lights' state line). */
export const sansTime = (t) => String(t ?? '').replace(/\b\d+:\d{2}\b|\d+(?:[.,]\d+)?[\s\u00a0]*(?:s|min|h|days?)\b/g, '#');
/** A text without its ticking times ("for about 40 s more", "for 3 min", "6 min ago"): what a live region may say (Status's band
 *  and Lights' state line, R7 #13). */
export function untimed(text) {
  return String(text ?? '')
    .replace(/\s*\b(?:for\s+)?(?:about\s+|over\s+)?\d+(?:[.,]\d+)?\s*(?:s|min|h|days?)\b(?:\s+(?:more|ago|left))?/g, '')
    .replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
/** derive()'s show.applying with each entry's elapsed time moved to serverNowMs (the server's clock carried forward): a page that
 *  derives once per answer ticks only the m:ss (the chat, CR7 #13). An entry with no start keeps the time it was derived with. */
export function entriesAt(list, serverNowMs) {
  const now = num(serverNowMs);
  return (Array.isArray(list) ? list : []).map((a) => (now != null && num(a?.started_at) != null ? { ...a, elapsed_s: Math.max(0, Math.round((now - a.started_at) / 1000)) } : { ...a }));
}
/** A change in flight from another phone or the studio chat, as a live region says it (no times): "Applying: <label>, from the
 *  studio chat.", "Waiting for bitcube to show <label>.", "No answer in time for <label>: waiting for bitcube to show whether it
 *  happened." (R7 #12) */
export function entrySaid(a) {
  const label = a?.label ?? 'a change', from = saidFrom(a);
  if (a?.maybe === true) return `No answer in time for ${label}: waiting for bitcube to show whether it happened${from}.`;
  return a?.phase === 'confirming' ? `Waiting for bitcube to show ${label}${from}.` : `Applying: ${label}${from}.`;
}
/** Who sent a change, said (R10 #9): ", from the studio chat", else ", from another phone": a region only ever says another phone's
 *  change (this phone's is said on its control), and a refused press of the same thing never hears "Applying: …" as its own. */
const saidFrom = (a) => (a?.source === 'studio chat' ? ', from the studio chat' : ', from another phone');
/** How long after another phone's change ended a live region still says how it ended (R8 #9): said once, when it appears. */
export const ENDED_SAID_S = 30;
/** A change ended confirmed or expired that waited for the server's verdict (a switch, a rebuild, a boot-file change, a lighting
 *  port change, a calibration's start, or one bitcube didn't answer in time): the ones a band showed as applying. */
const endedAwaited = (e) => e.maybe || Object.hasOwn(AWAITED, e.action);   // an entry is a calibration's start (AWAITED)
/** How another phone's (or the studio chat's) change ended, within ENDED_SAID_S after it did: [{ id, label, at, said }], said "Done:
 *  the change of the default to the live river, from the studio chat." or "The change of the default to the live river: bitcube
 *  didn't show it in time." (R8 #9). own: { ownIds } (ownEntries): this phone's own change is said on its control. nowMs: the
 *  server's clock. A page says each once, by its id (endedOnce, R9 #5). */
export function endedEntries(m, { ownIds = [], skip = null } = {}, nowMs = null) {
  const now = num(nowMs);
  if (!m?.show || now == null) return [];
  // skip(entry, verdict): what a page says another way (Lights: a calibration's start, said by the Calibrate block's new view, R10 #20)
  const recent = (list, verdict) => (list ?? []).filter((e) => e.id && !ownIds.includes(e.id) && endedAwaited(e) && num(e.at) != null && now - e.at >= 0 && now - e.at <= ENDED_SAID_S * 1000
      && !(typeof skip === 'function' && skip(e, verdict)))
    .map((e) => ({ id: e.id, label: e.label, at: e.at, said: verdict === 'confirmed' ? `Done: ${e.label}${saidFrom(e)}.`
      : `${cap(e.label)}${saidFrom(e)}: bitcube didn't show it in time.` }));
  return [...recent(m.show.confirmed, 'confirmed'), ...recent(m.show.expired, 'expired')].sort((a, b) => a.at - b.at);
}
/** The words of endedEntries. */
export function endedSaid(m, own = {}, nowMs = null) { return endedEntries(m, own, nowMs).map((x) => x.said); }
/** A page's memory of the ended changes it has said (R9 #5, #17, #30): each by its id, once, never as part of a region's standing
 *  words, so an old "Done: …" never rides along with a later change and a second change with the same name is still said when it
 *  ends. Nothing on the page's first answer (what ended before it opened is no news), and never one that has the same name as a
 *  change in flight now (the newer change is what is happening). Returns say(m, own, nowMs) → the lines to say now. */
export function endedOnce() {
  let said = new Set(), seeded = false;
  return (m, own = {}, nowMs = null) => {
    if (!m?.show || num(nowMs) == null) return [];
    const list = endedEntries(m, own, nowMs);
    // ids that left both lists are never seen again: forgotten, so the memory stays small
    const listed = new Set([...(m.show.confirmed ?? []), ...(m.show.expired ?? [])].map((e) => e.id));
    said = new Set([...said].filter((id) => listed.has(id)));
    if (!seeded) { seeded = true; for (const e of list) said.add(e.id); return []; }
    const flying = new Set((m.show.applying ?? []).map((a) => a.label));
    const out = [];
    for (const e of list) { if (said.has(e.id)) continue; said.add(e.id); if (!flying.has(e.label)) out.push(e.said); }
    return out;
  };
}
/** What Status's hidden band region stands for: head, the level and the headline without their times (R7 #13), said when either
 *  changes; lines, each change in flight but this phone's own (ownEntries: ownIds, its entries; ownActions, a request without an
 *  id yet) by name and source (R7 #12), each said when it is new (ui.js setLive, R9 #5). How another phone's change ended is said
 *  once beside it (endedOnce), never part of these words. */
export function bandParts(m, { ownIds = [], ownActions = [] } = {}) {
  if (!m) return { head: '', lines: [] };
  const head = `${{ ok: 'OK', warning: 'Attention', down: 'Down', unknown: 'Unknown' }[m.overall.level] ?? 'Unknown'}. ${untimed(m.overall.headline.replace(/\s*\(no answer for [^()]*\)$/, ''))}.`.replace(/\.\.$/, '.');
  if (m.overall.cause === 'page') return { head, lines: [] };
  const others = (m.show.applying ?? []).filter((a) => !(a.id && ownIds.includes(a.id)) && !ownActions.includes(a.action));
  return { head, lines: others.map(entrySaid) };
}
/** What a hidden region says when its words change from prev to now ({ head, lines } each; ui.js setLive): the head (the level
 *  and the headline) only when it changed, and each line that wasn't there before; never the unchanged head beside a new line, and
 *  nothing when a part only went (R9 #5). */
export function liveNews(prev, now) {
  const head = String(now?.head ?? '').trim(), lines = (now?.lines ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const was = prev?.lines ?? [];
  return [...(head && head !== prev?.head ? [head] : []), ...lines.filter((l, i) => !was.includes(l) && lines.indexOf(l) === i)];
}
/** bandParts as one text: the head, then each change in flight. */
export function bandSaid(m, own = {}) { const p = bandParts(m, own); return [p.head, ...p.lines].filter(Boolean).join(' '); }
/** The ids of this phone's own entries that it remembers beyond its controls' current ones (R9 #6, #31): mine.ids, every entry an
 *  answer named, and every entry (in flight, confirmed or expired) that carries a request id it sent (mine.requestIds). */
function mineIds(m, mine = {}) {
  const ids = (mine?.ids ?? []).filter((x) => typeof x === 'string' && x !== '');
  const reqs = new Set((mine?.requestIds ?? []).filter((x) => typeof x === 'string' && x !== ''));
  if (reqs.size) for (const list of [m?.show?.applying, m?.show?.confirmed, m?.show?.expired, m?.show?.failed, m?.show?.verdicts]) {
    for (const e of list ?? []) if (typeof e?.id === 'string' && e.request_id && reqs.has(e.request_id) && !ids.includes(e.id)) ids.push(e.id);
  }
  return ids;
}
/** A page's memory of its own changes (R9 #6, #31): the entries its answers named and the request ids it sent, the newest `max` of
 *  each, kept across its controls' presses (a new press never makes the last one "another phone's"). */
export function ownMemory(max = 20) {
  const mine = { ids: [], requestIds: [] };
  const add = (list, x) => { if (typeof x === 'string' && x !== '' && !list.includes(x)) { list.push(x); if (list.length > max) list.shift(); } };
  return { mine, id: (x) => add(mine.ids, x), request: (x) => add(mine.requestIds, x) };
}
/** This phone's own changes among status.applying (derive()'s show.applying), from its controls: [{ action, state, entryId, at }]
 *  (at: when the control entered its state, this phone's clock, ms). ownIds: its entries by id, and, for a control unconfirmed
 *  without an id (its answer never came), an entry of its action begun before it gave up (one begun later is another phone's
 *  change of the same thing); ownActions: a request in flight or confirming without an id, by its action (CR7 #10). mine: what the
 *  page remembers of its earlier changes (ownMemory: their ids and request ids, R9 #6, #31). What bandSaid, Status's band, Lights'
 *  state line and how a change ended leave out: this phone's own change is said on its control only. */
export function ownEntries(m, controls, nowMs = Date.now(), mine = {}) {
  const list = (Array.isArray(controls) ? controls : []).filter((c) => c && typeof c.action === 'string');
  const ownIds = [...new Set([...list.map((c) => c.entryId).filter((x) => typeof x === 'string' && x !== ''), ...mineIds(m, mine)])];
  const ownActions = [...new Set(list.filter((c) => !c.entryId && (c.state === 'applying' || c.state === 'confirming')).map((c) => c.action))];
  for (const a of m?.show?.applying ?? []) {
    if (!a.id || ownIds.includes(a.id)) continue;
    // the entry's age against the time since the control gave up: both durations, so the phone's clock offset never matters
    const gaveUp = list.some((c) => !c.entryId && c.state === 'unconfirmed' && c.action === a.action
      && (num(c.at) == null || num(a.elapsed_s) == null || a.elapsed_s + 2 >= (nowMs - c.at) / 1000));
    if (gaveUp) ownIds.push(a.id);
  }
  return { ownIds, ownActions };
}
/** What the page's live region says once on entering confirming (never with a time). */
export const CONFIRMING_SAID = 'Sent; waiting for bitcube to show it';
/** Another phone's change in flight (a show.applying entry), for the band: "Applying: the switch to the live river · 0:23 · usually
 *  about 1 min", then, once its request answered (phase 'confirming'), "Waiting for bitcube to show the switch to the live river · …". */
export function entryWords(a, elapsedS) {
  const from = a?.source === 'studio chat' ? ' · from the studio chat' : '';
  // one bitcube didn't answer in time (maybe): not an ordinary change in progress, and its usual time means nothing now (R7 #15)
  // its source after its words, as every other entry line has it, and as the hidden region says it (R10 #26)
  if (a?.maybe === true) return `No answer in time for ${a?.label ?? 'a change'}: waiting for bitcube to show whether it happened${from} · ${elapsedClock(elapsedS)}`;
  const confirming = a?.phase === 'confirming';
  const head = confirming ? `Waiting for bitcube to show ${a?.label ?? 'a change'}` : `Applying: ${a?.label ?? 'a change'}`;
  // the usual time the sending phone gives too: a boot file shows with bitcube's next full check, a run in its progress (R8 #22)
  // a lighting port change waits for the same full check as a boot file (R9 #15)
  const usual = confirming && (a?.action === 'bootfile' || a?.action === 'lightsroute') ? BOOT_USUAL : confirming && a?.action === 'calibrate' ? START_USUAL : usualWords(a?.expect_s);
  return `${head}${from} · ${elapsedClock(elapsedS)} · ${usual}`;
}
/** The server's verdict on one entry, by its id (applying_id): 'pending' (still in status.applying: applying or confirming),
 *  'confirmed' (status.confirmed: bitcube's reading showed it), 'expired' (status.expired: none did within its limit), or null
 *  (not known: no id, an older server, or forgotten after 10 min). m: derive()'s model. */
export function entryVerdict(m, id) {
  if (!id || !m?.show) return null;
  if ((m.show.applying ?? []).some((e) => e.id === id)) return 'pending';
  if ((m.show.confirmed ?? []).some((e) => e.id === id)) return 'confirmed';
  if ((m.show.expired ?? []).some((e) => e.id === id)) return 'expired';
  if ((m.show.failed ?? []).some((e) => e.id === id)) return 'failed';
  // the lists keep 10 min; the history keeps the verdict for longer, and across a restart of the server (R8 #0)
  return (m.show.verdicts ?? []).find((v) => v.id === id)?.verdict ?? null;
}
/** The id of a page's own entry, by the request id it sent with the press (R8 #2): a page whose answer was lost on the way back
 *  never learnt its applying_id, but the server keeps its request id on the entry, in status.confirmed / status.expired and in
 *  the history's verdicts. null when no list names it. */
export function entryIdOf(m, requestId) {
  if (!requestId || !m?.show) return null;
  for (const list of [m.show.applying, m.show.confirmed, m.show.expired, m.show.failed, m.show.verdicts]) {
    const e = (list ?? []).find((x) => x.request_id === requestId && typeof x.id === 'string');
    if (e) return e.id;
  }
  return null;
}
/** A page's own id for one press (sent as request_id with every control POST: R8 #2): unique enough on one phone, and never a
 *  secret. */
export function newRequestId() { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
/** When the server's verdict on a page's own change can't be known (no id: its answer was lost; or no list names it: it aged out
 *  after 10 min, or the server restarted), whether bitcube's reading shows it anyway (CR7 #4). sent: { action, file, before (the
 *  file running, or the boot file, when it was sent), sentAt (the server's clock, ms) }. A switch to a file other than the one
 *  running then, once a full check taken after the send shows TouchDesigner answering on that file; a boot-file change to another
 *  boot file, once one shows it. A restart (the same file) or a rebuild: no reading can tell, so never. */
export function readingShows(m, sent) {
  const o = obj(sent), at = num(m?.sources?.probe?.at), t = num(o?.sentAt);
  if (!o || !m?.show || typeof o.file !== 'string' || o.file === o.before || at == null || t == null || at <= t) return false;
  if (o.action === 'switch') return m.show.file?.name === o.file;
  if (o.action === 'bootfile') return m.show.boot_file?.name === o.file;
  return false;
}
/** A page's own change, judged: the server's verdict by its entry's id (entryVerdict: 'pending', 'confirmed', 'expired'), or, when
 *  that can't be known, 'confirmed' when bitcube's reading shows it (readingShows), else null (waiting; its own limit applies). */
export function serverJudged(m, id, sent = null) {
  const v = entryVerdict(m, id);
  if (v) return v;
  return sent && readingShows(m, sent) ? 'confirmed' : null;
}
/** A change bitcube didn't answer in time keeps its lock (on the server and every page) only when it could still be under way on
 *  bitcube and must not be run twice (lib/applying.mjs reads this table). */
export const MAYBE_HOLDS = Object.keys(AWAITED);
/** Whether this page's own change that bitcube didn't answer in time holds its lock (R8 #18): the server's answer was a maybe
 *  (serverMaybe) naming its entry, and its action is one whose lock holds (MAYBE_HOLDS: the server's own rule, lib/applying.mjs).
 *  Status (by the control's name) and ui.js control() (by its `action`) decide it here, the same way (CR8 #10). */
export function heldMaybe(action, { maybe = false, serverMaybe = false, entryId = null } = {}) {
  return !!maybe && !!serverMaybe && typeof entryId === 'string' && entryId !== '' && MAYBE_HOLDS.includes(action);
}
/** A page's own change judged on a new reading: one rule for Status (status.js settleControls) and ui.js control().update (CR8 #10).
 *  c: { state (its control's), entryId, requestId, sent, serverConfirms, held, saidExpired, lost (its answer was lost on the network) }.
 *  While its POST is in flight (applying) or after its answer was lost, its entry found by the request id it sent decides (R9 #1, #29):
 *  step 'done', 'expired', 'confirming' (the server answered it and waits for bitcube's reading), 'held' (bitcube didn't answer it
 *  in time and the lock holds: unlockAt). Otherwise returns
 *    entryId   its entry: the one its answer named, else, while it waits, the one that carries the request id it sent (R8 #2)
 *    unlockAt  when a held change's lock ends, by the server's own entry once it is in (its line and every "Wait: …" agree, R8 #18)
 *    judged    whether its verdict is the server's to give: a change the server confirms (serverConfirms), or one unconfirmed whose
 *              entry is known (a quick change whose answer was lost); the page then notes the reading as judged (its own limit)
 *    step      'done' (confirmed: by its id, or a reading that shows it when no list names it, serverJudged), 'expired' (the
 *              server gave up on it while it was confirming: unconfirmed now), 'gave-up' (one that may or may not have happened,
 *              which the server then gave up on: said once, saidExpired), or null (waiting) */
export function ownVerdict(m, c = {}) {
  const state = c?.state, waiting = state === 'confirming' || state === 'unconfirmed', flying = state === 'applying';
  const entryId = (typeof c?.entryId === 'string' && c.entryId) || ((waiting || flying) && c?.requestId ? entryIdOf(m, c.requestId) : null) || null;
  const pend = entryId ? (m?.show?.applying ?? []).find((x) => x.id === entryId) ?? null : null;
  // the server holds its lock: bitcube didn't answer it in time, and it could still be under way (MAYBE_HOLDS)
  const holds = !!pend && pend.maybe === true && pend.phase === 'confirming' && MAYBE_HOLDS.includes(pend.action);
  // its answer still on the way (R9 #1), or lost on the network (R9 #29: lost, never a server's maybe): its entry, found by the request
  // id it sent, says where it is: confirmed (done), given up (unconfirmed), answered and waiting for bitcube (confirming), or held
  // one lost with no entry any list names (its request id aged out, a restart of the server) still ends done when a reading taken
  // after it shows it (serverJudged's readingShows, CR7 #4: CR9 #6); one in flight waits for its answer or its entry
  if (flying || (state === 'unconfirmed' && c?.lost && !c?.held)) {
    const v = flying ? (entryId ? entryVerdict(m, entryId) : null) : serverJudged(m, entryId, c?.sent ?? null);
    const step = v === 'confirmed' ? 'done' : v === 'expired' ? (flying ? 'expired' : c?.saidExpired ? null : 'gave-up')
      : v === 'failed' ? 'failed'
      : v === 'pending' && holds ? 'held' : v === 'pending' && !pend.maybe && (!flying || pend.phase === 'confirming') ? 'confirming' : null;
    // one the server saw fail (R10 #31): its words, and whether it may still have happened (a quick change bitcube didn't answer)
    const f = step === 'failed' ? (m.show.failed ?? []).find((x) => x.id === entryId) : null;
    return { entryId, unlockAt: step === 'held' ? num(pend.unlock_at) : null, judged: !!step, step, ...(f ? { failed: { error: f.error ?? null, maybe: f.maybe === true } } : {}) };
  }
  const unlockAt = c?.held && state === 'unconfirmed' && pend ? num(pend.unlock_at) : null;
  // the server's verdict decides a change it confirms, and any change whose entry is known (a quick one found by its request id)
  const judged = waiting && (!!c?.serverConfirms || !!entryId);
  if (!judged) return { entryId, unlockAt, judged, step: null };
  const v = serverJudged(m, entryId, c?.sent ?? null);
  const step = v === 'confirmed' ? 'done' : v === 'expired' && state === 'confirming' ? 'expired' : v === 'expired' && !c?.saidExpired ? 'gave-up' : null;
  return { entryId, unlockAt, judged, step };
}
/** A press mission control hasn't got (R10 #2): once this many status answers since the press came without its request id (in no
 *  list: in flight, confirmed, expired, failed or the history's verdicts), its line says so; at its limit, or as soon as its answer
 *  was lost on the network, it is "Not sent": nothing changed, and its buttons unlock. */
export const UNKNOWN_ANSWERS = 2;
export const NOT_RECEIVED = 'Not received by mission control yet';
/** "Not sent at 21:04: mission control never got it; nothing changed. Press again." */
export function neverGotWords(at) { return `Not sent at ${at}: mission control never got it; nothing changed. Press again.`; }
/** This page's own change that bitcube didn't answer in time while its lock holds (R8 #18), said once on its control in place of a
 *  "Wait: …" line about itself: "The switch to the live river got no answer from bitcube in time: it may or may not have happened;
 *  the buttons unlock when bitcube shows it, or by 21:07." */
export function heldWords(what, unlockAt) {
  return `${cap(String(what ?? 'the change'))} got no answer from bitcube in time: it may or may not have happened; the buttons unlock when bitcube shows it${unlockAt ? `, or by ${unlockAt}` : ''}.`;
}
/** A change no reading showed in time, naming what was sent: "The switch to the live river was sent at 21:13, but bitcube didn't
 *  show it in time: look at the Now line, or call Gavin." (what: the change in team words, or null for "Sent at 21:13, …"). In the
 *  past, as Last sent, Recent and the ended line say the same verdict (R9 #14). */
export function unconfirmedWords(what, at, where = 'look at the Now line, or call Gavin') {
  return `${what ? `${cap(String(what))} was sent at ${at}` : `Sent at ${at}`}, but bitcube didn't show it in time: ${where}.`;
}
/** A confirm left open asks what it asked at the press; whether it would ask something else now (R10 #28): its title or its action
 *  (the show file changed meanwhile: "Restart on the river's year now?" is a switch away from the live river once that runs).
 *  asked: what the sheet shows; now: what a press would ask now (null when it can't be told: nothing to compare). */
export function confirmChanged(asked, now) {
  if (!asked || !now) return false;
  return asked.title !== now.title || asked.ok !== now.ok;
}
/** Why a confirm whose question changed is withdrawn: "Not sent at 21:04: the show file changed meanwhile." */
export const CHANGED_MEANWHILE = 'the show file changed meanwhile';
/** A press judged again and found impossible, or a confirm withdrawn: "Not sent at 21:04: bitcube is offline." Another change in
 *  flight is said in the past tense, so the line stays true after it ends: "Not sent at 21:17: the restart on the river's year
 *  was being applied. Press again when it is done." (R6 #4, #16) */
/** TouchDesigner starting or restarting with no entry holding it (model.js tdStartingWhy, the server's 409 too), in the past tense so it
 *  stays true once it has started, with one instruction (R10 #14): "bitcube was still coming up. Press again in a minute.", or null. */
function pastStarting(w) {
  const x = /^(bitcube is still coming up|TouchDesigner is (?:still starting|restarting)|bitcube's full check can't say whether TouchDesigner is starting)[:;] wait a minute(?: and try again)?$/i.exec(w);
  if (!x) return null;
  return x[1].replace(/^bitcube is still/, 'bitcube was still').replace(/^TouchDesigner is still/, 'TouchDesigner was still').replace(/^TouchDesigner is restarting/, 'TouchDesigner was restarting')
    .replace(/can't say whether TouchDesigner is starting/, "couldn't say whether TouchDesigner was starting");
}
export function notSentWords(why, at) {
  const w = String(why ?? "this page can't reach mission control").replace(/[.\s]+$/, '');
  if (/^wait: /i.test(w)) return `Not sent at ${at}: ${pastWait(w.slice(6), { started: false })}`;
  const st = pastStarting(w);
  if (st) return `Not sent at ${at}: ${st}. Press again in a minute.`;
  return `Not sent at ${at}: ${w}.`;
}
/** A "wait: …" reason in the past tense, so it stays true once that change ends: "the switch to the live river was being applied.
 *  Press again when it is done."; one bitcube didn't answer in time: "the restart on the river's year had got no answer from
 *  bitcube; the buttons unlock by 21:07. Press again then." (R8 #17) */
function pastWait(x, { kept = '', started = true } = {}) {
  const k = kept ? ` ${kept}` : '';
  const maybe = /^(.*?) got no answer from bitcube in time(?:; it unlocks by (.+))?$/.exec(x);
  if (maybe) return `${maybe[1]} had got no answer from bitcube${maybe[2] ? `; the buttons unlock by ${maybe[2]}` : ''}.${k} Press again then.`;
  return `${started ? x.replace(/ is being applied\b/, ' was being applied') : x.replace(/ is being applied\b.*$/, ' was being applied')}.${k} Press again when it is done.`;
}
/** A refused or failed change on its control, from the reason in words (app.js plainError): "<fail>: <reason> (21:04). Try again,
 *  or see the verdict above." Another change in flight reads as the server wrote it ("… is being applied (started 21:04). Try
 *  again when it is done."); a calibration running says to stop it or wait (R6 #14). kept: a form's "What you typed is kept.";
 *  tail: the last words, where the page that has no verdict points ("Try again, or check Status."). */
export function failWords(fail, why, at, { kept = '', tail = 'Try again, or see the verdict above.' } = {}) {
  const w = String(why ?? '').replace(/[.\s]+$/, ''), k = kept ? ` ${kept}` : '';
  // another change in flight: in the past tense, as a withdrawn confirm says it, so the line stays true once it ends (R7 #21)
  if (/^wait: /i.test(w)) return `${fail}: ${pastWait(w.slice(6), { kept })}`;
  if (/^a calibration is running\b/i.test(w)) return `${fail}: a calibration is running (${at}).${k} Stop it on the Lights page, or try again when it ends.`;
  const st = pastStarting(w);
  if (st) return `${fail}: ${st} (${at}).${k} Press again in a minute.`;
  return `${fail}: ${w} (${at}).${k}${/try again|apply again/i.test(w) ? '' : ` ${tail}`}`;
}
