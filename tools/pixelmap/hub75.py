"""Find HUB75 quad 1's four corners in the camera frame from a capture made by
`capture.py hub75` (panels black / test pattern, twice each), and store them in the pixel map.

    .venv\\Scripts\\python tools\\pixelmap\\hub75.py frames\\hub75-YYYYMMDD-HHMMSS [pixelmap.json]

The quad is the largest region that lights up between the black and test frames. Its corners are the
extreme points along the diagonals (fine for a roughly upright, convex quad). Check: the centroids of
the four coloured panels (red TL, green TR, blue BL, yellow BR) predict the corners through a
homography; check_px is the largest disagreement. Corners are stored as TD UVs (v up) under
'hub75_quad1' in the pixel-map JSON.

A multi-view map (decode.py over several camera views; its meta.space): every view of the capture's session is
searched, the quad is taken from the view that sees it whole and largest, and its corners are rotated into the map's
virtual frame (corners stay a true perspective quad: a rotation of the camera is a homography).
"""
import json
import sys
from pathlib import Path

import numpy as np

CORNERS = ('tl', 'tr', 'br', 'bl')


def homography(src, dst):
    """3x3 H with dst ~ H @ src for 4 point pairs (DLT)."""
    a = []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    h = np.linalg.svd(np.array(a, float))[2][-1]
    return (h / h[-1]).reshape(3, 3)


def apply_h(hm, pts):
    p = np.c_[pts, np.ones(len(pts))] @ hm.T
    return p[:, :2] / p[:, 2:]


def _dilate(m, n=2):
    for _ in range(n):
        d = m.copy()
        d[1:] |= m[:-1]; d[:-1] |= m[1:]; d[:, 1:] |= m[:, :-1]; d[:, :-1] |= m[:, 1:]
        m = d
    return m


def largest_component(mask):
    """Largest 4-connected region of mask (bool), by flood fill over the set pixels only."""
    seen = np.zeros_like(mask)
    best = None
    h, w = mask.shape
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        stack, comp = [(y0, x0)], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop()
            comp.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    stack.append((yy, xx))
        if best is None or len(comp) > len(best):
            best = comp
    out = np.zeros_like(mask)
    if best:
        ys, xs = zip(*best)
        out[list(ys), list(xs)] = True
    return out


def _colour_masks(test):
    r, g, b = test[..., 0], test[..., 1], test[..., 2]
    return {'tl': (r > g + 50) & (r > b + 50),                                  # red
            'tr': (g > r + 50) & (g > b + 30),                                  # green
            'bl': (b > r + 40) & (b > g + 20),                                  # blue
            'br': (r > b + 40) & (g > b + 30) & (np.abs(r - g) < 70)}           # yellow


def find_corners(test, black, thresh=40):
    """test, black: float (H, W, 3). Returns {'corners': {tl,tr,br,bl: (x, y) px}, 'red_at', 'check_px'}."""
    lit = (test - black).max(axis=2) > thresh
    region = largest_component(_dilate(lit)) & lit
    ys, xs = np.nonzero(region)
    if len(xs) < 50:
        raise ValueError('the HUB75 test pattern was not seen (panels off, window not on the LED display, '
                         'or the camera can\'t see them): nothing changed between the black and test frames')
    x, y = xs + 0.5, ys + 0.5
    pick = {'tl': np.argmin(x + y), 'br': np.argmax(x + y), 'tr': np.argmax(x - y), 'bl': np.argmin(x - y)}
    corners = {k: (float(x[i]), float(y[i])) for k, i in pick.items()}
    out = {'corners': {k: corners[k] for k in CORNERS}, 'red_at': None, 'check_px': None}

    masks = {k: m & region for k, m in _colour_masks(test).items()}
    cents = {k: (np.nonzero(m)[1].mean() + 0.5, np.nonzero(m)[0].mean() + 0.5) for k, m in masks.items() if m.sum() > 10}
    if 'tl' in cents:
        out['red_at'] = min(CORNERS, key=lambda k: np.hypot(*np.subtract(corners[k], cents['tl'])))
    if len(cents) == 4:
        quad_pts = {'tl': (0.25, 0.25), 'tr': (0.75, 0.25), 'br': (0.75, 0.75), 'bl': (0.25, 0.75)}
        hm = homography([quad_pts[k] for k in CORNERS], [cents[k] for k in CORNERS])
        pred = apply_h(hm, np.array([(0, 0), (1, 0), (1, 1), (0, 1)], float))
        out['predicted'] = {k: tuple(map(float, p)) for k, p in zip(CORNERS, pred)}
        out['check_px'] = float(max(np.hypot(*np.subtract(corners[k], p)) for k, p in zip(CORNERS, pred)))
    return out


def to_uv(corners, w, h):
    """Continuous image coordinates (x, y), as find_corners returns them, to TD UV (v up)."""
    return {k: (round(x / w, 5), round(1 - y / h, 5)) for k, (x, y) in corners.items()}


def _in_view(res, w, h, margin=4):
    xs, ys = zip(*res['corners'].values())
    return min(xs) > margin and min(ys) > margin and max(xs) < w - margin and max(ys) < h - margin


def _area(c):
    x, y = np.array([c[k] for k in CORNERS], float).T
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2)


def main(capture, pixelmap=None):
    from PIL import Image, ImageDraw
    capture = Path(capture)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from pixelmap.decode import latest_pixelmap, session_captures
    from pixelmap import sphere
    pixelmap = Path(pixelmap) if pixelmap else latest_pixelmap()
    pm = json.loads(pixelmap.read_text()) if pixelmap else None
    space = (pm or {}).get('meta', {}).get('space')
    tried = []
    for c in (session_captures(capture, 'hub75') if space else [capture]):
        load = lambda n, c=c: np.asarray(Image.open(c / f'{n}.png').convert('RGB'), np.float32)
        test = (load('test0') + load('test1')) / 2
        black = (load('black0') + load('black1')) / 2
        try:
            r = find_corners(test, black)
        except ValueError as e:
            if not space:
                raise
            print(f'{c.name}: {e}')
            continue
        view = json.loads((c / 'meta.json').read_text()).get('view') or 'home' if space else None
        tried.append((_in_view(r, *test.shape[1::-1]), _area(r['corners']), c, view, r, test))
    if not tried:
        raise ValueError('the HUB75 test pattern was not seen in any view')
    _, _, capture, view, res, test = max(tried, key=lambda t: (t[0], t[1]))
    h, w = test.shape[:2]
    if space:
        sp = sphere.Space.from_meta(space)
        uvs = sp.view_px_to_uv(view, np.array([res['corners'][k] for k in CORNERS]))
        uv = {k: (round(float(a), 5), round(float(b), 5)) for k, (a, b) in zip(CORNERS, uvs)}
        print(f'quad found in view {view} ({capture.name})')
    else:
        uv = to_uv(res['corners'], w, h)
    print(json.dumps(res, indent=1))
    if res['red_at'] != 'tl':
        print(f"WARNING: red panel is nearest the {res['red_at']} corner, not tl: check the orientation")
    if pixelmap is None:
        sys.exit('no tools/pixelmap/pixelmap-*.json yet: run capture.py ropes and decode.py first')
    pm['hub75_quad1'] = uv | {'capture': capture.name, 'frame_size': [w, h], 'check_px': res['check_px']} | (
        {'view': view} if space else {})
    pixelmap.write_text(json.dumps(pm, indent=0).replace('\n', ' ').replace('} {', '},\n{') + '\n')
    im = Image.fromarray(test.astype(np.uint8))
    dr = ImageDraw.Draw(im)
    pts = [res['corners'][k] for k in CORNERS]
    dr.polygon(pts, outline=(255, 255, 0))
    for k, (x, y) in res['corners'].items():
        dr.text((x + 3, y + 3), k, fill=(255, 255, 0))
    for x, y in (res.get('predicted') or {}).values():
        dr.ellipse((x - 3, y - 3, x + 3, y + 3), outline=(0, 255, 255))
    im.save(capture / 'corners.png')
    print(f'wrote hub75_quad1 into {pixelmap} and {capture / "corners.png"}')


if __name__ == '__main__':
    main(*sys.argv[1:])
