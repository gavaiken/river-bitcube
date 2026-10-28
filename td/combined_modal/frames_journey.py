"""Modal Frames on bitcube's side (modal-frames/SPEC.md §6): journeys in OKLCH and quiet handling. Pure numpy, no TD.

Used by td/combined_modal/modal_inputs.py (in a worker thread) and tools/tests/test_combined_modal_inputs.py.
Images are float32 sRGB arrays (h, w, 3), row 0 = the top of the element (as the PNGs and .rgb files are).
The river ripple (§6.3) runs on the GPU (frames_ripple.glsl); this module only makes "target_colour_now".
"""
import json
import math
import pathlib

import numpy as np

ELEMENTS = ('screen-1', 'screen-2', 'screen-3', 'screen-4', 'ropes')
SIZES = {'screen-1': (128, 256), 'screen-2': (128, 256), 'screen-3': (128, 256), 'screen-4': (128, 256), 'ropes': (20, 400)}
RIVER_DEFAULT = {'amount': 0.6, 'contrast': 0.5, 'speed': 1.0}
TRANSITION_DEFAULT = {'duration_ms': 5000, 'easing': 'ease-in-out', 'via': []}
QUIET_GRACE_S = 120.0          # keep showing the last target this long into quiet (§6.5)
POLL_DEAD_S = 45.0             # frames_sync has had no successful poll for this long: polls are failing
VIA_PULL = 0.6
SCHEMA, LAYOUT_VERSION = 'modal-frames/1', 1

# ---- colour: sRGB <-> OKLab <-> OKLCH (Björn Ottosson's matrices) ------------------------------------------------
_M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                [0.2119034982, 0.6806995451, 0.1073969566],
                [0.0883024619, 0.2817188376, 0.6299787005]], dtype=np.float32)
_M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                [1.9779984951, -2.4285922050, 0.4505937099],
                [0.0259040371, 0.7827717662, -0.8086757660]], dtype=np.float32)
_M1I = np.linalg.inv(_M1.astype(np.float64)).astype(np.float32)
_M2I = np.linalg.inv(_M2.astype(np.float64)).astype(np.float32)
CHROMA_EPS = 0.02


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def srgb_to_oklab(rgb):
    lms = srgb_to_linear(rgb) @ _M1.T
    return np.cbrt(lms) @ _M2.T


def oklab_to_srgb(lab):
    lms = (np.asarray(lab, dtype=np.float32) @ _M2I.T) ** 3
    return linear_to_srgb(lms @ _M1I.T).astype(np.float32)


def lab_to_lch(lab):
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    return np.stack([L, np.hypot(a, b), np.arctan2(b, a)], axis=-1)


def lch_to_lab(lch):
    L, C, h = lch[..., 0], lch[..., 1], lch[..., 2]
    return np.stack([L, C * np.cos(h), C * np.sin(h)], axis=-1)


def lch_mix(p, q, f):
    """OKLCH interpolation: L and C linear, hue the short way round; a grey end takes the other end's hue."""
    hp, hq = p[..., 2], q[..., 2]
    hp = np.where(p[..., 1] < CHROMA_EPS, hq, hp)
    hq = np.where(q[..., 1] < CHROMA_EPS, hp, hq)
    dh = (hq - hp + math.pi) % (2 * math.pi) - math.pi
    return np.stack([p[..., 0] + (q[..., 0] - p[..., 0]) * f,
                     p[..., 1] + (q[..., 1] - p[..., 1]) * f,
                     hp + dh * f], axis=-1)


def hex_rgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def ease(name, t):
    t = min(1.0, max(0.0, t))
    if name == 'linear':
        return t
    if name == 'ease-in':
        return t * t
    if name == 'ease-out':
        return 1 - (1 - t) ** 2
    return t * t * (3 - 2 * t)


class Journey:
    """One element's colour path: start -> via1 -> ... -> target, equal time per leg, eased in time (§6.2)."""

    def __init__(self, start_rgb, target_rgb, via=(), seconds=0.0, easing='ease-in-out', t0=0.0):
        start, target = srgb_to_oklab(start_rgb), srgb_to_oklab(target_rgb)
        points = [start]
        n = len(via)
        for i, colour in enumerate(via, start=1):
            base = start + (target - start) * (i / (n + 1))
            v = srgb_to_oklab(np.array(hex_rgb(colour), dtype=np.float32))
            points.append(base + (v - base) * VIA_PULL)
        points.append(target)
        self.points = [lab_to_lch(p) for p in points]
        self.target_rgb = np.asarray(target_rgb, dtype=np.float32)
        self.seconds, self.easing, self.t0 = max(0.0, seconds), easing, t0

    def progress(self, now):
        return 1.0 if self.seconds <= 0 else min(1.0, max(0.0, (now - self.t0) / self.seconds))

    def done(self, now):
        return self.progress(now) >= 1.0

    def colour(self, now):
        p = self.progress(now)
        if p >= 1.0:
            return self.target_rgb
        e = ease(self.easing, p) * (len(self.points) - 1)
        leg = min(len(self.points) - 2, int(e))
        return oklab_to_srgb(lch_to_lab(lch_mix(self.points[leg], self.points[leg + 1], np.float32(e - leg))))


class Element:
    """What one element shows: its target picture now (journeying) and its river settings (gliding)."""

    def __init__(self, name):
        self.name = name
        self.journey = None              # None until a target has arrived
        self.ref = None                  # '<frame_id>/<element>' of the target picture
        self.now = None                  # float32 (h, w, 3), the colour shown now (before the river ripple)
        self.river_from = dict(RIVER_DEFAULT)
        self.river_to = dict(RIVER_DEFAULT)
        self.river_t0, self.river_s, self.river_easing = 0.0, 0.0, 'ease-in-out'

    def river(self, now):
        f = ease(self.river_easing, 1.0 if self.river_s <= 0 else (now - self.river_t0) / self.river_s)
        return {k: self.river_from[k] + (self.river_to[k] - self.river_from[k]) * f for k in RIVER_DEFAULT}

    def set_river(self, values, now, seconds, easing):
        self.river_from = self.river(now)
        self.river_to = dict(self.river_from, **{k: float(v) for k, v in (values or {}).items() if k in RIVER_DEFAULT})
        self.river_t0, self.river_s, self.river_easing = now, seconds, easing

    def set_target(self, rgb, now, seconds, easing, via, jump=False):
        start = rgb if (jump or self.now is None) else self.now
        self.journey = Journey(start, rgb, via if not jump else (), 0.0 if jump else seconds, easing, now)
        self.now = self.journey.colour(now)

    def step(self, now):
        """Recompute `now`; True if it changed."""
        if self.journey is None:
            return False
        if self.journey.done(now) and self.now is self.journey.target_rgb:
            return False
        self.now = self.journey.colour(now)
        return True

    def progress(self, now):
        return None if self.journey is None else round(self.journey.progress(now), 3)


def load_rgb(folder, ref):
    """targets.json reference '<frame_id>/<element>' -> float32 (h, w, 3) from the .rgb file frames_sync writes."""
    name = ref.split('/')[-1]
    w, h = SIZES[name]
    path = pathlib.Path(folder) / (ref + '.rgb')
    data = path.read_bytes() if path.exists() else None
    if data is None:                                   # fallback: decode the PNG (slow, pure Python)
        import sys
        tools = str(pathlib.Path(__file__).resolve().parents[2] / 'tools' / 'modal')
        if tools not in sys.path:
            sys.path.insert(0, tools)
        import frames_sync
        data = frames_sync.png_rgb((pathlib.Path(folder) / (ref + '.png')).read_bytes())
    a = np.frombuffer(data, dtype=np.uint8)
    if a.size != w * h * 3:
        raise ValueError(f'{ref}: {a.size} bytes, expected {w * h * 3}')
    return (a.reshape(h, w, 3).astype(np.float32) / 255.0)


def manifest_ok(m):
    return (isinstance(m, dict) and m.get('schema') == SCHEMA and m.get('layout_version') == LAYOUT_VERSION
            and isinstance(m.get('elements'), dict))


def quiet(now_wall, arrived, ttl, sync, has_frame):
    """(quiet_since or None, stale, reason) per §6.5: polls failing, 404, or the frame past its ttl since arrival.
    Stale = quiet for longer than QUIET_GRACE_S (then the show fades back to Combined)."""
    since, why = [], []
    sync = sync or {}
    if not has_frame:
        return (0.0, True, 'no Modal frame has arrived yet')
    expiry = arrived + ttl
    if now_wall >= expiry:
        since.append(expiry)
        why.append(f'frame past its ttl ({ttl} s)')
    last_ok = sync.get('last_ok_epoch')
    if not isinstance(last_ok, (int, float)) or now_wall - last_ok > POLL_DEAD_S:
        since.append(last_ok if isinstance(last_ok, (int, float)) else arrived)
        why.append('frames_sync is not reaching Modal' if sync else 'frames_sync is not running')
    nf = sync.get('not_found_since')
    if isinstance(nf, (int, float)):
        since.append(nf)
        why.append('Modal has no frame (404)')
    if not since:
        return (None, False, None)
    start = min(since)
    stale = now_wall - start > QUIET_GRACE_S
    return (start, stale, '; '.join(why) + (f', quiet for {int(now_wall - start)} s' if stale else ''))


class Frames:
    """All five elements plus the files: call poll() about once a second and step() often (worker thread)."""

    def __init__(self, folder):
        self.folder = pathlib.Path(folder)
        self.elements = {n: Element(n) for n in ELEMENTS}
        self.frame_id, self.manifest, self.arrived, self.mtime = None, None, None, None
        self.sync, self.error, self.versions = None, None, dict.fromkeys(ELEMENTS, 0)

    def _read(self, name):
        try:
            return json.loads((self.folder / name).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None

    def poll(self, now, now_wall):
        """Read sync.json; on a new latest.json, start the journeys. Returns True when a new frame arrived."""
        self.sync = self._read('sync.json')
        try:
            mtime = (self.folder / 'latest.json').stat().st_mtime
        except OSError:
            return False
        if mtime == self.mtime:
            return False
        m = self._read('latest.json')
        if not manifest_ok(m) or m.get('frame_id') == self.frame_id:
            self.mtime = mtime
            return False
        first = self.frame_id is None
        targets = self._read('targets.json') or {}
        tr = dict(TRANSITION_DEFAULT, **(m.get('transition') or {}))
        seconds, easing, via = tr['duration_ms'] / 1000.0, tr['easing'], list(tr.get('via') or [])
        for name, el in self.elements.items():
            spec = m['elements'].get(name)
            ref = f"{m['frame_id']}/{name}" if spec and 'image' in spec else (targets.get(name) if first else None)
            if ref:
                el.set_target(load_rgb(self.folder, ref), now, seconds, easing, via, jump=first)
                el.ref = ref
                self.versions[name] += 1
            if spec and 'river' in spec:
                el.set_river(spec['river'], now, 0.0 if first else seconds, easing)
        self.frame_id, self.manifest, self.mtime = m['frame_id'], m, mtime
        self.arrived = mtime if first else now_wall
        return True

    def step(self, now):
        for name, el in self.elements.items():
            if el.step(now):
                self.versions[name] += 1

    def ttl(self):
        return (self.manifest or {}).get('ttl_s', 120)

    def quiet(self, now_wall):
        return quiet(now_wall, self.arrived or 0.0, self.ttl(), self.sync, self.frame_id is not None)

    def has_target(self, name):
        return self.elements[name].now is not None
