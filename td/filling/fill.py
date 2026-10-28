"""The filling glass (river-filling.toe, round 2 milestone M1, 27 Oct night): every rope and every screen is one canvas,
painted by where each LED really is in the room (the calibration's frame, as the gallery camera sees the piece, the
screens at their measured tilts: td/remembered/particles.py Geometry). Water rises from the floor to the top like a
glass filling, turbulent, sloshing and crashing, blues and blacks, a river filling a pool; holds churning at the top;
then drains all the way out, leaving drips; and again. numpy only.

The water: a level that rises and falls through the cycle, a surface that sloshes (a standing wave across the column
plus travelling chop, wild while it fills, calmer at the top), a white-cyan crest where it crashes, spray above it,
and below it deep blue broken by black voids that churn (upward while filling, downward while draining).
"""
import json
import math
import sys
import time
import types
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from remembered.particles import Geometry, QW, QH, NQ, N_ROPES, N_PX  # noqa: E402

RIVER = Path(r'C:\Users\user\River')

# the cycle at speed 1, seconds (the dials' Speed scales it)
FILL_S, HOLD_S, DRAIN_S, EMPTY_S = 38.0, 10.0, 30.0, 6.0
CYCLE_S = FILL_S + HOLD_S + DRAIN_S + EMPTY_S
SCREEN_DOWN = 2                       # screens at half resolution (each value fills 2x2 LEDs): fine churn, a third of the cost
ROPE_GAIN = 0.9                       # the ropes are many LEDs: the whole column filled stays under the power limit
# palettes: deep (the depths), mid (the body), bright (lit water), foam (crest and spray)
PALETTES = {
    'river':    {'deep': (0.00, 0.06, 0.30), 'mid': (0.03, 0.36, 0.95), 'bright': (0.20, 0.60, 1.00), 'foam': (0.75, 0.95, 1.00)},
    'glacier':  {'deep': (0.02, 0.14, 0.26), 'mid': (0.30, 0.70, 0.90), 'bright': (0.70, 0.95, 1.00), 'foam': (0.95, 1.00, 1.00)},
    'midnight': {'deep': (0.02, 0.01, 0.18), 'mid': (0.12, 0.10, 0.70), 'bright': (0.35, 0.35, 1.00), 'foam': (0.70, 0.80, 1.00)},
    'teal':     {'deep': (0.00, 0.12, 0.14), 'mid': (0.00, 0.55, 0.60), 'bright': (0.20, 0.90, 0.85), 'foam': (0.80, 1.00, 0.95)},
}
DEFAULTS = {'palette': 'river', 'brightness': 0.8, 'intensity': 0.6, 'speed': 1.0}
MAX_SPRAY = 1500


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def level_at(t, y0, y1):
    """(water level in frame px with y up, how wild 0..1, phase, fullness 0..1), t seconds into the cycle."""
    t = t % CYCLE_S
    lo, hi = y0 - 40, y1 + 40                                            # from below the floor to above the ceiling
    if t < FILL_S:
        f = t / FILL_S
        lv = lo + (hi - lo) * (0.8 * ease(f) + 0.2 * f)
        return lv, 1.0, 'filling', f
    t -= FILL_S
    if t < HOLD_S:
        return hi, 0.65, 'full', 1.0
    t -= HOLD_S
    if t < DRAIN_S:
        f = t / DRAIN_S
        return hi - (hi - lo) * ease(f), 0.7, 'draining', 1 - f
    return lo, 0.0, 'empty', 0.0


def _hash(a):
    h = np.sin(a) * 43758.5453
    return h - np.floor(h)


class Fill:
    def __init__(self, geometry, seed=0):
        g = self.g = geometry
        self.rng = np.random.default_rng(seed + 11)
        self.t = 0.0                                   # cycle time (advances at the dials' speed)
        self.clock = 0.0                               # wall time since start (the churn's own motion)
        self.last = None
        self.settings = dict(DEFAULTS)
        rope = g.led_xy.reshape(-1, 2).copy()
        rope[~np.isfinite(rope).all(1)] = (-1e4, -1e4)
        sw, sh = QW // SCREEN_DOWN, QH // SCREEN_DOWN
        scr = []
        for (c, ang, w, h) in g.screens:
            px, py = np.meshgrid((np.arange(sw) + 0.5) / sw, (np.arange(sh) + 0.5) / sh)
            lx, ly = (px - 0.5) * w, (0.5 - py) * h                    # row 0 at the top of the upright screen
            ca, sa = math.cos(ang), math.sin(ang)
            scr.append(np.stack([c[0] + lx * ca - ly * sa, c[1] + lx * sa + ly * ca], -1).reshape(-1, 2))
        self.n_rope = len(rope)
        self.pts = np.concatenate([rope] + scr).astype(np.float32)
        self.x0, self.x1, self.y0, self.y1 = g.x0, g.x1, g.y0 + 10, g.y1 - 25
        self.seed = self.rng.uniform(0, 100, 12)
        self.sp = np.zeros((0, 2), np.float32)                         # spray droplets: position, velocity
        self.sv = np.zeros((0, 2), np.float32)
        self.state = ('empty', 0.0)
        keyp = np.floor(self.pts / 4.0).astype(np.int64)                  # points binned once, for the spray lookup
        kp = keyp[:, 0] * 100003 + keyp[:, 1]
        order = np.argsort(kp)
        self._bins = (4.0, order, kp[order])

    def set(self, settings):
        for k, v in (settings or {}).items():
            if k == 'palette' and v in PALETTES:
                self.settings['palette'] = v
            elif k in ('brightness', 'intensity') and isinstance(v, (int, float)):
                self.settings[k] = float(min(1.0, max(0.0, v)))
            elif k == 'speed' and isinstance(v, (int, float)):
                self.settings[k] = float(min(3.0, max(0.25, v)))

    def _spray(self, dt, surf_fn, lv, wild, inten):
        """Droplets flung up where the surface crashes, falling back under gravity."""
        rng = self.rng
        n = int(rng.poisson(dt * 900 * wild * (0.3 + inten))) if wild > 0 else 0
        if n and len(self.sp) < MAX_SPRAY:
            x = rng.uniform(self.x0, self.x1, n).astype(np.float32)
            y = surf_fn(x).astype(np.float32)
            vx = rng.normal(0, 40 + 60 * inten, n)
            vy = rng.uniform(60, 160 + 260 * inten, n)
            self.sp = np.concatenate([self.sp, np.stack([x, y], 1)])
            self.sv = np.concatenate([self.sv, np.stack([vx, vy], 1).astype(np.float32)])
        if len(self.sp):
            self.sv[:, 1] -= 420 * dt                                     # gravity, frame px/s^2
            self.sp += self.sv * dt
            keep = self.sp[:, 1] > surf_fn(self.sp[:, 0]) - 4
            self.sp, self.sv = self.sp[keep], self.sv[keep]

    def colours(self, t, clock=None, dt=1 / 30):
        clock = t if clock is None else clock
        st = self.settings
        pal = {k: np.array(v, np.float32) for k, v in PALETTES[st['palette']].items()}
        inten = st['intensity']
        x, y = self.pts[:, 0], self.pts[:, 1]
        W = self.x1 - self.x0
        lv, wild, phase, full = level_at(t, self.y0, self.y1)
        self.state = (phase, full)
        wild = wild * (0.4 + 1.0 * inten)
        s = self.seed
        tc = clock

        def surf_fn(xx):
            xn = (xx - self.x0) / W
            slosh = (math.sin(tc * 1.1 + s[0]) * np.cos(math.pi * xn) + 0.6 * math.sin(tc * 0.7 + s[8]) * np.cos(2 * math.pi * xn)) * (45 * wild + 6)
            chop = (np.sin(xn * 11.0 - tc * 3.4 + s[1]) * 10 + np.sin(xn * 29.0 + tc * 5.3 + s[2]) * 5
                    + np.sin(xx / 2.3 - tc * 9.0 + s[9]) * 2.5) * (0.3 + wild)
            return lv + slosh + chop

        surf = surf_fn(x)
        d = y - surf                                                      # < 0: under water
        drift = (-1 if phase == 'draining' else 1) * tc * (50 + 60 * inten)
        yy = y - drift
        # churn: coarse structure + fine turbulence (the screens are ~30 px wide: the fine octaves are what they show)
        n = (0.30 * np.sin(x / 17.0 + np.sin(yy / 31.0 + s[3]) * 2.2 + tc * 0.8)
             + 0.25 * np.sin(yy / 13.0 + np.sin(x / 19.0 + tc * 1.2 + s[4]) * 2.0)
             + 0.20 * np.sin(x / 4.1 + np.sin(yy / 5.3 + tc * 2.1 + s[5]) * 1.8 + tc * 1.7)
             + 0.15 * np.sin(yy / 3.1 + np.sin(x / 3.7 - tc * 2.6 + s[6]) * 1.6)
             + 0.10 * np.sin((x - yy) / 1.9 + tc * (4 + 4 * inten) + s[7]))
        voids = np.clip((n + 0.40) * 2.6, 0, 1)                           # black pockets: about a third
        bright = np.clip((n - 0.30) * 2.8, 0, 1)
        depth = np.clip(-d / 400.0, 0, 1) * 0.6
        water = pal['deep'] + (pal['mid'] - pal['deep']) * (voids * (1 - depth))[:, None] \
            + (pal['bright'] - pal['mid']) * (bright * (1 - depth))[:, None]
        water = water * voids[:, None]
        # bubbles and foam flecks in the body, more with intensity
        fleck = (_hash(np.floor(x * 1.3) * 12.9898 + np.floor((yy + tc * 30) * 0.9) * 78.233) > 0.992 - 0.01 * inten)
        water = water + (fleck * (d < -6) * 0.6)[:, None] * pal['foam']
        col = np.where((d < 0)[:, None], water, 0.0)
        # the crest where it crashes: white, broken up finely
        crest = np.exp(-np.abs(d + 2) / (2.5 + 5 * wild)) * (0.45 + 0.55 * np.sin(x / 2.1 + tc * 9 + s[10]) ** 2)
        crest *= 0.0 if phase == 'empty' else (0.55 + 0.45 * min(1.0, wild))
        col = col + crest[:, None] * pal['foam']
        # spray droplets
        self._spray(dt, surf_fn, lv, 0.0 if phase == 'empty' else wild, inten)
        if len(self.sp):
            col = col + self._splat(self.sp, 1.6)[:, None] * pal['foam']
        # draining: drips running down the walls above the falling surface
        if phase in ('draining', 'empty'):
            hcol = _hash(np.floor(x / 1.5) * 91.7 + s[11])
            streak = (np.sin((y + tc * 180) / 6.0 + hcol * 40) > 0.9) & (hcol > 0.55)
            col = col + ((streak & (d > 0) & (d < 300)) * np.exp(-np.maximum(d, 0) / 140.0) * 0.7)[:, None] * pal['mid']
        return np.clip(col * st['brightness'] / 0.8, 0.0, 1.0).astype(np.float32)

    def _splat(self, p, r):
        """Brightness at every point from droplets at p (frame px), radius r: binned so it stays cheap."""
        out = np.zeros(len(self.pts), np.float32)
        cell, order, sk = self._bins
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                kd = (np.floor(p[:, 0] / cell).astype(np.int64) + ox) * 100003 + np.floor(p[:, 1] / cell).astype(np.int64) + oy
                lo, hi = np.searchsorted(sk, kd, 'left'), np.searchsorted(sk, kd, 'right')
                cnt = hi - lo
                if not cnt.sum():
                    continue
                drop = np.repeat(np.arange(len(p)), cnt)
                idx = order[np.concatenate([np.arange(a, b) for a, b in zip(lo[cnt > 0], hi[cnt > 0])])]
                d2 = ((self.pts[idx] - p[drop]) ** 2).sum(1)
                np.add.at(out, idx, np.exp(-d2 / (r * r)))
        return np.clip(out, 0, 1)

    def frames(self, now):
        dt = 0.0 if self.last is None else min(0.25, max(0.0, now - self.last))
        self.last = now
        self.clock += dt
        self.t = (self.t + dt * self.settings['speed']) % CYCLE_S
        col = self.colours(self.t, self.clock, dt)
        ropes = (col[: self.n_rope] * ROPE_GAIN).reshape(N_ROPES, N_PX, 3)
        sw, sh = QW // SCREEN_DOWN, QH // SCREEN_DOWN
        scr = col[self.n_rope:].reshape(NQ, sh, sw, 3)
        if SCREEN_DOWN > 1:
            scr = scr.repeat(SCREEN_DOWN, 1).repeat(SCREEN_DOWN, 2)
        panels = np.concatenate(list(scr), axis=1)                         # QH x QW*4 x 3, row 0 at the top
        return ropes, panels, self.t


# ---- TouchDesigner side --------------------------------------------------------------------------------------------

def _holder():
    h = sys.modules.setdefault('filling_live', types.ModuleType('filling_live'))
    for k, v in (('fill', None), ('ropes', None), ('panels', None), ('error', None), ('t', 0.0), ('read_at', 0.0), ('wrote_at', 0.0)):
        if not hasattr(h, k):
            setattr(h, k, v)
    return h


def reset():
    h = _holder()
    h.fill = None


def frame(comp):
    h = _holder()
    try:
        if h.fill is None:
            mf = comp.par.Mapfile.eval() if hasattr(comp.par, 'Mapfile') else ''
            sf = comp.par.Screensfile.eval() if hasattr(comp.par, 'Screensfile') else ''
            h.fill = Fill(Geometry(mf or None, sf or None))
        now = time.time()
        if now - h.read_at > 1.0:
            h.read_at = now
            try:
                h.fill.set(json.loads((RIVER / 'filling' / 'control.json').read_text(encoding='utf-8-sig')))
            except (OSError, ValueError):
                pass
        h.frame = getattr(h, 'frame', 0) + 1
        if h.frame % 2 == 0 or h.ropes is None:                          # the water at 30 Hz
            h.ropes, h.panels, h.t = h.fill.frames(now)
        if now - h.wrote_at > 0.5:
            h.wrote_at = now
            phase, full = h.fill.state
            st = dict(h.fill.settings, t=now, level=round(full, 3), phase=phase, cycle_s=round(h.t, 1))
            p = RIVER / 'filling' / 'status.json'
            try:
                p.parent.mkdir(parents=True, exist_ok=True)
                tmp = p.with_suffix('.tmp')
                tmp.write_text(json.dumps(st), encoding='utf-8')
                tmp.replace(p)
            except OSError:
                pass
        h.error = None
    except Exception as e:                                                # noqa: BLE001 - never stop the show
        h.error = repr(e)
    for n in ('rope_render', 'panel_render'):
        o = comp.op(n)
        if o is not None:
            o.cook(force=True)


def cook(scriptOp):
    h = _holder()
    if scriptOp.name == 'rope_render':
        f = h.ropes
        if f is None:
            return
        img = np.empty((f.shape[1], f.shape[0], 4), np.float32)          # 20 wide, 400 tall, LED 0 on the top row
        img[..., :3] = f.transpose(1, 0, 2)[::-1]
    else:
        f = h.panels
        if f is None:
            return
        img = np.empty((f.shape[0], f.shape[1], 4), np.float32)
        img[..., :3] = f[::-1]
    img[..., 3] = 1.0
    scriptOp.copyNumpyArray(np.ascontiguousarray(img))
