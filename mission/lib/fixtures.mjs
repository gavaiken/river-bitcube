// Fixture mode for mission control (MISSION_FIXTURES=<dir>): the same API served from scenario files instead of
// bitcube, Modal and the seasons page, so the pages can be designed and screenshotted in every state of the show
// without touching the live installation. Nothing here opens a socket or runs ssh. A scenario is <dir>/<name>.json:
//   { "_scenario": { "title": "...", "description": "..." },     free-form notes; only these two are shown
//     "status": { bitcube, seasons, modal, probe },               exactly what /api/status returns (minus studio)
//     "cameras": { "gallery": true, "river": false },             true = a placeholder still, false = 503 as when a camera is down
//     "camera_age_s": { "gallery": 30 } }                         how old a still claims to be (20 s)
// Files are read on every request, so editing one needs no restart. A browser picks its scenario with the
// `scenario` cookie (GET /fixtures/<name>); without one it gets all-good, else the first name alphabetically.
// Controls are checked exactly like the real ones (planControl), then only logged to <state>/controls.log.
//
// The clock: a scenario is written at one frozen moment (_scenario.now). Serving it later must not age it (an "at" from
// this morning would read as hours old by tonight), but it must not change its time of day either: Dave's agent rests
// 23:55-07:00 Pacific, so a scene "3 h old at 02:59" is the agent resting, while the same scene rebased to 18:50 reads
// "hasn't ticked for 3 h". So every timestamp is shifted by WHOLE DAYS only, to the last same time of day at or before
// now (fixtureClock), and the snapshot carries that moment as `now`: the server serves it as the clock the page judges
// by (/api/status now), and ages are what the scenario wrote. The fixture clock stands still between polls; a page
// ticks its own ages from the moment it received the answer, as it does with the live server.
//
// GET /api/lights (what TouchDesigner is sending to the lights right now) is answered here by synthesising season-coloured
// flowing water from the scenario's seasons state (renderLights), wrapped in the SAME shape lib/lights.mjs documents for
// the real frames (its CONTRACT: { ok, action: 'frames', file, fps, frames: { at, source, brightness, ropes { w, h, rgb,
// source, brightness, watts }, panels { w, h, rgb, source, brightness, output, atlas }, screens { w, h, rgb, cells } }, age_s }),
// plus synthetic: true. The panels part is the Gray Area atlas (stacked quads) made from the upright screens.
// 503 { error } when there is nothing to show: bitcube offline, TouchDesigner not answering, or not checked yet.
//
// The calibration (POST /api/control/calibrate, GET /api/calibration) is a scripted run (FixtureCalibration): about 60 s
// instead of five minutes, writing the exact progress-file shape lib/lights.mjs documents (stages ropes-capture with two
// passes of 29 patterns and one retake, ropes-decode over 20 ropes, hub75-capture, hub75-locate, done; before/restored;
// a result naming the newest map in the repo). Cancel stops it (restored true). outcome 'drift' ends it in the drift
// failure, 'decode' in a decode failure. Each scenario has its own job (a run started on all-good is not seen from td-frozen:
// every scenario is its own world, like its history); while one exists (24 h, like probe.ps1) that scenario's probe carries it
// as `calibration`, so the Status band can say "Calibrating the lights".
//
// Applying a change (docs/mission-ui.md "Applying a change") works as live, per scenario: every control in flight is in the
// snapshot's `applying` (started_at on the scenario's clock), a conflicting one answers 409 "wait: ...", and a calibration
// can't start under a switch, rebuild or boot-file change. So a page can be tested through applying and confirming, a switch,
// a rebuild or a boot-file change holds for applyS seconds (MISSION_FIXTURE_APPLY_S, 6; a rebuild twice that) before it
// answers; then, in that scenario's world only and in memory, a switch makes TouchDesigner report the new file (the boot
// file stays, as probe.ps1's switch leaves it), a boot-file change its boot_file. As live, a switch or a rebuild that answered stays
// in status.applying as 'confirming' while TouchDesigner restarts: for another applyS seconds the world's TouchDesigner reports
// "restarting on <file>" (what the switch's own answer says live, until the next full check), then it answers on the new file
// and the next snapshot confirms the change (status.confirmed names its entry); a rebuild records the map in use (rebuilt())
// only then.
import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CAMERAS, calBlocked, checkedControl, awaitsReading, startingBlocked, testBlocked, MODAL_INPUT_ONLY } from './mission.mjs';
import { Applying } from './applying.mjs';
import { readLocalPixelmap, summarizePixelmap, checkedCalibrate } from './lights.mjs';
import { atlasFromUprights } from '../public/screens.js';
import { changeLabel, FILES, MODAL_INPUT_FILE } from '../public/model.js';
import { FRAME_ELEMENTS } from '../public/modal-input.js';

// ---- the Modal input show (docs/modal-inputs.md) in fixture mode -------------------------------------------------------------
// td.modal_input as probe.ps1 reports it while river-combined-modal-inputs.toe runs: the fixtures (test/fixtures/build.mjs) and a
// world switched to that show both use it; a Modal input change in a world sets its source and strength and the params that
// source sends. ages: each source's age_s.
const FRAME_ID = '2026-10-23T09-57-25Z-7f3a';    // issued 95 s before the fixtures' moment (02:59:00 PDT), as it arrived
const FIXTURE_NOW = 1792749540000;
/** The id of a frame that arrived age_s before the fixtures' moment (Modal names a frame by its UTC issue time). */
const frameIdAged = (age_s) => new Date(FIXTURE_NOW - age_s * 1000).toISOString().slice(0, 19).replace(/:/g, '-') + 'Z-7f3a';
const SEEN_FRAMES = ['2026-10-23T09-47-31Z-1c20', '2026-10-23T09-49-20Z-88d1', '2026-10-23T09-51-40Z-30ab', '2026-10-23T09-53-25Z-c4e9', '2026-10-23T09-55-30Z-0f17'];
const MI_PARAMS = {
  off: [],
  canvas: [{ name: 'canvas', value: 'drift / deepening-pool', drives: 'additive overlay' }],
  scene: [
    { name: 'palette', value: ['#dce7f5', '#8faac4', '#4d6a8a', '#1f2f45'], drives: 'river recolour (gradient map by brightness)' },
    { name: 'speed', value: 0.19, factor: 0.85, drives: 'summer effect speed ×0.6–1.6' },
    { name: 'density', value: 0.41, factor: 0.93, drives: 'summer effects amount' },
    { name: 'brightness', value: 0.56, factor: 1.02, drives: 'river gain' },
    { name: 'turbulence', value: 0.62, effective: 0.55, factor: 1.1, drives: 'torrent / roughness' },
  ],
  // as Dave's agent sends them today (28 Oct): the four screens with the same settings (the page shows them as one row), the ropes their own
  frames: FRAME_ELEMENTS.map((el, k) => ({ name: el, value: { amount: [0.53, 0.53, 0.53, 0.53, 0.7][k], contrast: 0.4, speed: [0.54, 0.54, 0.54, 0.54, 0.8][k], journey: 1 },
    mix: 0.6, drives: el === 'ropes' ? 'rope target picture × river ripple' : `screen ${k + 1} target picture × river ripple` })),
};
export function fixtureModalInput(source = 'scene', { strength = 0.6, ages = { canvas: 3, scene: 42, frames: 95 }, stale = false } = {}) {
  const frameId = ages.frames === 95 ? FRAME_ID : frameIdAged(ages.frames);
  return { source, strength, effective_source: stale ? 'off' : source, fading: false, stale,
    stale_reason: stale ? (source === 'frames' ? 'frames quiet: newest frame is 120 s past its ttl' : `newest ${source} is older than 900 s`) : null,
    data_age_s: source === 'off' ? null : ages[source], mix: { canvas: source === 'canvas' && !stale ? strength : 0, scene: source === 'scene' && !stale ? strength : 0, frames: source === 'frames' && !stale ? strength : 0 },
    sources: { canvas: { ok: true, age_s: ages.canvas },
      scene: { ok: true, age_s: ages.scene, set_at: '2026-10-23T02:58:18-07:00', palette_name: 'froth-deepening', animation: 'drift', journal: 'The room has gone quiet, so the river slows and cools toward deep water.' },
      frames: { ok: !stale || source !== 'frames', age_s: ages.frames, frame_id: frameId, note: 'dusk: cooling toward deep blue', quiet: stale && source === 'frames', rejected: null, sync: { ok: true, age_s: 4, error: null } } },
    params: structuredClone(MI_PARAMS[source] ?? []),
    // what mission control saw lately (lib/modal-seen.mjs adds it live; a fixture carries its own): a frame about every 2 min, a
    // scene about every 6 min
    seen: { frames: frameId === FRAME_ID ? [...SEEN_FRAMES, FRAME_ID] : [frameId], scene: ['2026-10-23T02:46:02-07:00', '2026-10-23T02:52:11-07:00', '2026-10-23T02:58:18-07:00'] } };
}
/** A Modal input change in a world, as the next full check reports it: the chosen source and strength (and its params). */
function withModalInput(mi, set) {
  const base = mi && typeof mi === 'object' ? mi : fixtureModalInput();
  if (!set) return base;
  const age = base.sources?.[set.source]?.age_s, stale = set.source !== 'off' && typeof age === 'number' && age > (base.stale_after_s ?? 900);
  return { ...base, source: set.source, strength: set.strength, effective_source: stale ? 'off' : set.source, fading: false, stale,
           stale_reason: stale ? `newest ${set.source} is older than ${base.stale_after_s ?? 900} s` : null,
           data_age_s: set.source === 'off' ? null : age ?? null, params: structuredClone(MI_PARAMS[set.source] ?? []) };
}

const NAME = /^[a-z0-9-]+$/;
const STILL_AGE_S = 20;
export const DAY_MS = 86_400_000;
const TZ = 'America/Los_Angeles';

/** Local-time offset (ms) of a moment in the team's zone, so a whole-day shift keeps the wall clock across a DST change. */
function tzOffsetMs(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t) => Number(parts.find((x) => x.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}

/** The fixture's moment moved forward by whole days: the latest moment at or before `now` with the same time of day. */
export function fixtureClock(fixtureNow, now) {
  if (!Number.isFinite(fixtureNow)) return now;
  let c = fixtureNow + Math.floor((now - fixtureNow) / DAY_MS) * DAY_MS;
  c += tzOffsetMs(fixtureNow) - tzOffsetMs(c);        // the same wall clock in Pacific time
  if (c > now) c -= DAY_MS;
  return c;
}

/** How long a fixture change holds before it answers, in units of applyS (the rest answer at once, as their own answer is the
 *  reading live). */
const HOLD = { switch: 1, bootfile: 1, rebuild: 2 };

export class FixtureMission {
  constructor({ dir, stateDir, now = () => Date.now(), pixelmapDir = null, calibrateS = 60, applyS = 6, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    if (!dir || !existsSync(dir)) throw new Error(`MISSION_FIXTURES: ${dir} is not a folder`);
    Object.assign(this, { dir, stateDir, now, pixelmapDir, calibrateS, applyS: Number.isFinite(applyS) && applyS > 0 ? applyS : 0, sleep });
    this.calibs = new Map();     // scenario name -> FixtureCalibration: each scenario is its own world, so its own job on its own bitcube
    this.worlds = new Map();     // scenario name -> { applying, file, boot_file, rebuilt, restarting }: its changes in flight and what they changed
  }

  /** A scenario's own world (by cookie value; the same resolution as active()). */
  worldFor(name) {
    const n = this.active(name) ?? '-';
    if (!this.worlds.has(n)) this.worlds.set(n, { applying: new Applying({ now: this.now }), file: null, boot_file: null, rebuilt: null, restarting: null, test: false });
    return this.worlds.get(n);
  }

  /** The last confirmed rebuild in a scenario's world, { at, map, file }, or null (Mission.rebuilt's shape). A rebuild whose
   *  restart is over is confirmed first (snapshot()). */
  rebuilt(name) {
    try { this.snapshot(name); } catch { /* a half-edited scenario */ }
    const r = this.worldFor(name).rebuilt; return r ? { ...r } : null;
  }

  start() {}      // nothing to poll
  stop() { for (const c of this.calibs.values()) c.stop(); }

  /** The scripted calibration job of a scenario (by cookie value; the same resolution as active()). */
  calibFor(name) {
    const n = this.active(name) ?? '-';
    if (!this.calibs.has(n)) this.calibs.set(n, new FixtureCalibration({ now: this.now, durationS: this.calibrateS, map: () => (this.pixelmapDir ? readLocalPixelmap(this.pixelmapDir) : null) }));
    return this.calibs.get(n);
  }

  /** The clock a scenario is served on (see the header): its moment shifted by whole days to today, or now when it has none. */
  clock(name) { const [, f] = this.#scenario(name); return fixtureClock(f._scenario?.now, this.now()); }

  /** Scenario names, alphabetical (read afresh each time, so a new file shows up at once). */
  names() { return readdirSync(this.dir).filter((f) => f.endsWith('.json') && NAME.test(f.slice(0, -5))).map((f) => f.slice(0, -5)).sort(); }

  list() {
    return this.names().map((name) => {
      try { const s = this.#read(name)._scenario ?? {}; return { name, title: s.title ?? name, description: s.description ?? '', expect: s.expect ?? null }; }
      catch (e) { return { name, title: name, description: e.message }; }       // a half-edited file shouldn't hide the list
    });
  }

  /** Which scenario a request sees: its cookie if that names one, else all-good, else the first. Null if there are none. */
  active(cookieValue) {
    const names = this.names();
    if (names.includes(cookieValue)) return cookieValue;
    return names.includes('all-good') ? 'all-good' : names[0] ?? null;
  }

  snapshot(name) {
    const [n, f] = this.#scenario(name);
    // Every timestamp moves with the fixture clock (the header): whole days forward, so the scene set "9 h ago" in the
    // file is 9 h before `now` whenever the page is opened, at the same time of day the scenario was written at.
    const clock = fixtureClock(f._scenario?.now, this.now());
    const delta = Number.isFinite(f._scenario?.now) ? clock - f._scenario.now : 0;
    const out = {};
    for (const [k, v] of Object.entries(f.status ?? {})) {
      if (!v || typeof v !== 'object') { out[k] = v; continue; }
      const src = rebase(v, delta);
      // The real snapshot carries both `at` and `age_s`; a hand-written source may give one, so fill in the other.
      // A rebased `at` has moved, so its age_s follows it; a frozen fixture (no _scenario.now) keeps its age_s as written.
      if (src.at != null && (delta || src.age_s == null)) src.age_s = Math.max(0, Math.round((clock - src.at) / 1000));
      else if (src.age_s != null && src.at == null) src.at = clock - src.age_s * 1000;
      out[k] = src;
    }
    // The calibration job, as probe.ps1 reports it: the progress file while a run is on or recent (only behind a full check).
    // read now, as Mission.snapshot serves Lights' own reads (read_age_s): never aged by the full check's own age (R7 #32)
    const cal0 = this.calibFor(n).probeView(), cal = cal0 ? { ...cal0, read_age_s: 0 } : null;
    if (cal && out.probe && typeof out.probe === 'object' && out.probe.value && typeof out.probe.value === 'object') out.probe = { ...out.probe, value: { ...out.probe.value, calibration: cal } };
    // What a switch or a boot-file change did in this world (in memory), as the next full check would report it: while the
    // switch's TouchDesigner restarts, "restarting on <file>" (the switch's own answer, live); then the new file, which confirms it.
    const w = this.worldFor(n);
    const restarting = w.restarting && this.now() < w.restarting.until ? w.restarting.file : null;
    if ((w.file || w.boot_file) && out.probe?.value && typeof out.probe.value === 'object') {
      const v = { ...out.probe.value };
      if (restarting) v.td = { ok: false, error: `restarting on ${restarting}` };
      else if (w.file && v.td && typeof v.td === 'object') v.td = { ...v.td, file: w.file };
      if (w.boot_file) v.boot_file = w.boot_file;
      out.probe = { ...out.probe, value: v };
    }
    // the test pattern this world turned on, as the next full check reports it: the ropes' and the panels' Source
    if (w.test && out.probe?.value?.td && typeof out.probe.value.td === 'object' && out.probe.value.td.ok !== false) {
      const td = out.probe.value.td, ro = td.ropes && typeof td.ropes === 'object' ? td.ropes : null;
      out.probe = { ...out.probe, value: { ...out.probe.value, td: { ...td,
        ...(ro ? { ropes: { ...ro, source: 'test', ...(ro.status && typeof ro.status === 'object' ? { status: { ...ro.status, source: 'test' } } : {}) } } : {}),
        ...(td.hub75 && typeof td.hub75 === 'object' ? { hub75: { ...td.hub75, source: 'test' } } : {}) } } };
    }
    if (out.probe?.value?.td?.file === 'river-combined-v0.toe') {
      const td = out.probe.value.td;
      out.probe.value.td = { ...td, combined: { season: 'summer', intensity: 0.85, overlay: w.overlay ?? 0.25,
        screens: { offset: 0, recorded: 0, ...(w.screens ?? { mode: 'current', blend: 0, hold: 30 }), gavin_mix: w.screens?.mode === 'gavin' ? 1 : w.screens?.mode === 'manual' ? w.screens.blend * (1 - (w.screens.recorded ?? 0)) : 0, recorded_mix: w.screens?.mode === 'recorded' ? 1 : w.screens?.mode === 'manual' ? (w.screens.recorded ?? 0) : 0, fade_s: 8 }, framing: w.framing ?? 'original', effective_framing: w.framing === 'auto' ? 'pool-multi' : w.framing ?? 'original', auto_view: w.framing === 'auto' ? { view: 'pool', reason: 'matched' } : null, effective_overlay: w.overlay ?? 0.25, river_source: 'live', scene: { animation: 'flow', palette: 'fixture' }, scene_age_s: 5 } };
    }
    if (out.probe?.value?.td?.file === MODAL_INPUT_FILE && out.probe.value.td.ok !== false) {
      out.probe = { ...out.probe, value: { ...out.probe.value, td: { ...out.probe.value.td, modal_input: withModalInput(out.probe.value.td.modal_input, w.modalinput) } } };
    }
    if (out.probe?.value) w.applying.confirm(out.probe.value, this.now());
    out.applying = w.applying.list(clock);
    const ended = w.applying.ended(clock);
    out.confirmed = ended.confirmed;
    out.expired = ended.expired;
    out.failed = ended.failed;      // refused or failed: a page whose answer was lost learns it by its request id (R10 #31)
    out.fixture = n;
    out.now = clock;
    return out;
  }

  /** A placeholder still ({ jpeg: bytes, type, at }: `jpeg` is the server's name for the bytes whatever the format), or {} when
   *  the scenario says that camera is down. */
  async camera(cam, name) {
    if (!CAMERAS.includes(cam)) throw Object.assign(new Error('unknown camera'), { status: 400 });
    const [, f] = this.#scenario(name);
    if (!f.cameras?.[cam]) return {};
    const at = fixtureClock(f._scenario?.now, this.now()) - 1000 * Number(f.camera_age_s?.[cam] ?? STILL_AGE_S);
    for (const file of [`placeholder-${cam}.jpg`, 'placeholder.jpg']) {
      if (existsSync(join(this.dir, file))) return { jpeg: readFileSync(join(this.dir, file)), type: 'image/jpeg', at };
    }
    return { jpeg: Buffer.from(svgStill(cam)), type: 'image/svg+xml', at };
  }

  /** Same whitelist and argument checks as Mission.control, the same locks (a calibration, a change in flight); then the
   *  request is logged instead of acted on, and a switch, rebuild or boot-file change holds and changes this world (header). */
  /** The label a change gets in this world (a switch to the file its TouchDesigner runs is "the restart on …"). */
  label(action, body, scenario = null) {
    let file = null;
    try { file = this.snapshot(scenario).probe?.value?.td?.file ?? null; } catch { /* a half-edited scenario */ }
    return changeLabel(action, body, { running: typeof file === 'string' ? file : null });
  }

  /** Whether anything is in flight or confirming in any world (the server's self-update waits for none). */
  busy() { return [...this.worlds.values()].some((w) => w.applying.list().length > 0); }

  async control(action, body = {}, scenario = null, { source = 'mission control', requestId = null } = {}) {
    const checked = checkedControl(action, body);         // only what the whitelist read is logged, recorded and echoed
    // the scenario's own scripted run blocks what the live server blocks (Mission.control)
    const blocked = calBlocked(action, this.calibFor(scenario).status());
    if (blocked) throw blocked;
    // and TouchDesigner opening a file by itself, as the live server refuses it (R9 #34)
    const w = this.worldFor(scenario);
    let probe; try { probe = this.snapshot(scenario).probe; } catch { probe = { value: 'unreadable' }; }   // a half-edited scenario: closed
    const starting = w.applying.conflict(action, checked) ? null : startingBlocked(action, probe);
    if (starting) throw starting;
    const testing = testBlocked(action, checked, probe);      // the ropes button or a calibration while the test pattern shows
    if (testing) throw testing;
    let td = null;                 // TouchDesigner in this world: a switch to the file it runs reads "the restart on ..."
    try { td = this.snapshot(scenario).probe?.value?.td ?? null; } catch { /* a half-edited scenario: plain words */ }
    const running = typeof td?.file === 'string' ? td.file : null;
    let baked = null;              // a rebuild's map: the map in use once the rebuild is confirmed (as live)
    return w.applying.run(action, checked, async () => {
      this.#log(action, checked);
      // a rebuild is refused as probe.ps1 refuses it: only into the file TouchDesigner has open, and only while it answers
      if (action === 'rebuild' && (!td || td.ok === false)) return { ok: false, error: 'TouchDesigner did not answer: rebuild refused', rebuilt: false, saved: false, switched: false, fixture: true };
      if (action === 'rebuild' && running !== checked.file) return { ok: false, error: `TouchDesigner is running ${running}, not ${checked.file}: rebuild refused`, rebuilt: false, saved: false, switched: false, fixture: true };
      const hold = (HOLD[action] ?? 0) * this.applyS;
      if (hold > 0) await this.sleep(hold * 1000);
      if (action === 'switch' || action === 'rebuild') {     // a rebuild ends in the switch path: TouchDesigner restarts on the file
        w.file = checked.file;          // a switch leaves the boot file alone (probe.ps1: only bootfile writes boot-file.txt)
        w.restarting = this.applyS > 0 ? { file: checked.file, until: this.now() + this.applyS * 1000 } : null;
      }
      if (action === 'bootfile') w.boot_file = checked.file;
      if (action === 'overlay') {
        if (!td || td.ok === false || running !== 'river-combined-v0.toe')
          return { ok: false, error: 'overlay control is only available while combined-v0 is running', fixture: true };
        w.overlay = checked.strength;
        if (checked.framing !== undefined) w.framing = checked.framing;
        if (checked.screens !== undefined) w.screens = { offset: w.screens?.offset ?? 0, recorded: w.screens?.recorded ?? 0, ...checked.screens };
      }
      if (action === 'modalinput') {     // as probe.ps1 -Action modalinput: only while that show answers
        if (!td || td.ok === false || running !== MODAL_INPUT_FILE) return { ok: false, error: MODAL_INPUT_ONLY, fixture: true };
        w.modalinput = { source: checked.source, strength: checked.strength };
      }
      if (action === 'test') {       // as probe.ps1 -Action test: through TouchDesigner, refused when it doesn't answer
        if (!td || td.ok === false) return { ok: false, error: 'TouchDesigner is not running', fixture: true };
        w.test = checked.on;
      }
      if (action === 'rebuild') {
        // as probe.ps1's rebuilt_map: the map the show pins in shows.json, never the newest calibration
        const pinned = FILES[checked.file]?.show?.calibration?.pixelmap;
        baked = { map: typeof pinned === 'string' ? pinned.replace(/^.*\//, '') : null, file: checked.file };
      }
      const changed = HOLD[action] ? "fixture mode: nothing on bitcube was changed; only this scenario's world (in memory)" : 'fixture mode: nothing was changed';
      // a switch's or boot-file change's answer carries the boot file as probe.ps1's reading does (it reads boot-file.txt back)
      return { ok: true, fixture: true, action, body: checked, note: changed, ...(action === 'rebuild' ? { rebuilt: true, saved: true, switched: true, rebuilt_map: baked.map } : {}),
               ...(action === 'bootfile' || action === 'switch' ? { boot_file: w.boot_file } : {}) };
    }, { clock: () => this.clock(scenario), running, source, requestId, awaits: (r) => awaitsReading(action, r, checked),
         onConfirmed: () => { if (baked) w.rebuilt = { at: this.now(), ...baked }; } });
  }

  /** POST /api/control/check in fixture mode: nothing to poll, so only the log line. */
  async check() {
    this.#log('check', {});
    return { ok: true, fixture: true, action: 'check', at: this.now(), note: 'fixture mode: nothing was checked' };
  }

  /** GET /api/calibration: the scripted run's progress file, or { running: false, none: true } (calibrate.ps1 -Action status). */
  calibration(scenario) { return this.calibFor(scenario).status(); }

  /** POST /api/control/calibrate: the scripted run, refused for the reasons the real one would give in this scenario
   *  (bitcube offline, TouchDesigner not answering, the gallery camera unreachable). outcome: 'ok' | 'drift' | 'decode'. */
  async calibrate(action, body = {}, { scenario, outcome = 'ok', source = 'mission control', requestId = null } = {}) {
    const args = checkedCalibrate(action, body);   // the live whitelist, so a page sending bad arguments fails here exactly as it would live
    try { this.snapshot(scenario); } catch { /* a half-edited scenario */ }    // a switch whose restart is over is confirmed first
    this.#log('calibrate', args);
    const calib = this.calibFor(scenario);
    if (action === 'cancel') return calib.cancel();
    if (action === 'status') return calib.status();
    if (action !== 'start') throw Object.assign(new Error('action is start, cancel or status'), { status: 400 });
    let probe; try { probe = this.snapshot(scenario).probe; } catch { probe = null; }
    const testing = testBlocked('calibrate', args, probe);
    if (testing) throw testing;
    // a start waits for a switch, rebuild or boot-file change in flight in this world (409), as live
    return this.worldFor(scenario).applying.run('calibrate', args, async () => this.#startCalibration(scenario, args, outcome),
                                                { clock: () => this.clock(scenario), source, requestId });
  }

  #startCalibration(scenario, args, outcome) {
    const calib = this.calibFor(scenario);
    const [, f] = this.#scenario(scenario);
    const st = f.status ?? {}, pr = st.probe?.value, td = pr?.td;
    const refuse = (error) => ({ ok: false, error, calibration: calib.status() });
    if (st.bitcube?.value?.online === false) return refuse("bitcube is offline: calibration can't start");
    if (args.dry_run !== true) {     // as planCalibrate: only a real true is a dry run
      if (!pr) return refuse("bitcube hasn't been checked yet: calibration can't start");
      if (!td || td.ok === false || typeof td.file !== 'string') return refuse("TouchDesigner isn't answering: calibration can't start");
      if (pr.devices?.gallery_cam === false) return refuse("The gallery camera isn't reachable: calibration can't start");
    }
    return calib.start({ dry_run: args.dry_run === true, cam: args.cam ?? 'gallery', decode_only: args.decode_only || null, outcome });
  }

  #log(action, body) {
    mkdirSync(this.stateDir, { recursive: true });
    appendFileSync(join(this.stateDir, 'controls.log'), JSON.stringify({ t: this.now(), action, body }) + '\n');
  }

  /** What the lights are being sent right now, synthesised from the scenario's seasons state (renderLights) and wrapped in
   *  the frames shape lib/lights.mjs documents, so a page reads one shape in both modes. */
  lights(name) {
    const [, f] = this.#scenario(name);
    const st = f.status ?? {};
    const no = (why) => Object.assign(new Error(why), { status: 503 });
    if (st.bitcube?.value?.online === false) throw no('bitcube is offline: no frames');
    const pr = st.probe?.value, td = pr?.td;
    if (!pr) throw no('not checked yet: no frames until the full check of bitcube answers');
    if (!td || td.ok === false || typeof td.file !== 'string') throw no("TouchDesigner isn't answering: no frames");
    const year = st.seasons?.value ?? td.seasons ?? null;
    const test = this.worldFor(name).test === true;       // the test pattern this world turned on (control 'test')
    const r = renderLights({ at: this.now(), source: test ? 'test' : td.ropes?.source === 'black' ? 'black' : 'canvas', weights: year?.weights ?? null,
                             intensity: typeof year?.intensity === 'number' ? year.intensity : 0.5, look: td.river_cam?.fresh ? 'live' : 'rain', fps: td.fps ?? null });
    const hub = td.hub75 && typeof td.hub75 === 'object' ? td.hub75 : {};
    const panelBrightness = typeof hub.brightness === 'number' ? hub.brightness : 1;
    const watts = Array.isArray(td.ropes?.status?.watts) ? td.ropes.status.watts : null;
    return { ok: true, action: 'frames', file: td.file, fps: td.fps ?? null, synthetic: true, age_s: 0,
             frames: { at: r.at / 1000, source: r.source, brightness: panelBrightness,
                       ropes: { ...r.ropes, source: r.source, brightness: 0.4, watts },
                       panels: { ...r.panels, source: test ? 'test' : 'canvas', brightness: panelBrightness, output: hub.output !== false, atlas: [256, 512] },
                       ...(r.screens ? { screens: r.screens } : { screens: { error: 'the panels show a test pattern' } }) } };
  }

  #scenario(name) {
    const n = this.active(name);
    if (!n) throw Object.assign(new Error('fixture mode: no scenario files yet'), { status: 503 });
    return [n, this.#read(n)];
  }

  #read(name) {
    try { return JSON.parse(readFileSync(join(this.dir, `${name}.json`), 'utf8')); }
    catch (e) { throw Object.assign(new Error(`fixture ${name}.json: ${e.message}`), { status: e.code === 'ENOENT' ? 404 : 500 }); }
  }
}

// The looks: deep, mid and light colours per season (GLOSSARY.md), the live river at night (infrared) and the rain fallback.
const LOOKS = {
  winter: [[6, 14, 36], [110, 150, 205], [235, 242, 255]],
  spring: [[4, 36, 30], [36, 150, 118], [180, 235, 205]],
  summer: [[52, 26, 2], [224, 150, 28], [255, 232, 160]],
  autumn: [[38, 12, 4], [182, 78, 26], [236, 176, 96]],
  live: [[8, 10, 14], [118, 128, 140], [222, 226, 230]],
  rain: [[6, 10, 22], [66, 90, 124], [168, 186, 214]],
};
/** One frame for the lights: slow water flowing along each rope and across the panels, in the season's colours (blended
 *  by weight), brighter and faster with intensity; a slow TouchDesigner (fps under 30) moves in quarter-second steps. */
export function renderLights({ at, source = 'canvas', weights = null, intensity = 0.5, look = 'rain', fps = null }) {
  if (source === 'test') return renderTest(at);
  const ws = weights ? Object.entries(weights).filter(([k, v]) => LOOKS[k] && v > 0) : [];
  const total = ws.reduce((s, [, v]) => s + v, 0);
  const pal = total > 0 ? [0, 1, 2].map((i) => [0, 1, 2].map((j) => ws.reduce((s, [k, v]) => s + LOOKS[k][i][j] * v / total, 0))) : LOOKS[look] ?? LOOKS.rain;
  const gain = 0.35 + 0.65 * Math.min(1, Math.max(0, intensity));
  let t = (at / 1000) * (0.4 + 1.2 * gain);
  if (fps != null && fps < 30) t = Math.floor(t * 4) / 4;
  const put = (buf, o, v) => {
    v = Math.min(1, Math.max(0, v));
    const [a, b, k] = v < 0.5 ? [pal[0], pal[1], v * 2] : [pal[1], pal[2], (v - 0.5) * 2];
    const glint = v > 0.9 ? (v - 0.9) * 600 : 0;
    for (let j = 0; j < 3; j++) buf[o + j] = Math.max(0, Math.min(255, Math.round((a[j] + (b[j] - a[j]) * k) * gain + glint)));
  };
  const ropes = Buffer.alloc(20 * 400 * 3);
  if (source !== 'black') for (let led = 0; led < 400; led++) for (let r = 0; r < 20; r++) {
    const u = led / 400;
    put(ropes, (led * 20 + r) * 3, 0.5 + 0.25 * Math.sin(u * 18 + t * 1.7 + r * 0.9) + 0.15 * Math.sin(u * 41 - t * 2.3 + r * 2.1) + 0.1 * Math.sin(u * 7 + t * 0.7 + r * 0.3));
  }
  // the four screens upright as seen (32 × 64 each after the 4× downsample, side by side), and the Gray Area atlas made
  // from them the way screens.py and the receive card stack them (public/screens.js), so both of the page's paths draw
  const screens = Buffer.alloc(128 * 64 * 3);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    const X = (x % 32) / 32, Y = y / 64, q = Math.floor(x / 32);
    put(screens, (y * 128 + x) * 3, 0.5 + 0.25 * Math.sin(Y * 6 + t * 1.3 + X * 2 + q) + 0.15 * Math.sin(Y * 15 - t * 2.1 + X * 5) + 0.1 * Math.sin(X * 9 + t + q * 1.7));
  }
  const atlas = atlasFromUprights(screens, 128, 64);
  return { at, source, ropes: { w: 20, h: 400, rgb: ropes.toString('base64') }, panels: { w: atlas.w, h: atlas.h, rgb: Buffer.from(atlas.bytes).toString('base64') },
           screens: { w: 128, h: 64, cells: 4, rgb: screens.toString('base64') } };
}

// The test pattern as TouchDesigner sends it: td/ropes/artnet_out.py test_frame (red, green, blue, white wiping down from the plug
// end, one every 3 s) and td/panels/panel_test.glsl on each quad of the Gray Area atlas (quads stacked, quad k at rows 128(k-1)),
// 4x downsampled. No screens part: td_mission.py sends an error for it while the panels show a test pattern.
const TEST_COLOURS = [[0.6, 0, 0], [0, 0.6, 0], [0, 0, 0.6], [0.2, 0.2, 0.2]];
const PANEL_TEST = [[1, 0, 0], [0, 1, 0], [0, 0.3, 1], [1, 0.8, 0]];
export function testRope(t, pixels = 400) {
  const phase = Math.max(0, t) / 3, k = Math.floor(phase) % 4, edge = Math.floor((phase % 1) * pixels);
  return (led) => TEST_COLOURS[led < edge ? k : (k + 3) % 4];
}
/** panel_test.glsl at one pixel of a 256x128 quad (top-left origin): [r, g, b] 0..1. */
export function panelTestPixel(quad, x, y) {
  const cx = Math.floor(x / 128), cy = Math.floor(y / 64), ix = x - cx * 128, iy = y - cy * 64, panel = cx + 2 * cy;
  if (ix < 1 || iy < 1 || ix > 126 || iy > 62) return [1, 1, 1];
  if (panel === 0 && iy >= 8 && iy < 18 && ix >= 8) { const i = Math.floor((ix - 8) / 16); if (i < quad && (ix - 8) % 16 < 10) return [1, 1, 1]; }
  return PANEL_TEST[panel].map((v) => v * 0.35);
}
function renderTest(at) {
  const ropes = Buffer.alloc(20 * 400 * 3), colour = testRope(at / 1000);
  for (let led = 0; led < 400; led++) { const c = colour(led); for (let r = 0; r < 20; r++) for (let j = 0; j < 3; j++) ropes[(led * 20 + r) * 3 + j] = Math.round(c[j] * 255); }
  const w = 64, h = 128, panels = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = panelTestPixel(Math.floor(y / 32) + 1, x * 4 + 2, (y % 32) * 4 + 2);
    for (let j = 0; j < 3; j++) panels[(y * w + x) * 3 + j] = Math.round(c[j] * 255);
  }
  return { at, source: 'test', ropes: { w: 20, h: 400, rgb: ropes.toString('base64') }, panels: { w, h, rgb: panels.toString('base64') } };
}

function svgStill(cam) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#2b2b2f"/>` +
    `<text x="480" y="270" fill="#9a9aa2" font-family="system-ui, sans-serif" font-size="30" text-anchor="middle" dominant-baseline="middle">${cam} camera: placeholder still</text></svg>`;
}

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const EPOCH_S = /^(next_tick_epoch|t)$/;             // Modal's next tick, a seasons history point (seconds)
const FRAME_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z/;   // a Modal frame id starts with its UTC issue time
/** A frame id's issue time moved by delta ms ("2026-10-23T09-57-25Z-7f3a"), the rest of the id kept. */
function shiftFrameId(s, delta) {
  const m = FRAME_AT.exec(s), t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + delta;
  return new Date(t).toISOString().slice(0, 19).replace(/:/g, '-') + 'Z' + s.slice(m[0].length);
}

/** Move every timestamp in a fixture source forward by delta ms: `at` (ms), epoch seconds, ISO strings (keeping their zone). */
export function rebase(v, delta) {
  if (!delta) return v;
  const walk = (x, key) => {
    if (Array.isArray(x)) return x.map((e) => walk(e, key));
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, e]) => [k, walk(e, k)]));
    if (typeof x === 'number') {
      if (key === 'at') return x + delta;
      if (EPOCH_S.test(key) && x > 1e9) return Math.round(x + delta / 1000);
      return x;
    }
    if (typeof x === 'string' && key === 'last') return shiftLogLine(x, delta);
    if (typeof x === 'string' && ISO.test(x)) return shiftIso(x, delta);
    if (typeof x === 'string' && FRAME_AT.test(x)) return shiftFrameId(x, delta);
    return x;
  };
  return walk(v, '');
}

/** A log line's clock ("02:58:31 INFO ..." or "2026-10-23 02:05:41 done", bitcube's local time) moves with the probe's `time`
 *  stamp (an ISO string, shifted above), so the ages the model reads from them (its lineAge) stay what the scenario meant:
 *  a clip "15 minutes before the check" is 15 minutes old whenever the page is opened, not hours old by the evening. */
function shiftLogLine(s, delta) {
  const p = (n) => String(n).padStart(2, '0');
  const t = /^(\d{2}):(\d{2}):(\d{2})([\s\S]*)$/.exec(s);
  if (t) {
    const tod = ((+t[1] * 3600 + +t[2] * 60 + +t[3] + Math.round(delta / 1000)) % 86400 + 86400) % 86400;
    return `${p(Math.floor(tod / 3600))}:${p(Math.floor(tod / 60) % 60)}:${p(tod % 60)}${t[4]}`;
  }
  const d = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})([\s\S]*)$/.exec(s);
  if (d) return shiftIso(`${d[1]}T${d[2]}`, delta).replace('T', ' ') + d[3];
  return s;
}

function shiftIso(s, delta) {
  const m = s.match(ISO);
  const zone = m[4] ?? '';
  const offMin = zone === '' ? -new Date(s).getTimezoneOffset() : zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const t = new Date(s + (zone === '' ? '' : '')).getTime();     // Date parses the zone (or local time when there is none)
  if (!Number.isFinite(t)) return s;
  const local = new Date(t + delta + offMin * 60_000);           // wall-clock digits in the original zone
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}${m[3] ?? ''}${zone}`;
}

// ---- the scripted calibration run -------------------------------------------------------------------------------
// The progress file tools/mission/calibrate.py writes (shape in lib/lights.mjs), produced by a timetable instead of lights,
// a camera and subprocesses: the same stages, fields and wording, about 60 s long (durationS) in the real stages' proportions.
const N_PATTERNS = 29;                                   // graycode.patterns(): black, then 14 bits with their inverses
const N_ROPES = 20;
const REAL_S = { 'ropes-capture': 170, 'ropes-decode': 40, 'hub75-capture': 35, 'hub75-locate': 10 };   // calibrate.py EXPECTED_S
const BEFORE = { Active: true, Source: 'canvas', Brightness: 0.4, Graybit: 0, Grayinvert: false, Panels: 'canvas', Maxbrightness: 0.4 };
const PATTERN_NAMES = ['black', ...Array.from({ length: 14 }, (_, b) => [`b${String(b).padStart(2, '0')}`, `b${String(b).padStart(2, '0')}n`]).flat()];
export const CALIBRATION_OUTCOMES = ['ok', 'drift', 'decode'];
export const DRIFT_ERROR = 'The camera moved during the run (drift 48): the map was not saved. Fix the camera and run again';
// calibrate.py's real shape: `error` the raw text (the step id, the exit code, the log tail), `reason` the team's words
export const DECODE_ERROR = 'ropes-decode failed (exit 1): rope  6: visible 162  filled 400 | Traceback (most recent call last): | ValueError: rope 7 has no usable patterns';
export const DECODE_REASON = "Working out where each rope is failed: the patterns couldn't be read from the pictures (someone in view, or light in the room); run it again when the room is dark and empty";
const clockOf = (s) => { const d = new Date(s * 1000); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

/** calibrate.py's result block for a map (summarize_map), from the map as lib/lights.mjs reads it. */
export function mapResult(map, { dryRun = false } = {}) {
  const s = summarizePixelmap(map);
  if (!s) return null;
  return { map: s.file, date: s.date, points: s.points, seen: s.seen, ropes_found: s.ropes_found, ropes_dark: s.ropes_dark, drift_px: s.drift_px,
           hub75_quads: s.hub75_quads, camera: s.camera, frame_size: s.frame_size, capture: map.meta?.capture ?? null, ...(dryRun ? { dry_run: true } : {}) };
}

export class FixtureCalibration {
  constructor({ now = () => Date.now(), durationS = 60, map = () => null, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { now, durationS, map, setTimer, clearTimer });
    this.p = null;           // the progress file (what calibrate.ps1 -Action status prints)
    this.timer = null;
    this.steps = [];         // [{ at (s from start), apply(p) }], the timetable
    this.log = [];
    this.pid = 4000 + Math.floor(Math.random() * 1000);
  }

  /** calibrate.ps1 -Action status */
  status() { return this.p ? { ...this.p, alive: this.p.running } : { running: false, none: true }; }

  /** probe.ps1's `calibration`: the progress file while it is from the last 24 h, with alive. */
  probeView() {
    if (!this.p || this.now() / 1000 - this.p.updated > 24 * 3600) return null;
    return { ...this.p, alive: this.p.running };
  }

  start({ dry_run = false, cam = 'gallery', decode_only = null, outcome = 'ok' } = {}) {
    if (this.p?.running) return { ok: false, error: 'a calibration is already running', calibration: this.status() };
    const t0 = this.now() / 1000;
    this.log = [];
    const stages = ['ropes-capture', 'ropes-decode', 'hub75-capture', 'hub75-locate'];
    this.p = { running: true, pid: this.pid, mode: dry_run ? 'dry-run' : decode_only ? 'decode-only' : 'full', stage: null, stage_index: -1, stages: [...stages, 'done'],
               step: 0, of: 0, pass: null, retakes: 0, expected_s: null, started: round3(t0), updated: round3(t0), elapsed_s: 0, message: 'starting',
               log: [], ok: null, error: null, reason: null, cancelled: false, dry_run, decode_only, cam, brightness_cap: 0.4, max_drift: 30,
               before: null, restored: null, capture: null, hub75_capture: null, capture_info: null, result: null };
    this.steps = this.#timetable({ dry_run, outcome, t0 });
    this.#write();
    this.#schedule();
    return { ok: true, started: true, pid: this.pid, log: `C:\\Users\\user\\River\\logs\\calibrate-${stamp(t0)}.log`, calibration: this.status() };
  }

  /** calibrate.ps1 -Action cancel: the job stops its child and restores the ropes itself (never forced here). */
  cancel() {
    if (!this.p?.running) return { ok: true, cancelled: false, forced: false, note: 'nothing is running', calibration: this.p ? this.status() : null };
    this.#stopTimer();
    this.#note('child stopped');
    const restored = this.p.dry_run ? null : true;
    if (restored) this.#note('restored ropes and panels: ' + "r=op('/project1/ropes'); r.par.Active=True; r.par.Source='canvas'; r.par.Brightness=0.4; r.par.Graybit=0; r.par.Grayinvert=False; op('/project1/panels').par.Source='canvas'");
    this.#write({ running: false, ok: false, cancelled: true, error: 'cancelled', message: 'cancelled', result: null, restored });
    return { ok: true, cancelled: true, forced: false, calibration: this.status() };
  }

  stop() { this.#stopTimer(); }

  #stopTimer() { if (this.timer) { this.clearTimer(this.timer); this.timer = null; } }

  #schedule() {
    this.#stopTimer();
    const next = this.steps[0];
    if (!next || !this.p?.running) return;
    const delay = Math.max(0, (this.p.started + next.at) * 1000 - this.now());
    this.timer = this.setTimer(() => { this.timer = null; this.#tick(); }, delay);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  #tick() {
    if (!this.p?.running) return;
    // every step whose time has come (a timer can fire late; a test clock can jump)
    while (this.steps.length && (this.p.started + this.steps[0].at) * 1000 <= this.now() + 1) {
      const step = this.steps.shift();
      const changes = step.apply(this.p) ?? {};
      this.#write(changes);
      if (!this.p.running) { this.steps = []; break; }
    }
    this.#schedule();
  }

  #note(line) { this.log.push(String(line).slice(0, 300)); }

  #write(changes = {}) {
    const p = this.p;
    Object.assign(p, changes);
    p.updated = round3(this.now() / 1000);
    p.elapsed_s = Math.round((p.updated - p.started) * 10) / 10;
    p.log = this.log.slice(-40);
  }

  /** The timetable: [{ at, apply }], the same stage order, fields and stdout lines as calibrate.py reports. */
  #timetable({ dry_run, outcome, t0 }) {
    const k = this.durationS / Object.values(REAL_S).reduce((a, b) => a + b, 0);     // 60 s for the real 255 s
    const T = Object.fromEntries(Object.entries(REAL_S).map(([s, v]) => [s, Math.round(v * k * 10) / 10]));
    const steps = [];
    const add = (at, apply) => steps.push({ at: Math.round(at * 100) / 100, apply });
    const note = (line) => this.#note(line);
    let t = 0;
    const stageStart = (stage, i, of) => add(t, () => ({ stage, stage_index: i, step: 0, of, pass: null, expected_s: T[stage], message: `${stage} started` }));    // the scripted dry run takes as long as the full one
    const map = this.map();
    const drift = outcome === 'drift' ? 48.3 : map?.meta?.drift ?? 10.23;

    // ropes-capture: two passes of 29 patterns, one retake, the end black frame that measures the drift
    stageStart('ropes-capture', 0, dry_run ? 2 : N_PATTERNS);
    if (dry_run) {
      add(t + T['ropes-capture'] * 0.5, () => ({ step: 1, message: 'pass A done' }));
      add(t + T['ropes-capture'], () => ({ step: 2, message: 'pass B done' }));
      t += T['ropes-capture'];
    } else {
      const per = (T['ropes-capture'] - 1.2) / (2 * N_PATTERNS + 3);
      add(t + 0.2, () => { note('$ python tools/pixelmap/capture.py ropes --cam gallery --brightness 0.4'); note(`before: ${pyDict(BEFORE)}`); return { before: BEFORE }; });
      add(t + 0.6, () => { const l = `settle 1.75 s, start ${clockOf(this.now() / 1000)}`; note(l); return { message: l }; });
      let at = t + 1.2;
      for (const pass of ['A', 'B']) {
        for (let i = 1; i <= N_PATTERNS; i++) {
          add(at, () => { const l = `pass ${pass}: pattern ${i} of ${N_PATTERNS} (${PATTERN_NAMES[i - 1]})`; note(l); return { step: i, of: N_PATTERNS, pass, message: l }; });
          at += per;
        }
        add(at, () => { const l = `pass ${pass} done ${clockOf(this.now() / 1000)}`; note(l); return { step: N_PATTERNS, message: l }; });
      }
      add(at + per, () => { const l = '  b04n: retaken, 3 takes, best disagreement 0.012'; note(l); return { retakes: 1, message: l }; });
      add(at + 2 * per, (p) => {
        const info = { mode: 'ropes', camera: 'gallery', frame_size: [1440, 808], settle: 1.75, brightness_cap: 0.4, drift: Math.round(drift * 100) / 100, lit_camera_px: 31677 };
        note(JSON.stringify(info));
        const folder = `C:\\Users\\user\\River\\river-bitcube\\frames\\pixelmap-${stamp(p.started)}`;
        note(`OUT ${folder}`);
        return { capture_info: { mode: 'ropes', drift: info.drift, lit_camera_px: info.lit_camera_px, settle: 1.75, brightness_cap: 0.4 }, capture: `pixelmap-${stamp(p.started)}`, restored: true, message: 'ropes captured' };
      });
      t = at + 3 * per;
      if (outcome === 'drift') {
        add(t, () => ({ running: false, ok: false, error: DRIFT_ERROR, reason: DRIFT_ERROR, message: DRIFT_ERROR, result: null }));
        return steps;
      }
    }

    // ropes-decode: one line per rope
    stageStart('ropes-decode', 1, N_ROPES);
    const ropes = map?.ropes ?? {};
    const perRope = T['ropes-decode'] / (N_ROPES + 1);
    add(t + perRope * 0.5, () => { note(`$ python tools/pixelmap/decode.py frames/pixelmap-${stamp(t0)}`); note('decoded camera px: 28893  rope px with a position: 7466'); return { message: 'decoded camera px: 28893  rope px with a position: 7466' }; });
    for (let r = 1; r <= N_ROPES; r++) {
      const failHere = outcome === 'decode' && r === 7;
      add(t + perRope * r, () => {
        if (failHere) { note('Traceback (most recent call last):'); note('ValueError: rope 7 has no usable patterns'); return { running: false, ok: false, error: DECODE_ERROR, reason: DECODE_REASON, message: DECODE_ERROR, result: null, restored: dry_run ? null : true }; }
        const s = ropes[String(r - 1)];
        const l = `rope ${String(r).padStart(2)}: ` + (s && s.visible > 0 ? `visible ${String(s.visible).padStart(3)}  filled ${String(s.filled).padStart(3)}` : 'not seen');
        note(l);
        return { step: r, message: l };
      });
    }
    t += T['ropes-decode'];
    if (outcome === 'decode') return steps;
    add(t, () => { const name = map?.file ?? 'pixelmap-2026-10-23.json'; note(`wrote tools/pixelmap/${name} and frames/pixelmap-${stamp(t0)}/overlay.png`); return { step: N_ROPES, message: `map written: ${name}` }; });

    // hub75-capture, hub75-locate
    t += 0.3;
    stageStart('hub75-capture', 2, 1);
    if (dry_run) add(t + T['hub75-capture'], () => ({ step: 1, message: 'panels captured' }));
    else {
      add(t + T['hub75-capture'] * 0.3, () => { note('$ python tools/pixelmap/capture.py hub75 --cam gallery --brightness 0.4'); note(`before: ${pyDict(BEFORE)}`); return { before: BEFORE, message: 'settle 1.75 s' }; });
      add(t + T['hub75-capture'], (p) => { note(`OUT C:\\Users\\user\\River\\river-bitcube\\frames\\hub75-${stamp(p.started)}`); return { step: 1, hub75_capture: `hub75-${stamp(p.started)}`, restored: true, capture_info: { mode: 'hub75', drift: 0.8, lit_camera_px: 9129, settle: 1.75, brightness_cap: 0.4 }, message: 'panels captured' }; });
    }
    t += T['hub75-capture'] + 0.3;
    stageStart('hub75-locate', 3, 1);
    add(t + T['hub75-locate'], () => { const name = map?.file ?? 'pixelmap-2026-10-23.json'; note(`wrote hub75_quad1 into tools/pixelmap/${name}`); return { step: 1, message: 'HUB75 quad 1 located' }; });
    t += T['hub75-locate'] + 0.2;
    add(t, () => ({ running: false, ok: true, stage: 'done', stage_index: 4, step: 1, of: 1, pass: null, message: 'calibration done',
                    result: map ? mapResult(map, { dryRun: dry_run }) : null, restored: dry_run ? null : true }));
    return steps;
  }
}

const round3 = (x) => Math.round(x * 1000) / 1000;
function stamp(s) { const d = new Date(s * 1000); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
/** A dict the way Python prints it (capture.py's 'before:' line). */
function pyDict(o) { return '{' + Object.entries(o).map(([k, v]) => `'${k}': ${typeof v === 'string' ? `'${v}'` : typeof v === 'boolean' ? (v ? 'True' : 'False') : v}`).join(', ') + '}'; }
