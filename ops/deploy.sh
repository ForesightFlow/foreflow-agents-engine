#!/usr/bin/env bash
# One-shot VPS bootstrap. Alternatively, run `foreflow-engine bootstrap-vps`
# for the interactive guided flow.
#
# Usage: bash ops/deploy.sh [--install-root /opt/foreflow]

set -euo pipefail

INSTALL_ROOT="${1:-/opt/foreflow}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(dirname "$SCRIPT_DIR")"

echo "ForeFlow deploy — install root: $INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT"
mkdir -p /var/log/foreflow

REPOS=(
  "git@github.com:ForesightFlow/coordination-experiment.git"
  "git@github.com:ForesightFlow/foreflow-agents.git"
  "git@github.com:ForesightFlow/foreflow-agents-engine.git"
)

for REPO in "${REPOS[@]}"; do
  NAME="${REPO##*/}"
  NAME="${NAME%.git}"
  DEST="$INSTALL_ROOT/$NAME"
  if [[ -d "$DEST" ]]; then
    echo "  $NAME: pulling latest"
    git -C "$DEST" pull --ff-only
  else
    echo "  $NAME: cloning"
    git clone "$REPO" "$DEST"
  fi
  npm install --prefix "$DEST"
  npm run build --prefix "$DEST" 2>/dev/null || true
done

# Copy .env.example if .env doesn't exist yet.
ENV_FILE="$INSTALL_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$INSTALL_ROOT/foreflow-agents-engine/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo ""
  echo "Created $ENV_FILE — edit it and fill in your keys before proceeding."
fi

# Make run-agent.sh executable.
chmod +x "$INSTALL_ROOT/foreflow-agents-engine/ops/run-agent.sh"

echo ""
echo "✓ Deploy complete."
echo "  Next: edit $ENV_FILE, then run:"
echo "    foreflow-engine register-all"
echo "    foreflow-engine healthcheck"
echo "  Then install crontab:"
echo "    crontab -e   # paste contents of ops/crontab.example"
