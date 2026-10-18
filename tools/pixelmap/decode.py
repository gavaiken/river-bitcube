"""Decode a structured-light capture (tools/pixelmap/capture.py) into a rope pixel map.

    .venv\\Scripts\\python tools\\pixelmap\\decode.py frames\\pixelmap-YYYYMMDD-HHMMSS

Per camera pixel: which rope and which pixel on it lights it, with a confidence. Per (rope, px): the
confidence-weighted median camera position, outliers (reflections, stray decodes) dropped, and hidden
pixels (inside the coils) filled by interpolating along the rope. Ropes with no samples are left out.
Writes tools/pixelmap/pixelmap-<date>.json and <capture>/overlay.png.

UVs are normalised to the camera frame in TouchDesigner's texture convention: u left->right,
v bottom->top (v = 1 - y/H).
"""
import json
import sys
from pathlib import Path

import numpy as np

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pixelmap import graycode  # noqa: E402

N_ROPES, N_PIXELS = 20, 400
R = graycode.ROPE_BITS


# ---- per camera pixel ---------------------------------------------------------------------------

def pattern_bit(rope, px, bit):
    """What a Gray-code pattern shows at (rope, px): True = lit (same rule as gray_frame in TD)."""
    code = graycode.gray(rope) if bit < R else graycode.gray(px)
    k = bit if bit < R else bit - R
    return ((code >> k) & 1).astype(bool)


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


def reject_outliers(uv, window=4, max_dist=0.05):
    """uv: (n_pixels, 2), NaN = unseen. Drop points farther than max_dist from the median of their
    visible neighbours within +-window along the rope. Points with no visible neighbours are kept."""
    out = uv.copy()
    vis = ~np.isnan(uv[:, 0])
    n = len(uv)
    for i in np.nonzero(vis)[0]:
        lo, hi = max(0, i - window), min(n, i + window + 1)
        nb = [j for j in range(lo, hi) if j != i and vis[j]]
        if nb and np.linalg.norm(uv[i] - np.median(uv[nb], axis=0)) > max_dist:
            out[i] = np.nan
    return out


def fill_along_rope(uv):
    """Interpolate unseen pixels linearly between visible neighbours; the ends hold the nearest
    visible point. Returns (filled (n, 2) or None if nothing is visible, visible mask)."""
    vis = ~np.isnan(uv[:, 0])
    if not vis.any():
        return None, vis
    idx = np.arange(len(uv))
    filled = np.stack([np.interp(idx, idx[vis], uv[vis, c]) for c in range(2)], axis=1)
    return filled, vis


def build_map(u, v, window=4, max_dist=0.05, meta=None):
    """Pixel-map dict: meta, per-rope counts, and one point per pixel of every rope that was seen."""
    points, ropes = [], {}
    for r in range(u.shape[0]):
        uv = reject_outliers(np.stack([u[r], v[r]], axis=1), window, max_dist)
        filled, vis = fill_along_rope(uv)
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
        dr.line(pts, fill=PALETTE[r % 10], width=1)
        x, y = pts[len(pts) // 2]
        dr.text((x + 3, y - 6), str(r + 1), fill=(255, 255, 255))
        dr.ellipse((pts[0][0] - 3, pts[0][1] - 3, pts[0][0] + 3, pts[0][1] + 3), outline=(255, 255, 255))
    for name, (cu, cv) in (pmap.get('hub75_quad1') or {}).items():
        if name in ('tl', 'tr', 'br', 'bl'):
            dr.text((cu * w + 3, (1 - cv) * h + 3), name, fill=(255, 255, 0))
    return im


def main(capture, out_json=None):
    from PIL import Image
    capture = Path(capture)
    meta = json.loads((capture / 'meta.json').read_text())
    a, b = load_pass(capture / 'A'), load_pass(capture / 'B')
    rope, px, conf = decode_pair(a, b, weak_lsb=1)
    u, v, count = aggregate(rope, px, conf)
    date = meta.get('date', capture.name.split('-')[1])
    out_json = Path(out_json or Path(__file__).parent / f"pixelmap-{date[:4]}-{date[4:6]}-{date[6:8]}.json")
    old = json.loads(out_json.read_text()) if out_json.exists() else {}
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
