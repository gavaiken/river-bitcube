"""The remembered river v2, step 5 (docs/remembered-v2-plan.md): the retired fields, the black fallback, the GPU path's
cheap lit share and reused black frame, the all-looks readback rules for v2, mtime-gated reads, the library cache."""
import gzip
import json
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import clock, files, show  # noqa: E402

T0 = 1_800_000_000.0


def test_retired_fields_run_the_ribbons(tmp_path):
    (tmp_path / 'remembered').mkdir()
    for kind in ('fine', 'streaks', 'ribbons'):
        (tmp_path / 'remembered' / 'control.json').write_text(json.dumps({'screens': {'field': kind}}))
        files.clear_cache()
        s = show.Show(river_dir=tmp_path)
        s.tick(T0, 1 / 60)
        assert s.control['screen_field'] == kind and s.field_kind == 'ribbons'


def test_unbuildable_ribbons_leave_the_screens_black(tmp_path):
    s = show.Show(river_dir=tmp_path, pixelmap=tmp_path / 'missing-map.json')
    assert s.field_kind == 'none' and not s.gpu_active()
    for i in range(10):
        ropes, panels = s.tick(T0 + i / 60, 1 / 60)
    assert panels.shape == (256, 512, 3) and panels.max() == 0 and s.last_status['panels']['field'] == 'none'


def test_gpu_path_samples_the_lit_share_without_rendering_and_reuses_one_black_frame(tmp_path, monkeypatch):
    s = show.Show(river_dir=tmp_path)
    s.gpu_ok = True
    renders, samples = [], []
    monkeypatch.setattr(s.field, 'render_screens',
                        lambda *a, **k: renders.append(1) or np.zeros((256, 512, 3), np.float32))
    real = s.field.lit_sample
    monkeypatch.setattr(s.field, 'lit_sample', lambda: samples.append(1) or real())
    frames = set()
    for i in range(show.LIT_EVERY + 4):
        s.tick(T0 + i / 60, 1 / 60)
        if i >= show.PANEL_EVERY:                         # (the first frame is the one Show starts with)
            frames.add(id(s.panel_frame))
        img = show.panel_image(s)
    assert not renders and 2 <= len(samples) <= 3 and len(frames) == 1 and s.panel_static
    assert img.shape == (256, 512, 4) and img[..., :3].max() == 0 and img[..., 3].min() == 1
    assert isinstance(s.field.lit_pct, list) and len(s.field.lit_pct) == 4
    s.gpu_ok = False                                      # GPU gone: the numpy ribbons draw again, a new frame each time
    s.tick(T0 + 20, 1 / 60)
    s.tick(T0 + 20.02, 1 / 60)
    assert not s.panel_static and renders


def test_all_looks_v2_skips_the_unused_crop_readbacks_like_v1():
    def fx(name):
        return SimpleNamespace(show=name, river_source='clip', control={'screen_motion_mask': True},
                               water=SimpleNamespace(mask=np.zeros((180, 320), np.float32)),
                               wants_video=lambda: True, gpu_active=lambda: True)
    assert not show.cpu_video_crops(fx('river-all-looks.toe'))
    assert not show.cpu_video_crops(fx('river-all-looks-v2.toe'))
    assert show.cpu_video_crops(fx('river-looks.toe')) and show.cpu_video_crops(fx('river-remembered.toe'))


def test_td_images_reuse_their_buffers_and_follow_changes(tmp_path):
    s = show.Show(river_dir=tmp_path)
    a = show.rope_image(s)
    s.rope_frame = np.full_like(s.rope_frame, 0.5)
    b = show.rope_image(s)
    assert a is b and b[..., :3].min() == 0.5 and b[..., 3].min() == 1 and b.flags['C_CONTIGUOUS']
    s.water.mask = np.full((180, 320), 0.25, np.float32)
    assert show.mask_image(s)[..., :3].max() == 0.25
    s.water.mask = np.full((180, 320), 0.75, np.float32)
    assert show.mask_image(s)[..., :3].min() == 0.75


def test_cached_reads_parse_again_only_when_the_file_changes(tmp_path, monkeypatch):
    p = tmp_path / 'x.json'
    p.write_text('{"a": 1}')
    calls = []
    real = files.read_json
    monkeypatch.setattr(files, 'read_json', lambda path: calls.append(path) or real(path))
    d1, m1 = files.read_json_cached(p)
    d2, _ = files.read_json_cached(p)
    assert d1 == {'a': 1} and d1 is d2 and len(calls) == 1 and m1 == p.stat().st_mtime
    p.write_text('{"a": 22}')
    os.utime(p, ns=(time.time_ns(), time.time_ns() + 1_000_000))
    assert files.read_json_cached(p)[0] == {'a': 22} and len(calls) == 2
    p.unlink()
    assert files.read_json_cached(p) == (None, None)


def test_show_reflex_copy_never_changes_the_cached_file(tmp_path):
    (tmp_path / 'gallery_state').mkdir()
    (tmp_path / 'gallery_state' / 'reflex.json').write_text(json.dumps({'heard': 0.3, 'updated_epoch': T0}))
    s = show.Show(river_dir=tmp_path)
    s.tick(T0, 1 / 60)
    cached, _ = files.read_json_cached(tmp_path / 'gallery_state' / 'reflex.json')
    assert '_mtime' in s.reflex and '_mtime' not in cached


def test_library_is_parsed_again_only_when_its_files_change(tmp_path):
    (tmp_path / 'notable.json').write_text(json.dumps([{'date': '2005-12-31'}]))
    with gzip.open(tmp_path / 'profiles.json.gz', 'wt') as f:
        json.dump({'2005-12-31': {'flow': [1] * 24}}, f)
    a = clock.load_library(tmp_path)
    assert clock.load_library(tmp_path) is a and a['notable'][0]['date'] == '2005-12-31'
    (tmp_path / 'notable.json').write_text(json.dumps([{'date': '2005-12-31'}, {'date': '1997-01-01'}]))
    b = clock.load_library(tmp_path)
    assert b is not a and len(b['notable']) == 2
