"""The filling glass (river-filling.toe, round 2 milestone M1, 27 Oct night): every rope and every screen is one canvas,
painted by where each LED really is in the room (the calibration's frame, as the gallery camera sees the piece, the
screens at their measured tilts: td/remembered/particles.py Geometry). Water rises from the floor to the top like a
glass filling, turbulent, sloshing and crashing, blues and blacks, a river filling a pool; holds churning at the top;
then drains all the way out, leaving drips; and again. numpy only.

The water: a level that rises and falls through the cycle, a surface that sloshes (a standing wave across the column
plus travelling chop, wild while it fills, calmer at the top), a white-cyan crest where it crashes, spray above it,
and below it deep blue broken by black voids that churn (upward while filling, downward while draining).
"""
import math
import sys
import time
import types
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from remembered.particles import Geometry, QW, QH, NQ, N_ROPES, N_PX  # noqa: E402

# the cycle, seconds
FILL_S, HOLD_S, DRAIN_S, EMPTY_S = 38.0, 10.0, 30.0, 6.0
CYCLE_S = FILL_S + HOLD_S + DRAIN_S + EMPTY_S
SCREEN_DOWN = 2                       # screens drawn at half resolution, then doubled (cheaper; still smooth water)
DEEP = np.array([0.00, 0.06, 0.30], np.float32)
MID = np.array([0.03, 0.36, 0.95], np.float32)
BRIGHT = np.array([0.20, 0.60, 1.00], np.float32)
FOAM = np.array([0.75, 0.95, 1.00], np.float32)
ROPE_GAIN = 0.9                       # the ropes are many LEDs: keep the whole column filled under the power limit


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def level_at(t, y0, y1):
    """The water level (frame px, y up) and how wild it is (0..1), t seconds into the cycle."""
    t = t % CYCLE_S
    span = y1 - y0
    if t < FILL_S:
        f = t / FILL_S
        lv = y0 - 30 + (span + 60) * (0.85 * ease(f) + 0.15 * f)       # rushes in, then fills steadily
        return lv, 1.0
    t -= FILL_S
    if t < HOLD_S:
        return y1 + 30, 0.55
    t -= HOLD_S
    if t < DRAIN_S:
        f = t / DRAIN_S
        return y1 + 30 - (span + 90) * ease(f), 0.6
    return y0 - 60, 0.0


class Fill:
    def __init__(self, geometry, seed=0):
        g = self.g = geometry
        self.rng = np.random.default_rng(seed + 11)
        self.t0 = None
        # every point to paint: rope LEDs, then the screens' pixels (half resolution), all in frame px
        rope = g.led_xy.reshape(-1, 2).copy()
        bad = ~np.isfinite(rope).all(1)
        rope[bad] = (-1e4, -1e4)
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
        self.seed = self.rng.uniform(0, 100, 8)

    def colours(self, t):
        x, y = self.pts[:, 0], self.pts[:, 1]
        W = self.x1 - self.x0
        lv, wild = level_at(t, self.y0, self.y1)
        tt = t % CYCLE_S
        s = self.seed
        # the surface: a standing slosh across the column + travelling chop
        xn = (x - self.x0) / W
        slosh = math.sin(t * 1.3 + s[0]) * np.cos(math.pi * xn) * (55 * wild + 8)
        chop = (np.sin(xn * 9.0 - t * 3.1 + s[1]) * 14 + np.sin(xn * 23.0 + t * 4.7 + s[2]) * 6) * (0.4 + wild)
        surf = lv + slosh + chop
        d = y - surf                                                      # < 0: under water
        # churn under the surface: rotating sine noise, rising while filling, sinking while draining
        drift = (-1 if tt > FILL_S + HOLD_S else 1) * t * 40
        a = np.sin(x / 13.0 + np.sin(y / 29.0 - drift / 29.0 + s[3]) * 2.2 + t * 0.9)
        b = np.sin(y / 17.0 - drift / 17.0 + np.sin(x / 21.0 + t * 1.1 + s[4]) * 2.0)
        c = np.sin((x + y) / 9.0 + t * 2.3 + s[5])
        n = 0.45 * a + 0.4 * b + 0.15 * c                                  # -1..1
        voids = np.clip((n + 0.45) * 2.4, 0, 1)                           # black pockets where n is low (about a third)
        bright = np.clip((n - 0.35) * 2.5, 0, 1)
        depth = np.clip(-d / 400.0, 0, 1) * 0.6                           # deeper = a little darker
        water = DEEP + (MID - DEEP) * (voids * (1 - 0.6 * depth))[:, None] + (BRIGHT - MID) * (bright * (1 - depth))[:, None]
        water = water * voids[:, None]
        under = d < 0
        col = np.where(under[:, None], water, 0.0)
        # the crest: where it crashes, white-cyan, broken up
        crest = np.exp(-np.abs(d + 3) / (4 + 6 * wild)) * (0.55 + 0.45 * np.sin(x / 5.0 + t * 7 + s[6]) ** 2)
        crest *= (0.5 + 0.5 * wild) if lv > self.y0 - 20 else 0.0
        col = col + crest[:, None] * FOAM
        # spray above the surface while it fills: sparse bright points flung up and falling
        above = (d > 0) & (d < 70 * wild + 1)
        if wild > 0.3:
            h = np.sin(x * 12.9898 + np.floor(y / 3.0) * 78.233 + math.floor(t * 12) * 3.7) * 43758.5453
            h = h - np.floor(h)
            spray = (h > 0.985) & above
            col = col + (spray * np.exp(-d / 30.0) * wild)[:, None] * FOAM
        # draining: drips left on the walls above the falling surface
        if FILL_S + HOLD_S < tt < CYCLE_S - EMPTY_S / 2:
            drip = (d > 0) & (d < 260)
            hcol = np.sin(np.floor(x / 2.0) * 91.7 + s[7]) * 43758.5
            hcol = hcol - np.floor(hcol)
            streak = (np.sin((y + t * 160) / 7.0 + hcol * 40) > 0.92) & (hcol > 0.6)
            col = col + ((drip & streak) * np.exp(-d / 120.0) * 0.6)[:, None] * MID
        return np.clip(col, 0.0, 1.0).astype(np.float32)

    def frames(self, now):
        if self.t0 is None:
            self.t0 = now
        t = now - self.t0
        col = self.colours(t)
        ropes = (col[: self.n_rope] * ROPE_GAIN).reshape(N_ROPES, N_PX, 3)
        sw, sh = QW // SCREEN_DOWN, QH // SCREEN_DOWN
        scr = col[self.n_rope:].reshape(NQ, sh, sw, 3)
        scr = scr.repeat(SCREEN_DOWN, 1).repeat(SCREEN_DOWN, 2)
        panels = np.concatenate(list(scr), axis=1)                         # QH x QW*4 x 3, row 0 at the top
        return ropes, panels, t % CYCLE_S


# ---- TouchDesigner side --------------------------------------------------------------------------------------------

def _holder():
    h = sys.modules.setdefault('filling_live', types.ModuleType('filling_live'))
    for k, v in (('fill', None), ('ropes', None), ('panels', None), ('error', None), ('t', 0.0)):
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
        h.ropes, h.panels, h.t = h.fill.frames(time.time())
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
