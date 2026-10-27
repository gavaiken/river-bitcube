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
