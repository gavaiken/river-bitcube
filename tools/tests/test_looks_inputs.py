"""What the looks are fed (td/looks/inputs.py): Dave's agent, the river and the room read from River's files the way
the remembered river reads them, None for anything missing, stale or malformed, and never an exception; what each look
takes from them; and the one-line summary for the logs."""
import json
import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from looks import inputs  # noqa: E402
from remembered import palette  # noqa: E402

T0 = 1_800_000_000.0
COLORS = ['#0a1f3c', '#3f7f9a', '#bfe8f0', '#1d4a66', '#7fc0d0']


def put(path, data, mtime=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data), encoding='utf-8')
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def lay_out(river, now=T0):
    """A River folder as on bitcube: Dave's mirror, the remembered river's status, the people counter."""
    put(river / 'gallery_state' / 'state.json', {
        'memory': {'date': '2017-02-07', 'chosen_at': '2027-01-15T08:00:00Z', 'reason': 'the February storm',
                   'profile': {'flow': [1.0] * 24}},
        'surge_at': 13.5,
        'scene': {'animation': 'drift', 'palette_name': 'deepening-pool', 'colors': COLORS, 'speed': 0.7,
                  'density': 0.4, 'brightness': 0.55, 'turbulence': 1.4, 'transition_seconds': 60},
        'set_at': '2027-01-15T08:00:00Z', 'set_at_epoch': now - 240})
    put(river / 'gallery_state' / 'reflex.json', {'updated_epoch': now - 20, 'ttl_seconds': 90, 'heard': 0.42})
    put(river / 'remembered' / 'status.json', {'t': now - 1, 'river_source': 'live', 'river_motion': 0.31,
                                               'room': {'presence': 3.0, 'usual': 1.5, 'relative': 2.0, 'lingerers': []}})
    put(river / 'presence.json', {'t': now - 0.5, 'count': 3, 'people': [{}, {}, {}],
                                  'lingerers': [{'x': 0.4, 'y': 0.8, 'still_s': 12.34, 'ropes': [4, 5]}]})


def test_the_full_happy_path(tmp_path):
    """Every file present and fresh: each value read as the remembered river reads it, in exactly the contract's shape."""
    lay_out(tmp_path)
    got = inputs.gather(tmp_path, T0)
    assert set(got) == {'dave', 'river', 'room'}
    assert set(got['dave']) == {'age_s', 'memory_date', 'surge_at', 'scene', 'palette', 'knobs', 'heard', 'heard_age_s'}
    assert set(got['river']) == {'source', 'motion', 'age_s'}
    assert set(got['room']) == {'people', 'usual', 'lingerers'}
    d = got['dave']
    assert d['age_s'] == 240 and d['memory_date'] == '2017-02-07' and d['surge_at'] == 13.5
    assert d['scene'] == 'drift / deepening-pool'
    assert d['knobs'] == {'speed': 0.7, 'density': 0.4, 'brightness': 0.55, 'turbulence': 1.0}   # clamped to 0..1
    assert d['heard'] == 0.42 and d['heard_age_s'] == 20
    assert got['river'] == {'source': 'live', 'motion': 0.31, 'age_s': 1}
    assert got['room'] == {'people': 3, 'usual': 1.5, 'lingerers': [{'ropes': [4, 5], 'seconds': 12.3}]}
    json.dumps(got)                                                # it goes straight into status.json


def test_the_palette_is_three_hex_colours_like_the_remembered_river_s(tmp_path):
    """Dave's colours, dark to bright, as palette.as_hex writes them (deep, mid, light)."""
    lay_out(tmp_path)
    pal = inputs.gather(tmp_path, T0)['dave']['palette']
    assert pal == palette.as_hex(palette.from_dave(COLORS))
    assert pal == ['#0a1f3c', '#3f7f9a', '#bfe8f0']
    assert all(len(c) == 7 and c.startswith('#') for c in pal)


def test_each_missing_file_is_none_and_nothing_else_changes(tmp_path):
    """Take the files away one at a time: only what came from that file goes to None."""
    full = None
    for rel in ('gallery_state/state.json', 'gallery_state/reflex.json', 'remembered/status.json', 'presence.json'):
        lay_out(tmp_path)
        full = full or inputs.gather(tmp_path, T0)
        (tmp_path / rel).unlink()
        got = inputs.gather(tmp_path, T0)
        if rel.endswith('state.json') and 'gallery' in rel:
            assert all(got['dave'][k] is None for k in ('age_s', 'memory_date', 'surge_at', 'scene', 'palette', 'knobs'))
            assert got['dave']['heard'] == 0.42
        elif rel.endswith('reflex.json'):
            assert got['dave']['heard'] is None and got['dave']['heard_age_s'] is None
            assert got['dave']['memory_date'] == '2017-02-07'
        elif rel.startswith('remembered'):
            assert got['river'] == {'source': 'none', 'motion': None, 'age_s': None}
            assert got['room']['usual'] is None and got['room']['people'] == 3
        else:
            assert got['room'] == {'people': None, 'usual': 1.5, 'lingerers': None}
            assert got['river'] == full['river']


def test_an_empty_river_folder(tmp_path):
    """Nothing there at all (or no folder): every value None, the river none."""
    for river in (tmp_path, tmp_path / 'nowhere'):
        got = inputs.gather(river, T0)
        assert all(v is None for v in got['dave'].values())
        assert got['river'] == {'source': 'none', 'motion': None, 'age_s': None}
        assert got['room'] == {'people': None, 'usual': None, 'lingerers': None}


def test_malformed_json_never_raises(tmp_path):
    """Half-written files, the wrong types, junk values: Nones, never an exception."""
    lay_out(tmp_path)
    put(tmp_path / 'gallery_state' / 'state.json', '{"memory": {"date": ')
    put(tmp_path / 'gallery_state' / 'reflex.json', '[1, 2, 3]')
    put(tmp_path / 'remembered' / 'status.json', '"just a string"')
    put(tmp_path / 'presence.json', {'t': 'yesterday', 'count': 'many'})
    got = inputs.gather(tmp_path, T0)
    assert all(v is None for v in got['dave'].values())
    assert got['river']['source'] == 'none'
    assert got['room']['people'] is None
    # the right files, with junk inside
    put(tmp_path / 'gallery_state' / 'state.json', {'memory': 'Feb', 'surge_at': 'soon', 'scene': ['x'],
                                                    'set_at': 'never'})
    put(tmp_path / 'gallery_state' / 'reflex.json', {'updated_epoch': 'x', 'heard': 'loud'})
    put(tmp_path / 'presence.json', {'t': T0, 'count': float('nan'), 'people': 'x', 'lingerers': [5, {'ropes': 'a'}]})
    got = inputs.gather(tmp_path, T0)
    assert got['dave']['memory_date'] is None and got['dave']['surge_at'] is None and got['dave']['scene'] is None
    assert got['dave']['age_s'] is not None                        # no usable set_at: the file's own age
    assert got['dave']['heard'] is None
    assert got['room']['people'] is None and got['room']['lingerers'] == [{'ropes': [], 'seconds': None}]
    assert inputs.gather(None, 'later')['river']['source'] == 'none'


def test_a_stale_reflex_has_no_heard(tmp_path):
    """reflex.json past its ttl (or, without updated_epoch, a file over 90 s old): heard None, its age still shown."""
    lay_out(tmp_path)
    put(tmp_path / 'gallery_state' / 'reflex.json', {'updated_epoch': T0 - 200, 'ttl_seconds': 90, 'heard': 0.42})
    d = inputs.gather(tmp_path, T0)['dave']
    assert d['heard'] is None and d['heard_age_s'] == 200
    put(tmp_path / 'gallery_state' / 'reflex.json', {'heard': 0.42}, mtime=T0 - 30)
    assert inputs.gather(tmp_path, T0)['dave']['heard'] == 0.42
    put(tmp_path / 'gallery_state' / 'reflex.json', {'heard': 0.42}, mtime=T0 - 120)
    d = inputs.gather(tmp_path, T0)['dave']
    assert d['heard'] is None and d['heard_age_s'] == 120


def test_dave_s_age_falls_back_from_set_at_epoch_to_set_at_to_the_file(tmp_path):
    """age_s: now minus set_at_epoch, else the ISO set_at, else the file's mtime."""
    st = {'memory': {'date': '2019-03-01'}, 'surge_at': '2027-01-15T09:30:00Z', 'set_at': '2027-01-15T08:00:00Z'}
    p = put(tmp_path / 'gallery_state' / 'state.json', st, mtime=T0 - 5)
    set_at = inputs._epoch(st['set_at'])
    d = inputs.gather(tmp_path, set_at + 300)['dave']
    assert d['age_s'] == 300 and d['surge_at'] == '2027-01-15T09:30:00Z'   # an ISO surge kept as given
    assert d['scene'] is None and d['palette'] is None and d['knobs'] is None   # no scene yet
    put(p, {'memory': {'date': '2019-03-01'}, 'surge_at': 30}, mtime=T0 - 5)
    d = inputs.gather(tmp_path, T0)['dave']
    assert d['age_s'] == 5 and d['surge_at'] == 24.0                # clamped as clock.dave_day does


def test_a_placeholder_scene_is_no_scene(tmp_path):
    lay_out(tmp_path)
    put(tmp_path / 'gallery_state' / 'state.json', {'scene': {'placeholder': True, 'colors': COLORS}, 'set_at_epoch': T0})
    d = inputs.gather(tmp_path, T0)['dave']
    assert d['scene'] is None and d['palette'] is None and d['knobs'] is None


def test_stale_files_are_unknown(tmp_path):
    """The remembered river's status over 10 s old and presence.json over 30 s old count as not there."""
    lay_out(tmp_path)
    got = inputs.gather(tmp_path, T0 + 60)
    assert got['river'] == {'source': 'none', 'motion': None, 'age_s': None}
    assert got['room'] == {'people': None, 'usual': None, 'lingerers': None}


def fake_show(river_t=T0 - 2, source='clip', level=0.25, usual=1.2, last_status=None):
    """Just enough of a remembered Show for gather and used_by: its river, its room, its last status."""
    room = types.SimpleNamespace(stats=lambda now: {'available': True, 'usual': usual})
    return types.SimpleNamespace(river_t=river_t, river_source=source, motion=types.SimpleNamespace(level=level), room=room,
                                 last_status=last_status)


def test_the_river_from_the_show_when_its_status_is_stale(tmp_path):
    """No fresh status.json (another look on the lights): the show's own river while its last frame is under 10 s."""
    lay_out(tmp_path)
    (tmp_path / 'remembered' / 'status.json').unlink()
    got = inputs.gather(tmp_path, T0, remembered_show=fake_show())
    assert got['river'] == {'source': 'clip', 'motion': 0.25, 'age_s': 2}
    assert got['room']['usual'] == 1.2
    got = inputs.gather(tmp_path, T0, remembered_show=fake_show(river_t=T0 - 30))
    assert got['river'] == {'source': 'none', 'motion': None, 'age_s': None}
    broken = types.SimpleNamespace(river_t=T0, river_source='live')            # no panels, no room
    got = inputs.gather(tmp_path, T0, remembered_show=broken)
    assert got['river']['source'] == 'none' and got['room']['usual'] is None


STATUS = {'day': {'date': '2017-02-07', 'reason': 'Dave: the February storm', 'chosen_by': 'dave', 'source': 'dave'},
          'surge': {'hour': 13.5, 'why': 'Dave: hour 13.5'}, 'heard': 0.42,
          'knobs': {'speed': 0.7, 'density': 0.4, 'brightness': 0.55, 'turbulence': 0.5, 'reflex': {'speed': 0.1}},
          'room': {'presence': 3.0, 'usual': 1.5, 'relative': 2.0, 'lingerers': [{'ropes': [4]}, {'ropes': [9]}]}}


def test_used_by_the_remembered_river():
    """The remembered river: its day and why, heard, the knobs and the room, from its last status."""
    used = inputs.used_by('remembered', remembered_show=fake_show(last_status=STATUS))
    assert used == {'day': '2017-02-07', 'why': 'Dave: the February storm', 'heard': 0.42,
                    'knobs': {'speed': 0.7, 'density': 0.4, 'brightness': 0.55, 'turbulence': 0.5},
                    'room': {'people': 3.0, 'lingerers': 2}}
    empty = {'day': None, 'why': None, 'heard': None, 'knobs': None, 'room': {'people': None, 'lingerers': None}}
    assert inputs.used_by('remembered') == empty
    assert inputs.used_by('remembered', remembered_show=fake_show(last_status='junk')) == empty
    assert inputs.used_by('remembered', remembered_show=fake_show(last_status={'day': 3, 'room': None}))['day'] is None


def test_used_by_the_other_looks():
    """The fills take nothing from the inputs; seasons and modal pass through whatever they say."""
    assert inputs.used_by('fill-simple', fill=object()) == {}
    assert inputs.used_by('fill-configurable') == {}
    assert inputs.used_by('seasons', extra={'mode': 'dynamic', 'people': 2}) == {'mode': 'dynamic', 'people': 2}
    assert inputs.used_by('modal', extra=None) == {} and inputs.used_by('modal', extra='x') == {}
    assert inputs.used_by(None) == {}


def test_the_summary_line(tmp_path):
    lay_out(tmp_path)
    got = inputs.gather(tmp_path, T0)
    line = inputs.summary_line(got, inputs.used_by('remembered', fake_show(last_status=STATUS)))
    assert line == 'Dave 4 min old (7 Feb 2017, surge 13.5), heard 0.42, river live (motion 0.31), 3 people, 1 lingerer'
    other = dict(STATUS, day={'date': '2019-03-01'})
    assert inputs.summary_line(got, inputs.used_by('remembered', fake_show(last_status=other))).endswith(
        'playing 1 Mar 2019')
    blank = inputs.gather(tmp_path / 'nowhere', T0)
    assert inputs.summary_line(blank, {}) == 'Dave: no state, river none, room unknown'
    assert inputs.summary_line(None, None) == 'Dave: no state, river unknown, room unknown'
    assert inputs.summary_line('junk', 'junk') == 'Dave: no state, river unknown, room unknown'


def test_a_ticking_show_lends_its_parsed_inputs_instead_of_a_second_read(tmp_path):
    """While the remembered show ticks, gather takes its state, reflex, presence and last status (no file reads);
    once it stops ticking (another look) the files are read again."""
    lay_out(tmp_path)
    s = fake_show(last_status={'t': T0 - 0.2, 'river_source': 'live', 'river_motion': 0.5, 'room': {'usual': 2.0}})
    s.last_tick = T0 - 0.1
    s.state, s.state_mtime = {'memory': {'date': '1999-01-02'}, 'set_at_epoch': T0 - 60}, T0 - 60
    s.reflex = {'heard': 0.5, 'updated_epoch': T0 - 5, '_mtime': T0 - 5}
    s.presence_raw = {'t': T0 - 1, 'count': 7, 'lingerers': []}
    got = inputs.gather(tmp_path, T0, remembered_show=s)
    assert got['dave']['memory_date'] == '1999-01-02' and got['dave']['age_s'] == 60 and got['dave']['heard_age_s'] == 5
    assert got['river'] == {'source': 'live', 'motion': 0.5, 'age_s': 0} and got['room']['people'] == 7
    assert got['room']['usual'] == 2.0
    s.last_tick = T0 - 10                                 # not ticking: the files as before
    files_view = inputs.gather(tmp_path, T0, remembered_show=s)
    assert files_view['dave'] == inputs.gather(tmp_path, T0)['dave'] and files_view['room']['people'] == 3
