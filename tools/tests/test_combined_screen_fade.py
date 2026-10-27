"""Screens-only fade timing, transitions and strict persistence schema."""
import importlib.util
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('fade_under_test', ROOT / 'td/combined/screen_fade.py')
fade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fade)


def test_cycle_holds_each_look_and_has_three_smooth_eight_second_fades():
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


def test_three_look_cycle_and_wrap_have_normalized_continuous_weights():
    s = fade.checked({'mode': 'cycle', 'blend': 0, 'hold': 30})
    for t, expected in [(0,(1,0,0)), (34,(.5,.5,0)), (38,(0,1,0)),
                        (72,(0,.5,.5)), (76,(0,0,1)), (105,(0,0,1)),
                        (110,(.5,0,.5)), (114,(1,0,0))]:
        assert fade.weights(s, t) == pytest.approx(expected)
    for t in range(3420):
        w = fade.weights(s, t / 10)
        assert sum(w) == pytest.approx(1)
        assert all(0 <= x <= 1 for x in w)
    for t in (30,38,68,76,106,114):
        assert fade.weights(s,t-.0001) == pytest.approx(fade.weights(s,t+.0001),abs=.00001)


def test_manual_recorded_share_and_mode_transition_preserve_all_weights():
    s = fade.checked({'mode':'manual','blend':.25,'recorded':.4,'hold':30})
    assert fade.weights(s,0) == pytest.approx((.45,.15,.4))
    st = {}
    fade.step(st,s,0)
    fade.step(st,s,8)
    assert st['screen_weights'] == pytest.approx((.45,.15,.4))
    recorded = dict(s,mode='recorded')
    fade.step(st,recorded,10)
    assert st['screen_weights'] == pytest.approx((.45,.15,.4))
    fade.step(st,recorded,14)
    assert st['screen_weights'] == pytest.approx((.225,.075,.7))
    fade.step(st,recorded,18)
    assert st['screen_weights'] == (0,0,1)
    assert fade.checked({'mode':'current','blend':0,'hold':30})['recorded'] == 0


@pytest.mark.parametrize('recorded', [True, None, -1, 1.1, float('nan'), float('inf'), '0.5'])
def test_invalid_recorded_weight_is_refused(recorded):
    with pytest.raises(ValueError):
        fade.checked({'mode':'manual','blend':0,'recorded':recorded,'hold':30})


def test_four_screens_delay_the_same_cycle_and_zero_restores_sync():
    s=fade.checked({'mode':'cycle','blend':0,'hold':30,'offset':10})
    for k in range(4):
        all_weights=fade.screen_targets(s,34+10*k)
        assert all_weights[k] == pytest.approx((.5,.5,0))
    assert fade.screen_targets(s,34)[1:] == ((1,0,0),)*3
    for elapsed in [0,34,72,110,148,230]:
        for k,w in enumerate(fade.screen_targets(s,elapsed)):
            assert w == pytest.approx(fade.weights(s,(elapsed-10*k)%114))
            assert sum(w) == pytest.approx(1)
    sync=fade.screen_targets(dict(s,offset=0),72)
    assert sync == ((0,.5,.5),)*4
    for mode in ('manual','current','gavin','recorded'):
        values=fade.screen_targets(dict(s,mode=mode),34)
        assert all(w==values[0] for w in values)


def test_offset_change_and_interrupted_fade_remain_continuous_on_every_screen():
    st={}
    s={'mode':'cycle','blend':0,'hold':30,'offset':10}
    fade.step(st,s,0)
    fade.step(st,s,54)
    previous=st['screen_weights_all']
    fade.step(st,dict(s,offset=0),55)
    assert st['screen_weights_all']==previous
    fade.step(st,dict(s,offset=0),59)
    for w in st['screen_weights_all']:
        assert sum(w)==pytest.approx(1)
    fade.step(st,dict(s,offset=0),63)
    assert st['screen_weights_all']==((1,0,0),)*4


@pytest.mark.parametrize('offset',[True,None,-1,120.1,float('nan'),float('inf'),'10'])
def test_bad_offset_is_refused(offset):
    with pytest.raises(ValueError):
        fade.checked({'mode':'cycle','blend':0,'hold':30,'offset':offset})


@pytest.mark.parametrize('hold',[15,30,60,120])
def test_evenly_spaced_screens_show_different_holds_from_the_start(hold):
    period=3*(hold+fade.FADE_S)
    s={'mode':'cycle','blend':0,'hold':hold,'offset':period/4}
    for t in range(int(period)*2):
        w=fade.screen_targets(s,t)
        # Four phases distributed over three looks always include at least two distinct held looks.
        held={tuple(x) for x in w if max(x)==1}
        assert len(held)>=2
        assert all(sum(x)==pytest.approx(1) for x in w)
    assert fade.screen_targets(s,0)==fade.screen_targets(s,period)
