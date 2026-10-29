"""The remembered river's control request file, River\\remembered\\control.json: the one schema TouchDesigner (show.py
parse_control), probe.ps1 (the remembered-* actions), mission control (lib/mission.mjs) and the Remembered river page
(public/remembered.js, remembered-words.js) share. docs/remembered-river.md section 5.

The canonical shape (what probe.ps1 writes; flat keys, the screens in one block):
  {"pool_height_m": 0.6, "light": "pool", "light_at": "2026-10-29T04:12:09Z", "opening_night": true,
   "screens": {"intensity": 0.82, "threshold": 0.35, "video": 0.7}, "at": "2026-10-29T04:12:09Z"}
Read as a fallback only, when the flat key is absent: zones.{pool_height_m, light, leds} (and its "t" as light_at; the
shape `tools/remembered/zones.py light --write` writes), opening.on, and the old flat screen_<name> keys.

Each field: {type, min, max, default, doc} (min/max only for numbers, choices for enums). validate(raw, now) keeps only the
fields that are present and valid, keyed by their schema name ("screens.video").

The "overrides" block (v2 plan decision 6; docs/remembered-river.md section 5): a manual override of any parameter the show
drives, one entry per PARAMS name:
  "overrides": {"knob.speed": {"mode": "adjust", "offset": 0.1, "gain": 1.2, "at": "...Z", "expires_at": null},
                "palette": {"mode": "fix", "value": ["#0b3d5c", "#1f8fb3", "#bfefff"], "at": "...Z"},
                "headcount": {"mode": "fix", "value": 6, "at": "...Z", "expires_at": "...Z"}}
  auto: the show's own value (the same as no entry); fix: value instead of it; adjust (numbers only): auto * gain + offset,
  clamped to the parameter's range. Sticky until cleared or expires_at, except the simulated people (headcount,
  lingerer_rope): they need an at and never last past at + SIMULATED_MAX_S (2 minutes). validate_overrides(raw, now) keeps
  the valid, unexpired fix/adjust entries; overrides.py applies them (apply, simulated_people).

The page and mission control read a generated copy, mission/public/remembered-schema.js (an ES module, so the browser and
node import it alike). Regenerate it after any change here:
  python td/remembered/control_schema.py           write it
  python td/remembered/control_schema.py --check   exit 1 when it is stale (tools/tests/test_control_schema.py does this)
"""
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

LIGHT_MAX_S = 600.0                  # a light check (pool, eddies, leds) goes back to the show on its own after 10 minutes
POOL_HEIGHT_UI_M = 0.6               # the page's pool slider before TouchDesigner or control.json says anything
LIGHTS_UI = ('off', 'pool', 'eddies')    # what mission control may ask for (leds: zones.py only)

FIELDS = {
    'pool_height_m': {'type': 'number', 'min': 0.0, 'max': 1.5, 'default': None,
                      'doc': "the pool line, metres above the floor; null: the zones file's own"},
    'light': {'type': 'enum', 'choices': ['off', 'pool', 'eddies', 'leds'], 'default': 'off',
              'doc': 'off: the show; pool / eddies / leds: light those LEDs to check them. Never survives a restart of the '
                     'show, and goes back to off by itself after light_max_s'},
    'light_at': {'type': 'time', 'default': None,
                 'doc': 'when light was last set (UTC, ISO 8601); a light set before the show started, or over light_max_s '
                        "ago, is ignored. Absent: the file's at, else its write time"},
    'leds': {'type': 'list', 'default': [], 'doc': 'light: leds only: [{rope, from, to}] (zones.py light leds --write)'},
    'opening_night': {'type': 'bool', 'default': True, 'doc': 'the opening-night switch: on unless the file says false'},
    'screens.intensity': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.82,
                          'doc': 'how bright the four screens are, ribbons and video alike'},
    'screens.threshold': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.35,
                          'doc': 'how much the river has to move to show in its video'},
    'screens.video': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.7,
                      'doc': 'how strongly the river video shows under the particle windows (0: the particles alone)'},
    'screens.mode': {'type': 'enum', 'choices': ['particles', 'water'], 'default': 'particles',
                     'doc': 'particles: one field seen through the screens as windows; water: the river video'},
    'screens.field': {'type': 'enum', 'choices': ['ribbons', 'fine', 'streaks'], 'default': 'ribbons',
                      'doc': 'what the particle windows look onto'},
    'screens.gpu': {'type': 'bool', 'default': True, 'doc': "the ribbons drawn on the GPU while its shaders are healthy"},
    'screens.motion_mask': {'type': 'bool', 'default': True,
                            'doc': 'all-looks only: false lets recorded video bypass the motion mask'},
    'at': {'type': 'time', 'default': None, 'doc': 'when the file was last written (UTC, ISO 8601)'},
    'overrides': {'type': 'overrides', 'default': {},
                  'doc': 'manual overrides of the parameters the show drives: {param: {mode: fix|adjust, value, offset, gain, '
                         'at, expires_at}}; see params'},
}

# ---- overrides ---------------------------------------------------------------------------------------------------------
# Every parameter the show drives that people may steer from mission control. Each: {type (number|int|date|palette), min,
# max (numbers), default (the show's usual value, null: always computed), unit, group, modes, doc}; simulated: an input
# stand-in that clears itself after SIMULATED_MAX_S. The screens' intensity/threshold/video stay plain fields (above).
SIMULATED_MAX_S = 120.0
FUTURE_SLACK_S = 60.0                # a simulated override stamped further ahead than this (a wrong clock) is ignored
MODES = ('auto', 'fix', 'adjust')
GAIN_RANGE = (0.0, 4.0)
DAYS_CSV = Path(__file__).resolve().parents[2] / 'data' / 'remembered' / 'days.csv'
_NUM = ['auto', 'fix', 'adjust']
_FIX = ['auto', 'fix']

PARAMS = {
    'day': {'type': 'date', 'default': None, 'unit': '', 'group': 'day', 'modes': _FIX,
            'doc': 'the remembered day playing (YYYY-MM-DD, a day in data/remembered/days.csv); auto: Dave\'s pick, else a '
                   'notable day, else the preset'},
    'surge_hour': {'type': 'number', 'min': 0.0, 'max': 24.0, 'default': None, 'unit': 'h', 'group': 'day', 'modes': _NUM,
                   'doc': "the remembered hour the main surge lands on (the loop plays 24 h in 5 min); auto: Dave's "
                          "surge_at, else the day's heaviest hour"},
    'knob.speed': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.5, 'unit': '', 'group': 'knobs', 'modes': _NUM,
                   'doc': 'how fast the water runs down the ropes'},
    'knob.density': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.5, 'unit': '', 'group': 'knobs',
                     'modes': _NUM, 'doc': 'how many ropes carry drips and streams'},
    'knob.brightness': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.5, 'unit': '', 'group': 'knobs',
                        'modes': _NUM, 'doc': 'how bright the water is'},
    'knob.turbulence': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.5, 'unit': '', 'group': 'knobs',
                        'modes': _NUM, 'doc': 'how rough: splashes, sloshing, the ribbons swirling'},
    'palette': {'type': 'palette', 'default': None, 'unit': '', 'group': 'look', 'modes': _FIX,
                'doc': "the three colours, deep / mid / light ('#rrggbb'); auto: the day's season and Dave's colours"},
    'flow_level': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.5, 'unit': '', 'group': 'ropes', 'modes': _NUM,
                   'doc': 'how hard the ropes flow: what the gallery hears, else how much the river camera moves'},
    'headcount': {'type': 'number', 'min': 0.0, 'max': 20.0, 'default': None, 'unit': 'people', 'group': 'room',
                  'modes': _FIX, 'simulated': True,
                  'doc': 'people in the room (the counter); fix: SIMULATE that many, for 2 minutes at most'},
    'lingerer_rope': {'type': 'int', 'min': 0, 'max': 19, 'default': None, 'unit': 'rope', 'group': 'room',
                      'modes': _FIX, 'simulated': True,
                      'doc': 'someone standing still by this rope (the counter); fix: SIMULATE a lingerer there, for 2 '
                             'minutes at most'},
    'calm_min': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.18, 'unit': '', 'group': 'ropes', 'modes': _NUM,
                 'doc': "the floor of the calm brightness curve (the day's hours, the room, a slow drift)"},
    'calm_max': {'type': 'number', 'min': 0.0, 'max': 1.0, 'default': 0.6, 'unit': '', 'group': 'ropes', 'modes': _NUM,
                 'doc': 'the ceiling of the calm brightness curve'},
    'master_brightness': {'type': 'number', 'min': 0.0, 'max': 1.5, 'default': 1.0, 'unit': 'x', 'group': 'ropes',
                          'modes': _NUM, 'doc': "every rope's brightness times this (the power limit still applies)"},
}
SIMULATED = tuple(k for k, p in PARAMS.items() if p.get('simulated'))
_HEX = re.compile(r'#[0-9a-fA-F]{6}')
_DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
_days = None


def known_days():
    """The dates in data/remembered/days.csv (a frozenset; empty when the file isn't there: then any real date passes)."""
    global _days
    if _days is None:
        try:
            lines = DAYS_CSV.read_text(encoding='utf-8').splitlines()[1:]
            _days = frozenset(ln.split(',', 1)[0] for ln in lines if ln)
        except OSError:
            _days = frozenset()
    return _days


def param_value(name, v):
    """A fixed value for parameter name, cleaned (float, int, 'YYYY-MM-DD', ['#rrggbb'] * 3), or None when invalid."""
    p = PARAMS[name]
    t = p['type']
    if t in ('number', 'int'):
        if not (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and p['min'] <= v <= p['max']):
            return None
        if t == 'int':
            return int(v) if float(v).is_integer() else None
        return float(v)
    if t == 'date':
        if not (isinstance(v, str) and _DATE.fullmatch(v)):
            return None
        try:
            datetime.strptime(v, '%Y-%m-%d')
        except ValueError:
            return None
        days = known_days()
        return v if not days or v in days else None
    if t == 'palette':
        if isinstance(v, list) and len(v) == 3 and all(isinstance(c, str) and _HEX.fullmatch(c) for c in v):
            return [c.lower() for c in v]
        return None
    return None


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi


def iso(t):
    """unix seconds -> '2026-10-29T04:12:09Z'."""
    return datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def override_entry(name, e, now=None):
    """One overrides entry -> the cleaned entry {mode, value?, offset?, gain?, at, expires_at} or None (invalid, auto, or
    expired at now). A simulated parameter needs an at; its expires_at becomes at most at + SIMULATED_MAX_S."""
    if name not in PARAMS or not isinstance(e, dict):
        return None
    p = PARAMS[name]
    mode = e.get('mode')
    if mode not in p['modes'] or mode == 'auto':
        return None
    out = {'mode': mode}
    if mode == 'fix':
        v = param_value(name, e.get('value'))
        if v is None:
            return None
        out['value'] = v
    else:                                                       # adjust: auto * gain + offset
        span = p['max'] - p['min']
        off, gain = e.get('offset', 0.0), e.get('gain', 1.0)
        if off is None:
            off = 0.0
        if gain is None:
            gain = 1.0
        if not (_num(off, -span, span) and _num(gain, *GAIN_RANGE)):
            return None
        out['offset'], out['gain'] = float(off), float(gain)
    at = to_epoch(e.get('at'))
    exp = e.get('expires_at')
    exp_t = None if exp is None else to_epoch(exp)
    if exp is not None and exp_t is None:
        return None                                             # an expiry nobody can read: never let it stick forever
    if p.get('simulated'):
        if at is None or (now is not None and at > now + FUTURE_SLACK_S):
            return None
        exp_t = at + SIMULATED_MAX_S if exp_t is None else min(exp_t, at + SIMULATED_MAX_S)
    if now is not None and exp_t is not None and now >= exp_t:
        return None
    out['at'] = None if at is None else iso(at)
    out['expires_at'] = None if exp_t is None else iso(exp_t)
    return out


def validate_overrides(raw, now=None):
    """control.json's overrides block -> {param: cleaned entry} for every valid fix/adjust entry not expired at now (now
    None: none treated as expired). auto entries, unknown parameters and invalid values are dropped."""
    if not isinstance(raw, dict):
        return {}
    out = {}
    for name, e in raw.items():
        c = override_entry(name, e, now)
        if c is not None:
            out[name] = c
    return out

DEFAULTS = {k: f['default'] for k, f in FIELDS.items()}


def valid(name, v):
    """Whether v is a valid value for field name."""
    f = FIELDS[name]
    t = f['type']
    if t == 'number':
        return (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                and f['min'] <= v <= f['max'])
    if t == 'enum':
        return isinstance(v, str) and v in f['choices']
    if t == 'bool':
        return isinstance(v, bool)
    if t == 'list':
        return isinstance(v, list)
    if t == 'overrides':
        return isinstance(v, dict)
    if t == 'time':
        return to_epoch(v) is not None
    return False


def _clean(name, v):
    if FIELDS[name]['type'] == 'number':
        return float(v)
    if FIELDS[name]['type'] == 'list':
        return [e for e in v if isinstance(e, dict)]
    return v


def validate(c, now=None):
    """control.json (any shape it has had) -> {field: value} for every field present and valid. A flat key wins; the old
    nested/legacy spellings count only when it is absent (not when it is invalid: an invalid flat value is dropped).
    overrides: present only when it holds a valid entry not expired at now (validate_overrides)."""
    if not isinstance(c, dict):
        return {}
    z = c.get('zones') if isinstance(c.get('zones'), dict) else {}
    op = c.get('opening') if isinstance(c.get('opening'), dict) else {}
    sc = c.get('screens') if isinstance(c.get('screens'), dict) else {}
    out = {}
    for name in FIELDS:
        if name.startswith('screens.'):
            k = name.split('.', 1)[1]
            v = sc[k] if k in sc else c.get('screen_' + k)
        elif name in ('pool_height_m', 'light', 'leds'):
            v = c[name] if name in c else z.get(name)
        elif name == 'light_at':
            v = c[name] if name in c else (c.get('t') if 'light' not in c and 'light' in z else None)
        elif name == 'opening_night':
            v = c[name] if name in c else op.get('on')
        elif name == 'overrides':
            ov = validate_overrides(c.get(name), now)
            if ov:
                out[name] = ov
            continue
        else:
            v = c.get(name)
        if v is not None and valid(name, v):
            out[name] = _clean(name, v)
    return out


def to_epoch(v):
    """A time as control.json writes it (ISO 8601 UTC like "2026-10-29T04:12:09Z", or unix seconds) -> unix seconds."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v) if math.isfinite(v) and v > 0 else None
    if isinstance(v, str) and v:
        try:
            d = datetime.fromisoformat(v.strip().replace('Z', '+00:00'))
        except ValueError:
            return None
        if d.tzinfo is None:
            return None
        return d.timestamp()
    return None


def light_set_at(fields, mtime=None):
    """When the light in validate()'s fields was set (unix s): light_at, else the file's at, else its write time."""
    for k in ('light_at', 'at'):
        if k in fields:
            return to_epoch(fields[k])
    return mtime


def as_json():
    """What the page and mission control read (mission/public/remembered-schema.js)."""
    days = sorted(known_days())
    return {'fields': FIELDS, 'light_max_s': LIGHT_MAX_S,
            'ui': {'lights': list(LIGHTS_UI), 'pool_height_m': POOL_HEIGHT_UI_M},
            'params': PARAMS,
            'overrides': {'modes': list(MODES), 'simulated': list(SIMULATED), 'simulated_max_s': SIMULATED_MAX_S,
                          'gain': list(GAIN_RANGE),
                          'days': {'first': days[0] if days else None, 'last': days[-1] if days else None,
                                   'count': len(days)}}}


OUT = Path(__file__).resolve().parents[2] / 'mission' / 'public' / 'remembered-schema.js'


def dump_json():
    """The generated module's text."""
    return ('// GENERATED from td/remembered/control_schema.py (python td/remembered/control_schema.py): do not edit by hand.\n'
            "// River\\remembered\\control.json's fields, defaults and ranges (docs/remembered-river.md section 5), shared by\n"
            '// lib/mission.mjs, remembered-words.js and remembered.js. tools/tests/test_control_schema.py checks it is current.\n'
            'export default ' + json.dumps(as_json(), indent=2) + ';\n')


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    text = dump_json()
    if '--check' in argv:
        ok = OUT.exists() and OUT.read_text(encoding='utf-8') == text
        print('remembered-schema.js is current' if ok else
              'remembered-schema.js is stale: run python td/remembered/control_schema.py')
        return 0 if ok else 1
    OUT.write_text(text, encoding='utf-8', newline='\n')
    print('wrote', OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
