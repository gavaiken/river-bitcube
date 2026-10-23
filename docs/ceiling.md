---
title: bitcube and the router in the ceiling
---

# Putting bitcube and the router in the ceiling

Once they're up there, nobody can reach a screen or a power button. So everything has to come back by itself after a power cut, and we have to be able to fix things remotely (VNC, SSH) whatever got plugged in. (Session N, 22 Oct 2026; see the [execution plan](execution-plan.html) steps S21–S24.)

## The setup
```
Gray Area wired drop (if there is one) ──► router WAN
router LAN1 or LAN2 ──► bitcube ROUTER port            internet, 192.168.9.79
router Wi-Fi "gray-river" ◄── gallery cam (192.168.9.76), bitcube's Wi-Fi as backup (192.168.9.80), phones
bitcube LIGHTS port (2.0.0.8) ──► lighting switch ──► rack controller NET1 + both PSAC10s ──► 20 ropes
bitcube HDMI ──► Colorlight sender ──(its own cable)──► receive card ──► HUB75 panels
bitcube DisplayPort ◄── dummy display plug (recommended: a desktop VNC can use)
```

**Never plug in:**
- the lighting switch to the router;
- the Colorlight sender's cable to the router or the lighting switch.

## How it copes when something is missing
| If… | then… |
|---|---|
| Gray Area's drop isn't connected or fails | the router uses Gray Area's staff Wi-Fi (Repeater), by itself |
| bitcube's router cable is missing or fails | bitcube uses its Wi-Fi (`gray-river`), by itself |
| the power goes off and on | the router starts by itself; bitcube does too **once the BIOS setting below is made** |
| the ROUTER and LIGHTS cables are swapped | bitcube stays online over Wi-Fi; the lights are dark until the roles are swapped (remotely, or automatically: S22) |
| the internet is down | the show keeps running from bitcube's disk; the team on site reaches it on `gray-river` |

## Before lifting (on the ground, with a monitor and keyboard)
1. **BIOS: power on after a power cut.** Restart bitcube and press **Del** (or F2) as it starts. Find *Restore on AC Power Loss* (or *State After G3*, or *AC Back*; usually under Advanced → Power or Chipset). Set it to **Power On**. Save with **F10**.
2. **Label bitcube's two network ports:** **ROUTER** is the one the router cable is in now; **LIGHTS** is the other. (S22 may make either work.)
3. **Pull-the-plug test:** switch off bitcube's and the router's power at the wall, wait 10 s, switch back on, touch nothing. Within about 2 minutes:
   - the router's Clients page shows BITCUBE at 192.168.9.79;
   - bitcube is online on Tailscale;
   - VNC shows its desktop.
4. **Fallback tests:**
   - Unplug bitcube's router cable: within a minute bitcube is still on Tailscale and VNC (over Wi-Fi). Plug it back in.
   - If the wired drop is connected, unplug it from WAN: the router's Internet page switches to Repeater. Plug it back in.
5. **Dummy display plug in DisplayPort** (recommended, S24). It gives Windows a desktop that isn't the LED output. Without it, the only display is the Colorlight sender, so over VNC you only see TouchDesigner's black panels window.

## In the ceiling
- **bitcube has no fan.** Keep air around its fins, and don't put the router or anything else on top of it.
- **Router:** use its own USB-C adapter (5 V 4 A). Antennas up, in range of the gallery cam and of Gray Area's staff Wi-Fi.
- **Cables:**
  - Use good Ethernet cables. The flat white cable failed on 22 Oct.
  - Leave slack and strain relief, so a tug doesn't unplug HDMI or Ethernet.
- **Power:** bitcube and the router go on the normal outlet (under 200 W). The rope boxes and the HUB75 power board need their own circuits ([Gray Area page](gray-area.html)).

## After it's up
1. Check, in this order:
   - the router's Clients page shows BITCUBE (wired .79) and the camera (`gallery`, .76);
   - bitcube is online on Tailscale;
   - VNC works.
2. Connect HDMI and the lights, then tell Claude. Claude checks:
   - that the lighting port has `2.0.0.8` and both PSAC10s answer (`2.0.0.10`, `2.0.0.11`);
   - that TouchDesigner finds the LED display;
   - and does it by camera.

## Already set on bitcube (checked 22 Oct)
- Windows starts first.
- It logs in by itself.
- Sleep and hibernate are off.
- Windows Update is paused until 15 Nov.
- These start without anyone logging in, and run automatically:
  - SSH
  - Tailscale (unattended)
  - TightVNC
- The `gray-river` Wi-Fi connects automatically for all users.
- The router port gets its address by DHCP (reserved .79, and .80 for Wi-Fi).
- The lighting port holds `2.0.0.8/8`. TouchDesigner's Art-Net sender binds to that address, so it uses whichever port has it.
