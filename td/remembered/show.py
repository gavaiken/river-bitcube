"""The remembered river's runtime: reads its inputs, runs the loop clock, renders the ropes and the panels, writes
status.json. Synced into /project1/remembered/show_mod by td/build/build_remembered.py; the Execute DAT calls frame(comp)
every frame and the two Script TOPs call cook_ropes / cook_panels.

Inputs (on bitcube, under C:\\Users\\user\\River):
  gallery_state\\state.json, reflex.json   Dave's mirror: memory + surge_at (section 2), scene knobs/colours, reflexes, heard
  presence.json                            people + lingerers (section 4)
  remembered\\control.json                 {pool_height_m, light: off|pool|eddies, opening_night}
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
from . import palette
from . import panels as panels_mod
from . import ropes as ropes_mod
from . import status as status_mod
from . import water as water_mod
from . import particles as particles_mod
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
PANEL_EVERY = 2                     # screens step every 2nd frame
KNOBS = ('speed', 'density', 'brightness', 'turbulence')
NEUTRAL = {k: 0.5 for k in KNOBS}
CONTROL_DEFAULT = {'pool_height_m': None, 'light': 'off', 'leds': [], 'opening_night': True,   # opening night ON unless told
                   'screen_intensity': None, 'screen_threshold': None,                          # None: water.SETTINGS
                   'screen_mode': 'particles',       # particles (one field, the screens as windows) | water (video)
                   'screen_video': 0.25}             # M9: how strongly the river video shows under the particles (0..1)
SCREEN_CALM = 0.4                   # the screens in calm, as a share of their intensity (artists, 27 Oct: follow the loop)
DARK_LUMA = 0.08                    # the live cam darker than this (night) -> the screens use the clips
LIGHTS = ('off', 'pool', 'eddies', 'leds')


def parse_control(c):
    """River\\remembered\\control.json -> {pool_height_m, light, leds, opening_night}. The shape zones.py light --write and
    mission control write: {"t", "zones": {"file", "light": off|pool|eddies|leds, "leds": [{rope, from, to}],
    "pool_height_m"?}, "opening_night"?}; flat keys (pool_height_m, light, opening_night) are read too.
    Opening night: on by default; "opening_night": false (or "opening": {"on": false}) turns it off."""
    ctl = dict(CONTROL_DEFAULT)
    if not isinstance(c, dict):
        return ctl
    z = c.get('zones') if isinstance(c.get('zones'), dict) else {}
    ph = z.get('pool_height_m', c.get('pool_height_m'))
    if isinstance(ph, (int, float)) and not isinstance(ph, bool) and 0 <= ph <= 5:
        ctl['pool_height_m'] = float(ph)
    light = z.get('light', c.get('light'))
    if light in LIGHTS:
        ctl['light'] = light
    leds = z.get('leds', c.get('leds'))
    if isinstance(leds, list):
        ctl['leds'] = [e for e in leds if isinstance(e, dict)]
    on = c.get('opening_night', True)               # Gavin and the artists: on unless control.json says false
    if isinstance(c.get('opening'), dict):
        on = c['opening'].get('on', on)
    ctl['opening_night'] = bool(on)
    sc = c.get('screens') if isinstance(c.get('screens'), dict) else {}
    v = sc.get('video', c.get('screen_video'))
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1:
        ctl['screen_video'] = float(v)
    if sc.get('mode', c.get('screen_mode')) in ('particles', 'water'):
        ctl['screen_mode'] = sc.get('mode', c.get('screen_mode'))
    for key, name in (('screen_intensity', 'intensity'), ('screen_threshold', 'threshold')):
        v = sc.get(name, c.get(key))
        if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1:
            ctl[key] = float(v)
    return ctl


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
        sc = (state or {}).get('scene') or {}
        if not sc or sc.get('placeholder'):
            return
        seq = state.get('seq', state.get('set_at_epoch'))
        if seq == self.seq:
            return
        first = self.seq is None
        self.start = self.scene(now)
        self.target = {k: min(1.0, max(0.0, float(sc.get(k, 0.5)))) for k in KNOBS}
        self.t0, self.seconds = now, 0.0 if first else max(0.0, float(sc.get('transition_seconds', 60.0)))
        self.seq = seq
        self.colors = sc.get('colors') or None

    def set_reflex(self, reflex, now):
        zero = {k: 0.0 for k in KNOBS}
        if not reflex or not fresh_reflex(reflex, now):
            self.reflex_target = zero
            return
        off = reflex.get('offsets') or {}
        self.reflex_target = {k: min(1.0, max(-1.0, float(off.get(k, 0.0)))) for k in KNOBS}

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
    def __init__(self, zones=None, river_dir=RIVER, data_dir=None, seed=0, show=SHOW, pixelmap=None, screens=None):
        self.z = zones or zones_mod.Zones()
        self.river = Path(river_dir)
        self.data = Path(data_dir) if data_dir else REPO / 'data' / 'remembered'
        self.show = show
        self.loop = clock.Loop(seed)
        self.ropes = ropes_mod.Ropes(self.z, seed)
        self.panels = panels_mod.Panels(self.z, seed)
        self.water = water_mod.Water()
        self.field = particles_mod.Field(particles_mod.Geometry(pixelmap, screens), seed)
        self.rope_level = 0.0                 # the ropes' brightness, smoothed: how busy the particle field is
        self.field_dt = 0.0
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
        self.lib = None
        self.next = {'dave': 0.0, 'presence': 0.0, 'control': 0.0, 'library': 0.0, 'status': 0.0}
        self.river_source = 'none'
        self.river_t = None
        self.fps = 0.0
        self.rope_frame = np.zeros((ropes_mod.N_ROPES, ropes_mod.N_PX, 3), np.float32)
        self.panel_frame = np.zeros((panels_mod.QH, panels_mod.QW * panels_mod.NQ, 3), np.float32)
        self.last_status = None
        self.last_day = None
        self.error = None
        self.ticks = 0
        self.panel_dt = 0.0

    def wants_video(self):
        """Whether the river video is drawn (the water look, or faintly under the particles: M9)."""
        return self.control['screen_mode'] == 'water' or self.control['screen_video'] > 0

    # ---- inputs ----------------------------------------------------------------------------------------------------

    def feed_river(self, img, source, now):
        """A new river frame (row 0 at the top; live cam or the recorded clip)."""
        self.panels.feed(img)
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
            self.control = parse_control(read_json(self.river / 'remembered' / 'control.json'))
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
            calm_level=clock.OPENING_CALM_LEVEL if opening else (clock.PRESET_LEVEL if preset else clock.CALM_LEVEL),
            wave=snap['wave'], light=self.control['light'], leds=self.control['leds'], pool_height_m=self.control['pool_height_m'], day=day)
        if self.control['screen_mode'] == 'particles' and self.control['light'] == 'off':
            self.field_dt += dt
            if self.ticks % PANEL_EVERY == 0 or self.ropes.overlay is None:   # the field at 30 Hz, like the screens
                lvl = self.ropes.base_level / 0.3        # how lit the ropes are on their own (not the field's light), ~0..1
                self.rope_level += (min(1.0, lvl) - self.rope_level) * (1 - math.exp(-self.field_dt / 0.8))
                self.field.step(self.field_dt, max(self.rope_level, 0.6 if snap['phase'] == 'surge' else 0.0),
                                max(self.ropes.v_now, 30.0), knobs.get('turbulence', 0.5))
                self.field_dt = 0.0
                self.ropes.overlay = self.field.render_ropes(pal['light']) * 0.8
        else:
            self.ropes.overlay = None
        self.rope_frame = self.ropes.step(dt, ctx)
        ctx['rope_speed'] = self.ropes.v_now
        self.ticks += 1
        self.panel_dt += dt
        self.wins = self.water.windows(now)
        target = 1.0 if snap['phase'] == 'surge' else screen_level(snap['t_s'], snap['times'], opening)
        self.screen_level += (target - self.screen_level) * (1 - math.exp(-dt / 0.6))   # never a jump
        if self.ticks % PANEL_EVERY == 0:                 # the screens at 30 fps: half the work, still smooth
            # the artists' simulator look (water.py): the moving water through four drifting windows, everything else off
            if self.control['screen_mode'] == 'particles':
                inten = self.control['screen_intensity'] or 0.82
                frame = self.field.render_screens(pal['light']) * inten
                if self.control['screen_video'] > 0:              # M9: the river video, faint, under the particles
                    video = self.water.step(self.crops, self.wins, level=self.screen_level, intensity=None,
                                            sens=self.control['screen_threshold'])
                    frame = frame + video * self.control['screen_video']
                self.panel_frame = np.clip(frame, 0.0, 1.0)
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
                lit_pct=self.field.lit_pct if self.control['screen_mode'] == 'particles' else self.water.lit_pct, cap=round(self.screen_level, 2), watts=self.ropes.watts, opening_night=opening,
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
        h.clips = sorted(str(p).replace('\\', '/') for p in (RIVER / 'recordings' / 'river' / 'remembered').glob('*.mp4'))
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


def get(comp):
    h = _holder()
    if h.show is None:
        zf = comp.par.Zonesfile.eval() if hasattr(comp.par, 'Zonesfile') else ''
        mf = comp.par.Mapfile.eval() if hasattr(comp.par, 'Mapfile') else ''
        sf = comp.par.Screensfile.eval() if hasattr(comp.par, 'Screensfile') else ''
        h.show = Show(zones_mod.load(zf or None), seed=int(comp.par.Seed.eval()) if hasattr(comp.par, 'Seed') else 0,
                      pixelmap=mf or None, screens=sf or None, show=_project_name())
    return h.show


def frame(comp):
    """Execute DAT onFrameStart: a river frame now and then, one tick, then cook the two Script TOPs."""
    step(comp)
    for n in ('rope_render', 'panel_render'):
        o = comp.op(n)
        if o is not None:
            o.cook(force=True)


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
        if h.frame % 2 == 0 and show.wants_video():                # each screen's window of the footage
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
