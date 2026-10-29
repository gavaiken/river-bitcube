"""The remembered river's inputs log, read back for mission control's sparklines (docs/mission-ui.md "Remembered river v2 page").

    python tools/remembered/history.py --fields inputs.heard,params.knob.speed [--seconds 86400] [--river C:\\Users\\user\\River]

Prints ONE line of JSON: {"ok": true, "action": "remembered-history", "now_s": ..., "fields": {field: [[t, value], ...]}}, from
td/remembered/inputs_log.py recent() over River\\logs\\inputs.jsonl (and its .1), the last --seconds ending now, at most 300 points
a field. A field is inputs.<name> or params.<name> (letters, digits, dots and underscores). probe.ps1 -Action remembered-history runs
it; mission control caches its answer 30 s (mission/lib/remembered.mjs). Read-only.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import inputs_log  # noqa: E402

FIELD = re.compile(r'(inputs|params)\.[A-Za-z0-9_.]{1,40}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--fields', required=True, help='comma-separated: inputs.heard,params.knob.speed')
    ap.add_argument('--seconds', type=float, default=86400.0)
    ap.add_argument('--river', default=str(ROOT.parent), help='the River folder (default: the checkout\'s parent)')
    a = ap.parse_args(argv)
    fields = [f.strip() for f in a.fields.split(',') if f.strip()]
    bad = [f for f in fields if not FIELD.fullmatch(f)]
    if not fields or bad or not 0 < a.seconds <= 7 * 86400:
        print(json.dumps({'ok': False, 'action': 'remembered-history', 'error': f'bad fields or seconds: {bad[:3] or a.seconds}'}))
        return 2
    now = time.time()
    try:
        out = inputs_log.recent(inputs_log.default_path(a.river), seconds=a.seconds, fields=fields, now=now)
    except Exception as e:                                        # noqa: BLE001 (one line of JSON, whatever happens)
        print(json.dumps({'ok': False, 'action': 'remembered-history', 'error': f'reading the inputs log failed: {e!r}'[:300]}))
        return 1
    print(json.dumps({'ok': True, 'action': 'remembered-history', 'now_s': round(now, 2), 'fields': out}, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
