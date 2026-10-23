#!/bin/sh
# river-wan-watch: Gray Area's staff Wi-Fi repeater as a standby uplink (S29, Gavin 23 Oct: "#2 if bullet proof").
# Runs from cron every minute on the install router (GL.iNet GL-AXT1800, `router-gray-area-gl-axt1800`).
#
#   Wired drop healthy             -> repeater OFF, 5 GHz pinned to channel 36, 40 MHz (no radar wait for `gray-river`).
#   Wired drop down for FAIL_N min -> repeater ON (GL's own repeater service reconnects to "Gray Area Staff"; the
#                                     5 GHz radio follows its channel). GL's kmwan failover then routes over it.
#   Wired healthy again for OK_N min -> repeater OFF again.
#
# "Healthy" = eth0 has carrier and a ping forced out of eth0 reaches any of three public addresses (kmwan keeps
# both default routes, so this tests the drop itself even while traffic runs over the repeater).
# Fail-safe: anything unexpected (bad status, no eth0) counts as "down", so the repeater comes ON, never OFF.
# Test without touching the cable: `touch /tmp/river-wan-test-down` makes the drop look down; `rm` it to end.
# State and status: /tmp/river-wan/ (status is one line for mission control). Log: `logread -e river-wan`.
# Never prints or logs the repeater's Wi-Fi password: status is read field by field with jsonfilter.
# Source of truth: river-bitcube repo tools/router/river-wan-watch.sh (install: tools/router/install-wan-watch.sh).

FAIL_N=2            # consecutive failed minutes before the repeater comes on
OK_N=10             # consecutive healthy minutes before it goes off again
KICK_N=5            # minutes the repeater may stay unconnected while on before its service is restarted
CHANNEL=36          # 5 GHz while the repeater is off: 36+40 measured quietest (23 Oct); non-DFS
HTMODE=HE40         # 40 MHz: all the gallery cam uses (1 stream, 40 MHz), and less to collide with
TARGETS="1.1.1.1 8.8.8.8 208.67.222.222"
S=/tmp/river-wan

mkdir -p "$S"
exec 9>"$S/lock"
flock -n 9 || exit 0                 # a slow run is still going: skip this minute

log() { logger -t river-wan "$*"; }
num() { v=$(cat "$S/$1" 2>/dev/null); case "$v" in ''|*[!0-9]*) echo 0 ;; *) echo "$v" ;; esac; }
put() { echo "$2" > "$S/$1"; }

wired_ok() {
    [ -e /tmp/river-wan-test-down ] && return 1
    [ "$(cat /sys/class/net/eth0/carrier 2>/dev/null)" = 1 ] || return 1
    for ip in $TARGETS; do
        ping -I eth0 -c 1 -W 2 "$ip" >/dev/null 2>&1 && return 0
    done
    return 1
}

repeater_enabled() { [ "$(uci -q get repeater.@main[0].disabled)" != 1 ]; }
repeater_state() { ubus call repeater status 2>/dev/null | jsonfilter -e '@.state_s' 2>/dev/null; }

repeater_on() {
    uci set wireless.radio0.channel='auto'
    uci commit wireless
    uci set repeater.@main[0].disabled='0'
    uci commit repeater
    /etc/init.d/repeater restart >/dev/null 2>&1
    put kick 0
    log "wired drop down for $FAIL_N min: repeater ON (Gray Area Staff), 5 GHz channel auto"
}

repeater_off() {
    # Channel first: the repeater service's restart reloads Wi-Fi itself, and with the old order the radio came
    # up on its auto pick (channel 48, 23 Oct) instead of $CHANNEL.
    uci set wireless.sta.disabled='1'
    uci set wireless.radio0.channel="$CHANNEL"
    uci set wireless.radio0.htmode="$HTMODE"
    uci commit wireless
    uci set repeater.@main[0].disabled='1'
    uci commit repeater
    /etc/init.d/repeater restart >/dev/null 2>&1      # its start also disables the sta interface
    sleep 3
    wifi reload >/dev/null 2>&1
    log "wired drop healthy for $OK_N min: repeater OFF, 5 GHz channel $CHANNEL"
}

if wired_ok; then
    put fail 0
    ok=$(( $(num ok) + 1 )); put ok "$ok"
    if repeater_enabled && [ "$ok" -ge "$OK_N" ]; then
        repeater_off
    fi
    wired=up
else
    put ok 0
    fail=$(( $(num fail) + 1 )); put fail "$fail"
    if ! repeater_enabled && [ "$fail" -ge "$FAIL_N" ]; then
        repeater_on
    elif repeater_enabled && [ "$fail" -ge "$FAIL_N" ] && [ "$(repeater_state)" != connected ]; then
        kick=$(( $(num kick) + 1 )); put kick "$kick"
        if [ "$kick" -ge "$KICK_N" ]; then
            /etc/init.d/repeater restart >/dev/null 2>&1
            put kick 0
            log "repeater on but not connected for $KICK_N min: restarted its service"
        fi
    fi
    wired=down
fi

if repeater_enabled; then rep="on ($(repeater_state))"; else rep=off; fi
put status "$(date '+%Y-%m-%d %H:%M:%S') wired=$wired ok=$(num ok) fail=$(num fail) repeater=$rep channel=$(uci -q get wireless.radio0.channel) $(uci -q get wireless.radio0.htmode)"
