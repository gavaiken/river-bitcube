#!/bin/sh
# Install (or update) river-wan-watch on the Gray Area router, from the Mac mini or any tailnet machine:
#   sh tools/router/install-wan-watch.sh [root@100.127.193.8]
# Idempotent: copies the script to /etc (kept across firmware upgrades via /etc/sysupgrade.conf) and adds one
# cron line. Remove: delete the cron line and /etc/river-wan-watch.sh, then re-enable the repeater in GL's UI.
set -e
R=${1:-root@100.127.193.8}
cd "$(dirname "$0")"
scp -q -O river-wan-watch.sh "$R:/etc/river-wan-watch.sh" 2>/dev/null || scp -q river-wan-watch.sh "$R:/etc/river-wan-watch.sh"
ssh "$R" '
chmod 755 /etc/river-wan-watch.sh
touch /etc/crontabs/root
grep -q river-wan-watch /etc/crontabs/root || echo "* * * * * /etc/river-wan-watch.sh" >> /etc/crontabs/root
grep -q river-wan-watch /etc/sysupgrade.conf || echo /etc/river-wan-watch.sh >> /etc/sysupgrade.conf
/etc/init.d/cron enable; /etc/init.d/cron restart
echo installed; grep river-wan /etc/crontabs/root'
