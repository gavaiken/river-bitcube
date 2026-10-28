import json
import sys
import types
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered.video_library import clips_for


class Params:
    def __init__(self, value):
        self._file = types.SimpleNamespace(value=value)
        self._file.eval = lambda: self._file.value
    @property
    def file(self):
        return self._file
    @file.setter
    def file(self, value):
        self._file.value = value


@pytest.fixture
def trial(tmp_path, monkeypatch):
    source = (ROOT / 'tools/remembered/video_trial.py').read_text()
    ns = {'project': types.SimpleNamespace(name='river-all-looks.toe')}
    exec(compile(source.rsplit('\ntrial()', 1)[0], '<video_trial>', 'exec'), ns)
    river = tmp_path / 'River'
    original = river / 'recordings/river/remembered'
    candidate = river / 'recordings/river/motion30-trial-20261028'
    for path in (original, candidate, river / 'remembered'):
        path.mkdir(parents=True, exist_ok=True)
    names = ns['NAMES']
    for name in names:
        (original / name).write_bytes(b'original')
        (candidate / name).write_bytes(b'trial')
    (candidate / 'manifest.json').write_text(json.dumps([
        {'name': n, 'output': {'format': {'size': '5'}}} for n in names]))
    before = [str(original / n) for n in names]
    holder = types.SimpleNamespace(clips=before[:])
    player = types.SimpleNamespace(par=Params(before[1]))
    monkeypatch.setitem(sys.modules, 'remembered_live', holder)
    ns.update(ROOT=candidate, ORIGINAL=original, op=lambda _: player)
    return ns, river, holder, player


def test_keep_survives_fresh_selection_and_rollback_restores_originals(trial):
    ns, river, holder, player = trial
    baseline = holder.clips[:]
    config = river / 'remembered/video-library.json'
    config.write_text(json.dumps({'shows': {'another.toe': {'directory': 'leave', 'files': ['x.mp4']}}}))
    ns['ACTION'] = 'keep'
    ns['trial']()
    assert clips_for(river, 'river-all-looks.toe') == holder.clips != baseline
    assert clips_for(river, 'river-two-looks.toe') == baseline
    checkpoint = (ns['ROOT'] / 'trial-state.json').read_bytes()
    ns['trial']()
    assert (ns['ROOT'] / 'trial-state.json').read_bytes() == checkpoint
    player.par.file = holder.clips[0]  # the movie advanced before rollback
    ns['ACTION'] = 'rollback'
    ns['trial']()
    assert holder.clips == baseline and player.par.file.eval() == baseline[0]
    assert clips_for(river, 'river-all-looks.toe') == baseline
    assert json.loads(config.read_text())['shows'] == {'another.toe': {'directory': 'leave', 'files': ['x.mp4']}}


def test_wrong_show_cannot_write_preference_or_change_live_list(trial):
    ns, river, holder, _ = trial
    before = holder.clips[:]
    ns['ACTION'] = 'keep'
    ns['project'].name = 'river-two-looks.toe'
    with pytest.raises(RuntimeError):
        ns['trial']()
    assert holder.clips == before and not (river / 'remembered/video-library.json').exists()


def test_partial_candidate_does_not_write_preference_or_change_live_list(trial):
    ns, river, holder, _ = trial
    before = holder.clips[:]
    ns['ACTION'] = 'keep'
    (ns['ROOT'] / ns['NAMES'][0]).write_bytes(b'partial upload')
    with pytest.raises(RuntimeError):
        ns['trial']()
    assert holder.clips == before and not (river / 'remembered/video-library.json').exists()
