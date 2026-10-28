"""River\\remembered\\status.json (docs/remembered-river.md section 5): what the remembered river is doing, written twice
a second for the full check and mission control's debug page. Plain Python.

build() returns exactly the contract's shape; write() replaces the file atomically (never a half-written file).
"""
import json
import os
from pathlib import Path

KEYS = ('t', 'show', 'fps', 'loop', 'phase', 'day', 'surge', 'knobs', 'palette', 'ropes_follow', 'heard', 'river_motion',
        'river_source', 'room', 'panels', 'ropes', 'opening_night', 'zones')
WRITE_EVERY = 0.5


def _r(x, n=2):
    return None if x is None else round(float(x), n)


def build(*, now, show, fps, loop, day, plan, knobs, reflex, palette, heard, river_motion, river_source, room,
          lit_pct, cap, watts, opening_night, zones_file, pool_height_m, light, field=None):
    """The status object. loop: Loop.snapshot(); day: the playing remembered day; plan: the surge plan."""
    chosen = day.get('chosen_at') if day else None
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
        'ropes': {'watts': int(round(watts))},
        'opening_night': bool(opening_night),
        'zones': {'file': zones_file, 'pool_height_m': _r(pool_height_m), 'light': light},
    }


def write(path, obj):
    """Write JSON atomically (temp file + replace)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + '.tmp')
    tmp.write_text(json.dumps(obj, separators=(',', ':')), encoding='utf-8')
    os.replace(tmp, p)
