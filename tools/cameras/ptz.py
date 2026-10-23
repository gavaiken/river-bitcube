"""Nudge a Reolink camera: pan/tilt for a short time, then stop.

    python tools/cameras/ptz.py gallery Down 0.4      # op: Left Right Up Down; seconds of movement
    python tools/cameras/ptz.py gallery Stop

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


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 0.0)
