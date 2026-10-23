---
title: "river-local-oct-22-seasons"
---

# river-local-oct-22-seasons

**The river's year, local-only.** Opens at boot on bitcube. [All show files](../show-files.html) · [Gallery card](../card/seasons.html) · [Control page](http://bitcube.tail03bc1a.ts.net:9981) (tailnet only)

## For visitors
A river in the Sierra foothills flows through the room, slowed and quickened and coloured by the season. Its year turns forward and never back: still white winter, green spring rain, a golden summer torrent, a rust-and-mud autumn. When the room fills it warms toward summer; when everyone leaves it locks into winter.

## For the team
- **Reads:** the **river library** on bitcube's disk (`River\recordings\river`; today one 64 s clip from 21 Oct), pre-rendered at three speeds. Later: the people counter's counts (`River\presence.json`). No internet, no Modal, no live river feed.
- **Does:**
  - Crossfades the slow, normal and fast copies by **intensity**: winter plays it 4× slower (with generated in-between frames, since the camera only gives 16 fps), summer 2× faster.
  - Grades the river through the current seasons' blended palette, with some natural colour kept so it reads as a real river.
  - Overlays: torrent streaks on the bright water (grow with intensity), glints (ice in winter, sun in summer), autumn leaf flecks, spring rain.
  - Samples the result onto the ropes through the camera pixel map, and onto the four HUB75 quads. Ropes the map is missing (9 and 17, dark when it was captured on 18 Oct) borrow the positions of their neighbour (8 and 16), shifted slightly, until the Gray Area re-map (`tools/pixelmap/fill.py`; fixed 23 Oct: before that they were sent black).
- **Modes:** automatic (4-minute year), dynamic (people steer it; needs the counter), manual (targets). After a restart: dynamic if the counter is running, otherwise automatic; never manual.
- **Controls:** the control page (port 9981), or in TD `/project1/seasons` (Look page: gain, river brightness and contrast, natural colour, overlays, blur, HUB75 gain and gamma). Rules are saved in `River\seasons-rules.json`.
- **Outputs:** 20 ropes over Art-Net (capped at 600 W per box); HUB75 quads 1–4 stacked down the left edge of the HDMI output (x = 0; y = 0, 128, 256, 384), as the Gray Area receive card has them (found by camera, 23 Oct). Each of the four portrait screens shows a window of the river, the windows stacked down one column of the field in the order the screens hang (Screens page: *Screenorder*, top first; *Screencolumn*), so the water flows down through them. Per-quad orientation on the Screens page (flop, flips, and *swap its two panel rows* for quad 4); *Screentest* shows a big F1–F4 to check it on camera.
- **Code:** `td/build/build_seasons_local.py` (builds the file), `td/seasons/seasons.py` (the year), `td/seasons/seasons_td.py` (TD glue and control page API), `td/seasons/control.html`, `tools/seasons/prerender.py` (river library speeds).
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
