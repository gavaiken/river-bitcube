"""M2, the fine particle field (td/remembered/flow.py): swirl without clumping, ledges at the screens' lower edges, true
black, and cheap enough for bitcube."""
import math
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))

from remembered import flow  # noqa: E402

PM = ROOT / 'tools' / 'pixelmap'
FILES = (PM / 'pixelmap-2026-10-28.json', PM / 'screens-2026-10-28.json', PM / 'zones-2026-10-28.json')


def field(seed=0):
    return flow.FineField.from_files(*[str(f) for f in FILES], seed=seed)


def test_the_swirl_is_divergence_free():
    """The flow is the curl of a stream function: it swirls but never gathers particles into clumps."""
    rng = np.random.default_rng(1)
    x, y = rng.uniform(0, 1000, 200), rng.uniform(0, 600, 200)
    s, t, e = rng.uniform(0, 6, 5), 3.0, 1e-3
    def vel(x, y):
        dx, dy = flow._stream(x, y, t, s)
        return dy, -dx
    div = ((vel(x + e, y)[0] - vel(x - e, y)[0]) + (vel(x, y + e)[1] - vel(x, y - e)[1])) / (2 * e)
    scale = np.abs(vel(x, y)[0]).mean() / 50
    assert np.abs(div).max() < 1e-6 + 1e-4 * scale


def test_screens_are_at_their_measured_tilts():
    f = field()
    assert [round(math.degrees(s[2])) for s in f.screens] == [21, -19, -20, 23]


def test_empty_is_true_black():
    f = field()
    out = f.render_screens((0.6, 0.9, 1.0))
    assert out.shape == (flow.QH, flow.QW * flow.NQ, 3) and out.max() == 0.0
    assert f.render_ropes((1, 1, 1)).max() == 0.0


def test_water_lands_on_a_ledge_and_spills_off_the_low_corner():
    f = field()
    cx, cy, ang, w, h = f.screens[0]                        # screen 1, tilted CCW: its left end is lower
    ca, sa = math.cos(ang), math.sin(ang)
    lx, ly = 0.0, -h / 2 + 3                                # just above the middle of the lower edge
    f.p = np.array([[cx + lx * ca - ly * sa, cy + lx * sa + ly * ca]], np.float32)
    f.pp = f.p.copy()
    f.v = np.zeros((1, 2), np.float32)
    f.b, f.r = np.ones(1, np.float32), np.ones(1, np.float32)
    f.ledge = np.full(1, -1, np.int8)
    f.debt = -1e9                                           # no new water: follow this one drop
    landed = spilled = False
    xs = []
    for _ in range(300):
        f.step(1 / 30, 0.0, 40, 0.0)
        if not len(f.b):
            break
        if f.ledge[0] == 0:
            landed = True
            xs.append(float(f.p[0, 0]))
        elif landed:
            spilled = True
            break
    assert landed and spilled
    assert xs[-1] < xs[0]                                  # it ran downhill (left) before spilling


def test_a_surge_lights_every_screen_and_stays_in_budget():
    f = field(seed=3)
    for _ in range(240):
        f.step(1 / 30, 0.9, 110, 0.6)
        f.render_screens((0.6, 0.9, 1.0))
    t = time.perf_counter()
    for _ in range(30):
        f.step(1 / 30, 0.9, 110, 0.6)
        out = f.render_screens((0.6, 0.9, 1.0))
        f.render_ropes((0.6, 0.9, 1.0))
    ms = (time.perf_counter() - t) / 30 * 1000
    assert all(v > 3 for v in f.lit_pct), f.lit_pct
    assert 0 < out.max() <= 1.0 and len(f.b) <= flow.MAX_N
    assert ms < 40, ms                                      # ~6 ms on the mini; bitcube ~3x


# ---- the silk ribbons (td/remembered/ribbons.py, the default since 28 Oct) ------------------------------------------------

def test_ribbons_reach_every_screen_and_stay_in_budget():
    from remembered import ribbons
    f = ribbons.Ribbons.from_files(*[str(p) for p in FILES], seed=2)
    assert sorted(r['home'] for r in f.rib) == sorted(s[0] for s in f.screens)   # a ribbon homed on each window
    seen = np.zeros(4)
    t = time.perf_counter()
    for i in range(240):
        f.step(1 / 30, 0.9, 110, 0.6)
        out = f.render_screens((0.6, 0.8, 1.0))
        seen = np.maximum(seen, f.lit_pct)
    ms = (time.perf_counter() - t) / 240 * 1000
    assert (seen > 15).all(), seen
    assert out.shape == (flow.QH, flow.QW * flow.NQ, 3) and 0 <= out.min() and out.max() <= 1.0
    ropes = f.render_ropes((1, 1, 1))
    assert ropes.shape == (20, 400, 3) and ropes.max() > 0                     # the ribbons light the ropes too
    assert ms < 60, ms                                                         # ~10 ms on the mini


def test_calm_ribbons_are_quieter_than_a_surge():
    from remembered import ribbons
    lit = {}
    for lv in (0.1, 0.9):
        f = ribbons.Ribbons.from_files(*[str(p) for p in FILES], seed=4)
        tot = 0.0
        for i in range(150):
            f.step(1 / 30, lv, 40 + 70 * lv, 0.5)
            tot += float(f.render_screens((1, 1, 1)).mean())
        lit[lv] = tot
    assert lit[0.1] < 0.7 * lit[0.9]


def test_gpu_params_and_the_numpy_mirror_of_the_shaders():
    from remembered import ribbons, ribbons_gpu as G
    f = ribbons.Ribbons.from_files(*[str(p) for p in FILES], seed=5)
    for _ in range(30):
        f.step(1 / 30, 0.8, 100, 0.6)
    p = G.params(f, (0.6, 0.8, 1.0), gain=0.82)
    assert p.shape == (G.PH, G.PW, 4) and p.dtype == np.float32 and np.isfinite(p).all()
    assert abs(p[0, 1, 3] - 0.82) < 1e-6 and (p[1:1 + G.N_RIB, 1] <= 2 * math.pi).all()      # time folded into phases
    ref = G.Reference()
    for _ in range(3):
        out = ref.render(p)
    lit = [(out[:, k * 128:(k + 1) * 128].max(-1) > 0.03).mean() for k in range(4)]
    assert out.shape == (G.QH, G.QW * G.NQ, 3) and out.max() <= 1.0 and min(lit) > 0.05, lit
    assert G.Reference().render(G.params(f, (1, 1, 1), gain=0.0)).max() == 0.0             # gain 0: nothing on the screens
