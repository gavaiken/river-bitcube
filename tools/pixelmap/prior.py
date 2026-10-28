"""Check a new calibration against what we already know, and repair it from that knowledge (Gavin, 27 Oct night: "the
camera moved a couple of feet to the left but all the lights stayed in the same place ... influence that calibration
with the knowledge you already have").

The lights didn't move, so the previous map is a strong prior. In 3D, not in the picture: the camera moved sideways, so
things at different depths shift differently (parallax). From the previous map (each LED's direction from the camera)
and its zones file (each rope's distance and each LED's height above the floor, the camera's height and which way is
down) every LED gets a place in the room. Then:
  1. the camera's new pose (rotation and position) is fitted to the LEDs the new calibration decoded, robustly;
  2. every LED's place is projected into the new map's frame: where it should be;
  3. a decoded LED that agrees (within --tol degrees) stays as decoded; one that disagrees, and every LED the new
     calibration didn't see, takes the predicted place (smoothed along its rope by the decoded neighbours' offsets);
  4. a rope whose decodes fit a neighbouring rope's prediction better is reported (a swapped or misread rope);
  5. the screens' corners are predicted the same way (from their old corners and distances) and compared with a new
     screens file if one is given; a screen off by more than --screen-tol px takes the prediction.
Prints the fitted move (it should match how the camera was moved) and what was repaired; writes the repaired map (and
screens) with meta.prior saying so.

    python tools/pixelmap/prior.py --old-map M_old --old-zones Z_old --new-map M_new [--new-screens S_new]
           --old-screens S_old --out-map M_out [--out-screens S_out] [--tol 0.8] [--screen-tol 12]
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sphere  # noqa: E402

N_ROPES, N_PX = 20, 400


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def arrays(m):
    d = np.full((N_ROPES, N_PX, 3), np.nan)
    vis = np.zeros((N_ROPES, N_PX), bool)
    for p in m['points']:
        r, i = p['rope'], p['px']
        if p.get('d') is not None:
            d[r, i] = p['d']
        vis[r, i] = bool(p.get('visible'))
    return d, vis


def places(old_map, old_zones):
    """Every LED's place in the room (old camera coordinates, metres): along its direction, at its rope's horizontal
    distance, or on the floor for the coils."""
    d, vis = arrays(old_map)
    z = old_zones
    down = np.asarray(z['meta']['down'], float)
    down /= np.linalg.norm(down)
    cam_h = float(z['meta']['cam_height_m'])
    P = np.full((N_ROPES, N_PX, 3), np.nan)
    for r in z['ropes']:
        k = r['rope']
        hs = np.array([np.nan if v is None else v for v in r['heights']], float)
        dk = d[k]
        dd = dk @ down                                        # cos of the angle below the camera's level
        horiz = np.linalg.norm(dk - dd[:, None] * down, axis=1)
        s_rope = r['distance_m'] / np.maximum(horiz, 1e-6)
        s_floor = np.where(dd > 0.05, cam_h / np.maximum(dd, 1e-6), np.nan)
        on_floor = np.isfinite(hs) & (hs <= 0.05) & np.isfinite(s_floor)
        s = np.where(on_floor, s_floor, s_rope)
        P[k] = dk * s[:, None]
    return P, vis


def project(params, P):
    R = sphere.rot(params[:3])
    q = (P - params[3:]) @ R.T
    return q / np.linalg.norm(q, axis=1, keepdims=True)


def angle_deg(a, b):
    return np.degrees(np.arccos(np.clip(np.sum(a * b, axis=1), -1, 1)))


def fit_pose(P, dnew, iters=6):
    """Rotation vector + position (6 numbers) taking the old camera to the new one, by Gauss-Newton on the angle
    between predicted and decoded directions, trimming the worst 15 % each round (stray decodes)."""
    p = np.zeros(6)
    keep = np.ones(len(P), bool)
    for it in range(iters):
        for _ in range(8):
            f0 = (project(p, P[keep]) - dnew[keep]).ravel()
            J = np.empty((f0.size, 6))
            for j in range(6):
                dp = np.zeros(6)
                dp[j] = 1e-5
                J[:, j] = ((project(p + dp, P[keep]) - dnew[keep]).ravel() - f0) / 1e-5
            step = np.linalg.lstsq(J, -f0, rcond=None)[0]
            p = p + step
            if np.abs(step).max() < 1e-7:
                break
        err = angle_deg(project(p, P), dnew)
        keep = err <= np.quantile(err, 0.85) if it < iters - 1 else err <= np.quantile(err, 0.9)
    return p, angle_deg(project(p, P), dnew)


def smooth_offsets(pred, dec, good, window=15):
    """Along one rope: the decoded-minus-predicted offset, as the median of good neighbours (index +-window)."""
    off = np.zeros_like(pred)
    idx = np.nonzero(good)[0]
    if not len(idx):
        return off
    for i in range(len(pred)):
        near = idx[np.abs(idx - i) <= window]
        if len(near):
            off[i] = np.median(dec[near] - pred[near], axis=0)
    return off


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--old-map', required=True)
    ap.add_argument('--old-zones', required=True)
    ap.add_argument('--old-screens')
    ap.add_argument('--new-map', required=True)
    ap.add_argument('--new-screens')
    ap.add_argument('--out-map', required=True)
    ap.add_argument('--out-screens')
    ap.add_argument('--tol', type=float, default=0.8, help='degrees a decoded LED may differ from its prediction')
    ap.add_argument('--screen-tol', type=float, default=12.0, help='px a screen corner may differ from its prediction')
    a = ap.parse_args(argv)
    old_map, old_zones, new_map = load(a.old_map), load(a.old_zones), load(a.new_map)
    P, vis_old = places(old_map, old_zones)
    dnew, vis_new = arrays(new_map)
    both = vis_new & np.isfinite(P).all(-1) & np.isfinite(dnew).all(-1)
    p, err = fit_pose(P[both], dnew[both])
    R = sphere.rot(p[:3])
    down = np.asarray(old_zones['meta']['down'], float)
    t = p[3:]
    # the move in the room's terms: sideways (camera right), forward, up
    right = np.array([1.0, 0, 0]) - down * down[0]
    right /= np.linalg.norm(right)
    fwd = np.cross(right, down)
    print(f"camera move: {t @ right:+.2f} m right, {t @ fwd:+.2f} m forward, {-(t @ down):+.2f} m up; "
          f"turned {math.degrees(np.linalg.norm(p[:3])):.1f} deg")
    print(f"fit on {both.sum()} LEDs decoded in both: median {np.median(err):.2f} deg, 90 % within {np.quantile(err, 0.9):.2f} deg")

    space = sphere.Space.from_meta(new_map['meta']['space'])
    W, H = new_map['meta']['frame_size']
    pred = np.full_like(dnew, np.nan)
    ok = np.isfinite(P).all(-1)
    pred[ok] = project(p, P[ok])
    out_pts, report, kept, repaired = [], {}, 0, 0
    for r in range(N_ROPES):
        e = np.full(N_PX, np.inf)
        fin = np.isfinite(dnew[r]).all(-1) & np.isfinite(pred[r]).all(-1)
        e[fin] = angle_deg(pred[r][fin], dnew[r][fin])
        good = vis_new[r] & (e <= a.tol)
        # is this rope's decode a neighbour's? (swapped or misread rope)
        if good.sum() < vis_new[r].sum() * 0.5 and vis_new[r].sum() > 30:
            for nb in (r - 1, r + 1):
                if 0 <= nb < N_ROPES:
                    f2 = np.isfinite(pred[nb]).all(-1) & vis_new[r]
                    if f2.sum() and np.median(angle_deg(pred[nb][f2], dnew[r][f2])) < a.tol:
                        print(f"  rope {r + 1}: its decodes match rope {nb + 1}'s place: check rope order / wiring")
        uv_pred = space.frame.uv(np.where(np.isfinite(pred[r]), pred[r], [0, 0, 1]))
        uv_dec = space.frame.uv(np.where(np.isfinite(dnew[r]), dnew[r], [0, 0, 1]))
        off = smooth_offsets(uv_pred, uv_dec, good)
        final = np.where(good[:, None], uv_dec, uv_pred + off)
        dirs = space.frame.uv_to_dirs(final)
        home = space.uv_to_view_px('home', final)
        n_rep = int((~good & np.isfinite(pred[r]).all(-1)).sum())
        report[str(r)] = {'decoded': int(vis_new[r].sum()), 'agree': int(good.sum()), 'from_prior': n_rep,
                          'median_err_deg': None if not np.isfinite(e[vis_new[r]]).any() else round(float(np.median(e[vis_new[r] & np.isfinite(e)])), 2)}
        kept += int(good.sum())
        repaired += n_rep
        for i in range(N_PX):
            hu, hv = home[i, 0] / W, 1 - home[i, 1] / H
            out_pts.append({'rope': r, 'px': i, 'u': round(float(final[i, 0]), 5), 'v': round(float(final[i, 1]), 5),
                            'visible': bool(good[i]), 'prior': bool(not good[i]),
                            'd': [round(float(x), 5) for x in dirs[i]],
                            'hu': round(float(hu), 5), 'hv': round(float(hv), 5)})
        print(f"  rope {r + 1:2d}: decoded {vis_new[r].sum():3d}, agree {good.sum():3d}, from the prior {n_rep:3d}")
    out = dict(new_map)
    out['points'] = out_pts
    out['meta'] = dict(new_map['meta'])
    out['meta']['prior'] = {'from': [Path(a.old_map).name, Path(a.old_zones).name], 'tol_deg': a.tol,
                            'camera_move_m': [round(float(t @ right), 3), round(float(t @ fwd), 3), round(float(-(t @ down)), 3)],
                            'fit_median_deg': round(float(np.median(err)), 3), 'kept_decoded': kept, 'from_prior': repaired,
                            'ropes': report,
                            'note': 'decodes that disagree with the previous map moved to the new camera pose were replaced by that prediction'}
    Path(a.out_map).write_text(json.dumps(out), encoding='utf-8')
    print(f"kept {kept} decoded LEDs, {repaired} from the prior -> {a.out_map}")

    if a.old_screens and a.out_screens:
        so = load(a.old_screens)
        sn = load(a.new_screens) if a.new_screens else None
        zsc = {s['screen']: s for s in old_zones.get('screens', [])}
        old_space = sphere.Space.from_meta(old_map['meta']['space'])
        new_sc = {'meta': dict((sn or so)['meta']), 'screens': {}}
        new_sc['meta']['map'] = Path(a.out_map).name
        for k, e in so['screens'].items():
            dist = zsc.get(int(k), {}).get('distance_m', 4.6)
            corners = {}
            for c in ('tl', 'tr', 'br', 'bl'):
                d0 = old_space.frame.uv_to_dirs(np.array([e[c]]))[0]
                horiz = np.linalg.norm(d0 - (d0 @ down) * down)
                Pc = d0 * dist / max(horiz, 1e-6)
                corners[c] = space.frame.uv(project(p, Pc[None]))[0]
            det = (sn or {}).get('screens', {}).get(k) if sn else None
            use = 'prior'
            if det and all(c in det for c in corners):
                diff = max(np.hypot((det[c][0] - corners[c][0]) * W, (det[c][1] - corners[c][1]) * H) for c in corners)
                use = 'detected' if diff <= a.screen_tol else 'prior'
                print(f"  screen {k}: detected vs predicted {diff:.1f} px -> {use}")
            else:
                print(f"  screen {k}: not detected -> prior")
            src = det if use == 'detected' else {c: [round(float(v), 5) for v in corners[c]] for c in corners}
            new_sc['screens'][k] = dict(e, **{c: src[c] for c in corners}, **{'from': use})
            new_sc['screens'][k].pop('home', None)
        Path(a.out_screens).write_text(json.dumps(new_sc, indent=1), encoding='utf-8')
        print(f"screens -> {a.out_screens}")


if __name__ == '__main__':
    main()
