#!/usr/bin/env bash
# Copies the project to the instance and (re)starts it there.
# Usage: deploy/push.sh <public-ip>
set -euo pipefail

IP="${1:?usage: push.sh <public-ip>}"
KEY="${SSH_KEY:-$HOME/.ssh/oci_autoclaim}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new ubuntu@$IP"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ">>> syncing source (no node_modules, no local profile data)"
rsync -az --delete \
  --exclude node_modules --exclude web/node_modules --exclude web/dist \
  --exclude server/data --exclude .git \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$HERE/" "ubuntu@$IP:~/autoclaim/"

# Session cookies travel separately and never enter the image or a git-tracked
# path. --ignore-existing so a redeploy can't clobber profiles or the log that
# the running instance has since updated.
if [ -f "$HERE/server/data/config.json" ]; then
  echo ">>> seeding profiles (only if not already present)"
  rsync -az --ignore-existing \
    -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
    "$HERE/server/data/config.json" "ubuntu@$IP:~/autoclaim/server/data/config.json"
  $SSH "chmod 600 ~/autoclaim/server/data/config.json"
fi

echo ">>> build and start"
$SSH "cd ~/autoclaim && docker compose up -d --build"

echo ">>> status"
$SSH "cd ~/autoclaim && docker compose ps && docker compose logs --tail=20"

cat <<EOF

Deployed. The UI is not exposed to the internet by design - reach it with a
tunnel from your machine:

  ssh -i $KEY -L 8787:127.0.0.1:8787 ubuntu@$IP

then open http://127.0.0.1:8787
EOF
