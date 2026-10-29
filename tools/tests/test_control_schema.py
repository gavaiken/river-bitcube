"""The remembered river's control request file (td/remembered/control_schema.py, docs/remembered-river.md section 5): the
generated copy mission control reads is current; flat keys win over the nested zones block zones.py writes; opening night is
on unless told; a light check never survives a restart and reverts after 10 minutes; intensity 0 is 0; a non-numeric knob
from Dave never aborts a tick; probe.ps1 writes only the canonical shape."""
import json
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import control_schema as cs  # noqa: E402
from remembered import show  # noqa: E402

T0 = 1_800_000_000.0
PROBE = ROOT / 'tools' / 'mission' / 'probe.ps1'


def test_the_generated_schema_matches_the_python_source():
    assert cs.OUT == ROOT / 'mission' / 'public' / 'remembered-schema.js'
    assert cs.OUT.read_text(encoding='utf-8') == cs.dump_json(), 'run: python td/remembered/control_schema.py'
    assert cs.main(['--check']) == 0
    body = cs.OUT.read_text(encoding='utf-8')
    data = json.loads(body[body.index('export default ') + len('export default '):].rstrip().rstrip(';'))
    assert data['fields']['screens.intensity']['default'] == 0.82 and data['fields']['opening_night']['default'] is True
    assert data['ui']['lights'] == ['off', 'pool', 'eddies'] and data['light_max_s'] == 600


def test_every_field_has_type_default_and_doc():
    for name, f in cs.FIELDS.items():
        assert {'type', 'default', 'doc'} <= set(f), name
        if f['type'] == 'number':
            assert f['min'] < f['max'] and (f['default'] is None or f['min'] <= f['default'] <= f['max']), name
        if f['type'] == 'enum':
            assert f['default'] in f['choices'], name
    assert set(show.CONTROL_KEYS) <= set(cs.FIELDS)
    assert show.FIELDS == ('ribbons', 'fine', 'streaks') and show.LIGHTS == ('off', 'pool', 'eddies', 'leds')


def test_validate_keeps_only_valid_fields():
    v = cs.validate({'pool_height_m': 9, 'light': 'strobe', 'opening_night': 'no', 'screens': {'video': 0.4, 'intensity': -1,
                     'threshold': True, 'field': 'fine', 'gpu': 'yes'}, 'at': 'yesterday', 'junk': 1})
    assert v == {'screens.video': 0.4, 'screens.field': 'fine'}
    assert cs.validate(None) == {} and cs.validate([1]) == {}
    assert cs.validate({'screens': {'intensity': 0}}) == {'screens.intensity': 0.0}       # 0 is a value, not "unset"


def test_flat_keys_win_over_the_nested_zones_block():
    # the shape zones.py light --write leaves, then mission control's Off and pool slider written flat beside it
    both = {'t': T0, 'zones': {'file': 'z.json', 'light': 'pool', 'pool_height_m': 0.9, 'leds': [{'rope': 1, 'from': 0, 'to': 9}]},
            'light': 'off', 'pool_height_m': 0.4}
    c = show.parse_control(both)
    assert c['light'] == 'off' and c['pool_height_m'] == 0.4
    assert c['leds'] == [{'rope': 1, 'from': 0, 'to': 9}], 'leds: no flat key, so the nested one still counts'
    nested = show.parse_control({'t': T0, 'zones': {'light': 'eddies', 'pool_height_m': 0.7}})
    assert nested['light'] == 'eddies' and nested['pool_height_m'] == 0.7                # nested alone: the fallback
    assert cs.validate({'t': T0, 'zones': {'light': 'pool'}})['light_at'] == T0          # zones.py's t stamps its light
    assert 'light_at' not in cs.validate({'t': T0, 'light': 'pool', 'zones': {'light': 'pool'}})
    # an invalid flat value is dropped, it doesn't let the nested one back in
    assert show.parse_control({'light': 'strobe', 'zones': {'light': 'pool'}})['light'] == 'off'
    # the old flat screen_<name> keys and opening.on: fallbacks too
    assert show.parse_control({'screen_video': 0.2, 'screens': {'video': 0.5}})['screen_video'] == 0.5
    assert show.parse_control({'screen_video': 0.2})['screen_video'] == 0.2
    assert show.parse_control({'opening': {'on': False}, 'opening_night': True})['opening_night'] is True


def test_opening_night_is_on_unless_the_file_says_false():
    assert show.parse_control({})['opening_night'] is True
    assert show.parse_control({'screens': {'video': 0.3}, 'at': '2026-10-29T04:00:00Z'})['opening_night'] is True
    assert show.parse_control({'opening_night': False})['opening_night'] is False


def test_times():
    assert cs.to_epoch('2026-10-29T04:12:09Z') == 1793247129.0
    assert cs.to_epoch(T0) == T0 and cs.to_epoch('2026-10-29T04:12:09') is None and cs.to_epoch('soon') is None
    assert cs.to_epoch(True) is None and cs.to_epoch(0) is None
    assert cs.light_set_at({'light_at': T0, 'at': T0 + 50}, T0 + 99) == T0
    assert cs.light_set_at({'at': T0 + 50}, T0 + 99) == T0 + 50
    assert cs.light_set_at({}, T0 + 99) == T0 + 99


def test_a_light_check_never_survives_a_restart_and_reverts_after_ten_minutes():
    raw = {'light': 'pool', 'light_at': T0 - 3600, 'pool_height_m': 0.5}
    ctl, why = show.effective_light(show.parse_control(raw), raw, T0 - 3600, started=T0, now=T0 + 1)
    assert ctl['light'] == 'off' and why == 'set before the show started' and ctl['pool_height_m'] == 0.5
    raw = {'light': 'eddies', 'light_at': T0 + 10}
    ctl, why = show.effective_light(show.parse_control(raw), raw, T0 + 10, started=T0, now=T0 + 20)
    assert ctl['light'] == 'eddies' and why is None
    ctl, why = show.effective_light(show.parse_control(raw), raw, T0 + 10, started=T0, now=T0 + 10 + 601)
    assert ctl['light'] == 'off' and why == 'set over 10 minutes ago'
    # a later write of another control (a newer at) doesn't bring the old light back: light_at is what counts
    raw = {'light': 'pool', 'light_at': T0 + 10, 'at': T0 + 900, 'screens': {'video': 0.2}}
    assert show.effective_light(show.parse_control(raw), raw, T0 + 900, started=T0, now=T0 + 901)[0]['light'] == 'off'
    # without light_at: the file's at, else its write time
    raw = {'light': 'leds', 'leds': [{'rope': 0, 'from': 1, 'to': 2}]}
    ctl, _ = show.effective_light(show.parse_control(raw), raw, T0 - 5, started=T0, now=T0)
    assert ctl['light'] == 'off' and ctl['leds'] == []
    assert show.effective_light(show.parse_control(raw), raw, T0 + 5, started=T0, now=T0 + 6)[0]['light'] == 'leds'


def test_the_show_reads_the_light_through_the_start_rule(tmp_path):
    river = tmp_path / 'River'
    (river / 'remembered').mkdir(parents=True)
    cp = river / 'remembered' / 'control.json'
    cp.write_text(json.dumps({'light': 'pool', 'pool_height_m': 0.5}))
    os.utime(cp, (T0 - 60, T0 - 60))                                  # written a minute before the show started
    s = show.Show(river_dir=river, data_dir=tmp_path / 'none')
    s.started = T0
    s.next['library'] = 1e18
    s._read(T0)
    assert s.control['light'] == 'off' and s.control['pool_height_m'] == 0.5 and s.light_dropped
    cp.write_text(json.dumps({'light': 'pool', 'light_at': '2027-01-15T08:00:10Z'}))   # someone presses Light the pool
    now = cs.to_epoch('2027-01-15T08:00:12Z')
    s.next['control'] = 0
    s._read(now)
    assert s.control['light'] == 'pool' and s.light_dropped is None
    s.next['control'] = 0
    s._read(now + 601)
    assert s.control['light'] == 'off'


def test_screen_intensity_zero_is_dark_not_the_default(tmp_path):
    s = show.Show(river_dir=tmp_path, data_dir=tmp_path / 'none')
    assert s.screen_intensity() == cs.DEFAULTS['screens.intensity'] == 0.82
    s.control = show.parse_control({'screens': {'intensity': 0, 'threshold': 0}})
    assert s.screen_intensity() == 0.0
    now = s.screens_now()
    assert now['intensity'] == 0.0 and now['threshold'] == 0.0
    src = (ROOT / 'td' / 'remembered' / 'show.py').read_text(encoding='utf-8')
    assert not re.search(r"control\[[^\]]+\] or ", src), 'a legal 0 must never read as unset'


def test_a_non_numeric_knob_from_dave_keeps_the_tick_going(capsys):
    show._warned.clear()
    k = show.Knobs()
    k.set_scene({'seq': 1, 'scene': {'speed': 'fast', 'density': None, 'brightness': 0.9, 'turbulence': [1],
                                     'transition_seconds': 'soon'}}, T0)
    assert k.target == {'speed': 0.5, 'density': 0.5, 'brightness': 0.9, 'turbulence': 0.5}
    k.set_scene({'seq': 2, 'scene': {'speed': 'fast', 'transition_seconds': 'soon'}}, T0 + 2)
    assert k.seconds == 60.0
    out = capsys.readouterr().out
    assert out.count("scene.speed is 'fast'") == 1, 'warned once, not every 2 s'
    k.set_reflex({'updated_epoch': T0, 'ttl_seconds': 90, 'offsets': {'speed': 'x', 'density': 0.1}}, T0 + 1)
    assert k.reflex_target['speed'] == 0.0 and k.reflex_target['density'] == 0.1
    k.set_scene({'seq': 3, 'scene': 'broken'}, T0)                     # not even a dict: ignored
    k.set_scene('broken', T0)


def test_probe_writes_the_canonical_shape():
    src = PROBE.read_text(encoding='utf-8')
    rem = src[src.index("if ($Action -in 'remembered', 'remembered-zones', 'remembered-opening', 'remembered-screens') {"):
              src.index("if ($Action -eq 'rebuild') {")]
    # opening night is written only by remembered-opening: never seeded (TouchDesigner's default is on)
    assert '$ctl = [ordered]@{}' in rem and 'opening_night = $false' not in rem
    sets = re.findall(r'\$ctl\.opening_night = ([^\s}]+)', rem)
    assert sets == ['$ctl.opening.on', '[bool]$On'], 'only the old opening.on spelling of a value already there, and the switch'
    assert re.search(r"Action -eq 'remembered-opening'\)\s*\{\s*\$ctl\.opening_night = \[bool\]\$On", rem)
    # the nested zones block and its t are folded into flat keys (flat ones win) and dropped
    assert "$ctl.Remove('zones')" in rem and "$ctl.Remove('t')" in rem and '$ctl.light_at' in rem
    assert "-not $ctl.Contains($k)" in rem
    assert 'ConvertTo-Json -InputObject $ctl -Compress -Depth' in rem


# ---- overrides (v2 plan decision 6) -------------------------------------------------------------------------------------

def test_every_param_has_range_default_unit_group_modes_and_doc():
    assert set(cs.PARAMS) == {'day', 'surge_hour', 'knob.speed', 'knob.density', 'knob.brightness', 'knob.turbulence',
                              'palette', 'flow_level', 'headcount', 'lingerer_rope', 'calm_min', 'calm_max',
                              'master_brightness'}
    for name, p in cs.PARAMS.items():
        assert {'type', 'default', 'unit', 'group', 'modes', 'doc'} <= set(p), name
        assert p['modes'][0] == 'auto' and set(p['modes']) <= set(cs.MODES), name
        if p['type'] in ('number', 'int'):
            assert p['min'] < p['max'] and (p['default'] is None or p['min'] <= p['default'] <= p['max']), name
        else:
            assert 'adjust' not in p['modes'], name
    assert cs.SIMULATED == ('headcount', 'lingerer_rope') and cs.SIMULATED_MAX_S == 120
    assert (cs.PARAMS['master_brightness']['max'], cs.PARAMS['surge_hour']['max'], cs.PARAMS['lingerer_rope']['max'],
            cs.PARAMS['headcount']['max']) == (1.5, 24.0, 19, 20.0)
    body = cs.OUT.read_text(encoding='utf-8')
    data = json.loads(body[body.index('export default ') + len('export default '):].rstrip().rstrip(';'))
    assert data['params']['knob.speed']['modes'] == ['auto', 'fix', 'adjust']
    assert data['overrides']['simulated_max_s'] == 120 and data['overrides']['days']['count'] > 7000


def test_override_values_are_checked_per_type():
    assert cs.param_value('day', '2017-02-07') == '2017-02-07'
    assert cs.param_value('day', '1990-01-01') is None, 'not a day in days.csv'
    assert cs.param_value('day', '2017-02-30') is None and cs.param_value('day', 20170207) is None
    assert cs.param_value('palette', ['#0B3D5C', '#1f8fb3', '#bfefff']) == ['#0b3d5c', '#1f8fb3', '#bfefff']
    assert cs.param_value('palette', ['#0b3d5c', '#1f8fb3']) is None and cs.param_value('palette', ['red'] * 3) is None
    assert cs.param_value('lingerer_rope', 7) == 7 and cs.param_value('lingerer_rope', 7.5) is None
    assert cs.param_value('lingerer_rope', 20) is None and cs.param_value('headcount', 3) == 3.0
    assert cs.param_value('master_brightness', 1.5) == 1.5 and cs.param_value('master_brightness', 1.6) is None
    assert cs.param_value('knob.speed', True) is None and cs.param_value('knob.speed', float('nan')) is None


def test_validate_overrides_keeps_only_valid_unexpired_entries():
    now = T0 + 30
    raw = {'knob.speed': {'mode': 'adjust', 'offset': 0.1, 'gain': 1.2, 'at': cs.iso(T0), 'expires_at': None},
           'knob.density': {'mode': 'fix', 'value': 0.9},
           'knob.turbulence': {'mode': 'auto', 'value': 0.2},              # auto = no override
           'knob.brightness': {'mode': 'fix', 'value': 2},                 # out of range
           'palette': {'mode': 'adjust', 'offset': 0.1},                    # adjust: numbers only
           'surge_hour': {'mode': 'fix', 'value': 9, 'expires_at': cs.iso(T0 + 10)},   # expired
           'calm_min': {'mode': 'fix', 'value': 0.1, 'expires_at': 'later'},          # unreadable expiry
           'flow_level': {'mode': 'adjust', 'gain': 5},                     # gain over 4
           'day': {'mode': 'fix', 'value': '2017-02-07'},
           'nonsense': {'mode': 'fix', 'value': 1}, 'master_brightness': 1.2}
    v = cs.validate_overrides(raw, now)
    assert set(v) == {'knob.speed', 'knob.density', 'day'}
    assert v['knob.speed'] == {'mode': 'adjust', 'offset': 0.1, 'gain': 1.2, 'at': cs.iso(T0), 'expires_at': None}
    assert v['knob.density'] == {'mode': 'fix', 'value': 0.9, 'at': None, 'expires_at': None}
    assert 'surge_hour' in cs.validate_overrides(raw, T0 + 5)
    assert cs.validate_overrides(None, now) == {} and cs.validate_overrides([1], now) == {}
    # through validate(): present only when it holds something; parse_control ignores it
    assert cs.validate({'overrides': raw}, now)['overrides'] == v
    assert 'overrides' not in cs.validate({'overrides': {'knob.speed': {'mode': 'auto'}}}, now)
    assert show.parse_control({'overrides': raw}) == show.CONTROL_DEFAULT


def test_simulated_people_never_last_past_two_minutes():
    raw = {'headcount': {'mode': 'fix', 'value': 8, 'at': cs.iso(T0), 'expires_at': cs.iso(T0 + 3600)},
           'lingerer_rope': {'mode': 'fix', 'value': 7, 'at': cs.iso(T0), 'expires_at': cs.iso(T0 + 30)}}
    v = cs.validate_overrides(raw, T0 + 10)
    assert v['headcount']['expires_at'] == cs.iso(T0 + 120) and v['lingerer_rope']['expires_at'] == cs.iso(T0 + 30)
    assert set(cs.validate_overrides(raw, T0 + 60)) == {'headcount'}
    assert cs.validate_overrides(raw, T0 + 120) == {}
    assert cs.validate_overrides({'headcount': {'mode': 'fix', 'value': 8}}, T0) == {}, 'no at: cannot be bounded'
    future = {'headcount': {'mode': 'fix', 'value': 8, 'at': cs.iso(T0 + 3600)}}
    assert cs.validate_overrides(future, T0) == {}, 'a wrong clock never makes a simulation stick'
    assert cs.validate_overrides({'headcount': {'mode': 'adjust', 'offset': 2, 'at': cs.iso(T0)}}, T0) == {}
