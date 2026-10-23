"""Pure numpy helpers for td_mission.py's "frames" action (mission control's lights simulator).

A TOP's pixels come out of TOP.numpyArray() as (h, w, c) with rows BOTTOM-UP (TD's texture origin), float32 0..1
for float textures or uint8 for 8-bit ones, RGBA/RGB/mono. These functions turn that into top-down RGB uint8 bytes
(row 0 = the top of the texture: the plug end for rope_tex, the top of the atlas for panel_out), base64-encoded,
with an optional box downsample (the HUB75 atlas) or nearest resample (as artnet_out.canvas_frame samples
rope_tex). No TouchDesigner imports, so tools/tests/test_frames_pack.py runs anywhere.
"""
import base64

import numpy as np


def as_float_rgb(a):
    """(h, w, c) in any TD pixel format -> float32 (h, w, 3) in 0..1. Mono is repeated, alpha dropped."""
    a = np.asarray(a)
    if a.ndim == 2:
        a = a[:, :, None]
    if a.ndim != 3:
        raise ValueError(f'expected an (h, w, c) array, got shape {a.shape}')
    a = a[:, :, :3] if a.shape[2] >= 3 else np.repeat(a[:, :, :1], 3, axis=2)
    if np.issubdtype(a.dtype, np.integer):
        f = a.astype(np.float32) / float(np.iinfo(a.dtype).max)
    else:
        f = a.astype(np.float32)
    return np.clip(f, 0.0, 1.0)


def nearest(f, w, h):
    """Nearest-neighbour resample of (H, W, 3) to (h, w, 3), the way artnet_out.canvas_frame picks rows and columns."""
    H, W = f.shape[:2]
    ys = (np.arange(h) * H) // h
    xs = (np.arange(w) * W) // w
    return f[ys][:, xs]


def box_downsample(f, n):
    """Mean of every n x n block of (H, W, 3); rows/columns past the last whole block are dropped."""
    if n <= 1:
        return f
    H, W = f.shape[:2]
    H2, W2 = (H // n) * n, (W // n) * n
    f = f[:H2, :W2]
    return f.reshape(H2 // n, n, W2 // n, n, f.shape[2]).mean(axis=(1, 3))


def quantise(f):
    """float 0..1 (h, w, 3) -> contiguous uint8 (h, w, 3)."""
    return np.ascontiguousarray((np.clip(f, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8))


def encode(rgb8):
    """uint8 (h, w, 3) -> {'w', 'h', 'rgb': base64 of h*w*3 bytes, row 0 first}."""
    rgb8 = np.ascontiguousarray(rgb8, dtype=np.uint8)
    h, w = rgb8.shape[:2]
    return {'w': int(w), 'h': int(h), 'rgb': base64.b64encode(rgb8.tobytes()).decode('ascii')}


def decode(d):
    """The inverse of encode(), for tests and tools: {'w', 'h', 'rgb'} -> uint8 (h, w, 3)."""
    raw = base64.b64decode(d['rgb'])
    if len(raw) != d['w'] * d['h'] * 3:
        raise ValueError(f"rgb holds {len(raw)} bytes, expected {d['w'] * d['h'] * 3}")
    return np.frombuffer(raw, np.uint8).reshape(d['h'], d['w'], 3)


def pack_top(a, flip=True, downsample=1, size=None):
    """A TOP's numpyArray (rows bottom-up) -> encode() of it top-down. size=(w, h) resamples (nearest) first,
    downsample=n box-averages n x n blocks. A non-contiguous input is fine: a contiguous copy is made before
    the bytes are taken."""
    f = as_float_rgb(a)
    if flip:
        f = f[::-1]
    if size is not None:
        f = nearest(f, *size)
    if downsample > 1:
        f = box_downsample(f, downsample)
    return encode(quantise(f))


def pack_frame(frame):
    """A sender frame [rope][pixel][rgb] (float 0..1, pixel 0 = plug end, as artnet_out builds them) ->
    encode() with columns = ropes and row 0 = pixel 0."""
    f = np.asarray(frame, np.float32)
    if f.ndim != 3 or f.shape[2] < 3:
        raise ValueError(f'expected [rope][pixel][rgb], got shape {f.shape}')
    return encode(quantise(np.transpose(f[:, :, :3], (1, 0, 2))))


def pack_black(w, h):
    return encode(np.zeros((h, w, 3), np.uint8))
