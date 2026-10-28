// The river (all looks)'s card (river-looks.toe, docs/mission-ui.md "Looks"): the full check's probe.looks as the Status card shows
// it. Pure, so the server (mc.mjs status), the tests and the page read it alike. Relative import: in the browser this is /model.js,
// under node the same file.
import { LOOKS, LOOK_IN_LINE } from './model.js';

export const LOOK_MODES = ['auto', 'manual'];
/** Each look's name as its button says it (in a sentence: model.js LOOK_IN_LINE). */
export const LOOK_WORDS = { remembered: 'The remembered river', 'fill-simple': 'Fill my cup (simple)', 'fill-configurable': 'Fill my cup (configurable)' };
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
  const asked = c ? { mode: LOOK_MODES.includes(c.json.mode) ? c.json.mode : null, look: look(c.json.look), at_age_s: c.age_s } : null;
  let now = null;
  if (st) {
    const j = st.json, auto = obj(j.auto), loops = num(auto?.remembered_loops);
    const s = { mode: LOOK_MODES.includes(j.mode) ? j.mode : null, look: look(j.look), target: look(j.target),
                fading: j.fading === 'out' || j.fading === 'in' ? j.fading : null, fade: num(j.fade) == null ? null : Math.min(1, Math.max(0, j.fade)),
                loops: loops == null ? null : Math.min(AUTO_LOOPS, Math.max(0, Math.round(loops))), next: look(auto?.next),
                looks: Array.isArray(j.looks) ? j.looks.filter((x) => LOOKS.includes(x)) : [] };
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
  return a.mode === body.mode && (body.mode === 'auto' || a.look === body.look);
}
