import numpy as np

from pixelmap import graycode


def test_gray_roundtrip():
    n = np.arange(512)
    assert (graycode.ungray(graycode.gray(n)) == n).all()


def test_neighbours_differ_by_one_bit():
    g = graycode.gray(np.arange(400))
    diff = g[1:] ^ g[:-1]
    assert all(bin(int(d)).count('1') == 1 for d in diff)


def test_pattern_list():
    pats = graycode.patterns()
    names = [p['name'] for p in pats]
    assert names[0] == 'black'
    assert 'white' not in names           # never all ropes white at once (power)
    assert len(pats) == 1 + 2 * (graycode.ROPE_BITS + graycode.PIXEL_BITS)
    assert len(set(names)) == len(names)
    b3 = [p for p in pats if p.get('bit') == 3]
    assert [p['invert'] for p in b3] == [False, True]
    assert all(p['source'] == 'gray' for p in b3)


def test_box_fraction_of_unbalanced_bits():
    # rope bit 4 is 1 only for ropes 16-19, so its inverse lights all of box 1 (ropes 0-9)
    assert graycode.box_fraction({'name': 'b04n', 'source': 'gray', 'bit': 4, 'invert': True}) == 1.0
    assert graycode.box_fraction({'name': 'black', 'source': 'black'}) == 0.0


def test_pattern_brightness_keeps_every_box_at_or_below_half_power():
    cap = 0.4
    for p in graycode.patterns():
        b = graycode.pattern_brightness(p, cap)
        assert b <= cap
        assert graycode.box_fraction(p) * b <= 0.5 * cap + 1e-9, p['name']
    # both halves of a pair share one brightness, so pos vs neg compares like with like
    for bit in range(graycode.ROPE_BITS + graycode.PIXEL_BITS):
        pos, neg = ({'source': 'gray', 'bit': bit, 'invert': i} for i in (False, True))
        assert graycode.pattern_brightness(pos, cap) == graycode.pattern_brightness(neg, cap)


def test_bits_cover_counts():
    assert 2 ** graycode.ROPE_BITS >= 20
    assert 2 ** graycode.PIXEL_BITS >= 400
