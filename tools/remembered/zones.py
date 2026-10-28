"""Calibration zones for the remembered river (docs/remembered-river.md §3): every LED's height above the floor, the
pool line, the driftwood eddies, each rope's foot in the show view and the screens' heights and tilts.

    python tools/remembered/zones.py build [--map tools/pixelmap/pixelmap-<date>.json] [--screens screens-<date>.json]
                                           [--logs tools/remembered/logs-<date>.json] [--cam-height-m 2.0]
                                           [--pool-above-coil-m 0.25 | --pool-height-m X] [--out zones-<date>.json]
    python tools/remembered/zones.py still [--map M] [--zones Z] [--logs L] [--image show-still.jpg] [--out marked.png]
    python tools/remembered/zones.py light pool|eddies|off|leds [ROPE:FROM-TO ...] [--zones Z] [--pool-height-m X]
                                           [--write [PATH]]

Pure repo work: nothing here touches the camera, TouchDesigner or the lights. `light` only prints which LEDs to light
and (with --write) writes River\\remembered\\control.json for the remembered show to act on (§5).

Rope numbers are 0-based everywhere, as in the pixel map (rope 1 of the rope map = 0); LED 0 = the plug end.
Show view = the gallery cam's home ("show") view: x, y in 0..1 from the top left, as the people counter sees it.

How heights are found (assumptions, also written into the file's meta):
- Each LED is a direction from the camera: `d` of a multi-view map (sphere.py, home-view coordinates), or, for an old
  single-view map, its camera pixel through a pinhole of --hfov-deg (default 87, sphere.py's guess; no distortion).
- Down: ropes hang vertically and their LEDs are evenly spaced, so each well-decoded rope's 3D direction follows from
  how its LED spacing shrinks with distance (directions d_i ~ P0 + i v, solved by least squares, coil loops and strays
  dropped); down is the robust mean of those directions. --pitch-deg overrides it (camera tilted down by that much,
  no roll). (The ropes' planes through the camera would also contain the vertical, but the ropes span too narrow a
  fan of directions for that to fix the camera's pitch: tried on the 23 Oct map, 10 degrees off.)
- A rope at horizontal distance D: an LED at elevation e is at height cam_height_m + D tan(e). The rope's lowest decoded
  LED is taken as the floor (height 0), which fixes D. The LED pitch (metres per LED) is then the median over those
  ropes; a rope whose lowest decoded LED isn't on the floor (it disagrees with the pitch by more than 25 %, or its
  lowest LED is above the camera's horizon) gets D from the pitch and how fast its elevation changes along its LEDs;
  a rope with too few decoded LEDs for that takes the median D of its two nearest ropes (by direction); a rope with
  none borrows its nearest rope's heights and foot (as td/build's fill_unmapped does for positions).
- Undecoded LEDs: heights interpolated along the LED index between decoded ones (median-smoothed); past the ends,
  continued along the rope's own slope (upward towards the rig; downward to the floor, never below 0, held once the
  rope is in its coil) and listed in `extrapolated`.
- Coil top: where the rope stops falling one pitch per LED and sits in its coil; the median over the ropes where it is
  seen (0 when none is). Pool line = coil top + pool_above_coil_m (or --pool-height-m). pool_from = the first LED
  (from the plug end) at or below the pool line.
- Screens: each screen's corners (screens-<date>.json, in the same frame as the map: pin them together) are taken to
  hang at the horizontal distance of the two ropes nearest it (by direction) unless --screen-distance-m is given; its
  centre height follows as for an LED. tilt_deg: how far its top leans from vertical as seen from the camera,
  positive = top to the right (rotate by -tilt_deg to cancel). Estimated screens (not seen) stay marked estimated.
- Eddies: log outlines marked on a show-view still (tools/remembered/logs-<date>.json: [{name, polygon: [[x, y], ...]}]
  in show-view 0..1 from the top left; or {"frame": "map", "logs": [...]} for the map's own frame, v down). Every run of
  a rope's LEDs inside an outline (gaps up to EDDY_GAP LEDs bridged, runs shorter than EDDY_MIN dropped) is an eddy.
"""
import argparse
import json
import math
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
REPO = TOOLS.parent
RIVER = REPO.parent
PIXELMAP = TOOLS / 'pixelmap'
CONTROL = RIVER / 'remembered' / 'control.json'
sys.path.insert(0, str(TOOLS))
from pixelmap import sphere  # noqa: E402

N_ROPES, N_PX = 20, 400
CAM_HEIGHT_M = 2.0           # the gallery cam's lens above the floor (estimate; measure it and pass --cam-height-m)
POOL_ABOVE_COIL_M = 0.25     # the pool line above the coil tops
HFOV_DEG = 87.0              # lens guess for an old single-view map (sphere.py's)
MIN_DECODED = 12             # decoded LEDs a rope needs to fix its own distance from its floor
MIN_FOR_PITCH = 4            # ... or from the LED pitch (spanning at least 5 LEDs)
FLOOR_MIN_TAN = 0.14         # a floor LED is at least ~8 degrees below the horizon (rope within ~14 m at 2 m)
FRAME_EDGE = 0.02            # ... and not at the picture's bottom edge (the view cut the rope off there)
FLOOR_AGREE = 0.25           # floor distance vs pitch distance: more apart than this = its lowest LED isn't the floor
HANG_ABOVE_M = 0.4           # LEDs this far above a rope's floor are certainly hanging (for its slope)
COIL_TOL_M = 0.08            # an LED this much above the straight drop = in the coil
EDDY_GAP, EDDY_MIN = 2, 3    # bridge gaps up to 2 LEDs; drop runs shorter than 3


# ---- the map --------------------------------------------------------------------------------------------------------

class MapGeom:
    """A pixel map's LEDs as directions from the camera (home-view coordinates: x right, y down, z forward)."""

    def __init__(self, pmap, hfov_deg=HFOV_DEG):
        meta = pmap.get('meta') or {}
        self.w, self.h = (meta.get('frame_size') or [1440, 808])[:2]
        space = meta.get('space')
        self.multi = bool(space)
        if space:
            self.space = sphere.Space.from_meta(space)
            self.cam = self.space.cam
        else:
            self.space = None
            self.cam = sphere.Cam((self.w / 2) / math.tan(math.radians(hfov_deg / 2)), 0.0, self.w, self.h)
        self.lens = (f"multi-view map lens: f {self.cam.f:.1f} px, k1 {self.cam.k1:.4f}" if space else
                     f"single-view map: pinhole guess, horizontal view {hfov_deg} deg, no distortion")
        by = {}
        for p in pmap['points']:
            by.setdefault(int(p['rope']), []).append(p)
        self.ropes = {}
        for r, ps in sorted(by.items()):
            ps.sort(key=lambda p: p['px'])
            uv = np.array([[p['u'], p['v']] for p in ps], float)
            if space and all('d' in p for p in ps):
                d = np.array([p['d'] for p in ps], float)
                d /= np.linalg.norm(d, axis=1, keepdims=True)
            else:
                d = self.uv_to_dirs(uv)
            self.ropes[r] = {'idx': np.array([p['px'] for p in ps], int), 'd': d, 'uv': uv,
                             'decoded': np.array([bool(p.get('visible', True)) for p in ps]),
                             'xy': self.dirs_to_show(d)}

    def uv_to_dirs(self, uv):
        """The map's own (u, v) (TD: v up) -> home directions."""
        uv = np.atleast_2d(np.asarray(uv, float))
        if self.space:
            return self.space.frame.uv_to_dirs(uv)
        return self.cam.rays(np.c_[uv[:, 0] * self.w, (1 - uv[:, 1]) * self.h])

    def dirs_to_show(self, d):
        """Home directions -> show view (x, y) 0..1 from the top left (NaN behind the camera)."""
        px = self.cam.project(np.atleast_2d(d))
        return np.c_[px[:, 0] / self.w, px[:, 1] / self.h]


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def latest(pattern, folder=PIXELMAP):
    found = sorted(Path(folder).glob(pattern))
    return found[-1] if found else None


# ---- down, elevation ------------------------------------------------------------------------------------------------

def down_from_pitch(pitch_deg):
    """World down in camera coordinates for a camera tilted down by pitch_deg with no roll."""
    p = math.radians(pitch_deg)
    return np.array([0.0, math.cos(p), math.sin(p)])


def _skew(a):
    return np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])


def _line_fit(d, idx):
    """(P0, v) with d_i ~ P0 + i v by least squares (cross(d_i, P0 + i v) = 0), and every point's angle off it."""
    a = np.vstack([np.hstack([_skew(x), _skew(x) * i]) for x, i in zip(d, idx.astype(float))])
    x = np.linalg.svd(a, full_matrices=False)[2][-1]
    return x[:3], x[3:]


def _line_err(p0, v, d, idx):
    pred = p0[None] + idx[:, None] * v[None]
    pred /= np.linalg.norm(pred, axis=1, keepdims=True)
    cos = (pred * d).sum(axis=1)
    if np.median(cos) < 0:
        cos = -cos
    return np.arccos(np.clip(cos, -1, 1))


def rope_line(d, idx, min_pts=8, tol=0.004):
    """A straight rope with evenly spaced LEDs: directions d_i ~ P0 + i v. Found on the stretch of LEDs that fits one
    such line best (windows along the rope, the most inliers wins: coil loops and strays don't fit), then refined on
    its inliers. Returns (unit v, inlier mask) or (None, mask): v is the rope's 3D direction, found from how the
    spacing between its LEDs shrinks with distance (perspective)."""
    idx = np.asarray(idx)
    if len(d) < min_pts or np.ptp(idx) < 10:
        return None, np.zeros(len(d), bool)
    span = max(40, int(np.ptp(idx)) // 4)
    best, best_n = None, 0
    for start in range(int(idx.min()), int(idx.max()) - span + 2, 10):
        w = (idx >= start) & (idx < start + span)
        if w.sum() < min_pts or np.ptp(idx[w]) < 10:
            continue
        p0, v = _line_fit(d[w], idx[w])
        err = _line_err(p0, v, d, idx)
        n = int((err <= tol).sum())                      # a fixed tolerance: a bad window can't widen its own
        if n > best_n:
            best, best_n = err <= tol, n
    if best is None:
        return None, np.zeros(len(d), bool)
    keep = best
    for _ in range(3):
        if keep.sum() < min_pts or np.ptp(idx[keep]) < 10:
            return None, keep
        p0, v = _line_fit(d[keep], idx[keep])
        err = _line_err(p0, v, d, idx)
        new = err <= max(3 * float(np.median(err[keep])), tol)
        if (new == keep).all():
            break
        keep = new
    return v / np.linalg.norm(v), keep


def fit_down(ropes, min_pts=8, max_dev_deg=6.0):
    """World down in home-view coordinates, from the ropes (see the header): each straight, evenly spaced rope gives
    its own 3D direction from its LED spacing; down is their robust mean, pointing down in the picture. Returns
    (down unit vector, ropes used, quality = rms angle in degrees between the ropes used and down)."""
    us, used = [], []
    for r, R in ropes.items():
        m = R['decoded']
        u, _ = rope_line(R['d'][m], R['idx'][m], min_pts)
        if u is None:
            continue
        us.append(u if u[1] > 0 else -u)
        used.append(r)
    if len(us) < 2:
        raise ValueError(f'only {len(us)} rope(s) decoded well enough to find the vertical: pass --pitch-deg')
    us = np.array(us)
    g = np.median(us, axis=0)
    g /= np.linalg.norm(g)
    for _ in range(2):
        dev = np.degrees(np.arccos(np.clip(us @ g, -1, 1)))
        ok = dev <= max(max_dev_deg, 2 * float(np.median(dev)))
        g = us[ok].mean(axis=0)
        g /= np.linalg.norm(g)
    dev = np.degrees(np.arccos(np.clip(us[ok] @ g, -1, 1)))
    return g, [r for r, k in zip(used, ok) if k], float(np.sqrt(np.mean(dev ** 2)))


def tan_elev(d, g):
    """tan(elevation) of directions d (N, 3) given world down g: + above the camera's horizon."""
    c = d @ g
    return -c / np.sqrt(np.maximum(1 - c ** 2, 1e-12))


def horiz(d, g):
    """Unit horizontal components of directions."""
    h = np.atleast_2d(d) - np.outer(np.atleast_2d(d) @ g, g)
    return h / np.linalg.norm(h, axis=1, keepdims=True)


def theil_sen(x, y, min_dx=3):
    """Robust slope and intercept of y over x."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    i, j = np.triu_indices(len(x), 1)
    dx = x[j] - x[i]
    ok = np.abs(dx) >= min(min_dx, max(np.abs(dx).max(initial=0), 1e-9))
    if not ok.any():
        return 0.0, float(np.median(y)) if len(y) else 0.0
    s = float(np.median((y[j] - y[i])[ok] / dx[ok]))
    return s, float(np.median(y - s * x))


def medfilt(a, k=5):
    if len(a) < k:
        return np.asarray(a, float)
    pad = np.pad(np.asarray(a, float), k // 2, mode='edge')
    return np.median(np.lib.stride_tricks.sliding_window_view(pad, k), axis=1)


# ---- heights --------------------------------------------------------------------------------------------------------

def coil_start(idx, h, slope, icpt, tol=COIL_TOL_M):
    """Where a rope leaves its straight drop for its coil: the first decoded LED (going down the rope) from which it
    and the next two stay more than tol above the line. Returns (index, coil top height) or (None, None)."""
    down = np.sign(slope) or -1.0
    order = np.argsort(idx * -down)                 # top of the rope first
    i_s, h_s = idx[order], h[order]
    above = h_s - (slope * i_s + icpt) > tol
    for k in range(len(i_s) - 2):
        if above[k] and above[k + 1] and above[k + 2]:
            return int(i_s[k]), max(0.0, float(slope * i_s[k] + icpt))
    return None, None


def complete(idx, h, slope, coil_top, n_px=N_PX):
    """400 heights from decoded (idx, h): smoothed, interpolated, extrapolated along slope (m/LED) past the ends.
    Returns (heights, extrapolated bool mask)."""
    order = np.argsort(idx)
    idx, h = idx[order], medfilt(h[order], 5)
    allx = np.arange(n_px)
    out = np.interp(allx, idx, h)
    ext = (allx < idx[0]) | (allx > idx[-1])
    for end, side in ((0, allx < idx[0]), (-1, allx > idx[-1])):
        if not side.any():
            continue
        line = h[end] + slope * (allx[side] - idx[end])
        going_down = (slope * (allx[side] - idx[end])).mean() < 0 if slope else False
        if going_down and coil_top is not None and h[end] <= coil_top + COIL_TOL_M:
            line = np.full(side.sum(), h[end])          # already in the coil: stay there
        out[side] = line
    return np.maximum(out, 0.0), ext


def ranges(mask):
    """Bool mask -> [[from, to], ...] runs of True (inclusive)."""
    out, start = [], None
    for i, m in enumerate(list(mask) + [False]):
        if m and start is None:
            start = i
        elif not m and start is not None:
            out.append([start, i - 1])
            start = None
    return out


def rope_heights(geom, g, cam_height_m, led_pitch_m=None, rope_distance_m=None):
    """Per rope: {method, D, heights, extrapolated, decoded, coil_from, coil_top, az}; and the LED pitch used."""
    info = {}
    for r, R in geom.ropes.items():
        dec = R['decoded']
        if dec.sum() == 0:
            continue
        t = tan_elev(R['d'][dec], g)
        info[r] = {'idx': R['idx'][dec], 't': t, 'decoded': int(dec.sum()), 'xy': R['xy'][dec],
                   'az': horiz(R['d'][dec], g).mean(axis=0)}
        info[r]['az'] /= np.linalg.norm(info[r]['az'])
        if info[r]['decoded'] >= MIN_FOR_PITCH and np.ptp(info[r]['idx']) >= 5:
            _, line = rope_line(R['d'][dec], R['idx'][dec])          # its straight drop, without the coil
            use = line if line.sum() >= MIN_FOR_PITCH else np.ones(len(t), bool)
            info[r]['t_slope'] = theil_sen(info[r]['idx'][use], t[use])[0]
    signs = [np.sign(I['t_slope']) for I in info.values() if I.get('t_slope')]
    down_sign = float(np.sign(np.sum(signs))) if signs and np.sum(signs) else -1.0   # heights fall with the index
    # pass 1: each rope's own floor (its lowest decoded LED, if that can be the floor)
    pitches = []
    for r, I in info.items():
        if I['decoded'] < MIN_DECODED:
            continue
        order = np.argsort(I['idx'])
        tf = medfilt(I['t'][order], 3)
        low = int(np.argmin(tf))
        y_low = I['xy'][order][low, 1]
        if tf[low] > -FLOOR_MIN_TAN or not np.isfinite(y_low) or y_low > 1 - FRAME_EDGE:
            continue                                        # too near the horizon, or cut off by the picture's edge
        I['d_floor'] = -cam_height_m / float(tf[low])
        h = cam_height_m + I['d_floor'] * I['t']
        hang = h > HANG_ABOVE_M
        if hang.sum() >= 5:
            s, _ = theil_sen(I['idx'][hang], h[hang])
            if abs(s) > 1e-4:
                I['slope_floor'] = s
                pitches.append(abs(s))
    pitch = led_pitch_m or (float(np.median(pitches)) if pitches else None)
    # pass 2: choose each rope's distance
    for r, I in info.items():
        d_pitch = pitch / abs(I['t_slope']) if pitch and abs(I.get('t_slope') or 0) > 1e-6 else None
        I['d_pitch'] = d_pitch
        if 'd_floor' in I and (d_pitch is None or abs(I['d_floor'] / d_pitch - 1) <= FLOOR_AGREE):
            I['method'], I['D'] = 'floor', I['d_floor']
        elif d_pitch is not None:
            I['method'], I['D'] = 'pitch', d_pitch
        elif rope_distance_m:
            I['method'], I['D'] = 'given', float(rope_distance_m)
    good = [r for r, I in info.items() if I.get('method') == 'floor'] or [r for r, I in info.items() if 'D' in I]
    for r, I in info.items():
        if 'D' in I:
            continue
        if not good:
            raise ValueError("no rope's distance can be found: no rope's lowest decoded LED looks like the floor (the "
                             "map's view doesn't reach it?) and no LED pitch is known: pass --led-pitch-m or "
                             "--rope-distance-m")
        near = sorted(good, key=lambda o: -float(I['az'] @ info[o]['az']))[:2]
        I['method'], I['D'], I['from'] = 'neighbours', float(np.median([info[o]['D'] for o in near])), near
    # heights
    for r, I in info.items():
        h = cam_height_m + I['D'] * I['t']
        slope = I.get('slope_floor') if I['method'] == 'floor' else None
        if slope is None:
            if len(I['idx']) >= 2 and np.ptp(I['idx']) >= 5:
                slope = theil_sen(I['idx'], I['D'] * I['t'])[0]
            else:
                slope = down_sign * (pitch or 0.0)
        hang = h > (h.min() + HANG_ABOVE_M)
        icpt = theil_sen(I['idx'][hang], h[hang])[1] if hang.sum() >= 2 else float(np.median(h - slope * I['idx']))
        c_from, c_top = coil_start(I['idx'], h, slope, icpt) if I['method'] == 'floor' else (None, None)
        heights, ext = complete(I['idx'], h, slope, c_top)
        I.update(heights=heights, extrapolated=ext, coil_from=c_from, coil_top=c_top, slope=slope)
    return info, pitch


def foot_dir(I, g, cam_height_m):
    """Direction from the camera to the floor point under a rope."""
    p = I['D'] * I['az'] + cam_height_m * g
    return p / np.linalg.norm(p)


def build(pmap, cam_height_m=CAM_HEIGHT_M, pool_above_coil_m=POOL_ABOVE_COIL_M, pool_height_m=None, screens=None,
          logs=None, pitch_deg=None, hfov_deg=HFOV_DEG, screen_distance_m=None, names=None, led_pitch_m=None,
          rope_distance_m=None):
    """The zones dict (see the header and docs/remembered-river.md §3)."""
    names = names or {}
    geom = MapGeom(pmap, hfov_deg)
    if pitch_deg is not None:
        g, used, quality = down_from_pitch(pitch_deg), [], None
    else:
        g, used, quality = fit_down(geom.ropes)
    info, pitch = rope_heights(geom, g, cam_height_m, led_pitch_m, rope_distance_m)
    tops = [I['coil_top'] for I in info.values() if I['coil_top'] is not None]
    coil_top = float(np.median(tops)) if tops else 0.0
    pool = pool_height_m if pool_height_m is not None else coil_top + pool_above_coil_m

    ropes, feet = [], []
    mapped = sorted(info)
    for r in range(N_ROPES):
        if r in info:
            I = info[r]
            heights = np.round(I['heights'], 2)
            row = {'rope': r, 'method': I['method'], 'distance_m': round(I['D'], 3), 'decoded': I['decoded'],
                   'heights': heights.tolist(), 'extrapolated': ranges(I['extrapolated']),
                   'pool_from': pool_from(heights, pool),
                   'coil_from': I['coil_from'], 'coil_top_m': None if I['coil_top'] is None else round(I['coil_top'], 2)}
            if 'from' in I:
                row['distance_from'] = I['from']
            ropes.append(row)
            x, y = geom.dirs_to_show(foot_dir(I, g, cam_height_m))[0]
            feet.append({'rope': r, 'x': round(float(x), 4), 'y': round(float(y), 4)})
        elif mapped:
            src = min(mapped, key=lambda m: (abs(m - r), m))
            I = info[src]
            heights = np.round(I['heights'], 2)
            ropes.append({'rope': r, 'method': 'borrowed', 'borrowed_from': src, 'distance_m': round(I['D'], 3),
                          'decoded': 0, 'heights': heights.tolist(), 'extrapolated': [[0, N_PX - 1]],
                          'pool_from': pool_from(heights, pool), 'coil_from': None, 'coil_top_m': None})
            x, y = geom.dirs_to_show(foot_dir(I, g, cam_height_m))[0]
            feet.append({'rope': r, 'x': round(min(1.0, max(0.0, float(x) + (0.02 if r > src else -0.02))), 4),
                         'y': round(float(y), 4), 'borrowed_from': src})

    pitch_deg_fit = math.degrees(math.asin(max(-1.0, min(1.0, float(g[2])))))
    roll_deg_fit = math.degrees(math.atan2(-float(g[0]), float(g[1])))
    meta = {
        'made': date.today().isoformat(), 'map': names.get('map'), 'screens': names.get('screens'),
        'logs': names.get('logs'), 'cam_height_m': cam_height_m, 'coil_top_m': round(coil_top, 3),
        'pool_above_coil_m': None if pool_height_m is not None else pool_above_coil_m,
        'pool_height_m': round(pool, 3), 'led_pitch_m': None if pitch is None else round(pitch, 4),
        'led_pitch_from': 'given' if led_pitch_m else 'median over the "floor" ropes',
        'down': [round(float(c), 5) for c in g],
        'camera_pitch_deg': round(pitch_deg_fit, 2), 'camera_roll_deg': round(roll_deg_fit, 2),
        'down_from': (f'--pitch-deg {pitch_deg}' if pitch_deg is not None else
                      f'fitted: the mean direction of {len(used)} ropes from their LED spacing (spread {quality:.1f} deg rms)'),
        'lens': geom.lens,
        'rope': '0-based, as in the pixel map (rope 1 of the rope map = 0); LED 0 = the plug end',
        'heights': 'metres above the floor (the lowest decoded LED of a "floor" rope = 0), rounded to cm; '
                   'consistent across ropes, not exact; scales with cam_height_m',
        'methods': 'floor: own lowest LED is the floor; pitch: distance from the LED pitch; given: '
                   '--rope-distance-m; neighbours: median distance of its two nearest ropes; borrowed: the map '
                   'missed it, heights of its nearest rope',
        'pool_from': 'first LED from the plug end at or below pool_height_m (400 = none); LEDs from there on are the pool',
        'xy': 'show view (the gallery cam\'s home view, as the people counter sees it): 0..1 from the top left',
        'tilt_deg': 'how far a screen\'s top leans from vertical as seen from the camera, + = to the right',
    }
    out = {'meta': meta, 'pool_height_m': round(pool, 3), 'ropes': ropes, 'feet': feet,
           'eddies': eddies(geom, logs) if logs else [], 'screens': []}
    if screens:
        out['screens'] = screen_zones(geom, screens, info, g, cam_height_m, screen_distance_m)
    return out


def pool_from(heights, pool):
    below = np.nonzero(np.asarray(heights) <= pool)[0]
    return int(below[0]) if len(below) else N_PX


# ---- screens --------------------------------------------------------------------------------------------------------

def screen_zones(geom, screens, info, g, cam_height_m, distance_m=None):
    out = []
    corners = ('tl', 'tr', 'br', 'bl')
    for k, s in sorted((screens.get('screens') or {}).items(), key=lambda kv: int(kv[0])):
        d = geom.uv_to_dirs(np.array([s[c] for c in corners], float))
        centre = d.mean(axis=0)
        centre /= np.linalg.norm(centre)
        az = horiz(centre, g)[0]
        if distance_m is not None:
            dist, near = float(distance_m), None
        else:
            near = sorted((r for r in info), key=lambda r: -float(az @ info[r]['az']))[:2]
            dist = float(np.median([info[r]['D'] for r in near]))
        height = cam_height_m + dist * float(tan_elev(centre[None], g)[0])
        pts = {c: dist / np.linalg.norm(dc - (dc @ g) * g) * dc for c, dc in zip(corners, d)}
        up = (pts['tl'] + pts['tr']) / 2 - (pts['bl'] + pts['br']) / 2
        right = (pts['tr'] + pts['br']) / 2 - (pts['tl'] + pts['bl']) / 2
        side = np.cross(g, az)                              # right as seen from the camera, horizontal
        tilt = math.degrees(math.atan2(float(up @ side), float(-(up @ g))))
        row = {'screen': int(k), 'height_m': round(height, 2), 'tilt_deg': round(tilt, 1),
               'distance_m': round(dist, 3), 'size_m': [round(float(np.linalg.norm(right)), 2),
                                                         round(float(np.linalg.norm(up)), 2)]}
        if near is not None:
            row['distance_from'] = near
        if s.get('estimated'):
            row['estimated'] = True
        out.append(row)
    return out


# ---- eddies ---------------------------------------------------------------------------------------------------------

def inside(pts, poly):
    """Points (N, 2) inside a polygon (any shape; even-odd rule). NaN points are outside."""
    pts = np.atleast_2d(np.asarray(pts, float))
    poly = np.asarray(poly, float)
    x, y = pts[:, 0], pts[:, 1]
    res = np.zeros(len(pts), bool)
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[i - 1]
        cross = (y1 > y) != (y2 > y)
        with np.errstate(divide='ignore', invalid='ignore'):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        res ^= cross & (x < xi)
    return res & np.isfinite(x) & np.isfinite(y)


def read_logs(logs):
    """logs file -> (frame, [{name, polygon}]): a bare list is in the show view."""
    if isinstance(logs, dict):
        return logs.get('frame', 'show'), logs.get('logs') or []
    return 'show', logs or []


def eddies(geom, logs, gap=EDDY_GAP, min_len=EDDY_MIN):
    frame, items = read_logs(logs)
    out = []
    for r, R in geom.ropes.items():
        pts = R['xy'] if frame == 'show' else np.c_[R['uv'][:, 0], 1 - R['uv'][:, 1]]
        for li, log in enumerate(items):
            m = np.zeros(N_PX, bool)
            m[R['idx'][inside(pts, log['polygon'])]] = True
            runs = ranges(m)
            merged = []
            for a, b in runs:
                if merged and a - merged[-1][1] - 1 <= gap:
                    merged[-1][1] = b
                else:
                    merged.append([a, b])
            dec = np.zeros(N_PX, bool)
            dec[R['idx'][R['decoded']]] = True
            for a, b in merged:
                if b - a + 1 >= min_len:
                    out.append({'rope': r, 'from': a, 'to': b, 'log': log.get('name', f'log{li + 1}'),
                                'decoded': int(dec[a:b + 1].sum())})
    return sorted(out, key=lambda e: (e['rope'], e['from']))


# ---- lighting checks ------------------------------------------------------------------------------------------------

def parse_leds(specs):
    """['3:120-140', '5:7'] -> [{rope, from, to}]."""
    out = []
    for s in specs:
        rope, _, span = s.partition(':')
        a, _, b = span.partition('-')
        if not rope.strip().isdigit() or not a.strip().isdigit():
            raise ValueError(f'bad LED range {s!r}: use ROPE:FROM-TO, e.g. 3:120-140 (0-based)')
        a = int(a)
        b = int(b) if b.strip() else a
        out.append({'rope': int(rope), 'from': min(a, b), 'to': min(max(a, b), N_PX - 1)})
    return out


def light_ranges(mode, zones=None, pool_height_m=None, specs=()):
    if mode == 'off':
        return []
    if mode == 'leds':
        return parse_leds(specs)
    if zones is None:
        raise ValueError(f'--light {mode} needs a zones file')
    if mode == 'pool':
        pool = zones['pool_height_m'] if pool_height_m is None else pool_height_m
        return [{'rope': z['rope'], 'from': pool_from(z['heights'], pool), 'to': N_PX - 1}
                for z in zones['ropes'] if pool_from(z['heights'], pool) < N_PX]
    if mode == 'eddies':
        return [{'rope': e['rope'], 'from': e['from'], 'to': e['to']} for e in zones.get('eddies', [])]
    raise ValueError(f'unknown light mode {mode!r}')


def control(mode, leds, zones_name=None, pool_height_m=None):
    """River\\remembered\\control.json (§5): what the remembered show should light for a check."""
    z = {'file': zones_name, 'light': mode, 'leds': leds}
    if pool_height_m is not None:
        z['pool_height_m'] = pool_height_m
    return {'t': round(time.time(), 2), 'zones': z}


# ---- the still for marking logs -------------------------------------------------------------------------------------

PALETTE = [(255, 80, 80), (80, 255, 80), (80, 160, 255), (255, 220, 60), (255, 80, 255),
           (80, 255, 255), (255, 160, 60), (200, 200, 255), (160, 255, 160), (255, 255, 255)]


def render_still(geom, image=None, zones=None, logs=None, size=None):
    """A show-view picture: a 0.1 grid (to read x, y off), every LED as a dot (decoded bright, filled grey), the rope
    numbers (0-based) at their feet, the log outlines and a cyan tick where each rope's pool begins."""
    from PIL import Image, ImageDraw
    if image is not None:
        im = Image.open(image).convert('RGB')
    else:
        im = Image.new('RGB', tuple(size or (geom.w, geom.h)))
    w, h = im.size
    im = Image.eval(im, lambda c: int(c * 0.6))
    dr = ImageDraw.Draw(im)
    for i in range(1, 10):
        dr.line([(i * w / 10, 0), (i * w / 10, h)], fill=(70, 70, 70))
        dr.line([(0, i * h / 10), (w, i * h / 10)], fill=(70, 70, 70))
        dr.text((i * w / 10 + 2, 2), f'{i / 10:.1f}', fill=(160, 160, 160))
        dr.text((2, i * h / 10 + 2), f'{i / 10:.1f}', fill=(160, 160, 160))
    for r, R in geom.ropes.items():
        col = PALETTE[r % 10]
        for (x, y), dec in zip(R['xy'], R['decoded']):
            if not (np.isfinite(x) and np.isfinite(y)):
                continue
            px, py = x * w, y * h
            if dec:
                dr.ellipse((px - 1.5, py - 1.5, px + 1.5, py + 1.5), fill=col)
            else:
                dr.point((px, py), fill=(110, 110, 110))
    if zones:
        for z in zones['ropes']:
            R = geom.ropes.get(z['rope'])
            if R is None or z['pool_from'] >= N_PX:
                continue
            k = np.nonzero(R['idx'] == z['pool_from'])[0]
            if len(k) and np.isfinite(R['xy'][k[0]]).all():
                x, y = R['xy'][k[0]] * (w, h)
                dr.line([(x - 6, y), (x + 6, y)], fill=(0, 220, 255), width=2)
        for f in zones.get('feet', []):                     # at the foot (kept inside the picture)
            fx, fy = min(max(f['x'] * w, 2), w - 14), min(max(f['y'] * h, 2), h - 12)
            dr.ellipse((fx - 3, fy - 3, fx + 3, fy + 3), outline=(255, 255, 255))
            dr.text((fx + 4, fy - 12), str(f['rope']), fill=(255, 255, 255))
    else:
        for r, R in geom.ropes.items():
            ok = np.isfinite(R['xy']).all(axis=1)
            if ok.any():
                x, y = R['xy'][ok][np.argmax(R['xy'][ok][:, 1])]
                dr.text((x * w + 3, y * h + 3), str(r), fill=(255, 255, 255))
    if logs:
        frame, items = read_logs(logs)
        if frame == 'show':
            for log in items:
                pts = [(x * w, y * h) for x, y in log['polygon']]
                dr.polygon(pts, outline=(255, 230, 0))
                dr.text(pts[0], log.get('name', ''), fill=(255, 230, 0))
    return im


# ---- CLI ------------------------------------------------------------------------------------------------------------

def _map_path(a):
    p = Path(a.map) if a.map else latest('pixelmap-????-??-??.json')
    if not p:
        raise SystemExit('no pixel map: pass --map')
    return p


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build', help='write tools/pixelmap/zones-<date>.json')
    b.add_argument('--map')
    b.add_argument('--screens', help='screens-<date>.json in the same frame as the map (default: none)')
    b.add_argument('--logs', help='tools/remembered/logs-<date>.json (default: none, no eddies)')
    b.add_argument('--cam-height-m', type=float, default=CAM_HEIGHT_M)
    b.add_argument('--pool-above-coil-m', type=float, default=POOL_ABOVE_COIL_M)
    b.add_argument('--pool-height-m', type=float)
    b.add_argument('--pitch-deg', type=float, help='camera tilt down (deg) instead of fitting the vertical')
    b.add_argument('--hfov-deg', type=float, default=HFOV_DEG, help='lens of an old single-view map')
    b.add_argument('--screen-distance-m', type=float)
    b.add_argument('--led-pitch-m', type=float, help='metres between LEDs along a rope, if known (else fitted)')
    b.add_argument('--rope-distance-m', type=float, help='distance for ropes whose floor and pitch are unknown')
    b.add_argument('--out')
    s = sub.add_parser('still', help='a show-view picture for marking logs')
    s.add_argument('--map')
    s.add_argument('--zones')
    s.add_argument('--logs')
    s.add_argument('--image', help='a show-view still (default: black at the map\'s frame size)')
    s.add_argument('--hfov-deg', type=float, default=HFOV_DEG)
    s.add_argument('--out', default='zones-still.png')
    li = sub.add_parser('light', help='which LEDs to light for a check (and River\\remembered\\control.json)')
    li.add_argument('mode', choices=['pool', 'eddies', 'leds', 'off'])
    li.add_argument('specs', nargs='*', help='for leds: ROPE:FROM-TO (0-based)')
    li.add_argument('--zones')
    li.add_argument('--pool-height-m', type=float)
    li.add_argument('--write', nargs='?', const=str(CONTROL), help=f'write the control file (default {CONTROL})')
    a = ap.parse_args(argv)

    if a.cmd == 'build':
        mp = _map_path(a)
        screens = load_json(a.screens) if a.screens else None
        if screens and (screens.get('meta') or {}).get('map') not in (None, mp.name):
            print(f"warning: {a.screens} was made against {screens['meta']['map']}, not {mp.name}")
        try:
            z = build(load_json(mp), a.cam_height_m, a.pool_above_coil_m, a.pool_height_m, screens,
                      load_json(a.logs) if a.logs else None, a.pitch_deg, a.hfov_deg, a.screen_distance_m,
                      {'map': mp.name, 'screens': a.screens and Path(a.screens).name,
                       'logs': a.logs and Path(a.logs).name}, a.led_pitch_m, a.rope_distance_m)
        except ValueError as e:
            raise SystemExit(f'zones: {e}')
        out = Path(a.out or PIXELMAP / f'zones-{date.today().isoformat()}.json')
        out.write_text(json.dumps(z, separators=(',', ':')).replace('{"rope"', '\n{"rope"').replace('{"screen"', '\n{"screen"') + '\n')
        m = z['meta']
        print(f"down: {m['down_from']}; camera pitch {m['camera_pitch_deg']} deg, roll {m['camera_roll_deg']} deg")
        print(f"LED pitch {m['led_pitch_m']} m; coil top {m['coil_top_m']} m; pool line {m['pool_height_m']} m")
        for r in z['ropes']:
            print(f"rope {r['rope']:2d}: {r['method']:10s} D {r['distance_m']:.2f} m  decoded {r['decoded']:3d}  "
                  f"top {max(r['heights']):.2f} m  pool from {r['pool_from']}")
        for s_ in z['screens']:
            print(f"screen {s_['screen']}: centre {s_['height_m']} m, tilt {s_['tilt_deg']} deg" + (' (estimated)' if s_.get('estimated') else ''))
        print(f"eddies: {len(z['eddies'])}; wrote {out}")
    elif a.cmd == 'still':
        mp = _map_path(a)
        geom = MapGeom(load_json(mp), a.hfov_deg)
        im = render_still(geom, a.image, load_json(a.zones) if a.zones else None, load_json(a.logs) if a.logs else None)
        im.save(a.out)
        print('wrote', a.out)
    else:
        zp = Path(a.zones) if a.zones else latest('zones-????-??-??.json')
        zones = load_json(zp) if zp else None
        leds = light_ranges(a.mode, zones, a.pool_height_m, a.specs)
        for x in leds:
            print(f"rope {x['rope']:2d}: LEDs {x['from']}-{x['to']} ({x['to'] - x['from'] + 1})")
        print(f"{a.mode}: {sum(x['to'] - x['from'] + 1 for x in leds)} LEDs on {len({x['rope'] for x in leds})} ropes")
        if a.write:
            p = Path(a.write)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(control(a.mode, leds, zp.name if zp else None, a.pool_height_m)) + '\n')
            print('wrote', p)


if __name__ == '__main__':
    main()
