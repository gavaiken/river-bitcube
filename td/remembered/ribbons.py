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
GRID = 192                       # rows the spine is computed on per screen band
TWINKLE = (0.55 + 0.45 * np.sin(np.arange(64) * 2 * math.pi / 64)).astype(np.float32)
TRAIL = 0.55                     # a little persistence: the glitter shimmers rather than flickers


def _soft(a):
    p = np.pad(a, 1)
    h = p[:, :-2] + p[:, 1:-1] + p[:, 2:]
    return (h[:-2] + h[1:-1] + h[2:]) / 9.0


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

    def render_screens(self, colour):
        out = np.zeros((QH, QW * NQ, 3), np.float32)
        col = np.asarray(colour, np.float32)
        shown = self._shown()
        bright = 0.9 + 0.5 * self.level
        for k, (cx, cy, ang, w, h) in enumerate(self.screens):
            img = np.zeros(QH * QW, np.float32)
            ca, sa = math.cos(ang), math.sin(ang)
            ylo, yhi = self.band[k]
            span = yhi - ylo
            for i in range(N_RIB):
                if shown[i] <= 0.01:
                    continue
                u = (self.pu[k, i] - self.flow * self.rib[i]['spd'] / span) % 1.0
                y = yhi - u * span
                # (speed) the spine on GRID rows of the band, then looked up per point: trig on 192 rows, not 3,800 points
                xs, c, sn, W = self._spine(i, yhi - (np.arange(GRID) + 0.5) / GRID * span)
                g = np.minimum((u * GRID).astype(np.int32), GRID - 1)
                vW = self.pv[k, i] * W[g]
                x, yy, face = xs[g] + vW * c[g], y + vW * sn[g] * 0.45, np.abs(sn[g])
                dx, dy = x - cx, yy - cy
                lx = dx * ca + dy * sa
                ly = -dx * sa + dy * ca
                fx = (lx / w + 0.5) * QW
                fy = (0.5 - ly / h) * QH
                ix, iy = fx.astype(np.int32), fy.astype(np.int32)
                ok = (fx >= 0) & (ix < QW) & (fy >= 0) & (iy < QH)
                if not ok.any():
                    continue
                tw = TWINKLE[(self.pw[k, i] * self.t + self.pph[k, i]).astype(np.int32) & 63]
                val = self.pbe[k, i] * tw * (0.55 + 0.45 * face) * (shown[i] * bright)
                img += np.bincount((iy[ok] * QW + ix[ok]), val[ok], QH * QW).astype(np.float32)
            img = img.reshape(QH, QW)
            # loose glitter and bokeh
            dd = self.dust[k]
            di = dd.astype(np.int32)
            twd = 0.5 + 0.5 * np.sin(self.t * 5.0 + self.dust_b[k] * 40)
            img += np.bincount(di[:, 1] * QW + di[:, 0], self.dust_b[k] * twd * (0.2 + 0.35 * self.level),
                               QH * QW).astype(np.float32).reshape(QH, QW)
            for b in range(BOKEH):
                r = float(self.bok_r[k, b])
                key = round(r * 2) / 2
                disc = self.discs.get(key)
                if disc is None:
                    disc = self.discs[key] = _disc(key)
                n = disc.shape[0] // 2
                bx, by = int(self.bok[k, b, 0]), int(self.bok[k, b, 1])
                a = 0.10 * (0.5 + 0.5 * math.sin(self.t * 0.6 + float(self.bok_ph[k, b]))) * (0.4 + 0.6 * self.level)
                x0, x1, y0, y1 = max(0, bx - n), min(QW, bx + n + 1), max(0, by - n), min(QH, by + n + 1)
                if x0 < x1 and y0 < y1:
                    img[y0:y1, x0:x1] += disc[y0 - by + n:y1 - by + n, x0 - bx + n:x1 - bx + n] * a
            glow = _soft(_soft(img))
            frame = img * 0.5 + glow * 1.5
            tr = np.maximum(self.trails[k] * TRAIL, frame)
            tr[tr < 0.015] = 0.0
            self.trails[k] = tr
            v = np.clip(tr, 0, 1.6)
            rgb = v[..., None] * col + np.clip(v - 0.55, 0, 1)[..., None] * (1 - col)      # the brightest go to white
            out[:, k * QW:(k + 1) * QW] = np.clip(rgb, 0, 1)
            self.lit_pct[k] = int(round(100 * float((tr > 0.03).mean())))
        return out

    def render_ropes(self, colour):
        can = np.zeros(self.ch * self.cw, np.float32)
        shown = self._shown()
        span = self.y1 - self.y0 + 60
        for i in range(N_RIB):
            if shown[i] <= 0.01:
                continue
            u = (self.ru[i] - self.flow * self.rib[i]['spd'] / span) % 1.0
            y = self.y1 + 30 - u * span
            x, yy, face = self._sheet(i, y, self.rv[i])
            ix = np.round(x - self.cx0).astype(np.int32)
            iy = np.round(yy - self.cy0).astype(np.int32)
            ok = (ix >= 0) & (ix < self.cw) & (iy >= 0) & (iy < self.ch)
            can += np.bincount(iy[ok] * self.cw + ix[ok], np.full(ok.sum(), 0.5 * shown[i], np.float32),
                               self.ch * self.cw).astype(np.float32)
        can = can.reshape(self.ch, self.cw)
        can = (can + np.roll(can, 1, 0) + np.roll(can, -1, 0) + np.roll(can, 1, 1) + np.roll(can, -1, 1)) / 2.5
        acc = can[self.rope_iy, self.rope_ix] * self.rope_ok * (0.4 + 0.6 * self.level)
        out = np.clip(acc, 0, 1)[:, None] * np.asarray(colour, np.float32)
        return out.reshape(N_ROPES, N_PX, 3)
