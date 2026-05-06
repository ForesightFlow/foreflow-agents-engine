#!/usr/bin/env bash
# run-status.sh <kind> <agent>
#
# Called by crontab. Posts a daily status tweet or per-round resolution tweet.
#
# Usage:
#   /opt/foreflow/foreflow-agents-engine/ops/run-status.sh daily      foreflow-ensemble
#   /opt/foreflow/foreflow-agents-engine/ops/run-status.sh resolution foreflow-ensemble
#
# kind:
#   daily      — compose and post the daily cumulative-stats tweet (18:00 UTC target)
#   resolution — check for newly resolved rounds and post one tweet per round

set -euo pipefail

KIND="${1:?Usage: run-status.sh <daily|resolution> <agent>}"
AGENT="${2:?Usage: run-status.sh <daily|resolution> <agent>}"

if [[ "$KIND" != "daily" && "$KIND" != "resolution" ]]; then
  echo "run-status.sh: kind must be 'daily' or 'resolution', got '$KIND'" >&2
  exit 1
fi

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

if [[ "$KIND" == "daily" ]]; then
  exec node "${ENGINE_ROOT}/dist/src/cli.js" post-daily-status "$AGENT"
else
  exec node "${ENGINE_ROOT}/dist/src/cli.js" post-resolution-status "$AGENT"
fi
