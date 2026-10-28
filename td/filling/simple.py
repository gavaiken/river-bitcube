"""Fill my cup (simple): the filling glass as the artists first saw it on 27 Oct (smooth churn, a slosh, the crest), the
look they liked best, on the same real-height space as the configurable one, its spray and drips now soft round
particles of varying sizes instead of single pixels. The dials (palette, brightness, speed) apply here too."""
import math

import numpy as np

from filling.fill import Fill, PALETTES, CYCLE_S, FILL_S, HOLD_S, level_at


class SimpleFill(Fill):
    def colours(self, t, clock=None, dt=1 / 30):
        if clock is not None:
            self.clock = clock
        st = self.settings
        pal = {k: np.array(v, np.float32) for k, v in PALETTES[st['palette']].items()}
        x, y = self.pts[:, 0], self.pts[:, 1]
        W = self.x1 - self.x0
        lv, wild, phase, full = level_at(t, self.y0, self.y1)
        self.state = (phase, full)
        tt, s, tc = t % CYCLE_S, self.seed, self.clock

        def surf_fn(xx):
            xn = (xx - self.x0) / W
            slosh = math.sin(tc * 1.3 + s[0]) * np.cos(math.pi * xn) * (55 * wild + 8)
            chop = (np.sin(xn * 9.0 - tc * 3.1 + s[1]) * 14 + np.sin(xn * 23.0 + tc * 4.7 + s[2]) * 6) * (0.4 + wild)
            return lv + slosh + chop

        d = y - surf_fn(x)                                                # < 0: under water
        drift = (-1 if tt > FILL_S + HOLD_S else 1) * tc * 40
        a = np.sin(x / 13.0 + np.sin(y / 29.0 - drift / 29.0 + s[3]) * 2.2 + tc * 0.9)
        b = np.sin(y / 17.0 - drift / 17.0 + np.sin(x / 21.0 + tc * 1.1 + s[4]) * 2.0)
        c = np.sin((x + y) / 9.0 + tc * 2.3 + s[5])
        n = 0.45 * a + 0.4 * b + 0.15 * c
        voids = np.clip((n + 0.45) * 2.4, 0, 1)
        bright = np.clip((n - 0.35) * 2.5, 0, 1)
        depth = np.clip(-d / 400.0, 0, 1) * 0.6
        water = pal['deep'] + (pal['mid'] - pal['deep']) * (voids * (1 - 0.6 * depth))[:, None] \
            + (pal['bright'] - pal['mid']) * (bright * (1 - depth))[:, None]
        water = water * voids[:, None]
        col = np.where((d < 0)[:, None], water, 0.0)
        crest = np.exp(-np.abs(d + 3) / (4 + 6 * wild)) * (0.55 + 0.45 * np.sin(x / 5.0 + tc * 7 + s[6]) ** 2)
        crest *= (0.5 + 0.5 * wild) if phase != 'empty' else 0.0
        col = col + crest[:, None] * pal['foam']
        parts = self._particles(dt, surf_fn, wild * 0.7, 0.3, phase if phase != 'full' else 'drain-free')
        k = st['brightness'] / 0.8
        return np.clip(col * k, 0.0, 1.0).astype(np.float32), parts * k, pal['foam']
