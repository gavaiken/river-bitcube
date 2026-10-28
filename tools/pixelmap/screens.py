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

With a multi-view map (--map, default the newest; decode.py over several camera views, its meta.space) the screens
must land in that map's frame: the camera is turned to each of the map's views (the pan/tilt recorded there), each
screen is taken from the view that sees it, its corners are rotated into the map's frame, and the camera goes back to
its show position (tools/cameras/views.json home) at the end, also when the run fails.
"""
import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from PIL import Image

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


def locate(quarters, black, thresh=40, min_px=30):
    """quarters: {1..4: frame with that quarter of one screen white}; black: all dark (float H, W, 3 frames).
    Returns {'corners': {tl,tr,br,bl: (x, y) px}, 'px': lit pixels, 'balance': smallest/largest quarter} or None
    when any quarter wasn't seen (the screen is out of view or partly hidden).
    The screen is the largest region lit in any of the four frames together; each quarter is then looked for only
    there, so something else changing in one frame (someone walking by, 23 Oct) can't pull a corner away."""
    # Opened (eroded, then grown back): a lit quarter is a solid patch, while a camera still swaying after a pan/tilt
    # turns every edge in the room into a thin line of difference (27 Oct) that would join into a bigger region.
    lit = {q: _dilate(_erode((f - black).max(axis=2) > thresh, 2), 2) for q, f in quarters.items()}
    union = np.logical_or.reduce(list(lit.values()))
    if union.sum() < min_px:
        return None
    for _ in range(4):                                 # the largest region that holds all four quarters
        blob = largest_component(_dilate(union))
        screen = _dilate(blob, 3)
        parts = {q: m & screen for q, m in lit.items()}
        if all(m.sum() >= min_px for m in parts.values()):
            break
        union &= ~screen
        if union.sum() < min_px:
            return None
    else:
        return None
    cents, sizes = {}, []
    for q, m in parts.items():
        ys, xs = np.nonzero(m)
        cents[QUARTER_OF[q]] = (float(xs.mean() + 0.5), float(ys.mean() + 0.5))
        sizes.append(int(m.sum()))
    hm = homography([QUARTERS[k] for k in CORNERS], [cents[k] for k in CORNERS])
    pts = apply_h(hm, np.array([UNIT[k] for k in CORNERS], float))
    corners = {k: (float(p[0]), float(p[1])) for k, p in zip(CORNERS, pts)}
    area = quad_area([corners[k] for k in CORNERS])
    # A screen's quarters are similar in size and fill their quad; a tiny or collapsed quad is something else
    # changing in the picture (the camera's clock, someone walking), as for the back screens on 23 Oct.
    if area < 400 or area < 0.3 * sum(sizes) or min(sizes) < 0.3 * max(sizes):
        return None
    return {'corners': corners, 'px': int(sum(sizes)), 'balance': round(min(sizes) / max(sizes), 2)}


def _erode(m, n=1):
    return ~_dilate(~m, n)


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


def shoot(capture, comp, cam, out, settle, prefix=''):
    """Black, then each quarter of each screen: {(screen, quarter): frame}, saved under out."""
    from PIL import Image
    frames = {}
    shots = [(9, 0)] + [(k, q) for k in (1, 2, 3, 4) for q in (1, 2, 3, 4)]    # all black first
    for k, q in shots:
        capture.td(f"c = op('{comp}'); c.par.Screensolo = {k}; c.par.Screenquarter = {q}")
        time.sleep(settle)
        frames[k, q] = cam.after(time.monotonic(), n=3)
        Image.fromarray(np.clip(frames[k, q], 0, 255).astype(np.uint8)).save(out / f'{prefix}screen{k}-q{q}.png')
    return frames


def main():
    from PIL import Image, ImageDraw
    from pixelmap import capture, decode, sphere
    ap = argparse.ArgumentParser()
    ap.add_argument('--cam', default='gallery')
    ap.add_argument('--settle', type=float, default=2.0)
    ap.add_argument('--brightness', type=float, default=0.3, help='panels brightness while locating')
    ap.add_argument('--map', help='the pixel map whose frame the screens go in (default: the newest)')
    a = ap.parse_args()
    mpath = Path(a.map) if a.map else decode.latest_pixelmap()
    space_meta = (json.loads(mpath.read_text()).get('meta') or {}).get('space') if mpath else None
    space = sphere.Space.from_meta(space_meta) if space_meta else None
    ptz, views_cfg = None, None
    if space:
        sys.path.insert(0, str(capture.REPO / 'tools' / 'cameras'))
        import ptz
        views_cfg = ptz.views(a.cam)
        print('multi-view map', mpath.name, '- views', list(space.rots))
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
    per_view, rots = {}, {}
    try:
        capture.td(f"c = op('{comp}'); c.par.Screentest = False; c.par.Screencorners = True\n"
                   f"op('/project1/ropes').par.Source = 'black'; op('/project1/panels').par.Brightness = {a.brightness}")
        if not space:
            per_view[None] = shoot(capture, comp, cam, out, a.settle)
        else:
            for name, v in space.views.items():
                with ptz.Ptz(a.cam) as c:
                    pan, tilt = v.get('ptz') or (None, None)
                    print(f'view {name}: camera to', c.move_to(pan, tilt, (views_cfg or {}).get('tol', 3)))
                time.sleep(4.0)                    # the camera sways for a moment after a tilt
                per_view[name] = shoot(capture, comp, cam, out, a.settle, f'{name}-')
                # The camera never lands exactly where the calibration had it: measure the difference in the picture.
                ref = capture.REPO / 'frames' / v['capture'] / 'A' / 'black.png'
                if ref.exists():
                    s_ = capture.image_shift(np.asarray(Image.open(ref).convert('RGB'), np.float32), per_view[name][9, 0])
                    rots[name] = space.corrected(name, s_)
                    print(f'view {name}: picture {s_} px from the calibration\'s')
    finally:
        if space and views_cfg:
            try:
                with ptz.Ptz(a.cam) as c:
                    ok, pos = c.go_home(views_cfg)
                print('camera home:', pos, '' if ok else 'NOT where it should be: python tools/cameras/ptz.py gallery home')
            except Exception as e:
                print(f'CAMERA NOT BACK HOME ({e}): python tools/cameras/ptz.py gallery home')
        capture.td(f"c = op('{comp}'); c.par.Screencorners = {keep['corners']}; c.par.Screensolo = {keep['solo']}; "
                   f"c.par.Screenquarter = 0; "
                   f"c.par.Screentest = {keep['test']}\nop('/project1/ropes').par.Source = '{keep['source']}'\n"
                   f"op('/project1/panels').par.Brightness = {keep['bright']}")
        cam.close()
    h, w = next(iter(per_view.values()))[9, 0].shape[:2]
    seen, info = {}, {}                                    # corners in TD UVs of the map's frame (or the camera's)
    for view, frames in per_view.items():
        for k in (1, 2, 3, 4):
            r = locate({q: frames[k, q] for q in (1, 2, 3, 4)}, frames[9, 0])
            print(f'screen {k}' + (f' in view {view}' if view else '') + ':', 'seen' if r else 'not seen', r and r['px'])
            if not r or (k in info and info[k]['px'] >= r['px']):
                continue
            if view is None:
                seen[k] = {c: tuple(v) for c, v in to_uv(r['corners'], w, h).items()}
            else:
                rv = rots.get(view, space.rots[view])
                uvs = space.frame.uv(space.cam.rays(np.array([r['corners'][c] for c in CORNERS])) @ rv)
                seen[k] = {c: (float(u), float(v)) for c, (u, v) in zip(CORNERS, uvs)}
            info[k] = {'px': r['px'], 'balance': r['balance']} | ({'view': view} if view else {})
    screens = {}
    for k in (1, 2, 3, 4):
        if k in seen:
            screens[k] = {c: [round(min(max(u, -0.5), 1.5), 5), round(min(max(v, -0.5), 1.5), 5)] for c, (u, v) in seen[k].items()} | info[k]
        else:
            est = estimate(seen, k)
            if est:
                screens[k] = keep_inside({c: [round(u, 5), round(v, 5)] for c, (u, v) in est.items()}) | {'estimated': True, 'from': NEIGHBOUR[k][0]}
    frames = per_view[next(iter(per_view))]
    im = Image.fromarray(np.clip(np.maximum.reduce([frames[k, q] for k in (1, 2, 3, 4) for q in (1, 2, 3, 4)]), 0, 255).astype(np.uint8))
    dr = ImageDraw.Draw(im)
    first = next(iter(per_view))
    for k, s in screens.items():
        uvs = np.array([s[c] for c in CORNERS], float)
        pts = [tuple(p) for p in (space.cam.project(space.frame.uv_to_dirs(uvs) @ rots.get(first, space.rots[first]).T) if space else np.c_[uvs[:, 0] * w, (1 - uvs[:, 1]) * h])]
        dr.polygon(pts, outline=(255, 255, 0) if not s.get('estimated') else (255, 128, 0))
        dr.text((pts[0][0] + 3, pts[0][1] + 3), f"{k} tl" + (' est' if s.get('estimated') else ''), fill=(255, 255, 0))
    im.save(out / 'corners.png')
    path = capture.REPO / 'tools' / 'pixelmap' / f"screens-{datetime.now():%Y-%m-%d}.json"
    meta = {'capture': out.name, 'camera': a.cam, 'frame_size': [w, h],
            'uv': 'TD convention: u left->right, v bottom->top; corners as seen (tl = top left of the upright picture)'}
    if space:
        meta |= {'map': mpath.name, 'frame': 'the map\'s virtual frame (its meta.space): pin both together',
                 'views': list(per_view)}
    path.write_text(json.dumps({'meta': meta, 'screens': {str(k): v for k, v in screens.items()}}, indent=1) + '\n')
    print('wrote', path, 'and', out / 'corners.png')


if __name__ == '__main__':
    main()
