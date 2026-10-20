"""Pure parts of td/modal/modal_scene.py: Dave's scene -> look multipliers, palette, glide (no TD)."""
import importlib.util
import pathlib

import pytest

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'td' / 'modal' / 'modal_scene.py'


@pytest.fixture
def ms():
    spec = importlib.util.spec_from_file_location('modal_scene_under_test', MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


STATE = {'seq': 7, 'set_at_epoch': 1000.0, 'scene': {
    'animation': 'flow', 'palette_name': 'ember-in-the-deep',
    'colors': ['#987050', '#18204a', '#607090', '#909878', '#284060'],
    'speed': 0.47, 'density': 0.78, 'brightness': 0.37, 'turbulence': 0.84,
    'transition_seconds': 240.0, 'placeholder': False}}


def test_neutral_scene_keeps_the_tuned_look(ms):
    f = ms.factors(ms.NEUTRAL)
    assert all(v == pytest.approx(1.0) for v in f.values())


def test_scene_values_and_palette_dark_to_bright_with_black_first(ms):
    sv = ms.scene_values(STATE)
    assert sv['knobs']['turbulence'] == 0.84 and sv['transition'] == 240.0 and sv['seq'] == 7
    keys = sv['keys']
    assert keys[0] == [0.0, 0.0, 0.0, 0.0, 1.0] and keys[-1][0] == 1.0 and len(keys) == 6
    lum = [ms.luminance(k[1:4]) for k in keys]
    assert lum == sorted(lum)


def test_placeholder_or_missing_scene_is_ignored(ms):
    assert ms.scene_values({'scene': {'placeholder': True}}) is None
    assert ms.scene_values({}) is None
    assert ms.palette_keys(['not a colour']) is None


def test_gain_is_capped_and_turbulence_shortens_memory(ms):
    f = ms.factors({'speed': 1, 'density': 1, 'brightness': 1, 'turbulence': 1})
    assert f['Gain'] == ms.GAIN_CAP
    assert f['Memory'] < ms.factors({'speed': 0, 'density': 0, 'brightness': 0, 'turbulence': 0})['Memory']


def test_blend_mix_zero_is_the_tuned_value(ms):
    assert ms.blend(0.012, 1.7, 0.0) == 0.012
    assert ms.blend(0.012, 1.5, 1.0) == pytest.approx(0.018)


def test_reflexes_only_while_fresh(ms):
    r = {'updated_epoch': 100.0, 'ttl_seconds': 90, 'offsets': {'speed': 0.2, 'turbulence': -0.1}}
    assert ms.reflex_offsets(r, 150.0)['speed'] == 0.2
    assert ms.reflex_offsets(r, 200.0)['speed'] == 0.0
    assert ms.reflex_offsets(None, 0)['density'] == 0.0


def test_glide_moves_linearly_and_restarts_from_where_it_is(ms):
    g = ms.Glide([0.0])
    g.go([1.0], now=10.0, seconds=10.0)
    assert g.value(15.0) == [0.5] and g.value(30.0) == [1.0]
    g.go([0.0], now=15.0, seconds=5.0)          # retarget mid-glide: no jump
    assert g.value(15.0) == [0.5] and g.value(20.0) == [0.0]


def test_keys_flatten_round_trip(ms):
    keys = ms.palette_keys(STATE['scene']['colors'])
    assert ms.unflatten_keys(ms.flatten_keys(keys)) == keys


def test_dim_palette_is_lifted_to_full_range_keeping_ratios(ms):
    keys = ms.palette_keys(['#18204a', '#607090'])            # brightest channel 0x90 = 0.565
    top = keys[-1][1:4]
    assert max(top) == pytest.approx(1.0)
    assert top[0] / top[2] == pytest.approx(0x60 / 0x90)
