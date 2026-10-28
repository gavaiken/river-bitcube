from pathlib import Path
import sys
from types import SimpleNamespace
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'td'))
from remembered import show


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
    for s in (fixture(source='live'), fixture(name='river-two-looks.toe'), fixture(mask=True)):
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
