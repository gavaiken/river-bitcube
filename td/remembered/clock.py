"""The remembered river's loop clock (docs/remembered-river.md): which remembered day plays, where the loop is, its
phase, when the surge lands, and the fallback when Dave's agent is late. Plain Python (no TouchDesigner, no numpy).

- A loop is LOOP_S (300 s) and replays the remembered day's 24 hours (12.5 s per remembered hour).
- One remembered day per loop. A new day takes effect only at the next loop boundary, with the decision wave.
- The surge lands at Dave's surge_at (a remembered hour) when present; else at the day's heaviest hour of rain, moved
  30 s sooner by a busy room (relative presence > 1.3) or a lingerer and 30 s later by an empty room; always clamped to
  90-216 s into the loop. A dry day (stats.dry, or surge_at null) has no surge, unless opening night (a surge every loop, at
  150 s for a dry day; opening night is on unless control.json says opening_night false).
- Dave's choice counts while chosen_at is under 5 min old and the mirror is fresh. Otherwise bitcube picks a notable
  day itself (data/remembered/notable.json + profiles.json.gz), never the same date twice within an hour. With no
  data either: the preset calm loop at 30 %.
- Phases: calm -> building -> surge -> settling -> calm, placed around the surge by the day's weather.

Time is wall-clock seconds (time.time()), passed in: nothing here reads absTime or comp.storage.
"""
import csv
import datetime as dt
import gzip
import json
import math
import random
from pathlib import Path

LOOP_S = 300.0
HOURS = 24
HOUR_S = LOOP_S / HOURS              # 12.5 s per remembered hour
SURGE_MIN_S, SURGE_MAX_S = 90.0, 216.0
ROOM_SHIFT_S = 30.0
BUSY_RELATIVE = 1.3
EMPTY_ROOM_S = 60.0                  # nobody for this long = an empty room
MEMORY_MAX_AGE_S = 900.0             # Dave's chosen_at older than this -> bitcube picks (his ticks run ~5-15 min apart)
MIRROR_STALE_S = 900.0               # state.json (the mirror) not rewritten for this long -> stale
NO_REPEAT_S = 3600.0                 # a fallback date never plays twice within an hour
DRAWBACK_S = 8.0                     # the last seconds before the surge: the pool dims, the top metre glows
FRONT_S = 4.0
BODY_S = 40.0                        # surge phase: front 0-4 s, body 4-40 s
WAVE_S = 8.0                         # the decision wave
PRESET_LEVEL = 0.30                  # everything down: the preset calm loop at 30 %
CALM_LEVEL = 0.35                    # calm brightness (30-40 %)
OPENING_CALM_LEVEL = 0.45            # opening night
OPENING_DRY_HOUR = 12.0              # opening night, a dry day: the surge at 150 s (before the room moves it)
PHASES = ('calm', 'building', 'surge', 'settling')
SEASON_OF_MONTH = {12: 'winter', 1: 'winter', 2: 'winter', 3: 'spring', 4: 'spring', 5: 'spring',
                   6: 'summer', 7: 'summer', 8: 'summer', 9: 'autumn', 10: 'autumn', 11: 'autumn'}
KIND_PCT = {'flood': 99, 'storm': 92, 'first_rain': 65, 'cold': 55, 'drought': 3}
_MISSING = object()


# ---- small helpers -------------------------------------------------------------------------------------------------

def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def parse_time(s):
    """ISO 8601 ('2026-10-28T04:10:00Z') -> epoch seconds, or None."""
    if isinstance(s, (int, float)):
        return float(s)
    if not isinstance(s, str) or not s:
        return None
    try:
        t = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t.timestamp()


def season_of(date):
    try:
        return SEASON_OF_MONTH[int(str(date)[5:7])]
    except (ValueError, KeyError):
        return 'autumn'


def series(profile, key):
    """24 values (None where missing) from a profile, whatever it holds."""
    v = (profile or {}).get(key)
    out = []
    for i in range(HOURS):
        x = v[i] if isinstance(v, list) and i < len(v) else None
        out.append(float(x) if isinstance(x, (int, float)) and math.isfinite(x) else None)
    return out


def at_hour(values, hour):
    """A 24-value series at a fractional hour (linear between hours, missing hours skipped; None if all missing)."""
    known = [(i, v) for i, v in enumerate(values) if v is not None]
    if not known:
        return None
    h = clamp(hour, 0.0, HOURS - 1e-6)
    i = int(h)
    a, b = values[i], values[min(HOURS - 1, i + 1)]
    if a is not None and b is not None:
        return a + (b - a) * (h - i)
    return min(known, key=lambda kv: abs(kv[0] - h))[1]


# ---- remembered days -------------------------------------------------------------------------------------------------

def make_day(date, profile, stats=None, source='fallback', reason='', chosen_by='', chosen_at=None, surge_at=_MISSING):
    """The internal remembered day: {date, reason, chosen_by, source, chosen_at, stats, profile, surge_at?}."""
    prof = {k: series(profile, k) for k in ('flow', 'rain', 'temp', 'snow', 'is_day')}
    stats = dict(stats or {})
    rain = [v for v in prof['rain'] if v is not None]
    stats.setdefault('season', season_of(date))
    stats.setdefault('rain_mm', round(sum(rain), 1) if rain else 0.0)
    if stats.get('heaviest_hour') is None and rain and max(rain) > 0:
        stats['heaviest_hour'] = max(range(HOURS), key=lambda i: prof['rain'][i] or 0.0)
    stats.setdefault('dry', stats.get('rain_mm', 0.0) < 0.5)
    temps = [v for v in prof['temp'] if v is not None]
    snow = [v for v in prof['snow'] if v is not None]
    stats.setdefault('cold', bool((temps and min(temps) < 2.0) or (snow and sum(snow) > 0)))
    stats.setdefault('flow_pct', 50)
    day = {'date': date, 'reason': reason, 'chosen_by': chosen_by, 'source': source, 'chosen_at': chosen_at,
           'stats': stats, 'profile': prof}
    if surge_at is not _MISSING:
        day['surge_at'] = surge_at
    return day


def dave_day(state, now, mirror_age_s=0.0):
    """Dave's remembered day from state.json, or (None, why) when it can't be used. Returns (day, why)."""
    if mirror_age_s is None or mirror_age_s > MIRROR_STALE_S:
        return None, 'mirror stale'
    mem = (state or {}).get('memory')
    if not isinstance(mem, dict) or not mem.get('date') or not isinstance(mem.get('profile'), dict):
        return None, 'no memory in state.json'
    chosen = parse_time(mem.get('chosen_at'))
    if chosen is None:
        return None, 'memory has no chosen_at'
    if now - chosen > MEMORY_MAX_AGE_S:
        return None, f'Dave chose {round(now - chosen)} s ago (over {int(MEMORY_MAX_AGE_S)} s)'
    surge = state.get('surge_at', _MISSING)
    if surge is not _MISSING and surge is not None:
        try:
            surge = clamp(float(surge), 0.0, 24.0)
        except (TypeError, ValueError):
            surge = _MISSING
    day = make_day(mem['date'], mem['profile'], mem.get('stats'), source='dave', reason=str(mem.get('reason') or ''),
                   chosen_by=str(mem.get('chosen_by') or 'dave'), chosen_at=chosen, surge_at=surge)
    return day, 'Dave'


def preset_day():
    """Everything down: a calm loop at 30 %, no surge."""
    day = make_day('preset', {'flow': [1.0] * 24, 'rain': [0.0] * 24, 'is_day': [1] * 24},
                   {'dry': True, 'flow_pct': 30, 'season': 'autumn'}, source='preset',
                   reason='No remembered day available: the preset calm loop.', chosen_by='preset', surge_at=None)
    day['level'] = PRESET_LEVEL
    return day


def load_library(folder):
    """data/remembered as {'notable': [...], 'profiles': {date: profile}, 'days': {date: row}}; empty parts when missing."""
    folder = Path(folder)
    lib = {'notable': [], 'profiles': {}, 'days': {}}
    try:
        lib['notable'] = [n for n in json.loads((folder / 'notable.json').read_text(encoding='utf-8'))
                          if isinstance(n, dict) and n.get('date')]
    except (OSError, ValueError, TypeError):
        pass
    try:
        with gzip.open(folder / 'profiles.json.gz', 'rt', encoding='utf-8') as f:
            lib['profiles'] = json.load(f)
    except (OSError, ValueError, EOFError):
        pass
    try:
        with open(folder / 'days.csv', encoding='utf-8', newline='') as f:
            for row in csv.DictReader(f):
                lib['days'][row.get('date')] = row
    except OSError:
        pass
    return lib


def _stats_from_row(row, kind):
    def num(k):
        try:
            return float(row[k])
        except (KeyError, TypeError, ValueError):
            return None

    def flag(k):
        return str(row.get(k, '')).strip().lower() in ('1', 'true', 'yes')
    out = {}
    if row:
        for k in ('flow_mean_cfs', 'flow_pct', 'rain_mm', 'heaviest_hour', 'snow_cm'):
            v = num(k)
            if v is not None:
                out[k] = int(v) if k == 'heaviest_hour' else v
        if row.get('season'):
            out['season'] = row['season']
        for k in ('dry', 'cold'):
            if k in row:
                out[k] = flag(k)
    if 'flow_pct' not in out:
        out['flow_pct'] = KIND_PCT.get(kind, 50)
    if kind == 'drought':
        out.setdefault('dry', True)
    if kind == 'cold':
        out.setdefault('cold', True)
    return out


def fallback_day(lib, history, now, rng):
    """bitcube's own choice among the notable days that have a profile, never a date played within NO_REPEAT_S
    (history: [(date, epoch)]). If every candidate played within the hour, the one played longest ago. None if no data."""
    cands = [n for n in lib.get('notable', []) if n['date'] in lib.get('profiles', {})]
    if not cands:
        return None
    last = {}
    for d, t in history:
        last[d] = max(t, last.get(d, -1e18))
    fresh = [n for n in cands if now - last.get(n['date'], -1e18) >= NO_REPEAT_S]
    pick = rng.choice(fresh) if fresh else min(cands, key=lambda n: last.get(n['date'], -1e18))
    kind = pick.get('kind', 'notable')
    return make_day(pick['date'], lib['profiles'][pick['date']], _stats_from_row(lib['days'].get(pick['date']), kind),
                    source='fallback', reason=str(pick.get('line') or pick['date']), chosen_by=f'notable: {kind}',
                    chosen_at=now)


# ---- the room and the surge ------------------------------------------------------------------------------------------

def room_shift(room):
    """(seconds, why): 30 s sooner for a busy room or a lingerer, 30 s later for an empty room, else 0."""
    room = room or {}
    if not room.get('available'):
        return 0.0, ''
    if room.get('lingerers'):
        return -ROOM_SHIFT_S, 'a lingerer: 30 s sooner'
    if (room.get('relative') or 0) > BUSY_RELATIVE:
        return -ROOM_SHIFT_S, 'busier than usual: 30 s sooner'
    if (room.get('presence') or 0) <= 0 and (room.get('empty_for_s') or 0) >= EMPTY_ROOM_S:
        return ROOM_SHIFT_S, 'empty room: 30 s later'
    return 0.0, ''


def is_dry(day):
    return bool(day['stats'].get('dry')) or ('surge_at' in day and day['surge_at'] is None)


def plan_surge(day, room=None, opening_night=False):
    """{'hour', 't_s', 'why', 'room_shift_s'}; hour and t_s None on a dry day (no surge)."""
    surge = day.get('surge_at', _MISSING)
    if surge is not _MISSING and surge is not None:
        hour, why, shift = float(surge), f'Dave: hour {float(surge):g}', 0.0
    elif is_dry(day) and not opening_night:
        return {'hour': None, 't_s': None, 'why': 'dry day: no surge', 'room_shift_s': 0}
    elif is_dry(day):
        # Opening night (Gavin and the artists): a surge every loop, a dry day's at the default window, still moved by
        # the room; the ropes play it a little smaller (ctx dry).
        hour, why = OPENING_DRY_HOUR, 'Opening night: a surge every loop (the day was dry)'
        shift, swhy = room_shift(room)
        if swhy:
            why += ', ' + swhy
    else:
        h = day['stats'].get('heaviest_hour')
        if h is not None:
            # Open-Meteo stamps rain at the hour's end: the heaviest rain fell in the half hour before (as Dave's surge_at)
            hour, why = max(0.0, float(h) - 0.5), f'heaviest rain hour {int(h)} - 0.5'
        else:
            flow = day['profile']['flow']
            known = [i for i, v in enumerate(flow) if v is not None]
            hour = float(max(known, key=lambda i: flow[i])) if known else 12.0
            why = f'highest flow hour {int(hour)}'
        shift, swhy = room_shift(room)
        if swhy:
            why += ', ' + swhy
    t = hour * HOUR_S + shift
    ct = clamp(t, SURGE_MIN_S, SURGE_MAX_S)
    if ct != t:
        why += f' (clamped to {int(SURGE_MIN_S)}-{int(SURGE_MAX_S)} s)'
    return {'hour': round(hour, 2), 't_s': round(ct, 2), 'why': why, 'room_shift_s': int(shift)}


def phase_times(day, surge_t):
    """When each phase starts in the loop (seconds), placed by the day's weather around the surge. None: no surge.
    building starts earlier when it rained for longer before the surge hour (30-75 s before); settling lasts longer for a
    higher flow (45-75 s), cut at the loop's end."""
    if surge_t is None:
        return None
    rain = day['profile']['rain']
    peak = max([v for v in rain if v is not None] or [0.0])
    sh = int(clamp(surge_t / HOUR_S, 0, HOURS - 1))
    wet = sum(1 for i in range(max(0, sh - 4), sh) if peak > 0 and (rain[i] or 0.0) >= 0.25 * peak)
    build = clamp(30.0 + 11.25 * wet, 30.0, 75.0)
    pct = float(day['stats'].get('flow_pct') or 50)
    settle = clamp(45.0 + 0.3 * pct, 45.0, 75.0)
    s0 = surge_t + BODY_S
    return {'build': max(0.0, surge_t - build), 'drawback': surge_t - DRAWBACK_S, 'surge': surge_t,
            'settle': s0, 'calm': min(LOOP_S, s0 + settle)}


def phase_at(t, times):
    """The phase name at loop second t."""
    if times is None:
        return 'calm'
    if t < times['build'] or t >= times['calm']:
        return 'calm'
    if t < times['surge']:
        return 'building'
    if t < times['settle']:
        return 'surge'
    return 'settling'


def day_energy(day, hour):
    """How high the remembered river runs at this hour, 0..1 (the day's flow relative to its own peak, scaled by the
    day's flow percentile). 0.3 when the flow is unknown."""
    flow = day['profile']['flow']
    v = at_hour(flow, hour)
    peak = max([x for x in flow if x is not None] or [0.0])
    pct = float(day['stats'].get('flow_pct') or 50) / 100.0
    rel = (v / peak) if (v is not None and peak > 0) else 0.6
    return clamp(0.25 + 0.75 * rel * (0.4 + 0.6 * pct), 0.0, 1.0)


# ---- the loop ----------------------------------------------------------------------------------------------------

class Loop:
    """The loop clock. Call update(now, ...) once a frame (or less): it rolls loops, applies a new day at the boundary
    (starting the decision wave), and plans the surge (re-planned with the room until the loop is about to build)."""

    def __init__(self, seed=0):
        self.rng = random.Random(seed)
        self.index = 0
        self.start = None
        self.day = None
        self.next = None             # a different day already chosen by Dave, waiting for the boundary
        self.history = []            # [(date, epoch)] of days played
        self.plan = {'hour': None, 't_s': None, 'why': '', 'room_shift_s': 0}
        self.times = None
        self.locked = False
        self.wave_start = None
        self.dave_why = ''
        self.dave_played = None      # chosen_at of the last of Dave's choices that played

    def _choose(self, now, dave, lib):
        # each of Dave's choices plays once; between his choices bitcube fills the loop with a notable day
        if dave is not None and dave.get('chosen_at') != self.dave_played:
            self.dave_played = dave.get('chosen_at')
            return dave
        return fallback_day(lib or {}, self.history, now, self.rng) or preset_day()

    def _apply(self, day, now):
        changed = self.day is None or day['date'] != self.day['date'] or day['source'] != self.day['source']
        if self.day is not None and day['date'] == self.day['date'] and day['source'] == 'dave':
            changed = False
        self.day = day
        if changed:
            self.wave_start = now
            if day['source'] != 'preset':
                self.history.append((day['date'], now))
                self.history = [(d, t) for d, t in self.history if now - t < 2 * NO_REPEAT_S]
        self.locked = False

    def update(self, now, dave=None, lib=None, room=None, opening_night=False):
        if self.start is None or now < self.start - 5:          # first call, or the clock went backwards
            self.start = now
            self.index = 0
            self._apply(self._choose(now, dave, lib), now)
        elif now - self.start >= LOOP_S:
            n = int((now - self.start) // LOOP_S)
            self.index += n
            self.start = self.start + n * LOOP_S if n < 3 else now
            self._apply(self._choose(now, dave, lib), now)
        self.next = dave['date'] if dave is not None and dave['date'] != self.day['date'] else None
        if dave is not None and dave['date'] == self.day['date']:
            self.day.update({k: dave[k] for k in ('reason', 'chosen_by', 'chosen_at')})   # same day: keep it fresh
            if 'surge_at' in dave:
                self.day['surge_at'] = dave['surge_at']
        t = self.t(now)
        if not self.locked:
            if self.times is not None and t >= self.times['build'] - 2.0:
                self.locked = True                               # from building on, the surge stays where it is
            else:
                plan = plan_surge(self.day, room, opening_night)
                times = phase_times(self.day, plan['t_s'])
                self.plan, self.times = plan, times
                self.locked = times is not None and t >= times['build'] - 2.0
        return self.snapshot(now)

    def t(self, now):
        return 0.0 if self.start is None else clamp(now - self.start, 0.0, LOOP_S)

    def wave(self, now):
        """Seconds into the decision wave, or None when no wave is running."""
        if self.wave_start is None:
            return None
        w = now - self.wave_start
        return w if 0 <= w < WAVE_S else None

    def snapshot(self, now):
        t = self.t(now)
        return {'index': self.index, 't_s': t, 'hour': t / HOUR_S, 'phase': phase_at(t, self.times),
                'times': self.times, 'plan': self.plan, 'day': self.day, 'next': self.next, 'wave': self.wave(now)}
