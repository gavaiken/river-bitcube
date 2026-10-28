"""The remembered river's screens in the look the artists chose in mission control's HUB75 simulator (/hub75, 27 Oct):
only the moving water of the river footage, through four windows (one per screen), everything else off. numpy only.

The simulator's pipeline (mission/public/hub75.js), on bitcube:
  motion   a slow running average of how much each pixel of a 320 x 180 copy of the footage changes from frame to frame
           (water keeps changing; rocks, trees and the camera's timestamp don't), blurred and scaled so its 90th
           percentile is 1, then a soft threshold: the mask (1 = moving water).
  windows  four rectangles of the footage (x, y, w, h, 0..1 from the top left), each screen's home, drifting gently
           around it (a few % of the frame, minutes per cycle) so the view varies without wandering. TouchDesigner crops
           each window to 128 x 256 (crop + fit TOPs) and hands the four images to step().
  grade    video x mask, a black floor (anything darker goes fully off), contrast, colour, then intensity in linear
           light, 8-bit: what the HDMI carries.
Brightness follows the loop: `level` (0..1, from the show: about 0.4 in calm, 1 at the surge) scales the intensity.
"""
import math

import numpy as np

QW, QH, NQ = 128, 256, 4
MW, MH = 320, 180

# The artists' settings (the simulator's "Copy settings", 27 Oct): screens 1-4 left to right.
SETTINGS = {'intensity': 0.82, 'sens': 0.35, 'soft': 0.35, 'floor': 0.12, 'contrast': 1.4, 'sat': 0.85, 'trail': 0.5}
HOMES = [(0.1818, 0.2875, 0.1125, 0.4), (0.3438, 0.5425, 0.1125, 0.4),
         (0.4449, 0.0756, 0.1125, 0.4), (0.6168, 0.2639, 0.1125, 0.4)]
DRIFT = 0.035                  # how far a window wanders from home (fraction of the frame), each axis
DRIFT_PERIODS = [(97.0, 131.0), (113.0, 89.0), (83.0, 149.0), (127.0, 103.0)]   # seconds, x and y, per screen
ZOOM_BREATH = 0.06             # window size breathes +-6 %
A_SLOW = 0.02                  # the simulator's slow motion average per river frame (float textures)
P_NORM = 0.90


def _blur(a, r=3):
    """Separable box blur (three passes ~ gaussian), edges clamped."""
    out = a
    for _ in range(3):
        p = np.pad(out, ((0, 0), (r, r)), mode='edge')
        c = np.cumsum(p, axis=1)
        c = np.concatenate([np.zeros((c.shape[0], 1)), c], axis=1)
        out = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
        p = np.pad(out, ((r, r), (0, 0)), mode='edge')
        c = np.cumsum(p, axis=0)
        c = np.concatenate([np.zeros((1, c.shape[1])), c], axis=0)
        out = (c[2 * r + 1:, :] - c[:-2 * r - 1, :]) / (2 * r + 1)
    return out


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / max(e1 - e0, 1e-6), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def luma(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


class Water:
    def __init__(self, settings=None, homes=None):
        self.s = dict(SETTINGS, **(settings or {}))
        self.homes = list(homes or HOMES)
        self.prev = None
        self.slow = np.zeros((MH, MW), np.float32)
        self.frames = 0
        self.norm = 40.0
        self.mask = np.zeros((MH, MW), np.float32)
        self.lit_pct = [0, 0, 0, 0]
        self.brightness = 0.0          # mean linear light of the last frame, 0..1

    # ---- the motion mask --------------------------------------------------------------------------------------------
    def feed(self, img):
        """A new river frame (MH x MW x 3, float 0..1 or uint8, row 0 at the top)."""
        a = np.asarray(img, np.float32)
        if a.dtype != np.float32 or a.max() > 1.5:
            a = a / 255.0
        if a.shape[:2] != (MH, MW):
            ys = (np.arange(MH) * a.shape[0] / MH).astype(int)
            xs = (np.arange(MW) * a.shape[1] / MW).astype(int)
            a = a[ys][:, xs]
        L = luma(a[..., :3])
        if self.prev is not None and self.prev.shape == L.shape:
            d = np.abs(L - self.prev)
            a_slow = max(A_SLOW, 1.0 / (self.frames + 1))      # settle fast at the start, then slow
            self.slow += (d - self.slow) * a_slow
        self.prev = L
        self.frames += 1
        b = _blur(self.slow, 3)
        p = float(np.quantile(b, P_NORM))
        want = 1.0 / max(p, 1e-3)
        self.norm += (want - self.norm) * 0.25
        thr = 0.05 + self.s['sens'] * 0.9
        soft = 0.05 + self.s['soft'] * 0.8
        self.mask = smoothstep(thr, thr + soft, b * self.norm).astype(np.float32)

    @property
    def water_frac(self):
        return float((self.mask > 0.5).mean())

    # ---- where each screen looks ---------------------------------------------------------------------------------------
    def windows(self, t):
        """The four windows now: [(x, y, w, h)], 0..1 from the top left, kept inside the frame."""
        out = []
        for k, (x, y, w, h) in enumerate(self.homes):
            px, py = DRIFT_PERIODS[k % len(DRIFT_PERIODS)]
            dx = DRIFT * math.sin(2 * math.pi * t / px + k * 1.7)
            dy = DRIFT * math.sin(2 * math.pi * t / py + k * 0.9)
            z = 1.0 + ZOOM_BREATH * math.sin(2 * math.pi * t / (px + py) + k)
            ww, hh = min(1.0, w * z), min(1.0, h * z)
            cx = min(1 - ww / 2, max(ww / 2, x + w / 2 + dx))
            cy = min(1 - hh / 2, max(hh / 2, y + h / 2 + dy))
            out.append((cx - ww / 2, cy - hh / 2, ww, hh))
        return out

    def _mask_in(self, win):
        x, y, w, h = win
        xs = np.clip(((x + (np.arange(QW) + 0.5) / QW * w) * MW).astype(int), 0, MW - 1)
        ys = np.clip(((y + (np.arange(QH) + 0.5) / QH * h) * MH).astype(int), 0, MH - 1)
        return self.mask[ys][:, xs]

    # ---- the screens ---------------------------------------------------------------------------------------------------
    def step(self, crops, wins, level=1.0, intensity=None, sens=None):
        """crops: four QH x QW x 3 images (float 0..1, row 0 at the top), each window's footage; wins: the windows they
        came from. Returns QH x (QW*4) x 3, float 0..1 (the signal)."""
        if sens is not None and sens != self.s['sens']:
            self.s['sens'] = float(sens)
        inten = (self.s['intensity'] if intensity is None else float(intensity)) * max(0.0, min(1.0, level))
        s = self.s
        out = np.zeros((QH, QW * NQ, 3), np.float32)
        light = 0.0
        for k in range(NQ):
            c = crops[k] if k < len(crops) and crops[k] is not None else None
            if c is None:
                self.lit_pct[k] = 0
                continue
            c = np.asarray(c, np.float32)[..., :3]
            if c.shape[:2] != (QH, QW):
                ys = (np.arange(QH) * c.shape[0] / QH).astype(int)
                xs = (np.arange(QW) * c.shape[1] / QW).astype(int)
                c = c[ys][:, xs]
            m = self._mask_in(wins[k])[..., None]
            v = c * m
            lv = luma(v)
            v = lv[..., None] + (v - lv[..., None]) * s['sat']
            lv = luma(v)
            kf = np.where(lv > 0, np.maximum(lv - s['floor'], 0) / (1 - s['floor']) / np.maximum(lv, 1e-6), 0.0)
            v = np.clip(v * kf[..., None], 0.0, 1.0) ** s['contrast']
            lin = v ** 2.2 * inten
            v = np.round(lin ** (1 / 2.2) * 255) / 255
            out[:, k * QW:(k + 1) * QW] = v
            self.lit_pct[k] = int(round(100 * float((v.max(axis=-1) > 0).mean())))
            light += float(lin.mean())
        self.brightness = light / NQ
        return out
