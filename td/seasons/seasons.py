# The river's year: which season it is, how intense the water is, and what steers it.
# Pure Python (no TouchDesigner): river-local-oct-22-seasons.toe drives it once per frame, the control page
# reads and sets it, and tools/tests/test_seasons.py checks it. Terms as in GLOSSARY.md.
#
# The year is a position on a circle, `phase` in [0, 4): 0 = deep winter, 1 = spring, 2 = high summer,
# 3 = autumn. It only ever moves forward (winter -> spring -> summer -> autumn -> winter): every mode can
# hold it or move it on, never back.
#
# Modes
#   automatic  the season cycle: one season a minute, forever.
#   dynamic    relative presence steers it (closed loop): busier than usual -> on to summer and hold;
#              quieter than usual -> on through autumn to winter and hold; an empty room -> winter.
#   manual     a target season and an intensity (0 stillness .. 1 turbulence); the year travels forward
#              to the target quickly (the whole way round in under a minute) and holds there.
import math
from collections import deque

SEASONS = ('winter', 'spring', 'summer', 'autumn')
WINTER, SPRING, SUMMER, AUTUMN = 0.0, 1.0, 2.0, 3.0

CYCLE_SECONDS = 240.0             # automatic: the whole year
WARM_SECONDS = 60.0               # dynamic: winter -> summer (2 seasons) with people arriving
COOL_SECONDS = 180.0              # dynamic: summer -> winter (2 seasons) as they leave
MANUAL_SECONDS_PER_SEASON = 13.5  # manual: even a full lap (4 seasons) takes under a minute (54 s)
INTENSITY_GLIDE_SECONDS = 6.0     # how fast intensity follows its target

# How intense each season's water is (dynamic summer is scaled by how much busier than usual it is).
SEASON_INTENSITY = {0: 0.05, 1: 0.45, 2: 0.85, 3: 0.35}
SUMMER_GENTLE, SUMMER_TORRENT = 0.6, 1.0

# Presence model
NOW_WINDOW = 30.0                 # presence now = median of the last 30 s of counts
USUAL_WINDOW = 600.0              # usual presence = median of the last 10 min
USUAL_FLOOR = 0.75                # one person in an empty gallery reads as busier than usual (1.33x)
WARMER, COOLER = 1.3, 0.7         # relative presence thresholds
TORRENT_AT = 2.0                  # 2x usual (or more) = full torrent
EMPTY_SECONDS = 60.0              # nobody for this long = winter, whatever the usual is
STALE_SECONDS = 30.0              # no counts for this long = presence unavailable (dynamic falls back to automatic)


def wrap(p):
    return p % 4.0


def ahead(frm, to):
    """How far `to` is ahead of `frm`, going forward round the year (0 <= d < 4)."""
    return (to - frm) % 4.0


def weights(phase):
    """Blend of the four seasons at `phase`: each season peaks at its own point and fades to zero at
    its neighbours (cosine), so two seasons share the stage between their centres. Sums to 1."""
    w = []
    for k in range(4):
        d = min(ahead(k, phase), ahead(phase, k))      # circular distance to season k's centre
        w.append(0.5 + 0.5 * math.cos(math.pi * d) if d < 1 else 0.0)
    s = sum(w) or 1.0
    return [x / s for x in w]


def season_name(phase):
    return SEASONS[int(round(wrap(phase))) % 4]


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return None
    return xs[n // 2] if n % 2 else 0.5 * (xs[n // 2 - 1] + xs[n // 2])


class Presence:
    """Counts of people in the foreground, with time stamps -> presence now, usual presence, relative."""

    def __init__(self):
        self.samples = deque()     # (t, count)
        self.last_person = None    # last time anyone was seen
        self.last_sample = None

    def add(self, t, count):
        self.samples.append((t, float(count)))
        self.last_sample = t
        if count > 0:
            self.last_person = t
        while self.samples and self.samples[0][0] < t - USUAL_WINDOW:
            self.samples.popleft()

    def available(self, t):
        return self.last_sample is not None and t - self.last_sample <= STALE_SECONDS

    def now(self, t):
        return median([c for (s, c) in self.samples if s >= t - NOW_WINDOW]) or 0.0

    def usual(self, t):
        return max(USUAL_FLOOR, median([c for (_, c) in self.samples]) or 0.0)

    def relative(self, t):
        return self.now(t) / self.usual(t)

    def empty_for(self, t):
        if self.last_person is None:
            first = self.samples[0][0] if self.samples else t
            return t - first
        return t - self.last_person

    def stats(self, t):
        return {'available': self.available(t), 'now': round(self.now(t), 2), 'usual': round(self.usual(t), 2),
                'relative': round(self.relative(t), 2), 'empty_for_s': round(self.empty_for(t))}


class Year:
    """The river's year. Call step(t) once per frame; read phase, weights(), intensity."""

    def __init__(self, t=0.0, phase=WINTER, mode='automatic'):
        self.phase = wrap(phase)
        self.intensity = SEASON_INTENSITY[int(round(self.phase)) % 4]
        self.mode = mode
        self.manual_season = SUMMER
        self.manual_intensity = 0.5
        self.presence = Presence()
        self.t = t
        self.target = None          # hold point the year is heading to (None = keep cycling)
        self.effective_mode = mode  # dynamic falls back to automatic while presence is unavailable

    # ---- control -------------------------------------------------------------------------------
    def set_mode(self, mode):
        if mode not in ('automatic', 'dynamic', 'manual'):
            raise ValueError(mode)
        self.mode = mode

    def set_manual(self, season=None, intensity=None):
        if season is not None:
            self.manual_season = float(SEASONS.index(season) if isinstance(season, str) else season) % 4
        if intensity is not None:
            self.manual_intensity = max(0.0, min(1.0, float(intensity)))

    # ---- the loop -------------------------------------------------------------------------------
    def dynamic_target(self, t):
        """Where relative presence sends the year: SUMMER (busier), WINTER (quieter or empty), or None (hold)."""
        p = self.presence
        if p.empty_for(t) >= EMPTY_SECONDS:
            return WINTER
        r = p.relative(t)
        if r >= WARMER:
            return SUMMER
        if r <= COOLER:
            return WINTER
        return 'hold'

    def summer_strength(self, t):
        r = self.presence.relative(t)
        return max(0.0, min(1.0, (r - WARMER) / (TORRENT_AT - WARMER)))

    def step(self, t):
        dt = max(0.0, min(1.0, t - self.t))
        self.t = t
        mode = self.mode
        if mode == 'dynamic' and not self.presence.available(t):
            mode = 'automatic'
        self.effective_mode = mode

        if mode == 'automatic':
            self.target = None
            self.phase = wrap(self.phase + dt * 4.0 / CYCLE_SECONDS)
            want = self._season_intensity()
        elif mode == 'manual':
            self.target = self.manual_season
            self._travel(self.target, dt / MANUAL_SECONDS_PER_SEASON)
            want = self.manual_intensity
        else:
            goal = self.dynamic_target(t)
            if goal == 'hold':
                # Spring and autumn are passages, never resting places: keep heading where we were heading,
                # or, with no heading yet, on to whichever resting season (summer or winter) comes next.
                if self.target is not None:
                    goal = self.target
                elif min(ahead(WINTER, self.phase), ahead(self.phase, WINTER)) < 1e-6 or \
                        min(ahead(SUMMER, self.phase), ahead(self.phase, SUMMER)) < 1e-6:
                    goal = None
                else:
                    goal = SUMMER if ahead(self.phase, SUMMER) < ahead(self.phase, WINTER) else WINTER
            self.target = goal
            if goal is not None:
                # warming pace while heading for summer (even through autumn and winter), cooling pace otherwise
                rate = 2.0 / WARM_SECONDS if goal == SUMMER else 2.0 / COOL_SECONDS
                self._travel(goal, dt * rate)
            want = self._season_intensity(self.summer_strength(t))

        a = 1 - math.exp(-dt / INTENSITY_GLIDE_SECONDS) if dt else 0.0
        self.intensity += (want - self.intensity) * a
        return self

    def _travel(self, goal, amount):
        d = ahead(self.phase, goal)
        if d < 1e-6 or d > 4 - 1e-6:
            self.phase = wrap(goal)
            return
        self.phase = wrap(goal) if amount >= d else wrap(self.phase + amount)

    def _season_intensity(self, summer_strength=None):
        w = weights(self.phase)
        summer = SEASON_INTENSITY[2] if summer_strength is None else \
            SUMMER_GENTLE + (SUMMER_TORRENT - SUMMER_GENTLE) * summer_strength
        vals = [SEASON_INTENSITY[0], SEASON_INTENSITY[1], summer, SEASON_INTENSITY[3]]
        return sum(wk * v for wk, v in zip(w, vals))

    def state(self):
        w = weights(self.phase)
        return {'mode': self.mode, 'effective_mode': self.effective_mode, 'phase': round(self.phase, 4),
                'season': season_name(self.phase), 'weights': {s: round(x, 3) for s, x in zip(SEASONS, w)},
                'intensity': round(self.intensity, 3),
                'target': None if self.target is None else SEASONS[int(self.target) % 4],
                'manual': {'season': SEASONS[int(self.manual_season) % 4], 'intensity': self.manual_intensity},
                'presence': self.presence.stats(self.t)}
