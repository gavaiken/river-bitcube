import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'power'))
import idle_shutdown as m  # noqa: E402

NOW = 1_800_000_000.0
H = 3600.0
OK = {'t': NOW - 1, 'stream': True}


def test_shuts_down_after_three_hours_of_nobody():
    shut, why = m.decide(NOW, NOW - 10 * H, OK, NOW - 3.1 * H)
    assert shut and 'someone seen' in why


def test_stays_on_when_someone_was_seen_recently():
    assert m.decide(NOW, NOW - 10 * H, OK, NOW - 2.9 * H)[0] is False


def test_boot_counts_as_activity():
    assert m.decide(NOW, NOW - 1 * H, OK, None)[0] is False
    assert m.decide(NOW, NOW - 3.5 * H, OK, None)[0] is True


def test_keep_on_until_holds_it_on():
    assert m.decide(NOW, NOW - 10 * H, OK, NOW - 5 * H, keep_until=NOW + 60)[0] is False


def test_never_shuts_down_without_a_working_counter():
    assert m.decide(NOW, NOW - 10 * H, None, None)[0] is False
    assert m.decide(NOW, NOW - 10 * H, {'t': NOW - 600, 'stream': True}, None)[0] is False
    assert m.decide(NOW, NOW - 10 * H, {'t': NOW - 1, 'stream': False}, None)[0] is False


def test_no_boot_time_and_nobody_seen_stays_on():
    assert m.decide(NOW, None, OK, None)[0] is False
