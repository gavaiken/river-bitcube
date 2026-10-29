"""The remembered river's inputs log (td/remembered/inputs_log.py, docs/remembered-river.md section 5): a line every 5 s
or on a change over 2 % (at most once a second), rotation at 20 MB keeping one old file, and the sparkline reader."""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import inputs_log as il  # noqa: E402

T0 = 1_800_000_000.0


def lines(p):
    return [json.loads(ln) for ln in p.read_text(encoding='utf-8').splitlines()]


def inputs(heard=0.5, src='sound'):
    return {'heard': {'value': heard, 'source': src, 'age_s': 1.0, 'fresh': True}}


def test_default_path():
    assert il.default_path(pathlib.Path('River')) == pathlib.Path('River') / 'logs' / 'inputs.jsonl'


def test_writes_every_five_seconds_or_on_a_change(tmp_path):
    p = tmp_path / 'logs' / 'inputs.jsonl'
    log = il.InputsLog(p)
    params = {'knob.speed': {'mode': 'auto', 'auto': 0.5, 'value': 0.5, 'source': 'auto', 'expires_in_s': None}}
    assert log.log(T0, inputs(), params)                       # the first line
    assert not log.log(T0 + 2, inputs(0.51), params)           # 1 %: not a change
    assert not log.log(T0 + 0.5, inputs(0.9), params)          # a change, but within a second of the last line
    assert log.log(T0 + 2, inputs(0.53), params)               # over 2 %
    assert log.log(T0 + 3.5, inputs(0.53, 'cam'), params)      # the source changed
    assert not log.log(T0 + 5, inputs(0.53, 'cam'), params)
    assert log.log(T0 + 8.5, inputs(0.53, 'cam'), params)      # 5 s since the last line
    params2 = {'knob.speed': {'value': 0.5, 'source': 'fixed'}}
    assert log.log(T0 + 9.6, inputs(0.53, 'cam'), params2)     # a parameter's source changed
    assert log.log(T0 + 11, inputs(0.53, 'cam'), {'knob.speed': 0.6})   # bare values too
    ls = lines(p)
    assert [d['t'] for d in ls] == [T0, T0 + 2, T0 + 3.5, T0 + 8.5, T0 + 9.6, T0 + 11]
    assert ls[0] == {'t': T0, 'inputs': {'heard': {'v': 0.5, 's': 'sound'}},
                     'params': {'knob.speed': {'v': 0.5, 's': 'auto'}}}
    assert ls[-1]['params'] == {'knob.speed': {'v': 0.6, 's': None}}
    # larger values: 2 % of the value
    log2 = il.InputsLog(tmp_path / 'b.jsonl')
    log2.log(T0, {}, {'surge_hour': 13.0})
    assert not log2.log(T0 + 2, {}, {'surge_hour': 13.2})
    assert log2.log(T0 + 3, {}, {'surge_hour': 13.4})


def test_rotates_at_the_size_limit_keeping_one_old_file(tmp_path):
    p = tmp_path / 'inputs.jsonl'
    log = il.InputsLog(p, max_bytes=300)
    for i in range(40):
        log.log(T0 + 5 * i, inputs(i / 40), {})
    old = p.with_name('inputs.jsonl.1')
    assert old.exists() and p.exists() and p.stat().st_size < 300 + 200
    assert not p.with_name('inputs.jsonl.2').exists()
    assert lines(old)[-1]['t'] < lines(p)[0]['t']
    assert il.InputsLog(p).max_bytes == 20 * 1024 * 1024


def test_a_write_error_never_raises(tmp_path):
    blocker = tmp_path / 'logs'
    blocker.write_text('a file where the folder should be')
    log = il.InputsLog(blocker / 'inputs.jsonl')
    assert log.log(T0, inputs(), {}) is False and log.error


def test_recent_downsamples_for_sparklines(tmp_path):
    p = tmp_path / 'inputs.jsonl'
    log = il.InputsLog(p, max_bytes=60_000)
    for i in range(3000):                                       # 4 h 10 min of a line every 5 s, across a rotation
        log.log(T0 + 5 * i, inputs((i % 100) / 100), {'knob.speed': {'value': 0.5, 'source': 'auto'},
                                                       'day': {'value': '2017-02-07', 'source': 'auto'}})
    assert p.with_name('inputs.jsonl.1').exists()
    with open(p, 'a', encoding='utf-8') as f:
        f.write('{"t": 18000')                                  # a torn last line is skipped
    end = T0 + 5 * 2999
    r = il.recent(p, seconds=4 * 3600, fields=['inputs.heard', 'params.knob.speed', 'params.day', 'inputs.nothing'])
    assert set(r) == {'inputs.heard', 'params.knob.speed', 'params.day', 'inputs.nothing'}
    assert 0 < len(r['inputs.heard']) <= 300 and r['inputs.nothing'] == []
    assert all(end - 4 * 3600 <= t <= end for t, _ in r['inputs.heard'])
    assert all(0 <= v <= 0.99 for _, v in r['inputs.heard'])
    assert all(v == 0.5 for _, v in r['params.knob.speed']) and r['params.day'][-1][1] == '2017-02-07'
    assert [t for t, _ in r['inputs.heard']] == sorted(t for t, _ in r['inputs.heard'])
    every = il.recent(p, seconds=600)                           # fields None: every numeric field
    assert set(every) == {'inputs.heard', 'params.knob.speed'} and len(every['inputs.heard']) <= 121
    assert il.recent(p, seconds=600, now=end + 86400) == {}       # nothing in the window
    assert il.recent(tmp_path / 'none.jsonl', fields=['inputs.heard']) == {'inputs.heard': []}
