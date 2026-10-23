// Mission control's data and controls (docs/mission-plan.md). The server polls each source on its own
// timer and serves one combined snapshot; controls are fixed actions with checked arguments, never
// arbitrary commands.
import { execFile } from 'node:child_process';
import { connect } from 'node:net';

const PS = 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\user\\River\\river-bitcube\\tools\\mission\\';
const PROBE = PS + 'probe.ps1';
export const CAMERAS = ['gallery', 'river'];
const SNAP_CACHE_MS = 45_000;
// Show files mission control may open (the online one keeps its old name until step S1.1 renames it).
export const BOOT_FILES = ['river-local-oct-22-seasons.toe', 'river-online-oct-20.toe', 'river-local-oct-18.toe'];
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

  #set(name, value, error) { this.data[name] = { at: this.now(), ...(error ? { error: String(error) } : { value }) }; }

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
    switch (action) {
      case 'mode': {
        if (!MODES.includes(body.mode)) throw bad('mode must be automatic, dynamic or manual');
        return this.#seasons('/mode', { mode: body.mode });
      }
      case 'target': {
        const t = {};
        if (body.season !== undefined) { if (!SEASONS.includes(body.season)) throw bad('unknown season'); t.season = body.season; }
        if (body.intensity !== undefined) { const x = Number(body.intensity); if (!(x >= 0 && x <= 1)) throw bad('intensity is 0 to 1'); t.intensity = x; }
        return this.#seasons('/target', t);
      }
      case 'rules': {
        const r = {};
        for (const [k, v] of Object.entries(body.rules ?? {})) { if (!/^[a-z_]{1,40}$/.test(k) || !Number.isFinite(Number(v))) throw bad('bad rule'); r[k] = Number(v); }
        return this.#seasons('/rules', r);
      }
      case 'rules-reset': return this.#seasons('/rules/reset', {});
      case 'ropes': return this.#probeAction(`-Action ropes${body.dark ? ' -Dark' : ''}`);
      case 'hub75': {
        const x = Number(body.brightness);
        if (!(x >= 0 && x <= 1)) throw bad('brightness is 0 to 1');
        return this.#probeAction(`-Action hub75 -Brightness ${x.toFixed(2)}`);
      }
      case 'bootfile': case 'switch': {
        if (!BOOT_FILES.includes(body.file)) throw bad('unknown show file');
        return this.#probeAction(`-Action ${action} -BootFile ${body.file}`);
      }
      default: throw bad('unknown action');
    }
  }

  async #seasons(path, body) {
    const r = await getJson(`${this.seasonsUrl}${path}`, 5000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    this.#set('seasons', r);
    return r;
  }

  async #probeAction(args) {
    const r = await this.probe(this.sshHost, args);
    if (r.ok !== false || r.td) this.#set('probe', r);
    return r;
  }
}

function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }
