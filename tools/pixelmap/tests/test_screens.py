import numpy as np
from PIL import Image, ImageDraw

from pixelmap.screens import estimate, keep_inside, locate, to_uv

W, H = 480, 360
SPANS = {1: (0, 0), 2: (0.5, 0), 3: (0, 0.5), 4: (0.5, 0.5)}     # Screenquarter -> (s, t) of its top left, as seen


def frames(corners, ambient=20, hide=None):
    """All-dark frame and, per quarter 1-4, the frame with only that quarter of a (tilted) screen lit."""
    black = np.full((H, W, 3), ambient, np.float32)
    c = {k: np.array(v, float) for k, v in corners.items()}
    at = lambda s, t: tuple(c['tl'] + (c['tr'] - c['tl']) * s + (c['bl'] - c['tl']) * t)   # parallelogram
    out = {}
    for q, (s0, t0) in SPANS.items():
        im = Image.fromarray(black.astype(np.uint8))
        if q != hide:
            ImageDraw.Draw(im).polygon([at(s0, t0), at(s0 + 0.5, t0), at(s0 + 0.5, t0 + 0.5), at(s0, t0 + 0.5)],
                                       fill=(230, 240, 235))
        out[q] = np.asarray(im, np.float32)
    return out, black


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
    assert r['balance'] > 0.9


def test_tilted_40_keeps_its_labels():
    truth = tilted(240, 180, 60, 120, 40)      # diagonal extremes would mislabel this one
    r = locate(*frames(truth))
    assert r and close(r['corners'], truth, 3)


def test_upside_down_screen_is_labelled_as_seen():
    truth = tilted(240, 180, 60, 120, 180)     # its top left as seen is at the image's bottom right
    r = locate(*frames(truth))
    assert r and close(r['corners'], truth, 3)


def test_nothing_lit_is_not_seen():
    quarters, black = frames(tilted(240, 180, 60, 120, 0))
    assert locate({q: black.copy() for q in quarters}, black) is None


def test_partly_hidden_screen_is_not_seen():
    assert locate(*frames(tilted(240, 180, 60, 120, 0), hide=2)) is None


def test_estimate_puts_screen_1_above_screen_2():
    seen = {2: tilted(240, 200, 60, 120, 0)}
    est = estimate(seen, 1)
    assert est['bl'][1] < seen[2]['tl'][1] + 1    # wholly above it
    assert abs(est['tl'][0] - seen[2]['tl'][0]) < 1
    assert estimate({}, 1) is None


def test_uv_is_v_up():
    uv = to_uv({'tl': (0, 0), 'br': (W, H)}, W, H)
    assert uv['tl'] == [0.0, 1.0] and uv['br'] == [1.0, 0.0]


def test_a_flickering_dot_is_not_a_screen():
    quarters, black = frames(tilted(240, 180, 60, 120, 0))
    dots = {}
    for q in quarters:                          # one small blob that moves a pixel per frame (a clock digit)
        f = black.copy()
        f[20:26, 100 + q:106 + q] = 240
        dots[q] = f
    assert locate(dots, black) is None


def test_estimate_kept_inside_the_field():
    uv = keep_inside({'tl': [0.6, 1.1], 'tr': [0.7, 1.1], 'br': [0.7, 0.9], 'bl': [0.6, 0.9]})
    assert max(c[1] for c in uv.values()) <= 0.98 + 1e-9 and abs(uv['tl'][1] - uv['bl'][1] - 0.2) < 1e-6


def test_someone_walking_by_in_one_frame_is_ignored():
    truth = tilted(240, 180, 60, 120, 30)
    quarters, black = frames(truth)
    quarters[4] = quarters[4].copy()
    quarters[4][250:350, 380:470] = 240        # a bigger bright blob far away, in the last frame only
    r = locate(quarters, black)
    assert r and close(r['corners'], truth, 3)
