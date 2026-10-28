"""M2, the fine particle field (28 Oct; the artists: "finer, closer to smoke, particle physics with swirling, sloshing
between the screens and across the ropes, hitting the edges of the screens, falling from the top"). numpy only.

Replaces particles.py's rope-sized streaks on the remembered river's screens (particles.py stays, checkpoint
remembered-particles-v1). The same API: step(dt, intensity, rope_speed_leds, turbulence), render_screens(colour),
render_ropes(colour), lit_pct.

The space is the filling glass's (td/filling/space.py): x across the piece in the calibration's frame px, y = height
above the floor in the same scale (from the zones file for the ropes; the measured chain and tilts for the screens), so a
screen and the ropes beside it agree from anywhere in the room.

  flow     fine particles fall at the ropes' speed through a swirling, divergence-free field (the curl of a moving
           stream function: it swirls and never clumps), more swirl with Dave's turbulence; numbers and brightness follow
           the ropes' own level (a few in calm, a torrent in a surge)
  ledges   each screen's lower edge, at its real tilt, is a surface: a particle reaching it from above lands on it, runs
           downhill along it (faster the steeper the tilt), and spills off the low corner, falling on through the ropes
  screens  each a window onto the field at its real size and tilt; particles are soft round dots of 1-3 LEDs; the screen
           keeps a short fading trace (smoke), decaying to true black
  ropes    the same particles light the rope LEDs they pass (a small canvas over the piece, sampled at every LED)
"""
import math

import numpy as np

QW, QH, NQ = 128, 256, 4
N_ROPES, N_PX = 20, 400
SCREEN_M = (0.32, 0.64)
MAX_N = 4000
TRAIL = 0.80                    # a screen keeps this much of its last frame (at 30 Hz): a smoky trace (~0.2 s)
PLUME = 0.75                    # share of the water released above the screens: it falls as plumes through the windows
SWIRL = (0.35, 1.0)             # swirl strength at calm turbulence, and at full (x the fall speed)
LEDGE_RUN = 1.4                 # x the fall speed: how fast water runs down a ledge (scaled by the tilt)
SIZES = (0.6, 1.0, 1.7)         # dot radius on a screen, LEDs: most small, some larger (weights below)
SIZE_W = (0.55, 0.3, 0.15)
STREAK = 8                      # sub-steps a dot is drawn at between two frames: motion blur, a streak not a dotted line
FALL_SCALE = 0.7                # the particles fall a little slower than the ropes' water: smoke, not rain
GLOW = 0.8                      # share of a dot's light spread as a soft halo (two box blurs): rounded, smoky


def _stream(x, y, t, s):
    """The stream function and its gradient: a few moving sines (smooth, cheap). The flow is its curl."""
    a1, a2, a3 = 0.021, 0.047, 0.011
    p1 = a1 * x + 0.9 * t + s[0]
    q1 = a1 * 0.8 * y - 0.6 * t + s[1]
    p2 = a2 * x - 1.3 * t + s[2]
    q2 = a2 * 1.1 * y + 1.1 * t + s[3]
    p3 = a3 * (x + y) + 0.4 * t + s[4]
    # psi = sin p1 sin q1 + 0.5 sin p2 sin q2 + 1.5 sin p3
    dpdx = a1 * np.cos(p1) * np.sin(q1) + 0.5 * a2 * np.cos(p2) * np.sin(q2) + 1.5 * a3 * np.cos(p3)
    dpdy = a1 * 0.8 * np.sin(p1) * np.cos(q1) + 0.5 * a2 * 1.1 * np.sin(p2) * np.cos(q2) + 1.5 * a3 * np.cos(p3)
    return dpdx, dpdy


def _soft(a):
    """A 3 x 3 box blur, edges zero (cheap: shifted sums)."""
    p = np.pad(a, 1)
    h = p[:, :-2] + p[:, 1:-1] + p[:, 2:]
    return (h[:-2] + h[1:-1] + h[2:]) / 9.0


class FineField:
    """The fine particle field. Built from the filling glass's Space (rope LEDs and screens by real height)."""

    @classmethod
    def from_files(cls, pixelmap=None, screens=None, zones=None, seed=0):
        from filling import space as space_mod                  # lazy: filling imports remembered
        return cls(space_mod.Space(pixelmap, screens, zones, down=4), seed)

    def __init__(self, space, seed=0):
        from filling import space as space_mod
        self.sp = space
        S = space.px_per_m
        hts = space_mod.screen_heights(getattr(space, 'zones_data', None))
        # screens in this space: centre, angle (CCW), size, as the filling glass draws them
        self.screens = []
        for k, (c, ang, _w, _h) in enumerate(space.g.screens, start=1):
            cy = space.screen_full[k - 1][:, 1].mean()
            self.screens.append((float(c[0]), float(cy), float(ang), SCREEN_M[0] * S, SCREEN_M[1] * S))
        self.rng = np.random.default_rng(seed + 17)
        self.seed = self.rng.uniform(0, 2 * math.pi, 5)
        self.x0, self.x1, self.y0, self.y1 = space.x0, space.x1, space.y0, space.y1
        self.p = np.zeros((0, 2), np.float32)
        self.pp = np.zeros((0, 2), np.float32)                      # where each was a frame ago (the streak)
        self.v = np.zeros((0, 2), np.float32)
        self.b = np.zeros(0, np.float32)
        self.r = np.zeros(0, np.float32)
        self.ledge = np.full(0, -1, np.int8)                         # which screen's ledge a particle runs along
        self.t = 0.0
        self.debt = 0.0
        self.fall = 80.0
        self.trails = np.zeros((NQ, QH, QW), np.float32)
        self.lit_pct = [0, 0, 0, 0]
        rope = space.rope
        ok = rope[:, 0] > -1e3
        self.rope_ok = ok
        self.cx0, self.cy0 = self.x0, self.y0 - 10
        self.cw = int(self.x1 - self.x0) + 2
        self.ch = int(self.y1 - self.y0) + 40
        self.rope_ix = np.clip(np.round(rope[:, 0] - self.cx0).astype(int), 0, self.cw - 1)
        self.rope_iy = np.clip(np.round(rope[:, 1] - self.cy0).astype(int), 0, self.ch - 1)

    # ---- motion ------------------------------------------------------------------------------------------------------

    def step(self, dt, intensity, rope_speed_leds, turbulence=0.5):
        if dt <= 0:
            return
        sp, rng = self.sp, self.rng
        self.t += dt
        px_led = sp.g.px_per_led
        self.fall = max(35.0, FALL_SCALE * rope_speed_leds * px_led)              # frame px/s, never stalled
        inten = max(0.0, min(1.0, intensity))
        rate = 120 + 4200 * inten ** 1.5
        self.debt += rate * dt
        n = min(int(self.debt), MAX_N - len(self.b))
        self.debt -= int(self.debt)
        if n > 0:
            x = rng.uniform(self.x0 - 20, self.x1 + 20, n)
            plume = rng.random(n) < PLUME                         # most of it falls through the screens' columns
            if plume.any():
                k = rng.integers(0, len(self.screens), plume.sum())
                cxs = np.array([c[0] for c in self.screens])[k]
                wid = np.array([c[3] for c in self.screens])[k]
                x[plume] = cxs + rng.normal(0, 0.45, plume.sum()) * wid
            y = self.y1 + rng.uniform(0, 40, n)
            self.p = np.concatenate([self.p, np.stack([x, y], 1).astype(np.float32)])
            self.v = np.concatenate([self.v, np.zeros((n, 2), np.float32)])
            self.b = np.concatenate([self.b, (rng.uniform(0.35, 1.0, n) * (0.4 + 0.6 * inten)).astype(np.float32)])
            self.r = np.concatenate([self.r, rng.choice(SIZES, n, p=SIZE_W).astype(np.float32)])
            self.ledge = np.concatenate([self.ledge, np.full(n, -1, np.int8)])
        if not len(self.b):
            return
        p, v = self.p, self.v
        free = self.ledge < 0
        # the swirling flow (curl of the stream function), scaled to the fall speed, plus the fall itself
        sw = SWIRL[0] + (SWIRL[1] - SWIRL[0]) * turbulence
        dpdx, dpdy = _stream(p[:, 0], p[:, 1], self.t, self.seed)
        k = sw * self.fall / 0.03
        target = np.stack([dpdy * k, -dpdx * k - self.fall], 1).astype(np.float32)
        v[free] += (target[free] - v[free]) * min(1.0, dt * 4.0)
        prev = p.copy()
        p[free] += v[free] * dt
        # ledges: a particle crossing a screen's lower edge from above lands on it and runs downhill
        for j, (cx, cy, ang, w, h) in enumerate(self.screens):
            ca, sa = math.cos(ang), math.sin(ang)
            def local(q):
                d = q - (cx, cy)
                return d[:, 0] * ca + d[:, 1] * sa, -d[:, 0] * sa + d[:, 1] * ca
            lx0, ly0 = local(prev)
            lx1, ly1 = local(p)
            hit = free & (ly0 > -h / 2) & (ly1 <= -h / 2) & (np.abs(lx1) < w / 2)
            if hit.any():
                self.ledge[hit] = j
                p[hit] = np.stack([cx + lx1[hit] * ca - (-h / 2 + 0.5) * sa, cy + lx1[hit] * sa + (-h / 2 + 0.5) * ca], 1)
            on = self.ledge == j
            if on.any():
                # downhill along the edge: the edge's direction (ca, sa) points right; it slopes by the tilt
                down = -1.0 if sa > 0 else 1.0                       # tilted CCW: the left end is lower
                run = LEDGE_RUN * self.fall * max(0.15, abs(sa)) * down
                lx, _ = local(p[on])
                lx = lx + run * dt
                off = np.abs(lx) >= w / 2
                p[on] = np.stack([cx + lx * ca - (-h / 2 + 0.5) * sa, cy + lx * sa + (-h / 2 + 0.5) * ca], 1)
                idx = np.nonzero(on)[0]
                spill = idx[off]
                if len(spill):                                       # spilled off the low corner: falls on
                    self.ledge[spill] = -1
                    v[spill] = np.stack([np.full(len(spill), run * ca * 0.6), np.full(len(spill), -0.3 * self.fall)], 1)
        keep = (p[:, 1] > self.y0 - 15) & (p[:, 0] > self.x0 - 60) & (p[:, 0] < self.x1 + 60)
        self.pp = prev
        if not keep.all():
            self.pp = prev[keep]
            self.p, self.v, self.b, self.r, self.ledge = p[keep], v[keep], self.b[keep], self.r[keep], self.ledge[keep]

    # ---- drawing ------------------------------------------------------------------------------------------------------

    def render_screens(self, colour):
        """QH x (QW*4) x 3: each screen's window onto the field, upright to the room, with a short fading trace."""
        out = np.zeros((QH, QW * NQ, 3), np.float32)
        col = np.asarray(colour, np.float32)
        p, b, r = self.p, self.b, self.r
        pp = self.pp if len(self.pp) == len(p) else p
        for k, (cx, cy, ang, w, h) in enumerate(self.screens):
            img = np.zeros((QH + 2, QW + 2), np.float32)
            if len(b):
                ca, sa = math.cos(ang), math.sin(ang)
                def to_screen(q):
                    d = q - (cx, cy)
                    lx = d[:, 0] * ca + d[:, 1] * sa
                    ly = -d[:, 0] * sa + d[:, 1] * ca
                    return (lx / w + 0.5) * QW, (0.5 - ly / h) * QH
                fx1, fy1 = to_screen(p)
                fx0, fy0 = to_screen(pp)
                ins = ((np.minimum(fx0, fx1) < QW + 2) & (np.maximum(fx0, fx1) > -2)
                       & (np.minimum(fy0, fy1) < QH + 2) & (np.maximum(fy0, fy1) > -2))
                if ins.any():
                    fx0, fy0, fx1, fy1, bb, rr = fx0[ins], fy0[ins], fx1[ins], fy1[ins], b[ins], r[ins]
                    bb = bb * (0.55 + 0.45 * rr)                    # the larger drops carry more light (spread by the glow)
                    for st in range(STREAK):                         # a streak from where it was to where it is
                        a = (st + 1) / STREAK
                        fx, fy = fx0 + (fx1 - fx0) * a, fy0 + (fy1 - fy0) * a
                        wt_s = bb * (1.6 / STREAK)                    # even along the streak (no beads)
                        ix, iy = np.floor(fx).astype(int), np.floor(fy).astype(int)
                        ax, ay = fx - ix, fy - iy
                        for ox, oy, wt in ((0, 0, (1 - ax) * (1 - ay)), (1, 0, ax * (1 - ay)), (0, 1, (1 - ax) * ay), (1, 1, ax * ay)):
                            jx, jy = ix + ox + 1, iy + oy + 1
                            ok = (jx >= 0) & (jx < QW + 2) & (jy >= 0) & (jy < QH + 2)
                            np.add.at(img, (jy[ok], jx[ok]), (wt_s * wt)[ok])
            img = img[1:-1, 1:-1]
            halo = _soft(_soft(_soft(img)))                               # the soft round halo: smoke, never a hard pixel
            img = img * (1 - GLOW) + halo * GLOW * 9.0
            frame = np.clip(img * 2.2, 0, 1)
            tr = np.maximum(self.trails[k] * TRAIL, frame)
            tr[tr < 0.02] = 0.0                                      # the trace decays to true black
            self.trails[k] = tr
            out[:, k * QW:(k + 1) * QW] = tr[..., None] * col
            self.lit_pct[k] = int(round(100 * float((tr > 0.02).mean())))
        return out

    def render_ropes(self, colour):
        """N_ROPES x N_PX x 3: the light the particles add to the rope LEDs they pass."""
        can = np.zeros((self.ch, self.cw), np.float32)
        if len(self.b):
            ix = np.round(self.p[:, 0] - self.cx0).astype(int)
            iy = np.round(self.p[:, 1] - self.cy0).astype(int)
            ok = (ix >= 0) & (ix < self.cw) & (iy >= 0) & (iy < self.ch)
            np.add.at(can, (iy[ok], ix[ok]), self.b[ok])
            can = (can + np.roll(can, 1, 0) + np.roll(can, -1, 0) + np.roll(can, 1, 1) + np.roll(can, -1, 1)) / 2.5
        acc = can[self.rope_iy, self.rope_ix] * self.rope_ok
        out = np.clip(acc, 0, 1)[:, None] * np.asarray(colour, np.float32)
        return out.reshape(N_ROPES, N_PX, 3)
