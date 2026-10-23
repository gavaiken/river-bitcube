"""Stand-in positions for ropes the camera pixel map missed (pure; used by td/build/*.py).

A rope that was dark during the capture (ropes 9 and 17 on 18 Oct) has no points in the map, so the show
files sampled outside the field for it and sent it black even after it was fixed. Until the next re-map,
such a rope borrows its nearest mapped neighbour's positions, shifted a little sideways in u, so it shows
the same river as that neighbour (slightly offset) instead of staying dark.
"""


def fill_unmapped(uv, n_ropes, n_px, du=0.02):
    """uv: {(rope, px): (u, v)}. Returns (filled copy, {unmapped rope: rope it borrowed from})."""
    mapped = sorted({r for r, _ in uv})
    out, borrowed = dict(uv), {}
    if not mapped:
        return out, borrowed
    for r in range(n_ropes):
        if r in mapped:
            continue
        src = min(mapped, key=lambda m: (abs(m - r), m))    # nearest; the lower one on a tie
        shift = du if r > src else -du
        for px in range(n_px):
            if (src, px) in uv:
                u, v = uv[(src, px)]
                out[(r, px)] = (min(1.0, max(0.0, u + shift)), v)
        borrowed[r] = src
    return out, borrowed
