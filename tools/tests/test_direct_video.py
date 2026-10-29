import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import numpy as np
import pytest
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import show
from remembered import control_schema

_spec = importlib.util.spec_from_file_location('direct_video_tool', ROOT / 'tools/remembered/direct_video.py')
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)


def fixture(name='river-all-looks.toe', source='clip', mask=False, gpu=True):
    return SimpleNamespace(show=name, river_source=source, control={'screen_motion_mask': mask},
                           water=SimpleNamespace(mask=np.full((180, 320), .25, np.float32)),
                           wants_video=lambda: True, gpu_active=lambda: gpu)


def test_direct_mode_passes_every_video_pixel_and_skips_unused_gpu_readbacks():
    s = fixture()
    assert show.direct_recorded_video(s)
    assert np.all(show.mask_image(s) == 1)
    assert not show.cpu_video_crops(s)


def test_original_mask_retained_for_live_other_shows_or_rollback():
    for s in (fixture(source='live'), fixture(name='river-two-looks.toe')):
        assert not show.direct_recorded_video(s)
        assert np.all(show.mask_image(s)[..., :3] == .25)
        assert show.cpu_video_crops(s)
    assert show.parse_control({})['screen_motion_mask'] is True
    assert show.parse_control({'screens': {'motion_mask': False}})['screen_motion_mask'] is False
    assert show.parse_control({'screens': {'motion_mask': 'false'}})['screen_motion_mask'] is True


def test_gpu_failure_immediately_restores_cpu_crop_readbacks():
    assert show.cpu_video_crops(fixture(gpu=False))


def test_video_only_cpu_mode_keeps_its_crop_inputs_even_if_gpu_is_healthy():
    s = fixture()
    s.control["screen_mode"] = "water"
    assert show.cpu_video_crops(s)


def test_slow_mask_can_be_restored_without_enabling_unused_video_readbacks():
    s = fixture(mask=True)
    assert not show.direct_recorded_video(s)
    assert np.all(show.mask_image(s)[..., :3] == .25)
    assert not show.cpu_video_crops(s)
    s.water.mask[:] = .75
    assert np.all(show.mask_image(s)[..., :3] == .75)
    assert not show.cpu_video_crops(s)
    s.gpu_active = lambda: False
    assert show.cpu_video_crops(s)


# ---- tools/remembered/direct_video.py on v2: control.json screens.motion_mask only, no patching ----

def test_tool_on_v2_writes_only_screens_motion_mask(tmp_path):
    path = tmp_path / 'control.json'
    before = {'pool_height_m': 0.6, 'light': 'pool', 'opening_night': True, 'screens': {'intensity': 0.82, 'video': 0.7},
              'overrides': {'knob.speed': {'mode': 'fix', 'value': 0.3, 'at': '2026-10-29T04:00:00Z'}}}
    path.write_text(json.dumps(before))
    patched = {k: getattr(show, k) for k in ('parse_control', 'direct_recorded_video', 'cpu_video_crops', 'mask_image', 'step')}
    codes = {k: f.__code__ for k, f in patched.items()}
    tool.run(SimpleNamespace(name='river-all-looks-v2.toe'), True, path, modules={})
    after = json.loads(path.read_text())
    assert after.pop('screens') == {'intensity': 0.82, 'video': 0.7, 'motion_mask': False}
    assert control_schema.validate({'screens': {'motion_mask': False}})['screens.motion_mask'] is False
    assert show.parse_control(json.loads(path.read_text()))['screen_motion_mask'] is False
    assert after.pop('at').endswith('Z')
    assert after == {k: v for k, v in before.items() if k != 'screens'}
    assert not (tmp_path / 'control.json.tmp').exists()
    assert {k: f.__code__ for k, f in patched.items()} == codes          # nothing patched
    tool.run(SimpleNamespace(name='river-all-looks-v2.toe'), False, path, modules={})
    assert json.loads(path.read_text())['screens']['motion_mask'] is True


def test_tool_refuses_the_frozen_v1_file_and_writes_nothing(tmp_path):
    path = tmp_path / 'control.json'
    path.write_text('{"screens": {"intensity": 0.5}}')
    v1 = SimpleNamespace(__file__='C:/Users/user/River/river-bitcube-v1/td/remembered/show.py')
    for project, modules in ((SimpleNamespace(name='river-all-looks-v2.toe'), {'remembered.show': v1}),
                             (SimpleNamespace(name='river-all-looks.toe'), {})):
        with pytest.raises(RuntimeError):
            tool.run(project, True, path, modules=modules)
    assert path.read_text() == '{"screens": {"intensity": 0.5}}'
