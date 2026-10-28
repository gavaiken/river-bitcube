"""Projection continuity at edge-on twists and isolation between packed physical screens."""
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "td"))
import numpy as np
from remembered import ribbons_gpu as G


def sheet(phase):
    p = np.zeros((G.PH, G.PW, 4), np.float32)
    p[0, 0, 3] = 1
    p[1, 0] = (0, 0, 0, 1)
    p[1, 1, 2] = phase
    p[1, 2, 2] = 1
    for k in range(4):
        p[5 + k, 0] = (0, 0, 1, 0)
        p[5 + k, 1] = (1.4, 1, 1, 0)
    return p


def test_edge_on_sheet_has_finite_soft_support_and_no_phase_flip(monkeypatch):
    monkeypatch.setattr(G, 'SPARKLE', 0)
    monkeypatch.setattr(G, 'DUST', 0)
    a = G.draw(sheet(math.pi / 2 - 1e-4), soft=True)
    b = G.draw(sheet(math.pi / 2 + 1e-4), soft=True)
    assert np.isfinite(a).all() and np.isfinite(b).all()
    np.testing.assert_allclose(a, b, atol=1e-5)
    line = a[G.QH // 2, :G.QW, 0]
    assert line.max() > 0 and line[0] == line[-1] == 0
    assert len(np.unique(np.round(line[line > 0], 5))) > 10
    assert np.abs(np.diff(line)).max() < line.max() * .2


def test_glow_does_not_leak_into_adjacent_physical_screen():
    a = np.zeros((G.QH, G.QW * G.NQ, 2), np.float32)
    a[100, 127, 0] = 1
    g = G.soft_glow(a)
    assert g[:, :128].max() > 0
    assert g[:, 128:].max() == 0
    assert np.isfinite(g).all()


def test_soft_glow_failure_selects_cpu_fallback_only_for_opted_in_show():
    from types import SimpleNamespace
    from remembered import show
    class Comp:
        def __init__(self, soft):
            self.soft = soft
        def fetch(self, key, default):
            return self.soft
        def op(self, name):
            if name == 'screens_src':
                return None
            return SimpleNamespace(errors=lambda: ['compile failure'] if name == 'ribbons_glow_soft' else [])
    for soft in (False, True):
        state = SimpleNamespace(gpu_ok=None)
        show.check_gpu(Comp(soft), state)
        assert state.gpu_ok is (not soft)
