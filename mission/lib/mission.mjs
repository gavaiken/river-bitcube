// Mission control's data and controls (docs/mission-plan.md). The server polls each source on its own
// timer and serves one combined snapshot; controls are fixed actions with checked arguments, never
// arbitrary commands. planControl is the whitelist on its own (pure), shared with fixture mode.
import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { scrubCreds } from './scrub.mjs';
import { Applying } from './applying.mjs';
import { checkedCalibrate, noAnswer } from './lights.mjs';
import { CAL_RUNNING, changeLabel, tdStartingWhy, TD_UNREADABLE_WHY, calNoLights } from '../public/model.js';

const PS = 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\user\\River\\river-bitcube\\tools\\mission\\';
const PROBE = PS + 'probe.ps1';
export const CAMERAS = ['gallery', 'river'];
const SNAP_CACHE_MS = 45_000;
/** Controls refused while a calibration runs (model.js refuses the same ones on the pages). A rebuild ends in the switch
 *  path (TouchDesigner stopped and restarted), so it spoils a run as surely as a switch. A dry run (or a decode of earlier
 *  photos) touches no lights, camera or TouchDesigner: it refuses none of them (R7 #20). */
export const CAL_BLOCKED = ['ropes', 'hub75', 'switch', 'lightsroute', 'rebuild'];
/** The 409 a switch or a rebuild gets while TouchDesigner is starting or restarting (model.js tdStartingWhy, the pages' words; shared
 *  with fixture mode), or null. probe: the full check's reading as kept ({ at, value } or { at, error }), judged by itself, never
 *  the whole page model; a reading the rule can't read, or a slip in it, refuses (closed, CR9 #11). */
export function startingBlocked(action, probe) {
  if (action !== 'switch' && action !== 'rebuild') return null;
  let why;
  try { const p = probe && typeof probe === 'object' ? probe : null; why = tdStartingWhy(p && !p.error ? p.value ?? null : null); } catch { why = TD_UNREADABLE_WHY; }
  return why ? Object.assign(new Error(why), { status: 409 }) : null;
}
/** The 409 a control gets while a calibration runs (shared with fixture mode), or null. */
export function calBlocked(action, cal) {
  if (!CAL_BLOCKED.includes(action) || cal?.running !== true || cal.stale === true || calNoLights(cal)) return null;   // model.js: one rule
  return Object.assign(new Error(CAL_RUNNING), { status: 409 });
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

export function sshProbe(sshHost, args = '', timeout = 45_000, { exec = execFile } = {}) {
  return new Promise((resolve) => {
    exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshHost, `${PROBE} ${args}`],
      { timeout, maxBuffer: 1 << 20 }, (err, stdout) => {
        const line = String(stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
        if (line) { try { return resolve(JSON.parse(line)); } catch { /* fall through */ } }
        resolve(noAnswer(err, 'probe', 'the probe'));
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
  let r;
  try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw Object.assign(e, { timedOut: e?.name === 'TimeoutError' || e?.name === 'AbortError' }); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `HTTP ${r.status}`), { status: r.status, body });
  return body;
}

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const CAL_NONE_GRACE_MS = 30_000;              // a "no job" answer this soon after the kept copy may be a start racing its file
const CAL_KEEP_S = 24 * 3600;                 // probe.ps1 reports a progress file from the last 24 h, and so does the newest-copy rule
export const CAL_POLL_MS = 5_000;             // while a run is on, the server reads its progress itself this often
/** After a switch or rebuild answers, the full check is asked again this soon (as well as on its 60 s timer), so the change is
 *  confirmed (TouchDesigner answering on the file) about when it is real: the launcher waits 10 s, then opens the file. */
export const RECHECK_MS = [15_000, 45_000];
/** A calibration start that wasn't a clear refusal holds its lock ('starting') while the server reads the progress every
 *  CAL_POLL_MS, this many times (about a minute), until the new run's file shows up. */
export const CAL_START_READS = 12;

/** A rebuild that went all the way: built, saved and restarted on the file (probe.ps1 -Action rebuild; ok false names the step). */
export function rebuildSucceeded(r) { return !!r && r.ok !== false && r.rebuilt !== false && r.saved !== false; }

export class Mission {
  // lights: the Lights instance (lib/lights.mjs) the calibration goes through; stateDir: where the last rebuild is kept (null: memory)
  constructor({ bitcubeHost = '100.73.68.60', sshHost = 'bitcube', seasonsUrl = 'http://100.73.68.60:9981',
                modalUrl = 'https://to-be-a-river--river.modal.run', riverCam = { host: '192.168.8.217', port: 554 },
                probe = sshProbe, snap = sshSnap, now = () => Date.now(), lights = null, stateDir = null,
                later = (fn, ms) => setTimeout(fn, ms).unref?.(), recheckMs = RECHECK_MS, seasonsTimeoutMs = 5000 } = {}) {
    // later(fn, ms): the timer the follow-up reads use (a test passes its own); seasonsTimeoutMs: a seasons page POST's limit
    Object.assign(this, { bitcubeHost, sshHost, seasonsUrl, modalUrl, riverCam, probe, snap, now, lights, stateDir, later, recheckMs, seasonsTimeoutMs });
    this.snaps = {};         // cam -> { at, jpeg, pending }
    this.data = {};          // source -> { at, value | error }
    this.askedAt = {};       // source -> when the reading kept in data was asked (a full check: an older one never replaces it)
    this.timers = [];
    this.applying = new Applying({ now });     // every control in flight (status.applying; the 409 "wait: ...")
    this.calNote = null;     // { at, value }: the newest progress file Lights answered with (start, cancel, a progress read)
    this.lastRebuild = this.#readRebuilt();
  }

  /** Keep a source's reading (or its failure). asked: when it was asked (ms); a reading asked before the one already kept is
   *  older news and is dropped (a full check on its 60 s timer, asked before a switch answered, landing after the switch's own
   *  reading: it would put TouchDesigner back on the file it is restarting on). Returns whether it was kept. */
  #set(name, value, error, asked = null) {
    if (asked != null && this.askedAt[name] != null && asked < this.askedAt[name]) return false;
    if (asked != null) this.askedAt[name] = asked;
    // a failure keeps when the failures in a row began (failing_since), so "failing for 52 min" can grow past one poll
    const prev = this.data[name], t = this.now();
    // never a login in what the pages are served (a camera's RTSP address in an ffmpeg line, see scrub.mjs)
    this.data[name] = { at: t, ...(error ? { error: scrubCreds(String(error)), failing_since: prev?.error ? prev.failing_since ?? prev.at : t } : { value: scrubCreds(value) }) };
    return true;
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
    const asked = this.now();
    const r = await this.probe(this.sshHost);
    // kept only when asked after the reading already kept (pollProbe and a control's own reading race: R7 #25)
    if (r.ok === false && !r.td) this.#set('probe', null, r.error, asked); else this.#set('probe', r, null, asked);
    // a switch or rebuild that answered before this check was asked is done once TouchDesigner answers on its file
    if (r.td) this.applying.confirm(scrubCreds(r), asked);
  }

  /** Whether anything is being applied or confirmed (a self-update restart waits for nothing to be in flight). */
  busy() { return this.applying.list().length > 0; }

  /** The label a change gets (model.js changeLabel, as its entry has it): a switch to the file TouchDesigner runs is "the restart on …". */
  label(action, body) { return changeLabel(action, body, { running: this.data.probe?.value?.td?.file ?? null }); }

  /** After a switch or rebuild answered: look again sooner than the 60 s timer, so the confirmation arrives when it is real. */
  #recheckSoon() {
    for (const ms of this.recheckMs) this.later(() => { if (this.busy()) this.pollProbe().catch(() => {}); }, ms);
  }

  start() {
    const every = (fn, ms) => { fn().catch(() => {}); this.timers.push(setInterval(() => fn().catch(() => {}), ms)); };
    every(() => this.pollFast(), 5000);
    every(() => this.pollModal(), 30_000);
    every(() => this.pollProbe(), 60_000);
    every(() => this.pollCalibration(), CAL_POLL_MS);
  }

  stop() { this.timers.forEach(clearInterval); this.timers = []; }

  snapshot() {
    const out = {};
    for (const [k, v] of Object.entries(this.data)) out[k] = { ...v, age_s: Math.round((this.now() - v.at) / 1000) };
    // the calibration the pages see is the newest copy there is (Lights' own answer can be up to a minute ahead of the probe)
    const cal = this.calibration();
    // a copy from Lights' own answer carries how long ago it was read, so every page counts the run's time left from that,
    // not from the full check's age (up to a minute older): the Lights card, the tiles and the band agree (R6 #33)
    const served = cal && cal === this.calNote?.value ? { ...cal, read_age_s: Math.max(0, Math.round((this.now() - this.calNote.at) / 1000)) } : cal;
    if (obj(out.probe?.value) && served !== (out.probe.value.calibration ?? null)) out.probe = { ...out.probe, value: { ...out.probe.value, calibration: served } };
    out.applying = this.applying.list();
    // the server's verdict on every change it confirmed or gave up on in the last 10 min: a page confirms its own switch,
    // restart, rebuild or boot-file change only by its entry's id here, never from a file name (R7 #6, #25)
    const ended = this.applying.ended();
    out.confirmed = ended.confirmed;
    out.expired = ended.expired;
    out.failed = ended.failed;      // refused or failed: a page whose answer was lost learns it by its request id (R10 #31)
    return out;
  }

  // ---- the calibration job: the newest copy of its progress file -------------------------------------------------
  // The full check carries the progress file, but it runs once a minute; Lights' answers (a start, a cancel, a progress read)
  // are newer the moment they arrive. Whichever copy bitcube wrote last (its `updated`) is the state, so the lock on the
  // ropes, the panels, a switch, a rebuild and the lighting port holds from the first second of a run and ends with it.

  /** Keep a progress file Lights answered with, when it is at least as new as the one kept. A failed read ({ ok: false,
   *  error }) changes nothing; a copy without its updated stamp counts as now. "No job" ({ running: false, none: true }) means the
   *  progress file is gone: it ends a kept run, but only once the start is CAL_NONE_GRACE_MS behind (just after a start the file
   *  may not be written yet), so a run whose file vanished never locks the controls for the rest of the day. */
  noteCalibration(cal) {
    const c = obj(cal);
    if (c?.none === true) { if (this.calNote && this.now() - this.calNote.at > CAL_NONE_GRACE_MS) this.calNote = null; return; }
    if (!c || typeof c.running !== 'boolean') return;
    const u = typeof c.updated === 'number' && Number.isFinite(c.updated) ? c.updated : this.now() / 1000;
    if (this.calNote && u < this.calNote.u) return;
    // the same write read again keeps its first read time (read_age_s ages the copy's elapsed_s from it)
    const at = this.calNote && u === this.calNote.u ? this.calNote.at : this.now();
    this.calNote = { at, u, value: scrubCreds(c) };
  }

  /** The calibration job as the newest copy says (the probe's or Lights'), or null: none in the last 24 h. */
  calibration() {
    const pr = obj(this.data.probe?.value?.calibration), n = this.calNote;
    if (!n || this.now() / 1000 - n.u > CAL_KEEP_S) return pr;
    const pu = typeof pr?.updated === 'number' ? pr.updated : -Infinity;
    // the same file read twice: the later read knows more (alive, stale are judged as it is read)
    if (n.u > pu || (n.u === pu && n.at >= (this.data.probe?.at ?? -Infinity))) return n.value;
    return pr;
  }

  /** GET /api/calibration: the job's progress now (Lights.calibration, cached a few seconds), kept as the newest copy. */
  async calibrationStatus() {
    if (!this.lights) throw Object.assign(new Error('no calibration here'), { status: 503 });
    const r = await this.lights.calibration();
    this.noteCalibration(r);
    return r;
  }

  /** While a run is on, read its progress (every CAL_POLL_MS from start()), so the lock ends with the run even with no page open. */
  async pollCalibration() {
    const c = this.calibration();
    if (!this.lights || c?.running !== true || c.stale === true) return;
    await this.calibrationStatus();
  }

  /** POST /api/control/calibrate: start, cancel or status through Lights (planCalibrate is the whitelist). A start is a change
   *  in flight (it waits for a switch, rebuild or boot-file change, and those wait for it); a cancel always goes through. A start
   *  that isn't a clear refusal but whose run hasn't shown up yet (calibrate.ps1's first write can take longer than its 6 s wait,
   *  or the call timed out) keeps its lock as 'starting' while the progress is read every CAL_POLL_MS, for about a minute,
   *  until the new run's file shows up: the run's own state then holds the lock (calBlocked), from its first second. */
  async calibrate(action, body = {}, { source = 'mission control', requestId = null } = {}) {
    const checked = checkedCalibrate(action, body);
    if (!this.lights) throw Object.assign(new Error('no calibration here'), { status: 503 });
    const before = typeof this.calibration()?.started === 'number' ? this.calibration().started : null;   // bitcube's clock
    let isNew = () => false;
    return this.applying.run('calibrate', checked, async () => {
      const r = await this.lights.calibrate(action, checked);
      this.noteCalibration(r?.calibration);
      if (action === 'start') isNew = newRunTest(r, before, this.now());
      return r;
    }, { source, requestId, awaits: (r) => action === 'start' && startPending(r, isNew), onPending: (e) => this.#watchStart(e.id, isNew) });
  }

  /** A start whose run hasn't shown up: read the progress every CAL_POLL_MS until the run's file is there (its lock then holds
   *  it), or CAL_START_READS reads have passed; either way the start's own lock ends. */
  #watchStart(id, isNew, n = 1) {
    this.later(async () => {
      if (!this.applying.has(id)) return;
      let c = null;
      try { c = await this.lights.calibration(); this.noteCalibration(c); } catch { /* a failed read: try again */ }
      if (isNew(c) || isNew(this.calibration())) this.applying.release(id, 'confirmed');
      else if (n >= CAL_START_READS) this.applying.release(id, 'expired');
      else this.#watchStart(id, isNew, n + 1);
    }, CAL_POLL_MS);
  }

  // ---- the last rebuild: which LED map the river's year uses ------------------------------------------------------
  /** { at, map, file, run } of the last rebuild that went all the way and was confirmed (TouchDesigner answering on the file
   *  after it), or null. */
  rebuilt() { return this.lastRebuild ? { ...this.lastRebuild } : null; }

  /** What a rebuild baked in, read at its answer: the map (the answer's, else the run's result, else the newest on bitcube),
   *  the file, and the run whose map it is. Recorded as the map in use only once the rebuild is confirmed (R7 #26). */
  #rebuildOf(file, r) {
    const cal = this.calibration();
    const map = (typeof r?.pixelmap?.file === 'string' && r.pixelmap.file) || cal?.result?.map || this.data.probe?.value?.pixelmap?.file || null;
    // the run whose map this is, by its own started stamp (bitcube's clock): a page matches it exactly, never across two clocks
    const run = cal && cal.ok === true && cal.result?.map === map && typeof cal.started === 'number' ? cal.started : null;
    return { map, file, run };
  }

  #recordRebuilt({ map, file, run }) {
    this.lastRebuild = { at: this.now(), map, file, run };
    if (!this.stateDir) return;
    try {
      mkdirSync(this.stateDir, { recursive: true });
      const f = join(this.stateDir, 'rebuilt.json');
      writeFileSync(`${f}.tmp`, JSON.stringify(this.lastRebuild) + '\n');
      renameSync(`${f}.tmp`, f);
    } catch (e) { console.warn(`rebuilt.json: ${e.message}`); }
  }

  #readRebuilt() {
    if (!this.stateDir) return null;
    try {
      const j = JSON.parse(readFileSync(join(this.stateDir, 'rebuilt.json'), 'utf8'));
      return obj(j) && typeof j.at === 'number' ? { at: j.at, map: typeof j.map === 'string' ? j.map : null, file: typeof j.file === 'string' ? j.file : null,
                                                    run: typeof j.run === 'number' ? j.run : null } : null;
    } catch { return null; }
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
  async control(action, body = {}, _scenario = null, { source = 'mission control', requestId = null } = {}) {
    const plan = planControl(action, body);
    const checked = checkedControl(action, body);     // only what the whitelist read goes into status.applying
    // a calibration photographs the ropes and the panels: anything that changes them, restarts TouchDesigner or moves the
    // lighting port spoils the run (the pages refuse these too; this covers the studio chat and a stale page)
    const blocked = calBlocked(action, this.calibration());
    if (blocked) throw blocked;
    // never a switch or rebuild while TouchDesigner opens a file by itself (bitcube's own boot, a crash relaunch: no entry holds
    // it): the pages grey both, and a second switch kills the half-opened file (R9 #34)
    // (a change in flight that holds it answers first, with its own "wait: …")
    const starting = this.applying.conflict(action, checked) ? null : startingBlocked(action, this.data.probe);
    if (starting) throw starting;
    // every change in flight is recorded, and one that conflicts with it waits (409): two phones pressing Rebuild must not run
    // two builds and two restarts, and nothing may touch TouchDesigner while a switch restarts it
    // A switch or rebuild that answered OK stays in status.applying ('confirming', still blocking what it blocks: a second switch
    // would kill the half-opened file) until the full check shows TouchDesigner answering on that file, or its confirm limit.
    // A rebuild's map is the map in use only when it is confirmed: never while TouchDesigner is still restarting on it, and
    // never for one whose TouchDesigner doesn't come back (R7 #26)
    let baked = null;
    return this.applying.run(action, checked, async () => {
      // the year page's answer (or its error) as a browser gets it: scrubbed, as the copy kept in data is (R10 #40)
      if (plan.kind === 'seasons') return scrubCreds(await this.#seasons(plan.path, plan.body));
      const r = await this.#probeAction(plan.args, plan.timeout, action);
      if (action === 'rebuild' && (rebuildSucceeded(r) || r?.maybe === true)) baked = this.#rebuildOf(checked.file, r);
      return r;
    }, { running: this.data.probe?.value?.td?.file ?? null, source, requestId, awaits: (r) => awaitsReading(action, r, checked), onPending: () => this.#recheckSoon(),
         onConfirmed: () => { if (baked) this.#recordRebuilt(baked); } });
  }

  async #seasons(path, body) {
    let r;
    try { r = await getJson(`${this.seasonsUrl}${path}`, this.seasonsTimeoutMs, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) {
      // no answer in time: the page may have taken it (it may or may not have happened); a refusal or no page at all did not
      if (e.timedOut) return { ok: false, maybe: true, error: "the river's year page took too long to answer" };
      throw e;
    }
    this.#set('seasons', r);
    return r;
  }

  async #probeAction(args, timeout, action = null) {
    const asked = this.now();
    const r = await this.probe(this.sshHost, args, timeout);
    // an action's reading is bitcube as the action left it (a switch: TouchDesigner stopped, "restarting on <file>"), so it is
    // as new as its answer: a full check asked before that answer never replaces it
    if (r.ok !== false || r.td) this.#set('probe', r, null, this.now());
    if (r.td) this.applying.confirm(scrubCreds(r), asked);
    // the answer goes to the page as it is: every log line in it (modal_link.*.last, recorder.last) is scrubbed as the snapshot is
    return scrubCreds(actionResult(action, r));
  }
}

/** Whether a control's answer leaves the change to be confirmed by bitcube's reading: a switch that answered OK, a rebuild that
 *  went all the way (both restart TouchDesigner, which then opens the file); a boot-file change whose answer's own reading doesn't
 *  show the boot file asked for (probe.ps1 reads boot-file.txt back after writing it: an OK answer that still names the old one
 *  is no proof, R8 #32), and a lighting port change whose answer reads another port (R8 #31). Those wait for a full check that
 *  shows them (Applying.confirm). body: the request's checked fields. */
export function awaitsReading(action, r, body = {}) {
  if (!r || typeof r !== 'object' || r.ok === false) return false;
  switch (action) {
    case 'switch': return true;
    case 'rebuild': return rebuildSucceeded(r);
    case 'bootfile': return r.boot_file !== body?.file;
    case 'lightsroute': return typeof r.lights_route === 'string' && r.lights_route !== body?.route;
    default: return false;
  }
}

/** A calibration start's answer -> isNew(progress): whether a progress file is the run this start launched. By bitcube's clock:
 *  at or after the request (calibrate.ps1's requested), else newer than the run known before it; with neither, within two
 *  minutes of the mini's clock (nowMs) at the answer. */
export function newRunTest(r, before, nowMs) {
  const req = typeof r?.requested === 'number' ? r.requested - 1 : null;
  return (c) => {
    const s = obj(c)?.started;
    if (typeof s !== 'number') return false;
    if (req != null) return s >= req;
    if (before != null) return s > before;
    return s >= nowMs / 1000 - 120;
  };
}

/** A start that isn't a clear refusal and whose run isn't known yet: launched (calibrate.ps1 says started or names a pid; an
 *  older calibrate.ps1 said "the job did not report within 6 s", also after the -Task launch, with no pid) or a maybe (no
 *  answer in time). A clear refusal (ok false, started false, no pid) and a run already in hand are not pending. */
export function startPending(r, isNew) {
  if (!r || typeof r !== 'object') return false;
  if (isNew(r.calibration)) return false;
  if (r.started === false) return false;
  return r.maybe === true || r.started === true || (r.pid != null && r.pid !== '') || /did not report/i.test(String(r.error ?? ''));
}

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
    case 'ropes': {
      // a real true or false, nothing else: "true", 1 or a missing dark is refused, never read as "on" (R10 #37)
      if (typeof body.dark !== 'boolean') throw bad('dark is true or false');
      return { kind: 'probe', args: `-Action ropes${body.dark ? ' -Dark' : ''}` };
    }
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

/** A control request as the whitelist reads it, and nothing else (a 400 for a bad request, as planControl): what the history
 *  keeps, status.applying names and a page reads back. Extra keys a client sends never go further. */
export function checkedControl(action, body = {}) {
  const plan = planControl(action, body);
  switch (action) {
    case 'mode': return { mode: body.mode };
    case 'target': return { ...plan.body };
    case 'rules': return { rules: { ...plan.body } };
    case 'ropes': return { dark: body.dark === true };
    case 'hub75': return { brightness: num(body.brightness) };
    case 'bootfile': case 'switch': case 'rebuild': return { file: body.file };
    case 'lightsroute': return { route: body.route };
    default: return {};
  }
}

function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }
/** A number from a request: a number, or a string that is one ("0.8"); null, "", false, [] and true are NaN, never 0. */
export function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(v)) return Number(v);
  return NaN;
}
