"""The remembered river on the 20 ropes: one 20 x 400 RGB frame (float 0..1, [rope][led][rgb], LED 0 at the ceiling) per
step, from the loop's state. numpy only (no TouchDesigner); deterministic for a given seed and sequence of inputs.

The artists' rules (docs/files/river-remembered.md has them in full):
- calm: 30-40 % brightness, low saturation, about a quarter of the ropes carry single slow drips; the pool breathes.
- building: more ropes wake, drips lengthen and join into flow, speed up.
- surge: draw-back (last 8 s: everything dims to near black, the top metre glows faintly); the front (white-cyan edge,
  2-3 px sharp leading edge, ~20 px full white, ~60 px fading tail, enters every rope top with a 0-600 ms offset,
  40 % of its top speed accelerating to it by mid-height, the floor in ~3.5 s); the body (saturated teal-cyan at
  70-85 %, foam sparkles riding the flow, bubbles, per-rope speed +-30 % on 2-5 s noise, eddies at the driftwood); the
  pool (deeper, bluer, 0.3x flow, churns white); the swell at 60 % through the body (+15 %, a 2 s pulse top to floor).
- settling: colour drains (~15 s), then speed (~30 s), foam thins, the ropes go dark top-down one by one in random
  order, the pool fades last leaving a slow drip.
- people (v2, Gavin 29 Oct; room.py smooths the room into crowd, empty and linger):
  - a lingerer: sparks and splashes run up and down their 2-4 nearest ropes (short bright streaks, 5-20 px, thrown up
    from the waterline and falling from above, in the palette's light and foam, several a second; landing in the pool
    they splash), the light gathers there (those ropes x1.5-2 with a standing glow, the rest a little dimmer) and the
    waterline rises on those ropes. Strongest between 0.5 and 1.8 m.
  - a crowd: Fantasia-style turbulence at head height and below (LEDs <= 1.8 m): swirling eddies, a slosh across the
    ropes, bursts; 1 person a hint, 4+ full; calm brightens toward 0.6 and more ropes carry drips.
  - an empty room: the calm becomes slow ocean waves over the pool and across the ropes (10-20 s), settling to a still
    pond breathing at ~0.15; the main surge still plays, at ~60 %. Anyone entering wakes it (a ripple across the pool).
- safety: the whole column's mean brightness never changes faster than MAX_MEAN_RATE per second (every change ramps over
  >= 0.5 s, no whole-column flashing), and the frame never asks for more than BUDGET_W (artnet_out's power model) so
  artnet_out's own 1,400 W limit never has to cut in.
"""
import math

import numpy as np

from . import palette as pal_mod

N_ROPES, N_PX = 20, 400
WATTS_PER_CHANNEL = 150 / 400 / 3          # = td/ropes/artnet_out.py (tested)
BUDGET_W = 1250.0                          # under artnet_out.TOTAL_WATTS (1,400 W) with headroom
MAX_MEAN_RATE = 0.5                        # column mean brightness per second (0 -> 1 takes 2 s)
FOAM_SLOTS = 40                            # ~1 sparkle per 10 px
BUBBLE_SLOTS = 3
FRONT_EDGE_PX, FRONT_WHITE_PX, FRONT_TAIL_PX = 2.5, 20.0, 60.0
SWELL_AT, SWELL_GAIN, SWELL_S = 0.6, 0.15, 2.0
TOP_GLOW_M = 1.0
DARK_SPEED = 90.0                          # px/s: the settling darkness running down a rope
# Round 2 (the artists on site, 27 Oct): M3 the pool, M4 more dynamic, M5 easing and black dots
POOL_BAND_M = 0.35                         # the waterline is a soft band this deep (~14 LEDs), never a hard edge
POOL_RISE_M = (0.25, 0.45)                 # how far the waterline rises with the river's flow, and in a surge
SLOSH_M = (0.08, 0.16)                     # the slow wave across the ropes: calm, and at full turbulence
RIPPLE_SLOTS = 24
RIPPLE_SPEED = 0.18                        # across the piece (0..1 of its width) per second
RIPPLE_LIFE = 1.8                          # s
EASE_RANGE = (1.0, 60.0)                   # s: each surge eases in and out over a duration in this range (log-uniform)
DOT_SLOTS = 40                             # black dots in the surge body: as many as the foam
MINI_BODY, MINI_SETTLE, MINI_GAIN = 10.0, 14.0, 0.55   # a small surge (M4: random when the room is empty, or the room's)
# v2 (29 Oct): people visibly change the ropes
LINGER_GAIN = 0.9                          # a lingerer's ropes up to x1.9 ...
LINGER_DIM = 0.25                          # ... and every other rope down by up to this
LINGER_GLOW = 0.16                         # a standing, shimmering glow on a lingerer's ropes (in LINGER_BAND_M)
LINGER_RISE_M = 0.4                        # the waterline rises this much on a lingerer's ropes
LINGER_BAND_M = (0.5, 1.8)                 # the sparks and the gathering are strongest between these heights
LINGER_SLOW = 0.6                          # and the water there slows by up to this
SPARK_SLOTS = 64
SPARK_RATE = 7.0                           # sparks a second on a fully lingered rope
SPARK_UP = 0.6                             # the share thrown up from the waterline (the rest fall from above)
SPARK_LEN_PX = (5.0, 20.0)
SPARK_V = (90.0, 170.0)                    # px/s thrown up from the waterline (2.2-4 m/s)
SPARK_FROM_M = (1.6, 2.6)                  # the falling ones start this high
SPARK_G = 160.0                            # px/s^2 pulling every spark down into the pool, where it splashes
SPARK_LIFE_S = 2.2
CROWD_FULL_AT = 1.0                        # crowd (room.py: 4 people = 1) at which the turbulence is full
CROWD_TOP_M = 1.8                          # the crowd's turbulence: at head height and below
CROWD_CALM = 0.6                           # a full crowd lifts the calm level toward this
CROWD_TURB = 0.4                           # and adds this to the turbulence knob
BURST_SLOTS = 10
BURST_LIFE = 0.9                           # s
BURST_RATE = 3.0                           # bursts a second at a full crowd (x crowd^2: 1 person ~0.2/s)
EMPTY_POND = 0.15                          # an empty room settles to a still pond breathing at about this
EMPTY_WAVE_S = (13.0, 19.0)                # its slow ocean waves' periods (across the ropes, and up from the pool)
EMPTY_WAVE_M = 0.14                        # how far they lift the waterline
EMPTY_SURGE = 0.6                          # an empty room's main surge plays at this gain


def front_vmax(flow_pct):
    """The front's top speed in px/s: 1.5-3 m/s (40 px/m) by the day's flow percentile."""
    return 60.0 + 60.0 * max(0.0, min(100.0, float(flow_pct))) / 100.0


def front_pos(tau, floor_px, vmax):
    """Where the front is (px below the rope top) tau seconds after it entered: 0.4 * vmax at the top, speeding up
    linearly with distance to vmax at mid-height (floor_px / 2), then steady. Works on arrays."""
    tau = np.maximum(np.asarray(tau, float), 0.0)
    floor_px = np.asarray(floor_px, float)
    v0 = 0.4 * vmax
    s_mid = np.maximum(floor_px / 2.0, 1.0)
    a = (vmax - v0) / s_mid
    t_mid = np.log(vmax / v0) / a
    early = v0 / a * np.expm1(a * np.minimum(tau, t_mid))
    return np.where(tau < t_mid, early, s_mid + vmax * (tau - t_mid))


def front_time(px, floor_px, vmax):
    """Inverse of front_pos: seconds for the front to reach px."""
    px = np.asarray(px, float)
    floor_px = np.asarray(floor_px, float)
    v0 = 0.4 * vmax
    s_mid = np.maximum(floor_px / 2.0, 1.0)
    a = (vmax - v0) / s_mid
    t_mid = np.log(vmax / v0) / a
    return np.where(px < s_mid, np.log1p(a * np.maximum(px, 0) / v0) / a, t_mid + (px - s_mid) / vmax)


def led_mask(leds):
    """[{rope, from, to}] (inclusive LED ranges) -> a 20 x 400 bool mask."""
    m = np.zeros((N_ROPES, N_PX), bool)
    for e in leds or []:
        try:
            r, a, b = int(e['rope']), int(e['from']), int(e['to'])
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= r < N_ROPES:
            a, b = sorted((max(0, a), min(N_PX - 1, b)))
            m[r, a:b + 1] = True
    return m


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def norm(c):
    """A colour scaled so its brightest channel is 1 (intensity then sets the LED level)."""
    m = max(c) or 1.0
    return np.array([v / m for v in c], np.float32)


class Safety:
    """Ramps and power: limits how fast the frame's mean may change and keeps it under the power budget."""

    def __init__(self, max_rate=MAX_MEAN_RATE, budget_w=BUDGET_W):
        self.max_rate, self.budget_w = max_rate, budget_w
        self.prev = None
        self.watts = 0.0

    def apply(self, frame, dt):
        w_raw = float(frame.sum()) * WATTS_PER_CHANNEL
        g_max = min(1.6, self.budget_w / w_raw) if w_raw > 0 else 1.0
        g = min(1.0, g_max)
        m_raw = float(frame.mean())
        if self.prev is not None and m_raw > 0:
            step = self.max_rate * min(max(dt, 0.0), 0.1)
            target = m_raw * g
            if target > self.prev + step:
                g = (self.prev + step) / m_raw
            elif target < self.prev - step:
                g = min(g_max, (self.prev - step) / m_raw)
        out = np.clip(frame * g, 0.0, 1.0).astype(np.float32)
        self.prev = float(out.mean())
        self.watts = float(out.sum()) * WATTS_PER_CHANNEL
        return out


def default_ctx(**kw):
    """The inputs one step needs, with neutral defaults (show.py fills them from the loop and the files)."""
    ctx = {'t': 0.0, 'times': None, 'phase': 'calm', 'energy': 0.4, 'pal': pal_mod.palette('autumn'),
           'flow_pct': 50.0, 'rain': 0.3, 'cold': False, 'dry': False, 'flow_level': 0.5,
           'knobs': {'speed': 0.5, 'density': 0.5, 'brightness': 0.5, 'turbulence': 0.5},
           'linger': np.zeros(N_ROPES, np.float32), 'night': 0.0, 'calm_level': 0.35, 'level': 1.0,
           'wave': None, 'light': 'off', 'pool_height_m': None,
           'crowd': 0.0, 'empty': 0.0, 'headcount': 0, 'wake': 0.0}   # the room (room.RoomState.ctx())
    ctx.update(kw)
    return ctx


class Ropes:
    def __init__(self, zones, seed=0):
        self.z = zones
        rng = np.random.default_rng(seed)
        R = N_ROPES
        self.x = np.arange(N_PX, dtype=np.float32)[None, :]
        self.floor = zones.floor_px.astype(np.float32)[:, None]
        self.top = zones.height >= (zones.height[:, :1] - TOP_GLOW_M)
        self.rank = rng.permutation(R).astype(np.float32)               # which ropes wake first
        self.dark_rank = rng.permutation(R).astype(np.float32)          # the order they go dark in settling
        self.strand = rng.permutation(R) < 6                            # a dry day's few thin strands
        self.front_off = rng.uniform(0.0, 0.6, R)
        self.spacing = rng.uniform(70.0, 130.0, R).astype(np.float32)[:, None]
        self.noise_f = rng.uniform(1 / 5, 1 / 2, (R, 2))
        self.noise_p = rng.uniform(0, 2 * math.pi, (R, 2))
        self.tex_p = rng.uniform(0, 2 * math.pi, (R, 2)).astype(np.float32)
        self.foam_x0 = rng.uniform(0, N_PX, (R, FOAM_SLOTS))
        self.foam_j = rng.uniform(-0.2, 0.2, (R, FOAM_SLOTS))
        self.foam_life = rng.uniform(0.3, 1.2, (R, FOAM_SLOTS))
        self.foam_t0 = rng.uniform(0, 1, (R, FOAM_SLOTS))
        self.foam_size = rng.integers(1, 4, (R, FOAM_SLOTS))
        self.foam_rank = rng.uniform(0, 1, (R, FOAM_SLOTS))
        self.bub_x0 = rng.uniform(0, N_PX, (R, BUBBLE_SLOTS))
        self.bub_period = rng.uniform(3.0, 6.0, (R, BUBBLE_SLOTS))
        self.bub_t0 = rng.uniform(0, 1, (R, BUBBLE_SLOTS))
        self.bub_size = rng.integers(4, 9, (R, BUBBLE_SLOTS))
        self.sparkle = rng.uniform(0, 1, (16, R, N_PX)).astype(np.float32)   # per-LED hash for eddy foam
        self.phase = rng.uniform(0, 1000, R)                            # px travelled by each rope's water
        self.pool_phase = 0.0
        self.time = 0.0
        self.safety = Safety()
        self.watts = 0.0
        self.v_now = 0.0
        self.base_level = 0.0
        self.overlay = None              # extra light to add (N_ROPES x N_PX x 3), set by the show each frame
        self.state = {}
        self.rng = rng
        feet = getattr(zones, 'feet', None)
        rx = feet[:, 0] if feet is not None and len(feet) == R else (np.arange(R) + 0.5) / R
        span = max(1e-3, float(rx.max() - rx.min()))
        self.rx = ((rx - rx.min()) / span).astype(np.float32)          # each rope across the piece, 0..1 (real order)
        self.rip_x = np.zeros(RIPPLE_SLOTS, np.float32)
        self.rip_t0 = np.full(RIPPLE_SLOTS, -99.0, np.float32)
        self.rip_a = np.zeros(RIPPLE_SLOTS, np.float32)
        self.rip_i = 0
        self.landed = np.zeros(R, bool)                                  # the surge front has reached this rope's pool
        self.mini_landed = np.zeros(R, bool)
        self.ease = (2.0, 8.0)                                           # this surge's ease in / out (M5)
        self.last_tau = None
        self.dot_x0 = rng.uniform(0, N_PX, (R, DOT_SLOTS))
        self.dot_j = rng.uniform(-0.15, 0.15, (R, DOT_SLOTS))
        self.dot_life = rng.uniform(0.6, 1.8, (R, DOT_SLOTS))
        self.dot_t0 = rng.uniform(0, 1, (R, DOT_SLOTS))
        self.dot_size = rng.integers(2, 5, (R, DOT_SLOTS))
        self.dot_rank = rng.uniform(0, 1, (R, DOT_SLOTS))
        self.pw = np.zeros((R, N_PX), np.float32)
        self.hw = np.zeros(R, np.float32)
        # v2: the people effects
        h = zones.height.astype(np.float32)
        lo, hi = LINGER_BAND_M
        self.band = (0.3 + 0.7 * smooth((h - (lo - 0.25)) / 0.25) * smooth(((hi + 0.5) - h) / 0.5)).astype(np.float32)
        self.crowd_mask = smooth((CROWD_TOP_M + 0.25 - h) / 0.35).astype(np.float32)
        self.sp_live = np.zeros(SPARK_SLOTS, bool)
        self.sp_rope = np.zeros(SPARK_SLOTS, np.int64)
        self.sp_x = np.zeros(SPARK_SLOTS, np.float32)
        self.sp_v = np.zeros(SPARK_SLOTS, np.float32)
        self.sp_len = np.zeros(SPARK_SLOTS, np.float32)
        self.sp_age = np.zeros(SPARK_SLOTS, np.float32)
        self.sp_amp = np.zeros(SPARK_SLOTS, np.float32)
        self.sp_mix = np.zeros(SPARK_SLOTS, np.float32)
        self.sp_gen = np.zeros(SPARK_SLOTS, np.int8)
        self.bu_rx = np.zeros(BURST_SLOTS, np.float32)
        self.bu_h = np.zeros(BURST_SLOTS, np.float32)
        self.bu_t0 = np.full(BURST_SLOTS, -99.0, np.float32)
        self.bu_i = 0
        self.wake_prev = 0.0
        self.effects = {'lingerer': 0.0, 'crowd': 0.0, 'empty': 0.0, 'sparks': 0}

    # ---- envelopes ---------------------------------------------------------------------------------------------------

    def _env(self, c):
        """Scalars for this moment of the loop."""
        t, tm = c['t'], c['times']
        e = {'b': 0.0, 'g_calm': 1.0, 'glow': 0.0, 'tau': None, 'tau_s': None, 'ls': None}
        if tm is None:
            return e
        if tm['build'] <= t < tm['surge']:
            e['b'] = float(smooth((t - tm['build']) / max(1.0, tm['drawback'] - tm['build'])))
        if t >= tm['drawback'] and t < tm['calm']:
            d = (t - tm['drawback']) / (tm['surge'] - tm['drawback'])
            e['g_calm'] = 1.0 - 0.94 * float(smooth(d))                # draw-back: down to near black
            e['glow'] = 0.10 * float(smooth(d * 1.5))
        if t >= tm['surge'] and t < tm['calm']:
            e['tau'] = t - tm['surge']
            e['b'] = 1.0 if t < tm['settle'] else 0.0
            e['glow'] = 0.10 * (1 - float(smooth(e['tau'] / 2.0)))      # the top-metre glow gives way to the front
        if t >= tm['settle'] and t < tm['calm']:
            e['tau_s'] = t - tm['settle']
            e['ls'] = max(1.0, tm['calm'] - tm['settle'])
            back = float(smooth((e['tau_s'] / e['ls'] - 0.45) / 0.55))  # calm comes back over the second half
            e['g_calm'] = 0.06 + 0.94 * back
            e['glow'] = 0.0
        return e

    # ---- M3: the pool's waterline and ripples -------------------------------------------------------------------------

    def ripple(self, rope, strength):
        """A ring spreading from where water lands in a rope's pool, to its neighbours by real distance."""
        i = self.rip_i % RIPPLE_SLOTS
        self.rip_x[i], self.rip_t0[i], self.rip_a[i] = self.rx[rope], self.time, strength
        self.rip_i += 1

    def _pool_weight(self, c, fl, surge_fill, turb, rise_r=0.0, ocean=0.0, still=0.0):
        """0..1 per LED: how much it is in the pool. The waterline rises with the river and in a surge (and per rope by
        rise_r: a lingerer's ropes), sloshes as a slow wave across the ropes in their real order (stilled by `still`, an
        empty room, which rolls slow ocean waves of height `ocean` instead), and is a soft band, never a hard edge."""
        T = self.time
        base = c.get('pool_height_m')
        base = float(self.z.pool_height_m if base is None else base)
        rise = POOL_RISE_M[0] * fl + POOL_RISE_M[1] * surge_fill + np.asarray(rise_r, np.float32)
        amp = (SLOSH_M[0] + (SLOSH_M[1] - SLOSH_M[0]) * turb) * (1 - still)
        slosh = amp * (np.sin(2 * np.pi * (self.rx / 0.7) - 0.55 * T) + 0.45 * np.sin(2 * np.pi * (self.rx / 0.23) + 1.2 * T))
        if ocean > 0:
            slosh = slosh + ocean * (0.5 + 0.5 * np.sin(2 * np.pi * (self.rx / 1.4 - T / EMPTY_WAVE_S[0])))
        self.hw = (base + rise + slosh).astype(np.float32)                # the waterline, per rope (m)
        return smooth((self.hw[:, None] - self.z.height) / POOL_BAND_M + 0.5).astype(np.float32)

    def _ripples(self):
        """Brightness added along the ropes by the rings travelling out from where water landed."""
        age = self.time - self.rip_t0
        live = (age >= 0) & (age < RIPPLE_LIFE) & (self.rip_a > 0)
        if not live.any():
            return np.zeros(N_ROPES, np.float32)
        d = np.abs(self.rx[:, None] - self.rip_x[None, live])
        ring = np.exp(-((d - RIPPLE_SPEED * age[None, live]) / 0.05) ** 2)
        fade = (1 - age[live] / RIPPLE_LIFE) ** 2 * self.rip_a[live]
        return np.clip((ring * fade[None, :]).sum(1), 0, 1.2).astype(np.float32)

    # ---- one frame ------------------------------------------------------------------------------------------------

    def step(self, dt, c):
        dt = max(0.0, min(float(dt), 0.25))
        self.time += dt
        T = self.time
        R = N_ROPES
        k = c['knobs']
        turb, spd, dens, bri = (float(k.get(n, 0.5)) for n in ('turbulence', 'speed', 'density', 'brightness'))
        fl = 0.5 if c.get('flow_level') is None else float(c['flow_level'])
        linger = np.asarray(c.get('linger', np.zeros(R)), np.float32)
        if linger.shape != (R,):
            linger = np.zeros(R, np.float32)
        ls = smooth(linger).astype(np.float32)                         # the lingerer's ropes (room.py ramps them)
        crowd = float(np.clip(c.get('crowd') or 0.0, 0.0, 1.0))
        crowd_a = min(1.0, crowd / CROWD_FULL_AT) ** 0.8               # how much turbulence (1 person ~0.3)
        empty = float(np.clip(c.get('empty') or 0.0, 0.0, 1.0))
        turb = min(1.0, turb + CROWD_TURB * crowd)
        # an empty room: slow ocean waves come in, then settle to a still pond (a faint swell at empty = 1)
        ocean_a = float(smooth(empty / 0.35)) * (1 - 0.75 * float(smooth((empty - 0.45) / 0.55)))
        pool_hard = self.z.pool_mask(c.get('pool_height_m'))
        x = self.x
        pal = c['pal']
        if c.get('light') in ('pool', 'eddies', 'leds'):                # calibration check: white, dim, safe
            if c['light'] == 'pool':
                m = pool_hard
            elif c['light'] == 'eddies':
                m = self.z.eddy_mask
            else:
                m = led_mask(c.get('leds'))
            f = np.zeros((R, N_PX, 3), np.float32)
            f[m] = 0.25
            return self._finish(f, dt)

        e = self._env(c)
        b, tau, tau_s, ls_ = e['b'], e['tau'], e['tau_s'], e['ls']
        dry = bool(c.get('dry'))
        settling = tau_s is not None
        rr = (tau_s / ls_) if settling else 0.0
        # M5: a new surge picks how it eases in and out (1 s to 1 min, log-uniform: mostly a few seconds)
        if tau is not None and (self.last_tau is None or tau < self.last_tau):
            lo, hi = math.log(EASE_RANGE[0]), math.log(EASE_RANGE[1])
            win = max(2.0, (c['times']['settle'] - c['times']['surge']) * 0.75) if c.get('times') else 30.0
            self.ease = (min(math.exp(self.rng.uniform(lo, hi)), win), math.exp(self.rng.uniform(lo, hi)))
            self.landed[:] = False
        self.last_tau = tau
        # M3: the pool's soft, moving waterline (a surge fills it, then it drains back)
        surge_fill = 0.0
        if tau is not None:
            surge_fill = float(smooth(tau / 6.0)) * ((1 - float(smooth(rr / 0.8))) if settling else 1.0)
        pool = self._pool_weight(c, fl, max(surge_fill, float(c.get('mini_fill', 0.0))), turb,
                                 rise_r=LINGER_RISE_M * ls, ocean=EMPTY_WAVE_M * ocean_a, still=float(smooth(empty / 0.5)))
        self.pw = pool

        # speeds (px/s): drips in calm/building, the body in the surge, easing back while settling
        nz = 0.5 * (np.sin(2 * np.pi * self.noise_f[:, 0] * T + self.noise_p[:, 0])
                    + np.sin(2 * np.pi * self.noise_f[:, 1] * T + self.noise_p[:, 1]))
        var = min(0.45, 0.3 * (0.4 + 1.2 * turb))
        mul = (1 + var * nz) * (1 - LINGER_SLOW * ls)
        v_drip = (14.0 + 50.0 * b) * (0.7 + 0.6 * fl) * (0.6 + 0.8 * spd)
        v_body = front_vmax(c['flow_pct']) * (0.6 + 0.8 * spd) * (0.85 + 0.3 * fl)
        if tau is not None and not settling:
            v = v_body
        elif settling:
            v = v_body + (v_drip - v_body) * float(smooth((tau_s - ls_ / 3) / (2 * ls_ / 3)))
        else:
            v = v_drip
        self.phase += v * mul * dt
        self.v_now = float(v * mul.mean())
        self.pool_phase += 0.3 * v * dt
        ph = self.phase[:, None].astype(np.float32)

        # ---- calm layer: drips joining into flow, the breathing pool
        act_n = (0.12 if dry else 0.15 + 0.2 * c['energy']) * R
        act_n = act_n + (R - act_n) * (0.0 if dry else b)
        act_n = (act_n + (R - act_n) * 0.6 * crowd_a) * (1 - 0.8 * empty)   # a crowd wakes more ropes; an empty room fewer
        act = np.clip(act_n - self.rank, 0.0, 1.0)[:, None]
        join = b ** 1.5
        d = np.mod(ph - x, self.spacing)
        tail = 10.0 + join * (self.spacing * 0.95 - 10.0)
        drip = np.where(d < tail, np.exp(-3.0 * d / tail), 0.0) + 0.10 * join
        cl = float(c['calm_level'])
        cl = cl + max(0.0, CROWD_CALM - cl) * crowd_a                 # a crowd lifts the calm toward CROWD_CALM
        cl = cl + (EMPTY_POND - cl) * empty                           # an empty room settles toward the still pond
        level = cl + (0.55 - cl) * b
        i_calm = act * drip * level
        # drips landing in the pool send ripples to the neighbouring ropes (M3)
        rate = act[:, 0] * v_drip * mul / self.spacing[:, 0] * dt * 0.6
        for r in np.nonzero(self.rng.random(R) < rate)[0]:
            self.ripple(int(r), 0.35 + 0.3 * b)
        i_calm = i_calm * (1 - pool)
        breathe = (0.12 + 0.05 * math.sin(2 * math.pi * T / 9.0)) * (cl / 0.35)
        breathe = breathe + (EMPTY_POND + 0.02 * math.sin(2 * math.pi * T / 12.0) - breathe) * empty
        pool_tex = 0.8 + 0.2 * (1 - 0.7 * empty) * np.sin(2 * np.pi * (self.pool_phase - x) / 37.0 + self.tex_p[:, :1])
        # soft bubbles rising in the pool: round, slow, never single-LED flicker
        bub = np.sin(2 * np.pi * (self.z.height * 2.5 - 0.35 * T) + self.tex_p[:, :1]) * np.sin(2 * np.pi * (T * 0.21 + self.rx[:, None] * 3.1))
        bubbles = 0.35 * smooth((bub - 0.55) / 0.45)
        near_line = np.exp(-np.maximum(self.hw[:, None] - self.z.height, 0) / 0.35)
        rip = self._ripples()[:, None] * near_line
        wake = float(c.get('wake') or 0.0)
        if wake > self.wake_prev + 0.2:                                # someone came in: the pond notices
            for r in self.rng.choice(R, 4, replace=False):
                self.ripple(int(r), 0.4 + 0.6 * wake)
        self.wake_prev = wake
        i_pool = pool * (breathe * pool_tex * (1 + 0.5 * wake) + 0.25 * (1 - 0.6 * empty) * bubbles + 0.45 * rip)
        sat_calm = 0.55 * (1 - b)
        mid = norm(pal_mod.desaturate(pal['mid'], sat_calm))
        light = norm(pal_mod.desaturate(pal['light'], sat_calm))
        deep = norm(pal['deep'])
        head = np.clip(drip, 0, 1)[..., None]
        calm = (i_calm[..., None] * (mid * (1 - 0.5 * head) + light * 0.5 * head) + i_pool[..., None] * deep)
        if ocean_a > 0.01:                                             # the empty room's slow waves, up from the pool
            calm += self._ocean(ocean_a, pool)[..., None] * norm(pal_mod.desaturate(pal['mid'], 0.3))
        calm *= e['g_calm']
        if e['glow'] > 0:
            calm += (e['glow'] * self.top)[..., None] * light

        frame = calm
        g_surge = 1 - (1 - EMPTY_SURGE) * empty                       # an empty room's surge plays softer
        if tau is not None:
            frame = frame + g_surge * self._surge(c, tau, tau_s, ls_, rr, ph, pool, dt, turb, dens, bri, dry, self.ease,
                                                  self.landed)
        # M4: a smaller surge of its own (random when the room is empty, or brought on by the room), between main ones
        mt = c.get('mini_tau')
        if mt is not None and tau is None:
            if mt < 0.05:
                self.mini_landed[:] = False
            ms = mt - MINI_BODY if mt > MINI_BODY else None
            mrr = (ms / MINI_SETTLE) if ms is not None else 0.0
            frame = frame + g_surge * MINI_GAIN * self._surge(c, mt, ms, MINI_SETTLE, mrr, ph, pool, dt, turb, dens, bri, dry,
                                                    c.get('mini_ease', (2.0, 6.0)), self.mini_landed)

        # ---- the decision wave: one slow wave of light down every rope
        if c.get('wave') is not None:
            w = float(c['wave'])
            amp = 0.4 * float(smooth(w / 0.6)) * float(smooth((8.0 - w) / 0.6))
            y = (w / 8.0) * (self.floor + 20.0)
            band = amp * np.exp(-0.5 * ((x - y) / 18.0) ** 2)
            frame = np.maximum(frame, band[..., None] * norm(pal['light']))

        # ---- the crowd: turbulence at head height and below (rides the surge; dims with the draw-back before it)
        if crowd_a > 0.005:
            cg = e['g_calm'] if tau is None else 1.0
            frame = frame + cg * self._crowd(crowd_a, dt, pool, pal)

        # ---- night, lingerers, the day's level
        gain = (1 - 0.35 * float(c.get('night', 0.0))) * float(c.get('level', 1.0))
        lmax = float(ls.max(initial=0.0))
        g_rope = 1 + LINGER_GAIN * ls - LINGER_DIM * lmax * (1 - ls)
        frame = frame * (gain * g_rope)[:, None, None]
        n_sparks = 0
        if lmax > 0.01 or self.sp_live.any():                          # the lingerer: the light gathers, sparks fly
            glow = LINGER_GLOW * ls[:, None] * self.band * (1 - 0.6 * pool) * (
                0.75 + 0.25 * np.sin(2 * np.pi * (self.z.height * 1.3 - 0.4 * T) + self.tex_p[:, :1]))
            sparks, n_sparks = self._sparks(dt, ls, pal)
            frame = frame + gain * (glow[..., None] * norm(pal['light']) + sparks)
        self.effects = {'lingerer': round(lmax, 3), 'crowd': round(crowd, 3), 'empty': round(empty, 3),
                        'sparks': int(n_sparks)}
        self.state = {'b': b, 'tau': tau, 'tau_s': tau_s, 'effects': dict(self.effects)}
        return self._finish(frame, dt)

    # ---- v2: the people effects -------------------------------------------------------------------------------------

    def _ocean(self, amp, pool):
        """The empty room's slow ocean waves: long crests rolling across the ropes and up from the waterline."""
        T = self.time
        above = np.maximum(self.z.height - self.hw[:, None], 0.0)
        reach = np.exp(-above / 0.9) * (1 - 0.5 * pool)
        u = self.rx[:, None]
        w = (np.sin(2 * np.pi * (u / 1.1 - T / EMPTY_WAVE_S[0]) + 2 * np.pi * above / 2.5)
             + 0.6 * np.sin(2 * np.pi * (-u / 0.8 - T / EMPTY_WAVE_S[1]) + 1.3))
        crest = smooth((w + 0.2) / 1.6)
        return (amp * 0.22 * crest * reach).astype(np.float32)

    def _crowd(self, a, dt, pool, pal):
        """Fantasia-style turbulence at head height and below: swirling eddies, a slosh across the ropes, bursts."""
        T = self.time
        u = self.rx[:, None] * np.ones((1, N_PX), np.float32)
        v = self.z.height
        w1 = np.sin(2 * np.pi * (v / 0.7 + 0.35 * T) + 2.5 * np.sin(2 * np.pi * (u * 0.8 - 0.11 * T)))
        w2 = np.sin(2 * np.pi * (u * 1.3 + 0.17 * T) + 2.0 * np.sin(2 * np.pi * (v / 0.9 - 0.23 * T) + 3 * u))
        crests = smooth((w1 * w2 - 0.2) / 0.5)
        cx = 0.5 + 0.48 * math.sin(2 * math.pi * T / 6.5) + 0.12 * math.sin(2 * math.pi * T / 2.3)
        slosh = np.exp(-((u - cx) / 0.14) ** 2) * (0.5 + 0.5 * np.sin(2 * np.pi * (v / 0.5 - 0.6 * T)))
        # bursts: a bright bloom somewhere below head height, spreading to the neighbouring ropes
        n = self.rng.poisson(BURST_RATE * a * a * dt)
        for _ in range(int(n)):
            i = self.bu_i % BURST_SLOTS
            self.bu_rx[i], self.bu_h[i], self.bu_t0[i] = self.rng.uniform(0, 1), self.rng.uniform(0.4, 1.6), T
            self.bu_i += 1
        bursts = np.zeros_like(v)
        age = T - self.bu_t0
        for i in np.nonzero((age >= 0) & (age < BURST_LIFE))[0]:
            d = np.sqrt(((u - self.bu_rx[i]) / 0.12) ** 2 + ((v - self.bu_h[i]) / 0.35) ** 2)
            bursts += np.exp(-(d - 2.2 * age[i] / BURST_LIFE) ** 2 / 0.3) * (1 - age[i] / BURST_LIFE) ** 2
        m = self.crowd_mask * (1 - 0.5 * pool)
        light, mid, foam = norm(pal['light']), norm(pal['mid']), norm(pal['foam'])
        return m[..., None] * (a * (0.38 * crests)[..., None] * light + a * (0.25 * slosh)[..., None] * mid
                               + (0.7 * np.clip(bursts, 0, 1.2))[..., None] * foam)

    def _sparks(self, dt, ls, pal):
        """The lingerer's sparks: thrown up from the waterline or falling from above on their ropes, pulled down into
        the pool, where they splash (a ripple and a small child spark). Returns (rgb layer, how many are flying)."""
        R = N_ROPES
        h = self.z.height
        under = h <= self.hw[:, None]
        wl = np.where(under.any(1), under.argmax(1), N_PX - 1).astype(np.float32)   # the waterline's LED, per rope
        rng = self.rng
        if ls.max(initial=0.0) > 0.01:                                  # launch
            counts = rng.poisson(SPARK_RATE * ls * dt)
            for r in np.nonzero(counts)[0]:
                for _ in range(int(counts[r])):
                    if rng.random() < SPARK_UP:
                        self._spark(int(r), wl[r], -rng.uniform(*SPARK_V), rng.uniform(*SPARK_LEN_PX), 0)
                    else:
                        hs = rng.uniform(*SPARK_FROM_M)
                        above = h[r] <= hs
                        x0 = float(above.argmax()) if above.any() else 0.0
                        self._spark(int(r), x0, rng.uniform(10.0, 60.0), rng.uniform(*SPARK_LEN_PX), 0)
        live = self.sp_live
        self.sp_v[live] += SPARK_G * dt
        self.sp_x[live] += self.sp_v[live] * dt
        self.sp_age[live] += dt
        landed = live & (self.sp_v > 0) & (self.sp_x >= wl[self.sp_rope])
        for i in np.nonzero(landed)[0]:                                 # a splash where it lands
            r = int(self.sp_rope[i])
            self.sp_live[i] = False
            if self.sp_gen[i] == 0:
                self.ripple(r, 0.5 * float(self.sp_amp[i]))
                if rng.random() < 0.6:
                    self._spark(r, wl[r], -rng.uniform(40.0, 80.0), rng.uniform(5.0, 8.0), 1, 0.7 * float(self.sp_amp[i]))
        self.sp_live &= (self.sp_age < SPARK_LIFE_S) & (self.sp_x > -SPARK_LEN_PX[1])
        idx = np.nonzero(self.sp_live)[0]
        if not len(idx):
            return np.zeros((R, N_PX, 3), np.float32), 0
        xh, vv = self.sp_x[idx, None], self.sp_v[idx, None]
        dirn = np.where(vv >= 0, 1.0, -1.0)
        bd = (xh - self.x) * dirn                                       # px behind the head (the tail trails it)
        lpx = self.sp_len[idx, None] * np.clip(np.abs(vv) / 120.0, 0.5, 1.3)
        prof = np.where(bd >= 0, np.clip(1 - bd / lpx, 0, 1) ** 1.5, np.clip(1 + bd, 0, 1))
        fade = np.clip(1 - self.sp_age[idx] / SPARK_LIFE_S, 0, 1) * np.clip(self.sp_age[idx] / 0.05, 0, 1)
        prof = prof * (self.sp_amp[idx] * fade)[:, None] * self.band[self.sp_rope[idx]]
        light, foam = norm(pal['light']), norm(pal['foam'])
        mix = self.sp_mix[idx, None]
        col = light[None, :] * (1 - mix) + foam[None, :] * mix
        onehot = (self.sp_rope[idx][None, :] == np.arange(R)[:, None]).astype(np.float32)   # R x n: which rope
        out = np.stack([onehot @ (prof * col[:, k:k + 1]) for k in range(3)], axis=-1).astype(np.float32)
        return out, len(idx)

    def _spark(self, rope, x0, v0, length, gen, amp=None):
        free = np.nonzero(~self.sp_live)[0]
        i = int(free[0]) if len(free) else int(np.argmax(self.sp_age))
        self.sp_live[i], self.sp_rope[i], self.sp_x[i], self.sp_v[i] = True, rope, x0, v0
        self.sp_len[i], self.sp_age[i], self.sp_gen[i] = length, 0.0, gen
        self.sp_amp[i] = self.rng.uniform(0.75, 1.0) if amp is None else amp
        self.sp_mix[i] = self.rng.uniform(0.0, 1.0)

    def _surge(self, c, tau, tau_s, ls, rr, ph, pool, dt, turb, dens, bri, dry, ease=(2.0, 8.0), landed=None):
        R = N_ROPES
        x = self.x
        pal = c['pal']
        vmax = front_vmax(c['flow_pct'])
        off = self.front_off * min(1.5, 0.5 + turb)
        tau_r = (tau - off)[:, None]
        s = front_pos(tau_r, self.floor, vmax)
        s = np.where(tau_r > 0, s, -1.0)
        delta = s - x
        behind = np.clip(delta / FRONT_EDGE_PX, 0.0, 1.0)
        white = np.where(delta < FRONT_EDGE_PX, behind,
                         np.where(delta < FRONT_EDGE_PX + FRONT_WHITE_PX, 1.0,
                                  np.clip(1 - (delta - FRONT_EDGE_PX - FRONT_WHITE_PX) / FRONT_TAIL_PX, 0.0, 1.0)))
        white = np.where(delta >= 0, white, 0.0)

        # body: flowing saturated teal-cyan at 70-85 %
        body_level = (0.70 + 0.15 * bri) * (0.85 + 0.15 * c['flow_pct'] / 100.0)
        strands = np.ones((R, 1), np.float32)
        if dry:                                     # a dry day's surge (opening night): smaller, clearly visible
            body_level *= 0.8
        p1 = 0.5 + 0.5 * np.sin(2 * np.pi * (ph - x) / 23.0 + self.tex_p[:, :1])
        p2 = 0.5 + 0.5 * np.sin(2 * np.pi * (ph - x) / 61.0 + self.tex_p[:, 1:])
        tex = 0.72 + 0.28 * p1 * p2
        eddy = self.z.eddy_mask
        if eddy.any():
            # eddies: the flow stalls and briefly reverses (0.5-1 s of every ~3 s), brighter, double foam
            T = self.time
            local = 0.15 * ph + (12.0 + 16.0 * turb) * np.sin(2 * np.pi * T / 3.0)
            te = 0.72 + 0.28 * (0.5 + 0.5 * np.sin(2 * np.pi * (local - x) / 17.0))
            tex = np.where(eddy, te * (1 + 0.25 * (0.5 + turb)), tex)
        swell = 1.0
        sw_t = tau - SWELL_AT * 40.0 - x / (self.floor / 2.5)
        swell = 1 + SWELL_GAIN * np.where((sw_t >= 0) & (sw_t < SWELL_S), 0.5 - 0.5 * np.cos(2 * np.pi * sw_t / SWELL_S), 0.0)
        mid, light = pal['mid'], pal['light']
        drain = 0.0
        if tau_s is not None:
            drain = 0.85 * float(smooth(tau_s / max(1.0, ls / 3.0)))
            body_level *= 1 - 0.3 * rr
        mid_n = norm(pal_mod.desaturate(mid, drain))
        light_n = norm(pal_mod.desaturate(light, drain))
        i_body = body_level * tex * swell * strands
        mixw = np.clip((tex - 0.72) / 0.28, 0, 1)[..., None] * 0.6
        body = i_body[..., None] * (mid_n * (1 - mixw) + light_n * mixw)

        # foam sparkles riding the flow, and bubbles
        foam_d = (0.25 + 0.75 * c['rain']) * (0.5 + dens) * (1 - rr) * (0.4 if dry else 1.0)
        foam = np.zeros((R, N_PX), np.float32)
        T = self.time
        if foam_d > 0:
            age = np.mod(T / self.foam_life + self.foam_t0, 1.0)
            env = np.sin(np.pi * age) * (self.foam_rank < foam_d)
            pos = np.mod(self.foam_x0 + self.phase[:, None] * (1 + self.foam_j), np.maximum(self.floor, 2.0))
            size = np.ones_like(self.foam_size) if c.get('cold') else self.foam_size
            rows = np.repeat(np.arange(R)[:, None], FOAM_SLOTS, 1)
            for k in range(3):
                on = size > k
                idx = np.clip(pos.astype(int) + k, 0, N_PX - 1)
                np.add.at(foam, (rows[on], idx[on]), 0.9 * env[on])
            if self.z.eddy_mask.any():
                sp = self.sparkle[int(T * 6) % 16]
                foam += np.where(eddy & (sp > 1 - 0.12 * min(foam_d, 1.5)), 0.8, 0.0)
            bage = np.mod(T / self.bub_period + self.bub_t0, 1.0) * self.bub_period
            benv = np.where(bage < 1.5, np.sin(np.pi * bage / 1.5), 0.0)
            bpos = np.mod(self.bub_x0 + 0.6 * self.phase[:, None], np.maximum(self.floor, 2.0))
            for j in range(BUBBLE_SLOTS):
                prof = np.clip(1 - np.abs(x - bpos[:, j:j + 1] - self.bub_size[:, j:j + 1] / 2)
                               / (self.bub_size[:, j:j + 1] / 2), 0, 1)
                foam += 0.5 * benv[:, j:j + 1] * prof
        foam = np.clip(foam, 0, 1) * behind
        foam_col = norm(pal['foam'])
        # M5: black dots in the body, moving with the flow, about as dense as the foam: contrast in the torrent
        dots = np.zeros((R, N_PX), np.float32)
        dot_d = (0.3 + 0.7 * c['rain']) * (0.5 + dens) * (1 - rr)
        if dot_d > 0:
            age = np.mod(T / self.dot_life + self.dot_t0, 1.0)
            env = np.sin(np.pi * age) * (self.dot_rank < dot_d)
            pos = np.mod(self.dot_x0 + self.phase[:, None] * (1 + self.dot_j), np.maximum(self.floor, 2.0))
            rows = np.repeat(np.arange(R)[:, None], DOT_SLOTS, 1)
            for k in range(4):
                on = self.dot_size > k
                idx = np.clip(pos.astype(int) + k, 0, N_PX - 1)
                np.add.at(dots, (rows[on], idx[on]), env[on])
            dots = np.clip(dots, 0, 1) * behind

        # the pool: dark until the front lands, then churns white, flowing at 0.3x; fades last
        t_floor = front_time(self.floor, self.floor, vmax)
        if landed is not None:                                          # the front reaching a rope's pool: a big ripple
            now_in = (tau_r[:, 0] >= t_floor[:, 0]) & ~landed
            for r in np.nonzero(now_in)[0]:
                self.ripple(int(r), 1.0)
            landed |= now_in
        pool_on = smooth((tau_r - t_floor) / 1.0)
        build = np.clip((tau_r - t_floor) / 10.0, 0, 1)
        churn = 0.5 + 0.5 * np.sin(2 * np.pi * (self.pool_phase - x) / 29.0 + 3 * np.sin(T * 0.7 + self.tex_p[:, :1]))
        whiteness = (0.35 + 0.45 * build) * churn
        deep_n = norm(pal['deep'])
        i_pool = 0.65 * pool_on * (0.7 + 0.3 * churn)
        if tau_s is not None:
            fade = 1 - smooth((rr - 0.70) / 0.30)
            i_pool = i_pool * fade
            whiteness = whiteness * (1 - rr)
        pool_rgb = i_pool[..., None] * (deep_n * (1 - whiteness[..., None]) + np.ones(3, np.float32) * whiteness[..., None])

        # settling: each rope goes dark from the top, one after another
        keep = behind
        if tau_s is not None:
            d_r = (ls * (0.30 + 0.45 * self.dark_rank / (R - 1)))[:, None]
            y = (tau_s - d_r) * DARK_SPEED
            keep = keep * np.clip((x - y) / 30.0, 0.0, 1.0)
        front_rgb = (white * (1 - (tau_s is not None)))[..., None] * norm(pal_mod.FRONT)
        body = body * (1 - 0.92 * dots[..., None])
        rope = (body * (1 - white[..., None]) + front_rgb + foam[..., None] * foam_col) * keep[..., None]
        # M5: the torrent eases in (and out while settling) over this surge's own duration
        g_in = float(smooth(tau / max(ease[0], 1e-3)))
        g_out = 1.0 if tau_s is None else 1.0 - float(smooth(tau_s / max(ease[1], 1e-3)))
        rope = rope * (g_in * max(g_out, 0.0))
        pw = pool[..., None]
        return rope * (1 - pw) + pool_rgb * pw

    def _finish(self, frame, dt):
        self.base_level = float(np.clip(frame, 0.0, 1.0).max(axis=-1).mean())   # the ropes' own light, before the overlay
        if self.overlay is not None:                                # the particle field (particles.py), before safety
            frame = frame + self.overlay
        out = self.safety.apply(np.clip(frame, 0.0, 1.0), dt)
        self.watts = self.safety.watts
        return out
