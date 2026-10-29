"""The remembered river's knobs (td/remembered/knobs.py): Dave's band remapped, the remembered day driving the knobs
through the loop (a flood day vs a dry day), the blend and its parts, tolerance to bad values."""
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import clock, knobs  # noqa: E402

T0 = 1_800_000_000.0


def flood_day():
    rain = [0.0] * 24
    for h, mm in zip(range(8, 16), (1, 3, 6, 10, 14, 9, 5, 2)):
        rain[h] = float(mm)
    flow = [40.0 + (h - 8) ** 2 * 6 if h >= 8 else 40.0 for h in range(24)]
    return clock.make_day('2017-01-08', {'flow': flow, 'rain': rain, 'temp': [9.0 + 0.2 * h for h in range(24)],
                                         'is_day': [1 if 7 <= h < 17 else 0 for h in range(24)]},
                          {'flow_pct': 99}, source='dave')


def dry_day():
    return clock.make_day('2014-09-01', {'flow': [2.0 - 0.01 * h for h in range(24)], 'rain': [0.0] * 24,
                                         'temp': [15.0 + 10 * (1 - abs(h - 14) / 14) for h in range(24)],
                                         'is_day': [1 if 6 <= h < 19 else 0 for h in range(24)]},
                          {'flow_pct': 3}, source='fallback')


def test_daves_band_is_remapped_to_a_useful_range():
    for k, lo, hi, ulo, uhi in (('speed', 0.04, 0.14, 0.25, 0.75), ('turbulence', 0.075, 0.14, 0.25, 0.7),
                                ('density', 0.25, 0.58, 0.3, 0.75), ('brightness', 0.47, 0.65, 0.45, 0.75)):
        assert knobs.remap(k, lo) == pytest.approx(ulo) and knobs.remap(k, hi) == pytest.approx(uhi)
        assert knobs.remap(k, (lo + hi) / 2) == pytest.approx((ulo + uhi) / 2)
        assert 0.0 <= knobs.remap(k, -5) <= knobs.remap(k, 0) <= ulo
        assert uhi <= knobs.remap(k, 1.0) == knobs.remap(k, 7) <= 1.0
    k = knobs.Knobs()
    assert k.value(T0) == knobs.NEUTRAL                       # before Dave's first scene: neutral, not remapped
    k.set_scene({'seq': 1, 'scene': {'speed': 0.04, 'density': 0.25, 'brightness': 0.47, 'turbulence': 0.075}}, T0)
    assert k.target['speed'] == 0.04                           # target stays Dave's raw value
    k.set_scene({'seq': 2, 'scene': {'speed': 0.14, 'density': 0.58, 'brightness': 0.65, 'turbulence': 0.14,
                                     'transition_seconds': 100}}, T0)
    mid = k.value(T0 + 50)
    assert mid['speed'] == pytest.approx(0.5) and mid['turbulence'] == pytest.approx(0.475)
    assert k.value(T0 + 100)['speed'] == pytest.approx(0.75)


def test_a_flood_day_and_a_dry_day_give_different_curves():
    flood = [knobs.day_knobs(flood_day(), h) for h in range(24)]
    dry = [knobs.day_knobs(dry_day(), h) for h in range(24)]
    sp_f, sp_d = [x['speed'] for x in flood], [x['speed'] for x in dry]
    tu_f, tu_d = [x['turbulence'] for x in flood], [x['turbulence'] for x in dry]
    assert min(sp_f) > max(sp_d) - 0.15 and sum(sp_f) / 24 - sum(sp_d) / 24 > 0.2
    assert max(sp_f) - min(sp_f) > 0.3                         # the flood day's speed climbs through the loop
    assert max(tu_f) > 0.75 and max(tu_d) < 0.3                # rain -> turbulence; a dry day stays smooth
    assert tu_f.index(max(tu_f)) == 12                         # the wettest hour
    assert max(tu_f) - min(tu_f) > 0.5 and max(tu_d) - min(tu_d) < 0.05
    assert flood[20]['density'] > dry[20]['density'] + 0.3      # flow peaks after the rain
    # brightness: warmer and in daylight brighter
    assert dry[14]['brightness'] > dry[2]['brightness'] + 0.1
    assert all(0.0 <= v <= 1.0 for x in flood + dry for v in x.values())


def test_day_knobs_fallbacks_when_data_is_missing():
    assert knobs.day_knobs(None, 3) is None
    day = clock.make_day('2010-01-01', {'flow': [None] * 24, 'rain': None, 'temp': ['x'] * 24}, {'flow_pct': 'high'})
    k = knobs.day_knobs(day, 'noon')
    assert all(0.0 <= v <= 1.0 for v in k.values())
    assert k['brightness'] == pytest.approx(knobs.DAY_BRIGHT)     # no temp, no daylight: the centre
    assert k['speed'] == pytest.approx(sum(knobs.DAY_RANGE['speed']) / 2)   # pct 50, flow shape 0.5


def test_blend_parts_and_describe():
    k = knobs.Knobs()
    k.set_scene({'seq': 1, 'scene': {'speed': 0.09, 'density': 0.4, 'brightness': 0.5, 'turbulence': 0.1}}, T0)
    k.step(0.016)                                              # no day yet: Dave alone
    assert k.value(T0) == pytest.approx(k.dave(T0))
    day = flood_day()
    k.step(0.016, day, 12.0)                                   # the first day snaps in
    p = k.parts(T0)
    for name in knobs.KNOBS:
        assert p['value'][name] == pytest.approx(0.5 * p['dave'][name] + 0.5 * p['day'][name])
    assert p['day'] == pytest.approx(knobs.day_knobs(day, 12.0))
    k.step(0.016, dry_day(), 0.0)                              # a new day eases in, no jump
    assert k.day['speed'] == pytest.approx(p['day']['speed'], abs=0.05)
    for _ in range(600):
        k.step(0.05, dry_day(), 0.0)
    assert k.day['speed'] == pytest.approx(knobs.day_knobs(dry_day(), 0.0)['speed'], abs=1e-3)
    k.set_reflex({'updated_epoch': T0, 'ttl_seconds': 90, 'offsets': {'speed': 0.2}}, T0)
    for _ in range(200):
        k.step(0.05, dry_day(), 0.0)
    p = k.parts(T0)
    assert p['reflex']['speed'] == pytest.approx(0.2, abs=1e-3)
    assert p['value']['speed'] == pytest.approx(0.5 * p['dave']['speed'] + 0.5 * p['day']['speed'] + 0.2, abs=1e-3)
    d = knobs.describe(p)
    assert d['speed'].startswith('Dave 0.50 / day ') and 'reflex +0.20' in d['speed'] and '->' in d['speed']
    assert 'reflex' not in d['density']
    assert k.reflex_now == p['reflex'] and k.seconds == 0.0 and k.colors is None


def test_stale_or_bad_reflex_reads_as_zero():
    k = knobs.Knobs()
    k.set_reflex({'updated_epoch': T0 - 200, 'ttl_seconds': 90, 'offsets': {'speed': 0.3}}, T0)
    assert k.reflex_target['speed'] == 0.0
    k.set_reflex({'updated_epoch': 'yesterday', 'offsets': {'speed': 0.3}}, T0)
    assert k.reflex_target['speed'] == 0.0
    k.set_reflex({'_mtime': T0 - 10, 'offsets': {'speed': 0.3, 'density': [1]}}, T0)
    assert k.reflex_target == {'speed': 0.3, 'density': 0.0, 'brightness': 0.0, 'turbulence': 0.0}
    assert not knobs.fresh_reflex(None, T0)
