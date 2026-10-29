# Glossary: A River Becoming

**bitcube**: The show PC, a Windows mini PC that runs TouchDesigner and drives the ropes and panels. Always lowercase, even at the start of a sentence.

**Show file**: A TouchDesigner file that runs the whole piece (ropes and HUB75 panels) on bitcube. Each one has its own page explaining it to visitors and to the team. There are two, and the team calls them by these names, never by their file names:
- **The river's year** (`river-local-oct-22-seasons.toe`): the recorded river through four seasons. A **local-only file**: it runs with no network at all (no internet, no Dave's agent, no live river feed) and draws only on what is on bitcube's disk.
- **The live river** (`river-online-oct-23.toe`): the **online show file**. The River camera's live picture over the internet, with Dave's agent shaping its colours and movement.

**Old show file**: A retired show file, renamed with `old-` in front so it is obvious: `old-river-online-oct-20.toe` (the old live river, from 20 Oct: one screen, the Agape rope map) and `old-river.toe` (the first show file, from Agape). Never opened at boot and never offered by mission control; kept so it can be opened by hand.

**Boot file**: The show file TouchDesigner opens when bitcube starts: the one chosen in mission control (Status → Installer → Boot file), else the river's year, else the live river.

**Rain fallback**: What the live river shows (on the ropes and the panels) while the River camera sends no frames: rain. The only meaning of "fallback" in the team's words: an old show file is not a fallback, and neither is a network port.

**River library**: The recorded clips of the real river, kept on bitcube and played back when the live river feed is absent. Not the same as the **river memory** (the last few seconds of whatever river image is showing, smeared down the ropes).

**Season**: (The river's year only.) One of four looks the river passes through: winter (near-still, white and pale blue, ice glints), spring (thaw and rain, greens and teal), summer (torrent, gold and sunlight glints), autumn (slowing, ochre, rust, leaf-red and mud). A season sets both the river's colours and its intensity.

**Season cycle**: The river's year compressed into four minutes, one minute per season, blending continuously. It is what the piece does when nothing else is steering it.

**The year only turns forward**: Seasons always follow winter → spring → summer → autumn → winter. Whatever steers the river (the clock or presence) can hold it in a season or move it on, never back: from autumn, the way back to summer is through winter and spring.

**Intensity**: How much the river is moving, from **trickle** to **torrent**. It shows as flow speed, spray and brightness. Summer is the most intense season and winter the least. Mission control names it in five words, low to high: **stillness** (under 0.1), **trickle** (under 0.3), **flowing** (under 0.6), **strong** (under 0.8) and **torrent**.

**Presence**: How many people the gallery camera sees in the foreground, in front of the piece. Smoothed over several seconds, so it swells and fades rather than flickers.

**Usual presence**: What presence has typically been lately: the median over a rolling window of the last few minutes. It lets the piece adapt to the night, whether a busy moment means 4 people or 100.

**Relative presence**: Presence compared with usual presence: busier than usual, about as usual, or quieter than usual. This, not the raw count, is what warms or cools the river. An empty room is always winter.

**Mode**: Who is steering the year. **Automatic**: the season cycle, one season a minute. **Dynamic**: relative presence steers it, a closed loop that people can watch but not touch. **Manual**: someone picks a target season and an intensity, and the year travels forward to it quickly. In every mode the year only turns forward.

**Intensity (in manual)**: Set directly on a scale from **stillness** (0) to **torrent** (1), instead of following the season.

**Target**: In manual mode, where the river should end up: a **target season** and a **target intensity**. The river travels to a target (forward through the calendar), it never jumps there.

**Rules**: The numbers that shape how the river behaves in every mode (how long the year takes, how fast it warms and cools, what counts as busier or quieter than usual, when summer becomes a full torrent). Changing a rule changes the behaviour from that moment on; it doesn't move the river anywhere.

**Dave's agent**: Dave's AI, which runs online (on Modal), watches the room and the river through their cameras, and chooses the live river's colours and mood every few minutes. **Clips to Dave** are the short camera clips bitcube sends it.

**Modal**: what Dave's agent sends (its scene, its frames, its moving picture), as mission control's Modal input panel names it (Gavin, 28 Oct): "What Modal is sending", "Latest from Modal", "from Modal", always in Modal's green chip. Use it for those outputs on that panel; the agent itself is still **Dave's agent** elsewhere.

**Mission control**: The team's live web page for the installation: what every part is doing right now (bitcube, the show file, seasons, presence, cameras, the river site, Dave's agent), the controls for steering the piece, and the system map. Behind one shared team password. Not for visitors.

**Studio chat**: One long-running conversation with the team's Claude agent, reachable from mission control. Everyone on the team writes into the same conversation, one request at a time, and the agent can act on the installation, not just talk about it.

**Test pattern**: A mode on mission control's Lights page for checking every LED and screen: the ropes fill red, green, blue, then white, each wiping down from the plug end, and each screen shows four coloured panels (red, green, blue, yellow) with its number in white squares, which also shows which way up it hangs. The river stops until someone presses Stop; then the ropes and panels go back to what they showed.

## The remembered river (the artists' "Rules for the light", 27 Oct)

**Remembered day**: One real date from Dry Creek's past, chosen by Dave's agent, that the column relives: its hours, its rain, how high the river ran, its night and day, its season. Usually chosen because it resembles the river today; otherwise for its significance (a flood, a drought, the first rains). _Avoid_: memory (and never confuse with **river memory**, the last few seconds smeared down the ropes).

**Loop**: About five minutes in which the column relives one remembered day's 24 hours, about 12 seconds per hour. One remembered day per loop; never the same one twice within an hour.

**Phase**: Where a loop is: **calm**, **building**, **surge** or **settling**.

**Surge**: The one moment of full brightness and colour in a loop, landing on the remembered day's heaviest hour of rain, moved earlier or later by the room. A dry day has no surge.

**Decision wave**: One slow wave of light down every rope, and a line wiping down each screen, when a new remembered day is chosen.

**The pool**: Where the ropes coil on the floor. Deeper, bluer and slower than the ropes above it: it breathes in calm, goes dark just before the surge, churns white during it, and is the last thing to fade.

**Day's season**: The season of the remembered date, which sets the loop's palette. Not the **season cycle** of the river's year.

**Lingerer**: Someone standing still close to the column (8 s or more). Since v2 (29 Oct) sparks and splashes run up and down their two to four nearest ropes, the light gathers there (the other ropes dim a little) and the pool's waterline rises under them; it fades a few seconds after they move on.

**Crowd**: How full the room is, as the ropes feel it: one person is a hint, four or more the full crowd. It mounts over about a minute as people are counted and subsides over about a minute when they leave, as turbulence at head height and below (swirls, sloshing, bursts). _Avoid_: presence (the raw count) for this smoothed effect.

**Empty room**: Nobody seen for a few seconds. The calm becomes slow ocean waves over the pool, settling to a still pond; the day's surge still plays, softer, and the random small surges happen only now. Anyone walking in wakes it within seconds, with a ripple across the pool.

**Override**: A hand on one of the remembered river's parameters, from mission control's v2 page: **auto** (the show's own value), **fix** (a chosen value) or **adjust** (the show's value scaled and shifted). It holds until someone clears it. _Avoid_: manual (that is a mode of the river's year).

**Simulated people**: A pretend headcount or a pretend lingerer by one rope, set on the v2 page to test the people effects with nobody in the room. It clears itself after two minutes, and the page shows a red SIMULATING banner meanwhile.

**Master brightness**: One multiplier on every rope's brightness (0–150 %, normally 100 %), set on the v2 page. The 1,400 W power limit still applies on top.

**Calm range**: The floor and ceiling of the calm's brightness (normally 18 % and 60 %), set on the v2 page; the calm moves between them with the day, the room and a slow drift.

**Inputs log**: bitcube's running record of every input and parameter with where it came from (`River\logs\inputs.jsonl`), a line every few seconds. The v2 page draws its sparklines from it.

**The frozen file**: `river-all-looks.toe`, the remembered river as it was before v2, pinned so that no code change can reach it. It is **the rollback**: switching back to it from mission control's What's showing undoes v2. _Avoid_: old file (old files have `old-` in their names and are never offered).

**Show view**: Where the gallery camera points while the piece runs: low, seeing the people and the base of the piece. It turns away only during a calibration, and always comes back.
