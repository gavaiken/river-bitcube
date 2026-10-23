---
title: "A River Becoming: ceiling install, step by step"
---

# Ceiling install: step by step

For whoever goes up the lift (Gavin, Lilian, the Gray Area crew). Everything that lives in the ceiling, how to cable it, and how to check it worked, without needing anyone else. About 45 minutes. Background and addresses: [ceiling page](ceiling.html). Plan: [execution plan](execution-plan.html). Updated 23 Oct 2026.

![Rigging at Gray Area: 1 ceiling, 2 panel power, 3 lowest rope point](img/rigging-2026-10-22.jpg)

- **Point 1, ceiling grid:** bitcube (the show PC), our router, the lighting switch, the rack LED controller, both PSAC10 rope boxes, the Colorlight sender.
- **Point 2, on the driftwood:** the HUB75 panels, their receive card and the panel power board.
- **Point 3:** the lowest point the ropes hang to.

## 1. Take up
| Item | Notes |
|---|---|
| **bitcube** + its power supply | Two Ethernet ports, taped: **blue = ROUTER**, **white = LIGHTS** |
| **Router** (GL.iNet Slate AX, `gray-river`) + its USB-C power supply | Ports: **WAN** and **LAN1 / LAN2**; LAN2 is taped blue |
| **Lighting switch** (small network switch) + its power | For the lighting network only |
| **Rack LED controller** (AoShow, 1U) + IEC power cord | Plays its own pattern if bitcube ever stops sending |
| **PSAC10 box 1** and **box 2** + blue powerCON mains leads | Each can draw up to ~600 W as we run them (1.5 kW at full white): **each on its own circuit** |
| **Colorlight sender** + its power | Turns bitcube's HDMI into the panels' signal |
| **Cables** | 1 blue-taped Ethernet (bitcube ↔ router, the good one); 4 short Ethernet (lighting switch); 1 long Ethernet (sender → receive card at point 2); 1 HDMI (bitcube → sender); Gray Area's drop |
| **Power strips** and extension leads | Three separate circuits (below) |
| **Small HDMI monitor + USB keyboard** | Stay with the kit on the ground; only needed if the network is down |

**Not up there:** the gallery camera's Ethernet cable. **The camera runs on Wi-Fi only** (its cable link is faulty, 23 Oct); just give it power.

## 2. Mount
1. **bitcube:** somewhere it gets air. **Nothing on top of it or against its fins**, not on top of the rope boxes (they get warm), its vents clear. Secure it so it can't slide off the grid.
2. **Router** next to bitcube, antennas up, not inside a metal box (the camera and phones reach it over Wi-Fi).
3. **Lighting switch, rack controller, PSAC10 boxes** next to each other at point 1.
4. **Colorlight sender** within HDMI reach of bitcube.
5. Leave **slack** in every cable, and strain-relieve the heavy ones (the powerCON leads, the ropes).

## 3. Cable (in this order)
**Network (internet and remote access):**
1. **Gray Area's drop → router WAN.** (If there's no drop yet, skip it: the router uses Gray Area's staff Wi-Fi by itself.)
2. **Blue cable: bitcube's blue ROUTER port → the router port taped blue (LAN2).** Not LAN1: that port is switched off since 23 Oct (the studio chat can switch it back on once the camera's old cable is out).

**Lights (a separate network: never into the router):**
3. **White: bitcube's white LIGHTS port → lighting switch.**
4. **Lighting switch → rack controller NET1, → PSAC10 box 1 NET1, → PSAC10 box 2 NET1.**
5. **Ropes:** each rope's **male round plug is its input** (the female end stays unused). Box 1 OUT1–OUT10 = ropes 1–10, box 2 OUT1–OUT10 = ropes 11–20, through the XLR adapters. (Order doesn't have to be perfect: we re-map the ropes by camera after the hang.)

**Panels:**
6. **HDMI: bitcube → Colorlight sender.** No monitor on bitcube.
7. **Long Ethernet: Colorlight sender → the receive card at point 2.** Not into the router or the lighting switch.

**Never:**
- the lighting switch into the router;
- the sender's cable into the router or the lighting switch;
- the blue and white cables swapped (bitcube stays online over Wi-Fi, but the lights stay dark).

## 4. Power
Three separate circuits if you can (ask Gray Area which outlets are on which breaker):
| Circuit | What |
|---|---|
| A | PSAC10 box 1 |
| B | PSAC10 box 2 |
| C | HUB75 panel power board (point 2) |
| any | bitcube, router, lighting switch, rack controller, Colorlight sender (well under 300 W together) |

- **Check the PSAC10 voltage selectors are on 110 V** (screwdriver switch on each box). On 220 V the ropes look dim and flicker.
- Switch everything on; the order doesn't matter. bitcube starts by itself when it gets power (no button), logs in and opens the show in about a minute.

## 5. Check it worked (5 minutes, from the floor)
1. **Wait 2 minutes.**
2. **Ropes:** they should show the river (slow, blue-white in winter, then green, gold, rust as the 4-minute year turns).
   - If they **cycle through bright colours by themselves**, the boxes aren't getting bitcube's signal: check the **white** cable is in bitcube's white port and the lighting switch has power.
   - If one rope is dark, swap its plug to a free OUT to tell a dead rope from a dead port (ropes 9 and 17 have been dark since 18 Oct).
3. **Panels:** the river, in four blocks. Black: check the HDMI, the sender's power and its long cable to the receive card, and the panel power board.
4. **On a phone** (any internet): open **[mission control](https://gav-m1-mini.tailddc624.ts.net)**, log in with the team password. **System status** should show green for bitcube, TouchDesigner, the router, the gallery camera, both rope boxes and the HUB75 sender. Red is the thing to fix; the **System map** tab shows where it sits.
5. **Ask the studio chat** (mission control → Studio chat): "The ceiling install is done, check everything." It can see bitcube, the router and the cameras, and says what's wrong.

## If something's off
| You see | Likely | Fix |
|---|---|---|
| Ropes cycle colours by themselves | bitcube's signal isn't reaching the boxes | White cable in bitcube's **white** port; lighting switch powered; switch → box NET1 cables in |
| Ropes dark, panels fine | Boxes unpowered or on the wrong voltage | powerCON in and breaker on; selector on 110 V |
| Panels black, ropes fine | HDMI or sender | HDMI seated at both ends; sender powered; long cable to the receive card |
| Everything dark | bitcube off or not booted | Its power; wait 2 minutes after power; mission control shows whether it's online |
| Mission control: bitcube offline | No network | Blue cable into router **LAN2**; router powered. bitcube also falls back to Wi-Fi by itself |
| Mission control: router or internet red | Router has no uplink | The drop in **WAN**; otherwise it should use Gray Area's staff Wi-Fi by itself (can take a few minutes after a power cut) |
| The lighting switch had to go into the router | No cable run to bitcube's white port | Allowed as a fallback: plug it into a router LAN port, then in mission control → Mission control → Lights choose **the router (fallback)** |

## Don't
- Put anything on bitcube or block its vents.
- Unplug the router or bitcube to "reset" them: that's what the studio chat and mission control are for (they can restart things remotely).
- Plug the gallery camera in by cable.
- Change the rope boxes' settings (MODE button) or the rack controller's program.
