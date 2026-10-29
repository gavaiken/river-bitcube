"""The room, as the ropes feel it: raw presence (how many people the counter sees, who is standing still where) in, the
three smoothed people signals the ropes render out (docs/remembered-v2-plan.md, Decisions 3). numpy only, no
TouchDesigner; deterministic for a given sequence of inputs (no randomness at all).

The rules (Gavin, 29 Oct):
- a lingerer (someone standing still near the piece) gathers the light on their 2-4 nearest ropes: `linger` (per rope,
  0..1) builds over ~3 s when they appear and fades over ~5 s after they go. Their ropes are the counter's own nearest
  ropes, widened by zones.neighbours with a tight radius (the old 0.08 lit 11-18 of 20 ropes: all the feet span about
  0.16 of the show view) and never more than LINGER_ROPES of them.
- the crowd: `headcount` is what the counter sees now; `crowd` (0..1) mounts over ~60 s as people are counted and
  subsides over ~60 s (1 person = a hint, CROWD_FULL or more = full).
- an empty room: `empty` (0..1) ramps up over ~60 s once nobody has been seen for EMPTY_GRACE_S; anyone entering drops
  it to 0 within ~1.5 s and sets `wake` (0..1, the moment the room noticed them, fading over WAKE_S).
- no counter (presence unavailable or stale): every signal relaxes to neutral (no crowd, not empty, no lingerers).

Use: one RoomState per show; each frame `room.update(dt, count, lingerers, available)` with the counter's newest raw
count (not a median: waking must be fast) and its lingerers [{ropes: [nearest first], still_s, x, y}]; then
`ropes.default_ctx(..., **room.ctx())`, and `room.status()` for status.json.
"""
import numpy as np

N_ROPES = 20
LINGER_RADIUS = 0.012          # show-view distance (feet) over which a lingerer's light spreads to the next ropes
LINGER_ROPES = 4               # a lingerer lights at most this many ropes ...
LINGER_MIN_ROPES = 2           # ... and at least this many (the second nearest gets LINGER_SECOND at least)
LINGER_SECOND = 0.6
LINGER_RANK = (1.0, 1.0, 0.85, 0.7)    # nearest first: how much of the light each of a lingerer's ropes gets
LINGER_UP_S, LINGER_DOWN_S = 3.0, 5.0  # builds over this when they appear, fades over this after
CROWD_FULL = 4                 # this many people (or more) = the full crowd
CROWD_UP_S, CROWD_DOWN_S = 60.0, 60.0  # crowd 0 -> 1 / 1 -> 0
EMPTY_GRACE_S = 5.0            # nobody seen this long before the room counts as emptying (the counter blinks)
EMPTY_UP_S = 60.0              # then empty 0 -> 1 over this
EMPTY_DOWN_S = 1.5             # anyone entering: empty 1 -> 0 over this (the room wakes within ~3 s)
WAKE_S = 4.0                   # the wake pulse fades over this


def _toward(cur, target, dt, up_s, down_s):
    """Move cur linearly toward target: 0 -> 1 takes up_s going up, down_s going down. Works on arrays."""
    cur = np.asarray(cur, np.float32)
    target = np.asarray(target, np.float32)
    up = np.minimum(cur + dt / up_s, target)
    down = np.maximum(cur - dt / down_s, target)
    return np.where(target > cur, up, down).astype(np.float32)


class RoomState:
    """Smoothed people signals for the ropes: crowd, empty, linger (per rope), linger_strength, headcount, wake."""

    def __init__(self, zones=None):
        self.z = zones
        self.crowd = 0.0
        self.empty = 0.0
        self.wake = 0.0
        self.headcount = 0
        self.available = False
        self.linger = np.zeros(N_ROPES, np.float32)
        self.linger_target = np.zeros(N_ROPES, np.float32)
        self.lingerers = []
        self.nobody_s = 0.0            # how long nobody has been seen (only while the counter is available)

    @property
    def linger_strength(self):
        return float(self.linger.max(initial=0.0))

    def ropes_for(self, lingerer):
        """One lingerer -> per-rope weight 0..1 on their 2-4 nearest ropes."""
        near = [int(r) for r in (lingerer.get('ropes') or []) if isinstance(r, (int, float)) and 0 <= int(r) < N_ROPES]
        w = np.zeros(N_ROPES, np.float32)
        if not near:
            return w
        anchor = near[0]
        if self.z is not None and getattr(self.z, 'feet', None) is not None and len(self.z.feet) == N_ROPES:
            g = self.z.neighbours([anchor], radius=LINGER_RADIUS)
            d = np.linalg.norm(self.z.feet - self.z.feet[anchor], axis=1)
        else:                                                    # no feet: the counter's order is all we have
            g = np.zeros(N_ROPES, np.float32)
            d = np.full(N_ROPES, 9.0, np.float32)
        for i, r in enumerate(near[:2]):                         # the counter's two nearest first, then by distance
            d[r] = -1.0 + i * 1e-3
            g[r] = max(g[r], 1.0 if i == 0 else LINGER_SECOND)
        order = np.argsort(d, kind='stable')
        if len(near) < LINGER_MIN_ROPES and g[order[1]] < LINGER_SECOND:
            g[order[1]] = LINGER_SECOND                          # an isolated rope still takes its nearest neighbour
        for k, r in enumerate(order[:LINGER_ROPES]):
            w[r] = g[r] * LINGER_RANK[k]
        return w

    def update(self, dt, count=None, lingerers=(), available=True):
        """One tick: count = the counter's newest headcount (None when unknown), lingerers as in presence.json."""
        dt = max(0.0, float(dt))
        self.available = bool(available) and count is not None
        n = max(0, int(round(float(count)))) if self.available else 0
        self.headcount = n
        ling = [g for g in (lingerers or []) if isinstance(g, dict)] if self.available else []
        self.lingerers = ling
        target = np.zeros(N_ROPES, np.float32)
        for g in ling:
            target = np.maximum(target, self.ropes_for(g))
        self.linger_target = target
        self.linger = _toward(self.linger, target, dt, LINGER_UP_S, LINGER_DOWN_S)
        crowd_t = min(1.0, n / CROWD_FULL)
        self.crowd = float(_toward(self.crowd, crowd_t, dt, CROWD_UP_S, CROWD_DOWN_S))
        if self.available and n == 0 and not ling:
            self.nobody_s += dt
        else:
            self.nobody_s = 0.0
        if self.available and self.nobody_s >= EMPTY_GRACE_S:
            self.empty = float(_toward(self.empty, 1.0, dt, EMPTY_UP_S, EMPTY_DOWN_S))
        else:
            if self.available and (n > 0 or ling) and self.empty > 0.05:
                self.wake = max(self.wake, self.empty)           # someone came into an emptying room
            self.empty = float(_toward(self.empty, 0.0, dt, EMPTY_UP_S, EMPTY_DOWN_S))
        self.wake = max(0.0, self.wake - dt / WAKE_S)
        return self

    def ctx(self):
        """The keys ropes.default_ctx takes from the room."""
        return {'crowd': self.crowd, 'empty': self.empty, 'linger': self.linger.copy(), 'headcount': self.headcount,
                'wake': self.wake}

    def status(self):
        """For status.json: plain numbers."""
        return {'available': self.available, 'headcount': self.headcount, 'crowd': round(self.crowd, 3),
                'empty': round(self.empty, 3), 'wake': round(self.wake, 3),
                'linger_strength': round(self.linger_strength, 3),
                'linger_ropes': [int(r) for r in np.nonzero(self.linger > 0.05)[0]],
                'lingerers': len(self.lingerers), 'nobody_s': round(self.nobody_s, 1)}
