#!/usr/bin/env node
// Writes the fixture scenarios in this folder: `node build.mjs` rewrites every <name>.json from the data below.
// The scenarios are authored here (what is true in the world, and the exact payload a correct server would
// produce for it); the helpers only keep the derived numbers consistent (age_s from at, season weights from
// the phase, log-line timestamps, history points). README.md explains the format and each scenario.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureModalInput, fixtureModalFeed } from '../../lib/fixtures.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
// The remembered river (docs/remembered-river.md): _shows.extra.json adds it until it is in the real shows.json.
export const REMEMBERED_FILE = 'river-remembered.toe';
export const REMEMBERED_ENTRY = {
  file: REMEMBERED_FILE, title: 'The remembered river', label: 'the remembered river', kind: 'viz', offered: true, build: 'td/build/build_remembered.py',
  calibration: { pixelmap: 'tools/pixelmap/pixelmap-2026-10-23.json', screens: 'tools/pixelmap/screens-2026-10-23.json' },
  description: "The column relives one real day from Dry Creek's past every five minutes, chosen by Dave's agent: its rain, how high the river ran, night and day, with one surge of full light at its heaviest rain. The pool on the floor breathes; people standing still close by slow the light near them.",
  inputs: ["Dave's agent (remembered day, palette, knobs, heard)", 'river camera (recorded clip as fallback)', 'gallery camera (people counter)'],
  created_by: 'gavin', created: '2026-10-27', updated_by: 'gavin', updated: '2026-10-27', last_change: 'Fixture entry until the show is in shows.json',
};
const RECORDED = join(DIR, '_recorded-2026-10-23.json');
const recorded = JSON.parse(readFileSync(RECORDED, 'utf8'));

// The moment every fixture is "taken": 2026-10-23 02:59:00 PDT (09:59:00Z), two seconds after the real recording.
export const NOW = 1792749540000;
const S = 1000;

const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const SEASONS_FILE = 'river-local-oct-22-seasons.toe';
const ONLINE_FILE = 'river-online-oct-23.toe';            // the current online file (23 Oct: four screens, the 23 Oct rope map)
const SHOW_FILES = [SEASONS_FILE, ONLINE_FILE];             // what probe.ps1 offers; retired files are old-… (D27)
// A test visualization (kind viz), added on top of the repo's shows.json by _shows.extra.json, which the fixture server and the
// tests read (model.js registryPaths; test/run.mjs). Never in the real shows.json.
export const VIZ_FILE = 'river-fixture-fireflies.toe';
const TEMPLATE_FILE = 'river-baseline-template.toe';
export const VIZ_ENTRY = {
  file: VIZ_FILE, title: 'Fireflies (test viz)', kind: 'viz', offered: true, build: 'td/build/build_baseline.py',
  calibration: { pixelmap: 'tools/pixelmap/pixelmap-2026-10-23.json', screens: 'tools/pixelmap/screens-2026-10-23.json' },
  description: 'A fixture only: points of light drift up the ropes and gather where people stand, and the screens show the river slowed right down.',
  inputs: ['river camera (recorded clip as fallback)', 'gallery camera'],
  created_by: 'will', created: '2026-10-26', updated_by: 'will', updated: '2026-10-26', last_change: 'Slower drift; fewer lights at once',
};
// The Modal input show (docs/modal-inputs.md): _shows.extra.json adds it on top of the real entry (later entries win in model.js FILES)
// as offered, with a short label, so the fixtures read it as a listed show (the real entry was still offered: false on 27 Oct). Its status (td.modal_input) comes from lib/fixtures.mjs fixtureModalInput, the same data a
// world switched to it in fixture mode reports.
export const MODAL_FILE = 'river-combined-modal-inputs.toe';
export const MODAL_ENTRY = {
  file: MODAL_FILE, title: 'Combined with Modal Input Selector', label: 'the Modal input show', kind: 'viz', offered: true, build: 'td/build/build_combined_modal_inputs.py',
  calibration: { pixelmap: 'tools/pixelmap/pixelmap-2026-10-23.json', screens: 'tools/pixelmap/screens-2026-10-23.json' },
  description: "Combined v0 with a Modal input selector: one of Dave's inputs at a time (his moving picture, his scene's colours and pace, or his own pictures for each screen and the ropes) drives the river, at a strength chosen in mission control.",
  inputs: ['river camera (recorded clip as fallback)', "Dave's Modal canvas, scene and frames"],
  created_by: 'gavin', created: '2026-10-27', updated_by: 'gavin', updated: '2026-10-27', last_change: 'Fixture entry until the show is in shows.json',
};
// The filling glass (docs/mission-ui.md "Filling glass dials"): the real entry is offered: false (27 Oct, a first sample); the
// fixtures' entry is offered, so a fixture running it reads as a listed show (later entries win in model.js FILES).
export const FILLING_FILE = 'river-filling.toe';
export const FILLING_ENTRY = {
  file: FILLING_FILE, title: 'The filling glass', label: 'the filling glass', kind: 'viz', offered: true, build: 'td/build/build_filling.py',
  calibration: { pixelmap: 'tools/pixelmap/pixelmap-2026-10-27.json', screens: 'tools/pixelmap/screens-2026-10-27.json', zones: null },
  description: 'Every rope and every screen is one canvas, painted by where each LED really is in the room. Water rises from the floor to the top like a glass filling, turbulent and sloshing, then drains all the way out and fills again (about 84 seconds a cycle).',
  inputs: ['the LED map and screens (calibration, measured tilts)'],
  created_by: 'Gavin (session A)', created: '2026-10-27', updated_by: 'Gavin (session A)', updated: '2026-10-27', last_change: 'Fixture entry, offered, until the real one is',
};
// The river (all looks) (docs/mission-ui.md "Looks"): one show file, several looks faded between; _shows.extra.json adds it until
// its real shows.json entry is pushed.
export const LOOKS_FILE = 'river-looks.toe';
export const LOOKS_ENTRY = {
  file: LOOKS_FILE, title: 'The river (all looks)', label: 'the river (all looks)', kind: 'viz', offered: true, build: 'td/build/build_looks.py',
  calibration: { pixelmap: 'tools/pixelmap/pixelmap-2026-10-27.json', screens: 'tools/pixelmap/screens-2026-10-27.json', zones: null },
  description: 'One show file with several looks: the remembered river, Fill my cup (simple) and Fill my cup (configurable). It fades between them without restarting TouchDesigner: on Auto, four loops of the remembered river, then one full cycle of Fill my cup (simple), again; on Manual, the chosen look stays.',
  inputs: ["Dave's agent (remembered day, palette, knobs, heard)", 'river camera (recorded clip as fallback)', 'gallery camera (people counter)', 'the LED map and screens (calibration, measured tilts)'],
  created_by: 'gavin', created: '2026-10-28', updated_by: 'gavin', updated: '2026-10-28', last_change: 'Fixture entry until the show is in shows.json',
};
const RULES = recorded.seasons.value.rules;            // the defaults, as served by the control page
const ADDRESSES = recorded.probe.value.addresses;      // bitcube's addresses at Gray Area
const SCENE_COLORS = recorded.modal.value.scene.colors;

// ---- time helpers (bitcube and the mini are both on Pacific time) -------------------------------------------
const la = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
const localIso = (ms) => la(ms).replace(' ', 'T');                       // probe.ps1: (Get-Date).ToString('s')
const hms = (ms) => la(ms).slice(11);                                     // capture.py / sync.py log lines (%H:%M:%S)
const ymdhms = (ms) => la(ms);                                            // record.py log lines
const isoUtc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00');   // Dave's finished_at
const isoPdt = (ms) => localIso(ms) + '-07:00';                                     // Dave's set_at
const utcStamp = (ms) => new Date(ms).toISOString().replace(/[:.]/g, '-');          // media file names

// ---- mission.mjs: one source = { at, value | error, age_s } --------------------------------------------------
const src = (at, value) => ({ at, value, age_s: Math.round((NOW - at) / S) });
const err = (at, error) => ({ at, error, age_s: Math.round((NOW - at) / S) });

// ---- td/seasons/seasons.py: weights, names, intensities -----------------------------------------------------
const wrap = (p) => ((p % 4) + 4) % 4;
const ahead = (a, b) => wrap(b - a);
function weights(phase) {
  const w = [];
  for (let k = 0; k < 4; k++) { const d = Math.min(ahead(k, phase), ahead(phase, k)); w.push(d < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * d) : 0); }
  const s = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / s);
}
const SEASON_INTENSITY = [0.05, 0.45, 0.85, 0.35];
const blend = (phase) => weights(phase).reduce((a, w, k) => a + w * SEASON_INTENSITY[k], 0);
const seasonName = (phase) => SEASONS[Math.round(wrap(phase)) % 4];
const r3 = (x) => Math.round(x * 1000) / 1000, r4 = (x) => Math.round(x * 10000) / 10000;
const PRESENCE_NONE = { available: false, now: 0, usual: 0.75, relative: 0, empty_for_s: 0 };   // no people counter yet
const MANUAL_DEFAULT = { season: 'summer', intensity: 0.5 };

/** Year.state() (what td.seasons holds, and the first part of the control page's /state). */
function yearState({ mode = 'automatic', phase, intensity, target = null, manual = MANUAL_DEFAULT, presence = PRESENCE_NONE }) {
  const w = weights(phase);
  return { mode, effective_mode: mode, phase: r4(phase), season: seasonName(phase),
           weights: Object.fromEntries(SEASONS.map((s, k) => [s, r3(w[k])])), intensity: r3(intensity ?? blend(phase)),
           target, manual, presence };
}
/** seasons_td.snapshot(): the control page's /state. */
const seasonsState = (year, history) => ({ ...year, counter_available: false, rules: RULES, history, file: SEASONS_FILE });
/** Six history points, 10 s apart, ending at endT (unix seconds), with the year turning in automatic mode. */
function autoHistory(endT, phaseNow, n = 6) {
  return Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i, ph = wrap(phaseNow - back * 10 * 4 / 240);
    return { t: endT - back * 10, phase: r3(ph), intensity: r3(blend(ph)), now: 0, usual: 0.75, relative: 0 };
  });
}

// ---- the all-good world ----------------------------------------------------------------------------------------
const BITCUBE_AT = NOW - 4 * S;       // pollFast every 5 s
const SEASONS_AT = NOW - 4 * S;
const MODAL_AT = NOW - 9 * S;         // pollModal every 30 s
const PROBE_AT = NOW - 20 * S;        // pollProbe every 60 s: the mini got this answer 20 s ago
const T0 = PROBE_AT - 8 * S;          // ...and the probe started 8 s before that (its `time`, log ages, device checks)
const PHASE_GOOD = 1.12;              // a little past the middle of spring
const YEAR_GOOD = yearState({ phase: PHASE_GOOD });
const HISTORY_END = Math.round((SEASONS_AT - 5 * S) / S);
const MODAL_TICK_AT = NOW - 72 * S;   // the 02:55 tick finished at 02:57:48; the next is 03:00:00
const SYNC_AT = T0 - 57 * S;          // sync.py mirrored that tick's status.json

/** artnet_out.status(): the rope sender. Counters live in comp.storage and survive restarts (saved in the .toe). */
const sender = (over = {}) => ({ error: null, sent: 4441370, dropped: null, packets: 80, watts: [182, 191], seq: 137,
                                 active: true, open: true, source: 'canvas', retrying: false, ...over });
/** river_cam.status('river', 'sub'): only in the online file (the seasons file destroys /project1/river_local). */
const relay = (over = {}) => ({ relay: true, frames: 111634, last_frame_age_s: 0.1, fresh: true, error: null,
                                colourfulness: 0.0011, night: true, nightness: 1.0, ...over });   // infrared at 3 am
/** td_mission.py's answer. */
const td = (over = {}) => ({ ok: true, action: 'status', file: SEASONS_FILE, fps: 60.1, cook_rate: 60,
  ropes: { active: true, source: 'canvas', box_watts_cap: 600, status: sender() },
  hub75: { brightness: 1, output: true }, seasons: YEAR_GOOD, river_cam: null, errors: 0, ...over });
/** Lines as probe.ps1 reads them: the last INFO line of each Modal-link log, cut to 120 characters. */
const clip = (loc, ms, kb) => `${hms(ms)} INFO    ${loc}/video -> media/${loc}/video/${utcStamp(ms + 1197)}.mp4 (${kb} KB)`;
const syncLine = (ms, what) => `${hms(ms)} INFO    sync: ${what}`;
const cut120 = (line) => line.slice(0, 120);     // probe.ps1 keeps the first 120 characters of a log line
const logAge = (ms) => Math.round((T0 - ms) / S);
const link = (over = {}) => ({ processes: 8,
  gallery: { log_age_s: 1, last: clip('gallery', T0 - 1 * S, 50) },
  river: { log_age_s: 4, last: clip('river', T0 - 4 * S, 63) },
  sync: { log_age_s: logAge(SYNC_AT), last: syncLine(SYNC_AT, 'updated status.json (611 bytes)') }, ...over });
const DEVICES_GOOD = { internet: true, router: true, gallery_cam: true, river_cam: true, psac10_1: true, psac10_2: true, seasons_page: true };
/** probe.ps1's answer. */
const probeValue = (over = {}) => ({ ok: true, time: localIso(T0), show_files: SHOW_FILES, lights_route: 'direct', td: td(),
  boot_file: SEASONS_FILE, modal_link: link(), recorder: { clips: 14, last: `${ymdhms(NOW - 53 * 60 * S - 19 * S)} done` },
  devices: { ...DEVICES_GOOD }, addresses: ADDRESSES, displays: ['LED 1920X1080'], disk_free_gb: 676, uptime_h: 3.1, ...over });
/** pollModal's value: status.json + state.json from Dave's app. */
const modal = (over = {}) => ({ tick: 4229, mood: 'attentive', ok: true, finished_at: isoUtc(MODAL_TICK_AT),
  next_tick_epoch: Math.round((NOW + 60 * S) / S),
  scene: { animation: 'blooms', palette: 'sandstone-dusk', colors: SCENE_COLORS, speed: 0.28, turbulence: 0.62 },
  set_at: isoPdt(MODAL_TICK_AT - 1 * S), ...over });

const base = () => ({
  bitcube: src(BITCUBE_AT, { online: true }),
  seasons: src(SEASONS_AT, seasonsState(YEAR_GOOD, autoHistory(HISTORY_END, PHASE_GOOD))),
  modal: src(MODAL_AT, modal()),
  probe: src(PROBE_AT, probeValue()),
});
const CAMS_GOOD = { cameras: { gallery: true, river: true }, camera_age_s: { gallery: 25, river: 40 } };

// Per-equipment verdicts shared by the healthy scenarios; each scenario overrides what differs.
const OK_ITEMS = {
  'mission control': 'ok: serving the page',
  bitcube: 'ok: online over Tailscale, up 3.1 h, 676 GB free',
  touchdesigner: 'ok: seasons file at 60 fps, no errors',
  seasons: 'ok: automatic, spring, intensity 0.46; people counter not available (normal)',
  ropes: 'ok: showing the river, sender open, 182 + 191 W of 600 W per box',
  'rope box 1': 'ok: answers',
  'rope box 2': 'ok: answers',
  'hub75 panels': 'ok: LED display present, brightness 1',
  'gallery camera': 'ok: reachable, clips posting, still 25 s old',
  'river camera': 'ok: reachable, clips posting (the seasons file does not use it)',
  router: 'ok: answers',
  internet: 'ok: bitcube reaches the internet',
  'modal agent': 'ok: ticked a minute ago, next tick in the future',
  'modal link': 'ok: 8 processes, gallery and river clips seconds old',
  recorder: 'ok: 14 clips, last run finished',
};
const items = (over) => ({ ...OK_ITEMS, ...over });

// ---- the scenarios ----------------------------------------------------------------------------------------------
const SCENARIOS = {
  'all-good': {
    title: 'All good: the seasons file is running, spring, automatic',
    description: 'A normal evening after the lift. bitcube is up on the cable; TouchDesigner runs the seasons file at 60 fps; the river\'s year is in automatic mode a little past the middle of spring; the rope sender is open and both rope boxes answer (about 180 + 190 W of a 600 W cap each); the Colorlight sender shows up as the LED display; both cameras are up and posting clips to Dave\'s agent, which ticked a minute ago; the hourly recorder is idle after a good run. The people counter doesn\'t exist yet, so presence is unavailable and dynamic mode can\'t be chosen: that is normal, not a fault. td.river_cam is null because the seasons file has no river-camera relay.',
    expect: { headline: 'Everything is up: the river is in spring (automatic), lights and cameras all fine', severity: 'ok', items: items({}),
              action: 'Nothing to do.' },
    build: () => ({ status: base(), ...CAMS_GOOD }),
  },

  'bitcube-offline': {
    title: 'bitcube is offline',
    description: 'The mini can\'t open a TCP connection to bitcube over Tailscale, the seasons page can\'t be fetched (fetch failed) and the SSH probe fails (exit 255: "can\'t reach bitcube over SSH"); that probe error is 400 s old. Nothing behind bitcube can be checked: not TouchDesigner, the ropes, the boxes, the panels, the cameras, the router or the internet at Gray Area. Dave\'s agent is fine (the mini reaches Modal directly). No camera stills: they are fetched through bitcube.',
    expect: { headline: 'bitcube is offline: nothing behind it can be checked', severity: 'down',
      items: items({ bitcube: 'down: not reachable over Tailscale (TCP 22); the probe has failed for 400 s',
        touchdesigner: 'unknown: behind bitcube', seasons: 'unknown: the fetch failed because bitcube is down, not because the file is not running',
        ropes: 'unknown: behind bitcube', 'rope box 1': 'unknown: behind bitcube', 'rope box 2': 'unknown: behind bitcube',
        'hub75 panels': 'unknown: behind bitcube', 'gallery camera': 'unknown: behind bitcube (no still)', 'river camera': 'unknown: behind bitcube (no still)',
        router: 'unknown: behind bitcube', internet: 'unknown: behind bitcube', 'modal agent': 'ok: reachable from the mini, ticked a minute ago',
        'modal link': 'unknown: behind bitcube', recorder: 'unknown: behind bitcube' }),
      action: 'Someone at Gray Area checks bitcube\'s power light and the router; a restart takes about a minute and bitcube comes back by itself. Nothing can be done from here, and every control would fail.' },
    build: () => ({
      status: { bitcube: src(BITCUBE_AT, { online: false }), seasons: err(SEASONS_AT, 'fetch failed'), modal: src(MODAL_AT, modal()),
                probe: err(NOW - 400 * S, "can't reach bitcube over SSH") },
      cameras: { gallery: false, river: false }, camera_age_s: { gallery: null, river: null } }),
  },

  'td-frozen': {
    title: 'TouchDesigner is frozen (a dialog blocks it)',
    description: 'bitcube is up and the probe answers, but the TD bridge gets no reply within 15 s (td = { ok: false, error: "no answer from the TD bridge" }): a modal dialog is blocking TouchDesigner\'s main thread. The seasons page is served by that same frozen thread, so the mini\'s fetch times out ("The operation was aborted due to timeout") even though the port still accepts TCP connections (devices.seasons_page is true). The probe\'s own checks are real: both boxes, both cameras, the router and the internet answer, and the LED display is attached. With TD frozen no Art-Net goes out: the rope boxes fall back to their own colour-cycling program and the panels keep their last frame. The probe took longer (its time is 24 s before the answer arrived).',
    expect: { headline: 'TouchDesigner is frozen: the ropes are not being driven (someone must answer the dialog on bitcube)', severity: 'down',
      items: items({ touchdesigner: 'down: no answer from the TD bridge (a dialog is blocking it)',
        seasons: 'down: the control page times out (TD is frozen); its port still accepting connections proves nothing',
        ropes: 'down: not driven; the boxes play their own colour cycle', 'rope box 1': 'ok: answers (power is on)', 'rope box 2': 'ok: answers (power is on)',
        'hub75 panels': 'warning: LED display present but the picture is frozen' }),
      action: 'Look at bitcube\'s console over VNC and answer the dialog, or restart TouchDesigner on the seasons file with Switch now in mission control (about a minute dark).' },
    build: () => {
      const t0 = PROBE_AT - 24 * S;
      return { status: { bitcube: src(BITCUBE_AT, { online: true }), seasons: err(NOW - 3 * S, 'The operation was aborted due to timeout'),
                         modal: src(MODAL_AT, modal()), probe: src(PROBE_AT, probeValue({ time: localIso(t0), td: { ok: false, error: 'no answer from the TD bridge' } })) },
               ...CAMS_GOOD };
    },
  },

  'td-low-fps': {
    title: 'TouchDesigner is struggling: 4 fps',
    description: 'Like all-good, but TouchDesigner cooks at 4.1 fps against a 60 fps timeline and reports 3 operator errors. Everything still answers (the seasons page too, slowly), the sender is open and the boxes are on, but the river moves in jerks and the Art-Net frames go out at 4 fps.',
    expect: { headline: 'TouchDesigner is running slowly (4 fps instead of 60, 3 errors): the river will look jerky', severity: 'warning',
      items: items({ touchdesigner: 'warning: 4.1 fps of 60, 3 errors', ropes: 'warning: driven, but only at 4 frames a second' }),
      action: 'Check bitcube\'s console (VNC) for what is cooking or erroring; if it doesn\'t recover in a few minutes, restart TouchDesigner on the seasons file with Switch now (about a minute dark).' },
    build: () => { const st = base(); Object.assign(st.probe.value.td, { fps: 4.1, errors: 3 }); return { status: st, ...CAMS_GOOD }; },
  },

  'river-cam-stale': {
    title: 'River camera has gone quiet (online file running)',
    description: 'TouchDesigner is running the online show file (river-online-oct-23.toe), the one that uses the live river camera and Dave\'s agent, so the seasons page isn\'t served (fetch failed: connection refused on 9981; td.seasons is null): expected for this file. The fault: the river camera\'s RTSP port still accepts TCP connections (devices.river_cam true) but sends no frames. TD\'s relay reports its last frame 1800 s ago and fresh false (river_cam.py never records a stream error, so error stays null while the relay keeps restarting ffmpeg); the panels and ropes have fallen back to the rain. The Modal link\'s river capture is in the same state: its last successful clip (the last INFO line) was at 01:58, an hour ago, and every clip since has failed with an ERROR line about 70 s apart, so the log file itself is still fresh (log_age_s small). The recorder\'s current run times out. The cached river still is 30 minutes old.',
    expect: { headline: 'The river camera has sent no frames for 30 minutes: the show is running on the rain fallback (online file)', severity: 'warning',
      items: items({ touchdesigner: 'ok: online file at 59.8 fps', seasons: 'warning: the river\'s year is not running (the live river file is); its controls are unavailable until you switch',
        ropes: 'ok: showing the rain fallback, sender open, 164 + 171 W',
        'river camera': 'warning: port answers but no frames for 1800 s (TD relay); last clip to Dave at 01:58',
        'modal link': 'warning: river clips failing since 01:58; gallery clips fine', recorder: 'warning: current run can\'t get video (timed out)' }),
      action: 'Reboot the river camera through its API from bitcube, or wait for the Starlink link to settle. If the live river isn\'t needed tonight, Switch now to the seasons file, which doesn\'t use it.' },
    build: () => {
      const lastClip = T0 - 3601 * S, st = base();
      st.seasons = err(SEASONS_AT, 'fetch failed');
      st.probe.value.td = td({ file: ONLINE_FILE, fps: 59.8, ropes: { active: true, source: 'canvas', box_watts_cap: 600, status: sender({ watts: [164, 171], seq: 201 }) },
                               seasons: null, river_cam: relay({ frames: 1046800, last_frame_age_s: 1800.4, fresh: false, colourfulness: 0.0014 }) });
      st.probe.value.modal_link.river = { log_age_s: 38, last: clip('river', lastClip, 58) };
      st.probe.value.recorder = { clips: 14, last: cut120(`${ymdhms(T0 - 4 * 60 * S)} river-sub-20261023-0200-part3.mkv: no video [tcp @ 000001f3a2b0c4e0] Connection to tcp://192.168.8.217:554?timeout=15000000 failed: Connection timed out`) };
      st.probe.value.devices.seasons_page = false;
      return { status: st, cameras: { gallery: true, river: true }, camera_age_s: { gallery: 25, river: 1800 } };
    },
  },

  'gallery-cam-down': {
    title: 'Gallery camera is down',
    description: 'The gallery camera (Reolink E1 Pro on Wi-Fi, 192.168.9.76) doesn\'t answer on its RTSP port. The Modal link\'s gallery capture fails every clip (ffmpeg\'s TCP connect gives up after about 20 s and an ERROR line is written, so the log file is still fresh); its last successful clip, the last INFO line, is from 02:43, 15 minutes ago. No gallery still can be fetched. Presence (which will come from this camera) is unavailable anyway: the people counter doesn\'t exist yet. The show itself is unaffected: the seasons file doesn\'t use the gallery camera.',
    expect: { headline: 'The gallery camera is down: no picture of the room and no clips to Dave\'s agent; the show itself is unaffected', severity: 'warning',
      items: items({ 'gallery camera': 'down: no answer on 192.168.9.76:554; last clip at 02:43; no still',
        'modal link': 'warning: gallery clips failing since 02:43; river clips fine' }),
      action: 'Its cable path is faulty (execution plan, Before the lift, item 1): make sure its Ethernet cable is unplugged so it stays on Wi-Fi; power-cycle it if needed, or from the mini run `ip link set eth1 down` on the router (it is back on Wi-Fi within 10 s). Then check its aim with a still.' },
    build: () => {
      const st = base();
      st.probe.value.devices.gallery_cam = false;
      st.probe.value.modal_link.gallery = { log_age_s: 9, last: clip('gallery', T0 - 15 * 60 * S - 12 * S, 49) };
      return { status: st, cameras: { gallery: false, river: true }, camera_age_s: { gallery: null, river: 40 } };
    },
  },

  'modal-scene-old': {
    title: 'Dave\'s agent stopped ticking 9 hours ago',
    description: 'Modal answers (status.json and state.json fetched fine, ok still true), but the last tick finished at 17:58 yesterday evening, nine hours ago, and next_tick_epoch is in the past: the agent should have ticked every 5 minutes until 23:55 and didn\'t. The Modal link\'s sync log has had nothing to write for 9 hours (it only logs changes). The seasons file doesn\'t use Dave\'s scene, so the room is unaffected (the online file would be). Everything else is as in all-good. Note: between 23:55 and 07:00 PDT the agent rests by design and a past next_tick is normal; this one missed six hours of daytime ticks.',
    expect: { headline: 'Dave\'s agent hasn\'t ticked for 9 hours (the room is unaffected: the seasons file doesn\'t use its scene)', severity: 'warning',
      items: items({ 'modal agent': 'warning: last tick 17:58 yesterday, next tick 9 h in the past; its ok flag is still true',
        'modal link': 'warning: sync has seen no new state for 9 h; clips are posting fine' }),
      action: 'Tell Dave: he checks the Modal dashboard for a failing tick or a stopped deployment. Nothing to do in the gallery.' },
    build: () => {
      const tick = NOW - 9 * 3600 * S - 60 * S, st = base();
      st.modal = src(MODAL_AT, modal({ tick: 4120, mood: 'wistful', finished_at: isoUtc(tick), next_tick_epoch: Math.round((tick + 105 * S) / S),
        scene: { animation: 'embers', palette: 'cold-ash', colors: ['#2b2f36', '#5a6068', '#9aa3ad', '#d9a066', '#f0c27b'], speed: 0.18, turbulence: 0.41 },
        set_at: isoPdt(tick - 1 * S) }));
      const syncAt = tick + 5 * S;
      st.probe.value.modal_link.sync = { log_age_s: logAge(syncAt), last: syncLine(syncAt, 'updated status.json (611 bytes)') };
      return { status: st, ...CAMS_GOOD };
    },
  },

  'ropes-dark-on-purpose': {
    title: 'Ropes dark on purpose (sending black)',
    description: 'Someone pressed Ropes → Dark in mission control (or asked the studio chat): the rope sender is open and active with source "black", so it keeps sending black frames (0 + 0 W) and both boxes stay dark instead of playing their own colour cycle. Both boxes answer. TouchDesigner, the seasons (which keep turning), the panels, the cameras and Dave\'s agent are all fine.',
    expect: { headline: 'The ropes are dark on purpose (sending black); everything else is up', severity: 'warning',
      items: items({ ropes: 'warning: dark by choice (source black, 0 + 0 W); not a fault', 'hub75 panels': 'ok: still showing the river, brightness 1' }),
      action: 'If the ropes should be showing the river, press Ropes → On in mission control; they follow within a few seconds. Nothing is broken.' },
    build: () => {
      const st = base();
      st.probe.value.td.ropes = { active: true, source: 'black', box_watts_cap: 600, status: sender({ source: 'black', watts: [0, 0], seq: 44 }) };
      return { status: st, ...CAMS_GOOD };
    },
  },

  'just-booted': {
    title: 'bitcube restarted 6 minutes ago, still coming up',
    description: 'bitcube\'s uptime is 0.1 h. TouchDesigner has opened the seasons file; the probe can\'t compute a frame rate on its first call (fps null). The year has just started: automatic mode, phase 0 (winter), intensity 0.05, no history yet (the first point lands within 10 s). The rope sender is open; its counters carry over from the saved file (comp.storage is pickled into the .toe), so sent and packets look old. The Modal link hasn\'t started yet (0 processes; its logs are from before the restart, 12 minutes old). Dave\'s agent is fine. Both boxes, both cameras, the router and the internet answer, and the LED display is attached.',
    expect: { headline: 'bitcube restarted 6 minutes ago and is still coming up: the seasons file is running (winter); the Modal link hasn\'t started yet', severity: 'warning',
      items: items({ bitcube: 'ok: online, up 0.1 h', touchdesigner: 'ok: seasons file; frame rate not known yet (first probe)',
        seasons: 'ok: automatic, winter, just started (no history yet)', ropes: 'ok: showing the river, sender open, 96 + 101 W',
        'modal link': 'warning: not running yet (0 processes; logs 12 min old)' }),
      action: 'Wait two minutes and look again. If the Modal link is still not running after 5 minutes, start it on bitcube (Start-Modal.cmd through a one-off interactive task).' },
    build: () => {
      const year = yearState({ phase: 0.0 }), st = base();
      st.seasons = src(SEASONS_AT, seasonsState(year, []));
      const old = T0 - 12 * 60 * S;
      st.probe.value = probeValue({ uptime_h: 0.1,
        td: td({ fps: null, seasons: year, ropes: { active: true, source: 'canvas', box_watts_cap: 600, status: sender({ sent: 4433255, watts: [96, 101], seq: 23 }) } }),
        modal_link: { processes: 0, gallery: { log_age_s: logAge(old), last: clip('gallery', old, 51) }, river: { log_age_s: logAge(old - 3 * S), last: clip('river', old - 3 * S, 60) },
                      sync: { log_age_s: logAge(old - 38 * S), last: syncLine(old - 38 * S, 'updated reflex.json (1488 bytes)') } } });
      return { status: st, ...CAMS_GOOD };
    },
  },

  'nothing-known-yet': {
    title: 'Mission control just started',
    description: 'The server started a second ago: only the first fast poll has run, so the snapshot holds just the bitcube TCP check (online). The seasons, modal and probe keys don\'t exist yet (they appear after their first poll: within 5 s, 30 s and up to a minute). No stills yet.',
    expect: { headline: 'Checking… bitcube answers; everything else is not known yet', severity: 'unknown',
      items: items(Object.fromEntries(Object.keys(OK_ITEMS).map((k) => [k, k === 'mission control' ? 'ok: just started' : k === 'bitcube' ? 'ok: reachable over Tailscale' : 'unknown: not checked yet']))),
      action: 'Wait a minute. Nothing is wrong yet, and nothing is known to be right either.' },
    build: () => ({ status: { bitcube: src(NOW - 1 * S, { online: true }) }, cameras: { gallery: false, river: false }, camera_age_s: { gallery: null, river: null } }),
  },

  'lights-not-connected': {
    title: 'Lights not connected (the real state, 03:00 on 23 Oct)',
    description: 'The recorded payload, nearly verbatim (seasons.history trimmed to its last 6 points; the server-added studio key removed). Before the lift: bitcube is online at Gray Area on the cable; TouchDesigner runs the seasons file at 60 fps in manual mode (summer, intensity 0.39, set from the control page). The lighting switch and the Colorlight sender are not connected: both rope boxes are unreachable, the Art-Net sender can\'t bind 2.0.0.8 (OSError 10049; open false, retrying true: it picks up by itself once the lights are in), the watts [106, 120] are stale counters from the saved file, and displays is ["\\u0000"] (no monitor at all). The river site is down (solar, Starlink): the river camera is unreachable, the Modal link\'s river log has no INFO line in its last 200 lines (last null, though it is written to every 23 s), and the recorder\'s last log line is a fragment of an ffmpeg error ("Error ope"). The gallery camera is on Wi-Fi and posting clips. Dave\'s agent last ticked at 23:53 and is in its overnight rest; the sync log is 34 minutes old.',
    expect: { headline: 'Lights not connected: both rope boxes unreachable, the sender can\'t open its port, no LED display; the river site is down', severity: 'down',
      items: items({ seasons: 'ok: manual, summer, intensity 0.39; people counter not available (normal)',
        ropes: 'down: sender can\'t open its port (OSError 10049 on 2.0.0.8), retrying; the watts shown are stale',
        'rope box 1': 'down: no answer on 2.0.0.10', 'rope box 2': 'down: no answer on 2.0.0.11',
        'hub75 panels': 'down: no LED display on bitcube (displays ["\\u0000"])',
        'river camera': 'down: river site down (solar, Starlink); no still', 'modal agent': 'ok: last tick 23:53; resting overnight (23:55 to 07:00 PDT), so a past next tick is normal',
        'modal link': 'warning: gallery clips fine; river clips failing (site down)',
        recorder: 'warning: 2 clips; last log line is a cut ffmpeg error ("Error ope")' }),
      action: 'Expected until the lift. In the ceiling: plug the lighting switch into bitcube\'s LIGHTS port and the Colorlight sender into HDMI, then check that both boxes answer, the sender error clears and the display reads "LED 1920X1080". The river site needs sun.' },
    build: () => {
      const st = structuredClone(recorded);
      delete st.studio;
      st.seasons.value.history = st.seasons.value.history.slice(-6);
      return { status: st, cameras: { gallery: true, river: false }, camera_age_s: { gallery: 25, river: null } };
    },
  },

  'seasons-not-running': {
    title: 'The online file is running, not the seasons file',
    description: 'TouchDesigner is running river-online-oct-23.toe (the live river plus Dave\'s agent and canvas). That file has no seasons COMP, so nothing listens on port 9981: the seasons fetch fails (connection refused, reported as "fetch failed"), devices.seasons_page is false and td.seasons is null. The live river relay is healthy (fresh frames from the river camera, infrared at this hour). The seasons file is still the boot file, so the next restart would bring it back. Everything else is up.',
    expect: { headline: 'TouchDesigner is running the online file, not the seasons file: the river\'s year and its controls are unavailable', severity: 'warning',
      items: items({ touchdesigner: 'ok: online file at 60 fps', seasons: 'warning: the river\'s year is not running (the live river file is); switch to it to get the year and its controls back',
        ropes: 'ok: showing the live river, sender open, 158 + 166 W', 'river camera': 'ok: live, fresh frames (infrared)' }),
      action: 'If nobody chose this on purpose, press Switch now → river-local-oct-22-seasons.toe in mission control (the lights go dark for about a minute). If Colin wants the live river tonight, leave it.' },
    build: () => {
      const st = base();
      st.seasons = err(SEASONS_AT, 'fetch failed');
      st.probe.value.td = td({ file: ONLINE_FILE, fps: 60.0, ropes: { active: true, source: 'canvas', box_watts_cap: 600, status: sender({ watts: [158, 166], seq: 92 }) },
                               seasons: null, river_cam: relay() });
      st.probe.value.devices.seasons_page = false;
      return { status: st, ...CAMS_GOOD };
    },
  },

  'viz-running': {
    title: 'A new visualization is showing (chosen on purpose)',
    description: `Someone switched TouchDesigner to a show from the registry that is neither the river's year nor the live river: ${VIZ_FILE}, a visualization (kind viz) made from the baseline template. It serves no year page (port 9981 refuses: "fetch failed", devices.seasons_page false, td.seasons null) and drives the ropes and the panels as every show does. The river's year is still the default (the boot file), so a restart brings it back. Everything else is up.`,
    expect: { headline: 'Everything is up: Fireflies (test viz) is showing; lights and cameras fine', severity: 'ok',
      items: items({ touchdesigner: 'ok: the test viz at 60 fps', seasons: "ok: not used (this show has no year)", ropes: 'ok: showing the viz, sender open, 140 + 150 W' }),
      action: "Nothing to do. To go back, press Back to default (the river's year) under What's showing." },
    build: () => {
      const st = base();
      st.seasons = err(SEASONS_AT, 'fetch failed');
      st.probe.value.show_files = [...SHOW_FILES, TEMPLATE_FILE, VIZ_FILE];
      st.probe.value.td = td({ file: VIZ_FILE, fps: 60.0, ropes: { active: true, source: 'canvas', box_watts_cap: 600, status: sender({ watts: [140, 150], seq: 92 }) },
                               seasons: null, river_cam: relay() });
      st.probe.value.devices.seasons_page = false;
      return { status: st, ...CAMS_GOOD };
    },
  },

  // ---- the Modal input show: one of Dave's inputs drives the river (docs/modal-inputs.md) ---------------------------------
  ...Object.fromEntries([
    ['scene', "Scene: Modal's colours and pace recolour the river", { ages: { canvas: 3, scene: 42, frames: 95 } }],
    ['frames', "Frames: Modal's own pictures for each screen and the ropes", { ages: { canvas: 3, scene: 42, frames: 95 } }],
    ['canvas', "Canvas: Modal's moving picture over the river", { ages: { canvas: 2, scene: 300, frames: 95 } }],
    ['off', 'Off: the river on its own', { strength: 0.6, ages: { canvas: 3, scene: 42, frames: 95 } }],
  ].map(([source, title, o]) => [`modal-input-${source}`, {
    title: `Modal input show: ${title}`,
    description: `TouchDesigner runs ${MODAL_FILE} (Combined with Modal Input Selector, kind viz), chosen on purpose; the Modal input is ${source}${source === 'off' ? '' : ' at 60 %'}. Every source is fresh (canvas seconds old, the scene minutes at most, the latest frame under two minutes). No year page (the show has none); the default is still the river's year.`,
    expect: { headline: 'Everything is up: the Modal input show is showing; lights and cameras fine', severity: 'ok',
      items: items({ touchdesigner: 'ok: the Modal input show at 60 fps', seasons: 'ok: not used (this show has no year)', ropes: 'ok: showing the show, sender open, 140 + 150 W' }),
      action: "Nothing to do. The Modal input under What's showing changes which of Modal's outputs drives the river." },
    build: () => modalShow(fixtureModalInput(source, o)),
  }])),

  'modal-input-frames-stale': {
    title: "Modal input show: Modal's frames are old",
    description: `TouchDesigner runs ${MODAL_FILE} with the Modal input on frames at 60 %, but Dave's newest frame is 21 minutes old and Modal Frames has gone quiet (SPEC §6.5): the show has faded back to plain Combined (effective_source off). The canvas and the scene are fresh. The rest of the show is fine.`,
    expect: { headline: "Modal's frames are 21 min old: showing the river without them", severity: 'warning',
      items: items({ 'modal agent': 'warning: answers, but its frames for the show are 21 min old', touchdesigner: 'ok: the Modal input show at 60 fps', seasons: 'ok: not used (this show has no year)', ropes: 'ok: showing the show, sender open, 140 + 150 W' }),
      action: "Nothing is broken: tell Dave if it lasts, or pick another Modal input under What's showing." },
    build: () => modalShow(fixtureModalInput('frames', { ages: { canvas: 3, scene: 42, frames: 1260 }, stale: true })),
  },

  // ---- the remembered river: the debug page's four situations (public/remembered.*) --------------------------------------------------
  'remembered-calm': {
    title: 'The remembered river: a calm stretch of the loop',
    description: `TouchDesigner runs ${REMEMBERED_FILE}. The loop is 41 s in (hour 3.3 of a made-up wet winter day Dave's agent chose for its resemblance 3 min 40 s ago); the surge is due at hour 13.5, as Dave asked. The ropes follow the sound (heard 0.62); the river cam is live. Three people in the room against 2.1 usual, one of them standing still by ropes 7 and 8. Panels well under the 30 % rule.`,
    expect: { headline: 'Everything is up: the remembered river is showing; lights and cameras fine', severity: 'ok', items: rememberedItems(),
      action: 'Nothing to do. The Remembered river page shows what it is doing and why.' },
    build: () => rememberedShow(rememberedRaw({})),
  },
  'remembered-surge': {
    title: 'The remembered river: the surge',
    description: `TouchDesigner runs ${REMEMBERED_FILE} in the surge of the loop (2 min 46 s in, hour 13.3), Dave's day and his surge hour; one screen is just over the 30 % rule (31 %), the ropes draw 1,180 W of the 1,400 W limit. Two lingerers. The ropes follow the sound, loud now (heard 0.81).`,
    expect: { headline: 'Everything is up: the remembered river is showing; lights and cameras fine', severity: 'ok', items: rememberedItems(),
      action: 'Nothing to do.' },
    build: () => rememberedShow(rememberedRaw({ phase: 'surge', t_s: 166.0, heard: 0.81, river_motion: 0.66, lit: [24, 28, 31, 19], watts: 1180, presence: 5.4, usual: 2.3,
      lingerers: [{ x: 0.42, y: 0.78, still_s: 31, ropes: [7, 8] }, { x: 0.63, y: 0.71, still_s: 9, ropes: [12] }] }), { watts: [590, 590] }),
  },
  'remembered-fallback': {
    title: "The remembered river: Dave's choice is old, bitcube plays a notable day",
    description: `TouchDesigner runs ${REMEMBERED_FILE}. Dave's choice is 7 min old (over the 5 min rule), so bitcube plays one of the notable days itself (a made-up flood day; its 24 hours come from TouchDesigner's own status). No sound from Dave (heard unknown), so the ropes follow the river cam's picture, which is the recorded clip. The surge lands at the day's heaviest rain, moved 6 s later by the room. Building toward it.`,
    expect: { headline: 'Everything is up: the remembered river is showing; lights and cameras fine', severity: 'ok', items: rememberedItems(),
      action: "Nothing to do; tell Dave if his agent stays quiet." },
    build: () => rememberedShow(rememberedRaw({ phase: 'building', t_s: 121.0, heard: null, river_motion: 0.27, river_source: 'recorded', chosenAge: 420, lit: [9, 14, 11, 6], watts: 520,
      day: { date: '2017-01-08', reason: FLOOD_LINE, chosen_by: 'significance', source: 'notable', age_s: 420, profile: DAY_FLOOD },
      surge: { hour: 11.0, t_s: 143.5, why: "the day's heaviest rain, hour 11", room_shift_s: 6 } })),
  },
  'remembered-not-running': {
    title: "The remembered river isn't running (the river's year is)",
    description: `TouchDesigner runs the river's year, as on any normal evening; the remembered river's status file is 90 min old, from when it last ran. Dave's agent still chooses remembered days (its scene and reflex are fresh) and the people counter still writes the room.`,
    expect: { headline: "Everything is up: the river's year is showing; lights and cameras fine", severity: 'ok', items: OK_ITEMS, action: 'Nothing to do.' },
    build: () => ({ status: base(), ...CAMS_GOOD, remembered: rememberedRaw({ statusAge: 5400 }) }),
  },

  // ---- the filling glass: its dials on Status (public/filling.js) ----------------------------------------------------------------
  'filling-running': {
    title: 'The filling glass is showing, filling up',
    description: `TouchDesigner runs ${FILLING_FILE}. Its dials were last set 12 min ago to Midnight, brightness 80 %, intensity 60 %, speed 100 % (River\\filling\\control.json); the show's own report (status.json, written every second) says the same, 42 % full and filling. Everything else is up.`,
    expect: { headline: 'Everything is up: the filling glass is showing; lights and cameras fine', severity: 'ok',
      items: items({ touchdesigner: 'ok: the filling glass at 60 fps', seasons: 'ok: not used (this show has no year)', ropes: 'ok: showing the show, sender open' }),
      action: "Nothing to do. The filling glass's dials under What's showing change its colours, brightness, turbulence and pace." },
    build: () => fillingShow(fillingRaw({})),
  },
  'filling-not-running': {
    title: "The filling glass isn't running (the river's year is)",
    description: "TouchDesigner runs the river's year, as on any normal evening. The filling glass's files are still on bitcube from when it last ran (its status file is 2 h old): the full check reads them, but nothing shows them and its dials are refused.",
    expect: { headline: "Everything is up: the river's year is showing; lights and cameras fine", severity: 'ok', items: OK_ITEMS, action: 'Nothing to do.' },
    build: () => { const st = base(); st.probe.value.filling = fillingRaw({ statusAge: 7200, controlAge: 7300 }); return { status: st, ...CAMS_GOOD }; },
  },

  // ---- the river (all looks): its Looks card on Status (public/looks.js) -------------------------------------------------------
  'looks-auto': {
    title: 'The river (all looks) on Auto: the remembered river, loop 2 of 4',
    description: `TouchDesigner runs ${LOOKS_FILE} on Auto (set 25 min ago): it has played one loop of the remembered river this round and is in its second; after the fourth it fades to Fill my cup (simple) for one full cycle. Its own report (looks\\status.json, twice a second) is fresh. The Remembered river page treats it as running.`,
    expect: { headline: 'Everything is up: the river (all looks) is showing; lights and cameras fine', severity: 'ok', items: looksItems(),
      action: 'Nothing to do. The Looks card under What\'s showing picks Auto or one look.' },
    build: () => looksShow(looksRaw({}), { remembered: rememberedRaw({ show: LOOKS_FILE, looks: looksRaw({}).status }) }),
  },
  'looks-manual-fill': {
    title: 'The river (all looks) on Manual: Fill my cup (configurable)',
    description: `TouchDesigner runs ${LOOKS_FILE} on Manual, staying on Fill my cup (configurable) (chosen 4 min ago). Its dials (River\\filling\\control.json) were last set 12 min ago to Midnight, 80 %; the fill reports 42 % full and filling.`,
    expect: { headline: 'Everything is up: the river (all looks) is showing; lights and cameras fine', severity: 'ok', items: looksItems(),
      action: 'Nothing to do. The Looks card under What\'s showing picks Auto or one look.' },
    build: () => looksShow(looksRaw({ mode: 'manual', look: 'fill-configurable', controlAge: 240, next: null, loops: 0 }), { filling: fillingRaw({}) }),
  },
  'looks-fading': {
    title: 'The river (all looks) fading from the remembered river to Fill my cup (simple)',
    description: `TouchDesigner runs ${LOOKS_FILE} on Manual: Fill my cup (simple) was picked 2 s ago, so the remembered river is fading out (40 % of its brightness left); Fill my cup (simple) fades in next and then stays.`,
    expect: { headline: 'Everything is up: the river (all looks) is showing; lights and cameras fine', severity: 'ok', items: looksItems(),
      action: 'Nothing to do. The Looks card under What\'s showing picks Auto or one look.' },
    build: () => looksShow(looksRaw({ mode: 'manual', look: 'remembered', target: 'fill-simple', fading: 'out', fade: 0.4, controlAge: 2, controlLook: 'fill-simple', next: null }),
      { remembered: rememberedRaw({ show: LOOKS_FILE, looks: looksRaw({ mode: 'manual', look: 'remembered', target: 'fill-simple', fading: 'out', fade: 0.4 }).status }) }),
  },

  'no-internet': {
    title: 'No internet at Gray Area',
    description: 'bitcube can\'t open connections to the internet (1.1.1.1:443 fails) while the install router answers: the router\'s uplink (the venue\'s staff Wi-Fi) has dropped. bitcube\'s existing Tailscale tunnel to the mini still carries traffic, so the mini can still probe it. Dave\'s agent is fine as seen from the mini, but the Modal link on bitcube can\'t upload: its last successful clips (the last INFO lines) are from 02:38, 20 minutes ago, and every clip since has failed with an ERROR line, so the log files are still fresh; the sync has logged nothing since its last update. The river camera (via Starlink and Will\'s tailnet) is unreachable, and the recorder\'s current run can\'t connect. The show is unaffected: the seasons file needs no network.',
    expect: { headline: 'No internet at Gray Area: the show runs (local file), but the cameras can\'t reach Dave\'s agent and the river site is unreachable', severity: 'warning',
      items: items({ internet: 'down: bitcube can\'t reach the internet; the router is fine', 'river camera': 'down: unreachable without internet (Starlink via Will\'s tailnet); no still',
        'modal agent': 'ok: reachable from the mini (not from bitcube)', 'modal link': 'down: uploads failing since 02:38 for both cameras; sync stalled',
        recorder: 'warning: current run can\'t connect to the river camera' }),
      action: 'Check the router\'s uplink (the venue\'s staff Wi-Fi as Repeater, or the wired drop) from its admin page or over SSH from the mini. The show keeps running meanwhile; clips resume by themselves.' },
    build: () => {
      const st = base(), lost = T0 - 20 * 60 * S;
      Object.assign(st.probe.value.devices, { internet: false, river_cam: false });
      st.probe.value.modal_link = link({ gallery: { log_age_s: 6, last: clip('gallery', lost - 7 * S, 50) }, river: { log_age_s: 31, last: clip('river', lost - 11 * S, 62) },
                                         sync: { log_age_s: logAge(lost - 40 * S), last: syncLine(lost - 40 * S, 'updated status.json (611 bytes)') } });
      st.probe.value.recorder = { clips: 14, last: cut120(`${ymdhms(T0 - 5 * 60 * S)} river-main-20261023-0200-part5.mkv: no video [tcp @ 000001c2f8e0a4a0] Connection to tcp://192.168.8.217:554?timeout=15000000 failed: Connection timed out`) };
      return { status: st, cameras: { gallery: true, river: false }, camera_age_s: { gallery: 25, river: null } };
    },
  },
};

// ---- the remembered river (docs/remembered-river.md section 5; lib/remembered.mjs CONTRACT) -------------------------------------
// A made-up day for the fixtures (not the record's numbers): 24 hours of rain (mm/h), flow (cfs), temperature, snow and is_day.
const DAY_WET = {
  rain: [0, 0, 0, 0.2, 0.4, 0.3, 0.8, 1.2, 1.6, 2.4, 3.1, 4.2, 5.8, 7.4, 6.1, 4.0, 2.2, 1.4, 0.9, 0.5, 0.3, 0.1, 0, 0],
  flow: [31, 31, 30, 30, 31, 32, 33, 35, 38, 44, 52, 63, 79, 102, 131, 158, 176, 181, 174, 160, 143, 126, 111, 99],
  temp: [5.1, 4.8, 4.6, 4.4, 4.3, 4.2, 4.3, 4.8, 5.4, 6.0, 6.6, 7.0, 7.1, 7.0, 6.8, 6.5, 6.1, 5.8, 5.6, 5.4, 5.3, 5.2, 5.1, 5.0],
  snow: Array(24).fill(0),
  is_day: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
};
const DAY_FLOOD = {
  rain: [2.1, 3.4, 4.0, 5.6, 6.2, 7.9, 9.4, 8.1, 6.6, 7.2, 9.8, 12.4, 10.1, 6.0, 3.2, 1.8, 1.0, 0.6, 0.4, 0.2, 0.1, 0, 0, 0],
  flow: [88, 104, 131, 166, 208, 251, 297, 338, 362, 371, 384, 401, 412, 409, 398, 377, 352, 324, 298, 271, 249, 230, 214, 201],
  temp: [9.2, 9.1, 9.0, 9.1, 9.3, 9.6, 10.0, 10.4, 10.9, 11.3, 11.6, 11.8, 11.7, 11.4, 11.0, 10.6, 10.2, 9.9, 9.7, 9.5, 9.4, 9.3, 9.2, 9.1],
  snow: Array(24).fill(0),
  is_day: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
};
const PALETTE_WINTER = ['#0b3d5c', '#1f8fb3', '#7fd3e6', '#e3f6ff'];
const MEMORY_WET = { date: '2017-02-07', reason: 'Cold steady rain at the creek today, like 7 Feb 2017.', chosen_by: 'resemblance',
  product: 'NWM v3 retrospective (modelled reach flow) + Open-Meteo',
  stats: { flow_mean_cfs: 91.4, flow_pct: 88, rain_mm: 42.9, heaviest_hour: 13, season: 'winter', dry: false, cold: true }, profile: DAY_WET };
const FLOOD_LINE = '8 Jan 2017: highest modelled flow in the record, 412 cfs; 81 mm of rain';
const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** probe.ps1 -Action remembered's answer at the fixtures' moment (each file { age_s, json }). What differs from a calm loop is passed. */
function rememberedRaw({ statusAge = 0.3, phase = 'calm', t_s = 41.5, day = {}, surge = {}, heard = 0.62, river_motion = 0.41, river_source = 'live',
                         lingerers = [{ x: 0.42, y: 0.78, still_s: 12, ropes: [7, 8] }], presence = 3.2, usual = 2.1, lit = [12, 8, 22, 4], watts = 410,
                         chosenAge = 220, opening = false, zones = { file: 'zones-2026-10-27.json', pool_height_m: 0.6, light: 'off' }, fps = 60,
                         show = REMEMBERED_FILE, looks = null, video = 0.25 } = {}) {
  const chosen = NOW - chosenAge * S;
  const dayJ = { date: MEMORY_WET.date, reason: MEMORY_WET.reason, chosen_by: 'resemblance', source: 'dave', age_s: chosenAge, next: null, ...day };
  const relative = Math.round(presence / usual * 100) / 100;
  const status = { t: Math.round((NOW - statusAge * S) / 10) / 100, show, fps,
    loop: { index: 12, t_s, length_s: 300, hour: Math.round(t_s / 300 * 24 * 10) / 10 }, phase, day: dayJ,
    surge: { hour: 13.5, t_s: 168.8, why: 'Dave: hour 13.5', room_shift_s: 0, ...surge },
    knobs: { speed: 0.5, density: 0.6, brightness: 0.7, turbulence: 0.4, reflex: { speed: 0.05, turbulence: -0.04 } },
    palette: PALETTE_WINTER, ropes_follow: heard == null ? 'picture' : 'sound', heard, river_motion, river_source,
    room: { presence, usual, relative, lingerers },
    panels: { lit_pct: lit, cap: 0.55 }, ropes: { watts }, opening_night: opening, zones, screens: { video } };
  const people = [{ x: 0.42, y: 0.78, h: 0.46, still_s: 12 }, { x: 0.71, y: 0.62, h: 0.3, still_s: 2 }, { x: 0.63, y: 0.71, h: 0.42, still_s: 9 }];
  return {
    status: { age_s: statusAge, json: status },
    state: { age_s: 61, json: { memory: { ...MEMORY_WET, chosen_at: isoZ(chosen) }, surge_at: 13.5,
      scene: { animation: 'drift', palette_name: 'winter-creek', colors: PALETTE_WINTER, speed: 0.5, density: 0.6, brightness: 0.7, turbulence: 0.4 }, set_at: isoPdt(chosen) } },
    reflex: { age_s: 4, json: { live: true, offsets: { speed: 0.05, density: 0, brightness: 0, turbulence: -0.04 }, heard, updated_at: isoUtc(NOW - 4 * S) } },
    presence: { age_s: 0.4, json: { presence, usual, relative, people: people.slice(0, Math.max(2, Math.round(presence))), lingerers } },
    control: { age_s: 3600, json: { pool_height_m: zones.pool_height_m, light: zones.light, opening_night: opening, screens: { video }, at: isoZ(NOW - 3600 * S) } },
    ...(looks ? { looks } : {}),
  };
}
/** The remembered river running (like viz-running), with its files as given. */
function rememberedShow(remembered, { watts = [210, 200] } = {}) {
  const st = base();
  st.seasons = err(SEASONS_AT, 'fetch failed');
  st.probe.value.show_files = [...SHOW_FILES, TEMPLATE_FILE, REMEMBERED_FILE];
  st.probe.value.td = td({ file: REMEMBERED_FILE, fps: 60.0, ropes: { active: true, source: 'canvas', box_watts_cap: 600, status: sender({ watts, seq: 92 }) },
                           seasons: null, river_cam: relay() });
  st.probe.value.devices.seasons_page = false;
  return { status: st, ...CAMS_GOOD, remembered };
}
function rememberedItems() { return items({ touchdesigner: 'ok: the remembered river at 60 fps', seasons: 'ok: not used (this show has no year)', ropes: 'ok: showing the show, sender open' }); }

/** probe.ps1's probe.filling at the fixtures' moment: control.json and status.json, each { age_s, json }. */
function fillingRaw({ statusAge = 0.6, controlAge = 720, palette = 'midnight', brightness = 0.8, intensity = 0.6, speed = 1, level = 0.42, phase = 'filling' } = {}) {
  const set = { palette, brightness, intensity, speed };
  return { control: { age_s: controlAge, json: { ...set, at: new Date(NOW - controlAge * S).toISOString().replace(/\.\d{3}Z$/, 'Z') } },
           status: { age_s: statusAge, json: { t: Math.round((NOW - statusAge * S) / 10) / 100, ...set, level, phase } } };
}
/** The filling glass running (like viz-running), with its files as given. */
function fillingShow(filling) {
  const st = base();
  st.seasons = err(SEASONS_AT, 'fetch failed');
  st.probe.value.show_files = [...SHOW_FILES, TEMPLATE_FILE, FILLING_FILE];
  st.probe.value.td = td({ file: FILLING_FILE, fps: 60.0, ropes: { active: true, source: 'canvas', box_watts_cap: 600, status: sender({ watts: [260, 250], seq: 92 }) },
                           seasons: null, river_cam: relay() });
  st.probe.value.devices.seasons_page = false;
  st.probe.value.filling = filling;
  return { status: st, ...CAMS_GOOD };
}

/** probe.ps1's probe.looks at the fixtures' moment: control.json and status.json, each { age_s, json }. */
function looksRaw({ statusAge = 0.3, controlAge = 1500, mode = 'auto', look = 'remembered', target = null, fading = null, fade = 1, loops = 1, next = 'fill-simple',
                    controlLook = null } = {}) {
  return { control: { age_s: controlAge, json: { mode, look: controlLook ?? (mode === 'manual' ? target ?? look : look), at: isoZ(NOW - controlAge * S) } },
           status: { age_s: statusAge, json: { t: Math.round((NOW - statusAge * S) / 10) / 100, show: LOOKS_FILE, mode, look, target: target ?? look, fading, fade,
                                               auto: { remembered_loops: loops, next }, looks: ['remembered', 'fill-simple', 'fill-configurable'] } } };
}
/** The river (all looks) running (like viz-running), with its files as given (and the filling glass's, for a fill look). */
function looksShow(looks, { filling = null, remembered = null } = {}) {
  const st = base();
  st.seasons = err(SEASONS_AT, 'fetch failed');
  st.probe.value.show_files = [...SHOW_FILES, TEMPLATE_FILE, LOOKS_FILE];
  st.probe.value.td = td({ file: LOOKS_FILE, fps: 60.0, ropes: { active: true, source: 'canvas', box_watts_cap: 600, status: sender({ watts: [240, 230], seq: 92 }) },
                           seasons: null, river_cam: relay() });
  st.probe.value.devices.seasons_page = false;
  st.probe.value.looks = looks;
  if (filling) st.probe.value.filling = filling;
  return { status: st, ...CAMS_GOOD, ...(remembered ? { remembered } : {}) };
}
function looksItems() { return items({ touchdesigner: 'ok: the river (all looks) at 60 fps', seasons: 'ok: not used (this show has no year)', ropes: 'ok: showing the show, sender open' }); }

/** The Modal input show running (like viz-running), with td.modal_input as given. */
function modalShow(mi) {
  const st = base();
  st.seasons = err(SEASONS_AT, 'fetch failed');
  st.probe.value.show_files = [...SHOW_FILES, TEMPLATE_FILE, MODAL_FILE];
  st.probe.value.td = td({ file: MODAL_FILE, fps: 60.0, ropes: { active: true, source: 'canvas', box_watts_cap: 600, status: sender({ watts: [140, 150], seq: 92 }) },
                           seasons: null, river_cam: relay(), modal_input: mi });
  st.probe.value.devices.seasons_page = false;
  // what Modal's public endpoints answer (lib/modal-feed.mjs), for the frame the show reports: every value the page lists
  st.modal_feed = fixtureModalFeed({ frameId: mi.sources.frames.frame_id });
  return { status: st, ...CAMS_GOOD };
}

export function buildAll() {
  const out = {};
  for (const [name, s] of Object.entries(SCENARIOS)) {
    const { status, cameras, camera_age_s, remembered } = s.build();
    out[name] = { _scenario: { now: NOW, title: s.title, description: s.description, expect: s.expect }, status, cameras, camera_age_s, ...(remembered ? { remembered } : {}) };
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = buildAll();
  for (const [name, fixture] of Object.entries(all)) writeFileSync(join(DIR, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  writeFileSync(join(DIR, '_shows.extra.json'), JSON.stringify({ shows: [VIZ_ENTRY, MODAL_ENTRY, REMEMBERED_ENTRY, FILLING_ENTRY, LOOKS_ENTRY] }, null, 2) + '\n');
  console.log(`wrote ${Object.keys(all).length} fixtures to ${DIR}`);
}
