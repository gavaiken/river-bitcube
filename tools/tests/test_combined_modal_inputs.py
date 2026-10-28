"""Combined with Modal Input Selector: the selector's pure logic and Modal Frames journeys (no TouchDesigner)."""
import json
import math
import pathlib
import sys

import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td' / 'combined_modal'))
import selector  # noqa: E402
import frames_journey as fj  # noqa: E402


# ---- settings ---------------------------------------------------------------------------------------------------

def test_checked_accepts_and_refuses():
    assert selector.checked('scene', 0.6) == {'source': 'scene', 'strength': 0.6}
    for bad in (('rain', 0.5), ('scene', 1.5), ('scene', -0.1), ('scene', True), ('scene', float('nan')), ('scene', '0.5')):
        with pytest.raises(ValueError):
            selector.checked(*bad)


def test_load_defaults_and_roundtrip(tmp_path):
    p = tmp_path / 'combined-modal-inputs.json'
    assert selector.load(p) == {'source': 'canvas', 'strength': 0.18}
    p.write_text('{"source": "nope"}')
    assert selector.load(p) == selector.DEFAULT
    selector.save(p, {'source': 'frames', 'strength': 0.7})
    assert json.loads(p.read_text()) == {'source': 'frames', 'strength': 0.7}
    assert selector.load(p)['source'] == 'frames'
    assert not (tmp_path / 'combined-modal-inputs.json.tmp').exists()


# ---- fades ------------------------------------------------------------------------------------------------------

def run(f, t0, t1, dt=1 / 60):
    t = t0
    while t < t1:
        t += dt
        f.step(t)
    return t


def test_switch_fades_over_four_seconds():
    f = selector.Fader('canvas', 0.5)
    f.step(0.0)
    f.aim('scene', 0.0)
    run(f, 0, 2.0)
    assert 0 < f.mix('scene', 2.0) < 0.5 and 0 < f.mix('canvas', 2.0) < 0.5 and f.fading(2.0)
    run(f, 2.0, 4.1)
    assert f.mix('scene', 4.1) == pytest.approx(0.5) and f.mix('canvas', 4.1) == 0 and not f.fading(4.1)
    assert f.mix('off', 4.1) == 0


def test_strength_glides():
    f = selector.Fader('frames', 0.2)
    f.step(0)
    f.set_strength(1.0, 0.0)
    assert f.strength(0.0) == pytest.approx(0.2)
    assert 0.2 < f.strength(2.0) < 1.0
    assert f.strength(4.0) == pytest.approx(1.0)


def test_stale_fade_can_be_slower():
    f = selector.Fader('frames', 1.0)
    f.step(0)
    f.aim('off', 0.0, seconds=8.0)
    run(f, 0, 4.0)
    assert f.mix('frames', 4.0) == pytest.approx(0.5, abs=0.02)


# ---- scene ------------------------------------------------------------------------------------------------------

STATE = {'seq': 1, 'set_at': 'x', 'set_at_epoch': 1000.0,
         'scene': {'animation': 'drift', 'palette_name': 'deep', 'colors': ['#dce7f5', '#28354a'], 'speed': 0.2,
                   'density': 0.4, 'brightness': 0.7, 'turbulence': 0.3, 'transition_seconds': 60}}


def test_scene_info_staleness():
    assert selector.scene_info(STATE, 1060)[0] is True
    ok, age, reason, info = selector.scene_info(STATE, 1000 + 16 * 60)
    assert not ok and age == 960 and '15 min' in reason and info['palette_name'] == 'deep'
    assert selector.scene_info(None, 0)[0] is False
    assert 'placeholder' in selector.scene_info({'scene': {'placeholder': True}}, 0)[2]


def test_palette_slots_fixed_count_dark_to_light():
    slots = selector.palette_slots(['#ffffff', '#000080'])
    assert len(slots) == selector.PALETTE_SLOTS
    lum = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in slots]
    assert lum == sorted(lum)
    rows = selector.ramp_rows(slots)
    assert rows[0] == [0.0, 0.0, 0.0, 0.0, 1.0] and rows[-1][0] == 1.0
    assert selector.palette_slots(['nope']) is None


def test_scene_glides_and_reports_params():
    s = selector.Scene()
    s.update(STATE, None, now=0.0, now_wall=1001)
    assert s.values(0.0)['speed'] == pytest.approx(0.2)            # the first scene after a load: no glide
    nxt = json.loads(json.dumps(STATE))
    nxt['seq'], nxt['scene']['speed'], nxt['scene']['colors'] = 2, 0.8, ['#ff0000', '#00ff00', '#0000ff']
    s.update(nxt, None, now=10.0, now_wall=1011)
    assert s.values(40.0)['speed'] == pytest.approx(0.5)            # halfway through 60 s
    params = {p['name']: p for p in s.params(40.0, mix=1.0)}
    assert params['speed']['raw'] == 0.8 and params['speed']['value'] == 0.5
    assert params['palette']['raw'] == ['#ff0000', '#00ff00', '#0000ff'] and len(params['palette']['value']) == 6
    assert params['speed']['factor'] == pytest.approx(0.6 + 1.0 * 0.5)
    assert {p['name'] for p in s.params(40.0, 0)} == {'palette', 'speed', 'density', 'brightness', 'turbulence'}
    assert all(p['factor'] == 1.0 for p in s.params(40.0, 0) if 'factor' in p)


def test_reflex_offsets_reported_as_effective():
    s = selector.Scene()
    s.update(STATE, {'updated_epoch': 1000, 'ttl_seconds': 90, 'offsets': {'brightness': -0.2}}, 0.0, 1001)
    for _ in range(600):
        s.smooth_reflex(1 / 60)
    p = {q['name']: q for q in s.params(0.0, 1.0)}
    assert p['brightness']['effective'] < p['brightness']['value']


def test_factors_neutral_at_zero_mix():
    f = selector.factors({'speed': 1, 'density': 1, 'brightness': 1, 'turbulence': 1})
    assert f['brightness'] <= 1.25 and f['speed'] == pytest.approx(1.6)
    assert selector.applied(f['speed'], 0) == 1.0 and selector.applied(f['speed'], 1) == pytest.approx(1.6)


# ---- Modal Frames journeys --------------------------------------------------------------------------------------

def test_oklab_roundtrip():
    rgb = np.random.default_rng(0).random((50, 3)).astype(np.float32)
    assert np.allclose(fj.oklab_to_srgb(fj.srgb_to_oklab(rgb)), rgb, atol=2e-3)


def test_hue_takes_the_short_way():
    a = fj.lab_to_lch(fj.srgb_to_oklab(np.array([[1.0, 0.0, 0.2]], dtype=np.float32)))   # magenta-ish red
    b = fj.lab_to_lch(fj.srgb_to_oklab(np.array([[1.0, 0.2, 0.0]], dtype=np.float32)))   # orange-ish red
    mid = fj.lch_mix(a, b, 0.5)
    d = (mid[0, 2] - a[0, 2] + math.pi) % (2 * math.pi) - math.pi
    assert abs(d) < abs((b[0, 2] - a[0, 2] + math.pi) % (2 * math.pi) - math.pi)


def test_grey_does_not_swing_through_a_rainbow():
    grey = fj.lab_to_lch(fj.srgb_to_oklab(np.array([[0.5, 0.5, 0.5]], dtype=np.float32)))
    blue = fj.lab_to_lch(fj.srgb_to_oklab(np.array([[0.1, 0.2, 0.9]], dtype=np.float32)))
    for f in (0.25, 0.5, 0.75):
        assert fj.lch_mix(grey, blue, f)[0, 2] == pytest.approx(blue[0, 2], abs=1e-5)


def test_easing():
    assert fj.ease('linear', 0.5) == 0.5 and fj.ease('ease-in', 0.5) == 0.25
    assert fj.ease('ease-out', 0.5) == 0.75 and fj.ease('ease-in-out', 0.5) == 0.5
    assert fj.ease('ease-in-out', 2) == 1 and fj.ease('linear', -1) == 0


def test_journey_ends_exactly_on_target_and_passes_via():
    start = np.zeros((4, 2, 3), dtype=np.float32) + 0.8
    target = np.zeros((4, 2, 3), dtype=np.float32)
    target[..., 2] = 0.6
    j = fj.Journey(start, target, via=['#ff0000'], seconds=10, easing='linear', t0=0)
    assert np.allclose(j.colour(0), start, atol=3e-3)
    assert j.colour(10) is j.target_rgb
    mid = j.colour(5)                                               # at the via waypoint: pulled 60% toward red
    assert mid[0, 0, 0] > mid[0, 0, 1] and mid[0, 0, 0] > mid[0, 0, 2]


def test_element_mid_journey_restart_starts_from_now():
    el = fj.Element('ropes')
    a = np.ones((400, 20, 3), dtype=np.float32)
    el.set_target(a, 0.0, 8, 'linear', [], jump=True)
    assert el.now is not None and el.progress(0) == 1.0
    b = np.zeros_like(a)
    el.set_target(b, 0.0, 8, 'linear', [])
    el.step(4.0)
    half = el.now.copy()
    el.set_target(a, 4.0, 8, 'linear', [])
    assert np.allclose(el.now, half, atol=3e-3)                       # the new journey starts where it was
    el.step(12.0)
    assert np.allclose(el.now, a)


def test_river_settings_glide_and_left_out_fields_keep():
    el = fj.Element('screen-1')
    assert el.river(0) == fj.RIVER_DEFAULT
    el.set_river({'amount': 1.0}, 0.0, 10, 'linear')
    r = el.river(5.0)
    assert r['amount'] == pytest.approx(0.8) and r['contrast'] == 0.5 and r['speed'] == 1.0


def test_quiet_rules():
    sync = {'last_ok_epoch': 1000.0, 'not_found_since': None}
    assert fj.quiet(1010, 990, 120, sync, True) == (None, False, None)
    since, stale, why = fj.quiet(990 + 120 + 60, 990, 120, dict(sync, last_ok_epoch=1165), True)
    assert since == 1110 and not stale                                   # past ttl, still in the 120 s grace
    since, stale, why = fj.quiet(990 + 120 + 121, 990, 120, dict(sync, last_ok_epoch=1230), True)
    assert stale and 'ttl' in why
    since, stale, why = fj.quiet(1100, 990, 900, sync, True)            # polls failing for 100 s
    assert since == 1000 and not stale and 'not reaching' in why
    assert fj.quiet(1200, 990, 900, sync, True)[1] is True
    assert fj.quiet(1010, 990, 900, dict(sync, not_found_since=1005), True)[0] == 1005
    assert fj.quiet(0, 0, 0, None, False)[1] is True
    assert 'not running' in fj.quiet(2000, 990, 900, None, True)[2]


def _write_frame(folder, fid, elements, colour, mtime=None):
    d = folder / fid
    d.mkdir(parents=True, exist_ok=True)
    targets = json.loads((folder / 'targets.json').read_text()) if (folder / 'targets.json').exists() else {}
    els = {}
    for name in elements:
        w, h = fj.SIZES[name]
        (d / f'{name}.rgb').write_bytes(bytes(colour) * (w * h))
        targets[name] = f'{fid}/{name}'
        els[name] = {'image': f'/frames/{fid}/{name}.png', 'sha256': '0' * 64, 'river': {'amount': 0.3}}
    (folder / 'targets.json').write_text(json.dumps(targets))
    m = {'schema': 'modal-frames/1', 'layout_version': 1, 'frame_id': fid, 'issued_at': 'x', 'ttl_s': 120,
         'transition': {'duration_ms': 2000, 'easing': 'linear', 'space': 'oklch', 'via': []}, 'elements': els}
    (folder / 'latest.json').write_text(json.dumps(m))
    if mtime:
        import os
        os.utime(folder / 'latest.json', (mtime, mtime))


def test_frames_load_targets_then_journey(tmp_path):
    _write_frame(tmp_path, 'a', ['screen-1', 'ropes'], (255, 0, 0), mtime=1000)
    _write_frame(tmp_path, 'b', ['screen-1'], (0, 0, 255), mtime=1001)
    fr = fj.Frames(tmp_path)
    assert fr.poll(0.0, 1002) is True                                # first read: jumps, takes ropes from targets.json
    assert fr.has_target('ropes') and fr.has_target('screen-1') and not fr.has_target('screen-2')
    assert fr.elements['ropes'].now[0, 0, 0] == pytest.approx(1.0)
    assert fr.elements['screen-1'].now[0, 0, 2] == pytest.approx(1.0)
    assert fr.elements['ropes'].river(0)['amount'] == 0.6               # river settings of older frames are not kept
    assert fr.elements['screen-1'].river(0)['amount'] == 0.3
    assert fr.arrived == 1001
    assert fr.elements['ropes'].ref == 'a/ropes' and fr.elements['screen-1'].ref == 'b/screen-1'
    _write_frame(tmp_path, 'c', ['ropes'], (0, 255, 0), mtime=1010)
    assert fr.poll(5.0, 1010) is True
    fr.step(6.0)
    assert 0 < fr.elements['ropes'].now[0, 0, 1] < 1                   # mid-journey from red to green
    fr.step(7.0)
    assert fr.elements['ropes'].now[0, 0, 1] == pytest.approx(1.0)
    assert fr.elements['screen-1'].now[0, 0, 2] == pytest.approx(1.0)  # left out: keeps its target
    assert fr.poll(8.0, 1012) is False


def test_frames_rgb_orientation(tmp_path):
    """Row 0 of the .rgb file (the PNG's top row) stays row 0 = top."""
    d = tmp_path / 'f'
    d.mkdir()
    w, h = fj.SIZES['ropes']
    data = bytearray(w * h * 3)
    data[0:3] = b'\xff\xff\xff'                                         # top-left pixel white
    (d / 'ropes.rgb').write_bytes(bytes(data))
    a = fj.load_rgb(tmp_path, 'f/ropes')
    assert a.shape == (400, 20, 3) and a[0, 0, 0] == 1.0 and a[-1, 0, 0] == 0.0
