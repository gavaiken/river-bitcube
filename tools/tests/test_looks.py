"""The river (all looks), td/looks/mixer.py: auto and manual, fades instead of restarts."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'td'))
from looks import mixer  # noqa: E402


def run(L, seconds, dt=1 / 30, **progress):
    changes = []
    for _ in range(int(seconds / dt)):
        L.auto_next(**progress)
        if L.step(dt):
            changes.append(L.look)
    return changes


def test_auto_four_remembered_loops_then_one_fill():
    L = mixer.Looks('auto')
    assert L.look == 'remembered'
    for loop in range(4):
        run(L, 1, remembered_loop=loop)
    assert L.target == 'remembered'
    run(L, 1, remembered_loop=4)                            # the fourth loop done
    assert L.target == 'fill-simple'
    assert run(L, mixer.FADE_S * 2 + 0.5) == ['fill-simple'] and L.fade == 1.0
    run(L, 1, fill_t=10.0)
    run(L, 1, fill_t=80.0)
    assert L.target == 'fill-simple'
    run(L, 0.1, fill_t=0.5)                                 # the cycle wrapped: back to the river
    assert L.target == 'remembered'


def test_manual_fades_to_the_chosen_look_and_stays():
    L = mixer.Looks('auto')
    L.set({'mode': 'manual', 'look': 'fill-configurable'})
    run(L, mixer.FADE_S * 0.5)
    assert L.fading == 'out' and 0 < L.fade < 1 and L.look == 'remembered'
    run(L, mixer.FADE_S * 2)
    assert L.look == 'fill-configurable' and L.fade == 1.0 and L.fading is None
    run(L, 5, fill_t=0.5)                                   # manual never moves on by itself
    assert L.look == 'fill-configurable'


def test_status_shape():
    L = mixer.Looks('auto')
    st = L.status(1.0)
    assert set(st) == {'t', 'show', 'mode', 'look', 'target', 'fading', 'fade', 'auto', 'looks'}
    assert st['auto'] == {'remembered_loops': 0, 'next': 'fill-simple'} and st['looks'] == list(mixer.LOOKS)
