"""Preset river windows and masks. TOP arrays are bottom-up; mask coordinates are top-down.

The profiles were chosen with the offline still-image heuristic, not semantic water detection.
Three windows gently crossfade; Auto recognition or manual selection chooses the profile.
Pure numpy, at most 10 Hz, with a GPU bypass for Original and recorded fallback.
"""
from pathlib import Path
import math
import sys
import time
import types
import numpy as np

# Pixel coordinates in the 640 x 360 clock/label-cropped camera image.
WINDOWS = {
    'channel': [(146, 144, 256, 144), (118, 140, 288, 162), (90, 136, 320, 180)],
    'pool': [(170, 156, 256, 144), (142, 148, 288, 162), (118, 140, 320, 180)],
}


def crop(rgb, box):
    x, y, w, h = box
    # Bilinear enlargement, preserving the 16:9 aspect ratio.
    xx = np.linspace(x, x + w - 1, 640)
    yy = np.linspace(y, y + h - 1, 360)
    x0, y0 = xx.astype(int), yy.astype(int)
    x1, y1 = np.minimum(x0 + 1, 639), np.minimum(y0 + 1, 359)
    wx = (xx - x0).astype(np.float32)[None, :, None]
    wy = (yy - y0).astype(np.float32)[:, None, None]
    a = rgb[y0[:, None], x0] * (1 - wx) + rgb[y0[:, None], x1] * wx
    b = rgb[y1[:, None], x0] * (1 - wx) + rgb[y1[:, None], x1] * wx
    return a * (1 - wy) + b * wy


def render(pixels, mask, profile, elapsed):
    windows = WINDOWS[profile.split('-')[0]]
    # Apply the mask after shadow lift so suppressed rocks stay black.
    rgb = np.clip(np.maximum(pixels[:, :, :3] - .008, 0) ** .58 * 1.33, 0, 1)
    rgb *= mask[:, :, None]
    if profile.endswith('-multi'):
        phase = (elapsed / 18) % len(windows)
        i = int(phase)
        weight = .5 - .5 * math.cos(math.pi * (phase - i))
        first = crop(rgb, windows[i]) * (1 - weight) + crop(rgb, windows[(i + 1) % len(windows)]) * weight
    else:
        first = crop(rgb, windows[0])
    rgba = np.ones((360, 640, 4), dtype=np.float32)
    rgba[:, :, :3] = first
    return np.ascontiguousarray(rgba[::-1])


def onCook(scriptOp):
    holder = sys.modules.setdefault('combined_framing_live', types.ModuleType('combined_framing_live'))
    if not hasattr(holder, 'masks'):
        folder = Path(project.folder) / 'td/combined'  # noqa: F821
        holder.masks = {name: np.load(folder / (name + '_mask.npz'))['mask'] for name in WINDOWS}
        holder.next = 0
    comp = scriptOp.parent()
    profile = comp.op('combined_mod').module.effective_framing(comp)
    if profile == 'original':
        return  # unselected: the switch TOP takes river_in directly
    now = time.monotonic()
    if now < holder.next:
        return
    holder.next = now + .095
    pixels = scriptOp.inputs[0].numpyArray(delayed=True)
    if pixels is not None:
        image = render(pixels[::-1], holder.masks[profile.split('-')[0]], profile, now)
        scriptOp.copyNumpyArray(image)
