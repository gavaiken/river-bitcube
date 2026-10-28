// Mission control: the HUB75 simulator (/hub75). An experiment, not the show: nothing here reaches bitcube.
//
// The river footage (mission/media/river-cascade.mp4, 22 s of the river cam's main stream on 27 Oct, looped) goes through four
// WebGL2 passes, all in this page:
//   1. analysis (320 × 180): luma, and two running averages of how much each pixel changes from frame to frame: a slow one
//      (where the water is: rocks, trees and the camera's timestamp barely change) and a fast one (what is moving right now).
//   2. mask: both blurred, the slow one scaled so its 95th percentile is 1 (the scene sets its own scale), then a soft threshold:
//      1 = moving water, 0 = everything else.
//   3. panels (512 × 256): what TD would send. Four portrait screens of 128 × 256 LEDs side by side, upright as seen, each
//      sampling its own window of the footage (or one window spanning all four). Outside the water the signal is exactly 0:
//      the LEDs are off, not dark grey. Intensity scales light output (linear), then the signal is re-encoded.
//   4. LEDs (the canvas): each LED drawn as an emitter on a black board, at the panel's grey depth, with optional glow.
// Plain ES module, no build, no framework.
import { mountShell, art } from '/ui.js';

const $ = (s) => document.querySelector(s);
const AW = 320, AH = 180;                  // analysis size
const SW = 128, SH = 256, GAP = 48;        // one screen in LEDs (portrait), the gap between screens in LED pitches
const PW = SW * 4, PH = SH;                // the panel texture: four screens side by side
const WALL_W = 4 * SW + 3 * GAP;           // 656
const GPAD = 32, GW = (WALL_W + 2 * GPAD) / 2, GH = (SH + 2 * GPAD) / 2;   // the glow is worked out on the wall, at half resolution
const KEY = 'mc-hub75';
const DEFAULTS = { intensity: 0.7, look: 'water', frame: 'four', zoom: 2.4, sens: 0.35, soft: 0.35, floor: 0.12, contrast: 1.4,
                   sat: 0.85, trail: 0.5, glow: 0.25, bits: 10, follow: false, src: 'mask', view: 'wall',
                   centers: [[0.3, 0.5], [0.42, 0.55], [0.55, 0.5], [0.68, 0.45]], spanCenter: [0.5, 0.5] };
const LOOK_HINT = {
  water: 'The moving water as it looks, everything else off.',
  foam: 'Only the bright white water inside the moving area: sparse, most LEDs off.',
  motion: 'Only what changed in the last moments, with a fading trail: the flow itself.',
};

const S = load();
function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && typeof v === 'object') return { ...structuredClone(DEFAULTS), ...v }; } catch { /* none kept */ }
  return structuredClone(DEFAULTS);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private window */ } }

const shell = mountShell({ page: 'hub75', title: 'HUB75 simulator' });
shell.setAge(0);
art.setSeason?.(null);
const banner = (t) => { const b = $('#banner'); b.textContent = t; b.hidden = !t; };

// ---- WebGL -------------------------------------------------------------------------------------------------------
const canvas = $('#leds');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
if (!gl) { banner("This browser has no WebGL2, so the simulator can't run here. Try Chrome, Safari 15+ or Firefox."); throw new Error('no webgl2'); }
const floatOK = !!gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');

const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0., 1.); }`;
const HEAD = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
const FS_ANA = HEAD + `
uniform sampler2D uVid, uPrev; uniform float aSlow, aFast, uFirst;
void main() {
  float L = luma(textureLod(uVid, vUv, 2.6).rgb);
  vec4 pr = texture(uPrev, vUv);
  float d = abs(L - pr.r);
  o = uFirst > 0.5 ? vec4(L, 0., 0., 1.) : vec4(L, mix(pr.g, d, aSlow), mix(pr.b, d, aFast), 1.);
}`;
// separable 9-tap gaussian; pass 1 (horizontal) blurs the motion channels, pass 2 (vertical) also shapes the mask
const FS_BLUR_H = HEAD + `
uniform sampler2D uIn; uniform vec2 uStep;
const float W[5] = float[5](0.227, 0.1945, 0.1216, 0.054, 0.0162);
void main() {
  vec2 s = texture(uIn, vUv).gb * W[0];
  for (int i = 1; i < 5; i++) { vec2 dd = uStep * float(i); s += (texture(uIn, vUv + dd).gb + texture(uIn, vUv - dd).gb) * W[i]; }
  o = vec4(s, 0., 1.);
}`;
const FS_MASK = HEAD + `
uniform sampler2D uIn; uniform vec2 uStep; uniform float uNorm, uThr, uSoft;
const float W[5] = float[5](0.227, 0.1945, 0.1216, 0.054, 0.0162);
void main() {
  vec2 s = texture(uIn, vUv).rg * W[0];
  for (int i = 1; i < 5; i++) { vec2 dd = uStep * float(i); s += (texture(uIn, vUv + dd).rg + texture(uIn, vUv - dd).rg) * W[i]; }
  float n = s.x * uNorm;
  float m = smoothstep(uThr, uThr + uSoft, n);
  o = vec4(m, clamp(s.y * uNorm * 1.3, 0., 1.), clamp(s.x * 4., 0., 1.), 1.);
}`;
// where panel pixel px samples the footage (y of the footage from the top), and the mip level that averages it
const WINDOW = `
uniform vec4 uRect[4]; uniform vec2 uVidPx;
vec2 srcOf(vec2 px, out float lod) {
  int k = int(px.x / ${SW}.);
  vec2 loc = vec2(mod(px.x, ${SW}.) / ${SW}., px.y / ${SH}.);
  vec4 r = uRect[k];
  lod = log2(max(r.z * uVidPx.x / ${SW}., 1.));
  return vec2(r.x + loc.x * r.z, r.y + (1. - loc.y) * r.w);
}`;
// what is moving now, at panel resolution: the change since the last frame, as a running average (the trail)
const FS_MOT = HEAD + WINDOW + `
uniform sampler2D uVid, uPrevVid, uPrevE; uniform float aFast, uFirst;
void main() {
  float lod; vec2 src = srcOf(gl_FragCoord.xy, lod);
  float d = abs(luma(textureLod(uVid, src, lod).rgb) - luma(textureLod(uPrevVid, src, lod).rgb));
  float e = texelFetch(uPrevE, ivec2(gl_FragCoord.xy), 0).r;
  o = vec4(uFirst > 0.5 ? 0. : mix(e, d, aFast), 0., 0., 1.);
}`;
const FS_PANEL = HEAD + WINDOW + `
uniform sampler2D uVid, uMask, uMot;
uniform int uLook; uniform float uFloor, uContrast, uSat, uIntensity, uNorm;
void main() {
  vec2 px = gl_FragCoord.xy;
  float lod; vec2 src = srcOf(px, lod);
  vec3 c = textureLod(uVid, src, lod).rgb;
  vec4 mk = texture(uMask, src);
  float m = mk.r, L = luma(c);
  vec3 v;
  if (uLook == 0) v = c * m;
  else if (uLook == 1) v = c * smoothstep(0.38, 0.85, L) * m;
  else {
    float fast = texelFetch(uMot, ivec2(px), 0).r * uNorm;
    float e = smoothstep(1.2, 5., fast) * mix(1., m, 0.85);
    v = min(c * 1.35 + 0.08, 1.) * e;
  }
  float l = luma(v);
  v = mix(vec3(l), v, uSat);
  l = luma(v);
  float kf = l > 0. ? max(l - uFloor, 0.) / (1. - uFloor) / l : 0.;
  v *= kf;
  v = pow(clamp(v, 0., 1.), vec3(uContrast));
  vec3 lin = pow(v, vec3(2.2)) * uIntensity;
  v = pow(lin, vec3(1. / 2.2));
  o = vec4(floor(v * 255. + 0.5) / 255., 1.);
}`;
// the light each part of the wall gives off (linear), with nothing between and around the screens, so blurring it (its mips)
// spills light past a screen's edge without one screen bleeding into the next
const FS_GLOWSRC = HEAD + `
uniform sampler2D uPanel; uniform float uLevels;
void main() {
  vec2 w = gl_FragCoord.xy * 2. - ${GPAD}.;
  float slot = ${SW + GAP}.;
  int k = int(floor(w.x / slot));
  float lx = w.x - float(k) * slot;
  if (k < 0 || k > 3 || lx < 0. || lx >= ${SW}. || w.y < 0. || w.y >= ${SH}.) { o = vec4(0., 0., 0., 1.); return; }
  vec2 uv = vec2((float(k) * ${SW}. + lx) / ${PW}., w.y / ${PH}.);
  vec3 lin = pow(textureLod(uPanel, uv, 0.).rgb, vec3(2.2));
  o = vec4(floor(lin * uLevels + 0.5) / uLevels, 1.);
}`;
const FS_LED = HEAD + `
uniform sampler2D uPanel, uGlow; uniform vec3 uView; uniform float uLevels, uGlowAmt;
void main() {
  vec2 w = uView.xy + gl_FragCoord.xy * uView.z;     // wall coordinates, in LED pitches, y up
  float pitchPx = uView.z;                           // LED pitches per device pixel
  float slot = ${SW + GAP}.;
  int k = int(floor(w.x / slot));
  float lx = w.x - float(k) * slot;
  bool on = k >= 0 && k < 4 && lx >= 0. && lx < ${SW}. && w.y >= 0. && w.y < ${SH}.;
  vec3 col = vec3(0.);
  if (on) {
    vec2 id = floor(vec2(lx, w.y));
    vec2 f = fract(vec2(lx, w.y)) - 0.5;
    vec3 sig = texelFetch(uPanel, ivec2(k * ${SW} + int(id.x), int(id.y)), 0).rgb;
    vec3 lin = floor(pow(sig, vec3(2.2)) * uLevels + 0.5) / uLevels;
    float aa = max(pitchPx * 0.8, 0.002);
    float dE = length(max(abs(f) - vec2(0.13), 0.)) - 0.13;          // the emitter: a rounded square, about 0.5 of the pitch
    float dB = length(max(abs(f) - vec2(0.3), 0.)) - 0.1;            // its black package
    float cov = 1. - smoothstep(-aa, aa, dE);
    float body = 1. - smoothstep(-aa, aa, dB);
    float far = clamp((pitchPx - 0.3) / 0.5, 0., 1.);                // LEDs smaller than a pixel: average them
    vec3 near = lin * cov * 1.9 + vec3(0.0006) * body;               // an off LED's package: just visible up close
    col = mix(near, lin * 0.92, far);                                // from a distance, off is black
  }
  // glow: light scattered by the eye or a camera, so it spills past the screen's edge. Only bright water scatters enough to
  // see; dim water adds nothing, so the blacks stay black.
  if (uGlowAmt > 0.) {
    vec2 g = (w + ${GPAD}.) / vec2(${WALL_W + 2 * GPAD}., ${SH + 2 * GPAD}.);
    vec3 gw = textureLod(uGlow, g, 1.5).rgb * 0.45 + textureLod(uGlow, g, 3.).rgb * 0.4 + textureLod(uGlow, g, 4.5).rgb * 0.3;
    col += max(gw - 0.03, 0.) * 1.5 * uGlowAmt * smoothstep(0.12, 0.5, pitchPx);   // bloom is a far-away effect, not fog between LEDs
  }
  col = min(col, vec3(1.));
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  o = vec4(pow(col, vec3(1. / 2.2)) + n / 255., 1.);
}`;

function compile(fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
const P = { mot: compile(FS_MOT), ana: compile(FS_ANA), blurH: compile(FS_BLUR_H), mask: compile(FS_MASK), panel: compile(FS_PANEL), glowSrc: compile(FS_GLOWSRC), led: compile(FS_LED) };

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

function tex(w, h, { float = false, mip = false, filter = gl.LINEAR } = {}) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function target(w, h, opts) {
  const t = tex(w, h, opts), f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { t, f, w, h };
}
const vid = [tex(2, 2, { mip: true }), tex(2, 2, { mip: true })];
let vi = 0;
const mot = [target(PW, PH, { float: floatOK, filter: gl.NEAREST }), target(PW, PH, { float: floatOK, filter: gl.NEAREST })];
let mi = 0;
const ana = [target(AW, AH, { float: floatOK }), target(AW, AH, { float: floatOK })];
const blurT = target(AW, AH, { float: floatOK });
const maskT = target(AW, AH);
const panelT = target(PW, PH, { filter: gl.NEAREST });
const glowT = target(GW, GH, { mip: true });
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

function run(prog, out, uniforms, textures) {
  gl.useProgram(prog.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.f : null);
  gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
  textures.forEach(([name, t], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.u[name], i); });
  for (const [name, v] of Object.entries(uniforms)) {
    const loc = prog.u[name]; if (loc == null) continue;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.int != null) gl.uniform1i(loc, v.int);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else gl.uniform4fv(loc, v);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ---- the footage ----------------------------------------------------------------------------------------------------
const video = $('#video');
let vidW = 1920, vidH = 1080, newFrame = false, first = true, frames = 0, startedAt = 0;
function watchFrames() {
  if (video.requestVideoFrameCallback) { const f = () => { newFrame = true; video.requestVideoFrameCallback(f); }; video.requestVideoFrameCallback(f); }
  else { let last = -1; setInterval(() => { if (video.currentTime !== last) { last = video.currentTime; newFrame = true; } }, 1000 / 60); }
}
watchFrames();
video.addEventListener('loadedmetadata', () => { vidW = video.videoWidth; vidH = video.videoHeight; first = true; frames = 0; startedAt = performance.now(); placed = false; });
video.addEventListener('error', () => banner("Couldn't load the river footage. Reload, or choose a clip of your own below."));
$('#clipName').textContent = 'river-cascade.mp4 · river cam, 27 Oct 14:51, 22 s loop';
function play() { video.play().then(() => { $('#play').textContent = 'Pause'; }, () => { $('#play').textContent = 'Play'; banner('Tap Play to start the footage.'); }); }
play();
$('#play').onclick = () => { if (video.paused) { banner(''); play(); } else { video.pause(); $('#play').textContent = 'Play'; } };
$('#file').onchange = (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  video.src = URL.createObjectURL(f); $('#clipName').textContent = f.name; play();
};

// ---- windows into the footage -----------------------------------------------------------------------------------------
// four: each screen's window, centre in normalised footage coordinates; span: one window across the wall, gaps included
const cur = { centers: S.centers.map((c) => [...c]), span: [...S.spanCenter] };
let placed = false;
function sizes() {
  const z = S.zoom, ar = vidW / vidH;
  if (S.frame === 'four') { const h = 1 / z, w = h * (SW / SH) / ar; return { w, h }; }
  let w = 1 / z, h = w * ar * (SH / WALL_W);
  if (h > 1) { w /= h; h = 1; }
  return { w, h };
}
const clampC = (c, w, h) => [Math.min(1 - w / 2, Math.max(w / 2, c[0])), Math.min(1 - h / 2, Math.max(h / 2, c[1]))];
function rects() {
  const { w, h } = sizes(), out = [];
  if (S.frame === 'four') for (let k = 0; k < 4; k++) { const c = clampC(cur.centers[k], w, h); out.push([c[0] - w / 2, c[1] - h / 2, w, h]); }
  else {
    const c = clampC(cur.span, w, h), x0 = c[0] - w / 2, y0 = c[1] - h / 2;
    for (let k = 0; k < 4; k++) out.push([x0 + (k * (SW + GAP) / WALL_W) * w, y0, (SW / WALL_W) * w, h]);
  }
  return out;
}

// ---- reading the mask back (8 times a second): the source view, auto placement, the meters ----------------------------------
const maskPx = new Uint8Array(AW * AH * 4);
let norm = 40, waterFrac = 0;
function readMask() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, maskT.f);
  gl.readPixels(0, 0, AW, AH, gl.RGBA, gl.UNSIGNED_BYTE, maskPx);
  // the slow motion's 95th percentile sets the scale: the scene decides what "a lot of motion" means
  const hist = new Uint32Array(256); let wet = 0;
  for (let i = 0; i < AW * AH; i++) { hist[maskPx[i * 4 + 2]]++; if (maskPx[i * 4] > 127) wet++; }
  let acc = 0, p95 = 255; const want = AW * AH * 0.9;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) { p95 = v; break; } }   // (the 90th, in fact: see want)
  const want95 = 4 / Math.max(p95 / 255, 0.01);
  norm += (want95 - norm) * 0.25;
  waterFrac = wet / (AW * AH);
}
function autoPlace() {
  // integral image of "water, weighted by what is moving now"; the best window, blank it out, again
  const sc = new Float32Array(AW * AH);
  for (let i = 0; i < AW * AH; i++) sc[i] = (maskPx[i * 4] / 255) * (0.4 + maskPx[i * 4 + 1] / 255);
  const best = (w, h) => {
    const I = new Float64Array((AW + 1) * (AH + 1));
    for (let y = 0; y < AH; y++) { let row = 0; for (let x = 0; x < AW; x++) { row += sc[y * AW + x]; I[(y + 1) * (AW + 1) + x + 1] = I[y * (AW + 1) + x + 1] + row; } }
    const W = Math.max(1, Math.round(w * AW)), H = Math.max(1, Math.round(h * AH));
    let bs = -1, bx = 0, by = 0;
    for (let y = 0; y + H <= AH; y += 2) for (let x = 0; x + W <= AW; x += 2) {
      const s = I[(y + H) * (AW + 1) + x + W] - I[y * (AW + 1) + x + W] - I[(y + H) * (AW + 1) + x] + I[y * (AW + 1) + x];
      if (s > bs) { bs = s; bx = x; by = y; }
    }
    return { x: bx, y: by, W, H, c: [(bx + W / 2) / AW, (by + H / 2) / AH] };
  };
  const { w, h } = sizes();
  if (S.frame === 'span') { S.spanCenter = best(w, h).c; }
  else {
    const found = [];
    for (let k = 0; k < 4; k++) {
      const b = best(w, h); found.push(b.c);
      // blank the window and a margin around it, so the next screen shows somewhere else
      const mx = Math.round(b.W * 0.35), my = Math.round(b.H * 0.35);
      for (let y = Math.max(0, b.y - my); y < Math.min(AH, b.y + b.H + my); y++) for (let x = Math.max(0, b.x - mx); x < Math.min(AW, b.x + b.W + mx); x++) sc[y * AW + x] = 0;
    }
    S.centers = found.sort((a, b) => a[0] - b[0]);
  }
  save();
}

const panelPx = new Uint8Array(PW * PH * 4);
const lin8 = new Float32Array(256).map((_, i) => (i / 255) ** 2.2);
function meters() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, panelT.f);
  gl.readPixels(0, 0, PW, PH, gl.RGBA, gl.UNSIGNED_BYTE, panelPx);
  let lit = 0, light = 0;
  for (let i = 0; i < PW * PH; i++) {
    const r = panelPx[i * 4], g = panelPx[i * 4 + 1], b = panelPx[i * 4 + 2];
    if (r | g | b) lit++;
    light += lin8[r] + lin8[g] + lin8[b];
  }
  $('#mLit').textContent = `${(100 * lit / (PW * PH)).toFixed(0)} %`;
  $('#mLight').textContent = `${(100 * light / (3 * PW * PH)).toFixed(1)} %`;
  $('#mWater').textContent = `${(100 * waterFrac).toFixed(0)} % of the frame`;
}

/** The centre (wall coordinates) of the brightest 32 × 32 LEDs, from the last panel readback; null before one. */
function brightest() {
  if (!panelPx.some((v, i) => i % 4 !== 3 && v)) return null;
  let best = -1, at = null;
  for (let k = 0; k < 4; k++) for (let y = 0; y + 32 <= PH; y += 8) for (let x = 0; x + 32 <= SW; x += 8) {
    let s = 0;
    for (let yy = y; yy < y + 32; yy += 2) for (let xx = x; xx < x + 32; xx += 2) { const i = (yy * PW + k * SW + xx) * 4; s += lin8[panelPx[i]] + lin8[panelPx[i + 1]] + lin8[panelPx[i + 2]]; }
    if (s > best) { best = s; at = [k * (SW + GAP) + x + 16, y + 16]; }
  }
  return at;
}
// ---- the view of the wall ---------------------------------------------------------------------------------------------
const stage = $('#stage');
const view = { cx: WALL_W / 2, cy: SH / 2, span: WALL_W + 36 };   // centre and visible width, in LED pitches
function setView(v, k = null) {
  S.view = v; save();
  stage.classList.toggle('zoomed', v !== 'wall');
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  const kk = k ?? 1, sx = kk * (SW + GAP) + SW / 2;
  if (v === 'wall') Object.assign(view, { cx: WALL_W / 2, cy: SH / 2, span: WALL_W + 36 });
  else if (v === 'one') Object.assign(view, { cx: sx, cy: SH / 2, span: (SH + 24) * 4 / 3 });
  else { const b = brightest(); Object.assign(view, { cx: b ? b[0] : sx, cy: b ? b[1] : SH * 0.55, span: 40 }); }
  $('#stageNote').textContent = v === 'leds' ? 'About 40 LEDs across: each one an emitter on a black board. Drag to look around; scroll or pinch to zoom.'
    : 'Each screen is 128 × 256 LEDs (four 128 × 64 panels, hung portrait). Drag to pan, scroll or pinch to zoom.';
}
document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
function sizeCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}
// drag to pan, wheel / pinch to zoom
const pts = new Map();
let pinch0 = null;
stage.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); });
stage.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId)) return;
  const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
  const per = view.span / stage.clientWidth;
  if (pts.size === 1) { view.cx -= (e.clientX - prev[0]) * per; view.cy += (e.clientY - prev[1]) * per; }
  else if (pts.size === 2) {
    const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch0) zoomBy(pinch0 / d);
    pinch0 = d;
  }
});
const up = (e) => { pts.delete(e.pointerId); pinch0 = null; };
stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
function zoomBy(f) { view.span = Math.min(WALL_W * 1.6, Math.max(12, view.span * f)); }
$('#full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.().catch(() => {}); };
if (!stage.requestFullscreen) $('#full').hidden = true;

// ---- the source view ------------------------------------------------------------------------------------------------
const src = $('#src'), sctx = src.getContext('2d');
const mcan = document.createElement('canvas'); mcan.width = AW; mcan.height = AH;
const mctx = mcan.getContext('2d'), mimg = mctx.createImageData(AW, AH);
const cut = document.createElement('canvas'), cctx = cut.getContext('2d');
function drawSource() {
  sizeCanvas(src);
  const W = src.width, H = src.height;
  for (let i = 0; i < AW * AH; i++) {
    const m = maskPx[i * 4];
    mimg.data[i * 4] = 70; mimg.data[i * 4 + 1] = 220; mimg.data[i * 4 + 2] = 255; mimg.data[i * 4 + 3] = m;
  }
  mctx.putImageData(mimg, 0, 0);
  sctx.imageSmoothingEnabled = true;
  if (S.src === 'cut') {
    if (cut.width !== W || cut.height !== H) { cut.width = W; cut.height = H; }
    cctx.globalCompositeOperation = 'source-over'; cctx.clearRect(0, 0, W, H);
    cctx.drawImage(mcan, 0, 0, W, H);
    cctx.globalCompositeOperation = 'source-in'; cctx.drawImage(video, 0, 0, W, H);
    sctx.fillStyle = '#000'; sctx.fillRect(0, 0, W, H); sctx.drawImage(cut, 0, 0);
  } else {
    sctx.drawImage(video, 0, 0, W, H);
    if (S.src === 'mask') { sctx.fillStyle = 'rgba(0,0,0,.55)'; sctx.fillRect(0, 0, W, H); sctx.globalAlpha = 0.75; sctx.drawImage(mcan, 0, 0, W, H); sctx.globalAlpha = 1; }
  }
  // the windows
  const dpr = W / src.clientWidth;
  sctx.lineWidth = 2 * dpr; sctx.font = `700 ${13 * dpr}px system-ui, sans-serif`;
  const rs = rects();
  if (S.frame === 'span') {
    const a = rs[0], b = rs[3];
    sctx.strokeStyle = 'rgba(255,255,255,.35)'; sctx.setLineDash([6 * dpr, 5 * dpr]);
    sctx.strokeRect(a[0] * W, a[1] * H, (b[0] + b[2] - a[0]) * W, a[3] * H); sctx.setLineDash([]);
  }
  rs.forEach((r, k) => {
    sctx.strokeStyle = '#ffd25e'; sctx.strokeRect(r[0] * W, r[1] * H, r[2] * W, r[3] * H);
    sctx.fillStyle = '#ffd25e'; sctx.fillText(String(k + 1), r[0] * W + 5 * dpr, r[1] * H + 16 * dpr);
  });
}
// drag a window
let dragK = null, dragOff = null;
const at = (e) => { const b = src.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]; };
src.addEventListener('pointerdown', (e) => {
  const [x, y] = at(e), rs = rects();
  for (let k = rs.length - 1; k >= 0; k--) {
    const r = rs[k];
    if (x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]) {
      dragK = S.frame === 'span' ? 0 : k;
      const c = S.frame === 'span' ? cur.span : cur.centers[k];
      dragOff = [c[0] - x, c[1] - y]; src.setPointerCapture(e.pointerId);
      S.follow = false; $('#follow').checked = false;
      return;
    }
  }
});
src.addEventListener('pointermove', (e) => {
  if (dragK == null) return;
  const [x, y] = at(e), { w, h } = sizes(), c = clampC([x + dragOff[0], y + dragOff[1]], w, h);
  if (S.frame === 'span') { S.spanCenter = c; cur.span = [...c]; } else { S.centers[dragK] = c; cur.centers[dragK] = [...c]; }
});
const drop = () => { if (dragK != null) save(); dragK = null; };
src.addEventListener('pointerup', drop); src.addEventListener('pointercancel', drop);

// ---- controls -------------------------------------------------------------------------------------------------------------
const fmt = { intensity: (v) => v.toFixed(2), zoom: (v) => `${v.toFixed(1)}×`, sens: (v) => v.toFixed(2), soft: (v) => v.toFixed(2),
              floor: (v) => v.toFixed(2), contrast: (v) => v.toFixed(2), sat: (v) => v.toFixed(2), trail: (v) => v.toFixed(2),
              glow: (v) => v.toFixed(2), bits: (v) => `${v} bit (${2 ** v} steps)` };
for (const k of Object.keys(fmt)) {
  const inp = $(`#${k}`), out = $(`#${k}Out`);
  const show = () => { out.textContent = fmt[k](S[k]); };
  inp.value = S[k]; show();
  inp.oninput = () => { S[k] = Number(inp.value); show(); save(); };
}
function segs() {
  for (const [sel, key] of [['#lookSeg', 'look'], ['#frameSeg', 'frame'], ['#srcSeg', 'src']])
    document.querySelectorAll(`${sel} button`).forEach((b) => b.setAttribute('aria-pressed', String(Object.values(b.dataset)[0] === S[key])));
  $('#lookHint').textContent = LOOK_HINT[S.look];
}
for (const [sel, key] of [['#lookSeg', 'look'], ['#frameSeg', 'frame'], ['#srcSeg', 'src']])
  document.querySelectorAll(`${sel} button`).forEach((b) => { b.onclick = () => { S[key] = Object.values(b.dataset)[0]; segs(); save(); if (key === 'frame') autoPlace(); }; });
segs();
$('#follow').checked = S.follow;
$('#follow').onchange = (e) => { S.follow = e.target.checked; save(); };
$('#auto').onclick = () => autoPlace();
$('#reset').onclick = () => { Object.assign(S, structuredClone(DEFAULTS)); save(); location.reload(); };
$('#copy').onclick = async () => {
  const { centers, spanCenter, view: _v, src: _s, follow: _f, ...rest } = S;
  const text = JSON.stringify({ ...rest, windows: rects().map((r) => r.map((n) => +n.toFixed(4))), windows_are: 'x, y, w, h of the footage, 0-1 from top left; screens 1-4 left to right' }, null, 2);
  try { await navigator.clipboard.writeText(text); $('#copy').textContent = 'Copied'; } catch { prompt('Settings', text); }
  setTimeout(() => { $('#copy').textContent = 'Copy settings'; }, 1500);
};
setView(S.view);

// ---- the frame loop -------------------------------------------------------------------------------------------------------
let ping = 0, lastRead = 0, lastMeters = 0, lastFollow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (video.readyState >= 2 && newFrame) {
    newFrame = false;
    vi = 1 - vi;
    gl.bindTexture(gl.TEXTURE_2D, vid[vi]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.generateMipmap(gl.TEXTURE_2D);
    const aSlow = floatOK ? 0.02 : 0.06, aFast = 0.7 - 0.62 * S.trail;
    run(P.ana, ana[1 - ping], { aSlow, aFast, uFirst: first ? 1 : 0 }, [['uVid', vid[vi]], ['uPrev', ana[ping].t]]);
    run(P.mot, mot[1 - mi], { uRect: rects().flat(), uVidPx: [vidW, vidH], aFast, uFirst: first ? 1 : 0 },
        [['uVid', vid[vi]], ['uPrevVid', vid[1 - vi]], ['uPrevE', mot[mi].t]]);
    ping = 1 - ping; mi = 1 - mi; first = false; frames++;
  }
  if (frames === 0) return;
  const thr = 0.05 + S.sens * 0.9, soft = 0.05 + S.soft * 0.8;
  run(P.blurH, blurT, { uStep: [1.6 / AW, 0] }, [['uIn', ana[ping].t]]);
  run(P.mask, maskT, { uStep: [0, 1.6 / AH], uNorm: norm, uThr: thr, uSoft: soft }, [['uIn', blurT.t]]);
  if (now - lastRead > 125) { lastRead = now; readMask(); drawSource(); }
  // place the windows once the motion map has settled (3 s), then again whenever following
  if (!placed && performance.now() - startedAt > 3000 && frames > 30) { placed = true; autoPlace(); }
  if (S.follow && now - lastFollow > 4000) { lastFollow = now; autoPlace(); }
  for (let k = 0; k < 4; k++) for (let i = 0; i < 2; i++) cur.centers[k][i] += (S.centers[k][i] - cur.centers[k][i]) * 0.06;
  for (let i = 0; i < 2; i++) cur.span[i] += (S.spanCenter[i] - cur.span[i]) * 0.06;
  const r = rects();
  run(P.panel, panelT, { 'uRect': r.flat(), uVidPx: [vidW, vidH], uLook: { int: ['water', 'foam', 'motion'].indexOf(S.look) },
                         uFloor: S.floor, uContrast: S.contrast, uSat: S.sat, uIntensity: S.intensity, uNorm: norm },
      [['uVid', vid[vi]], ['uMask', maskT.t], ['uMot', mot[mi].t]]);
  const levels = 2 ** S.bits - 1;
  run(P.glowSrc, glowT, { uLevels: levels }, [['uPanel', panelT.t]]);
  gl.bindTexture(gl.TEXTURE_2D, glowT.t); gl.generateMipmap(gl.TEXTURE_2D);
  sizeCanvas(canvas);
  const scale = view.span / canvas.width;
  run(P.led, null, { uView: [view.cx - (canvas.width / 2) * scale, view.cy - (canvas.height / 2) * scale, scale], uLevels: levels, uGlowAmt: S.glow },
      [['uPanel', panelT.t], ['uGlow', glowT.t]]);
  if (now - lastMeters > 500) { lastMeters = now; meters(); }
}
requestAnimationFrame(frame);
