# TouchDesigner side of the river's year, for river-local-oct-22-seasons.toe.
# Synced into /project1/seasons/seasons_mod (edit here, not in TD). The year itself (modes, forward-only
# travel, presence) is td/seasons/seasons.py, synced into seasons_engine; this file runs it once per frame,
# feeds it the people counter's counts, keeps the rules, and serves the control page.
#
#   frame(comp)        executeDAT onFrameStart: step the year
#   w(k), intensity()  read by the season look's expressions (k: 0 winter, 1 spring, 2 summer, 3 autumn)
#   http(req, resp)    Web Server DAT (port 9981): the control page and its JSON API
#
# Files (outside the repo, on bitcube):
#   C:/Users/user/River/seasons-rules.json   the rules, as last applied from the control page
#   C:/Users/user/River/presence.json        written by the people counter: {"t": unix time, "count": n}
#                                            (until it exists, dynamic mode is unavailable)
import json
import pathlib
import sys
import time
import types
import urllib.parse

REPO = pathlib.Path(r'C:\Users\user\River\river-bitcube')
RIVER = REPO.parent
RULES_FILE = RIVER / 'seasons-rules.json'
PRESENCE_FILE = RIVER / 'presence.json'
CONTROL_HTML = REPO / 'td' / 'seasons' / 'control.html'
HISTORY_EVERY = 10.0              # s between points on the control page's 30-minute graph
HISTORY_POINTS = 180
PRESENCE_READ = 0.5               # s between reads of presence.json
# Overlay motion, integrated (position += speed * dt) so a changing intensity never makes the noise jump.
# name: (speed at stillness, speed at turbulence), in noise units per second
PHASES = {'torrent': (0.15, 2.6), 'rain': (0.25, 0.9), 'leaves': (0.04, 0.12), 'glint': (0.2, 1.2), 'drift': (0.01, 0.06)}

# name: (engine constant, label, default, min, max, unit)
RULES = {
    'cycle_seconds': ('CYCLE_SECONDS', 'Length of the year (automatic)', 240.0, 60, 1800, 's'),
    'warm_seconds': ('WARM_SECONDS', 'Winter to summer as people arrive (dynamic)', 60.0, 10, 600, 's'),
    'cool_seconds': ('COOL_SECONDS', 'Summer to winter as they leave (dynamic)', 180.0, 10, 1200, 's'),
    'warmer': ('WARMER', 'Busier than usual from', 1.3, 1.05, 3.0, '× usual'),
    'cooler': ('COOLER', 'Quieter than usual below', 0.7, 0.1, 0.95, '× usual'),
    'torrent_at': ('TORRENT_AT', 'Full torrent at', 2.0, 1.2, 6.0, '× usual'),
    'now_window': ('NOW_WINDOW', 'Presence now = median of the last', 30.0, 5, 300, 's'),
    'usual_window': ('USUAL_WINDOW', 'Usual presence = median of the last', 600.0, 60, 3600, 's'),
    'empty_seconds': ('EMPTY_SECONDS', 'An empty room turns to winter after', 60.0, 5, 600, 's'),
}

# Season looks, used by the expressions (palette ramps are tables in the .toe; these are tints and glints).
TINT = {0: (0.80, 0.90, 1.00), 1: (0.70, 1.00, 0.80), 2: (1.00, 0.90, 0.62), 3: (1.00, 0.72, 0.45)}
GLINT = {0: (0.85, 0.95, 1.00), 1: (0.80, 1.00, 0.90), 2: (1.00, 0.85, 0.45), 3: (1.00, 0.60, 0.25)}


def _holder():
    h = sys.modules.setdefault('seasons_live', types.ModuleType('seasons_live'))
    if not hasattr(h, 'st'):
        h.st = None
    return h


def engine():
    return op('/project1/seasons/seasons_engine').module          # noqa: F821 (TD global)


def load_rules():
    vals = {k: v[2] for k, v in RULES.items()}
    try:
        saved = json.loads(RULES_FILE.read_text(encoding='utf-8'))
        for k, v in saved.items():
            if k in RULES:
                lo, hi = RULES[k][3], RULES[k][4]
                vals[k] = max(lo, min(hi, float(v)))
    except (OSError, ValueError):
        pass
    return vals


def apply_rules(eng, vals):
    for k, v in vals.items():
        setattr(eng, RULES[k][0], float(v))


def _presence_fresh():
    try:
        return time.time() - json.loads(PRESENCE_FILE.read_text(encoding='utf-8'))['t'] < 30
    except (OSError, ValueError, KeyError, TypeError):
        return False


def state():
    """The live state, created on first use (and again if the engine file was edited: the year carries on)."""
    h = _holder()
    eng = engine()
    st = h.st
    if st is None or st['engine'] is not eng:
        rules = load_rules()
        apply_rules(eng, rules)
        now = time.monotonic()
        old = st['year'] if st else None
        counter = _presence_fresh()
        year = eng.Year(now, phase=old.phase if old else eng.WINTER,
                        mode=old.mode if old else ('dynamic' if counter else 'automatic'))
        if old:
            year.intensity, year.manual_season, year.manual_intensity = old.intensity, old.manual_season, old.manual_intensity
        st = h.st = {'engine': eng, 'year': year, 'rules': rules, 'history': [], 'next_hist': 0.0,
                     'phases': dict(st['phases']) if st else {k: 0.0 for k in PHASES}, 'last': None,
                     'next_read': 0.0, 'presence_mtime': None, 'auto_default': not old and not counter,
                     'counter': counter}
    return st


def _read_presence(st, now):
    st['next_read'] = now + PRESENCE_READ
    try:
        m = PRESENCE_FILE.stat().st_mtime
        if m == st['presence_mtime']:
            return
        st['presence_mtime'] = m
        d = json.loads(PRESENCE_FILE.read_text(encoding='utf-8'))
        if time.time() - float(d['t']) < 30:
            st['year'].presence.add(now, max(0, int(d['count'])))
    except (OSError, ValueError, KeyError, TypeError):
        pass


def frame(comp):
    st = state()
    now = time.monotonic()
    if now >= st['next_read']:
        _read_presence(st, now)
    y = st['year']
    st['counter'] = y.presence.available(now)
    if st['auto_default'] and st['counter'] and y.mode == 'automatic':
        y.set_mode('dynamic')            # the counter came up after boot: hand the year to it
        st['auto_default'] = False
    y.step(now)
    dt = 0.0 if st['last'] is None else max(0.0, min(0.25, now - st['last']))
    st['last'] = now
    for k, (lo, hi) in PHASES.items():
        st['phases'][k] = (st['phases'][k] + (lo + (hi - lo) * y.intensity) * dt) % 10000.0
    if now >= st['next_hist']:
        st['next_hist'] = now + HISTORY_EVERY
        p = y.presence.stats(now)
        st['history'].append({'t': round(time.time()), 'phase': round(y.phase, 3), 'intensity': round(y.intensity, 3),
                              'now': p['now'], 'usual': p['usual'], 'relative': p['relative']})
        del st['history'][:-HISTORY_POINTS]


# ---- read by the look's expressions ---------------------------------------------------------------------

def w(k):
    return engine().weights(state()['year'].phase)[k]


def intensity():
    return state()['year'].intensity


def ph(name):
    """Integrated overlay position (see PHASES)."""
    return state()['phases'][name]


def _looks():
    """A show may carry its own tints in a Text DAT `season_looks` (JSON {"tint": [[r,g,b] x4], "glint": [...]});
    without it (the river's year) the tables above apply."""
    d = op('/project1/seasons/season_looks')                                  # noqa: F821 (TD global)
    if d is None:
        return TINT, GLINT
    try:
        j = json.loads(d.text)
        return ({k: tuple(v) for k, v in enumerate(j['tint'])}, {k: tuple(v) for k, v in enumerate(j['glint'])})
    except (ValueError, KeyError, TypeError):
        return TINT, GLINT


def tint(ch, table='tint'):
    t = _looks()[0 if table == 'tint' else 1]
    ws = engine().weights(state()['year'].phase)
    return sum(ws[k] * t[k][ch] for k in range(4))


# ---- control page -----------------------------------------------------------------------------------------

def _allowed(addr):
    """Only this machine, private networks and the tailnet: the page is never meant for the internet."""
    a = str(addr).strip('[]').replace('::ffff:', '')
    if a in ('::1', 'localhost') or a.startswith(('127.', '10.', '192.168.', 'fd7a:115c:a1e0')):
        return True
    if a.startswith('172.'):
        try:
            return 16 <= int(a.split('.')[1]) <= 31
        except (IndexError, ValueError):
            return False
    if a.startswith('100.'):                         # Tailscale: 100.64.0.0/10
        try:
            return 64 <= int(a.split('.')[1]) <= 127
        except (IndexError, ValueError):
            return False
    return False


def _reply(resp, status, payload, ctype='application/json'):
    resp['statusCode'] = status
    resp['statusReason'] = 'OK' if status == 200 else 'Error'
    resp['content-type'] = ctype
    resp['cache-control'] = 'no-store'
    resp['data'] = payload if isinstance(payload, str) else json.dumps(payload)
    return resp


def _body(req):
    data = req.get('data', b'')
    if isinstance(data, (bytes, bytearray)):
        data = data.decode('utf-8', 'replace')
    try:
        return json.loads(data or '{}')
    except ValueError:
        return {}


def snapshot():
    st = state()
    y = st['year']
    y.step(time.monotonic())          # a change from the page shows straight away, not a frame later
    s = y.state()
    s['counter_available'] = st['counter']
    s['rules'] = {k: {'value': st['rules'][k], 'label': v[1], 'default': v[2], 'min': v[3], 'max': v[4], 'unit': v[5]}
                  for k, v in RULES.items()}
    s['history'] = st['history']
    s['file'] = project.name                         # noqa: F821
    return s


def http(req, resp):
    if not _allowed(req.get('clientAddress', '')):
        return _reply(resp, 403, {'ok': False, 'error': 'local network and tailnet only'})
    path = urllib.parse.urlparse(req.get('uri', '')).path.rstrip('/') or '/'
    method = req.get('method', 'GET').upper()
    st = state()
    y = st['year']
    try:
        if method == 'GET' and path in ('/', '/index.html'):
            return _reply(resp, 200, CONTROL_HTML.read_text(encoding='utf-8'), 'text/html; charset=utf-8')
        if method == 'GET' and path == '/state':
            return _reply(resp, 200, snapshot())
        if method == 'POST' and path == '/mode':
            mode = _body(req).get('mode')
            if mode == 'dynamic' and not st['counter']:
                return _reply(resp, 409, {'ok': False, 'error': 'the people counter is not running'})
            y.set_mode(mode)
            st['auto_default'] = False
            return _reply(resp, 200, snapshot())
        if method == 'POST' and path == '/target':
            b = _body(req)
            y.set_manual(season=b.get('season'), intensity=b.get('intensity'))
            y.set_mode('manual')
            st['auto_default'] = False
            return _reply(resp, 200, snapshot())
        if method == 'POST' and path in ('/rules', '/rules/reset'):
            vals = {k: v[2] for k, v in RULES.items()} if path.endswith('reset') else dict(st['rules'])
            if not path.endswith('reset'):
                for k, v in _body(req).items():
                    if k in RULES:
                        lo, hi = RULES[k][3], RULES[k][4]
                        vals[k] = max(lo, min(hi, float(v)))
            if vals['cooler'] >= vals['warmer']:
                return _reply(resp, 400, {'ok': False, 'error': '"quieter" must be below "busier"'})
            apply_rules(st['engine'], vals)
            st['rules'] = vals
            RULES_FILE.write_text(json.dumps(vals, indent=2), encoding='utf-8')
            return _reply(resp, 200, snapshot())
        return _reply(resp, 404, {'ok': False, 'error': 'unknown ' + method + ' ' + path})
    except (ValueError, TypeError) as e:
        return _reply(resp, 400, {'ok': False, 'error': str(e)})
