import numpy as np

from pixelmap import hub75

H, W = 120, 200
QUAD = {'tl': (60, 30), 'tr': (150, 36), 'br': (146, 92), 'bl': (64, 88)}     # camera px (x, y)
COLOURS = {(0, 0): (230, 30, 40), (1, 0): (40, 220, 50), (0, 1): (40, 60, 230), (1, 1): (220, 210, 40)}


def render_panel(quad=QUAD):
    """Black frame plus a test-pattern frame: the quad's four panels red/green/blue/yellow (TL/TR/BL/BR)."""
    hm = hub75.homography([(0, 0), (1, 0), (1, 1), (0, 1)], [quad[k] for k in ('tl', 'tr', 'br', 'bl')])
    ys, xs = np.mgrid[0:H, 0:W]
    s, t = hub75.apply_h(np.linalg.inv(hm), np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], axis=1)).T
    s, t = s.reshape(H, W), t.reshape(H, W)
    black = np.full((H, W, 3), 25.0)
    test = black.copy()
    inside = (s >= 0) & (s < 1) & (t >= 0) & (t < 1)
    for (i, j), rgb in COLOURS.items():
        m = inside & ((s >= 0.5) == bool(i)) & ((t >= 0.5) == bool(j))
        test[m] = rgb
    return test, black


def test_homography_roundtrip():
    src = [(0, 0), (1, 0), (1, 1), (0, 1)]
    dst = [(10, 5), (90, 12), (85, 70), (12, 60)]
    hm = hub75.homography(src, dst)
    assert np.allclose(hub75.apply_h(hm, np.array(src, float)), dst)


def test_corners_found():
    test, black = render_panel()
    c = hub75.find_corners(test, black)
    for k, (x, y) in QUAD.items():
        assert abs(c['corners'][k][0] - x) <= 1.5 and abs(c['corners'][k][1] - y) <= 1.5, k
    assert c['red_at'] == 'tl'
    assert c['check_px'] < 4


def test_ignores_smaller_blob():
    test, black = render_panel()
    test[5:15, 5:30] = 255            # a rope or reflection that changed between frames
    c = hub75.find_corners(test, black)
    assert abs(c['corners']['tl'][0] - QUAD['tl'][0]) <= 1.5


def test_no_panel_seen_is_a_clear_error():
    _, black = render_panel()
    try:
        hub75.find_corners(black.copy(), black)
    except ValueError as e:
        assert 'not seen' in str(e)
    else:
        raise AssertionError('expected ValueError')


def test_to_uv_td_convention():
    uv = hub75.to_uv({'tl': (0, 0), 'br': (200, 120), 'mid': (50, 30)}, W, H)
    assert np.allclose(uv['tl'], (0, 1)) and np.allclose(uv['br'], (1, 0))
    assert np.allclose(uv['mid'], (0.25, 0.75))
