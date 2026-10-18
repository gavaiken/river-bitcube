"""Nudge a Reolink camera: pan/tilt for a short time, then stop.

    python tools/cameras/ptz.py gallery Down 0.4      # op: Left Right Up Down; seconds of movement
    python tools/cameras/ptz.py gallery Stop

Camera host and password come from the untracked secrets.local.json (cameras.<name> RTSP URL).
Based on Will's tools/cameras/test_cam_move.py (Reolink HTTPS JSON API, self-signed cert).
"""
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


def call(host, command, params, token=None):
    url = f'https://{host}/cgi-bin/api.cgi' + (f'?token={token}' if token else '?cmd=Login')
    body = json.dumps([{'cmd': command, 'action': 0, 'param': params}]).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, context=CTX, timeout=5) as r:
        res = json.load(r)[0]
    if res.get('code') != 0:
        raise RuntimeError(f'{command} rejected: {res}')
    return res


def main(name, op, seconds=0.0):
    host, user, password = camera(name)
    token = call(host, 'Login', {'User': {'userName': user, 'password': password}})['value']['Token']['name']
    try:
        if op != 'Stop':
            call(host, 'PtzCtrl', {'channel': 0, 'op': op, 'speed': 1}, token)
            time.sleep(seconds)
    finally:
        for _ in range(3):
            try:
                call(host, 'PtzCtrl', {'channel': 0, 'op': 'Stop'}, token)
                break
            except Exception:
                time.sleep(0.2)
        else:
            print('WARNING: Stop not confirmed; stop the camera from the Reolink app')
        try:
            call(host, 'Logout', {}, token)
        except Exception:
            pass
    print(f'{name}: {op} {seconds}s done')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 0.0)
