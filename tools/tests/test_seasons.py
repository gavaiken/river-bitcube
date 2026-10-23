"""td/seasons/seasons.py: the river's year (modes, forward-only, adaptive presence)."""
import importlib.util
import pathlib

import pytest

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'td' / 'seasons' / 'seasons.py'


@pytest.fixture
def ss():
    spec = importlib.util.spec_from_file_location('seasons_under_test', MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(year, t0, t1, dt=0.5, counts=None):
    t = t0
    while t < t1:
        t += dt
        if counts is not None:
            year.presence.add(t, counts(t) if callable(counts) else counts)
        year.step(t)
    return year


def test_weights_sum_to_one_and_peak_at_each_season(ss):
    for p in (0, 0.3, 1, 1.5, 2, 2.7, 3, 3.9):
        assert sum(ss.weights(p)) == pytest.approx(1)
    assert ss.weights(2.0)[2] == pytest.approx(1)
    assert ss.weights(3.5)[3] == pytest.approx(0.5) and ss.weights(3.5)[0] == pytest.approx(0.5)


def test_automatic_is_one_season_a_minute(ss):
    y = run(ss.Year(0, phase=0), 0, 60)
    assert y.phase == pytest.approx(1, abs=0.02) and ss.season_name(y.phase) == 'spring'
    run(y, 60, 240)
    assert min(y.phase, 4 - y.phase) == pytest.approx(0, abs=0.02)


def test_the_year_never_moves_backwards(ss):
    y = ss.Year(0, phase=2.5, mode='manual')
    y.set_manual('summer', 0.5)          # summer is behind us: the way there is through winter and spring
    last, travelled, t = y.phase, 0.0, 0.0
    while t < 60:
        t += 0.5
        y.step(t)
        travelled += ss.ahead(last, y.phase)
        assert ss.ahead(last, y.phase) < 0.5          # always a small step forward, never a jump back
        last = y.phase
    assert y.phase == pytest.approx(2.0) and travelled == pytest.approx(3.5, abs=0.01)


def test_manual_reaches_any_season_in_under_a_minute(ss):
    y = ss.Year(0, phase=2.01, mode='manual')
    y.set_manual('summer', 1.0)                       # almost a full lap
    run(y, 0, 60)
    assert y.phase == pytest.approx(2.0) and y.intensity > 0.95


def test_dynamic_warms_with_a_crowd_and_freezes_when_empty(ss):
    y = ss.Year(0, phase=0, mode='dynamic')
    run(y, 0, 600, counts=2)                         # a usual evening: about 2 people
    rest = y.phase
    run(y, 600, 640, counts=6)                       # a crowd: 3x usual
    assert y.target == 2.0
    run(y, 640, 700, counts=6)
    assert y.phase == pytest.approx(2.0) and y.intensity > 0.85
    run(y, 700, 900, counts=0)                       # everyone leaves: on through autumn to winter
    assert y.phase == pytest.approx(0.0) or y.phase == pytest.approx(4.0)
    assert y.intensity < 0.15


def test_usual_presence_adapts_to_the_size_of_the_night(ss):
    p = ss.Presence()
    for t in range(0, 600, 2):
        p.add(t, 100)
    assert p.usual(600) == 100 and p.relative(600) == pytest.approx(1.0)
    for t in range(600, 640, 2):
        p.add(t, 60)
    assert p.relative(640) < ss.COOLER                # 60 is quiet for a 100-person night


def test_one_person_in_an_empty_gallery_counts(ss):
    p = ss.Presence()
    for t in range(0, 600, 2):
        p.add(t, 0)
    for t in range(600, 640, 2):
        p.add(t, 1)
    assert p.relative(640) >= ss.WARMER


def test_dynamic_falls_back_to_automatic_without_counts(ss):
    y = run(ss.Year(0, phase=0, mode='dynamic'), 0, 30)
    assert y.effective_mode == 'automatic' and y.phase > 0.4


def test_dynamic_never_rests_in_spring(ss):
    y = ss.Year(0, phase=1.0, mode='dynamic')
    run(y, 0, 600, counts=2)                          # as usual: no push either way
    assert y.phase == pytest.approx(2.0) or y.phase == pytest.approx(0.0)
