import json
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'td'))
from remembered.video_library import clips_for


def library(tmp_path):
    (tmp_path / 'remembered').mkdir()
    for directory in ('remembered', 'smooth'):
        p = tmp_path / 'recordings' / 'river' / directory
        p.mkdir(parents=True)
        for name in ('a.mp4', 'b.mp4'):
            (p / name).write_bytes(b'movie')
    return tmp_path / 'remembered' / 'video-library.json'


def test_preference_survives_new_selection_and_does_not_affect_other_show(tmp_path):
    config = library(tmp_path)
    config.write_text(json.dumps({'shows': {'river-all-looks.toe': {'directory': 'smooth', 'files': ['b.mp4', 'a.mp4']}}}))
    expected = [str(tmp_path / 'recordings/river/smooth' / n) for n in ('b.mp4', 'a.mp4')]
    assert clips_for(tmp_path, 'river-all-looks.toe') == expected
    assert clips_for(tmp_path, 'river-all-looks.toe') == expected
    assert all('/remembered/' in p for p in clips_for(tmp_path, 'river-two-looks.toe'))


@pytest.mark.parametrize('entry', [
    {'directory': '../elsewhere', 'files': ['a.mp4']},
    {'directory': 'smooth', 'files': ['../a.mp4']},
    {'directory': 'smooth', 'files': ['a.mp4', 'missing.mp4']},
    {'directory': 'smooth', 'files': ['a.mp4', 'a.mp4']},
    {'directory': 'smooth', 'files': []},
    {'directory': 'smooth', 'files': [['bad']]},
])
def test_invalid_or_incomplete_preference_uses_whole_original_library(tmp_path, entry):
    config = library(tmp_path)
    config.write_text(json.dumps({'shows': {'river-all-looks.toe': entry}}))
    clips = clips_for(tmp_path, 'river-all-looks.toe')
    assert len(clips) == 2 and all('/remembered/' in p for p in clips)


def test_absent_or_corrupt_config_and_deleting_preference_restore_originals(tmp_path):
    config = library(tmp_path)
    baseline = clips_for(tmp_path, 'river-all-looks.toe')
    config.write_text('{broken')
    assert clips_for(tmp_path, 'river-all-looks.toe') == baseline
    config.write_text(json.dumps({'shows': {'river-all-looks.toe': {'directory': 'smooth', 'files': ['a.mp4']}}}))
    assert clips_for(tmp_path, 'river-all-looks.toe') != baseline
    config.unlink()
    assert clips_for(tmp_path, 'river-all-looks.toe') == baseline


def test_actual_runtime_holder_uses_preference_on_fresh_start(tmp_path, monkeypatch):
    from remembered import show
    config = library(tmp_path)
    config.write_text(json.dumps({'shows': {'river-all-looks.toe': {'directory': 'smooth', 'files': ['a.mp4', 'b.mp4']}}}))
    monkeypatch.setattr(show, 'RIVER', tmp_path)
    monkeypatch.setattr(show, '_project_name', lambda: 'river-all-looks.toe')
    monkeypatch.delitem(sys.modules, 'remembered_live', raising=False)
    assert show._holder().clips == clips_for(tmp_path, 'river-all-looks.toe')
    assert all('/smooth/' in p for p in show._holder().clips)


def test_v2_takes_the_all_looks_entry_when_it_has_none(tmp_path):
    base = tmp_path / 'recordings' / 'river'
    (base / 'remembered').mkdir(parents=True)
    (base / 'remembered' / 'orig.mp4').write_bytes(b'x')
    (base / 'fast').mkdir()
    (base / 'fast' / 'a.mp4').write_bytes(b'x')
    (tmp_path / 'remembered').mkdir()
    (tmp_path / 'remembered' / 'video-library.json').write_text(
        '{"shows": {"river-all-looks.toe": {"directory": "fast", "files": ["a.mp4"]}}}')
    from remembered import video_library
    assert video_library.clips_for(tmp_path, 'river-all-looks-v2.toe') == [str(base / 'fast' / 'a.mp4').replace('\\', '/')]
    assert video_library.clips_for(tmp_path, 'river-remembered.toe') == [str(base / 'remembered' / 'orig.mp4').replace('\\', '/')]
