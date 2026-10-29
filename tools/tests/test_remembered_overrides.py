"""Manual overrides of the remembered river's parameters (td/remembered/overrides.py, control_schema.PARAMS; v2 plan
decision 6, docs/remembered-river.md section 5): auto / fix / adjust, expiry, simulated people for 2 minutes at most, and
what status.json reports (params, overrides, simulating, inputs)."""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import control_schema as cs  # noqa: E402
from remembered import overrides as ov  # noqa: E402
from remembered import status  # noqa: E402

T0 = 1_800_000_000.0


def test_no_override_is_auto():
    v, how = ov.apply('knob.speed', 0.42, {}, T0)
    assert v == 0.42 and how == {'mode': 'auto', 'auto': 0.42, 'value': 0.42, 'source': 'auto', 'expires_in_s': None}
    assert ov.apply('knob.speed', 0.42, None, T0)[0] == 0.42
    assert ov.apply('knob.speed', 0.42, {'knob.speed': {'mode': 'auto', 'value': 0.9}}, T0)[0] == 0.42


def test_fix_and_adjust():
    o = {'knob.speed': {'mode': 'fix', 'value': 0.9},
         'knob.density': {'mode': 'adjust', 'offset': 0.1, 'gain': 1.5},
         'master_brightness': {'mode': 'adjust', 'gain': 4},
         'calm_max': {'mode': 'adjust', 'offset': -1.0},
         'palette': {'mode': 'fix', 'value': ['#000000', '#111111', '#FFFFFF']},
         'day': {'mode': 'fix', 'value': '2017-02-07'}}
    v, how = ov.apply('knob.speed', 0.4, o, T0)
    assert v == 0.9 and how['source'] == 'fixed' and how['auto'] == 0.4 and how['mode'] == 'fix'
    v, how = ov.apply('knob.density', 0.4, o, T0)
    assert abs(v - 0.7) < 1e-9 and how['source'] == 'adjusted'
    assert ov.apply('master_brightness', 1.0, o, T0)[0] == 1.5, 'clamped to the range'
    assert ov.apply('calm_max', 0.6, o, T0)[0] == 0.0
    assert ov.apply('palette', ['#0b3d5c', '#1f8fb3', '#bfefff'], o, T0)[0] == ['#000000', '#111111', '#ffffff']
    assert ov.apply('day', '2005-12-31', o, T0) == ('2017-02-07', {'mode': 'fix', 'auto': '2005-12-31',
                                                                  'value': '2017-02-07', 'source': 'fixed',
                                                                  'expires_in_s': None})
    # adjusting nothing (no river camera, no sound) stays nothing
    v, how = ov.apply('flow_level', None, {'flow_level': {'mode': 'adjust', 'offset': 0.2}}, T0)
    assert v is None and how['source'] == 'auto'
    values, hows = ov.apply_all({'knob.speed': 0.4, 'knob.density': 0.4}, o, T0)
    assert values['knob.speed'] == 0.9 and hows['knob.density']['source'] == 'adjusted'


def test_expiry_counts_down_and_drops_at_once():
    o = {'surge_hour': {'mode': 'fix', 'value': 9, 'at': cs.iso(T0), 'expires_at': cs.iso(T0 + 600)}}
    assert ov.apply('surge_hour', 13.5, o, T0 + 100)[1]['expires_in_s'] == 500
    assert ov.apply('surge_hour', 13.5, o, T0 + 600) == (13.5, {'mode': 'auto', 'auto': 13.5, 'value': 13.5,
                                                               'source': 'auto', 'expires_in_s': None})
    # validated once, applied later: the validated entry still expires on time
    val = cs.validate_overrides(o, T0)
    assert ov.apply('surge_hour', 13.5, val, T0 + 599)[0] == 9.0 and ov.apply('surge_hour', 13.5, val, T0 + 601)[0] == 13.5


def test_simulated_people():
    o = {'headcount': {'mode': 'fix', 'value': 6, 'at': cs.iso(T0)},
         'lingerer_rope': {'mode': 'fix', 'value': 12, 'at': cs.iso(T0 + 60), 'expires_at': None}}
    assert ov.simulated_people(o, T0 + 10) == (6.0, 12) and ov.simulating(o, T0 + 10)
    assert ov.apply('headcount', 2.0, o, T0 + 10)[1]['expires_in_s'] == 110
    assert ov.simulated_people(o, T0 + 121) == (None, 12)
    assert ov.simulated_people(o, T0 + 181) == (None, None) and not ov.simulating(o, T0 + 181)
    assert ov.simulated_people({}, T0) == (None, None) and ov.simulated_people(None, T0) == (None, None)
    act = ov.active(o, T0 + 10)
    assert act['headcount'] == {'mode': 'fix', 'value': 6.0, 'at': cs.iso(T0), 'expires_at': cs.iso(T0 + 120),
                                'expires_in_s': 110, 'simulated': True}


def _status(**kw):
    loop = {'index': 1, 't_s': 10.0, 'hour': 0.8, 'phase': 'calm', 'next': None}
    return status.build(now=T0, show='river-all-looks-v2.toe', fps=30, loop=loop, day=None, plan={}, knobs={}, reflex={},
                        palette=['#000000'] * 3, heard=None, river_motion=None, river_source='none',
                        room={'presence': 0, 'usual': 0, 'relative': None, 'lingerers': []}, lit_pct=[0, 0, 0, 0],
                        cap=0.4, watts=0, opening_night=True, zones_file='default', pool_height_m=0.6, light='off', **kw)


def test_status_reports_inputs_params_effects_overrides():
    st = _status()
    assert set(st['inputs']) == set(status.INPUTS) and set(st['params']) == set(cs.PARAMS)
    assert st['inputs']['heard'] == {'value': None, 'source': None, 'age_s': None, 'fresh': False}
    assert st['params']['knob.speed'] == {'mode': 'auto', 'auto': None, 'value': None, 'source': 'auto',
                                          'expires_in_s': None}
    assert st['effects'] == {} and st['overrides'] == {} and st['simulating'] is False
    o = {'headcount': {'mode': 'fix', 'value': 6, 'at': cs.iso(T0 - 30)}, 'knob.speed': {'mode': 'fix', 'value': 0.9}}
    _, how = ov.apply('knob.speed', 0.512345, o, T0)
    st = _status(sources={'heard': {'value': 0.6234567, 'source': 'sound', 'age_s': 3.21, 'fresh': True},
                          'scene': {'value': {'speed': 0.6, 'density': 0.4}, 'source': 'dave', 'age_s': 200, 'fresh': True},
                          'bogus': {'value': 1}},
                 params={'knob.speed': how}, effects={'lingerer': {'ropes': [6, 7, 8], 'level': 0.81234}},
                 overrides=o)
    assert st['inputs']['heard'] == {'value': 0.623, 'source': 'sound', 'age_s': 3.2, 'fresh': True}
    assert st['inputs']['scene']['value'] == [0.6, 0.4, 0.0, 0.0] and 'bogus' not in st['inputs']
    assert st['params']['knob.speed'] == {'mode': 'fix', 'auto': 0.512, 'value': 0.9, 'source': 'fixed',
                                          'expires_in_s': None}
    assert st['effects'] == {'lingerer': {'ropes': [6, 7, 8], 'level': 0.812}}
    assert set(st['overrides']) == {'headcount', 'knob.speed'} and st['overrides']['headcount']['expires_in_s'] == 90
    assert st['simulating'] is True
    json.dumps(st, allow_nan=False)
