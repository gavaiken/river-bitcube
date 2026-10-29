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
//     control:  remembered\control.json           (the last requests: public/remembered-schema.js, from td/remembered/control_schema.py:
//                                                  { pool_height_m?, light?, light_at?, opening_night?, screens?: { intensity, threshold, video }, at })
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
//   overrides: control.json's overrides block as written ({ <param>: { mode, value?, offset?, gain?, at, expires_at } }), or null
//   (v2: the status itself carries inputs, params, effects, overrides (cleaned, with expires_in_s) and simulating, served as-is).
// v2 overrides (docs/remembered-river.md section 5 "Overrides"; river-all-looks-v2.toe only):
//   probe.ps1 -Action remembered-override -Param <p> -Mode auto|fix|adjust [-Value v] [-Offset:o] [-Gain:g]
//             -Action remembered-override-clear [-Param <p>]     -Action remembered-simulate [-Headcount n] [-LingerRope r] [-Stop]
//   -> the same answer as remembered-zones after merging control.json's overrides block (stamped at; simulated people get
//   expires_at = at + 120 s), or { ok: false, error, refused } unless the remembered river v2 is the look showing.
// GET /api/remembered/history?fields=inputs.heard,params.knob.speed -> probe.ps1 -Action remembered-history -Fields <list>
//   (tools/remembered/history.py: td/remembered/inputs_log.py recent() over River\logs\inputs.jsonl, the last 24 h, at most 300
//   points a field), cached HISTORY_CACHE_MS per list: { ok: true, now_s, fields: { <field>: [[t, value], ...] }, read_at, age_s },
//   400 for a field that isn't inputs.<input> or params.<param>, 503 in plain words. Fixture mode: syntheticHistory() from the
//   scenario's status.
//   running: TouchDesigner's status.json is fresh (under STATUS_FRESH_S old) and names river-remembered.toe, or river-looks.toe reports
//   the remembered river as the look showing (and the remembered river's status.json is fresh). Everything is scrubbed of
//   logins (scrubCreds), as every other answer.
//   503 { ok: false, error } in plain words when bitcube couldn't be read at all.
import { scrubCreds } from './scrub.mjs';
import { sshProbe } from './mission.mjs';
import { REMEMBERED_FILE, LOOKS_FILE, LOOKS_FILES, LOOKS } from '../public/model.js';
import { INPUTS, PARAM_NAMES } from '../public/remembered-v2-words.js';

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
  const lp = part('looks'), lj = lp && LOOKS_FILES.includes(lp.json.show) && num(lp.age_s) != null && lp.age_s < STATUS_FRESH_S ? lp.json : null;
  const look = lj ? { look: LOOKS.includes(lj.look) ? lj.look : null, target: LOOKS.includes(lj.target) ? lj.target : null,
                      fading: lj.fading === 'out' || lj.fading === 'in' ? lj.fading : null } : null;
  const fresh = !!sv && stAge != null && stAge < STATUS_FRESH_S, lookFile = lj ? lj.show : LOOKS_FILE;
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
    ok: true, running, show: running ? (look ? lookFile : REMEMBERED_FILE) : look ? lookFile : typeof tdFile === 'string' ? tdFile : (typeof sv?.show === 'string' ? sv.show : null), look,
    read_at: readAt, age_s: Math.max(0, Math.round((now - readAt) / 1000)),
    status: sv, status_age_s: stAge,
    dave, dave_age_s: dp ? num(dp.age_s) : null,
    reflex: part('reflex')?.json ?? null, presence: part('presence')?.json ?? null, control: part('control')?.json ?? null,
    overrides: obj(part('control')?.json?.overrides) ?? null,
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

// ---- the inputs log, for the v2 page's sparklines ------------------------------------------------------------------------------------
export const HISTORY_CACHE_MS = 30_000;
export const HISTORY_MAX_FIELDS = 24;
/** ?fields= -> the checked list (inputs.<input>, params.<param>; sorted, each once), or throws (status 400). */
export function checkedHistoryFields(q) {
  const list = [...new Set(String(q ?? '').split(',').map((x) => x.trim()).filter(Boolean))].sort();
  if (!list.length) throw Object.assign(new Error('fields is a list like inputs.heard,params.knob.speed'), { status: 400 });
  if (list.length > HISTORY_MAX_FIELDS) throw Object.assign(new Error(`at most ${HISTORY_MAX_FIELDS} fields`), { status: 400 });
  for (const f of list) {
    const [part, ...rest] = f.split('.'), name = rest.join('.');
    if (!(part === 'inputs' ? INPUTS.includes(name) : part === 'params' ? PARAM_NAMES.includes(name) : false))
      throw Object.assign(new Error(`unknown field ${f.slice(0, 40)}: inputs.<${INPUTS.join('|')}> or params.<param>`), { status: 400 });
  }
  return list;
}
/** probe.ps1 -Action remembered-history over SSH (fields already checked: letters, dots, underscores and commas only). */
export function sshRememberedHistory(sshHost, fields, opts = {}) {
  return sshProbe(sshHost, `-Action remembered-history -Fields ${fields.join(',')}`, 30_000, opts);
}
/** The live reader: cached HISTORY_CACHE_MS per field list, one fetch per list at a time. */
export class RememberedHistory {
  constructor({ sshHost = 'bitcube', fetch = sshRememberedHistory, now = () => Date.now(), cacheMs = HISTORY_CACHE_MS } = {}) {
    Object.assign(this, { sshHost, fetch, now, cacheMs });
    this.c = new Map();
  }
  async read(fields) {
    const key = fields.join(',');
    let c = this.c.get(key);
    if (!c) { c = {}; this.c.set(key, c); if (this.c.size > 32) this.c.delete(this.c.keys().next().value); }
    if (c.raw !== undefined && this.now() - c.at < this.cacheMs) return { raw: c.raw, at: c.at };
    if (!c.pending) c.pending = this.fetch(this.sshHost, fields).then((v) => { if (v?.ok !== false) { c.raw = v; c.at = this.now(); } return v; }).finally(() => { c.pending = null; });
    const v = await c.pending;
    return v?.ok === false ? { raw: v, at: this.now() } : { raw: c.raw, at: c.at };
  }
}
/** history.py's answer -> GET /api/remembered/history's body (scrubbed), or { ok: false, error } in words. */
export function shapeHistory(raw, fields, { readAt = Date.now(), now = Date.now() } = {}) {
  const r = obj(raw);
  if (!r || r.ok === false) return { ok: false, error: plainRememberedError(r?.error).replace("the remembered river's files", 'the inputs log') };
  const src = obj(r.fields) ?? {};
  const out = {};
  for (const f of fields) out[f] = (Array.isArray(src[f]) ? src[f] : []).filter((p) => Array.isArray(p) && num(p[0]) != null).slice(-400);
  return scrubCreds({ ok: true, now_s: num(r.now_s), fields: out, read_at: readAt, age_s: Math.max(0, Math.round((now - readAt) / 1000)) });
}
/** Fixture mode: 24 h of made-up history for each field, ending at the scenario's value now (inputs and params of its status), a
 *  point every 5 minutes, deterministic (the same field draws the same line). */
export function syntheticHistory(raw, fields, nowS) {
  const st = obj(obj(raw?.status)?.json);
  const fieldsOut = {};
  for (const f of fields) {
    const [part, ...rest] = f.split('.'), e = obj(obj(st?.[part])?.[rest.join('.')]);
    const v = num(e?.value);
    if (v == null) { fieldsOut[f] = []; continue; }
    let seed = 0; for (const ch of f) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    const amp = Math.max(0.05, Math.abs(v) * 0.35), pts = [];
    for (let k = 287; k >= 0; k--) {
      const t = nowS - k * 300, x = (287 - k) / 287;
      const wave = Math.sin(x * 6.3 + seed) * 0.6 + Math.sin(x * 23 + seed * 0.7) * 0.3 + Math.sin(x * 71 + seed * 1.3) * 0.1;
      pts.push([Math.round(t), Math.round(Math.max(0, v + amp * wave * (1 - x * 0.8)) * 1e4) / 1e4]);
    }
    pts[pts.length - 1][1] = v;
    fieldsOut[f] = pts;
  }
  return { ok: true, action: 'remembered-history', now_s: nowS, fields: fieldsOut, synthetic: true };
}
