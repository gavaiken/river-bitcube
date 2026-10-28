"""The remembered river's particle field (round 2, 27 Oct night, the artists on site): one field of falling water-like
particles in the room's own space, which the four screens look into like windows and which also lights the ropes it
passes. numpy only.

The space is the calibration's virtual frame (pixelmap-<date>.json meta.space: one frame holding the whole sculpture,
floor to rig), in frame pixels (x right, y up; frame_size 1440 x 808). Every rope LED has its place there (the map's
points) and every screen its centre, size and how it hangs (the screens file's corners; screen 1, edge-on to the camera
and placed by hand, hangs 15 deg counterclockwise as seen: Gavin). A screen is a window of its real size and rotation:
each of its 128 x 256 LEDs is a point in the frame, so a particle passing behind it is drawn there, upright to the room
(water falls toward the floor however the screen hangs), and a particle crossing from a rope to a screen is the same
particle.

Particles fall at the ropes' own speed (ropes.v_now, LEDs per second along a rope, converted with the map's LED spacing),
swirl sideways a little as they go, and come in numbers and brightness that follow the ropes' intensity: a few in calm,
a torrent in the surge. Each is drawn as a short streak along its motion.
"""
import json
import math
from pathlib import Path

import numpy as np

QW, QH, NQ = 128, 256, 4
N_ROPES, N_PX = 20, 400
FRAME = (1440.0, 808.0)
SCREEN_M = (0.32, 0.64)             # a screen: 128 x 256 LEDs at 2.5 mm
SCREEN1_ANGLE = 15.0                # deg, counterclockwise as seen (Gavin, 27 Oct: screen 1 can't be seen by the camera)
MAX_N = 3500
STREAK = 8                          # samples along each particle's streak
DOT_M = 0.018                       # a particle's radius in the room, metres (a few LEDs on a rope, ~10 on a screen)
ROPE_R = 2.2                        # a particle lights rope LEDs within this many frame px
ROPE_GAIN = 0.85


def _load(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError, TypeError):
        return None


def _box(a, r):
    """Box blur of radius r, both axes, zero outside."""
    p = np.pad(a, r)
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    k = 2 * r + 1
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


class Geometry:
    """Rope LEDs and screen windows in frame px. Built from the pinned map and screens files; a plain default without."""

    def __init__(self, pixelmap=None, screens=None):
        W, H = FRAME
        self.led_xy = None
        self.px_per_led = 1.9
        m = _load(pixelmap) if pixelmap else None
        if m and m.get('points'):
            fs = (m.get('meta') or {}).get('frame_size') or [W, H]
            W, H = float(fs[0]), float(fs[1])
            xy = np.full((N_ROPES, N_PX, 2), np.nan, np.float32)
            for p in m['points']:
                r, i, u, v = p.get('rope'), p.get('px'), p.get('u'), p.get('v')
                if r is None or i is None or u is None or v is None or not (0 <= r < N_ROPES and 0 <= i < N_PX):
                    continue
                xy[r, i] = (u * W, v * H)
            self.led_xy = xy
            d = np.hypot(*np.diff(xy, axis=1).transpose(2, 0, 1))
            if np.isfinite(d).any():
                self.px_per_led = float(np.nanmedian(d))
        if self.led_xy is None:                                   # default: 20 ropes side by side, 400 LEDs down
            xs = np.linspace(560, 880, N_ROPES)
            ys = np.linspace(780, 30, N_PX)
            self.led_xy = np.stack(np.meshgrid(xs, ys, indexing='ij'), -1).astype(np.float32)
        self.frame = (W, H)
        px_per_m = self.px_per_led / 0.025
        self.screens = []                                         # [(centre xy, angle rad CCW, width px, height px)]
        s = (_load(screens) or {}).get('screens') if screens else None
        for k in range(1, NQ + 1):
            e = (s or {}).get(str(k))
            if e and all(c in e for c in ('tl', 'tr', 'br', 'bl')):
                pts = {c: np.array([e[c][0] * W, e[c][1] * H]) for c in ('tl', 'tr', 'br', 'bl')}
                cxy = sum(pts.values()) / 4
                up = (pts['tl'] + pts['tr']) / 2 - (pts['bl'] + pts['br']) / 2
                h = float(np.hypot(*up))
                ang = math.atan2(-up[0], up[1])                     # 0 = upright, + = counterclockwise as seen
                if k == 1 or e.get('estimated'):
                    ang = math.radians(SCREEN1_ANGLE) if k == 1 else ang
                    h = max(h, SCREEN_M[1] * px_per_m * 1.2)
                self.screens.append((cxy, ang, h * SCREEN_M[0] / SCREEN_M[1], h))
            else:
                self.screens.append((np.array([W * (0.42 + 0.05 * k), H * (0.75 - 0.12 * k)]), 0.0,
                                     SCREEN_M[0] * px_per_m, SCREEN_M[1] * px_per_m))
        allp = np.concatenate([self.led_xy.reshape(-1, 2)[np.isfinite(self.led_xy.reshape(-1, 2)).all(1)],
                               np.array([c for c, *_ in self.screens])])
        self.x0, self.x1 = float(allp[:, 0].min()) - 20, float(allp[:, 0].max()) + 20
        self.y0, self.y1 = float(allp[:, 1].min()) - 10, float(allp[:, 1].max()) + 30
        flat = self.led_xy.reshape(-1, 2)
        ok = np.isfinite(flat).all(1)
        self.led_idx = np.nonzero(ok)[0]
        self.led_pts = flat[ok]


class Field:
    def __init__(self, geometry, seed=0):
        self.g = geometry
        self.rng = np.random.default_rng(seed + 7)
        self.p = np.zeros((0, 2), np.float32)        # positions
        self.v = np.zeros((0, 2), np.float32)        # velocities, frame px/s
        self.b = np.zeros(0, np.float32)             # brightness 0..1
        self.ph = np.zeros(0, np.float32)            # swirl phase
        self.t = 0.0
        self.spawn_debt = 0.0
        self.lit_pct = [0, 0, 0, 0]

    def step(self, dt, intensity, rope_speed_leds, turbulence=0.5):
        """Advance the field. intensity 0..1 (the ropes' level), rope_speed_leds: LEDs/s along a rope."""
        g, rng = self.g, self.rng
        self.t += dt
        speed = max(60.0, rope_speed_leds * g.px_per_led)          # frame px/s, never stalled
        rate = 40 + 1800 * intensity ** 1.5                         # particles per second
        self.spawn_debt += rate * dt
        n = min(int(self.spawn_debt), MAX_N - len(self.b))
        self.spawn_debt -= int(self.spawn_debt)
        if n > 0:
            x = rng.uniform(g.x0, g.x1, n)
            y = g.y1 + rng.uniform(0, 30, n)
            vy = -speed * rng.uniform(0.7, 1.3, n)
            self.p = np.concatenate([self.p, np.stack([x, y], 1).astype(np.float32)])
            self.v = np.concatenate([self.v, np.stack([np.zeros(n), vy], 1).astype(np.float32)])
            self.b = np.concatenate([self.b, (rng.uniform(0.35, 1.0, n) * (0.35 + 0.65 * intensity)).astype(np.float32)])
            self.ph = np.concatenate([self.ph, rng.uniform(0, 2 * math.pi, n).astype(np.float32)])
        if not len(self.b):
            return
        # fall toward the ropes' speed; swirl sideways (a slow vortex field), more with turbulence
        target = -speed * (0.8 + 0.4 * np.sin(self.ph * 3.1))
        self.v[:, 1] += (target - self.v[:, 1]) * min(1.0, dt * 2.0)
        swirl = (12 + 40 * turbulence) * np.sin(self.p[:, 1] / 37.0 + self.t * 0.7 + self.ph) \
            + 8 * np.sin(self.p[:, 0] / 23.0 - self.t * 1.3)
        self.v[:, 0] += (swirl - self.v[:, 0]) * min(1.0, dt * 1.5)
        self.p += self.v * dt
        keep = self.p[:, 1] > g.y0 - 10
        self.p, self.v, self.b, self.ph = self.p[keep], self.v[keep], self.b[keep], self.ph[keep]

    def _streak(self):
        """Sample points along each particle's streak (head brightest), [m, 2] and brightness [m]."""
        if not len(self.b):
            return np.zeros((0, 2), np.float32), np.zeros(0, np.float32)
        k = np.linspace(0.0, 1.0, STREAK, dtype=np.float32)
        tail = 0.025                                                    # seconds of motion the streak covers
        pts = self.p[None, :, :] - self.v[None, :, :] * tail * k[:, None, None]
        br = self.b[None, :] * (1.0 - 0.8 * k[:, None])
        return pts.reshape(-1, 2), br.reshape(-1)

    def render_screens(self, colour):
        """QH x (QW*4) x 3: each screen's window onto the field, upright to the room."""
        out = np.zeros((QH, QW * NQ, 3), np.float32)
        pts, br = self._streak()
        col = np.asarray(colour, np.float32)
        for k, (c, ang, w, h) in enumerate(self.g.screens):
            if not len(br):
                self.lit_pct[k] = 0
                continue
            d = pts - c
            ca, sa = math.cos(-ang), math.sin(-ang)
            lx = d[:, 0] * ca - d[:, 1] * sa                     # into the screen's own axes
            ly = d[:, 0] * sa + d[:, 1] * ca
            px = (lx / w + 0.5) * QW
            py = (0.5 - ly / h) * QH                               # row 0 at the top
            inside = (px > -3) & (px < QW + 3) & (py > -3) & (py < QH + 3)
            if not inside.any():
                self.lit_pct[k] = 0
                continue
            img = np.zeros((QH, QW), np.float32)
            xs, ys, bs = px[inside], py[inside], br[inside]
            ix, iy = np.floor(xs).astype(int), np.floor(ys).astype(int)
            ok = (ix >= 0) & (ix < QW) & (iy >= 0) & (iy < QH)
            np.add.at(img, (iy[ok], ix[ok]), bs[ok])
            r = max(1, int(round(DOT_M / 0.025 * self.g.px_per_led * QH / h / 2)))   # the particle's size here
            for _ in range(2):                                     # two box passes ~ a soft round drop
                img = _box(img, r)
            img *= (2 * r + 1) ** 2 * 0.55
            img = np.clip(img, 0.0, 1.0)
            out[:, k * QW:(k + 1) * QW] = img[..., None] * col
            self.lit_pct[k] = int(round(100 * float((img > 0.02).mean())))
        return out

    def render_ropes(self, colour):
        """N_ROPES x N_PX x 3: the light the particles add to the rope LEDs they pass (splat on a 1-px canvas over the
        sculpture, a small blur, sampled at every LED)."""
        g = self.g
        W, H = int(g.x1 - g.x0) + 1, int(g.y1 - g.y0) + 1
        can = np.zeros((H, W), np.float32)
        pts, br = self._streak()
        if len(br):
            ix = np.round(pts[:, 0] - g.x0).astype(int)
            iy = np.round(pts[:, 1] - g.y0).astype(int)
            ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
            np.add.at(can, (iy[ok], ix[ok]), br[ok])
            for _ in range(2):                                    # ~ROPE_R px of spread, both axes
                can = (can + np.roll(can, 1, 0) + np.roll(can, -1, 0)) / 2.2
                can = (can + np.roll(can, 1, 1) + np.roll(can, -1, 1)) / 2.2
        lx = np.clip(np.round(g.led_pts[:, 0] - g.x0).astype(int), 0, W - 1)
        ly = np.clip(np.round(g.led_pts[:, 1] - g.y0).astype(int), 0, H - 1)
        acc = can[ly, lx]
        out = np.zeros((N_ROPES * N_PX, 3), np.float32)
        out[g.led_idx] = np.clip(acc * ROPE_GAIN, 0, 1)[:, None] * np.asarray(colour, np.float32)
        return out.reshape(N_ROPES, N_PX, 3)
