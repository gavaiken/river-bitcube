"""The filling glass (td/filling/fill.py): one canvas over every rope LED and screen pixel."""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from filling import fill  # noqa: E402
from remembered.particles import Geometry  # noqa: E402


def geom():
    return Geometry(ROOT / 'tools/pixelmap/pixelmap-2026-10-27.json', ROOT / 'tools/pixelmap/screens-2026-10-27.json')


def test_fills_from_the_floor_and_drains():
    f = fill.Fill(geom())
    ys = f.pts[: f.n_rope, 1]
    low, high = ys < np.nanpercentile(ys, 20), ys > np.nanpercentile(ys, 80)
    early = f.colours(8.0)[: f.n_rope].max(-1)
    full = f.colours(fill.FILL_S + 5).max(-1)[: f.n_rope]
    empty = f.colours(fill.CYCLE_S - 1).max(-1)[: f.n_rope]
    assert early[low].mean() > early[high].mean()          # the bottom fills first
    assert full[high].mean() > 0.05                         # then the top
    assert empty.mean() < full.mean() / 3                   # and it drains


def test_frames_shapes_and_power():
    f = fill.Fill(geom())
    now = 1000.0
    for _ in range(int((fill.FILL_S + 5) * 30)):           # time advances frame by frame (dt is capped)
        now += 1 / 30
        ropes, panels, t = f.frames(now)
    assert ropes.shape == (20, 400, 3) and panels.shape == (256, 512, 3)
    assert ropes.sum() * 150 / 3 / 400 < 1400               # under the ropes' power limit, full column
    assert panels.max() <= 1 and panels.mean() > 0.02


def test_dials_change_the_look():
    f = fill.Fill(geom())
    f.set({'palette': 'midnight', 'brightness': 0.4, 'intensity': 1.0, 'speed': 2.0, 'junk': 1})
    assert f.settings == {'palette': 'midnight', 'brightness': 0.4, 'intensity': 1.0, 'speed': 2.0}
    f.set({'palette': 'nope', 'speed': 99})
    assert f.settings['palette'] == 'midnight' and f.settings['speed'] == 3.0
    now = 1000.0
    for _ in range(300):
        now += 1 / 30
        f.frames(now)
    assert abs(f.t - 30.0) < 0.5                            # 10 s at the top speed (3x) = 30 s into the cycle
