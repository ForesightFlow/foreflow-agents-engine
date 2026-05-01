#!/usr/bin/env bash
# run-agent.sh <mode> <agent>
#
# Called by crontab. Loads .env, sets MODE, and delegates to the engine CLI.
#
# Usage:
#   /opt/foreflow/foreflow-agents-engine/ops/run-agent.sh discover ensemble
#   /opt/foreflow/foreflow-agents-engine/ops/run-agent.sh predict debate
#
# Placeholder paths are substituted by deploy.sh on first install.

set -euo pipefail

MODE="${1:?Usage: run-agent.sh <mode> <agent>}"
AGENT="${2:?Usage: run-agent.sh <mode> <agent>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(dirname "$SCRIPT_DIR")"

# Load shared .env (one level above engine root on VPS, sibling on dev).
for ENV_CANDIDATE in \
    "${FOREFLOW_ENV_FILE:-}" \
    "/opt/foreflow/.env" \
    "${ENGINE_ROOT}/../.env" \
    "${ENGINE_ROOT}/.env"; do
  if [[ -n "$ENV_CANDIDATE" && -f "$ENV_CANDIDATE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_CANDIDATE"
    set +a
    break
  fi
done

# Default FOREFLOW_AGENTS_DIR relative to engine root.
export FOREFLOW_AGENTS_DIR="${FOREFLOW_AGENTS_DIR:-${ENGINE_ROOT}/../foreflow-agents}"

# Pass --live unless DRY_RUN=1 is explicitly set.
LIVE_FLAG="--live"
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  LIVE_FLAG=""
fi

export MODE
# shellcheck disable=SC2086
exec node "${ENGINE_ROOT}/dist/src/cli.js" run-agent "$AGENT" --mode "$MODE" $LIVE_FLAG
