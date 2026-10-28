"""tools/remembered/zones.py: heights, pool line, rope feet, screens and eddies from a synthetic room."""
import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS / 'remembered'))
sys.path.insert(0, str(TOOLS))
import zones  # noqa: E402
from pixelmap import sphere  # noqa: E402

W, H = 1440, 808
HC = 2.0                     # camera height
PITCH = 0.02                 # m between LEDs
TOP, COIL = 5.0, 0.3         # rope top, coil top
CAM_DOWN = 12.0              # camera tilted down (deg)


def world_to_cam(pitch_deg=CAM_DOWN, roll_deg=1.5):
    """Rows: the camera's x (right), y (down), z (forward) in world coordinates (X right, Y down, Z forward)."""
    p, q = math.radians(pitch_deg), math.radians(roll_deg)
    r = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    roll = np.array([[math.cos(q), -math.sin(q), 0], [math.sin(q), math.cos(q), 0], [0, 0, 1]])
    return roll @ r


def rope_points(foot, n=400):
    """World positions (camera at the origin, Y down) of a rope hanging at foot (X, Z) into a coil on the floor."""
    x0, z0 = foot
    out, heights = [], []
    for i in range(n):
        h = TOP - PITCH * i
        if h >= COIL:
            p = (x0, HC - h, z0)
        else:                                              # a helix from the coil top down to the floor
            k = (h - COIL) / -PITCH                        # LEDs into the coil
            frac = min(1.0, k / (n - (TOP - COIL) / PITCH))
            hh = COIL * (1 - frac)
            a = k * 0.25
            p = (x0 + 0.25 * math.sin(a), HC - hh, z0 - 0.25 * math.cos(a))
            h = hh
        out.append(p)
        heights.append(h)
    return np.array(out, float), np.array(heights)


FEET = {r: (-1.2 + 0.2 * r, 3.6 + 0.5 * math.sin(r)) for r in range(12)}


def scene(seed=0):
    """{rope: (camera-space directions (400, 3), true heights, decoded mask)}; rope 7 missing, rope 5 barely seen,
    rope 9's bottom hidden."""
    rng = np.random.default_rng(seed)
    rc = world_to_cam()
    out = {}
    for r, foot in FEET.items():
        if r == 7:
            continue
        pw, h = rope_points(foot)
        d = pw @ rc.T
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        dec = rng.random(400) > 0.3
        front = pw[:, 2] <= foot[1] + 0.02                 # the back of the coil is hidden
        dec &= front
        elev = np.degrees(np.arcsin(-(pw[:, 1]) / np.linalg.norm(pw, axis=1)))
        dec &= elev < 30                                   # the camera doesn't see all the way up
        if r == 5:
            dec[:] = False
            dec[100:108] = True
        if r == 9:
            dec[:50] = False
            dec[180:] = False
        d = d + rng.normal(0, 0.0004, d.shape) * dec[:, None]
        out[r] = (d / np.linalg.norm(d, axis=1, keepdims=True), h, dec)
    return out


def multi_view_map(sc):
    cam = sphere.Cam(760, -0.04, W, H)
    alld = np.concatenate([d for d, _, _ in sc.values()])
    frame = sphere.make_frame(alld, cam.f, W / H)
    space = sphere.Space(cam, {'home': np.eye(3)}, frame)
    pts = []
    for r, (d, _, dec) in sc.items():
        uv = frame.uv(d)
        for i in range(400):
            pts.append({'rope': r, 'px': i, 'u': float(uv[i, 0]), 'v': float(uv[i, 1]), 'visible': bool(dec[i]),
                        'd': d[i].tolist()})
    return {'meta': {'frame_size': [W, H], 'space': space.to_meta()}, 'points': pts}, cam


def single_view_map(sc):
    cam = sphere.Cam((W / 2) / math.tan(math.radians(zones.HFOV_DEG / 2)), 0.0, W, H)
    pts = []
    for r, (d, _, dec) in sc.items():
        px = cam.project(d)
        for i in range(400):
            x, y = px[i]
            if np.isfinite(x) and 0 <= x < W and 0 <= y < H:
                pts.append({'rope': r, 'px': i, 'u': x / W, 'v': 1 - y / H, 'visible': bool(dec[i])})
    return {'meta': {'frame_size': [W, H]}, 'points': pts}, cam


def by_rope(z):
    return {r['rope']: r for r in z['ropes']}


def check_heights(z, sc, rel=0.08, ab=0.06, pmap=None):
    ropes = by_rope(z)
    for r, (_, h, dec) in sc.items():
        got = np.array(ropes[r]['heights'])
        if pmap is not None:                               # only what the map decoded
            dec = np.zeros(400, bool)
            dec[[p['px'] for p in pmap['points'] if p['rope'] == r and p['visible']]] = True
        hang = (h > COIL + 0.2) & dec
        if not hang.any():
            continue
        err = np.abs(got[hang] - h[hang])
        assert (err <= rel * h[hang] + ab).mean() > 0.9, (r, ropes[r]['method'], float(err.max()))


def test_down_is_found_from_the_ropes_spacing():
    sc = scene()
    pmap, _ = multi_view_map(sc)
    geom = zones.MapGeom(pmap)
    g, used, spread = zones.fit_down(geom.ropes)
    truth = world_to_cam() @ np.array([0, 1.0, 0])
    assert math.degrees(math.acos(min(1.0, float(g @ truth)))) < 1.0
    assert len(used) >= 8 and spread < 2


def test_multi_view_map_heights_pool_and_methods():
    sc = scene()
    pmap, _ = multi_view_map(sc)
    z = zones.build(pmap, cam_height_m=HC)
    ropes = by_rope(z)
    assert sorted(ropes) == list(range(20))
    assert all(len(r['heights']) == 400 for r in z['ropes'])
    assert ropes[7]['method'] == 'borrowed' and ropes[7]['borrowed_from'] == 6
    assert ropes[9]['method'] == 'pitch'
    assert ropes[5]['method'] in ('pitch', 'neighbours')
    assert sum(r['method'] == 'floor' for r in z['ropes']) >= 8
    check_heights(z, {r: v for r, v in sc.items() if r != 5})
    assert abs(z['meta']['led_pitch_m'] - PITCH) < 0.0025
    assert abs(z['meta']['coil_top_m'] - COIL) < 0.15
    truth_from = math.ceil((TOP - (COIL + 0.25)) / PITCH)
    expect = math.ceil((TOP - z['pool_height_m']) / PITCH)
    for r in ropes.values():
        if r['method'] == 'floor':
            assert abs(r['pool_from'] - expect) <= 12, (r['rope'], r['pool_from'], expect, truth_from)
    for r, (_, h, _) in sc.items():                         # every LED, extrapolated ones too, within ~30 cm
        assert np.abs(np.array(ropes[r]['heights']) - h).max() < 0.35, r
    # extrapolated: the top LEDs the camera never saw
    assert ropes[0]['extrapolated'][0][0] == 0
    assert z['meta']['cam_height_m'] == HC and z['meta']['pool_above_coil_m'] == 0.25


def test_pool_height_is_a_parameter():
    sc = scene()
    pmap, _ = multi_view_map(sc)
    z = zones.build(pmap, cam_height_m=HC, pool_height_m=1.0)
    assert z['pool_height_m'] == 1.0
    for r in z['ropes']:
        if r['pool_from'] < 400:
            assert r['heights'][r['pool_from']] <= 1.0
            assert r['pool_from'] == 0 or r['heights'][r['pool_from'] - 1] > 1.0


def test_rope_feet_are_under_the_ropes_in_the_show_view():
    sc = scene()
    pmap, cam = multi_view_map(sc)
    z = zones.build(pmap, cam_height_m=HC)
    rc = world_to_cam()
    for f in z['feet']:
        if f['rope'] not in FEET or f['rope'] in (5, 7):
            continue
        x0, z0 = FEET[f['rope']]
        px = cam.project((rc @ np.array([x0, HC, z0]))[None])[0]
        assert abs(f['x'] - px[0] / W) < 0.03 and abs(f['y'] - px[1] / H) < 0.05, f
    assert next(f for f in z['feet'] if f['rope'] == 7)['borrowed_from'] == 6


def test_single_view_map_gives_the_same_heights():
    sc = scene()
    pmap, _ = single_view_map(sc)
    z = zones.build(pmap, cam_height_m=HC)
    sc_seen = {r: v for r, v in sc.items() if r not in (5,)}
    check_heights(z, sc_seen, rel=0.1, pmap=pmap)


def test_screens_height_and_tilt():
    sc = scene()
    pmap, cam = multi_view_map(sc)
    rc = world_to_cam()
    # a 0.5 x 1.0 m screen, centre 3 m up, between ropes 4 and 5, its top leaning 10 degrees right as seen
    cx, cz = (FEET[4][0] + FEET[5][0]) / 2, (FEET[4][1] + FEET[5][1]) / 2
    a = math.radians(10)
    up, right = np.array([math.sin(a), -math.cos(a), 0]), np.array([math.cos(a), math.sin(a), 0])
    c = np.array([cx, HC - 3.0, cz])
    corners = {'tl': c + 0.5 * up - 0.25 * right, 'tr': c + 0.5 * up + 0.25 * right,
               'br': c - 0.5 * up + 0.25 * right, 'bl': c - 0.5 * up - 0.25 * right}
    space = sphere.Space.from_meta(pmap['meta']['space'])
    scr = {k: [float(x) for x in space.frame.uv((rc @ p)[None] / np.linalg.norm(p))[0]] for k, p in corners.items()}
    z = zones.build(pmap, cam_height_m=HC, screens={'meta': {}, 'screens': {'2': scr, '1': scr | {'estimated': True}}})
    s2 = next(s for s in z['screens'] if s['screen'] == 2)
    assert abs(s2['height_m'] - 3.0) < 0.25 and abs(s2['tilt_deg'] - 10) < 3, s2
    assert next(s for s in z['screens'] if s['screen'] == 1)['estimated'] is True


def test_eddies_from_log_outlines():
    sc = scene()
    pmap, _ = multi_view_map(sc)
    geom = zones.MapGeom(pmap)
    xy = geom.ropes[2]['xy'][150:171]
    (x0, y0), (x1, y1) = xy.min(axis=0) - 0.003, xy.max(axis=0) + 0.003
    logs = [{'name': 'big log', 'polygon': [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}]
    ed = zones.eddies(geom, logs)
    mine = [e for e in ed if e['rope'] == 2]
    assert len(mine) == 1 and mine[0]['from'] <= 150 and mine[0]['to'] >= 170 and mine[0]['log'] == 'big log'
    assert mine[0]['to'] - mine[0]['from'] < 40


def test_inside_and_ranges():
    sq = [[0, 0], [1, 0], [1, 1], [0, 1]]
    assert zones.inside(np.array([[0.5, 0.5], [1.5, 0.5], [np.nan, 0.5]]), sq).tolist() == [True, False, False]
    assert zones.ranges([False, True, True, False, True]) == [[1, 2], [4, 4]]


def test_light_modes_and_control_file(tmp_path):
    z = {'pool_height_m': 0.5, 'ropes': [{'rope': 0, 'heights': [2.0] * 300 + [0.2] * 100},
                                          {'rope': 1, 'heights': [2.0] * 400}],
         'eddies': [{'rope': 3, 'from': 10, 'to': 20, 'log': 'a'}]}
    assert zones.light_ranges('pool', z) == [{'rope': 0, 'from': 300, 'to': 399}]
    assert zones.light_ranges('pool', z, pool_height_m=3.0)[1] == {'rope': 1, 'from': 0, 'to': 399}
    assert zones.light_ranges('eddies', z) == [{'rope': 3, 'from': 10, 'to': 20}]
    assert zones.light_ranges('leds', specs=['3:120-140', '5:7']) == [{'rope': 3, 'from': 120, 'to': 140},
                                                                      {'rope': 5, 'from': 7, 'to': 7}]
    assert zones.light_ranges('off') == []
    with pytest.raises(ValueError):
        zones.parse_leds(['three'])
    out = tmp_path / 'remembered' / 'control.json'
    zf = tmp_path / 'zones-2026-10-28.json'
    zf.write_text(json.dumps(z))
    zones.main(['light', 'pool', '--zones', str(zf), '--write', str(out)])
    c = json.loads(out.read_text())
    assert c['zones'] == {'file': 'zones-2026-10-28.json', 'light': 'pool', 'leds': [{'rope': 0, 'from': 300, 'to': 399}]}


def test_build_and_still_from_the_cli(tmp_path):
    sc = scene()
    pmap, _ = multi_view_map(sc)
    mp = tmp_path / 'pixelmap-2026-10-28.json'
    mp.write_text(json.dumps(pmap))
    logs = tmp_path / 'logs-2026-10-28.json'
    logs.write_text(json.dumps([{'name': 'log', 'polygon': [[0.4, 0.8], [0.6, 0.8], [0.6, 0.9], [0.4, 0.9]]}]))
    out = tmp_path / 'zones.json'
    zones.main(['build', '--map', str(mp), '--logs', str(logs), '--cam-height-m', '2.0', '--out', str(out)])
    z = json.loads(out.read_text())
    assert z['meta']['map'] == mp.name and z['meta']['logs'] == logs.name and len(z['ropes']) == 20
    png = tmp_path / 'still.png'
    zones.main(['still', '--map', str(mp), '--zones', str(out), '--logs', str(logs), '--out', str(png)])
    from PIL import Image
    assert Image.open(png).size == (W, H)


def test_old_map_without_a_floor_asks_for_a_distance():
    m = json.loads((TOOLS / 'pixelmap' / 'pixelmap-2026-10-23.json').read_text())
    with pytest.raises(ValueError, match='rope-distance-m'):
        zones.build(m)
    z = zones.build(m, rope_distance_m=4.0)
    assert len(z['ropes']) == 20 and all(r['method'] == 'given' for r in z['ropes'])
