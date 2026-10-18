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


def test_bits_cover_counts():
    assert 2 ** graycode.ROPE_BITS >= 20
    assert 2 ** graycode.PIXEL_BITS >= 400
