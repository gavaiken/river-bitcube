"""Preview the remembered river offline (no TouchDesigner): run one loop of td/remembered/show.py at 60 fps on a
remembered day and save pictures of what the ropes and the screens would do.

    python tools/remembered/preview.py [--date 2017-01-08] [--surge-at 13.5|none] [--river clip.mp4] [--out DIR]
        [--zones tools/pixelmap/zones-<date>.json] [--lingerer 7,8] [--opening]

Writes to --out (default ~/claude/local/remembered-preview):
  loop.png         the whole loop: time across (0.5 s a column), four ropes (0, 5, 10, 15) down, each LED 0 at the top;
                   a bar above says the phase (calm grey, building blue, surge cyan, settling violet), white ticks = 10 s
  surge.png        the surge close up (draw-back to settling, 0.05 s a column), all 20 ropes, every 4th LED
  panels-<phase>.png  the four screens upright side by side at a moment of each phase, plus the rope frame
  loop.gif         ropes + screens at 10 fps from the draw-back through the settling
  watts.txt        rope watts and column brightness over the loop (the safety checks' numbers)
The river for the screens comes from --river (default mission/media/river-cascade.mp4 through ffmpeg; random motion if
ffmpeg or the file is missing). Dave's choice is simulated by a state.json with the day's real profile from
data/remembered (so the loop plays as if Dave chose it).
"""
import argparse
import gzip
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'td'))
from remembered import clock      # noqa: E402
from remembered import show as show_mod   # noqa: E402
from remembered import zones as zones_mod  # noqa: E402

PHASE_COL = {'calm': (90, 90, 90), 'building': (40, 80, 200), 'surge': (40, 220, 230), 'settling': (150, 90, 200)}


def river_frames(path, w=320, h=180, fps=10):
    ff = shutil.which('ffmpeg')
    if not ff or not Path(path).is_file():
        return None
    out = subprocess.run([ff, '-v', 'error', '-i', str(path), '-vf', f'fps={fps},scale={w}:{h}', '-f', 'rawvideo',
                          '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    n = len(out) // (w * h * 3)
    return np.frombuffer(out[:n * w * h * 3], np.uint8).reshape(n, h, w, 3) if n else None


def to8(a):
    return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--date', default='2017-01-08')
    ap.add_argument('--surge-at', default='13.5')
    ap.add_argument('--river', default=str(REPO / 'mission' / 'media' / 'river-cascade.mp4'))
    ap.add_argument('--out', default=str(Path.home() / 'claude' / 'local' / 'remembered-preview'))
    ap.add_argument('--zones', default=None)
    ap.add_argument('--lingerer', default='')
    ap.add_argument('--opening', action='store_true')
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    data = REPO / 'data' / 'remembered'
    with gzip.open(data / 'profiles.json.gz', 'rt', encoding='utf-8') as f:
        prof = json.load(f)[a.date]
    lib = clock.load_library(data)
    row = lib['days'].get(a.date) or {}
    stats = clock._stats_from_row(row, 'storm')
    river = Path(tempfile.mkdtemp())
    (river / 'gallery_state').mkdir()
    (river / 'remembered').mkdir()
    t0 = 1_800_000_000.0
    state = {'memory': {'date': a.date, 'reason': f'preview of {a.date}', 'chosen_by': 'preview',
                        'chosen_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t0)), 'stats': stats,
                        'profile': prof},
             'surge_at': None if a.surge_at == 'none' else float(a.surge_at)}
    (river / 'gallery_state' / 'state.json').write_text(json.dumps(state))
    import os
    os.utime(river / 'gallery_state' / 'state.json', (t0, t0))
    if a.opening:
        (river / 'remembered' / 'control.json').write_text(json.dumps({'opening_night': True}))
    if a.lingerer:
        ropes = [int(x) for x in a.lingerer.split(',')]
        (river / 'presence.json').write_text(json.dumps({'t': t0, 'count': 1, 'people': [],
                                                          'lingerers': [{'x': 0.5, 'y': 0.9, 'still_s': 12, 'ropes': ropes}]}))
    frames = river_frames(a.river)
    s = show_mod.Show(zones_mod.load(a.zones), river_dir=river, data_dir=data, seed=1)
    fps = 60
    n = int(clock.LOOP_S * fps)
    loop_cols, surge_cols, phases, means, watts, gif = [], [], [], [], [], []
    snaps = {}
    rng = np.random.default_rng(0)
    times = None
    for i in range(n):
        now = t0 + i / fps
        if a.lingerer:
            (river / 'presence.json').write_text(json.dumps({'t': now, 'count': 1, 'people': [], 'lingerers': [
                {'x': 0.5, 'y': 0.9, 'still_s': 12, 'ropes': [int(x) for x in a.lingerer.split(',')]}]}))
        if i % 6 == 0:
            img = frames[(i // 6) % len(frames)] if frames is not None else (rng.random((180, 320, 3)) * 255).astype(np.uint8)
            s.feed_river(img, 'clip', now)
        r, p = s.tick(now, 1 / fps, fps)
        snap = s.loop.snapshot(now)
        times = snap['times']
        ph = snap['phase']
        phases.append(ph)
        means.append(float(r.mean()))
        watts.append(s.ropes.watts)
        t = snap['t_s']
        if i % 30 == 0:
            loop_cols.append(r[[0, 5, 10, 15]].copy())
        if times and times['drawback'] - 2 <= t < min(times['calm'], times['surge'] + 60) and i % 3 == 0:
            surge_cols.append(r[:, ::4].copy())
        if times and times['drawback'] <= t < times['calm'] and i % 6 == 0:
            gif.append((r.copy(), p.copy()))
        key = ph
        want = {'calm': 40.0, 'building': None, 'surge': None, 'settling': None}
        if times:
            want.update({'building': (times['build'] + times['drawback']) / 2, 'surge': times['surge'] + 15.0,
                         'settling': times['settle'] + 8.0, 'front': times['surge'] + 2.0})
        for name, at in want.items():
            if at is not None and name not in snaps and t >= at:
                snaps[name] = (r.copy(), p.copy(), round(t, 1))
    # loop.png: a phase bar, then four ropes (each 400 LEDs tall) over time
    cols = np.stack(loop_cols, 1)                           # 4 ropes x T x 400 x 3
    bar = np.zeros((12, cols.shape[1], 3), np.uint8)
    for j in range(cols.shape[1]):
        bar[:, j] = PHASE_COL[phases[min(len(phases) - 1, j * 30)]]
        if j % 20 == 0:
            bar[:4, j] = 255
    parts = [bar]
    for k in range(4):
        parts.append(np.transpose(to8(cols[k]), (1, 0, 2)))
        parts.append(np.full((4, cols.shape[1], 3), 40, np.uint8))
    im = Image.fromarray(np.concatenate(parts, 0)).resize((cols.shape[1] * 2, sum(x.shape[0] for x in parts)), Image.NEAREST)
    im.save(out / 'loop.png')
    if surge_cols:
        sc = np.stack(surge_cols, 1)                        # 20 x T x 100 x 3
        parts = []
        for k in range(20):
            parts.append(np.transpose(to8(sc[k]), (1, 0, 2)))
            parts.append(np.full((2, sc.shape[1], 3), 50, np.uint8))
        Image.fromarray(np.concatenate(parts, 0)).save(out / 'surge.png')
    for name, (r, p, t) in snaps.items():
        rope = np.repeat(np.transpose(to8(r), (1, 0, 2)), 4, 1)     # 400 x 80
        rope = np.asarray(Image.fromarray(rope).resize((80, 256)))
        sheet = np.concatenate([rope, np.full((256, 6, 3), 60, np.uint8), to8(p)], 1)
        sheet = np.asarray(Image.fromarray(sheet).resize((sheet.shape[1] * 2, 512), Image.NEAREST))
        Image.fromarray(sheet).save(out / f'panels-{name}.png')
    if gif:
        ims = []
        for r, p in gif:
            rope = np.asarray(Image.fromarray(np.repeat(np.transpose(to8(r), (1, 0, 2)), 4, 1)).resize((80, 256)))
            ims.append(Image.fromarray(np.concatenate([rope, np.full((256, 6, 3), 60, np.uint8), to8(p)], 1)))
        ims[0].save(out / 'loop.gif', save_all=True, append_images=ims[1:], duration=100, loop=0)
    m = np.array(means)
    (out / 'watts.txt').write_text(
        f'date {a.date} surge {s.loop.plan}\ntimes {times}\nmax watts {max(watts):.0f}\n'
        f'max column-mean step per frame {np.abs(np.diff(m)).max():.4f} (limit {show_mod.ropes_mod.MAX_MEAN_RATE / fps:.4f})\n'
        f'snapshots {[(k, v[2]) for k, v in snaps.items()]}\nlast status {json.dumps(s.last_status)}\n')
    print('wrote', out, '| max watts', round(max(watts)), '| phases', {p: phases.count(p) for p in set(phases)})


if __name__ == '__main__':
    main()
