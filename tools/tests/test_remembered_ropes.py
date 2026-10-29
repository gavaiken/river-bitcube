"""The remembered river on the ropes (td/remembered/ropes.py): the surge front's timing, the safety rules (ramps, no
whole-column flashing, power under artnet_out's cap), the pool, calm, the lingerer reflex, the calibration light modes."""
import importlib.util
import pathlib
import sys

import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'td'))
from remembered import clock  # noqa: E402
from remembered import palette  # noqa: E402
from remembered import room  # noqa: E402
from remembered import ropes  # noqa: E402
from remembered import zones  # noqa: E402

FPS = 60


def artnet():
    spec = importlib.util.spec_from_file_location('artnet_out_under_test', ROOT / 'td' / 'ropes' / 'artnet_out.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def wet_day(flow_pct=95, rain_mm=60.0):
    prof = {'flow': [100 + 10 * h for h in range(24)], 'rain': [0.0] * 10 + [3, 5, 8, 9, 4] + [0.0] * 9,
            'is_day': [1] * 24}
    return clock.make_day('2017-01-08', prof, {'flow_pct': flow_pct, 'rain_mm': rain_mm, 'heaviest_hour': 13,
                                               'dry': False, 'season': 'winter'})


def ctx_at(day, t, times, **kw):
    return ropes.default_ctx(t=t, times=times, phase=clock.phase_at(t, times), energy=clock.day_energy(day, t / 12.5),
                             pal=palette.palette('winter'), flow_pct=day['stats']['flow_pct'],
                             rain=min(1.0, day['stats']['rain_mm'] / 40), day=day, **kw)


@pytest.fixture(scope='module')
def loop():
    """One full loop at 60 fps with a big surge at 160 s (default zones): frames every 1/60 s are summarised."""
    z = zones.Zones()
    day = wet_day()
    times = clock.phase_times(day, 160.0)
    r = ropes.Ropes(z, seed=5)
    knobs = {'speed': 0.5, 'density': 0.9, 'brightness': 1.0, 'turbulence': 0.6}
    means, watts, keep = [], [], {}
    want = {'calm': 40.0, 'drawback_end': times['surge'] - 0.5, 'surge_body': times['surge'] + 15.0,
            'pool_last': times['calm'] - 3.0, 'settle_mid': times['settle'] + (times['calm'] - times['settle']) * 0.85}
    floor_hit = None
    for i in range(int(300 * FPS)):
        t = i / FPS
        f = r.step(1 / FPS, ctx_at(day, t, times, knobs=knobs))
        means.append(float(f.mean()))
        watts.append(r.watts)
        for k, at in want.items():
            if k not in keep and t >= at:
                keep[k] = f.copy()
                keep[k + '_pw'] = r.pw.copy()                    # where the (moving, soft) pool was then
        if t >= times['surge'] and floor_hit is None:
            floor_hit = np.full(20, np.nan)
        if floor_hit is not None and t < times['surge'] + 8:
            lit = f[np.arange(20), z.floor_px - 3].max(axis=1) > 0.3
            floor_hit[np.isnan(floor_hit) & lit] = t - times['surge']
    return {'z': z, 'times': times, 'means': np.array(means), 'watts': np.array(watts), 'keep': keep, 'r': r,
            'floor_hit': floor_hit, 'day': day}


def test_watts_model_matches_artnet_out():
    a = artnet()
    assert ropes.WATTS_PER_CHANNEL == a.WATTS_PER_CHANNEL
    assert ropes.BUDGET_W < a.TOTAL_WATTS


def test_front_kinematics_reach_the_floor_in_about_3_5_s():
    vmax = ropes.front_vmax(95)
    assert 1.5 * 40 <= ropes.front_vmax(0) and ropes.front_vmax(100) <= 3.0 * 40        # 1.5-3 m/s
    t = float(ropes.front_time(320, 320, vmax))
    assert 3.0 <= t <= 4.0
    assert float(ropes.front_pos(t, 320, vmax)) == pytest.approx(320, abs=0.5)
    # starts at 0.4 x top speed, reaches top speed by mid-height
    eps = 1e-3
    assert float(ropes.front_pos(eps, 320, vmax)) / eps == pytest.approx(0.4 * vmax, rel=0.02)
    tm = float(ropes.front_time(160, 320, vmax))
    v_mid = (float(ropes.front_pos(tm + eps, 320, vmax)) - float(ropes.front_pos(tm, 320, vmax))) / eps
    assert v_mid == pytest.approx(vmax, rel=0.02)


def test_rendered_front_lands_on_every_floor_within_0_6_s_offsets(loop):
    hit = loop['floor_hit']
    assert not np.isnan(hit).any()
    assert 3.0 <= hit.min() and hit.max() <= 4.0 + 0.6 * 1.1 + 0.1      # ~3.5 s plus the 0-600 ms (x turbulence) offset
    assert hit.max() - hit.min() > 0.1                                  # the ropes are staggered


def test_every_brightness_change_ramps(loop):
    m = loop['means']
    step = np.abs(np.diff(m))
    assert step.max() <= ropes.MAX_MEAN_RATE / FPS + 1e-6               # 0 -> full mean takes >= 2 s (>= 0.5 s rule)
    # the column's mean over any 0.5 s never jumps by more than a quarter of full scale
    k = FPS // 2
    assert np.abs(m[k:] - m[:-k]).max() <= 0.25


def test_no_whole_column_flashing(loop):
    m = loop['means']
    # peaks of the column's mean with >= 0.02 rise and fall: never more than 3 in any second
    peaks = []
    for i in range(1, len(m) - 1):
        if m[i] >= m[i - 1] and m[i] > m[i + 1]:
            lo = max(0, i - FPS // 2)
            hi = min(len(m), i + FPS // 2)
            if m[i] - m[lo:i].min() >= 0.02 and m[i] - m[i:hi].min() >= 0.02:
                peaks.append(i)
    peaks = np.array(peaks)
    for p in peaks:
        assert ((peaks >= p) & (peaks < p + FPS)).sum() <= 3


def test_power_stays_under_the_cap_at_full_surge(loop):
    a = artnet()
    assert loop['watts'].max() <= ropes.BUDGET_W + 1
    f = loop['keep']['surge_body']
    config = {'boxes': [{'ip': '2.0.0.10', 'ropes': 10, 'first_universe': 0}, {'ip': '2.0.0.11', 'ropes': 10, 'first_universe': 40}],
              'universes_per_rope': 4, 'pixels_per_universe': 170, 'pixels_per_rope': 400}
    data, watts = a.to_bytes(f.copy(), config, 1.0, a.BOX_WATTS, a.TOTAL_WATTS)
    assert sum(watts) <= a.TOTAL_WATTS
    assert np.array_equal(data, (np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8))   # artnet_out never had to scale it
    assert sum(watts) > 600                                                        # and it is a real surge


def test_calm_is_dim_sparse_and_desaturated(loop):
    f = loop['keep']['calm']
    pool = loop['z'].pool_mask() | (loop['keep']['calm_pw'] > 0.05)   # the pool rises and sloshes (M3)
    assert f.max() <= 0.42
    lit = (f.max(axis=2) > 0.05) & ~pool
    ropes_lit = int((lit.sum(axis=1) > 0).sum())
    assert 2 <= ropes_lit <= 10                                  # about a quarter of the ropes carry drips
    rgb = f[lit]
    sat = (rgb.max(axis=1) - rgb.min(axis=1)) / np.maximum(rgb.max(axis=1), 1e-6)
    assert np.median(sat) < 0.6


def test_pool_dark_before_churns_during_fades_last(loop):
    pool = loop['z'].pool_mask()
    k = loop['keep']
    assert k['drawback_end'][pool].mean() < 0.02                 # goes dark just before the surge
    body = k['surge_body']
    assert body[pool].mean() > 0.2                               # churns during
    whiteness = body[pool].min(axis=1).mean() / body[pool].max(axis=1).mean()
    assert whiteness > 0.3                                       # white in it, not just blue
    last = k['pool_last']
    assert last[pool].mean() > last[~pool].mean()                # the ropes went dark first; the pool fades last
    mid = k['settle_mid']
    assert (mid[~pool].reshape(-1, 3).max(axis=1) > 0.3).mean() < (body[~pool].reshape(-1, 3).max(axis=1) > 0.3).mean()


def test_deterministic_for_a_seed():
    z = zones.Zones()
    day = wet_day()
    times = clock.phase_times(day, 100.0)
    a, b = ropes.Ropes(z, seed=9), ropes.Ropes(z, seed=9)
    for i in range(0, 120 * FPS, 7):
        c = ctx_at(day, i / FPS, times)
        fa, fb = a.step(7 / FPS, c), b.step(7 / FPS, c)
    assert np.array_equal(fa, fb)


def test_lingerers_gather_the_light():
    z = zones.Zones()
    day = wet_day()
    times = clock.phase_times(day, 100.0)
    linger = z.neighbours([7])
    plain, held = ropes.Ropes(z, seed=2), ropes.Ropes(z, seed=2)
    acc_p, acc_h = np.zeros(20), np.zeros(20)
    for i in range(int(130 * 30)):
        t = i / 30
        fp = plain.step(1 / 30, ctx_at(day, t, times))
        fh = held.step(1 / 30, ctx_at(day, t, times, linger=linger))
        if t > 104:
            acc_p += fp.mean(axis=(1, 2))
            acc_h += fh.mean(axis=(1, 2))
    gain = acc_h / acc_p
    assert gain[7] > 1.3                                          # brighter on their rope ...
    assert np.median(np.delete(gain, 7)) < gain[7] - 0.3          # ... compared with the rest: visible, not subtle
    assert held.phase[7] - plain.phase[7] < 0                     # and slower there


def test_calibration_light_modes_light_only_those_leds():
    z = zones.Zones({'eddies': [{'rope': 4, 'from': 250, 'to': 266}]})
    r = ropes.Ropes(z)
    for _ in range(300):                                          # the ramp takes it up over a few seconds
        f = r.step(1 / 30, ropes.default_ctx(light='pool'))
    pool = z.pool_mask()
    assert np.allclose(f[pool], 0.25, atol=0.01) and f[~pool].max() == 0
    r2 = ropes.Ropes(z)
    for _ in range(300):
        f = r2.step(1 / 30, ropes.default_ctx(light='eddies'))
    assert (f.max(axis=2) > 0).sum() == 17 and f[4, 250:267].min() > 0.2
    r3 = ropes.Ropes(z)
    for _ in range(300):
        f = r3.step(1 / 30, ropes.default_ctx(light='leds', leds=[{'rope': 2, 'from': 10, 'to': 12}]))
    assert (f.max(axis=2) > 0).sum() == 3


def test_zones_file_shape_as_built(tmp_path):
    heights = [round(max(0.0, (300 - i) / 40), 2) for i in range(400)]
    data = {'pool_height_m': 0.53, 'ropes': [{'rope': r, 'heights': heights} for r in range(20)],
            'feet': [{'rope': 0, 'x': 0.31, 'y': 0.93}], 'eddies': [{'rope': 4, 'from': 250, 'to': 266, 'log': 'big'}],
            'screens': [{'screen': 2, 'height_m': 3.1, 'tilt_deg': -4.5}]}
    p = tmp_path / 'zones-2026-10-28.json'
    import json
    p.write_text(json.dumps(data))
    z = zones.load(str(p))
    assert z.file == p.name and z.pool_height_m == 0.53 and int(z.floor_px[0]) == 298
    assert z.pool_mask().sum() == 20 * (400 - 279)
    assert z.screens[1]['tilt_deg'] == -4.5 and z.screen_order()[0] == 1
    assert z.eddy_mask[4, 250] and z.eddy_mask.sum() == 17
    assert zones.load(None).file == 'default'


# ---- v2: people visibly change the ropes (room.py -> ctx crowd, empty, linger, wake) ----------------------------------

def people_run(seconds, count=0, lingerers=(), seed=4, z=None, times=None, day=None, warm=0.0, fps=30, keep_every=None):
    """Step Ropes with a RoomState fed a constant room; returns (ropes, room, frames after warm, means)."""
    z = z or zones.Zones()
    r, rs = ropes.Ropes(z, seed=seed), room.RoomState(z)
    frames, means = [], []
    for i in range(int(seconds * fps)):
        t = i / fps
        rs.update(1 / fps, count, lingerers, True)
        c = ctx_at(day, t, times, **rs.ctx()) if day is not None else ropes.default_ctx(t=t, **rs.ctx())
        f = r.step(1 / fps, c)
        means.append(float(f.mean()))
        if t >= warm and (keep_every is None or i % keep_every == 0):
            frames.append(f)
    return r, rs, frames, np.array(means)


def test_a_lingerer_sparks_gathers_the_light_and_raises_the_pool():
    z = zones.Zones()
    ling = [{'ropes': [7], 'still_s': 10, 'x': 0.37, 'y': 0.85}]
    plain, _, fp, _ = people_run(20, 1, (), warm=5)
    held, rs, fh, _ = people_run(20, 1, ling, warm=5)
    mine = np.nonzero(rs.linger > 0.3)[0]
    assert 2 <= len(mine) <= 4 and 7 in mine
    band = (z.height >= 0.5) & (z.height <= 1.8)
    bp = np.mean([f.max(axis=2)[band.nonzero()].reshape(20, -1).mean(1) for f in fp], axis=0)
    bh = np.mean([f.max(axis=2)[band.nonzero()].reshape(20, -1).mean(1) for f in fh], axis=0)
    assert (bh[mine] / bp[mine]).min() > 2.0                         # obvious from across the room
    others = np.setdiff1d(np.arange(20), mine)
    assert np.median(bh[others] / bp[others]) < 1.0                    # the rest a little dimmer
    assert held.hw[7] - plain.hw[7] > 0.3                              # the waterline rises there
    assert held.state['effects']['lingerer'] == pytest.approx(1.0) and held.state['effects']['sparks'] >= 5
    # sparks: short bright streaks moving both up and down the rope, on their ropes only
    assert (held.sp_v[held.sp_live] < 0).any() and (held.sp_v[held.sp_live] > 0).any()
    assert set(held.sp_rope[held.sp_live].tolist()) <= set(mine.tolist())
    assert max(f[7].max() for f in fh) > 0.8


def test_a_lingerer_builds_over_seconds_not_a_jump():
    ling = [{'ropes': [7]}]
    z = zones.Zones()
    r, rs = ropes.Ropes(z, seed=1), room.RoomState(z)
    m7 = []
    for i in range(int(12 * 30)):
        rs.update(1 / 30, 1, ling if i >= 4 * 30 else (), True)
        f = r.step(1 / 30, ropes.default_ctx(t=i / 30, **rs.ctx()))
        m7.append(float(f[7].mean()))
    m7 = np.array(m7)
    before, half, full = m7[3 * 30:4 * 30].mean(), m7[int(5.2 * 30):int(5.6 * 30)].mean(), m7[9 * 30:].mean()
    assert before < half < full and full > 2 * before


def test_a_crowd_stirs_head_height_and_below():
    z = zones.Zones()
    _, _, f0, m0 = people_run(30, 0, warm=10, keep_every=3)
    r, rs, f6, m6 = people_run(90, 6, warm=70, keep_every=3)
    assert rs.crowd == pytest.approx(1.0)
    low = (z.height <= ropes.CROWD_TOP_M) & (z.height > z.pool_height_m + 0.5)
    high = z.height >= ropes.CROWD_TOP_M + 0.8
    lo0, lo6 = np.mean([f.max(axis=2)[low].mean() for f in f0]), np.mean([f.max(axis=2)[low].mean() for f in f6])
    hi0, hi6 = np.mean([f.max(axis=2)[high].mean() for f in f0]), np.mean([f.max(axis=2)[high].mean() for f in f6])
    assert lo6 > lo0 + 0.08                                            # turbulence below head height ...
    assert hi6 - hi0 < 0.5 * (lo6 - lo0)                               # ... far more than above it
    # it moves: the low region changes frame to frame (swirls, sloshing, bursts), never a static wash
    d = np.mean([np.abs(a[low] - b[low]).mean() for a, b in zip(f6[:-1], f6[1:])])
    assert d > 0.01
    assert r.state['effects']['crowd'] == pytest.approx(1.0)
    assert np.abs(np.diff(m6)).max() <= ropes.MAX_MEAN_RATE / 30 + 1e-6
    assert r.watts <= ropes.BUDGET_W + 1


def test_one_person_is_a_hint():
    z = zones.Zones()
    low = (z.height <= ropes.CROWD_TOP_M) & (z.height > z.pool_height_m + 0.5)
    _, _, f0, _ = people_run(90, 0, warm=70, keep_every=3)
    _, _, f1, _ = people_run(90, 1, warm=70, keep_every=3)
    _, _, f6, _ = people_run(90, 6, warm=70, keep_every=3)
    lo = [np.mean([f.max(axis=2)[low].mean() for f in fs]) for fs in (f0, f1, f6)]
    assert lo[0] < lo[1] < lo[2] and (lo[1] - lo[0]) < 0.5 * (lo[2] - lo[0])


def test_an_empty_room_settles_to_a_still_pond_and_its_surge_plays_softer():
    z = zones.Zones()
    _, _, fb, _ = people_run(30, 2, warm=20, keep_every=3)
    r, rs, fe, _ = people_run(90, 0, warm=80, keep_every=3)
    assert rs.empty == pytest.approx(1.0) and r.state['effects']['empty'] == pytest.approx(1.0)
    above = z.height > z.pool_height_m + 0.8
    assert np.mean([f[above].mean() for f in fe]) < 0.5 * np.mean([f[above].mean() for f in fb])   # drips fade out
    pool = z.pool_mask()
    pm = np.array([f[pool].max(axis=1).mean() for f in fe])
    assert 0.06 < pm.mean() < 0.2 and pm.std() < 0.03                  # a still pond breathing low
    # mid-way the ocean waves roll: the waterline swings slowly
    r2, z2 = ropes.Ropes(z, seed=4), room.RoomState(z)
    hws = []
    for i in range(int(50 * 30)):
        z2.update(1 / 30, 0, (), True)
        r2.step(1 / 30, ropes.default_ctx(t=i / 30, **z2.ctx()))
        if 0.3 < z2.empty < 0.6:
            hws.append(r2.hw.copy())
    hws = np.array(hws)
    assert np.ptp(hws, axis=0).mean() > 0.06
    # the main surge still plays, at ~60 %
    day = wet_day()
    times = clock.phase_times(day, 100.0)
    knobs = {'speed': 0.5, 'density': 0.5, 'brightness': 0.5, 'turbulence': 0.5}
    out = {}
    for name, extra in (('busy', {}), ('empty', {'empty': 1.0})):
        rr = ropes.Ropes(z, seed=6)
        acc = []
        for i in range(int(times['settle'] * 30)):
            t = i / 30
            f = rr.step(1 / 30, ctx_at(day, t, times, knobs=knobs, **extra))
            if times['surge'] + 10 <= t < times['surge'] + 20:
                acc.append(f[~pool].mean())
        out[name] = np.mean(acc)
    assert 0.45 < out['empty'] / out['busy'] < 0.75
