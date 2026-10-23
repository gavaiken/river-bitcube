---
title: "A River Becoming: live"
---

# A River Becoming: live

The gallery camera's view of the ropes and HUB75, a new still **every minute** (08:00–02:00 Pacific). This page refreshes itself. People in the room may appear.

<img id="snap" src="img/rain-checkpoint-2026-10-18.jpg" alt="Latest gallery-cam still" style="width:100%;max-width:960px;height:auto">

<span id="snap-time"></span> <span id="snap-note"></span>

<script src="assets/snapshot.js"></script>
<script>
riverSnapshot({ img: document.getElementById('snap'), time: document.getElementById('snap-time'),
                note: document.getElementById('snap-note'), every: 60,
                failText: 'The camera snapshot is unavailable right now, so this is the 18 Oct rain checkpoint still.' });
</script>

## What TouchDesigner sends

The same minute from inside the show: the 20 ropes (left, one column each) and the four screens as you'd see them standing in front of each (1 to 4). Useful when the camera can't see something.

<img id="td" alt="What TouchDesigner sends to the ropes and screens" style="width:100%;max-width:960px;height:auto;image-rendering:pixelated;background:#000">

<span id="td-time"></span> <span id="td-note"></span>

<script>
riverSnapshot({ img: document.getElementById('td'), time: document.getElementById('td-time'),
                note: document.getElementById('td-note'), every: 60, prefix: 't/', ext: '.jpg', latest: 'td.jpg',
                failText: 'No preview from TouchDesigner right now (TD restarting, or outside 08:00-02:00).' });
</script>

<a href="./">Status page</a> · Dave's agent's own page: <a href="https://to-be-a-river--river.modal.run/">to-be-a-river--river.modal.run</a>
