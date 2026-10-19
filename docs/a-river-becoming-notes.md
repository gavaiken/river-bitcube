# A River Becoming: design notes

Digest of the in-person hacking session at Agape, 2026-10-17. Hardware details are in [a-river-becoming-hardware.md](a-river-becoming-hardware.md). The raw Signal thread is exported on Gavin's Mac mini (not in this repo).

## Tonight's goal
TouchDesigner on bitcube (the Windows mini PC) drives both outputs: the ropes over Art-Net and one HUB75 quad over HDMI. Layer-one hardware (screen, PSU, sender/receiver) gets laid out in parallel. Exploring animations is out of scope tonight.

## System layout
- **Ropes:** bitcube → Ethernet → AoShow rack controller → PSAC10 boxes → 20 ropes. Will has driven all 20 over Art-Net with Python/PowerShell scripts on bitcube.
- **Panels:** bitcube HDMI → Colorlight sender (always looks like a 1920×1080 display, samples the top-left region) → 5A-75B receive card → panels. In Andi's testing, fullscreening the output on that display just works.
- **Cameras:** Reolink cameras behind a GL.iNet router running Tailscale, which exposes the camera subnet. The river kit (Starlink + solar + camera) deploys Sun/Mon 18–19 Oct.
- **Brain:** Dave's agent on Modal. It still needs a bridge into the tailnet. Worst case, a small service somewhere that joins it.
- **Remote dev:** bitcube has RDP and SSH. Run things on the box itself rather than forwarding ports. bitcube is the gallery machine too.
- **Gallery network:** a dumb switch with the camera + LED controller on one PC NIC, and gallery internet on the other NIC. Still open: who gets the gallery camera onto Tailscale. bitcube could act as a subnet router or proxy. Will is thinking it through.

## TouchDesigner's job: glue
Minimum function:
1. Take Dave's visualization in as a high-res canvas.
2. Crop a **20 × 400** region (one column per rope, 400 px each) → Art-Net to all ropes.
3. Crop the panel regions, which may be tilted/rotated rectangles, transform them, and composite them into the 1080p frame → HDMI.

Later, maybe: effects driven by the cameras, and knobs/parameters the agent can tweak.

Correction to the meeting: someone guessed a panel is "a quarter of 1080p, ~640×480". It's actually 128×64 per panel, so a 2×2 quad is 256×128. The HDMI frame has plenty of room.

## Open question: what does Modal output?
- **(a)** A display stream, with bitcube just showing it.
- **(b)** Config/code (a ready-made animation, maybe in a TD web view) that runs locally on bitcube, plus knobs the agent tweaks.

Earlier the group leaned toward (b) for resilience: if the network flakes, the show keeps running. Not settled.

## Panels: two artistic modes
1. **Independent pools.** The panels show their own content. Simpler, and this is the baseline.
2. **High-res windows into the same field as the ropes.** Needs each panel's physical position and orientation, so TD (or a custom script in TD) samples the right part of the canvas. Gavin's Oct 7 Chromatik pixel map already puts every LED and panel in one shared "river" texture space.

Decision: "it just has to look good". Do the mapping if it's achievable, otherwise fall back to pools.

## Animation direction
River-like and flowing, not literally a river. Earlier refs: Justine's cosmos.so board, the WLED effects list, Colin's fast→slow-mo flow and "breathing" (colour or intensity), high contrast on black (the panels don't ghost). Constraint: 2D canvas animations don't automatically translate to 1D/3D sculpture.

## Sensing and the agent
- **Will's angle (reservoir computing):** treat the ripples on the river's surface as state/memory. Decompose the video, e.g. PCA, high vs low frequency, ripple vs bulk flow, into roughly orthogonal vectors. Expose the analysis scripts to the agent as tool calls, maybe as an MCP server with "dials".
- **Colin/Dave's angle:** let VLMs (Qwen/DeepSeek) look at frames directly. Dave currently runs video → descriptive text → agent, and is also looking at Cloudflare's CLEF decision models.
- **Gallery camera:** pan/tilt, mic and speaker. The agent can scan the room and track rolling noise level and amount of movement, so the river "sees" people interacting with its avatar.
- **River camera:** keep its use minimal.
- **Future ideas:** more sensors at the river (hydrophones, flow rate).
