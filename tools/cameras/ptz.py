"""Nudge a Reolink camera: pan/tilt for a short time, then stop.

    python tools/cameras/ptz.py gallery Down 0.4      # op: Left Right Up Down; seconds of movement
    python tools/cameras/ptz.py gallery Stop
    python tools/cameras/ptz.py gallery save 1 map    # remember where it points now as preset 1 ("map")
    python tools/cameras/ptz.py gallery goto 1        # go back there (then wait ~5 s)
    python tools/cameras/ptz.py gallery presets       # list the saved ones
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


if __name__ == '__main__':
    if sys.argv[2] in ('save', 'goto', 'presets'):
        preset(sys.argv[1], sys.argv[2], *sys.argv[3:5])
    else:
        main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 0.0)
