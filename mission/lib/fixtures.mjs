// Fixture mode for mission control (MISSION_FIXTURES=<dir>): the same API served from scenario files instead of
// bitcube, Modal and the seasons page, so the pages can be designed and screenshotted in every state of the show
// without touching the live installation. Nothing here opens a socket or runs ssh. A scenario is <dir>/<name>.json:
//   { "_scenario": { "title": "...", "description": "..." },     free-form notes; only these two are shown
//     "status": { bitcube, seasons, modal, probe },               exactly what /api/status returns (minus studio)
//     "cameras": { "gallery": true, "river": false },             true = a placeholder still, false = 503 as when a camera is down
//     "camera_age_s": { "gallery": 30 } }                         how old a still claims to be (20 s)
// Files are read on every request, so editing one needs no restart. A browser picks its scenario with the
// `scenario` cookie (GET /fixtures/<name>); without one it gets all-good, else the first name alphabetically.
// Controls are checked exactly like the real ones (planControl), then only logged to <state>/controls.log.
import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CAMERAS, planControl } from './mission.mjs';

const NAME = /^[a-z0-9-]+$/;
const STILL_AGE_S = 20;

export class FixtureMission {
  constructor({ dir, stateDir, now = () => Date.now() }) {
    if (!dir || !existsSync(dir)) throw new Error(`MISSION_FIXTURES: ${dir} is not a folder`);
    Object.assign(this, { dir, stateDir, now });
  }

  start() {}      // nothing to poll
  stop() {}

  /** Scenario names, alphabetical (read afresh each time, so a new file shows up at once). */
  names() { return readdirSync(this.dir).filter((f) => f.endsWith('.json') && NAME.test(f.slice(0, -5))).map((f) => f.slice(0, -5)).sort(); }

  list() {
    return this.names().map((name) => {
      try { const s = this.#read(name)._scenario ?? {}; return { name, title: s.title ?? name, description: s.description ?? '', expect: s.expect ?? null }; }
      catch (e) { return { name, title: name, description: e.message }; }       // a half-edited file shouldn't hide the list
    });
  }

  /** Which scenario a request sees: its cookie if that names one, else all-good, else the first. Null if there are none. */
  active(cookieValue) {
    const names = this.names();
    if (names.includes(cookieValue)) return cookieValue;
    return names.includes('all-good') ? 'all-good' : names[0] ?? null;
  }

  snapshot(name) {
    const [n, f] = this.#scenario(name);
    // A scenario is written at one frozen moment (_scenario.now, ms). Serving it later would make its ages drift
    // (an "at" from this morning reads as hours old by tonight), so every timestamp is shifted to the present:
    // the scene set "9 h ago" in the file is 9 h ago whenever the page is opened.
    const delta = Number.isFinite(f._scenario?.now) ? this.now() - f._scenario.now : 0;
    const out = {};
    for (const [k, v] of Object.entries(f.status ?? {})) {
      if (!v || typeof v !== 'object') { out[k] = v; continue; }
      const src = rebase(v, delta);
      // The real snapshot carries both `at` and `age_s`; a hand-written source may give one, so fill in the other.
      // A rebased `at` has moved, so its age_s follows it; a frozen fixture (no _scenario.now) keeps its age_s as written.
      if (src.at != null && (delta || src.age_s == null)) src.age_s = Math.max(0, Math.round((this.now() - src.at) / 1000));
      else if (src.age_s != null && src.at == null) src.at = this.now() - src.age_s * 1000;
      out[k] = src;
    }
    out.fixture = n;
    return out;
  }

  /** A placeholder still ({ jpeg: bytes, type, at }: `jpeg` is the server's name for the bytes whatever the format), or {} when
   *  the scenario says that camera is down. */
  async camera(cam, name) {
    if (!CAMERAS.includes(cam)) throw Object.assign(new Error('unknown camera'), { status: 400 });
    const [, f] = this.#scenario(name);
    if (!f.cameras?.[cam]) return {};
    const at = this.now() - 1000 * Number(f.camera_age_s?.[cam] ?? STILL_AGE_S);
    for (const file of [`placeholder-${cam}.jpg`, 'placeholder.jpg']) {
      if (existsSync(join(this.dir, file))) return { jpeg: readFileSync(join(this.dir, file)), type: 'image/jpeg', at };
    }
    return { jpeg: Buffer.from(svgStill(cam)), type: 'image/svg+xml', at };
  }

  /** Same whitelist and argument checks as Mission.control; then the request is logged instead of acted on. */
  async control(action, body = {}) {
    planControl(action, body);
    mkdirSync(this.stateDir, { recursive: true });
    appendFileSync(join(this.stateDir, 'controls.log'), JSON.stringify({ t: this.now(), action, body }) + '\n');
    return { ok: true, fixture: true, action, body, note: 'fixture mode: nothing was changed' };
  }

  #scenario(name) {
    const n = this.active(name);
    if (!n) throw Object.assign(new Error('fixture mode: no scenario files yet'), { status: 503 });
    return [n, this.#read(n)];
  }

  #read(name) {
    try { return JSON.parse(readFileSync(join(this.dir, `${name}.json`), 'utf8')); }
    catch (e) { throw Object.assign(new Error(`fixture ${name}.json: ${e.message}`), { status: e.code === 'ENOENT' ? 404 : 500 }); }
  }
}

function svgStill(cam) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#2b2b2f"/>` +
    `<text x="480" y="270" fill="#9a9aa2" font-family="system-ui, sans-serif" font-size="30" text-anchor="middle" dominant-baseline="middle">${cam} camera: placeholder still</text></svg>`;
}

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const EPOCH_S = /^(next_tick_epoch|t)$/;             // Modal's next tick, a seasons history point (seconds)

/** Move every timestamp in a fixture source forward by delta ms: `at` (ms), epoch seconds, ISO strings (keeping their zone). */
export function rebase(v, delta) {
  if (!delta) return v;
  const walk = (x, key) => {
    if (Array.isArray(x)) return x.map((e) => walk(e, key));
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, e]) => [k, walk(e, k)]));
    if (typeof x === 'number') {
      if (key === 'at') return x + delta;
      if (EPOCH_S.test(key) && x > 1e9) return Math.round(x + delta / 1000);
      return x;
    }
    if (typeof x === 'string' && ISO.test(x)) return shiftIso(x, delta);
    return x;
  };
  return walk(v, '');
}

function shiftIso(s, delta) {
  const m = s.match(ISO);
  const zone = m[4] ?? '';
  const offMin = zone === '' ? -new Date(s).getTimezoneOffset() : zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const t = new Date(s + (zone === '' ? '' : '')).getTime();     // Date parses the zone (or local time when there is none)
  if (!Number.isFinite(t)) return s;
  const local = new Date(t + delta + offMin * 60_000);           // wall-clock digits in the original zone
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}${m[3] ?? ''}${zone}`;
}
