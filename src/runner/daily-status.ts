import { openDb } from '../storage/sqlite.js';
import { getRevealedRoundsForAgent } from '../storage/predictions.js';
import { loadRegistration } from '../lib/state.js';
import { postFromAgent } from '../twitter/post.js';
import type { AgentName } from '../lib/env.js';
import type { TweetRecord } from '../storage/twitter.js';

export const MAX_STATUS_TWEET_LENGTH = 240;

const THIRTY_DAYS_S = 30 * 24 * 3600;
const SEVEN_ROUNDS_THRESHOLD = 7;
const TWENTY_FOUR_ROUNDS_THRESHOLD = 24;

// Static fallback configuration names derived from agent naming convention
const AGENT_CONFIGURATIONS: Record<string, string> = {
  'foreflow-ensemble': 'independent_ensemble',
  'foreflow-debate': 'debate',
  'foreflow-orchestrator': 'orchestrator',
  'foreflow-pipeline': 'pipeline',
  'foreflow-consensus': 'consensus',
};

// Injectable for tests — avoids actual Twitter API calls
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
// Stats computation
// ---------------------------------------------------------------------------

interface DailyStats {
  totalRounds: number;
  cumBrier: number | null;
  cumMarketBrier: number | null;
  cumAlpha: number | null;
  recentRounds: number;
  recentCommits: number;
  timeframe: '30-day' | 'All-time';
}

function computeStats(
  rounds: ReturnType<typeof getRevealedRoundsForAgent>,
  nowUnix: number,
): DailyStats {
  const all = rounds.flatMap((r) => r.predictions);
  const resolved = all.filter((p) => p.outcome !== undefined && p.outcome !== null);

  let cumBrier: number | null = null;
  let cumMarketBrier: number | null = null;
  let cumAlpha: number | null = null;

  if (resolved.length > 0) {
    cumBrier =
      resolved.reduce((s, p) => s + (p.brierScore ?? 0), 0) / resolved.length;

    const withBaseline = resolved.filter(
      (p) => p.marketBaseline !== undefined && p.outcome !== undefined,
    );
    if (withBaseline.length > 0) {
      const sumMarketBrier = withBaseline.reduce(
        (s, p) => s + Math.pow((p.marketBaseline! - p.outcome!), 2),
        0,
      );
      cumMarketBrier = sumMarketBrier / withBaseline.length;
      cumAlpha = cumMarketBrier - cumBrier;
    }
  }

  const dayAgo = nowUnix - 86400;
  const recentPreds = all.filter((p) => p.predictedAt > dayAgo);
  const recentRounds = new Set(recentPreds.map((p) => p.roundId)).size;
  const recentCommits = recentPreds.filter(
    (p) => p.commitAt !== undefined && p.commitAt > dayAgo,
  ).length;

  const thirtyDaysAgo = nowUnix - THIRTY_DAYS_S;
  const hasOldData = all.some((p) => p.predictedAt <= thirtyDaysAgo);
  const timeframe: '30-day' | 'All-time' =
    hasOldData || rounds.length >= SEVEN_ROUNDS_THRESHOLD ? '30-day' : 'All-time';

  return {
    totalRounds: rounds.length,
    cumBrier,
    cumMarketBrier,
    cumAlpha,
    recentRounds,
    recentCommits,
    timeframe,
  };
}

// ---------------------------------------------------------------------------
// Tweet composition
// ---------------------------------------------------------------------------

function shortAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

export function composeDailyStatusText(
  configuration: string,
  stats: DailyStats,
  agentAddress: string | null,
): string {
  const lines: string[] = [];
  lines.push(`[${configuration} configuration]`);
  lines.push('');
  lines.push(`${stats.timeframe} stats:`);
  lines.push(`• Rounds participated: ${stats.totalRounds}`);

  if (stats.cumBrier !== null) {
    const brier = stats.cumBrier.toFixed(3);
    const mkt = stats.cumMarketBrier !== null ? stats.cumMarketBrier.toFixed(3) : '?';
    lines.push(`• Brier: ${brier} (market: ${mkt})`);

    if (stats.cumAlpha !== null && stats.totalRounds >= TWENTY_FOUR_ROUNDS_THRESHOLD) {
      const sign = stats.cumAlpha >= 0 ? '+' : '';
      lines.push(`• Alpha: ${sign}${stats.cumAlpha.toFixed(3)}`);
    }
  }

  if (stats.recentCommits > 0 || stats.recentRounds > 0) {
    lines.push('');
    const c = stats.recentCommits;
    const r = stats.recentRounds;
    lines.push(
      `Past 24h: ${c} commit${c !== 1 ? 's' : ''} across ${r} round${r !== 1 ? 's' : ''}.`,
    );
  }

  if (agentAddress) {
    lines.push('');
    lines.push(`foresightarena.xyz/agent/${shortAddr(agentAddress)}`);
  }

  return lines.join('\n');
}

function composeTerse(
  configuration: string,
  stats: DailyStats,
  agentAddress: string | null,
): string {
  const parts: string[] = [`[${configuration} configuration]`];
  if (stats.cumBrier !== null) {
    parts.push(`Brier: ${stats.cumBrier.toFixed(3)}.`);
  }
  if (agentAddress) {
    parts.push(`foresightarena.xyz/agent/${shortAddr(agentAddress)}`);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function postDailyStatus(
  agentName: string,
  opts?: { dryRun?: boolean },
): Promise<void> {
  const dryRun = opts?.dryRun ?? false;
  const nowUnix = Math.floor(Date.now() / 1000);

  const db = openDb();
  const rounds = getRevealedRoundsForAgent(db, agentName, nowUnix);
  const all = rounds.flatMap((r) => r.predictions);

  // Derive configuration: prefer DB-stored value, fall back to static map
  const configCounts = new Map<string, number>();
  for (const p of all) {
    configCounts.set(p.configuration, (configCounts.get(p.configuration) ?? 0) + 1);
  }
  const configuration =
    configCounts.size > 0
      ? [...configCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : (AGENT_CONFIGURATIONS[agentName] ?? agentName.replace('foreflow-', '') + '_configuration');

  // Get wallet address from registration state
  const shortName = agentName.replace('foreflow-', '') as AgentName;
  const reg = loadRegistration(shortName);
  const agentAddress = reg?.address ?? null;

  const stats = computeStats(rounds, nowUnix);

  let text = composeDailyStatusText(configuration, stats, agentAddress);

  if (text.length > MAX_STATUS_TWEET_LENGTH) {
    text = composeTerse(configuration, stats, agentAddress);
  }
  if (text.length > MAX_STATUS_TWEET_LENGTH) {
    text = text.slice(0, MAX_STATUS_TWEET_LENGTH - 1) + '…';
  }

  if (dryRun) {
    console.log(`[DRY-RUN] Daily status for ${agentName} (${text.length} chars):`);
    console.log('─'.repeat(50));
    console.log(text);
    console.log('─'.repeat(50));
    console.log(`Rounds included (revealed only): ${rounds.length}`);
    return;
  }

  const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await _postFn(agentName, text, 'daily_status');
      console.log(`✓ Daily status posted for ${agentName}`);
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetriable =
        msg.includes('429') ||
        msg.includes('Rate limit') ||
        msg.includes('503') ||
        msg.includes('timeout');

      if (isRetriable && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(`⚠ Twitter error (${msg.slice(0, 40)}) — retrying in ${delay / 1000}s...`);
        await _sleepFn(delay);
        continue;
      }

      console.error(`✗ Daily status post failed for ${agentName}: ${msg}`);
      return;
    }
  }
}
