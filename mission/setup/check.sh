#!/bin/bash
# Read-only health check for mission control (run as Gavin, no sudo). docs/mission-plan.md
echo "home folder: $(stat -f '%Sp %Su' /Users/gav)  (want drwx------ gav)"
echo "river user:  $(id river 2>/dev/null || echo missing)"
echo "service:     $(launchctl print system/com.agape.river-mission 2>/dev/null | awk '/state =/{print $3; exit}' || echo 'not loaded')"
echo "local:       $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8790/healthz)  (want 200)"
echo "login page:  $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8790/login)"
echo "funnel:      $(/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status 2>&1 | grep -E 'https://|No serve' | head -2 | tr '\n' ' ')"
echo "online:      $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://gav-m1-mini.tailddc624.ts.net/healthz)  (want 200)"
