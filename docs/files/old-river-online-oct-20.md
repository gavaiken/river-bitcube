---
title: "old-river-online-oct-20 (retired)"
---

# old-river-online-oct-20 (retired)

**Retired 24 Oct: renamed `old-river-online-oct-20.toe`** (execution plan D27), so it is never opened at boot and mission control never offers it. Superseded by [river-online-oct-23](river-online-oct-23.html) (23 Oct: four screens and the Gray Area rope map); this one drives only HUB75 quad 1, from its Agape corners. Was `river-online-oct-20.toe` from 22 Oct and `river-local-oct-18.toe` before that. [All show files](../show-files.html)

## For visitors
The river you see is happening now: a camera at a river in the Sierra foothills streams it here over a satellite link. An AI listens to this room and the river through their cameras and writes a journal; every few minutes it chooses the colours and the mood of the water, and it reacts to what it sees in between.

## For the team
- **Reads:** the live river cam (over Starlink and Tailscale, 640×360 at 10 fps); Dave's agent on Modal (`state.json` scene every 5 min, `reflex.json` camera reactions, mirrored locally on port 8770); Dave's `canvas.html` animation.
- **Does:** the river cam fills the field (with the river memory time-slice and sparkle on moving water); the agent's scene scales flow, rain, sparkle, memory and gain and sets the palette; Dave's canvas plays as a 25% layer; memory of rain (trails in the river's colours); auto day/night (infrared at night). If the river feed drops, it falls back to rain.
- **Controls:** TD `/project1/river_local` (River and Modal pages).
- **Code:** `td/build/build_river_local.py`, `td/cameras/river_cam.py`, `td/modal/modal_scene.py`.
- **Switching to it:** not offered. Open it by hand in TouchDesigner only if both current show files are broken; mission control then shows Attention, "TouchDesigner is showing an old show file".
