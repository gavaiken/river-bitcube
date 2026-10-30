"""The people counter (S10, docs/presence-plan.md): how many people are near the piece, every half second.

    .venv\\Scripts\\python tools\\presence\\counter.py            # supervisor: runs the counter, restarts it if it dies
    .venv\\Scripts\\python tools\\presence\\counter.py run        # the counter itself (in the foreground)
    .venv\\Scripts\\python tools\\presence\\counter.py status     # processes, the last count, the log's tail
    .venv\\Scripts\\python tools\\presence\\counter.py run --debug   # also writes River\\presence-debug.jpg (tuning)

    .venv\\Scripts\\python tools\\presence\\counter.py run --zones=tools\\pixelmap\\zones-<date>.json   # rope feet to use

Writes C:\\Users\\user\\River\\presence.json every 0.5 s: {"t": unix time, "count": people near the piece, "people": [...],
"lingerers": [...]}. "t" and "count" are the whole contract with the seasons file (td/seasons/seasons_td.py turns
dynamic mode on while it's fresh); the rest is for the remembered river (docs/remembered-river.md §4):
  people:    [{x, y, h, still_s}]  everyone seen: foot point (box bottom centre) in the show view, 0..1 from the top
             left; h = box height / frame height; still_s = seconds their foot hasn't moved more than STILL_MOVE
  lingerers: [{x, y, still_s, ropes}]  people still >= LINGER_STILL_S and close (h >= LINGER_MIN_H), with the (up to)
             NEAREST_ROPES ropes whose feet (zones file) are within ROPE_RADIUS of them, nearest first (0-based)
People are followed between frames by a simple tracker (box overlap, else nearest foot point; see Tracker) only to time
stillness: nothing about anyone is kept once they've been out of sight TRACK_KEEP_S. Rope feet come from the zones file
(tools/pixelmap/zones-<date>.json): --zones=PATH, else the one a show pins in shows.json (calibration.zones), else the
newest; without one, lingerers' ropes are []. With the motion fallback, people and lingerers are []. Also
River\\presence-status.json (detector, frame rate, raw and near counts) for whoever is tuning, and
River\\presence-tracker.json (the tracker's people, so a restarted counter keeps their stillness clocks; see TRACKER_MAX_AGE_S).
River\\presence-seen.json ({"t"}: the last time anyone was in frame, near or not, every SEEN_EVERY s while they are; read
by tools/power/idle_shutdown.py, which shuts bitcube down after 3 hours without anyone).
A write that Windows refuses (a reader such as TouchDesigner or mission control has the file open: WinError 5, 28 Oct) is
retried a few times, then skipped; nothing in one frame's detect-or-write step can stop the counter.

Input: the gallery cam's sub stream (640x360) at 2 frames a second, through ffmpeg; the camera login comes from
secrets.local.json and is never logged. Detector: YOLOv8 nano (ONNX, CPU, 2 threads; River\\models\\yolov8n.onnx,
see MODEL_URL) -- people only. "Near the piece" = a box at least MIN_HEIGHT of the
frame tall (tune on site: the cam looks up at the piece, so nearby people show as tall boxes at the bottom).
If the detector can't load, a motion measure (the share of the frame that changed) stands in as a rough count.
Nobody is identified or recorded: frames stay in memory; only the count and anonymous positions leave the process (the --debug frame is
for tuning, local, overwritten, and off unless asked for). Logs to River\\logs\\presence.log.
Started at login by Start-Presence.cmd (from SSH a child dies with the session: use a one-off interactive
scheduled task, as for Start-Modal.cmd).
"""
import json
import math
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
TRACKER = RIVER / 'presence-tracker.json'
SEEN = RIVER / 'presence-seen.json'     # {"t": the last time anyone was in frame}: tools/power/idle_shutdown.py
SEEN_EVERY = 15.0          # s between presence-seen.json writes while people are in frame
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
LINGER_STILL_S = 5.0       # a lingerer has stood still at least this long ...
LINGER_MIN_H = 0.25        # ... and is close: box at least this share of the frame tall
STILL_MOVE = 0.04          # moving the foot point more than this (in frame heights) restarts the stillness clock
TRACK_IOU = 0.3            # a box overlapping a person's last box this much is that person ...
TRACK_DIST = 0.12          # ... else the one whose foot point is within this (frame heights)
TRACK_KEEP_S = 2.0         # a person unseen this long is forgotten (bridges a missed detection or two)
PEOPLE_KEEP_S = 1.0        # people unseen for longer than this are left out of "people"
ROPE_RADIUS = 0.35         # a lingerer's ropes: rope feet within this (frame heights) ...
NEAREST_ROPES = 2          # ... at most this many, nearest first
LOCK_PORT = 8772          # held by the running supervisor, so a second one exits at once
RESTART_SECONDS = 10
REPLACE_TRIES = 5          # a refused swap of a JSON file (a reader has it open) is tried this many times ...
REPLACE_WAIT = 0.06        # ... this long apart (~250 ms in all), then that write is skipped
LOG_EVERY_S = 60.0         # the same failure is logged at most this often (with how many times it happened)
TRACKER_MAX_AGE_S = RESTART_SECONDS + 15   # a restarted counter takes the tracker's people back if this fresh: the
                           # supervisor waits RESTART_SECONDS, then the model and the stream take a few more


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


# ---- people over time (pure) ---------------------------------------------------------------------------------------
def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


class Tracker:
    """Follows people between frames (2 a second) to time how long each has stood still.
    update(boxes, now): boxes [(x1, y1, x2, y2, score)] in frame pixels. A box joins the person whose last box it
    overlaps (IoU >= TRACK_IOU), else the one whose foot point is nearest (within TRACK_DIST frame heights); best
    matches first, each person and box at most once; other boxes are new people. A person unseen for TRACK_KEEP_S is
    forgotten. Their stillness clock restarts whenever their foot point is more than STILL_MOVE from where it was when
    the clock last started (so a few pixels of box jitter never reset it)."""

    def __init__(self, frame_w=W, frame_h=H):
        self.w, self.h = float(frame_w), float(frame_h)
        self.tracks, self.next_id = [], 1

    def _foot(self, b):
        return ((b[0] + b[2]) / 2 / self.w, b[3] / self.h)

    def _dist(self, a, b):
        return math.hypot((a[0] - b[0]) * self.w / self.h, a[1] - b[1])

    def update(self, boxes, now):
        pairs = []
        for ti, t in enumerate(self.tracks):
            for bi, b in enumerate(boxes):
                o = iou(t['box'], b)
                if o >= TRACK_IOU:
                    pairs.append((1 + o, ti, bi))
                else:
                    d = self._dist(t['foot'], self._foot(b))
                    if d <= TRACK_DIST:
                        pairs.append((1 - d / TRACK_DIST, ti, bi))
        used_t, used_b = set(), set()
        for _, ti, bi in sorted(pairs, reverse=True):
            if ti in used_t or bi in used_b:
                continue
            used_t.add(ti)
            used_b.add(bi)
            t, b = self.tracks[ti], boxes[bi]
            t['box'], t['foot'], t['seen'] = tuple(b[:4]), self._foot(b), now
            if self._dist(t['foot'], t['anchor']) > STILL_MOVE:
                t['anchor'], t['still_since'] = t['foot'], now
        for bi, b in enumerate(boxes):
            if bi not in used_b:
                f = self._foot(b)
                self.tracks.append({'id': self.next_id, 'box': tuple(b[:4]), 'foot': f, 'anchor': f,
                                    'still_since': now, 'seen': now})
                self.next_id += 1
        self.tracks = [t for t in self.tracks if now - t['seen'] <= TRACK_KEEP_S or now <= t.get('grace', 0)]
        return self.people(now)

    def state(self, now):
        """What a restarted counter needs to keep everyone's stillness clock (presence-tracker.json): their id, last
        box (so foot and h), the foot point their clock started at, and when it started (unix time)."""
        return {'t': round(now, 2), 'next_id': self.next_id,
                'people': [{'id': t['id'], 'box': [round(v, 1) for v in t['box']],
                            'foot': [round(v, 4) for v in t['foot']], 'anchor': [round(v, 4) for v in t['anchor']],
                            'still_since': round(t['still_since'], 2)} for t in self.tracks]}

    def restore(self, state, now, max_age=TRACKER_MAX_AGE_S):
        """Take back the people from state() if it was written at most max_age ago; returns how many. They stay out
        of people() until a detection picks them up (within TRACK_KEEP_S of now, their 'grace'), and their clocks go
        on from still_since; anyone who moved meanwhile restarts their clock as usual, anyone gone is forgotten."""
        try:
            if not state or not 0 <= now - float(state['t']) <= max_age:
                return 0
            tracks = [{'id': int(p['id']), 'box': tuple(map(float, p['box'])), 'foot': tuple(map(float, p['foot'])),
                       'anchor': tuple(map(float, p['anchor'])), 'still_since': float(p['still_since']),
                       'seen': float(state['t']), 'grace': now + TRACK_KEEP_S}
                      for p in state['people']]
        except (KeyError, TypeError, ValueError):
            return 0
        self.tracks = tracks
        self.next_id = max([int(state.get('next_id', 1))] + [t['id'] + 1 for t in tracks])
        return len(tracks)

    def people(self, now):
        """[{x, y, h, still_s}] of everyone seen in the last PEOPLE_KEEP_S (show view, 0..1 from the top left)."""
        out = []
        for t in sorted(self.tracks, key=lambda t: t['id']):
            if now - t['seen'] > PEOPLE_KEEP_S:
                continue
            x1, y1, x2, y2 = t['box']
            out.append({'x': round(t['foot'][0], 3), 'y': round(t['foot'][1], 3), 'h': round((y2 - y1) / self.h, 3),
                        'still_s': round(now - t['still_since'], 1)})
        return out


def nearest_ropes(x, y, feet, aspect=W / H, radius=ROPE_RADIUS, n=NEAREST_ROPES):
    """Ropes (0-based) whose feet [{rope, x, y}] are within radius (frame heights) of (x, y), nearest first."""
    d = sorted((math.hypot((f['x'] - x) * aspect, f['y'] - y), f['rope']) for f in feet)
    return [int(r) for dist, r in d if dist <= radius][:n]


def lingerers(people, feet, aspect=W / H, still_s=LINGER_STILL_S, min_h=LINGER_MIN_H):
    """People still at least still_s and close (h >= min_h), with their nearest ropes."""
    return [{'x': p['x'], 'y': p['y'], 'still_s': p['still_s'], 'ropes': nearest_ropes(p['x'], p['y'], feet, aspect)}
            for p in people if p['still_s'] >= still_s and p['h'] >= min_h]


def record(now, count, tracker, feet):
    """One presence.json: t and count as ever, plus people and lingerers ([] without a tracker: motion fallback)."""
    ppl = tracker.people(now) if tracker else []
    return {'t': round(now, 2), 'count': int(count), 'people': ppl,
            'lingerers': lingerers(ppl, feet, tracker.w / tracker.h if tracker else W / H)}


def zones_path(arg=None, repo=REPO):
    """The zones file whose rope feet lingerers are matched to: arg, else a show's pin (shows.json calibration.zones),
    else the newest tools/pixelmap/zones-<date>.json; None when there is none."""
    if arg:
        return Path(arg)
    try:
        for e in json.loads((repo / 'shows.json').read_text(encoding='utf-8')).get('shows', []):
            z = (e.get('calibration') or {}).get('zones')
            if z and (repo / z).is_file():
                return repo / z
    except (OSError, ValueError, AttributeError):
        pass
    found = sorted((repo / 'tools' / 'pixelmap').glob('zones-????-??-??.json'))
    return found[-1] if found else None


class Feet:
    """Rope feet from a zones file, re-read when the file changes (looked at every 10 s)."""

    def __init__(self, path):
        self.path, self.mtime, self.feet, self.next = path, None, [], 0.0

    def get(self, now):
        if self.path and now >= self.next:
            self.next = now + 10
            try:
                m = self.path.stat().st_mtime
                if m != self.mtime:
                    self.feet = json.loads(self.path.read_text(encoding='utf-8')).get('feet') or []
                    self.mtime = m
            except (OSError, ValueError, AttributeError):
                pass
        return self.feet


def read_tracker_state(path):
    """presence-tracker.json as written by the last counter, or None."""
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def motion_count(prev, cur, thresh=25, per_person=0.04):
    """Fallback: share of the frame that changed, as a rough head count (one person ~ 4% of the frame)."""
    if prev is None:
        return 0
    changed = (np.abs(cur.astype(np.int16) - prev.astype(np.int16)).max(axis=2) > thresh).mean()
    return int(round(changed / per_person))


_replace = os.replace       # tests swap this for one that fails


def write_json(path, obj, tries=REPLACE_TRIES, wait=REPLACE_WAIT):
    """Write obj to path whole (temp file, then swap it in). Windows refuses the swap while a reader has path open
    (PermissionError, WinError 5), so it's tried `tries` times `wait` apart; if it still fails the write is skipped
    (logged at most every LOG_EVERY_S) and False returned. Never raises: a skipped write is replaced 0.5 s later."""
    tmp = path.with_suffix('.tmp')
    err = None
    try:
        tmp.write_text(json.dumps(obj), encoding='utf-8')
        for k in range(tries):
            try:
                _replace(tmp, path)
                return True
            except OSError as e:
                err = e
                if k < tries - 1:
                    time.sleep(wait)
    except (OSError, TypeError, ValueError) as e:
        err = e
    log_every('write ' + path.name, f'{path.name} not written ({type(err).__name__}: {err}); skipped')
    return False


# ---- the counter ---------------------------------------------------------------------------------------------------
def camera_url():
    url = json.loads((REPO / 'secrets.local.json').read_text())['cameras']['gallery']
    return url.replace('Preview_01_main', 'Preview_01_sub')


def log(msg):
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')
    except OSError:
        pass                                                           # a log we can't write never stops the counter


_logged = {}                # key -> [last logged (time.time()), times since]


def log_every(key, msg, every=LOG_EVERY_S):
    """log(msg), but the same key at most once every `every` s, saying how many times it happened meanwhile."""
    now = time.time()
    last, n = _logged.get(key, [None, 0])
    n += 1
    if last is None or now - last >= every:
        log(msg + (f' ({n}x in the last {now - last:.0f} s)' if last is not None and n > 1 else ''))
        last, n = now, 0
    _logged[key] = [last, n]


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


def run(debug=False, min_height=MIN_HEIGHT, zones=None):
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
    tracker, feet = Tracker(W, H), Feet(zones_path(zones))
    log(f'rope feet for lingerers: {feet.path.name if feet.path else "none (no zones file): lingerers get no ropes"}')
    saved = read_tracker_state(TRACKER) if detector else None        # the last counter's people (taken back below)
    count, raw, prev, last_n, last_write, last_debug, t_det = 0, 0, None, 0, 0.0, 0.0, []
    last_seen_write = 0.0
    while True:
        now = time.time()
        if frames.n != last_n and frames.frame is not None:
            last_n, img = frames.n, frames.frame
            try:
                t0 = time.perf_counter()
                if detector:
                    if saved is not None:                              # at the first frame, not at start: the stream
                        n = tracker.restore(saved, now)                # can take seconds, and TRACK_KEEP_S is 2 s
                        log(f'took back {n} people from {TRACKER.name}' if n else
                            f'{TRACKER.name} too old or unreadable; starting with nobody')
                        saved = None
                    x, geom = letterbox(img)
                    boxes = people(detector.run(None, {detector.get_inputs()[0].name: x})[0], geom, W, H)
                    raw, count = len(boxes), near(boxes, H, min_height)
                    tracker.update(boxes, now)
                else:
                    boxes, count = [], motion_count(prev, img)
                    raw, prev = count, img
                t_det = (t_det + [time.perf_counter() - t0])[-20:]
                if debug and now - last_debug > 10:
                    last_debug = now
                    save_debug(img, boxes, min_height)
            except Exception as e:                                     # one bad frame never stops the counter
                log_every('frame', f'frame {last_n} failed ({type(e).__name__}: {e}); going on')
        if now - last_write >= WRITE_EVERY:
            last_write = now
            try:
                fresh = now - frames.last < 30
                write_json(OUT, record(now, count, tracker if detector else None, feet.get(now)))
                write_json(STATUS, {'t': round(now, 2), 'count': int(count), 'raw': int(raw), 'frames': frames.n,
                                    'detector': 'yolov8n' if detector else 'motion', 'min_height': min_height,
                                    'ms': round(1000 * sum(t_det) / len(t_det)) if t_det else None, 'stream': fresh})
                if detector:
                    write_json(TRACKER, tracker.state(now))
                if fresh and raw > 0 and now - last_seen_write >= SEEN_EVERY:   # anyone in frame, near or not
                    last_seen_write = now
                    write_json(SEEN, {'t': round(now, 2), 'raw': int(raw)})
            except Exception as e:                                     # nor does one bad write (write_json itself
                log_every('write', f'write failed ({type(e).__name__}: {e}); going on')   # never raises)
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
    zf = next((a.split('=', 1)[1] for a in args if a.startswith('--zones=')), None)
    if args[:1] == ['run']:
        run(debug='--debug' in args, min_height=mh, zones=zf)
    elif args[:1] == ['status']:
        status()
    else:
        supervise()
