"""The remembered river's four knobs (speed, density, brightness, turbulence), 0..1 each (docs/remembered-v2-plan.md,
decision 4). Plain Python (no TouchDesigner, no numpy); show.py owns one Knobs and calls it every frame.

Three parts, added up and clamped:
- **Dave's voice, remapped** (a slow mood layer): his scene's four knobs glide over transition_seconds. His agent keeps
  them in a narrow band (audit of 50 ticks: speed 0.04-0.14, density 0.25-0.58, brightness 0.47-0.65, turbulence
  0.075-0.14), so speed and turbulence were near-constant. REMAP stretches his observed band piecewise-linearly onto a
  useful range (speed -> 0.25-0.75 ...); values outside his band still move, a little, up to the end points.
- **The remembered day**, hour by hour through the loop (day_knobs): its flow drives speed and density, its rain
  turbulence, its temperature and daylight tilt brightness. Normalised within the day, scaled by the day's flow
  percentile and how hard it rained, so a flood day and a dry day give visibly different curves.
- **The reflex** nudges (reflex.json offsets), easing in over ~4 s.

value = W_DAVE * dave + (1 - W_DAVE) * day + REFLEX_GAIN * reflex (dave alone + reflex until the show passes a day).
parts() returns every part so status can show "Dave 0.42 · day 0.61 → 0.52".
"""
import math

from . import clock

KNOBS = ('speed', 'density', 'brightness', 'turbulence')
NEUTRAL = {k: 0.5 for k in KNOBS}
REFLEX_TAU = 4.0 / 3.0              # reflex nudges ease in over ~4 s (95 %)
REFLEX_MTIME_S = 90.0               # reflex.json without updated_epoch: stale when the file is older
REFLEX_GAIN = 1.0                   # Dave's offsets are ~±0.01 today; raise this to make them felt
DAY_TAU = 2.0                       # the day part eases (a new day at the loop boundary does not jump)
W_DAVE = 0.5                        # Dave's remapped voice vs the remembered day

# Dave's voice, remapped: (Dave's value, the knob) points per knob, linear between them, clamped at the ends. The middle
# two points are his observed band (audit, 28 Oct) -> the useful range; the outer two keep out-of-band values sane.
REMAP = {
    'speed':      ((0.0, 0.20), (0.04, 0.25), (0.14, 0.75), (1.0, 0.90)),
    'density':    ((0.0, 0.25), (0.25, 0.30), (0.58, 0.75), (1.0, 0.85)),
    'brightness': ((0.0, 0.35), (0.47, 0.45), (0.65, 0.75), (1.0, 0.85)),
    'turbulence': ((0.0, 0.20), (0.075, 0.25), (0.14, 0.70), (1.0, 0.85)),
}

# The day's ranges: each knob runs between these as its driver goes 0 -> 1
DAY_RANGE = {'speed': (0.15, 0.90), 'density': (0.25, 0.85), 'turbulence': (0.15, 0.90)}
DAY_BRIGHT = 0.55                   # brightness centre, tilted by temperature (± DAY_TEMP_TILT) and daylight (± DAY_SUN_TILT)
DAY_TEMP_TILT, DAY_SUN_TILT = 0.08, 0.08
WET_MM_H = 3.0                      # a day whose wettest hour reaches this rains "fully" (drizzle stays gentle)
FLOW_PCT_W = 0.5                    # flow driver: this much the day's flow percentile, the rest its hourly shape

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


def clamp01(x):
    return min(1.0, max(0.0, x))


def fresh_reflex(reflex, now):
    """reflex.json is rewritten only when a clip arrives: fresh while now <= updated_epoch + ttl_seconds; without
    updated_epoch, while the file (its mtime, kept as '_mtime') is at most REFLEX_MTIME_S old."""
    if not isinstance(reflex, dict):
        return False
    if reflex.get('updated_epoch'):
        age = now - num_or(reflex['updated_epoch'], 0.0, 'reflex.updated_epoch')
        ttl = num_or(reflex.get('ttl_seconds', REFLEX_MTIME_S) or REFLEX_MTIME_S, REFLEX_MTIME_S, 'reflex.ttl_seconds')
        return 0 <= age <= ttl
    m = reflex.get('_mtime')
    return m is not None and 0 <= now - m <= REFLEX_MTIME_S


def remap(k, v):
    """Dave's value of knob k -> the knob (REMAP, piecewise linear, clamped at the end points)."""
    pts = REMAP[k]
    if v <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if v <= x1:
            return y0 + (y1 - y0) * (v - x0) / (x1 - x0)
    return pts[-1][1]


def remap_all(raw):
    return {k: remap(k, raw[k]) for k in KNOBS}


def _norm(values, hour, default):
    """The series at hour, normalised within the day (0 at its lowest, 1 at its highest); default when unknown or flat."""
    v = clock.at_hour(values, hour)
    known = [x for x in values if x is not None]
    if v is None or not known:
        return default
    lo, hi = min(known), max(known)
    return default if hi - lo < 1e-9 else clamp01((v - lo) / (hi - lo))


def _shape(values, hour):
    """The flow's shape at hour: normalised within the day, but pulled to 0.5 by how little the day varies ((hi-lo)/hi),
    so a near-flat dry day does not get a full swing out of a trickle. 0.5 when unknown."""
    known = [x for x in values if x is not None]
    if not known or max(known) <= 0:
        return 0.5
    spread = clamp01((max(known) - min(known)) / max(known))
    return 0.5 + (_norm(values, hour, 0.5) - 0.5) * spread


def day_knobs(day, hour):
    """The four knobs from the remembered day at this (fractional) hour, or None without a day.
    flow -> speed and density (FLOW_PCT_W of the day's flow percentile, the rest the hour's flow within the day, damped
    on a day that barely varies);
    rain -> turbulence (the hour's rain within the day, times how wet the day got: its wettest hour over WET_MM_H, with a
    little of the flow); temperature (within the day) and is_day tilt brightness around DAY_BRIGHT. Missing data falls back
    to the middle (flow shape 0.5, no rain, temperature 0.5, daylight 0.5)."""
    if not isinstance(day, dict) or not isinstance(day.get('profile'), dict):
        return None
    prof = day['profile']
    stats = day.get('stats') or {}
    flow = clock.series(prof, 'flow')
    rain = clock.series(prof, 'rain')
    temp = clock.series(prof, 'temp')
    sun = clock.series(prof, 'is_day')
    h = clock.clamp(num_or(hour, 12.0, 'knobs.hour'), 0.0, clock.HOURS - 1e-6)
    pct = clamp01(num_or(stats.get('flow_pct', 50), 50.0, 'memory.stats.flow_pct') / 100.0)
    f = FLOW_PCT_W * pct + (1 - FLOW_PCT_W) * _shape(flow, h)
    peak = max([x for x in rain if x is not None] or [0.0])
    r = (clock.at_hour(rain, h) or 0.0) / peak if peak > 0 else 0.0
    wet = clamp01(peak / WET_MM_H)
    turb = clamp01(0.8 * clamp01(r) * wet + 0.2 * f)
    t = _norm(temp, h, 0.5)
    s = clock.at_hour(sun, h)
    s = 0.5 if s is None else clamp01(s)

    def lerp(k, x):
        lo, hi = DAY_RANGE[k]
        return lo + (hi - lo) * x
    return {'speed': lerp('speed', f), 'density': lerp('density', f), 'turbulence': lerp('turbulence', turb),
            'brightness': clamp01(DAY_BRIGHT + DAY_TEMP_TILT * (2 * t - 1) + DAY_SUN_TILT * (2 * s - 1))}


class Knobs:
    """Dave's four knobs gliding over transition_seconds (remapped), the remembered day through the loop, and the reflex
    nudges easing in over ~4 s. self.target is Dave's raw scene (clamped 0..1), as he sent it."""

    def __init__(self):
        self.start = dict(NEUTRAL)
        self.target = dict(NEUTRAL)
        self.t0, self.seconds = 0.0, 0.0
        self.seq = None
        self.reflex = {k: 0.0 for k in KNOBS}
        self.reflex_target = {k: 0.0 for k in KNOBS}
        self.colors = None
        self.day = None                  # the day part now (eased), None until step() gets a day
        self.day_target = None

    @property
    def reflex_now(self):
        """The reflex offsets in effect now (after REFLEX_GAIN), per knob."""
        return {k: REFLEX_GAIN * self.reflex[k] for k in KNOBS}

    def scene(self, now):
        """Dave's raw knobs now, mid-glide."""
        f = 1.0 if self.seconds <= 0 else min(1.0, max(0.0, (now - self.t0) / self.seconds))
        return {k: self.start[k] + (self.target[k] - self.start[k]) * f for k in KNOBS}

    def dave(self, now):
        """Dave's voice, remapped (NEUTRAL until his first scene)."""
        return dict(NEUTRAL) if self.seq is None else remap_all(self.scene(now))

    def set_scene(self, state, now):
        sc = state.get('scene') if isinstance(state, dict) else None
        if not isinstance(sc, dict) or not sc or sc.get('placeholder'):
            return
        seq = state.get('seq', state.get('set_at_epoch'))
        if seq == self.seq:
            return
        first = self.seq is None
        self.start = self.scene(now)
        # Dave's scene is someone else's file: a knob that isn't a number keeps the neutral 0.5 (never aborts the tick)
        self.target = {k: clamp01(num_or(sc.get(k, 0.5), 0.5, f'scene.{k}')) for k in KNOBS}
        self.t0 = now
        self.seconds = 0.0 if first else max(0.0, num_or(sc.get('transition_seconds', 60.0), 60.0,
                                                         'scene.transition_seconds'))
        self.seq = seq
        self.colors = sc.get('colors') or None

    def set_reflex(self, reflex, now):
        if not reflex or not fresh_reflex(reflex, now):
            self.reflex_target = {k: 0.0 for k in KNOBS}
            return
        off = reflex.get('offsets') if isinstance(reflex.get('offsets'), dict) else {}
        self.reflex_target = {k: min(1.0, max(-1.0, num_or(off.get(k, 0.0), 0.0, f'reflex.offsets.{k}'))) for k in KNOBS}

    def step(self, dt, day=None, hour=None):
        """Ease the reflex, and (given the remembered day and the loop's hour) the day part."""
        a = 1 - math.exp(-dt / REFLEX_TAU) if dt > 0 else 0.0
        for k in KNOBS:
            self.reflex[k] += (self.reflex_target[k] - self.reflex[k]) * a
        if day is not None:
            self.day_target = day_knobs(day, hour if hour is not None else 12.0)
            if self.day_target is None:
                return
            if self.day is None:
                self.day = dict(self.day_target)
            else:
                b = 1 - math.exp(-dt / DAY_TAU) if dt > 0 else 0.0
                self.day = {k: self.day[k] + (self.day_target[k] - self.day[k]) * b for k in KNOBS}

    def parts(self, now):
        """{'dave': {...}, 'day': {...} | None, 'reflex': {...}, 'value': {...}, 'w_dave': W_DAVE}."""
        dave = self.dave(now)
        rx = self.reflex_now
        if self.day is None:
            base = dave
        else:
            base = {k: W_DAVE * dave[k] + (1 - W_DAVE) * self.day[k] for k in KNOBS}
        value = {k: clamp01(base[k] + rx[k]) for k in KNOBS}
        return {'dave': dave, 'day': None if self.day is None else dict(self.day), 'reflex': rx, 'value': value,
                'w_dave': W_DAVE}

    def value(self, now):
        return self.parts(now)['value']


def describe(parts):
    """{knob: 'Dave 0.42 · day 0.61 → 0.52'} for status (the reflex shown only when it moves the knob)."""
    out = {}
    for k in KNOBS:
        s = f"Dave {parts['dave'][k]:.2f}"
        if parts.get('day') is not None:
            s += f" · day {parts['day'][k]:.2f}"
        rx = parts['reflex'][k]
        if abs(rx) >= 0.005:
            s += f' · reflex {rx:+.2f}'
        out[k] = s + f" → {parts['value'][k]:.2f}"
    return out
