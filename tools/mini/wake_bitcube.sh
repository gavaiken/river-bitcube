#!/bin/bash
# Wake bitcube from the Mac mini (Gavin, 28 Oct 2026). bitcube shuts itself down after the gallery closes
# (tools/power/nightly_shutdown.ps1); if the staff then pulled the power, plugging it back in boots it (BIOS Auto
# Power On), but if they forgot, nothing would: this sends a Wake-on-LAN magic packet to its ROUTER port
# (Ethernet 2, 00:e7:43:0e:5f:c4, on the install router's LAN2; BIOS Wake On LAN and the adapter's "Shutdown
# Wake-On-Lan" are both on, checked 28 Oct). The mini has no route onto the install LAN while bitcube is off, so the
# packet is sent from the install router (root over Will's tailnet, key auth; `etherwake` there).
#
#   tools/mini/wake_bitcube.sh            send, then wait up to 5 min for bitcube to answer ssh; exit 0 when it does
#   tools/mini/wake_bitcube.sh --send     just send one packet
#
# Scheduled an hour before each opening by the launchd agent tools/mini/com.river.wake-bitcube.plist (user gav on the
# mini); every run is appended to ~/claude/local/wake-bitcube.log. If bitcube is already up it says so and exits 0.
ROUTER=${ROUTER:-root@100.127.193.8}
MAC=${MAC:-00:e7:43:0e:5f:c4}
LOG=${LOG:-$HOME/claude/local/wake-bitcube.log}
SSH='ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new'

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }
up() { $SSH -o ConnectTimeout=5 bitcube 'echo up' 2>/dev/null | tr -d '\r' | grep -q '^up$'; }
send() { $SSH "$ROUTER" "etherwake -i br-lan $MAC" 2>&1 | tr -d '\r'; }

/bin/mkdir -p "$(dirname "$LOG")"
if [ "$1" = "--send" ]; then out=$(send); log "sent one magic packet to $MAC via $ROUTER ${out:+($out)}"; exit 0; fi

if up; then log "bitcube is already up; nothing to do"; exit 0; fi
log "bitcube does not answer ssh: waking $MAC via $ROUTER"
t0=$(date +%s)
for i in 1 2 3; do
    out=$(send) || { log "the router did not take the wake command: $out"; }
    for _ in $(seq 1 20); do                     # ~100 s per packet, three packets: about 5 min in all
        /bin/sleep 5
        if up; then log "bitcube answered after $(( $(date +%s) - t0 )) s (packet $i)"; exit 0; fi
    done
done
log "bitcube did not answer within $(( $(date +%s) - t0 )) s: ask Gray Area to pull and restore its power (BIOS Auto Power On boots it)"
exit 1
