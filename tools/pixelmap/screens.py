"""Find where each HUB75 screen hangs in the gallery camera's frame (phase G4, 23 Oct).

    .venv\\Scripts\\python tools\\pixelmap\\screens.py [--cam gallery]      (on bitcube, with a show file open)

One screen at a time lights one quarter of itself white (td/build/screens.py Screenquarter: TL, TR, BL, BR as
seen), the other screens and the ropes black. A screen's corners come from the four quarter centroids through a
homography, so they are right however the screen is tilted (hub75.py's diagonal extremes assume an upright quad)
and labelled as seen. Quarters, not colours: the gallery cam renders the LEDs' colours too unreliably (clipped to
cyan and white when bright, greyed when dim; 23 Oct). Screens the camera can't see (1 and 3 hang on the back) get an
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


QUARTER_OF = {1: 'tl', 2: 'tr', 3: 'bl', 4: 'br'}       # Screenquarter -> which quarter is white


def centroid(test, black, thresh=40, min_px=30):
    """Centroid (x, y) of the largest region that lit up between black and test, and its size; None if none."""
    lit = (test - black).max(axis=2) > thresh
    if lit.sum() < min_px:
        return None
    region = largest_component(_dilate(lit)) & lit
    if region.sum() < min_px:
        return None
    ys, xs = np.nonzero(region)
    return (float(xs.mean() + 0.5), float(ys.mean() + 0.5)), int(region.sum())


def locate(quarters, black, thresh=40, min_px=30):
    """quarters: {1..4: frame with that quarter of one screen white}; black: all dark (float H, W, 3 frames).
    Returns {'corners': {tl,tr,br,bl: (x, y) px}, 'px': lit pixels, 'balance': smallest/largest quarter} or None
    when any quarter wasn't seen (the screen is out of view or partly hidden)."""
    cents, sizes = {}, []
    for q, frame in quarters.items():
        r = centroid(frame, black, thresh, min_px)
        if r is None:
            return None
        cents[QUARTER_OF[q]], n = r
        sizes.append(n)
    hm = homography([QUARTERS[k] for k in CORNERS], [cents[k] for k in CORNERS])
    pts = apply_h(hm, np.array([UNIT[k] for k in CORNERS], float))
    corners = {k: (float(p[0]), float(p[1])) for k, p in zip(CORNERS, pts)}
    area = quad_area([corners[k] for k in CORNERS])
    # A screen's quarters are similar in size and fill their quad; a tiny or collapsed quad is something else
    # changing in the picture (the camera's clock, someone walking), as for the back screens on 23 Oct.
    if area < 400 or area < 0.3 * sum(sizes) or min(sizes) < 0.3 * max(sizes):
        return None
    return {'corners': corners, 'px': int(sum(sizes)), 'balance': round(min(sizes) / max(sizes), 2)}


def quad_area(pts):
    x, y = np.asarray(pts, float).T
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2)


def keep_inside(uv, margin=0.02):
    """Shift an estimated screen (TD UVs) so it lies inside the field, keeping its shape."""
    us, vs = [c[0] for c in uv.values()], [c[1] for c in uv.values()]
    du = max(0, margin - min(us)) - max(0, max(us) - (1 - margin))
    dv = max(0, margin - min(vs)) - max(0, max(vs) - (1 - margin))
    return {k: [round(c[0] + du, 5), round(c[1] + dv, 5)] for k, c in uv.items()}


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
    ap.add_argument('--brightness', type=float, default=0.3, help='panels brightness while locating')
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
        shots = [(9, 0)] + [(k, q) for k in (1, 2, 3, 4) for q in (1, 2, 3, 4)]    # all black first
        for k, q in shots:
            capture.td(f"c = op('{comp}'); c.par.Screensolo = {k}; c.par.Screenquarter = {q}")
            time.sleep(a.settle)
            frames[k, q] = cam.after(time.monotonic(), n=3)
            Image.fromarray(np.clip(frames[k, q], 0, 255).astype(np.uint8)).save(out / f'screen{k}-q{q}.png')
    finally:
        capture.td(f"c = op('{comp}'); c.par.Screencorners = {keep['corners']}; c.par.Screensolo = {keep['solo']}; "
                   f"c.par.Screenquarter = 0; "
                   f"c.par.Screentest = {keep['test']}\nop('/project1/ropes').par.Source = '{keep['source']}'\n"
                   f"op('/project1/panels').par.Brightness = {keep['bright']}")
        cam.close()
    black = frames[9, 0]
    h, w = black.shape[:2]
    seen, info = {}, {}
    for k in (1, 2, 3, 4):
        r = locate({q: frames[k, q] for q in (1, 2, 3, 4)}, black)
        if r:
            seen[k] = r['corners']
            info[k] = {'px': r['px'], 'balance': r['balance']}
        print(f'screen {k}:', 'seen' if r else 'not seen', r and info[k])
    screens = {}
    for k in (1, 2, 3, 4):
        if k in seen:
            screens[k] = to_uv(seen[k], w, h) | info[k]
        else:
            est = estimate(seen, k)
            if est:
                screens[k] = keep_inside(to_uv(est, w, h)) | {'estimated': True, 'from': NEIGHBOUR[k][0]}
    im = Image.fromarray(np.clip(np.maximum.reduce([frames[k, q] for k in (1, 2, 3, 4) for q in (1, 2, 3, 4)]), 0, 255).astype(np.uint8))
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
