// What TouchDesigner sends to the lights (GET /api/lights, lib/lights.mjs CONTRACT), drawn: one place for the Lights page and the
// Remembered river page (and the 30 % rule's meter, shared with the HUB75 simulator). Decoding is pure; the painters take a canvas
// sized by fitCanvas(). Plain ES module, no build step.
import { uprightsFromAtlas } from '/screens.js';

/** base64 RGB (w*h*3 bytes) -> Uint8Array, or null when it is short or not base64. */
export function decodeRGB(b64, w, h) {
  try {
    const bin = atob(b64), n = w * h * 3;
    if (bin.length < n) return null;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
/** RGB bytes -> an offscreen canvas of w x h. */
export function panelImage(bytes, w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const img = new ImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { d[i * 4] = bytes[i * 3]; d[i * 4 + 1] = bytes[i * 3 + 1]; d[i * 4 + 2] = bytes[i * 3 + 2]; d[i * 4 + 3] = 255; }
  cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}
/** The four screens to draw, each upright as seen: { img, cw, ch, upright } with cell k-1 = screen k at (cw·(k-1), 0, cw, ch).
 *  frames.screens when bitcube sends it; else the Gray Area atlas undone (public/screens.js); else (an atlas of four quads in a
 *  row, before Gray Area) the atlas cut into four as it is. */
export function screensOf(f, panelBytes) {
  const s = f.screens;
  if (s?.rgb && Number.isInteger(s.w) && Number.isInteger(s.h) && s.w % 4 === 0) {
    const b = decodeRGB(s.rgb, s.w, s.h);
    if (b) return { img: panelImage(b, s.w, s.h), cw: s.w / 4, ch: s.h, upright: true };
  }
  const up = uprightsFromAtlas(panelBytes, f.panels.w, f.panels.h);
  if (up) return { img: panelImage(up.bytes, up.w, up.h), cw: up.w / 4, ch: up.h, upright: true };
  return { img: panelImage(panelBytes, f.panels.w, f.panels.h), cw: f.panels.w / 4, ch: f.panels.h, upright: false };
}
/** A /api/lights answer -> { frames, bytes, panelBytes, dark (per rope: every LED black), scr }; throws when it is cut short. */
export function decodeLights(f) {
  const bytes = decodeRGB(f.ropes.rgb, f.ropes.w, f.ropes.h), panelBytes = decodeRGB(f.panels.rgb, f.panels.w, f.panels.h);
  if (!bytes || !panelBytes) throw new Error('the frame was cut short');
  const dark = [];
  for (let c = 0; c < f.ropes.w; c++) { let lit = false; for (let y = 0; y < f.ropes.h && !lit; y++) { const i = (y * f.ropes.w + c) * 3; if (bytes[i] > 8 || bytes[i + 1] > 8 || bytes[i + 2] > 8) lit = true; } dark.push(!lit); }
  return { frames: f, bytes, panelBytes, dark, scr: screensOf(f, panelBytes) };
}
/** A canvas's backing store sized to its box (device pixels, at most 2x): { ctx, w, h } in CSS pixels, or null while it has no size. */
export function fitCanvas(cv) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
const GAP = 6;
/** Empty outlines, so the strips and the screens stay readable as places before any frame (n strips, 4 screens). */
export function paintEmpty(fr, fq, n = 20) {
  if (fr) {
    fr.ctx.clearRect(0, 0, fr.w, fr.h);
    const sw = (fr.w - GAP * (n - 1)) / n;
    fr.ctx.strokeStyle = 'rgba(140, 150, 160, 0.3)'; fr.ctx.lineWidth = 1;
    for (let r = 0; r < n; r++) fr.ctx.strokeRect(r * (sw + GAP) + 0.5, 0.5, sw - 1, fr.h - 1);
  }
  if (fq) {
    fq.ctx.clearRect(0, 0, fq.w, fq.h);
    const qw = (fq.w - GAP * 3) / 4;
    fq.ctx.strokeStyle = 'rgba(140, 150, 160, 0.3)'; fq.ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) fq.ctx.strokeRect(i * (qw + GAP) + 0.5, 0.5, qw - 1, fq.h - 1);
  }
}
/** The ropes, one strip each, LED 0 (the plug end) at the top. d: decodeLights()'s answer. hi: the highlighted rope (0-based) or
 *  null; mark: ropes to outline (0-based, e.g. a lingerer's) in `markColor`. */
export function paintStrips(fr, d, { hi = null, mark = [], markColor = '#ffd25e' } = {}) {
  if (!fr) return;
  const f = d.frames, n = f.ropes.w, sw = (fr.w - GAP * (n - 1)) / n;
  fr.ctx.clearRect(0, 0, fr.w, fr.h);
  const dark = f.source === 'black' || f.ropes?.source === 'black';
  const col = document.createElement('canvas'); col.width = f.ropes.w; col.height = f.ropes.h;
  const img = new ImageData(f.ropes.w, f.ropes.h), px = img.data, b = d.bytes;
  for (let i = 0; i < f.ropes.w * f.ropes.h; i++) { px[i * 4] = b[i * 3]; px[i * 4 + 1] = b[i * 3 + 1]; px[i * 4 + 2] = b[i * 3 + 2]; px[i * 4 + 3] = 255; }
  col.getContext('2d').putImageData(img, 0, 0);
  fr.ctx.imageSmoothingEnabled = true;
  for (let r = 0; r < n; r++) {
    const x = Math.round(r * (sw + GAP));
    fr.ctx.globalAlpha = hi == null || hi === r ? 1 : 0.3;
    fr.ctx.drawImage(col, r, 0, 1, f.ropes.h, x, 0, Math.round(sw), fr.h);
    if (dark || d.dark?.[r]) { fr.ctx.strokeStyle = 'rgba(140, 150, 160, 0.5)'; fr.ctx.lineWidth = 1.5; fr.ctx.strokeRect(x + 0.75, 0.75, Math.round(sw) - 1.5, fr.h - 1.5); }
    if (hi === r) { fr.ctx.strokeStyle = '#7cc3e8'; fr.ctx.lineWidth = 2; fr.ctx.strokeRect(x + 1, 1, Math.round(sw) - 2, fr.h - 2); }
    else if (mark.includes(r)) { fr.ctx.globalAlpha = 1; fr.ctx.strokeStyle = markColor; fr.ctx.lineWidth = 2; fr.ctx.strokeRect(x + 1, 1, Math.round(sw) - 2, fr.h - 2); }
  }
  fr.ctx.globalAlpha = 1;
}
/** The four screens, each upright as seen (cell n-1 = screen n), its own shape kept, centred over its number. */
export function paintScreens(fq, sc) {
  if (!fq || !sc) return;
  fq.ctx.clearRect(0, 0, fq.w, fq.h);
  const gw = (fq.w - GAP * 3) / 4;
  let dw = gw, dh = fq.h;
  if (sc.upright) { dh = fq.h; dw = dh * sc.cw / sc.ch; if (dw > gw) { dw = gw; dh = gw * sc.ch / sc.cw; } }
  fq.ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < 4; i++) fq.ctx.drawImage(sc.img, i * sc.cw, 0, sc.cw, sc.ch, Math.round(i * (gw + GAP) + (gw - dw) / 2), Math.round((fq.h - dh) / 2), Math.round(dw), Math.round(dh));
}

// ---- the artists' panel rule: at most 30 % of a screen lit --------------------------------------------------------------
export const PANEL_RULE_PCT = 30;
/** One bar per screen against the 30 % rule, as HTML (the page's stylesheet: .litmeter in v2.css). pcts: four numbers (0-100) or
 *  nulls. Over the rule: the bar and its number say so in words too ("over"), never by colour alone. */
export function litMeterHTML(pcts, { rule = PANEL_RULE_PCT, label = 'Screen' } = {}) {
  const row = (p, k) => {
    const v = typeof p === 'number' && Number.isFinite(p) ? Math.max(0, p) : null, over = v != null && v > rule;
    const w = v == null ? 0 : Math.min(100, v);
    return `<div class="litrow${over ? ' over' : ''}"><span class="litname">${label} ${k + 1}</span>
      <span class="litbar" role="img" aria-label="${label} ${k + 1}: ${v == null ? 'unknown' : `${Math.round(v)} % lit`}${over ? `, over the ${rule} % rule` : ''}"><span class="fill" style="width:${w}%"></span><span class="rule" style="left:${rule}%"></span></span>
      <span class="litnum">${v == null ? '–' : `${Math.round(v)} %`}${over ? ' <b>over</b>' : ''}</span></div>`;
  };
  return `<div class="litmeter">${[0, 1, 2, 3].map((k) => row(pcts?.[k], k)).join('')}<div class="litkey">the line: at most ${rule} % of a screen lit</div></div>`;
}
