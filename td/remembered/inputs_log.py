"""The remembered river's inputs log, River\\logs\\inputs.jsonl (v2 plan decision 5; docs/remembered-river.md section 5):
what came in and what the show made of it, for mission control's sparklines and for looking back. Plain Python.

One JSON object per line:
  {"t": 1793160000.0, "inputs": {"heard": {"v": 0.62, "s": "sound"}, ...}, "params": {"knob.speed": {"v": 0.55, "s": "auto"}, ...}}
InputsLog.log(now, inputs, params) appends a line every EVERY_S (5 s), or sooner (but at most every MIN_GAP_S) when an
input's or parameter's source changes or its value moves by more than CHANGE (2 %) since the last line. At MAX_BYTES (20 MB)
the file moves to inputs.jsonl.1 (one old file kept). recent(path, seconds, fields) reads it back for sparklines, at most
MAX_POINTS points per field. Writing never raises: a full disk or a locked file only skips the line.
"""
import json
import math
import os
from pathlib import Path

EVERY_S = 5.0
MIN_GAP_S = 1.0
CHANGE = 0.02                 # |new - last| > CHANGE * max(|last|, 1): 2 % of a 0..1 range, 2 % of larger values
MAX_BYTES = 20 * 1024 * 1024
MAX_POINTS = 300


def default_path(river_dir):
    """River\\logs\\inputs.jsonl under the River folder."""
    return Path(river_dir) / 'logs' / 'inputs.jsonl'


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _compact(v):
    if _num(v):
        return round(float(v), 4)
    if isinstance(v, (list, tuple)):
        return [_compact(e) for e in v]
    if isinstance(v, dict):
        return {str(k): _compact(e) for k, e in v.items()}
    if v is None or isinstance(v, (str, bool)):
        return v
    try:
        return _compact(float(v))
    except (TypeError, ValueError):
        return str(v)


def _entries(d):
    """{name: {value, source, ...} | a bare value} -> {name: {'v': value, 's': source}}."""
    out = {}
    for k, e in (d or {}).items():
        if isinstance(e, dict) and ('value' in e or 'source' in e):
            out[str(k)] = {'v': _compact(e.get('value')), 's': e.get('source')}
        else:
            out[str(k)] = {'v': _compact(e), 's': None}
    return out


def _changed(a, b):
    """Whether entry a ({v, s}) differs from b by a source change or a value move over CHANGE."""
    if b is None or a['s'] != b['s']:
        return True
    va, vb = a['v'], b['v']
    if _num(va) and _num(vb):
        return abs(va - vb) > CHANGE * max(abs(vb), 1.0)
    return va != vb


class InputsLog:
    def __init__(self, path, every_s=EVERY_S, min_gap_s=MIN_GAP_S, max_bytes=MAX_BYTES):
        self.path = Path(path)
        self.every_s, self.min_gap_s, self.max_bytes = every_s, min_gap_s, max_bytes
        self.last_t = None
        self.last = None              # {'inputs': {...}, 'params': {...}} as last written
        self.error = None

    def due(self, now, line):
        if self.last_t is None or now < self.last_t:            # first line, or the clock went backwards
            return True
        gap = now - self.last_t
        if gap >= self.every_s:
            return True
        if gap < self.min_gap_s:
            return False
        for part in ('inputs', 'params'):
            old = self.last.get(part, {})
            if set(line[part]) != set(old) or any(_changed(e, old.get(k)) for k, e in line[part].items()):
                return True
        return False

    def log(self, now, inputs, params):
        """Append a line when due (see the module doc). inputs: status.json's inputs ({name: {value, source, ...}});
        params: overrides.apply's hows ({name: {value, source, ...}}) or bare values. Returns whether it wrote."""
        line = {'inputs': _entries(inputs), 'params': _entries(params)}
        if not self.due(now, line):
            return False
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._rotate()
            with open(self.path, 'a', encoding='utf-8', newline='\n') as f:
                f.write(json.dumps({'t': round(float(now), 2), **line}, separators=(',', ':')) + '\n')
            self.error = None
        except OSError as e:
            self.error = repr(e)
            return False
        self.last_t, self.last = now, line
        return True

    def _rotate(self):
        try:
            size = self.path.stat().st_size
        except OSError:
            return
        if size >= self.max_bytes:
            os.replace(self.path, self.path.with_name(self.path.name + '.1'))


def _read_lines(path, since):
    for p in (Path(str(path) + '.1'), Path(path)):
        try:
            f = open(p, encoding='utf-8')
        except OSError:
            continue
        with f:
            for ln in f:
                try:
                    d = json.loads(ln)
                except ValueError:
                    continue                                    # a torn last line
                t = d.get('t') if isinstance(d, dict) else None
                if _num(t) and t >= since:
                    yield d


def _field(d, field):
    """'inputs.heard' / 'params.knob.speed' -> that entry's value in line d (None when absent)."""
    part, _, name = field.partition('.')
    e = (d.get(part) or {}).get(name) if isinstance(d.get(part), dict) else None
    return e.get('v') if isinstance(e, dict) else None


def recent(path, seconds=86400, fields=None, now=None, max_points=MAX_POINTS):
    """The last `seconds` of the log (both files) -> {field: [[t, value], ...]} for sparklines, at most max_points points
    per field: numbers averaged per time bucket, other values (a day, a source) the bucket's last. fields: names like
    'inputs.heard', 'params.knob.speed' (None: every numeric field seen). now: the window's end (None: the last line)."""
    lines = list(_read_lines(path, -math.inf if now is None else now - seconds))
    if not lines:
        return {name: [] for name in (fields or [])}
    end = lines[-1]['t'] if now is None else now
    start = end - seconds
    lines = [d for d in lines if start <= d['t'] <= end]
    if fields is None:
        seen = {}
        for d in lines:
            for part in ('inputs', 'params'):
                for k, e in (d.get(part) or {}).items():
                    if isinstance(e, dict) and _num(e.get('v')):
                        seen[f'{part}.{k}'] = True
        fields = list(seen)
    width = max(seconds / max(1, max_points), 1e-9)
    out = {}
    for name in fields:
        buckets = {}
        for d in lines:
            v = _field(d, name)
            if v is None:
                continue
            b = min(max_points - 1, int((d['t'] - start) / width))
            buckets.setdefault(b, []).append((d['t'], v))
        pts = []
        for b in sorted(buckets):
            vals = buckets[b]
            nums = [v for _, v in vals if _num(v)]
            t = round(vals[-1][0], 2)
            pts.append([t, round(sum(nums) / len(nums), 4) if len(nums) == len(vals) else vals[-1][1]])
        out[name] = pts
    return out
