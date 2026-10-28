// Everything Modal is sending (Gavin, 28 Oct: "we want to show every value coming from the modal thing"; docs/mission-ui.md
// "Modal input"). status.modal_feed (lib/modal-feed.mjs) holds Modal's two public answers as they came: public/scene.json and
// frames/latest.json. Every field is listed with its value, one plain line on what it is, and whether bitcube uses it and for
// what; a field Modal adds later is still listed (by its name, "not used yet"), so nothing it sends is hidden. Values are checked
// before they reach a page: a colour must be #rrggbb, a picture only Modal's own /frames/<id>/<element>.png, a fingerprint 64 hex
// characters, text is cut short (and the page escapes it). Relative import, as modal-input.js.
import { MODAL_BASE, FRAME_ELEMENTS, DRIVES_WORDS, PARAM_INFO, FRAME_FIELD_INFO } from './modal-input.js';
import { dur } from './model.js';

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const HEX = /^#[0-9a-f]{6}$/i;
const SHA = /^[0-9a-f]{64}$/i;
const FRAME_ID = /^[A-Za-z0-9._-]{1,80}$/;
const FRAME_PATH = /^\/frames\/[A-Za-z0-9._-]{1,80}\/(?:screen-[1-4]|ropes)\.png$/;
const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SCREEN_ELEMENTS = FRAME_ELEMENTS.slice(0, 4);
const MAX_ROWS = 150;
const KNOBS = ['speed', 'density', 'brightness', 'turbulence'];
export const NOT_USED = 'not used yet';
/** Each known field: [label, what it is, [the source that uses it, what for] | the words when bitcube doesn't use it]. */
export const SCENE_FIELDS = {
  updated_at: ['Page updated', 'When Modal last rewrote this page (the reflex below changes it every few seconds).', NOT_USED],
  'scene.animation': ['Movement', "The name of the scene's movement, which Modal's moving picture draws.", "not used by bitcube itself (Modal's moving picture draws it)"],
  'scene.colors': ['Colours', "The scene's colours, in Modal's order.", ['scene', DRIVES_WORDS.palette]],
  'scene.palette_name': ['Colour name', "Modal's name for these colours.", 'shown on this page; not in the lights'],
  'scene.speed': ['Speed', 'How fast the scene asks the river to move, 0 to 1.', ['scene', DRIVES_WORDS.speed]],
  'scene.density': ['Density', 'How busy the scene asks the river to be, 0 to 1.', ['scene', DRIVES_WORDS.density]],
  'scene.brightness': ['Brightness', 'How bright the scene asks the river to be, 0 to 1.', ['scene', DRIVES_WORDS.brightness]],
  'scene.turbulence': ['Turbulence', 'How rough the scene asks the water to be, 0 to 1.', ['scene', DRIVES_WORDS.turbulence]],
  'scene.transition_seconds': ['Blend time', 'How long a new scene takes to blend in, in seconds.', ['scene', 'how long bitcube glides to a new scene']],
  'scene.placeholder': ['Placeholder', 'Yes while Modal has no real scene yet.', ['scene', 'while yes, bitcube ignores the scene']],
  'scene.set_at': ['Chosen at', 'When Modal chose this scene.', ['scene', 'its age: older than 15 min and bitcube stops using it']],
  'scene.tick': ['Round', "Modal's count of its thinking rounds; this scene came from this one.", NOT_USED],
  'reflex.live': ['Reflex on', 'Whether the reflex is running: quick nudges from what the cameras see, between scenes.', NOT_USED],
  'reflex.offsets.speed': ['Nudge: speed', "The reflex's nudge to speed, added to the scene's.", ['scene', 'added to speed']],
  'reflex.offsets.density': ['Nudge: density', "The reflex's nudge to density, added to the scene's.", ['scene', 'added to density']],
  'reflex.offsets.brightness': ['Nudge: brightness', "The reflex's nudge to brightness, added to the scene's.", ['scene', 'added to brightness']],
  'reflex.offsets.turbulence': ['Nudge: turbulence', "The reflex's nudge to turbulence, added to the scene's.", ['scene', 'added to turbulence']],
  'reflex.updated_at': ['Nudged at', 'When the reflex last changed its nudges.', ['scene', 'nudges older than 90 s are dropped']],
  'effective.speed': ['Speed', "The scene's speed with the nudge added, as Modal works it out.", 'not used: bitcube adds the nudge itself'],
  'effective.density': ['Density', "The scene's density with the nudge added.", 'not used: bitcube adds the nudge itself'],
  'effective.brightness': ['Brightness', "The scene's brightness with the nudge added.", 'not used: bitcube adds the nudge itself'],
  'effective.turbulence': ['Turbulence', "The scene's turbulence with the nudge added.", 'not used: bitcube adds the nudge itself'],
  'journal.tick': ['Round', 'The thinking round that wrote this journal entry.', NOT_USED],
  'journal.timestamp': ['Written at', 'When Modal wrote it.', NOT_USED],
  'journal.mood_word': ['Mood', "One word for Modal's mood.", NOT_USED],
  'journal.summary': ['Journal', "Modal's journal sentence for this round.", 'shown on this page (Scene); not in the lights'],
};
export const FRAMES_FIELDS = {
  schema: ['Format', 'Which version of the frames format this is.', ['frames', 'checked: bitcube reads modal-frames/1 only']],
  layout_version: ['Layout', 'Which layout of screens and ropes the pictures are drawn for.', ['frames', "checked: must match bitcube's layout"]],
  frame_id: ['Set name', 'The name of this set of pictures; it starts with when it was sent.', ['frames', 'a new name starts a new journey']],
  issued_at: ['Sent at', 'When Modal sent this set.', 'not in the lights (the Latest line shows it)'],
  ttl_s: ['Good for', 'How long this set stays current, in seconds.', ['frames', 'the set counts as old 2 min after this runs out']],
  'transition.duration_ms': ['Journey time', 'How long the lights take to travel to the new pictures, in thousandths of a second.', ['frames', "the journey's length"]],
  'transition.easing': ['Easing', 'How that journey speeds up and slows down.', ['frames', "the journey's easing"]],
  'transition.space': ['Colour space', 'The colour space the journey travels through.', 'not read: bitcube always travels in OKLCH'],
  'transition.via': ['Via', 'Colours to pass through on the way.', ['frames', 'colours the journey passes through']],
  note: ['Note', "Modal's note about this set.", 'shown on this page (Frames); not in the lights'],
  'elements.*.image': ['Picture', 'The picture: the colours to aim for, before the river ripples them.', ['frames', 'the target picture']],
  'elements.*.sha256': ['Fingerprint', "A fingerprint of that picture (its first 12 characters here).", ['frames', 'checked when bitcube downloads the picture']],
  'elements.*.river.amount': ['Ripple', 'How much the live river ripples the picture, 0 to 1.', ['frames', 'ripple']],
  'elements.*.river.contrast': ['Ripple strength', 'How deep those ripples are, 0 to 1.', ['frames', 'ripple strength']],
  'elements.*.river.speed': ['River speed', "How fast the river's movement plays (1 is real time).", ['frames', 'river speed']],
};
/** The longer ⓘ words a field has (the panel's own explanations), by its pattern. */
const MORE = { 'scene.colors': PARAM_INFO.palette, ...Object.fromEntries(KNOBS.map((k) => [`scene.${k}`, PARAM_INFO[k]])),
  'elements.*.river.amount': FRAME_FIELD_INFO.amount, 'elements.*.river.contrast': FRAME_FIELD_INFO.contrast, 'elements.*.river.speed': FRAME_FIELD_INFO.speed };
/** A length in seconds or thousandths, said plainly beside the number ("60000" → "1 min"). */
const HINT = { 'transition.duration_ms': (v) => dur(v / 1000), ttl_s: dur, 'scene.transition_seconds': dur };
const words = (k) => { const s = String(k).replace(/[-_]+/g, ' ').replace(/\./g, ' · ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : '?'; };
const elementWords = (el) => (el === 'ropes' ? 'Ropes' : /^screen-\d+$/.test(el) ? `Screen ${el.slice(7)}` : words(el));
const pattern = (path) => path.replace(/^elements\.[^.]+\./, 'elements.*.');
const safe = (s) => String(s).replace(/[^a-z0-9-]/gi, '-').slice(0, 80);
const fixN = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));

/** One value, checked, as the page shows it: { kind: text | number | colors | time | image, text?, colors?, url?, element?, ms? }. */
function leaf(v, path, frameId) {
  if (v == null) return { kind: 'text', text: 'none' };
  if (typeof v === 'boolean') return { kind: 'text', text: v ? 'yes' : 'no' };
  if (typeof v === 'number') return Number.isFinite(v) ? { kind: 'number', text: fixN(v) } : { kind: 'text', text: 'not a number' };
  if (typeof v === 'string') {
    if (/^elements\.[^.]+\.image$/.test(path)) {
      const el = path.split('.')[1];
      if (!FRAME_PATH.test(v)) return { kind: 'text', text: `not a picture from Modal (${v.slice(0, 60)})` };
      // a fixture's frame id moves with its clock, but the path in its copy doesn't: then the picture is the set's own
      const own = frameId && FRAME_ELEMENTS.includes(el) && !v.startsWith(`/frames/${frameId}/`) ? `/frames/${frameId}/${el}.png` : v;
      return { kind: 'image', url: MODAL_BASE + own, element: FRAME_ELEMENTS.includes(el) ? el : null, text: v };
    }
    if (/\.sha256$/.test(path)) return SHA.test(v) ? { kind: 'text', text: v.slice(0, 12).toLowerCase(), mono: true } : { kind: 'text', text: 'not a fingerprint' };
    if (HEX.test(v)) return { kind: 'colors', colors: [v] };
    if (ISO_AT.test(v)) { const ms = Date.parse(v); if (Number.isFinite(ms)) return { kind: 'time', ms, text: v }; }
    return { kind: 'text', text: v.length > 300 ? v.slice(0, 300) + '…' : v };
  }
  if (Array.isArray(v)) {
    if (!v.length) return { kind: 'text', text: 'none' };
    if (v.every((c) => typeof c === 'string' && HEX.test(c))) return { kind: 'colors', colors: v.slice(0, 12) };
    if (v.every((c) => c == null || ['string', 'number', 'boolean'].includes(typeof c)))
      return { kind: 'text', text: v.slice(0, 20).map((c) => String(c).slice(0, 40)).join(', ') + (v.length > 20 ? ` … (${v.length} in all)` : '') };
  }
  return { kind: 'text', text: JSON.stringify(v).slice(0, 200) };
}
/** Every field of one answer, in Modal's order: a known one with its words, any other by its name, "not used yet". */
function fieldRows(json, known, frameId, drives) {
  const rows = [];
  const walk = (o, prefix, depth) => {
    for (const [k, v] of Object.entries(o)) {
      if (rows.length >= MAX_ROWS) return;
      const path = prefix ? `${prefix}.${k}` : k, pat = pattern(path), kn = known[pat];
      if (obj(v) && !kn && depth < 4 && Object.keys(v).length) { walk(v, path, depth + 1); continue; }
      const use = kn ? (Array.isArray(kn[2]) ? { by: kn[2][0], words: drives(pat, path) ?? kn[2][1] } : { by: null, words: kn[2] }) : { by: null, words: NOT_USED };
      const hint = HINT[pat] && num(v) != null && v > 0 ? HINT[pat](v) : null;
      rows.push({ path, key: safe(path), label: kn ? kn[0] : words(path.replace(/^(?:elements\.[^.]+|scene|reflex|effective|journal|transition)\./, '')),
                  info: kn ? kn[1] : 'New from Modal: there is no explanation for it here yet.', more: MORE[pat] ?? null, used: use, extra: !kn,
                  ...leaf(v, path, frameId), ...(hint ? { hint } : {}) });
    }
  };
  walk(json, '', 0);
  return rows;
}
/** Rows in groups by their first part ("scene", "reflex", an element), so a phone reads short lists. */
function groupRows(rows, groupOf) {
  const out = [];
  for (const r of rows) {
    const g = groupOf(r);
    let last = out.find((x) => x.id === g.id);
    if (!last) out.push(last = { ...g, rows: [] });
    last.rows.push(r);
  }
  return out;
}
const SCENE_GROUPS = { scene: 'The scene', reflex: 'Reflex: quick nudges between scenes', effective: 'With the nudges added', journal: 'Journal' };
const sceneGroup = (r) => { const t = r.path.split('.')[0]; return r.path.includes('.') ? { id: safe(t), title: SCENE_GROUPS[t] ?? `New from Modal: ${words(t)}` } : { id: 'page', title: 'This page' }; };
/** Frames: the set's own fields, the journey, then one group per element; screens 1–4 as one group while all but their picture and
 *  fingerprint read the same (as the panel's rows above), each screen's picture and fingerprint still shown. */
function frameGroups(rows) {
  const top = (r) => r.path.split('.')[0];
  const groups = groupRows(rows, (r) => (top(r) === 'elements' && r.path.split('.').length > 2 ? { id: `el-${safe(r.path.split('.')[1])}`, title: elementWords(r.path.split('.')[1]), element: r.path.split('.')[1] }
    : top(r) === 'transition' ? { id: 'transition', title: 'The journey to the new pictures' } : { id: 'set', title: 'This set' }));
  const scr = SCREEN_ELEMENTS.map((el) => groups.find((g) => g.element === el));
  const own = (r) => /\.(image|sha256)$/.test(r.path);
  const rest = (g) => JSON.stringify(g.rows.filter((r) => !own(r)).map((r) => [r.path.split('.').slice(2).join('.'), r.kind, r.text ?? null, r.colors ?? null]));
  if (!scr.every(Boolean) || !scr.every((g) => rest(g) === rest(scr[0]))) return groups;
  const items = scr.map((g) => { const im = g.rows.find((r) => /\.image$/.test(r.path)), sh = g.rows.find((r) => /\.sha256$/.test(r.path));
    return { element: g.element, url: im?.kind === 'image' ? im.url : null, text: im && im.kind !== 'image' ? im.text : null, sha: sh?.text ?? null }; });
  const merged = { id: 'el-screens', title: 'Screens 1–4 (the same settings)', element: 'screens', rows: [
    { path: 'elements.screen-1..4.image', key: 'elements-screens-image', label: 'Pictures', info: "Each screen's own picture and its fingerprint: the colours to aim for, before the river ripples them.",
      more: null, used: { by: 'frames', words: 'the target pictures' }, extra: false, kind: 'images', items },
    ...scr[0].rows.filter((r) => !own(r)).map((r) => ({ ...r, path: r.path.replace('screen-1', 'screen-1..4'), key: r.key.replace('screen-1', 'screens') }))] };
  const out = groups.filter((g) => !scr.includes(g));
  out.splice(groups.indexOf(scr[0]), 0, merged);
  return out;
}

/** status.modal_feed -> what the page lists, { scene, frames }: each null when absent, else { ok, error, fetched_age_s, changed_age_s,
 *  groups: [{ id, title, rows }], count, extra } (extra: how many fields this page has no words for). nowMs: the server's clock
 *  (status.now); mi: the panel's view (modal-input.js modalInputView), whose `drives` words say what a used scene value drives. */
export function modalFeedView(feed, nowMs = null, mi = null) {
  const f = obj(feed);
  if (!f) return null;
  const now = num(nowMs);
  const ago = (iso) => { const t = typeof iso === 'string' && ISO_AT.test(iso) ? Date.parse(iso) : NaN; return Number.isFinite(t) && now != null ? Math.max(0, Math.round((now - t) / 1000)) : null; };
  const drivesOf = (name) => { const p = Array.isArray(mi?.params) ? mi.params.find((x) => x.name === name) : null; return typeof p?.drives === 'string' ? p.drives : null; };
  const one = (key, known, groupsOf, drives) => {
    const e = obj(f[key]);
    if (!e) return null;
    const json = obj(e.json);
    const frameId = key === 'frames' && json && typeof json.frame_id === 'string' && FRAME_ID.test(json.frame_id) ? json.frame_id : null;
    const rows = json ? fieldRows(json, known, frameId, drives) : [];
    return { ok: e.ok === true ? true : e.ok === false ? false : null, error: typeof e.error === 'string' ? e.error.slice(0, 200) : null,
             fetched_age_s: ago(e.fetched_at), changed_age_s: ago(e.changed_at), groups: groupsOf(rows), count: rows.length, extra: rows.filter((r) => r.extra).length };
  };
  return {
    scene: one('scene', SCENE_FIELDS, (rows) => groupRows(rows, sceneGroup),
      (pat) => (pat === 'scene.colors' ? drivesOf('palette') : /^scene\./.test(pat) && KNOBS.includes(pat.slice(6)) ? drivesOf(pat.slice(6)) : null)),
    frames: one('frames', FRAMES_FIELDS, frameGroups, (_pat, path) => (/^elements\.[^.]+\.image$/.test(path) ? `the target picture for ${elementWords(path.split('.')[1]).toLowerCase()}` : null)),
  };
}
