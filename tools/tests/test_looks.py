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
    assert set(st) == {'t', 'show', 'mode', 'look', 'target', 'fading', 'fade', 'auto', 'looks', 'playlist', 'position', 'progress'}
    assert st['auto'] == {'remembered_loops': 0, 'next': 'fill-simple', 'flood': False, 'why': None}
    assert st['looks'] == list(mixer.LOOKS)
    assert st['playlist'] == list(mixer.DEFAULT_PLAYLIST) and st['position'] == 0
    assert st['progress'] == {'done': 0, 'of': 4, 'unit': 'loops'}


def test_a_flood_day_brings_the_fill_on_after_its_loop():
    L = mixer.Looks('auto')
    run(L, 1, remembered_loop=0, flow_pct=40)
    run(L, 1, remembered_loop=1, flow_pct=96)                 # a flood day starts playing
    assert L.target == 'remembered' and L.flood
    run(L, 0.1, remembered_loop=2, flow_pct=30)               # its loop ended: the fill follows
    assert L.target == 'fill-simple' and L.why == 'a flood day'


# ---- the playlist (28 Oct, river-all-looks.toe) ----------------------------------------------------------------------

def test_check_playlist_accepts_the_shape_and_refuses_the_rest():
    ok = [{'look': 'remembered', 'for': {'loops': 2}}, {'look': 'seasons', 'for': {'minutes': 3}}, {'look': 'fill-simple', 'for': {'cycles': 1}}]
    assert mixer.check_playlist(ok) == ok
    assert mixer.check_playlist(ok, available=('remembered', 'fill-simple')) is None      # a look the file hasn't got
    for bad in (None, [], 'x', [{'look': 'nope', 'for': {'minutes': 3}}], [{'look': 'remembered', 'for': {'cycles': 1}}],
                [{'look': 'fill-simple', 'for': {'loops': 1}}], [{'look': 'seasons', 'for': {'minutes': 0}}],
                [{'look': 'seasons', 'for': {'minutes': 121}}], [{'look': 'remembered', 'for': {'loops': 21}}],
                [{'look': 'remembered', 'for': {'loops': 1.5}}], [{'look': 'remembered', 'for': {'loops': True}}],
                [{'look': 'remembered', 'for': {'loops': 1, 'minutes': 2}}], [{'look': 'remembered'}] * 13):
        assert mixer.check_playlist(bad) is None, bad


def test_the_playlist_plays_in_order_and_loops():
    pl = [{'look': 'remembered', 'for': {'loops': 1}}, {'look': 'seasons', 'for': {'minutes': 1}}, {'look': 'fill-simple', 'for': {'cycles': 2}}]
    L = mixer.Looks('auto', playlist=pl)
    assert L.look == 'remembered' and L.status(0)['progress'] == {'done': 0, 'of': 1, 'unit': 'loops'}
    run(L, 1, remembered_loop=0)
    run(L, 1, remembered_loop=1)
    assert L.target == 'seasons' and L.why == '1 loop'
    assert run(L, mixer.FADE_S * 2 + 0.5) == ['seasons']
    run(L, 30)
    assert L.target == 'seasons' and L.status(0)['progress']['unit'] == 'minutes'
    run(L, 31)                                                    # a minute on the seasons
    assert L.target == 'fill-simple' and L.why == '1 minute'
    run(L, mixer.FADE_S * 2 + 0.5)
    for cycle in range(2):                                        # two full fills
        run(L, 1, fill_t=10.0)
        run(L, 1, fill_t=80.0)
        run(L, 0.1, fill_t=0.5)
    assert L.target == 'remembered' and L.why == '2 cycles' and L.status(0)['position'] == 0


def test_a_new_playlist_keeps_the_place_by_the_look_showing():
    L = mixer.Looks('auto')
    run(L, 1, remembered_loop=0)
    L.set({'playlist': [{'look': 'fill-configurable', 'for': {'cycles': 1}}, {'look': 'remembered', 'for': {'loops': 2}}]})
    assert L.look == 'remembered' and L.position == 1 and L.target == 'remembered'
    L.set({'playlist': [{'look': 'seasons', 'for': {'minutes': 3}}]})          # the look showing isn't in it: start over
    assert L.target == 'seasons' and L.why == 'a new playlist'
    L.set({'playlist': 'garbage'})                                            # ignored: the last good one stays
    assert L.playlist == [{'look': 'seasons', 'for': {'minutes': 3}}]


def test_only_the_looks_the_file_has():
    L = mixer.Looks('auto', available=('remembered', 'fill-simple', 'fill-configurable'))
    assert L.status(0)['looks'] == ['remembered', 'fill-simple', 'fill-configurable']
    L.set({'mode': 'manual', 'look': 'seasons'})                             # not in this file: stays
    assert L.target == 'remembered'
    L.set({'playlist': [{'look': 'seasons', 'for': {'minutes': 3}}]})
    assert L.playlist == list(mixer.DEFAULT_PLAYLIST)
