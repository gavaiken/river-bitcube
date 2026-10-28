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
           'wave': None, 'light': 'off', 'pool_height_m': None}
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
        pool = self.z.pool_mask(c.get('pool_height_m'))
        x = self.x
        pal = c['pal']
        if c.get('light') in ('pool', 'eddies', 'leds'):                # calibration check: white, dim, safe
            if c['light'] == 'pool':
                m = pool
            elif c['light'] == 'eddies':
                m = self.z.eddy_mask
            else:
                m = led_mask(c.get('leds'))
            f = np.zeros((R, N_PX, 3), np.float32)
            f[m] = 0.25
            return self._finish(f, dt)

        e = self._env(c)
        b, tau, tau_s, ls = e['b'], e['tau'], e['tau_s'], e['ls']
        dry = bool(c.get('dry'))
        settling = tau_s is not None
        rr = (tau_s / ls) if settling else 0.0

        # speeds (px/s): drips in calm/building, the body in the surge, easing back while settling
        nz = 0.5 * (np.sin(2 * np.pi * self.noise_f[:, 0] * T + self.noise_p[:, 0])
                    + np.sin(2 * np.pi * self.noise_f[:, 1] * T + self.noise_p[:, 1]))
        var = min(0.45, 0.3 * (0.4 + 1.2 * turb))
        mul = (1 + var * nz) * (1 - 0.6 * linger)
        v_drip = (14.0 + 50.0 * b) * (0.7 + 0.6 * fl) * (0.6 + 0.8 * spd)
        v_body = front_vmax(c['flow_pct']) * (0.6 + 0.8 * spd) * (0.85 + 0.3 * fl)
        if tau is not None and not settling:
            v = v_body
        elif settling:
            v = v_body + (v_drip - v_body) * float(smooth((tau_s - ls / 3) / (2 * ls / 3)))
        else:
            v = v_drip
        self.phase += v * mul * dt
        self.v_now = float(v * mul.mean())
        self.pool_phase += 0.3 * v * dt
        ph = self.phase[:, None].astype(np.float32)

        # ---- calm layer: drips joining into flow, the breathing pool
        act_n = (0.12 if dry else 0.15 + 0.2 * c['energy']) * R
        act_n = act_n + (R - act_n) * (0.0 if dry else b)
        act = np.clip(act_n - self.rank, 0.0, 1.0)[:, None]
        join = b ** 1.5
        d = np.mod(ph - x, self.spacing)
        tail = 10.0 + join * (self.spacing * 0.95 - 10.0)
        drip = np.where(d < tail, np.exp(-3.0 * d / tail), 0.0) + 0.10 * join
        level = c['calm_level'] + (0.55 - c['calm_level']) * b
        i_calm = act * drip * level
        i_calm = np.where(pool, 0.0, i_calm)
        breathe = (0.12 + 0.05 * math.sin(2 * math.pi * T / 9.0)) * (c['calm_level'] / 0.35)
        pool_tex = 0.8 + 0.2 * np.sin(2 * np.pi * (self.pool_phase - x) / 37.0 + self.tex_p[:, :1])
        i_pool = np.where(pool, breathe * pool_tex, 0.0)
        sat_calm = 0.55 * (1 - b)
        mid = norm(pal_mod.desaturate(pal['mid'], sat_calm))
        light = norm(pal_mod.desaturate(pal['light'], sat_calm))
        deep = norm(pal['deep'])
        head = np.clip(drip, 0, 1)[..., None]
        calm = (i_calm[..., None] * (mid * (1 - 0.5 * head) + light * 0.5 * head) + i_pool[..., None] * deep)
        calm *= e['g_calm']
        if e['glow'] > 0:
            calm += (e['glow'] * self.top)[..., None] * light

        frame = calm
        if tau is not None:
            frame = frame + self._surge(c, tau, tau_s, ls, rr, ph, pool, dt, turb, dens, bri, dry)

        # ---- the decision wave: one slow wave of light down every rope
        if c.get('wave') is not None:
            w = float(c['wave'])
            amp = 0.4 * float(smooth(w / 0.6)) * float(smooth((8.0 - w) / 0.6))
            y = (w / 8.0) * (self.floor + 20.0)
            band = amp * np.exp(-0.5 * ((x - y) / 18.0) ** 2)
            frame = np.maximum(frame, band[..., None] * norm(pal['light']))

        # ---- night, lingerers, the day's level
        gain = (1 - 0.35 * float(c.get('night', 0.0))) * float(c.get('level', 1.0))
        g_rope = 1 + 0.8 * linger - 0.3 * float(linger.max(initial=0.0)) * (1 - linger)
        frame = frame * (gain * g_rope)[:, None, None]
        self.state = {'b': b, 'tau': tau, 'tau_s': tau_s}
        return self._finish(frame, dt)

    def _surge(self, c, tau, tau_s, ls, rr, ph, pool, dt, turb, dens, bri, dry):
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

        # the pool: dark until the front lands, then churns white, flowing at 0.3x; fades last
        t_floor = front_time(self.floor, self.floor, vmax)
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
        rope = (body * (1 - white[..., None]) + front_rgb + foam[..., None] * foam_col) * keep[..., None]
        rope = np.where(pool[..., None], 0.0, rope)
        return rope + np.where(pool[..., None], pool_rgb, 0.0)

    def _finish(self, frame, dt):
        self.base_level = float(np.clip(frame, 0.0, 1.0).max(axis=-1).mean())   # the ropes' own light, before the overlay
        if self.overlay is not None:                                # the particle field (particles.py), before safety
            frame = frame + self.overlay
        out = self.safety.apply(np.clip(frame, 0.0, 1.0), dt)
        self.watts = self.safety.watts
        return out
