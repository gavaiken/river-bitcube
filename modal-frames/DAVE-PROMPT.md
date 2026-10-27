# Prompt for Dave's Claude: Modal Frames, Modal side

Dave: paste everything in the block below into Claude Code, started in your `river-agent` checkout.

```
You're working with Dave on "A River Becoming", an LED/AI art installation at Gray Area, San Francisco. Dave's repo is drocamor/river-agent: an AI agent on Modal that watches the gallery and a real river through two cameras and decides how the piece should look. Today it publishes a "scene" (an animation name, a palette, four knobs) and a web canvas. bitcube, the show PC in the gallery, turns that into light on 20 LED ropes and 4 HUB75 screens.

We're adding **Modal Frames**: Modal decides the target colour of EVERY LED directly, as pictures. bitcube polls every 5 s, journeys smoothly to each new target, and keeps everything moving with the live river between targets. Your job is the **Modal side only**.

## Read first (the contract; it is normative)
The contract lives in the PUBLIC repo gavaiken/river-bitcube, folder `modal-frames/`. Read all of it before writing code:
- README.md, the goal and how it works: https://raw.githubusercontent.com/gavaiken/river-bitcube/main/modal-frames/README.md
- SPEC.md, the exact contract (endpoints, manifest, images, errors, bandwidth): https://raw.githubusercontent.com/gavaiken/river-bitcube/main/modal-frames/SPEC.md
- layout.json, the elements, sizes and which way is up: https://raw.githubusercontent.com/gavaiken/river-bitcube/main/modal-frames/layout.json
- frame.schema.json, the manifest's JSON Schema: https://raw.githubusercontent.com/gavaiken/river-bitcube/main/modal-frames/frame.schema.json
- samples/, example manifests: https://github.com/gavaiken/river-bitcube/tree/main/modal-frames/samples

If anything in this prompt disagrees with SPEC.md, SPEC.md wins. If SPEC.md is unclear or seems wrong, stop and tell Dave what and why. Don't invent behaviour: contract changes are agreed with Gavin and versioned.

Then read this repo so you build on what's here and don't invent parallel machinery:
- CLAUDE.md, README.md, docs/
- modal_deploy/app.py (the FastAPI app and routes: how /data/*.json and /public/scene.json are served, ETags and 304s, SITE_TOKEN auth, storage)
- tools/site.py (DATA_FILES)
- tools/visual_scene.py (the scene format the agent picks today)
- web/sculpture.js and canvas.html (how scenes are rendered today; useful for turning a scene into pictures)
- the tick orchestrator and where the agent sets its scene
- .github/workflows/ (CI; merges to main deploy to Modal)

## Scope: Modal side only
In scope (all in river-agent):
1. **Serve the endpoints** in SPEC.md §3 from the existing Modal app:
   - `GET /frames/latest.json`: strong ETag, `If-None-Match` → 304, `Cache-Control: no-cache`, 404 until the first frame exists.
   - `GET /frames/<frame_id>/<element>.png`: immutable, `Cache-Control: public, max-age=31536000, immutable`.
   - Same auth as /data (open unless SITE_TOKEN is set).
   - Publish the PNGs BEFORE the manifest that names them.
   - Retention: at least the last 20 frames and at least 30 minutes.
   - Store frames the way this app already stores its state (e.g. its Modal Volume), so every container serves the same latest frame.
2. **Make frames.** Turn the agent's decision into the five PNGs per SPEC.md §5 and layout.json:
   - `screen-1`…`screen-4` are 128×256 portrait; `ropes` is 20×400 (column c = rope c+1, row 0 = the top/hanging end).
   - 8-bit sRGB RGB PNG, no alpha. Row 0 = top. Never rotate or mirror for hardware; bitcube does that.
   - Prefer smooth fields (gradients, soft shapes, palettes laid out top to bottom). The river adds the texture and movement, so per-pixel noise is wasted bandwidth and won't look better.
   - Write the manifest:
     - `frame_id` unique (timestamp + short random);
     - `ttl_s`;
     - `transition` (duration 500–60000 ms, easing, optional up to 3 `via` hex colours);
     - per-element `river` {amount, contrast, speed};
     - a short `note` in plain words.
   - Partial frames are fine: leave out elements that don't change.
   - Start simple: render from the agent's existing scene (palette, brightness, density, turbulence → gradient pictures and river settings). Leave the agent's own creative rules intact; Modal Frames is another way of expressing its decision, not a new personality.
3. **Validate before publishing:**
   - every manifest against frame.schema.json;
   - layout_version equal to layout.json's;
   - image sizes and format exactly right;
   - sha256 of the exact bytes served.

   Refuse to publish anything invalid, and log why.
4. **Tests and CI:**
   - unit tests for the renderer (sizes, orientation: a top-to-bottom gradient sample really is light at row 0 if that's what you mean), ETag/304 behaviour, publish ordering, retention, auth;
   - schema validation of generated manifests;
   - a test that fails if layout.json's version changes without the code being updated (fetch it, or vendor a copy with its version pinned).

   Add these to the existing CI.
5. **Optional, recommended:** `GET /frames/preview.html` shows the latest five images side by side at their real proportions with the manifest, so Dave and Gavin can see what Modal is asking for.

Out of scope, don't touch:
- bitcube (the Windows show PC), TouchDesigner, anything that runs in the gallery.
- `gallery/sync.py`, `capture.py`, `rope-lights/` and anything else that runs on bitcube. bitcube writes its own fetcher (`frames_sync.py` in river-bitcube).
- the gavaiken/river-bitcube repo. It's read-only for you; if the contract needs a change, write the proposed change up for Dave to send to Gavin.
- Existing routes and outputs (/data/*.json, /public/scene.json, canvas.html, ingest). They keep working unchanged: the current shows depend on them.
- Secrets: never print, log or commit INGEST_TOKEN, SITE_TOKEN, CAMERA_TOKEN or camera logins.

## How to work
- This repo is PR-based and **every merge to main deploys to Modal**, so work on a branch, keep `main` green, and open a PR for Dave to review. Never merge or deploy without Dave saying so.
- Small steps, each tested.
  1. Endpoints with a static test frame.
  2. Validation.
  3. The renderer from the scene.
  4. Wiring into the agent's tick.
  5. Preview page.
- Mind the budget in SPEC.md §8:
  - aim for ≤250 KB per full frame;
  - new frames typically every 10–60 s with long journeys (the river supplies moment-to-moment life);
  - never more often than every 5 s.
- Before coding, summarise for Dave in plain language:
  - what you'll build and where;
  - how a frame is made from the agent's decision;
  - the storage you'll use;
  - anything in the spec that's unclear.

  Wait for his go.
- At the end, report:
  - what's on the branch;
  - how to try it: `curl -i` the manifest twice to see the 304, and open the preview;
  - test results;
  - what bitcube needs to know (the URL, whether SITE_TOKEN is on, the frame rate you chose).
```
