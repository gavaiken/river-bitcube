"""The remembered river's runtime: reads its inputs, runs the loop clock, renders the ropes and the panels, writes
status.json. Synced into /project1/remembered/show_mod by td/build/build_remembered.py; the Execute DAT calls frame(comp)
every frame and the two Script TOPs call cook_ropes / cook_panels.

Inputs (on bitcube, under C:\\Users\\user\\River):
  gallery_state\\state.json, reflex.json   Dave's mirror: memory + surge_at (section 2), scene knobs/colours, reflexes, heard
  presence.json                            people + lingerers (section 4)
  remembered\\control.json                 the control request file (control_schema.py; section 5)
  <repo>\\data\\remembered\\                notable.json, profiles.json.gz, days.csv (the fallback library)
Output: remembered\\status.json (section 5), twice a second.

Everything up to the TD wrappers at the bottom is plain Python + numpy and is tested offline (Show with temp folders).
Live state lives in a holder module in sys.modules ('remembered_live'), never in comp.storage; times are wall-clock
(time.time()), never absTime.
"""
import json
import math
import sys
import time
import types
from collections import deque
from pathlib import Path

import numpy as np


from . import clock
from . import control_schema
from . import palette
from . import panels as panels_mod
from . import ropes as ropes_mod
from . import status as status_mod
from . import water as water_mod
from . import video_library
from . import particles as particles_mod
from . import flow as flow_mod
from . import ribbons as ribbons_mod
from . import ribbons_gpu
from . import zones as zones_mod

RIVER = Path(r'C:\Users\user\River')
REPO = Path(__file__).resolve().parents[2]
SHOW = 'river-remembered.toe'
READ_DAVE_S, READ_PRESENCE_S, READ_CONTROL_S, READ_LIBRARY_S = 2.0, 0.5, 1.0, 600.0
PRESENCE_STALE_S = 30.0
NOW_WINDOW, USUAL_WINDOW, USUAL_FLOOR = 30.0, 600.0, 0.75
REFLEX_TAU = 4.0 / 3.0              # reflex nudges ease in over ~4 s (95 %)
NIGHT_TAU = 1.5
REFLEX_MTIME_S = 90.0              # reflex.json without updated_epoch: stale when the file is older
DAY_PALETTE_S = 8.0                 # a new day's palette glides in with the decision wave
RIVER_STALE_S = 10.0
ROPE_EVERY = 2                      # the ropes step every 2nd frame (30 Hz), alternating with the ribbons
PANEL_EVERY = 2                     # screens step every 2nd frame
KNOBS = ('speed', 'density', 'brightness', 'turbulence')
NEUTRAL = {k: 0.5 for k in KNOBS}
# control.json's fields (control_schema.FIELDS) -> the keys the show uses
CONTROL_KEYS = {'pool_height_m': 'pool_height_m', 'light': 'light', 'leds': 'leds', 'opening_night': 'opening_night',
                'screens.intensity': 'screen_intensity', 'screens.threshold': 'screen_threshold',
                'screens.mode': 'screen_mode', 'screens.video': 'screen_video', 'screens.field': 'screen_field',
                'screens.gpu': 'screen_gpu', 'screens.motion_mask': 'screen_motion_mask'}
# the defaults are control_schema's (opening night ON unless told; the river video 0.7: Gavin, 28 Oct, "see the water video
# more"), except intensity and threshold: None until someone sets them, so the screens use water.SETTINGS (whose values are
# control_schema's defaults too)
CONTROL_DEFAULT = {key: control_schema.DEFAULTS[name] for name, key in CONTROL_KEYS.items()}
CONTROL_DEFAULT.update(leds=[], screen_intensity=None, screen_threshold=None)
LIGHT_CLOCK_SLACK_S = 2.0           # a light stamped this much before the show started still counts (clock rounding)
# the particle fields: ribbons (silk of glitter, Gavin's reference, 28 Oct, the default) | fine (M2's smoky streaks with
# ledges, flow.py) | streaks (round 2b, particles.py, checkpoint remembered-particles-v1)
FIELDS = tuple(control_schema.FIELDS['screens.field']['choices'])   # ('ribbons', 'fine', 'streaks')
# M4 (the artists, 27 Oct: "more dynamic"): small surges between the main ones
MINI_EMPTY_S = (60.0, 240.0)        # an empty room: a random small surge every 1-4 minutes
MINI_ROOM_GAP_S = 60.0              # a busy room or a lingerer: at most one a minute
MINI_LEN_S = 24.0                   # a small surge's body and settling (ropes.MINI_BODY + MINI_SETTLE)
MINI_CLEAR_S = 45.0                 # never within this of the main surge
SCREEN_CALM = 0.4                   # the screens in calm, as a share of their intensity (artists, 27 Oct: follow the loop)
DARK_LUMA = 0.08                    # the live cam darker than this (night) -> the screens use the clips
LIGHTS = tuple(control_schema.FIELDS['light']['choices'])          # ('off', 'pool', 'eddies', 'leds')


def parse_control(c):
    """River\\remembered\\control.json -> {pool_height_m, light, leds, opening_night, screen_*}, through the one schema
    (control_schema.py: the canonical flat shape; zones.{light, pool_height_m, leds}, opening.on and screen_<name> are read
    only when the flat key is absent). Opening night: on unless the file says "opening_night": false. The light here is what
    was asked; Show._read drops one set before the show started or over control_schema.LIGHT_MAX_S ago (effective_light)."""
    ctl = dict(CONTROL_DEFAULT)
    for name, v in control_schema.validate(c).items():
        if name in CONTROL_KEYS:
            ctl[CONTROL_KEYS[name]] = v
    return ctl


def effective_light(ctl, raw, mtime, started, now):
    """The light a parsed control may use now: a light check (pool, eddies, leds) set before this show started (a restart
    or a rebuild: never come up in calibration white) or more than LIGHT_MAX_S ago goes back to off. Returns (ctl, why),
    why a short reason when it was dropped, else None. The file is left as it is (TouchDesigner only reads it); probe.ps1
    stamps light_at whenever someone picks a light, so a later write of another control doesn't bring an old one back."""
    if ctl['light'] == 'off':
        return ctl, None
    at = control_schema.light_set_at(control_schema.validate(raw), mtime)
    why = None
    if at is None or (started is not None and at < started - LIGHT_CLOCK_SLACK_S):
        why = 'set before the show started'
    elif now - at > control_schema.LIGHT_MAX_S:
        why = f'set over {control_schema.LIGHT_MAX_S / 60:.0f} minutes ago'
    if why:
        ctl = dict(ctl, light='off', leds=[])
    return ctl, why


def screen_level(t, times, opening=True):
    """The screens' share of their intensity through the loop: SCREEN_CALM in calm, eased up to 1 from building to the
    surge, held through the surge, eased back down while settling."""
    def ease(x):
        x = max(0.0, min(1.0, x))
        return x * x * (3 - 2 * x)
    b, s, st, c = ((times or {}).get(k) for k in ('build', 'surge', 'settle', 'calm'))
    if None in (b, s, st, c):
        return SCREEN_CALM
    if t < b:
        return SCREEN_CALM
    if t < s:
        return SCREEN_CALM + (1 - SCREEN_CALM) * ease((t - b) / max(1.0, s - b))
    if t < st:
        return 1.0
    return 1.0 - (1 - SCREEN_CALM) * ease((t - st) / max(1.0, c - st))


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return None


_warned = set()


def warn_once(key, msg):
    """Print msg the first time key comes up (a bad value from a file read every 2 s must not flood TouchDesigner's log)."""
    if key not in _warned:
        _warned.add(key)
        print(f'remembered: {msg}')


def num_or(v, default, what):
    """v as a finite float, else default (and a warning, once per what)."""
    try:
        x = float(v)
        if math.isfinite(x):
            return x
    except (TypeError, ValueError):
        pass
    warn_once(what, f'{what} is {v!r}, not a number: using {default}')
    return default


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return None
    return xs[n // 2] if n % 2 else 0.5 * (xs[n // 2 - 1] + xs[n // 2])


class Room:
    """presence.json -> presence now (median 30 s), usual (median 10 min, floor 0.75), relative, empty, lingerers."""

    def __init__(self):
        self.samples = deque()
        self.last_t = None
        self.last_person = None
        self.first = None
        self.lingerers = []

    def add(self, now, data):
        if not isinstance(data, dict):
            return
        t = float(data.get('t') or 0)
        if now - t > PRESENCE_STALE_S or t == self.last_t:
            return
        self.last_t = t
        count = float(data.get('count') or len(data.get('people') or []) or 0)
        self.samples.append((now, count))
        self.first = self.first or now
        if count > 0:
            self.last_person = now
        while self.samples and self.samples[0][0] < now - USUAL_WINDOW:
            self.samples.popleft()
        ling = []
        for g in data.get('lingerers') or []:
            if isinstance(g, dict):
                ling.append({'x': g.get('x'), 'y': g.get('y'), 'still_s': g.get('still_s'),
                             'ropes': [int(r) for r in g.get('ropes') or [] if isinstance(r, (int, float))]})
        self.lingerers = ling

    def stats(self, now):
        ok = self.last_t is not None and now - self.last_t <= PRESENCE_STALE_S
        if not ok:
            return {'available': False, 'presence': None, 'usual': None, 'relative': None, 'empty_for_s': None,
                    'lingerers': []}
        p = median([c for s, c in self.samples if s >= now - NOW_WINDOW]) or 0.0
        u = max(USUAL_FLOOR, median([c for _, c in self.samples]) or 0.0)
        empty = now - (self.last_person if self.last_person is not None else self.first)
        return {'available': True, 'presence': p, 'usual': u, 'relative': p / u, 'empty_for_s': empty,
                'lingerers': self.lingerers}


class Knobs:
    """Dave's four knobs gliding over transition_seconds, plus the reflex nudges easing in over ~4 s."""

    def __init__(self):
        self.start = dict(NEUTRAL)
        self.target = dict(NEUTRAL)
        self.t0, self.seconds = 0.0, 0.0
        self.seq = None
        self.reflex = {k: 0.0 for k in KNOBS}
        self.reflex_target = {k: 0.0 for k in KNOBS}
        self.colors = None

    def scene(self, now):
        f = 1.0 if self.seconds <= 0 else min(1.0, max(0.0, (now - self.t0) / self.seconds))
        return {k: self.start[k] + (self.target[k] - self.start[k]) * f for k in KNOBS}

    def set_scene(self, state, now):
        sc = (state or {}).get('scene') if isinstance(state, dict) else None
        if not isinstance(sc, dict) or not sc or sc.get('placeholder'):
            return
        seq = state.get('seq', state.get('set_at_epoch'))
        if seq == self.seq:
            return
        first = self.seq is None
        self.start = self.scene(now)
        # Dave's scene is someone else's file: a knob that isn't a number keeps the neutral 0.5 (never aborts the tick)
        self.target = {k: min(1.0, max(0.0, num_or(sc.get(k, 0.5), 0.5, f'scene.{k}'))) for k in KNOBS}
        self.t0 = now
        self.seconds = 0.0 if first else max(0.0, num_or(sc.get('transition_seconds', 60.0), 60.0, 'scene.transition_seconds'))
        self.seq = seq
        self.colors = sc.get('colors') or None

    def set_reflex(self, reflex, now):
        zero = {k: 0.0 for k in KNOBS}
        if not reflex or not fresh_reflex(reflex, now):
            self.reflex_target = zero
            return
        off = reflex.get('offsets') if isinstance(reflex.get('offsets'), dict) else {}
        self.reflex_target = {k: min(1.0, max(-1.0, num_or(off.get(k, 0.0), 0.0, f'reflex.offsets.{k}'))) for k in KNOBS}

    def step(self, dt):
        a = 1 - math.exp(-dt / REFLEX_TAU) if dt > 0 else 0.0
        for k in KNOBS:
            self.reflex[k] += (self.reflex_target[k] - self.reflex[k]) * a

    def value(self, now):
        s = self.scene(now)
        return {k: min(1.0, max(0.0, s[k] + self.reflex[k])) for k in KNOBS}


def fresh_reflex(reflex, now):
    """reflex.json is rewritten only when a clip arrives: fresh while now <= updated_epoch + ttl_seconds; without
    updated_epoch, while the file (its mtime, kept as '_mtime') is at most REFLEX_MTIME_S old."""
    if reflex.get('updated_epoch'):
        age = now - float(reflex['updated_epoch'])
        return 0 <= age <= float(reflex.get('ttl_seconds', REFLEX_MTIME_S) or REFLEX_MTIME_S)
    m = reflex.get('_mtime')
    return m is not None and 0 <= now - m <= REFLEX_MTIME_S


def heard_of(reflex, now):
    """reflex.json's heard (0..1) while the reflex is fresh, else None."""
    if not isinstance(reflex, dict) or not fresh_reflex(reflex, now):
        return None
    h = reflex.get('heard')
    return min(1.0, max(0.0, float(h))) if isinstance(h, (int, float)) and math.isfinite(h) else None


class PaletteGlide:
    def __init__(self, pal):
        self.cur = {k: tuple(v) for k, v in pal.items()}
        self.target = dict(self.cur)
        self.rate = 0.0

    def go(self, pal, seconds):
        if pal != self.target:
            self.target = {k: tuple(v) for k, v in pal.items()}
            self.rate = 1.0 / max(0.5, seconds)

    def step(self, dt):
        f = min(1.0, self.rate * dt) if self.rate else 1.0
        self.cur = {k: tuple(a + (b - a) * f for a, b in zip(self.cur[k], self.target[k])) for k in self.cur}
        return self.cur


class Show:
    def __init__(self, zones=None, river_dir=RIVER, data_dir=None, seed=0, show=SHOW, pixelmap=None, screens=None, zones_path=None):
        self.z = zones or zones_mod.Zones()
        self.river = Path(river_dir)
        self.data = Path(data_dir) if data_dir else REPO / 'data' / 'remembered'
        self.show = show
        self.loop = clock.Loop(seed)
        self.ropes = ropes_mod.Ropes(self.z, seed)
        self.panels = panels_mod.Panels(self.z, seed)
        self.water = water_mod.Water()
        self.calib = (pixelmap, screens, zones_path, seed)
        self.fields = {}
        self.field, self.field_kind = None, None
        self.use_field(CONTROL_DEFAULT['screen_field'])
        self.rope_level = 0.0                 # the ropes' brightness, smoothed: how busy the particle field is
        self.mini_t0 = None                   # M4: the small surge playing now (when it started), and why
        self.mini_kind = None
        self.mini_last = -1e9
        self.mini_next_empty = None
        self.mini_ease = (2.0, 6.0)
        self.drift_p = np.random.default_rng(seed + 3).uniform(0, 2 * math.pi, 2)
        self.field_dt = 0.0
        self.video_layer = None
        self.gpu_ok = False                   # the GPU ribbons' shaders built and without errors (checked in step())
        self.gpu_gain = 0.0                   # how bright the GPU draws the ribbons now (0: not the ribbons' turn)
        self.pal_now = {'deep': (0.03, 0.05, 0.19), 'mid': (0.21, 0.40, 0.49), 'light': (0.46, 0.77, 0.83)}
        self.crops = [None] * 4
        self.wins = self.water.windows(0.0)
        self.screen_level = SCREEN_CALM
        self.room = Room()
        self.knobs = Knobs()
        self.pal = PaletteGlide(palette.palette('autumn'))
        self.linger = np.zeros(ropes_mod.N_ROPES, np.float32)
        self.night = 0.0
        self.state = self.reflex = None
        self.state_mtime = None
        self.control = dict(CONTROL_DEFAULT)
        self.started = None                   # the first tick's time: a light check from before it is never taken up
        self.light_dropped = None             # why the light control.json asks for is ignored now (printed once)
        self.lib = None
        self.next = {'dave': 0.0, 'presence': 0.0, 'control': 0.0, 'library': 0.0, 'status': 0.0}
        self.river_source = 'none'
        self.river_t = None
        self.fps = 0.0
        self.rope_frame = np.zeros((ropes_mod.N_ROPES, ropes_mod.N_PX, 3), np.float32)
        self.rope_dt = 0.0
        self.panel_frame = np.zeros((panels_mod.QH, panels_mod.QW * panels_mod.NQ, 3), np.float32)
        self.last_status = None
        self.last_day = None
        self.error = None
        self.ticks = 0
        self.panel_dt = 0.0

    def screens_now(self):
        """What the screens run on now (status.json screens; the Remembered river page's "Now on bitcube")."""
        c = self.control
        return {'mode': c['screen_mode'], 'field': self.field_kind, 'video': round(c['screen_video'], 2),
                'intensity': round(self.screen_intensity(), 2),
                'threshold': round(self.water.s['sens'] if c['screen_threshold'] is None else c['screen_threshold'], 2)}

    def screen_intensity(self):
        """The screens' intensity: control.json's (0 is legal: dark screens), else the schema's default."""
        v = self.control['screen_intensity']
        return control_schema.DEFAULTS['screens.intensity'] if v is None else v

    def gpu_active(self):
        return self.gpu_ok and self.control['screen_gpu'] and self.field_kind == 'ribbons'

    def use_field(self, kind):
        """Switch the particle windows to another field (built once, kept); round 2b's streaks if one can't be built."""
        if kind == self.field_kind:
            return
        if kind not in self.fields:
            try:
                self.fields[kind] = _build_field(kind, *self.calib)
            except Exception as e:                                # noqa: BLE001
                print(f'remembered: the {kind} field failed ({e}); using the round 2b streaks')
                kind = 'streaks'
                if kind not in self.fields:
                    self.fields[kind] = _build_field(kind, *self.calib)
        self.field, self.field_kind = self.fields[kind], kind
    def _calm_level(self, opening, preset, day, hour, room, now):
        """M4: calm is a continuous curve, not one fixed level: the remembered day's hours (its rain and flow), the
        room (busier than usual: higher) and a slow drift, around the usual calm level."""
        base = clock.OPENING_CALM_LEVEL if opening else (clock.PRESET_LEVEL if preset else clock.CALM_LEVEL)
        if preset:
            return base
        energy = clock.day_energy(day, hour)
        rel = room.get('relative') if room.get('available') else None
        r = 0.0 if rel is None else max(-1.0, min(1.0, rel - 1.0))
        drift = 0.5 * (math.sin(now / 97.0 + self.drift_p[0]) + math.sin(now / 41.0 + self.drift_p[1]))
        return float(min(0.6, max(0.18, base * (0.75 + 0.55 * energy) * (1 + 0.2 * r) * (1 + 0.15 * drift))))

    def _mini(self, now, snap, room):
        """M4: a small surge between the main ones: at random every 1-4 minutes while the room is empty, or brought on
        by a busy room or someone lingering (at most one a minute). Never near the main surge."""
        tm = snap.get('times') or {}
        t = snap.get('t_s', 0.0)
        near_main = tm and (tm.get('drawback', 1e9) - MINI_CLEAR_S < t < tm.get('calm', -1e9))
        if self.mini_t0 is not None and (now - self.mini_t0 > MINI_LEN_S or near_main):
            self.mini_t0 = None
        if self.mini_t0 is None and not near_main and snap.get('phase') in ('calm', 'building'):
            empty = room.get('available') and (room.get('presence') or 0) < 0.5
            busy = room.get('available') and ((room.get('relative') or 0) > 1.5 or room.get('lingerers'))
            if self.mini_next_empty is None:
                self.mini_next_empty = now + float(np.random.uniform(*MINI_EMPTY_S))
            kind = None
            if busy and now - self.mini_last >= MINI_ROOM_GAP_S:
                kind = 'room'
            elif (empty or not room.get('available')) and now >= self.mini_next_empty:
                kind = 'random'
            if kind:
                self.mini_t0, self.mini_kind, self.mini_last = now, kind, now
                self.mini_next_empty = now + float(np.random.uniform(*MINI_EMPTY_S))
                lo, hi = math.log(1.0), math.log(8.0)
                self.mini_ease = (math.exp(np.random.uniform(lo, hi)), math.exp(np.random.uniform(lo, hi)))
        if self.mini_t0 is None:
            return {'mini_tau': None, 'mini_fill': 0.0}
        mt = now - self.mini_t0
        fill = 0.5 * min(1.0, mt / 4.0) * (1.0 - min(1.0, max(0.0, mt - 10.0) / 14.0))
        return {'mini_tau': mt, 'mini_ease': self.mini_ease, 'mini_fill': fill}

    def wants_video(self):
        """Whether the river video is drawn (the water look, or faintly under the particles: M9)."""
        return self.control['screen_mode'] == 'water' or self.control['screen_video'] > 0

    # ---- inputs ----------------------------------------------------------------------------------------------------

    def feed_river(self, img, source, now):
        """A new river frame (row 0 at the top; live cam or the recorded clip)."""
        self.panels.feed(img)                                     # the river cam's motion level (the ropes' flow without sound)
        if self.wants_video():
            self.water.feed(img)
        self.river_source = source
        self.river_t = now

    def _read(self, now):
        if now >= self.next['dave']:
            self.next['dave'] = now + READ_DAVE_S
            p = self.river / 'gallery_state' / 'state.json'
            self.state = read_json(p)
            try:
                self.state_mtime = p.stat().st_mtime
            except OSError:
                self.state_mtime = None
            rp = self.river / 'gallery_state' / 'reflex.json'
            self.reflex = read_json(rp)
            if isinstance(self.reflex, dict):
                try:
                    self.reflex['_mtime'] = rp.stat().st_mtime
                except OSError:
                    pass
            self.knobs.set_scene(self.state, now)
            self.knobs.set_reflex(self.reflex, now)
        if now >= self.next['presence']:
            self.next['presence'] = now + READ_PRESENCE_S
            self.room.add(now, read_json(self.river / 'presence.json'))
        if now >= self.next['control']:
            self.next['control'] = now + READ_CONTROL_S
            cp = self.river / 'remembered' / 'control.json'
            raw = read_json(cp)
            try:
                mtime = cp.stat().st_mtime
            except OSError:
                mtime = None
            self.control, why = effective_light(parse_control(raw), raw, mtime, self.started, now)
            if why and why != self.light_dropped:
                print(f'remembered: control.json asks for light {parse_control(raw)["light"]}, {why}: back to the show')
            self.light_dropped = why
            self.use_field(self.control['screen_field'])
        if now >= self.next['library']:
            self.next['library'] = now + READ_LIBRARY_S
            self.lib = clock.load_library(self.data)

    # ---- one frame ---------------------------------------------------------------------------------------------------

    def tick(self, now, dt, fps=None):
        dt = max(0.0, min(float(dt), 0.25))
        if fps:
            self.fps = fps
        elif dt > 0:
            self.fps += (1.0 / dt - self.fps) * 0.05
        if self.started is None:
            self.started = now
        self._read(now)
        mirror_age = None if self.state_mtime is None else max(0.0, now - self.state_mtime)
        dave, _why = clock.dave_day(self.state, now, mirror_age) if self.state else (None, 'no state.json')
        room = self.room.stats(now)
        opening = self.control['opening_night']
        snap = self.loop.update(now, dave, self.lib, room, opening)
        day = snap['day']
        self.knobs.step(dt)
        knobs = self.knobs.value(now)
        hour = snap['hour']
        isd = clock.at_hour(day['profile']['is_day'], hour)
        self.night += ((1.0 if isd is not None and isd < 0.5 else 0.0) - self.night) * (1 - math.exp(-dt / NIGHT_TAU))
        st = day['stats']
        snow = sum(v for v in day['profile']['snow'] if v)
        cold = bool(st.get('cold')) or snow > 0
        target_pal = palette.palette(st.get('season', 'autumn'), self.knobs.colors, cold=cold, night=self.night)
        changed_day = self.last_day is None or day['date'] != self.last_day
        self.pal.go(target_pal, DAY_PALETTE_S if changed_day else max(2.0, self.knobs.seconds or 2.0))
        if self.last_day is None:
            self.pal.cur = dict(self.pal.target)
        self.last_day = day['date']
        pal = self.pal.step(dt)
        linger_t = np.zeros(ropes_mod.N_ROPES, np.float32)
        for g in room['lingerers']:
            linger_t = np.maximum(linger_t, self.z.neighbours(g['ropes']))
        self.linger += (linger_t - self.linger) * (1 - math.exp(-dt / REFLEX_TAU))
        heard = heard_of(self.reflex, now)
        river_live = self.river_t is not None and now - self.river_t < RIVER_STALE_S
        motion = self.panels.motion.level if river_live else None
        flow_level = heard if heard is not None else motion
        preset = day['source'] == 'preset'
        ctx = ropes_mod.default_ctx(
            t=snap['t_s'], times=snap['times'], phase=snap['phase'], energy=clock.day_energy(day, hour), pal=pal,
            flow_pct=float(st.get('flow_pct') or 50), rain=min(1.0, float(st.get('rain_mm') or 0) / 40.0), cold=cold,
            dry=clock.is_dry(day), flow_level=flow_level, knobs=knobs, linger=self.linger, night=self.night,
            calm_level=self._calm_level(opening, preset, day, hour, room, now),
            wave=snap['wave'], light=self.control['light'], **self._mini(now, snap, room), leds=self.control['leds'], pool_height_m=self.control['pool_height_m'], day=day)
        if self.control['screen_mode'] == 'particles' and self.control['light'] == 'off':
            self.field_dt += dt
            if self.ticks % PANEL_EVERY == 0 or self.ropes.overlay is None:   # the field at 30 Hz, like the screens
                lvl = self.ropes.base_level / 0.3        # how lit the ropes are on their own (not the field's light), ~0..1
                self.rope_level += (min(1.0, lvl) - self.rope_level) * (1 - math.exp(-self.field_dt / 0.8))
                self.field.step(self.field_dt, max(self.rope_level, 0.6 if snap['phase'] == 'surge' else 0.0),
                                max(self.ropes.v_now, 30.0), knobs.get('turbulence', 0.5))
                self.field_dt = 0.0
                self.ropes.overlay = self.field.render_ropes(pal['light']) * 0.8
                # (M7 speed) the river video under the particles on this tick, the screens on the next: the two halves of
                # the screens' work on alternate frames, so no frame waits two vsyncs
                self.video_layer = (self.water.step(self.crops, self.wins, level=self.screen_level, intensity=None,
                                                    sens=self.control['screen_threshold'], half=True)
                                    if self.control['screen_video'] > 0 and not self.gpu_active() else None)
        else:
            self.ropes.overlay = None
        # (M7 speed) the ropes at 30 Hz, on the frames the ribbons don't step: each frame does about half the work
        self.rope_dt += dt
        if self.ticks % ROPE_EVERY == 1 or self.ticks < ROPE_EVERY:
            self.rope_frame = self.ropes.step(self.rope_dt, ctx)
            self.rope_dt = 0.0
        ctx['rope_speed'] = self.ropes.v_now
        self.ticks += 1
        self.panel_dt += dt
        self.wins = self.water.windows(now)
        target = 1.0 if snap['phase'] == 'surge' else screen_level(snap['t_s'], snap['times'], opening)
        self.screen_level += (target - self.screen_level) * (1 - math.exp(-dt / 0.6))   # never a jump
        if self.ticks % PANEL_EVERY == 0:                 # the screens at 30 fps: half the work, still smooth
            # the artists' simulator look (water.py): the moving water through four drifting windows, everything else off
            self.gpu_gain = 0.0
            self.pal_now = {k: tuple(float(c) for c in pal[k]) for k in ('deep', 'mid', 'light')}
            if self.control['screen_mode'] == 'particles' and self.gpu_active():
                # the GPU draws the ribbons and the river under them (ribbon_params -> ribbons_draw ... ribbons_out, and
                # river_gpu); panel_render carries nothing; now and then a numpy render for the lit share in status.json
                self.gpu_gain = self.screen_intensity()
                if self.ticks % 300 == 0:
                    self.field.render_screens(pal['light'])
                if self.panel_frame is None or self.panel_frame.any():
                    self.panel_frame = np.zeros((ribbons_gpu.QH, ribbons_gpu.QW * 4, 3), np.float32)
            elif self.control['screen_mode'] == 'particles':
                inten = self.screen_intensity()
                if self.field_kind == 'ribbons':                 # intensity folded into the ribbons' colour lookup
                    frame = self.field.render_screens(pal['light'], gain=inten)
                else:
                    frame = self.field.render_screens(pal['light']) * inten
                if self.control['screen_video'] > 0 and self.video_layer is not None:   # M9: the river video, faint, under
                    frame += self.video_layer * np.float32(self.control['screen_video'])
                self.panel_frame = np.minimum(frame, 1.0, out=frame)
            else:
                self.panel_frame = self.water.step(self.crops, self.wins, level=self.screen_level,
                                                   intensity=self.control['screen_intensity'],
                                                   sens=self.control['screen_threshold'])
            self.panel_dt = 0.0
        if now >= self.next['status']:
            self.next['status'] = now + status_mod.WRITE_EVERY
            self.last_status = status_mod.build(
                now=now, show=self.show, fps=self.fps, loop=snap, day=day, plan=snap['plan'], knobs=knobs,
                reflex=self.knobs.reflex, palette=palette.as_hex(pal), heard=heard,
                river_motion=motion, river_source=self.river_source if river_live else 'none', room=room,
                field=self.field_kind + ('-gpu' if self.gpu_active() else ''), screens=self.screens_now(), lit_pct=self.field.lit_pct if self.control['screen_mode'] == 'particles' else self.water.lit_pct, cap=round(self.screen_level, 2), watts=self.ropes.watts, opening_night=opening,
                zones_file=self.z.file,
                pool_height_m=self.control['pool_height_m'] if self.control['pool_height_m'] is not None
                else self.z.pool_height_m, light=self.control['light'])
            try:
                status_mod.write(self.river / 'remembered' / 'status.json', self.last_status)
                self.error = None
            except OSError as e:
                self.error = repr(e)
        return self.rope_frame, self.panel_frame


# ---- TouchDesigner side --------------------------------------------------------------------------------------------

def _holder():
    h = sys.modules.setdefault('remembered_live', types.ModuleType('remembered_live'))
    for k, v in (('show', None), ('last', None), ('frame', 0), ('error', None), ('live', False)):
        if not hasattr(h, k):
            setattr(h, k, v)
    if not hasattr(h, 'clips'):                               # the artists' approved footage, in turn (round 2, Q6)
        h.clips = video_library.clips_for(RIVER, _project_name())
    return h


def reset():
    """Drop the live show (a rebuild starts fresh)."""
    h = _holder()
    h.show, h.last = None, None
    if hasattr(h, 'clips'):
        del h.clips                                               # look for the clips again


def _project_name():
    """The open show file (river-remembered.toe, or river-looks.toe running this show among others)."""
    try:
        import td                                                 # TouchDesigner's module (not in tests)
        return td.project.name or SHOW
    except Exception:                                             # noqa: BLE001
        return SHOW


def _build_field(kind, pixelmap, screens, zones_path, seed):
    if kind == 'ribbons':
        return ribbons_mod.Ribbons.from_files(pixelmap, screens, zones_path, seed)
    if kind == 'fine':
        return flow_mod.FineField.from_files(pixelmap, screens, zones_path, seed)
    return particles_mod.Field(particles_mod.Geometry(pixelmap, screens), seed)


def get(comp):
    h = _holder()
    if h.show is None:
        zf = comp.par.Zonesfile.eval() if hasattr(comp.par, 'Zonesfile') else ''
        mf = comp.par.Mapfile.eval() if hasattr(comp.par, 'Mapfile') else ''
        sf = comp.par.Screensfile.eval() if hasattr(comp.par, 'Screensfile') else ''
        h.show = Show(zones_mod.load(zf or None), seed=int(comp.par.Seed.eval()) if hasattr(comp.par, 'Seed') else 0,
                      pixelmap=mf or None, screens=sf or None, zones_path=zf or None,
                      show=_project_name())
    return h.show


def frame(comp):
    """Execute DAT onFrameStart: a river frame now and then, one tick, then cook the two Script TOPs."""
    step(comp)
    for n in ('rope_render', 'panel_render', 'ribbon_params', 'river_mask'):
        o = comp.op(n)
        if o is not None:
            o.cook(force=True)


VIDEO_CALM = 0.45                   # the river video behind the GPU ribbons in calm, as a share of a surge's
VIDEO_BOOST = 1.6                   # and brighter than the simulator's intensity (it shares the screens with the ribbons)
GPU_OPS = ('ribbons_draw', 'ribbons_trail', 'ribbons_out', 'river_gpu')


def check_gpu(comp, show):
    """The GPU ribbons in use only while their three shaders exist without errors; screens_src follows (1: ribbons_out, 0:
    panel_render, the numpy ribbons). Never raises."""
    ok = False
    try:
        names = GPU_OPS
        if comp.fetch("soft_ribbon_folds", False):
            names = tuple(dict.fromkeys((*names, "ribbons_glow_soft")))
        ops = [comp.op(n) for n in names]
        ok = all(o is not None and not o.errors() for o in ops)
    except Exception:                                             # noqa: BLE001
        ok = False
    show.gpu_ok = ok
    sw = comp.op('screens_src')
    if sw is not None:
        want = 1 if show.gpu_active() else 0
        if int(sw.par.index.eval()) != want:
            sw.par.index = want


def params_image(show, fade=1.0, on=True):
    """ribbon_params: the GPU ribbons' numbers (ribbons_gpu.params), gain 0 when they aren't on the screens."""
    if show is None or show.field_kind != 'ribbons':
        return np.zeros((ribbons_gpu.PH, ribbons_gpu.PW, 4), np.float32)
    live = on and show.gpu_active()
    gain = show.gpu_gain * fade if live else 0.0
    s = show.water.s
    # the river behind the ribbons (Gavin, 28 Oct: "see the water video more… higher brightness / contrast, there should
    # still be blacks… like that hub75 simulator… more visible during the torrent"): the simulator's grade (its black floor and
    # contrast), VIDEO_BOOST brighter, and following the loop's level straight (calm 0.4 of a surge, floored at VIDEO_CALM)
    lvl = max(VIDEO_CALM, min(1.0, show.screen_level))
    vgain = (show.control['screen_video'] * s['intensity'] ** (1 / 2.2) * VIDEO_BOOST * lvl * fade
             if live and show.control['screen_mode'] == 'particles' else 0.0)
    video = {'windows': show.wins or [], 'gain': vgain, 'floor': s['floor'], 'contrast': s['contrast'], 'sat': s['sat']}
    return np.ascontiguousarray(ribbons_gpu.params(show.field, show.pal_now, gain, video))


def direct_recorded_video(show):
    """All-looks only: recorded video bypasses the slow mask when explicitly requested."""
    return (show is not None and show.show == 'river-all-looks.toe'
            and show.river_source == 'clip' and show.control.get('screen_motion_mask', True) is False)


def cpu_video_crops(show):
    """GPU recorded footage samples the movie directly, with or without the slow mask.
    CPU water mode and GPU failure still receive fresh crops on the very next tick.
    """
    gpu_recorded = (show is not None and show.show == 'river-all-looks.toe'
                    and show.river_source == 'clip'
                    and show.control.get('screen_mode', 'particles') == 'particles'
                    and show.gpu_active())
    return show.wants_video() and not gpu_recorded


def mask_image(show):
    """river_mask: water.py's motion mask (320 x 180, 1 = moving water) for river_gpu, upright in TD."""
    m = show.water.mask if show is not None else np.zeros((water_mod.MH, water_mod.MW), np.float32)
    if direct_recorded_video(show):
        return np.ones((water_mod.MH, water_mod.MW, 4), np.float32)
    img = np.empty((m.shape[0], m.shape[1], 4), np.float32)
    img[..., 0] = img[..., 1] = img[..., 2] = m[::-1]
    img[..., 3] = 1.0
    return img


def cook_params(scriptOp):
    scriptOp.copyNumpyArray(params_image(_holder().show))


def cook_mask(scriptOp):
    scriptOp.copyNumpyArray(mask_image(_holder().show))


def step(comp):
    """Everything frame() does but drawing: inputs, one tick, the windows' drift. The looks mixer (td/looks) calls this
    and draws show.rope_frame / show.panel_frame itself."""
    h = _holder()
    try:
        show = get(comp)
        now = time.time()
        dt = 0.0 if h.last is None or now < h.last else now - h.last
        h.last = now
        h.frame += 1
        if h.frame % 90 == 1:
            check_gpu(comp, show)
        if h.frame % 30 == 1:                                    # twice a second: live cam, or the clips?
            live = False
            try:
                cam = comp.op('/project1/inputs/river_cam_mod')
                live = bool(cam.module.fresh('river', 'sub')) and not comp.op('/project1/inputs').par.Forceclip.eval()
                if live:                                          # at night the cam is dark: the clips look better
                    probe = comp.op('cam_probe')
                    pa = probe.numpyArray(delayed=True) if probe is not None else None
                    live = pa is None or float(pa[..., :3].mean()) > DARK_LUMA
            except Exception:                                     # noqa: BLE001
                pass
            h.live = live
            sw = comp.op('river_src')
            if sw is not None and int(sw.par.index.eval()) != (0 if live else 1):
                sw.par.index = 0 if live else 1
            clip = comp.op('fallback_clip')
            files = getattr(h, 'clips', None)
            if clip is not None and files:                        # the approved clips take turns, a loop each
                want = files[(show.loop.index if hasattr(show, 'loop') else 0) % len(files)]
                if clip.par.file.eval() != want:
                    clip.par.file = want
        if h.frame % 6 == 0:                                     # ~10 fps: the river cam's own rate
            small = comp.op('river_small')
            a = small.numpyArray(delayed=True) if small is not None else None
            if a is not None:
                show.feed_river(np.ascontiguousarray(a[::-1, :, :3]), 'live' if getattr(h, 'live', False) else 'clip', now)
        if h.frame % 2 == 0 and cpu_video_crops(show):                # each screen's window of the footage
            for k in range(4):
                w = comp.op(f'win{k + 1}_fit')
                a = w.numpyArray(delayed=True) if w is not None else None
                show.crops[k] = None if a is None else np.ascontiguousarray(a[::-1, :, :3])
        show.tick(now, dt)
        h.error = show.error
    except Exception as e:                                        # noqa: BLE001 - never stop the show
        h.error = repr(e)
    try:                                                          # move the windows (the drift) for the next frame
        for k, (x, y, w, hh) in enumerate(get(comp).wins):
            c = comp.op(f'win{k + 1}')
            if c is not None:
                c.par.cropleft, c.par.cropright = x, x + w
                c.par.cropbottom, c.par.croptop = 1 - (y + hh), 1 - y
    except Exception as e:                                        # noqa: BLE001
        h.error = repr(e)
    return h.show


def rope_image(show):
    """[rope][led][rgb] -> the TOP's pixels: 20 wide, 400 tall, LED 0 on the top row (rows start at the bottom)."""
    f = show.rope_frame
    img = np.empty((f.shape[1], f.shape[0], 4), np.float32)
    img[..., :3] = f.transpose(1, 0, 2)[::-1]
    img[..., 3] = 1.0
    return np.ascontiguousarray(img)


def panel_image(show):
    f = show.panel_frame
    img = np.empty((f.shape[0], f.shape[1], 4), np.float32)
    img[..., :3] = f[::-1]
    img[..., 3] = 1.0
    return np.ascontiguousarray(img)


def cook_ropes(scriptOp):
    show = _holder().show
    if show is not None:
        scriptOp.copyNumpyArray(rope_image(show))


def cook_panels(scriptOp):
    show = _holder().show
    if show is not None:
        scriptOp.copyNumpyArray(panel_image(show))


def status():
    h = _holder()
    s = h.show
    return {'error': h.error, 'status': None if s is None else s.last_status}
