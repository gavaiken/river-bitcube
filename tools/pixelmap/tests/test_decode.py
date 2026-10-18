import numpy as np

from pixelmap import decode, graycode

H, W = 40, 60
N_ROPES, N_PX = 20, 400


def render(scene, ambient=20.0, gain=150.0, noise=0.0, seed=0, stride=N_PX):
    """Synthetic camera frames for every pattern. scene: int array (H, W) of rope*N_PX+px, -1 = no rope."""
    rng = np.random.default_rng(seed)
    rope = np.where(scene >= 0, scene // stride, 0)
    px = np.where(scene >= 0, scene % stride, 0)
    frames = {}
    for p in graycode.patterns():
        if p['name'] == 'black':
            on = np.zeros(scene.shape, bool)
        else:
            on = decode.pattern_bit(rope, px, p['bit']) != p['invert']
        img = ambient + gain * (on & (scene >= 0)) + rng.normal(0, noise, scene.shape) if noise else \
            ambient + gain * (on & (scene >= 0))
        frames[p['name']] = img.astype(np.float32)
    return frames


def scene_two_ropes():
    s = -np.ones((H, W), int)
    s[10, 5:45] = 3 * N_PX + np.arange(40) * 10     # rope 3, px 0..390 along row 10
    s[30, 5:25] = 17 * N_PX + np.arange(20)         # rope 17, px 0..19 along row 30
    return s


def test_decode_recovers_rope_and_px():
    s = scene_two_ropes()
    rope, px, conf = decode.decode(render(s))
    assert (rope[s < 0] == -1).all()
    assert (rope[s >= 0] == s[s >= 0] // N_PX).all()
    assert (px[s >= 0] == s[s >= 0] % N_PX).all()
    assert (conf[s >= 0] > 0.9).all()


def test_decode_rejects_unlit_and_out_of_range():
    s = -np.ones((H, W), int)
    s[0, 0] = 25 * 512 + 1           # rope code 25 doesn't exist
    s[0, 1] = 2 * 512 + 450          # pixel 450 doesn't exist
    rope, px, conf = decode.decode(render(s, stride=512))
    assert (rope == -1).all()


def test_lit_level_from_pairs():
    s = scene_two_ropes()
    f = render(s, ambient=20, gain=150)
    hi = decode.lit_level(f)
    assert np.allclose(hi[s >= 0], 170) and np.allclose(hi[s < 0], 20)


def test_decode_tolerates_noise():
    s = scene_two_ropes()
    rope, px, _ = decode.decode(render(s, noise=8.0))
    ok = (rope == s // N_PX) & (px == s % N_PX) & (s >= 0)
    assert ok.sum() >= 0.95 * (s >= 0).sum()


def test_weak_lsb_still_decodes_with_lower_conf():
    s = scene_two_ropes()
    f = render(s)
    lsb_p, lsb_n = f'b{graycode.ROPE_BITS:02d}p', f'b{graycode.ROPE_BITS:02d}n'
    f[lsb_p] = f[lsb_n] = (f[lsb_p] + f[lsb_n]) / 2      # pixel LSB blurred away (glow inside the tube)
    rope, px, conf = decode.decode(f, weak_lsb=1)
    lit = s >= 0
    assert (rope[lit] == s[lit] // N_PX).all()
    assert (np.abs(px[lit] - s[lit] % N_PX) <= 1).all()
    assert (conf[lit] < 0.5).all()
    rope2, _, _ = decode.decode(f, weak_lsb=0)
    assert (rope2 == -1).all()


def test_pair_agreement_masks_moving_person():
    s = scene_two_ropes()
    a, b = render(s), render(s)
    for name in list(b)[5:9]:             # a person walks in front of part of rope 3 in pass B
        b[name][8:13, 5:15] = 90.0
    rope, px, conf = decode.decode_pair(a, b)
    assert (rope[10, 5:15] == -1).all()
    assert (rope[10, 20:45] == 3).all()


def test_aggregate_weighted_median_and_counts():
    rope = -np.ones((4, 6), int)
    px = np.zeros((4, 6), int)
    conf = np.ones((4, 6))
    rope[1, 1:4] = 2                      # rope 2 px 7 seen at x=1,2,3 on row 1, plus an outlier
    px[1, 1:4] = 7
    rope[3, 5], px[3, 5], conf[3, 5] = 2, 7, 0.1
    u, v, count = decode.aggregate(rope, px, conf, n_ropes=3, n_pixels=10, min_count=2)
    assert count[2, 7] == 4
    assert np.isclose(u[2, 7], (2 + 0.5) / 6)            # median x = 2
    assert np.isclose(v[2, 7], 1 - (1 + 0.5) / 4)        # median y = 1, v up (TD convention)
    assert np.isnan(u[0]).all() and np.isnan(u[2, 6])


def test_reject_outliers_drops_far_points():
    uv = np.stack([np.linspace(0.1, 0.5, 50), np.full(50, 0.5)], axis=1)
    uv[20] = (0.9, 0.1)                   # a reflection on the floor
    uv[30] = np.nan
    out = decode.reject_outliers(uv, window=4, max_dist=0.05)
    assert np.isnan(out[20]).all()
    assert np.isnan(out[30]).all()
    assert not np.isnan(out[np.r_[0:20, 21:30, 31:50]]).any()


def test_fill_along_rope_interpolates_and_holds_ends():
    uv = np.full((10, 2), np.nan)
    uv[2] = (0.2, 0.2)
    uv[6] = (0.6, 0.4)
    filled, visible = decode.fill_along_rope(uv)
    assert visible.tolist() == [i in (2, 6) for i in range(10)]
    assert np.allclose(filled[4], (0.4, 0.3))
    assert np.allclose(filled[0], (0.2, 0.2)) and np.allclose(filled[9], (0.6, 0.4))


def test_fill_along_rope_empty_returns_none():
    filled, visible = decode.fill_along_rope(np.full((10, 2), np.nan))
    assert filled is None and not visible.any()


def test_build_map_leaves_out_empty_ropes():
    u = np.full((3, 5), np.nan)
    v = np.full((3, 5), np.nan)
    u[1, [0, 4]], v[1, [0, 4]] = (0.1, 0.5), (0.2, 0.2)
    m = decode.build_map(u, v, max_dist=1.0)
    ropes = {p['rope'] for p in m['points']}
    assert ropes == {1}
    pts = [p for p in m['points'] if p['rope'] == 1]
    assert [p['px'] for p in pts] == [0, 1, 2, 3, 4]
    assert [p['visible'] for p in pts] == [True, False, False, False, True]
    assert np.isclose(pts[2]['u'], 0.3)
    assert m['ropes'] == {'1': {'visible': 2, 'filled': 3}}
