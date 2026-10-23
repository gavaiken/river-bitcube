from pixelmap.fill import fill_unmapped


def test_unmapped_rope_borrows_nearest_neighbour_shifted():
    uv = {(r, px): (0.1 * r, px / 10) for r in (0, 1, 3) for px in range(3)}
    out, borrowed = fill_unmapped(uv, 4, 3, du=0.02)
    assert borrowed == {2: 1}                           # tie between 1 and 3: the lower one
    assert out[(2, 1)] == (0.1 + 0.02, 0.1)
    assert all(out[k] == uv[k] for k in uv)             # mapped ropes untouched


def test_shift_direction_and_clamp():
    uv = {(1, 0): (0.0, 0.5)}
    out, borrowed = fill_unmapped(uv, 3, 1, du=0.05)
    assert borrowed == {0: 1, 2: 1}
    assert out[(0, 0)] == (0.0, 0.5)                    # shifted left, clamped at 0
    assert out[(2, 0)] == (0.05, 0.5)


def test_real_map_fills_ropes_9_and_17():
    import json
    from pathlib import Path
    pm = json.loads((Path(__file__).resolve().parents[1] / 'pixelmap-2026-10-18.json').read_text())
    uv = {(p['rope'], p['px']): (p['u'], p['v']) for p in pm['points']}
    out, borrowed = fill_unmapped(uv, 20, 400)
    assert set(borrowed) == {8, 16}
    assert all((r, px) in out for r in range(20) for px in range(400))


def test_empty_map():
    assert fill_unmapped({}, 2, 2) == ({}, {})
