"""River\\remembered\\status.json (docs/remembered-river.md section 5): what the remembered river is doing, written twice
a second for the full check and mission control's debug page. Plain Python.

build() returns exactly the contract's shape; write() replaces the file atomically (never a half-written file).

v2 (plan decision 5, 8): beside the original keys, every input with its source and age (inputs), every overridable
parameter with its auto value, final value and source (params, from overrides.apply), what the people effects are doing
(effects, from ropes), the overrides in force and whether people are being simulated. inputs and params always list every
name (INPUTS, control_schema.PARAMS), so the page always has the same rows.
"""
import json
import math
import os
from pathlib import Path

from . import control_schema
from . import overrides as overrides_mod

KEYS = ('t', 'show', 'fps', 'loop', 'phase', 'day', 'surge', 'knobs', 'palette', 'ropes_follow', 'heard', 'river_motion',
        'river_source', 'room', 'panels', 'screens', 'ropes', 'opening_night', 'zones', 'inputs', 'params', 'effects',
        'overrides', 'simulating')
WRITE_EVERY = 0.5
# the inputs status.json reports, each {value, source, age_s, fresh}; source one of SOURCES
INPUTS = ('day', 'scene', 'reflex', 'heard', 'river_motion', 'headcount', 'lingerers', 'control')
SOURCES = ('dave', 'notable', 'preset', 'cam', 'clip', 'sound', 'counter', 'simulated', 'control')


def _r(x, n=2):
    return None if x is None else round(float(x), n)


def _val(v):
    """A JSON-ready value: numbers rounded to 3 places (non-finite -> None), lists and dicts element by element."""
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return round(float(v), 3) if math.isfinite(v) else None
    if isinstance(v, (list, tuple)):
        return [_val(e) for e in v]
    if isinstance(v, dict):
        return {str(k): _val(e) for k, e in v.items()}
    try:
        return _val(float(v))                                   # numpy scalars
    except (TypeError, ValueError):
        return str(v)


KNOBS = ('speed', 'density', 'brightness', 'turbulence')


def _input(src):
    """One inputs entry: {value, source, age_s, fresh} (missing: all None, not fresh). value is never an object (the
    contract's shape is fixed): a dict of knobs (Dave's scene, the reflex offsets) becomes [speed, density, brightness,
    turbulence] (absent ones 0)."""
    src = src if isinstance(src, dict) else {}
    age = src.get('age_s')
    v = src.get('value')
    if isinstance(v, dict):
        v = [v.get(k, 0.0) if isinstance(v.get(k, 0.0), (int, float)) else None for k in KNOBS]
    return {'value': _val(v), 'source': src.get('source'),
            'age_s': None if not isinstance(age, (int, float)) or isinstance(age, bool) or not math.isfinite(age)
            else round(float(age), 1), 'fresh': bool(src.get('fresh'))}


def _param(how):
    """One params entry: overrides.apply's how ({mode, auto, value, source, expires_in_s}); missing: auto, unknown."""
    how = how if isinstance(how, dict) else {}
    return {'mode': how.get('mode', 'auto'), 'auto': _val(how.get('auto')), 'value': _val(how.get('value')),
            'source': how.get('source', 'auto'), 'expires_in_s': how.get('expires_in_s')}


def build(*, now, show, fps, loop, day, plan, knobs, reflex, palette, heard, river_motion, river_source, room,
          lit_pct, cap, watts, opening_night, zones_file, pool_height_m, light, field=None, screens=None,
          sources=None, params=None, effects=None, overrides=None):
    """The status object. loop: Loop.snapshot(); day: the playing remembered day; plan: the surge plan.
    sources: {input: {value, source, age_s, fresh}} (INPUTS); params: {param: how} from overrides.apply; effects: the
    ropes' people effects (passed through); overrides: control.json's overrides block (validated or raw)."""
    chosen = day.get('chosen_at') if day else None
    sources = sources or {}
    params = params or {}
    return {
        't': round(float(now), 2),
        'show': show,
        'fps': int(round(fps or 0)),
        'loop': {'index': int(loop['index']), 't_s': _r(loop['t_s'], 1), 'length_s': 300,
                 'hour': _r(loop['hour'], 1)},
        'phase': loop['phase'],
        'day': {'date': day.get('date') if day else None, 'reason': day.get('reason', '') if day else '',
                'chosen_by': day.get('chosen_by', '') if day else '', 'source': day.get('source') if day else 'preset',
                'age_s': None if chosen is None else int(round(now - chosen)), 'next': loop.get('next')},
        'surge': {'hour': _r(plan.get('hour')), 't_s': _r(plan.get('t_s'), 1), 'why': plan.get('why', ''),
                  'room_shift_s': int(plan.get('room_shift_s') or 0)},
        'knobs': {**{k: _r(knobs.get(k, 0.5), 3) for k in ('speed', 'density', 'brightness', 'turbulence')},
                  'reflex': {k: _r(v, 3) for k, v in (reflex or {}).items()}},
        'palette': list(palette),
        'ropes_follow': 'sound' if heard is not None else 'picture',
        'heard': _r(heard),
        'river_motion': _r(river_motion),
        'river_source': river_source,
        'room': {'presence': _r(room.get('presence'), 1), 'usual': _r(room.get('usual'), 1),
                 'relative': _r(room.get('relative')), 'lingerers': list(room.get('lingerers') or [])},
        'panels': {'lit_pct': [int(v) for v in lit_pct], 'cap': cap, 'field': field},
        'screens': screens,
        'ropes': {'watts': int(round(watts))},
        'opening_night': bool(opening_night),
        'zones': {'file': zones_file, 'pool_height_m': _r(pool_height_m), 'light': light},
        'inputs': {k: _input(sources.get(k)) for k in INPUTS},
        'params': {k: _param(params.get(k)) for k in control_schema.PARAMS},
        'effects': _val(effects or {}),
        'overrides': _val(overrides_mod.active(overrides, now)),
        'simulating': overrides_mod.simulating(overrides, now),
    }


def write(path, obj):
    """Write JSON atomically (temp file + replace)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + '.tmp')
    tmp.write_text(json.dumps(obj, separators=(',', ':')), encoding='utf-8')
    os.replace(tmp, p)
