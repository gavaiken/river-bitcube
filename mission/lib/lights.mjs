// Lights data for mission control (docs/mission-plan.md): what TouchDesigner sends to the ropes and the HUB75 right now
// (the portal's lights simulator), the rope pixel map (the 2D map over the gallery still) and the calibration job.
// Separate from mission.mjs on purpose (no edits there). The fetchers follow sshProbe's pattern (execFile ssh, BatchMode,
// ConnectTimeout, the last stdout line that starts with '{'), each with an injectable exec for tests. The pure helpers
// decode and summarise the payloads. The Lights class caches like Mission.camera(): nothing is fetched while nobody looks.
//
// CONTRACT (bitcube side -> this file -> what server.mjs serves). Every shape below arrives from bitcube unchanged.
//
// GET /api/lights -> Lights.frames() -> sshFrames(): tools/mission/frames.ps1 -> td_mission.py {"action": "frames"}
//   (one SSH + one TD bridge call; cached FRAMES_CACHE_MS, one fetch in flight, so a 10 s page poll is fine)
//   { ok: true, action: 'frames', file, fps, cook_rate, ropes: {...}, hub75: {...}, ...,       <- td_mission.py's usual status
//     frames: { at: <unix seconds>, source: <ropes Source>, brightness: <panels Brightness>,
//               ropes:  { w: 20, h: 400, rgb: <base64 of w*h*3 uint8>, source, brightness, watts: [box1, box2] | null, top?, note? },
//               panels: { w: 256, h: 32, rgb: <base64 of w*h*3 uint8>, source, brightness, output, atlas: [1024, 128], top? } },
//     age_s }                                                                                  <- added here
//   ropes.rgb: row 0 = plug end (Art-Net pixel 0), column c = rope c+1; byte offset of (x, y) = (y*w + x)*3. The canvas colours
//   are as TD holds them; the sender multiplies by ropes.brightness (and the per-box power cap) before Art-Net. With a test or
//   calibration Source (gray, identify, ...) rgb is that pattern, so the simulator shows a calibration as it runs.
//   panels.rgb: a 4x box-downsample of panel_out (the 1024x128 HUB75 atlas, four 256x128 quads in a row), row 0 = top;
//   brightness and black mode are already in it (the layout shader applies them). Either part may be { error } on its own.
//   Failure: { ok: false, error }. decodeFrames() turns the base64 into Uint8Arrays and checks the sizes.
//
// GET /api/pixelmap -> Lights.pixelmap(probe.pixelmap) -> sshPixelmap(): tools/mission/pixelmap.ps1 (newest tools/pixelmap/pixelmap-YYYY-MM-DD.json)
//   { file: 'pixelmap-2026-10-18.json', modified: <ISO, bitcube local time>, meta: { capture, camera, frame_size: [w, h], drift, ... },
//     ropes: { '<rope 0-based>': { visible, filled } }, points: [{ rope (0-based), px (0 = plug end), u, v, visible }, ...],
//     hub75_quad1: { tl, tr, br, bl: [u, v], capture, frame_size, check_px, ... } }      or { error }
//   u, v are normalised camera coordinates in TD's convention (v up): on a still of the same aspect, x = u * W, y = (1 - v) * H.
//   Fetched once per new map: the class refetches when the probe's summary (file, modified) changes.
//
// GET /api/status (the probe, every 60 s) gains two keys from probe.ps1:
//   pixelmap:    { file, date, points, ropes (count), ropes_found: [1-based], ropes_dark: [1-based], hub75_quads: ['hub75_quad1', ...],
//                  camera, frame_size, drift_px, modified } | null (no map yet) | { file, error }
//   calibration: the progress file below when newer than 24 h, else null; plus alive (pid check) and stale: true when running is
//                still true but the process is gone (it crashed before its final write).
//
// POST /api/control/calibrate { action: 'start' | 'cancel' | 'status', dry_run?: bool, decode_only?: 'pixelmap-YYYYMMDD-HHMMSS',
//                               cam?: 'gallery' | 'river', task?: bool }
//   -> Lights.calibrate(action, body) -> planCalibrate() (the whitelist) -> sshCalibrate(): tools/mission/calibrate.ps1
//   start:  { ok, started, pid, log, calibration } | { ok: false, error, calibration? }   (returns at once; the job is detached)
//   cancel: { ok, cancelled, forced, calibration }   forced = it had to be killed: restored is then false and the ropes may still show
//           a pattern (the Ropes control puts them back)
//   status: the progress file | { running: false, none: true }
// Progress file (C:/Users/user/River/calibration.json; Lights.calibration() reads it fresh every few seconds while a run is on):
//   { running, pid, alive?, stale?, mode: 'full' | 'dry-run' | 'decode-only',
//     stage: null | 'ropes-capture' | 'ropes-decode' | 'hub75-capture' | 'hub75-locate' | 'done', stage_index, stages: [...],
//     step, of, expected_s (typical seconds for the stage, for a bar), started, updated (unix s), elapsed_s, message, log: [last lines],
//     ok: null | bool, error: null | string, cancelled, dry_run, decode_only, cam, brightness_cap,
//     before: { Active, Source, Brightness, Graybit, Grayinvert, Panels, Maxbrightness } | null, restored: null | bool,
//     capture: 'pixelmap-YYYYMMDD-HHMMSS' | null, hub75_capture: 'hub75-YYYYMMDD-HHMMSS' | null,
//     capture_info: { mode, drift, lit_camera_px, settle, brightness_cap } | null,
//     result: null | { map, date, points, ropes_found: [1-based], ropes_dark: [1-based], drift_px, hub75_quads, camera, frame_size, capture, dry_run? } }
//   A dry run's result describes the newest existing map (dry_run: true), so the map view can be exercised without lights.
import { execFile } from 'node:child_process';

const PS = 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\user\\River\\river-bitcube\\tools\\mission\\';
export const FRAMES_CACHE_MS = 8_000;
export const CALIBRATION_CACHE_MS = 3_000;
export const PIXELMAP_CACHE_MS = 10 * 60_000;
export const CALIBRATE_ACTIONS = ['start', 'cancel', 'status'];
export const N_ROPES = 20;
const MAP_FILE = /^pixelmap-\d{4}-\d{2}-\d{2}\.json$/;
const CAPTURE_DIR = /^(pixelmap|hub75)-\d{8}-\d{6}$/;

/** Run one tools/mission script on bitcube and parse its JSON line (sshProbe's pattern). Never rejects. */
export function sshJson(sshHost, script, args = '', { timeout = 45_000, maxBuffer = 1 << 20, exec = execFile } = {}) {
  return new Promise((resolve) => {
    exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshHost, `${PS}${script}${args ? ' ' + args : ''}`],
      { timeout, maxBuffer }, (err, stdout) => {
        const line = String(stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
        if (line) { try { return resolve(JSON.parse(line)); } catch { /* fall through */ } }
        const why = !err ? `no answer from ${script}`
          : err.killed ? 'bitcube took too long to answer'
          : err.code === 255 ? "can't reach bitcube over SSH"
          : `${script} failed (exit ${err.code})`;
        resolve({ ok: false, error: why });
      });
  });
}

/** What TD sends to the ropes and the HUB75 now (frames.ps1): td_mission.py's answer with `frames`, or { ok: false, error }. */
export function sshFrames(sshHost, opts = {}) {
  return sshJson(sshHost, 'frames.ps1', '', { timeout: 25_000, maxBuffer: 4 << 20, ...opts });
}

/** The newest pixel map (pixelmap.ps1), or a named one. Rejects (400) on a bad file name; otherwise never rejects. */
export function sshPixelmap(sshHost, { file, ...opts } = {}) {
  if (file != null && file !== '' && !MAP_FILE.test(String(file))) return Promise.reject(bad('file must be pixelmap-YYYY-MM-DD.json'));
  return sshJson(sshHost, 'pixelmap.ps1', file ? `-File ${file}` : '', { timeout: 40_000, maxBuffer: 16 << 20, ...opts });
}

/** calibrate.ps1 -Action start|cancel|status. opts carries the request body (dry_run, decode_only, cam, task) and exec/timeout. */
export function sshCalibrate(sshHost, action, { exec, timeout, maxBuffer, ...body } = {}) {
  const args = planCalibrate(action, body);          // throws 400 before anything runs
  return sshJson(sshHost, 'calibrate.ps1', args, { timeout: timeout ?? 60_000, ...(exec ? { exec } : {}), ...(maxBuffer ? { maxBuffer } : {}) });
}

/** The calibrate whitelist (pure, like planControl): the calibrate.ps1 arguments for a request, or a status-400 error. */
export function planCalibrate(action, body = {}) {
  if (!body || typeof body !== 'object') throw bad('bad body');
  if (!CALIBRATE_ACTIONS.includes(action)) throw bad('action is start, cancel or status');
  if (action !== 'start') return `-Action ${action}`;
  let args = '-Action start';
  if (body.dry_run) args += ' -DryRun';
  if (body.decode_only != null && body.decode_only !== '') {
    if (!CAPTURE_DIR.test(String(body.decode_only))) throw bad('decode_only is a frames folder name like pixelmap-20261018-154155');
    args += ` -DecodeOnly ${body.decode_only}`;
  }
  if (body.cam !== undefined) {
    if (!['gallery', 'river'].includes(body.cam)) throw bad('cam is gallery or river');
    args += ` -Cam ${body.cam}`;
  }
  if (body.task) args += ' -Task';
  return args;
}

/** frames (or the whole /api/lights payload) -> { at, source, brightness, ropes, panels } with rgb as Uint8Array (h*w*3, row 0
 *  first), each part keeping its other fields; a part that failed or has the wrong size carries `error` instead of rgb. */
export function decodeFrames(payload) {
  const f = payload && typeof payload === 'object' && payload.frames ? payload.frames : payload;
  if (!f || typeof f !== 'object') throw new Error('no frames');
  const part = (p) => {
    if (!p || typeof p !== 'object') return { error: 'missing' };
    if (p.error) return { ...p };
    const { w, h, rgb, ...rest } = p;
    if (!Number.isInteger(w) || !Number.isInteger(h) || typeof rgb !== 'string') return { ...rest, w, h, error: 'bad frame' };
    const bytes = Buffer.from(rgb, 'base64');
    if (bytes.length !== w * h * 3) return { ...rest, w, h, error: `rgb holds ${bytes.length} bytes, expected ${w * h * 3}` };
    return { ...rest, w, h, rgb: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) };
  };
  return { at: f.at, source: f.source, brightness: f.brightness, ropes: part(f.ropes), panels: part(f.panels) };
}

/** [r, g, b] of pixel (x, y) in a decoded part, or null outside it / without rgb. */
export function rgbAt(part, x, y) {
  if (!part?.rgb || x < 0 || y < 0 || x >= part.w || y >= part.h) return null;
  const i = (y * part.w + x) * 3;
  return [part.rgb[i], part.rgb[i + 1], part.rgb[i + 2]];
}

/** The probe's `pixelmap` summary, computed from a full map (same rules as probe.ps1 and calibrate.summarize_map). */
export function summarizePixelmap(map) {
  if (!map || typeof map !== 'object' || map.error) return null;
  const found = Object.entries(map.ropes ?? {}).filter(([, v]) => (v?.visible ?? 0) > 0).map(([k]) => Number(k) + 1).sort((a, b) => a - b);
  const dark = []; for (let r = 1; r <= N_ROPES; r++) if (!found.includes(r)) dark.push(r);
  return { file: map.file ?? null, date: (map.file ?? '').match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, points: (map.points ?? []).length,
           ropes: found.length, ropes_found: found, ropes_dark: dark, hub75_quads: Object.keys(map).filter((k) => /^hub75_quad\d+$/.test(k)).sort(),
           camera: map.meta?.camera ?? null, frame_size: map.meta?.frame_size ?? null, drift_px: map.meta?.drift ?? null, modified: map.modified ?? null };
}

/** A made-up but well-formed frames answer for fixture mode (MISSION_FIXTURES: nothing talks to bitcube): a slow river wash
 *  down every rope and the four-quad atlas, animated by t (ms) so a polling page sees movement. Same shape as sshFrames. */
export function syntheticFrames(t = Date.now(), { w = 20, h = 400, source = 'canvas' } = {}) {
  const ropes = Buffer.alloc(w * h * 3);
  const phase = (t / 1000) % 1e6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const wave = 0.5 + 0.5 * Math.sin(y / 23 - phase * 0.9 + x * 0.6);
      const drop = ((y + Math.floor(phase * 60) + x * 37) % 97) < 3 ? 1 : 0;
      const i = (y * w + x) * 3;
      ropes[i] = Math.round(255 * Math.min(1, drop + 0.05 * wave));
      ropes[i + 1] = Math.round(255 * Math.min(1, drop + 0.35 * wave));
      ropes[i + 2] = Math.round(255 * Math.min(1, drop + 0.25 + 0.55 * wave));
    }
  }
  const pw = 256, ph = 32;
  const panels = Buffer.alloc(pw * ph * 3);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const q = Math.floor(x / 64);                                   // four quads, 64 px each in the downsample
      const v = 0.5 + 0.5 * Math.sin((x % 64) / 9 + y / 5 - phase * (0.6 + q * 0.2));
      const i = (y * pw + x) * 3;
      panels[i] = Math.round(30 * v); panels[i + 1] = Math.round(120 * v); panels[i + 2] = Math.round(200 * v + 20);
    }
  }
  return { ok: true, action: 'frames', file: 'river-local-oct-22-seasons.toe', fps: 60, synthetic: true,
           frames: { at: t / 1000, source, brightness: 1,
                     ropes: { w, h, rgb: ropes.toString('base64'), source, brightness: 0.4, watts: [182, 191] },
                     panels: { w: pw, h: ph, rgb: panels.toString('base64'), source: 'canvas', brightness: 1, output: true, atlas: [1024, 128] } } };
}

/** rope (0-based) -> its points in px order, for drawing each rope as a path. */
export function ropePaths(map) {
  const by = new Map();
  for (const p of map?.points ?? []) { if (!by.has(p.rope)) by.set(p.rope, []); by.get(p.rope).push(p); }
  for (const pts of by.values()) pts.sort((a, b) => a.px - b.px);
  return by;
}

export class Lights {
  constructor({ sshHost = 'bitcube', frames = sshFrames, pixelmap = sshPixelmap, calibrate = sshCalibrate, now = () => Date.now(),
                framesCacheMs = FRAMES_CACHE_MS, calibrationCacheMs = CALIBRATION_CACHE_MS, pixelmapCacheMs = PIXELMAP_CACHE_MS } = {}) {
    Object.assign(this, { sshHost, fetchFrames: frames, fetchPixelmap: pixelmap, fetchCalibrate: calibrate, now,
                          framesCacheMs, calibrationCacheMs, pixelmapCacheMs });
    this.cache = { frames: {}, pixelmap: {}, calibration: {} };
  }

  #cached(slot, maxAge, fetch) {
    const c = this.cache[slot];
    if (c.value !== undefined && this.now() - c.at < maxAge) return Promise.resolve(c.value);
    if (!c.pending) c.pending = fetch().then((v) => { c.value = v; c.at = this.now(); return v; }).finally(() => { c.pending = null; });
    return c.pending;
  }

  /** The newest frames (cached framesCacheMs, one fetch at a time): sshFrames' answer plus age_s. */
  async frames() {
    const v = await this.#cached('frames', this.framesCacheMs, () => this.fetchFrames(this.sshHost));
    return { ...v, age_s: Math.round((this.now() - this.cache.frames.at) / 1000) };
  }

  /** The pixel map, fetched once per new file: pass the probe's pixelmap summary ({ file, modified }) when there is one;
   *  without one the newest map is fetched and kept for pixelmapCacheMs. */
  pixelmap(summary = null) {
    const c = this.cache.pixelmap;
    const key = summary?.file ? `${summary.file}@${summary.modified ?? ''}` : null;
    const fresh = c.value && !c.value.error && (key ? c.key === key : this.now() - c.at < this.pixelmapCacheMs);
    if (fresh) return Promise.resolve(c.value);
    if (!c.pending || c.pendingKey !== key) {
      c.pendingKey = key;
      c.pending = this.fetchPixelmap(this.sshHost, { file: summary?.file || undefined })
        .then((v) => { if (v && !v.error) { c.value = v; c.at = this.now(); c.key = key ?? (v.file ? `${v.file}@${v.modified ?? ''}` : null); } return v; })
        .finally(() => { c.pending = null; });
    }
    return c.pending;
  }

  /** Live progress of the calibration job (calibrate.ps1 -Action status), cached calibrationCacheMs. */
  calibration() { return this.#cached('calibration', this.calibrationCacheMs, () => this.fetchCalibrate(this.sshHost, 'status')); }

  /** start | cancel (| status). The whitelist is planCalibrate (throws 400); the answer's progress refreshes the status cache. */
  async calibrate(action, body = {}) {
    planCalibrate(action, body);
    const r = await this.fetchCalibrate(this.sshHost, action, { ...body });
    this.cache.calibration = r && r.calibration && typeof r.calibration === 'object' ? { value: r.calibration, at: this.now() } : {};
    return r;
  }
}

function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }
