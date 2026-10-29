"""The runtime tools' guard: never patch the frozen v1 file; run only in river-all-looks-v2.toe."""
import sys
from pathlib import Path
from types import SimpleNamespace
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/remembered'))
import runtime_guard  # noqa: E402

V1 = SimpleNamespace(__file__='C:\\Users\\user\\River\\river-bitcube-v1\\td\\remembered\\show.py')
LIVE = SimpleNamespace(__file__='C:/Users/user/River/river-bitcube/td/remembered/show.py')


def test_refuses_when_remembered_show_loads_from_the_v1_checkout(capsys):
    with pytest.raises(RuntimeError, match='the frozen v1 file is running') as e:
        runtime_guard.check('direct_video.py', project=SimpleNamespace(name='river-all-looks-v2.toe'),
                            modules={'remembered.show': V1}, replaced='it writes control.json')
    assert 'never patch it' in str(e.value) and 'docs/checkpoints.md' in str(e.value)
    assert 'direct_video.py: in v2, it writes control.json' in capsys.readouterr().out


def test_refuses_a_wrong_project_name():
    for name in ('river-all-looks.toe', 'river-two-looks.toe', None):
        with pytest.raises(RuntimeError, match='runs only in river-all-looks-v2.toe'):
            runtime_guard.check('video_trial.py', project=SimpleNamespace(name=name), modules={'remembered.show': LIVE})


def test_accepts_v2_with_live_modules_or_none_loaded():
    p = SimpleNamespace(name='river-all-looks-v2.toe')
    assert runtime_guard.check('x', project=p, modules={'remembered.show': LIVE}) == 'river-all-looks-v2.toe'
    assert runtime_guard.check('x', project=p, modules={}) == 'river-all-looks-v2.toe'
