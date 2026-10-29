"""How much the river moves: the river frames (live cam or the recorded clip, ~10 a second) -> one level 0..1, the
ropes' flow when Dave's sound (heard) is missing. numpy only.

The level: frame difference of a 320 x 180 luma copy, the brightest MOTION_KEEP of it averaged, against a slowly
decaying peak. The same luma copy feeds water.py's motion mask (show.feed_river makes it once: river_luma).
(Extracted on 29 Oct from panels.py, whose screens the artists replaced with the ribbons and the water look.)
"""
import numpy as np

MW, MH = 320, 180                  # the motion map (river frame downsampled)
MOTION_KEEP = 0.15                 # keep the brightest 15 % of motion
_W = np.array([0.2126, 0.7152, 0.0722], np.float32)


def resize_nearest(g, w=MW, h=MH):
    if g.shape[0] == h and g.shape[1] == w:
        return g
    ys = (np.arange(h) * g.shape[0]) // h
    xs = (np.arange(w) * g.shape[1]) // w
    return g[ys][:, xs]


def river_luma(img):
    """A river frame (H x W x 3+ or H x W; float 0..1 or uint8; row 0 at the top) -> MH x MW float32 luma 0..1."""
    a = resize_nearest(np.asarray(img))
    if a.dtype == np.uint8 or (a.size and a.max() > 1.5):
        a = a.astype(np.float32) / np.float32(255.0)
    if a.ndim == 2:
        return np.asarray(a, np.float32)
    return np.asarray(a[..., :3], np.float32) @ _W


class Motion:
    """River frames -> the motion level (the foam map the old screens drew from went with them)."""

    def __init__(self):
        self.prev = None
        self.level = 0.0
        self.peak = 1e-3
        self.frames = 0

    def feed(self, img):
        self.feed_luma(river_luma(img))

    def feed_luma(self, g):
        """g: MH x MW float32 luma (river_luma)."""
        if self.prev is None:
            self.prev = g
            return
        d = np.abs(g - self.prev)
        self.prev = g
        s = d * np.float32(1 / 5.0)                              # the 5-point blur (wrapping at the edges, as np.roll)
        acc = s.copy()
        acc[1:] += s[:-1]
        acc[0] += s[-1]
        acc[:-1] += s[1:]
        acc[-1] += s[0]
        acc[:, 1:] += s[:, :-1]
        acc[:, 0] += s[:, -1]
        acc[:, :-1] += s[:, 1:]
        acc[:, -1] += s[:, 0]
        d = acc
        n = d.size
        k = int((1 - MOTION_KEEP) * n)
        part = np.partition(d.ravel(), k)
        thr = part[k]
        above = part[k + 1:]                                     # everything above the k-th: the > thr set (ties aside)
        above = above[above > thr]
        hi = float(above.mean()) if above.size else 0.0
        self.peak = max(self.peak * 0.995, hi)
        self.level = float(min(1.0, hi / self.peak)) if self.peak > 1e-3 else 0.0
        self.frames += 1
