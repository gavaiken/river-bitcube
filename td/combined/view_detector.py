"""Recognize Will's two river views from coarse, exposure-normalized image structure.

No camera control or network requests. Unknown, ambiguous, stale and settling views bypass masks.
Reference thumbnails come from the same night-camera frames as the framing masks.
"""
from pathlib import Path
import sys
import time
import types
import numpy as np

VIEWS = ('channel', 'pool')
MIN_SCORE = .90
MIN_MARGIN = .10
SETTLE_S = 1.0
MAX_AGE_S = 2.0


def feature(pixels):
    gray = np.asarray(pixels, dtype=np.float32)[:, :, :3].mean(axis=2)
    # TOP input is exactly 640x360; average blocks suppress moving water and camera noise.
    if gray.shape != (360, 640) or not np.all(np.isfinite(gray)):
        return None
    small = gray.reshape(18, 20, 32, 20).mean(axis=(1, 3))
    small -= small.mean()
    norm = float(np.linalg.norm(small))
    return small / norm if norm > .02 else None


def match(value, references):
    if value is None:
        return {'candidate': None, 'confidence': 0.0, 'margin': 0.0}
    scores = sorted(((float(np.sum(value * references[name])), name) for name in VIEWS), reverse=True)
    best, second = scores[0][0], scores[1][0]
    return {'candidate': scores[0][1] if best >= MIN_SCORE and best - second >= MIN_MARGIN else None,
            'confidence': round(best, 4), 'margin': round(best - second, 4)}


class Detector:
    def __init__(self, references):
        self.references = references
        self.previous = None
        self.last = None
        self.since = None
        self.candidate = None
        self.selected = None
        self.confidence = 0.0
        self.margin = 0.0

    def observe(self, pixels, now):
        value = feature(pixels) if pixels is not None else None
        result = match(value, self.references)
        moving = value is not None and self.previous is not None and float(np.sum(value * self.previous)) < .995
        self.previous = value
        candidate = result['candidate']
        # A gap requires settling again, even if the last recognized view was the same.
        gap = self.last is None or now - self.last > MAX_AGE_S or now < self.last
        if gap or moving or candidate != self.candidate:
            self.since = now
            self.selected = None
        self.last = now
        self.candidate = candidate
        self.confidence, self.margin = result['confidence'], result['margin']
        if candidate is None:
            self.selected = None
            self.since = now
        elif now - self.since >= SETTLE_S:
            self.selected = candidate
        return self.info(now)

    def info(self, now):
        fresh = self.last is not None and 0 <= now - self.last <= MAX_AGE_S
        selected = self.selected if fresh else None
        return {'view': selected, 'candidate': self.candidate if fresh else None,
                'confidence': self.confidence, 'margin': self.margin,
                'reason': 'matched' if selected else 'settling' if fresh and self.candidate else 'unknown',
                'profile': selected + '-multi' if selected else 'original'}


def holder():
    h = sys.modules.setdefault('combined_view_detector_live', types.ModuleType('combined_view_detector_live'))
    if not hasattr(h, 'detector'):
        with np.load(Path(project.folder) / 'td/combined/view_references.npz') as refs:  # noqa: F821
            h.detector = Detector({name: refs[name].copy() for name in VIEWS})
        h.next_poll = 0.0
    return h


def poll(comp, now, live):
    h = holder()
    if not live:
        h.detector.observe(None, now)
        h.next_poll = now + .5
    elif now >= h.next_poll:
        h.next_poll = now + .5
        source = comp.op('framing_input')
        source.cook(force=True)  # also evaluate while Original bypasses the framing branch
        pixels = source.numpyArray(delayed=True)
        h.detector.observe(pixels[::-1] if pixels is not None else None, now)


def status(now=None):
    return holder().detector.info(time.monotonic() if now is None else now)
