"""The TD-side patterns (td/ropes/artnet_out.gray_frame) must be exactly what the decoder expects."""
import importlib.util
from pathlib import Path

import numpy as np

from pixelmap import decode, graycode

_spec = importlib.util.spec_from_file_location(
    'artnet_out', Path(__file__).resolve().parents[3] / 'td' / 'ropes' / 'artnet_out.py')
artnet_out = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(artnet_out)


def test_gray_frame_matches_decoder():
    rope, px = np.meshgrid(np.arange(20), np.arange(400), indexing='ij')
    for bit in range(graycode.ROPE_BITS + graycode.PIXEL_BITS):
        for invert in (False, True):
            lit = artnet_out.gray_frame(20, 400, bit, invert)[:, :, 0] > 0
            assert (lit == (decode.pattern_bit(rope, px, bit) != invert)).all(), (bit, invert)
    assert artnet_out.ROPE_BITS == graycode.ROPE_BITS
