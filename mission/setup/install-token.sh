#!/bin/bash
# Install (or replace) the studio agent's Claude token (docs/mission-plan.md, M7), then restart the service.
# First, as Gavin: run `claude setup-token`, paste the token it prints into
#   /Users/gav/claude/local/secrets/claude-token   (chmod 600; it never goes in the repo or chat)
# Then:  sudo bash /Users/river/river-bitcube/mission/setup/install-token.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
SRC=/Users/gav/claude/local/secrets/claude-token
[ -s "$SRC" ] || { echo "no token at $SRC"; exit 1; }
install -o river -g staff -m 600 "$SRC" /Users/river/.secrets/claude-token
launchctl kickstart -k system/com.agape.river-mission
echo "token installed; mission control restarted"
