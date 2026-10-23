---
title: "A River Becoming: show files"
---

# Show files: what the piece is doing

For Colin and Justine (and the rest of the team): what each show file does, in plain words, and what you can ask to change. Words in **bold** are defined in the [glossary](https://github.com/gavaiken/river-bitcube/blob/main/GLOSSARY.md). Updated 22 Oct 2026.

A **show file** is the TouchDesigner file that runs the whole piece on bitcube: the 20 ropes and the HUB75 panels. There are two:

| File | What it is | Needs |
|---|---|---|
| [**river-local-oct-22-seasons**](files/river-local-oct-22-seasons.html) | The river's year. Plays the recorded river through four seasons; people in the room warm it toward summer. **Opens at boot.** | Nothing: runs with no internet at all |
| [**river-online-oct-23**](files/river-online-oct-23.html) | The live river and Dave's AI, set up for Gray Area (four screens, 23 Oct rope map). Shows the river camera live (over Starlink) and lets Dave's agent on Modal shape the colours and movement. | Internet, the river site online, Modal |
| [river-online-oct-20](files/river-online-oct-20.html) | Fallback: the online file before Gray Area (only one screen). | Internet, the river site online, Modal |

**Gallery card** (for the iPad in front of the piece): [the seasons version](card/seasons.html). The online version will need its own card.

## The seasons version, in short
- **The river is always moving.** Its base is a recording of the real river, so it always reads as a river, on the ropes and on the panels.
- **It lives through a year.** **Winter**: almost still, white and pale blue, ice glints. **Spring**: thaw and rain, greens and teal. **Summer**: the torrent, gold light and sun glints. **Autumn**: slowing, ochre, rust, leaf-red and mud.
- **The year only turns forward.** Winter, spring, summer, autumn, winter. It can pause in a season or move on, but never go back: from autumn, the way back to summer is through winter and spring.
- **Who steers it** (the **mode**):
  - **Automatic**: the year turns by itself, one season a minute (4 minutes a year).
  - **Dynamic**: the people in front of the piece steer it. Busier than usual warms it toward summer; quieter cools it through autumn to winter; an empty room is winter. "Usual" adapts to the night (a busy moment might be 4 people or 100), and the bigger the crowd compared with usual, the stronger the summer torrent. *Needs the people counter, which isn't built yet (it's planned), so for now the piece runs in automatic.*
  - **Manual**: pick a **target** season and intensity (stillness to turbulence) and the river travels there, forward through the calendar, in under a minute.

## The control page
Open **http://bitcube.tail03bc1a.ts.net:9981** on a phone or laptop that's on our Tailscale network (or on our router at Gray Area). It shows where the year is on a season wheel, how intense the water is, and the people count, and lets you switch mode, pick targets, or change the **rules**. It only answers our own network and tailnet, never the public internet, and it works without internet.

## How to ask for changes
Tell Gavin (or any Claude working on the repo) in plain words; these are the knobs that already exist:

| You might say | What changes |
|---|---|
| "Make the year longer / shorter" | Length of the year (automatic), now 4 min |
| "People should warm it faster / it should freeze slower" | Warming and cooling pace (dynamic), now 1 min and 3 min |
| "It should react to smaller crowds" | Busier / quieter than usual thresholds, now 1.3× and 0.7× |
| "Summer should only roar with a real crowd" | Full torrent at, now 2× usual |
| "Less gold in summer", "bluer winter" | The season palettes and tints |
| "More rain in spring", "fewer leaves" | The overlay amounts |
| "Show more of the real river colours" | Natural colour mix, now 35% |
| "The panels are too bright" | HUB75 gain |

The first four are **rules** and can be changed live on the control page (Advanced). The rest are in the show file and take a few minutes.

## Keeping this page true
Whenever a show file changes, its page here changes in the same commit (a rule in the repo's `CLAUDE.md`).
