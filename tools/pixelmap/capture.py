"""Structured-light capture of the ropes (and the HUB75) with a Reolink camera.

    .venv\\Scripts\\python tools\\pixelmap\\capture.py ropes  [--cam gallery]   -> frames\\pixelmap-<stamp>\\
    .venv\\Scripts\\python tools\\pixelmap\\capture.py hub75  [--cam gallery]   -> frames\\hub75-<stamp>\\

ropes: drives /project1/ropes (via the Claude bridge) through black and every Gray-code bit plus its
inverse (graycode.patterns()), one averaged camera frame each. Never all ropes white at once (power). The whole sequence runs twice
(passes A and B); a pattern whose two frames disagree (someone walked through) is retaken until two
agree. Brightness 0.4 (the cap). Ends with the ropes black and Brightness restored.
hub75: ropes black; panels black / test pattern, twice each. Panels Source restored at the end.

One ffmpeg RTSP reader stays open for the whole run (a fresh connect per frame takes seconds).
Don't move the camera during a run; meta.json records the drift between the first and last black frame.
"""
import argparse
import json
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
            stdout=subprocess.PIPE, bufsize=W * H * 3 * 2)
        self.frames = []          # [(time, array)], newest last, short history
        self.lock = threading.Lock()
        threading.Thread(target=self._run, daemon=True).start()

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


def set_ropes(pat):
    code = f"r=op('/project1/ropes'); r.par.Source='{pat['source']}'"
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
        for p in pats:
            passes[name][p['name']] = snap(cam, settle, lambda p=p: set_ropes(p))
        print(f'pass {name} done {datetime.now():%H:%M:%S}')
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
    drift = float(np.abs(passes['A']['black'] - end_black).max(axis=2).mean())
    return {'patterns': report, 'drift': round(drift, 2), 'lit_camera_px': int(lit.sum())}


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
    args = ap.parse_args()

    url = json.loads((REPO / 'secrets.local.json').read_text(encoding='utf-8-sig'))['cameras'][args.cam]
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    out = REPO / 'frames' / f"{'pixelmap' if args.mode == 'ropes' else 'hub75'}-{stamp}"
    out.mkdir(parents=True)
    r = td("r=op('/project1/ropes'); p=op('/project1/panels'); "
           "print(r.par.Brightness.eval(), r.par.Source.eval(), p.par.Source.eval())")
    old_bright, old_src, old_panels = r['stdout'].split()
    cam = Reader(url)
    try:
        cam.after(time.monotonic(), n=2, timeout=30)          # stream is up
        td(f"r=op('/project1/ropes'); r.par.Active=True; "
           f"r.par.Brightness=min({args.brightness}, r.par.Maxbrightness.eval())")
        settle = args.settle or measure_settle(cam)
        print(f'settle {settle:.2f} s, start {datetime.now():%H:%M:%S}')
        if args.mode == 'ropes':
            info = run_ropes(cam, out, settle)
        else:
            set_ropes({'source': 'black'})
            info = run_hub75(cam, out, settle)
    finally:
        cam.close()
        td(f"r=op('/project1/ropes'); r.par.Source='black'; r.par.Brightness={old_bright}; "
           f"op('/project1/panels').par.Source='{old_panels}'")
    meta = {'mode': args.mode, 'camera': args.cam, 'date': stamp[:8], 'stamp': stamp, 'frame_size': [W, H],
            'settle': settle, 'brightness': args.brightness, 'ropes_source_before': old_src} | info
    (out / 'meta.json').write_text(json.dumps(meta, indent=1))
    print(json.dumps({k: v for k, v in meta.items() if k != 'patterns'}))
    print(f'OUT {out}')


if __name__ == '__main__':
    main()
