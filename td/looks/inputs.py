"""What the looks are fed, for River\\looks\\status.json: the inputs as they stand (Dave's agent, the river, the room)
and what the look on the lights takes from them. Plain Python; plain file reads only (never a socket), never raises:
anything missing, stale or malformed comes back as None.

  gather(river_dir, now, remembered_show=None)
      {"dave":  {age_s, memory_date, surge_at, scene, palette, knobs, heard, heard_age_s},
       "river": {source: live|clip|none, motion, age_s},
       "room":  {people, usual, lingerers: [{ropes, seconds}]}}
  used_by(look, remembered_show=None, fill=None, extra=None)
      remembered: {day, why, heard, knobs, room: {people, lingerers}} from the show's last status; fills: {};
      seasons, modal: whatever extra passes through
  summary_line(inputs, used)
      one short line for the logs: "Dave 4 min old (7 Feb 2017, surge 13.5), river live, 3 people, 1 lingerer"

Read the way the remembered river reads them (td/remembered/show.py, clock.py, palette.py):
  gallery_state\\state.json   memory.date, surge_at (an hour, clamped 0..24, or an ISO time kept as given), scene
                             (animation / palette_name, colours -> palette.from_dave as three hex colours like
                             palette.as_hex, the four knobs 0..1); age_s from set_at_epoch, else set_at, else the mtime
  gallery_state\\reflex.json  heard while the reflex is fresh (show.heard_of); heard_age_s from updated_epoch, else the mtime
  remembered\\status.json     the river (river_source, river_motion) while under RIVER_STALE_S old, else the live show's
                             own river, else none; and the room's usual (median over 10 min)
  presence.json              people (count) and lingerers ({ropes, still_s}) while under PRESENCE_STALE_S old
While the remembered river is ticking (its last tick under SHOW_FRESH_S ago) these are the show's own parsed copies
(show.state, show.reflex, show.presence_raw, show.last_status) instead of a second read; otherwise each file is parsed
again only when it changed (remembered/files.py).
"""
import datetime as dt
import math
from pathlib import Path

from remembered import files
from remembered import palette as palette_mod
from remembered import show as rshow
from remembered.files import PRESENCE_STALE_S, RIVER_STALE_S   # noqa: F401 (status.json older: the show isn't writing)
from remembered.knobs import KNOBS

SHOW_FRESH_S = 3.0                   # the remembered show ticked this recently: reuse what it read (it reads every <= 2 s)
SOURCES = ('live', 'clip', 'none')


# ---- small helpers ---------------------------------------------------------------------------------------------------

def _num(x):
    """A finite float, else None (bools are not numbers here)."""
    if isinstance(x, bool):
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _r(x, n=2):
    v = _num(x)
    return None if v is None else round(v, n)


def _age(now, stamp):
    """Seconds since stamp (never negative), or None."""
    v = _num(stamp)
    return None if v is None else max(0, int(round(now - v)))


def _read(path):
    """(json or None, mtime or None), parsed again only when the file changed (read-only: copy before changing it)."""
    return files.read_json_cached(path)


def _live(show, now):
    """The remembered show, if it ticked within SHOW_FRESH_S (then its parsed inputs are current), else None."""
    t = _num(getattr(show, 'last_tick', None)) if show is not None else None
    return show if t is not None and 0 <= now - t < SHOW_FRESH_S else None


def _epoch(x):
    """An epoch number or an ISO time -> epoch seconds, or None."""
    v = _num(x)
    if v is not None:
        return v
    if not isinstance(x, str) or not x:
        return None
    try:
        t = dt.datetime.fromisoformat(x.replace('Z', '+00:00'))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t.timestamp()


def _dict(x):
    return x if isinstance(x, dict) else {}


# ---- Dave's agent ----------------------------------------------------------------------------------------------------

def _surge_at(state):
    """surge_at as clock.dave_day reads it (an hour, clamped 0..24); an ISO time (not a number) is kept as given."""
    s = state.get('surge_at')
    v = _num(s)
    if v is not None:
        return round(max(0.0, min(24.0, v)), 2)
    if isinstance(s, str) and _epoch(s) is not None:
        return s
    return None


def _scene(state):
    """(name, palette, knobs) of a usable scene (not missing, not a placeholder), else Nones."""
    sc = state.get('scene')
    if not isinstance(sc, dict) or not sc or sc.get('placeholder'):
        return None, None, None
    parts = [str(sc[k]) for k in ('animation', 'palette_name') if isinstance(sc.get(k), str) and sc.get(k)]
    name = ' / '.join(parts) or None
    pal = None
    colors = sc.get('colors')
    if isinstance(colors, list):
        try:
            d = palette_mod.from_dave(colors)
            pal = None if d is None else [palette_mod.rgb_hex(d[k]) for k in ('deep', 'mid', 'light')]
        except Exception:                                         # noqa: BLE001 - a bad colour is just no palette
            pal = None
    knobs = {}
    for k in KNOBS:
        v = _num(sc.get(k))
        knobs[k] = None if v is None else round(max(0.0, min(1.0, v)), 3)
    return name, pal, knobs


def _dave(river, now, show=None):
    out = dict.fromkeys(('age_s', 'memory_date', 'surge_at', 'scene', 'palette', 'knobs', 'heard', 'heard_age_s'))
    if show is not None:
        state, mtime = show.state, show.state_mtime
        reflex = show.reflex
        rmtime = reflex.get('_mtime') if isinstance(reflex, dict) else None
    else:
        state, mtime = _read(river / 'gallery_state' / 'state.json')
        reflex, rmtime = _read(river / 'gallery_state' / 'reflex.json')
    if isinstance(state, dict):
        stamp = _epoch(state.get('set_at_epoch'))
        if stamp is None:
            stamp = _epoch(state.get('set_at'))
        out['age_s'] = _age(now, stamp if stamp is not None else mtime)
        mem = state.get('memory')
        if isinstance(mem, dict) and isinstance(mem.get('date'), str) and mem['date']:
            out['memory_date'] = mem['date']
        out['surge_at'] = _surge_at(state)
        out['scene'], out['palette'], out['knobs'] = _scene(state)
    if isinstance(reflex, dict):
        stamp = _num(reflex.get('updated_epoch'))
        out['heard_age_s'] = _age(now, stamp if stamp else rmtime)
        reflex = dict(reflex)
        if rmtime is not None:
            reflex['_mtime'] = rmtime
        try:
            out['heard'] = _r(rshow.heard_of(reflex, now))
        except (TypeError, ValueError):
            out['heard'] = None
    return out


# ---- the river and the room ------------------------------------------------------------------------------------------

def _remembered_status(river, now, show=None):
    """remembered\\status.json while it's fresh (the remembered river writing it), else None. Returns (status, age_s).
    The live show's own last status when it's ticking (it wrote that file)."""
    if show is not None and isinstance(getattr(show, 'last_status', None), dict):
        st, mtime = show.last_status, None
    else:
        st, mtime = _read(river / 'remembered' / 'status.json')
    if not isinstance(st, dict):
        return None, None
    t = _num(st.get('t'))
    stamp = t if t is not None else mtime
    if stamp is None or not 0 <= now - stamp < RIVER_STALE_S:
        return None, None
    return st, now - stamp


def _river(status, status_age, show, now):
    if status is not None:
        src = status.get('river_source')
        src = src if src in SOURCES else None
        return {'source': src, 'motion': _r(status.get('river_motion')) if src != 'none' else None,
                'age_s': _age(now, now - status_age)}
    if show is not None:
        try:
            rt = _num(getattr(show, 'river_t', None))
            if rt is not None and 0 <= now - rt < RIVER_STALE_S:
                src = getattr(show, 'river_source', None)
                src = src if src in SOURCES else None
                motion = None
                if src not in (None, 'none'):
                    motion = _r(show.motion.level)
                return {'source': src, 'motion': motion, 'age_s': _age(now, rt)}
        except Exception:                                         # noqa: BLE001 - a half-built show is no river
            pass
    return {'source': 'none', 'motion': None, 'age_s': None}


def _usual(status, show, now):
    if status is not None:
        return _r(_dict(status.get('room')).get('usual'), 1)
    if show is not None:
        try:
            st = show.room.stats(now)
            return _r(st.get('usual'), 1) if st.get('available') else None
        except Exception:                                         # noqa: BLE001
            return None
    return None


def _room(river, now, usual, show=None):
    out = {'people': None, 'usual': usual, 'lingerers': None}
    data = show.presence_raw if show is not None else _read(river / 'presence.json')[0]
    if not isinstance(data, dict):
        return out
    t = _num(data.get('t'))
    if t is None or now - t > PRESENCE_STALE_S:
        return out
    count = _num(data.get('count'))
    if count is None and isinstance(data.get('people'), list):
        count = len(data['people'])
    out['people'] = None if count is None else max(0, int(round(count)))
    ling = []
    raw = data.get('lingerers')
    for g in raw if isinstance(raw, list) else []:
        if isinstance(g, dict):
            rs = g.get('ropes')
            ropes = [int(_num(r)) for r in rs if _num(r) is not None] if isinstance(rs, list) else []
            ling.append({'ropes': ropes, 'seconds': _r(g.get('still_s'), 1)})
    out['lingerers'] = ling
    return out


# ---- the API ---------------------------------------------------------------------------------------------------------

def _empty():
    return {'dave': dict.fromkeys(('age_s', 'memory_date', 'surge_at', 'scene', 'palette', 'knobs', 'heard',
                                   'heard_age_s')),
            'river': {'source': 'none', 'motion': None, 'age_s': None},
            'room': {'people': None, 'usual': None, 'lingerers': None}}


def gather(river_dir, now, remembered_show=None):
    """The inputs as they stand now (see the module docstring). Never raises."""
    out = _empty()
    try:
        river = Path(river_dir)
        now = float(now)
    except (TypeError, ValueError):
        return out
    live = _live(remembered_show, now)
    try:
        out['dave'] = _dave(river, now, live)
    except Exception:                                             # noqa: BLE001 - never stop the show
        pass
    try:
        status, status_age = _remembered_status(river, now, live)
    except Exception:                                             # noqa: BLE001
        status, status_age = None, None
    try:
        out['river'] = _river(status, status_age, remembered_show, now)
    except Exception:                                             # noqa: BLE001
        pass
    try:
        out['room'] = _room(river, now, _usual(status, remembered_show, now), live)
    except Exception:                                             # noqa: BLE001
        pass
    return out


def _remembered_used(show):
    out = {'day': None, 'why': None, 'heard': None, 'knobs': None, 'room': {'people': None, 'lingerers': None}}
    st = getattr(show, 'last_status', None) if show is not None else None
    if not isinstance(st, dict):
        return out
    day = _dict(st.get('day'))
    out['day'] = day.get('date') if isinstance(day.get('date'), str) else None
    out['why'] = day.get('reason') if isinstance(day.get('reason'), str) and day.get('reason') else None
    out['heard'] = _r(st.get('heard'))
    kn = st.get('knobs')
    if isinstance(kn, dict):
        out['knobs'] = {k: _r(kn.get(k), 3) for k in KNOBS}
    room = _dict(st.get('room'))
    ling = room.get('lingerers')
    out['room'] = {'people': _r(room.get('presence'), 1), 'lingerers': len(ling) if isinstance(ling, list) else None}
    return out


def used_by(look, remembered_show=None, fill=None, extra=None):
    """What the look on the lights takes from the inputs now. Never raises."""
    try:
        if look == 'remembered':
            return _remembered_used(remembered_show)
        if isinstance(look, str) and look.startswith('fill'):
            return {}
        return dict(extra) if isinstance(extra, dict) else {}
    except Exception:                                             # noqa: BLE001
        return {}


# ---- one line for the logs -------------------------------------------------------------------------------------------

def _ago(s):
    if s is None:
        return None
    if s < 90:
        return f'{int(s)} s'
    if s < 90 * 60:
        return f'{int(round(s / 60))} min'
    return f'{int(round(s / 3600))} h'


def _date(d):
    """'2017-02-07' -> '7 Feb 2017' (anything else as given)."""
    try:
        x = dt.date.fromisoformat(str(d)[:10])
    except ValueError:
        return str(d)
    return f'{x.day} {x:%b %Y}'


def _plural(n, word):
    return f'{n} {word}' + ('' if n == 1 else 's')


def summary_line(inputs, used=None):
    """One short plain-English line: "Dave 4 min old (7 Feb 2017, surge 13.5), river live, 3 people, 1 lingerer"."""
    try:
        d = _dict(_dict(inputs).get('dave'))
        r = _dict(_dict(inputs).get('river'))
        m = _dict(_dict(inputs).get('room'))
        parts = []
        if d.get('age_s') is None:
            dave = 'Dave: no state'
        else:
            dave = f"Dave {_ago(d['age_s'])} old"
            bits = []
            if d.get('memory_date'):
                bits.append(_date(d['memory_date']))
            if d.get('surge_at') is not None:
                s = d['surge_at']
                bits.append(f'surge {s:g}' if isinstance(s, (int, float)) else f'surge {s}')
            if bits:
                dave += f" ({', '.join(bits)})"
        if d.get('heard') is not None:
            dave += f", heard {d['heard']:g}"
        parts.append(dave)
        src = r.get('source') or 'unknown'
        parts.append(f'river {src}' + (f" (motion {r['motion']:g})" if r.get('motion') is not None else ''))
        if m.get('people') is None:
            parts.append('room unknown')
        else:
            n = m['people']
            parts.append('nobody' if n == 0 else '1 person' if n == 1 else f'{n} people')
            if m.get('lingerers'):
                parts.append(_plural(len(m['lingerers']), 'lingerer'))
        u = _dict(used)
        if u.get('day') and u.get('day') != d.get('memory_date'):
            parts.append(f"playing {_date(u['day'])}")
        return ', '.join(parts)
    except Exception:                                             # noqa: BLE001
        return 'inputs: unreadable'
