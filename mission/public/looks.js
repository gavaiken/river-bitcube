// The river (all looks)'s card (river-looks.toe, docs/mission-ui.md "Looks"): the full check's probe.looks as the Status card shows
// it. Pure, so the server (mc.mjs status), the tests and the page read it alike. Relative import: in the browser this is /model.js,
// under node the same file.
import { LOOKS, LOOK_IN_LINE, FILL_LOOKS } from './model.js';

/** How long a playlist entry plays, in words: "4 loops", "1 cycle", "10 minutes" (null for a shape it isn't). */
export function forWords(f) {
  const o = f && typeof f === 'object' ? f : null, k = o && ['loops', 'cycles', 'minutes'].find((u) => typeof o[u] === 'number');
  return k ? `${o[k]} ${o[k] === 1 ? k.slice(0, -1) : k}` : null;
}

export const LOOK_MODES = ['auto', 'manual'];
/** Each look's name as its button says it (in a sentence: model.js LOOK_IN_LINE). */
export const LOOK_WORDS = { remembered: 'The remembered river', 'fill-simple': 'Fill my cup (simple)', 'fill-configurable': 'Fill my cup (configurable)',
  seasons: "The river's year", modal: 'Combined with Modal Input Selector' };
// ---- the playlist (river-all-looks.toe; docs/mission-ui.md "Looks"): control.json playlist, as td/looks reads it --------------------
/** What auto plays when control.json has no playlist (the file's default; river-looks.toe's Auto is the same). */
export const DEFAULT_PLAYLIST = [{ look: 'remembered', for: { loops: 4 } }, { look: 'fill-simple', for: { cycles: 1 } }];
/** 1..12 entries; loops and cycles 1..20, minutes 1..120 (whole numbers). */
export const PLAYLIST_MAX = 12;
export const FOR_RANGE = { loops: [1, 20], cycles: [1, 20], minutes: [1, 120] };
/** The units an entry's look may use: loops only for the remembered river, cycles only for the fills, minutes for any look. */
export const unitsFor = (l) => (l === 'remembered' ? ['loops', 'minutes'] : FILL_LOOKS.includes(l) ? ['cycles', 'minutes'] : ['minutes']);
/** The unit the Looks page's editor uses for a look (fixed per look): loops, cycles, else minutes. */
export const unitFor = (l) => unitsFor(l)[0];
/** Why a playlist isn't one bitcube takes (the 400's words, probe.ps1 says the same), or null. looks: the looks allowed. */
export function playlistProblem(p, looks = LOOKS) {
  if (!Array.isArray(p)) return 'playlist is a list of { look, for }';
  if (p.length < 1 || p.length > PLAYLIST_MAX) return `playlist has 1 to ${PLAYLIST_MAX} entries`;
  for (const [i, e] of p.entries()) {
    const at = `playlist entry ${i + 1}`;
    if (!obj(e)) return `${at} is { look, for }`;
    if (!looks.includes(e.look)) return `${at}: look is ${looks.join(', ')}`;
    const f = obj(e.for), keys = f ? Object.keys(f) : [];
    if (!f || keys.length !== 1 || !(keys[0] in FOR_RANGE)) return `${at}: for is { loops: n }, { cycles: n } or { minutes: m }`;
    const u = keys[0], n = f[u], [lo, hi] = FOR_RANGE[u];
    if (!unitsFor(e.look).includes(u)) return `${at}: ${LOOK_IN_LINE[e.look]} plays for ${unitsFor(e.look).join(' or ')}, not ${u}`;
    if (!Number.isInteger(n) || n < lo || n > hi) return `${at}: ${u} is a whole number from ${lo} to ${hi}`;
  }
  return null;
}
/** The playlist as sent (only look and for, in that order), or null when playlistProblem has a reason. */
export function checkPlaylist(p, looks = LOOKS) {
  if (playlistProblem(p, looks)) return null;
  return p.map((e) => { const u = Object.keys(e.for)[0]; return { look: e.look, for: { [u]: e.for[u] } }; });
}
/** "The remembered river for 4 loops". */
export const entryWords = (e) => `${LOOK_WORDS[e?.look] ?? 'A look'}${forWords(e?.for) ? ` for ${forWords(e.for)}` : ''}`;
/** Where the playlist is, in words: "2 of 2 · loop 3 of 4" (progress { done, of, unit }: done whole units played of this entry). */
export function positionWords(position, length, progress) {
  const parts = [];
  if (num(position) != null && num(length) != null && length > 0) parts.push(`${Math.min(length, Math.max(0, position) + 1)} of ${length}`);
  const p = obj(progress), of = num(p?.of), done = num(p?.done);
  if (p && of != null && done != null && ['loops', 'cycles', 'minutes'].includes(p.unit)) parts.push(`${p.unit.slice(0, -1)} ${Math.min(of, Math.floor(done) + 1)} of ${of}`);
  return parts.join(' · ');
}
/** TouchDesigner writes looks\status.json twice a second: older than this when bitcube read it, the show has stopped reporting. */
export const LOOKS_STATUS_OLD_S = 10;

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** Auto: this many loops of the remembered river, then one full cycle of Fill my cup (simple), again. */
export const AUTO_LOOPS = 4;
export const AUTO_FILL = 'fill-simple';
/** The words for Auto and Manual on the card. */
export const LOOK_MODE_WORDS = {
  auto: { label: 'Auto', line: 'Four loops of the remembered river, then one full cycle of Fill my cup (simple), again.' },
  manual: { label: 'Manual', line: 'Fades to the look you pick and stays on it.' },
};
const look = (x) => (LOOKS.includes(x) ? x : null);

/** "Showing the remembered river · auto: loop 2 of 4, then Fill my cup (simple)", "Fading to Fill my cup (simple)", "Showing Fill my
 *  cup (simple) · manual: it stays on it". s: the status's checked fields. */
export function nowWords(s) {
  if (!s) return null;
  if (s.fading && s.target) return `Fading to ${LOOK_IN_LINE[s.target]}`;
  if (!s.look) return 'Showing a look it doesn\'t name';
  const showing = `Showing ${LOOK_IN_LINE[s.look]}`;
  if (s.mode === 'manual') return `${showing} · manual: it stays on it`;
  if (s.mode !== 'auto') return showing;
  if (Array.isArray(s.playlist)) { const w = positionWords(s.position, s.playlist.length, s.progress); return `${showing} · playlist${w ? `: ${w}` : ''}`; }
  const next = s.next ? LOOK_IN_LINE[s.next] : null;
  if (s.look === 'remembered' && s.loops != null) return `${showing} · auto: loop ${Math.min(AUTO_LOOPS, s.loops + 1)} of ${AUTO_LOOPS}${next ? `, then ${next}` : ''}`;
  return `${showing} · auto: one full cycle${next ? `, then ${next}` : ''}`;
}

/** The card's view of show.looks ({ control, status }, each { age_s, json } | { missing } | { error }), or null when it isn't
 *  running. probeAgeS: how old the full check is (the server's clock), added to each file's age.
 *  -> { asked: { mode, look, at_age_s } | null, now: { mode, look, target, fading, fade, loops, next, looks, words, age_s, old } | null,
 *       base: { mode, look }, problems: [words] } */
export function looksView(raw, probeAgeS = 0) {
  const f = obj(raw);
  if (!f) return null;
  const pa = num(probeAgeS) ?? 0, problems = [];
  const file = (x, what) => {
    const o = obj(x);
    if (!o) { problems.push(`bitcube hasn't read ${what} yet`); return null; }
    if (o.missing) { problems.push(`${what} isn't there yet`); return null; }
    if (o.error || !obj(o.json)) { problems.push(`${what} couldn't be read`); return null; }
    return { json: o.json, age_s: num(o.age_s) != null ? Math.round(o.age_s + pa) : null, read_age_s: num(o.age_s) };
  };
  const c = file(f.control, 'the looks file'), st = file(f.status, "the show's own report");
  const asked = c ? { mode: LOOK_MODES.includes(c.json.mode) ? c.json.mode : null, look: look(c.json.look), at_age_s: c.age_s,
                      playlist: Array.isArray(c.json.playlist) ? checkPlaylist(c.json.playlist) : null } : null;
  let now = null;
  if (st) {
    const j = st.json, auto = obj(j.auto), loops = num(auto?.remembered_loops);
    const s = { mode: LOOK_MODES.includes(j.mode) ? j.mode : null, look: look(j.look), target: look(j.target),
                fading: j.fading === 'out' || j.fading === 'in' ? j.fading : null, fade: num(j.fade) == null ? null : Math.min(1, Math.max(0, j.fade)),
                loops: loops == null ? null : Math.min(AUTO_LOOPS, Math.max(0, Math.round(loops))), next: look(auto?.next),
                looks: Array.isArray(j.looks) ? j.looks.filter((x) => LOOKS.includes(x)) : [],
                // river-all-looks.toe: the playlist in force, the entry showing, how far into it; the inputs and what the look did with them
                playlist: Array.isArray(j.playlist) ? j.playlist.filter((e) => obj(e) && LOOKS.includes(e.look)) : null,
                position: num(j.position), progress: obj(j.progress), inputs: obj(j.inputs), used: obj(j.used) };
    now = { ...s, words: nowWords(s), age_s: st.age_s, old: st.read_age_s != null && st.read_age_s > LOOKS_STATUS_OLD_S };
  }
  // what the choice starts from: what was asked last, else what the show reports, else Auto on the remembered river
  const base = { mode: asked?.mode ?? now?.mode ?? 'auto', look: asked?.look ?? now?.target ?? now?.look ?? 'remembered' };
  return { asked, now, base, problems };
}
/** Whether what bitcube was asked (control.json, as the full check read it) is a body: a done line holds while it is. */
export function askedIs(v, body) {
  const a = v?.asked;
  if (!a || !body) return false;
  if (a.mode !== body.mode || (body.mode === 'manual' && a.look !== body.look)) return false;
  return !Array.isArray(body.playlist) || JSON.stringify(a.playlist) === JSON.stringify(checkPlaylist(body.playlist));
}
