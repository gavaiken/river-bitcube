# Dave's Modal agent drives the river_local look. Synced into /project1/river_local/modal_scene_mod.
#
# tools/modal/modal_link.py mirrors the agent's files into C:/Users/user/River/gallery_state every 3 s.
# Every 2 s this reads two of them:
#   state.json   the scene the agent composes every 5 min: 5 colours, speed, density, brightness, turbulence
#                (0..1) and transition_seconds. A new scene glides in over transition_seconds.
#   reflex.json  fast nudges from the camera clips (offsets for the same four knobs), valid for ttl_seconds.
# The scene scales the look parameters on river_local's River page instead of replacing them, so the
# hand-tuned look stays the centre and Modal Mix 0 gives it back exactly:
#   speed -> flow + rain speed, density -> rain density, turbulence -> sparkle and a shorter memory,
#   brightness -> overall gain (capped), colours -> the river palette (ramp_modal, crossed in by Modal Palette;
#   lifted so its brightest colour uses the LEDs' full range).
# Flow and rain positions are integrated here (phase += speed * dt), so a changing speed never makes
# the noise jump. If the files are missing or unreadable the look runs unmodulated.
import json
import math
import pathlib
import sys
import time
import types

STATE_DIR = pathlib.Path(r'C:\Users\user\River\gallery_state')
READ_SECONDS = 2.0
CANVAS_RELOAD_AFTER = 30.0          # s after the project loads: reload Dave's canvas once (see frame())
REFLEX_SMOOTH_SECONDS = 3.0
GAIN_CAP = 1.25                     # never more than 1.25x the tuned gain (power)
PALETTE_MAX_BOOST = 4.0             # how far a dim palette may be lifted to full LED range
LIMITS = {'Memory': 3.3}            # the river memory's cache holds 200 frames = 3.33 s at 60 fps
NEUTRAL = {'speed': 0.5, 'density': 0.5, 'brightness': 0.5, 'turbulence': 0.5}
KNOBS = tuple(NEUTRAL)


# ---- pure helpers (tested in tools/tests/test_modal_scene.py) ------------------------------------------

def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def palette_keys(colors):
    """Ramp keys (pos, r, g, b, a) for the lookup: black at 0 (dark water stays dark on the LEDs), then the
    agent's colours from darkest to brightest. Falls back to None for a bad palette."""
    try:
        rgbs = sorted((hex_rgb(c) for c in colors), key=luminance)
    except (ValueError, TypeError, AttributeError):
        return None
    if not rgbs:
        return None
    # Dave's palettes are composed for a screen and often top out dim; on the LEDs that just loses light.
    # Scale the whole palette (hues and ratios kept) so its brightest channel reaches 1. The agent's
    # brightness knob still sets the overall level (Gain).
    peak = max(max(c) for c in rgbs)
    k = min(PALETTE_MAX_BOOST, 1 / peak) if peak > 0 else 1.0
    rgbs = [tuple(min(1.0, v * k) for v in c) for c in rgbs]
    n = len(rgbs)
    return [[0.0, 0.0, 0.0, 0.0, 1.0]] + [[round((i + 1) / n, 4), *rgb, 1.0] for i, rgb in enumerate(rgbs)]


def scene_values(state):
    """Knob values (0..1) and palette keys from state.json; None if it isn't a usable scene."""
    scene = (state or {}).get('scene') or {}
    if not scene or scene.get('placeholder'):
        return None
    vals = {k: clamp(float(scene.get(k, NEUTRAL[k]))) for k in KNOBS}
    return {'knobs': vals, 'keys': palette_keys(scene.get('colors') or []),
            'transition': max(0.0, float(scene.get('transition_seconds', 60.0))),
            'seq': state.get('seq'), 'name': f"{scene.get('animation', '?')} / {scene.get('palette_name', '?')}"}


def reflex_offsets(reflex, now):
    """The camera reflexes' offsets while they are fresh (ttl), else zeros."""
    zero = {k: 0.0 for k in KNOBS}
    if not reflex:
        return zero
    age = now - float(reflex.get('updated_epoch', 0))
    if age < 0 or age > float(reflex.get('ttl_seconds', 90)):
        return zero
    off = reflex.get('offsets') or {}
    return {k: clamp(float(off.get(k, 0.0)), -1.0, 1.0) for k in KNOBS}


def factors(knobs):
    """Multipliers for the tuned look parameters. 0.5 on every knob = 1x (the tuned look)."""
    s, d, b, t = (knobs[k] for k in ('speed', 'density', 'brightness', 'turbulence'))
    return {
        'Flowspeed': 0.25 + 1.5 * s,        # 0.25x .. 1.75x
        'Rainspeed': 0.4 + 1.2 * s,
        'Raindensity': 0.4 + 1.2 * d,
        'Sparkle': 0.2 + 1.6 * t,
        'Memory': 1.35 - 0.7 * t,           # hectic water forgets quickly, calm water remembers
        'Gain': min(GAIN_CAP, 0.5 + 1.0 * b),
    }


def lerp(a, b, f):
    return a + (b - a) * f


def blend(base, factor, mix):
    """The parameter value TD uses: the tuned value scaled by the factor, faded in by Modal Mix."""
    return base * lerp(1.0, factor, clamp(mix))


class Glide:
    """Moves a vector of floats linearly from where it is to a new target over `seconds`."""

    def __init__(self, value):
        self.start = list(value)
        self.target = list(value)
        self.t0, self.seconds = 0.0, 0.0

    def value(self, now):
        if self.seconds <= 0:
            return list(self.target)
        f = clamp((now - self.t0) / self.seconds)
        return [lerp(a, b, f) for a, b in zip(self.start, self.target)]

    def go(self, target, now, seconds):
        self.start = self.value(now)
        self.target = list(target)
        self.t0, self.seconds = now, max(0.0, seconds)


def flatten_keys(keys):
    return [v for row in keys for v in row]


def unflatten_keys(flat):
    return [flat[i:i + 5] for i in range(0, len(flat), 5)]


# ---- live (TD side) ------------------------------------------------------------------------------------------

def _holder():
    h = sys.modules.setdefault('modal_scene_live', types.ModuleType('modal_scene_live'))
    if not hasattr(h, 'st'):
        h.st = None
    return h


def _read(name):
    try:
        return json.loads((STATE_DIR / name).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def _state():
    h = _holder()
    if h.st is None:
        h.st = {'knobs': Glide([NEUTRAL[k] for k in KNOBS]), 'keys': None, 'seq': None, 'name': '',
                'reflex': {k: 0.0 for k in KNOBS}, 'reflex_target': {k: 0.0 for k in KNOBS},
                'next_read': 0.0, 'last_frame': None, 'phase': {'river': 0.0, 'rain': 0.0},
                'ok': False, 'error': None, 'scene_age': None, 'canvas_reloaded': False}
    return h.st


def _poll(st, now, wall):
    st['next_read'] = now + READ_SECONDS
    state = _read('state.json')
    sv = scene_values(state) if state else None
    st['ok'] = sv is not None
    if sv:
        st['scene_age'] = wall - float(state.get('set_at_epoch', wall))
        if sv['seq'] != st['seq']:
            first = st['seq'] is None
            seconds = 0.0 if first else sv['transition']          # the first scene after a load: no glide
            st['knobs'].go([sv['knobs'][k] for k in KNOBS], now, seconds)
            if sv['keys']:
                old = st['keys']
                if old is None or len(old.target) != len(flatten_keys(sv['keys'])):
                    st['keys'] = Glide(flatten_keys(sv['keys']))
                else:
                    old.go(flatten_keys(sv['keys']), now, seconds)
            st['seq'], st['name'] = sv['seq'], sv['name']
    st['reflex_target'] = reflex_offsets(_read('reflex.json'), wall)


def knobs(now=None):
    """Current knob values: the gliding scene plus the smoothed reflexes."""
    st = _state()
    now = absTime.seconds if now is None else now               # noqa: F821 (TD global)
    scene = dict(zip(KNOBS, st['knobs'].value(now)))
    return {k: clamp(scene[k] + st['reflex'][k]) for k in KNOBS}


def frame(comp):
    """executeDAT onFrameStart: read the files now and then, glide, integrate the flow and rain phases."""
    st = _state()
    now = absTime.seconds                                         # noqa: F821
    last = st['last_frame']
    dt = 0.0 if last is None or now < last else min(0.25, now - last)
    st['last_frame'] = now
    if now >= st['next_read'] or now < st['next_read'] - 10:
        try:
            _poll(st, now, time.time())
            st['error'] = None
        except Exception as e:                                    # noqa: BLE001 - never stop the show
            st['error'] = repr(e)
    if not st.get('canvas_reloaded') and now > CANVAS_RELOAD_AFTER:
        # At login TD can open Dave's canvas before modal_link's mirror serves it; reload it once.
        st['canvas_reloaded'] = True
        cv = comp.op('modal_canvas')
        if cv is not None and cv.par.active:
            cv.par.reload.pulse()
    a = 1 - math.exp(-dt / REFLEX_SMOOTH_SECONDS) if dt else 0.0
    for k in KNOBS:
        st['reflex'][k] += (st['reflex_target'][k] - st['reflex'][k]) * a
    st['phase']['river'] += eff(comp, 'Flowspeed') * dt
    st['phase']['rain'] += eff(comp, 'Rainspeed') * dt
    if st['keys'] is not None:
        t = comp.op('ramp_modal_keys')
        rows = unflatten_keys(st['keys'].value(now))
        if t is not None:
            if t.numRows != len(rows) + 1:
                t.clear()
                t.appendRow(['pos', 'r', 'g', 'b', 'a'])
                for row in rows:
                    t.appendRow([round(v, 4) for v in row])
            for i, row in enumerate(rows, start=1):
                for j, v in enumerate(row):
                    if abs(float(t[i, j].val) - v) > 1e-4:
                        t[i, j] = round(v, 4)


def eff(comp, name):
    """The value of look parameter `name` after Modal: used by river_local's expressions."""
    base = getattr(comp.par, name).eval()
    try:
        if name == 'Sparkle':                                     # day/night first (river_cam.daynight)
            base = comp.op('river_cam_mod').module.daynight(comp, name)
        st = _state()
        if not st['ok']:
            return base
        v = blend(base, factors(knobs())[name], comp.par.Modalmix.eval())
        return min(v, LIMITS.get(name, v))
    except Exception:                                             # noqa: BLE001
        return base


def ok():
    """True once a usable scene has been read (the palette crossfade waits for it)."""
    return bool(_state()['ok'])


def phase(name):
    return _state()['phase'][name]


def status():
    st = _state()
    return {'ok': st['ok'], 'scene': st['name'], 'seq': st['seq'], 'error': st['error'],
            'scene_age_s': None if st['scene_age'] is None else round(st['scene_age']),
            'knobs': {k: round(v, 3) for k, v in knobs().items()},
            'reflex': {k: round(v, 3) for k, v in st['reflex'].items()}}
