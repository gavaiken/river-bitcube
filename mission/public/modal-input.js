// The Modal input show's panel (docs/modal-inputs.md, docs/mission-ui.md "Modal input"): td.modal_input as the pages show it,
// "What Dave's agent is sending". Split from model.js (which keeps the choice's words, the stale verdict and the control) to keep
// model.js small for phones. Relative import: in the browser this is /model.js, under node the same file.
import { dur, MODAL_SOURCES, MODAL_SOURCE_WORDS, modalStaleWords } from './model.js';

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** Dave's river app (public): the frames' PNGs are at /frames/<frame_id>/<element>.png (modal-frames/SPEC.md §3). */
export const MODAL_BASE = 'https://to-be-a-river--river.modal.run';
export const FRAME_ELEMENTS = ['screen-1', 'screen-2', 'screen-3', 'screen-4', 'ropes'];
const FRAME_ID = /^[A-Za-z0-9._-]{1,80}$/;
const FRAME_PATH = /^\/frames\/[A-Za-z0-9._-]{1,80}\/(?:screen-[1-4]|ropes)\.png$/;
const HEX = /^#[0-9a-f]{6}$/i;
/** A frame element's river settings, in plain words (modal-frames/SPEC.md §4): amount, contrast, speed, journey. */
export const FRAME_FIELD_WORDS = { amount: 'ripple', contrast: 'ripple strength', speed: 'river speed', journey: 'arrived', mix: 'mixed in' };
const FRAME_FIELD_MAX = { amount: 1, contrast: 1, speed: 2, journey: 1, mix: 1 };
/** What each parameter drives, in the pages' words (docs/modal-inputs.md "params"); TouchDesigner's own `drives` text (engineering
 *  words: "gradient map by brightness") is kept for Will (drives_raw) and only shown in its place for a name not listed here. */
export const DRIVES_WORDS = {
  palette: "the river's colours: its dark and bright parts take the palette's colours",
  speed: 'how fast the summer effects move', density: 'how many summer effects there are', brightness: 'how bright the river is',
  turbulence: 'how rough the water looks', canvas: "Dave's moving picture, added over the river",
  'screen-1': "screen 1: Dave's picture, rippled by the river", 'screen-2': "screen 2: Dave's picture, rippled by the river",
  'screen-3': "screen 3: Dave's picture, rippled by the river", 'screen-4': "screen 4: Dave's picture, rippled by the river",
  ropes: "the 20 ropes: Dave's picture, rippled by the river",
};
const paramLabel = (n) => { const s = String(n).replace(/[-_]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : '?'; };

/** td.modal_input -> what the page shows (show.modal_input), or null when it isn't an object. later_s: how old the full check is
 *  (pb.age_s), added to every age so they read on the server's clock (principle 2). Everything is checked: a colour must be
 *  #rrggbb, a number finite, a frame id or image path Modal's own shape, so nothing odd reaches a page or a URL. */
export function modalInputView(mi, later_s = 0) {
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
    const v = p.value, base = { name: p.name, label: paramLabel(p.name), drives: DRIVES_WORDS[p.name] ?? raw, drives_raw: raw, age_s: add(p.age_s) ?? activeAge,
                                factor: num(p.factor) };
    if (Array.isArray(v) && v.length && v.every((c) => typeof c === 'string' && HEX.test(c))) return { ...base, kind: 'palette', colors: v.slice(0, 12) };
    if (num(v) != null) {
      const min = num(p.min) ?? 0, max = num(p.max) ?? Math.max(1, v), eff = num(p.effective);
      return { ...base, kind: 'number', value: v, effective: eff != null && Math.abs(eff - v) > 1e-6 ? eff : null, min, max,
               frac: max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0 };
    }
    if (obj(v)) {
      const vv = { ...v, ...(num(p.mix) != null ? { mix: p.mix } : {}) };     // the element's applied mix with Combined sits beside value
      const fields = Object.keys(FRAME_FIELD_WORDS).filter((k) => num(vv[k]) != null)
        .map((k) => ({ key: k, words: FRAME_FIELD_WORDS[k], value: vv[k], frac: Math.min(1, Math.max(0, vv[k] / FRAME_FIELD_MAX[k])) }));
      const image = typeof p.image === 'string' && FRAME_PATH.test(p.image) ? MODAL_BASE + p.image
        : FRAME_ELEMENTS.includes(p.name) && frameId ? `${MODAL_BASE}/frames/${frameId}/${p.name}.png` : null;
      return { ...base, kind: 'frame', fields, image };
    }
    if (typeof v === 'string' || typeof v === 'boolean') return { ...base, kind: 'text', text: String(v).slice(0, 120) };
    return { ...base, kind: 'text', text: 'not known' };
  });
  const images = frameId ? FRAME_ELEMENTS.map((el) => params.find((p) => p.name === el && p.image)?.image ?? `${MODAL_BASE}/frames/${frameId}/${el}.png`)
    .map((url, k) => ({ element: FRAME_ELEMENTS[k], url })) : [];
  const stale = o.stale === true && source != null && source !== 'off';   // Off has nothing to go old
  const fresh = sources.filter((s) => s.known).map((s) => s.ok === false ? `${s.label} not arriving`
    : s.id === 'canvas' ? (s.age_s != null && s.age_s > 120 ? `${s.label} ${dur(s.age_s)} ago` : `${s.label} live`) : s.age_s == null ? `${s.label} age not known` : `${s.label} ${dur(s.age_s)} ago`);
  return {
    source, effective_source: effective, strength, fading: o.fading === true, stale,
    stale_words: stale ? modalStaleWords(source, o) : null,
    stale_raw: stale && typeof o.stale_reason === 'string' ? o.stale_reason.slice(0, 200) : null,
    age_s: add(o.data_age_s),
    sources, fresh_words: fresh.join(' · '),
    params,
    scene: sc ? { palette_name: typeof sc.palette_name === 'string' ? sc.palette_name.slice(0, 80) : null, animation: typeof sc.animation === 'string' ? sc.animation.slice(0, 80) : null, journal: typeof sc.journal === 'string' ? sc.journal.slice(0, 400) : null } : null,
    frames: fr ? { frame_id: frameId, note: typeof fr.note === 'string' ? fr.note.slice(0, 280) : null, images } : null,
  };
}
