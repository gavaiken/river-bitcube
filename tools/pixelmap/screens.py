"""Find where each HUB75 screen hangs in the gallery camera's frame (phase G4, 23 Oct).

    .venv\\Scripts\\python tools\\pixelmap\\screens.py [--cam gallery]      (on bitcube, with a show file open)

One screen at a time shows the four-colour corner pattern of td/build/screens.py (red TL, green TR, blue BL,
yellow BR, as seen), the other screens and the ropes black. A screen's corners come from the four colour
centroids through a homography, so they are right however the screen is tilted (hub75.py's diagonal extremes
assume an upright quad) and labelled as seen. Screens the camera can't see (1 and 3 hang on the back) get an
estimated place next to a neighbour and are marked "estimated": they still show the water near where they hang.
Writes tools/pixelmap/screens-<date>.json (TD UVs, v up; read by td/build/screens.py) and
frames/screens-<stamp>/ (frames and corners.png). Puts the show back as it was, also when the run fails.
"""
import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pixelmap.hub75 import _dilate, apply_h, homography, largest_component  # noqa: E402

CORNERS = ('tl', 'tr', 'br', 'bl')
QUARTERS = {'tl': (0.25, 0.25), 'tr': (0.75, 0.25), 'br': (0.75, 0.75), 'bl': (0.25, 0.75)}
UNIT = {'tl': (0, 0), 'tr': (1, 0), 'br': (1, 1), 'bl': (0, 1)}
# Which screen to borrow a place from when one isn't seen, and where to put it (in units of the neighbour's
# own up and right vectors, as seen): screen 1 hangs above screen 2, screen 3 below screen 4 (Gavin's photos).
NEIGHBOUR = {1: (2, 1.15, 0.0), 2: (1, -1.15, 0.0), 3: (4, -1.15, -0.3), 4: (3, 1.15, 0.3)}


def colour_masks(test):
    """Red TL, green TR, blue BL, yellow BR as the gallery cam sees bright LEDs: it pushes green towards cyan
    (84, 253, 233) and blue towards light blue (71, 209, 253) (23 Oct), so green only needs g >= b - 15 and blue
    needs b clearly above g. Run dim (--brightness) so yellow doesn't clip to white."""
    r, g, b = test[..., 0], test[..., 1], test[..., 2]
    return {'tl': (r > g + 60) & (r > b + 60),
            'tr': (g > r + 50) & (g >= b - 15),
            'bl': (b > g + 20) & (b > r + 60),
            'br': (r > b + 40) & (g > b + 40) & (np.abs(r - g) < 60)}


def locate(test, black, thresh=40, min_px=150):
    """test, black: float (H, W, 3) frames, one screen showing the corner pattern vs all black.
    Returns {'corners': {tl,tr,br,bl: (x, y) px}, 'px': lit pixels, 'fit_px': mean miss} or None if not seen."""
    lit = (test - black).max(axis=2) > thresh
    if lit.sum() < min_px:
        return None
    region = largest_component(_dilate(lit)) & lit
    if region.sum() < min_px:
        return None
    masks = {k: m & region for k, m in colour_masks(test).items()}
    cents = {}
    for k, m in masks.items():
        if m.sum() < max(10, region.sum() // 40):
            return None                                  # a colour is missing: not a whole screen in view
        ys, xs = np.nonzero(m)
        cents[k] = (xs.mean() + 0.5, ys.mean() + 0.5)
    hm = homography([QUARTERS[k] for k in CORNERS], [cents[k] for k in CORNERS])
    pts = apply_h(hm, np.array([UNIT[k] for k in CORNERS], float))
    corners = {k: (float(p[0]), float(p[1])) for k, p in zip(CORNERS, pts)}
    # Fit check: how far the region's pixels on its outline lie from the predicted quad (rough, in px).
    ys, xs = np.nonzero(region)
    inside = _inside(np.stack([xs + 0.5, ys + 0.5], 1), [corners[k] for k in CORNERS])
    return {'corners': corners, 'px': int(region.sum()), 'inside': round(float(inside.mean()), 3)}


def _inside(pts, poly):
    """Points inside a convex polygon (any winding)."""
    poly = np.asarray(poly, float)
    sign = None
    ok = np.ones(len(pts), bool)
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        cross = (b[0] - a[0]) * (pts[:, 1] - a[1]) - (b[1] - a[1]) * (pts[:, 0] - a[0])
        s = np.sign(cross.sum()) if sign is None else sign
        sign = s
        ok &= cross * s >= -1e-6
    return ok


def estimate(seen, k):
    """A place for screen k next to a seen neighbour: shifted along the neighbour's up/right vectors."""
    n, up_f, right_f = NEIGHBOUR[k]
    if n not in seen:
        return None
    c = {key: np.array(v, float) for key, v in seen[n].items()}
    up = c['tl'] - c['bl']                                # image y is down, so this points up as seen
    right = c['tr'] - c['tl']
    shift = up * up_f + right * right_f
    return {key: tuple(map(float, v + shift)) for key, v in c.items()}


def to_uv(corners, w, h):
    return {k: [round(min(max(x / w, -0.5), 1.5), 5), round(min(max(1 - y / h, -0.5), 1.5), 5)]
            for k, (x, y) in corners.items()}


def main():
    from PIL import Image, ImageDraw
    from pixelmap import capture
    ap = argparse.ArgumentParser()
    ap.add_argument('--cam', default='gallery')
    ap.add_argument('--settle', type=float, default=2.0)
    ap.add_argument('--brightness', type=float, default=0.06, help='panels brightness (the cam clips colours above ~0.1)')
    a = ap.parse_args()
    comp = capture.td("print([p for p in ('/project1/seasons', '/project1/river_local') "
                      "if op(p) is not None and hasattr(op(p).par, 'Screencorners')][0])")['stdout'].strip()
    keep = json.loads(capture.td(
        f"import json; c = op('{comp}'); r = op('/project1/ropes'); p = op('/project1/panels')\n"
        "print(json.dumps({'corners': bool(c.par.Screencorners), 'solo': int(c.par.Screensolo), "
        "'test': bool(c.par.Screentest), 'source': r.par.Source.eval(), 'bright': float(p.par.Brightness)}))")['stdout'])
    print('before:', comp, keep)
    secrets = json.loads((capture.REPO / 'secrets.local.json').read_text())
    cam = capture.Reader(secrets['cameras'][a.cam])
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    out = capture.REPO / 'frames' / f'screens-{stamp}'
    out.mkdir(parents=True, exist_ok=True)
    frames = {}
    try:
        capture.td(f"c = op('{comp}'); c.par.Screentest = False; c.par.Screencorners = True\n"
                   f"op('/project1/ropes').par.Source = 'black'; op('/project1/panels').par.Brightness = {a.brightness}")
        for k in (9, 1, 2, 3, 4):                         # 9 = all black first
            capture.td(f"op('{comp}').par.Screensolo = {k}")
            time.sleep(a.settle)
            frames[k] = cam.after(time.monotonic(), n=4)
            Image.fromarray(np.clip(frames[k], 0, 255).astype(np.uint8)).save(out / f'solo{k}.png')
    finally:
        capture.td(f"c = op('{comp}'); c.par.Screencorners = {keep['corners']}; c.par.Screensolo = {keep['solo']}; "
                   f"c.par.Screentest = {keep['test']}\nop('/project1/ropes').par.Source = '{keep['source']}'\n"
                   f"op('/project1/panels').par.Brightness = {keep['bright']}")
        cam.close()
    h, w = frames[9].shape[:2]
    seen, info = {}, {}
    for k in (1, 2, 3, 4):
        r = locate(frames[k], frames[9])
        if r:
            seen[k] = r['corners']
            info[k] = {'px': r['px'], 'inside': r['inside']}
        print(f'screen {k}:', 'seen' if r else 'not seen', r and {'px': r['px'], 'inside': r['inside']})
    screens = {}
    for k in (1, 2, 3, 4):
        if k in seen:
            screens[k] = to_uv(seen[k], w, h) | info[k]
        else:
            est = estimate(seen, k)
            if est:
                screens[k] = to_uv(est, w, h) | {'estimated': True, 'from': NEIGHBOUR[k][0]}
    im = Image.fromarray(np.clip(np.maximum.reduce([frames[k] for k in (1, 2, 3, 4)]), 0, 255).astype(np.uint8))
    dr = ImageDraw.Draw(im)
    for k, s in screens.items():
        pts = [(s[c][0] * w, (1 - s[c][1]) * h) for c in CORNERS]
        dr.polygon(pts, outline=(255, 255, 0) if not s.get('estimated') else (255, 128, 0))
        dr.text((pts[0][0] + 3, pts[0][1] + 3), f"{k} tl" + (' est' if s.get('estimated') else ''), fill=(255, 255, 0))
    im.save(out / 'corners.png')
    path = capture.REPO / 'tools' / 'pixelmap' / f"screens-{datetime.now():%Y-%m-%d}.json"
    meta = {'capture': out.name, 'camera': a.cam, 'frame_size': [w, h],
            'uv': 'TD convention: u left->right, v bottom->top; corners as seen (tl = top left of the upright picture)'}
    path.write_text(json.dumps({'meta': meta, 'screens': {str(k): v for k, v in screens.items()}}, indent=1) + '\n')
    print('wrote', path, 'and', out / 'corners.png')


if __name__ == '__main__':
    main()
