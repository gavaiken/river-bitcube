---
title: "A River Becoming: the people counter (plan)"
---

# The people counter: plan

**Built 23 Oct** (`tools/presence/counter.py`, started at login by `Start-Presence.cmd`; status: `.venv\Scripts\python.exe tools\presence\counter.py status`). It is what turns on **dynamic** mode in [river-local-oct-22-seasons](files/river-local-oct-22-seasons.html). Terms as in the [glossary](https://github.com/gavaiken/river-bitcube/blob/main/GLOSSARY.md). Decided 22 Oct 2026 with Gavin.

## What it must produce
Every half second, a line in `C:\Users\user\River\presence.json`: `{"t": <unix time>, "count": <people in the foreground>}`. That's the whole contract with the show file (`td/seasons/seasons_td.py` reads it). If the file stops changing for 30 s, the show falls back to automatic by itself; when it comes back, the show returns to dynamic by itself (unless someone picked a mode on the control page).

## How it counts (local-only)
- **Input:** the gallery cam's low-res stream (640×360) on our own network. No internet, no Modal.
- **Detector:** a small person detector (YOLO "nano" class model, ONNX, CPU) on bitcube, about 2 frames a second. The Iris Xe CPU can do that without disturbing TouchDesigner; we'd check its frame rate stays at 60.
- **Foreground only:** count people whose box is taller than about a quarter of the frame (near the piece), not people far across the gallery. Tune on site by looking at what the camera sees.
- **No tracking:** count per frame. The medians below already turn flicker into a steady number, and it keeps the counter simple and fast. Nobody is identified or recorded; only the count leaves the process.
- **Fallback:** if the detector isn't installed or crashes, a motion measure (how much of the frame changed) stands in as a rough count, so the piece still responds.
- **Runs as:** a process started at login by the same supervisor pattern as the Modal link (`tools/modal/modal_link.py`), restarted if it dies, logging to `River\logs\presence.log`.

## How the show uses the count (already built)
- **Presence now** = median of the last 30 s; **usual presence** = median of the last 10 min (never below 0.75, so one person in an empty gallery counts).
- **Relative presence** = now ÷ usual: above 1.3× warms the year toward summer, below 0.7× cools it toward winter, in between holds; nobody for a minute = winter. Summer's strength rises from 1.3× to full torrent at 2×.
- The year only turns forward; warming takes about a minute, freezing about three.
- All of these are **rules**, adjustable live on the control page.

## As built (23 Oct)
- **Detector:** YOLOv8 nano, ONNX (`River\models\yolov8n.onnx`, from Hugging Face `Kalray/yolov8`, sha256 in `counter.py`), onnxruntime 1.31 on the CPU with 2 threads: ~70–120 ms a frame at 2 frames a second; TouchDesigner stays at 60 fps. No OpenCV: letterbox with PIL, NMS in numpy.
- **Near the piece:** a box at least 25% of the frame tall. Checked on a 12:11 still with three people by the piece: all three found (0.63–0.83), 31–56% tall. The empty room gave 0, no false hits from ropes, branches or speakers.
- **Camera:** the gallery cam has two presets (`tools/cameras/ptz.py gallery goto 1|2`): **1 "map"**, the framing the rope map and screen positions came from (use it for any re-map), and **2 "room"**, tilted down to the people around the piece, where it stays for the counter and Dave's agent. Moving it doesn't change the ropes or screens: their maps were only needed at capture time.
- **Also writes** `River\presence-status.json` (detector, frame time, raw and near counts); `run --debug` writes a local tuning frame `River\presence-debug.jpg` with the boxes.
- **Live 15:40:** the seasons file went to dynamic mode by itself; empty room → target winter.

## Lingerers (28 Oct, for the remembered river)
- `presence.json` also carries `people` (foot point in the show view, box height, seconds still) and `lingerers` (still ≥ 8 s, box ≥ 40 % of the frame tall, with their two nearest ropes from the zones file); `t` and `count` are unchanged. Contract and details: [remembered-river.md §4](remembered-river.md).
- This needs a light tracker after all (box overlap, else nearest foot point, at 2 fps), only to time how long someone stands still; nobody is identified and nothing about a person is kept 2 s after they're out of sight. "No tracking" above was true until then.
- Rope feet come from `tools/pixelmap/zones-<date>.json` (`tools/remembered/zones.py`): `--zones=<path>`, else a show's `calibration.zones` pin, else the newest.

## Steps when we build it
1. Install `onnxruntime` and `opencv-python` into bitcube's `.venv`; download the detector model.
2. `tools/presence/counter.py`: RTSP (sub-stream, from `secrets.local.json`) → frames at 2 fps → count → `presence.json`; motion fallback.
3. Add it to the login supervisor; check TouchDesigner still runs at 60 fps.
4. On site: aim and fix the camera, tune the "near the piece" size threshold, watch the control page's graph through an evening, adjust the rules.

## Back burner
- AI-enhanced river footage via Modal: upscaling, smoother generated slow motion, longer generated clips.
- Cross-checking the count with Dave's agent, which already asks "about how many people are present?" every ~15 s.
