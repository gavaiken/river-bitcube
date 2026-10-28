// The Modal input show's panel (docs/modal-inputs.md, docs/mission-ui.md "Modal input"): td.modal_input as the pages show it,
// "What Modal is sending". Split from model.js (which keeps the choice's words, the stale verdict and the control) to keep
// model.js small for phones. Relative import: in the browser this is /model.js, under node the same file.
import { dur, clock, MODAL_SOURCES, MODAL_SOURCE_WORDS, modalStaleWords } from './model.js';

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** Dave's river app (public): the frames' PNGs are at /frames/<frame_id>/<element>.png (modal-frames/SPEC.md §3). */
export const MODAL_BASE = 'https://to-be-a-river--river.modal.run';
export const FRAME_ELEMENTS = ['screen-1', 'screen-2', 'screen-3', 'screen-4', 'ropes'];
const SCREEN_ELEMENTS = FRAME_ELEMENTS.slice(0, 4);
const FRAME_ID = /^[A-Za-z0-9._-]{1,80}$/;
const FRAME_PATH = /^\/frames\/[A-Za-z0-9._-]{1,80}\/(?:screen-[1-4]|ropes)\.png$/;
const HEX = /^#[0-9a-f]{6}$/i;
/** A frame element's river settings, in plain words (modal-frames/SPEC.md §4): amount, contrast, speed, journey. */
export const FRAME_FIELD_WORDS = { amount: 'ripple', contrast: 'ripple strength', speed: 'river speed', journey: 'arrived', mix: 'mixed in' };
const FRAME_FIELD_MAX = { amount: 1, contrast: 1, speed: 2, journey: 1, mix: 1 };
/** Who each value comes from (Gavin, 28 Oct: "none of it is explained"): Modal (Dave's agent), bitcube itself, or the Strength chosen
 *  on this page. The page marks it beside the value. */
export const FROM_WORDS = { modal: 'from Modal', bitcube: 'on bitcube', you: 'your setting' };
export const FRAME_FIELD_FROM = { amount: 'modal', contrast: 'modal', speed: 'modal', journey: 'bitcube', mix: 'you' };
/** What each frame value means, for the page's ⓘ (short sentences, the copy rules' plain words). */
export const FRAME_FIELD_INFO = {
  amount: "How much the river's light and dark moves through Modal's picture: 0 keeps the picture still, 1 lets the river move it fully.",
  contrast: 'How deep those ripples are: low is a gentle shimmer, high makes strong bright and dark bands.',
  speed: "How fast the river's movement plays: 1× is real time. The live river video can't go faster than 1×; only the recorded river can.",
  journey: "How far the lights have travelled from Modal's previous picture to this one: 100 % means they show the newest picture now.",
  mix: "Your Strength setting, as applied now: how much of Modal's frames replaces the river look. 0 % is the river alone.",
};
/** What each scene knob (and the canvas) changes in the lights, for the page's ⓘ. */
export const PARAM_INFO = {
  palette: "Modal's colours. bitcube recolours the river with them: its dark water takes the darker colours, its bright water the lighter ones.",
  speed: 'How fast the moving effects drawn over the river play on the ropes and screens. The live river video itself stays at camera speed.',
  density: 'How many of those moving effects there are at once: more makes the lights busier.',
  brightness: 'How bright the river looks on the ropes and screens.',
  turbulence: 'How rough the water looks: higher breaks the light into choppier, faster-changing patches.',
  canvas: "Modal's moving picture: a web page it draws all the time. bitcube adds it over the river as it plays, at your Strength.",
};
/** "×0.85 of the usual", explained. */
export const FACTOR_INFO = 'What bitcube applies now, after your Strength: ×1 is the river as Will tuned it, below 1 calmer, above 1 stronger.';
/** What each parameter drives, in the pages' words (docs/modal-inputs.md "params"); TouchDesigner's own `drives` text (engineering
 *  words: "gradient map by brightness") is kept for Will (drives_raw) and only shown in its place for a name not listed here. */
export const DRIVES_WORDS = {
  palette: "the river's colours: its dark and bright parts take the palette's colours",
  speed: 'how fast the summer effects move', density: 'how many summer effects there are', brightness: 'how bright the river is',
  turbulence: 'how rough the water looks', canvas: "Modal's moving picture, added over the river",
  'screen-1': "screen 1: Modal's picture, rippled by the river", 'screen-2': "screen 2: Modal's picture, rippled by the river",
  'screen-3': "screen 3: Modal's picture, rippled by the river", 'screen-4': "screen 4: Modal's picture, rippled by the river",
  ropes: "the 20 ropes: Modal's picture, rippled by the river",
};
const paramLabel = (n) => { const s = String(n).replace(/[-_]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : '?'; };

/** The issue time Modal puts at the start of a frame id ("2026-10-28T01-16-01Z-9672": issued 01:16:01 UTC), in ms, or null. */
export function frameIssuedMs(id) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z/.exec(typeof id === 'string' ? id : '');
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(t) ? t : null;
}
const isoMs = (x) => { if (typeof x !== 'string' || x.length > 40) return null; const t = Date.parse(x); return Number.isFinite(t) ? t : null; };
/** How often Dave sends something new, from the moments mission control has seen (each distinct frame's or scene's own time): the
 *  median gap between successive ones, ignoring gaps over 30 min (his overnight rest, a restart). null below two moments. */
export function cadenceS(moments) {
  const t = [...new Set((Array.isArray(moments) ? moments : []).filter((x) => num(x) != null))].sort((a, b) => a - b);
  const gaps = t.slice(1).map((x, k) => (x - t[k]) / 1000).filter((g) => g > 0 && g <= 1800).sort((a, b) => a - b);
  if (!gaps.length) return null;
  const mid = gaps.length >> 1;
  return Math.round(gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2);
}
/** One line saying what arrives from Dave for a source, in plain words. transition_s: how long bitcube takes to reach a new one. */
export function sourceIntro(source, transition_s = null) {
  const over = num(transition_s) != null && transition_s > 0 ? `over ${dur(transition_s)}` : 'over a few seconds';
  if (source === 'frames') return `Modal sends a new set of pictures every few minutes: one for each screen and one for all 20 ropes (the colours to aim for), plus how strongly the live river should ripple them. bitcube travels to each new set ${over}.`;
  if (source === 'scene') return `Modal picks a new scene every few minutes: a set of colours, and four settings for how the river moves. bitcube recolours and steers the river with them, gliding to each new scene ${over}.`;
  if (source === 'canvas') return "Modal draws a moving picture on a web page, all the time. bitcube adds it over the river as it plays, at your Strength.";
  return null;
}
/** A frame value as the page writes it, so "the same" means what a person would read as the same. */
const shown = (f) => (f.key === 'journey' || f.key === 'mix' ? Math.round(f.value * 100) : Math.round(f.value * 100) / 100);
const sameFields = (a, b) => a.length === b.length && a.every((f, k) => f.key === b[k].key && shown(f) === shown(b[k]));

/** td.modal_input -> what the page shows (show.modal_input), or null when it isn't an object. later_s: how old the full check is
 *  (pb.age_s), added to every age so they read on the server's clock (principle 2); nowMs: the server's clock at that answer
 *  (status.now), for the age of Dave's own times (a frame id's issue time, the scene's set_at). Everything is checked: a colour
 *  must be #rrggbb, a number finite, a frame id or image path Modal's own shape, so nothing odd reaches a page or a URL. */
export function modalInputView(mi, later_s = 0, nowMs = null) {
  const o = obj(mi);
  if (!o) return null;
  const add = (a) => (num(a) == null ? null : Math.max(0, Math.round(a + (num(later_s) ?? 0))));
  const source = MODAL_SOURCES.includes(o.source) ? o.source : null;
  const effective = MODAL_SOURCES.includes(o.effective_source) ? o.effective_source : source;
  const strength = num(o.strength) != null ? Math.min(1, Math.max(0, o.strength)) : null;
  const srcs = obj(o.sources) ?? {};
  const sources = ['canvas', 'scene', 'frames'].map((id) => {
    const s = obj(srcs[id]);
    return { id, label: MODAL_SOURCE_WORDS[id].label, ok: s ? s.ok !== false : null, age_s: s ? add(s.age_s) : null, known: !!s };
  });
  const fr = obj(srcs.frames), sc = obj(srcs.scene);
  const activeAge = sources.find((x) => x.id === effective)?.age_s ?? null;   // a parameter with no age of its own: its source's
  const frameId = typeof fr?.frame_id === 'string' && FRAME_ID.test(fr.frame_id) ? fr.frame_id : null;
  const params = (Array.isArray(o.params) ? o.params : []).map(obj).filter((p) => p && typeof p.name === 'string' && p.name).slice(0, 24).map((p) => {
    const raw = typeof p.drives === 'string' ? p.drives.slice(0, 200) : null;
    const v = p.value, base = { name: p.name, label: p.name === 'palette' ? "Modal's colours" : paramLabel(p.name), drives: DRIVES_WORDS[p.name] ?? raw, drives_raw: raw,
                                age_s: add(p.age_s) ?? activeAge, own_age: num(p.age_s) != null, factor: num(p.factor), info: PARAM_INFO[p.name] ?? null };
    if (Array.isArray(v) && v.length && v.every((c) => typeof c === 'string' && HEX.test(c))) return { ...base, kind: 'palette', colors: v.slice(0, 12) };
    if (num(v) != null) {
      const min = num(p.min) ?? 0, max = num(p.max) ?? Math.max(1, v), eff = num(p.effective);
      return { ...base, kind: 'number', value: v, effective: eff != null && Math.abs(eff - v) > 1e-6 ? eff : null, min, max,
               frac: max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0 };
    }
    if (obj(v)) {
      const vv = { ...v, ...(num(p.mix) != null ? { mix: p.mix } : {}) };     // the element's applied mix with Combined sits beside value
      const fields = Object.keys(FRAME_FIELD_WORDS).filter((k) => num(vv[k]) != null)
        .map((k) => ({ key: k, words: FRAME_FIELD_WORDS[k], value: vv[k], frac: Math.min(1, Math.max(0, vv[k] / FRAME_FIELD_MAX[k])),
                       from: FRAME_FIELD_FROM[k], info: FRAME_FIELD_INFO[k] }));
      const image = typeof p.image === 'string' && FRAME_PATH.test(p.image) ? MODAL_BASE + p.image
        : FRAME_ELEMENTS.includes(p.name) && frameId ? `${MODAL_BASE}/frames/${frameId}/${p.name}.png` : null;
      return { ...base, kind: 'frame', fields, image };
    }
    if (typeof v === 'string' || typeof v === 'boolean') return { ...base, kind: 'text', text: String(v).slice(0, 120) };
    return { ...base, kind: 'text', text: 'not known' };
  });
  // frames: screens 1–4 in one row when they read the same, one row each when they differ; the ropes always their own
  let rows = params;
  const scr = SCREEN_ELEMENTS.map((n) => params.find((p) => p.name === n && p.kind === 'frame')).filter(Boolean);
  if (scr.length === 4 && scr[0].fields.length && scr.every((p) => sameFields(p.fields, scr[0].fields))) {
    const at = params.indexOf(scr[0]);
    rows = params.filter((p) => !scr.includes(p));
    rows.splice(at, 0, { ...scr[0], name: 'screens', label: 'Screens 1–4', names: [...SCREEN_ELEMENTS], image: null,
      drives: "screens 1 to 4: each its own picture from Modal, rippled by the river (all four have the same settings now)" });
  }
  const images = frameId ? FRAME_ELEMENTS.map((el) => params.find((p) => p.name === el && p.image)?.image ?? `${MODAL_BASE}/frames/${frameId}/${el}.png`)
    .map((url, k) => ({ element: FRAME_ELEMENTS[k], url })) : [];
  const stale = o.stale === true && source != null && source !== 'off';   // Off has nothing to go old
  const fresh = sources.filter((s) => s.known).map((s) => s.ok === false ? `${s.label} not arriving`
    : s.id === 'canvas' ? (s.age_s != null && s.age_s > 120 ? `${s.label} ${dur(s.age_s)} ago` : `${s.label} live`) : s.age_s == null ? `${s.label} age not known` : `${s.label} ${dur(s.age_s)} ago`);
  // What Dave sent last for the chosen source: when (his own time: the frame id's issue time, the scene's set_at; else when it
  // arrived here) and how often lately (the moments mission control has seen: td.modal_input.seen, lib/modal-seen.mjs).
  const seen = obj(o.seen) ?? {}, now = num(nowMs);
  const ageAt = (ms) => (ms == null || now == null ? null : Math.max(0, Math.round((now - ms) / 1000)));
  const trMs = num(fr?.transition_ms) ?? num(obj(fr?.transition)?.duration_ms);
  const trS = num(fr?.transition_s) ?? (trMs != null ? trMs / 1000 : null);
  const frIssued = isoMs(fr?.issued_at) ?? frameIssuedMs(frameId), scSet = isoMs(sc?.set_at);
  const latestOf = (id) => {
    const s = sources.find((x) => x.id === id);
    if (id === 'frames' && fr) {
      const ids = (Array.isArray(seen.frames) ? seen.frames : []).slice(-20).map(frameIssuedMs);
      return { what: 'new pictures', clock: frIssued != null ? clock(frIssued) : null, age_s: ageAt(frIssued), arrived_age_s: s.age_s,
               every_s: cadenceS([...ids, frIssued]) };
    }
    if (id === 'scene' && sc) {
      const ts = (Array.isArray(seen.scene) ? seen.scene : []).slice(-20).map(isoMs);
      return { what: 'a new scene', clock: scSet != null ? clock(scSet) : null, age_s: ageAt(scSet), arrived_age_s: s.age_s, every_s: cadenceS([...ts, scSet]) };
    }
    if (id === 'canvas' && s?.known) return { what: 'its moving picture', live: s.ok !== false && s.age_s != null && s.age_s <= 120, clock: null, age_s: null, arrived_age_s: s.age_s, every_s: null };
    return null;
  };
  return {
    source, effective_source: effective, strength, fading: o.fading === true, stale,
    stale_words: stale ? modalStaleWords(source, o) : null,
    stale_raw: stale && typeof o.stale_reason === 'string' ? o.stale_reason.slice(0, 200) : null,
    age_s: add(o.data_age_s),
    intro: sourceIntro(source, source === 'frames' ? trS : num(sc?.transition_s)),
    latest: source && source !== 'off' ? latestOf(source) : null,
    sources, fresh_words: fresh.join(' · '),
    params, rows,
    scene: sc ? { palette_name: typeof sc.palette_name === 'string' ? sc.palette_name.slice(0, 80) : null, animation: typeof sc.animation === 'string' ? sc.animation.slice(0, 80) : null, journal: typeof sc.journal === 'string' ? sc.journal.slice(0, 400) : null } : null,
    frames: fr ? { frame_id: frameId, note: typeof fr.note === 'string' ? fr.note.slice(0, 280) : null, images,
                   issued_clock: frIssued != null ? clock(frIssued) : null, issued_age_s: ageAt(frIssued) } : null,
  };
}
