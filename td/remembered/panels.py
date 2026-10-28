"""The remembered river on the four HUB75 screens: one 256 x 512 RGB image (float 0..1, row 0 at the top) holding the four
screens upright side by side (screen k in columns 128*(k-1) .. 128*k), each 128 x 256 portrait. numpy only.

The artists' rules: at least 70 % black (at most 30 % of each screen lit, enforced by an adaptive threshold); foam =
the river footage reduced to its moving highlights (frame difference, keep only the brightest ~15 % of motion) tinted to
the palette, from the live river cam (the recorded clip as fallback; IR at night is greyscale, fine); the day's flow
line traced across one screen (time across, flow up) with a point at the current hour; a soft 10 px fade at every
edge; each screen a different crop and scale of the same water, turned to cancel its tilt so water falls toward the
floor; motion matched to the rope speed at its height; brightness cap 55 %. Calm: almost black (a drop every few
seconds, at most three forms); building wakes the 2nd and 3rd screens; surge: every screen lit, in height order as the
front passes; settling: dark top-down, the last holds a frame of foam fading over 5 s; the decision wave wipes a line
down each screen in step with the ropes. No text, no people, no hard cuts.
"""
import math

import numpy as np

from . import ropes as ropes_mod

QW, QH, NQ = 128, 256, 4
MW, MH = 320, 180                  # the motion map (river frame downsampled)
CAP = 0.55                         # panel brightness cap
LIT_MAX = 0.30                     # at most 30 % of a screen lit
LIT_EPS = 0.02                     # what counts as lit
EDGE_PX = 10.0
MOTION_KEEP = 0.15                 # keep the brightest 15 % of motion
FOAM_DECAY = 0.55                  # per river frame: foam lingers a few frames, then goes
PANEL_PX_PER_M = 400.0             # P2.5 HUB75: 400 LEDs per metre
MAX_SCROLL = 360.0                 # px/s: faster water streaks rather than teleports
LIMITS = {'calm': 0.0, 'building': 0.06, 'surge': 0.22, 'settling': 0.12}
GATE_RATE = 1 / 0.8                # gates open/close over >= 0.8 s
MEAN_RATE = 0.15                   # a screen's mean brightness per second (the safety ramp)
# Each screen's crop of the river (centre u, v in 0..1 and height as a fraction of the frame): different, never mirrored.
CROPS = [(0.30, 0.42, 0.85), (0.66, 0.38, 0.55), (0.45, 0.62, 1.0), (0.72, 0.66, 0.42)]


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def lit_fraction(img):
    return float((img.max(axis=-1) > LIT_EPS).mean()) if img.ndim == 3 else float((img > LIT_EPS).mean())


def cap_lit(i, limit):
    """Keep at most `limit` of the pixels lit: zero everything under the (1 - limit) quantile."""
    n = i.size
    keep = int(limit * n)
    if (i > LIT_EPS).sum() <= keep:
        return i
    if keep <= 0:
        return np.zeros_like(i)
    thr = np.partition(i.ravel(), n - keep - 1)[n - keep - 1]
    return np.where(i > max(thr, LIT_EPS), i, 0.0)


def to_luma(img):
    a = np.asarray(img)
    if a.dtype == np.uint8:
        a = a.astype(np.float32) / 255.0
    a = a.astype(np.float32)
    if a.ndim == 2:
        return a
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def resize_nearest(g, w=MW, h=MH):
    ys = (np.arange(h) * g.shape[0]) // h
    xs = (np.arange(w) * g.shape[1]) // w
    return g[ys][:, xs]


class Motion:
    """River frames -> the foam map: frame difference, keep the brightest MOTION_KEEP of it, lingering a few frames."""

    def __init__(self):
        self.prev = None
        self.foam = np.zeros((MH, MW), np.float32)
        self.level = 0.0
        self.peak = 1e-3
        self.frames = 0

    def feed(self, img):
        g = resize_nearest(to_luma(img))
        if self.prev is None:
            self.prev = g
            return
        d = np.abs(g - self.prev)
        self.prev = g
        d = (d + np.roll(d, 1, 0) + np.roll(d, -1, 0) + np.roll(d, 1, 1) + np.roll(d, -1, 1)) / 5.0
        n = d.size
        k = int((1 - MOTION_KEEP) * n)
        thr = np.partition(d.ravel(), k)[k]
        top = np.partition(d.ravel(), n - n // 100 - 1)[n - n // 100 - 1]
        m = np.clip((d - thr) / max(top - thr, 1e-3), 0.0, 1.0)
        self.foam = np.maximum(self.foam * FOAM_DECAY, m).astype(np.float32)
        hi = float(d[d > thr].mean()) if (d > thr).any() else 0.0
        self.peak = max(self.peak * 0.995, hi)
        self.level = float(min(1.0, hi / self.peak)) if self.peak > 1e-3 else 0.0
        self.frames += 1


class Panels:
    def __init__(self, zones, seed=0):
        self.z = zones
        rng = np.random.default_rng(seed + 101)
        self.motion = Motion()
        self.order = zones.screen_order()                      # screen indices, highest first
        jj, ii = np.meshgrid(np.arange(QW, dtype=np.float32) - (QW - 1) / 2, np.arange(QH, dtype=np.float32) - (QH - 1) / 2)
        self.world = []
        for s in zones.screens:
            th = math.radians(s['tilt_deg'])
            xw = jj * math.cos(th) - ii * math.sin(th)
            yw = jj * math.sin(th) + ii * math.cos(th)
            self.world.append((xw.astype(np.float32), yw.astype(np.float32)))
        di = np.minimum(np.arange(QH), np.arange(QH)[::-1]).astype(np.float32)[:, None]
        dj = np.minimum(np.arange(QW), np.arange(QW)[::-1]).astype(np.float32)[None, :]
        self.edge = (smooth(di / EDGE_PX) * smooth(dj / EDGE_PX)).astype(np.float32)
        self.scroll = np.zeros(NQ)
        self.gate = np.zeros(NQ)
        self.drops = [None] * NQ
        self.next_drop = rng.uniform(0.5, 3.0, NQ)
        self.rng = rng
        self.time = 0.0
        self.hold = None                                        # (image, start time) for the last screen
        self.mean = [None] * NQ
        self.lit_pct = [0, 0, 0, 0]
        self._line_key = None
        self._line = None
        self._line_img = None
        self._geometry()

    # ---- targets ----------------------------------------------------------------------------------------------------

    def _front_times(self, c):
        """Loop seconds when the surge front passes each screen's height."""
        tm = c['times']
        if tm is None:
            return None
        vmax = ropes_mod.front_vmax(c['flow_pct'])
        floor = float(np.median(self.z.floor_px))
        top = self.z.top_m
        out = []
        for s in self.z.screens:
            px = max(0.0, (top - s['height_m']) * 40.0)
            out.append(tm['surge'] + float(ropes_mod.front_time(px, floor, vmax)))
        return out

    def _targets(self, c):
        """(gate target per screen, motion limit) for this moment."""
        t, tm, ph = c['t'], c['times'], c['phase']
        g = np.zeros(NQ)
        if tm is None or ph == 'calm':
            return g, 0.0
        if ph == 'building':
            b = float(smooth((t - tm['build']) / max(1.0, tm['drawback'] - tm['build'])))
            if t < tm['drawback']:
                for i in self.order[1:3]:
                    g[i] = b
            return g, LIMITS['building']
        if ph == 'surge':
            for i, tf in enumerate(self._front_times(c)):
                g[i] = 1.0 if t >= tf else 0.0
            return g, LIMITS['surge']
        ls = max(1.0, tm['calm'] - tm['settle'])
        for rank, i in enumerate(self.order):
            g[i] = 1.0 if t < tm['settle'] + ls * (0.15 + 0.15 * rank) else 0.0
        return g, LIMITS['settling']

    # ---- pieces (intensity images, 256 x 128, 0..1) ------------------------------------------------------------------

    def _geometry(self):
        """Per screen: where each LED samples the motion map (x fixed; y moves with the scroll)."""
        self.geo = []
        for k, (xw, yw) in enumerate(self.world):
            cu, cv, sc = CROPS[k % len(CROPS)]
            f = sc * MH / QH
            mx = np.mod(cu * MW + xw * f, MW - 1)
            x0 = mx.astype(np.int32)
            self.geo.append({'f': f, 'x0': x0, 'fx': (mx - x0).astype(np.float32), 'my': cv * MH + yw * f})

    def _sample(self, k):
        g = self.geo[k]
        my = np.mod(g['my'] - self.scroll[k] * g['f'], MH - 1)
        y0 = my.astype(np.int32)
        fy = my - y0
        x0, fx = g['x0'], g['fx']
        m = self.motion.foam
        top = m[y0, x0] + (m[y0, x0 + 1] - m[y0, x0]) * fx
        bot = m[y0 + 1, x0] + (m[y0 + 1, x0 + 1] - m[y0 + 1, x0]) * fx
        return top + (bot - top) * fy

    def _window(self, k, wx, wy, r):
        """Panel-pixel slices around a world point (r px each way), for small forms."""
        th = math.radians(self.z.screens[k]['tilt_deg'])
        px = wx * math.cos(th) + wy * math.sin(th) + (QW - 1) / 2       # inverse of the world rotation
        py = -wx * math.sin(th) + wy * math.cos(th) + (QH - 1) / 2
        i0, i1 = int(max(0, py - r)), int(min(QH, py + r + 1))
        j0, j1 = int(max(0, px - r)), int(min(QW, px + r + 1))
        if i0 >= i1 or j0 >= j1:
            return None
        return slice(i0, i1), slice(j0, j1)

    def _blob(self, img, k, wx, wy, sx, sy, level):
        win = self._window(k, wx, wy, int(3 * max(sx, sy)) + 2)
        if win is None:
            return
        xw, yw = self.world[k]
        b = level * np.exp(-((xw[win] - wx) / sx) ** 2 - ((yw[win] - wy) / sy) ** 2)
        img[win] = np.maximum(img[win], np.where(b > 0.03, b, 0.0))

    def _flow_line(self, k, c, img):
        day = c.get('day') or {}
        flow = ((day.get('profile') or {}).get('flow')) or []
        key = (day.get('date'), tuple(flow))
        if key != self._line_key:
            self._line_key = key
            vals = [v for v in flow if v is not None]
            self._line = None
            self._line_img = None
            if vals:
                lo, hi = min(vals), max(vals)
                self._line = [None if v is None else (v - lo) / (hi - lo if hi > lo else 1.0) for v in flow]
                xw, yw = self.world[k]
                hours = np.clip((xw + 50.0) / 100.0 * 24.0, 0, 23.999)
                known = np.array([v if v is not None else np.nan for v in self._line], np.float32)
                i = hours.astype(np.int32)
                a, b = known[i], known[np.minimum(i + 1, 23)]
                val = np.where(np.isfinite(b), a + (b - a) * (hours - i), a)
                yl = 105.0 - 60.0 * val
                line = np.clip(1.0 - np.abs(yw - yl), 0, 1) * 0.25
                line = np.where((np.abs(xw) <= 50.0) & np.isfinite(val) & (line > 0.03), line, 0.0)
                self._line_img = line.astype(np.float32)
        if self._line_img is None:
            return
        np.maximum(img, self._line_img, out=img)
        h = float(c['t']) / 12.5
        if 0 <= h < 24 and self._line[int(h)] is not None:
            nxt = self._line[min(23, int(h) + 1)]
            v = self._line[int(h)] + ((nxt - self._line[int(h)]) * (h - int(h)) if nxt is not None else 0.0)
            self._blob(img, k, -50.0 + h / 24.0 * 100.0, 105.0 - 60.0 * v, 2.5, 2.5, 0.6)

    def _drop(self, k, dt, speed, img):
        T = self.time
        d = self.drops[k]
        if d is None and T >= self.next_drop[k]:
            d = self.drops[k] = {'x': float(self.rng.uniform(-45, 45)), 'y': -140.0}
            self.next_drop[k] = T + float(self.rng.uniform(3.0, 6.0))
        if d is None:
            return
        d['y'] += speed * dt
        if d['y'] > 150:
            self.drops[k] = None
            return
        self._blob(img, k, d['x'], d['y'], 1.6, 3.5, 0.6)

    def _wipe(self, k, c, img):
        w = c.get('wave')
        if w is None:
            return
        floor = float(np.median(self.z.floor_px))
        frac = min(1.2, (w / 8.0) * (floor + 20.0) / max(1.0, floor))
        yl = (self.z.screens[k]['height_m'] - self.z.top_m * (1.0 - frac)) * PANEL_PX_PER_M
        if abs(yl) > QH:
            return
        amp = float(smooth(w / 0.6) * smooth((8.0 - w) / 0.6))
        yw = self.world[k][1]
        np.maximum(img, np.clip(1.0 - np.abs(yw - yl) / 1.5, 0, 1) * 0.45 * amp, out=img)

    # ---- one frame ---------------------------------------------------------------------------------------------------

    def feed(self, img):
        self.motion.feed(img)

    def step(self, dt, c):
        dt = max(0.0, min(float(dt), 0.25))
        self.time += dt
        pal = c['pal']
        if c.get('light') in ('pool', 'eddies', 'leds'):
            self.lit_pct = [0, 0, 0, 0]
            self.mean = [0.0] * NQ
            return np.zeros((QH, QW * NQ, 3), np.float32)
        target, limit = self._targets(c)
        step = GATE_RATE * dt
        self.gate = np.clip(self.gate + np.clip(target - self.gate, -step, step), 0, 1)
        scroll_v = min(MAX_SCROLL, float(c.get('rope_speed', 20.0)) / 40.0 * PANEL_PX_PER_M)
        self.scroll += scroll_v * dt
        level = CAP * (1 - 0.3 * float(c.get('night', 0.0)))
        tm = c['times']
        last = self.order[-1]
        drops = c['phase'] == 'calm' or (tm is not None and c['phase'] == 'building' and c['t'] < tm['drawback'])
        I = np.zeros((QH, QW * NQ), np.float32)
        for k in range(NQ):
            i_k = np.zeros((QH, QW), np.float32)
            if self.gate[k] > 0.001 and limit > 0:
                i_k = cap_lit(self._sample(k), limit) * self.gate[k]
            if drops:
                self._drop(k, dt, scroll_v, i_k)
            if k == last:
                self._flow_line(k, c, i_k)
            self._wipe(k, c, i_k)
            i_k = cap_lit(i_k * self.edge, LIT_MAX) * level
            if k == last:
                if c['phase'] == 'settling' and self.gate[k] < 0.999 and self.hold is None:
                    self.hold = (i_k.copy(), self.time)
                if self.hold is not None:
                    age = self.time - self.hold[1]
                    if age < 5.0 and c['phase'] == 'settling':
                        i_k = np.maximum(i_k, self.hold[0] * (1 - age / 5.0))
                    elif c['phase'] != 'settling':
                        self.hold = None
            i_k = self._ramp(k, i_k, dt)
            I[:, QW * k:QW * (k + 1)] = i_k
            self.lit_pct[k] = int(round(100 * float((i_k > LIT_EPS).mean())))
        mid = ropes_mod.norm(pal['mid'])
        light = ropes_mod.norm(pal['light'])
        w = np.clip(I / max(level, 1e-3), 0, 1)[..., None]
        return np.minimum(I[..., None] * (mid + (light - mid) * w), CAP).astype(np.float32)

    def _ramp(self, k, img, dt):
        m = float(img.mean())
        prev = self.mean[k]
        if prev is not None and m > 0:
            step = MEAN_RATE * dt
            if m > prev + step:
                img = img * ((prev + step) / m)
            elif m < prev - step:
                img = img * min(1.6, (prev - step) / m)
        self.mean[k] = float(img.mean())
        return img

