# Live camera feed into TouchDesigner without a Video Stream In TOP.
# Synced into /project1/river_local/river_cam_mod (edit here, not in TD).
#
# Why not Video Stream In: creating one through the bridge froze TD's main thread on bitcube (19 Oct).
# Instead TD starts a small *relay process* (this same file run with Python: `python river_cam.py relay
# river sub <td-pid>`). The relay runs ffmpeg, which decodes the camera's RTSP stream to raw RGBA frames
# already flipped for TD (row 0 = bottom), and writes each newest frame into named shared memory. A Script
# TOP copies it from there in onCook: one memcpy, no network, no Python thread competing with TD (a reader
# thread inside TD only managed ~2 fps of the camera's 10). Never hand copyNumpyArray a non-contiguous view
# (e.g. np.flipud): that froze TD on 19 Oct. The relay exits when TD does. ffmpeg is restarted with a back-off if the stream drops,
# and killed if it stalls (no frame for 20 s) (the river cam is on Starlink, relayed over Tailscale).
#
# The camera URL (with its password) is read from the untracked secrets.local.json when the stream
# starts and is never written into a parameter, so it can't end up in the public .toe.

import json
import os
import pathlib
import shutil
import struct
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
STALL_SECONDS = 20.0              # relay kills ffmpeg if no frame arrives for this long (a hung connection)
RTSP_TIMEOUT_US = 10_000_000      # ffmpeg's socket timeout: a dead link ends ffmpeg instead of hanging it
HEADER = struct.Struct('<Qd')     # shared memory: frame counter, unix time of that frame, then RGBA bytes
# Day/night: at night the Reolink switches to infrared and sends greyscale. Colourfulness (mean of
# max(rgb) - min(rgb), 0..1) is ~0.07 by day on the river and ~0 in IR. Hysteresis so dusk doesn't flicker.
NIGHT_BELOW, DAY_ABOVE = 0.02, 0.035
DAYNIGHT_SECONDS = 20.0           # how long the look takes to cross between its day and night settings
DAYNIGHT_EVERY = 30               # measure every Nth new frame (~3 s at 10 fps)
DAYNIGHT_PARS = {'Camgain': 'Camgainnight', 'Camcontrast': 'Camcontrastnight', 'Sparkle': 'Sparklenight'}
PYTHONS = [str(REPO / '.venv' / 'Scripts' / 'python.exe'), r'C:\Program Files\Python313\python.exe']


# ---- pure helpers (tested in tools/tests/test_river_cam.py) ----------------------------------

def stream_url(secrets, cam, stream='sub'):
    """RTSP URL for a camera from the secrets dict, switched to the main or sub stream."""
    url = secrets['cameras'][cam]
    for name in ('main', 'sub'):
        url = url.replace(f'Preview_01_{name}', f'Preview_01_{stream}')
    return url


def ffmpeg_args(ffmpeg, url, width=WIDTH, height=HEIGHT):
    return [ffmpeg, '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp',
            '-timeout', str(RTSP_TIMEOUT_US), '-i', url,
            '-an', '-vf', f'scale={width}:{height},vflip', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']


def shm_name(cam, stream):
    return f'river_cam_{cam}_{stream}'


def shm_size(width=WIDTH, height=HEIGHT):
    return HEADER.size + width * height * 4


def pack_header(count, when):
    return HEADER.pack(count, when)


def unpack_header(buf):
    return HEADER.unpack_from(buf, 0)


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
        """Newest frame as a contiguous, writable uint8 (h, w, 4) copy, in the order ffmpeg sent it
        (ffmpeg already flipped it for TD). Contiguous matters: a flipped view froze TD."""
        if self.latest is None:
            return None
        return np.array(np.frombuffer(self.latest, np.uint8).reshape(self.shape), copy=True, order='C')


def colourfulness(frame):
    """0 for greyscale (IR night video), ~0.05-0.1 for daylight water and rocks. frame: uint8 (h, w, >=3)."""
    s = frame[::8, ::8, :3].astype(np.int16)
    return float((s.max(axis=2) - s.min(axis=2)).mean()) / 255


class DayNight:
    """Night or day from colourfulness, with hysteresis; `nightness` glides 0 (day) .. 1 (night)."""

    def __init__(self, night=False):
        self.night = night
        self.nightness = 1.0 if night else 0.0

    def measure(self, c):
        if self.night and c > DAY_ABOVE:
            self.night = False
        elif not self.night and c < NIGHT_BELOW:
            self.night = True
        return self.night

    def step(self, dt):
        target = 1.0 if self.night else 0.0
        d = dt / DAYNIGHT_SECONDS
        self.nightness = min(target, self.nightness + d) if target > self.nightness else max(target, self.nightness - d)
        return self.nightness


# ---- live stream (TD side + relay process) ------------------------------------------------------------------

def _find_ffmpeg():
    for c in FFMPEG_CANDIDATES:
        if os.path.isfile(c):
            return c
        if shutil.which(c):
            return shutil.which(c)
    raise FileNotFoundError('ffmpeg not found')


def _parent_alive(pid):
    """Windows: is process `pid` still running? (relay watchdog)"""
    import ctypes
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = ctypes.c_ulong()
    ok = k.GetExitCodeProcess(h, ctypes.byref(code))
    k.CloseHandle(h)
    return bool(ok) and code.value == 259          # STILL_ACTIVE


def relay(cam, stream, parent_pid):
    """Relay process main: ffmpeg -> newest frame into shared memory, until the parent (TD) exits."""
    import mmap
    mm = mmap.mmap(-1, shm_size(), tagname=shm_name(cam, stream))
    state = {'proc': None, 'stop': False, 'started': time.monotonic(), 'last': time.monotonic()}

    def watchdog():
        # Two jobs: exit with TD, and end a stalled ffmpeg (the river cam went offline overnight on
        # 19 Oct; ffmpeg sat on the dead TCP connection for 11 h and the field stayed on the rain).
        while _parent_alive(parent_pid):
            time.sleep(2)
            p = state['proc']
            if p and p.poll() is None and time.monotonic() - max(state['last'], state['started']) > STALL_SECONDS:
                p.kill()
        state['stop'] = True
        if state['proc']:
            state['proc'].kill()

    threading.Thread(target=watchdog, daemon=True).start()
    count = 0
    size = WIDTH * HEIGHT * 4
    while not state['stop']:
        try:
            secrets = json.loads((REPO / 'secrets.local.json').read_text(encoding='utf-8-sig'))
            args = ffmpeg_args(_find_ffmpeg(), stream_url(secrets, cam, stream))
            proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    stdin=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            state['proc'], state['started'] = proc, time.monotonic()
            while not state['stop']:
                frame = proc.stdout.read(size)
                if len(frame) < size:
                    break
                count += 1
                state['last'] = time.monotonic()
                mm[HEADER.size:HEADER.size + size] = frame
                mm[:HEADER.size] = pack_header(count, time.time())   # header last: readers see whole frames
            proc.kill()
            proc.wait()
        except Exception:
            pass
        state['proc'] = None
        for _ in range(int(RESTART_SECONDS * 10)):
            if state['stop']:
                break
            time.sleep(0.1)


def _holder():
    h = sys.modules.setdefault('river_cam_live', types.ModuleType('river_cam_live'))
    if not hasattr(h, 'streams'):
        h.streams = {}
    return h


def start(cam='river', stream='sub'):
    """TD side: make sure the relay process runs and the shared memory is mapped. Safe to call every frame."""
    import mmap
    h = _holder()
    st = h.streams.setdefault((cam, stream), {'relay': None, 'mm': None, 'seen': 0, 'error': None,
                                             'next_try': 0.0, 'dn': None, 'dn_n': 0, 'dn_t': None,
                                             'colour': None})
    if st['mm'] is None:
        st['mm'] = mmap.mmap(-1, shm_size(), tagname=shm_name(cam, stream))
    relay_proc = st['relay']
    if (relay_proc is None or relay_proc.poll() is not None) and time.monotonic() >= st['next_try']:
        st['next_try'] = time.monotonic() + RESTART_SECONDS
        try:
            py = next(p for p in PYTHONS if os.path.isfile(p))
            script = str(REPO / 'td' / 'cameras' / 'river_cam.py')
            st['relay'] = subprocess.Popen([py, script, 'relay', cam, stream, str(os.getpid())],
                                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL,
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            st['error'] = None
        except Exception as e:
            st['error'] = repr(e)
    return st


def stop_all():
    for st in _holder().streams.values():
        if st['relay'] and st['relay'].poll() is None:
            st['relay'].kill()


def _header(cam, stream):
    st = _holder().streams.get((cam, stream))
    if not st or st['mm'] is None:
        return None, 0, 0.0
    count, when = unpack_header(st['mm'])
    return st, count, when


def nightness(cam='river', stream='sub'):
    """0 = day look, 1 = night (IR) look; glides over DAYNIGHT_SECONDS (stepped in cook())."""
    st = _holder().streams.get((cam, stream))
    return 0.0 if not st or st['dn'] is None else st['dn'].nightness


def daynight(comp, name, cam='river', stream='sub'):
    """Look parameter `name` (Camgain, Camcontrast, Sparkle) between its day value (the parameter itself)
    and its night twin (Camgainnight ...), when Auto Day/Night is on."""
    day = getattr(comp.par, name).eval()
    try:
        if not comp.par.Autodaynight.eval():
            return day
        night = getattr(comp.par, DAYNIGHT_PARS[name]).eval()
        return day + (night - day) * nightness(cam, stream)
    except Exception:                                  # noqa: BLE001 - never break the look
        return day


def fresh(cam='river', stream='sub'):
    _, count, when = _header(cam, stream)
    return bool(count) and time.time() - when < STALE_SECONDS


def status(cam='river', stream='sub'):
    st, count, when = _header(cam, stream)
    if not st:
        return {'running': False}
    return {'relay': bool(st['relay'] and st['relay'].poll() is None), 'frames': count,
            'last_frame_age_s': round(time.time() - when, 1) if count else None,
            'fresh': fresh(cam, stream), 'error': st['error'],
            'colourfulness': None if st['colour'] is None else round(st['colour'], 4),
            'night': None if st['dn'] is None else st['dn'].night,
            'nightness': None if st['dn'] is None else round(st['dn'].nightness, 3)}


def cook(scriptOp, cam='river', stream='sub'):
    """Script TOP onCook: copy the newest frame from shared memory (black until one arrives)."""
    st = start(cam, stream)
    now = time.monotonic()
    if st['dn'] is not None and st['dn_t'] is not None:
        st['dn'].step(min(1.0, now - st['dn_t']))
    st['dn_t'] = now
    count, _ = unpack_header(st['mm'])
    if count and (count != st['seen'] or scriptOp.width != WIDTH):
        st['seen'] = count
        frame = np.frombuffer(st['mm'], np.uint8, count=WIDTH * HEIGHT * 4, offset=HEADER.size)
        img = np.array(frame.reshape(HEIGHT, WIDTH, 4), copy=True, order='C')
        scriptOp.copyNumpyArray(img)
        st['dn_n'] += 1
        if st['dn'] is None or st['dn_n'] % DAYNIGHT_EVERY == 0:
            st['colour'] = colourfulness(img)
            if st['dn'] is None:
                st['dn'] = DayNight(night=st['colour'] < NIGHT_BELOW)   # start in the right state, no fade
            st['dn'].measure(st['colour'])
    elif not count:
        scriptOp.copyNumpyArray(np.zeros((HEIGHT, WIDTH, 4), np.uint8))


if __name__ == '__main__' and len(sys.argv) >= 5 and sys.argv[1] == 'relay':
    relay(sys.argv[2], sys.argv[3], int(sys.argv[4]))
