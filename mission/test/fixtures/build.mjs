#!/usr/bin/env node
// Writes the fixture scenarios in this folder: `node build.mjs` rewrites every <name>.json from the data below.
// The scenarios are authored here (what is true in the world, and the exact payload a correct server would
// produce for it); the helpers only keep the derived numbers consistent (age_s from at, season weights from
// the phase, log-line timestamps, history points). README.md explains the format and each scenario.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const RECORDED = join(DIR, '_recorded-2026-10-23.json');
const recorded = JSON.parse(readFileSync(RECORDED, 'utf8'));

// The moment every fixture is "taken": 2026-10-23 02:59:00 PDT (09:59:00Z), two seconds after the real recording.
export const NOW = 1792749540000;
const S = 1000;

const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const SEASONS_FILE = 'river-local-oct-22-seasons.toe';
const ONLINE_FILE = 'river-online-oct-23.toe';            // the current online file (23 Oct: four screens, the 23 Oct rope map)
const SHOW_FILES = [SEASONS_FILE, ONLINE_FILE, 'river-online-oct-20.toe'];
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
    description: 'TouchDesigner is running the online show file (river-online-oct-20.toe), the one that uses the live river camera and Dave\'s agent, so the seasons page isn\'t served (fetch failed: connection refused on 9981; td.seasons is null): expected for this file. The fault: the river camera\'s RTSP port still accepts TCP connections (devices.river_cam true) but sends no frames. TD\'s relay reports its last frame 1800 s ago and fresh false (river_cam.py never records a stream error, so error stays null while the relay keeps restarting ffmpeg); the panels and ropes have fallen back to the rain. The Modal link\'s river capture is in the same state: its last successful clip (the last INFO line) was at 01:58, an hour ago, and every clip since has failed with an ERROR line about 70 s apart, so the log file itself is still fresh (log_age_s small). The recorder\'s current run times out. The cached river still is 30 minutes old.',
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
    description: 'TouchDesigner is running river-online-oct-20.toe (the live river plus Dave\'s agent and canvas). That file has no seasons COMP, so nothing listens on port 9981: the seasons fetch fails (connection refused, reported as "fetch failed"), devices.seasons_page is false and td.seasons is null. The live river relay is healthy (fresh frames from the river camera, infrared at this hour). The seasons file is still the boot file, so the next restart would bring it back. Everything else is up.',
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

export function buildAll() {
  const out = {};
  for (const [name, s] of Object.entries(SCENARIOS)) {
    const { status, cameras, camera_age_s } = s.build();
    out[name] = { _scenario: { now: NOW, title: s.title, description: s.description, expect: s.expect }, status, cameras, camera_age_s };
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = buildAll();
  for (const [name, fixture] of Object.entries(all)) writeFileSync(join(DIR, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`wrote ${Object.keys(all).length} fixtures to ${DIR}`);
}
