import { openDb } from '../storage/sqlite.js';
import {
  getRuntimeState,
  setRuntimeState,
  getResolvedAndRevealedRoundsForAgent,
} from '../storage/predictions.js';
import { postFromAgent } from '../twitter/post.js';
import type { PredictionRecord } from '../storage/predictions.js';

const MAX_TWEET_LENGTH = 240;

// Injectable for tests
export let _postFn: typeof postFromAgent = postFromAgent;
export function _setPostFnForTest(fn: typeof postFromAgent): void {
  _postFn = fn;
}

export let _sleepFn: (ms: number) => Promise<void> = (ms) =>
  new Promise((r) => setTimeout(r, ms));
export function _setSleepFnForTest(fn: (ms: number) => Promise<void>): void {
  _sleepFn = fn;
}

// ---------------------------------------------------------------------------
// Tweet composition
// ---------------------------------------------------------------------------

function countCorrectDirections(preds: PredictionRecord[]): number {
  return preds.filter((p) => {
    if (p.outcome === undefined || p.outcome === null) return false;
    return (p.probability > 0.5 && p.outcome === 1) ||
           (p.probability < 0.5 && p.outcome === 0) ||
           (p.probability === 0.5);
  }).length;
}

export function composeResolutionText(
  roundId: string,
  preds: PredictionRecord[],
): string {
  const resolved = preds.filter((p) => p.outcome !== undefined && p.outcome !== null);
  const n = resolved.length;
  const correct = countCorrectDirections(resolved);

  const agentBrier =
    n > 0
      ? resolved.reduce((s, p) => s + (p.brierScore ?? 0), 0) / n
      : null;

  const withBaseline = resolved.filter((p) => p.marketBaseline !== undefined);
  const mktBrier =
    withBaseline.length > 0
      ? withBaseline.reduce(
          (s, p) => s + Math.pow((p.marketBaseline! - p.outcome!), 2),
          0,
        ) / withBaseline.length
      : null;

  const lines: string[] = [];
  lines.push(`Round ${roundId} resolved.`);
  lines.push(`${n} market${n !== 1 ? 's' : ''}, ${correct} correct direction${correct !== 1 ? 's' : ''}.`);

  if (agentBrier !== null) {
    const a = agentBrier.toFixed(3);
    const m = mktBrier !== null ? mktBrier.toFixed(3) : '?';
    lines.push(`Round Brier: ${a} (market: ${m}).`);
  }

  lines.push('');
  lines.push(`foresightarena.xyz/round/${roundId}`);

  return lines.join('\n');
}

function buildText(roundId: string, predictions: PredictionRecord[]): string {
  let text = composeResolutionText(roundId, predictions);
  if (text.length > MAX_TWEET_LENGTH) {
    text = `Round ${roundId} resolved. ${predictions.length} markets.\nforesightarena.xyz/round/${roundId}`;
  }
  if (text.length > MAX_TWEET_LENGTH) {
    text = text.slice(0, MAX_TWEET_LENGTH - 1) + '…';
  }
  return text;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkAndPostResolutionStatus(
  agentName: string,
  opts?: { dryRun?: boolean },
): Promise<void> {
  const dryRun = opts?.dryRun ?? false;
  const now = Math.floor(Date.now() / 1000);
  const db = openDb();
  const stateKey = `last_resolution_post_at:${agentName}`;

  if (dryRun) {
    // Dry-run: read-only, no state update, no lock needed
    const lastPostAt = parseInt(getRuntimeState(db, stateKey) ?? '0', 10);
    const eligibleRounds = getResolvedAndRevealedRoundsForAgent(db, agentName, lastPostAt, now);

    if (eligibleRounds.length === 0) {
      console.log(`[DRY-RUN] No new resolutions for ${agentName} since last post.`);
      return;
    }

    for (const { roundId, predictions } of eligibleRounds) {
      const text = buildText(roundId, predictions);
      console.log(`[DRY-RUN] Resolution status for ${agentName} round ${roundId} (${text.length} chars):`);
      console.log('─'.repeat(50));
      console.log(text);
      console.log('─'.repeat(50));
    }
    return;
  }

  // Live path: IMMEDIATE transaction prevents parallel cron ticks from racing on
  // lastPostAt and posting duplicate tweets. A second process trying BEGIN IMMEDIATE
  // while this one holds the lock will block (up to busy_timeout) then skip safely.
  db.pragma('busy_timeout = 10000');
  db.exec('BEGIN IMMEDIATE');
  try {
    const lastPostAt = parseInt(getRuntimeState(db, stateKey) ?? '0', 10);
    const eligibleRounds = getResolvedAndRevealedRoundsForAgent(db, agentName, lastPostAt, now);

    if (eligibleRounds.length === 0) {
      db.exec('COMMIT');
      return;
    }

    let highestResolvedAt = lastPostAt;

    for (const { roundId, predictions } of eligibleRounds) {
      const text = buildText(roundId, predictions);
      const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];
      let posted = false;

      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
          await _postFn(agentName, text, 'resolution_status', { relatedRoundId: roundId });
          console.log(`✓ Resolution status posted for ${agentName} round ${roundId}`);
          posted = true;
          break;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const isRetriable =
            msg.includes('429') ||
            msg.includes('Rate limit') ||
            msg.includes('503') ||
            msg.includes('timeout');
          if (isRetriable && attempt < RETRY_DELAYS_MS.length) {
            await _sleepFn(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          console.error(`✗ Resolution post failed for ${agentName} round ${roundId}: ${msg}`);
          break;
        }
      }

      if (!posted) continue;

      for (const p of predictions) {
        if ((p.resolvedAt ?? 0) > highestResolvedAt) highestResolvedAt = p.resolvedAt!;
      }
    }

    if (highestResolvedAt > lastPostAt) {
      setRuntimeState(db, stateKey, String(highestResolvedAt));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
