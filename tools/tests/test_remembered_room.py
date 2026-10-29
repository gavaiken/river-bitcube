"""The room as the ropes feel it (td/remembered/room.py): a lingerer's 2-4 ropes building over ~3 s and fading over ~5 s,
the crowd mounting and subsiding over ~60 s, the empty room ramping over ~60 s and waking within ~3 s, and no counter
meaning neutral."""
import pathlib
import sys

import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import room  # noqa: E402
from remembered import zones  # noqa: E402

DT = 1 / 30
ZONES_FILE = ROOT / 'tools' / 'pixelmap' / 'zones-2026-10-28.json'


def run(rs, seconds, count, lingerers=(), available=True):
    for _ in range(int(round(seconds / DT))):
        rs.update(DT, count, lingerers, available)
    return rs


@pytest.mark.parametrize('z', [zones.Zones(), zones.load(str(ZONES_FILE))], ids=['default', 'as-built'])
def test_a_lingerer_lights_two_to_four_ropes(z):
    rs = room.RoomState(z)
    for r in range(20):
        w = rs.ropes_for({'ropes': [r]})
        lit = np.nonzero(w > 0.3)[0]
        assert 2 <= len(lit) <= 4, (r, w)
        assert w[r] == 1.0 and int(np.argmax(w)) == r
        assert (w > 0).sum() <= room.LINGER_ROPES
    # the counter's own nearest ropes come first, in its order
    w = rs.ropes_for({'ropes': [3, 13, 9, 1]})
    assert w[3] == 1.0 and w[13] >= room.LINGER_SECOND
    assert not rs.ropes_for({'ropes': []}).any() and not rs.ropes_for({'ropes': [99]}).any()


def test_linger_builds_over_3_s_and_fades_over_5_s():
    rs = room.RoomState(zones.Zones())
    ling = [{'ropes': [7], 'still_s': 9, 'x': 0.4, 'y': 0.8}]
    run(rs, 1.5, 1, ling)
    assert rs.linger[7] == pytest.approx(0.5, abs=0.03)
    run(rs, 1.6, 1, ling)
    assert rs.linger[7] == pytest.approx(1.0) and rs.linger_strength == pytest.approx(1.0)
    run(rs, 2.5, 1)
    assert rs.linger[7] == pytest.approx(0.5, abs=0.03)
    run(rs, 2.6, 1)
    assert rs.linger_strength == 0.0


def test_crowd_mounts_and_subsides_over_a_minute():
    rs = room.RoomState(zones.Zones())
    run(rs, 30, 6)
    assert rs.crowd == pytest.approx(0.5, abs=0.02) and rs.headcount == 6
    run(rs, 31, 6)
    assert rs.crowd == pytest.approx(1.0)
    run(rs, 30, 1)
    assert rs.crowd == pytest.approx(0.5, abs=0.02)
    run(rs, 60, 1)
    assert rs.crowd == pytest.approx(1 / room.CROWD_FULL)            # one person: a hint
    run(rs, 61, 0)
    assert rs.crowd == 0.0


def test_the_empty_room_ramps_over_a_minute_and_wakes_within_3_s():
    rs = room.RoomState(zones.Zones())
    run(rs, room.EMPTY_GRACE_S - 0.5, 0)
    assert rs.empty == 0.0                                             # the counter blinks: not empty yet
    run(rs, 0.5 + 30, 0)
    assert rs.empty == pytest.approx(0.5, abs=0.02)
    run(rs, 31, 0)
    assert rs.empty == pytest.approx(1.0) and rs.wake == 0.0
    run(rs, 3.0, 1)
    assert rs.empty == 0.0 and rs.wake > 0.2                           # someone came in: awake, and the pond noticed
    run(rs, room.WAKE_S, 1)
    assert rs.wake == 0.0
    run(rs, 20, 0, [{'ropes': [2]}])                                   # a lingerer alone still counts as someone
    assert rs.empty == 0.0


def test_no_counter_is_neutral():
    rs = room.RoomState(zones.Zones())
    run(rs, 70, 5, [{'ropes': [4]}])
    run(rs, 70, None, [{'ropes': [4]}])
    assert rs.crowd == 0.0 and rs.empty == 0.0 and rs.linger_strength == 0.0 and not rs.available
    run(rs, 70, 0, available=False)
    assert rs.empty == 0.0


def test_ctx_and_status_shapes():
    rs = run(room.RoomState(zones.Zones()), 2, 2, [{'ropes': [5, 6]}])
    c = rs.ctx()
    assert set(c) == {'crowd', 'empty', 'linger', 'headcount', 'wake'}
    assert c['linger'].shape == (20,) and c['headcount'] == 2
    s = rs.status()
    assert s['linger_ropes'] and s['headcount'] == 2 and s['available'] is True
    import json
    json.dumps(s)
