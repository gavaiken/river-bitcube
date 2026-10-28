// The filling glass's card (river-filling.toe, docs/mission-ui.md "Filling glass dials"): the full check's probe.filling as the
// Status card shows it. Pure, so the server (mc.mjs status), the tests and the page read it alike. Relative import: in the browser
// this is /model.js, under node the same file.
import { FILLING_PALETTES, FILLING_PALETTE_WORDS, FILLING_RANGE, FILLING_DEFAULTS } from './model.js';

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** TouchDesigner writes status.json every second: older than this when bitcube read it, the show has stopped reporting, and the
 *  card says how old its last report is instead of "Now". */
export const FILLING_STATUS_OLD_S = 10;
/** One full fill and drain at 100 % speed (the show's own pace). */
export const FILLING_CYCLE_S = 84;
export const FILLING_PHASES = ['filling', 'full', 'draining', 'empty'];
/** Each dial's words on the card. */
export const FILLING_DIAL_WORDS = {
  brightness: { label: 'Brightness', line: 'How bright the water is on the ropes and screens.' },
  intensity: { label: 'Intensity', line: 'How turbulent: chop, splash and crashing. 0 % is a calm rise; 100 % churns and sprays.' },
  speed: { label: 'Speed', line: 'How fast it fills and drains.' },
};

const inRange = (k, x) => { const v = num(x); return v != null && v >= FILLING_RANGE[k][0] && v <= FILLING_RANGE[k][1] ? v : null; };
/** The four settings in a file's json, each checked (a value out of range or of the wrong kind is null, never guessed). */
function settings(j) {
  return { palette: FILLING_PALETTES.includes(j?.palette) ? j.palette : null,
           brightness: inRange('brightness', j?.brightness), intensity: inRange('intensity', j?.intensity), speed: inRange('speed', j?.speed) };
}
/** "about 84 s a full cycle" at a speed (1 = 100 %). */
export function cycleWords(speed) {
  const s = num(speed);
  if (s == null || s <= 0) return null;
  const t = Math.round(FILLING_CYCLE_S / s), m = Math.floor(t / 60), r = t % 60;
  return `about ${t < 100 ? `${t} s` : `${m} min${r ? ` ${r} s` : ''}`} a full cycle`;
}
/** "filling 42 % full", "full", "draining 18 % full", "empty"; null when TouchDesigner didn't say. */
export function levelWords(phase, level) {
  const l = num(level), pct = l == null ? null : Math.round(Math.min(1, Math.max(0, l)) * 100);
  if (phase === 'full' || phase === 'empty') return phase;
  if (phase === 'filling' || phase === 'draining') return pct == null ? phase : `${phase} ${pct} % full`;
  return pct == null ? null : `${pct} % full`;
}

/** The card's view of show.filling ({ control, status }, each { age_s, json } | { missing } | { error }), or null when it isn't
 *  running. probeAgeS: how old the full check is (the server's clock), added to each file's age.
 *  -> { asked: settings + at_age_s | null, now: settings + level, phase, words, age_s, old | null, base, problems: [words] } */
export function fillingView(raw, probeAgeS = 0) {
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
  const c = file(f.control, 'the dials file'), s = file(f.status, "the show's own report");
  const asked = c ? { ...settings(c.json), at_age_s: c.age_s } : null;
  let now = null;
  if (s) {
    const v = settings(s.json), phase = FILLING_PHASES.includes(s.json.phase) ? s.json.phase : null, level = num(s.json.level);
    const lw = levelWords(phase, level);
    const words = [v.palette ? FILLING_PALETTE_WORDS[v.palette] : null, v.brightness != null ? `${Math.round(v.brightness * 100)} %` : null, lw].filter(Boolean).join(', ');
    now = { ...v, phase, level: level == null ? null : Math.min(1, Math.max(0, level)), words: words || 'nothing it can name', age_s: s.age_s,
            // old by the file's own age when bitcube read it (the full check's age is the page's own "Last seen", not the show's)
            old: s.read_age_s != null && s.read_age_s > FILLING_STATUS_OLD_S };
  }
  // what the dials start from: what was asked last, else what the show reports, else its defaults (each setting on its own)
  const base = {};
  for (const k of ['palette', 'brightness', 'intensity', 'speed']) base[k] = asked?.[k] ?? now?.[k] ?? FILLING_DEFAULTS[k];
  return { asked, now, base, problems };
}
/** The draft's values as the card holds them (percent for the three dials) from settings (0..1, speed 0.25..3). */
export const toPct = (v) => ({ palette: v.palette, brightness: Math.round(v.brightness * 100), intensity: Math.round(v.intensity * 100), speed: Math.round(v.speed * 100) });
/** The request body from the card's percentages. */
export const fromPct = (d) => ({ palette: d.palette, brightness: d.brightness / 100, intensity: d.intensity / 100, speed: d.speed / 100 });
/** Whether what bitcube was asked (control.json, as the full check read it) is a body: a done line holds while it is. */
export function askedIs(v, body) {
  const a = v?.asked;
  if (!a || !body) return false;
  const same = (x, y) => x != null && y != null && Math.round(x * 100) === Math.round(y * 100);
  return a.palette === body.palette && same(a.brightness, body.brightness) && same(a.intensity, body.intensity) && same(a.speed, body.speed);
}
