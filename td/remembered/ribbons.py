"""Silk ribbons of glitter (28 Oct, Gavin's reference: a twisting translucent sheet of fine sparkling particles, brighter
where it folds edge-on, loose glitter and soft bokeh around it). numpy only. Not physics: a cheap procedural look.

Same API as flow.FineField / particles.Field: step(dt, intensity, rope_speed_leds, turbulence), render_screens(colour),
render_ropes(colour), lit_pct.

The space is the filling glass's (x across the piece in the calibration's frame px, y = real height above the floor in the
same scale), so a ribbon is one continuous thing passing through all four windows and down the ropes.

  ribbons  a few sheets, each a spine that wanders sideways with height and time, a width that breathes, and a twist
           that turns along it: a point at (height y, across v in -1..1) sits at x = spine(y) + v W cos(twist(y)), lifted a
           little by v W sin(twist) (the sheet's depth, seen slightly from above). Where the sheet turns edge-on its points
           pile up into a bright fold, as in the reference. The points stream down the sheet (the water falls), each
           twinkling on its own.
  glitter  loose sparkles shed around the sheets, drifting and falling; a few large, faint, soft discs (bokeh)
  level    how many sheets show, how wide, bright and fast, follows the ropes' level (calm: one faint ribbon; surge: all
           of them, bright and quick); turbulence (Dave) adds twist and wander
"""
import math

import numpy as np

QW, QH, NQ = 128, 256, 4
N_ROPES, N_PX = 20, 400
SCREEN_M = (0.32, 0.64)
N_RIB = 4
PTS = 3800                       # points per ribbon per screen (streaming through that screen's height band)
ROPE_PTS = 4000                  # per ribbon, over the whole height, for the ropes
DUST = 900                       # loose glitter per screen
BOKEH = 7                        # faint soft discs per screen
LUT_TOP = 1.6                    # the brightest a screen pixel gets before the colour lookup
ROPE_GRID = 512                  # rows the spine is computed on over the whole height, for the ropes
GRID = 192                       # rows the spine is computed on per screen band
TWINKLE = (0.55 + 0.45 * np.sin(np.arange(64) * 2 * math.pi / 64)).astype(np.float32)
TRAIL = 0.55                     # a little persistence: the glitter shimmers rather than flickers


def _soft(a):
    """A 3 x 3 box blur over the last two axes, edges zero."""
    p = np.pad(a, [(0, 0)] * (a.ndim - 2) + [(1, 1), (1, 1)])
    h = p[..., :-2] + p[..., 1:-1] + p[..., 2:]
    return (h[..., :-2, :] + h[..., 1:-1, :] + h[..., 2:, :]) / 9.0


def _disc(r):
    k = int(math.ceil(r)) + 1
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    d = np.sqrt(xx * xx + yy * yy)
    return np.clip(r + 0.5 - d, 0, 1).astype(np.float32) * (0.6 + 0.4 * (d / max(r, 1)) ** 2)   # bright rim, as bokeh


class Ribbons:
    @classmethod
    def from_files(cls, pixelmap=None, screens=None, zones=None, seed=0):
        from filling import space as space_mod
        return cls(space_mod.Space(pixelmap, screens, zones, down=4), seed)

    def __init__(self, space, seed=0):
        self.sp = space
        S = space.px_per_m
        self.S = S
        self.screens = []
        for k, (c, ang, _w, _h) in enumerate(space.g.screens, start=1):
            cy = space.screen_full[k - 1][:, 1].mean()
            self.screens.append((float(c[0]), float(cy), float(ang), SCREEN_M[0] * S, SCREEN_M[1] * S))
        rng = np.random.default_rng(seed + 29)
        self.rng = rng
        self.t = 0.0
        self.flow = 0.0                                       # how far the points have streamed (fraction of a band)
        self.level = 0.3
        self.turb = 0.5
        xs = [s[0] for s in self.screens]
        self.xc = float(np.mean(xs))
        self.xspread = max(30.0, (max(xs) - min(xs)) / 2 + 0.15 * SCREEN_M[0] * S)
        # each ribbon's character: phases, frequencies, width
        self.rib = [dict(ph=rng.uniform(0, 2 * math.pi, 6), off=(i - (N_RIB - 1) / 2) * 0.8,
                         kx=rng.uniform(1.8, 2.8) / S, kt=rng.uniform(6.0, 9.0) / S,
                         w=rng.uniform(0.13, 0.22) * S, spd=rng.uniform(0.8, 1.2),
                         home=self.screens[i % len(self.screens)][0]) for i in range(N_RIB)]
        self.sw = SCREEN_M[0] * S
        # the points: per screen, per ribbon, a fixed (u, v, sparkle) set
        self.band = []
        for (cx, cy, ang, w, h) in self.screens:
            r = 0.5 * math.hypot(w, h) + 0.25 * S          # + the sheet's lift: no straight cut at the band ends
            self.band.append((cy - r, cy + r))
        self.pu = rng.random((NQ, N_RIB, PTS)).astype(np.float32)
        v = rng.random((NQ, N_RIB, PTS)).astype(np.float32) * 2 - 1
        self.pv = np.sign(v) * np.abs(v) ** 0.8                 # a little denser toward the edges (the reference's rims)
        self.pb = (rng.lognormal(-0.4, 0.7, (NQ, N_RIB, PTS))).astype(np.float32)
        self.pw = (rng.uniform(1.5, 7.0, (NQ, N_RIB, PTS)) * 64 / (2 * math.pi)).astype(np.float32)   # twinkle rate
        self.pph = rng.uniform(0, 64, (NQ, N_RIB, PTS)).astype(np.float32)                # (in TWINKLE steps)
        self.pbe = self.pb * (1.0 + 1.2 * (np.abs(self.pv) > 0.93))                       # luminous rims
        self.ru = rng.random((N_RIB, ROPE_PTS)).astype(np.float32)
        self.rv = (rng.random((N_RIB, ROPE_PTS)) * 2 - 1).astype(np.float32)
        # loose glitter (screen LED coordinates, drifting) and bokeh
        self.dust = rng.random((NQ, DUST, 2)).astype(np.float32) * (QW, QH)
        self.dust_b = rng.lognormal(-1.0, 0.8, (NQ, DUST)).astype(np.float32)
        self.bok = rng.random((NQ, BOKEH, 2)).astype(np.float32) * (QW, QH)
        self.bok_r = rng.uniform(2.5, 6.0, (NQ, BOKEH)).astype(np.float32)
        self.bok_ph = rng.uniform(0, 2 * math.pi, (NQ, BOKEH)).astype(np.float32)
        self.discs = {}
        self.trails = np.zeros((NQ, QH, QW), np.float32)
        self.lit_pct = [0, 0, 0, 0]
        rope = space.rope
        self.rope_ok = rope[:, 0] > -1e3
        self.x0, self.x1, self.y0, self.y1 = space.x0, space.x1, space.y0, space.y1
        self.cx0, self.cy0 = self.x0, self.y0 - 10
        self.cw = int(self.x1 - self.x0) + 2
        self.ch = int(self.y1 - self.y0) + 40
        self.rope_ix = np.clip(np.round(rope[:, 0] - self.cx0).astype(int), 0, self.cw - 1)
        self.rope_iy = np.clip(np.round(rope[:, 1] - self.cy0).astype(int), 0, self.ch - 1)

    # ---- the sheets ----------------------------------------------------------------------------------------------------

    def _spine(self, i, y):
        """Ribbon i at heights y: the spine's x, the cos and sin of the twist, the half-width."""
        R, t, S = self.rib[i], self.t, self.S
        tb = 0.6 + 0.8 * self.turb
        ph = R['ph']
        # each ribbon wanders around its home screen's column (so every window always has one), into its neighbours'
        xs = R['home'] + self.sw * (0.8 * np.sin(R['kx'] * y + 0.23 * t * tb + ph[0])
                                    + 0.35 * np.sin(2.3 * R['kx'] * y - 0.37 * t * tb + ph[1]))
        tw = R['kt'] * tb * y + 0.5 * t * tb + ph[2] + 1.3 * np.sin(0.8 * R['kx'] * y + 0.19 * t + ph[3])
        W = R['w'] * (0.6 + 0.6 * self.level) * (1 + 0.35 * np.sin(1.7 * R['kx'] * y + 0.3 * t + ph[4]))
        return xs, np.cos(tw), np.sin(tw), W

    def _sheet(self, i, y, v):
        """Points of ribbon i at heights y and across-positions v -> (x, y, facing 0..1)."""
        xs, c, s, W = self._spine(i, y)
        x = xs + v * W * c
        yy = y + v * W * s * 0.45
        return x, yy, np.abs(s)

    def _shown(self):
        """How much of each ribbon shows (0..1): every window always has its ribbon (Gavin, 28 Oct: "too sparse and
        dark"), faint in calm and full in a surge, the ribbons fading up one after another as the level rises."""
        lv = self.level
        return [min(1.0, 0.5 + 0.5 * max(0.0, min(1.0, lv * N_RIB - i * 0.5))) for i in range(N_RIB)]

    def step(self, dt, intensity, rope_speed_leds, turbulence=0.5):
        if dt <= 0:
            return
        self.t += dt
        lv = max(0.0, min(1.0, intensity))
        self.level += (lv - self.level) * min(1.0, dt / 1.5)
        self.turb += (max(0.0, min(1.0, turbulence)) - self.turb) * min(1.0, dt / 3.0)
        speed = max(10.0, rope_speed_leds * self.sp.g.px_per_led * 0.35)       # frame px/s down the sheet
        self.flow += dt * speed
        # loose glitter: drifts down and sideways on the screen, wraps
        d = self.dust
        d[..., 1] += dt * (8 + 40 * self.level)
        d[..., 0] += dt * 6 * np.sin(self.t * 0.7 + d[..., 1] * 0.05)
        d[..., 0] %= QW
        d[..., 1] %= QH
        self.bok[..., 1] += dt * 3
        self.bok[..., 1] %= QH

    # ---- drawing -------------------------------------------------------------------------------------------------------

    def render_screens(self, colour, gain=1.0):
        # (speed, M7) every screen's points into one bincount, then the glow, trace and colour on all four at once: bitcube
        # was spending 14.5 ms here with one pass per screen and ribbon
        col = np.asarray(colour, np.float32)
        shown = self._shown()
        bright = 0.9 + 0.5 * self.level
        idx, vals = [], []
        for k, (cx, cy, ang, w, h) in enumerate(self.screens):
            ca, sa = math.cos(ang), math.sin(ang)
            ylo, yhi = self.band[k]
            span = yhi - ylo
            base = k * QH * QW
            for i in range(N_RIB):
                if shown[i] <= 0.01:
                    continue
                u = (self.pu[k, i] - self.flow * self.rib[i]['spd'] / span) % 1.0
                y = yhi - u * span
                # the spine on GRID rows of the band, then looked up per point: trig on 192 rows, not 3,800 points
                xs, c, sn, W = self._spine(i, yhi - (np.arange(GRID) + 0.5) / GRID * span)
                g = np.minimum((u * GRID).astype(np.int32), GRID - 1)
                vW = self.pv[k, i] * W[g]
                dx, dy = xs[g] + vW * c[g] - cx, y + vW * sn[g] * 0.45 - cy
                fx = ((dx * ca + dy * sa) / w + 0.5) * QW
                fy = (0.5 - (-dx * sa + dy * ca) / h) * QH
                ok = (fx >= 0) & (fx < QW) & (fy >= 0) & (fy < QH)
                if not ok.any():
                    continue
                tw = TWINKLE[(self.pw[k, i][ok] * self.t + self.pph[k, i][ok]).astype(np.int32) & 63]
                idx.append(base + fy[ok].astype(np.int32) * QW + fx[ok].astype(np.int32))
                vals.append(self.pbe[k, i][ok] * tw * (0.55 + 0.45 * np.abs(sn[g][ok])) * (shown[i] * bright))
            # loose glitter
            di = self.dust[k].astype(np.int32)
            idx.append(base + di[:, 1] * QW + di[:, 0])
            vals.append(self.dust_b[k] * (0.5 + 0.5 * np.sin(self.t * 5.0 + self.dust_b[k] * 40)) * (0.2 + 0.35 * self.level))
        img = np.bincount(np.concatenate(idx), np.concatenate(vals), NQ * QH * QW).astype(np.float32).reshape(NQ, QH, QW)
        # bokeh: a few faint soft discs
        for k in range(NQ):
            for b in range(BOKEH):
                key = round(float(self.bok_r[k, b]) * 2) / 2
                disc = self.discs.get(key)
                if disc is None:
                    disc = self.discs[key] = _disc(key)
                n = disc.shape[0] // 2
                bx, by = int(self.bok[k, b, 0]), int(self.bok[k, b, 1])
                a = 0.10 * (0.5 + 0.5 * math.sin(self.t * 0.6 + float(self.bok_ph[k, b]))) * (0.4 + 0.6 * self.level)
                x0, x1, y0, y1 = max(0, bx - n), min(QW, bx + n + 1), max(0, by - n), min(QH, by + n + 1)
                if x0 < x1 and y0 < y1:
                    img[k, y0:y1, x0:x1] += disc[y0 - by + n:y1 - by + n, x0 - bx + n:x1 - bx + n] * a
        frame = img * 0.5 + _soft(_soft(img)) * 1.5
        tr = np.maximum(self.trails * TRAIL, frame)
        tr[tr < 0.015] = 0.0
        self.trails = tr
        self.lit_pct = [int(round(100 * float(m))) for m in (tr > 0.03).mean(axis=(1, 2))]
        # colour through a 256-step lookup (the brightest go to white), screens side by side: one gather instead of
        # broadcasting every step to three channels (5.7 ms on bitcube)
        lv = np.linspace(0, LUT_TOP, 256, dtype=np.float32)[:, None]
        lut = (np.clip(lv * col + np.clip(lv - 0.55, 0, 1) * (1 - col), 0, 1) * np.float32(gain)).astype(np.float32)
        q = (np.minimum(tr, LUT_TOP) * (255 / LUT_TOP) + 0.5).astype(np.uint8)        # (NQ, QH, QW)
        return lut[q.transpose(1, 0, 2).reshape(QH, NQ * QW)]

    def render_ropes(self, colour):
        # (speed, M7) one bincount, then each LED reads its own cell and four neighbours: no blur of the whole canvas
        shown = self._shown()
        span = self.y1 - self.y0 + 60
        idx, vals = [], []
        for i in range(N_RIB):
            if shown[i] <= 0.01:
                continue
            u = (self.ru[i] - self.flow * self.rib[i]['spd'] / span) % 1.0
            y = self.y1 + 30 - u * span
            xs, c, sn, W = self._spine(i, self.y1 + 30 - (np.arange(ROPE_GRID) + 0.5) / ROPE_GRID * span)
            g = np.minimum((u * ROPE_GRID).astype(np.int32), ROPE_GRID - 1)
            vW = self.rv[i] * W[g]
            ix = np.round(xs[g] + vW * c[g] - self.cx0).astype(np.int32)
            iy = np.round(y + vW * sn[g] * 0.45 - self.cy0).astype(np.int32)
            ok = (ix >= 0) & (ix < self.cw) & (iy >= 0) & (iy < self.ch)
            idx.append(iy[ok] * self.cw + ix[ok])
            vals.append(np.full(int(ok.sum()), 0.5 * shown[i], np.float32))
        acc = np.zeros(len(self.rope_ix), np.float32)
        if idx:
            can = np.bincount(np.concatenate(idx), np.concatenate(vals), self.ch * self.cw).astype(np.float32)
            can = np.pad(can.reshape(self.ch, self.cw), 1)
            ry, rx = self.rope_iy + 1, self.rope_ix + 1
            acc = (can[ry, rx] + can[ry - 1, rx] + can[ry + 1, rx] + can[ry, rx - 1] + can[ry, rx + 1]) / 2.5
        acc = acc * self.rope_ok * (0.4 + 0.6 * self.level)
        out = np.clip(acc, 0, 1)[:, None] * np.asarray(colour, np.float32)
        return out.reshape(N_ROPES, N_PX, 3)
