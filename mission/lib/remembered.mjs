// The remembered river's debug data for mission control (docs/remembered-river.md section 5; the page: public/remembered.*).
// One SSH call reads the remembered river's files on bitcube through probe.ps1 -Action remembered (no TouchDesigner bridge call,
// no device checks: cheap enough for a page that looks every 2 s), cached REMEMBERED_CACHE_MS with one fetch in flight, as
// lib/lights.mjs caches the frames. shapeRemembered() turns what probe.ps1 read into what GET /api/remembered serves; fixture mode
// (lib/fixtures.mjs) hands it the same raw shape from a scenario file.
//
// CONTRACT
// probe.ps1 -Action remembered -> one JSON line (every file under C:\Users\user\River):
//   { ok: true, action: 'remembered', now_s: <bitcube's clock, unix s>,
//     status:   remembered\status.json          (TouchDesigner, twice a second: section 5 of docs/remembered-river.md)
//     state:    gallery_state\state.json         (Dave's scene, mirrored by sync.py): only { memory, surge_at, scene, set_at }
//     reflex:   gallery_state\reflex.json         (Dave's reflex: offsets and heard)
//     presence: presence.json                     (the people counter: presence, usual, relative, lingerers, people)
//     control:  remembered\control.json           (the last request mission control wrote: { pool_height_m, light, opening_night,
//                                                  screens: { video }, at })
//     looks:    looks\status.json                 (river-looks.toe's own report: which look shows; docs/mission-ui.md "Looks") }
//   each file part is { age_s, json } (age from the file's write time), { missing: true } or { error }.
// probe.ps1 -Action remembered-zones -Light off|pool|eddies [-PoolHeight 0.60] / -Action remembered-opening [-On] /
//   -Action remembered-screens [-Video 0.15] [-Intensity 0.82] [-Threshold 0.35] (the screens, M7/M9: screens.video, .intensity, .threshold)
//   -> the same answer after writing control.json (merged with what was there, written atomically), plus written: { ...control }, or
//   { ok: false, error, refused } when the remembered river isn't running (TouchDesigner's status.json older than 10 s or another show;
//   in river-looks.toe: its looks\status.json under 10 s old with look 'remembered').
//
// GET /api/remembered -> shapeRemembered(raw, { tdFile }):
//   { ok: true, running, show, read_at (ms, the mini's clock when read), age_s (seconds since then: the cache's age),
//     status: <status.json> | null, status_age_s, dave: { memory, surge_at, scene, set_at } | null, dave_age_s,
//     reflex: <reflex.json> | null, presence: <presence.json> | null, control: <control.json> | null,
//     profile: { flow, rain, temp, snow, is_day } | null (the playing day's 24 hours: TouchDesigner's day.profile, else Dave's
//               memory.profile when it is that day), profile_date, problems: [plain sentences] }
//   look: { look, target, fading } while river-looks.toe reports (its looks\status.json fresh), else null.
//   running: TouchDesigner's status.json is fresh (under STATUS_FRESH_S old) and names river-remembered.toe, or river-looks.toe reports
//   the remembered river as the look showing (and the remembered river's status.json is fresh). Everything is scrubbed of
//   logins (scrubCreds), as every other answer.
//   503 { ok: false, error } in plain words when bitcube couldn't be read at all.
import { scrubCreds } from './scrub.mjs';
import { sshProbe } from './mission.mjs';
import { REMEMBERED_FILE, LOOKS_FILE, LOOKS } from '../public/model.js';

export const REMEMBERED_CACHE_MS = 1500;
export const STATUS_FRESH_S = 10;
const PARTS = ['status', 'state', 'reflex', 'presence', 'control', 'looks'];
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** probe.ps1 -Action remembered over SSH: its answer, or { ok: false, error } (sshProbe's rules: never rejects). */
export function sshRemembered(sshHost, opts = {}) {
  return sshProbe(sshHost, '-Action remembered', 20_000, opts);
}

/** A list of 24 numbers (or nulls) from a profile, or null. */
function hours(a) {
  if (!Array.isArray(a) || a.length !== 24) return null;
  return a.map((v) => num(v));
}
function profileOf(p) {
  const o = obj(p);
  if (!o) return null;
  const out = {};
  for (const k of ['flow', 'rain', 'temp', 'snow', 'is_day']) out[k] = hours(o[k]);
  return out.flow || out.rain ? out : null;
}

/** probe.ps1's answer (or a fixture's) -> GET /api/remembered's body (see the header). readAt: when it was read (ms). */
export function shapeRemembered(raw, { tdFile = null, readAt = Date.now(), now = Date.now() } = {}) {
  const r = obj(raw);
  if (!r || r.ok === false) return { ok: false, error: plainRememberedError(r?.error) };
  const part = (k) => { const p = obj(r[k]); return p && obj(p.json) ? p : null; };
  const problems = [];
  for (const k of PARTS) { const p = obj(r[k]); if (p?.error) problems.push(`${WHAT[k]} couldn't be read: ${String(p.error).slice(0, 160)}`); }
  const st = part('status'), sv = st ? st.json : null, stAge = st ? num(st.age_s) : null;
  // river-looks.toe's report: which look shows (fresh, or nothing: an old report says nothing about now)
  const lp = part('looks'), lj = lp && lp.json.show === LOOKS_FILE && num(lp.age_s) != null && lp.age_s < STATUS_FRESH_S ? lp.json : null;
  const look = lj ? { look: LOOKS.includes(lj.look) ? lj.look : null, target: LOOKS.includes(lj.target) ? lj.target : null,
                      fading: lj.fading === 'out' || lj.fading === 'in' ? lj.fading : null } : null;
  const fresh = !!sv && stAge != null && stAge < STATUS_FRESH_S;
  // while river-looks.toe reports, only its look counts (the remembered look may write its status as river-remembered.toe's own)
  const running = fresh && (look ? look.look === 'remembered' : sv.show === REMEMBERED_FILE);
  const dp = part('state'), d = dp ? dp.json : null;
  const dave = d ? { memory: obj(d.memory), surge_at: num(d.surge_at), scene: obj(d.scene), set_at: typeof d.set_at === 'string' ? d.set_at : null } : null;
  // the playing day's hours: TouchDesigner's own when it sends them, else Dave's when the day playing is his
  const playing = typeof sv?.day?.date === 'string' ? sv.day.date : dave?.memory?.date ?? null;
  let profile = profileOf(sv?.day?.profile), profileDate = profile ? playing : null;
  if (!profile && dave?.memory && (!playing || dave.memory.date === playing)) { profile = profileOf(dave.memory.profile); profileDate = profile ? dave.memory.date ?? null : null; }
  if (dave?.memory && 'profile' in dave.memory) { const { profile: _served, ...rest } = dave.memory; dave.memory = rest; }   // served once, as `profile`
  return scrubCreds({
    ok: true, running, show: running ? (look ? LOOKS_FILE : REMEMBERED_FILE) : look ? LOOKS_FILE : typeof tdFile === 'string' ? tdFile : (typeof sv?.show === 'string' ? sv.show : null), look,
    read_at: readAt, age_s: Math.max(0, Math.round((now - readAt) / 1000)),
    status: sv, status_age_s: stAge,
    dave, dave_age_s: dp ? num(dp.age_s) : null,
    reflex: part('reflex')?.json ?? null, presence: part('presence')?.json ?? null, control: part('control')?.json ?? null,
    profile, profile_date: profileDate, problems,
  });
}
const WHAT = { status: "TouchDesigner's status file", state: "Dave's scene (state.json)", reflex: "Dave's reflex (reflex.json)", presence: "the people counter's file", control: 'the control file',
  looks: "the river (all looks)'s status file" };

/** Why bitcube's remembered-river files couldn't be read, in the team's words. */
export function plainRememberedError(raw) {
  const s = scrubCreds(String(raw ?? ''));
  return /can't reach bitcube|ssh/i.test(s) ? 'bitcube is offline'
    : /too long|timed out|timeout/i.test(s) ? "bitcube didn't answer in time"
    : s ? `bitcube couldn't read the remembered river's files (${s.slice(0, 120)})` : "bitcube didn't answer";
}

/** The live reader: probe.ps1 -Action remembered, cached REMEMBERED_CACHE_MS, one fetch at a time. */
export class Remembered {
  constructor({ sshHost = 'bitcube', fetch = sshRemembered, now = () => Date.now(), cacheMs = REMEMBERED_CACHE_MS } = {}) {
    Object.assign(this, { sshHost, fetch, now, cacheMs });
    this.c = {};
  }
  /** { raw, at }: the newest answer and when it arrived. */
  async read() {
    const c = this.c;
    if (c.raw !== undefined && this.now() - c.at < this.cacheMs) return { raw: c.raw, at: c.at };
    if (!c.pending) c.pending = this.fetch(this.sshHost).then((v) => { c.raw = v; c.at = this.now(); return v; }).finally(() => { c.pending = null; });
    await c.pending;
    return { raw: c.raw, at: c.at };
  }
}
