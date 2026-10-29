"""The remembered river's control request file, River\\remembered\\control.json: the one schema TouchDesigner (show.py
parse_control), probe.ps1 (the remembered-* actions), mission control (lib/mission.mjs) and the Remembered river page
(public/remembered.js, remembered-words.js) share. docs/remembered-river.md section 5.

The canonical shape (what probe.ps1 writes; flat keys, the screens in one block):
  {"pool_height_m": 0.6, "light": "pool", "light_at": "2026-10-29T04:12:09Z", "opening_night": true,
   "screens": {"intensity": 0.82, "threshold": 0.35, "video": 0.7}, "at": "2026-10-29T04:12:09Z"}
Read as a fallback only, when the flat key is absent: zones.{pool_height_m, light, leds} (and its "t" as light_at; the
shape `tools/remembered/zones.py light --write` writes), opening.on, and the old flat screen_<name> keys.

Each field: {type, min, max, default, doc} (min/max only for numbers, choices for enums). validate(raw) keeps only the
fields that are present and valid, keyed by their schema name ("screens.video"). A future "overrides" block (plan step 3c)
gets its own entries here; nothing reads one yet.

The page and mission control read a generated copy, mission/public/remembered-schema.js (an ES module, so the browser and
node import it alike). Regenerate it after any change here:
  python td/remembered/control_schema.py           write it
  python td/remembered/control_schema.py --check   exit 1 when it is stale (tools/tests/test_control_schema.py does this)
"""
import json
import math
import sys
from datetime import datetime
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
}

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
    if t == 'time':
        return to_epoch(v) is not None
    return False


def _clean(name, v):
    if FIELDS[name]['type'] == 'number':
        return float(v)
    if FIELDS[name]['type'] == 'list':
        return [e for e in v if isinstance(e, dict)]
    return v


def validate(c):
    """control.json (any shape it has had) -> {field: value} for every field present and valid. A flat key wins; the old
    nested/legacy spellings count only when it is absent (not when it is invalid: an invalid flat value is dropped)."""
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
    return {'fields': FIELDS, 'light_max_s': LIGHT_MAX_S,
            'ui': {'lights': list(LIGHTS_UI), 'pool_height_m': POOL_HEIGHT_UI_M}}


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
