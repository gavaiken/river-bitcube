"""Decode a structured-light capture (tools/pixelmap/capture.py) into a rope pixel map.

    .venv\\Scripts\\python tools\\pixelmap\\decode.py frames\\pixelmap-YYYYMMDD-HHMMSS

Per camera pixel: which rope and which pixel on it lights it, with a confidence. Per (rope, px): the
confidence-weighted median camera position, outliers (reflections, stray decodes) dropped, and hidden
pixels (inside the coils) filled by interpolating along the rope. Ropes with no samples are left out.
Writes tools/pixelmap/pixelmap-<date>.json and <capture>/overlay.png.

UVs are normalised to the camera frame in TouchDesigner's texture convention: u left->right,
v bottom->top (v = 1 - y/H).

Several views (a multi-view calibration: capture.py --session, one capture per camera view): give any one of the
session's captures and the others are found next to it. Each view is decoded as above; the views are put together
from the LEDs two of them both see (tools/pixelmap/sphere.py: the lens and each view's rotation); every LED gets a
direction from the camera (`d`, home-view coordinates: x right, y down, z forward) and (u, v) in one virtual frame
that holds all the lights (meta.space says how). `hu`, `hv`: where it is in the home view's own frame (the show
position; outside 0..1 when that view doesn't see it). Writes overlay.png into every view's capture and
panorama.png (all views stitched, the map drawn on it) into the home view's.
"""
import json
import sys
from pathlib import Path

import numpy as np

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pixelmap import graycode, sphere  # noqa: E402

N_ROPES, N_PIXELS = 20, 400
R = graycode.ROPE_BITS


# ---- per camera pixel ---------------------------------------------------------------------------

pattern_bit = graycode.pattern_bit


def lit_level(frames):
    """Stand-in for an all-white frame: each bit/inverse pair lights every pixel exactly once, so
    max(pos, neg) is the pixel's lit brightness. Median over pairs ignores a few bad patterns."""
    n = graycode.ROPE_BITS + graycode.PIXEL_BITS
    return np.median(np.stack([np.maximum(frames[graycode.pattern_name(b, False)],
                                          frames[graycode.pattern_name(b, True)]) for b in range(n)]), axis=0)


def decode(frames, min_contrast=25.0, min_conf=0.25, weak_lsb=0, n_ropes=N_ROPES, n_pixels=N_PIXELS):
    """frames: {pattern name: float (H, W) brightness}. Returns rope, px (int, -1 = not decoded) and conf.
    A bit's confidence is |pos - neg| / (lit - black), lit from lit_level(). All rope bits and all pixel
    bits except the lowest `weak_lsb` must reach min_conf; weak bits are still used but lower the confidence."""
    scale = lit_level(frames) - frames['black']
    lit = scale > min_contrast
    scale = np.maximum(scale, 1e-3)
    code = [np.zeros(scale.shape, np.int64), np.zeros(scale.shape, np.int64)]
    req = np.ones(scale.shape, np.float32)
    weak = np.ones(scale.shape, np.float32)
    for bit in range(R + graycode.PIXEL_BITS):
        pos = frames[graycode.pattern_name(bit, False)]
        neg = frames[graycode.pattern_name(bit, True)]
        c = np.minimum(np.abs(pos - neg) / scale, 1.0)
        rope_bit = bit < R
        k = bit if rope_bit else bit - R
        code[0 if rope_bit else 1] |= (pos > neg).astype(np.int64) << k
        if not rope_bit and k < weak_lsb:
            weak = np.minimum(weak, c)
        else:
            req = np.minimum(req, c)
    rope = graycode.ungray(code[0])
    px = graycode.ungray(code[1])
    ok = lit & (req >= min_conf) & (rope < n_ropes) & (px < n_pixels)
    conf = np.where(ok, req * (0.25 + 0.75 * weak), 0.0)
    return np.where(ok, rope, -1), np.where(ok, px, -1), conf


def decode_pair(a, b, max_px_diff=2, **kw):
    """Decode two passes of the same patterns. Keep a camera pixel only where pass A, pass B and their
    average agree (rope equal, px within max_px_diff): drops people walking through either pass."""
    ra, pa, _ = decode(a, **kw)
    rb, pb, _ = decode(b, **kw)
    rope, px, conf = decode({k: (a[k] + b[k]) / 2 for k in a}, **kw)
    ok = (rope >= 0) & (ra == rope) & (rb == rope) & (np.abs(pa - px) <= max_px_diff) & (np.abs(pb - px) <= max_px_diff)
    return np.where(ok, rope, -1), np.where(ok, px, -1), np.where(ok, conf, 0.0)


# ---- per rope pixel -----------------------------------------------------------------------------

def _weighted_median(values, weights):
    order = np.argsort(values, kind='stable')
    v, w = values[order], weights[order]
    if w.sum() <= 0:
        w = np.ones_like(w)
    cum = np.cumsum(w)
    return v[np.searchsorted(cum, cum[-1] / 2)]


def aggregate(rope, px, conf, n_ropes=N_ROPES, n_pixels=N_PIXELS, min_count=3):
    """Per (rope, px): confidence-weighted median camera position as (u, v), NaN where fewer than
    min_count camera pixels decoded to it. Returns u, v, count, each (n_ropes, n_pixels)."""
    h, w = rope.shape
    ys, xs = np.nonzero(rope >= 0)
    keys = rope[ys, xs] * n_pixels + px[ys, xs]
    wts = conf[ys, xs]
    order = np.argsort(keys, kind='stable')
    keys, ys, xs, wts = keys[order], ys[order], xs[order], wts[order]
    u = np.full((n_ropes, n_pixels), np.nan)
    v = np.full((n_ropes, n_pixels), np.nan)
    count = np.zeros((n_ropes, n_pixels), int)
    uniq, starts, counts = np.unique(keys, return_index=True, return_counts=True)
    for key, s, n in zip(uniq, starts, counts):
        r, p = divmod(int(key), n_pixels)
        count[r, p] = n
        if n >= min_count:
            sl = slice(s, s + n)
            u[r, p] = (_weighted_median(xs[sl], wts[sl]) + 0.5) / w
            v[r, p] = 1 - (_weighted_median(ys[sl], wts[sl]) + 0.5) / h
    return u, v, count


def reject_outliers(uv, window=4, max_dist=0.05, max_jump=0.08, min_segment=8):
    """uv: (n_pixels, 2), NaN = unseen. Two passes:
    1. drop points with no visible neighbour within +-window along the rope that is also within
       max_dist in the image (stray decodes);
    2. split the remaining points into segments wherever consecutive visible points are more than
       max_jump apart, and drop segments shorter than min_segment (islands such as a reflection or the
       camera's status light). If no segment is that long, only the longest is kept."""
    out = uv.copy()
    vis = ~np.isnan(uv[:, 0])
    n = len(uv)
    for i in np.nonzero(vis)[0]:
        lo, hi = max(0, i - window), min(n, i + window + 1)
        nb = [j for j in range(lo, hi) if j != i and vis[j]]
        if not nb or np.linalg.norm(uv[nb] - uv[i], axis=1).min() > max_dist:
            out[i] = np.nan
    idx = np.nonzero(~np.isnan(out[:, 0]))[0]
    if len(idx) == 0:
        return out
    breaks = np.nonzero(np.linalg.norm(np.diff(out[idx], axis=0), axis=1) > max_jump)[0] + 1
    segments = np.split(idx, breaks)
    longest = max(len(s) for s in segments)
    for s in segments:
        if len(s) < min(min_segment, longest):
            out[s] = np.nan
    return out


def fill_along_rope(uv, max_step=None):
    """Interpolate unseen pixels linearly between visible neighbours; the ends hold the nearest
    visible point. Where the two visible points around a hidden stretch are more than max_step apart
    (the rope runs hidden from one pile to another), don't draw a chord across the floor: each half of
    the stretch holds its nearer visible point. Returns (filled (n, 2) or None, visible mask)."""
    vis = ~np.isnan(uv[:, 0])
    if not vis.any():
        return None, vis
    idx = np.arange(len(uv))
    filled = np.stack([np.interp(idx, idx[vis], uv[vis, c]) for c in range(2)], axis=1)
    if max_step is not None:
        seen = idx[vis]
        for i, j in zip(seen[:-1], seen[1:]):
            if j - i > 1 and np.linalg.norm(uv[j] - uv[i]) > max_step:
                mid = (i + j) / 2
                filled[i + 1:j] = np.where((idx[i + 1:j] <= mid)[:, None], uv[i], uv[j])
    return filled, vis


def build_map(u, v, window=4, max_dist=0.05, max_jump=0.08, min_segment=8, max_step=0.05, meta=None):
    """Pixel-map dict: meta, per-rope counts, and one point per pixel of every rope that was seen."""
    points, ropes = [], {}
    for r in range(u.shape[0]):
        uv = reject_outliers(np.stack([u[r], v[r]], axis=1), window, max_dist, max_jump, min_segment)
        filled, vis = fill_along_rope(uv, max_step)
        if filled is None:
            continue
        ropes[str(r)] = {'visible': int(vis.sum()), 'filled': int((~vis).sum())}
        for p in range(u.shape[1]):
            points.append({'rope': r, 'px': p, 'u': round(float(filled[p, 0]), 5),
                           'v': round(float(filled[p, 1]), 5), 'visible': bool(vis[p])})
    return {'meta': meta or {}, 'ropes': ropes, 'points': points}


# ---- files --------------------------------------------------------------------------------------

PALETTE = [(255, 80, 80), (80, 255, 80), (80, 160, 255), (255, 220, 60), (255, 80, 255),
           (80, 255, 255), (255, 160, 60), (200, 200, 255), (160, 255, 160), (255, 255, 255)]


def load_pass(folder):
    from PIL import Image
    return {p['name']: np.asarray(Image.open(folder / f"{p['name']}.png").convert('RGB'), np.float32).max(axis=2)
            for p in graycode.patterns()}


def overlay(base_rgb, rope, px, pmap):
    """Decoded camera pixels tinted by rope (brighter towards px 399), each rope's mapped path drawn
    as a line, and the rope number (1-based, as in the rope map) at its middle."""
    from PIL import Image, ImageDraw
    arr = (base_rgb.astype(np.float32) * 0.35)
    for r in range(N_ROPES):
        m = rope == r
        if m.any():
            shade = (0.35 + 0.65 * px[m] / N_PIXELS)[:, None]
            arr[m] = np.array(PALETTE[r % 10], np.float32) * shade
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    dr = ImageDraw.Draw(im)
    h, w = rope.shape
    by_rope = {}
    for p in pmap['points']:
        by_rope.setdefault(p['rope'], []).append((p['u'] * w, (1 - p['v']) * h))
    for r, pts in by_rope.items():
        for a, b in zip(pts[:-1], pts[1:]):           # no line across a jump between piles
            if np.hypot(a[0] - b[0], a[1] - b[1]) < 0.05 * w:
                dr.line([a, b], fill=PALETTE[r % 10], width=1)
        x, y = pts[len(pts) // 2]
        dr.text((x + 3, y - 6), str(r + 1), fill=(255, 255, 255))
        dr.ellipse((pts[0][0] - 3, pts[0][1] - 3, pts[0][0] + 3, pts[0][1] + 3), outline=(255, 255, 255))
    quad = pmap.get('hub75_quad1') or {}
    for name in ('tl', 'tr', 'br', 'bl'):
        if name in quad:
            cu, cv = quad[name]
            dr.text((cu * w + 3, (1 - cv) * h + 3), name, fill=(255, 255, 0))
    return im


def latest_pixelmap(folder=Path(__file__).parent):
    """The newest tools/pixelmap/pixelmap-YYYY-MM-DD.json (the latest calibration; a show builds from the map its registry entry pins), or None."""
    maps = sorted(Path(folder).glob('pixelmap-????-??-??.json'))
    return maps[-1] if maps else None


def session_captures(capture, mode='ropes'):
    """All captures of capture's multi-view session, home view first (by view_index); [capture] when it has none."""
    capture = Path(capture)
    meta = json.loads((capture / 'meta.json').read_text())
    if not meta.get('session'):
        return [capture]
    found = []
    for m in capture.parent.glob('*/meta.json'):
        try:
            other = json.loads(m.read_text())
        except ValueError:
            continue
        if other.get('session') == meta['session'] and other.get('mode') == meta.get('mode', mode):
            found.append((other.get('view_index', 0), m.parent))
    return [c for _, c in sorted(found)] or [capture]


def _write_map(out_json, pmap):
    out_json.write_text(json.dumps(pmap, indent=0).replace('\n', ' ').replace('} {', '},\n{') + '\n')


def _report(pmap, count):
    for r in range(N_ROPES):
        s = pmap['ropes'].get(str(r))
        print(f"rope {r + 1:2d}: " + (f"visible {s['visible']:3d}  filled {s['filled']:3d}" if s else 'not seen'))


def main_views(captures, out_json=None):
    """Decode a multi-view session (see the file header)."""
    from PIL import Image
    metas = [json.loads((c / 'meta.json').read_text()) for c in captures]
    names = [m.get('view') or f'view{i}' for i, m in enumerate(metas)]
    home = names[0]
    per = {}
    for c, m, name in zip(captures, metas, names):
        rope, px, conf = decode_pair(load_pass(c / 'A'), load_pass(c / 'B'), weak_lsb=1)
        u, v, count = aggregate(rope, px, conf)
        h, w = rope.shape
        obs = {(r, p): (float(u[r, p] * w), float((1 - v[r, p]) * h), int(count[r, p]))
               for r, p in zip(*np.nonzero(~np.isnan(u)))}
        per[name] = {'capture': c, 'meta': m, 'rope': rope, 'px': px, 'obs': obs}
        print(f"view {name}: decoded camera px {(rope >= 0).sum()}, LEDs with a position {len(obs)}, "
              f"camera at {m.get('ptz')}", flush=True)
    cam, rots, rep = sphere.fit_views({n: per[n]['obs'] for n in names}, w, h, home)
    for n in names[1:]:
        r = rep[n]
        print(f"view {n}: {r['shared']} LEDs shared with the others, pan/tilt/roll from home {r['pan_tilt_roll']} deg, "
              f"stitch error {r['rms_px']} px", flush=True)
    print(f'lens: f {cam.f:.1f} px, k1 {cam.k1:.4f}', flush=True)

    # one direction per LED: the weighted mean of every view's ray (home coordinates)
    acc = {}
    for n in names:
        keys = list(per[n]['obs'])
        if not keys:
            continue
        xy = np.array([per[n]['obs'][k][:2] for k in keys])
        wt = np.array([per[n]['obs'][k][2] for k in keys], float)
        for k, d, wk in zip(keys, cam.rays(xy) @ rots[n], wt):
            a = acc.setdefault(k, [np.zeros(3), 0.0])
            a[0] += d * wk
            a[1] += wk
    keys = list(acc)
    dirs = np.array([acc[k][0] / np.linalg.norm(acc[k][0]) for k in keys])
    pre = sphere.make_frame(dirs, cam.f, w / h)
    U = np.full((N_ROPES, N_PIXELS), np.nan)
    V = np.full((N_ROPES, N_PIXELS), np.nan)
    xy = pre.xy(dirs)
    for (r, p), (x, y) in zip(keys, xy):
        U[r, p], V[r, p] = x / w, -y / h              # camera-sized units, so build_map's distances mean what they did
    date = metas[0].get('date', captures[0].name.split('-')[1])
    out_json = Path(out_json or Path(__file__).parent / f"pixelmap-{date[:4]}-{date[4:6]}-{date[6:8]}.json")
    pmap = build_map(U, V)
    pd = pre.dirs(np.array([[p['u'] * w, -p['v'] * h] for p in pmap['points']]))
    frame = sphere.make_frame(pd, cam.f, w / h)
    uv = frame.uv(pd)
    hpx = cam.project(pd)
    for p, d, (u_, v_), (hx, hy) in zip(pmap['points'], pd, uv, hpx):
        p['u'], p['v'] = round(float(u_), 5), round(float(v_), 5)
        p['d'] = [round(float(c), 5) for c in d]
        ok = np.isfinite(hx) and d[2] > 0.05
        p['hu'] = round(float(hx / w), 5) if ok else None
        p['hv'] = round(float(1 - hy / h), 5) if ok else None
    space = sphere.Space(cam, rots, frame, {n: {'capture': per[n]['capture'].name, 'ptz': per[n]['meta'].get('ptz'),
                                               'drift': per[n]['meta'].get('drift')} | rep[n] for n in names})
    pmap['meta'] = {
        'capture': captures[0].name, 'captures': [c.name for c in captures], 'session': metas[0].get('session'),
        'camera': metas[0].get('camera'), 'frame_size': [w, h], 'drift': max((m.get('drift') or 0) for m in metas),
        'uv': 'normalised virtual frame holding every view (meta.space.frame), TD convention: u left->right, v bottom->top',
        'd': 'direction from the camera, home view coordinates: x right, y down, z forward (the show position\'s axis)',
        'hu_hv': 'where the LED is in the home view (the show position), TD convention; null behind it, outside 0..1 out of view',
        'rope': '0-based (rope 1 in the rope map = 0)', 'px': '0 = plug end (Art-Net pixel 0)',
        'decoded_camera_px': int(sum((per[n]['rope'] >= 0).sum() for n in names)), 'space': space.to_meta()}
    _write_map(out_json, pmap)
    for n in names:
        c = per[n]['capture']
        vpx = space.uv_to_view_px(n, uv)
        pts = [dict(p, u=float(x / w), v=float(1 - y / h)) for p, (x, y) in zip(pmap['points'], vpx)
               if np.isfinite(x) and -0.05 * w < x < 1.05 * w and -0.05 * h < y < 1.05 * h]
        base = np.maximum(*(np.asarray(Image.open(c / 'A' / f'b00{s_}.png').convert('RGB')) for s_ in 'pn'))
        overlay(base, per[n]['rope'], per[n]['px'], {'points': pts}).save(c / 'overlay.png')
    panorama(space, per, names, pmap, w, h).save(captures[0] / 'panorama.png')
    print(f"decoded camera px: {pmap['meta']['decoded_camera_px']}  LEDs placed: {len(keys)}")
    _report(pmap, None)
    print(f'wrote {out_json} and {captures[0] / "panorama.png"}')


def panorama(space, per, names, pmap, w, h, width=1440):
    """Every view's lit frame rotated into the virtual frame (home on top where they overlap), the map drawn on it."""
    from PIL import Image, ImageDraw
    fr = space.frame
    ph = int(round(width * fr.fh / fr.fw))
    gu, gv = np.meshgrid((np.arange(width) + 0.5) / width, 1 - (np.arange(ph) + 0.5) / ph)
    uv = np.c_[gu.ravel(), gv.ravel()]
    out = np.zeros((ph * width, 3), np.uint8)
    for n in reversed(names):
        c = per[n]['capture']
        img = np.maximum(*(np.asarray(Image.open(c / 'A' / f'b00{s_}.png').convert('RGB')) for s_ in 'pn'))
        px = space.uv_to_view_px(n, uv)
        ok = np.isfinite(px).all(axis=1) & (px[:, 0] >= 0) & (px[:, 0] < w) & (px[:, 1] >= 0) & (px[:, 1] < h)
        xi, yi = px[ok, 0].astype(int), px[ok, 1].astype(int)
        out[ok] = img[yi, xi]
    im = Image.fromarray(out.reshape(ph, width, 3))
    dr = ImageDraw.Draw(im)
    for p in pmap['points']:
        x, y = p['u'] * width, (1 - p['v']) * ph
        col = PALETTE[p['rope'] % 10] if p['visible'] else (90, 90, 90)
        dr.point((x, y), fill=col)
    return im


def main(capture, out_json=None):
    from PIL import Image
    capture = Path(capture)
    captures = session_captures(capture)
    if len(captures) > 1:
        return main_views(captures, out_json)
    meta = json.loads((capture / 'meta.json').read_text())
    a, b = load_pass(capture / 'A'), load_pass(capture / 'B')
    rope, px, conf = decode_pair(a, b, weak_lsb=1)
    u, v, count = aggregate(rope, px, conf)
    date = meta.get('date', capture.name.split('-')[1])
    out_json = Path(out_json or Path(__file__).parent / f"pixelmap-{date[:4]}-{date[4:6]}-{date[6:8]}.json")
    prev = out_json if out_json.exists() else latest_pixelmap()
    old = json.loads(prev.read_text()) if prev else {}
    if (old.get('meta') or {}).get('space'):
        old.pop('hub75_quad1', None)                  # a multi-view map's quad is in its own frame, not this camera's
    if 'hub75_quad1' in old and prev != out_json:
        print(f'hub75_quad1 carried over from {prev.name}: re-run hub75.py if the panel or camera moved')
    h, w = rope.shape
    pmap = build_map(u, v, meta={
        'capture': capture.name, 'camera': meta.get('camera'), 'frame_size': [w, h], 'drift': meta.get('drift'),
        'uv': 'normalised camera frame, TD convention: u left->right, v bottom->top',
        'rope': '0-based (rope 1 in the rope map = 0)', 'px': '0 = plug end (Art-Net pixel 0)',
        'decoded_camera_px': int((rope >= 0).sum())})
    if 'hub75_quad1' in old:
        pmap['hub75_quad1'] = old['hub75_quad1']
    out_json.write_text(json.dumps(pmap, indent=0).replace('\n', ' ').replace('} {', '},\n{') + '\n')
    base = np.maximum(*(np.asarray(Image.open(capture / 'A' / f'b00{s}.png').convert('RGB')) for s in 'pn'))
    overlay(base, rope, px, pmap).save(capture / 'overlay.png')
    print(f"decoded camera px: {(rope >= 0).sum()}  rope px with a position: {int((count >= 3).sum())}")
    for r in range(N_ROPES):
        s = pmap['ropes'].get(str(r))
        print(f"rope {r + 1:2d}: " + (f"visible {s['visible']:3d}  filled {s['filled']:3d}" if s else 'not seen'))
    print(f'wrote {out_json} and {capture / "overlay.png"}')


if __name__ == '__main__':
    main(*sys.argv[1:])
