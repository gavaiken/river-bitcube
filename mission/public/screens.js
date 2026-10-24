// The four HUB75 screens as Lights draws them: each UPRIGHT AS SEEN, side by side, cell k-1 = screen k. Pure (no DOM), so
// the fixtures (lib/fixtures.mjs) and the tests use the same geometry as the page.
//
// bitcube sends them that way in frames.screens (tools/mission/td_mission.py screens_now): exact. A td_mission.py from
// before 24 Oct sends only frames.panels, the atlas, and that has to be undone here. At Gray Area the receive card stacks
// the quads down the left edge (panel_out 256 × 512, so 64 × 128 after the 4× downsample), and td/build/screens.py turns
// each upright portrait on its side for it: screen 3 gets a half turn as seen (it hangs the other way up), then every
// screen is flopped (bottom left) and flipped in y, a quarter turn, and screens 3 and 4 have their two panel rows swapped.
// The quarter turn's direction here assumes TD's Flip TOP flips before it flops; it has not been checked against bitcube
// (frames.screens, when present, never depends on it). An atlas of four quads in a row (before Gray Area) is not stacked:
// uprightsFromAtlas returns null and the page cuts it into four as it is.
export const SWAPPED = [3, 4];
export const HALF_TURN = [3];

/** Where pixel (x, y) of screen k's upright cell (W wide, H tall, row 0 = top as seen) lands in its quad (H wide, W tall,
 *  row 0 = the top of panel_out's cell): [qx, qy]. */
export function quadPos(k, x, y, W, H) {
  let vx = x, vy = y;
  if (HALF_TURN.includes(k)) { vx = W - 1 - x; vy = H - 1 - y; }
  const qx = vy;
  let qy = W - 1 - vx;
  if (SWAPPED.includes(k)) qy = (qy + W / 2) % W;
  return [qx, qy];
}

/** Is a panels frame (w × h) the stacked Gray Area atlas (four quads down one column)? */
export const isStacked = (w, h) => Number.isInteger(w) && Number.isInteger(h) && w > 0 && h >= w * 1.5 && h % 8 === 0;

/** The stacked atlas (rgb bytes, AW × AH, row 0 = top) → { w, h, bytes }: the four uprights side by side; null when the
 *  atlas is not stacked. */
export function uprightsFromAtlas(bytes, AW, AH) {
  if (!bytes || !isStacked(AW, AH) || bytes.length < AW * AH * 3) return null;
  const W = AH / 4, H = AW, w = 4 * W, out = new Uint8Array(w * H * 3);
  for (let k = 1; k <= 4; k++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [qx, qy] = quadPos(k, x, y, W, H);
    const s = (((k - 1) * W + qy) * AW + qx) * 3, d = (y * w + (k - 1) * W + x) * 3;
    out[d] = bytes[s]; out[d + 1] = bytes[s + 1]; out[d + 2] = bytes[s + 2];
  }
  return { w, h: H, bytes: out };
}

/** The inverse: four uprights side by side (w × h) → the stacked atlas { w: h, h: w, bytes } as panel_out holds it (the
 *  fixtures make their frames this way, so both paths of the page are exercised). */
export function atlasFromUprights(bytes, w, h) {
  const W = w / 4, H = h, AW = H, AH = 4 * W, out = new Uint8Array(AW * AH * 3);
  for (let k = 1; k <= 4; k++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [qx, qy] = quadPos(k, x, y, W, H);
    const d = (((k - 1) * W + qy) * AW + qx) * 3, s = (y * w + (k - 1) * W + x) * 3;
    out[d] = bytes[s]; out[d + 1] = bytes[s + 1]; out[d + 2] = bytes[s + 2];
  }
  return { w: AW, h: AH, bytes: out };
}
