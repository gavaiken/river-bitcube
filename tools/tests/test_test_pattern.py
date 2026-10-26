"""Mission control's test pattern on the ropes (td/ropes/artnet_out.py test_frame): every LED shows every colour once a
cycle, wiping down from the plug end, and no box ever draws more than the calibration's 300 W cap at full brightness."""
import importlib.util
import pathlib

import numpy as np

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'td' / 'ropes' / 'artnet_out.py'
spec = importlib.util.spec_from_file_location('artnet_out_test_pattern', MODULE)
ao = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ao)
CONFIG = {'pixels_per_rope': 400, 'pixels_per_universe': 170, 'universes_per_rope': 4, 'color_order': 'RGB', 'reverse_ropes': [],
          'boxes': [{'ip': '2.0.0.10', 'first_universe': 0, 'ropes': 10}, {'ip': '2.0.0.11', 'first_universe': 40, 'ropes': 10}]}


def test_every_led_shows_every_colour_once_a_cycle():
    seen = np.zeros((20, 400, len(ao.TEST_COLOURS)), bool)
    for t in np.arange(0, 4 * ao.TEST_WIPE_S, 0.05):
        f = ao.test_frame(20, 400, t)
        for k, c in enumerate(ao.TEST_COLOURS):
            seen[:, :, k] |= np.all(np.isclose(f, c), axis=2)
    assert seen.all()


def test_the_new_colour_wipes_down_from_the_plug_end():
    f = ao.test_frame(20, 400, 0.5 * ao.TEST_WIPE_S)     # halfway through the first wipe: red over white
    assert np.allclose(f[:, :200], ao.TEST_COLOURS[0]) and np.allclose(f[:, 200:], ao.TEST_COLOURS[-1])
    assert np.allclose(f, f[0])                            # every rope the same


def test_never_more_than_300_w_a_box_at_full_brightness():
    for t in np.arange(0, 4 * ao.TEST_WIPE_S, 0.25):
        _, watts = ao.to_bytes(ao.test_frame(20, 400, t), CONFIG, 1.0, 0)     # no limiter: the pattern itself stays under
        assert max(watts) <= 300, (t, watts)


def test_bad_time_never_breaks_it():
    assert ao.test_frame(20, 400, -5).shape == (20, 400, 3)
