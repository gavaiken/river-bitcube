# A River Becoming: hardware reference (as of 2026-10-17)

LED art installation that should read as a river. LED rope is the rain/flow (partly hung from the ceiling), and HUB75 screens are "pools" set asymmetrically in the flow. Everything here was verified on the physical gear unless marked unknown.

## Rope lights: 20× AoShow "360 LED Flex Neon"
- 10 m each, DC24V, SPI, UCS1903 IC, RGB. 240 LEDs/m but 40 ICs/m, so 40 px/m: 400 px per rope, 8,000 px total.
- 15 W/m, so 150 W per rope at full white. 22 mm diameter, IP66/67.
- The male round plug is the INPUT end. The female plug at the far end is for chaining and is unused (one rope per port).
- The loose red/black pair at each end is power taps (R‑24V+, B‑V−, Y GND). Not needed, left capped.
- Colour order RGB, confirmed by camera on 2026-10-18 (box 1 red / box 2 green test).

## Controllers/power: 2× AoShow "AS_PSAC10 BOX_SPI_60U_1750W"
- Art-Net node and PSU in one box: 10 × 175 W (1,750 W max). Mains in via blue powerCON, breaker on the back. IP20, indoor only.
- **Mains voltage selector (110/220 V, screwdriver).** Shipped on 220, now set to 110. On 220 the board and OLED work but the 24 V rail sags. Flip it back before using on 230 V mains.
- Outputs: 10 × 4‑pin female XLR (OUT1–OUT10), each carrying 24 V + data. Label says 1–6 universes per port, max 60 per box. Supplied XLR→round-plug adapters mate with the ropes' input plug.
- Network: Ethercon NET1/NET2. Label says to set the PC to 2.0.0.8 / 255.0.0.0. The boxes' own IPs are unknown (presumably 2.x.x.x).
- OLED shows `AS_832M-16P`, `ID:001 PLAY>>>` (second box `ID:002`). Short presses on MODE do nothing; the menu may need a long press or AoShow's PC tool.
- Power: 10 ropes at full white = 1,500 W ≈ 12.5 A at 120 V per box. Each box needs its own 15–20 A circuit, or keep brightness/white content in check in software.

## Master player: AoShow 1U "LED Controller" (identified as AS_MSDMX)
- Standalone SD-card player and master for the boxes. LCD shows `P:002/005 S:07` and `IC:UCS1903_UCS1909_UCS1912`.
- Rear: NET1/NET2, sensitivity pot, audio in, mic, DMX512 on XLR and RJ45, wall pad RJ45, IEC 100–240 V.
- Program 2 lights the ropes. Programs 1, 3 and 5 are untested (they were only tried while the voltage switch was wrong).
- Will has driven everything over Art-Net from the Windows PC via rack NET1 → PSAC10 #1 → PSAC10 #2, and also with the PC wired directly to a PSAC10's NET1.

## Wiring and mapping
- Rack NET1 → box 001 NET1. Box 002 is fed either from rack NET2 or chained from box 1 NET2 (to check).
- Plan: ropes 1–10 on box 001 OUT1–10, ropes 11–20 on box 002 OUT1–10.
- 400 px × 3 ch = 1,200 ch = 3 universes per rope (170 + 170 + 60 px). The universe ↔ port mapping is unknown: maybe 3 per port, or fixed 6-per-port blocks (port 1 = U0–5, port 2 = U6–11…) with box ID as the offset.

## Panels
- 30 HUB75 panels, 128×64, in 2×2 quads. Colorlight sender → 5A-75B receive card.
- The sender always looks like a 1920×1080 display to the PC and samples the top-left region per the receive-card config (Andi sends that config from their Windows PC).

## Computers
- Windows mini PC "bitcube": at Agape on house Wi-Fi (seen as bitcube.local / 10.0.7.79), and on Will's tailnet as bitcube.tail03bc1a.ts.net. Has TouchDesigner, RDP and SSH. It will be the gallery machine. The login is held by Will; don't write it here.
- Gavin's Mac: TouchDesigner, Chromatik models in `~/Chromatik/Models` (Rain.lxm, River.lxm), pixel map and builder script in `~/Chromatik/Models/River-pixelmap`. Chromatik free tier caps output at 1k px.

## Open questions
1. Box IPs and port ↔ universe mapping (and whether it's configurable).
2. How to get into the PSAC10 menu, or whether config is PC-tool-only.
3. Whether the boxes auto-switch from PLAY to Art-Net when live frames arrive.
4. Whether the rack unit can record Art-Net to SD for standalone playback of our own content.
5. Rope gamma. (Colour order is RGB, confirmed 2026-10-18.)
6. No manual online. AoShow's YouTube has PSAC tutorials for MadMapper, Resolume and TouchDesigner, and they respond on WhatsApp/WeChat during Shenzhen hours.

## Cameras (from Will, 2026-10-18)
- Two Reolinks behind the GL.iNet travel router (`192.168.8.0/24`), which runs Tailscale on Will's tailnet:
  - **Gallery:** Reolink E1 Pro. Was `192.168.8.103`; since 18 Oct 14:09 it is on Agape WiFi at `10.0.7.76` (DHCP), reached directly over the house network, not via Tailscale.
  - **River:** Reolink E1 Outdoor Pro, `192.168.8.217`.
- **RTSP:** `rtsp://admin:<password>@<ip>:554/Preview_01_main`, best with `-rtsp_transport tcp` (e.g. `ffplay -rtsp_transport tcp "<url>"`). The password is the same as bitcube's login; it is not stored in git (on bitcube it's in the untracked `river-bitcube\secrets.local.json`).
- **Pan/tilt:** HTTPS JSON API `https://<ip>/cgi-bin/api.cgi` (self-signed cert). `?cmd=Login` with `{"User":{"userName":"admin","password":...}}` returns a token. Then `PtzCtrl` with `{"channel":0,"op":"Left|Right|Up|Down|Stop","speed":1}`, then `Logout`. Always follow a move with `Stop`. Will's working example: `tools/cameras/test_cam_move.py`.
- The gallery cam has a motion-triggered spotlight; Will turned it off on 2026-10-16.
- **Where the cameras are (2026-10-18, at Agape):** the **river** cam (E1 Outdoor Pro, `.217`, S/N on its base) sits on top of the rack LED controller, looking along the floor at the three rope coil piles; the HUB75 is out of frame. The **gallery** cam (E1 Pro, now `10.0.7.76`) was aimed on 18 Oct 13:59 at all the coil piles, the HUB75, both PSAC10s and the controller; the rope pixel map depends on it staying put. The river cam goes to the river with the Starlink kit, so the gallery cam (or another) will need to take over watching the installation.
