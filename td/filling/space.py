"""Where every LED of the filling glass is, by its real height above the floor, and soft round water particles drawn
there (both fill shows). numpy only.

Water fills by height, and height doesn't depend on where you stand: the camera sees the piece from low and to one side,
so the screens and the ropes beside them line up differently in its picture than for someone in front of the piece
(the artists, 27 Oct night: "the middle screen comes on with the LEDs much closer to the floor"). So the canvas is
  x  across the piece: the calibration's frame (frame px, as the gallery camera sees it)
  y  height above the floor, in the same px scale (metres x px_per_m from the rope LED spacing)
Rope LED heights come from the zones file (tools/remembered/zones.py: from each rope's LED spacing and floor).
Screen heights: Gavin's measurements on site, chained from screen 3's calibrated centre (1 m between the centres of 3
and 4 and of 4 and 2, each 30 deg from vertical; screen 1's bottom 1.5 m above the top of screen 3); each pixel then at
its real place on its screen (0.32 x 0.64 m) at the screen's measured tilt.
"""
import json
import math
from pathlib import Path

import numpy as np

from remembered.particles import Geometry, QW, QH, NQ, N_ROPES, N_PX  # noqa: F401

SCREEN_M = (0.32, 0.64)
SCREEN3_HEIGHT_M = 1.81                       # the calibration's (zones file), the anchor of the measured chain
CHAIN_M = 1.0 * math.cos(math.radians(30))    # 1 m between centres at 30 deg from vertical: 0.87 m up


def screen_heights(zones=None):
    """Each screen's centre height (m): the measured chain from screen 3."""
    h3 = SCREEN3_HEIGHT_M
    for s in (zones or {}).get('screens') or []:
        if s.get('screen') == 3 and isinstance(s.get('height_m'), (int, float)):
            h3 = float(s['height_m'])
    h4 = h3 + CHAIN_M
    h2 = h4 + CHAIN_M
    h1 = h3 + SCREEN_M[1] / 2 + 1.5 + SCREEN_M[1] / 2
    return {1: h1, 2: h2, 3: h3, 4: h4}


class Space:
    """Points to paint: rope LEDs, then the screens' pixels (at `down` x lower resolution), as (x, y) in frame px with y
    = height. Also the screens at full resolution, for the particles."""

    def __init__(self, pixelmap=None, screens=None, zones=None, down=2):
        self.g = g = Geometry(pixelmap, screens)
        z = None
        if zones:
            try:
                z = json.loads(Path(zones).read_text(encoding='utf-8'))
            except (OSError, ValueError):
                z = None
        self.px_per_m = g.px_per_led / 0.025
        S = self.px_per_m
        rope = g.led_xy.reshape(-1, 2).astype(np.float64).copy()
        if z and z.get('ropes'):                                    # real heights for every rope LED
            hs = np.full((N_ROPES, N_PX), np.nan)
            for r in z['ropes']:
                if 0 <= r.get('rope', -1) < N_ROPES and len(r.get('heights') or []) == N_PX:
                    hs[r['rope']] = [np.nan if v is None else v for v in r['heights']]
            ok = np.isfinite(hs.reshape(-1))
            rope[ok, 1] = hs.reshape(-1)[ok] * S
        rope[~np.isfinite(rope).all(1)] = (-1e4, -1e4)
        self.rope = rope.astype(np.float32)
        self.n_rope = len(rope)
        hts = screen_heights(z)
        self.screen_full = []
        self.screen_low = []
        self.down = down
        for k, (c, ang, w, h) in enumerate(g.screens, start=1):
            hc = hts.get(k, c[1] / S)
            for res, store in ((1, self.screen_full), (down, self.screen_low)):
                sw, sh = QW // res, QH // res
                px, py = np.meshgrid((np.arange(sw) + 0.5) / sw, (np.arange(sh) + 0.5) / sh)
                lx, ly = (px - 0.5) * SCREEN_M[0], (0.5 - py) * SCREEN_M[1]      # metres on the screen, y up
                ca, sa = math.cos(ang), math.sin(ang)
                X = c[0] + (lx * ca - ly * sa) * S
                Y = (hc + lx * sa + ly * ca) * S
                store.append(np.stack([X, Y], -1).reshape(-1, 2).astype(np.float32))
        self.field_pts = np.concatenate([self.rope] + self.screen_low)
        self.part_pts = np.concatenate([self.rope] + self.screen_full)
        ok = self.rope[:, 0] > -1e3
        self.x0, self.x1 = float(self.rope[ok, 0].min()) - 20, float(self.rope[ok, 0].max()) + 20
        allh = np.concatenate([self.rope[ok, 1]] + [s[:, 1] for s in self.screen_full])
        self.y0, self.y1 = float(allh.min()), float(allh.max())             # the floor and the top, by height
        keyp = np.floor(self.part_pts / 6.0).astype(np.int64)                 # binned once, for the particles
        kp = keyp[:, 0] * 100003 + keyp[:, 1]
        order = np.argsort(kp)
        self._bins = (6.0, order, kp[order])

    def screens_from_low(self, low_cols):
        """The screens' low-resolution colours -> QH x (QW*4) x 3, smoothly upsampled (no 2 x 2 blocks)."""
        d = self.down
        sw, sh = QW // d, QH // d
        scr = low_cols.reshape(NQ, sh, sw, 3)
        out = []
        for q in scr:
            up = q.repeat(d, 0).repeat(d, 1)
            if d > 1:                                                            # smooth the steps (box over d px)
                p = np.pad(up, ((1, 1), (1, 1), (0, 0)), mode='edge')
                up = (p[:-2, :-2] + p[:-2, 1:-1] + p[1:-1, :-2] + p[1:-1, 1:-1] + p[1:-1, 2:] + p[2:, 1:-1] + p[2:, 2:]
                      + p[:-2, 2:] + p[2:, :-2]) / 9.0
            out.append(up)
        return np.concatenate(out, axis=1)

    def splat(self, pos, radius, bright):
        """Soft round particles (gaussian, radius in frame px) -> brightness at every particle point (ropes then screens
        at full resolution)."""
        out = np.zeros(len(self.part_pts), np.float32)
        if not len(pos):
            return out
        cell, order, sk = self._bins
        reach = int(math.ceil(float(radius.max()) * 2 / cell))
        cx = np.floor(pos[:, 0] / cell).astype(np.int64)
        cy = np.floor(pos[:, 1] / cell).astype(np.int64)
        for ox in range(-reach, reach + 1):
            for oy in range(-reach, reach + 1):
                kd = (cx + ox) * 100003 + cy + oy
                lo, hi = np.searchsorted(sk, kd, 'left'), np.searchsorted(sk, kd, 'right')
                cnt = hi - lo
                sel = cnt > 0
                if not sel.any():
                    continue
                drop = np.repeat(np.nonzero(sel)[0], cnt[sel])
                idx = order[np.concatenate([np.arange(a, b) for a, b in zip(lo[sel], hi[sel])])]
                d2 = ((self.part_pts[idx] - pos[drop]) ** 2).sum(1)
                np.add.at(out, idx, bright[drop] * np.exp(-d2 / (radius[drop] ** 2)))
        return np.clip(out, 0, 1.5)


class Drops:
    """Soft round water particles of varying sizes: spray flung up from the surface, drips and bubbles."""

    def __init__(self, rng, max_n=1200):
        self.rng = rng
        self.max_n = max_n
        self.p = np.zeros((0, 2), np.float32)
        self.v = np.zeros((0, 2), np.float32)
        self.r = np.zeros(0, np.float32)
        self.b = np.zeros(0, np.float32)
        self.g = np.zeros(0, np.float32)          # gravity per particle (px/s^2; negative = rises, a bubble)

    def add(self, pos, vel, radius, bright, gravity):
        n = min(len(pos), self.max_n - len(self.b))
        if n <= 0:
            return
        self.p = np.concatenate([self.p, pos[:n].astype(np.float32)])
        self.v = np.concatenate([self.v, vel[:n].astype(np.float32)])
        self.r = np.concatenate([self.r, radius[:n].astype(np.float32)])
        self.b = np.concatenate([self.b, bright[:n].astype(np.float32)])
        self.g = np.concatenate([self.g, gravity[:n].astype(np.float32)])

    def step(self, dt, keep):
        if not len(self.b):
            return
        self.v[:, 1] -= self.g * dt
        self.v[:, 0] *= (1 - 0.6 * dt)
        self.p += self.v * dt
        k = keep(self.p, self.v)
        self.p, self.v, self.r, self.b, self.g = self.p[k], self.v[k], self.r[k], self.b[k], self.g[k]

    def sizes(self, n, lo=0.7, hi=2.6):
        """Varying sizes: mostly small, a few large."""
        return lo + (hi - lo) * self.rng.random(n) ** 2.2
