---
title: "river-online-oct-23"
---

# river-online-oct-23

**The live river and Dave's AI.** Rebuilt 23 Oct for Gray Area from `river-online-oct-20` (now retired as [old-river-online-oct-20](old-river-online-oct-20.html)). [All show files](../show-files.html)

## For visitors
The river you see is happening now: a camera at a river in the Sierra foothills streams it here over a satellite link. An AI listens to this room and the river through their cameras and writes a journal; every few minutes it chooses the colours and the mood of the water, and it reacts to what it sees in between.

## For the team
- **Reads:** the live river cam (over Starlink and Tailscale, 640×360 at 10 fps); Dave's agent on Modal (`state.json` scene every 5 min, `reflex.json` camera reactions, mirrored locally on port 8770); Dave's `canvas.html` animation.
- **Does:** the river cam fills the field (with the river memory time-slice and sparkle on moving water); the agent's scene scales flow, rain, sparkle, memory and gain and sets the palette; Dave's canvas plays as a 25% layer; memory of rain (trails in the river's colours); auto day/night (infrared at night). If the river feed drops, it falls back to rain.
- **Outputs:** 20 ropes over Art-Net through the 23 Oct Gray Area rope map; the four HUB75 screens through the shared screens module (`td/build/screens.py`, the same as the seasons file: stacked quads, each screen upright, F test and corner pattern on the Screens page). New 23 Oct; oct-20 drove only quad 1, from its Agape corners.
- **Controls:** TD `/project1/river_local` (River, Modal and Screens pages).
- **Code:** `td/build/build_river_local.py`, `td/build/screens.py`, `td/cameras/river_cam.py`, `td/modal/modal_scene.py`.
- **Switching to it:** mission control's show-file switch, or `River\boot-file.txt` naming `river-online-oct-23.toe` (the boot file is currently the seasons version).
