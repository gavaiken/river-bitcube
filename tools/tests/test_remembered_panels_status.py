"""The remembered river on the four screens (td/remembered/panels.py) and its status.json (td/remembered/status.py,
show.py): at most 30 % of each screen lit, cap 55 %, soft edges, calm almost black, different crops; status.json in
exactly the contract's shape (docs/remembered-river.md section 5); control.json shapes; reflex freshness."""
import datetime as dt
import gzip
import json
import pathlib
import re
import sys

import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import clock  # noqa: E402
from remembered import palette  # noqa: E402
from remembered import panels  # noqa: E402
from remembered import ropes  # noqa: E402
from remembered import show  # noqa: E402
from remembered import zones  # noqa: E402

T0 = 1_800_000_000.0


def noisy_river(rng, n=1):
    """Busy water: lots of motion everywhere (the worst case for the lit limit)."""
    return [(rng.random((180, 320, 3)) * 255).astype(np.uint8) for _ in range(n)]


def run_panels(phase_t, times, day, seconds=6.0, tilt=0.0, seed=0):
    z = zones.Zones({'screens': [{'screen': k, 'tilt_deg': tilt} for k in range(1, 5)]})
    p = panels.Panels(z, seed)
    rng = np.random.default_rng(seed)
    img = None
    for i in range(int(seconds * 30)):
        if i % 3 == 0:
            p.feed(noisy_river(rng)[0])
        t = phase_t - seconds + i / 30
        c = ropes.default_ctx(t=t, times=times, phase=clock.phase_at(t, times), pal=palette.palette('autumn'),
                              flow_pct=90, day=day, rope_speed=80.0)
        img = p.step(1 / 30, c)
    return p, img


@pytest.fixture(scope='module')
def day():
    prof = {'flow': [10 + h for h in range(24)], 'rain': [0.0] * 12 + [5.0] * 3 + [0.0] * 9, 'is_day': [1] * 24}
    return clock.make_day('2017-01-08', prof, {'flow_pct': 90, 'heaviest_hour': 13, 'dry': False})


def quads(img):
    return [img[:, 128 * k:128 * (k + 1)] for k in range(4)]


@pytest.mark.parametrize('tilt', [0.0, -4.5])
def test_surge_lights_every_screen_but_at_most_30_percent(day, tilt):
    times = clock.phase_times(day, 150.0)
    p, img = run_panels(times['surge'] + 20, times, day, tilt=tilt)
    assert img.shape == (256, 512, 3) and img.max() <= panels.CAP + 1e-6
    for q in quads(img):
        lit = panels.lit_fraction(q)
        assert 0.02 < lit <= panels.LIT_MAX
    assert all(0 < v <= 30 for v in p.lit_pct)


def test_calm_is_almost_black(day):
    times = clock.phase_times(day, 150.0)
    p, img = run_panels(40.0, times, day, seconds=10)
    for q in quads(img):
        assert panels.lit_fraction(q) <= 0.03
    assert (img > 0).mean() < 0.02


def test_screens_show_different_crops_outside_a_surge(day):
    times = clock.phase_times(day, 150.0)
    p, img = run_panels(times['surge'] + 25, times, day)
    q = quads(img)
    for a in range(4):
        for b in range(a + 1, 4):
            assert not np.allclose(q[a], q[b])


def test_soft_edges_and_cap(day):
    times = clock.phase_times(day, 150.0)
    p, img = run_panels(times['surge'] + 20, times, day)
    for q in quads(img):
        assert q[0].max() == 0 and q[-1].max() == 0 and q[:, 0].max() == 0 and q[:, -1].max() == 0
    assert img.max() <= 0.55


def test_cap_lit_keeps_only_the_brightest():
    rng = np.random.default_rng(1)
    i = rng.random((256, 128)).astype(np.float32)
    out = panels.cap_lit(i, 0.3)
    assert (out > panels.LIT_EPS).mean() <= 0.3 and out.max() == i.max()


def test_screens_light_in_height_order_as_the_front_passes(day):
    z = zones.Zones()
    p = panels.Panels(z)
    times = clock.phase_times(day, 150.0)
    c = ropes.default_ctx(times=times, flow_pct=90, t=0.0)
    ft = p._front_times(c)
    order = z.screen_order()
    assert [ft[i] for i in order] == sorted(ft) and ft[order[0]] >= times['surge']


# ---- status.json ------------------------------------------------------------------------------------------------

def contract():
    text = (ROOT / 'docs' / 'remembered-river.md').read_text(encoding='utf-8')
    sec = text[text.index('## 5.'):]
    block = re.search(r'```json\n(.*?)```', sec, re.S).group(1)
    return json.loads(block)


def same_shape(a, b, path='status'):
    assert type(a) is dict and type(b) is dict, path
    assert set(a) == set(b), f'{path}: {sorted(set(a) ^ set(b))}'
    for k, v in b.items():
        if isinstance(v, dict) and k != 'reflex':
            same_shape(a[k], v, f'{path}.{k}')


def iso(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def test_status_json_matches_the_contract(tmp_path):
    river = tmp_path / 'River'
    (river / 'gallery_state').mkdir(parents=True)
    prof = {'flow': [10 + h for h in range(24)], 'rain': [0.0] * 12 + [5.0] * 3 + [0.0] * 9, 'temp': [5.0] * 24,
            'snow': [0.0] * 24, 'is_day': [0] * 7 + [1] * 11 + [0] * 6}
    (river / 'gallery_state' / 'state.json').write_text(json.dumps({
        'seq': 3, 'scene': {'colors': ['#0b3d5c', '#1f8fb3', '#bfefff'], 'speed': 0.6, 'density': 0.4, 'brightness': 0.7,
                            'turbulence': 0.3, 'transition_seconds': 60},
        'memory': {'date': '2017-02-07', 'reason': 'like today', 'chosen_by': 'resemblance', 'chosen_at': iso(T0 - 10),
                   'stats': {'flow_pct': 96, 'rain_mm': 38.5, 'heaviest_hour': 14, 'season': 'winter', 'dry': False,
                             'cold': True}, 'profile': prof},
        'surge_at': 13.5}))
    import os
    os.utime(river / 'gallery_state' / 'state.json', (T0, T0))
    (river / 'gallery_state' / 'reflex.json').write_text(json.dumps(
        {'updated_epoch': T0, 'ttl_seconds': 90, 'offsets': {'speed': 0.05}, 'heard': 0.62}))
    (river / 'presence.json').write_text(json.dumps({'t': T0, 'count': 2, 'people': [],
                                                     'lingerers': [{'x': 0.4, 'y': 0.8, 'still_s': 12, 'ropes': [7, 8]}]}))
    s = show.Show(river_dir=river, data_dir=tmp_path / 'none', seed=1)
    rng = np.random.default_rng(0)
    for i in range(90):
        now = T0 + i / 30
        if i % 3 == 0:
            s.feed_river(noisy_river(rng)[0], 'live', now)
        s.tick(now, 1 / 30, 30)
    out = json.loads((river / 'remembered' / 'status.json').read_text())
    same_shape(out, contract())
    assert out['show'] == 'river-remembered.toe' and out['day']['source'] == 'dave' and out['day']['date'] == '2017-02-07'
    assert out['surge'] == {'hour': 13.5, 't_s': 168.8, 'why': 'Dave: hour 13.5', 'room_shift_s': 0}
    assert out['ropes_follow'] == 'sound' and out['heard'] == 0.62 and out['river_source'] == 'live'
    assert out['room']['lingerers'][0]['ropes'] == [7, 8] and out['loop']['length_s'] == 300
    assert len(out['palette']) == 3 and all(re.fullmatch(r'#[0-9a-f]{6}', c) for c in out['palette'])
    assert len(out['panels']['lit_pct']) == 4 and 0.39 <= out['panels']['cap'] <= 1.0
    assert out['zones'] == {'file': 'default', 'pool_height_m': 0.25, 'light': 'off'}
    assert out['knobs']['reflex']['speed'] > 0
    assert not (river / 'remembered' / 'status.json.tmp').exists()


def test_stale_dave_falls_back_to_notable_days(tmp_path):
    river = tmp_path / 'River'
    (river / 'gallery_state').mkdir(parents=True)
    (river / 'gallery_state' / 'state.json').write_text(json.dumps({'memory': {
        'date': '2017-02-07', 'chosen_at': iso(T0 - 600), 'profile': {'flow': [1] * 24}}}))
    data = tmp_path / 'data'
    data.mkdir()
    (data / 'notable.json').write_text(json.dumps([{'date': '2005-12-31', 'kind': 'flood', 'line': 'a flood'}]))
    with gzip.open(data / 'profiles.json.gz', 'wt') as f:
        json.dump({'2005-12-31': {'flow': [5] * 24, 'rain': [1.0] * 24}}, f)
    s = show.Show(river_dir=river, data_dir=data)
    s.tick(T0, 0.0)
    st = s.last_status
    assert st['day']['source'] == 'fallback' and st['day']['date'] == '2005-12-31' and st['day']['reason'] == 'a flood'
    assert st['ropes_follow'] == 'picture' and st['heard'] is None and st['river_source'] == 'none'


def test_opening_night_by_default_surges_on_a_dry_day(tmp_path):
    river = tmp_path / 'River'
    data = tmp_path / 'data'
    data.mkdir()
    (data / 'notable.json').write_text(json.dumps([{'date': '2008-10-02', 'kind': 'drought', 'line': 'a drought'}]))
    with gzip.open(data / 'profiles.json.gz', 'wt') as f:
        json.dump({'2008-10-02': {'flow': [1] * 24, 'rain': [0.0] * 24}}, f)
    s = show.Show(river_dir=river, data_dir=data)
    s.tick(T0, 0.0)
    st = s.last_status
    assert st['opening_night'] is True and st['day']['date'] == '2008-10-02'
    assert st['surge']['t_s'] == 150.0 and st['surge']['why'] == 'Opening night: a surge every loop (the day was dry)'
    (river / 'remembered').mkdir(parents=True, exist_ok=True)
    (river / 'remembered' / 'control.json').write_text(json.dumps({'opening_night': False}))
    s2 = show.Show(river_dir=river, data_dir=data)
    s2.tick(T0, 0.0)
    assert s2.last_status['opening_night'] is False and s2.last_status['surge']['t_s'] is None


def test_control_json_shapes():
    assert show.parse_control(None) == show.CONTROL_DEFAULT
    c = show.parse_control({'t': 1, 'zones': {'file': 'zones-x.json', 'light': 'leds', 'pool_height_m': 0.6,
                                              'leds': [{'rope': 1, 'from': 2, 'to': 3}]}})
    assert c == {'pool_height_m': 0.6, 'light': 'leds', 'leds': [{'rope': 1, 'from': 2, 'to': 3}], 'opening_night': True,
                 'screen_intensity': None, 'screen_threshold': None, 'screen_mode': 'particles',
                 'screen_video': 0.35, 'screen_field': 'ribbons', 'screen_gpu': True}
    assert show.parse_control({'screens': {'field': 'fine'}})['screen_field'] == 'fine'
    assert show.parse_control({'screens': {'field': 'lasers'}})['screen_field'] == 'ribbons'
    assert show.CONTROL_DEFAULT['opening_night'] is True                   # opening night is on unless told otherwise
    assert show.parse_control({'light': 'pool', 'opening_night': False})['opening_night'] is False
    assert show.parse_control({'opening': {'on': False}})['opening_night'] is False
    assert show.parse_control({'light': 'strobe', 'pool_height_m': 99})['light'] == 'off'


def test_heard_only_while_the_reflex_is_fresh():
    r = {'updated_epoch': T0, 'ttl_seconds': 90, 'heard': 0.4}
    assert show.heard_of(r, T0 + 10) == 0.4
    assert show.heard_of(r, T0 + 91) is None
    assert show.heard_of({'heard': 0.4, '_mtime': T0}, T0 + 60) == 0.4
    assert show.heard_of({'heard': 0.4, '_mtime': T0}, T0 + 120) is None
    assert show.heard_of({'updated_epoch': T0, 'heard': None}, T0) is None


def test_td_images_are_contiguous_and_upright():
    s = show.Show(river_dir='/nonexistent-river-dir')
    s.rope_frame[3, 0] = (1, 0, 0)                  # LED 0 of rope 3 = the top row of the TOP
    img = show.rope_image(s)
    assert img.shape == (400, 20, 4) and img.flags['C_CONTIGUOUS'] and img.dtype == np.float32
    assert img[-1, 3, 0] == 1.0                      # TD rows start at the bottom: the last row is the top
    s.panel_frame[0, 5] = (0, 1, 0)
    p = show.panel_image(s)
    assert p.shape == (256, 512, 4) and p.flags['C_CONTIGUOUS'] and p[-1, 5, 1] == 1.0


def test_build_script_and_registry_entry():
    import ast
    src = (ROOT / 'td' / 'build' / 'build_remembered.py').read_text(encoding='utf-8')
    ast.parse(src)
    assert "registry.require_build(project.name, 'td/build/build_remembered.py')" in src
    assert 'registry.zones_for(TOE)' in src and "'river-remembered.toe'" in src   # (river-looks.toe overrides TOE)
    assert 'videostreaminTOP' not in src and 'project.save' not in src
    # GLSL only for the GPU ribbons (ribbons_gpu.py, 28 Oct), and only shaders that can't hang the Iris Xe driver (19 Oct):
    # every input read behind a TD_NUM_2D_INPUTS guard, inputs indexed by literal constants
    import re
    sys.path.insert(0, str(ROOT / 'td'))
    from remembered import ribbons_gpu
    for text in (ribbons_gpu.DRAW_GLSL, ribbons_gpu.TRAIL_GLSL, ribbons_gpu.OUT_GLSL):
        assert 'TD_NUM_2D_INPUTS' in text
        assert set(re.findall(r'sTD2DInputs\[([^\]]*)\]', text)) <= {'0', '1', '2'}
    assert src.count('glslTOP') == 1 and 'ribbons_gpu.' in src
    entry = next(s for s in json.loads((ROOT / 'shows.json').read_text())['shows'] if s['file'] == 'river-remembered.toe')
    assert entry['build'] == 'td/build/build_remembered.py' and entry['kind'] == 'show'
    assert entry['offered'] is False or (ROOT / 'river-remembered.toe').is_file()     # offered once the .toe lands
    assert (ROOT / 'docs' / 'files' / 'river-remembered.md').is_file()
    assert 'files/river-remembered.html' in (ROOT / 'docs' / 'show-files.md').read_text(encoding='utf-8')
