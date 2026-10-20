"""bitcube's link to Dave's Modal agent (river-agent): cameras up, scene down. Outbound HTTPS only.

    python tools/modal/modal_link.py            # supervisor: runs the three children below, restarts any that exit
    python tools/modal/modal_link.py status     # what's running, newest log lines

Children (each logs to C:/Users/user/River/logs/modal-<name>.log):
  sync      river-agent's gallery/sync.py: mirrors status/state/pad/journal_recent/reflex.json every 3 s into
            C:/Users/user/River/gallery_state and serves them (and Dave's web page) on 127.0.0.1:8770.
            TouchDesigner reads state.json and reflex.json from that folder (td/modal/modal_scene.py).
  gallery   river-agent's capture/capture.py --video: 10 s clips (640 px, 10 fps, with sound) from the gallery
            cam's sub-stream, back to back, POSTed to /ingest/gallery/video.
  river     the same for the river cam: /ingest/river/video.

Started at login by Start-Modal.cmd (Startup folder). Dave's scripts are used unmodified from
C:/Users/user/River/river-agent; this file only adds the camera URLs and the token, read from the untracked
secrets.local.json (cameras.<name>, modal.ingest_token, modal.site). Neither is put on a command line: the
child reads them itself, so they never show in a process list or a log.
"""
import json
import os
import pathlib
import socket
import subprocess
import sys
import threading
import time

REPO = pathlib.Path(__file__).resolve().parents[2]
RIVER = REPO.parent
AGENT = RIVER / 'river-agent'
LOGS = RIVER / 'logs'
STATE_DIR = RIVER / 'gallery_state'
PORT = 8770                              # 8765 is RopeLights
FFMPEG_DIRS = [r'C:\Program Files\WinGet\Links']
CHILDREN = ('sync', 'gallery', 'river')
RESTART_SECONDS = 15
LOCK_PORT = 8771                         # held by the running supervisor, so a second one exits at once


def secrets():
    return json.loads((REPO / 'secrets.local.json').read_text(encoding='utf-8-sig'))


def sub_stream(url):
    """The cameras' 640x360 sub-stream: the clips are 640 px anyway, and it is a fraction of the bandwidth."""
    return url.replace('Preview_01_main', 'Preview_01_sub')


def child_env():
    env = dict(os.environ)
    env['PATH'] = os.pathsep.join(FFMPEG_DIRS + [env.get('PATH', '')])
    env['PYTHONUNBUFFERED'] = '1'
    env['MODAL_LINK_PARENT'] = str(os.getpid())
    return env


# ---- children (run in their own process) ----------------------------------------------------------------

def _parent_alive(pid):
    import ctypes
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = ctypes.c_ulong()
    ok = k.GetExitCodeProcess(h, ctypes.byref(code))
    k.CloseHandle(h)
    return bool(ok) and code.value == 259          # STILL_ACTIVE


def die_with_parent():
    """A child exits when the supervisor does, so a restarted supervisor never doubles the uploads."""
    pid = int(os.environ.get('MODAL_LINK_PARENT', '0'))
    if not pid:
        return

    def watch():
        while _parent_alive(pid):
            time.sleep(2)
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


def run_sync():
    s = secrets()['modal']
    sys.path.insert(0, str(AGENT))
    sys.argv = ['sync.py', '--site', s['site'], '--dir', str(STATE_DIR), '--port', str(PORT)]
    import runpy
    runpy.run_path(str(AGENT / 'gallery' / 'sync.py'), run_name='__main__')


def run_capture(cam):
    s = secrets()
    sys.path.insert(0, str(AGENT / 'capture'))
    import capture

    plain = capture.split_device

    def split_device(spec):                      # RTSP over TCP: UDP is unreliable through Tailscale and NAT
        args = plain(spec)
        return ['-rtsp_transport', 'tcp'] + args if spec.startswith('rtsp://') else args

    capture.split_device = split_device
    os.environ['RIVER_SITE_URL'] = s['modal']['site']
    os.environ['INGEST_TOKEN'] = s['modal']['ingest_token']
    sys.argv = ['capture.py', '--location', cam, '--video', sub_stream(s['cameras'][cam])]
    sys.exit(capture.main())


# ---- supervisor ------------------------------------------------------------------------------------------

def spawn(name):
    LOGS.mkdir(parents=True, exist_ok=True)
    log = open(LOGS / f'modal-{name}.log', 'a', encoding='utf-8', buffering=1)
    log.write(f'\n==== {time.strftime("%Y-%m-%d %H:%M:%S")} start {name}\n')
    py = sys.executable.replace('pythonw.exe', 'python.exe')
    return subprocess.Popen([py, __file__, name], stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                            env=child_env(), cwd=str(AGENT),
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def supervise():
    lock = socket.socket()
    try:
        lock.bind(('127.0.0.1', LOCK_PORT))
    except OSError:
        print('modal_link is already running')
        return
    procs, next_try = {}, {}
    while True:
        for name in CHILDREN:
            p = procs.get(name)
            if p is None or p.poll() is not None:
                if time.monotonic() >= next_try.get(name, 0):
                    procs[name] = spawn(name)
                    next_try[name] = time.monotonic() + RESTART_SECONDS
        time.sleep(2)


def status():
    out = subprocess.run(['powershell', '-NoProfile', '-Command',
                          "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | "
                          "? CommandLine -like '*modal_link*' | % { $_.ProcessId.ToString() + ' ' + $_.CommandLine }"],
                         capture_output=True, text=True).stdout
    print(out.strip() or 'modal_link not running')
    for name in CHILDREN:
        f = LOGS / f'modal-{name}.log'
        lines = f.read_text(encoding='utf-8', errors='replace').splitlines()[-3:] if f.exists() else ['(no log)']
        print(f'--- {name}'), [print('  ' + line) for line in lines]
    for name in ('state.json', 'reflex.json'):
        f = STATE_DIR / name
        print(f'{name}: ' + (f'{time.time() - f.stat().st_mtime:.0f} s old' if f.exists() else 'missing'))


if __name__ == '__main__':
    arg = sys.argv[1] if len(sys.argv) > 1 else 'supervise'
    if arg == 'sync':
        die_with_parent()
        run_sync()
    elif arg in ('gallery', 'river'):
        die_with_parent()
        run_capture(arg)
    elif arg == 'status':
        status()
    else:
        supervise()
