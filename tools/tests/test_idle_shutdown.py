import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'power'))
import idle_shutdown as m  # noqa: E402

NOW = 1_800_000_000.0
H = 3600.0
OK = {'t': NOW - 1, 'stream': True}


def test_shuts_down_after_three_hours_of_nobody():
    shut, why = m.decide(NOW, NOW - 10 * H, OK, NOW - 2.1 * H)
    assert shut and 'someone seen' in why


def test_stays_on_when_someone_was_seen_recently():
    assert m.decide(NOW, NOW - 10 * H, OK, NOW - 1.9 * H)[0] is False


def test_boot_counts_as_activity():
    assert m.decide(NOW, NOW - 1 * H, OK, None)[0] is False
    assert m.decide(NOW, NOW - 2.5 * H, OK, None)[0] is True


def test_keep_on_until_holds_it_on():
    assert m.decide(NOW, NOW - 10 * H, OK, NOW - 5 * H, keep_until=NOW + 60)[0] is False


def test_never_shuts_down_without_a_working_counter():
    assert m.decide(NOW, NOW - 10 * H, None, None)[0] is False
    assert m.decide(NOW, NOW - 10 * H, {'t': NOW - 600, 'stream': True}, None)[0] is False
    assert m.decide(NOW, NOW - 10 * H, {'t': NOW - 1, 'stream': False}, None)[0] is False


def test_no_boot_time_and_nobody_seen_stays_on():
    assert m.decide(NOW, None, OK, None)[0] is False


def test_never_between_noon_and_nine_pm():
    for hour in (12, 15, 20):
        assert m.decide(NOW, NOW - 10 * H, OK, NOW - 5 * H, hour=hour)[0] is False
    for hour in (21, 23, 2, 11):
        assert m.decide(NOW, NOW - 10 * H, OK, NOW - 5 * H, hour=hour)[0] is True


def test_nothing_after_the_show_week():
    assert m.decide(NOW, NOW - 10 * H, OK, NOW - 5 * H, hour=23, expires_t=NOW - 1)[0] is False
    assert m.decide(NOW, NOW - 10 * H, OK, NOW - 5 * H, hour=23, expires_t=NOW + 1)[0] is True


def test_until_is_local_midnight_7_nov():
    import time
    t = time.localtime(m.until_t())
    assert (t.tm_year, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min) == (2026, 11, 7, 0, 0)


def test_counter_seen_needs_someone_for_most_of_the_window():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'presence'))
    import counter
    assert counter.sustained([(0, True)]) is False                          # one frame: a ghost
    assert counter.sustained([(t, t != 2) for t in range(6)]) is True      # a dropout is fine
    assert counter.sustained([(t, t % 2 == 0) for t in range(6)]) is False  # flicker
    assert counter.sustained([(t, t < 5) for t in range(6)]) is False      # gone now
