# Modal Frames: specification

Manifest schema **`modal-frames/1`**, layout **version 1**. Status: proposed, 27 Oct 2026.

This is the contract between Modal (Dave's river-agent) and bitcube (river-bitcube). "MUST" and "SHOULD" are meant literally. The overview is in [`README.md`](README.md).

## 1. Terms
- **Element:** one thing that lights up as a unit of the contract. There are five: `screen-1`, `screen-2`, `screen-3`, `screen-4` (HUB75 screens) and `ropes` (all 20 LED ropes in one image).
- **Target:** the colours Dave wants an element to reach: one PNG per element.
- **Frame:** a manifest (`latest.json`) plus the PNGs it names. Each frame has a unique `frame_id`.
- **Journey:** bitcube's transition from what an element shows now to its new target.
- **River:** the live river video (the river camera, or the recorded river when the camera is down) that keeps the lights moving between targets.
- **Arrival:** the moment bitcube has a complete, valid frame on its own disk.

## 2. Layout ([`layout.json`](layout.json))
- **Who publishes it:** bitcube, in this repo: `https://raw.githubusercontent.com/gavaiken/river-bitcube/main/modal-frames/layout.json`. Modal SHOULD read it (at deploy or start) rather than hard-code sizes.
- **Elements, version 1:**

  | id | width × height | Row 0 is | Columns |
  |---|---|---|---|
  | `screen-1` … `screen-4` | 128 × 256 (portrait) | the top edge as the screen hangs | left to right, as seen from the front |
  | `ropes` | 20 × 400 | the top (hanging) end of every rope | column *c* = rope *c+1*; row *r* = the *r*-th LED from the top |

- **Orientation only.** Modal knows top and bottom and nothing else: not where the elements are in the room, not how they're wired, not which end of a rope is LED 0, not how a screen's panels are rotated. bitcube converts.
- **`river_region`** says which part of the river video each element ripples with. bitcube chooses it; Modal never sets it.
- **Changes:** any change to element ids, sizes or orientation bumps `layout_version`. bitcube then rejects frames carrying the old version (§7), so both sides must deploy together.

## 3. Endpoints (served by the Modal app)
Base URL: the river app, `https://to-be-a-river--river.modal.run`.

### `GET /frames/latest.json`
- **200:** the newest frame's manifest (§4), `Content-Type: application/json`, a strong `ETag`, `Cache-Control: no-cache`.
- **304** when the request's `If-None-Match` matches, with no body. Most polls end here.
- **404** while no frame has ever been published. bitcube treats it as "quiet" (§6.5).
- **Never** return a manifest whose PNGs aren't already retrievable: publish the images first, then the manifest.

### `GET /frames/<frame_id>/<element>.png`
- `<element>` is one of the ids in §2.
- **200:** `Content-Type: image/png`, `Cache-Control: public, max-age=31536000, immutable`.
- **Immutable:** the bytes at a URL never change. A new picture always means a new `frame_id`.
- **Retention:** keep at least the last 20 frames, and at least 30 minutes' worth. bitcube may still be fetching an older frame's images.

### Auth
The same as the existing `/data/*` routes: open unless `SITE_TOKEN` is set, in which case a `river_token` cookie or `Authorization: Bearer` is required. bitcube's fetcher MUST send the token when one is configured.

### Optional, recommended
`GET /frames/preview.html`: the latest frame's five images side by side at their real proportions, labelled, with the manifest beside them, so a person can see what Modal is asking for.

## 4. The manifest
Validated by [`frame.schema.json`](frame.schema.json) (JSON Schema 2020-12). Example:

```json
{
  "schema": "modal-frames/1",
  "layout_version": 1,
  "frame_id": "2026-10-27T18-04-05Z-7f3a",
  "issued_at": "2026-10-27T18:04:05Z",
  "ttl_s": 120,
  "transition": {"duration_ms": 8000, "easing": "ease-in-out", "space": "oklch", "via": ["#1b3a6b"]},
  "elements": {
    "screen-1": {"image": "/frames/2026-10-27T18-04-05Z-7f3a/screen-1.png", "sha256": "<64 hex>",
                 "river": {"amount": 0.7, "contrast": 0.5, "speed": 1.0}},
    "ropes":    {"river": {"amount": 0.4}}
  },
  "note": "dusk: cooling toward deep blue"
}
```

**Top-level fields**

| Field | Type | Meaning |
|---|---|---|
| `schema` | `"modal-frames/1"` | Contract version. |
| `layout_version` | integer | The `layout.json` version these images were made for. |
| `frame_id` | string `[A-Za-z0-9._-]{1,80}` | Unique, never reused. A timestamp plus a short random suffix is ideal. |
| `issued_at` | RFC 3339 UTC | When Modal made it. Informational only; bitcube never schedules by it. |
| `ttl_s` | 10–3600 | How long the frame counts as fresh, from **arrival**. |
| `transition` | object, optional | How to journey to this frame (§6.2). Defaults: `duration_ms` 5000, `easing` `ease-in-out`, `space` `oklch`, `via` `[]`. |
| `elements` | object, 1–5 entries | Keyed by element id. **Elements left out keep their current target and river settings.** |
| `note` | string ≤280, optional | Words for people (mission control, the journal). |

**Per-element fields** (at least one present)

| Field | Meaning |
|---|---|
| `image` | Path of this element's new target PNG, `/frames/<frame_id>/<element>.png`. Left out: the target stays as it is (useful to change only the river). |
| `sha256` | Lowercase hex SHA-256 of the PNG bytes. Required with `image`. bitcube rejects a mismatch. |
| `river.amount` | 0–1. How much the river's light and dark ripples modulate the colour. 0 = Dave's colour held still; 1 = full ripple. |
| `river.contrast` | 0–1. How strong the ripples are (the difference between light and dark). |
| `river.speed` | 0.25–2. Playback speed of the river movement for this element. |

Left-out `river` fields keep their current values. Initial values when Modal Frames starts: amount 0.6, contrast 0.5, speed 1.0.

## 5. The images
- **Format:** PNG, 8-bit per channel, colour type RGB (no alpha, no palette, no 16-bit), non-interlaced, exactly the element's `width × height`.
- **Colour space:** sRGB, meaning what the picture looks like in a browser on a normal screen. Send what you mean, at full range. bitcube applies each device's colour response, white balance, brightness cap and rope-box power limits.
- **Orientation:** row 0 is the top (§2). Don't pre-rotate or mirror anything.
- **Size on the wire:** about 417 KB raw for all five, typically 40–250 KB as PNG. Smooth gradients compress best; per-pixel noise defeats compression and isn't needed, because the river adds the texture.

## 6. What bitcube does with a frame
### 6.1 Polling and arrival
- bitcube polls `latest.json` every 5 s with `If-None-Match`.
- When it sees a new `frame_id`, it fetches the named PNGs, checks the sizes, formats and `sha256`, writes everything to its own disk, and then counts the frame as **arrived**.
- A frame whose images aren't all fetched within 30 s is dropped. The next poll tries the newest manifest again.

### 6.2 The journey
- **Start:** a journey begins at arrival, from the colour **each pixel shows at that moment** (even mid-journey), and lasts `duration_ms`.
- **Colour path:** each pixel moves in **OKLCH**. Lightness and chroma move linearly; hue takes the shorter way round the circle. When chroma is near zero, hue follows the endpoint that has colour, so grey never swings through a rainbow.
- **`via` colours:** these are waypoints. The path goes start → via₁ → … → target, each leg taking an equal share of the time, so every pixel passes near those hues. Each pixel blends its own path toward each via colour by 60%, which keeps the picture's structure.
- **Easing:** applied to time. `linear` is t; `ease-in` is t²; `ease-out` is 1−(1−t)²; `ease-in-out` is smoothstep.
- **River settings** in the frame glide from their current values over the same duration and easing.
- **Unchanged elements:** an element whose `image` is left out keeps its target and only its river settings journey.

### 6.3 Movement: the river
Every element samples its `river_region` of the river video, scaled to its own `width × height` (the ropes image's 400 rows run top to bottom through the region). At 60 fps:

```
luma      = river lightness at this pixel (0–1), played at river.speed
gain      = 1 + amount × contrast × 2 × (luma − mean_luma_of_region)
out       = target_colour_now × gain        (target_colour_now from the journey, §6.2)
```

The gain is centred, so the average colour of the element stays what Dave sent. When the river camera is down, bitcube uses the recorded river, as the baseline template does. The lights are never still while `amount > 0`.

### 6.4 To the lights
`out` (sRGB) → linear light → each device's colour curve → the show's brightness cap → the rope-box power limit (scaled per box) → Art-Net (ropes) and HDMI (screens). These caps can make a bright frame look dimmer than sent, especially white on all ropes. That is intended.

### 6.5 When Modal is quiet
"Quiet" means any of: polls failing, `latest.json` 404, or the current frame older than `ttl_s` since arrival.
1. For the first **120 s** of quiet, bitcube keeps showing the last target, still moving with the river.
2. After that it journeys (8 s, ease-in-out) to the baseline: the river video itself on every element.
3. When a valid frame arrives again, it journeys to it as usual.

The piece is never black and never frozen.

## 7. Errors
bitcube ignores a frame, keeps showing the current one, and reports the reason in mission control when:
- it fails [`frame.schema.json`](frame.schema.json);
- `schema` or `layout_version` doesn't match bitcube's;
- an image is the wrong size, wrong format or fails `sha256`.

Modal SHOULD validate every manifest and image before publishing it.

## 8. Bandwidth and timing (budget: 10 Mbps, polled every 5 s)
| Case | Per poll | Worst sustained |
|---|---|---|
| Nothing new | ~300 B (304) | ~0.0005 Mbps |
| River settings only | ~1 KB | negligible |
| New full frame every 5 s | ≤250 KB typical, ≤420 KB worst | ≤0.4 Mbps typical, ≤0.7 Mbps worst |

Publishing a new frame every 5 s is allowed. Frames 10–60 s apart with long journeys usually look better: the river provides the moment-to-moment life.

## 9. On bitcube: the local mirror (bitcube's side)
bitcube's own fetcher (planned: `tools/modal/frames_sync.py` in river-bitcube, started alongside the Modal link) mirrors frames into `C:\Users\user\River\gallery_state\frames\`. Modal does nothing here beyond serving §3 correctly:

```
frames/
  <frame_id>/screen-1.png … ropes.png   (only the images that frame names)
  latest.json                           (the manifest, written LAST, atomically: temp file + rename)
```

- Images MUST be complete and verified before `latest.json` is replaced. TouchDesigner reads only these local files and never waits on the network.
- The mirror keeps the last 20 frame folders and deletes older ones.
- It logs one line per new frame (`frames: <frame_id> (<n> images, <bytes>)`).
- It backs off on failures (5 s, doubling to 60 s) and sends the site token when one is configured.

## 10. Testing without each other
- **This repo:** `samples/` holds example manifests. bitcube's mock server (planned: `tools/modal/frames_mock.py`) serves rotating sample frames with real PNGs and ETags, so the "Modal Frames" show can be built before Modal ships.
- **Modal:** validate output against `frame.schema.json` and `layout.json` in CI, and keep `/frames/preview.html` for eyeballing.

## 11. Changelog
- **modal-frames/1, layout 1** (27 Oct 2026, Gavin): first version.
