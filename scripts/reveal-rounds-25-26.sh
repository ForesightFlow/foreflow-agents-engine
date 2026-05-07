#!/usr/bin/env bash
#
# reveal-rounds-25-26.sh
#
# Waits for reveal windows for rounds 25 & 26 and runs foreflow-ensemble discover.
# Polls every 5 minutes inside each window until the round is gone from the queue.
#
# Usage (background):
#   nohup bash scripts/reveal-rounds-25-26.sh >> ~/reveal-25-26.log 2>&1 &
#
# Usage (foreground, watch output):
#   bash scripts/reveal-rounds-25-26.sh
#
# No .env changes are made. DRY_RUN is overridden by --live flag.

set -euo pipefail
ENGINE="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE="$HOME/.foreflow-state/ensemble/.foresight-arena/reveal-queue.json"
LOG="[reveal-25-26 $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

log() { echo "[$(date -u +%H:%M:%SZ)] $*"; }

die() { echo "FATAL: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Verify engine is built
# ---------------------------------------------------------------------------

[[ -f "$ENGINE/dist/cli.js" ]] || die "dist/cli.js not found — run: cd $ENGINE && npm run build"

# ---------------------------------------------------------------------------
# Query on-chain reveal windows for rounds 25 and 26
# Falls back to user-provided estimates if the query fails.
# ---------------------------------------------------------------------------

log "Querying on-chain reveal windows for rounds 25 & 26..."

ROUND_INFO=$(cd "$ENGINE" && npx tsx --input-type=module <<'EOF' 2>/dev/null
import { getRound } from 'foresight-arena';
const [r25, r26] = await Promise.all([
  getRound(25).catch(() => null),
  getRound(26).catch(() => null),
]);
const ts = (r) => r ? Number(r.revealStart) : 0;
const te = (r) => r ? Number(r.revealDeadline) : 0;
console.log(JSON.stringify({
  r25_start: ts(r25), r25_end: te(r25),
  r26_start: ts(r26), r26_end: te(r26),
}));
EOF
) || ROUND_INFO=""

to_epoch() {
  python3 -c "
from datetime import datetime, timezone
print(int(datetime.fromisoformat('$1'.replace('Z','+00:00')).timestamp()))
"
}

# Parse on-chain timestamps or fall back to user-provided estimates
if [[ -n "$ROUND_INFO" ]] && python3 -c "import json,sys; d=json.loads('$ROUND_INFO'); sys.exit(0 if d['r25_start']>0 else 1)" 2>/dev/null; then
  R25_START=$(python3 -c "import json; d=json.loads('$ROUND_INFO'); print(d['r25_start'])")
  R25_END=$(python3 -c "import json; d=json.loads('$ROUND_INFO'); print(d['r25_end'])")
  R26_START=$(python3 -c "import json; d=json.loads('$ROUND_INFO'); print(d['r26_start'])")
  R26_END=$(python3 -c "import json; d=json.loads('$ROUND_INFO'); print(d['r26_end'])")
  log "On-chain data loaded:"
  log "  Round 25 reveal: $(date -u -r "$R25_START" 2>/dev/null || date -u -d "@$R25_START" 2>/dev/null) → $(date -u -r "$R25_END" 2>/dev/null || date -u -d "@$R25_END" 2>/dev/null)"
  log "  Round 26 reveal: $(date -u -r "$R26_START" 2>/dev/null || date -u -d "@$R26_START" 2>/dev/null) → $(date -u -r "$R26_END" 2>/dev/null || date -u -d "@$R26_END" 2>/dev/null)"
else
  log "On-chain query failed or returned empty — using estimated times (UTC)."
  log "  Edit ESTIMATED_* constants in this script if times are wrong."
  # On-chain verified: May 9 12:00 UTC and 18:00 UTC (24h windows until May 10)
  R25_START=$(to_epoch "2026-05-09T12:00:00Z")
  R25_END=$(to_epoch  "2026-05-10T12:00:00Z")
  R26_START=$(to_epoch "2026-05-09T18:00:00Z")
  R26_END=$(to_epoch  "2026-05-10T18:00:00Z")
  log "  Round 25 fallback window: 2026-05-09T12:00Z → 2026-05-10T12:00Z"
  log "  Round 26 fallback window: 2026-05-09T18:00Z → 2026-05-10T18:00Z"
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

queue_has_round() {
  local round="$1"
  [[ -f "$QUEUE" ]] || { echo "no"; return; }
  python3 -c "
import json, sys
try:
    q = json.load(open('$QUEUE'))
    print('yes' if any(e['roundId'] == $round for e in q) else 'no')
except Exception:
    print('yes')  # conservative: assume still pending on error
"
}

run_discover() {
  log "Running discover (live)..."
  cd "$ENGINE" && node dist/cli.js run-agent ensemble --mode discover --live
  log "Discover run completed."
}

sleep_until() {
  local target="$1"
  local label="$2"
  local now
  now=$(date +%s)
  local secs=$(( target - now - 30 ))  # arrive 30s early
  if (( secs > 0 )); then
    local hm
    hm=$(date -u -r "$target" 2>/dev/null || date -u -d "@$target" 2>/dev/null)
    log "Sleeping ${secs}s until ~${hm} (${label})..."
    sleep "$secs"
  fi
}

reveal_round() {
  local round="$1"
  local window_start="$2"
  local window_end="$3"

  if [[ "$(queue_has_round "$round")" == "no" ]]; then
    log "Round $round not in queue — skipping."
    return
  fi

  log "--- Round $round ---"
  sleep_until "$window_start" "round $round reveal window"

  local now
  now=$(date +%s)
  if (( now > window_end )); then
    log "ERROR: Round $round reveal deadline has passed ($(date -u)). Cannot reveal."
    return 1
  fi

  # Retry loop: run discover every 5 min until round is gone from queue
  local attempt=0
  local max_attempts=24  # up to 2h of retries
  while (( attempt < max_attempts )); do
    if [[ "$(queue_has_round "$round")" == "no" ]]; then
      log "Round $round successfully revealed (no longer in queue)."
      return
    fi

    now=$(date +%s)
    if (( now > window_end )); then
      log "ERROR: Round $round reveal deadline passed during retry loop."
      return 1
    fi

    run_discover || log "Discover exited non-zero — will retry."

    if [[ "$(queue_has_round "$round")" == "no" ]]; then
      log "Round $round successfully revealed."
      return
    fi

    (( attempt++ ))
    log "Round $round still in queue. Retry $attempt/$max_attempts in 5 min..."
    sleep 300
  done

  log "ERROR: Round $round not revealed after $max_attempts attempts."
  return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

log "Script started. Engine: $ENGINE"
log "Queue file: $QUEUE"
echo ""

# Determine which round comes first by revealStart
if (( R25_START <= R26_START )); then
  FIRST_ROUND=25; FIRST_START=$R25_START; FIRST_END=$R25_END
  SECOND_ROUND=26; SECOND_START=$R26_START; SECOND_END=$R26_END
else
  FIRST_ROUND=26; FIRST_START=$R26_START; FIRST_END=$R26_END
  SECOND_ROUND=25; SECOND_START=$R25_START; SECOND_END=$R25_END
fi

reveal_round "$FIRST_ROUND" "$FIRST_START" "$FIRST_END"
echo ""
reveal_round "$SECOND_ROUND" "$SECOND_START" "$SECOND_END"

echo ""
log "All done. Both rounds processed."
log "Remaining queue:"
[[ -f "$QUEUE" ]] && python3 -c "
import json
q = json.load(open('$QUEUE'))
if q:
    for e in q: print(f'  roundId={e[\"roundId\"]}')
else:
    print('  (empty)')
" || echo "  (queue file not found)"
