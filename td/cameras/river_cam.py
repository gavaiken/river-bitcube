# Live camera feed into TouchDesigner without a Video Stream In TOP.
# Synced into /project1/river_local/river_cam_mod (edit here, not in TD).
#
# Why not Video Stream In: creating one through the bridge froze TD's main thread on bitcube (19 Oct).
# Instead an ffmpeg child process decodes the camera's RTSP stream to raw RGBA frames on stdout; a
# background thread keeps only the newest frame, and a Script TOP copies it in onCook. Nothing in TD's
# main thread ever waits on the network. ffmpeg is restarted with a back-off if the stream drops
# (the river cam is on Starlink, relayed over Tailscale).
#
# The camera URL (with its password) is read from the untracked secrets.local.json when the stream
# starts and is never written into a parameter, so it can't end up in the public .toe.

import json
import os
import pathlib
import shutil
import subprocess
import sys
import threading
import time
import types

import numpy as np

REPO = pathlib.Path(r'C:\Users\user\River\river-bitcube')
FFMPEG_CANDIDATES = [r'C:\Program Files\WinGet\Links\ffmpeg.exe', 'ffmpeg']
WIDTH, HEIGHT = 640, 360          # the Reolink sub-stream (Preview_01_sub)
STALE_SECONDS = 10.0              # no new frame for this long -> fresh() is False (panels fall back to rain)
RESTART_SECONDS = 5.0             # wait before restarting ffmpeg after it exits


# ---- pure helpers (tested in tools/tests/test_river_cam.py) ----------------------------------

def stream_url(secrets, cam, stream='sub'):
    """RTSP URL for a camera from the secrets dict, switched to the main or sub stream."""
    url = secrets['cameras'][cam]
    for name in ('main', 'sub'):
        url = url.replace(f'Preview_01_{name}', f'Preview_01_{stream}')
    return url


def ffmpeg_args(ffmpeg, url, width=WIDTH, height=HEIGHT):
    return [ffmpeg, '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url,
            '-an', '-vf', f'scale={width}:{height}', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']


class FrameAssembler:
    """Turns a byte stream into whole frames; keeps only the newest one."""

    def __init__(self, width, height, channels=4):
        self.size = width * height * channels
        self.shape = (height, width, channels)
        self.buf = bytearray()
        self.latest = None
        self.count = 0

    def feed(self, chunk):
        self.buf += chunk
        n = len(self.buf) // self.size
        if n:
            start = (n - 1) * self.size
            self.latest = bytes(self.buf[start:start + self.size])
            del self.buf[:n * self.size]
            self.count += n
        return n

    def array(self):
        """Newest frame as uint8 (h, w, 4), flipped so row 0 is the bottom (TD's convention)."""
        if self.latest is None:
            return None
        return np.flipud(np.frombuffer(self.latest, np.uint8).reshape(self.shape))


# ---- live stream (TD side) --------------------------------------------------------------------

def _holder():
    h = sys.modules.setdefault('river_cam_live', types.ModuleType('river_cam_live'))
    if not hasattr(h, 'streams'):
        h.streams = {}
    return h


def _find_ffmpeg():
    for c in FFMPEG_CANDIDATES:
        if os.path.isfile(c) or shutil.which(c):
            return c if os.path.isfile(c) else shutil.which(c)
    raise FileNotFoundError('ffmpeg not found')


def _run(state):
    while not state['stop']:
        try:
            secrets = json.loads((REPO / 'secrets.local.json').read_text(encoding='utf-8-sig'))
            args = ffmpeg_args(_find_ffmpeg(), stream_url(secrets, state['cam'], state['stream']))
            flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    stdin=subprocess.DEVNULL, creationflags=flags)
            state['proc'] = proc
            state['error'] = None
            asm = state['asm']
            while not state['stop']:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                if asm.feed(chunk):
                    state['last_frame'] = time.monotonic()
            proc.kill()
            state['error'] = state['error'] or f'ffmpeg exited ({proc.wait()})'
        except Exception as e:           # bad secrets, ffmpeg missing, ...: record and retry later
            state['error'] = repr(e)
        state['proc'] = None
        for _ in range(int(RESTART_SECONDS * 10)):
            if state['stop']:
                return
            time.sleep(0.1)


def start(cam='river', stream='sub'):
    """Start (or keep) the background reader for a camera. Safe to call every frame."""
    h = _holder()
    key = (cam, stream)
    st = h.streams.get(key)
    if st and st['thread'].is_alive():
        return st
    st = {'cam': cam, 'stream': stream, 'stop': False, 'proc': None, 'error': None,
          'last_frame': None, 'asm': FrameAssembler(WIDTH, HEIGHT)}
    st['thread'] = threading.Thread(target=_run, args=(st,), name=f'river_cam_{cam}', daemon=True)
    h.streams[key] = st
    st['thread'].start()
    return st


def stop_all():
    for st in _holder().streams.values():
        st['stop'] = True
        if st['proc']:
            st['proc'].kill()


def fresh(cam='river', stream='sub'):
    st = _holder().streams.get((cam, stream))
    return bool(st and st['last_frame'] and time.monotonic() - st['last_frame'] < STALE_SECONDS)


def status(cam='river', stream='sub'):
    st = _holder().streams.get((cam, stream))
    if not st:
        return {'running': False}
    age = None if st['last_frame'] is None else round(time.monotonic() - st['last_frame'], 1)
    return {'running': st['thread'].is_alive(), 'ffmpeg': bool(st['proc']), 'frames': st['asm'].count,
            'last_frame_age_s': age, 'fresh': fresh(cam, stream), 'error': st['error']}


def cook(scriptOp, cam='river', stream='sub'):
    """Script TOP onCook: start the reader if needed and copy the newest frame (black until one arrives)."""
    st = start(cam, stream)
    a = st['asm'].array()
    if a is None:
        a = np.zeros((HEIGHT, WIDTH, 4), np.uint8)
    scriptOp.copyNumpyArray(a)
