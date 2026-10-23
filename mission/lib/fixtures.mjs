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
//
// GET /api/lights (what TouchDesigner is sending to the lights right now) is answered here by synthesising season-coloured
// flowing water from the scenario's seasons state, so the pages can draw the ropes and panels without bitcube. The contract,
// which a real frames endpoint will serve one day (until then the real server answers 503 { error: 'not available yet' }):
//   200 { at:     ms epoch when the frame was taken (the server's clock),
//         source: 'canvas' (the show) | 'black' (the ropes are dark on purpose: every rope byte is 0; the panels still show the river),
//         ropes:  { w: 20, h: 400, rgb: <base64 of w*h*3 bytes> }    row-major 8-bit RGB: byte (led * 20 + rope) * 3 is the red of LED
//                                                                   `led` (0 = the plug end, in the ceiling) on rope `rope` (0 = rope 1);
//                                                                   drawn as a 20-wide, 400-tall image it is the 20 ropes side by side
//         panels: { w: 256, h: 32, rgb: <base64 of w*h*3 bytes> } } row-major, top row first: the four HUB75 quads side by side,
//                                                                   64 x 32 each (quad 1 at x 0-63, quad 2 at 64-127, ...)
//   503 { error } when there is nothing to show: bitcube offline, TouchDesigner not answering, or not checked yet.
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

  /** What the lights are being sent right now (the contract at the top), synthesised from the scenario's seasons state. */
  lights(name) {
    const [, f] = this.#scenario(name);
    const st = f.status ?? {};
    const no = (why) => Object.assign(new Error(why), { status: 503 });
    if (st.bitcube?.value?.online === false) throw no('bitcube is offline: no frames');
    const pr = st.probe?.value, td = pr?.td;
    if (!pr) throw no('not checked yet: no frames until the full check of bitcube answers');
    if (!td || td.ok === false || typeof td.file !== 'string') throw no("TouchDesigner isn't answering: no frames");
    const year = st.seasons?.value ?? td.seasons ?? null;
    return renderLights({ at: this.now(), source: td.ropes?.source === 'black' ? 'black' : 'canvas', weights: year?.weights ?? null,
                          intensity: typeof year?.intensity === 'number' ? year.intensity : 0.5, look: td.river_cam?.fresh ? 'live' : 'rain', fps: td.fps ?? null });
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

// The looks: deep, mid and light colours per season (GLOSSARY.md), the live river at night (infrared) and the rain fallback.
const LOOKS = {
  winter: [[6, 14, 36], [110, 150, 205], [235, 242, 255]],
  spring: [[4, 36, 30], [36, 150, 118], [180, 235, 205]],
  summer: [[52, 26, 2], [224, 150, 28], [255, 232, 160]],
  autumn: [[38, 12, 4], [182, 78, 26], [236, 176, 96]],
  live: [[8, 10, 14], [118, 128, 140], [222, 226, 230]],
  rain: [[6, 10, 22], [66, 90, 124], [168, 186, 214]],
};
/** One frame for the lights: slow water flowing along each rope and across the panels, in the season's colours (blended
 *  by weight), brighter and faster with intensity; a slow TouchDesigner (fps under 30) moves in quarter-second steps. */
export function renderLights({ at, source = 'canvas', weights = null, intensity = 0.5, look = 'rain', fps = null }) {
  const ws = weights ? Object.entries(weights).filter(([k, v]) => LOOKS[k] && v > 0) : [];
  const total = ws.reduce((s, [, v]) => s + v, 0);
  const pal = total > 0 ? [0, 1, 2].map((i) => [0, 1, 2].map((j) => ws.reduce((s, [k, v]) => s + LOOKS[k][i][j] * v / total, 0))) : LOOKS[look] ?? LOOKS.rain;
  const gain = 0.35 + 0.65 * Math.min(1, Math.max(0, intensity));
  let t = (at / 1000) * (0.4 + 1.2 * gain);
  if (fps != null && fps < 30) t = Math.floor(t * 4) / 4;
  const put = (buf, o, v) => {
    v = Math.min(1, Math.max(0, v));
    const [a, b, k] = v < 0.5 ? [pal[0], pal[1], v * 2] : [pal[1], pal[2], (v - 0.5) * 2];
    const glint = v > 0.9 ? (v - 0.9) * 600 : 0;
    for (let j = 0; j < 3; j++) buf[o + j] = Math.max(0, Math.min(255, Math.round((a[j] + (b[j] - a[j]) * k) * gain + glint)));
  };
  const ropes = Buffer.alloc(20 * 400 * 3);
  if (source !== 'black') for (let led = 0; led < 400; led++) for (let r = 0; r < 20; r++) {
    const u = led / 400;
    put(ropes, (led * 20 + r) * 3, 0.5 + 0.25 * Math.sin(u * 18 + t * 1.7 + r * 0.9) + 0.15 * Math.sin(u * 41 - t * 2.3 + r * 2.1) + 0.1 * Math.sin(u * 7 + t * 0.7 + r * 0.3));
  }
  const panels = Buffer.alloc(256 * 32 * 3);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 256; x++) {
    const X = (x % 64) / 64, Y = y / 32, q = Math.floor(x / 64);
    put(panels, (y * 256 + x) * 3, 0.5 + 0.25 * Math.sin(X * 6 + t * 1.3 + Y * 2 + q) + 0.15 * Math.sin(X * 15 - t * 2.1 + Y * 5) + 0.1 * Math.sin(Y * 9 + t + q * 1.7));
  }
  return { at, source, ropes: { w: 20, h: 400, rgb: ropes.toString('base64') }, panels: { w: 256, h: 32, rgb: panels.toString('base64') } };
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
    if (typeof x === 'string' && key === 'last') return shiftLogLine(x, delta);
    if (typeof x === 'string' && ISO.test(x)) return shiftIso(x, delta);
    return x;
  };
  return walk(v, '');
}

/** A log line's clock ("02:58:31 INFO ..." or "2026-10-23 02:05:41 done", bitcube's local time) moves with the probe's `time`
 *  stamp (an ISO string, shifted above), so the ages the model reads from them (its lineAge) stay what the scenario meant:
 *  a clip "15 minutes before the check" is 15 minutes old whenever the page is opened, not hours old by the evening. */
function shiftLogLine(s, delta) {
  const p = (n) => String(n).padStart(2, '0');
  const t = /^(\d{2}):(\d{2}):(\d{2})([\s\S]*)$/.exec(s);
  if (t) {
    const tod = ((+t[1] * 3600 + +t[2] * 60 + +t[3] + Math.round(delta / 1000)) % 86400 + 86400) % 86400;
    return `${p(Math.floor(tod / 3600))}:${p(Math.floor(tod / 60) % 60)}:${p(tod % 60)}${t[4]}`;
  }
  const d = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})([\s\S]*)$/.exec(s);
  if (d) return shiftIso(`${d[1]}T${d[2]}`, delta).replace('T', ' ') + d[3];
  return s;
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
