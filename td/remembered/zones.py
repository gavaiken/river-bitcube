"""The remembered river's calibration zones (docs/remembered-river.md section 3): every LED's height above the floor, the
pool, the driftwood eddies, each rope's foot in the show view, and each screen's height and tilt.

Plain Python + numpy (no TouchDesigner), tested in tools/tests/test_remembered_*.py.

The zones file (tools/pixelmap/zones-<date>.json, written by tools/remembered/zones.py, pinned per show in shows.json as
calibration.zones; shape in docs/remembered-river.md section 3 "As built") is read like this; every key is optional and
anything missing falls back to the defaults below:

    {"pool_height_m": 0.53,                          the pool line (control.json's pool_height_m overrides it live)
     "ropes":   [{"rope": 0, "heights": [400 x metres above the floor], ...}, ...]   (null heights are interpolated)
     "eddies":  [{"rope": 4, "from": 250, "to": 266, ...}, ...]   LED index ranges (inclusive) where a rope crosses a log
     "feet":    [{"rope": 0, "x": 0.31, "y": 0.93}, ...]          each rope's foot in the show view (0-1, top left)
     "screens": [{"screen": 2, "height_m": 3.1, "tilt_deg": -4.5, ...}, ...]}   centre height; tilt + = top leans right
                                                                                (the panels rotate by -tilt to cancel)

Without a zones file (none pinned yet) the defaults assume every rope hangs DEFAULT_HANG_PX LEDs from the ceiling to the
floor (40 LEDs per metre) and coils the rest on the floor, with no eddies, feet spread evenly and the four screens stacked.
"""
import json
from pathlib import Path

import numpy as np

N_ROPES, N_PX = 20, 400
PX_PER_M = 40.0
DEFAULT_HANG_PX = 320            # ceiling to floor: 8 m of each rope hangs, the last 2 m coil on the floor
DEFAULT_POOL_HEIGHT_M = 0.25
DEFAULT_SCREENS = [{'screen': 1, 'height_m': 3.0, 'tilt_deg': 0.0}, {'screen': 2, 'height_m': 2.3, 'tilt_deg': 0.0},
                   {'screen': 3, 'height_m': 1.6, 'tilt_deg': 0.0}, {'screen': 4, 'height_m': 0.9, 'tilt_deg': 0.0}]


def _interp_row(row):
    """A rope's heights with nulls filled by linear interpolation (ends held); None if nothing is known."""
    a = np.array([np.nan if v is None else float(v) for v in row], float)
    if len(a) != N_PX:
        a = np.resize(a, N_PX) if len(a) else np.full(N_PX, np.nan)
    ok = np.isfinite(a)
    if not ok.any():
        return None
    idx = np.arange(N_PX)
    return np.interp(idx, idx[ok], a[ok])


class Zones:
    """Heights (20 x 400, metres), eddies, feet and screens, with the defaults filled in. `file` names the source."""

    def __init__(self, data=None, file=None):
        data = data or {}
        self.file = file or 'default'
        self.cam_height_m = float((data.get('meta') or {}).get('cam_height_m') or 0) or None
        self.pool_height_m = float(data.get('pool_height_m', DEFAULT_POOL_HEIGHT_M) or DEFAULT_POOL_HEIGHT_M)
        default = default_heights()
        h = default.copy()
        rows = {}
        for e in data.get('ropes') or []:                       # as built: [{"rope": r, "heights": [400 x m], ...}]
            if isinstance(e, dict) and isinstance(e.get('heights'), list) and isinstance(e.get('rope'), int):
                rows[e['rope']] = e['heights']
        if not rows and isinstance(data.get('height_m'), list):  # or a plain 20 x 400 list
            rows = {r: row for r, row in enumerate(data['height_m']) if isinstance(row, list)}
        for r, row in rows.items():
            if 0 <= r < N_ROPES:
                filled = _interp_row(row)
                if filled is not None:
                    h[r] = np.maximum(filled, 0.0)
        self.height = h.astype(np.float32)
        self.eddies = []
        for e in data.get('eddies') or []:
            try:
                r, a, b = int(e['rope']), int(e['from']), int(e['to'])
            except (KeyError, TypeError, ValueError):
                continue
            if 0 <= r < N_ROPES:
                a, b = sorted((max(0, a), min(N_PX - 1, b)))
                self.eddies.append({'rope': r, 'from': a, 'to': b})
        feet = {int(f['rope']): (float(f['x']), float(f['y'])) for f in data.get('feet') or []
                if isinstance(f, dict) and 'rope' in f and 'x' in f and 'y' in f}
        self.feet = np.array([feet.get(r, ((r + 0.5) / N_ROPES, 0.85)) for r in range(N_ROPES)], np.float32)
        screens = {int(s.get('screen', i + 1)): s for i, s in enumerate(data.get('screens') or []) if isinstance(s, dict)}
        self.screens = []
        for d in DEFAULT_SCREENS:
            s = screens.get(d['screen'], {})
            self.screens.append({'screen': d['screen'], 'height_m': float(s.get('height_m', d['height_m'])),
                                 'tilt_deg': float(s.get('tilt_deg', d['tilt_deg']))})
        # Where each rope reaches the floor: the first LED at (or below) 5 cm. The surge front lands there.
        floor = []
        for r in range(N_ROPES):
            low = np.nonzero(self.height[r] <= 0.05)[0]
            floor.append(int(low[0]) if len(low) else N_PX - 1)
        self.floor_px = np.array(floor, np.int32)
        self.top_m = float(np.median(self.height[:, 0]))
        em = np.zeros((N_ROPES, N_PX), bool)
        for e in self.eddies:
            em[e['rope'], e['from']:e['to'] + 1] = True
        self.eddy_mask = em

    def pool_mask(self, pool_height_m=None):
        """LEDs at or below the pool line (section 3: height_m <= pool_height_m)."""
        return self.height <= (self.pool_height_m if pool_height_m is None else float(pool_height_m))

    def screen_order(self):
        """Screen indices (0-3) from the highest to the lowest: the order the surge front lights them."""
        return sorted(range(len(self.screens)), key=lambda i: -self.screens[i]['height_m'])

    def neighbours(self, ropes, radius=0.08):
        """Per-rope weight 0..1: 1 on the listed ropes, falling off with the distance of their feet in the show view."""
        w = np.zeros(N_ROPES, np.float32)
        for r in ropes:
            if 0 <= int(r) < N_ROPES:
                d = np.linalg.norm(self.feet - self.feet[int(r)], axis=1)
                w = np.maximum(w, np.exp(-0.5 * (d / radius) ** 2))
        return w


def default_heights(hang_px=DEFAULT_HANG_PX):
    px = np.arange(N_PX, dtype=np.float32)
    h = np.maximum(0.0, (hang_px - px) / PX_PER_M)
    return np.tile(h, (N_ROPES, 1))


def load(path):
    """Zones from a file (absolute path) or the defaults when path is None/missing/unreadable (file='default')."""
    if not path:
        return Zones()
    p = Path(path)
    try:
        return Zones(json.loads(p.read_text(encoding='utf-8-sig')), file=p.name)
    except (OSError, ValueError):
        return Zones(file=f'default ({p.name} unreadable)')
