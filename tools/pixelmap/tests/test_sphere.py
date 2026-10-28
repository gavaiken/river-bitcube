"""tools/pixelmap/sphere.py: views of the same lights from a turning camera are put back together exactly."""
import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pixelmap import sphere  # noqa: E402

W, H = 1440, 808


def ropes(n_ropes=20, n_px=400, seed=1):
    """Hanging ropes as directions in home coordinates: from high above the home view (y < 0 is up) down into it."""
    rng = np.random.default_rng(seed)
    out = {}
    for r in range(n_ropes):
        x0 = rng.uniform(-0.35, 0.35)
        for p in range(n_px):
            t = p / (n_px - 1)
            d = np.array([x0 + 0.05 * math.sin(6 * t + r), -1.1 + 1.5 * t, 1.0])
            out[(r, p)] = d / np.linalg.norm(d)
    return out


def observe(dirs, cam, r, noise=0.3, seed=2):
    rng = np.random.default_rng(seed)
    keys = list(dirs)
    px = cam.project(np.array([dirs[k] for k in keys]) @ r.T) + rng.normal(0, noise, (len(keys), 2))
    return {k: (x, y, 9) for k, (x, y) in zip(keys, px) if 0 <= x < W and 0 <= y < H}


def test_rotation_round_trip():
    for w in ([0.3, -0.2, 0.1], [0, 0, 0], [0.6, 0, 0]):
        assert np.allclose(sphere.rotvec(sphere.rot(w)), w, atol=1e-9)


def test_lens_round_trip():
    cam = sphere.Cam(700, -0.08, W, H)
    px = np.array([[10.0, 20.0], [720, 404], [1400, 790]])
    assert np.allclose(cam.project(cam.rays(px)), px, atol=1e-6)


def test_two_views_tilted_up_are_put_together():
    truth = sphere.Cam(760, -0.06, W, H)
    up = sphere.rot([math.radians(-35), 0, 0])            # tilt up 35 degrees
    dirs = ropes()
    obs = {'home': observe(dirs, truth, np.eye(3)), 'up': observe(dirs, truth, up)}
    assert 300 < len(set(obs['home']) & set(obs['up'])) < len(dirs)           # overlap, and each sees lights the other doesn't
    cam, rots, rep = sphere.fit_views(obs, W, H, 'home')
    assert abs(cam.f - 760) < 8 and abs(cam.k1 + 0.06) < 0.02
    assert np.degrees(np.linalg.norm(sphere.rotvec(rots['up'] @ up.T))) < 0.2
    assert rep['up']['rms_px'] < 1.5
    assert abs(rep['up']['pan_tilt_roll'][1] - 35) < 0.3        # reported as tilt up +35


def test_frame_holds_every_light_at_the_cameras_aspect():
    dirs = np.array(list(ropes().values()))
    fr = sphere.make_frame(dirs, 760, W / H)
    uv = fr.uv(dirs)
    assert uv.min() > 0 and uv.max() < 1
    assert abs(fr.fw / fr.fh - W / H) < 1e-6
    assert np.allclose(fr.uv_to_dirs(uv), dirs, atol=1e-9)
    top, bottom = dirs[np.argmin(dirs[:, 1])], dirs[np.argmax(dirs[:, 1])]     # up in the room is up in the frame
    assert fr.uv(top)[0, 1] > 0.85 and fr.uv(bottom)[0, 1] < 0.15


def test_space_round_trip_through_meta():
    cam = sphere.Cam(760, -0.06, W, H)
    rots = {'home': np.eye(3), 'up': sphere.rot([-0.6, 0.02, 0])}
    fr = sphere.make_frame(np.array(list(ropes().values())), cam.f, W / H)
    sp = sphere.Space.from_meta(sphere.Space(cam, rots, fr).to_meta())
    px = np.array([[300.0, 200.0], [1000, 600]])
    assert np.allclose(sp.uv_to_view_px('up', sp.view_px_to_uv('up', px)), px, atol=1e-3)


def test_views_that_do_not_overlap_are_refused():
    truth = sphere.Cam(760, 0, W, H)
    dirs = ropes()
    obs = {'home': observe(dirs, truth, np.eye(3)), 'away': observe(dirs, truth, sphere.rot([0, math.radians(120), 0]))}
    obs['away'] = dict(list(obs['away'].items())[:5]) | {('x', 1): (5, 5, 9)}
    with pytest.raises(sphere.RegistrationError, match='overlap'):
        sphere.fit_views(obs, W, H, 'home')


def test_decode_puts_a_two_view_session_into_one_map(tmp_path, monkeypatch):
    """decode.main on one capture of a session: finds the other view, stitches them, every LED placed once in 0..1,
    with its direction and where it is in the home view; the rope that only the up view sees is in the map too."""
    import json
    from PIL import Image
    from pixelmap import decode
    truth = sphere.Cam(760, -0.05, W, H)
    up = sphere.rot([math.radians(-35), 0, 0])
    dirs = ropes(n_ropes=6, seed=3)
    views = {'home': np.eye(3), 'up': up}
    for i, (name, r) in enumerate(views.items()):
        c = tmp_path / f'pixelmap-2026102{i}-120000'
        (c / 'A').mkdir(parents=True)
        for s in 'pn':
            Image.new('RGB', (W, H)).save(c / 'A' / f'b00{s}.png')
        (c / 'meta.json').write_text(json.dumps({'mode': 'ropes', 'date': '20261027', 'session': 'S1', 'view': name,
                                                 'view_index': i, 'ptz': [3241, 0 if i == 0 else 900], 'drift': 1.0}))
    def fake_aggregate(rope, px, conf):
        name = conf                                              # the fake decode_pair passes the view's name here
        u = np.full((20, 400), np.nan); v = u.copy(); n = np.zeros((20, 400), int)
        for (r, p), (x, y, _) in observe(dirs, truth, views[name]).items():
            u[r, p], v[r, p], n[r, p] = x / W, 1 - y / H, 9
        return u, v, n
    monkeypatch.setattr(decode, 'load_pass', lambda folder: folder.parent)
    monkeypatch.setattr(decode, 'decode_pair', lambda a, b, **kw: (
        np.full((H, W), -1), np.full((H, W), -1), json.loads((a / 'meta.json').read_text())['view']))
    monkeypatch.setattr(decode, 'aggregate', fake_aggregate)
    monkeypatch.setattr(decode, 'overlay', lambda *a, **k: Image.new('RGB', (4, 4)))
    out = tmp_path / 'map.json'
    decode.main(tmp_path / 'pixelmap-20261021-120000', out)
    m = json.loads(out.read_text())
    assert m['meta']['captures'] == ['pixelmap-20261020-120000', 'pixelmap-20261021-120000']
    assert sorted(m['ropes']) == [str(r) for r in range(6)] and len(m['points']) == 6 * 400
    uv = np.array([[p['u'], p['v']] for p in m['points']])
    assert uv.min() > 0 and uv.max() < 1
    sp = sphere.Space.from_meta(m['meta']['space'])
    for p in m['points'][::97]:
        if p['visible']:
            assert np.degrees(np.arccos(np.clip(np.dot(p['d'], dirs[(p['rope'], p['px'])]), -1, 1))) < 0.3
    hidden_from_home = [p for p in m['points'] if p['visible'] and p['hv'] is not None and p['hv'] > 1]
    assert hidden_from_home                                         # lights above the show position: placed anyway
    assert (tmp_path / 'pixelmap-20261020-120000' / 'panorama.png').exists()
    assert sp.views['up']['ptz'] == [3241, 900]


def test_camera_shift_sees_movement_not_light():
    from pixelmap.capture import camera_shift
    rng = np.random.default_rng(0)
    img = rng.uniform(0, 255, (200, 300, 3)).astype(np.float32)
    img[50:120, 80:200] += 80
    assert camera_shift(img, img * 0.6 + 30) == 0                     # the room brightened: no movement
    moved = np.roll(np.roll(img, 3, axis=0), -4, axis=1)
    assert camera_shift(img, moved) == pytest.approx(5.0)
