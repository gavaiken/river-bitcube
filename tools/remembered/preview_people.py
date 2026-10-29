"""Preview the people effects on the ropes offline (no TouchDesigner, no show.py): step td/remembered/ropes.py with a
room.RoomState fed a scripted room and save PNG strips.

    python tools/remembered/preview_people.py [--zones tools/pixelmap/zones-2026-10-28.json] [--out DIR] [--fps 30]

The room: nobody for 75 s (the empty room ramps to a still pond), one lingerer at rope 7 for 30 s, six people for 60 s,
then everyone leaves for 30 s. The loop stays in calm (no surge), so only the room changes the ropes.
Writes to --out (default ~/claude/local/remembered-preview/people):
  <segment>.png   one frame a second side by side: each frame is the 20 ropes across (in their real order, 3 px each)
                  and 400 LEDs down (LED 0 at the top); a small bar above shows crowd (orange), empty (blue), linger (white)
  sparks.png      rope 7 and its neighbours during the lingerer, 20 frames a second side by side (sparks moving)
Brightness is shown with a 1/1.8 gamma so dim calm reads on a screen.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'td'))
from remembered import palette  # noqa: E402
from remembered import room as room_mod  # noqa: E402
from remembered import ropes as ropes_mod  # noqa: E402
from remembered import zones as zones_mod  # noqa: E402

SEGMENTS = [('empty', 0.0, 75.0), ('lingerer', 75.0, 105.0), ('crowd', 105.0, 165.0), ('leaving', 165.0, 195.0)]


def room_at(t):
    """(count, lingerers) the counter would report at t."""
    if t < 75:
        return 0, []
    if t < 105:
        return 1, [{'ropes': [7], 'still_s': t - 75 + 8, 'x': 0.43, 'y': 0.75}]
    if t < 165:
        return 6, []
    return 0, []


def to8(f):
    return (np.clip(f, 0, 1) ** (1 / 1.8) * 255 + 0.5).astype(np.uint8)


def frame_img(f, order, w=3):
    a = to8(f[order])                                    # ropes x leds x 3
    return np.repeat(a.transpose(1, 0, 2), w, axis=1)   # leds down, ropes across


def bar(rs, width, h=6):
    b = np.zeros((h * 3, width, 3), np.uint8)
    for k, (v, col) in enumerate(((rs.crowd, (255, 150, 30)), (rs.empty, (60, 120, 255)), (rs.linger_strength, (255, 255, 255)))):
        b[k * h:(k + 1) * h - 1, :int(round(v * width))] = col
    return b


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--zones', default=str(REPO / 'tools' / 'pixelmap' / 'zones-2026-10-28.json'))
    ap.add_argument('--out', default=str(Path.home() / 'claude' / 'local' / 'remembered-preview' / 'people'))
    ap.add_argument('--fps', type=int, default=30)
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    z = zones_mod.load(a.zones)
    r = ropes_mod.Ropes(z, seed=3)
    rs = room_mod.RoomState(z)
    order = np.argsort(r.rx, kind='stable')
    dt = 1.0 / a.fps
    pal = palette.palette('winter')
    strips = {name: [] for name, _, _ in SEGMENTS}
    sparks_cols = []
    effects = []
    n = int(SEGMENTS[-1][2] * a.fps)
    for i in range(n):
        t = i * dt
        count, ling = room_at(t)
        rs.update(dt, count, ling, True)
        f = r.step(dt, ropes_mod.default_ctx(t=t, pal=pal, **rs.ctx()))
        seg = next(name for name, t0, t1 in SEGMENTS if t0 <= t < t1)
        if i % a.fps == 0:
            img = frame_img(f, order)
            strips[seg].append(np.vstack([bar(rs, img.shape[1]), img]))
            strips[seg].append(np.zeros((img.shape[0] + 18, 2, 3), np.uint8) + 40)
            effects.append((round(t), dict(r.state['effects']), round(r.watts)))
        if 80.0 <= t < 86.0 and i % max(1, a.fps // 20) == 0:
            near = [int(k) for k in np.nonzero(rs.linger > 0.05)[0]] or [7]
            cols = to8(f[near]).transpose(1, 0, 2)      # leds x ropes x 3
            sparks_cols.append(np.repeat(cols, 2, axis=1))
            sparks_cols.append(np.zeros((400, 1, 3), np.uint8) + 40)
    paths = []
    for name, cols in strips.items():
        img = Image.fromarray(np.hstack(cols))
        p = out / f'{name}.png'
        img.resize((img.width, img.height * 2), Image.NEAREST).save(p)
        paths.append(p)
    if sparks_cols:
        img = Image.fromarray(np.hstack(sparks_cols))
        p = out / 'sparks.png'
        img.resize((img.width * 2, img.height * 2), Image.NEAREST).save(p)
        paths.append(p)
    for t, e, w in effects[::5]:
        print(f'{t:4d}s {e} {w} W')
    for p in paths:
        print(p)


if __name__ == '__main__':
    main()
