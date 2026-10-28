"""One map from several camera views: the gallery cam pans and tilts during a calibration (tools/cameras/views.json),
and every LED becomes a direction in 3D from the camera, then a point in one virtual camera frame that holds them all.

The cam turns about (nearly) its own centre, so two views of the same LED differ only by a rotation: no depth is
needed, and none can be measured from one place. The rotations come from the LEDs themselves: an LED decoded in two
views is a correspondence. `fit_views` solves the lens (focal length f and one radial distortion term k1, principal
point at the centre) and each view's rotation relative to the home view (the one the camera returns to), by least
squares over every LED seen in two views. No PTZ units or lens specs are needed; the views just have to overlap.

Coordinates. Camera (and "home") coordinates: x right, y down, z forward (the home view's optical axis). A direction
`d` (unit 3-vector, home coordinates) is where an LED is as seen from the camera. A view's rotation R maps home to that
view: d_view = R @ d_home. The virtual frame (`Frame`) is a pinhole camera with the same f, aimed at the middle of all
the LEDs, level with the home view, cropped to the LEDs plus a margin at the camera's aspect: its (u, v) in 0..1 (TD
convention, v up) is what the shows sample, as they sampled the one camera frame before.
"""
import math

import numpy as np


class RegistrationError(ValueError):
    """The views can't be put together (too little overlap): the words say which view and why."""


# ---- rotations ----------------------------------------------------------------------------------

def rot(w):
    """Rotation matrix from a rotation vector (axis * angle, radians)."""
    w = np.asarray(w, float)
    t = float(np.linalg.norm(w))
    if t < 1e-12:
        return np.eye(3)
    k = w / t
    kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(t) * kx + (1 - math.cos(t)) * kx @ kx


def rotvec(r):
    """Rotation vector of a rotation matrix (inverse of rot)."""
    r = np.asarray(r, float)
    c = (np.trace(r) - 1) / 2
    t = math.acos(max(-1.0, min(1.0, c)))
    if t < 1e-9:
        return np.zeros(3)
    v = np.array([r[2, 1] - r[1, 2], r[0, 2] - r[2, 0], r[1, 0] - r[0, 1]])
    if math.sin(t) < 1e-6:                      # ~180 degrees: from the symmetric part
        m = (r + np.eye(3)) / 2
        k = np.sqrt(np.maximum(np.diag(m), 0))
        k *= np.sign(v + 1e-12)
        return k / np.linalg.norm(k) * t
    return v / (2 * math.sin(t)) * t


def nearest_rotation(m):
    u, _, vt = np.linalg.svd(m)
    r = u @ vt
    if np.linalg.det(r) < 0:
        u[:, -1] *= -1
        r = u @ vt
    return r


def angles(r):
    """(pan, tilt, roll) in degrees of a view rotation, for people: pan right +, tilt up +."""
    z = r.T @ np.array([0, 0, 1.0])                  # the view's optical axis in home coordinates
    pan = math.degrees(math.atan2(z[0], z[2]))
    tilt = math.degrees(math.atan2(-z[1], math.hypot(z[0], z[2])))
    x = r.T @ np.array([1.0, 0, 0])
    roll = math.degrees(math.atan2(-x[1], math.hypot(x[0], x[2])))
    return round(pan, 2), round(tilt, 2), round(roll, 2)


# ---- the lens -----------------------------------------------------------------------------------

class Cam:
    """Pinhole with one radial term: pixel = f * n * (1 + k1 |n|^2) + centre, n = (x/z, y/z)."""

    def __init__(self, f, k1, w, h):
        self.f, self.k1, self.w, self.h = float(f), float(k1), int(w), int(h)
        self.c = np.array([w / 2, h / 2])

    def project(self, d):
        """(N, 3) directions in this camera's coordinates -> (N, 2) pixels (NaN behind the camera)."""
        d = np.atleast_2d(np.asarray(d, float))
        z = d[:, 2:3]
        n = np.where(z > 1e-6, d[:, :2] / np.where(z > 1e-6, z, 1), np.nan)
        r2 = (n ** 2).sum(axis=1, keepdims=True)
        if self.k1 < 0:                              # past r^2 = 1/(-3 k1) the model folds back: not in this lens's view
            n = np.where(r2 < 1 / (-3 * self.k1), n, np.nan)
        return self.f * n * (1 + self.k1 * r2) + self.c

    def rays(self, px):
        """(N, 2) pixels -> (N, 3) unit directions in this camera's coordinates."""
        px = np.atleast_2d(np.asarray(px, float))
        nd = (px - self.c) / self.f
        n = nd.copy()
        for _ in range(20):                          # undistort: n (1 + k1 |n|^2) = nd
            n = nd / (1 + self.k1 * (n ** 2).sum(axis=1, keepdims=True))
        d = np.c_[n, np.ones(len(n))]
        return d / np.linalg.norm(d, axis=1, keepdims=True)

    def to_meta(self):
        return {'f_px': round(self.f, 3), 'k1': round(self.k1, 5), 'frame_size': [self.w, self.h]}

    @classmethod
    def from_meta(cls, m):
        return cls(m['f_px'], m.get('k1', 0.0), *m['frame_size'])


# ---- homography (initial guesses) ---------------------------------------------------------------

def _dlt(src, dst):
    a = []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    h = np.linalg.svd(np.array(a, float))[2][-1].reshape(3, 3)
    return h / h[2, 2] if abs(h[2, 2]) > 1e-12 else h


def _apply(h, p):
    q = np.c_[p, np.ones(len(p))] @ h.T
    return q[:, :2] / q[:, 2:]


def ransac_homography(src, dst, iters=400, thresh=6.0, seed=0):
    """Homography dst ~ H src robust to stray decodes; returns (H, inlier mask)."""
    rng = np.random.default_rng(seed)
    n = len(src)
    best = np.zeros(n, bool)
    for _ in range(iters):
        idx = rng.choice(n, 4, replace=False)
        try:
            h = _dlt(src[idx], dst[idx])
            err = np.linalg.norm(_apply(h, src) - dst, axis=1)
        except (np.linalg.LinAlgError, FloatingPointError):
            continue
        inl = err < thresh
        if inl.sum() > best.sum():
            best = inl
    if best.sum() < 8:
        best = np.ones(n, bool)
    return _dlt(src[best], dst[best]), best


def rotation_from_homography(h, w, ht, f=None):
    """Rotation (view j from view i) and focal length from a pure-rotation homography x_j ~ K R K^-1 x_i.
    With f unknown, the f whose K^-1 H K is closest to a rotation (scanned over 40..130 degrees of horizontal view)."""
    def k(f_):
        return np.array([[f_, 0, w / 2], [0, f_, ht / 2], [0, 0, 1]])

    def ortho_err(f_):
        m = np.linalg.inv(k(f_)) @ h @ k(f_)
        m = m / np.cbrt(np.linalg.det(m))
        return float(np.linalg.norm(m.T @ m - np.eye(3))), m

    if f is None:
        cands = [(w / 2) / math.tan(math.radians(a / 2)) for a in np.linspace(40, 130, 181)]
        f = min(cands, key=lambda f_: ortho_err(f_)[0])
    return nearest_rotation(ortho_err(f)[1]), f


# ---- fitting the views --------------------------------------------------------------------------

def _pairs(obs, min_shared):
    names = list(obs)
    out = []
    for a in range(len(names)):
        for b in range(a + 1, len(names)):
            shared = sorted(set(obs[names[a]]) & set(obs[names[b]]))
            if len(shared) >= min_shared:
                out.append((names[a], names[b], shared))
    return out


def fit_views(obs, w, h, home, f0=None, min_shared=30, iters=40):
    """obs: {view: {key: (x, y, weight)}} camera pixels of each LED decoded in each view; home: the reference view.
    Returns (Cam, {view: R}, report). report: per view the LEDs it shares, its pan/tilt/roll from home and the rms
    transfer error in px. A single view needs no fit: R = I, f from f0 (or a 87-degree guess)."""
    views = list(obs)
    if home not in obs:
        raise RegistrationError(f'the home view {home!r} has no decoded lights')
    f_guess = f0 or (w / 2) / math.tan(math.radians(87 / 2))
    rots = {home: np.eye(3)}
    report = {v: {'shared': 0} for v in views}
    if len(views) == 1:
        return Cam(f_guess, 0.0, w, h), rots, report | {home: {'shared': 0, 'pan_tilt_roll': (0.0, 0.0, 0.0), 'rms_px': 0.0}}
    pairs = _pairs(obs, min_shared)
    for a, b, shared in pairs:
        report[a]['shared'] += len(shared)
        report[b]['shared'] += len(shared)

    # initial guesses: grow from home along the best-shared pairs
    f_est = []
    todo = [v for v in views if v != home]
    while todo:
        cand = [(len(s), a, b, s) for a, b, s in pairs if (a in rots) != (b in rots)]
        if not cand:
            v = todo[0]
            n = max([len(set(obs[v]) & set(obs[o])) for o in rots] or [0])
            raise RegistrationError(f'view {v!r} shares only {n} lights with the views already placed (needs '
                                    f'{min_shared}): the views must overlap; tilt less between them')
        _, a, b, s = max(cand, key=lambda c: c[0])
        known, new = (a, b) if a in rots else (b, a)
        src = np.array([obs[known][k][:2] for k in s], float)
        dst = np.array([obs[new][k][:2] for k in s], float)
        hm, _ = ransac_homography(src, dst)
        r_rel, f_i = rotation_from_homography(hm, w, h, f0)
        f_est.append(f_i)
        rots[new] = r_rel @ rots[known]
        todo.remove(new)
    f_start = f0 or float(np.median(f_est))

    # joint least squares: params = [log(f/f_start), k1, rotvec of each non-home view]
    others = [v for v in views if v != home]
    data = []
    for a, b, s in pairs:
        pa = np.array([obs[a][k][:2] for k in s], float)
        pb = np.array([obs[b][k][:2] for k in s], float)
        wt = np.sqrt(np.minimum(np.array([obs[a][k][2] for k in s], float), np.array([obs[b][k][2] for k in s], float)))
        data.append([a, b, pa, pb, np.sqrt(wt)])

    def unpack(p):
        cam = Cam(f_start * math.exp(p[0]), p[1], w, h)
        rs = {home: np.eye(3)} | {v: rot(p[2 + 3 * i: 5 + 3 * i]) for i, v in enumerate(others)}
        return cam, rs

    def errors(p):
        """Per pair: transfer error a->b and b->a in px, (n, 2) each."""
        cam, rs = unpack(p)
        out = []
        for a, b, pa, pb, _ in data:
            rab = rs[b] @ rs[a].T
            fwd = cam.project(cam.rays(pa) @ rab.T) - pb
            bwd = cam.project(cam.rays(pb) @ rab) - pa
            out.append((fwd, bwd))
        return out

    def residuals(p, keep):
        res = []
        for (fwd, bwd), (_, _, _, _, sw), k in zip(errors(p), data, keep):
            res.append(np.nan_to_num((fwd * sw[:, None])[k].ravel(), nan=1e3))
            res.append(np.nan_to_num((bwd * sw[:, None])[k].ravel(), nan=1e3))
        res.append([p[0] * 5.0, p[1] * 20.0])              # weak priors: f near the guess, little distortion
        return np.concatenate(res)

    p = np.r_[0.0, 0.0, np.concatenate([rotvec(rots[v]) for v in others])]
    keep = [np.ones(len(d[2]), bool) for d in data]
    for round_ in range(3):
        p = _lm(lambda q: residuals(q, keep), p, iters)
        errs = errors(p)
        e_all = np.concatenate([np.r_[np.linalg.norm(f, axis=1), np.linalg.norm(b, axis=1)] for f, b in errs])
        cut = max(4.0, 4 * float(np.nanmedian(e_all)))
        keep = [(np.nan_to_num(np.linalg.norm(f, axis=1), nan=1e9) < cut) & (np.nan_to_num(np.linalg.norm(b, axis=1), nan=1e9) < cut)
                for f, b in errs]
    cam, rs = unpack(p)
    errs = errors(p)
    for v in views:
        e = [np.linalg.norm(x, axis=1)[k] for (f, b), d, k in zip(errs, data, keep) if v in d[:2] for x in (f, b)]
        e = np.concatenate(e) if e else np.zeros(0)
        report[v] |= {'pan_tilt_roll': angles(rs[v]), 'rms_px': round(float(np.sqrt(np.mean(e ** 2))), 2) if len(e) else None,
                      'used': int(sum(k.sum() for d, k in zip(data, keep) if v in d[:2]))}
    return cam, rs, report


def _lm(fun, p, iters, eps=1e-6):
    """Levenberg-Marquardt with a forward-difference Jacobian (a dozen parameters, so this is cheap)."""
    r = fun(p)
    cost = r @ r
    lam = 1e-3
    for _ in range(iters):
        j = np.empty((len(r), len(p)))
        for i in range(len(p)):
            q = p.copy()
            q[i] += eps
            j[:, i] = (fun(q) - r) / eps
        g = j.T @ r
        a = j.T @ j
        improved = False
        for _ in range(10):
            step = np.linalg.solve(a + lam * np.diag(np.diag(a) + 1e-9), -g)
            q = p + step
            rq = fun(q)
            cq = rq @ rq
            if cq < cost:
                p, r, cost, lam = q, rq, cq, lam / 3
                improved = True
                break
            lam *= 4
        if not improved or np.linalg.norm(step) < 1e-10:
            break
    return p


# ---- the virtual frame --------------------------------------------------------------------------

class Frame:
    """A pinhole view (focal f px, no distortion) with basis rows (right, down, forward) in home coordinates, cropped to
    [x0, x0 + fw] x [y0, y0 + fh] px. uv in 0..1 with v up (TD), as the one-camera maps were."""

    def __init__(self, basis, f, x0, y0, fw, fh):
        self.b, self.f = np.asarray(basis, float), float(f)
        self.x0, self.y0, self.fw, self.fh = float(x0), float(y0), float(fw), float(fh)

    def xy(self, d):
        """Home directions (N, 3) -> virtual px (N, 2), relative to the frame's axis (not yet cropped)."""
        q = np.atleast_2d(d) @ self.b.T
        return self.f * q[:, :2] / q[:, 2:]

    def dirs(self, xy):
        q = np.c_[np.atleast_2d(xy) / self.f, np.ones(len(np.atleast_2d(xy)))] @ self.b
        return q / np.linalg.norm(q, axis=1, keepdims=True)

    def uv(self, d):
        p = self.xy(d)
        return np.c_[(p[:, 0] - self.x0) / self.fw, 1 - (p[:, 1] - self.y0) / self.fh]

    def uv_to_dirs(self, uv):
        uv = np.atleast_2d(uv)
        return self.dirs(np.c_[uv[:, 0] * self.fw + self.x0, (1 - uv[:, 1]) * self.fh + self.y0])

    def to_meta(self):
        return {'kind': 'virtual pinhole: every view rotated into one frame aimed at the middle of the lights',
                'basis': np.round(self.b, 6).tolist(), 'f_px': round(self.f, 3),
                'crop_px': [round(self.x0, 2), round(self.y0, 2), round(self.fw, 2), round(self.fh, 2)]}

    @classmethod
    def from_meta(cls, m):
        return cls(m['basis'], m['f_px'], *m['crop_px'])


def make_frame(dirs, f, aspect, margin=0.04, max_half_angle=75):
    """The frame for these directions (N, 3): axis through their middle, level with the home view (right stays the
    home view's right), cropped to them plus `margin` of the size on each side, widened to `aspect` (w / h)."""
    d = np.asarray(dirs, float)
    lo, hi = d.min(axis=0), d.max(axis=0)
    z = (lo + hi) / 2
    z = z / np.linalg.norm(z)
    if np.degrees(np.arccos(np.clip(d @ z, -1, 1))).max() > max_half_angle:
        raise RegistrationError('the lights span too wide an angle for one flat frame')
    x = np.array([1.0, 0, 0]) - z[0] * z
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    fr = Frame(np.stack([x, y, z]), f, 0, 0, 1, 1)
    p = fr.xy(d)
    (x0, y0), (x1, y1) = p.min(axis=0), p.max(axis=0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    fw, fh = (x1 - x0) * (1 + 2 * margin), (y1 - y0) * (1 + 2 * margin)
    fw, fh = max(fw, fh * aspect, 1.0), max(fh, fw / aspect, 1.0)
    fw, fh = max(fw, fh * aspect), max(fh, fw / aspect)
    return Frame(fr.b, f, cx - fw / 2, cy - fh / 2, fw, fh)


# ---- a map's geometry, back from its meta -------------------------------------------------------

class Space:
    """The views, lens and frame a multi-view pixel map was made in (its meta['space']), to place more things in it
    (hub75.py, screens.py) or to draw it back into a view."""

    def __init__(self, cam, rots, frame, views=None):
        self.cam, self.rots, self.frame, self.views = cam, rots, frame, views or {}

    def view_px_to_uv(self, view, px):
        return self.frame.uv(self.cam.rays(px) @ self.rots[view])

    def uv_to_view_px(self, view, uv):
        return self.cam.project(self.frame.uv_to_dirs(uv) @ self.rots[view].T)

    def to_meta(self):
        return {'camera': self.cam.to_meta(), 'frame': self.frame.to_meta(),
                'views': [self.views.get(v, {}) | {'name': v, 'rotvec': np.round(rotvec(r), 6).tolist()} for v, r in self.rots.items()]}

    @classmethod
    def from_meta(cls, m):
        rots = {v['name']: rot(v['rotvec']) for v in m['views']}
        return cls(Cam.from_meta(m['camera']), rots, Frame.from_meta(m['frame']), {v['name']: v for v in m['views']})
