"""The remembered river's screens in the artists' simulator look (td/remembered/water.py)."""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'td'))
from remembered import show, water  # noqa: E402


def test_windows_drift_near_home_and_stay_inside():
    w = water.Water()
    for t in (0, 30, 77, 400, 1234):
        for (x, y, ww, hh), (hx, hy, hw, hh0) in zip(w.windows(t), water.HOMES):
            assert 0 <= x and x + ww <= 1 + 1e-9 and 0 <= y and y + hh <= 1 + 1e-9
            assert abs((x + ww / 2) - (hx + hw / 2)) <= water.DRIFT + 0.01
    assert w.windows(0) != w.windows(60)


def test_only_moving_water_lights_and_stills_stay_black():
    rng = np.random.default_rng(0)
    w = water.Water()
    base = np.full((water.MH, water.MW, 3), 0.5, np.float32)
    for _ in range(40):                                   # left half changes (water), right half still (rock)
        f = base.copy()
        f[:, : water.MW // 2] = rng.random((water.MH, water.MW // 2, 1))
        w.feed(f)
    assert w.mask[:, : water.MW // 4].mean() > 0.5 and w.mask[:, -water.MW // 4:].max() == 0
    wins = [(0.05, 0.1, 0.2, 0.6), (0.75, 0.1, 0.2, 0.6)] * 2
    crops = [np.full((water.QH, water.QW, 3), 0.8, np.float32)] * 4
    out = w.step(crops, wins, level=1.0)
    assert out[:, : water.QW].max() > 0.5                 # screen 1 looks at the water
    assert out[:, water.QW: 2 * water.QW].max() == 0      # screen 2 looks at the rock: LEDs off
    dim = w.step(crops, wins, level=0.4)
    assert 0 < dim[:, : water.QW].max() < out[:, : water.QW].max()


def test_screen_level_follows_the_loop():
    times = {'build': 90, 'surge': 160, 'settle': 200, 'calm': 280}
    assert show.screen_level(10, times) == show.SCREEN_CALM
    assert show.SCREEN_CALM < show.screen_level(125, times) < 1
    assert show.screen_level(180, times) == 1.0
    assert show.screen_level(290, times) == show.SCREEN_CALM


def test_control_sets_screen_intensity_and_threshold():
    c = show.parse_control({'screens': {'intensity': 0.6, 'threshold': 0.5}})
    assert c['screen_intensity'] == 0.6 and c['screen_threshold'] == 0.5
    assert show.parse_control({})['screen_intensity'] is None


def test_geometry_screens_hang_at_their_measured_tilts():
    from remembered import geometry
    repo = Path(__file__).resolve().parents[2]
    g = geometry.Geometry(repo / 'tools/pixelmap/pixelmap-2026-10-27.json', repo / 'tools/pixelmap/screens-2026-10-27.json')
    angles = [round(np.degrees(a)) for _, a, _, _ in g.screens]
    assert angles == [21, -19, -20, 23]
    assert g.led_xy.shape == (20, 400, 2) and len(g.led_pts) > 1000


def test_blur_and_quantile_match_the_float64_originals():
    rng = np.random.default_rng(2)
    a = rng.random((water.MH, water.MW)).astype(np.float32) * 0.05

    def blur64(x, r=3):                                   # water.py's blur before 29 Oct (np.pad + cumsum, float64)
        out = x
        for _ in range(3):
            p = np.pad(out, ((0, 0), (r, r)), mode='edge')
            c = np.concatenate([np.zeros((p.shape[0], 1)), np.cumsum(p, axis=1)], axis=1)
            out = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
            p = np.pad(out, ((r, r), (0, 0)), mode='edge')
            c = np.concatenate([np.zeros((1, p.shape[1])), np.cumsum(p, axis=0)], axis=0)
            out = (c[2 * r + 1:, :] - c[:-2 * r - 1, :]) / (2 * r + 1)
        return out
    b = water._blur(a)
    assert b.dtype == np.float32 and np.abs(b - blur64(a)).max() < 1e-6
    assert water.quantile(b, 0.9) == pytest.approx(float(np.quantile(b, 0.9)), abs=1e-7)


def test_one_luma_pass_feeds_the_motion_level_and_the_mask(tmp_path):
    s = show.Show(river_dir=tmp_path)
    rng = np.random.default_rng(0)
    w = water.Water()
    for i in range(10):
        f = rng.random((180, 320, 3)).astype(np.float32)
        s.feed_river(f, 'clip', 1_800_000_000 + i)
        w.feed(f)                                         # Water.feed (its own luma) gives the same mask
    assert s.motion.frames == 9 and s.motion.level > 0
    assert np.array_equal(s.water.mask, w.mask) and s.water.mask.dtype == np.float32


def test_show_runs_with_the_particle_field(tmp_path):
    repo = Path(__file__).resolve().parents[2]
    s = show.Show(river_dir=tmp_path, pixelmap=repo / 'tools/pixelmap/pixelmap-2026-10-27.json',
                  screens=repo / 'tools/pixelmap/screens-2026-10-27.json')
    for i in range(120):
        ropes_frame, panels_frame = s.tick(1_800_000_000 + i / 60, 1 / 60)
    assert panels_frame.shape == (256, 512, 3) and s.control['screen_mode'] == 'particles'


def test_m4_small_surges_random_when_empty_and_room_at_most_one_a_minute(tmp_path):
    s = show.Show(river_dir=tmp_path)
    snap = {'times': {'drawback': 1e6, 'calm': 2e6}, 't_s': 10.0, 'phase': 'calm'}
    empty = {'available': True, 'presence': 0.0, 'relative': 0.0, 'lingerers': []}
    starts, now = [], 1000.0
    for i in range(int(900 / 0.5)):                       # 15 minutes of an empty room
        now += 0.5
        before = s.mini_t0
        s._mini(now, snap, empty)
        if s.mini_t0 is not None and s.mini_t0 != before:
            starts.append(now)
    gaps = np.diff(starts)
    assert len(starts) >= 3 and gaps.min() >= show.MINI_EMPTY_S[0] and gaps.max() <= show.MINI_EMPTY_S[1] + show.MINI_LEN_S
    s2 = show.Show(river_dir=tmp_path)
    busy = {'available': True, 'presence': 6.0, 'relative': 2.5, 'lingerers': [{'ropes': [3]}]}
    starts, now = [], 1000.0
    for i in range(int(300 / 0.5)):
        now += 0.5
        before = s2.mini_t0
        s2._mini(now, snap, busy)
        if s2.mini_t0 is not None and s2.mini_t0 != before:
            starts.append(now)
    assert len(starts) >= 3 and np.diff(starts).min() >= show.MINI_ROOM_GAP_S and s2.mini_kind == 'room'


def test_m4_no_small_surge_near_the_main_one(tmp_path):
    s = show.Show(river_dir=tmp_path)
    snap = {'times': {'drawback': 150.0, 'calm': 280.0}, 't_s': 140.0, 'phase': 'building'}
    busy = {'available': True, 'presence': 6.0, 'relative': 2.5, 'lingerers': [{'ropes': [3]}]}
    assert s._mini(1000.0, snap, busy)['mini_tau'] is None
