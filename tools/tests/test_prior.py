"""tools/pixelmap/prior.py: a new calibration checked against the previous one in 3D (the lights didn't move)."""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'pixelmap'))
import prior  # noqa: E402

MAP, ZONES = ROOT / 'tools/pixelmap/pixelmap-2026-10-27.json', ROOT / 'tools/pixelmap/zones-2026-10-27.json'


def test_a_camera_move_is_recovered_and_stray_decodes_replaced(tmp_path):
    m, z = json.loads(MAP.read_text()), json.loads(ZONES.read_text())
    P, vis = prior.places(m, z)
    down = np.array(z['meta']['down'])
    right = np.array([1.0, 0, 0]) - down * down[0]
    right /= np.linalg.norm(right)
    true = np.r_[np.radians([0.5, -3.0, 0.3]), -0.6 * right]
    ok = np.isfinite(P).all(-1)
    dn = np.full_like(P, np.nan)
    dn[ok] = prior.project(true, P[ok])
    rng = np.random.default_rng(1)
    bad = (rng.random(dn.shape[:2]) < 0.06) & vis & ok
    clean = dn.copy()
    dn[bad] += rng.normal(0, 0.05, (bad.sum(), 3))
    dn /= np.linalg.norm(dn, axis=-1, keepdims=True)
    off = np.degrees(np.arccos(np.clip(np.sum(np.nan_to_num(dn) * np.nan_to_num(clean), -1), -1, 1)))
    bad = bad & (off > 1.5)                                   # the strays that really are somewhere else
    pts = [{'rope': r, 'px': i, 'u': 0, 'v': 0, 'visible': bool(vis[r, i]),
            'd': None if not np.isfinite(dn[r, i]).all() else dn[r, i].tolist(), 'hu': 0, 'hv': 0}
           for r in range(20) for i in range(400)]
    new = dict(m, points=pts)
    (tmp_path / 'new.json').write_text(json.dumps(new))
    prior.main(['--old-map', str(MAP), '--old-zones', str(ZONES), '--new-map', str(tmp_path / 'new.json'),
                '--out-map', str(tmp_path / 'out.json')])
    out = json.loads((tmp_path / 'out.json').read_text())
    move = out['meta']['prior']['camera_move_m']
    assert abs(move[0] + 0.6) < 0.02 and abs(move[1]) < 0.02 and abs(move[2]) < 0.02
    replaced = {(p['rope'], p['px']) for p in out['points'] if p['prior']}
    assert all((r, i) in replaced for r, i in zip(*np.nonzero(bad)))   # every stray decode taken from the prior
