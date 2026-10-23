#!/bin/bash
# One-time setup of the `river` user and the mission control service on the Mac mini (docs/mission-plan.md, M6).
# Run as Gavin, from his checkout:   sudo bash ~/claude/Source/river-bitcube/mission/setup/setup-river.sh
# Safe to run again: every step checks first. It never prints a secret.
#
# What it does:
#   1. creates `river`: a hidden, standard (non-admin) user that never logs in (MD6)
#   2. locks /Users/gav to Gavin only (it was readable by group staff, and ~/.claude by everyone)
#   3. gives river its secrets: the site password (a copy of the bitcube password Gavin saved for VNC)
#      and, if Gavin has saved it, the Claude token (M7)
#   4. makes river's SSH keys (one for bitcube, one GitHub deploy key) and its ssh config
#   5. clones river-bitcube for river, installs mission/'s dependencies
#   6. river's Claude settings (the deny fence; no connectors exist for a token login anyway)
#   7. installs and starts the LaunchDaemon com.agape.river-mission (runs as river, at boot, restarts if it dies)
# Afterwards (as Gavin, no sudo): add the two public keys it prints (deploy key on GitHub, bitcube's
# authorized_keys), then turn on Funnel: see the end of this script's output.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
cd /                  # commands run as river must not inherit a folder inside /Users/gav (locked in step 2)
GAV=gav
R=river
RH=/Users/$R
REPO_URL=https://github.com/gavaiken/river-bitcube.git
PASSWORD_SRC=/Users/$GAV/claude/local/secrets/bitcube-vnc
TOKEN_SRC=/Users/$GAV/claude/local/secrets/claude-token
PLIST=/Library/LaunchDaemons/com.agape.river-mission.plist
NODE=/opt/homebrew/bin/node
say() { printf '\n== %s\n' "$*"; }

say "1. user $R"
if id "$R" >/dev/null 2>&1; then
  echo "exists"
else
  pw=$(openssl rand -base64 33)      # nobody ever needs it: river never logs in
  sysadminctl -addUser "$R" -fullName "River studio" -password "$pw" -home "$RH" -shell /bin/zsh 2>&1 | grep -v -i password || true
  unset pw
  [ -d "$RH" ] || createhomedir -c -u "$R" >/dev/null
fi
dscl . create /Users/$R IsHidden 1                     # not on the login window
dseditgroup -o edit -d "$R" -t user admin 2>/dev/null || true   # standard user, never admin
chown "$R":staff "$RH"; chmod 700 "$RH"
echo "uid $(id -u $R), admin: $(dseditgroup -o checkmember -m $R admin >/dev/null 2>&1 && echo YES || echo no)"

say "2. lock /Users/$GAV to $GAV only"
chmod 700 /Users/$GAV
ls -ld /Users/$GAV

say "3. secrets"
install -d -o "$R" -g staff -m 700 "$RH/.secrets"
if [ -s "$PASSWORD_SRC" ]; then
  install -o "$R" -g staff -m 600 "$PASSWORD_SRC" "$RH/.secrets/site-password"; echo "site password: copied"
else
  echo "MISSING $PASSWORD_SRC: save the bitcube password there first (see docs/mission-plan.md)"; exit 1
fi
if [ -s "$TOKEN_SRC" ]; then
  install -o "$R" -g staff -m 600 "$TOKEN_SRC" "$RH/.secrets/claude-token"; echo "Claude token: copied"
else
  echo "Claude token: not saved yet (M7). The chat will say so until it is; run install-token.sh later."
fi

say "4. ssh keys and config"
install -d -o "$R" -g staff -m 700 "$RH/.ssh"
[ -f "$RH/.ssh/id_ed25519" ] || sudo -u "$R" ssh-keygen -q -t ed25519 -N '' -C "river@gav-m1-mini (bitcube)" -f "$RH/.ssh/id_ed25519"
[ -f "$RH/.ssh/river_bitcube_deploy" ] || sudo -u "$R" ssh-keygen -q -t ed25519 -N '' -C "river@gav-m1-mini (deploy key)" -f "$RH/.ssh/river_bitcube_deploy"
echo "keys: $(ls $RH/.ssh | tr '\n' ' ')"
cat > "$RH/.ssh/config" <<'EOF'
Host bitcube
    HostName 100.73.68.60
    User user
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
Host github.com
    IdentityFile ~/.ssh/river_bitcube_deploy
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
EOF
chown "$R":staff "$RH/.ssh/config"; chmod 600 "$RH/.ssh/config"

say "5. clone and install"
if [ ! -d "$RH/river-bitcube/.git" ]; then
  sudo -u "$R" -H git clone -q "$REPO_URL" "$RH/river-bitcube"
fi
sudo -u "$R" -H git -C "$RH/river-bitcube" remote set-url --push origin git@github.com:gavaiken/river-bitcube.git
sudo -u "$R" -H git -C "$RH/river-bitcube" config user.name "River studio agent"
sudo -u "$R" -H git -C "$RH/river-bitcube" config user.email "studio@river-agent.invalid"
sudo -u "$R" -H git -C "$RH/river-bitcube" pull -q --ff-only || echo "(pull skipped: local changes)"
(cd "$RH/river-bitcube/mission" && sudo -u "$R" -H env PATH=/opt/homebrew/bin:/usr/bin:/bin npm ci --silent --no-audit --no-fund) \
  || { echo "npm ci failed: see the output above"; exit 1; }
echo "mission/ dependencies installed"

say "6. Claude settings for $R"
install -d -o "$R" -g staff -m 700 "$RH/.claude"
cp "$RH/river-bitcube/mission/setup/river-claude-settings.json" "$RH/.claude/settings.json"
chown "$R":staff "$RH/.claude/settings.json"; chmod 600 "$RH/.claude/settings.json"
install -d -o "$R" -g staff -m 700 "$RH/mission-state" "$RH/mission-state/logs"

say "7. service"
sed -e "s#__NODE__#$NODE#g" "$RH/river-bitcube/mission/setup/com.agape.river-mission.plist" > "$PLIST"
chown root:wheel "$PLIST"; chmod 644 "$PLIST"
launchctl bootout system/com.agape.river-mission 2>/dev/null || true
launchctl bootstrap system "$PLIST"
sleep 3
if curl -fsS --max-time 5 http://127.0.0.1:8790/healthz >/dev/null; then echo "mission control is up on 127.0.0.1:8790"
else echo "NOT UP: see $RH/mission-state/logs/"; fi

say "Next (as $GAV, no sudo):"
echo "a) GitHub deploy key (lets river push to this repo only):"
echo "   gh repo deploy-key add $RH/.ssh/river_bitcube_deploy.pub --allow-write -R gavaiken/river-bitcube -t 'river studio agent (mini)'"
echo "   (this script can't read gh's login; the public key is: $(cat $RH/.ssh/river_bitcube_deploy.pub))"
echo "b) bitcube: add this line to C:\\Users\\user\\.ssh\\authorized_keys (or administrators_authorized_keys):"
echo "   $(cat $RH/.ssh/id_ed25519.pub)"
echo "c) Funnel (OK'd, MD9):   /Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg 8790"
echo "d) If the token isn't installed yet: claude setup-token, save it to $TOKEN_SRC (chmod 600), then"
echo "   sudo bash $RH/river-bitcube/mission/setup/install-token.sh"
