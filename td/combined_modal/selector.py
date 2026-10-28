"""The Modal input selector's pure logic (docs/modal-inputs.md). No TouchDesigner globals: tested in
tools/tests/test_combined_modal_inputs.py, used by td/combined_modal/modal_inputs.py.

One source at a time (off / canvas / scene / frames) and one strength 0-1, saved in River/combined-modal-inputs.json.
Changing either fades over FADE_S; a stale source fades to Combined alone and back by itself.
"""
import json
import math
import os
import pathlib
import sys

SOURCES = ('off', 'canvas', 'scene', 'frames')
DEFAULT = {'source': 'canvas', 'strength': 0.18}
FADE_S = 4.0
STALE_FADE_S = {'frames': 8.0}          # SPEC §6.5: 8 s back to the river after the quiet grace
SCENE_MAX_AGE_S = 15 * 60
PALETTE_SLOTS = 6

_MODAL = str(pathlib.Path(__file__).resolve().parents[1] / 'modal') if '__file__' in globals() else 'C:/Users/user/River/river-bitcube/td/modal'
if _MODAL not in sys.path:
    sys.path.insert(0, _MODAL)
import modal_scene  # noqa: E402  (pure helpers: scene_values, reflex_offsets, Glide, hex_rgb, luminance)

KNOBS = modal_scene.KNOBS
DRIVES = {'palette': 'river recolour (gradient map by brightness)',
          'speed': 'summer effect speed ×0.6–1.6 (live video stays at camera speed)',
          'density': 'summer effects amount ×0.4–1.6',
          'brightness': 'river gain ×0.5–1.25',
          'turbulence': 'torrent / roughness ×0.4–1.6'}


def checked(source, strength):
    if source not in SOURCES:
        raise ValueError('source must be one of off, canvas, scene, frames')
    if isinstance(strength, bool) or not isinstance(strength, (int, float)) or not math.isfinite(strength) or not 0 <= strength <= 1:
        raise ValueError('strength must be a number from 0 to 1')
    return {'source': source, 'strength': float(strength)}


def load(path):
    try:
        d = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
        return checked(d.get('source'), d.get('strength'))
    except (OSError, ValueError, AttributeError, TypeError):
        return dict(DEFAULT)


def save(path, settings):
    settings = checked(settings['source'], settings['strength'])
    path = pathlib.Path(path)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(settings) + '\n', encoding='utf-8')
    os.replace(tmp, path)
    return settings


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


class Fader:
    """A weight per source moving linearly to its target (1 for the effective source, else 0), smoothstepped;
    the strength glides linearly. mix(source) = weight x strength."""

    def __init__(self, source='off', strength=0.0):
        self.v = {s: 1.0 if s == source else 0.0 for s in SOURCES}
        self.target = dict(self.v)
        self.rate = dict.fromkeys(SOURCES, 1 / FADE_S)
        self.s_from = self.s_to = float(strength)
        self.s_t0, self.last = 0.0, None

    def aim(self, source, now, seconds=FADE_S):
        for s in SOURCES:
            t = 1.0 if s == source else 0.0
            if self.target[s] != t:
                self.target[s] = t
                self.rate[s] = 1 / max(0.05, seconds)

    def set_strength(self, strength, now):
        self.s_from, self.s_to, self.s_t0 = self.strength(now), float(strength), now

    def strength(self, now):
        f = smooth((now - self.s_t0) / FADE_S)
        return self.s_from + (self.s_to - self.s_from) * f

    def step(self, now):
        dt = 0.0 if self.last is None else max(0.0, min(0.25, now - self.last))
        self.last = now
        for s in SOURCES:
            d = self.target[s] - self.v[s]
            self.v[s] += max(-self.rate[s] * dt, min(self.rate[s] * dt, d))

    def weight(self, source):
        return smooth(self.v[source])

    def mix(self, source, now):
        return 0.0 if source == 'off' else self.weight(source) * self.strength(now)

    def fading(self, now):
        return any(abs(self.v[s] - self.target[s]) > 1e-4 for s in SOURCES) or now - self.s_t0 < FADE_S and self.s_from != self.s_to


# ---- the scene (state.json + reflex.json, td/modal/modal_scene.py's reading) ---------------------------------------

def palette_slots(colors):
    """2-6 hex colours -> PALETTE_SLOTS RGB colours, darkest to brightest, lifted to full LED range (as modal_scene).
    A fixed count, so one palette can glide into the next. None for a bad palette."""
    try:
        rgbs = sorted((modal_scene.hex_rgb(c) for c in colors), key=modal_scene.luminance)
    except (ValueError, TypeError, AttributeError):
        return None
    if not rgbs:
        return None
    peak = max(max(c) for c in rgbs)
    k = min(modal_scene.PALETTE_MAX_BOOST, 1 / peak) if peak > 0 else 1.0
    rgbs = [tuple(min(1.0, v * k) for v in c) for c in rgbs]
    out = []
    for i in range(PALETTE_SLOTS):
        x = i * (len(rgbs) - 1) / (PALETTE_SLOTS - 1) if len(rgbs) > 1 else 0
        a, f = int(x), x - int(x)
        b = min(a + 1, len(rgbs) - 1)
        out.append(tuple(rgbs[a][j] + (rgbs[b][j] - rgbs[a][j]) * f for j in range(3)))
    return out


def ramp_rows(slots):
    """Ramp keys (pos, r, g, b, a): black at 0 so dark water stays dark, then the slots."""
    return [[0.0, 0.0, 0.0, 0.0, 1.0]] + [[round((i + 1) / len(slots), 4), *c, 1.0] for i, c in enumerate(slots)]


def to_hex(rgb):
    return '#' + ''.join(f'{max(0, min(255, round(v * 255))):02x}' for v in rgb)


def factors(knobs):
    """Multipliers at full strength; 0.4 speed, 0.5 elsewhere = 1x (Combined as tuned)."""
    s, d, b, t = (knobs[k] for k in ('speed', 'density', 'brightness', 'turbulence'))
    return {'speed': 0.6 + 1.0 * s, 'density': 0.4 + 1.2 * d,
            'brightness': min(modal_scene.GAIN_CAP, 0.5 + 1.0 * b), 'turbulence': 0.4 + 1.2 * t}


def applied(factor, mix):
    """The multiplier TD uses: 1 at mix 0, the full factor at mix 1."""
    return 1.0 + (factor - 1.0) * max(0.0, min(1.0, mix))


def scene_info(state, now_wall):
    """(usable, age_s, reason, info) for state.json's scene."""
    if state is None:
        return False, None, 'the scene file (gallery_state/state.json) is missing or unreadable', {}
    scene = state.get('scene') or {}
    stamp = state.get('set_at_epoch')
    age = max(0, round(now_wall - stamp)) if isinstance(stamp, (int, float)) else None
    info = {'set_at': state.get('set_at'), 'palette_name': scene.get('palette_name'), 'animation': scene.get('animation')}
    if not scene or scene.get('placeholder'):
        return False, age, "Dave's agent has no scene yet (placeholder)", info
    if age is None:
        return False, None, 'the scene has no set_at time', info
    if age > SCENE_MAX_AGE_S:
        return False, age, f'the scene is {age // 60} min old (over 15 min)', info
    return True, age, None, info


class Scene:
    """The scene's knobs and palette, gliding over transition_seconds, plus smoothed reflex offsets."""

    def __init__(self):
        self.knobs = modal_scene.Glide([modal_scene.NEUTRAL[k] for k in KNOBS])
        self.palette = None              # Glide over the flattened slots
        self.raw_colors, self.raw_knobs = [], dict(modal_scene.NEUTRAL)
        self.seq = None
        self.reflex = dict.fromkeys(KNOBS, 0.0)
        self.reflex_target = dict.fromkeys(KNOBS, 0.0)

    def update(self, state, reflex, now, now_wall):
        sv = modal_scene.scene_values(state) if state else None
        if sv and sv['seq'] != self.seq:
            first = self.seq is None
            seconds = 0.0 if first else sv['transition']
            self.knobs.go([sv['knobs'][k] for k in KNOBS], now, seconds)
            self.raw_knobs = dict(sv['knobs'])
            colors = (state.get('scene') or {}).get('colors') or []
            slots = palette_slots(colors)
            if slots:
                flat = [v for c in slots for v in c]
                if self.palette is None:
                    self.palette = modal_scene.Glide(flat)
                else:
                    self.palette.go(flat, now, seconds)
                self.raw_colors = list(colors)
            self.seq = sv['seq']
        self.reflex_target = modal_scene.reflex_offsets(reflex, now_wall)

    def smooth_reflex(self, dt):
        a = 1 - math.exp(-dt / modal_scene.REFLEX_SMOOTH_SECONDS) if dt > 0 else 0.0
        for k in KNOBS:
            self.reflex[k] += (self.reflex_target[k] - self.reflex[k]) * a

    def values(self, now):
        return dict(zip(KNOBS, self.knobs.value(now)))

    def effective(self, now):
        v = self.values(now)
        return {k: modal_scene.clamp(v[k] + self.reflex[k]) for k in KNOBS}

    def slots(self, now):
        if self.palette is None:
            return None
        flat = self.palette.value(now)
        return [tuple(flat[i:i + 3]) for i in range(0, len(flat), 3)]

    def params(self, now, mix):
        vals, eff = self.values(now), self.effective(now)
        f = factors(eff)
        slots = self.slots(now)
        out = []
        if slots:
            p = {'name': 'palette', 'value': [to_hex(c) for c in slots], 'drives': DRIVES['palette']}
            if self.raw_colors:
                p['raw'] = self.raw_colors
            out.append(p)
        for k in ('speed', 'density', 'brightness', 'turbulence'):
            p = {'name': k, 'value': round(vals[k], 3), 'drives': DRIVES[k]}
            if abs(eff[k] - vals[k]) > 5e-4:
                p['effective'] = round(eff[k], 3)
            if abs(self.raw_knobs[k] - vals[k]) > 5e-4:
                p['raw'] = round(self.raw_knobs[k], 3)
            p['factor'] = round(applied(f[k], mix), 3)
            out.append(p)
        return out
