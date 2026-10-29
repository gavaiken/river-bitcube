// The Remembered river v2 page's words, shapes and checks (docs/mission-ui.md "Remembered river v2 page"): GET /api/remembered
// (lib/remembered.mjs CONTRACT, with TouchDesigner's v2 status: inputs, params, effects, overrides, simulating; docs/remembered-river.md
// section 5) -> inputs → parameters → outputs in the team's words (GLOSSARY.md: remembered day, loop, phase, surge, the pool,
// lingerer, decision wave). Pure: no DOM, so node tests it (test/remembered-v2.test.mjs); the page (remembered-v2.js) only places it.
// The override and simulate checks here are the server's too (lib/mission.mjs planControl imports them): one rule, from the one schema
// (remembered-schema.js, generated from td/remembered/control_schema.py).
import { dur, REMEMBERED_FILE, REMEMBERED_V2_FILE, FILES } from './model.js';
import SCHEMA from './remembered-schema.js';
import { rememberedView, dateWords, mss } from './remembered-words.js';

export const PARAMS = SCHEMA.params;
export const PARAM_NAMES = Object.keys(PARAMS);
export const SIM = SCHEMA.overrides;                        // { modes, simulated: [headcount, lingerer_rope], simulated_max_s, gain, days }
export const SIMULATED = SIM.simulated;
export const INPUTS = ['day', 'scene', 'reflex', 'heard', 'river_motion', 'headcount', 'lingerers', 'control'];   // td/remembered/status.py INPUTS
export const ROPES = 20;
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** A number from a request (a number, or a string that is one), else NaN: as lib/mission.mjs num. */
const reqNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(v) ? Number(v) : NaN);
const round = (x, d) => Number(x.toFixed(d));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---- which page for which file (route detection; docs/mission-ui.md) ----------------------------------------------------------
/** The files that play the remembered river without v2's overrides: their page is /remembered (v2's is /remembered-v2). */
export const REMEMBERED_V1_FILES = [REMEMBERED_FILE, 'river-looks.toe', 'river-two-looks.toe', 'river-all-looks.toe'];
/** The Remembered river page that matches the file TouchDesigner runs (null or any other file: v1's, the long-standing address). */
export const rememberedPage = (file) => (file === REMEMBERED_V2_FILE ? '/remembered-v2' : '/remembered');
/** The one-line banner a Remembered river page shows when the other version's file runs, or null. page: 'v1' | 'v2'. */
export function versionBanner(page, file) {
  if (page === 'v2' && REMEMBERED_V1_FILES.includes(file)) return { text: 'The v1 file is showing; this page is for v2', href: '/remembered', link: 'open /remembered' };
  if (page === 'v1' && file === REMEMBERED_V2_FILE) return { text: 'The v2 file is showing; this page is for v1', href: '/remembered-v2', link: 'open /remembered-v2' };
  return null;
}

/** The v2 overrides' parameters in the team's words (control_schema.PARAMS; changeLabel and the history name them). */
export const REMEMBERED_PARAM_WORDS = { day: 'the remembered day', surge_hour: 'the surge hour', 'knob.speed': 'speed', 'knob.density': 'density',
  'knob.brightness': 'the water\'s brightness', 'knob.turbulence': 'turbulence', palette: 'the colours', flow_level: 'the flow', headcount: 'the headcount',
  lingerer_rope: 'the lingerer', calm_min: 'the calm floor', calm_max: 'the calm ceiling', master_brightness: 'the ropes\' master brightness' };
/** An override's value in words: "0.70", "hour 13.5", "8 people", "rope 13" (ropes counted 1-20; the files count 0-19), "120 %". */
export function overrideValueWords(param, v) {
  if (param === 'palette') return Array.isArray(v) ? v.join(' ') : null;
  if (param === 'day') return typeof v === 'string' ? v : null;
  const x = num(typeof v === 'string' && v !== '' ? Number(v) : v);
  if (x == null) return null;
  if (param === 'surge_hour') return `hour ${+x.toFixed(2)}`;
  if (param === 'headcount') return `${+x.toFixed(1)} ${x === 1 ? 'person' : 'people'}`;
  if (param === 'lingerer_rope') return `rope ${Math.round(x) + 1}`;
  if (param === 'master_brightness' || param === 'calm_min' || param === 'calm_max') return `${Math.round(x * 100)} %`;
  return x.toFixed(2);
}
/** "the speed override to 0.70 (fixed)" / "… to auto × 1.20 + 0.10 (adjusted)" / "speed back to auto" (changeLabel and the history). */
export function overrideWords(b) {
  const o = obj(b) ?? {}, w = REMEMBERED_PARAM_WORDS[o.param];
  if (!w) return null;
  if (o.mode === 'auto') return `${w} back to auto`;
  if (o.mode === 'fix') { const v = overrideValueWords(o.param, o.value); return v ? `${w} fixed at ${v}` : `${w} fixed`; }
  if (o.mode === 'adjust') {
    const g = num(o.gain) ?? 1, f = num(o.offset) ?? 0;
    return `${w} adjusted (auto${g !== 1 ? ` × ${+g.toFixed(2)}` : ''}${f ? ` ${f > 0 ? '+' : '−'} ${+Math.abs(f).toFixed(2)}` : ''})`;
  }
  return null;
}
/** "8 people and a lingerer by rope 13" / "a lingerer by rope 13" / "8 people" (null: nothing). */
export function simulateWords(b) {
  const o = obj(b) ?? {}, h = num(o.headcount), r = num(o.lingerer_rope);
  const parts = [h != null ? overrideValueWords('headcount', h) : null, r != null ? `a lingerer by ${overrideValueWords('lingerer_rope', r)}` : null].filter(Boolean);
  return parts.length ? parts.join(' and ') : null;
}

// ---- the checks (the server's whitelist too) ------------------------------------------------------------------------------------
/** A fixed value for a parameter, cleaned (number rounded, whole rope, 'YYYY-MM-DD', three lowercase '#rrggbb'), or an { error }. */
export function checkedValue(param, v) {
  const p = PARAMS[param];
  if (!p) return { error: `param is one of ${PARAM_NAMES.join(', ')}` };
  if (p.type === 'number' || p.type === 'int') {
    const x = reqNum(v);
    if (!(x >= p.min && x <= p.max)) return { error: `${param} is ${p.min} to ${p.max}` };
    if (p.type === 'int') return Number.isInteger(x) ? { value: x } : { error: `${param} is a whole number, ${p.min} to ${p.max}` };
    return { value: round(x, 3) };
  }
  if (p.type === 'date') {
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!d || d.getUTCDate() !== +m[3] || d.getUTCMonth() !== +m[2] - 1) return { error: 'day is a date, YYYY-MM-DD' };
    const { first, last } = SIM.days;
    if ((first && v < first) || (last && v > last)) return { error: `day is a remembered day, ${first} to ${last}` };
    return { value: v };
  }
  if (p.type === 'palette') {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))) return { error: "palette is three colours, ['#rrggbb', '#rrggbb', '#rrggbb']" };
    return { value: v.map((c) => c.toLowerCase()) };
  }
  return { error: `${param} can't be fixed` };
}

/** POST /api/control/remembered-override's body, checked: { param, mode, value? | offset?, gain? } or throws (status 400). */
export function checkedOverride(body) {
  const b = obj(body) ?? {}, p = PARAMS[b.param];
  if (!p) throw bad(`param is one of ${PARAM_NAMES.join(', ')}`);
  if (!p.modes.includes(b.mode)) throw bad(`${b.param}'s mode is ${p.modes.join(', ')}`);
  if (b.mode === 'auto') return { param: b.param, mode: 'auto' };
  if (b.mode === 'fix') {
    const c = checkedValue(b.param, b.value);
    if (c.error) throw bad(c.error);
    return { param: b.param, mode: 'fix', value: c.value };
  }
  const span = p.max - p.min, [glo, ghi] = SIM.gain;
  const off = b.offset === undefined ? 0 : reqNum(b.offset), gain = b.gain === undefined ? 1 : reqNum(b.gain);
  if (!(off >= -span && off <= span)) throw bad(`offset is −${span} to ${span}`);
  if (!(gain >= glo && gain <= ghi)) throw bad(`gain is ${glo} to ${ghi}`);
  return { param: b.param, mode: 'adjust', offset: round(off, 3), gain: round(gain, 2) };
}
/** POST /api/control/remembered-override-clear's body: {} (every override) or { param }. */
export function checkedClear(body) {
  const b = obj(body) ?? {};
  if (b.param === undefined) return {};
  if (!PARAMS[b.param]) throw bad(`param is one of ${PARAM_NAMES.join(', ')}`);
  return { param: b.param };
}
/** POST /api/control/remembered-simulate's body: { headcount?, lingerer_rope? } (at least one) or { stop: true }. */
export function checkedSimulate(body) {
  const b = obj(body) ?? {};
  if (b.stop !== undefined) {
    if (b.stop !== true) throw bad('stop is true');
    return { stop: true };
  }
  const out = {};
  for (const k of SIMULATED) {
    if (b[k] === undefined) continue;
    const c = checkedValue(k, b[k]);
    if (c.error) throw bad(c.error);
    out[k] = k === 'headcount' ? round(c.value, 1) : c.value;
  }
  if (!Object.keys(out).length) throw bad('simulate needs headcount (0 to 20), lingerer_rope (0 to 19) or stop');
  return out;
}
function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }

// ---- inputs ---------------------------------------------------------------------------------------------------------------------
/** Each source's chip: its words and its colour class (remembered-v2.css .src-<name>). */
export const SOURCE_WORDS = {
  dave: "Dave's agent", notable: 'notable day', preset: 'preset', cam: 'river camera', clip: 'recorded clip', sound: 'sound',
  counter: 'people counter', simulated: 'SIMULATED', control: 'mission control',
};
export const INPUT_WORDS = {
  day: { label: 'Remembered day', explain: "The real day from Dry Creek's past the column relives this loop. Dave's agent picks one that resembles the river today; when his pick is over 5 minutes old, bitcube plays a notable day (a flood, a drought) itself, else a preset." },
  scene: { label: "Dave's scene", explain: "Dave's agent's four knobs (speed, density, brightness, turbulence), sent every 5 minutes as a slow mood. bitcube widens his narrow range and blends it with the remembered day's own hours." },
  reflex: { label: "Dave's reflex", explain: "Small nudges to the knobs Dave's agent sends every few seconds, from what it sees and hears right now." },
  heard: { label: 'Heard', explain: 'How loud the river sounds, 0 to 1, from the river camera\'s microphone through Dave\'s agent. The ropes follow it while it arrives.' },
  river_motion: { label: 'River motion', explain: 'How much the river moves in the river camera\'s picture, 0 to 1 (the recorded clip when the camera is down). The ropes follow it when there is no sound.' },
  headcount: { label: 'People in the room', explain: 'How many people the people counter sees in the gallery camera\'s picture, about twice a second. A crowd stirs turbulence low on the ropes; an empty room settles to a still pond.' },
  lingerers: { label: 'Lingerers', explain: 'Someone standing still close to the column (a lingerer): the ropes nearest them spark and gather the light. Ropes are counted 1 to 20.' },
  control: { label: 'Mission control', explain: 'What people set on this page (the calm range, master brightness, overrides): when it was last changed.' },
};
/** "by ropes 8, 9" from the files' 0-based rope numbers (the team counts 1-20). */
export function ropesWords1(a) {
  const r = (Array.isArray(a) ? a : []).filter((x) => Number.isInteger(x) && x >= 0 && x < ROPES).map((x) => x + 1);
  return r.length ? `${r.length === 1 ? 'rope' : 'ropes'} ${r.join(', ')}` : null;
}
const KNOBS = ['speed', 'density', 'brightness', 'turbulence'];
/** An input's value in words. */
export function inputValueWords(name, v) {
  if (v == null) return name === 'control' ? 'nothing set' : 'nothing yet';
  switch (name) {
    case 'day': return dateWords(v) ?? String(v);
    case 'scene': return Array.isArray(v) ? v.map((x, k) => `${KNOBS[k] ?? k} ${num(x) != null ? x.toFixed(2) : '–'}`).join(' · ') : String(v);
    case 'reflex': { if (!Array.isArray(v)) return String(v); const n = v.map((x, k) => (num(x) && Math.abs(x) >= 0.005 ? `${KNOBS[k]} ${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}` : null)).filter(Boolean); return n.length ? n.join(' · ') : 'no nudge'; }
    case 'heard': case 'river_motion': return num(v) != null ? v.toFixed(2) : String(v);
    case 'headcount': return num(v) != null ? `${+v.toFixed(1)} ${v === 1 ? 'person' : 'people'}` : String(v);
    case 'lingerers': return Array.isArray(v) ? (ropesWords1(v) ? `by ${ropesWords1(v)}` : 'nobody standing still') : String(v);
    default: return typeof v === 'object' ? 'set' : String(v);
  }
}
/** The fields the page asks /api/remembered/history for (inputs.jsonl: the numeric ones), and which row each feeds. */
export const SPARK = { heard: 'inputs.heard', river_motion: 'inputs.river_motion', headcount: 'inputs.headcount',
  'p.surge_hour': 'params.surge_hour', 'p.knob.speed': 'params.knob.speed', 'p.knob.density': 'params.knob.density', 'p.knob.brightness': 'params.knob.brightness',
  'p.knob.turbulence': 'params.knob.turbulence', 'p.flow_level': 'params.flow_level', 'p.headcount': 'params.headcount', 'p.calm_min': 'params.calm_min',
  'p.calm_max': 'params.calm_max', 'p.master_brightness': 'params.master_brightness' };
export const HISTORY_FIELDS = Object.values(SPARK);

// ---- parameters -----------------------------------------------------------------------------------------------------------------
export const PARAM_LABEL = { day: 'Remembered day', surge_hour: 'Surge hour', 'knob.speed': 'Speed', 'knob.density': 'Density', 'knob.brightness': 'Brightness',
  'knob.turbulence': 'Turbulence', palette: 'Colours', flow_level: 'Flow', headcount: 'Headcount', lingerer_rope: 'Lingerer rope', calm_min: 'Calm floor',
  calm_max: 'Calm ceiling', master_brightness: 'Master brightness' };
/** One paragraph per parameter, in plain words (the schema's doc, said for the artists). */
export const PARAM_EXPLAIN = {
  day: "Which remembered day the loop relives. Auto: Dave's pick, else a notable day bitcube picks, else the preset. Fix it to replay one day (any date in the record) until you clear it.",
  surge_hour: 'The hour of the remembered day when the surge lands (the loop plays 24 hours in 5 minutes, about 12 s an hour). Auto: Dave\'s surge hour, else the day\'s heaviest rain.',
  'knob.speed': 'How fast the water runs down the ropes. Auto: the remembered day\'s flow and Dave\'s scene, nudged by his reflex.',
  'knob.density': 'How many ropes carry drips and streams at once. Auto: the day\'s rain and Dave\'s scene.',
  'knob.brightness': 'How bright the water itself is (the calm range and master brightness also scale the ropes).',
  'knob.turbulence': 'How rough it is: splashes, sloshing, the ribbons on the screens swirling. Auto: the day\'s hours and Dave\'s scene.',
  palette: "The three colours, deep, mid and light. Auto: the remembered day's season and Dave's colours.",
  flow_level: 'How hard the ropes flow: what the gallery hears, else how much the river camera moves.',
  headcount: 'The people the show thinks are in the room. Fix it only with Simulate (top of the page): it clears itself after 2 minutes.',
  lingerer_rope: 'The rope someone is standing still by. Simulate puts a pretend lingerer there for 2 minutes at most.',
  calm_min: 'The floor of the calm brightness: how dark the ropes may get between surges.',
  calm_max: 'The ceiling of the calm brightness: how bright they may get between surges (the surge itself is always full).',
  master_brightness: "Every rope's brightness times this, after everything else. 100 % is the show as designed; the power limit (1,400 W) still applies.",
};
/** A parameter's value in words (palette: its three colours). */
export const paramValueWords = (name, v) => (v == null ? '–' : overrideValueWords(name, v) ?? String(v));
export const MODE_WORDS = { auto: 'Auto', fix: 'Fixed', adjust: 'Adjusted' };
export const MODE_EXPLAIN = {
  auto: 'Auto: the show computes it from its inputs.',
  fix: 'Fix: use this value instead, until someone clears it.',
  adjust: "Adjust: keep following the show, but scaled and shifted (auto × gain + offset), kept inside the range.",
};
/** What adjust gives for an auto value: auto × gain + offset, clamped to the range (control_schema.py). */
export function adjusted(param, auto, gain = 1, offset = 0) {
  const p = PARAMS[param], a = num(auto);
  if (!p || a == null) return null;
  return Math.min(p.max, Math.max(p.min, a * gain + offset));
}
/** One parameter for the page: { name, label, mode, auto, value, line, who, overridden, simulated, expiresIn }. */
export function paramView(name, p, ov, { plus = 0, nowMs = Date.now() } = {}) {
  const e = obj(p), o = obj(ov), def = PARAMS[name];
  const mode = def.modes.includes(e?.mode) ? e.mode : o && def.modes.includes(o.mode) ? o.mode : 'auto';
  const auto = e?.auto ?? null, value = e ? e.value ?? null : null;
  const aw = paramValueWords(name, auto), vw = paramValueWords(name, value);
  let line;
  if (mode === 'fix') line = `auto ${aw} → fixed ${o?.value != null ? paramValueWords(name, o.value) : vw}`;
  else if (mode === 'adjust') {
    const g = num(o?.gain) ?? 1, f = num(o?.offset) ?? 0;
    line = `auto ${aw} → ${vw} (adjusted${g !== 1 ? ` ×${+g.toFixed(2)}` : ''}${f ? ` ${f > 0 ? '+' : '−'}${+Math.abs(f).toFixed(2)}` : ''})`;
  } else line = e ? `auto ${vw}` : 'not reported';
  const at = typeof o?.at === 'string' ? Date.parse(o.at) : NaN;
  const ago = Number.isFinite(at) ? Math.max(0, (nowMs - at) / 1000) : null;
  // how long a timed override has left: TouchDesigner's own count (carried forward by how old its status is), else from expires_at
  const left = num(e?.expires_in_s) ?? num(o?.expires_in_s);
  const exp = typeof o?.expires_at === 'string' ? Date.parse(o.expires_at) : NaN;
  const expiresIn = left != null ? Math.max(0, left - plus) : Number.isFinite(exp) ? Math.max(0, (exp - nowMs) / 1000) : null;
  const simulated = SIMULATED.includes(name) && mode !== 'auto';
  const who = mode === 'auto' ? null : [ago != null ? `set ${dur(ago)} ago` : 'set from mission control', expiresIn != null ? `clears in ${mss(expiresIn)}` : 'until cleared'].join(' · ');
  return { name, label: PARAM_LABEL[name] ?? name, mode, modeWords: MODE_WORDS[mode], auto, value, line, who, overridden: mode !== 'auto', simulated, expiresIn,
           palette: def.type === 'palette' ? (Array.isArray(value) ? value : Array.isArray(auto) ? auto : null) : null, source: e?.source ?? null };
}

// ---- inputs → parameters: the groups ---------------------------------------------------------------------------------------------
/** Which inputs feed which parameters (td/remembered/show.py), in the order the page lays them out. */
export const GROUPS = [
  { id: 'day', title: 'The day', inputs: ['day'], params: ['day', 'surge_hour', 'palette'],
    why: 'The remembered day sets when the surge lands and the colours.' },
  { id: 'scene', title: "Dave's mood", inputs: ['scene', 'reflex'], params: ['knob.speed', 'knob.density', 'knob.brightness', 'knob.turbulence'],
    why: "Dave's scene and reflex, with the day's own hours, set the four knobs." },
  { id: 'flow', title: 'The river now', inputs: ['heard', 'river_motion'], params: ['flow_level'],
    why: 'What the gallery hears (else the river camera\'s motion) sets how hard the ropes flow.' },
  { id: 'room', title: 'The room', inputs: ['headcount', 'lingerers'], params: ['headcount', 'lingerer_rope'],
    why: 'People in the room stir the ropes; a lingerer\'s ropes spark.' },
  { id: 'control', title: 'This page', inputs: ['control'], params: ['calm_min', 'calm_max', 'master_brightness'],
    why: 'The calm range and master brightness are set here (Steer the river, at the top).' },
];

// ---- the whole page --------------------------------------------------------------------------------------------------------------
/** The /api/remembered answer -> the v2 page's view: v1's rememberedView (phase, loop, day, Dave, room, outputs) plus inputs, params,
 *  effects, the simulation and the overrides. now: the server's clock (ms); sinceS: seconds since the answer arrived. */
export function rememberedV2View(p, { now = Date.now(), sinceS = 0 } = {}) {
  const b = obj(p) ?? {};
  const v = rememberedView(b, { now, sinceS });
  const st = obj(b.status);                                   // shown even when old (greyed, with its age), never trusted as now
  const plus = (num(b.age_s) ?? 0) + sinceS;
  v.statusAgeS = num(b.status_age_s) != null ? b.status_age_s + plus : null;
  v.stale = !!st && v.statusAgeS != null && v.statusAgeS > 10;
  v.staleWords = v.stale ? `TouchDesigner's status is ${dur(v.statusAgeS)} old: everything below is as it was then, not now` : null;
  v.isV2 = !!st && ('params' in st || 'inputs' in st);
  v.v2Missing = !!st && !v.isV2 ? "TouchDesigner's status has no inputs or parameters: this file isn't the v2 river (see the banner above, or switch to the river v2 under What's showing)" : null;
  const inputs = obj(st?.inputs) ?? {}, params = obj(st?.params) ?? {};
  // the overrides: TouchDesigner's view (cleaned, with expires_in_s), else what control.json asks for (the file mission control writes)
  const ovTd = obj(st?.overrides), ovFile = obj(b.overrides) ?? obj(obj(b.control)?.overrides) ?? {};
  v.overrides = ovTd ?? ovFile;
  v.inputs = Object.fromEntries(INPUTS.map((name) => {
    const e = obj(inputs[name]);
    const age = num(e?.age_s) != null ? e.age_s + plus : null;
    const source = typeof e?.source === 'string' ? e.source : null;
    return [name, { name, label: INPUT_WORDS[name].label, explain: INPUT_WORDS[name].explain, value: e?.value ?? null, words: inputValueWords(name, e?.value ?? null),
      source, sourceWords: source ? SOURCE_WORDS[source] ?? source : 'no source', age, ageWords: age != null ? `${dur(age)} ago` : null,
      fresh: e?.fresh === true && !v.stale, simulated: source === 'simulated' }];
  }));
  v.params = Object.fromEntries(PARAM_NAMES.map((name) => [name, paramView(name, params[name], v.overrides[name], { plus, nowMs: now })]));
  v.overriddenCount = Object.values(v.params).filter((x) => x.overridden && !x.simulated).length;
  // the people effects in the ropes (ropes.py: lingerer, crowd, empty 0..1; sparks a count)
  const fx = obj(st?.effects) ?? {};
  v.effects = Object.entries(fx).filter(([, x]) => num(x) != null).map(([k, x]) => ({ name: k, label: EFFECT_WORDS[k]?.label ?? cap(k), explain: EFFECT_WORDS[k]?.explain ?? null,
    value: x, meter: k === 'sparks' ? null : Math.max(0, Math.min(1, x)), words: k === 'sparks' ? `${Math.round(x)}` : `${Math.round(Math.max(0, Math.min(1, x)) * 100)} %` }));
  // the simulation (decision 6): the simulated headcount and lingerer, how long they have left, the banner's words
  const hc = v.params.headcount, lr = v.params.lingerer_rope;
  const simOn = [hc, lr].filter((x) => x.simulated && (x.expiresIn == null || x.expiresIn > 0));
  v.sim = { active: st?.simulating === true || simOn.length > 0,
    headcount: hc.simulated ? num(v.overrides.headcount?.value) ?? num(hc.value) : null, rope: lr.simulated ? num(v.overrides.lingerer_rope?.value) ?? num(lr.value) : null,
    expiresIn: simOn.length ? Math.max(...simOn.map((x) => x.expiresIn ?? 0)) : null };
  const what = simulateWords({ headcount: v.sim.headcount ?? undefined, lingerer_rope: v.sim.rope ?? undefined });
  v.sim.words = v.sim.active ? `SIMULATING${what ? ` ${what}` : ' people'}${v.sim.expiresIn != null ? ` · clears in ${mss(v.sim.expiresIn)}` : ''}` : null;
  v.groups = GROUPS.map((g) => ({ ...g, inputs: g.inputs.map((n) => v.inputs[n]), params: g.params.map((n) => v.params[n]) }));
  v.fileLabel = b.show ? FILES[b.show]?.label ?? b.show : null;
  v.onV2 = b.show === REMEMBERED_V2_FILE;
  return v;
}
export const EFFECT_WORDS = {
  lingerer: { label: 'Lingerer', explain: "How strongly a lingerer's ropes spark and gather the light (0: nobody standing still)." },
  crowd: { label: 'Crowd', explain: 'How much the crowd stirs turbulence low on the ropes (below head height); it mounts and subsides over about a minute.' },
  empty: { label: 'Empty room', explain: 'How far an empty room has settled toward a still pond with slow waves.' },
  sparks: { label: 'Sparks', explain: "Sparks running up and down the lingerer's ropes right now." },
};

// ---- the sparkline -----------------------------------------------------------------------------------------------------------------
/** 24 h of [t, value] points (unix s) as a small SVG line (viewBox 0 0 120 28), from nowS back a day; lo/hi: the range (else the data's). */
export function sparkSVG(points, { lo = null, hi = null, nowS = null, label = '' } = {}) {
  const pts = (Array.isArray(points) ? points : []).filter((x) => Array.isArray(x) && num(x[0]) != null && num(x[1]) != null);
  if (pts.length < 2) return `<svg class="spark none" viewBox="0 0 120 28" role="img" aria-label="${esc(label || 'no history yet')}"><line x1="0" x2="120" y1="27" y2="27"/></svg>`;
  const end = nowS ?? pts.at(-1)[0], start = end - 86400;
  const vs = pts.map((x) => x[1]);
  const a = lo ?? Math.min(...vs), z = hi ?? Math.max(...vs), span = Math.max(1e-6, z - a);
  const d = pts.filter((x) => x[0] >= start).map((x, k) => `${k ? 'L' : 'M'}${(((x[0] - start) / 86400) * 120).toFixed(1)},${(26 - ((Math.min(z, Math.max(a, x[1])) - a) / span) * 24).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 120 28" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><path d="${d}"/></svg>`;
}
/** A parameter's or input's range for its sparkline. */
export function sparkRange(key) {
  const p = PARAMS[key.replace(/^p\./, '')];
  if (key.startsWith('p.') && p && num(p.min) != null) return { lo: p.min, hi: p.max };
  if (key === 'heard' || key === 'river_motion') return { lo: 0, hi: 1 };
  if (key === 'headcount') return { lo: 0, hi: null };
  return {};
}

// ---- explainers --------------------------------------------------------------------------------------------------------------------
/** "How this works": ten lines, plain words. */
export const HOW_IT_WORKS = [
  'The column relives one real day from Dry Creek\'s past every loop: about five minutes for its 24 hours.',
  'Inputs (left) are what comes in: Dave\'s agent\'s remembered day and mood, the river camera\'s sound and motion, the people counter.',
  'Parameters (middle) are what the show makes of them: the day, the surge hour, the colours, the four knobs, the flow, the room.',
  'Outputs (right) are what the ropes and screens are sent, and the people effects in the ropes.',
  'Each parameter is grouped under the inputs that drive it, so you can read across: input → parameter → light.',
  'Every parameter is on Auto unless someone changes it: tap one to Fix it (use your value) or Adjust it (auto × gain + offset).',
  'Fixed and adjusted parameters stay until cleared. "Clear all overrides" puts everything back to Auto.',
  'Simulate pretends people are there (a headcount, a lingerer by a rope) for 2 minutes at most, under a red SIMULATING banner.',
  'The coloured chip on each input says where it came from right now; a grey dot means it has gone quiet.',
  'Every ? explains its control in a sentence. Nothing here changes the show file or its calibration.',
];
/** Every ? button's sheet: { title, body }. Keys: in.<input>, p.<param>, fx.<effect>, ctl.<control>, how. */
export function explainer(key) {
  if (key === 'how') return { title: 'How this works', lines: HOW_IT_WORKS };
  const [kind, ...rest] = key.split('.'), name = rest.join('.');
  if (kind === 'in' && INPUT_WORDS[name]) return { title: INPUT_WORDS[name].label, body: INPUT_WORDS[name].explain };
  if (kind === 'p' && PARAMS[name]) return { title: PARAM_LABEL[name], body: PARAM_EXPLAIN[name] };
  if (kind === 'fx' && EFFECT_WORDS[name]) return { title: EFFECT_WORDS[name].label, body: EFFECT_WORDS[name].explain };
  if (kind === 'ctl' && CONTROL_EXPLAIN[name]) return CONTROL_EXPLAIN[name];
  if (kind === 'mode' && MODE_EXPLAIN[name]) return { title: MODE_WORDS[name], body: MODE_EXPLAIN[name] };
  return null;
}
export const CONTROL_EXPLAIN = {
  master: { title: 'Master brightness', body: PARAM_EXPLAIN.master_brightness },
  calm: { title: 'Calm range', body: 'How dark and how bright the ropes may get between surges: the calm brightness moves inside this range with the day\'s hours, the room and a slow drift. The surge is always full.' },
  simulate: { title: 'Simulate', body: 'Pretend there are people in the room, or someone standing still by a rope, to see what the show does with them. It clears itself after 2 minutes (or press Stop simulating); a red SIMULATING banner shows while it is on.' },
  clear: { title: 'Clear all overrides', body: 'Puts every parameter back to Auto (also a simulation). The pool line, light checks, opening night and the screens sliders are not overrides and stay as they are.' },
  screens: { title: 'Screens', body: 'Intensity is how bright the four screens are (0 % is dark). Threshold is how much the river has to move to show in its video. River video is how strongly it shows under the particle windows.' },
  pool: { title: 'The pool line and light checks', body: 'The pool line is how high (metres above the floor) the pool reaches: LEDs below it are the pool. Light the pool or the eddies to check where they fall; it goes back to the show by itself after 10 minutes.' },
  opening: { title: 'Opening night', body: 'For a crowded room: calm runs a little brighter and a surge comes at least every 5 minutes.' },
  effects: { title: 'People effects', body: 'What the people in the room are doing to the ropes right now: a lingerer\'s sparks, the crowd\'s turbulence, the empty room\'s pond.' },
  ropes: { title: 'What the lights are sent', body: 'The 20 ropes and four screens exactly as TouchDesigner sends them, a few seconds ago. Outlined ropes are by a lingerer.' },
};
/** The glossary terms the page uses (GLOSSARY.md), for "How this works". */
export const TERMS = [
  ['Remembered day', "One real date from Dry Creek's past that the column relives."],
  ['Loop', "About five minutes in which the column relives the day's 24 hours."],
  ['Phase', 'Where a loop is: calm, building, surge or settling.'],
  ['Surge', "The one moment of full brightness in a loop, at the day's heaviest rain."],
  ['The pool', 'Where the ropes coil on the floor; it breathes in calm and churns in the surge.'],
  ['Lingerer', 'Someone standing still close to the column.'],
];

// ---- the steer controls' words ----------------------------------------------------------------------------------------------------
/** The calm range's two drafts (0..1) -> the overrides to send, or a reason it can't: floor below ceiling. */
export function calmProblem(lo, hi) {
  if (num(lo) == null || num(hi) == null) return 'move a slider first';
  return lo < hi ? null : 'the calm floor must be below the ceiling';
}
/** A change's words on this page (richer than model.js changeLabel's): "the override: speed fixed at 0.70", "the simulation of 8 people …". */
export function v2Label(action, b = {}) {
  if (action === 'remembered-override') { const w = overrideWords(b); return w ? `the override: ${w}` : 'the change of an override'; }
  if (action === 'remembered-override-clear') return REMEMBERED_PARAM_WORDS[b?.param] ? `the clearing of the override of ${REMEMBERED_PARAM_WORDS[b.param]}` : 'the clearing of every override';
  if (action === 'remembered-simulate') { if (b?.stop === true) return 'the end of the simulation'; const w = simulateWords(b); return w ? `the simulation of ${w}` : 'the simulation of people'; }
  return null;
}
export { REMEMBERED_FILE, REMEMBERED_V2_FILE };
