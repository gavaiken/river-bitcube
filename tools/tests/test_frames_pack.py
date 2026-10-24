"""tools/mission/frames_pack.py: a TOP's numpyArray (rows bottom-up; float32 RGBA 0..1 or uint8) -> top-down RGB
bytes for the lights simulator, the flips, the 4x box downsample of the HUB75 atlas, and the nearest resample that
must match artnet_out.canvas_frame (what the sender samples from rope_tex)."""
import base64
import importlib.util
import pathlib
import sys
import types

import numpy as np
import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'tools' / 'mission'))
import frames_pack as fp  # noqa: E402


def td_rgba(h, w, dtype=np.float32):
    """A fake TOP.numpyArray(): (h, w, 4), rows bottom-up, alpha 1, with a different colour in every row and column."""
    a = np.zeros((h, w, 4), np.float32)
    a[:, :, 0] = np.linspace(0, 1, h)[:, None]        # red grows with the TD row (bottom -> top)
    a[:, :, 1] = np.linspace(0, 1, w)[None, :]        # green grows with the column
    a[:, :, 2] = 0.25
    a[:, :, 3] = 1.0
    if dtype == np.uint8:
        return (a * 255 + 0.5).astype(np.uint8)
    return a


def test_float_rgba_is_flipped_so_row_0_is_the_top_of_the_texture():
    a = td_rgba(400, 20)
    a[0, 3] = (1, 0, 0, 1)             # TD's bottom row: red at column 3
    a[399, 0] = (0, 0, 1, 1)           # TD's top row: blue at column 0
    d = fp.pack_top(a)
    assert (d['w'], d['h']) == (20, 400)
    img = fp.decode(d)
    assert tuple(img[0, 0]) == (0, 0, 255)           # the top of the texture is row 0 (the plug end for rope_tex)
    assert tuple(img[399, 3]) == (255, 0, 0)
    assert img[1, 5, 0] > img[398, 5, 0]             # red decreases down the image (it grew with the TD row)
    assert len(base64.b64decode(d['rgb'])) == 20 * 400 * 3


def test_uint8_rgba_comes_through_exactly():
    a = td_rgba(50, 7, np.uint8)
    img = fp.decode(fp.pack_top(a))
    assert img.dtype == np.uint8
    assert np.array_equal(img, a[::-1, :, :3])
    assert np.array_equal(fp.decode(fp.pack_top(a, flip=False)), a[:, :, :3])


def test_mono_rgb_and_uint16_inputs():
    mono = np.full((4, 3), 0.5, np.float32)
    img = fp.decode(fp.pack_top(mono))
    assert img.shape == (4, 3, 3) and tuple(img[0, 0]) == (128, 128, 128)
    rgb = np.zeros((2, 2, 3), np.float32); rgb[1, 1] = (1, 0.5, 0)
    assert tuple(fp.decode(fp.pack_top(rgb))[0, 1]) == (255, 128, 0)       # TD row 1 (top) -> image row 0
    u16 = np.array([[[65535, 32768, 0, 65535]]], np.uint16)
    assert tuple(fp.decode(fp.pack_top(u16))[0, 0]) == (255, 128, 0)
    hdr = np.array([[[2.0, -1.0, 1.0, 1.0]]], np.float32)                 # out of range is clipped, never wrapped
    assert tuple(fp.decode(fp.pack_top(hdr))[0, 0]) == (255, 0, 255)


def test_atlas_box_downsample_4x():
    # 1024x128 atlas (TD rows bottom-up): four 256x128 quads in a row, each a flat colour, plus a 4x4 bright block
    # in the top-left corner of the atlas (TD rows 124..127, columns 0..3) and a checker inside one block.
    a = np.zeros((128, 1024, 4), np.float32)
    for q, col in enumerate([(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0)]):
        a[:, q * 256:(q + 1) * 256, :3] = col
    a[124:128, 0:4, :3] = 1.0
    a[0:4, 8:12, :3] = 0                                   # bottom-left block: half 1, half 0 in red
    a[0:4, 8:12, 0] = np.array([1, 0, 1, 0])[None, :]
    d = fp.pack_top(a, downsample=4)
    assert (d['w'], d['h']) == (256, 32)
    img = fp.decode(d)
    assert tuple(img[0, 0]) == (255, 255, 255)             # top-left of the atlas is row 0 of the image
    assert tuple(img[0, 1]) == (255, 0, 0)
    assert tuple(img[31, 255]) == (255, 255, 0)            # quad 4 at the bottom right
    assert tuple(img[16, 64 + 32]) == (0, 255, 0)          # quad 2
    assert tuple(img[31, 2]) == (128, 0, 0)                # the block mean, not a sample
    # sizes that are not a multiple of 4 drop the partial blocks
    assert (lambda d: (d['w'], d['h']))(fp.pack_top(np.zeros((130, 1026, 4), np.float32), downsample=4)) == (256, 32)


def test_nearest_resample_matches_what_the_sender_samples():
    spec = importlib.util.spec_from_file_location('artnet_out_under_test', REPO / 'td' / 'ropes' / 'artnet_out.py')
    ao = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ao)
    rng = np.random.default_rng(1)
    big = rng.random((808, 1440, 4), np.float32)                      # a rope_tex that is not 20x400
    top = types.SimpleNamespace(numpyArray=lambda delayed=False: big)
    want = np.transpose(ao.canvas_frame(top, 20, 400), (1, 0, 2))     # [rope][pixel] -> (pixel, rope)
    got = fp.decode(fp.pack_top(big, size=(20, 400)))
    assert got.shape == (400, 20, 3)
    assert np.array_equal(got, fp.quantise(want))
    exact = td_rgba(400, 20)                                          # the real size: identity
    assert np.array_equal(fp.decode(fp.pack_top(exact, size=(20, 400))), fp.decode(fp.pack_top(exact)))


def test_pack_frame_puts_pixel_0_in_row_0_and_ropes_in_columns():
    f = np.zeros((20, 400, 3), np.float32)
    f[4, 0] = 1                       # rope 5, plug end: white
    f[19, 399] = (0, 0, 1)            # rope 20, far end: blue
    d = fp.pack_frame(f)
    assert (d['w'], d['h']) == (20, 400)
    img = fp.decode(d)
    assert tuple(img[0, 4]) == (255, 255, 255)
    assert tuple(img[399, 19]) == (0, 0, 255)
    assert img.sum() == 255 * 3 + 255
    with pytest.raises(ValueError):
        fp.pack_frame(np.zeros((20, 400)))


def test_non_contiguous_views_give_the_same_bytes_as_a_copy():
    a = td_rgba(64, 20, np.uint8)
    view = a[::-1][:, ::1]            # a flipped view (what froze TD when handed to copyNumpyArray)
    assert not view.flags['C_CONTIGUOUS']
    assert fp.pack_top(view) == fp.pack_top(np.ascontiguousarray(view))
    strided = a[:, ::2]
    assert fp.pack_top(strided) == fp.pack_top(np.ascontiguousarray(strided))


def test_encode_decode_roundtrip_and_black():
    rgb = np.arange(2 * 3 * 3, dtype=np.uint8).reshape(2, 3, 3)
    d = fp.encode(rgb)
    assert d == {'w': 3, 'h': 2, 'rgb': base64.b64encode(rgb.tobytes()).decode('ascii')}
    assert np.array_equal(fp.decode(d), rgb)
    with pytest.raises(ValueError):
        fp.decode({'w': 3, 'h': 3, 'rgb': d['rgb']})
    b = fp.pack_black(20, 400)
    assert (b['w'], b['h']) == (20, 400) and not fp.decode(b).any()


def test_pack_screens_puts_the_four_upright_screens_side_by_side():
    """Gray Area stacks the quads and turns each on its side, so Lights gets each screen upright too (cell k-1 = screen k)."""
    def solid(rgb, h=256, w=128):
        a = np.zeros((h, w, 4), np.float32)
        a[:, :, :3] = rgb
        a[-1, :, :3] = (1, 1, 1)                      # TD's LAST row is the top of the screen: white after the flip
        a[:, :, 3] = 1
        return a
    tops = [solid((1, 0, 0)), solid((0, 1, 0)), None, solid((0, 0, 1), h=128, w=64)]
    d = fp.pack_screens(tops, downsample=4, gain=0.5)
    assert (d['w'], d['h'], d['cells']) == (128, 64, 4)
    img = fp.decode(d)
    assert tuple(img[10, 5]) == (128, 0, 0)            # screen 1 red, at half brightness
    assert tuple(img[10, 32 + 5]) == (0, 128, 0)       # screen 2 green
    assert tuple(img[10, 64 + 5]) == (0, 0, 0)         # screen 3 not cooked: black
    assert tuple(img[10, 96 + 5]) == (0, 0, 128)       # screen 4 resampled to the same cell size
    assert img[0, 5, 1] > 0 and img[63, 5, 1] == 0    # row 0 is the top of the screen (the white row)
    with pytest.raises(ValueError):
        fp.pack_screens([None] * 4)
