---
title: "river-local-oct-22-seasons"
---

# river-local-oct-22-seasons

**The river's year, local-only.** Opens at boot on bitcube. [All show files](../show-files.html) · [Gallery card](../card/seasons.html) · [Control page](http://bitcube.tail03bc1a.ts.net:9981) (tailnet only)

## For visitors
A river in the Sierra foothills flows through the room, slowed and quickened and coloured by the season. Its year turns forward and never back: still white winter, green spring rain, a golden summer torrent, a rust-and-mud autumn. When the room fills it warms toward summer; when everyone leaves it locks into winter.

## For the team
- **Reads:** the **river library** on bitcube's disk (`River\recordings\river`; today the 21 Oct recording, 71 s, from the camera's clean sub stream with its clock cropped off: the main stream was 40% corrupt, re-rendered 23 Oct), pre-rendered at three speeds (`tools/seasons/prerender.py`). Later: the people counter's counts (`River\presence.json`). No internet, no Modal, no live river feed.
- **Does:**
  - Crossfades the slow, normal and fast copies by **intensity**: winter plays it 4× slower (with generated in-between frames, since the camera only gives 16 fps), summer 2× faster.
  - Grades the river through the current seasons' blended palette, with some natural colour kept so it reads as a real river.
  - Overlays: torrent streaks on the bright water (grow with intensity), glints (ice in winter, sun in summer), autumn leaf flecks, spring rain.
  - Samples the result onto the ropes through the camera pixel map, and onto the four HUB75 quads. The map is `pixelmap-2026-10-23.json`, captured at Gray Area with the gallery cam where it now hangs (all 20 ropes). A rope a map misses borrows its neighbour's positions (`tools/pixelmap/fill.py`), so it's never sent black.
- **Modes:** automatic (4-minute year), dynamic (people steer it; needs the counter), manual (targets). After a restart: dynamic if the counter is running, otherwise automatic; never manual.
- **Controls:** the control page (port 9981), or in TD `/project1/seasons` (Look page: gain, river brightness and contrast, natural colour, overlays, blur, HUB75 gain and gamma). Rules are saved in `River\seasons-rules.json`.
- **Outputs:** 20 ropes over Art-Net (capped at 600 W per box) through the Gray Area rope map (`pixelmap-2026-10-23.json`). The four HUB75 screens through `td/build/screens.py` (shared with the online file): each shows the river from where it hangs in the camera's view (`tools/pixelmap/screens-2026-10-23.json`: screens 2 and 4 located, 1 and 3 estimated next to them), sampled *Screenspan* (2.4) times its own size so it stays sharp; quads stacked down the left edge of the HDMI output as the receive card has them; per-screen orientation, F test and corner pattern on the Screens page. *screens_preview* shows what's sent (ropes and the four screens upright); it's on the [live page](../live.html) every minute.
- **Code:** `td/build/build_seasons_local.py` (builds the file), `td/build/screens.py` (the screens), `td/seasons/seasons.py` (the year), `td/seasons/seasons_td.py` (TD glue and control page API), `td/seasons/control.html`, `tools/seasons/prerender.py` (river library speeds).
- **Switching to it:** it's the boot file. To go back to the online version, point `Start-River.cmd` at `river-online-oct-20.toe`.

## Now
<img id="snap" src="../img/rain-checkpoint-2026-10-18.jpg" alt="Latest gallery-cam still" style="width:100%;max-width:640px;height:auto">
<span id="snap-time"></span> <span id="snap-note"></span>
<script src="../assets/snapshot.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  riverSnapshot({ img: document.getElementById('snap'), time: document.getElementById('snap-time'), note: document.getElementById('snap-note') });
});
</script>
