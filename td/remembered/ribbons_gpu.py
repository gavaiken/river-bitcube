"""The silk ribbons drawn on the GPU (28 Oct, Gavin: "we should be using a GPU shader for this... we want it to look good").

ribbons.py keeps the ribbons' state (time, flow, level, turbulence) and still lights the ropes on the CPU; the four screens
are drawn per LED by GLSL TOPs in TouchDesigner (built by td/build/build_remembered.py):

  ribbon_params  (Script TOP, PW x PH RGBA float) <- params(): everything the shader needs, written every frame
  ribbons_draw   (GLSL TOP, 512 x 256, DRAW_GLSL)  each LED: where it is in the room (its screen's centre, tilt, size), and
                 for each ribbon whether the sheet passes there (the spine at that height, the twist, the width: the same
                 formulas as ribbons.Ribbons._spine). Inside the sheet: a faint sheen and glitter from a hash of the sheet's own
                 coordinates (so the sparkles stream down the sheet), both denser where the sheet turns edge-on (1/|cos twist|,
                 the bright folds), brighter on the rims; loose glitter drifting in screen space
  ribbons_glow   (Blur TOP) the soft halo
  ribbons_trail  (GLSL TOP, TRAIL_GLSL) max(last frame x TRAIL, draw x 0.5 + glow x 1.5), true black under 0.015; its own
                 Feedback TOP (ribbons_fb) brings the last frame back
  ribbons_out    (GLSL TOP, OUT_GLSL) the trace coloured (the palette's light, the brightest to white) x gain, plus the
                 river video under it (panel_render, already faded by the looks mixer)
  screens_src    (Switch TOP) ribbons_out while the GPU path is healthy, else panel_render (the numpy ribbons): show.py checks
                 the GLSL TOPs' errors every few seconds and falls back on its own

reference() is the same drawing in numpy (tests and offline renders), so a change to the shader can be checked off the
piece. Keep the two in step.
"""
import math

import numpy as np

QW, QH, NQ = 128, 256, 4
N_RIB = 4
PW, PH = 6, 1 + N_RIB + NQ          # params texture: row 0 globals, then one row per ribbon, then one per screen
WRAP = 4096.0                       # the glitter's streaming offset wraps here (float32 precision on the GPU)
CELLS = 3.2                         # glitter cells per field px along the sheet (about one per 1.7 LEDs)
SPARKLE = 0.42                      # share of the sheet's cells that hold a sparkle
SHEEN = 0.05                        # the translucent sheet itself, before the fold boost
FOLD_MAX = 5.0
WIDTH = 1.35                        # the GPU sheets a little wider than the numpy ones (Gavin, 28 Oct: more LEDs on)
GAIN = 1.15                         # and brighter
FOOTAGE_FLOW_DEG = 25.0             # which way the river runs in the river cam's picture: down and 25 deg toward the right
                                    # (measured 28 Oct on river-cascade.mp4, Lucas-Kanade over the moving water); the screens'
                                    # windows turn so that this runs along the ropes' "down" by each screen
VIDEO_SCREEN_M = 0.64               # a window's height in the footage covers the screen's height
DUST = 0.035                        # share of screen LEDs holding loose glitter


def params(rib, pal, gain=1.0, video=None):
    """ribbons.Ribbons -> the PH x PW x 4 float32 array the shaders read (texelFetch(x = column, y = row)).
    pal: {'deep', 'mid', 'light'} rgb 0..1 (the show's palette). video: None (no river under the ribbons) or
    {'windows': [(x, y, w, h)] 0..1 from the top left, 'gain': 0..1, 'floor', 'contrast', 'sat'} (water.py's grade)."""
    p = np.zeros((PH, PW, 4), np.float32)
    t, tb = rib.t, 0.6 + 0.8 * rib.turb
    shown = rib._shown()
    p[0, 0] = (t % 628.3185, rib.level, rib.turb, (0.9 + 0.5 * rib.level) * GAIN)    # time (wrapped), level, turb, brightness
    p[0, 1] = (*[float(c) for c in pal['light']], float(gain))
    p[0, 2] = (rib.sw, (8 + 40 * rib.level) * t % WRAP, 0.2 + 0.35 * rib.level, 0)  # screen width, dust drift, dust gain
    p[0, 3] = (*[float(c) for c in pal['deep']], float(video['gain']) if video else 0.0)
    p[0, 4] = (*[float(c) for c in pal['mid']], 0)
    g = math.radians(FOOTAGE_FLOW_DEG)
    if video:
        p[0, 5] = (video.get('floor', 0.12), video.get('contrast', 1.4), video.get('sat', 0.85), g)
    for i, R in enumerate(rib.rib[:N_RIB]):
        ph = R['ph']
        a = (0.23 * t * tb + ph[0], -0.37 * t * tb + ph[1], 0.5 * t * tb + ph[2], 0.19 * t + ph[3], 0.3 * t + ph[4])
        a = [x % (2 * math.pi) for x in a]                       # time folded into phases in float64: no drift on the GPU
        p[1 + i, 0] = (R['home'], R['kx'], R['kt'] * tb, R['w'] * (0.6 + 0.6 * rib.level) * WIDTH)
        p[1 + i, 1] = a[:4]
        p[1 + i, 2] = (a[4], (rib.flow * R['spd']) % WRAP, shown[i], i % 2)
    for k, (cx, cy, ang, w, h) in enumerate(rib.screens[:NQ]):
        fx, fy = rib.down[k] if k < len(rib.down) else (0.0, -1.0)
        phi = math.atan2(fx, -fy)                                 # the ropes' down here, from straight down (+ toward +x)
        # the ribbons' world turned by phi about the screen: they fall along the ropes beside it
        p[1 + N_RIB + k, 0] = (cx, cy, math.cos(ang - phi), math.sin(ang - phi))
        p[1 + N_RIB + k, 1] = (w, h, math.cos(ang), math.sin(ang))
        if video and k < len(video['windows']):
            x, y, ww, hh = video['windows'][k]
            p[1 + N_RIB + k, 2] = (x + ww / 2, y + hh / 2, hh, 1)
        p[1 + N_RIB + k, 3] = (fx, fy, 0, 0)
    return p


# ---- the shaders (GLSL 3.30, TouchDesigner pixel shaders) -----------------------------------------------------------------

_COMMON = """
uint hsh(uvec3 v) {                       // pcg3d, first lane
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v.x;
}
float h01(uvec3 v) { return float(hsh(v) >> 8u) / 16777216.0; }
"""

DRAW_GLSL = """// ribbons_draw (generated from td/remembered/ribbons_gpu.py): the silk ribbons, one LED at a time
out vec4 fragColor;
""" + _COMMON + """
vec4 P(int x, int y) {
#if TD_NUM_2D_INPUTS > 0
    return texelFetch(sTD2DInputs[0], ivec2(x, y), 0);
#else
    return vec4(0.0);
#endif
}
void main() {
    vec2 px = vUV.st * uTDOutputInfo.res.zw;                       // LED (x 0..512, y 0..256 from the bottom)
    int k = clamp(int(px.x / 128.0), 0, 3);
    vec4 g0 = P(0, 0), g2 = P(2, 0);
    vec4 s0 = P(0, 5 + k), s1 = P(1, 5 + k);
    float lx = ((px.x - 128.0 * float(k)) / 128.0 - 0.5) * s1.x;
    float ly = (px.y / 256.0 - 0.5) * s1.y;
    float X = s0.x + lx * s0.z - ly * s0.w;                        // where this LED is in the room (frame px, real height)
    float Y = s0.y + lx * s0.w + ly * s0.z;
    float t = g0.x, lvl = g0.y, bright = g0.w, sw = g2.x;
    float acc = 0.0, accg = 0.0;
    for (int i = 0; i < 4; i++) {
        vec4 r0 = P(0, 1 + i), r1 = P(1, 1 + i), r2 = P(2, 1 + i);
        if (r2.z < 0.01) continue;
        float kx = r0.y;
        // the sheet is lifted by v W sin(twist) x 0.45 (seen a little from above: its curls); find the height y on the sheet
        // under this LED by two fixed-point steps from y = Y
        float y = Y, xs = 0.0, tw = 0.0, W = 1.0, c = 1.0, v = 9.0;
        for (int it = 0; it < 3; it++) {
            xs = r0.x + sw * (0.8 * sin(kx * y + r1.x) + 0.35 * sin(2.3 * kx * y + r1.y));
            tw = r0.z * y + r1.z + 1.3 * sin(0.8 * kx * y + r1.w);
            W = r0.w * (1.0 + 0.35 * sin(1.7 * kx * y + r2.x));
            c = cos(tw);
            v = abs(W * c) < 1e-4 ? 9.0 : (X - xs) / (W * c);
            if (it < 2) y = Y - 0.45 * clamp(v, -1.2, 1.2) * W * sin(tw);
        }
        if (abs(v) > 1.0) continue;
        float fold = min(1.0 / max(abs(c), 1e-3), """ + f"{FOLD_MAX:.1f}" + """);
        float edge = abs(v) > 0.93 ? 2.2 : 1.0;
        float u = y + r2.y;                                         // the sheet's own coordinate, streaming down
        uvec3 cell = uvec3(uint(int(floor(u * """ + f"{CELLS:.2f}" + """)) + 100000), uint(int(floor((v + 1.0) * W * """ + f"{CELLS:.2f}" + """))), uint(i) + 7u);
        float h = h01(cell);
        float sp = 0.0;
        if (h < """ + f"{SPARKLE:.3f}" + """ * min(fold, 2.5)) {
            float b = 0.2 + 2.5 * pow(h01(cell + uvec3(0u, 0u, 101u)), 3.0);
            float rate = 1.5 + 5.5 * h01(cell + uvec3(0u, 0u, 202u));
            float twk = 0.55 + 0.45 * sin(rate * t + 6.2832 * h01(cell + uvec3(0u, 0u, 303u)));
            sp = b * twk;
        }
        float add = (sp * sqrt(fold) + """ + f"{SHEEN:.3f}" + """ * fold) * edge * (0.55 + 0.45 * abs(sin(tw))) * r2.z * bright * 0.7;
        acc += add;
        accg += add * r2.w;                                         // the green-leaning ribbons (every other one)
    }
    // loose glitter drifting down the screen
    uvec3 dc = uvec3(uint(px.x), uint(int(floor(px.y + g2.y)) + 100000), 31u);
    float dh = h01(dc);
    if (dh < """ + f"{DUST:.3f}" + """) {
        float db = 0.15 + 0.6 * pow(h01(dc + uvec3(0u, 0u, 7u)), 2.0);
        acc += db * (0.5 + 0.5 * sin(t * 5.0 + 40.0 * db)) * g2.z;
    }
    fragColor = TDOutputSwizzle(vec4(acc, accg, 0.0, 1.0));
}
"""

TRAIL = 0.55
TRAIL_GLSL = """// ribbons_trail (generated from td/remembered/ribbons_gpu.py): glow and a short shimmering trace, to true black
out vec4 fragColor;
void main() {
    vec2 d = vec2(0.0), g = vec2(0.0), f = vec2(0.0);
#if TD_NUM_2D_INPUTS > 2
    d = texture(sTD2DInputs[0], vUV.st).rg;
    g = texture(sTD2DInputs[1], vUV.st).rg;
    f = texture(sTD2DInputs[2], vUV.st).rg;
#endif
    vec2 v = max(f * """ + f"{TRAIL:.3f}" + """, d * 0.5 + g * 1.5);
    if (v.x < 0.015) v = vec2(0.0);
    fragColor = TDOutputSwizzle(vec4(v, 0.0, 1.0));
}
"""

OUT_GLSL = """// ribbons_out (generated from td/remembered/ribbons_gpu.py): the trace in the palette's blues and greens, the river
// video under it
out vec4 fragColor;
void main() {
    vec2 tr = vec2(0.0);
    vec3 video = vec3(0.0), light = vec3(0.46, 0.77, 0.83), mid = vec3(0.21, 0.40, 0.49);
    float gain = 0.0;
#if TD_NUM_2D_INPUTS > 2
    tr = texture(sTD2DInputs[0], vUV.st).rg;
    video = texture(sTD2DInputs[1], vUV.st).rgb;
    vec4 g1 = texelFetch(sTD2DInputs[2], ivec2(1, 0), 0);
    light = g1.rgb; gain = g1.a;
    mid = texelFetch(sTD2DInputs[2], ivec2(4, 0), 0).rgb;
#endif
    float v = min(tr.x, 1.6);
    float green = tr.x > 1e-4 ? clamp(tr.y / tr.x, 0.0, 1.0) : 0.0;
    // the palette's mid (blue-teal) for the faint glitter rising to its light (cyan) for the bright, white only at the top;
    // the green-leaning ribbons tip both toward green
    vec3 lo = max(mid * 1.7, vec3(0.0)), hi = light;
    vec3 gtint = vec3(0.55, 1.15, 0.75);
    lo = mix(lo, lo * gtint, green); hi = mix(hi, hi * gtint, green);
    vec3 c = mix(lo, hi, smoothstep(0.1, 0.9, v));
    vec3 rgb = clamp(v * c + clamp(v - 0.95, 0.0, 1.0) * (vec3(1.0) - hi) * 0.6, 0.0, 1.0) * gain;
    fragColor = TDOutputSwizzle(vec4(min(rgb + video, vec3(1.0)), 1.0));
}
"""

RIVER_GLSL = """// river_gpu (generated from td/remembered/ribbons_gpu.py): the river's moving water under the ribbons, each screen a
// window of the footage turned so the river runs along the ropes beside that screen (Gavin, 28 Oct), graded as water.py
// (the artists' simulator look). Inputs: 0 the footage, 1 the motion mask (water.py, 320 x 180), 2 ribbon_params.
out vec4 fragColor;
vec4 P(int x, int y) {
#if TD_NUM_2D_INPUTS > 2
    return texelFetch(sTD2DInputs[2], ivec2(x, y), 0);
#else
    return vec4(0.0);
#endif
}
void main() {
    vec3 col = vec3(0.0);
#if TD_NUM_2D_INPUTS > 2
    vec2 px = vUV.st * uTDOutputInfo.res.zw;
    int k = clamp(int(px.x / 128.0), 0, 3);
    vec4 s1 = P(1, 5 + k), s2 = P(2, 5 + k), s3 = P(3, 5 + k), g3 = P(3, 0), g5 = P(5, 0);
    if (s2.w > 0.5 && g3.a > 0.0) {
        // this LED's offset from the screen's centre in the room (metres), then in the ropes' frame: across, along
        float lx = ((px.x - 128.0 * float(k)) / 128.0 - 0.5) * 0.32;
        float ly = (px.y / 256.0 - 0.5) * 0.64;
        vec2 d = vec2(lx * s1.z - ly * s1.w, lx * s1.w + ly * s1.z);
        vec2 f = normalize(s3.xy), fr = vec2(-f.y, f.x);
        float a = dot(d, fr), b = dot(d, f);
        // the footage (y down, units of its height): the river's direction g and its right
        vec2 ts = vec2(textureSize(sTD2DInputs[0], 0));
        float aspect = ts.x / max(ts.y, 1.0);
        vec2 g = vec2(sin(g5.w), cos(g5.w)), gr = vec2(g.y, -g.x);
        float sc = s2.z / """ + f"{VIDEO_SCREEN_M:.2f}" + """;
        vec2 q = vec2(s2.x * aspect, s2.y) + sc * (a * gr + b * g);
        vec2 uv = vec2(q.x / aspect, 1.0 - q.y);
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
            vec3 c = texture(sTD2DInputs[0], uv).rgb;
            float m = texture(sTD2DInputs[1], uv).r;
            vec3 v = c * m;
            float lv = dot(v, vec3(0.2126, 0.7152, 0.0722));
            v = vec3(lv) + (v - vec3(lv)) * g5.z;
            float kf = max(lv - g5.x, 0.0) / ((1.0 - g5.x) * max(lv, 1e-6));
            v = pow(clamp(v * kf, 0.0, 1.0), vec3(g5.y));
            col = v * g3.a;
        }
    }
#endif
    fragColor = TDOutputSwizzle(vec4(col, 1.0));
}
"""


# ---- the same drawing in numpy (tests, offline renders) ---------------------------------------------------------------

def _hsh(x, y, z):
    v = [np.asarray(a, np.uint32).copy() for a in np.broadcast_arrays(x, y, z)]
    with np.errstate(over='ignore'):
        v = [a * np.uint32(1664525) + np.uint32(1013904223) for a in v]
        v[0] = v[0] + v[1] * v[2]; v[1] = v[1] + v[2] * v[0]; v[2] = v[2] + v[0] * v[1]
        v = [a ^ (a >> np.uint32(16)) for a in v]
        v[0] = v[0] + v[1] * v[2]; v[1] = v[1] + v[2] * v[0]; v[2] = v[2] + v[0] * v[1]
    return v[0]


def _h01(x, y, z):
    return (_hsh(x, y, z) >> np.uint32(8)).astype(np.float64) / 16777216.0


def draw(p):
    """ribbons_draw in numpy: params -> QH x (QW*4) x 2 (brightness, its green-leaning share), row 0 at the BOTTOM."""
    p = p.astype(np.float64)
    yy, xx = np.mgrid[0:QH, 0:QW * NQ] + 0.5
    k = np.clip((xx / 128).astype(int), 0, 3)
    s0, s1 = p[1 + N_RIB + k, 0], p[1 + N_RIB + k, 1]
    lx = ((xx - 128 * k) / 128 - 0.5) * s1[..., 0]
    ly = (yy / 256 - 0.5) * s1[..., 1]
    X = s0[..., 0] + lx * s0[..., 2] - ly * s0[..., 3]
    Y = s0[..., 1] + lx * s0[..., 3] + ly * s0[..., 2]
    t, lvl, _turb, bright = p[0, 0]
    sw = p[0, 2, 0]
    acc = np.zeros_like(X)
    accg = np.zeros_like(X)
    for i in range(N_RIB):
        r0, r1, r2 = p[1 + i, 0], p[1 + i, 1], p[1 + i, 2]
        if r2[2] < 0.01:
            continue
        kx = r0[1]
        y = Y
        for it in range(3):                                     # the lift, as the shader: two fixed-point steps
            xs = r0[0] + sw * (0.8 * np.sin(kx * y + r1[0]) + 0.35 * np.sin(2.3 * kx * y + r1[1]))
            tw = r0[2] * y + r1[2] + 1.3 * np.sin(0.8 * kx * y + r1[3])
            W = r0[3] * (1 + 0.35 * np.sin(1.7 * kx * y + r2[0]))
            c = np.cos(tw)
            wc = W * c
            with np.errstate(divide='ignore', invalid='ignore'):
                v = np.where(np.abs(wc) < 1e-4, 9.0, (X - xs) / wc)
            if it < 2:
                y = Y - 0.45 * np.clip(v, -1.2, 1.2) * W * np.sin(tw)
        ins = np.abs(v) <= 1
        fold = np.minimum(1 / np.maximum(np.abs(c), 1e-3), FOLD_MAX)
        edge = np.where(np.abs(v) > 0.93, 2.2, 1.0)
        u = y + r2[1]
        cu = (np.floor(u * CELLS).astype(np.int64) + 100000).astype(np.uint32)
        cv = np.floor(np.clip((v + 1) * W * CELLS, 0, 1e6)).astype(np.int64).astype(np.uint32)
        ci = np.uint32(i + 7)
        h = _h01(cu, cv, ci)
        b = 0.2 + 2.5 * _h01(cu, cv, ci + np.uint32(101)) ** 3
        rate = 1.5 + 5.5 * _h01(cu, cv, ci + np.uint32(202))
        twk = 0.55 + 0.45 * np.sin(rate * t + 6.2832 * _h01(cu, cv, ci + np.uint32(303)))
        sp = np.where(h < SPARKLE * np.minimum(fold, 2.5), b * twk, 0.0)
        val = (sp * np.sqrt(fold) + SHEEN * fold) * edge * (0.55 + 0.45 * np.abs(np.sin(tw))) * r2[2] * bright * 0.7
        acc += np.where(ins, val, 0.0)
        accg += np.where(ins, val, 0.0) * r2[3]
    dcx = xx.astype(np.uint32)
    dcy = (np.floor(yy + p[0, 2, 1]).astype(np.int64) + 100000).astype(np.uint32)
    dh = _h01(dcx, dcy, np.uint32(31))
    db = 0.15 + 0.6 * _h01(dcx, dcy, np.uint32(38)) ** 2
    acc += np.where(dh < DUST, db * (0.5 + 0.5 * np.sin(t * 5 + 40 * db)) * p[0, 2, 2], 0.0)
    return np.stack([acc, accg], -1).astype(np.float32)


def _blur(a, r=2):
    out = a
    for ax in (0, 1):
        pads = [(0, 0), (0, 0)]
        pads[ax] = (r, r)
        q = np.pad(out, pads)
        out = sum(np.take(q, range(o, o + a.shape[ax]), axis=ax) for o in range(2 * r + 1)) / (2 * r + 1)
    return out


class Reference:
    """The whole GPU chain in numpy: draw, glow, trail, colour. render(params, video=None) -> QH x 512 x 3, row 0 at the
    TOP (as ribbons.render_screens), for side-by-side checks."""

    def __init__(self):
        self.fb = np.zeros((QH, QW * NQ, 2), np.float32)

    def render(self, p, video=None):
        d = draw(p)
        g = np.stack([_blur(_blur(d[..., c], 1), 1) for c in range(2)], -1)
        v = np.maximum(self.fb * TRAIL, d * 0.5 + g * 1.5)
        v[v[..., 0] < 0.015] = 0
        self.fb = v
        light, gain, mid = p[0, 1, :3], p[0, 1, 3], p[0, 4, :3]
        x = np.minimum(v[..., 0], 1.6)[..., None]
        with np.errstate(divide='ignore', invalid='ignore'):
            green = np.where(v[..., 0] > 1e-4, np.clip(v[..., 1] / v[..., 0], 0, 1), 0)[..., None]
        gt = np.array([0.55, 1.15, 0.75])
        lo, hi = mid * 1.7, light
        lo = lo + (lo * gt - lo) * green
        hi = hi + (hi * gt - hi) * green
        s_ = np.clip((x - 0.1) / 0.8, 0, 1)
        c = lo + (hi - lo) * (s_ * s_ * (3 - 2 * s_))
        rgb = np.clip(x * c + np.clip(x - 0.95, 0, 1) * (1 - hi) * 0.6, 0, 1) * gain
        if video is not None:
            rgb = rgb + video[::-1]
        return np.minimum(rgb, 1)[::-1].astype(np.float32)
