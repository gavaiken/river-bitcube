"""Where every rope LED and every screen window is in the room: the calibration's virtual frame (pixelmap-<date>.json
meta.space: one frame holding the whole sculpture, floor to rig), in frame pixels (x right, y up; frame_size 1440 x
808). Every rope LED has its place there (the map's points) and every screen its centre, size and how it hangs (the
screens file's corners; screen 1, edge-on to the camera and placed by hand, hangs 21 deg counterclockwise as seen;
the other tilts measured on site with an iPhone: TILT_MEASURED). The ribbons (via filling/space.py) and both fill
shows paint by it. numpy only. (Moved here from round 2b's particles.py, deleted with that field on 29 Oct.)
"""
import json
import math
from pathlib import Path

import numpy as np

QW, QH, NQ = 128, 256, 4
N_ROPES, N_PX = 20, 400
FRAME = (1440.0, 808.0)
SCREEN_M = (0.32, 0.64)             # a screen: 128 x 256 LEDs at 2.5 mm
SCREEN1_ANGLE = 21.0                # deg, counterclockwise as seen (screen 1 can't be seen by the camera)
# How each screen hangs, measured on site with an iPhone (Gavin, 27 Oct night; + = counterclockwise as seen). The camera
# sees the screens at a slant, so its corners misjudge the rotation (screen 2 looked upright): these win.
TILT_MEASURED = {1: 21.0, 2: -19.0, 3: -20.0, 4: 23.0}


def _load(path):
    """A calibration file; a path that can't be read is an error, never a silent default layout."""
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError, TypeError) as e:
        raise RuntimeError(f'calibration file {path} unreadable ({e})') from e


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
                if k in TILT_MEASURED:
                    ang = math.radians(TILT_MEASURED[k])
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
