"""The remembered river's loop clock (td/remembered/clock.py): phases, surge timing and clamp, the room's shift, Dave's
day vs the fallback, never the same fallback date twice within an hour, the preset loop, the decision wave."""
import datetime as dt
import gzip
import json
import pathlib
import random
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import clock  # noqa: E402

T0 = 1_800_000_000.0


def iso(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def profile(rain_peak_hour=14, rain=4.0, dry=False):
    r = [0.0] * 24
    if not dry:
        for h in range(max(0, rain_peak_hour - 3), rain_peak_hour + 1):
            r[h] = rain * (0.5 if h < rain_peak_hour else 1.0)
    return {'flow': [10.0 + h for h in range(24)], 'rain': r, 'temp': [8.0] * 24, 'snow': [0.0] * 24,
            'is_day': [1 if 7 <= h < 18 else 0 for h in range(24)]}


def make_library(folder, n=14):
    folder.mkdir(parents=True, exist_ok=True)
    dates = [f'2017-01-{d:02d}' for d in range(1, n + 1)]
    (folder / 'notable.json').write_text(json.dumps([{'date': d, 'kind': 'storm', 'line': f'{d}: a storm'} for d in dates]))
    with gzip.open(folder / 'profiles.json.gz', 'wt', encoding='utf-8') as f:
        json.dump({d: profile(10 + i % 8) for i, d in enumerate(dates)}, f)
    (folder / 'days.csv').write_text('date,flow_mean_cfs,flow_pct,rain_mm,heaviest_hour,season,dry,cold\n'
                                     + ''.join(f'{d},100,90,30,{10 + i % 8},winter,false,false\n' for i, d in enumerate(dates)))
    return dates


def state_for(date='2017-02-07', chosen_at=T0, surge_at=13.5, **stats):
    s = {'flow_pct': 96, 'rain_mm': 38.5, 'heaviest_hour': 14, 'season': 'winter', 'dry': False, 'cold': True}
    s.update(stats)
    st = {'memory': {'date': date, 'reason': 'like today', 'chosen_by': 'resemblance', 'chosen_at': iso(chosen_at),
                     'stats': s, 'profile': profile()}}
    if surge_at != 'absent':
        st['surge_at'] = surge_at
    return st


# ---- surge timing -------------------------------------------------------------------------------------------------

def test_dave_surge_at_lands_where_he_says_without_room_shift():
    day, _ = clock.dave_day(state_for(surge_at=13.5), T0)
    plan = clock.plan_surge(day, {'available': True, 'relative': 2.0, 'lingerers': []})
    assert plan['t_s'] == pytest.approx(13.5 * 12.5) and plan['room_shift_s'] == 0
    assert plan['why'] == 'Dave: hour 13.5'


def test_heaviest_hour_minus_half_moved_by_the_room():
    day = clock.make_day('2017-01-01', profile(12), {'heaviest_hour': 12, 'dry': False, 'flow_pct': 80})
    base = 11.5 * 12.5
    assert clock.plan_surge(day)['t_s'] == pytest.approx(base)
    busy = clock.plan_surge(day, {'available': True, 'relative': 1.5, 'presence': 3, 'lingerers': []})
    assert busy['t_s'] == pytest.approx(base - 30) and busy['room_shift_s'] == -30
    ling = clock.plan_surge(day, {'available': True, 'relative': 1.0, 'presence': 1, 'lingerers': [{'ropes': [3]}]})
    assert ling['t_s'] == pytest.approx(base - 30) and 'lingerer' in ling['why']
    empty = clock.plan_surge(day, {'available': True, 'relative': 0.0, 'presence': 0, 'empty_for_s': 120, 'lingerers': []})
    assert empty['t_s'] == pytest.approx(base + 30) and empty['room_shift_s'] == 30
    assert clock.plan_surge(day, {'available': False})['room_shift_s'] == 0      # no counter: no shift


@pytest.mark.parametrize('hour,expect', [(0, 90.0), (2, 90.0), (23, 216.0), (24, 216.0)])
def test_surge_always_clamped_to_90_216_s(hour, expect):
    day = clock.make_day('2017-01-01', profile(), surge_at=float(hour))
    p = clock.plan_surge(day)
    assert p['t_s'] == expect and 'clamped' in p['why']
    day2 = clock.make_day('2017-01-01', profile(), {'heaviest_hour': 1})
    assert clock.plan_surge(day2, {'available': True, 'presence': 0, 'empty_for_s': 999, 'lingerers': []})['t_s'] >= 90


def test_dry_day_no_surge_unless_opening_night():
    day = clock.make_day('2008-10-02', profile(dry=True), {'dry': True})
    assert clock.plan_surge(day) == {'hour': None, 't_s': None, 'why': 'dry day: no surge', 'room_shift_s': 0}
    assert clock.phase_times(day, None) is None and clock.phase_at(150, None) == 'calm'
    on = clock.plan_surge(day, opening_night=True)
    assert on['t_s'] == 150.0 and on['why'] == 'Opening night: a surge every loop (the day was dry)'
    busy = clock.plan_surge(day, {'available': True, 'relative': 2.0, 'presence': 4, 'lingerers': []}, opening_night=True)
    assert busy['t_s'] == 120.0 and busy['why'].startswith('Opening night')
    nulled = clock.make_day('2017-01-01', profile(), {'dry': False}, surge_at=None)    # Dave: surge_at null = dry
    assert clock.plan_surge(nulled)['t_s'] is None


def test_wet_day_without_rain_surges_at_highest_flow():
    day = clock.make_day('2017-01-01', {'flow': [5] * 20 + [50, 9, 9, 9], 'rain': [0] * 24}, {'dry': False})
    assert clock.plan_surge(day)['hour'] == 20


def test_phases_in_order_around_the_surge():
    day = clock.make_day('2017-01-01', profile(14), {'heaviest_hour': 14, 'flow_pct': 90})
    tm = clock.phase_times(day, 170.0)
    assert 0 < tm['build'] < tm['drawback'] < tm['surge'] < tm['settle'] < tm['calm'] <= 300
    assert tm['surge'] - tm['drawback'] == clock.DRAWBACK_S and tm['settle'] - tm['surge'] == clock.BODY_S
    assert 30 <= tm['surge'] - tm['build'] <= 75 and 45 <= tm['calm'] - tm['settle'] <= 75
    seq = [clock.phase_at(t, tm) for t in range(0, 300)]
    order = [p for i, p in enumerate(seq) if i == 0 or p != seq[i - 1]]
    assert order == ['calm', 'building', 'surge', 'settling', 'calm']
    late = clock.phase_times(day, 216.0)                     # settling cut at the loop's end
    assert late['calm'] == 300


# ---- Dave's day, the fallback, the preset ---------------------------------------------------------------------------

def test_dave_day_needs_fresh_choice_and_mirror():
    assert clock.dave_day(state_for(chosen_at=T0 - 60), T0)[0]['source'] == 'dave'
    day, why = clock.dave_day(state_for(chosen_at=T0 - 901), T0)
    assert day is None and 'over 900' in why
    assert clock.dave_day(state_for(), T0, mirror_age_s=clock.MIRROR_STALE_S + 1)[0] is None
    assert clock.dave_day({'scene': {}}, T0)[0] is None
    assert clock.dave_day(state_for(surge_at='absent'), T0)[0].get('surge_at', 'absent') == 'absent'


def test_fallback_never_repeats_within_an_hour(tmp_path):
    dates = make_library(tmp_path, n=14)
    lib = clock.load_library(tmp_path)
    assert len(lib['notable']) == 14 and len(lib['profiles']) == 14 and lib['days']['2017-01-01']['flow_pct'] == '90'
    loop = clock.Loop(seed=3)
    played = []
    for i in range(13):                                   # 13 loops = 65 min: the first 12 cover the hour
        snap = loop.update(T0 + i * 300 + 1, None, lib)
        played.append((snap['day']['date'], T0 + i * 300))
        assert snap['day']['source'] == 'fallback' and snap['day']['date'] in dates
    for i, (d, t) in enumerate(played):
        for d2, t2 in played[i + 1:]:
            if d2 == d:
                assert t2 - t >= clock.NO_REPEAT_S
    assert played[0][0] != played[1][0]


def test_fallback_with_few_days_plays_the_least_recent():
    rng = random.Random(0)
    lib = {'notable': [{'date': 'a', 'kind': 'storm'}, {'date': 'b', 'kind': 'storm'}],
           'profiles': {'a': profile(), 'b': profile()}, 'days': {}}
    day = clock.fallback_day(lib, [('a', T0 - 100), ('b', T0 - 50)], T0, rng)
    assert day['date'] == 'a'


def test_everything_down_is_the_preset_calm_loop(tmp_path):
    loop = clock.Loop()
    snap = loop.update(T0, None, clock.load_library(tmp_path / 'nothing'))
    assert snap['day']['source'] == 'preset' and snap['day']['level'] == clock.PRESET_LEVEL
    assert snap['plan']['t_s'] is None and snap['phase'] == 'calm'


def test_new_dave_day_waits_for_the_loop_boundary_with_the_wave(tmp_path):
    lib = clock.load_library(tmp_path)
    loop = clock.Loop()
    d1, _ = clock.dave_day(state_for('2017-02-07'), T0)
    s = loop.update(T0, d1, lib)
    assert s['day']['date'] == '2017-02-07' and s['wave'] == 0.0
    assert loop.update(T0 + 9, d1, lib)['wave'] is None             # the wave lasts 8 s
    d2, _ = clock.dave_day(state_for('2019-02-27', chosen_at=T0 + 100), T0 + 100)
    s = loop.update(T0 + 100, d2, lib)
    assert s['day']['date'] == '2017-02-07' and s['next'] == '2019-02-27'
    s = loop.update(T0 + 300.5, d2, lib)
    assert s['day']['date'] == '2019-02-27' and s['index'] == 1 and s['wave'] == pytest.approx(0.5, abs=0.6)
    d2b, _ = clock.dave_day(state_for('2019-02-27', chosen_at=T0 + 590), T0 + 590)
    s = loop.update(T0 + 600.2, d2b, lib)
    assert s['index'] == 2 and s['wave'] is None                    # same day again: no wave


def test_surge_plan_locks_once_building():
    day, _ = clock.dave_day(state_for(surge_at=None, heaviest_hour=14), T0)
    day['stats']['dry'] = False
    day.pop('surge_at')
    loop = clock.Loop()
    loop.update(T0, day)
    first = loop.plan['t_s']
    tm = loop.times
    loop.update(T0 + tm['build'] + 1, day, room={'available': True, 'relative': 3.0, 'presence': 5, 'lingerers': []})
    assert loop.plan['t_s'] == first                                # locked: the busy room no longer moves it


def test_each_dave_choice_plays_once_then_bitcube_fills_in():
    lib = clock.load_library(REPO_DATA) if 'REPO_DATA' in globals() else None
    loop = clock.Loop(seed=1) if 'seed' in clock.Loop.__init__.__code__.co_varnames else clock.Loop()
    dave = clock.dave_day(state_for(chosen_at=T0 - 60), T0)[0]
    first = loop._choose(T0, dave, lib)
    assert first['source'] == 'dave'
    again = loop._choose(T0 + 300, dave, lib)
    assert again['source'] != 'dave'


# ---- valid_until and the raw signals (drocamor/river-agent#14, read with defaults) ----------------------------------

def test_dave_day_honours_valid_until_over_the_900_s_rule():
    st = state_for(chosen_at=T0 - 1100)
    st['memory']['valid_until'] = iso(T0 - 1100 + 1200)          # chosen 18 min ago, valid for 20: still Dave's
    assert clock.dave_day(st, T0)[0]['source'] == 'dave'
    day, why = clock.dave_day(st, T0 + 200)                       # 101 s past valid_until
    assert day is None and 'valid_until' in why
    st = state_for(chosen_at=T0 - 60)
    st['memory']['valid_until'] = iso(T0 - 1)                      # Dave says it already expired
    assert clock.dave_day(st, T0)[0] is None
    st['memory']['valid_until'] = iso(T0 + 86400)                  # absurd: capped at chosen_at + MEMORY_MAX_VALID_S
    assert clock.dave_day(st, T0)[0] is not None
    assert clock.dave_day(st, T0 - 60 + clock.MEMORY_MAX_VALID_S + 1)[0] is None
    st['memory']['valid_until'] = 'soon'                           # not a time: the 900 s rule
    assert clock.dave_day(st, T0)[0] is not None
    assert clock.dave_day(st, T0 - 60 + 901)[0] is None


def test_read_signals_with_staleness_and_absence():
    empty = {'gallery': {}, 'river': {}}
    assert clock.read_signals(None, T0) == empty
    assert clock.read_signals({'heard': 0.3}, T0) == empty
    assert clock.read_signals({'signals': 'x'}, T0) == empty
    rx = {'updated_epoch': T0 - 100, 'signals': {
        'gallery': {'motion': {'value': 0.4, 'slow': 0.3, 'age_s': 5}, 'old': {'value': 0.9, 'slow': 0.8, 'age_s': 550},
                    'bad': {'value': 'loud', 'age_s': 1}, 'bare': 0.2},
        'river': {'level': {'value': 0.7, 'slow': 0.6, 'age_s': 0}}, 'junk': 3}}
    s = clock.read_signals(rx, T0)
    assert s['gallery']['motion'] == {'value': 0.4, 'slow': 0.3, 'age_s': 105.0, 'stale': False}
    assert s['gallery']['old'] == {'value': None, 'slow': None, 'age_s': 650.0, 'stale': True}   # over SIGNALS_TTL_S
    assert s['gallery']['bad']['value'] is None and not s['gallery']['bad']['stale']
    assert s['gallery']['bare']['value'] == 0.2
    assert s['river']['level']['value'] == 0.7 and 'junk' not in s
    assert clock.read_signals(rx, T0, ttl=50)['river']['level']['value'] is None
    mt = clock.read_signals({'_mtime': T0 - 10, 'signals': {'river': {'level': {'value': 1, 'age_s': 2}}}}, T0)
    assert mt['river']['level']['age_s'] == 12.0
