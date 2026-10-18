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


def pattern_bit(rope, px, bit):
    """What a Gray-code pattern shows at (rope, px): True = lit (same rule as gray_frame in TD)."""
    code = gray(rope) if bit < ROPE_BITS else gray(px)
    k = bit if bit < ROPE_BITS else bit - ROPE_BITS
    return ((code >> k) & 1).astype(bool)


def box_fraction(pat, n_ropes=20, n_pixels=400, per_box=10):
    """Largest fraction of one box's pixels that the pattern lights (power is limited per box).
    Plain Gray codes are not balanced: rope bit 4's inverse lights every rope of box 1."""
    if pat['source'] != 'gray':
        return 0.0 if pat['source'] == 'black' else 1.0
    rope, px = np.meshgrid(np.arange(n_ropes), np.arange(n_pixels), indexing='ij')
    lit = pattern_bit(rope, px, pat['bit']) != pat['invert']
    return max(float(lit[b:b + per_box].mean()) for b in range(0, n_ropes, per_box))


def pattern_brightness(pat, cap):
    """Brightness for a pattern so no box draws more than half its full power at the cap.
    Both halves of a bit/inverse pair get the same value, so they compare like with like."""
    if pat['source'] != 'gray':
        return cap * min(1.0, 0.5 / max(box_fraction(pat), 1e-9))
    pair = [dict(pat, invert=i) for i in (False, True)]
    return cap * min(1.0, 0.5 / max(box_fraction(p) for p in pair))


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
