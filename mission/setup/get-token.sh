#!/bin/bash
# One command for Gavin (docs/mission-plan.md, M7):   bash ~/claude/Source/river-bitcube/mission/setup/get-token.sh
# 1. runs `claude setup-token` (opens a browser to log in; it then prints a long token starting sk-ant-)
# 2. asks you to paste that token (hidden as you paste), saves it to ~/claude/local/secrets/claude-token (chmod 600)
# 3. installs it for the river user and restarts mission control (asks for your password once, for sudo)
set -euo pipefail
cd /
claude setup-token
echo
printf 'Paste the token printed above (it starts sk-ant-), then press Enter: '
IFS= read -rs tok; echo
tok=$(printf '%s' "$tok" | tr -d '[:space:]')
case "$tok" in sk-ant-*) ;; *) echo "That doesn't look like a token (should start sk-ant-). Nothing saved."; exit 1 ;; esac
mkdir -p ~/claude/local/secrets
( umask 077; printf '%s\n' "$tok" > ~/claude/local/secrets/claude-token )
unset tok
echo "saved to ~/claude/local/secrets/claude-token"
sudo bash /Users/river/river-bitcube/mission/setup/install-token.sh
