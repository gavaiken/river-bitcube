"""Automatic river-view recognition, transition and stale-camera refusal boundaries."""
import importlib.util
from pathlib import Path
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('detector_under_test', ROOT / 'td/combined/view_detector.py')
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)


@pytest.fixture
def refs():
    with np.load(ROOT / 'td/combined/view_references.npz') as data:
        return {name: data[name].copy() for name in detector.VIEWS}


def image(value):
    # Exposure-shifted reconstruction: the same coarse image structure.
    gray = np.repeat(np.repeat(value, 20, 0), 20, 1)
    return np.repeat((gray * 2 + .3)[:, :, None], 4, 2)


@pytest.mark.parametrize('name', ['channel', 'pool'])
def test_each_reference_matches_despite_exposure_and_water_motion(refs, name):
    pixels = image(refs[name])
    pixels[125:235, 210:350, :3] += np.random.default_rng(42).normal(0, .04, (110, 140, 3))
    result = detector.match(detector.feature(pixels), refs)
    assert result['candidate'] == name and result['confidence'] > .9


def test_unknown_blank_and_ambiguous_views_bypass(refs):
    for pixels in [np.zeros((360, 640, 4)), image(refs['channel'] + refs['pool']),
                   np.random.default_rng(42).random((360, 640, 4))]:
        assert detector.match(detector.feature(pixels), refs)['candidate'] is None


def test_switch_settles_and_unknown_or_stale_data_never_holds_old_mask(refs):
    d = detector.Detector(refs)
    a, b = image(refs['channel']), image(refs['pool'])
    assert d.observe(a, 0)['profile'] == 'original'
    assert d.observe(a, .5)['profile'] == 'original'
    assert d.observe(a, 1)['profile'] == 'channel-multi'
    assert d.observe(b, 1.5)['profile'] == 'original'
    assert d.observe(b, 2)['profile'] == 'original'
    assert d.observe(b, 2.5)['profile'] == 'pool-multi'
    assert d.info(5)['profile'] == 'original'
    assert d.observe(b, 5)['profile'] == 'original'  # stale gap must settle again
    assert d.observe(b, 6)['profile'] == 'pool-multi'
    assert d.observe(None, 6.5)['profile'] == 'original'
    assert d.observe(a, 7)['profile'] == 'original'
    assert d.observe(a, 8)['profile'] == 'channel-multi'
    assert d.observe(np.zeros_like(a), 8.5)['profile'] == 'original'


def test_invalid_frame_does_not_match(refs):
    assert detector.feature(np.zeros((10, 10, 4))) is None
    assert detector.feature(np.full((360, 640, 4), np.nan)) is None
