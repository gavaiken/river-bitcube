import numpy as np
from PIL import Image, ImageDraw

from pixelmap.screens import estimate, locate, to_uv

W, H = 480, 360
COLOURS = {'tl': (200, 40, 40), 'tr': (84, 253, 233), 'bl': (71, 180, 253), 'br': (170, 160, 50)}   # as the cam sees them


def frames(corners, ambient=20):
    """A dark frame and the same frame with a (possibly tilted) screen showing the four-colour pattern."""
    black = np.full((H, W, 3), ambient, np.float32)
    im = Image.fromarray(black.astype(np.uint8))
    dr = ImageDraw.Draw(im)
    c = {k: np.array(v, float) for k, v in corners.items()}
    at = lambda s, t: tuple(c['tl'] + (c['tr'] - c['tl']) * s + (c['bl'] - c['tl']) * t)   # parallelogram
    for key, (s0, t0) in {'tl': (0, 0), 'tr': (0.5, 0), 'bl': (0, 0.5), 'br': (0.5, 0.5)}.items():
        dr.polygon([at(s0, t0), at(s0 + 0.5, t0), at(s0 + 0.5, t0 + 0.5), at(s0, t0 + 0.5)], fill=COLOURS[key])
    return np.asarray(im, np.float32), black


def tilted(cx, cy, w, h, deg):
    a = np.radians(deg)
    right, down = np.array([np.cos(a), np.sin(a)]) * w, np.array([-np.sin(a), np.cos(a)]) * h
    tl = np.array([cx, cy]) - right / 2 - down / 2
    return {'tl': tuple(tl), 'tr': tuple(tl + right), 'bl': tuple(tl + down), 'br': tuple(tl + right + down)}


def close(a, b, tol):
    return all(np.hypot(*np.subtract(a[k], b[k])) <= tol for k in a)


def test_upright_screen():
    truth = tilted(240, 180, 60, 120, 0)
    r = locate(*frames(truth))
    assert r and close(r['corners'], truth, 3)


def test_tilted_45_keeps_its_labels():
    truth = tilted(240, 180, 60, 120, 40)      # diagonal extremes would mislabel this one
    r = locate(*frames(truth))
    assert r and close(r['corners'], truth, 3)
    assert r['inside'] > 0.95


def test_upside_down_screen_is_labelled_as_seen():
    truth = tilted(240, 180, 60, 120, 180)     # red is bottom right in the image: tl is there
    r = locate(*frames(truth))
    assert r and close(r['corners'], truth, 3)


def test_nothing_lit_is_not_seen():
    black = np.full((H, W, 3), 20, np.float32)
    assert locate(black.copy(), black) is None


def test_partly_hidden_screen_is_not_seen():
    truth = tilted(240, 180, 60, 120, 0)
    test, black = frames(truth)
    test[:, 240:] = black[:, 240:]             # the right half (green and yellow) hidden
    assert locate(test, black) is None


def test_estimate_puts_screen_1_above_screen_2():
    seen = {2: tilted(240, 200, 60, 120, 0)}
    est = estimate(seen, 1)
    assert est['bl'][1] < seen[2]['tl'][1] + 1    # wholly above it
    assert abs(est['tl'][0] - seen[2]['tl'][0]) < 1
    assert estimate({}, 1) is None


def test_uv_is_v_up():
    uv = to_uv({'tl': (0, 0), 'br': (W, H)}, W, H)
    assert uv['tl'] == [0.0, 1.0] and uv['br'] == [1.0, 0.0]
