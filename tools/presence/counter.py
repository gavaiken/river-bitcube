"""The people counter (S10, docs/presence-plan.md): how many people are near the piece, every half second.

    .venv\\Scripts\\python tools\\presence\\counter.py            # supervisor: runs the counter, restarts it if it dies
    .venv\\Scripts\\python tools\\presence\\counter.py run        # the counter itself (in the foreground)
    .venv\\Scripts\\python tools\\presence\\counter.py status     # processes, the last count, the log's tail
    .venv\\Scripts\\python tools\\presence\\counter.py run --debug   # also writes River\\presence-debug.jpg (tuning)

Writes C:\\Users\\user\\River\\presence.json every 0.5 s: {"t": unix time, "count": people near the piece} -- the whole
contract with the seasons file (td/seasons/seasons_td.py turns dynamic mode on while it's fresh). Also
River\\presence-status.json (detector, frame rate, raw and near counts) for whoever is tuning.

Input: the gallery cam's sub stream (640x360) at 2 frames a second, through ffmpeg; the camera login comes from
secrets.local.json and is never logged. Detector: YOLOv8 nano (ONNX, CPU, 2 threads; River\\models\\yolov8n.onnx,
see MODEL_URL) -- people only, one frame at a time, no tracking. "Near the piece" = a box at least MIN_HEIGHT of the
frame tall (tune on site: the cam looks up at the piece, so nearby people show as tall boxes at the bottom).
If the detector can't load, a motion measure (the share of the frame that changed) stands in as a rough count.
Nobody is identified or recorded: frames stay in memory; only the count leaves the process (the --debug frame is
for tuning, local, overwritten, and off unless asked for). Logs to River\\logs\\presence.log.
Started at login by Start-Presence.cmd (from SSH a child dies with the session: use a one-off interactive
scheduled task, as for Start-Modal.cmd).
"""
import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
RIVER = REPO.parent
OUT = RIVER / 'presence.json'
STATUS = RIVER / 'presence-status.json'
DEBUG = RIVER / 'presence-debug.jpg'
LOG = RIVER / 'logs' / 'presence.log'
MODEL = RIVER / 'models' / 'yolov8n.onnx'
MODEL_URL = 'https://huggingface.co/Kalray/yolov8/resolve/main/yolov8n.onnx'   # sha256 65158DAD...AFD8B5, 12.8 MB
MODEL_SHA256 = '65158DAD735BE799C2466FA15E260C09558080BD530B42A8D0C3D1B419AFD8B5'
FFMPEG = r'C:\Program Files\WinGet\Links\ffmpeg.exe'
W, H = 640, 360            # frames from the sub stream
FPS = 2.0                  # detector frames a second
WRITE_EVERY = 0.5          # s between presence.json writes
CONF = 0.35                # person score
IOU = 0.5                  # non-maximum suppression
MIN_HEIGHT = 0.25          # "near the piece": box at least this share of the frame tall
LOCK_PORT = 8772           # held by the running supervisor, so a second one exits at once
RESTART_SECONDS = 10


# ---- detection (pure) ----------------------------------------------------------------------------------------------
def letterbox(rgb, size=640):
    """uint8 (h, w, 3) -> float32 (1, 3, size, size) in 0..1, grey padded, plus (scale, pad_x, pad_y)."""
    from PIL import Image
    h, w = rgb.shape[:2]
    s = min(size / w, size / h)
    nw, nh = int(round(w * s)), int(round(h * s))
    im = np.asarray(Image.fromarray(rgb).resize((nw, nh), Image.BILINEAR))
    canvas = np.full((size, size, 3), 114, np.uint8)
    px, py = (size - nw) // 2, (size - nh) // 2
    canvas[py:py + nh, px:px + nw] = im
    return (canvas.astype(np.float32) / 255).transpose(2, 0, 1)[None], (s, px, py)


def people(pred, geom, frame_w, frame_h, conf=CONF, iou=IOU):
    """YOLOv8 output (1, 84, N) -> person boxes [(x1, y1, x2, y2, score)] in frame pixels, after NMS."""
    p = pred[0]
    score = p[4]                                   # class 0 = person
    keep = score >= conf
    if not keep.any():
        return []
    cx, cy, bw, bh = (p[i][keep] for i in range(4))
    s, px, py = geom
    x1 = np.clip((cx - bw / 2 - px) / s, 0, frame_w)
    y1 = np.clip((cy - bh / 2 - py) / s, 0, frame_h)
    x2 = np.clip((cx + bw / 2 - px) / s, 0, frame_w)
    y2 = np.clip((cy + bh / 2 - py) / s, 0, frame_h)
    boxes = np.stack([x1, y1, x2, y2, score[keep]], 1)
    return [tuple(map(float, b)) for b in nms(boxes, iou)]


def nms(boxes, iou=IOU):
    """boxes: (n, 5) x1 y1 x2 y2 score -> the kept rows, best first."""
    order = np.argsort(-boxes[:, 4])
    kept = []
    while len(order):
        i = order[0]
        kept.append(boxes[i])
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0]); yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2]); yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        area = lambda b: (b[..., 2] - b[..., 0]) * (b[..., 3] - b[..., 1])
        union = area(boxes[i]) + area(boxes[rest]) - inter
        order = rest[inter / np.maximum(union, 1e-6) < iou]
    return kept


def near(boxes, frame_h, min_height=MIN_HEIGHT):
    """How many people are near the piece: boxes at least min_height of the frame tall."""
    return sum(1 for b in boxes if (b[3] - b[1]) >= min_height * frame_h)


def motion_count(prev, cur, thresh=25, per_person=0.04):
    """Fallback: share of the frame that changed, as a rough head count (one person ~ 4% of the frame)."""
    if prev is None:
        return 0
    changed = (np.abs(cur.astype(np.int16) - prev.astype(np.int16)).max(axis=2) > thresh).mean()
    return int(round(changed / per_person))


def write_json(path, obj):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj), encoding='utf-8')
    os.replace(tmp, path)


# ---- the counter ---------------------------------------------------------------------------------------------------
def camera_url():
    url = json.loads((REPO / 'secrets.local.json').read_text())['cameras']['gallery']
    return url.replace('Preview_01_main', 'Preview_01_sub')


def log(msg):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')


class Frames:
    """Newest RGB frame from one ffmpeg reading the sub stream at FPS (reconnects when the stream drops)."""

    def __init__(self, url):
        self.url, self.frame, self.n, self.alive, self.last = url, None, 0, True, 0.0
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        ff = FFMPEG if Path(FFMPEG).is_file() else 'ffmpeg'
        while self.alive:
            p = subprocess.Popen([ff, '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-timeout', '10000000',
                                  '-i', self.url, '-vf', f'fps={FPS},scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            size = W * H * 3
            while True:
                buf = p.stdout.read(size)
                if len(buf) < size:
                    break
                self.frame, self.n = np.frombuffer(buf, np.uint8).reshape(H, W, 3), self.n + 1
                self.last = time.time()
            p.kill()
            log('camera stream ended; reconnecting in 5 s')
            time.sleep(5)


def run(debug=False, min_height=MIN_HEIGHT):
    detector = None
    try:
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads, opts.inter_op_num_threads = 2, 1    # leave the CPU to TouchDesigner
        detector = ort.InferenceSession(str(MODEL), opts, providers=['CPUExecutionProvider'])
        log(f'detector: {MODEL.name}, near = boxes >= {min_height:.2f} of the frame tall')
    except Exception as e:                                             # missing model or onnxruntime
        log(f'detector unavailable ({type(e).__name__}: {e}); counting motion instead')
    frames = Frames(camera_url())
    count, raw, prev, last_n, last_write, last_debug, t_det = 0, 0, None, 0, 0.0, 0.0, []
    while True:
        now = time.time()
        if frames.n != last_n and frames.frame is not None:
            last_n, img = frames.n, frames.frame
            t0 = time.perf_counter()
            if detector:
                x, geom = letterbox(img)
                boxes = people(detector.run(None, {detector.get_inputs()[0].name: x})[0], geom, W, H)
                raw, count = len(boxes), near(boxes, H, min_height)
            else:
                boxes, count = [], motion_count(prev, img)
                raw, prev = count, img
            t_det = (t_det + [time.perf_counter() - t0])[-20:]
            if debug and now - last_debug > 10:
                save_debug(img, boxes, min_height)
                last_debug = now
        if now - last_write >= WRITE_EVERY:
            fresh = now - frames.last < 30
            write_json(OUT, {'t': round(now, 2), 'count': int(count)})
            write_json(STATUS, {'t': round(now, 2), 'count': int(count), 'raw': int(raw), 'frames': frames.n,
                                'detector': 'yolov8n' if detector else 'motion', 'min_height': min_height,
                                'ms': round(1000 * sum(t_det) / len(t_det)) if t_det else None, 'stream': fresh})
            last_write = now
        time.sleep(0.05)


def save_debug(img, boxes, min_height):
    from PIL import Image, ImageDraw
    im = Image.fromarray(img)
    dr = ImageDraw.Draw(im)
    for x1, y1, x2, y2, s in boxes:
        ok = (y2 - y1) >= min_height * H
        dr.rectangle((x1, y1, x2, y2), outline=(0, 255, 0) if ok else (255, 160, 0), width=2)
        dr.text((x1 + 2, y1 + 2), f'{s:.2f}', fill=(255, 255, 0))
    dr.line((4, H - 4, 4, H - 4 - min_height * H), fill=(255, 0, 255), width=3)      # the "near" height
    im.save(DEBUG, quality=80)


# ---- supervisor ----------------------------------------------------------------------------------------------------
def supervise():
    lock = socket.socket()
    try:
        lock.bind(('127.0.0.1', LOCK_PORT))
    except OSError:
        print('the people counter is already running')
        return
    log('supervisor started')
    while True:
        p = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'run'] + [a for a in sys.argv[1:] if a.startswith('--')],
                             stdout=subprocess.DEVNULL, stderr=open(LOG, 'a'))
        code = p.wait()
        log(f'counter exited ({code}); restarting in {RESTART_SECONDS} s')
        time.sleep(RESTART_SECONDS)


def status():
    out = subprocess.run(['powershell', '-NoProfile', '-Command',
                          "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | "
                          "? CommandLine -like '*presence*counter*' | % { $_.ProcessId.ToString() + ' ' + $_.CommandLine }"],
                         capture_output=True, text=True).stdout
    print(out.strip() or 'the people counter is not running')
    for f in (STATUS, OUT):
        print(f.name + ':', f.read_text() if f.exists() else 'missing',
              f'({time.time() - f.stat().st_mtime:.0f} s old)' if f.exists() else '')
    if LOG.exists():
        print('--- log'), [print('  ' + line) for line in LOG.read_text(encoding='utf-8', errors='replace').splitlines()[-5:]]


if __name__ == '__main__':
    args = sys.argv[1:]
    mh = next((float(a.split('=', 1)[1]) for a in args if a.startswith('--min-height=')), MIN_HEIGHT)
    if args[:1] == ['run']:
        run(debug='--debug' in args, min_height=mh)
    elif args[:1] == ['status']:
        status()
    else:
        supervise()
