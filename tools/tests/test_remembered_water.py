"""The remembered river's screens in the artists' simulator look (td/remembered/water.py)."""
import sys
from pathlib import Path

import numpy as np

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


def test_particle_field_windows_follow_the_room():
    from remembered import particles
    repo = Path(__file__).resolve().parents[2]
    g = particles.Geometry(repo / 'tools/pixelmap/pixelmap-2026-10-27.json', repo / 'tools/pixelmap/screens-2026-10-27.json')
    angles = [round(np.degrees(a)) for _, a, _, _ in g.screens]
    assert angles[0] == 15 and abs(angles[2] + 21) <= 2 and abs(angles[3] - 24) <= 2
    calm, surge = particles.Field(g), particles.Field(g)
    for _ in range(300):
        calm.step(1 / 60, 0.1, 40)
        surge.step(1 / 60, 0.9, 120)
    sc, ss = calm.render_screens((1, 1, 1)), surge.render_screens((1, 1, 1))
    assert ss.mean() > sc.mean() > 0                       # the field follows the ropes' intensity
    r = surge.render_ropes((1, 1, 1))
    assert r.shape == (20, 400, 3) and 0 < r.max() <= 1


def test_show_runs_with_the_particle_field(tmp_path):
    repo = Path(__file__).resolve().parents[2]
    s = show.Show(river_dir=tmp_path, pixelmap=repo / 'tools/pixelmap/pixelmap-2026-10-27.json',
                  screens=repo / 'tools/pixelmap/screens-2026-10-27.json')
    for i in range(120):
        ropes_frame, panels_frame = s.tick(1_800_000_000 + i / 60, 1 / 60)
    assert panels_frame.shape == (256, 512, 3) and s.control['screen_mode'] == 'particles'
