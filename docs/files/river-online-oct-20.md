---
title: "river-online-oct-20"
---

# river-online-oct-20

**The live river and Dave's AI.** Was `river-local-oct-18.toe` until 22 Oct. [All show files](../show-files.html)

## For visitors
The river you see is happening now: a camera at a river in the Sierra foothills streams it here over a satellite link. An AI listens to this room and the river through their cameras and writes a journal; every few minutes it chooses the colours and the mood of the water, and it reacts to what it sees in between.

## For the team
- **Reads:** the live river cam (over Starlink and Tailscale, 640×360 at 10 fps); Dave's agent on Modal (`state.json` scene every 5 min, `reflex.json` camera reactions, mirrored locally on port 8770); Dave's `canvas.html` animation.
- **Does:** the river cam fills the field (with the river memory time-slice and sparkle on moving water); the agent's scene scales flow, rain, sparkle, memory and gain and sets the palette; Dave's canvas plays as a 25% layer; memory of rain (trails in the river's colours); auto day/night (infrared at night). If the river feed drops, it falls back to rain.
- **Controls:** TD `/project1/river_local` (River and Modal pages).
- **Code:** `td/build/build_river_local.py`, `td/cameras/river_cam.py`, `td/modal/modal_scene.py`.
- **Switching to it:** point `Start-River.cmd` at `river-online-oct-20.toe` (the boot file is currently the seasons version).
