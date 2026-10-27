"""Overlay persistence and refusal boundaries, without needing TouchDesigner."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def runtime():
    path = Path(__file__).resolve().parents[2] / 'td/combined/runtime.py'
    spec = importlib.util.spec_from_file_location('combined_under_test', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize('value', [True, False, None, '', '0.5', -0.1, 1.1, float('nan'), float('inf')])
def test_invalid_overlay_never_writes(runtime, tmp_path, value):
    dest = tmp_path / 'settings.json'
    with pytest.raises(ValueError):
        runtime.save_strength(value, dest)
    assert not dest.exists()


def test_strength_persists_and_corrupt_settings_recover(runtime, tmp_path):
    dest = tmp_path / 'settings.json'
    assert runtime.load_strength(dest) == runtime.DEFAULT_STRENGTH
    for value in [0, 0.37, 1]:
        assert runtime.save_strength(value, dest) == value
        assert runtime.load_strength(dest) == value
    dest.write_text('{broken')
    assert runtime.load_strength(dest) == runtime.DEFAULT_STRENGTH


def test_other_show_cannot_change_or_save_overlay(runtime, monkeypatch):
    writes = []
    monkeypatch.setattr(runtime, 'save_strength', lambda value: writes.append(value) or value)
    comp = SimpleNamespace(par=SimpleNamespace(Canvasmix=0.25))
    with pytest.raises(ValueError, match='only available'):
        runtime.set_strength(comp, 1, 'river-local-oct-22-seasons.toe')
    assert not writes and comp.par.Canvasmix == 0.25
    runtime.set_strength(comp, 0.5, runtime.SHOW)
    assert writes == [0.5] and comp.par.Canvasmix == 0.5


def test_failed_save_does_not_change_live_value(runtime, monkeypatch):
    def fail(value):
        raise OSError('disk full')
    monkeypatch.setattr(runtime, 'save_strength', fail)
    comp = SimpleNamespace(par=SimpleNamespace(Canvasmix=0.25))
    with pytest.raises(OSError):
        runtime.set_strength(comp, 0.5, runtime.SHOW)
    assert comp.par.Canvasmix == 0.25


def test_opening_saved_show_restores_slider_once_without_rebuilding(runtime, monkeypatch):
    st = {'started': None, 'last': None, 'phases': dict.fromkeys(runtime.PHASES, 0),
          'next_read': 0, 'reloaded': False}
    monkeypatch.setattr(runtime, 'state', lambda: st)
    monkeypatch.setattr(runtime, 'load_strength', lambda: 0.63)
    monkeypatch.setattr(runtime, 'intensity', lambda: 0.85)
    monkeypatch.setattr(runtime, 'SCENE', Path('/nonexistent/scene.json'))
    comp = SimpleNamespace(par=SimpleNamespace(Canvasmix=0.25), op=lambda name: None)
    runtime.frame(comp)
    assert comp.par.Canvasmix == 0.63
    comp.par.Canvasmix = 0.4
    runtime.frame(comp)
    assert comp.par.Canvasmix == 0.4


def test_framing_and_overlay_share_settings_without_erasing_each_other(runtime, tmp_path):
    dest = tmp_path / 'settings.json'
    runtime.save_strength(.1, dest, profile='channel-multi')
    assert runtime.load_framing(dest) == 'channel-multi'
    runtime.save_strength(.4, dest)
    assert runtime.load_framing(dest) == 'channel-multi'
    assert runtime.load_strength(dest) == .4
    before = dest.read_bytes()
    with pytest.raises(ValueError):
        runtime.save_strength(.9, dest, profile='pool; restart')
    assert dest.read_bytes() == before
    runtime.save_strength(.4, dest, profile='original')
    assert runtime.load_framing(dest) == 'original'


def test_recorded_fallback_bypasses_selected_camera_profile(runtime, monkeypatch):
    comp = SimpleNamespace(par=SimpleNamespace(Framing=SimpleNamespace(eval=lambda: 'pool-multi')))
    monkeypatch.setattr(runtime, 'live_source', lambda: False)
    assert runtime.effective_framing(comp) == 'original'
    monkeypatch.setattr(runtime, 'live_source', lambda: True)
    assert runtime.effective_framing(comp) == 'pool-multi'


def test_framing_pixel_orientation_mask_and_crossfade():
    import numpy as np
    path = Path(__file__).resolve().parents[2] / 'td/combined/framing.py'
    spec = importlib.util.spec_from_file_location('framing_under_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    pixels = np.ones((360, 640, 4), dtype=np.float32) * .2
    mask = np.ones((360, 640), dtype=np.float32)
    mask[144:180] = 0
    out = module.render(pixels, mask, 'channel', 0)
    assert out.flags.c_contiguous and out.shape == (360, 640, 4)
    assert np.max(out[-30:, :, :3]) == 0  # masked top becomes bottom-up array's last rows
    assert np.min(out[:30, :, :3]) > .1
    mask[:] = 1
    pixels[:, :, 0] = np.linspace(0, 1, 640)
    a = module.render(pixels, mask, 'channel-multi', 17.999)
    b = module.render(pixels, mask, 'channel-multi', 18)
    assert np.max(np.abs(a - b)) < .001


def test_auto_uses_detector_only_for_live_input(runtime, monkeypatch):
    detected = {'profile': 'pool-multi'}
    comp = SimpleNamespace(par=SimpleNamespace(Framing=SimpleNamespace(eval=lambda: 'auto')),
                           op=lambda name: SimpleNamespace(module=SimpleNamespace(status=lambda: detected)))
    monkeypatch.setattr(runtime, 'live_source', lambda: True)
    assert runtime.effective_framing(comp) == 'pool-multi'
    detected['profile'] = 'original'
    assert runtime.effective_framing(comp) == 'original'
    detected['profile'] = 'pool-multi'
    monkeypatch.setattr(runtime, 'live_source', lambda: False)
    assert runtime.effective_framing(comp) == 'original'


def test_screen_controls_preserve_framing_overlay_and_reject_before_writing(runtime, tmp_path):
    dest = tmp_path / 'settings.json'
    runtime.save_strength(.18, dest, profile='auto')
    settings = {'mode':'cycle','blend':.25,'hold':30,'recorded':0.0}
    runtime.save_strength(.18, dest, screens=settings)
    assert runtime.load_strength(dest) == .18
    assert runtime.load_framing(dest) == 'auto'
    assert runtime.load_screens(dest) == settings
    before = dest.read_bytes()
    with pytest.raises(ValueError):
        runtime.save_strength(.9, dest, screens=dict(settings, hold=999))
    assert dest.read_bytes() == before
    runtime.save_strength(.2, dest)
    assert runtime.load_screens(dest) == settings


def test_old_screen_client_preserves_recorded_share_and_invalid_value_never_writes(runtime, monkeypatch):
    writes=[]
    monkeypatch.setattr(runtime,'save_strength',lambda value, **kw: writes.append(kw) or value)
    comp=SimpleNamespace(par=SimpleNamespace(Canvasmix=.18,Screenmode='manual',Screenblend=.25,Screenhold=30,Screenrecorded=.4))
    runtime.set_strength(comp,.18,runtime.SHOW,screens={'mode':'manual','blend':.5,'hold':30})
    assert writes[-1]['screens']['recorded'] == .4
    assert comp.par.Screenrecorded == .4
    with pytest.raises(ValueError):
        runtime.set_strength(comp,.9,runtime.SHOW,screens={'mode':'manual','blend':0,'hold':30,'recorded':True})
    assert len(writes)==1 and comp.par.Canvasmix==.18
