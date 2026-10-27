"""Screens-only fade timing, transitions and strict persistence schema."""
import importlib.util
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('fade_under_test', ROOT / 'td/combined/screen_fade.py')
fade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fade)


def test_cycle_holds_each_look_and_has_two_smooth_eight_second_fades():
    s = {'mode': 'cycle', 'blend': 0, 'hold': 30}
    for t, expected in [(0,0),(29,0),(30,0),(34,.5),(38,1),(67,1),(68,1),(72,.5),(76,0),(106,0)]:
        assert fade.amount(s, t) == pytest.approx(expected)
    for boundary in [30,38,68,76]:
        assert abs(fade.amount(s,boundary-.0001)-fade.amount(s,boundary+.0001)) < .00001


def test_mode_changes_and_manual_blends_fade_without_jumping():
    st = {}
    current = {'mode':'current','blend':0,'hold':30}
    gavin = dict(current,mode='gavin')
    assert fade.step(st,current,0) == 0
    assert fade.step(st,gavin,10) == 0
    assert fade.step(st,gavin,14) == .5
    assert fade.step(st,gavin,18) == 1
    manual = dict(current,mode='manual',blend=.25)
    assert fade.step(st,manual,20) == 1
    assert fade.step(st,manual,28) == .25
    cycle = dict(current,mode='cycle')
    assert fade.step(st,cycle,30) == .25
    assert fade.step(st,cycle,38) == 0
    assert fade.step(st,dict(cycle),64) == .5  # unchanged settings do not restart the clock


@pytest.mark.parametrize('value', [None,[],{}, {'mode':'bad','blend':0,'hold':30},
    {'mode':'cycle','blend':True,'hold':30}, {'mode':'cycle','blend':float('nan'),'hold':30},
    {'mode':'cycle','blend':1.1,'hold':30}, {'mode':'cycle','blend':0,'hold':31},
    {'mode':'cycle','blend':0,'hold':'30'}, {'mode':'cycle','blend':0,'hold':True}])
def test_invalid_controls_are_refused(value):
    with pytest.raises(ValueError):
        fade.checked(value)

