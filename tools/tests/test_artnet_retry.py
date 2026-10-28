"""The rope sender must survive the lights being switched off: network errors back off and retry,
they never switch the sender off (td/ropes/artnet_out.py, tick)."""
import importlib.util
import pathlib
import sys
import types

import pytest

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'td' / 'ropes' / 'artnet_out.py'


@pytest.fixture
def ao(monkeypatch):
    spec = importlib.util.spec_from_file_location('artnet_out_under_test', MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.absTime = types.SimpleNamespace(seconds=100.0)          # TD global, faked
    sys.modules.pop('river_ropes_live', None)                   # fresh socket holder per test
    config = {'source_ip': '2.0.0.8', 'pixels_per_rope': 400, 'pixels_per_universe': 170,
              'universes_per_rope': 4, 'color_order': 'RGB', 'reverse_ropes': [],
              'boxes': [{'ip': '2.0.0.10', 'first_universe': 0, 'ropes': 1},
                        {'ip': '2.0.0.11', 'first_universe': 4, 'ropes': 1}]}
    monkeypatch.setattr(mod, 'load_config', lambda path=None: config)
    return mod


class Par:
    def __init__(self, value):
        self.value = value

    def eval(self):
        return self.value


class Pars:
    def __init__(self, **kw):
        object.__setattr__(self, '_p', {k: Par(v) for k, v in kw.items()})

    def __getattr__(self, name):
        return self._p[name]

    def __setattr__(self, name, value):          # TD style: comp.par.Active = False
        self._p[name].value = value


class Comp:
    path = '/project1/ropes'

    def __init__(self):
        self.storage = {}
        self.par = Pars(Active=True, Fps=40, Source='black', Brightness=0.4, Maxbrightness=0.4,
                        Boxwatts=600, Identify=0, Graybit=0, Grayinvert=False)

    def unstore(self, key):
        self.storage.pop(key, None)

    def op(self, name):
        return None


class Sock:
    def __init__(self, fail):
        self.fail = fail
        self.sent = 0
        self.closed = False

    def sendto(self, packet, target):
        if self.fail['on']:
            raise OSError(10065, 'A socket operation was attempted to an unreachable host')
        self.sent += 1

    def close(self):
        self.closed = True


def run(ao, comp, seconds, step=0.025):
    end = ao.absTime.seconds + seconds
    while ao.absTime.seconds < end:
        ao.absTime.seconds += step
        ao.tick(comp)


def test_network_error_keeps_sender_active_and_recovers(ao, monkeypatch):
    fail = {'on': True}
    socks = []
    monkeypatch.setattr(ao, 'open_socket', lambda config: socks.append(Sock(fail)) or socks[-1])
    comp = Comp()

    run(ao, comp, 1.0)                                     # lights off: every send fails
    assert comp.par.Active.eval() is True                  # never switches itself off
    assert comp.storage['error']
    assert ao.status(comp)['retrying'] is True
    opened_while_failing = len(socks)

    run(ao, comp, 1.0)
    assert len(socks) == opened_while_failing              # backs off instead of retrying every frame

    fail['on'] = False                                     # lights back on
    run(ao, comp, 3.0)
    assert comp.storage['error'] is None
    assert ao.status(comp)['retrying'] is False
    assert socks[-1].sent > 0                              # sending again, by itself


def test_retry_at_ahead_of_clock_is_ignored_after_reload(ao, monkeypatch):
    monkeypatch.setattr(ao, 'open_socket', lambda config: Sock({'on': False}))
    comp = Comp()
    comp.storage.update(retry_at=99999.0, error='OSError(...)')   # saved in the .toe, clock restarted
    run(ao, comp, 0.2)
    assert comp.storage['error'] is None                   # sent straight away, not after ~27 h


def test_non_network_error_still_stops_sender(ao, monkeypatch):
    monkeypatch.setattr(ao, 'open_socket', lambda config: Sock({'on': False}))
    monkeypatch.setattr(ao, 'to_bytes', lambda *a: (_ for _ in ()).throw(ValueError('bad frame')))
    comp = Comp()
    run(ao, comp, 0.2)
    assert comp.par.Active.eval() is False                 # a real bug still stops it
    assert 'bad frame' in comp.storage['error']



def test_combined_limit_scales_both_boxes_together(ao):
    """27 Oct: both boxes share one circuit, so full white is scaled to TOTAL_WATTS across the two boxes together."""
    import numpy as np
    config = {'pixels_per_universe': 170, 'universes_per_rope': 4, 'color_order': 'RGB', 'reverse_ropes': [],
              'boxes': [{'ip': '2.0.0.10', 'first_universe': 0, 'ropes': 10},
                        {'ip': '2.0.0.11', 'first_universe': 40, 'ropes': 10}]}
    frame = np.ones((20, 400, 3), np.float32)
    _, watts = ao.to_bytes(frame, config, 1.0, ao.BOX_WATTS, ao.TOTAL_WATTS)
    assert abs(sum(watts) - ao.TOTAL_WATTS) <= 2 and abs(watts[0] - watts[1]) <= 1
    _, low = ao.to_bytes(frame * 0.1, config, 1.0, ao.BOX_WATTS, ao.TOTAL_WATTS)   # 300 W in all: untouched
    assert abs(sum(low) - 300) <= 2
