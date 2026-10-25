// Mission control's data and controls (docs/mission-plan.md). The server polls each source on its own
// timer and serves one combined snapshot; controls are fixed actions with checked arguments, never
// arbitrary commands. planControl is the whitelist on its own (pure), shared with fixture mode.
import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { scrubCreds } from './scrub.mjs';

const PS = 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\user\\River\\river-bitcube\\tools\\mission\\';
const PROBE = PS + 'probe.ps1';
export const CAMERAS = ['gallery', 'river'];
const SNAP_CACHE_MS = 45_000;
/** Controls refused while a calibration runs (model.js refuses the same ones on the pages). A rebuild ends in the switch
 *  path (TouchDesigner stopped and restarted), so it spoils a run as surely as a switch. */
export const CAL_BLOCKED = ['ropes', 'hub75', 'switch', 'lightsroute', 'rebuild'];
/** The 409 a control gets while a calibration runs (shared with fixture mode), or null. */
export function calBlocked(action, cal) {
  if (!CAL_BLOCKED.includes(action) || cal?.running !== true || cal.stale === true) return null;
  return Object.assign(new Error('a calibration is running: stop it on the Lights page first'), { status: 409 });
}
// Show files mission control may open: the river's year and the live river. Retired files start with old- (D27) and
// are never offered, for the boot file or a switch.
export const BOOT_FILES = ['river-local-oct-22-seasons.toe', 'river-online-oct-23.toe'];
// The only show file a rebuild may bake the LED map into: the river's year (build_seasons_local.py refuses any other).
export const REBUILD_FILES = ['river-local-oct-22-seasons.toe'];
export const MODES = ['automatic', 'dynamic', 'manual'];
export const SEASONS = ['winter', 'spring', 'summer', 'autumn'];

export function tcpUp(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const s = connect({ host, port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export function sshProbe(sshHost, args = '', timeout = 45_000) {
  return new Promise((resolve) => {
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshHost, `${PROBE} ${args}`],
      { timeout, maxBuffer: 1 << 20 }, (err, stdout) => {
        const line = String(stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
        if (line) { try { return resolve(JSON.parse(line)); } catch { /* fall through */ } }
        const why = !err ? 'no answer from the probe'
          : err.killed ? 'bitcube took too long to answer'
          : err.code === 255 ? "can't reach bitcube over SSH"
          : `probe failed (exit ${err.code})`;
        resolve({ ok: false, error: why });
      });
  });
}

/** One camera still through bitcube (tools/mission/snap.ps1): a JPEG Buffer, or null. */
export function sshSnap(sshHost, cam, timeout = 30_000) {
  return new Promise((resolve) => {
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshHost, `${PS}snap.ps1 -Camera ${cam}`],
      { timeout, maxBuffer: 8 << 20 }, (_err, stdout) => {
        const b64 = String(stdout ?? '').trim().split('\n').pop().trim();
        resolve(/^[A-Za-z0-9+/=]{1000,}$/.test(b64) ? Buffer.from(b64, 'base64') : null);
      });
  });
}

async function getJson(url, timeout = 5000, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `HTTP ${r.status}`), { status: r.status, body });
  return body;
}

export class Mission {
  constructor({ bitcubeHost = '100.73.68.60', sshHost = 'bitcube', seasonsUrl = 'http://100.73.68.60:9981',
                modalUrl = 'https://to-be-a-river--river.modal.run', riverCam = { host: '192.168.8.217', port: 554 },
                probe = sshProbe, snap = sshSnap, now = () => Date.now() } = {}) {
    Object.assign(this, { bitcubeHost, sshHost, seasonsUrl, modalUrl, riverCam, probe, snap, now });
    this.snaps = {};         // cam -> { at, jpeg, pending }
    this.data = {};          // source -> { at, value | error }
    this.timers = [];
  }

  #set(name, value, error) {
    // a failure keeps when the failures in a row began (failing_since), so "failing for 52 min" can grow past one poll
    const prev = this.data[name], t = this.now();
    // never a login in what the pages are served (a camera's RTSP address in an ffmpeg line, see scrub.mjs)
    this.data[name] = { at: t, ...(error ? { error: scrubCreds(String(error)), failing_since: prev?.error ? prev.failing_since ?? prev.at : t } : { value: scrubCreds(value) }) };
  }

  async pollFast() {
    // Only bitcube itself is reachable from the mini; everything behind it is checked by the probe.
    this.#set('bitcube', { online: await tcpUp(this.bitcubeHost, 22) });
    try { this.#set('seasons', await getJson(`${this.seasonsUrl}/state`, 4000)); } catch (e) { this.#set('seasons', null, e.message); }
  }

  async pollModal() {
    try {
      const [st, sc] = await Promise.all([getJson(`${this.modalUrl}/data/status.json`), getJson(`${this.modalUrl}/data/state.json`)]);
      this.#set('modal', { tick: st.tick, mood: st.mood, ok: st.ok, finished_at: st.finished_at, next_tick_epoch: st.next_tick_epoch,
                           scene: sc.scene && { animation: sc.scene.animation, palette: sc.scene.palette_name, colors: sc.scene.colors,
                                                speed: sc.scene.speed, turbulence: sc.scene.turbulence }, set_at: sc.set_at });
    } catch (e) { this.#set('modal', null, e.message); }
  }

  async pollProbe() {
    const r = await this.probe(this.sshHost);
    if (r.ok === false && !r.td) this.#set('probe', null, r.error); else this.#set('probe', r);
  }

  start() {
    const every = (fn, ms) => { fn().catch(() => {}); this.timers.push(setInterval(() => fn().catch(() => {}), ms)); };
    every(() => this.pollFast(), 5000);
    every(() => this.pollModal(), 30_000);
    every(() => this.pollProbe(), 60_000);
  }

  stop() { this.timers.forEach(clearInterval); this.timers = []; }

  snapshot() {
    const out = {};
    for (const [k, v] of Object.entries(this.data)) out[k] = { ...v, age_s: Math.round((this.now() - v.at) / 1000) };
    return out;
  }

  /** The newest still of a camera (cached; one fetch at a time). */
  async camera(cam) {
    if (!CAMERAS.includes(cam)) throw bad('unknown camera');
    const c = this.snaps[cam] ?? (this.snaps[cam] = {});
    if (c.jpeg && this.now() - c.at < SNAP_CACHE_MS) return c;
    if (!c.pending) c.pending = this.snap(this.sshHost, cam).then((j) => { if (j) { c.jpeg = j; c.at = this.now(); } c.tried = this.now(); }).finally(() => { c.pending = null; });
    await c.pending;
    return c;
  }

  // ---- controls (fixed actions) ----------------------------------------------------------------------
  async control(action, body = {}) {
    const plan = planControl(action, body);
    // a calibration photographs the ropes and the panels: anything that changes them, restarts TouchDesigner or moves the
    // lighting port spoils the run (the pages refuse these too; this covers the studio chat and a stale page)
    const blocked = calBlocked(action, this.data.probe?.value?.calibration);
    if (blocked) throw blocked;
    if (plan.kind === 'seasons') return this.#seasons(plan.path, plan.body);
    // a rebuild, a switch or a boot-file change at a time: two phones pressing Rebuild must not run two builds and two restarts
    if (EXCLUSIVE.includes(action)) {
      if (this.busy) throw Object.assign(new Error(`${this.busy === 'rebuild' ? 'a rebuild' : 'a show-file change'} is already running; wait for it to finish`), { status: 409 });
      this.busy = action;
      try { return await this.#probeAction(plan.args, plan.timeout, action); } finally { this.busy = null; }
    }
    return this.#probeAction(plan.args, plan.timeout, action);
  }

  async #seasons(path, body) {
    const r = await getJson(`${this.seasonsUrl}${path}`, 5000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    this.#set('seasons', r);
    return r;
  }

  async #probeAction(args, timeout, action = null) {
    const r = await this.probe(this.sshHost, args, timeout);
    if (r.ok !== false || r.td) this.#set('probe', r);
    // the answer goes to the page as it is: every log line in it (modal_link.*.last, recorder.last) is scrubbed as the snapshot is
    return scrubCreds(actionResult(action, r));
  }
}

const EXCLUSIVE = ['rebuild', 'switch', 'bootfile'];
/** Ropes and panels act through TouchDesigner: when its own answer says it failed, the action failed, whatever the probe's
 *  top-level ok says (a probe.ps1 from before 24 Oct reported ok: true with td.ok false). */
export function actionResult(action, r) {
  if ((action === 'ropes' || action === 'hub75') && r && r.ok !== false && r.td && r.td.ok === false) {
    return { ...r, ok: false, error: String(r.td.error || 'TouchDesigner did not answer') };
  }
  return r;
}

/** The control whitelist: what a fixed action would do, with its arguments checked. Pure, so fixture mode checks
 *  requests exactly as the real server does. Returns { kind: 'seasons', path, body } (a POST to the seasons page)
 *  or { kind: 'probe', args, timeout? } (probe.ps1 on bitcube); anything else is a status-400 error. */
export function planControl(action, body = {}) {
  if (!body || typeof body !== 'object') throw bad('bad body');
  switch (action) {
    case 'mode': {
      if (!MODES.includes(body.mode)) throw bad('mode must be automatic, dynamic or manual');
      return { kind: 'seasons', path: '/mode', body: { mode: body.mode } };
    }
    case 'target': {
      const t = {};
      if (body.season !== undefined) { if (!SEASONS.includes(body.season)) throw bad('unknown season'); t.season = body.season; }
      if (body.intensity !== undefined) { const x = num(body.intensity); if (!(x >= 0 && x <= 1)) throw bad('intensity is 0 to 1'); t.intensity = x; }
      return { kind: 'seasons', path: '/target', body: t };
    }
    case 'rules': {
      const r = {};
      for (const [k, v] of Object.entries(body.rules ?? {})) { if (!/^[a-z_]{1,40}$/.test(k) || !Number.isFinite(num(v))) throw bad('bad rule'); r[k] = num(v); }
      return { kind: 'seasons', path: '/rules', body: r };
    }
    case 'rules-reset': return { kind: 'seasons', path: '/rules/reset', body: {} };
    case 'ropes': return { kind: 'probe', args: `-Action ropes${body.dark === true ? ' -Dark' : ''}` };   // only a real true goes dark
    case 'hub75': {
      const x = num(body.brightness);
      if (!(x >= 0 && x <= 1)) throw bad('brightness is 0 to 1');
      return { kind: 'probe', args: `-Action hub75 -Brightness ${x.toFixed(2)}` };
    }
    case 'bootfile': case 'switch': {
      if (!BOOT_FILES.includes(body.file)) throw bad('unknown show file');
      return { kind: 'probe', args: `-Action ${action} -BootFile ${body.file}` };
    }
    case 'rebuild': {
      // Bake the newest LED map into the river's year (probe.ps1 -Action rebuild: build, save, then the switch path; minutes).
      if (!REBUILD_FILES.includes(body.file)) throw bad("rebuild is only for the river's year");
      return { kind: 'probe', args: `-Action rebuild -BootFile ${body.file}`, timeout: 400_000 };
    }
    case 'lightsroute': {
      if (!['direct', 'router'].includes(body.route)) throw bad('route is direct or router');
      return { kind: 'probe', args: `-Action lightsroute -LightsRoute ${body.route}` };
    }
    default: throw bad('unknown action');
  }
}

function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }
/** A number from a request: a number, or a string that is one ("0.8"); null, "", false, [] and true are NaN, never 0. */
export function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(v)) return Number(v);
  return NaN;
}
