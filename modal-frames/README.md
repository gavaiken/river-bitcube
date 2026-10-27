# Modal Frames

**Dave's Modal agent decides the colour of every LED in A River Becoming; bitcube makes it move and glow.**

This folder is self-contained: the goal, the contract between Modal and bitcube, and a prompt to start Dave's Claude on the Modal side. It's separate from the rest of the repo on purpose: you can read only this folder and build your half.

| File | What |
|---|---|
| `README.md` | This page: the goal and how it works, for people |
| [`SPEC.md`](SPEC.md) | The contract, precisely: endpoints, JSON, images, timing, errors. **Normative**: when anything disagrees, the spec wins |
| [`layout.json`](layout.json) | The elements (4 screens, 20 ropes): sizes, which way is up. Published by bitcube, read by Modal |
| [`frame.schema.json`](frame.schema.json) | JSON Schema for the frame manifest. Validate against it in CI |
| [`samples/`](samples/) | Example manifests |
| [`DAVE-PROMPT.md`](DAVE-PROMPT.md) | Copy-paste prompt for Dave's Claude (Modal side only) |

Status: **proposed, 27 Oct 2026** (Gavin). Nothing is built yet on either side.

## The goal
Today Modal shapes the piece indirectly. It picks a *scene* (an animation name, a palette, four knobs) and a web canvas, and TouchDesigner on bitcube samples them through the camera map. Dave wants to say directly **what colour every LED should be**.

So, with Modal Frames:
- Dave's agent publishes a **target**: one picture per element (four screens, plus one picture for all 20 ropes) and how the live river should move it.
- bitcube **polls every 5 s**, and when a new target appears it **travels** there smoothly. This is not a crossfade: each pixel moves through hue, saturation and brightness over a few seconds.
- Between targets the piece **never stands still**. The live river camera, or the recorded river when the camera is down, keeps rippling light through Dave's colours.
- Dave knows **which way is up** on every element, but nothing about where things hang in the room. Wiring, calibration, rotation and LED power are bitcube's job.
- It works on a **slow link**. An unchanged poll costs a few hundred bytes; a full new target costs about 40–250 KB.

## How it works

```
 Modal (Dave)                                bitcube (gallery)
 ─────────────                               ──────────────────
 agent decides a target
   ├─ screen-1..4.png (128×256)              frames_sync.py polls every 5 s
   ├─ ropes.png (20×400)          ──HTTPS──▶   GET /frames/latest.json  (ETag → 304 if same)
   └─ latest.json (manifest)                   new frame_id? fetch its PNGs, check sha256
                                               write to gallery_state/frames/ atomically
                                                          │
                                             TouchDesigner, show "Modal Frames"
                                               journey: current → target in OKLCH (easing, via colours)
                                               × live river light (element space, amount/contrast/speed)
                                               → device colour curve → brightness & power caps
                                               → 20 ropes (Art-Net) + 4 screens (HDMI) at 60 fps
```

1. **The layout** ([`layout.json`](layout.json)) names five elements: `screen-1`…`screen-4` (each 128 wide × 256 tall, portrait, as hung) and `ropes` (20 columns × 400 rows: column *c* is rope *c+1*, row 0 is the top end where it hangs, row 399 the bottom).
2. **A frame** is a small JSON manifest plus one PNG per element it changes. The PNGs are plain 8-bit sRGB pictures, exactly what you'd see in a browser.
3. **The journey.** When a frame arrives, each pixel travels from the colour it shows *now* to its new target through the OKLCH colour space. Hue rotates the short way round; chroma and lightness glide. Dave sets the duration, the easing and up to three `via` colours to pass through on the way, e.g. through deep blue at dusk.
4. **The river.** Each element takes its movement from its own region of the river video. Dave's colour is multiplied by the river's light and dark ripples, centred so the average stays his colour. Per element, Dave sets `river.amount` (0 = still, 1 = full ripple), `river.contrast` and `river.speed`. These also glide during a journey.
5. **When Modal goes quiet** (no new frame, the manifest unreachable, or `ttl_s` passed): bitcube keeps animating the last target with the river for 2 more minutes, then journeys to the baseline live river. Never black, never frozen. When frames come back, it journeys to them.
6. **Safety is bitcube's.** Dave sends what he means, full range. bitcube applies its own colour calibration per device, brightness caps and rope-box power limits.

## Who does what
- **Dave / Modal (river-agent), Modal side only:**
  - serve `GET /frames/latest.json` and `GET /frames/<frame_id>/<element>.png` as [`SPEC.md`](SPEC.md) describes;
  - have his agent decide the targets and render them as PNGs;
  - validate everything against the schema before publishing;
  - optionally serve `/frames/preview.html`.

  Nothing on bitcube. Prompt for his Claude: [`DAVE-PROMPT.md`](DAVE-PROMPT.md).
- **bitcube (river-bitcube):**
  - publish `layout.json`;
  - fetch and mirror frames into `gallery_state/frames/` (`tools/modal/frames_sync.py`);
  - build the **"Modal Frames"** show (a new show file from the baseline template, listed in `shows.json` and selectable in mission control): reads the mirrored frames, renders journeys and river movement, applies caps;
  - provide a mock server that serves the samples so both sides can work independently;
  - show frame age and errors in mission control.
- **Changing the contract** needs both sides to agree. Bump `schema` (manifest) or `layout_version` (elements) and note it in [`SPEC.md`](SPEC.md)'s changelog.

## Decisions behind this (27 Oct, Gavin)
Full targets, not parameters. PNG + JSON manifest. Physical orientation only (bitcube owns wiring). One manifest with ETag/304. OKLCH journeys with easing and `via`. Movement from the live river, mapped in element space so all 400 LEDs of every rope move. sRGB values; bitcube applies caps. Partial frames allowed. Transitions start on arrival, `ttl_s` from arrival. Quiet Modal: keep moving 2 min, then the baseline river. bitcube fetches and mirrors frames itself; Dave works only on Modal. A show of its own called "Modal Frames". The contract lives here.
