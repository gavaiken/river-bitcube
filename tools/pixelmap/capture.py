"""Structured-light capture of the ropes (and the HUB75) with a Reolink camera.

    .venv\\Scripts\\python tools\\pixelmap\\capture.py ropes  [--cam gallery]   -> frames\\pixelmap-<stamp>\\
    .venv\\Scripts\\python tools\\pixelmap\\capture.py hub75  [--cam gallery]   -> frames\\hub75-<stamp>\\

ropes: drives /project1/ropes (via the Claude bridge) through black and every Gray-code bit plus its
inverse (graycode.patterns()), one averaged camera frame each. Never all ropes white at once (power):
plain Gray codes are unbalanced (rope bit 4's inverse lights all of box 1), so each pair is dimmed until
no box draws more than half its power at the cap (graycode.pattern_brightness; <= 300 W/box at 0.4). The whole sequence runs twice
(passes A and B); a pattern whose two frames disagree (someone walked through) is retaken until two
agree. Brightness cap 0.4. hub75: ropes black; panels black / test pattern, twice each.
Both modes put the ropes (Active, Source, Brightness, Graybit, Grayinvert) and panels Source back as
they were, also when the run fails.

One ffmpeg RTSP reader stays open for the whole run (a fresh connect per frame takes seconds).
Don't move the camera during a run; meta.json records the drift: how far the picture moved (px) between the first and last black frame.
A multi-view calibration (tools/mission/calibrate.py, tools/cameras/views.json) runs this once per camera view with
--session, --view and --ptz: meta.json records them, and decode.py / hub75.py put a session's views together.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pixelmap import decode, graycode  # noqa: E402


# A camera's login, up to the authority's LAST @ (as calibrate.py and mission/lib/scrub.mjs): ffmpeg takes the last @ too, so an
# @ or a quote in the password is all login.
_CREDS = re.compile(r'([a-z][a-z0-9+.-]*://)[^\s/?#"<>]*@', re.I)


def scrub(text):
    """'rtsp://admin:pw@10.0.0.1/x' -> 'rtsp://***@10.0.0.1/x'."""
    return _CREDS.sub(r'\1***@', str(text))


REPO = Path(__file__).resolve().parents[2]
BRIDGE = 'http://127.0.0.1:9980/exec'
W, H = 1440, 808          # half of the gallery cam's 2880x1616
AVG = 3                   # camera frames averaged per pattern
DISAGREE_DIFF, DISAGREE_FRAC = 40, 0.03


def td(code):
    req = urllib.request.Request(BRIDGE, code.encode(), {'Content-Type': 'text/plain; charset=utf-8'})
    with urllib.request.urlopen(req, timeout=20) as r:
        out = json.loads(r.read())
    if not out.get('ok', True) or out.get('error'):
        raise RuntimeError(out.get('error'))
    return out


class Reader:
    """Keeps the newest camera frame (RGB uint8, W x H) from one long-running ffmpeg."""

    def __init__(self, url, fps=10):
        ffmpeg = shutil.which('ffmpeg') or r'C:\Program Files\WinGet\Links\ffmpeg.exe'
        self.p = subprocess.Popen(
            [ffmpeg, '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url,
             '-vf', f'fps={fps},scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=W * H * 3 * 2)
        self.frames = []          # [(time, array)], newest last, short history
        self.lock = threading.Lock()
        threading.Thread(target=self._run, daemon=True).start()
        threading.Thread(target=self._errors, daemon=True).start()

    def _errors(self):
        """ffmpeg's messages, without the camera's login: it prints the whole RTSP address when the input fails, and
        calibrate.py keeps these lines in the progress file that mission control serves."""
        for raw in iter(self.p.stderr.readline, b''):
            line = scrub(raw.decode('utf-8', 'replace'))
            sys.stderr.write(line)
            sys.stderr.flush()

    def _run(self):
        n = W * H * 3
        while True:
            buf = self.p.stdout.read(n)
            if len(buf) < n:
                return
            a = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
            with self.lock:
                self.frames = self.frames[-20:] + [(time.monotonic(), a)]

    def after(self, t, n=AVG, timeout=15):
        """n frames that arrived after monotonic time t, averaged (float32)."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            with self.lock:
                got = [a for ts, a in self.frames if ts > t]
            if len(got) >= n:
                return np.mean(np.stack(got[:n]).astype(np.float32), axis=0)
            time.sleep(0.02)
        raise TimeoutError('no camera frames (is the camera reachable?)')

    def close(self):
        self.p.kill()


CAP = 0.4      # set from --brightness; each pattern is dimmed below it as needed (graycode.pattern_brightness)


def set_ropes(pat):
    """Show one pattern. Brightness is set in the same call, so no box ever exceeds half power."""
    b = graycode.pattern_brightness(pat, CAP)
    code = f"r=op('/project1/ropes'); r.par.Brightness={b:.4f}; r.par.Source='{pat['source']}'"
    if pat['source'] == 'gray':
        code += f"; r.par.Graybit={pat['bit']}; r.par.Grayinvert={pat['invert']}"
    td(code)


def snap(cam, settle, setter):
    setter()
    t = time.monotonic()
    time.sleep(settle)
    return cam.after(t + settle)


def measure_settle(cam):
    """Time from switching the ropes black -> Gray bit 0 (half the ropes lit; never all white, for
    power) until the camera image has 90% of the change."""
    set_ropes({'source': 'black'})
    time.sleep(2.5)
    dark = cam.after(time.monotonic(), n=2).max(axis=2)
    set_ropes(graycode.patterns()[1])
    t0 = time.monotonic()
    series = []
    while time.monotonic() - t0 < 6:
        f = cam.after(time.monotonic(), n=1).max(axis=2)
        series.append((time.monotonic() - t0, float(np.abs(f - dark).mean())))
    final = np.mean([d for t, d in series if t > 5])
    t90 = next(t for t, d in series if d >= 0.9 * final)
    print('settle series:', ' '.join(f'{t:.1f}:{d:.0f}' for t, d in series[::3]))
    return float(np.clip(t90 + 0.4, 0.8, 4.0))


OSD_BAND = 0.07          # fraction of the height at the top and bottom where the Reolink overlay text sits


def camera_shift(a, b):
    """How far the picture moved between two frames (px), by phase correlation of their edges: blind to the room's
    light changing (auto exposure, house lights) and mostly to people walking, which a plain frame difference is not
    (27 Oct: a still camera read as drift 37 because the room brightened)."""
    return float(np.hypot(*image_shift(a, b)))


def image_shift(a, b):
    """(dx, dy) px such that what is at p in frame a is at p + (dx, dy) in frame b (phase correlation of edges)."""
    def edges(f):
        g = f.max(axis=2) if f.ndim == 3 else f
        gy, gx = np.gradient(g.astype(np.float32))
        e = np.hypot(gx, gy)
        e = e - e.mean()
        # The camera's own overlay (the clock along the top, its name bottom right) never moves with the picture and
        # pulled every answer to 0 (27 Oct: a view 130 px off read as 0): leave those bands out.
        band = max(1, int(round(OSD_BAND * e.shape[0])))
        e[:band] = 0
        e[-band:] = 0
        return e
    fa, fb = np.fft.fft2(edges(a)), np.fft.fft2(edges(b))
    r = fa * np.conj(fb)
    r = np.fft.ifft2(r / (np.abs(r) + 1e-9)).real
    y, x = np.unravel_index(int(r.argmax()), r.shape)
    h, w = r.shape
    return -float(x if x < w / 2 else x - w), -float(y if y < h / 2 else y - h)


def disagreement(a, b, lit):
    d = np.abs(a.max(axis=2) - b.max(axis=2)) > DISAGREE_DIFF
    return float(d[lit].mean()) if lit.any() else 0.0


def save(arr, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8)).save(path)


def run_ropes(cam, out, settle):
    pats = graycode.patterns()
    passes = {}
    for name in ('A', 'B'):
        passes[name] = {}
        for i, p in enumerate(pats, 1):
            print(f"pass {name}: pattern {i} of {len(pats)} ({p['name']})", flush=True)    # mission control's progress card reads this
            passes[name][p['name']] = snap(cam, settle, lambda p=p: set_ropes(p))
        print(f'pass {name} done {datetime.now():%H:%M:%S}', flush=True)
    hi = decode.lit_level({k: v.max(axis=2) for k, v in passes['A'].items()})
    lit = hi - passes['A']['black'].max(axis=2) > 30
    report = {}
    for p in pats:
        cands = [passes['A'][p['name']], passes['B'][p['name']]]
        best = (disagreement(cands[0], cands[1], lit), 0, 1)
        while best[0] > DISAGREE_FRAC and len(cands) < 5:       # retake: keep the two that agree best
            cands.append(snap(cam, settle, lambda p=p: set_ropes(p)))
            best = min((disagreement(cands[i], cands[j], lit), i, j)
                       for i in range(len(cands)) for j in range(i + 1, len(cands)))
        report[p['name']] = {'disagree': round(best[0], 4), 'takes': len(cands)}
        if len(cands) > 2:
            print(f"  {p['name']}: retaken, {len(cands)} takes, best disagreement {best[0]:.3f}")
        save(cands[best[1]], out / 'A' / f"{p['name']}.png")
        save(cands[best[2]], out / 'B' / f"{p['name']}.png")
    end_black = snap(cam, settle, lambda: set_ropes({'source': 'black'}))
    save(end_black, out / 'black_end.png')
    drift = camera_shift(passes['A']['black'], end_black)
    scene = float(np.abs(passes['A']['black'] - end_black).max(axis=2).mean())
    return {'patterns': report, 'drift': round(drift, 2), 'scene_change': round(scene, 2), 'lit_camera_px': int(lit.sum())}


def run_hub75(cam, out, settle):
    for i in range(2):
        for src in ('black', 'test'):
            f = snap(cam, settle, lambda src=src: td(f"op('/project1/panels').par.Source='{src}'"))
            save(f, out / f'{src}{i}.png')
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['ropes', 'hub75'])
    ap.add_argument('--cam', default='gallery')
    ap.add_argument('--brightness', type=float, default=0.4)
    ap.add_argument('--settle', type=float, help='seconds after a pattern change (default: measured)')
    ap.add_argument('--session', help='multi-view calibration: the run these views belong to')
    ap.add_argument('--view', help='multi-view calibration: this view\'s name (views.json)')
    ap.add_argument('--view-index', type=int, default=0)
    ap.add_argument('--ptz', help='multi-view calibration: the camera position, "pan,tilt" in its units')
    args = ap.parse_args()

    url = json.loads((REPO / 'secrets.local.json').read_text(encoding='utf-8-sig'))['cameras'][args.cam]
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    out = REPO / 'frames' / f"{'pixelmap' if args.mode == 'ropes' else 'hub75'}-{stamp}"
    out.mkdir(parents=True)
    # Ropes and panels settings to put back afterwards, whatever happens (also printed, in case).
    keep = ('Active', 'Source', 'Brightness', 'Graybit', 'Grayinvert')
    r = td("import json; r=op('/project1/ropes'); print(json.dumps({**{k: getattr(r.par, k).eval() for k in "
           f"{keep!r}}}, 'Panels': op('/project1/panels').par.Source.eval(), "
           "'Maxbrightness': r.par.Maxbrightness.eval()}))")
    before = json.loads(r['stdout'])
    print('before:', before)
    restore = ("r=op('/project1/ropes'); " + '; '.join(f'r.par.{k}={before[k]!r}' for k in keep)
               + f"; op('/project1/panels').par.Source={before['Panels']!r}")
    global CAP
    CAP = min(args.brightness, before['Maxbrightness'])
    cam = Reader(url)
    try:
        cam.after(time.monotonic(), n=2, timeout=30)          # stream is up
        td("op('/project1/ropes').par.Active = True")
        settle = args.settle if args.settle is not None else measure_settle(cam)
        print(f'settle {settle:.2f} s, start {datetime.now():%H:%M:%S}')
        if args.mode == 'ropes':
            info = run_ropes(cam, out, settle)
        else:
            set_ropes({'source': 'black'})
            info = run_hub75(cam, out, settle)
    finally:
        cam.close()
        td(restore)
    meta = {'mode': args.mode, 'camera': args.cam, 'date': stamp[:8], 'stamp': stamp, 'frame_size': [W, H],
            'settle': settle, 'brightness_cap': CAP, 'before': before,
            'pattern_brightness': {p['name']: round(graycode.pattern_brightness(p, CAP), 4)
                                   for p in graycode.patterns()}} | info
    if args.session:
        meta |= {'session': args.session, 'view': args.view, 'view_index': args.view_index,
                 'ptz': [int(x) for x in args.ptz.split(',')] if args.ptz else None}
    (out / 'meta.json').write_text(json.dumps(meta, indent=1))
    print(json.dumps({k: v for k, v in meta.items() if k != 'patterns'}))
    print(f'OUT {out}')


if __name__ == '__main__':
    main()
