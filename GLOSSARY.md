# Glossary: A River Becoming

**Show file**: A TouchDesigner file that runs the whole piece (ropes and HUB75 panels) on the show machine. Each one has its own page explaining it to visitors and to the team.

**Local-only file**: A show file that runs with no network at all: no internet, no Modal, no live river feed. It draws only on what is on the show machine's disk. Example: `river-local-oct-22-seasons.toe`. Its counterpart is the **online show file** (`river-online-oct-20.toe`), which also uses the live river feed and Dave's Modal agent.

**River library**: The recorded clips of the real river, kept on the show machine and played back when the live river feed is absent. Not the same as the **river memory** (the last few seconds of whatever river image is showing, smeared down the ropes).

**Season**: One of four looks the river passes through: winter (near-still, white and pale blue, ice glints), spring (thaw and rain, greens and teal), summer (torrent, gold and sunlight glints), autumn (slowing, ochre, rust, leaf-red and mud). A season sets both the river's colours and its intensity.

**Season cycle**: The river's year compressed into four minutes, one minute per season, blending continuously. It is what the piece does when nothing else is steering it.

**The year only turns forward**: Seasons always follow winter → spring → summer → autumn → winter. Whatever steers the river (the clock or presence) can hold it in a season or move it on, never back: from autumn, the way back to summer is through winter and spring.

**Intensity**: How much the river is moving, from **trickle** to **torrent**. It shows as flow speed, spray and brightness. Summer is the most intense season and winter the least.

**Presence**: How many people the gallery camera sees in the foreground, in front of the piece. Smoothed over several seconds, so it swells and fades rather than flickers.

**Usual presence**: What presence has typically been lately: the median over a rolling window of the last few minutes. It lets the piece adapt to the night, whether a busy moment means 4 people or 100.

**Relative presence**: Presence compared with usual presence: busier than usual, about as usual, or quieter than usual. This, not the raw count, is what warms or cools the river. An empty room is always winter.

**Mode**: Who is steering the year. **Automatic**: the season cycle, one season a minute. **Dynamic**: relative presence steers it, a closed loop that people can watch but not touch. **Manual**: someone picks a target season and an intensity, and the year travels forward to it quickly. In every mode the year only turns forward.

**Intensity (in manual)**: Set directly on a scale from **stillness** (0) to **turbulence** (1), instead of following the season.
