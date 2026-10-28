---
title: "A River Becoming: show files"
---

# Show files: what the piece is doing

For Colin and Justine (and the rest of the team): what each show file does, in plain words, and what you can ask to change. Words in **bold** are defined in the [glossary](https://github.com/gavaiken/river-bitcube/blob/main/GLOSSARY.md). Updated 28 Oct 2026.

A **show file** is the TouchDesigner file that runs the whole piece on bitcube: the 20 ropes and the HUB75 panels. Mission control offers these files:

| File | What it is | Needs |
|---|---|---|
| [**river-local-oct-22-seasons**](files/river-local-oct-22-seasons.html) | The river's year. Plays the recorded river through four seasons; people in the room warm it toward summer. **Opens at boot.** | Nothing: runs with no internet at all |
| [**river-seasons-palettes**](files/river-seasons-palettes.html) | The river's year in new colours: icy winter, deeper teal spring, sparse blue-green summer, deep cerulean autumn. Not the default. | Nothing: runs with no internet at all |
| [**river-online-oct-23**](files/river-online-oct-23.html) | The live river and Dave's AI, set up for Gray Area (four screens, 23 Oct rope map). Shows the river camera live (over Starlink) and lets Dave's agent on Modal shape the colours and movement. | Internet, the river site online, Modal |
| [**river-remembered**](files/river-remembered.html) | The remembered river: Dry Creek relives one real day from its past every five minutes (calm drips, a building flow, the surge down every rope into the pool, settling). Dave's agent picks the day. The boot default since 27 Oct. | Dave's agent (else bitcube's own notable days), the river camera (recorded fallback), the people counter |
| [**river-looks**](files/river-looks.html) | The river (all looks): the remembered river and both Fill my cups in one file, faded between (auto: four remembered loops, then one fill; or a chosen look). | As the remembered river, plus the fill dials |
| [**river-all-looks**](files/river-all-looks.html) | The river (all looks, playlist): every look in one file (the remembered river, both Fill my cups, the river's year, Combined with Modal), played in an order set in mission control's Looks tab, or one look pinned. Not offered yet. | Every look's inputs |
| [**river-two-looks**](files/river-two-looks.html) | The river (two looks): a frozen copy of river-looks as it ran on 28 Oct, the rollback while the all-looks file grows. Not offered yet. | As river-looks |
| [**river-filling**](files/river-filling.html) | Fill my cup (configurable): every rope and screen one canvas by real height; water fills the column from the floor to the top, turbulent, then drains out. Dials in mission control. | The calibration, the dials |
| [**river-fill-simple**](files/river-fill-simple.html) | Fill my cup (simple): the first filling look, smooth churn and a crest, by real height. | The calibration only |
| [**river-baseline-template**](files/river-baseline-template.html) | Starting point for making a new visualization; live river and gallery inputs | Live cameras, recorded river fallback |
| [**Combined v0**](files/river-combined-v0.html) | Will's live summer river with Dave's adjustable additive canvas overlay | Live river (recorded fallback) and the local Modal mirror |
| [**Combined with Modal Input Selector**](files/river-combined-modal-inputs.html) | Combined v0 plus a choice of which Modal output steers it (off, Dave's canvas, his scene's palette and pace, or Modal Frames pictures per screen and rope) and how strongly | Live river (recorded fallback), the local Modal mirror and Modal Frames |

Older show files are renamed with `old-` in front ([old-river-online-oct-20](files/old-river-online-oct-20.html), `old-river.toe`): they never open at boot and mission control doesn't offer them. To switch, use mission control: Status → What's showing → Change → pick a file → Switch. Back to default returns to the default. Set as default separately changes what opens at restart; switching does not.

**Gallery card** (for the iPad in front of the piece): [the seasons version](card/seasons.html). The online version will need its own card.

## Will's visualization

[Combined v0](files/river-combined-v0.html): live river with recorded fallback, Gavin's fixed summer treatment, and Dave's additive Modal canvas overlay. Its Status slider adjusts overlay strength. See its page for build and control details.

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
