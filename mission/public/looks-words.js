// The Looks page's words (/looks; docs/mission-ui.md "Looks page"): what shows now, the playlist as rows, each look's section and the
// inputs the looks share, all from the model (derive()) and the looks status (public/looks.js looksView). Pure: the page only places
// what this returns, and test/looks-page.test.mjs reads it in node. Relative imports: in the browser /model.js, under node the file.
import { FILES, ALL_LOOKS_FILE, LOOK_IN_LINE, dur } from './model.js';
import { looksView, LOOK_WORDS, DEFAULT_PLAYLIST, unitFor, FOR_RANGE, PLAYLIST_MAX, positionWords, forWords, checkPlaylist } from './looks.js';

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
/** Dave's inputs older than this are amber (his agent ticks every few minutes); the river's frames older than this. */
export const DAVE_OLD_S = 300;
export const RIVER_OLD_S = 10;
/** The river's year control page, as Status addresses bitcube (TouchDesigner serves it on 9981; Tailscale). */
export const SEASONS_PAGE = 'http://100.73.68.60:9981/';
/** The playlist needs this file; the others play their own Auto. */
export const PLAYLIST_ONLY = "the playlist works only in the river (all looks, playlist); this file plays its own Auto (four loops of the remembered river, then one Fill my cup (simple))";

/** A look's title, description and inputs: shows.json's entry for the running file ("looks": { look: { title, description, inputs } }),
 *  else the built-in title and no description. */
export function lookInfo(file, look) {
  const l = obj(obj(FILES[file]?.show?.looks)?.[look]);
  return { look, title: str(l?.title) ?? LOOK_WORDS[look] ?? look, description: str(l?.description) ?? '',
           inputs: Array.isArray(l?.inputs) ? l.inputs.filter((x) => typeof x === 'string' && x.trim()) : [] };
}

/** One playlist row's words: { look, title, unit, n, words: "for 4 loops", min, max, canLess, canMore }. */
export function rowWords(file, e) {
  const unit = Object.keys(obj(e?.for) ?? {})[0] ?? unitFor(e?.look), n = num(e?.for?.[unit]) ?? 1, [min, max] = FOR_RANGE[unit] ?? [1, 20];
  return { look: e?.look, title: lookInfo(file, e?.look).title, unit, n, words: `for ${forWords({ [unit]: n })}`, min, max, canLess: n > min, canMore: n < max };
}
/** A new entry for a look: one loop, one cycle or ten minutes. */
export const newEntry = (look) => ({ look, for: { [unitFor(look)]: unitFor(look) === 'minutes' ? 10 : 1 } });
/** The draft after one edit: { op: 'more'|'less'|'up'|'down'|'remove'|'add', i, look }. Never out of bounds, never empty. */
export function editPlaylist(list, { op, i, look }) {
  const p = list.map((e) => ({ look: e.look, for: { ...e.for } }));
  const e = p[i];
  if ((op === 'more' || op === 'less') && e) {
    const u = Object.keys(e.for)[0], [lo, hi] = FOR_RANGE[u];
    e.for[u] = Math.min(hi, Math.max(lo, e.for[u] + (op === 'more' ? 1 : -1)));
  } else if (op === 'up' && i > 0) [p[i - 1], p[i]] = [p[i], p[i - 1]];
  else if (op === 'down' && i < p.length - 1) [p[i + 1], p[i]] = [p[i], p[i + 1]];
  else if (op === 'remove' && p.length > 1) p.splice(i, 1);
  else if (op === 'add' && look && p.length < PLAYLIST_MAX) p.push(newEntry(look));
  return p;
}

/** A value from the inputs or `used`, in words: numbers to two places, lists joined, objects as "k v, k v", null "not known". */
export function valueWords(v) {
  if (v == null) return 'not known';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.length ? v.map(valueWords).join(', ') : 'none';
  if (typeof v === 'object') { const e = Object.entries(v); return e.length ? e.map(([k, x]) => `${KEY_WORDS[k] ?? k} ${valueWords(x)}`).join(', ') : 'none'; }
  return String(v);
}
/** The words for the keys the looks are known to use (contract 3); any other key is shown as it comes. */
export const KEY_WORDS = { day: 'Day', why: 'Why', heard: 'Heard', knobs: 'Knobs', room: 'Room', steering: 'Steering', speed: 'Speed', source: 'Source',
  strength: 'Strength', density: 'density', brightness: 'brightness', turbulence: 'turbulence', ropes: 'ropes', seconds: 'seconds' };
/** `used` as "key: value" lines: [{ key, words }]. */
export const usedLines = (used) => Object.entries(obj(used) ?? {}).map(([k, v]) => ({ key: KEY_WORDS[k] ?? k, words: valueWords(v) }));

/** The Inputs card: Dave's agent, the river, the room, each { lines: [{ key, words }], old, age }; and what the look showing did. */
export function inputsWords(inputs, used, look) {
  const i = obj(inputs);
  if (!i) return null;
  const d = obj(i.dave), r = obj(i.river), rm = obj(i.room);
  const dAge = num(d?.age_s), rAge = num(r?.age_s);
  const dave = d && { age: dAge == null ? 'age not known' : `answered ${dur(dAge)} ago`, old: dAge != null && dAge > DAVE_OLD_S, palette: Array.isArray(d.palette) ? d.palette.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)) : [],
    lines: [['Remembered day', d.memory_date], ['Surge at', num(d.surge_at) == null ? null : `hour ${d.surge_at}`], ['Scene', d.scene], ['Knobs', d.knobs],
            ['Heard', num(d.heard) == null ? null : `${valueWords(d.heard)}${num(d.heard_age_s) != null ? ` (${dur(d.heard_age_s)} ago)` : ''}`]].map(([key, v]) => ({ key, words: valueWords(v) })) };
  const SOURCE = { live: 'the live river camera', clip: 'the recorded clip (the camera is not reaching it)', none: 'no river picture' };
  const river = r && { age: rAge == null ? 'age not known' : `last frame ${dur(rAge)} ago`, old: (rAge != null && rAge > RIVER_OLD_S) || r.source === 'none' || r.source === 'clip',
    lines: [{ key: 'Source', words: SOURCE[r.source] ?? valueWords(r.source) }, { key: 'Motion', words: valueWords(r.motion) }] };
  const lingerers = Array.isArray(rm?.lingerers) ? rm.lingerers.filter(obj) : [];
  const room = rm && { old: false, age: '',
    lines: [{ key: 'People', words: num(rm.people) == null ? 'not known' : `${valueWords(rm.people)}${num(rm.usual) != null ? ` (usually ${valueWords(rm.usual)})` : ''}` },
            { key: 'Lingering', words: lingerers.length ? lingerers.map((l) => `by ropes ${valueWords(l.ropes)}${num(l.seconds) != null ? ` for ${dur(l.seconds)}` : ''}`).join('; ') : 'nobody' }] };
  const u = usedLines(used);
  return { dave, river, room, used: { title: look ? `What ${LOOK_IN_LINE[look] ?? 'the look'} did with them` : 'What the look did with them', lines: u,
    none: u.length ? null : look ? `${LOOK_IN_LINE[look] ?? 'This look'} doesn't use them` : 'No look is showing' } };
}

/** The page's view: m the model (derive()), draft the local playlist (null: none). See docs/mission-ui.md "Looks page".
 *  -> { file, allLooks, running, why, applyWhy, now: { title, mode, line, fading, old } | null, listed: [look],
 *       playlist: { rows, source: 'draft'|'bitcube'|'asked'|'default', note, changed, body }, sections: [{ look, title, description, inputs, showing }],
 *       inputs, problems } */
export function pageView(m, draft = null) {
  const file = m?.show?.file?.name ?? null, raw = m?.show?.looks ?? null;
  const v = raw ? looksView(raw, m?.show?.fresh?.probe_age_s ?? 0) : null;
  const allLooks = file === ALL_LOOKS_FILE, why = m?.controls?.looks?.why ?? null;
  const n = v?.now ?? null;
  const listed = n?.looks?.length ? n.looks : raw ? ['remembered', 'fill-simple', 'fill-configurable'] : [];
  const showing = n?.fading && n.target ? n.target : n?.look ?? null;
  const now = n ? { title: n.look ? lookInfo(file, n.look).title : 'A look it doesn\'t name', mode: n.mode === 'manual' ? 'Pinned (manual)' : n.mode === 'auto' ? 'Playing the playlist (auto)' : 'Mode not known',
    line: n.mode === 'auto' && n.playlist ? positionWords(n.position, n.playlist.length, n.progress) : n.mode === 'manual' ? 'It stays on this look' : '',
    fading: n.fading && n.target ? `Fading to ${LOOK_IN_LINE[n.target] ?? 'another look'}${n.fade != null ? ` (${Math.round(n.fade * 100)} %)` : ''}` : null,
    old: n.old, age_s: n.age_s, position: n.mode === 'auto' && n.playlist ? n.position : null } : null;
  const inForce = n?.playlist?.length ? n.playlist : null, asked = v?.asked?.playlist ?? null;
  const base = inForce ?? asked ?? DEFAULT_PLAYLIST;
  const source = draft ? 'draft' : inForce ? 'bitcube' : asked ? 'asked' : 'default';
  const list = draft ?? base;
  const body = checkPlaylist(list, listed) ? { mode: 'auto', playlist: checkPlaylist(list, listed) } : null;
  const NOTE = { draft: 'Your draft: nothing is sent until Apply.', bitcube: 'The playlist bitcube plays.', asked: "The playlist sent to bitcube (the show hasn't said it plays it yet).",
    default: "The file's default: no playlist has been set." };
  const applyWhy = why ?? (raw && !allLooks ? PLAYLIST_ONLY : null) ?? (!body ? 'the playlist has a look this file doesn\'t have' : null);
  return {
    file, allLooks, running: !!raw, why, applyWhy, now, listed, showing,
    playlist: { rows: list.map((e) => rowWords(file, e)), source, note: NOTE[source], changed: !!draft && JSON.stringify(draft) !== JSON.stringify(base), body,
                full: list.length >= PLAYLIST_MAX, addable: listed },
    sections: listed.map((l) => ({ ...lookInfo(file, l), showing: l === showing, pinned: n?.mode === 'manual' && n.look === l,
                                   state: l === showing ? showingWords(n?.progress) : null })),
    inputs: n ? inputsWords(n.inputs, n.used, n.look) : null,
    problems: v?.problems ?? [],
    pinBody: (look) => ({ mode: 'manual', look }), backBody: { mode: 'auto' },
    manual: n?.mode === 'manual',
  };
}
/** "Showing now · loop 3 of 4" for the look's card (its progress through its playlist entry), or "Showing now". */
export function showingWords(progress) {
  const pr = obj(progress);
  if (!pr || !Number.isFinite(pr.of) || !Number.isFinite(pr.done)) return 'Showing now';
  const unit = pr.unit === 'minutes' ? 'minute' : String(pr.unit ?? '').replace(/s$/, '');
  return `Showing now · ${unit} ${Math.min(pr.done + 1, pr.of)} of ${pr.of}`;
}
/** What each look's section says about its settings, and where they are: { line, link: [label, href] | null }. */
export function settingsWords(look) {
  switch (look) {
    case 'remembered': return { line: 'Its live state (the day, the phase, the loop, what Dave sent) and its settings are on its own page.', link: ['See and configure: Remembered river page', '/remembered'] };
    case 'fill-simple': return { line: 'It has no settings: the glass fills and drains in the river blues.', link: null };
    case 'fill-configurable': return { line: "Its dials (colours, brightness, intensity, speed) are on Status, under What's showing, while it shows: bitcube takes them only then.", link: ['Fill my cup dials: Status', '/status#ctl-filling'] };
    case 'seasons': return { line: "Its control page is TouchDesigner's own, on bitcube (needs Tailscale). Settings made ahead take effect when it shows.", link: ["The river's year page", SEASONS_PAGE] };
    case 'modal': return { line: "Which Modal input steers it and how strongly: the Modal input card on Status, when bitcube reports it for this file.", link: ['Modal input: Status', '/status'] };
    default: return { line: '', link: null };
  }
}
