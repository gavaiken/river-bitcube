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
from remembered.particles import QW, QH, NQ, N_ROPES, N_PX  # noqa: E402
from filling import space as space_mod  # noqa: E402

RIVER = Path(r'C:\Users\user\River')

# the cycle at speed 1, seconds (the dials' Speed scales it)
FILL_S, HOLD_S, DRAIN_S, EMPTY_S = 38.0, 10.0, 30.0, 6.0
CYCLE_S = FILL_S + HOLD_S + DRAIN_S + EMPTY_S
ROPE_GAIN = 0.9                       # the ropes are many LEDs: the whole column filled stays under the power limit
# palettes: deep (the depths), mid (the body), bright (lit water), foam (crest and spray)
PALETTES = {
    'river':    {'deep': (0.00, 0.06, 0.30), 'mid': (0.03, 0.36, 0.95), 'bright': (0.20, 0.60, 1.00), 'foam': (0.75, 0.95, 1.00)},
    'glacier':  {'deep': (0.02, 0.14, 0.26), 'mid': (0.30, 0.70, 0.90), 'bright': (0.70, 0.95, 1.00), 'foam': (0.95, 1.00, 1.00)},
    'midnight': {'deep': (0.02, 0.01, 0.18), 'mid': (0.12, 0.10, 0.70), 'bright': (0.35, 0.35, 1.00), 'foam': (0.70, 0.80, 1.00)},
    'teal':     {'deep': (0.00, 0.12, 0.14), 'mid': (0.00, 0.55, 0.60), 'bright': (0.20, 0.90, 0.85), 'foam': (0.80, 1.00, 0.95)},
}
DEFAULTS = {'palette': 'river', 'brightness': 0.8, 'intensity': 0.6, 'speed': 1.0}


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
    def __init__(self, space, seed=0):
        sp = self.space = space
        self.rng = np.random.default_rng(seed + 11)
        self.t = 0.0                                   # cycle time (advances at the dials' speed)
        self.clock = 0.0                               # wall time since start (the churn's own motion)
        self.last = None
        self.settings = dict(DEFAULTS)
        self.pts = sp.field_pts
        self.n_rope = sp.n_rope
        self.x0, self.x1, self.y0, self.y1 = sp.x0, sp.x1, sp.y0, sp.y1
        self.seed = self.rng.uniform(0, 100, 12)
        self.drops = space_mod.Drops(self.rng)
        self.state = ('empty', 0.0)

    def set(self, settings):
        for k, v in (settings or {}).items():
            if k == 'palette' and v in PALETTES:
                self.settings['palette'] = v
            elif k in ('brightness', 'intensity') and isinstance(v, (int, float)):
                self.settings[k] = float(min(1.0, max(0.0, v)))
            elif k == 'speed' and isinstance(v, (int, float)):
                self.settings[k] = float(min(3.0, max(0.25, v)))

    def _surface(self, lv, wild):
        s, tc, W = self.seed, self.clock, self.x1 - self.x0

        def surf_fn(xx):
            xn = (xx - self.x0) / W
            slosh = (math.sin(tc * 1.1 + s[0]) * np.cos(math.pi * xn) + 0.6 * math.sin(tc * 0.7 + s[8]) * np.cos(2 * math.pi * xn)) * (45 * wild + 6)
            chop = (np.sin(xn * 11.0 - tc * 3.4 + s[1]) * 10 + np.sin(xn * 29.0 + tc * 5.3 + s[2]) * 5
                    + np.sin(xx / 2.3 - tc * 9.0 + s[9]) * 2.5) * (0.3 + wild)
            return lv + slosh + chop
        return surf_fn

    def _particles(self, dt, surf_fn, wild, inten, phase):
        """Soft round particles of varying sizes: spray flung up where it crashes, bubbles rising in the body, drips
        sliding down the walls while it drains."""
        rng, dr = self.rng, self.drops
        n = int(rng.poisson(dt * 700 * wild * (0.3 + inten))) if phase != 'empty' and wild > 0 else 0
        if n:                                                             # spray
            x = rng.uniform(self.x0, self.x1, n)
            dr.add(np.stack([x, surf_fn(x)], 1), np.stack([rng.normal(0, 40 + 60 * inten, n),
                   rng.uniform(60, 150 + 240 * inten, n)], 1), dr.sizes(n), rng.uniform(0.6, 1.0, n), np.full(n, 420.0))
        n = int(rng.poisson(dt * 160 * (0.4 + inten))) if phase in ('filling', 'full') else 0
        if n:                                                             # bubbles: rise, dim
            x = rng.uniform(self.x0, self.x1, n)
            top = np.minimum(surf_fn(x), self.y1)
            y = self.y0 + rng.random(n) * np.maximum(top - self.y0, 0)
            dr.add(np.stack([x, y], 1), np.stack([rng.normal(0, 8, n), rng.uniform(20, 60, n)], 1),
                   dr.sizes(n, 0.6, 2.0), rng.uniform(0.25, 0.55, n), np.full(n, -30.0))
        n = int(rng.poisson(dt * 120)) if phase == 'draining' else 0
        if n:                                                             # drips left on the walls
            x = rng.uniform(self.x0, self.x1, n)
            y = surf_fn(x) + rng.uniform(5, 200, n)
            dr.add(np.stack([x, y], 1), np.zeros((n, 2)), dr.sizes(n, 0.6, 1.4), rng.uniform(0.3, 0.6, n),
                   np.full(n, 90.0))

        def keep(p, v):
            sf = surf_fn(p[:, 0])
            rising = v[:, 1] > 0
            return (p[:, 1] > self.y0 - 20) & (p[:, 1] < self.y1 + 200) & ~((v[:, 1] < 0) & (p[:, 1] < sf - 4) & (dr.g[:len(p)] > 0)) & ~(rising & (dr.g[:len(p)] < 0) & (p[:, 1] > sf))
        dr.step(dt, keep)
        return self.space.splat(dr.p, dr.r, dr.b)

    def colours(self, t, clock=None, dt=1 / 30):
        """The water on the field points (ropes + screens at low resolution) and the particles on the particle points
        (ropes + screens at full resolution): (field colours, particle brightness, foam colour)."""
        if clock is not None:
            self.clock = clock
        st = self.settings
        pal = {k: np.array(v, np.float32) for k, v in PALETTES[st['palette']].items()}
        inten = st['intensity']
        x, y = self.pts[:, 0], self.pts[:, 1]
        lv, wild, phase, full = level_at(t, self.y0, self.y1)
        self.state = (phase, full)
        wild = wild * (0.4 + 1.0 * inten)
        s, tc = self.seed, self.clock
        surf_fn = self._surface(lv, wild)
        d = y - surf_fn(x)                                                # < 0: under water
        drift = (-1 if phase == 'draining' else 1) * tc * (50 + 60 * inten)
        yy = y - drift
        n = (0.30 * np.sin(x / 17.0 + np.sin(yy / 31.0 + s[3]) * 2.2 + tc * 0.8)
             + 0.25 * np.sin(yy / 13.0 + np.sin(x / 19.0 + tc * 1.2 + s[4]) * 2.0)
             + 0.20 * np.sin(x / 4.1 + np.sin(yy / 5.3 + tc * 2.1 + s[5]) * 1.8 + tc * 1.7)
             + 0.15 * np.sin(yy / 3.1 + np.sin(x / 3.7 - tc * 2.6 + s[6]) * 1.6)
             + 0.10 * np.sin((x - yy) / 1.9 + tc * (4 + 4 * inten) + s[7]))
        voids = np.clip((n + 0.40) * 2.6, 0, 1)
        bright = np.clip((n - 0.30) * 2.8, 0, 1)
        depth = np.clip(-d / 400.0, 0, 1) * 0.6
        water = pal['deep'] + (pal['mid'] - pal['deep']) * (voids * (1 - depth))[:, None] \
            + (pal['bright'] - pal['mid']) * (bright * (1 - depth))[:, None]
        water = water * voids[:, None]
        col = np.where((d < 0)[:, None], water, 0.0)
        crest = np.exp(-np.abs(d + 2) / (2.5 + 5 * wild)) * (0.45 + 0.55 * np.sin(x / 2.1 + tc * 9 + s[10]) ** 2)
        crest *= 0.0 if phase == 'empty' else (0.55 + 0.45 * min(1.0, wild))
        col = col + crest[:, None] * pal['foam']
        parts = self._particles(dt, surf_fn, wild, inten, phase)
        k = st['brightness'] / 0.8
        return np.clip(col * k, 0.0, 1.0).astype(np.float32), parts * k, pal['foam']

    def frames(self, now):
        dt = 0.0 if self.last is None else min(0.25, max(0.0, now - self.last))
        self.last = now
        self.clock += dt
        self.t = (self.t + dt * self.settings['speed']) % CYCLE_S
        col, parts, foam = self.colours(self.t, self.clock, dt)
        n = self.n_rope
        ropes = np.clip(col[:n] + parts[:n, None] * foam, 0, 1) * ROPE_GAIN
        panels = self.space.screens_from_low(col[n:])
        pp = parts[n:].reshape(NQ, QH, QW)
        panels = np.clip(panels + np.concatenate(list(pp), axis=1)[..., None] * foam, 0.0, 1.0)
        return ropes.reshape(N_ROPES, N_PX, 3).astype(np.float32), panels.astype(np.float32), self.t


# ---- TouchDesigner side --------------------------------------------------------------------------------------------

def _holder():
    h = sys.modules.setdefault('filling_live', types.ModuleType('filling_live'))   # one show file runs at a time
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
            zf = comp.par.Zonesfile.eval() if hasattr(comp.par, 'Zonesfile') else ''
            variant = comp.par.Variant.eval() if hasattr(comp.par, 'Variant') else 'configurable'
            cls = Fill
            if variant == 'simple':
                from filling.simple import SimpleFill
                cls = SimpleFill
            h.fill = cls(space_mod.Space(mf or None, sf or None, zf or None))
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
