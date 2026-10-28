// The Remembered river page's words and shapes (docs/mission-ui.md "Remembered river page"): GET /api/remembered (lib/remembered.mjs
// CONTRACT) -> everything the page lays out, in the team's words (GLOSSARY.md: remembered day, loop, phase, surge, the pool,
// lingerer). Pure: no DOM, so node tests it (test/remembered.test.mjs). The page (remembered.js) only places it.
import { dur, FILES, LOOKS_FILES, LOOK_IN_LINE } from './model.js';

/** The river video's strength under the particle windows (M9) until someone sets it, 0..1. */
export const REMEMBERED_VIDEO_DEFAULT = 0.7;
/** The screens' intensity and motion threshold until someone sets them (td/remembered/water.py SETTINGS), 0..1. */
export const REMEMBERED_SCREENS_DEFAULT = { intensity: 0.82, threshold: 0.35 };

export const PHASES = ['calm', 'building', 'surge', 'settling'];
export const PHASE_WORDS = {
  calm: 'The river is calm: the pool breathes, the light is low and slow.',
  building: 'Building toward the surge: rain gathering, the pool going dark.',
  surge: 'The surge: full brightness and colour, the pool churning white.',
  settling: 'Settling after the surge: the light ebbs, the pool fades last.',
};
export const KNOBS = ['speed', 'density', 'brightness', 'turbulence'];
export const DAVE_OLD_S = 5 * 60;              // Dave's choice older than this: bitcube plays a notable day itself
export const PANEL_RULE_PCT = 30;
export const ROPE_LIMIT_W = 1400;             // td/ropes/artnet_out.py TOTAL_WATTS: both boxes together
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "2:21" from seconds. */
export function mss(s) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
/** "7 Feb 2017" from "2017-02-07" (as written: a remembered date has no time zone). */
export function dateWords(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d ?? ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}
/** An hour of the remembered day: 13.5 -> "13:30". */
export function hourWords(h) { if (num(h) == null) return null; const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
/** "ropes 7, 8" / "rope 12" (rope numbers as the team counts them, 1-20). */
export function ropesWords(r) { const a = Array.isArray(r) ? r.filter((x) => Number.isInteger(x)) : []; return a.length ? `${a.length === 1 ? 'rope' : 'ropes'} ${a.join(', ')}` : null; }
/** Relative presence in the team's words. */
export function relativeWords(rel) {
  const r = num(rel);
  return r == null ? null : r >= 1.25 ? 'busier than usual' : r <= 0.8 ? 'quieter than usual' : 'about as usual';
}

/** The /api/remembered answer (and the server's clock, ms) -> the page's view. See the header. */
export function rememberedView(p, { now = Date.now(), sinceS = 0 } = {}) {
  const b = obj(p) ?? {};
  const st = b.running ? obj(b.status) : null;              // TouchDesigner's own reading, only while the remembered river runs
  const dave = obj(b.dave), mem = obj(dave?.memory), scene = obj(dave?.scene), reflex = obj(b.reflex), pres = obj(b.presence);
  const age = num(b.age_s) ?? 0, plus = age + sinceS;      // how much older everything is than when it was read
  const out = { running: !!st, show: typeof b.show === 'string' ? b.show : null, problems: Array.isArray(b.problems) ? b.problems.map(String) : [] };
  // river-looks.toe (docs/mission-ui.md "Looks"): the remembered river is one of its looks; the page runs while it is the one showing
  const lk = obj(b.look);
  out.look = lk ? { look: lk.look ?? null, target: lk.target ?? null, fading: lk.fading ?? null } : null;
  out.inLooks = LOOKS_FILES.includes(out.show);
  out.notRunning = st ? null : out.inLooks
    ? `TouchDesigner is showing ${FILES[out.show]?.label ?? 'the river (all looks)'}, on ${out.look?.look ? LOOK_IN_LINE[out.look.look] : 'a look not known yet'} now${out.look?.fading && out.look.target === 'remembered' ? ', fading to the remembered river' : ''}. Pick the remembered river under Looks on Status. Below: what Dave's agent and the room are doing.`
    : `TouchDesigner is showing ${out.show ? FILES[out.show]?.label ?? out.show : "something else (or nothing)"}. Below: what Dave's agent and the room are doing.`;
  out.statusAgeS = num(b.status_age_s);

  // ---- inputs: Dave's agent ----
  const day = obj(st?.day);
  const chosenAt = typeof mem?.chosen_at === 'string' ? Date.parse(mem.chosen_at) : NaN;
  const choiceAge = Number.isFinite(chosenAt) ? Math.max(0, (now - chosenAt) / 1000 + sinceS) : num(day?.age_s) != null ? day.age_s + plus : null;
  const knobsBase = obj(st?.knobs) ?? scene ?? {};
  const nudges = obj(st?.knobs?.reflex) ?? obj(reflex?.offsets) ?? {};
  out.dave = {
    present: !!mem || !!scene,
    date: mem?.date ?? null, dateWords: dateWords(mem?.date), reason: typeof mem?.reason === 'string' ? mem.reason : null,
    chosenBy: mem?.chosen_by === 'resemblance' ? 'its resemblance to the river today' : mem?.chosen_by === 'significance' ? 'its significance' : mem?.chosen_by ?? null,
    ageS: choiceAge, old: choiceAge != null && choiceAge > DAVE_OLD_S,
    stats: obj(mem?.stats),
    palette: (Array.isArray(st?.palette) ? st.palette : Array.isArray(scene?.colors) ? scene.colors : []).filter((c) => /^#[0-9a-f]{6}$/i.test(String(c))).slice(0, 8),
    knobs: KNOBS.map((k) => {
      const v = num(knobsBase[k]), n = num(nudges[k]) ?? 0;
      return { name: k, value: v, nudge: n, effective: v == null ? null : clamp01(v + n) };
    }),
    heard: num(st?.heard) ?? num(reflex?.heard),
  };

  // ---- inputs: the river camera and the room ----
  out.river = { motion: num(st?.river_motion), source: st?.river_source === 'live' || st?.river_source === 'recorded' ? st.river_source : null };
  out.river.sourceWords = out.river.source === 'live' ? 'Live from the river camera' : out.river.source === 'recorded' ? 'The recorded clip (no live frames from the river camera)' : null;
  const room = obj(st?.room) ?? pres ?? {};
  const lingerers = (Array.isArray(room.lingerers) ? room.lingerers : []).filter((l) => num(l?.x) != null && num(l?.y) != null)
    .map((l) => ({ x: clamp01(l.x), y: clamp01(l.y), still_s: num(l.still_s), ropes: Array.isArray(l.ropes) ? l.ropes : [], label: ropesWords(l.ropes) ?? 'no rope near' }));
  out.room = { presence: num(room.presence), usual: num(room.usual), relative: num(room.relative), relWords: relativeWords(room.relative), lingerers,
    people: Array.isArray(pres?.people) ? pres.people.length : null };

  // ---- the decision ----
  const loop = obj(st?.loop);
  const len = num(loop?.length_s), t = num(loop?.t_s);
  out.phase = PHASES.includes(st?.phase) ? st.phase : null;
  out.phaseWords = out.phase ? PHASE_WORDS[out.phase] : null;
  out.loop = len && t != null ? { t, length: len, frac: clamp01(t / len), words: `${mss(t)} of ${mss(len)}`, index: num(loop.index) } : null;
  out.hour = num(loop?.hour) ?? (out.loop ? out.loop.frac * 24 : null);
  const surge = obj(st?.surge);
  out.surge = surge && num(surge.hour) != null ? { hour: surge.hour, t_s: num(surge.t_s), why: typeof surge.why === 'string' ? surge.why : null, shift: num(surge.room_shift_s) ?? 0 }
    : st && surge && surge.hour === null ? { dry: true } : null;
  out.day = st ? { date: day?.date ?? null, dateWords: dateWords(day?.date), reason: typeof day?.reason === 'string' ? day.reason : null,
                   source: day?.source ?? null, fromDave: day?.source === 'dave', next: day?.next ? dateWords(day.next) ?? String(day.next) : null } : null;
  out.profile = obj(b.profile);
  out.profileDate = b.profile_date ?? null;
  out.profileNote = out.profile ? null : st ? `No hours for ${dateWords(out.day?.date) ?? 'this day'}: TouchDesigner doesn't send them and Dave's day is another one` : mem ? null : "No remembered day from Dave's agent yet";
  out.why = whyLines(out, st);

  // ---- outputs ----
  const lit = Array.isArray(st?.panels?.lit_pct) ? st.panels.lit_pct.slice(0, 4).map((x) => num(x)) : null;
  out.panels = { lit, cap: num(st?.panels?.cap), over: (lit ?? []).map((x, k) => (x != null && x > PANEL_RULE_PCT ? k + 1 : null)).filter(Boolean) };
  out.watts = num(st?.ropes?.watts);
  out.wattsWords = out.watts == null ? null : `${Math.round(out.watts).toLocaleString('en-US')} W of the ${ROPE_LIMIT_W.toLocaleString('en-US')} W limit`;
  out.fps = num(st?.fps);
  out.zones = obj(st?.zones);
  out.opening = typeof st?.opening_night === 'boolean' ? st.opening_night : typeof b.control?.opening_night === 'boolean' ? b.control.opening_night : null;
  out.control = obj(b.control);
  // the river video under the particle windows (M9): what TouchDesigner reports, else what was asked last (control.json), 0..1
  const vid = (x) => { const n = num(x); return n != null && n >= 0 && n <= 1 ? n : null; };
  out.video = { now: vid(obj(st?.screens)?.video), asked: vid(obj(out.control?.screens)?.video), default: REMEMBERED_VIDEO_DEFAULT };
  // the screens' intensity and motion threshold (M7 sliders): the same three sources
  for (const k of ['intensity', 'threshold']) out[k] = { now: vid(obj(st?.screens)?.[k]), asked: vid(obj(out.control?.screens)?.[k]), default: REMEMBERED_SCREENS_DEFAULT[k] };
  out.field = typeof obj(st?.screens)?.field === 'string' ? st.screens.field : null;
  return out;
}

/** The WHY lines: why the loop is doing what it does, in plain words, most important first. */
export function whyLines(v, st) {
  const out = [];
  if (!st) return out;
  const d = v.dave, day = v.day;
  const choice = d.ageS != null ? `Dave's choice is ${dur(d.ageS)} old` : "There's no choice from Dave";
  if (day?.fromDave) out.push(`${choice} → playing his day${day.dateWords ? `, ${day.dateWords}` : ''}${d.chosenBy ? `, chosen for ${d.chosenBy}` : ''}`);
  else if (day) out.push(`${choice}${d.old ? ' (over the 5 min rule)' : ''} → playing a notable day: ${day.reason ?? day.dateWords ?? 'one bitcube picked'}`);
  if (day?.next) out.push(`Next loop: ${day.next}, with the decision wave`);
  const s = v.surge;
  if (s?.dry) out.push('No surge this loop: a dry day');
  else if (s) {
    const byDave = /dave/i.test(s.why ?? '');
    const at = s.t_s != null ? ` (${mss(s.t_s)} into the loop)` : '';
    const shift = s.shift ? `, moved ${Math.abs(Math.round(s.shift))} s ${s.shift > 0 ? 'later' : 'earlier'} by the room` : '';
    const cause = byDave ? "Dave's choice" : /heaviest/i.test(s.why ?? '') || !s.why ? "the day's heaviest rain" : s.why;
    out.push(`Surge at hour ${+s.hour.toFixed(1)}${at}: ${cause}${shift}`);
  }
  if (st.ropes_follow === 'sound') out.push(`Ropes follow the sound (heard ${d.heard != null ? d.heard.toFixed(2) : '?'}); the screens follow the picture`);
  else if (st.ropes_follow === 'picture') out.push(`Ropes follow the picture (river motion ${v.river.motion != null ? v.river.motion.toFixed(2) : '?'})${d.heard == null ? ': no sound from Dave' : ''}`);
  const n = v.room.lingerers.length;
  if (n) out.push(`${n === 1 ? 'Someone is' : `${n} people are`} standing still close by: the light slows and gathers toward ${v.room.lingerers.map((l) => l.label).join(' and ')}`);
  else if (v.room.relWords) out.push(`The room is ${v.room.relWords}${v.room.presence != null ? ` (${+v.room.presence.toFixed(1)} people, usually ${v.room.usual != null ? +v.room.usual.toFixed(1) : '?'})` : ''}`);
  if (st.opening_night === true) out.push('Opening night is on');
  return out;
}

/** The remembered day as a 24-hour strip (SVG, viewBox 0 0 480 120): night shaded, rain bars, the flow line, the surge marker and
 *  a playhead at the remembered hour. Colours are CSS variables (remembered.css), so it reads in both themes. */
export function dayStripSVG(v) {
  const W = 480, H = 120, top = 8, bottom = 100, x = (h) => (h / 24) * W;
  const p = v.profile;
  const parts = [`<rect class="ds-bg" x="0" y="${top}" width="${W}" height="${bottom - top}" rx="6"/>`];
  if (p?.is_day) p.is_day.forEach((d, h) => { if (d === 0) parts.push(`<rect class="ds-night" x="${x(h)}" y="${top}" width="${x(1) + 0.5}" height="${bottom - top}"/>`); });
  const rain = (p?.rain ?? []).map((r) => num(r) ?? 0), rmax = Math.max(1, ...rain);
  rain.forEach((r, h) => { if (r > 0) { const hh = (r / rmax) * (bottom - top) * 0.55; parts.push(`<rect class="ds-rain" x="${x(h) + 2}" y="${top}" width="${x(1) - 4}" height="${hh.toFixed(1)}" rx="2"/>`); } });
  const flow = (p?.flow ?? []).map((f) => num(f));
  const fv = flow.filter((f) => f != null), fmin = Math.min(...fv), fmax = Math.max(...fv);
  if (fv.length > 1) {
    let d = '', pen = false;
    flow.forEach((f, h) => {
      if (f == null) { pen = false; return; }
      const y = bottom - 6 - ((f - fmin) / Math.max(1e-6, fmax - fmin)) * (bottom - top - 30);
      d += `${pen ? 'L' : 'M'}${(x(h) + x(1) / 2).toFixed(1)},${y.toFixed(1)}`; pen = true;
    });
    parts.push(`<path class="ds-flow" d="${d}"/>`);
  }
  for (const h of [0, 6, 12, 18, 24]) parts.push(`<text class="ds-tick" x="${Math.min(W - 2, Math.max(2, x(h)))}" y="${H - 4}" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}">${String(h % 24).padStart(2, '0')}:00</text>`);
  if (v.surge && !v.surge.dry) parts.push(`<g class="ds-surge"><line x1="${x(v.surge.hour)}" x2="${x(v.surge.hour)}" y1="${top}" y2="${bottom}"/><text x="${x(v.surge.hour) + 4}" y="${bottom - 4}">surge</text></g>`);
  if (v.hour != null) parts.push(`<g class="ds-now"><line x1="${x(v.hour)}" x2="${x(v.hour)}" y1="${top - 6}" y2="${bottom + 2}"/><circle cx="${x(v.hour)}" cy="${top - 2}" r="4"/></g>`);
  const label = `The remembered day's 24 hours${v.profile ? '' : ' (no hours known)'}: rain as bars, the river's flow as a line, night shaded${v.hour != null ? `; now at ${hourWords(v.hour)}` : ''}${v.surge && !v.surge.dry ? `; the surge at ${hourWords(v.surge.hour)}` : ''}`;
  return `<svg class="daystrip" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join('')}</svg>`;
}
