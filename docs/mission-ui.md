---
title: "A River Becoming: mission control UI"
---

# Mission control v2: the design

For the team, to read on a phone. 23 Oct 2026. Goal: anyone on the team, in the dark gallery, can tell within **five seconds** whether the show is OK and, if not, what is wrong and what to do. Words in **bold** are from the [glossary](https://github.com/gavaiken/river-bitcube/blob/main/GLOSSARY.md).

How it was chosen: a 44-problem audit of today's pages; a status model (`mission/public/model.js`) that turns `GET /api/status` into every verdict; three built prototypes (A: one answer, then drill down; B: the room and the signal chain; C: a timeline); five judges (the artists; Will, Dave and Andi; Lilian and a Gray Area staffer; correctness; mobile and dark gallery). **A won every panel, 303 points to C's 271 and B's 269.** This is A, with what the judges asked to graft from B and C, without what they warned against.

## Principles

1. **One verdict, one cause, one action.** The headline is a sentence about the show, never a count of dots; one cause explains all its symptoms.
2. **The model decides, the page places.** Every state word, reason, control reason and "since" comes from `derive()` on the server's clock, so pages cannot disagree and a phone's clock cannot age or freshen anything.
3. **Unknown is never green and never red.** Stale data turns grey and says since when; a lost connection says so in one sentence.
4. **Word, then shape, then colour.** OK ✓ · Attention ▲ · Down ✕ · Unknown ?; colour is never the only signal, and status colours mean nothing else.
5. **Controls sit on the thing they change, say what they will do, confirm when it costs, and report on themselves.** Greyed with the model's reason when nothing can be done.
6. **Function first, art second.** A light page with river art in the season's palette behind translucent panels, a dark theme for the gallery; the art never sits under small text and never moves for anyone who asked it not to.

## Information architecture

| Page | For | Order on a phone |
|---|---|---|
| **Status** (tab 1, landing) | everyone: is the show OK, what is wrong, what do I do | lost-contact banner (only when needed) → verdict band → The piece now (Season, Ropes, Panels, The room) → Not OK, grouped by cause → "N things fine" (collapsed) → Installer (collapsed) → footer |
| **Lights** (tab 2) | Colin, Andi, Gavin, Will: does it look right, where is every LED, calibrating | state line → the LED map over the gallery still, Map \| Live → 20 rope chips → panel quads → rope-by-rope strips → provenance → Calibrate |
| **Studio chat** (tab 3) | anyone: ask the agent to look or to act | shared-conversation banner → request cards with state chips → pinned status bar with Stop → composer |
| **System map** (footer, every card's details) | Will and Gavin: which link is down, addresses | B's signal chain with live levels and a legend, then the existing diagram |
| **Menu** (⋯) | | Who to call · Recent · Check now · Theme auto/light/dark · Show files · Install guide · The plan · Log out (confirm) |
| **Login** | | one password field with show-password, Log in, "No password? Call …" |

Tab bar at the bottom on phones (≥ 48 px, icon over a 14 px label), a pill in the header from 900 px, two sticky columns from 1100 px. Every header: wordmark, page title, the ticking "Updated N s ago", the menu.

## Status vocabulary

**State words:** OK (green ✓), Attention (amber ▲), Down (red ✕), Unknown (grey ?). Attention covers running-but (slow, a camera down while the show is unaffected, coming up) and deliberate states ("dark on purpose"); no fifth colour. An item's level is the state of the piece itself; the band's level is what it means for the show (a down gallery camera: Down on its card, Attention on the band).

**Thresholds** (constants exported from `model.js`):

| Rule | Value |
|---|---|
| Polls (the mini) | bitcube port 5 s · seasons page 5 s · Modal 30 s · the full check 60 s |
| A source is stale | 3 missed polls: 15 s · 15 s · 90 s · 180 s; ages are `status.now − source.at` (the server's clock) |
| The page is stale | 30 s without an answer: band Unknown, every item stale, every control off |
| TouchDesigner slow | `td.fps` under 30 |
| Coming up | bitcube up under 15 min, or `fps` null on the first check after a start |
| Dave's agent late | `next_tick_epoch` more than 15 **daytime** minutes past (07:00–23:55 Pacific); overnight is "Resting" |
| Clips failing | the last good clip line older than 5 min |
| Disk low | under 20 GB |
| **Intensity** | stillness < 0.1 · trickle < 0.3 · flowing < 0.6 · strong < 0.8 · torrent |
| Headline order | down > warning > unknown > ok, then the cause's priority (page stale, bitcube offline, check failed, TouchDesigner frozen, the lights, …) |

**Per piece** (Unknown everywhere means not polled yet, or behind an offline bitcube):

| Piece | OK | Attention | Down |
|---|---|---|---|
| bitcube | port 22 answers ("full check still to come" is OK) | the full check failed | `bitcube.online` false: one cause for everything behind it |
| TouchDesigner | `td.ok`, fps ≥ 30 | fps < 30; restarting; not running within 15 min of a restart | `td.ok` false (frozen) or not running |
| The river's year (its page) | answers | fetch error: "not running: switch first" under the live river, "page not answering" under the year | part of a frozen TouchDesigner |
| Ropes (the sender) | open, `source` canvas | `source` black ("dark on purpose"); a sender error or a silent box while the other answers; TouchDesigner slow | sender error with both boxes unreachable ("the lights aren't connected"; 10049: "bitcube's LIGHTS port has no link"); both boxes silent; TouchDesigner frozen ("not being driven") |
| Rope box 1, 2 | `devices.psac10_1/2` answers | | no answer, folded under the ropes |
| Panels | `displays` reads LED, output on, brightness > 0 | TouchDesigner frozen ("picture frozen"); output off or brightness 0 | no LED display (no panel sender on bitcube's HDMI); with the boxes down, part of "the lights aren't connected" |
| Gallery camera | `devices.gallery_cam` | | port closed (band: Attention, "the show itself is unaffected") |
| River camera (the river site) | reachable; live file: fresh frames | live file, `river_cam.fresh` false ("no frames for 30 min: the rain fallback") | port closed (band: Attention; "unreachable: no internet" when the uplink is down) |
| Router · Internet at Gray Area | answers · bitcube reaches 1.1.1.1 | | not answering (owns the internet, the gallery camera) · no internet (band: Attention; owns clips, the river camera, the recorder) |
| Dave's agent | ticked on schedule, or resting overnight | unreachable, `ok` false, or late ("hasn't ticked for 9 h"); first among warnings under the live river | |
| Clips to Dave | processes > 0, both clip lines fresh | not running; one camera's clips failing (owned by that camera or the internet when down); sync quiet while the agent is overdue | both cameras' clips failing |
| River recorder · People counter | last line "done" · muted "Not available yet (normal)" | an error word in the last line | |
| Mission control | the page gets answers | | |

**Freshness rule:** one ticking age in the header (the phone's clock, only for its own last fetch); one muted "from bitcube · 20 s ago" per card; the band mentions freshness only when it is the problem ("Mission control hasn't heard from bitcube for 3 min"). Ages past 2 min turn amber. A fresh Down beats a stale Unknown. Not stale: the full check while bitcube is offline, the seasons page while the live river runs.

**A single cause explains several symptoms** (`problems[]`, `item.cause`):

| Cause | Owns | Headline → action |
|---|---|---|
| bitcube offline | everything behind it, one folded line | "bitcube is offline: nothing behind it can be checked" → power light, the router, wait a minute |
| TouchDesigner frozen / not running | the seasons page, the ropes, both boxes, the panels | "TouchDesigner is frozen: the lights are not being driven" → answer the dialog, or Switch now |
| the lights aren't connected | the ropes, both boxes, the panels | → in the ceiling: the lighting switch into bitcube's LIGHTS port, HDMI into the panel sender (Lilian) |
| no internet | clips to Dave, the river camera, the recorder | → check the router's uplink (Will); clips resume by themselves |
| coming up | TouchDesigner, a missing Modal link | "bitcube restarted 6 min ago and is still coming up" → wait two minutes |
| a leftover unknown | its own cause | an all-green page can never hide an unchecked piece |

**Since when** comes from the server (`lib/history.mjs`, transitions only), in duration form so a first sighting never reads as the fault's onset: "Down for 9 min", "for over 2 h". Never the page's own watch start.

## Copy rules

**Names,** one per thing, everywhere:

| Thing | Call it | Never on the main view |
|---|---|---|
| the app · the mini | Mission control · the Mac mini (provenance only) | portal, site, gav-m1-mini, 100.126… |
| the show PC | bitcube (lowercase even at a sentence start; "the show PC" once, on its card) | show computer, the PC |
| TouchDesigner and its file | TouchDesigner; **show file**: the river's year (local-only), the live river (online) | TD, the bridge, .toe names |
| the control page on 9981 | The river's year (item), "its page" in details | Seasons control page, :9981 |
| the ropes | Ropes · the rope sender · Rope box 1 (ropes 1–10), Rope box 2 (ropes 11–20) · bitcube's LIGHTS port (white) | lights (alone), Art-Net, PSAC10, 2.0.0.x |
| the panels | Panels ("HUB75 LED panels" once) · the panel sender | LED display, quad, Colorlight |
| cameras | Gallery camera (its still: The room) · River camera (The river); camera + router + Starlink = the river site | 192.168…, RTSP, Reolink |
| network | Router (ours, Wi-Fi gray-river) · Internet at Gray Area | GL.iNet, uplink, WAN |
| Modal | Dave's agent · Clips to Dave | Modal (alone), sync, ingest |
| the rest | River recorder · People counter (planned) · Studio chat, the agent · Calibrate (verb), the LED map (result) | ffmpeg, Claude, session, pixelmap, Gray code |

**Sentences.** Sentence case. Banned in any headline, summary, chip, action or control reason (the model's test enforces it): fps, TCP, SSH, VNC, RTSP, PSAC10, probe, OSError, Art-Net, WMI, HTTP, JSON, null, undefined, epoch, toe, "deployed", step ids, a trailing "?". A number in a summary only when it *is* the reason; settings with units ("100 %"); measurements in the detail; ages always. 24-hour Pacific, "today / yesterday"; durations from one `dur()`. One arrow, "→", only for the path to a control. Reasons are chosen upstream-first (bitcube online? check answered? TouchDesigner answering? which file? internet?), never guessed. The headline's first top-level ":" or ";" splits it into a big cause and a smaller consequence, never inside parentheses.

**Controls:**

| | Wording |
|---|---|
| Before | verb + object, the current state lit, one line of effect and duration: "Dark sends black to all 20 ropes; they follow within a few seconds. Dark asks first." Impossible: greyed, with "Not possible now: bitcube is offline" **above** it. |
| Confirm (ropes Dark, Panels off, Switch now, lighting port, boot file, Rules reset, Calibrate, Rebuild, Log out) | a bottom sheet naming the cost, full-width stacked 48 px buttons, the costly one first in its colour: "The ropes in the gallery go black now. [Go dark] [Keep showing the river]". Mode and target changes don't confirm but say "takes over by hand". |
| Progress | "Sending to bitcube…" on the control, siblings disabled; "Restarting on the river's year, about 50 s left". |
| Result | on the control with the time ("Dark since 21:04") and on the band as "Last done: Ropes → Dark · 21:04 · from mission control" (never a name). Failure in words: "The ropes are unchanged: bitcube didn't answer (21:04). Try again, or check Status." A failed Apply keeps what you typed. |

**Who to call:** "Call Lilian (the lights and the rigging)" as the band's second-loudest line, bold, accent-coloured, ≥ 48 px, a tel: link when the number is known. Deliberate states: "If unsure, ask Colin (how the piece should look)". Coming up and not checked: "Nobody to call yet: wait and look again". The page-can't-reach cause names mission control and the Mac mini, not bitcube.

**Errors** name the thing and the next step: "The river's year page didn't answer in 4 s: TouchDesigner may be busy; try again in a minute." The raw text goes to "Addresses and links (for Will)" as "raw: fetch failed".

## Design tokens

Light by default; dark follows `prefers-color-scheme` (guarded by `:root:not([data-theme="light"])`) and `:root[data-theme="dark"]` for the menu's remembered override. Contrast is measured against the panel (90 % opaque, so the art never lowers it).

| Token | Light | Dark | Contrast light / dark |
|---|---|---|---|
| `--bg` · `--panel` | #f4f1ea · rgba(255,255,255,.9) | #0e141a · rgba(22,30,38,.9) | |
| `--text` · `--muted` | #1c2228 · #566069 | #e4e9ee · #a9b4bf | 16.0, 6.4 / 13.6, 7.9 |
| `--accent` (links, lit controls, Call) | #1e5f7d, ink #fff | #7cc3e8, ink #0b1a24 | 7.0 / 8.6; ink on fill 7.0 / 9.1 |
| `--ok` fill · ink · soft · text-on-soft | #1b6e3a · #fff · #e1f1e6 · #155a2f | #2fae62 · #06140b · #10301d · #9fe0b7 | ink 6.3 / 6.6 · on soft 7.1 / 9.4 · mark 6.3 / 5.8 |
| `--warn` | #f2b233 · #1c2228 · #fff0cc · #6b4500 | #f0b429 · #1d1500 · #3a2a06 · #ffd87a | ink 8.6 / 9.7 · on soft 7.5 / 10.1 · mark 1.9 (ring) / 8.9 |
| `--down` | #b9372a · #fff · #fbe1dc · #8a2419 | #ef6a57 · #1e0905 · #3f1711 · #ffb3a7 | ink 5.8 / 6.3 · on soft 7.2 / 9.1 · mark 5.8 / 5.4 |
| `--unk` | #5c6670 · #fff · #e8ebee · #3c454e | #8a949e · #10151a · #262d34 · #c3cbd3 | ink 5.9 / 6.0 · on soft 8.1 / 8.5 · mark 5.9 / 5.4 |

Every text pair is above 4.5:1 and every mark above 3:1 except the amber mark on a light panel (1.9:1), so **every mark is a 20 px filled circle with a 1 px `--text` ring** and its glyph. A chip is mark + word. The band shows its level as the chip, a 6 px left border and a soft tint; its text stays full `--text`, never tinted. Band, chips, buttons and sheets are fully opaque.

**Type** (system sans, 1.45): headline cause 27 px (30 wide) bold; consequence 18 semibold; season word 30; body 16; secondary 15; eyebrows, tab labels, captions 14, the floor. **Spacing:** 16 px gutter and card padding, 12 px gaps; header 60, tab bar 64 + safe area. **Radii:** cards 16, buttons 12, chips 999. **Targets:** buttons and tabs ≥ 48 px, rows and links ≥ 44, ≥ 12 px apart; steppers, never bare sliders; `overflow-x: clip`, no `nowrap`. **Icons:** inline SVG favicon, `icon-192/512.png`, a web manifest.

**The river art,** pure CSS and inline SVG (no images, no build step), three fixed layers behind everything, `pointer-events: none`:

1. *Wash:* two large radial gradients in the season's tints over `--bg`, opacity .2 light / .22 dark, a 2 s fade between seasons. Light: winter #d6e4f0/#edf2f6, spring #cfe6d6/#cce0de, summer #efdfae/#f3e7c8, autumn #e9d6ba/#e3c8b2, unknown #dde3ea/#e6e8ec. Dark: #182a3c/#1c2b37, #133029/#143236, #322c14/#372e17, #35251a/#38241a, unknown #172029/#1a222c.
2. *Flow lines:* seven long bezier paths (`viewBox 0 0 2400 1000`, `preserveAspectRatio: none`, 1.4 px, non-scaling stroke) in the season's line colours, opacity .3 / .22, drifting ±30 px over 120 s. Light: winter #8fb9e0/#cfe2f2, spring #4fae82/#3c9a95, summer #d4a63c/#ecd07f, autumn #c17f3d/#b05a30. Dark: #8db6dc/#cfe3f5, #5fcf9c/#49b8af, #e9b94a/#f6d57e, #d08c48/#c26a3b. Unknown: slate #6f87a3/#8ea3bb.
3. *Ripples:* three blurred (26 px) radial blobs, opacity .24 / .18, drifting about 1 px/s over 46–70 s.

The palette blends from `show.weights`, so the page itself tells the season (slate when unknown); it never follows the state. Thin translucent lines and text only on panels keep autumn's rust from reading as a red band and summer's gold as amber. `prefers-reduced-motion` stops every animation; the art stays, still.

## Page specs

### Status

Top to bottom on a phone; every value is a model field.

| Section | From | Shows | Opens to | Loading, stale, empty |
|---|---|---|---|---|
| Lost-contact banner | `overall.cause === 'page'` | grey: "No contact with mission control for 35 s. Everything below is as it was at 11:57; the controls are off until it answers." | | header amber "No answer for 15 s" from 12 s, red from 30 s; marks grey, strips desaturated, the still kept with "No newer picture" |
| Verdict band | `overall` | chip · cause / consequence · detail · WHAT TO DO · jump button · Call line · "Also: …" · "Checked from bitcube 23 s ago · next in about 40 s · Check now" · "Last done: …" | Check now re-runs the full check | first load: "Connecting to mission control…"; OK: "Nothing to do." once, quietly |
| Season card | `show.season/mode/intensity/weights/file` | the season as one big word, the mode in words ("The clock turns the year, one season a minute"), the four-season strip with a ring marker, the intensity bar and word; under the live river, "The live river, not the river's year" + Switch now | "Steer the year" (folded): mode (Dynamic greyed with its why), targets greyed until Manual, Rules with Apply / Reset (confirm) | "Season not known · Behind bitcube, which is offline" |
| Ropes tile | `show.ropes.{state,words}` | eyebrow, mark, a state word ("Showing the river" / "Dark on purpose" / "Not getting the river" / "Not connected"), the sentence | "On · showing the river \| Dark" with the current state lit (Dark confirms); the sender's words; both box rows; watts only while the sender is open; "See every LED → Lights" | Unknown with the reason |
| Panels tile | `show.panels.{state,words,brightness}` | "Showing the river at 100 %" / "No panel sender" / "Picture frozen" | "now 100 %" readout, ±10 % stepper, "Set 90 %", "Panels off" (confirm); greyed with the reason when frozen | |
| The room | `/api/camera/gallery.jpg` | a 132 px strip, "Gallery camera · 28 s ago · tap to enlarge" | full size in a sheet | dims past 2 min; "bitcube is offline, so no picture" / "the gallery camera isn't answering" |
| Not OK | `problems[]`, `items[]` by `cause` | heading without counts; one card per cause: mark · name · state word · summary · "from bitcube · 20 s ago" · "for 9 min"; ≥ 3 unknowns fold into "12 things can't be checked · Behind bitcube" | the detail; an amber WHAT TO DO box; the control that fixes it; Dave's card adds the clip ages and whether tonight's file uses the scene; "Addresses and links (for Will)": address, checked from, raw error, the link word, "Show on the system map" | open rows survive re-renders |
| N things fine | the OK items | one collapsed line, the people counter muted last | the same rows | an Unknown never sits under Fine |
| Installer | `controls.lightsroute/bootfile` | hatched, tool icon, "changes cabling settings": the lighting port and the boot file (both confirm), "Calibrate the lights → Lights" | | |
| Footer | | System map (for engineers) · Show files · Install guide · The plan | | |

The jump button is keyed on `overall.cause`: ropes-dark → "Ropes → On"; td-frozen, td-slow, online-file, river-stale → "Switch now"; panels-off → "Panels brightness"; gallery-cam, no-internet, router, river-site, lights, box, sender → "Open <card> →"; coming-up, not-checked → "Open the studio chat". `/api/status` every 5 s; `derive(last, last.now + elapsed since receipt)` on every render; ages tick every second without re-rendering rows. Controls POST `/api/control/<action>`; a non-2xx or `ok: false` is a failure.

### Lights

- **State line:** `show.ropes.words` · `show.panels.words` · "from bitcube · 20 s ago".
- **The still** fills the width; a canvas over it draws the map in normalised coordinates, `x = u × W`, `y = (1 − v) × H` (the map's `v` runs bottom → top; drawn by ratio, never by pixel). Each rope is a polyline through its 400 points: **visible** points are 3 px dots with a 1 px dark halo, **filled** points the thin line between.
- **Map \| Live.** Map: each rope in its own hue, numbered at its plug end (`px 0`); quad 1 outlined from `hub75_quad1`, quads 2–4 "not located yet". Live: each LED in the colour TouchDesigner is sending it, each quad filled with its panel image; the default while frames flow; polls `/api/lights` every 10 s only while this tab is open.
- **20 rope chips:** "box 1 · OUT 3", "99 of 400 seen", found / not found at calibration / dark now; a tap highlights the rope.
- **Rope by rope:** B's 20 strips (plug end at the top) and the four quads, the Live view when no map matches this camera; black outlined strips when dark on purpose; "Can't show the lights: TouchDesigner isn't answering" when frozen; dims after 30 s without a frame.
- **Provenance:** "Map made 18 Oct 15:46 · 18 of 20 ropes · camera drift 13 (fine)"; amber when it doesn't match: "This map was made at Agape; it doesn't match the gallery camera here. Calibrate to make a new one."

**Data contract.** `GET /api/pixelmap` → the newest `tools/pixelmap/pixelmap-<date>.json` as `lib/lights.mjs` serves it: `{ file, modified, meta { capture, camera, frame_size, drift }, ropes { '0'…: { visible, filled } }, points [{ rope (0-based), px, u, v, visible }], hub75_quad1 { tl, tr, br, bl } }`. `GET /api/lights` → `{ ok, age_s, frames: { at, source, brightness, ropes { w: 20, h: 400, rgb (base64; row 0 = plug end, column c = rope c+1) }, panels { w: 256, h: 32, rgb } (the 1024 × 128 atlas downsampled 4×: four 64 × 32 quads side by side) } }`, or 503 `{ ok: false, error }` in plain words. One shape in both modes.

### Calibrate

An installer-styled block under the map, linked from the Ropes card and the Installer section. Needs TouchDesigner on the show file, the ropes hung and powered, the camera fixed, the room dark.

| State | The block says |
|---|---|
| Before | "Finds where every LED and the panels are, using the gallery camera. The ropes flash black-and-white patterns for about five minutes (the show is interrupted) and come back by themselves." A live checklist from the model: ✓ TouchDesigner answering · ✓ both rope boxes answering · ✓ the gallery camera reachable · the room dark and nobody in view (you check); the button is disabled with the failing one named. |
| Confirm | "Start calibration? The ropes go into patterns now, for about five minutes, and the show stops meanwhile. Keep people out of the camera's view. [Start] [Not now]" |
| Progress | one card from the progress file bitcube writes after every step: the stage in words (Capturing the ropes → Decoding → Capturing the panels → Finding the panels → Done), "Pass A: pattern 12 of 29 · retakes 1", a bar from `elapsed_s / expected_s`, "about 4 min left", a red-tinted "Stop and restore the ropes". The Status band shows Attention: "Calibrating the lights: the ropes are in patterns for about 4 more minutes." |
| Stopped | "Stopped; the ropes are back on the river. No map was written." If the job had to be killed (`forced`): "the ropes may still show a pattern: press Ropes → On". |
| Result | stays until dismissed: "Map made 23 Oct 21:14 · 18 of 20 ropes found · ropes 9 and 17 not found (dark) · 2,103 LEDs seen, the rest placed along the rope · camera drift 13 (fine) · panel quad 1 found. The show file still uses the old map until it is rebuilt." Then **"Use this map: rebuild the show file"** (confirm: "Bakes the new LED map into the river's year and restarts TouchDesigner on it: about a minute dark") or "Keep the old map". Never automatic: a map made with a moved camera gets looked at over the still first. |
| Failure | "TouchDesigner isn't answering: calibration can't start" · "The gallery camera isn't reachable: calibration can't start" · "A calibration is already running" · "The camera moved during the run (drift 48): the map was not saved. Fix the camera and run again" · "Patterns never agreed (people kept walking through): the map was not saved. Run again when the room is empty" · "bitcube went offline during the run: the ropes may still be in patterns; they come back when TouchDesigner reloads" · "Decoding failed: <reason>; the ropes are back on the river". |

**Fixture mode:** the server serves the 18 Oct map, the Agape frame `docs/img/rope-map-2026-10-18.png` as the gallery still (same camera aim, 16:9), synthetic season-coloured frames, and a scripted run in the progress file's exact shape (two passes of 29 with one retake, decode, panels, a result; about 60 s instead of 5 min), with `?calib=drift` to end in the drift failure.

### Studio chat

- **Pinned status bar** above the composer, from `studio.status()` and the SSE `status` events: "Ready" / "Working on: 'Turn the ropes dark' · 0:42" (animated mark) / "2 waiting"; a fixed red-tinted ≥ 48 px **Stop** ("Stop, and clear the queue" when something waits).
- **One card per request** with a chip: Waiting (2nd in line) · Working · Done 21:04 · Stopped · Failed: bitcube didn't answer (link to Status). Replies render under their own request, markdown kept; activity lines in plain verbs ("looked at bitcube", "changed the ropes"), acting lines highlighted.
- Banner "Everyone shares this conversation; say who you are"; timestamps and day dividers; after a reconnect, "Connection lost · 2 requests ran while you were away", the gap re-fetched from `/api/chat/history`. On touch, Return makes a new line; only Send sends. A control used from the chat shows on Status as "Last done: … · from studio chat" (never a name, MD4).

### System map (engineers)

B's chain on its own page: inputs (gallery camera, river camera, internet + router) → bitcube (TouchDesigner as its own box) → outputs (ropes with both boxes, panels, Dave's agent). Each box shows **its own item**, never the worst of a bundle; clips to Dave sit on the arrow to Dave's agent. Link pills: "no answer", "no frames", "no internet", "not driven", "picture frozen", "sending black", "clips failing", "sync quiet", "not known". One legend; greys with "· last answer" when stale; a tap opens the card's "Addresses and links". The existing diagram follows.

## Server changes needed

Already on the branch: `model.js`; `lib/lights.mjs` (frames, pixel map, calibrate start/cancel/status with a whitelist and caches); `tools/mission/calibrate.py` + `calibrate.ps1` (the pipeline as a detached job with a progress file, a lock, cancel-and-restore, `--dry-run`, `--decode-only`); `frames.ps1` and `td_mission.py frames`; `probe.ps1` reporting `calibration` and `pixelmap`; `lib/history.mjs`. Still to do:

1. **Routes:** `GET /api/lights` in real mode via `Lights.frames()` (today 503); `GET /api/pixelmap`; `GET /api/calibration` (cached 3 s, polled every 5 s only while a run is on); `POST /api/control/calibrate { action: start | cancel, dry_run }` through `planCalibrate`; `POST /api/control/check` (the full check now); `POST /api/control/rebuild`. Tests; 401 without the cookie.
2. **History wired:** `History.observe()` after every poll, `.action()` after every control (source: mission control or studio chat); `/api/status` gains `since` (`summary()`); `GET /api/history` for the menu's Recent.
3. **Contacts:** `<state>/contacts.json` (untracked, like the password) → `GET /api/contacts` → tel: links; names and ownership stay in `model.js`.
4. **Fixture mode:** one `/api/lights` shape (wrap `renderLights` in the `frames` contract); the 18 Oct map and the Agape frame as the Lights still; the scripted calibration with the drift flag; keep the log-line rebase fix; freeze the fixtures' hour so Dave's overnight rest stops reading "hasn't ticked for 3 h" by day.
5. **bitcube, small:** `calibrate.py` parses capture.py's "pattern i of N" and retakes into `step`, `of`, `retakes`; a `rebuild` action (run `td/build/build_seasons_local.py` through `tools/td.ps1` with the river's year open, save, then the existing `switch`); the drift threshold that fails a run (default 30 px) as a flag.
6. **Studio:** request ids on `started` / `done` events so cards can pair replies; a `failed` event with a plain reason.
7. **Static:** `/status`, `/lights`, `/chat`, `/map` from `public/`; `proto/` deleted after the cutover; manifest and icons.

## What we are not doing

- **The signal chain on the first screen** (B): it pushed the season, ropes and panels out of the fold and truncated its text; it is the engineers' map.
- **A feed as the landing body, or a localStorage history** (C): ticks and chat excerpts compete with the verdict, and two phones would disagree; the server's history gives "since" and "last done".
- **"Since at least HH:MM"** on a first load: it reads as the fault's onset.
- **Box-level "worst of a bundle"** (B): it blamed the wrong piece in 9 of 13 scenarios.
- **Counts in headlines or section labels, every unknown as its own row, 13 px explanations, two-line clamps on the band, side-by-side confirm buttons, 32–40 px targets, muted dark chips.**
- **Polling frames from the Status page:** battery and Funnel bandwidth for a picture the five-second question doesn't need.
- **Automatic rebuild after a calibration:** a map made with a moved camera would be baked in.
- **Phone numbers in the repo; names on chat actions** (MD4); a framework or a build step; the map in an iframe; pinch-to-zoom on the map; quads 2–4 (planned, step S5).

## Build plan

Harness, from `~/claude/local/ui-shots`: `node shots.mjs --base http://127.0.0.1:8792 --pages status,lights,chat --viewports iphone,ipad,desktop --themes light,dark --fold fold,full --out shots/v2-<step>`. A page is done only when every PNG has been looked at and every scenario reads as its fixture's `expect`. Controls are only ever POSTed to 8792.

| # | Step | Done when |
|---|---|---|
| 1 | Server: routes, history wiring, contacts, fixture fakes, one `/api/lights` shape, fixtures' hour frozen | `npm test` green; every route answers in all 13 scenarios on 8792; real mode answers 503 with a plain reason where bitcube hasn't been OK'd; 8790 untouched |
| 2 | Shared shell: `v2.css` tokens, art layers, header, tab bar, menu, sheet and confirm, theme override, icons and manifest | shot on iphone/ipad/desktop in both themes; a contrast script over every token pair passes; 390 px wide, no overflow; reduced-motion stops the art |
| 3 | Status from prototype A with the grafts (banner, state words on tiles, Call line, jump by cause, Last done, since, Dave's card, WHAT TO DO boxes, panel readout, 14 px floor, no counts) | 13 scenarios × 3 viewports × 2 themes read right; controls walked before/confirm/pending/done/failed; stale at 12 s and 35 s; slow first load |
| 4 | Lights: map over the still, Map \| Live, chips, quads, strips, provenance, Calibrate with the fixture fake, rebuild step | the Agape map lines up on the Agape frame (v flipped); every Calibrate state captured (idle, can't start, confirm, progress, stopped, forced stop, result, drift and decode failures, bitcube offline mid-run), both themes, all viewports |
| 5 | Studio chat v2 | ready / working / 2 waiting / stop / failed / reconnect captured; Return makes a new line on touch |
| 6 | System map page with B's chain and legend | td-frozen, bitcube-offline, no-internet, lights-not-connected read right; grey when stale; no box blames a bundle |
| 7 | Login and menu: contacts with tel:, Recent, Check now, theme, Log out confirm | login with and without a contacts file; Recent lists the fixture's actions |
| 8 | Cut over: `/status` replaces the old pages, `proto/` removed, the docs index links this page; Gavin restarts the live service | the live pages on 8790 read right for the real situation (GET only); old URLs redirect |
| 9 | bitcube first runs, gated by Gavin: a `calibrate` dry run from the portal, a real run at Gray Area after dark, then Rebuild | the progress card follows the real file; the new map lines up on the Gray Area still; ropes 9 and 17 reported as the capture found them |

## Which problems each part addresses

| Part | Problems |
|---|---|
| Verdict band and the model | P1, P5, P8, P9, P10, P19, P20, P41 |
| What to do, Call line, jump buttons, login contact line | P2, P35, P42 |
| Landing layout, tiles, collapsed fine list, tab bar | P3, P12, P17, P29, P43 |
| Freshness: header age, per-card phrase, banner, grey when stale, Check now | P6, P21, P30 |
| Unknown folds and reasons | P16 |
| History: since and Last done | P39, P40 |
| Controls on the thing, confirm, pending/result/failure, readouts | P4, P7, P11, P31, P32, P44, P45, P46 |
| Names and copy rules | P18, P33, P37 |
| Tokens, 14 px floor, 48 px targets, dark theme, icons | P22, P36, P38 |
| Card details for Will, Dave, Andi | P14, P15, P34 |
| System map page | P26, P27 |
| Studio chat | P23, P24, P25 |
