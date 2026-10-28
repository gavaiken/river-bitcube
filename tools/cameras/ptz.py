"""Nudge a Reolink camera: pan/tilt for a short time, then stop.

    python tools/cameras/ptz.py gallery Down 0.4      # op: Left Right Up Down; seconds of movement
    python tools/cameras/ptz.py gallery Stop
    python tools/cameras/ptz.py gallery save 1 map    # remember where it points now as preset 1 ("map")
    python tools/cameras/ptz.py gallery goto 1        # go back there (then wait ~5 s)
    python tools/cameras/ptz.py gallery presets       # list the saved ones
    python tools/cameras/ptz.py gallery pos           # where it points now (pan Ppos, tilt Tpos: the camera's own units)
    python tools/cameras/ptz.py gallery moveto 3241 max   # closed loop to a position: a number, "max"/"min" (the stop) or "-" (keep)
    python tools/cameras/ptz.py gallery view up       # to a calibration view in tools/cameras/views.json
    python tools/cameras/ptz.py gallery home          # back to the show position (views.json "home"), checked by reading it back
Calibration (27 Oct): the gallery cam's show position is aimed low (people and the base of the sculpture) and can't see
the tops of the ropes, so a calibration turns it through the views in views.json and always ends with `home`.
Presets on the gallery cam (23 Oct): 1 "map" = the framing the rope map and screen positions were captured
from (use it for any re-map); 2 "room" = tilted down to see the people near the piece (counter, Dave's agent).

Camera host and password come from the untracked secrets.local.json (cameras.<name> RTSP URL).
Based on Will's tools/cameras/test_cam_move.py (Reolink HTTPS JSON API, self-signed cert).
"""
import http.client
import json
import pathlib
import ssl
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CTX = ssl._create_unverified_context()


def camera(name):
    url = urllib.parse.urlparse(json.loads((ROOT / 'secrets.local.json').read_text())['cameras'][name])
    return url.hostname, urllib.parse.unquote(url.username or 'admin'), urllib.parse.unquote(url.password or '')


class Api:
    """One kept-alive HTTPS connection: a fresh TLS handshake per call delayed Stop by several hundred ms on
    Wi-Fi, so short nudges overshot (23 Oct). Falls back to a new connection if the camera closed it."""

    def __init__(self, host):
        self.host, self.conn = host, None

    def call(self, command, params, token=None):
        path = '/cgi-bin/api.cgi' + (f'?token={token}' if token else '?cmd=Login')
        body = json.dumps([{'cmd': command, 'action': 0, 'param': params}]).encode()
        for attempt in (0, 1):
            if self.conn is None:
                self.conn = http.client.HTTPSConnection(self.host, context=CTX, timeout=5)
            try:
                self.conn.request('POST', path, body, {'Content-Type': 'application/json'})
                res = json.loads(self.conn.getresponse().read())[0]
                break
            except (http.client.HTTPException, OSError):
                self.conn.close()
                self.conn = None
                if attempt:
                    raise
        if res.get('code') != 0:
            raise RuntimeError(f'{command} rejected: {res}')
        return res


VIEWS = ROOT / 'tools' / 'cameras' / 'views.json'


def views(name):
    """This camera's calibration views from views.json ({home, views, tol}), or None: then a calibration stays put."""
    try:
        return json.loads(VIEWS.read_text(encoding='utf-8')).get(name)
    except FileNotFoundError:
        return None


class Ptz:
    """A logged-in camera: read the position, nudge, go to presets and positions in a closed loop.
    Pan and tilt directions and speeds are learnt from the first nudges (which way Up moves Tpos isn't documented)."""

    def __init__(self, name, log=print):
        host, user, password = camera(name)
        self.name, self.api, self.log = name, Api(host), log
        self.token = self.api.call('Login', {'User': {'userName': user, 'password': password}})['value']['Token']['name']
        self.learnt = {}            # axis -> (sign of (op 'up' / 'right') on the position, units per second)

    def close(self):
        try:
            self.stop()
            self.api.call('Logout', {}, self.token)
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def pos(self):
        """(pan, tilt) in the camera's units (GetPtzCurPos Ppos, Tpos)."""
        v = self.api.call('GetPtzCurPos', {'PtzCurPos': {'channel': 0}}, self.token)['value']['PtzCurPos']
        return int(v['Ppos']), int(v['Tpos'])

    def stop(self):
        for _ in range(3):
            try:
                self.api.call('PtzCtrl', {'channel': 0, 'op': 'Stop'}, self.token)
                return
            except Exception:
                time.sleep(0.2)
        raise RuntimeError('Stop not confirmed; stop the camera from the Reolink app')

    def nudge(self, op, seconds, speed=1):
        try:
            self.api.call('PtzCtrl', {'channel': 0, 'op': op, 'speed': speed}, self.token)
            time.sleep(seconds)
        finally:
            self.stop()

    def settled(self, timeout=12.0):
        """The position once two readings 0.4 s apart agree (after a preset move or a nudge)."""
        end, last = time.monotonic() + timeout, None
        while True:
            time.sleep(0.4)
            p = self.pos()
            if p == last or time.monotonic() > end:
                return p
            last = p

    def goto_preset(self, pid):
        self.api.call('PtzCtrl', {'channel': 0, 'op': 'ToPos', 'id': int(pid), 'speed': 32}, self.token)
        time.sleep(1.0)
        return self.settled()

    def to_stop(self, axis, end):
        """Hold the move until the axis stops changing (a mechanical stop): end 'max' or 'min' of its units."""
        i = 0 if axis == 'pan' else 1
        sign, _ = self.learn(axis)
        up = (end == 'max') == (sign > 0)
        op = ('Right' if up else 'Left') if axis == 'pan' else ('Up' if up else 'Down')
        last = self.pos()[i]
        self.api.call('PtzCtrl', {'channel': 0, 'op': op, 'speed': 32}, self.token)
        try:
            t0 = time.monotonic()
            while time.monotonic() - t0 < 20:
                time.sleep(0.5)
                now = self.pos()[i]
                if now == last:
                    break
                last = now
        finally:
            self.stop()
        return self.settled()

    def learn(self, axis):
        """Which way 'Up'/'Right' moves this axis's units, and how fast at speed 1: from one short nudge."""
        if axis not in self.learnt:
            i = 0 if axis == 'pan' else 1
            op_pos, op_neg = ('Right', 'Left') if axis == 'pan' else ('Up', 'Down')
            secs = 0.15 if axis == 'pan' else 0.05
            for op in (op_pos, op_neg):              # at a stop one way, the other way moves
                a = self.settled(3)[i]
                self.nudge(op, secs)
                b = self.settled(3)[i]
                if b != a:
                    sign = (1 if b > a else -1) * (1 if op == op_pos else -1)
                    self.learnt[axis] = (sign, abs(b - a) / secs)
                    break
            else:
                raise RuntimeError(f'{self.name}: {axis} did not move (stuck, or the position is not reported)')
        return self.learnt[axis]

    def move_axis(self, axis, target, tol=3, tries=25):
        i = 0 if axis == 'pan' else 1
        op_pos, op_neg = ('Right', 'Left') if axis == 'pan' else ('Up', 'Down')
        for _ in range(tries):
            now = self.pos()[i]
            err = target - now
            if abs(err) <= tol:
                return now
            sign, rate = self.learn(axis)
            secs = min(max(abs(err) / rate * 0.8, 0.03), 2.0)
            self.nudge(op_pos if err * sign > 0 else op_neg, secs)
            moved = abs(self.settled(3)[i] - now)
            if moved:
                self.learnt[axis] = (sign, 0.5 * rate + 0.5 * moved / secs)
        return self.pos()[i]

    def move_to(self, pan=None, tilt=None, tol=3):
        """Closed loop to (pan, tilt); either may be None (keep), 'max' or 'min' (drive to the stop). Returns the
        position reached."""
        for axis, t in (('tilt', tilt), ('pan', pan)):
            if t in ('max', 'min'):
                self.to_stop(axis, t)
            elif t is not None:
                self.move_axis(axis, int(t), tol)
        return self.pos()

    def go_view(self, cfg, view):
        """Turn to a calibration view of views.json: {"name", "pan"?, "tilt"?} relative to nothing: absolute units,
        "max"/"min", or left out = the home position's."""
        home = cfg['home']
        return self.move_to(view.get('pan', home['pan']), view.get('tilt', home['tilt']), cfg.get('tol', 3))

    def go_home(self, cfg):
        """Back to the show position: its preset first (the camera's own positioning), then corrected in a closed loop to
        the recorded pan/tilt. Returns (ok, (pan, tilt))."""
        home, tol = cfg['home'], cfg.get('tol', 3)
        if home.get('preset') is not None:
            self.goto_preset(home['preset'])
        p = self.move_to(home['pan'], home['tilt'], tol)
        ok = abs(p[0] - home['pan']) <= tol and abs(p[1] - home['tilt']) <= tol
        return ok, p


def main(name, op, seconds=0.0):
    host, user, password = camera(name)
    api = Api(host)
    token = api.call('Login', {'User': {'userName': user, 'password': password}})['value']['Token']['name']
    try:
        if op != 'Stop':
            api.call('PtzCtrl', {'channel': 0, 'op': op, 'speed': 1}, token)
            time.sleep(seconds)
    finally:
        for _ in range(3):
            try:
                api.call('PtzCtrl', {'channel': 0, 'op': 'Stop'}, token)
                break
            except Exception:
                time.sleep(0.2)
        else:
            print('WARNING: Stop not confirmed; stop the camera from the Reolink app')
        try:
            api.call('Logout', {}, token)
        except Exception:
            pass
    print(f'{name}: {op} {seconds}s done')


def preset(name, action, pid=None, label=None):
    host, user, password = camera(name)
    api = Api(host)
    token = api.call('Login', {'User': {'userName': user, 'password': password}})['value']['Token']['name']
    try:
        if action == 'save':
            api.call('SetPtzPreset', {'PtzPreset': {'channel': 0, 'enable': 1, 'id': int(pid), 'name': label or f'preset{pid}'}}, token)
            print(f'{name}: saved preset {pid} ({label})')
        elif action == 'goto':
            api.call('PtzCtrl', {'channel': 0, 'op': 'ToPos', 'id': int(pid), 'speed': 32}, token)
            print(f'{name}: going to preset {pid}')
        else:
            res = api.call('GetPtzPreset', {'channel': 0}, token)
            for p in res['value']['PtzPreset']:
                if p.get('enable'):
                    print(p['id'], p.get('name', ''))
    finally:
        try:
            api.call('Logout', {}, token)
        except Exception:
            pass


def cli_moves(name, op, args):
    cfg = views(name)
    with Ptz(name) as cam:
        if op == 'pos':
            p = cam.pos()
        elif op == 'moveto':
            arg = lambda a: None if a == '-' else a if a in ('max', 'min') else int(a)
            p = cam.move_to(arg(args[0]), arg(args[1]), (cfg or {}).get('tol', 3))
        elif op == 'view':
            if not cfg:
                sys.exit(f'no views for {name} in {VIEWS}')
            p = cam.go_view(cfg, next(v for v in cfg['views'] if v['name'] == args[0]))
        else:
            if not cfg:
                sys.exit(f'no home for {name} in {VIEWS}')
            ok, p = cam.go_home(cfg)
            if not ok:
                print(f"WARNING: {name} is at {p}, not home {cfg['home']['pan']}, {cfg['home']['tilt']}")
        print(json.dumps({'camera': name, 'pan': p[0], 'tilt': p[1]}))


if __name__ == '__main__':
    if sys.argv[2] in ('pos', 'moveto', 'view', 'home'):
        cli_moves(sys.argv[1], sys.argv[2], sys.argv[3:])
    elif sys.argv[2] in ('save', 'goto', 'presets'):
        preset(sys.argv[1], sys.argv[2], *sys.argv[3:5])
    else:
        main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 0.0)
