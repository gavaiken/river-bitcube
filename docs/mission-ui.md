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
| The page is stale | 30 s since the last answer (on every page, from one rule in `ui.js` `watchContact`, so a request that hangs counts as surely as one that fails): band Unknown, every item stale, every control off, the lost-contact sentence on Status, Lights and the System map. A request is abandoned after 8 s; coming back to the tab drops a hung request and asks again. Elapsed time is the larger of the phone's monotonic and wall clocks, so a phone that slept never reads an old answer as new (the same for the Live frame, the room and gallery stills and a calibration's time left; the Live map dims while contact is lost). The verdict flips by the same unrounded > 30 s rule as the header, in the same second. Before the first answer the header says "No answer yet · 13 s", counted from when the page started asking (amber from 12 s, red from 30 s), never "Updated N s ago" |
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
| Ropes (the sender) | open, `source` canvas | `source` black ("dark on purpose"); a sender error or a silent box while the other answers; TouchDesigner slow | sender error with both boxes unreachable ("the lights aren't connected"; 10049: "bitcube's LIGHTS port has no link"); 10048, another program holding the ropes' connection (Will's rope lights): "Another program on bitcube is using the ropes' connection", call Gavin, never the cable advice (cause `sender-taken`); both boxes silent; TouchDesigner frozen ("not being driven") |
| Rope box 1, 2 | `devices.psac10_1/2` answers | | no answer, folded under the ropes |
| Panels | `displays` reads LED, output on, brightness > 0 | TouchDesigner frozen ("picture frozen"); output off or brightness 0 | no LED display (no panel sender on bitcube's HDMI); with the boxes down, part of "the lights aren't connected" |
| Gallery camera | `devices.gallery_cam` | | port closed (band: Attention, "the show itself is unaffected") |
| River camera (the river site) | reachable; live file: fresh frames | live file, `river_cam.fresh` false ("no frames for 30 min: the rain fallback") | port closed (band: Attention; "unreachable: no internet" when the uplink is down) |
| Router · Internet at Gray Area | answers · bitcube reaches 1.1.1.1 | | not answering (owns the internet, the gallery camera) · no internet (band: Attention; owns clips, the river camera, the recorder) |
| Dave's agent | ticked on schedule, or resting overnight | unreachable, `ok` false, or late ("hasn't ticked for 9 h"); first among warnings under the live river | |
| Clips to Dave | processes > 0, both clip lines fresh | not running; one camera's clips failing (owned by that camera or the internet when down); nothing back from Dave's agent while it is overdue. Never judged from a stale full check: then only "hasn't heard from bitcube" is known, and it heads the band over any warning read from that same old check | both cameras' clips failing |
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

**Since when** comes from the server (`lib/history.mjs`, transitions only), in duration form so a first sighting never reads as the fault's onset: "Down for 9 min", "for over 2 h". Never the page's own watch start. A "since" is hidden when it would contradict the words beside it: longer than bitcube has been up (for what bitcube reports), a first sighting ("over …") next to a duration the headline or summary states itself, or shorter than that duration. A failing source keeps when its failures began (`failing_since`), so "its full check has failed for 52 min" grows. On a row from a last answer (stale, or contact lost) the since stops where the item was last seen: "Down for over 24 min when last seen", never a duration nobody observed.

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
| Confirm (ropes Dark, Panels off, Switch to …, lighting port, boot file, Rules reset, Calibrate, Rebuild, Log out) | a bottom sheet naming the cost, full-width stacked 48 px buttons, the costly one first in its colour: "The ropes in the gallery go black now. [Go dark] [Keep showing the river]". **Focus starts on the safe one**, so a second Enter or a screen reader's double-tap never confirms; the dialog is named by its title and described by its body. Mode and target changes don't confirm but say "takes over by hand". |
| Progress | "Sending to bitcube…" on the control, siblings disabled; "Restarting on the river's year, about 50 s left". |
| Result | on the control with the time ("Dark since 21:04") and on the band as "Last done: Ropes → Dark · 21:04 · from mission control" (never a name). Failure in words: "The ropes are unchanged: bitcube didn't answer (21:04). Try again, or check Status." A failed Apply keeps what you typed. A top-level `ok: false`, or (ropes, panels) `td.ok: false`, is a failure; a 2xx that isn't mission control's JSON, or a POST answered by a proxy's error page, is unconfirmed ("it may or may not have happened"), never "unchanged"; "mission control didn't answer" only when the request itself failed, "bitcube didn't answer" when mission control answered that its call failed. Focus stays on the control across re-renders; one page-level polite live region says pending / done / failed. A request is given up a little past the server's own limit (75 s; 7 min for a rebuild): "No answer in 1 min: it may or may not have happened; the Now line shows what bitcube reports (21:04)." and the buttons come back (never "unchanged": it may have happened). Raw text never reaches the screen: an exit code, a script or file name, a traceback or a 400's reason reads as "bitcube couldn't do it" or "mission control didn't accept it"; a slip in mission control's own code (a JavaScript message such as "Cannot read properties of null") as "mission control couldn't do it"; an error answer that isn't mission control's JSON (a proxy's 502 page while the server is down) as "mission control didn't answer"; the river's year page's own refusal in the rules' words ("Quieter than usual must be below Busier than usual; change one and apply again"); a 429 from Check now as "the full check ran a moment ago; try again in 20 s". A control body that is not a JSON object is refused (400) before it runs or is recorded. While bitcube is offline, Check now reads "Try bitcube again" (it re-runs the quick check). |
| Exclusive | see "Applying a change": a conflicting request answers 409 "wait: <label> is being applied (started 21:04)" (`lib/applying.mjs` `BLOCKS`). While a calibration runs, the ropes, the panels, the show-file switch, a rebuild (it ends in a switch) and the lighting port are impossible ("a calibration is running: stop it on the Lights page first"), on the pages and on the server (409), so a request from the chat can't spoil the run; the server takes the run's state from Lights' own answers and reads its progress every 5 s while it runs, so the lock holds from the first second. A 409 is not recorded in the history. |
| A confirm left open | a control keeps its own state across re-renders (it is updated, never re-mounted, so Stop keeps "Asking bitcube to stop…" and "It didn't stop" while the run's patterns move on); judged again when it is answered: a control that became impossible meanwhile (bitcube went offline, contact lost, a run ended, a calibration began) sends nothing and says "Not sent: bitcube is offline (21:04)." An open confirm is withdrawn the moment its control becomes impossible, with the same words; focus then goes to the control's status line, never to the page. |
| Names in a confirm | the button's own words: the show-file control says "Restart on the river's year" when it runs and "Switch to …" otherwise, and its confirm and the advice that points at it say the same ("press Restart on the river's year"). |

**Who to call:** "Call Lilian (the lights and the rigging)" as the band's second-loudest line, bold, accent-coloured, ≥ 48 px, a tel: link when the number is known. Deliberate states: "If unsure, ask Colin (how the piece should look)". Coming up and not checked: "Nobody to call yet: wait and look again". A calibration: "Nothing to call about: this was started on purpose". The page-can't-reach cause names mission control and the Mac mini, not bitcube.

**Errors** name the thing and the next step: "The river's year page didn't answer in 4 s: TouchDesigner may be busy; try again in a minute." The raw text (error strings, log lines, file names, addresses) goes to "Addresses and links (for Will)" as "raw: fetch failed" (`item.raw`), never into a summary or a detail.

**Screen readers.** Live regions carry a level word and a headline, never a ticking age: the header's age is not live; the band and the Lights state line each have a hidden polite region with the words only; the System map's lost-contact banner ticks and so is not live: a hidden region says "No contact with mission control." once and clears on return; the chat thread is a `role="log"` patched in place (only new cards are announced; it starts `aria-busy` and the first load is not read out), each card is named by its request, a "Write a request" skip link leads to the box, and the pinned bar's state word has its own hidden region. The login's failure is said once by a hidden alert ("Wrong password. Wait 4 s, then try again.", then "You can try again now."); its visible countdown is not live. The band's "Also" items and each problem group's header carry the level word for a screen reader ("Down: …"), and the group headers are h3s, so heading navigation goes problem by problem. From 900 px the tab pill follows the header in the focus order, as it is drawn. Every `›` chevron is `aria-hidden`; repeated links are named ("Show TouchDesigner on the system map"). Pages without the verdict h1 have the page title as h1 and section labels as h2. The current tab has a bar and a heavier label, not colour alone; on the System map (no tab of its own) Status is marked as its parent. The engineers' diagram in the map's frame is out of the tab order (it holds 80 stops); keyboard users take "Open full screen".

**Before the first answer** every page says the same, by the header's thresholds from when it started asking: "Connecting…" under 12 s, "No answer yet · 14 s" (amber) to 30 s, then red and "This page can't reach mission control". The chat counts the same way and retries a failed load in place.

**Since when** comes from the server's history and restarts when an item's reason changes at the same level (running slowly for 2 h, then Ropes → Dark, is "Attention for 5 s"), not only its level; numbers inside one reason ("4 of 60 frames a second") don't restart it. Recent shows each change without the ages that were only true at the time ("bitcube is fine: online", not "…; up 3 h · 12 min ago").

**Logins never reach a page or the history.** A camera's RTSP address carries its login, and ffmpeg prints it when the camera fails: calibrate.py and capture.py strip it from every log line, and mission control strips any `scheme://user:password@` from what it stores and serves (`lib/scrub.mjs`).

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

**Type** (system sans, 1.45): headline cause 27 px (30 wide) bold; consequence 18 semibold; season word 30; body 16; secondary 15; eyebrows, tab labels, captions 14, the floor. **Spacing:** 16 px gutter and card padding, 12 px gaps; header 60, tab bar 64 + safe area (a landscape phone, under 500 px tall: header 48 and tab bar 48 with the icon beside its label; under 280 px wide, as at 200 % zoom, the wordmark goes and the header, the page title included, wraps at spaces only; the band's headline breaks inside a word only when one word can't fit). Studio chat under 300 px wide: the composer sits in the page after the thread instead of fixed over it, its state and Stop on one line (a landscape phone keeps it fixed, so Stop stays in reach). Amber chips on light surfaces get the 1 px dark ring the amber mark has. **Radii:** cards 16, buttons 12, chips 999. **Targets:** buttons and tabs ≥ 48 px, rows and links ≥ 44, ≥ 12 px apart; steppers, never bare sliders; `overflow-x: clip`, no `nowrap`. **Icons:** inline SVG favicon, `icon-192/512.png`, a web manifest.

**The river art,** pure CSS and inline SVG (no images, no build step), three fixed layers behind everything, `pointer-events: none`:

1. *Wash:* two large radial gradients in the season's tints over `--bg`, opacity .2 light / .22 dark, a 2 s fade between seasons. Light: winter #d6e4f0/#edf2f6, spring #cfe6d6/#cce0de, summer #efdfae/#f3e7c8, autumn #e9d6ba/#e3c8b2, unknown #dde3ea/#e6e8ec. Dark: #182a3c/#1c2b37, #133029/#143236, #322c14/#372e17, #35251a/#38241a, unknown #172029/#1a222c.
2. *Flow lines:* seven long bezier paths (`viewBox 0 0 2400 1000`, `preserveAspectRatio: none`, 1.4 px, non-scaling stroke) in the season's line colours, opacity .3 / .22, drifting ±30 px over 120 s. Light: winter #8fb9e0/#cfe2f2, spring #4fae82/#3c9a95, summer #d4a63c/#ecd07f, autumn #c17f3d/#b05a30. Dark: #8db6dc/#cfe3f5, #5fcf9c/#49b8af, #e9b94a/#f6d57e, #d08c48/#c26a3b. Unknown: slate #6f87a3/#8ea3bb.
3. *Ripples:* three blurred (26 px) radial blobs, opacity .24 / .18, drifting about 1 px/s over 46–70 s.

The palette blends from `show.weights`, so the page itself tells the season (slate when unknown); it never follows the state. Thin translucent lines and text only on panels keep autumn's rust from reading as a red band and summer's gold as amber. `prefers-reduced-motion` stops every animation; the art stays, still.

## Applying a change

Every control is pessimistic: nothing on screen claims a change until bitcube's own reading shows it. The same pattern on every page, every phone and the server (Gavin, 25 Oct: "standard UX patterns for async tasks and blocking editing settings while a change is being applied").

**States of one control** (`ui.js control()`, and status.js `runControl` on the same rules):

| State | When | On screen |
|---|---|---|
| ready | nothing in flight | the button, its one-line effect, the current value |
| blocked | the model says it can't run now (offline, a calibration, **another change being applied** anywhere) | greyed (dashed, full opacity), "Not possible now: <why>." *above* the buttons; inputs disabled too |
| confirm | a costly change was pressed | the sheet names the cost; focus on the safe button. Withdrawn (with "Not sent: <why>") if the control becomes blocked while it is open; focus then goes to the control's status line, never to the page |
| applying | the POST is in flight | spinner + "Applying: <what>…"; the control, its siblings **and its inputs** disabled; the host `aria-busy="true"`; long changes (expected over 20 s: switch, rebuild, calibrate) show elapsed m:ss and the usual time ("usually about 1 min") |
| confirming | the POST answered OK, but the change is only real when the reading shows it (switch: TouchDesigner answering on the new file; rebuild: the map in use; boot file: the boot file the probe reports) | "Sent · waiting for bitcube to show it · 0:34"; still locked |
| done | the reading shows it (or, for a control whose own answer is bitcube's reading: ropes, panels, mode, target, rules, the answer itself) | "Now <state> · 21:04"; inputs unlock; drafts clear |
| unconfirmed | no confirming reading within the limit (3 × the usual time, at least 2 min) | "Sent at 21:04, but bitcube doesn't show it yet: look at the Now line, or call Gavin." Unlocks. Never "unchanged" |
| failed | refused or failed | "<thing> unchanged: <reason in words> (21:04). Try again, or check Status." The draft stays; focus stays on the control |

One page-level polite live region announces applying, done, unconfirmed and failed once each; ticking times are never announced.

**Locks across phones.** The server records every control in flight in `status.applying`: `[{ id, action, label, file?, started_at, expect_s, blocks: [action…] }]` (`label` is team words: "the switch to the live river", "a rebuild of the river's year", "the boot file change", "a ropes change", "a panels change", "a mode change", "a target change", "a rules change", "a lighting port change"; `started_at` is the server's clock). An entry is removed when its request ends, success or failure. A POST that conflicts with an entry gets **409** `{ ok: false, error: "wait: <label> is being applied (started 21:04)" }`; the pages show the server's words as they are. The model turns each entry into `controls.<name>.why = "wait: <label> is being applied"` for every action in its `blocks`, on every phone, from the next `/api/status` (a page that just sent a change refreshes at once). What blocks what:

| In flight | Blocks |
|---|---|
| switch, rebuild | everything that touches TouchDesigner or the year: ropes, hub75, mode, target, rules, rules-reset, lightsroute, switch, rebuild, bootfile, calibrate |
| bootfile | switch, rebuild, bootfile, calibrate |
| lightsroute | ropes, hub75, lightsroute, calibrate |
| ropes, hub75, mode, target, rules, rules-reset | the same action (two phones changing one thing at once) |
| a calibration starting (the start request) | ropes, hub75, switch, lightsroute, rebuild, calibrate |
| a calibration running (`calibration.running`, not stale) | ropes, hub75, switch, lightsroute, rebuild (`CAL_BLOCKED`); and a calibration can't start while a switch, rebuild or boot-file change is in flight. Stop is never blocked |

The server takes a started calibration's state from Lights' own answer at once (the probe's copy is up to a minute old), so the lock holds from the first second of the run, on the server and in `/api/status`.

**Forms** (Rules, Target, panel brightness): the unit sits beside every box ("240 s"); a value outside the range says so under its box ("Must be 60 to 1800 s") with `aria-invalid`, and Apply stays disabled; Apply is enabled only when something changed and everything is valid, and says how many ("Apply 2 changes"); the inputs lock while applying; a failure keeps what was typed; a confirmed change clears the draft. Another phone's change arriving while you edit never overwrites what you typed: the box keeps your draft and shows "now N on bitcube" under it.

**Requests never hang the page**: every fetch (status, calibration progress, the LED map, stills, frames) has a time limit; a page that couldn't read something asks again on its own (the next good answer, or every 30 s) and says "hasn't loaded yet", never "there is none".

## Page specs

### Status

Top to bottom on a phone; every value is a model field.

| Section | From | Shows | Opens to | Loading, stale, empty |
|---|---|---|---|---|
| Lost-contact banner | `overall.cause === 'page'` | grey: "No contact with mission control for 35 s. Everything below is as it was at 11:57; the controls are off until it answers." | | header amber "No answer for 15 s" from 12 s, red from 30 s; marks grey, strips desaturated, the still kept with "No newer picture" |
| Verdict band | `overall` | chip · cause / consequence · detail · "Checked from bitcube 23 s ago · next in about 40 s · Check now" (above WHAT TO DO, so Check now stays on the first screen of a phone in the busiest bands) · WHAT TO DO · jump button · Call line · "Also: …" · "Last done: …" | Check now re-runs the full check | first load: "Connecting to mission control…"; OK: "Nothing to do." once, quietly |
| Season card | `show.season/mode/intensity/weights/file` | the season as one big word, the mode in words ("The clock turns the year, one season a minute"), the four-season strip with a ring marker, the intensity bar and word; under the live river, "The live river, not the river's year" + Switch now | "Steer the year" (folded): mode (Dynamic greyed with its why), targets greyed until Manual, Rules with Apply / Reset (confirm) | "Season not known · Behind bitcube, which is offline" |
| Ropes tile | `show.ropes.{state,words}` | eyebrow, mark, a state word ("Showing the river" / "Dark on purpose" / "In calibration patterns" (Attention, while a calibration runs: never "Showing the river") / "Not getting the river" / "Not connected"), the sentence | "On · showing the river \| Dark" with the current state lit (Dark confirms); the sender's words; both box rows; watts only while the sender is open; "See every LED → Lights" | Unknown with the reason |
| Panels tile | `show.panels.{state,words,brightness}` | "Showing the river at 100 %" / "In calibration patterns" (the panel stages) / "No panel sender" / "Picture frozen" | "now 100 %" readout ("Now 100 % (no panel sender, so dark)" without a sender), ±10 % stepper, "Set 90 %" ("Set brightness" while it isn't known), "Panels off" (confirm); greyed with the reason when frozen | |
| The room | `/api/camera/gallery.jpg` | a 132 px strip, "Gallery camera · 28 s ago · tap to enlarge" | full size in a sheet | dims past 2 min; "bitcube is offline, so no picture" / "the gallery camera isn't answering"; fetched again as soon as an answer arrives when the last try is over 30 s old (a phone waking with no network) |
| Not OK | `problems[]`, `items[]` by `cause` | heading without counts; one card per cause: mark · name · state word · summary · "from bitcube · 20 s ago" · "for 9 min"; ≥ 3 unknowns fold into "12 things can't be checked · Behind bitcube" ("13 things not checked yet" while the first check is still to come) | the detail; an amber WHAT TO DO box; the control that fixes it; Dave's card adds the clip ages and whether tonight's file uses the scene; "Addresses and links (for Will)": address, checked from, raw error, the link word, "Show on the system map" | open rows survive re-renders |
| N things fine | the OK items | one collapsed line, the people counter muted last | the same rows | an Unknown never sits under Fine; OK items from a last answer (an old full check, lost contact) count as "N more when last seen" with the grey mark, never a green ✓ (the room's caption too) |
| Installer | `controls.lightsroute/bootfile` | hatched, tool icon, "changes cabling settings": the lighting port and the boot file (both confirm), "Calibrate the lights → Lights" | | |
| Footer | | System map (for engineers) · Show files · Install guide · The plan | | |

The jump button is keyed on `overall.cause`: ropes-dark → "Ropes → On"; td-frozen, td-slow, td-off, online-file, old-file, river-stale, year-page → "Switch to the river's year", or "Restart on the river's year" when it is the file running (`yearPress()` in model.js, the same words as the advice); panels-off → "Panels brightness"; gallery-cam, no-internet, router, river-site, lights, box, sender → "Open <card> →"; coming-up, not-checked → "Open the studio chat". `/api/status` every 5 s; `derive(last, last.now + elapsed since receipt)` on every render; ages tick every second without re-rendering rows. Controls POST `/api/control/<action>`; a non-2xx or `ok: false` is a failure.

### Lights

- **State line:** `show.ropes.words` · `show.panels.words` · "from bitcube · 20 s ago". Its mark is the worse of the ropes and the panels (it speaks for both). Never green from a last answer: when the ropes item is stale (the same flag Status and the map use) or contact is lost, the mark is grey and the line says "last seen from bitcube 10 min ago". When the verdict isn't OK, the band's headline cause (split as Status splits it, never inside a parenthesis) and "What to do → Status" sit under it (Lights has no band of its own).
- **The still** fills the width; a canvas over it draws the map in normalised coordinates, `x = u × W`, `y = (1 − v) × H` (the map's `v` runs bottom → top; drawn by ratio, never by pixel, with one uniform scale). With no still behind it the view zooms to the box around the ropes and screens (the canvas takes the piece's aspect, clamped between 0.8 and the frame's); with a still behind it, the whole camera frame. Each rope is a polyline through its 400 points: **visible** points are 3 px dots with a 1 px dark halo, **filled** points the thin line between.
- **Map \| Live.** Map: each rope in its own hue, numbered at its plug end (`px 0`); the four screens outlined from the screens file (`screens-<date>.json`, estimated ones dashed and said so in the chip line; `hub75_quad1` alone means screen 1 and "not located yet" for the rest). Live: each LED in the colour TouchDesigner is sending it, each quad filled with its panel image (estimated screens marked ~, said in the legend); when the ropes aren't getting it or there is no panel sender, the map dims under "What TouchDesigner sends; the ropes aren't getting it"; the default while frames flow; polls `/api/lights` every 10 s only while this tab is open.
- **20 rope chips:** "box 1 · OUT 3", "99 of 400 seen", "Not known yet" until the LED map answers (after 30 s the map says "The LED map hasn't loaded: no answer for 33 s"), "Found at calibration" (a neutral grey ·, never a green ✓: it is not the rope's state now) / "Not found at calibration" (amber) / "Dark now"; a tap highlights the rope. On the map, a rope number moved off a crowd keeps a thin line to its plug end, and the screens' numbers are drawn over the ropes.
- **Rope by rope:** B's 20 strips (plug end at the top) and the four quads, the Live view when no map matches this camera; black outlined strips when dark on purpose; "Can't show the lights: TouchDesigner isn't answering" when frozen; dims after 30 s without a frame.
- **Provenance:** "Map made 18 Oct 15:46 · 18 of 20 ropes · camera drift 13 (fine)"; amber when it doesn't match: "This map was made at Agape; it doesn't match the gallery camera here. Calibrate to make a new one."

**Data contract.** `GET /api/pixelmap` → `{ map, screens, still }`: `map` is the newest `tools/pixelmap/pixelmap-<date>.json` as `lib/lights.mjs` serves it, `{ file, modified, meta { capture, camera, frame_size, drift }, ropes { '0'…: { visible, filled } }, points [{ rope (0-based), px, u, v, visible }], hub75_quad1 { tl, tr, br, bl } }` (bitcube's when the full check names a newer one); `screens` the newest `screens-<date>.json`; `still` null today. `GET /api/lights` → `{ ok, age_s, frames: { at, source, brightness, ropes { w: 20, h: 400, rgb (base64; row 0 = plug end, column c = rope c+1) }, panels { w: 64, h: 128, rgb, atlas: [256, 512] } (panel_out downsampled 4×: at Gray Area the four quads are stacked down the left edge, each the screen's portrait turned on its side, screens 3 and 4 row-swapped, screen 3 half-turned), screens { w: 128, h: 64, rgb, cells: 4 } (the four screens upright as seen, side by side: what the page draws, cell n on screen n) } }`; a bitcube without `screens` (td_mission.py before 24 Oct) is undone from the atlas by `public/screens.js`, and an atlas of four quads in a row (before Gray Area) is cut as it is, or 503 `{ ok: false, error }` in plain words. One shape in both modes.

### Calibrate

An installer-styled block under the map, linked from the Ropes card and the Installer section. Needs TouchDesigner on the show file, the ropes hung and powered, the camera fixed, the room dark.

| State | The block says |
|---|---|
| Before | "Finds where every LED and the panels are, using the gallery camera. The ropes flash black-and-white patterns for about five minutes (the show is interrupted) and come back by themselves." A live checklist from the model: ✓ TouchDesigner answering · ✓ both rope boxes answering · ✓ the gallery camera reachable · the room dark and nobody in view (you check); the button is disabled with the failing one named. |
| Confirm | "Start calibration? The ropes go into patterns now, for about five minutes, and the show stops meanwhile. Keep people out of the camera's view. [Start] [Not now]" |
| Progress | one card from the progress file bitcube writes after every step: the stage in words, the same as the Status band's (Photographing the ropes → Working out where each rope is → Photographing the panels → Finding the panels → Done), "Pass A: pattern 12 of 29 · 1 pattern photographed again", a bar from `elapsed_s / expected_s`, "about 4 min left", a red-tinted "Stop and restore the ropes" ("Stop the dry run" for a dry run, which touches no lights: "Dry run stopped; nothing changed."). "Rope N of 20" only from rope 1; a retake reads "1 pattern photographed again". The Status band shows Attention: "Calibrating the lights: the ropes are in patterns for about 4 more minutes." |
| Stopped | "Stopped; the ropes are back on the river. No map was written." If the job had to be killed (`forced`): "the ropes may still show a pattern: press Ropes → On". |
| Result | stays until dismissed: "Map made 23 Oct 21:14 · 18 of 20 ropes found · ropes 9 and 17 not found (dark) · 2,103 LEDs seen, the rest placed along the rope · camera drift 13 (fine) · panel quad 1 found. The show file still uses the old map until it is rebuilt." Then **"Use this map: rebuild the show file"** (confirm: "Bakes the new LED map into the river's year and restarts TouchDesigner on it: about a minute dark") or "Keep the old map". Never automatic: a map made with a moved camera gets looked at over the still first. Once the rebuild succeeds the card says "The river's year now uses this map (rebuilt 02:09)" with only OK: no second rebuild on offer. |
| Failure | calibrate.py writes the team's words in the progress file's `reason` (the raw text stays in `error`): the step in words, what went wrong and the next step, e.g. "Working out where each rope is failed: the patterns couldn't be read from the pictures (someone in view, or light in the room); run it again when the room is dark and empty". Refusals: "TouchDesigner isn't answering: calibration can't start" · "The gallery camera isn't reachable: calibration can't start" · "A calibration is already running" · "The camera moved during the run (drift 48): the map was not saved. Fix the camera and run again" · "Patterns never agreed (people kept walking through): the map was not saved. Run again when the room is empty" · "bitcube went offline during the run: the ropes may still be in patterns; they come back when TouchDesigner reloads" · the ropes' state added by the page ("The ropes are back on the river; no map was written." or "The ropes may still show a pattern: press Ropes → On on the Status page."). Buttons: OK and "Back to Calibrate" (it goes back; Calibrate asks again). |

**Fixture mode:** the server serves the newest map in the clone (23 Oct, made at Gray Area) and the screens file with `still: null` (the page can lay the room still from the gallery camera under the map), synthetic season-coloured frames, and a scripted run in the progress file's exact shape (two passes of 29 with one retake, decode, panels, a result; about 60 s instead of 5 min), one job per scenario, with `?calib=drift` (or the `calib` cookie) to end in the drift failure and `decode` in a decode failure. The fixtures' clock is the scenario's own moment moved forward by whole days (always 02:59 Pacific, today) and stands still between polls, so every age reads as the scenario wrote it.

### Studio chat

- **Pinned status bar** above the composer, from `studio.status()` and the SSE `status` events: "Ready" / "Working on: 'Turn the ropes dark' · 0:42" (animated mark) / "2 waiting"; a fixed red-tinted ≥ 48 px **Stop** ("Stop, and clear the queue" when something waits).
- **One card per request** with a chip: Waiting (2nd in line) · Working · Done 21:04 · Stopped · Failed: bitcube didn't answer (link to Status). Replies render under their own request, markdown kept; activity lines in plain verbs ("looked at bitcube", "changed the ropes"), acting lines highlighted. The server sends each step as `{ text, raw, acting }` (`lib/steps.mjs`): `text` in the glossary's words, `raw` (scrubbed) only in the step's tooltip, `acting` only for a change to the installation; every chat event is scrubbed of logins before it is kept or sent.
- Banner "Everyone shares this conversation; say who you are"; timestamps and day dividers; after a reconnect, "Connection lost · 2 requests ran while you were away", the gap re-fetched from `/api/chat/history`. On touch, Return makes a new line; only Send sends. The stream is lost on an error **or after 40 s of silence** (the server pings every 25 s; a half-open phone link or a buffering proxy never errors): the page reconnects and re-fetches the history, the pinned bar says "Reconnecting to mission control…", and the header counts from the last event (amber from 12 s, red from 30 s), never from the drop. A control used from the chat shows on Status as "Last done: … · from studio chat" (never a name, MD4).

### System map (engineers)

B's chain on its own page: inputs (gallery camera, river camera, internet + router) → bitcube (TouchDesigner as its own box) → outputs (ropes with both boxes, panels, Dave's agent). Each box shows **its own item**, never the worst of a bundle; clips to Dave sit on the arrow to Dave's agent. Link pills: "no answer", "no frames", "no internet", "not driven", "picture frozen", "sending black", "clips failing", "agent quiet", "not known". A box's sub-rows are mark · name · state word, the word wrapping under the name on narrow boxes (never cut off). The lost-contact banner gives the time on the server's clock, as Status does. One legend; greys with "· last answer" when stale, and during lost contact no green survives (marks, top bars, state words and pills go grey, as Status's tiles do); a sub-item not there yet (the people counter) has the grey "·" and "Not available yet", an unknown one says Unknown; a sheet lists every arrow in, not the first; a tap opens the card's "Addresses and links". The existing diagram follows (under 600 px wide, behind "Open full screen": its cable links are too small to tap in a frame). Its live marks come from `derive()`'s item per node (`map-words.js`), each with shape and glyph as on Status (✓ circle, ▲ triangle, ✕ square, ? grey ring) and the live state first in the node's name: a last answer, lost contact or a full check older than 3 min makes a mark "not known" (grey), never green; amber only means "needs attention". Lost contact and its return are said once each. The chain's sheets point at Status ("on Status", with a link to the row) instead of repeating its advice. Under 300 px the chain is one box per row with the arrows' words as a list.

## Server changes needed

Already on the branch: `model.js`; `lib/lights.mjs` (frames, pixel map, calibrate start/cancel/status with a whitelist and caches); `tools/mission/calibrate.py` + `calibrate.ps1` (the pipeline as a detached job with a progress file, a lock, cancel-and-restore, `--dry-run`, `--decode-only`); `frames.ps1` and `td_mission.py frames`; `probe.ps1` reporting `calibration` and `pixelmap`; `lib/history.mjs`. Still to do:

1. **Routes:** `GET /api/lights` in real mode via `Lights.frames()` (today 503); `GET /api/pixelmap`; `GET /api/calibration` (cached 3 s, polled every 5 s only while a run is on); `POST /api/control/calibrate { action: start | cancel, dry_run }` through `planCalibrate`; `POST /api/control/check` (the full check now); `POST /api/control/rebuild`. Tests; 401 without the cookie.
2. **History wired:** `History.observe()` after every poll, `.action()` after every control (source: mission control or studio chat); `/api/status` gains `since` (`summary()`); `GET /api/history` for the menu's Recent.
3. **Contacts:** `<state>/contacts.json` (untracked, like the password) → `GET /api/contacts` → tel: links; names and ownership stay in `model.js`.
4. **Fixture mode:** one `/api/lights` shape (wrap `renderLights` in the `frames` contract); the newest map and the screens file (no shipped still); the scripted calibration with the drift flag; keep the log-line rebase fix; freeze the fixtures' hour so Dave's overnight rest stops reading "hasn't ticked for 3 h" by day. Done.
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
| 8 | Cut over: `/status` replaces the old pages, `proto/` removed, the docs index links this page; Gavin restarts the live service | the live pages on 8790 read right for the real situation (GET only); old URLs redirect. `/`, `/mission` and `/status.html` → `/status`; `mission.html`, `app.css` and `public/proto/` are gone (git history) |
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
