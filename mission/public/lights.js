// Mission control v2: the Lights page (docs/mission-ui.md, "Lights" and "Calibrate"). For Colin, Andi, Gavin and Will:
// does it look right, where is every LED, calibrating. Every verdict and sentence comes from derive() in /model.js; this
// page only lays it out, draws the LED map (GET /api/pixelmap) and what TouchDesigner is sending (GET /api/lights), and
// runs the Calibrate block from GET /api/calibration. Plain ES module, no build step, no framework.
import { mountShell, poll, tick, watchContact, art, fmt, control, confirm, api, esc, mark, plainError, DOC_LINKS, splitHeadline, WARN_MS, LOST_MS } from '/ui.js';
import { derive, dur, FILES, CAL_STAGE_S, CAL_TOTAL_S, CAL_STAGE_WORDS } from '/model.js';
import { uprightsFromAtlas } from '/screens.js';

const N_ROPES = 20, LEDS = 400;
const LIGHTS_MS = 10_000, CAL_MS = 5_000, STILL_MS = 30_000, FRAME_OLD_S = 30, PROBE_OLD_S = 120;
const INSTALL_DAY = '20261022';           // the lift at Gray Area: a map captured before this day was made elsewhere (Agape)
const DRIFT_FINE_PX = 30;
const OLD_RUN_S = 15 * 60;                // a run that ended this long before the page opened is not shown as a result                 // calibrate.py's default --max-drift
// one set of stage words with the Status band (model.js CAL_STAGE_WORDS)
const STAGE_WORDS = { ...Object.fromEntries(Object.entries(CAL_STAGE_WORDS).map(([k, v]) => [k, v[0].toUpperCase() + v.slice(1)])), done: 'Done' };
const STAGE_ORDER = ['ropes-capture', 'ropes-decode', 'hub75-capture', 'hub75-locate', 'done'];
const YEAR_FILE = Object.keys(FILES).find((f) => FILES[f].kind === 'year');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const $ = (sel) => document.querySelector(sel);
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s ?? '');
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
/** Seconds since a moment recorded as { at: performance.now(), wall: Date.now() }: the larger of the monotonic and the wall
 *  clock's view, so a phone that slept (its monotonic clock paused) never shows an hour-old picture as seconds old. */
const since = (at, wall) => Math.max(0, (performance.now() - at) / 1000, wall != null ? (Date.now() - wall) / 1000 : 0);
const ropeHue = (r) => `hsl(${(r * 137.5) % 360} 85% 62%)`;   // golden-angle spacing: neighbours never share a hue

// ---- state ------------------------------------------------------------------------------------------------------
const S = {
  m: null,                                   // the model, from the last /api/status
  lights: { frames: null, at: null, age_s: null, error: null, failedAt: null, bytes: null, panelBytes: null, dark: null },
  map: { map: null, screens: null, still: null, error: null, ropes: null, loaded: false, askedAt: performance.now() },
  cal: { p: null, at: null, error: null, timer: null, lost: null, started: null },
  room: { on: false, url: null, age_s: null, at: null, error: null, timer: null },
  view: 'auto',                              // 'auto' (Live while frames flow, else Map) | 'map' | 'live'
  hi: null,                                  // the highlighted rope (0-based) or null
  html: {},                                  // last rendered HTML per part: never re-render under a thumb
  calCtl: {},                                // the Calibrate block's live controls: { start, dry } | { stop } | { rebuild }
};

const shell = mountShell({ page: 'lights', title: 'Lights' });
const status = poll('/api/status', { every: 5000,
  onData: () => { shell.setAge(0); shell.setStale(null); S.m = model(); render(); watchCalibration(); },
  onError: () => { S.m = model(); render(); } });   // before any answer, watchContact's header says "No answer yet · N s"
function model() { return status.last ? derive(status.last, status.last.now + status.elapsed()) : null; }
// the shared rule (ui.js): greyed and bannered from the time since the last answer, so a hung request counts too
const contact = watchContact(status, shell, () => { S.m = model(); render(); });
const pageDown = () => contact.lost;
/** The server's clock now (its last answer's `now`, carried forward), for comparing with bitcube's own times. */
const serverNowMs = () => (status.last ? status.last.now + status.elapsed() : null);

// ---- render: every part, in page order -----------------------------------------------------------------------------
function render() {
  const m = S.m;
  art.setSeason(m?.show.weights ?? null);
  renderStateLine(); renderMapCard(); renderChips(); renderStrips(); renderProvenance(); renderCalibrate(); renderFooter();
  updateRebuild();
}
const put = (id, html) => { if (S.html[id] !== html) { S.html[id] = html; const el = document.getElementById(id); if (el) el.innerHTML = html; } };

/** The probe's age as of now: the model's age (the server's clock) plus the time since that answer arrived, so it ticks. */
function probeAge() { const a = S.m?.overall.checked.probe_age_s; return a == null || status.receivedAt == null ? a ?? null : a + status.elapsed() / 1000; }

// ---- the state line: show.ropes.words · show.panels.words · from bitcube · N s ago ---------------------------------------
function renderStateLine() {
  const m = S.m;
  if (!m) {
    // the header's thresholds (ui.js WARN_MS, LOST_MS), from when the page started asking: one fact, one wording everywhere
    const ms = performance.now() - status.startedAt;
    put('state-words', ms > LOST_MS ? "This page can't reach mission control." : ms > WARN_MS ? `No answer from mission control yet · ${fmt.nb(dur(ms / 1000))}` : 'Connecting to mission control…');
    put('state-from', ''); put('state-next', ''); sayState(ms > LOST_MS ? "This page can't reach mission control." : ''); return;
  }
  const ropes = m.show.ropes, panels = m.show.panels;
  const words = `${cap(ropes.words)} · ${panels.words}.`;
  const lost = m.overall.cause === 'page' || pageDown();
  const ropesItem = m.items.find((x) => x.id === 'ropes');
  // one rule with Status and the map: the item's own stale flag says whether this is a last answer
  const stale = !lost && !!ropesItem?.stale;
  // the line speaks for the ropes and the panels, so its mark is the worse of the two; a last answer is never green
  const RANK = { down: 0, warning: 1, unknown: 2, ok: 3 };
  const worst = [levelOf('ropes'), levelOf('hub75 panels')].sort((a, b) => RANK[a] - RANK[b])[0];
  const lv = lost || stale ? 'unknown' : worst;
  put('state-words', `<span class="lv-${lv}">${mark(lv)}</span> ${esc(words)}`);
  const a = probeAge(), pr = m.sources.probe;
  const from = lost ? `No contact with mission control for ${fmt.nb(dur(status.elapsed() / 1000))}: this is how it was at ${fmt.clock(status.last.now, status.last.now)}`
    : m.overall.cause === 'bitcube-offline' ? 'bitcube is offline'
    : a == null ? 'Not checked yet'
    : pr.present && !pr.ok ? `bitcube's full check failed · ${fmt.nb(dur(a))} ago`
    : stale ? `last seen from bitcube ${fmt.nb(dur(a))} ago: this is how it was then`
    : `from bitcube · ${fmt.nb(dur(a))} ago`;
  const el = $('#state-from');
  el.textContent = from;
  el.className = `from muted${lost || stale || (a != null && a > PROBE_OLD_S) ? ' old' : ''}`;
  // when it isn't OK, the band's headline and the way to what to do (Lights has no band of its own)
  const o = m.overall, bad = !lost && o.level !== 'ok' && o.cause !== 'calibrating';
  // the headline's cause, split as Status splits it (never inside a parenthesis); a bare "Checking" says the whole headline
  const [cause] = splitHeadline(o.headline), head = /^Checking$/i.test(cause.trim()) ? o.headline : cause;
  put('state-next', bad ? `<span>${esc(fmt.nb(head.replace(/[.\s]+$/, '')))}.</span> <a href="/status">What to do → Status</a>` : '');
  sayState(lost ? `No contact with mission control. ${words}` : stale ? `Last seen: ${words}` : words);
}
/** Screen readers hear the state line's words when they change, never its ticking age (lights.html #state-live). */
function sayState(t) { const l = $('#state-live'); if (l && l.textContent !== t) l.textContent = t; }
function levelOf(id) { return S.m?.items.find((x) => x.id === id)?.level ?? 'unknown'; }

// ---- the LED map: GET /api/pixelmap once (and again after a calibration writes a map) --------------------------------------
async function loadMap() {
  try {
    const r = await fetch('/api/pixelmap', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login'; return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error || j.map?.error) throw Object.assign(new Error(mapError(j.error || j.map?.error || `HTTP ${r.status}`)), { status: r.status });
    S.map = { ...S.map, map: j.map ?? null, screens: j.screens ?? null, still: j.still ?? null, error: null, ropes: prepareRopes(j.map), loaded: true };
  } catch (e) { S.map = { ...S.map, error: plainError(e), loaded: true }; }
  render();
}
/** A map error in the team's words: never a file name or a parser's message (the raw text stays in the server's answer). */
function mapError(raw) {
  const s = String(raw ?? '');
  if (/unreadable|JSON|Unexpected|parse/i.test(s)) return "the LED map file can't be read";
  if (/could not fetch|fetch failed|ssh|can't reach/i.test(s)) return "bitcube didn't send it";
  return s;
}
/** The map's 8000 points grouped by rope, as fractions of the frame (y already flipped: v runs bottom → top). */
function prepareRopes(map) {
  if (!map || !Array.isArray(map.points)) return null;
  const ropes = Array.from({ length: N_ROPES }, () => []);
  for (const p of map.points) {
    if (!p || typeof p.rope !== 'number' || p.rope < 0 || p.rope >= N_ROPES) continue;
    ropes[p.rope].push({ px: p.px, x: p.u, y: 1 - p.v, visible: p.visible === true });
  }
  for (const r of ropes) r.sort((a, b) => a.px - b.px);
  return ropes;
}
/** The four screens' corners as fractions (y flipped), from the screens file, else quad 1 from the map. */
function screenQuads() {
  const flip = (q) => ({ tl: [q.tl[0], 1 - q.tl[1]], tr: [q.tr[0], 1 - q.tr[1]], br: [q.br[0], 1 - q.br[1]], bl: [q.bl[0], 1 - q.bl[1]] });
  const out = [];
  const sc = S.map.screens?.screens;
  if (sc && typeof sc === 'object') {
    for (let n = 1; n <= 4; n++) { const q = sc[String(n)]; out.push(q && q.tl ? { n, ...flip(q), estimated: q.estimated === true, from: q.from ?? null, located: true } : { n, located: false }); }
    return out;
  }
  const q1 = S.map.map?.hub75_quad1;
  for (let n = 1; n <= 4; n++) out.push(n === 1 && q1?.tl ? { n, ...flip(q1), estimated: false, located: true } : { n, located: false });
  return out;
}

// ---- what TouchDesigner is sending: GET /api/lights every 10 s while this page is visible -------------------------------
function decodeRGB(b64, w, h) {
  try {
    const bin = atob(b64), n = w * h * 3;
    if (bin.length < n) return null;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
async function pollLights() {
  if (document.hidden) return;
  try {
    const r = await fetch('/api/lights', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login'; return; }
    const j = await r.json().catch(() => ({}));
    const f = j?.frames;
    if (!r.ok || j.ok === false || !f?.ropes?.rgb || !f?.panels?.rgb) {
      S.lights.error = lightsError(j?.error || f?.ropes?.error || f?.panels?.error, r.status);
      S.lights.failedAt ??= performance.now();
    } else {
      const bytes = decodeRGB(f.ropes.rgb, f.ropes.w, f.ropes.h), panelBytes = decodeRGB(f.panels.rgb, f.panels.w, f.panels.h);
      if (!bytes || !panelBytes) throw new Error('the frame was cut short');
      const dark = [];   // per rope: every LED black (max channel under 8)
      for (let c = 0; c < f.ropes.w; c++) { let lit = false; for (let y = 0; y < f.ropes.h && !lit; y++) { const i = (y * f.ropes.w + c) * 3; if (bytes[i] > 8 || bytes[i + 1] > 8 || bytes[i + 2] > 8) lit = true; } dark.push(!lit); }
      S.lights = { frames: f, at: performance.now(), wall: Date.now(), age_s: typeof j.age_s === 'number' ? j.age_s : 0, error: null, failedAt: null, bytes, panelBytes, dark, scr: screensOf(f, panelBytes) };
    }
  } catch (e) { S.lights.error = lightsError(e); S.lights.failedAt ??= performance.now(); }
  render();
}
/** Why the lights can't be shown, in the team's words: the server's plain sentence, else plainError's; never "HTTP 502" or
 *  a frame's byte count. */
function lightsError(e, status) {
  const m = String(e?.message ?? e ?? '').replace(/:\s*no frames$/i, '');
  if (!m) return status ? plainError(`HTTP ${status}`) : 'no frames yet';
  if (/rgb holds|bytes, expected|bad frame|missing|cut short/i.test(m)) return 'a frame from bitcube arrived incomplete';
  if (/not cooked|has not cooked/i.test(m)) return 'TouchDesigner has not drawn a frame yet';
  return plainError(typeof e === 'object' && e ? e : m);
}
/** The four screens to draw, each upright as seen: { img, cw, ch } with cell k-1 = screen k at (cw·(k-1), 0, cw, ch).
 *  frames.screens when bitcube sends it; else the Gray Area atlas undone (public/screens.js); else (an atlas of four quads
 *  in a row, before Gray Area) the atlas cut into four as it is. */
function screensOf(f, panelBytes) {
  const s = f.screens;
  if (s?.rgb && Number.isInteger(s.w) && Number.isInteger(s.h) && s.w % 4 === 0) {
    const b = decodeRGB(s.rgb, s.w, s.h);
    if (b) return { img: panelImage(b, s.w, s.h), cw: s.w / 4, ch: s.h, upright: true };
  }
  const up = uprightsFromAtlas(panelBytes, f.panels.w, f.panels.h);
  if (up) return { img: panelImage(up.bytes, up.w, up.h), cw: up.w / 4, ch: up.h, upright: true };
  return { img: panelImage(panelBytes, f.panels.w, f.panels.h), cw: f.panels.w / 4, ch: f.panels.h, upright: false };
}
function panelImage(bytes, w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const img = new ImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { d[i * 4] = bytes[i * 3]; d[i * 4 + 1] = bytes[i * 3 + 1]; d[i * 4 + 2] = bytes[i * 3 + 2]; d[i * 4 + 3] = 255; }
  cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}
const frameAgeS = () => (S.lights.frames ? S.lights.age_s + since(S.lights.at, S.lights.wall) : null);
const frameOld = () => { const a = frameAgeS(); return a != null && a > FRAME_OLD_S; };
const ledRGB = (c, y) => { const b = S.lights.bytes, w = S.lights.frames.ropes.w, i = (y * w + c) * 3; return [b[i], b[i + 1], b[i + 2]]; };
const isBlack = ([r, g, b]) => r <= 8 && g <= 8 && b <= 8;

// ---- the map card -----------------------------------------------------------------------------------------------------
const liveView = () => (S.view === 'live' || (S.view === 'auto' && !!S.lights.frames && !frameOld()));
function renderMapCard() {
  const live = liveView(), hasMap = !!S.map.ropes;
  for (const b of document.querySelectorAll('#view-seg [data-view]')) { const on = (b.dataset.view === 'live') === live; b.classList.toggle('lit', on); b.setAttribute('aria-pressed', on); }
  const quads = screenQuads(), estimated = quads.filter((q) => q.located && q.estimated).length, located = quads.filter((q) => q.located).length;
  const zoomed = zoomBox(...frameSize()).zoomed;
  put('map-legend', live ? `Each LED in the colour TouchDesigner is sending it; the screens show their picture.${estimated ? ` Screens marked ~ are estimated.` : ''}${zoomed ? ' Zoomed to the piece.' : ''}`
    : `Each rope in its own colour, numbered at its plug end; dots are LEDs the camera saw.${located ? ` Screens outlined${estimated ? `, ${estimated} of them estimated (dashed)` : ''}.` : ''}${zoomed ? ' Zoomed to the piece.' : ''}`);
  // the still behind: the calibration's own frame when the map ships one, else the room still on request
  const img = $('#room-img'), toggle = $('#room-toggle');
  const mapStill = stillUrl(S.map.still);
  if (mapStill) { toggle.hidden = true; if (img.src !== mapStill) img.src = mapStill; img.hidden = false; }
  else { toggle.hidden = false; $('#room-check').checked = S.room.on; img.hidden = !(S.room.on && S.room.url); if (S.room.on && S.room.url && img.src !== S.room.url) img.src = S.room.url; }
  // the note over the canvas: no map, or no frames
  const note = $('#map-note');
  let noteHtml = '';
  // what TouchDesigner sends is not what the room shows when the lights aren't connected: said over the map, and dimmed
  const ropesSt = S.m?.show.ropes.state, panelsSt = S.m?.show.panels.state;
  const notGetting = [ropesSt === 'not-reaching' ? "the ropes aren't getting it" : '', panelsSt === 'no-sender' ? 'the panels have no sender' : ''].filter(Boolean);
  const unsent = live && !!S.lights.frames && !pageDown() && !frameOld() && notGetting.length > 0;
  const mapWaitS = (performance.now() - S.map.askedAt) / 1000;
  if (!S.map.loaded) noteHtml = mapWaitS * 1000 > LOST_MS ? `${mark('unknown')}<span>The LED map hasn't loaded: no answer for ${esc(fmt.nb(dur(mapWaitS)))}.</span>` : `${mark('unknown')}<span>Loading the LED map…</span>`;
  else if (!hasMap && S.map.error) noteHtml = `${mark('unknown')}<span>No LED map: ${esc(S.map.error)}.</span>`;
  else if (!hasMap) noteHtml = `${mark('unknown')}<span>No LED map yet: calibrate to make one. Rope by rope below shows what is being sent.</span>`;
  else if (live && !S.lights.frames) noteHtml = `${mark(S.m?.overall.cause === 'bitcube-offline' ? 'down' : 'unknown')}<span>${esc(S.lights.error && /:/.test(S.lights.error) ? `Can't show the lights. ${cap(S.lights.error)}` : `Can't show the lights: ${S.lights.error ?? 'no frames yet'}`)}.</span>`;
  else if (live && pageDown()) noteHtml = `${mark('unknown')}<span>No contact with mission control: this is the last frame it sent.</span>`;
  else if (live && frameOld()) noteHtml = `${mark('warning')}<span>No new frame for ${esc(fmt.nb(dur(frameAgeS())))}${S.lights.error ? `: ${esc(S.lights.error)}` : ''}. This is the last one.</span>`;
  else if (unsent) noteHtml = `${mark('warning')}<span>What TouchDesigner sends; ${esc(notGetting.join(' and '))}.</span>`;
  if (S.html['map-note'] !== noteHtml) { S.html['map-note'] = noteHtml; note.innerHTML = noteHtml; note.className = `mapnote ${/lv-down/.test(noteHtml) ? 'lv-down' : /lv-warning/.test(noteHtml) ? 'lv-warning' : 'lv-unknown'}`; }
  note.hidden = !noteHtml;
  $('#mapwrap').classList.toggle('dim', live && !!S.lights.frames && (frameOld() || pageDown() || unsent));
  // the caption
  let capHtml;
  if (live && S.lights.frames) capHtml = `<b>Live</b> · what TouchDesigner is sending · from bitcube · ${esc(fmt.nb(dur(frameAgeS())))} ago`;
  else if (live) capHtml = `<b>Live</b> · waiting for a frame from bitcube`;
  else capHtml = hasMap ? `<b>Map</b> · ${zoomed ? 'the piece, as the camera sees it' : "the camera's whole picture"}`
    : !S.map.loaded && mapWaitS * 1000 > LOST_MS ? `<b>Map</b> · the LED map hasn't loaded: no answer for ${esc(fmt.nb(dur(mapWaitS)))}`
    : !S.map.loaded ? '<b>Map</b> · loading' : `<b>Map</b> · nothing to draw yet`;
  if (mapStill) capHtml += ' · over the still from the calibration';
  else if (S.room.on) capHtml += S.room.url ? ` · the room still is ${esc(fmt.nb(dur(roomAgeS())))} old` : S.room.error ? ` · no room still: ${esc(S.room.error)}` : ' · fetching the room still…';
  put('map-cap', capHtml);
  const wrap = $('#mapwrap'), [FW, FH] = frameSize(), frameAspect = FW / FH;
  const zb = zoomBox(FW, FH), aspect = zb.zoomed ? Math.min(frameAspect, Math.max(0.8, zb.aspect)) : frameAspect;
  const want = `${Math.round(aspect * 1000)} / 1000`;
  if (wrap.style.aspectRatio !== want) { wrap.style.aspectRatio = want; wrap.style.setProperty('--ar', (Math.round(aspect * 1000) / 1000).toString()); }
  drawMap(live);
}
function stillUrl(still) {
  if (!still) return null;
  if (typeof still === 'string') return still;
  if (still.url) return still.url;
  if (still.jpeg || still.base64) return `data:${still.type || 'image/jpeg'};base64,${still.jpeg || still.base64}`;
  return null;
}
/** Fit a canvas to its CSS box at the device's pixel ratio (capped at 2); returns the context scaled to CSS px, or null. */
function fitCanvas(cv) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
/** Draws `img` (a canvas) onto the triangle d0-d1-d2 of the context, with the image's triangle s0-s1-s2 mapped onto it. */
function drawTri(ctx, img, [x0, y0], [x1, y1], [x2, y2], [u0, v0], [u1, v1], [u2, v2]) {
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!det) return;
  const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3, grow = (p) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.7, p[1] + dy / l * 0.7]; };
  const [g0, g1, g2] = [grow([u0, v0]), grow([u1, v1]), grow([u2, v2])];   // a little past the edge: no hairline seam between the two triangles
  ctx.save();
  ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath(); ctx.clip();
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det, b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det, d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  ctx.transform(a, b, c, d, u0 - a * x0 - c * y0, v0 - b * x0 - d * y0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
function drawMap(live) {
  const cv = $('#map-canvas'), fit = fitCanvas(cv);
  if (!fit) return;
  const { ctx, w: W, h: H } = fit;
  ctx.clearRect(0, 0, W, H);
  const ropes = S.map.ropes;
  if (!ropes) return;
  const narrow = W < 500, dot = narrow ? 2.2 : 3, hi = S.hi;
  const useFrame = live && !!S.lights.frames;
  const alphaFor = (r) => (hi == null || hi === r ? 1 : 0.22);
  // By ratio always (x = u × W, y = (1 − v) × H). With a still behind, the whole frame; without one, zoomed to the piece
  // (the same scale both ways, so nothing is stretched): the ropes fill a narrow middle of the camera's frame.
  const [FW, FH] = frameSize(), z = zoomBox(W, H), X = (x) => (x * FW - z.cx) * z.k + W / 2, Y = (y) => (y * FH - z.cy) * z.k + H / 2;
  const P = (p) => [X(p[0]), Y(p[1])];
  const placed = [];   // label boxes already drawn: later labels move off them, never under them
  const screenLabels = [];   // drawn after the ropes, so no rope is painted over a screen's number
  // the screens first, under the ropes
  // each screen's own picture, upright as seen, onto its corners as the camera sees them (cell n-1 = screen n)
  const scr = useFrame ? S.lights.scr : null, panels = scr?.img ?? null, qw = scr?.cw ?? 1, ph = scr?.ch ?? 1;
  for (const q of screenQuads()) {
    if (!q.located) continue;
    const tl = P(q.tl), tr = P(q.tr), br = P(q.br), bl = P(q.bl), i = q.n - 1;
    if (panels) {
      drawTri(ctx, panels, [i * qw, 0], [(i + 1) * qw, 0], [(i + 1) * qw, ph], tl, tr, br);
      drawTri(ctx, panels, [i * qw, 0], [(i + 1) * qw, ph], [i * qw, ph], tl, br, bl);
    } else { ctx.fillStyle = 'rgba(124, 195, 232, 0.12)'; ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.lineTo(...br); ctx.lineTo(...bl); ctx.closePath(); ctx.fill(); }
    ctx.save();
    ctx.setLineDash(q.estimated ? [6, 4] : []);
    ctx.lineWidth = 1.5; ctx.strokeStyle = panels ? 'rgba(228, 233, 238, 0.7)' : '#7cc3e8';
    ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.lineTo(...br); ctx.lineTo(...bl); ctx.closePath(); ctx.stroke();
    ctx.restore();
    if (!useFrame || hi == null) screenLabels.push([(tl[0] + br[0]) / 2, (tl[1] + br[1]) / 2, `${q.n}${q.estimated ? ' ~' : ''}`]);
  }
  // the ropes: a polyline through the filled points, dots on the visible ones
  for (let r = 0; r < N_ROPES; r++) {
    const pts = ropes[r];
    if (!pts.length) continue;
    ctx.globalAlpha = alphaFor(r);
    const bold = hi === r;
    if (useFrame) {
      ctx.lineWidth = bold ? 3 : 1.6; ctx.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const c = ledRGB(r, Math.min(LEDS - 1, pts[i].px));
        ctx.strokeStyle = isBlack(c) ? 'rgba(90, 100, 112, 0.6)' : `rgb(${c[0]} ${c[1]} ${c[2]})`;
        ctx.beginPath(); ctx.moveTo(X(pts[i - 1].x), Y(pts[i - 1].y)); ctx.lineTo(X(pts[i].x), Y(pts[i].y)); ctx.stroke();
      }
      for (const p of pts) if (p.visible) {
        const c = ledRGB(r, Math.min(LEDS - 1, p.px));
        ctx.fillStyle = '#05080b'; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), dot + 1, 0, 7); ctx.fill();
        ctx.fillStyle = isBlack(c) ? '#3a4048' : `rgb(${c[0]} ${c[1]} ${c[2]})`; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), dot, 0, 7); ctx.fill();
      }
    } else {
      const col = ropeHue(r);
      ctx.strokeStyle = col; ctx.lineWidth = bold ? 2.6 : 1.2; ctx.lineJoin = 'round';
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)))); ctx.stroke();
      for (const p of pts) if (p.visible) {
        ctx.fillStyle = '#05080b'; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), dot + 1, 0, 7); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), dot, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  for (const [x, y, t] of screenLabels) label(ctx, x, y, t, 14, '#7cc3e8', placed);
  // numbers at the plug ends (Map view, or the highlighted rope); one moved off a crowd keeps a thin line to its plug end
  for (let r = 0; r < N_ROPES; r++) {
    const pts = ropes[r];
    if (!pts.length || (useFrame && hi !== r) || (hi != null && hi !== r)) continue;
    const p0 = pts[0], dy = (r % 2 ? 1 : -1) * 15;     // alternate above and below: the plug ends crowd the ceiling
    label(ctx, X(p0.x), Y(p0.y) + dy, String(r + 1), 14, ropeHue(r), placed, [X(p0.x), Y(p0.y)]);
  }
}
/** The frame's size in its own pixels (meta.frame_size, else 1440 × 808). */
function frameSize() { const fs = S.map.map?.meta?.frame_size; return Array.isArray(fs) && fs[0] > 0 && fs[1] > 0 ? [fs[0], fs[1]] : [1440, 808]; }
/** How the camera's frame lands on a W × H canvas, one scale both ways: the whole frame when a still is behind it, else
 *  the box around every point and screen (with a margin), so a tall thin piece is not a sliver. { k, cx, cy } in frame px. */
function zoomBox(W, H) {
  const [FW, FH] = frameSize();
  const whole = { k: Math.min(W / FW, H / FH), cx: FW / 2, cy: FH / 2, zoomed: false, aspect: FW / FH };
  const stillShown = !!stillUrl(S.map.still) || (S.room.on && !!S.room.url);
  if (stillShown || !S.map.ropes) return whole;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (x, y) => { x0 = Math.min(x0, x * FW); y0 = Math.min(y0, y * FH); x1 = Math.max(x1, x * FW); y1 = Math.max(y1, y * FH); };
  for (const pts of S.map.ropes) for (const p of pts) take(p.x, p.y);
  for (const q of screenQuads()) if (q.located) for (const c of [q.tl, q.tr, q.br, q.bl]) take(c[0], c[1]);
  if (!Number.isFinite(x0)) return whole;
  const mx = Math.max(40, (x1 - x0) * 0.14), my = Math.max(30, (y1 - y0) * 0.05);
  const bw = x1 - x0 + 2 * mx, bh = y1 - y0 + 2 * my;
  const k = Math.min(W / bw, H / bh);
  return { k, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, zoomed: k > whole.k * 1.02 || bw / bh < (FW / FH) * 0.9, aspect: bw / bh };
}
/** A number in a dark pill at (x, y), moved to the nearest free spot (down, up, then sideways) when it would cover a
 *  label already drawn (`placed`, the boxes so far): on a phone the plug ends crowd together. */
function label(ctx, x, y, text, size, color, placed = [], anchor = null) {
  ctx.save();
  const cw = ctx.canvas.clientWidth || ctx.canvas.width, ch = ctx.canvas.clientHeight || ctx.canvas.height;
  ctx.font = `700 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 8, h = size + 6;
  const fit = (px, py) => [Math.min(cw - w / 2 - 1, Math.max(w / 2 + 1, px)), Math.min(ch - h / 2 - 1, Math.max(h / 2 + 1, py))];
  const hits = (px, py) => placed.some((b) => Math.abs(b.x - px) < (b.w + w) / 2 + 2 && Math.abs(b.y - py) < (b.h + h) / 2 + 2);
  let best = fit(x, y);
  if (hits(...best)) {
    const steps = [];
    for (let k = 1; k <= 6; k++) steps.push([0, k * (h + 2)], [0, -k * (h + 2)], [k * (w + 2), 0], [-k * (w + 2), 0], [k * (w + 2), k * (h + 2)], [-k * (w + 2), -k * (h + 2)]);
    for (const [dx, dy] of steps) { const c = fit(x + dx, y + dy); if (!hits(...c)) { best = c; break; } }
  }
  const [x0, y0] = [x, y];
  [x, y] = best;
  placed.push({ x, y, w, h });
  // moved off its spot: a leader line from the thing it names (the plug end) to the label, so it can't be misread
  if (anchor && Math.hypot(x - x0, y - y0) > h) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(anchor[0], anchor[1]); ctx.lineTo(x, y); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(5, 8, 11, 0.85)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 5); ctx.fill();
  ctx.fillStyle = color; ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

// ---- the room still (optional, behind the map) ---------------------------------------------------------------------------
const roomAgeS = () => (S.room.at == null ? null : (S.room.age_s ?? 0) + since(S.room.at, S.room.wall));
async function pollRoom() {
  if (!S.room.on || document.hidden) return;
  try {
    const r = await fetch('/api/camera/gallery.jpg?t=' + Date.now(), { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login'; return; }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
    const url = URL.createObjectURL(await r.blob());
    if (S.room.url) URL.revokeObjectURL(S.room.url);
    S.room = { ...S.room, url, age_s: Number(r.headers.get('x-age-s')) || 0, at: performance.now(), wall: Date.now(), error: null };
  } catch (e) { S.room.error = plainError(e); }
  render();
}
function setRoom(on) {
  S.room.on = on;
  clearInterval(S.room.timer); S.room.timer = null;
  if (on) { pollRoom(); S.room.timer = setInterval(pollRoom, STILL_MS); }
  render();
}

// ---- the 20 rope chips ------------------------------------------------------------------------------------------------
function ropeState(r) {
  const m = S.m, found = S.map.map?.ropes?.[String(r)], seen = found?.visible ?? null;
  const darkNow = S.lights.dark?.[r] === true && m?.show.ropes.state === 'river' && !frameOld();
  if (darkNow) return { level: 'warning', word: 'Dark now', seen };
  // before the LED map has answered (or when it couldn't be fetched) nothing is known: "Not mapped yet" claims calibration is missing
  if (!S.map.loaded || (!S.map.map && S.map.error)) return { level: 'unknown', word: 'Not known yet', seen: null };
  if (!S.map.map) return { level: 'unknown', word: 'Not mapped yet', seen: null };
  // what calibration found is not the rope's state now: a neutral mark, never a green ✓ (that would read "this rope is OK")
  if (seen > 0) return { level: 'unknown', neutral: true, word: 'Found at calibration', seen };
  return { level: 'warning', word: 'Not found at calibration', seen: seen ?? 0 };
}
function renderChips() {
  const html = Array.from({ length: N_ROPES }, (_, r) => {
    const n = r + 1, box = n <= 10 ? 1 : 2, out = ((n - 1) % 10) + 1, st = ropeState(r);
    const seen = st.seen == null ? '' : `${esc(fmt.nb(`${st.seen} of ${LEDS}`))} seen · `;
    return `<button type="button" class="rope lv-${st.level}${st.neutral ? ' neutral' : ''}" data-rope="${r}" aria-pressed="${S.hi === r}" aria-label="Rope ${n}, box ${box} out ${out}: ${esc(st.word)}${st.seen == null ? '' : `, ${st.seen} of ${LEDS} seen`}">
      ${st.neutral ? '<span class="mk lv-unknown" aria-hidden="true">·</span>' : mark(st.level)}<span class="rname">Rope ${n} <span class="out">box ${box} · OUT ${out}</span></span>
      <span class="rline">${seen}<span class="state">${esc(st.word)}</span></span></button>`;
  }).join('');
  put('rope-chips', html);
  const found = S.map.map ? Object.values(S.map.map.ropes ?? {}).filter((v) => (v?.visible ?? 0) > 0).length : null;
  put('ropes-sub', found == null ? 'tap one to pick it out' : `${found} of ${N_ROPES} found at calibration · tap one to pick it out`);
  const quads = screenQuads(), located = quads.filter((q) => q.located);
  const list = (ns) => (ns.length > 1 ? `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}` : String(ns[0]));
  const measured = located.filter((q) => !q.estimated).map((q) => q.n), est = located.filter((q) => q.estimated).map((q) => q.n), missing = quads.filter((q) => !q.located).map((q) => q.n);
  const parts = [measured.length ? `${measured.length > 1 ? 'Screens' : 'Screen'} ${list(measured)} located` : '', est.length ? `${measured.length ? '' : `${est.length > 1 ? 'Screens' : 'Screen'} `}${list(est)} estimated` : '', missing.length ? `${list(missing)} not located yet` : ''].filter(Boolean);
  put('screens-line', !located.length ? 'Screens: not located yet.' : `${parts.join('; ')}.`);
}
$('#rope-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rope]');
  if (!b) return;
  const r = Number(b.dataset.rope);
  S.hi = S.hi === r ? null : r;
  renderChips(); renderMapCard(); renderStrips();
});
$('#view-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) { S.view = b.dataset.view; renderMapCard(); } });
$('#room-check').addEventListener('change', (e) => setRoom(e.target.checked));

// ---- rope by rope: B's strips and the four quads --------------------------------------------------------------------------
function renderStrips() {
  const l = S.lights, m = S.m;
  const sec = $('#strips');
  const old = frameOld() || (!l.frames && !!l.error);
  sec.classList.toggle('dim', !!l.frames && frameOld());
  put('strip-nums', Array.from({ length: N_ROPES }, (_, r) => `<span class="${S.hi === r ? 'hi' : ''}${r === 0 || (r + 1) % 5 === 0 ? ' key' : ''}">${r + 1}</span>`).join(''));
  const note = $('#strips-note');
  let text = '', bad = false;
  if (l.frames) {
    const dark = l.frames.source === 'black' || l.frames.ropes?.source === 'black';
    text = dark ? 'The ropes are dark on purpose: TouchDesigner sends black. The panels still show the river.' : 'What TouchDesigner sends to each LED and screen, from bitcube (its age is on the map above).';
    if (!dark && m?.show.ropes.state === 'not-reaching') text += ` The ropes are not getting it. ${cap(m.show.ropes.summary.replace(/\.$/, ''))}.`;
    if (frameOld()) { text = `No new frame for ${fmt.nb(dur(frameAgeS()))}${l.error ? `: ${l.error}` : ''}. This is the last one received.`; bad = true; }
  } else {
    text = l.error && /:/.test(l.error) ? `Can't show the lights. ${cap(l.error)}.` : `Can't show the lights: ${l.error ?? 'no frames yet'}.`;
    bad = !!l.error && !/not checked yet/.test(l.error);
    if (!l.error && m && m.overall.cause && m.overall.cause !== 'page') text = `Can't show the lights yet: ${m.show.ropes.words}.`;
  }
  if (note.textContent !== text) note.textContent = text;
  note.className = `muted secondary${bad && old ? ' bad' : ''}`;
  drawStrips();
}
function drawStrips() {
  const rc = $('#strips-canvas'), qc = $('#quads-canvas');
  const fr = fitCanvas(rc), fq = fitCanvas(qc);
  if (!fr || !fq) return;
  const l = S.lights;
  fr.ctx.clearRect(0, 0, fr.w, fr.h); fq.ctx.clearRect(0, 0, fq.w, fq.h);
  const gap = 6, n = N_ROPES, sw = (fr.w - gap * (n - 1)) / n;
  if (!l.frames) {   // empty outlines: the strips stay readable as 20 places, not a blank box
    fr.ctx.strokeStyle = 'rgba(140, 150, 160, 0.3)'; fr.ctx.lineWidth = 1;
    for (let r = 0; r < n; r++) fr.ctx.strokeRect(r * (sw + gap) + 0.5, 0.5, sw - 1, fr.h - 1);
    const qw = (fq.w - gap * 3) / 4;
    for (let i = 0; i < 4; i++) fq.ctx.strokeRect(i * (qw + gap) + 0.5, 0.5, qw - 1, fq.h - 1);
    return;
  }
  const f = l.frames, dark = f.source === 'black' || f.ropes?.source === 'black';
  // one column of the frame per strip, LED 0 (the plug end) at the top
  const col = document.createElement('canvas'); col.width = f.ropes.w; col.height = f.ropes.h;
  const img = new ImageData(f.ropes.w, f.ropes.h), d = img.data, b = l.bytes;
  for (let i = 0; i < f.ropes.w * f.ropes.h; i++) { d[i * 4] = b[i * 3]; d[i * 4 + 1] = b[i * 3 + 1]; d[i * 4 + 2] = b[i * 3 + 2]; d[i * 4 + 3] = 255; }
  col.getContext('2d').putImageData(img, 0, 0);
  fr.ctx.imageSmoothingEnabled = true;
  for (let r = 0; r < n; r++) {
    const x = Math.round(r * (sw + gap));
    fr.ctx.globalAlpha = S.hi == null || S.hi === r ? 1 : 0.3;
    fr.ctx.drawImage(col, r, 0, 1, f.ropes.h, x, 0, Math.round(sw), fr.h);
    if (dark || l.dark?.[r]) { fr.ctx.strokeStyle = 'rgba(140, 150, 160, 0.5)'; fr.ctx.lineWidth = 1.5; fr.ctx.strokeRect(x + 0.75, 0.75, Math.round(sw) - 1.5, fr.h - 1.5); }
    if (S.hi === r) { fr.ctx.strokeStyle = '#7cc3e8'; fr.ctx.lineWidth = 2; fr.ctx.strokeRect(x + 1, 1, Math.round(sw) - 2, fr.h - 2); }
  }
  fr.ctx.globalAlpha = 1;
  // the four screens, each upright as seen (cell n-1 = screen n), its own shape kept, centred over its number
  const sc = l.scr, gw = (fq.w - gap * 3) / 4;
  let dw = gw, dh = fq.h;
  if (sc.upright) { dh = fq.h; dw = dh * sc.cw / sc.ch; if (dw > gw) { dw = gw; dh = gw * sc.ch / sc.cw; } }
  fq.ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < 4; i++) fq.ctx.drawImage(sc.img, i * sc.cw, 0, sc.cw, sc.ch, Math.round(i * (gw + gap) + (gw - dw) / 2), Math.round((fq.h - dh) / 2), Math.round(dw), Math.round(dh));
}

// ---- provenance: "Map made 23 Oct 12:24 at Gray Area · 20 of 20 ropes · camera drift 10 (fine)" ---------------------------
/** "pixelmap-20261023-122417" → { day: '20261023', words: '23 Oct 12:24' }. */
function captureWhen(capture, file) {
  const m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(capture || '');
  if (m) return { day: m[1] + m[2] + m[3], words: `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[4]}:${m[5]}` };
  const f = /(\d{4})-(\d{2})-(\d{2})/.exec(file || '');
  return f ? { day: f[1] + f[2] + f[3], words: `${Number(f[3])} ${MONTHS[Number(f[2]) - 1]}` } : { day: null, words: 'an unknown day' };
}
function renderProvenance() {
  const sec = $('#prov'), warn = $('#prov-warn');
  const map = S.map.map;
  if (!S.map.loaded) { put('prov-words', 'Loading the map…'); warn.hidden = true; return; }
  if (!map) { put('prov-words', S.map.error ? `No LED map on this mission control: ${esc(S.map.error)}.` : 'No LED map yet. Calibrate to make one.'); warn.hidden = true; sec.classList.remove('old'); return; }
  const when = captureWhen(map.meta?.capture, map.file), fromHere = when.day == null || when.day >= INSTALL_DAY;
  const found = Object.values(map.ropes ?? {}).filter((v) => (v?.visible ?? 0) > 0).length;
  const drift = typeof map.meta?.drift === 'number' ? map.meta.drift : null;
  const driftWords = drift == null ? '' : ` · camera drift ${Math.round(drift)} (${drift < DRIFT_FINE_PX ? 'fine' : 'too much'})`;
  const sc = S.map.screens, quads = screenQuads().filter((q) => q.located), est = quads.filter((q) => q.estimated).length;
  const scWhen = sc ? captureWhen(sc.meta?.capture, sc.file) : null;
  const screensWords = sc ? ` · screens from ${scWhen.words}${est ? ` (${quads.length - est} located, ${est} estimated)` : ''}` : quads.length ? ' · screen 1 from the map' : '';
  put('prov-words', esc(fmt.nb(`Map made ${when.words} at ${fromHere ? 'Gray Area' : 'Agape'} · ${found} of ${N_ROPES} ropes${driftWords}${screensWords}`)));
  // amber when it doesn't match: made at another site, or a calibration since then wrote a newer map
  const p = S.cal.p, newer = p && !p.running && p.ok === true && p.result && !p.result.dry_run && p.result.map && p.result.map > (map.file ?? '');
  let w = '';
  if (!fromHere) w = `This map was made at Agape; it doesn't match the gallery camera here. Calibrate to make a new one.`;
  else if (newer) w = `A calibration made a newer map (${captureWhen(p.result.capture, p.result.map).words}) than the one shown here; mission control picks it up at its next check, or reload the page.`;
  else if (drift != null && drift >= DRIFT_FINE_PX) w = `The camera moved ${Math.round(drift)} px during the capture: the dots may sit off the ropes. Calibrate again with the camera fixed.`;
  warn.hidden = !w;
  if (w) warn.innerHTML = `${mark('warning')}<span>${esc(w)}</span>`;
  sec.classList.toggle('old', !!w);
}

// ---- Calibrate: GET /api/calibration (every 5 s while a run is on), start / cancel / rebuild -----------------------------------
async function pollCal() {
  if (S.cal.fetching) return;
  S.cal.fetching = true;
  try {
    const r = await fetch('/api/calibration', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login'; return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j.ok === false && !('running' in j))) throw new Error(j.error || `HTTP ${r.status}`);
    const wasRunning = S.cal.p?.running === true;
    S.cal.p = j.none ? null : j; S.cal.at = performance.now(); S.cal.wall = Date.now(); S.cal.error = null;
    // ended before this page opened: show only a recent one, judged on the server's clock (never this phone's)
    const nowS = typeof j.age_s === 'number' ? null : serverNowMs() != null ? serverNowMs() / 1000 : null;
    if (!wasRunning && !j.running && !S.cal.seenStarted) S.cal.stale = typeof j.age_s === 'number' ? j.age_s > OLD_RUN_S : nowS != null && typeof j.updated === 'number' && nowS - j.updated > OLD_RUN_S;
    if (j.running) { S.cal.stale = false; S.cal.seenStarted = true; }
    if (wasRunning && !j.running && j.ok === true && j.result && !j.result.dry_run) loadMap();   // a new map: draw it
  } catch (e) {
    S.cal.error = plainError(e);
    // bitcube went away in the middle of a run: the file cannot be read; remember that the run was on
    if (S.cal.p?.running) S.cal.lost ??= { started: S.cal.p.started, at: performance.now() };
  } finally { S.cal.fetching = false; }
  watchCalibration();
  renderCalibrate(); renderProvenance();
}
/** Poll every 5 s only while a run is on: ours, or one the model reports (the 'calibrating' cause, from bitcube's full check). */
function watchCalibration() {
  const modelSays = !!S.m?.problems.some((p) => p.id === 'calibrating');
  const running = S.cal.p?.running === true || modelSays;
  if (running && !S.cal.timer) S.cal.timer = setInterval(pollCal, CAL_MS);
  if (!running && S.cal.timer) { clearInterval(S.cal.timer); S.cal.timer = null; }
  if (modelSays && !S.cal.p?.running && !S.cal.pending && !S.cal.fetching) pollCal();   // a run started elsewhere (the chat): fetch it
}
const dismissed = () => store.get('mc-cal-dismissed') ?? '';
const isDismissed = (p) => !!p && String(dismissed()).split(',').includes(String(p.started));
function dismiss(p) { if (p) store.set('mc-cal-dismissed', [...dismissed().split(',').filter(Boolean).slice(-5), String(p.started)].join(',')); S.cal.lost = null; renderCalibrate(); }

function calChecklist(m) {
  const lv = (id) => m?.items.find((x) => x.id === id)?.level ?? 'unknown';
  const both = [lv('rope box 1'), lv('rope box 2')];
  const boxLevel = both.every((l) => l === 'ok') ? 'ok' : both.includes('down') ? 'down' : both.includes('warning') ? 'warning' : 'unknown';
  const boxWhy = both[0] !== 'ok' && both[1] !== 'ok' ? "neither rope box is answering" : both[0] !== 'ok' ? "rope box 1 isn't answering" : "rope box 2 isn't answering";
  const td = m?.items.find((x) => x.id === 'touchdesigner'), tdSum = td?.summary ?? '';
  const tdWhy = td?.level === 'down' ? (/not running/i.test(tdSum) ? "TouchDesigner isn't running" : "TouchDesigner isn't answering")
    : /slow/i.test(tdSum) ? `TouchDesigner is running slowly (${tdSum.replace(/^Running slowly: /i, '')})`
    : /restart|start/i.test(tdSum) ? 'TouchDesigner is still starting' : "TouchDesigner isn't ready";
  return [
    { level: lv('touchdesigner'), ok: 'TouchDesigner answering', why: tdWhy },
    { level: boxLevel, ok: 'both rope boxes answering', why: boxWhy },
    { level: lv('gallery camera'), ok: 'the gallery camera reachable', why: "the gallery camera isn't reachable" },
  ];
}
function runTotalS(p) {
  const expected = typeof p.expected_s === 'number' && p.expected_s > 0 ? p.expected_s : null;
  return expected && CAL_STAGE_S[p.stage] ? CAL_TOTAL_S / CAL_STAGE_S[p.stage] * expected : CAL_TOTAL_S;
}
/** How far along the run is, 0–1, by the stages' typical lengths and the step within the stage. */
function runFraction(p) {
  const stages = STAGE_ORDER.filter((s) => CAL_STAGE_S[s]);
  const i = stages.indexOf(p.stage);
  if (p.stage === 'done') return 1;
  if (i < 0) return 0;
  let done = 0; for (let k = 0; k < i; k++) done += CAL_STAGE_S[stages[k]];
  let within = p.of > 0 ? Math.min(1, (p.step ?? 0) / p.of) : 0;
  if (p.stage === 'ropes-capture' && p.pass) within = (p.pass === 'B' ? 0.5 : 0) + within / 2;   // two passes of the patterns
  return Math.min(1, (done + CAL_STAGE_S[p.stage] * within) / CAL_TOTAL_S);
}
function resultWords(res) {
  const when = res.date ? captureWhen(res.capture, res.map) : { words: 'today' };
  const dark = Array.isArray(res.ropes_dark) ? res.ropes_dark : [];
  const darkWords = dark.length ? ` · ${dark.length === 1 ? 'rope' : 'ropes'} ${dark.length > 1 ? dark.slice(0, -1).join(', ') + ' and ' + dark.at(-1) : dark[0]} not found (dark)` : '';
  const ropesFound = Array.isArray(res.ropes_found) ? res.ropes_found.length : (N_ROPES - dark.length);
  const quads = Array.isArray(res.hub75_quads) && res.hub75_quads.length ? ` · ${res.hub75_quads.length === 1 ? 'screen 1 found' : `${res.hub75_quads.length} screens found`}` : '';
  const drift = typeof res.drift_px === 'number' ? ` · camera drift ${Math.round(res.drift_px)} (${res.drift_px < DRIFT_FINE_PX ? 'fine' : 'too much'})` : '';
  const seen = typeof res.seen === 'number' ? res.seen     // the result says how many LEDs the camera saw (calibrate.py summarize_map)
    : S.map.map && S.map.map.file === res.map ? Object.values(S.map.map.ropes ?? {}).reduce((s, v) => s + (v?.visible ?? 0), 0) : null;   // older result: the map on this page is that map
  const points = seen != null ? ` · ${seen.toLocaleString('en-US')} LEDs seen, the rest placed along the rope` : typeof res.points === 'number' ? ` · ${res.points.toLocaleString('en-US')} LEDs placed` : '';
  return fmt.nb(`Map made ${when.words} · ${ropesFound} of ${N_ROPES} ropes found${darkWords}${points}${drift}${quads}.`);
}
/** The Calibrate block. Each view (before, run, stopped, failed, done, lost) is built once; while it stays, its parts are
 *  painted in place and its controls are kept and updated, never re-mounted: a confirm left open is withdrawn by its own
 *  control when that becomes impossible (ui.js control().update), and Stop keeps its pending and failed words across the
 *  run's every pattern. Leaving a view withdraws any confirm its controls still have open. */
function renderCalibrate() {
  const m = S.m, p = S.cal.p, body = $('#cal-body');
  const running = p?.running === true;
  const lost = S.cal.lost && !isDismissed({ started: S.cal.lost.started }) ? S.cal.lost : null;
  const finished = p && !p.running && !isDismissed(p) && !S.cal.stale;   // a finished run stays until dismissed (or it was old when the page opened)
  const lostView = !!lost || (running && m?.overall.cause === 'bitcube-offline');
  const dry = !!(p?.dry_run || p?.mode === 'dry-run' || p?.result?.dry_run);
  let view, key, html;
  if (lostView) {
    view = 'lost'; key = `lost:${lost?.started ?? p?.started}`;
    html = `<div class="cal-result lv-down"><div class="h">${mark('down')}<span>Calibration interrupted</span></div>
      <p class="r-words">bitcube went offline during the run: the ropes may still be in patterns; they come back when TouchDesigner reloads.</p>
      <div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss-lost">OK</button></div></div>`;
  } else if (running) {
    view = 'run'; key = `run:${p.started}:${dry}`;
    html = `<div class="cal-stage" id="cal-stage">${dry ? 'A dry run: the lights don\'t change' : 'Calibrating'}</div>
      <div class="stages" id="cal-stages"></div>
      <div class="prog ${dry ? 'dry' : ''}" id="cal-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="cal-bar" style="width:0%"></i></div>
      <div class="cal-line" id="cal-line"></div>
      <div class="cal-left" id="cal-left"></div>
      <div class="cal-ctls"><div class="ctl" id="cal-stop"></div></div>
      <p class="cal-fine">Started ${esc(fmt.clock(p.started * 1000))}${p.cam ? ` · the ${esc(p.cam)} camera` : ''}. ${dry ? 'The lights stay as they are.' : 'The ropes come back to the river by themselves when it ends.'}</p>`;
  } else if (finished && p.cancelled) {
    view = 'stopped'; key = `stopped:${p.started}:${p.restored}:${dry}`;
    const forced = p.restored === false && !dry;
    html = `<div class="cal-result lv-unknown"><div class="h">${mark('unknown')}<span>${dry ? 'Dry run stopped' : 'Stopped'}</span></div>
      <p class="r-words">${dry ? 'Dry run stopped; nothing changed.' : forced ? 'Stopped, but it had to be forced: the ropes may still show a pattern. Press Ropes → On on the Status page. No map was written.' : 'Stopped; the ropes are back on the river. No map was written.'}</p>
      <div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">OK</button>${forced ? '<a class="btn" href="/status">Open Status</a>' : ''}</div></div>`;
  } else if (finished && p.ok === false) {
    view = 'failed'; key = `failed:${p.started}:${p.error}`;
    const err = calFailure(p);
    html = `<div class="cal-result lv-down"><div class="h">${mark('down')}<span>Calibration failed</span></div>
      <p class="r-words">${esc(err.replace(/\.?$/, '.'))}${p.restored === false ? ' The ropes may still show a pattern: press Ropes → On on the Status page.' : /back on the river|the map was not saved/i.test(err) ? '' : ' The ropes are back on the river; no map was written.'}</p>
      <div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">OK</button><button type="button" class="btn primary" data-cal="again">Back to Calibrate</button></div></div>`;
  } else if (finished && p.ok === true) {
    const res = p.result, rebuilt = rebuiltAt(p);
    view = 'done'; key = `done:${p.started}:${rebuilt ?? ''}`;
    html = rebuilt != null
      // rebuilt: the map is in the show file now; nothing more to press (a second rebuild is another minute dark)
      ? `<div class="cal-result lv-ok"><div class="h">${mark('ok')}<span>Map in use</span></div>
        <p class="r-words">The river's year now uses this map (rebuilt ${esc(fmt.clock(rebuilt))}).${res ? ` <span class="muted">${esc(resultWords(res))}</span>` : ''}</p>
        <div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">OK</button></div></div>`
      : `<div class="cal-result lv-ok"><div class="h">${mark('ok')}<span>${dry ? 'Dry run finished' : 'Map made'}</span></div>
      <p class="r-words">${res ? esc(resultWords(res)) : 'The run finished.'}${dry ? ' <span class="muted">A dry run describes the newest existing map; the lights were not changed and nothing was written.</span>' : ' The show file still uses the old map until it is rebuilt.'}</p>
      ${dry ? '<div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">OK</button></div>'
        : `<div class="cal-ctls"><div class="ctl" id="cal-rebuild"></div></div><div class="cal-dismiss"><button type="button" class="btn" data-cal="dismiss">Keep the old map</button></div>`}</div>`;
  } else {
    view = 'before'; key = 'before';
    html = `<p class="cal-lead">Finds where every LED and the panels are, using the gallery camera. The ropes flash black-and-white patterns for about five minutes (the show is interrupted) and come back by themselves.</p>
      <ul class="checklist" id="cal-checks"></ul>
      <div class="cal-ctls"><div class="ctl" id="cal-start"></div><div class="ctl quiet" id="cal-dry"></div></div>`;
  }
  if (S.html['cal-body'] !== key) {
    leaveCalView(view);
    S.html['cal-body'] = key; S.html['cal-checks'] = null;
    body.innerHTML = html;
    if (view === 'run') S.calCtl.stop = mountStop(dry);
    else if (view === 'done' && !dry && rebuiltAt(p) == null) S.calCtl.rebuild = mountRebuild(p);
    else if (view === 'before') Object.assign(S.calCtl, mountStart(m));
  }
  // the parts that change while a view stays, painted in place
  if (view === 'before') {
    const checks = calChecklist(m);
    const ul = $('#cal-checks'), lis = `${checks.map((c) => `<li class="lv-${c.level}">${mark(c.level)}<span>${esc(c.level === 'ok' ? c.ok : c.level === 'unknown' ? `${c.ok.replace(/answering|reachable/, 'not known yet')}` : c.why)}</span></li>`).join('')}
        <li class="you"><span class="mk" aria-hidden="true">·</span><span>the room dark and nobody in the camera's view (you check)</span></li>`;
    if (ul && S.html['cal-checks'] !== lis) { S.html['cal-checks'] = lis; ul.innerHTML = lis; }
    for (const [c, w] of [[S.calCtl.start, startWhy(m)], [S.calCtl.dry, dryWhy(m)]]) if (c && c.state !== 'pending' && c.why !== w) c.update({ why: w });
  }
  if (view === 'run') { paintRun(p); tickCalibrate(); }
  updateRebuild();
}
/** Leaving a view: a confirm its controls still hold open (Start, Dry run, Rebuild) is withdrawn, so a press on it can't send
 *  anything for a block that is gone; a control already sending is left to finish. */
function leaveCalView(next) {
  const why = next === 'run' ? 'a calibration is running' : next === 'lost' ? 'bitcube went offline during the run' : 'the calibration changed meanwhile';
  for (const c of Object.values(S.calCtl)) if (c && c.state !== 'pending') c.update({ why });
  S.calCtl = {};
}
/** The run's progress, painted in place (the stage words, the bar, "Pass A: pattern 12 of 29 · 1 pattern photographed again"). */
function paintRun(p) {
  const line = p.pass && p.of > 0 ? `Pass ${p.pass}: pattern ${p.step} of ${p.of}`
    : p.stage === 'ropes-decode' && p.of > 0 && p.step >= 1 ? `Rope ${p.step} of ${p.of}`       // never "Rope 0 of 20": it reads as an error
    : p.stage === 'ropes-capture' && p.of > 0 && p.step > 0 ? `Pass ${p.step} of ${p.of} done` : '';
  const again = p.retakes ? `${p.retakes} ${p.retakes === 1 ? 'pattern' : 'patterns'} photographed again` : '';
  const text = fmt.nb([line, again].filter(Boolean).join(' · '));
  const el = $('#cal-line'); if (el && el.textContent !== text) el.textContent = text;
  const stages = STAGE_ORDER.map((s) => `<span class="${s === p.stage ? 'now' : STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(p.stage ?? 'ropes-capture') ? 'done' : ''}">${STAGE_WORDS[s]}</span>`).join('<span aria-hidden="true">→</span>');
  const st = $('#cal-stages'); if (st && S.html['cal-stages'] !== stages) { S.html['cal-stages'] = stages; st.innerHTML = stages; }
  const pct = Math.round(runFraction(p) * 100), prog = $('#cal-prog'), bar = $('#cal-bar');
  if (prog && prog.getAttribute('aria-valuenow') !== String(pct)) { prog.setAttribute('aria-valuenow', String(pct)); bar.style.width = `${pct}%`; }
}
/** When the rebuild with this run's map succeeded on this phone (ms), or null. */
function rebuiltAt(p) {
  const hit = String(store.get('mc-cal-rebuilt') ?? '').split(',').map((x) => x.split('@')).find(([st]) => p && st === String(p.started));
  return hit && Number.isFinite(Number(hit[1])) ? Number(hit[1]) : null;
}
/** Why a run failed, in the team's words: calibrate.py's plain `reason` (from 24 Oct), else its error when that is already
 *  plain, else the stage it failed in; never a step id, a file name, an exit code or a traceback. */
function calFailure(p) {
  const plain = (s) => !!s && !/Traceback|exit \d|\.py\b|\bOUT\b|bridge|Error:|[A-Z][a-z]+Error\b|\|/.test(s);
  if (p?.reason && plain(p.reason)) return String(p.reason);
  const e = String(p?.error ?? '');
  if (plain(e)) return e || 'the run ended with an error';
  const stage = /ropes-capture/.test(e) ? 'Photographing the ropes failed' : /ropes-decode/.test(e) ? 'Working out where each rope is failed'
    : /hub75-capture/.test(e) ? 'Photographing the panels failed' : /hub75-locate/.test(e) ? 'Finding the panels failed' : 'The run stopped with an error';
  return `${stage}; run it again when the room is empty, or ask Gavin`;
}
function tickCalibrate() {
  const p = S.cal.p, left = $('#cal-left');
  if (!p?.running || !left) return;
  if (p.dry_run) { left.textContent = 'A dry run takes about a minute.'; return; }
  const elapsed = (p.elapsed_s ?? 0) + since(S.cal.at, S.cal.wall);
  const remain = Math.max(0, runTotalS(p) - elapsed);
  left.textContent = remain < 45 ? 'Nearly done' : `About ${fmt.nb(dur(remain))} left`;
}
function startRun(dry_run) {
  S.cal.pending = true;
  return api('/api/control/calibrate', { action: 'start', dry_run: !!dry_run }).catch((e) => {
    // the server's refusals read "<reason>: calibration can't start"; the control adds its own frame, so keep the reason alone
    const reason = String(e.message || e).replace(/:\s*calibration can't start$/i, '');
    throw Object.assign(new Error(/^[A-Z][a-z]/.test(reason) && !/^TouchDesigner/.test(reason) ? reason[0].toLowerCase() + reason.slice(1) : reason),
      { status: e.status, noAnswer: e.noAnswer, waitedS: e.waitedS, posted: e.posted });
  }).finally(() => { S.cal.pending = false; });
}
function afterStart(r) {
  if (r?.calibration) { S.cal.p = r.calibration; S.cal.at = performance.now(); S.cal.wall = Date.now(); S.cal.lost = null; }
  S.cal.stale = false; S.cal.seenStarted = true;
  watchCalibration(); renderCalibrate(); pollCal();
}
/** Why Calibrate (and its dry run) can't start now: the model's reason for the ropes, else the checklist's first failing line. */
function startWhy(m) {
  if (!m) return "this page hasn't heard from mission control yet";
  const failing = calChecklist(m).find((c) => c.level !== 'ok');
  return m.controls.ropes.why ?? (failing ? failing.why : null);
}
/** A dry run touches no lights and needs no camera: only the model's reason for the ropes (a calibration running, no contact). */
const dryWhy = (m) => (m ? m.controls.ropes.why : "this page hasn't heard from mission control yet");
function mountStart(m) {
  const why = startWhy(m);
  const start = control($('#cal-start'), { label: 'Calibrate the lights', kind: 'primary', why,
    before: 'Starts the real run: patterns on the ropes for about five minutes, then a new LED map to look at before anything changes. Asks first.',
    confirm: { title: 'Start calibration?', body: "The ropes go into patterns now, for about five minutes, and the show stops meanwhile. Keep people out of the camera's view.", ok: 'Start', cancel: 'Not now', destructive: true },
    pending: 'Asking bitcube to start…', run: () => startRun(false), done: 'Calibration started', fail: "Calibration didn't start", onDone: afterStart });
  const dry = control($('#cal-dry'), { label: 'Dry run: the lights stay as they are', kind: 'plain', why: dryWhy(m),
    before: 'Walks the same steps without touching the lights, about a minute: a check that the camera and bitcube are ready.',
    pending: 'Asking bitcube to start…', run: () => startRun(true), done: 'Dry run started', fail: "The dry run didn't start", onDone: afterStart });
  start.why = why; dry.why = dryWhy(m);
  const wrap = (c) => { const up = c.update; c.update = (n) => { if ('why' in n) c.why = n.why; up(n); }; return c; };
  return { start: wrap(start), dry: wrap(dry) };
}
/** Stop, mounted once per run (its pending and failed words stay while the patterns move on). A dry run touches no lights. */
function mountStop(dry) {
  return control($('#cal-stop'), { label: dry ? 'Stop the dry run' : 'Stop and restore the ropes', kind: 'danger',
    before: dry ? 'Ends the check now; the lights were not touched.' : 'Ends the run now; the ropes go back to the river within a few seconds. No map is written.',
    pending: 'Asking bitcube to stop…', run: () => api('/api/control/calibrate', { action: 'cancel' }), fail: "It didn't stop",
    noAnswer: 'the progress above shows whether it is still running',
    done: (r) => (r?.forced && !dry ? 'Stopped, but it had to be forced' : r?.cancelled === false ? 'Nothing was running' : 'Stopped'),
    onDone: (r) => { if (r?.calibration) { S.cal.p = r.calibration; S.cal.at = performance.now(); if (r.forced) S.cal.p.restored = false; } watchCalibration(); renderCalibrate(); pollCal(); } });
}
/** Why the rebuild can't run now: the model's reason for a switch, or the river's year not running (only it is rebuilt). */
function rebuildWhy() {
  const m = S.m;
  if (!m) return "this page hasn't heard from mission control yet";
  if (m.sources.probe.stale) return `mission control hasn't heard from bitcube for ${dur(m.sources.probe.age_s)}`;
  return m.controls.switch.why ?? (m.show.file && m.show.file.kind !== 'year' ? "the river's year isn't running: switch to it first" : !m.show.file ? "what TouchDesigner is running isn't known" : null);
}
function updateRebuild() { const c = S.calCtl.rebuild; if (c?.button.isConnected && c.state !== 'pending') c.update({ why: rebuildWhy() }); }
function mountRebuild(p) {
  return control($('#cal-rebuild'), { label: 'Use this map: rebuild the show file', kind: 'primary', why: rebuildWhy(),
    before: `Bakes the new LED map (${esc(captureWhen(p.result?.capture, p.result?.map).words)}) into the river's year and restarts TouchDesigner on it: about a minute dark. Asks first.`,
    confirm: { title: 'Rebuild the show file with this map?', body: "Bakes the new LED map into the river's year and restarts TouchDesigner on it: about a minute dark.", ok: 'Rebuild', cancel: 'Keep the old map', destructive: true },
    pending: 'Rebuilding on bitcube… this takes a few minutes', run: () => api('/api/control/rebuild', { file: YEAR_FILE }),
    done: "Rebuilt the river's year with the new map; TouchDesigner is restarting on it", fail: 'The show file is unchanged',
    // the card then says the map is in use, with no second rebuild on offer (another minute dark)
    onDone: () => { store.set('mc-cal-rebuilt', [...String(store.get('mc-cal-rebuilt') ?? '').split(',').filter(Boolean).slice(-5), `${p.started}@${Date.now()}`].join(',')); renderCalibrate(); status.refresh(); loadMap(); } });
}
$('#cal-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cal]');
  if (!b) return;
  if (b.dataset.cal === 'dismiss') dismiss(S.cal.p);
  else if (b.dataset.cal === 'dismiss-lost') { dismiss({ started: S.cal.lost?.started ?? S.cal.p?.started }); S.cal.lost = null; if (S.cal.p?.running) S.cal.p = { ...S.cal.p, running: false, ok: false, error: 'interrupted' }; renderCalibrate(); }
  else if (b.dataset.cal === 'again') { dismiss(S.cal.p); }
});

// ---- footer -------------------------------------------------------------------------------------------------------
function renderFooter() {
  put('foot', `<div class="links">${DOC_LINKS.map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div>`);
}

// ---- go ----------------------------------------------------------------------------------------------------------
loadMap(); pollLights(); pollCal();
setInterval(pollLights, LIGHTS_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollLights(); if (S.room.on) pollRoom(); if (S.cal.p?.running) pollCal(); } });
document.addEventListener('mc:check', () => { status.refresh(); pollLights(); pollCal(); });
document.addEventListener('mc:theme', () => render());
addEventListener('resize', () => { drawMap(liveView()); drawStrips(); });
tick(() => {   // ages only: the state line's "from bitcube", the captions, the time left; the rows stay put
  if (S.m) { S.m = model(); renderStateLine(); } else renderStateLine();   // before the first answer: the wait's words tick too
  const live = liveView(), cap_ = $('#map-cap');
  if (live && S.lights.frames && cap_) {
    const t = `<b>Live</b> · what TouchDesigner is sending · from bitcube · ${esc(fmt.nb(dur(frameAgeS())))} ago${S.room.on && S.room.url && !stillUrl(S.map.still) ? ` · the room still is ${esc(fmt.nb(dur(roomAgeS())))} old` : ''}`;
    if (S.html['map-cap'] !== t) put('map-cap', t);
    if ((frameOld() || pageDown()) !== $('#mapwrap').classList.contains('dim')) renderMapCard();
  }
  if (S.lights.frames && frameOld() !== $('#strips').classList.contains('dim')) renderStrips();
  if (!S.map.loaded) renderMapCard();   // "Loading the LED map…", then "hasn't loaded: no answer for N s" ticking
  tickCalibrate();
});
