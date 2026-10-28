"""The remembered river's colours: Dave's palette when present, shaded by the day's season, always cool, saturated;
night greyer and darker; cold/snow whiter. Plain Python (no TouchDesigner, no numpy).

A palette is four RGB tuples (0..1): deep (the pool, dark water), mid (the body), light (bright water), foam (sparkles).
"""
import colorsys

# Season palettes (the artists' rules: winter icy, autumn deeper teal, summer sparse/dim, spring teal-green; always cool).
SEASONS = {
    'winter': {'deep': (0.05, 0.16, 0.32), 'mid': (0.45, 0.72, 0.92), 'light': (0.80, 0.93, 1.00), 'foam': (0.92, 0.97, 1.00)},
    'spring': {'deep': (0.02, 0.20, 0.22), 'mid': (0.05, 0.62, 0.52), 'light': (0.45, 0.95, 0.80), 'foam': (0.85, 1.00, 0.95)},
    'summer': {'deep': (0.02, 0.10, 0.22), 'mid': (0.05, 0.42, 0.55), 'light': (0.35, 0.78, 0.85), 'foam': (0.80, 0.95, 1.00)},
    'autumn': {'deep': (0.01, 0.12, 0.20), 'mid': (0.02, 0.45, 0.52), 'light': (0.25, 0.80, 0.85), 'foam': (0.85, 1.00, 1.00)},
}
FRONT = (0.85, 1.0, 1.0)            # the surge's white-cyan edge
DAVE_WEIGHT = 0.6                   # Dave's colours vs the season's
COOL_HUE = (0.40, 0.68)             # hue range kept (0..1: green-cyan to blue)
SAT_PUSH = 1.25
KEYS = ('deep', 'mid', 'light', 'foam')


def hex_rgb(h):
    h = str(h).lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def rgb_hex(c):
    return '#' + ''.join(f'{int(round(max(0.0, min(1.0, v)) * 255)):02x}' for v in c)


def luminance(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def mix(a, b, f):
    return tuple(x + (y - x) * f for x, y in zip(a, b))


def cool(c):
    """Bring a colour's hue into the cool range (the artists: always cool), keeping its lightness; push saturation."""
    h, l, s = colorsys.rgb_to_hls(*c)
    lo, hi = COOL_HUE
    if not lo <= h <= hi:
        d_lo, d_hi = min(abs(h - lo), 1 - abs(h - lo)), min(abs(h - hi), 1 - abs(h - hi))
        h = lo if d_lo < d_hi else hi
    return colorsys.hls_to_rgb(h, l, min(1.0, s * SAT_PUSH))


def from_dave(colors):
    """Dave's hex colours sorted dark to bright -> {deep, mid, light} (None for a bad or empty list)."""
    try:
        rgbs = sorted((hex_rgb(c) for c in colors or []), key=luminance)
    except (ValueError, TypeError):
        return None
    if len(rgbs) < 2:
        return None
    return {'deep': rgbs[0], 'mid': rgbs[len(rgbs) // 2], 'light': rgbs[-1]}


def palette(season='autumn', dave_colors=None, cold=False, night=0.0):
    """The loop's palette: the season's, crossed with Dave's (DAVE_WEIGHT) when he sent one, kept cool and saturated;
    cold/snow pushes toward white; night (0..1) darkens and greys."""
    base = dict(SEASONS.get(season, SEASONS['autumn']))
    dv = from_dave(dave_colors)
    out = {}
    for k in KEYS:
        c = base[k]
        if dv and k in dv:
            # Dave's hue and saturation, the season's lightness band: his deep stays deep, his light stays light.
            d = cool(dv[k])
            scale = max(luminance(c), 0.02) / max(luminance(d), 0.02)
            d = tuple(min(1.0, v * min(scale, 4.0)) for v in d)
            c = mix(c, d, DAVE_WEIGHT)
        c = cool(c) if k != 'foam' else c
        if cold:
            c = mix(c, (0.92, 0.97, 1.0), 0.3 if k != 'deep' else 0.15)
        if night > 0:
            grey = (luminance(c),) * 3
            c = mix(c, grey, 0.45 * night)
        out[k] = tuple(max(0.0, min(1.0, v)) for v in c)
    return out


def desaturate(c, f):
    return mix(c, (luminance(c),) * 3, f)


def as_hex(pal):
    """Three colours for status.json: deep, mid, light."""
    return [rgb_hex(pal[k]) for k in ('deep', 'mid', 'light')]
