"""Gray-code patterns for the rope pixel map. Must match gray_frame() in td/ropes/artnet_out.py:
bits 0..4 encode the rope index, bits 5..13 the pixel index (bit 5 = pixel LSB)."""
import numpy as np

ROPE_BITS = 5
PIXEL_BITS = 9


def gray(n):
    n = np.asarray(n)
    return n ^ (n >> 1)


def ungray(g):
    g = np.asarray(g).copy()
    shift = g >> 1
    while np.any(shift):
        g ^= shift
        shift >>= 1
    return g


def pattern_name(bit, invert):
    return f'b{bit:02d}{"n" if invert else "p"}'


def patterns():
    """Capture order: a black reference, then every bit followed by its inverse.
    Each entry: name plus the /project1/ropes settings (source, bit, invert).
    No all-white frame: both boxes would sit at the power limiter (~1.2 kW) at once. Each bit/inverse
    pair lights every pixel exactly once, so max(pos, neg) stands in for a white reference."""
    out = [{'name': 'black', 'source': 'black'}]
    for bit in range(ROPE_BITS + PIXEL_BITS):
        for invert in (False, True):
            out.append({'name': pattern_name(bit, invert), 'source': 'gray', 'bit': bit, 'invert': invert})
    return out
