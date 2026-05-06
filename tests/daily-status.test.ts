import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { TweetRecord } from '../src/storage/twitter.js';

const TMP = join(os.tmpdir(), `foreflow-daily-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });
process.env.FOREFLOW_STATE_DIR = TMP;

const { openDb } = await import('../src/storage/sqlite.js');
const {
  savePrediction,
  updatePredictionReveal,
  updatePredictionResolution,
} = await import('../src/storage/predictions.js');
const {
  postDailyStatus,
  composeDailyStatusText,
  MAX_STATUS_TWEET_LENGTH,
  _setPostFnForTest,
  _setSleepFnForTest,
} = await import('../src/runner/daily-status.js');

const db = openDb();
const NOW = 1_800_100_000;

// Suppress sleeps in all tests
_setSleepFnForTest(async () => {});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 1;
function seedPred(overrides: object = {}) {
  const n = seq++;
  return {
    agentName: 'foreflow-ensemble',
    configuration: 'independent_ensemble',
    roundId: `r${n}`,
    marketId: `m${n}`,
    network: 'amoy' as const,
    marketQuestion: `Q${n}?`,
    marketBaseline: 0.5,
    probability: 0.6,
    predictedAt: NOW - 86400 * n,
    modelId: 'claude-opus-4-6',
    status: 'revealed' as const,
    ...overrides,
  };
}

// Reveal and resolve a prediction, returning its id
function revealAndResolve(
  id: number,
  outcome: 0 | 1,
  probability: number,
  marketBaseline: number,
) {
  updatePredictionReveal(db, id, '0xtx', NOW - 3600);
  const brierScore = Math.pow(probability - outcome, 2);
  updatePredictionResolution(db, id, outcome, NOW - 1800, brierScore);
}

// ---------------------------------------------------------------------------
// composeDailyStatusText — unit tests
// ---------------------------------------------------------------------------

test('composeDailyStatusText: full data under 240 chars', () => {
  const stats = {
    totalRounds: 24,
    cumBrier: 0.156,
    cumMarketBrier: 0.152,
    cumAlpha: -0.004,
    recentRounds: 3,
    recentCommits: 8,
    timeframe: '30-day' as const,
  };
  const text = composeDailyStatusText('independent_ensemble', stats, '0xA1b38e04C3f334c2B0D5003C51e857DB86D224d3');
  assert.ok(text.length <= MAX_STATUS_TWEET_LENGTH, `Too long: ${text.length} chars\n${text}`);
  assert.ok(text.includes('[independent_ensemble configuration]'));
  assert.ok(text.includes('Rounds participated: 24'));
  assert.ok(text.includes('Brier: 0.156'));
  assert.ok(text.includes('Alpha: -0.004'));
  assert.ok(text.includes('Past 24h: 8 commits'));
  assert.ok(text.includes('foresightarena.xyz/agent/'));
});

test('composeDailyStatusText: omits Alpha when < 24 rounds', () => {
  const stats = {
    totalRounds: 10,
    cumBrier: 0.20,
    cumMarketBrier: 0.21,
    cumAlpha: 0.01,
    recentRounds: 1,
    recentCommits: 2,
    timeframe: 'All-time' as const,
  };
  const text = composeDailyStatusText('debate', stats, null);
  assert.ok(!text.includes('Alpha'), 'Alpha should be omitted for < 24 rounds');
  assert.ok(text.includes('All-time stats:'));
});

test('composeDailyStatusText: handles no resolved predictions', () => {
  const stats = {
    totalRounds: 3,
    cumBrier: null,
    cumMarketBrier: null,
    cumAlpha: null,
    recentRounds: 2,
    recentCommits: 3,
    timeframe: 'All-time' as const,
  };
  const text = composeDailyStatusText('pipeline', stats, null);
  assert.ok(text.length > 0);
  assert.ok(!text.includes('Brier'), 'No Brier when no resolved predictions');
  assert.ok(text.includes('Rounds participated: 3'));
});

// ---------------------------------------------------------------------------
// postDailyStatus — integration tests (mocked post)
// ---------------------------------------------------------------------------

test('postDailyStatus dryRun: prints text, does not call post', async () => {
  let posted = false;
  _setPostFnForTest(async () => { posted = true; return {} as TweetRecord; });

  await postDailyStatus('foreflow-ensemble', { dryRun: true });

  assert.equal(posted, false, 'Should not call post in dry-run');
});

test('postDailyStatus: with revealed+resolved predictions posts correctly', async () => {
  // Seed two revealed+resolved rounds for foreflow-debate
  const p1 = savePrediction(db, seedPred({ agentName: 'foreflow-debate', roundId: 'dr1', marketId: 'dm1', probability: 0.7, marketBaseline: 0.55 }));
  const p2 = savePrediction(db, seedPred({ agentName: 'foreflow-debate', roundId: 'dr2', marketId: 'dm2', probability: 0.65, marketBaseline: 0.5 }));
  revealAndResolve(p1.id!, 1, 0.7, 0.55);
  revealAndResolve(p2.id!, 0, 0.65, 0.5);

  const posted: string[] = [];
  _setPostFnForTest(async (_name, text) => {
    posted.push(text);
    return {} as TweetRecord;
  });

  await postDailyStatus('foreflow-debate', { dryRun: false });

  assert.equal(posted.length, 1, 'Should post exactly once');
  assert.ok(posted[0].length <= MAX_STATUS_TWEET_LENGTH, `Tweet too long: ${posted[0].length}`);
  assert.ok(posted[0].includes('independent_ensemble') || posted[0].includes('debate') || posted[0].includes('configuration'));
});

test('postDailyStatus: with no rounds does not crash', async () => {
  let posted = false;
  _setPostFnForTest(async () => { posted = true; return {} as TweetRecord; });

  // 'foreflow-consensus' has no predictions in this test DB
  await postDailyStatus('foreflow-consensus', { dryRun: false });
  // posting with 0 rounds is valid (shows "All-time stats: Rounds participated: 0")
  // we just ensure it doesn't throw
});

test('postDailyStatus: reveal-aware — unrevealed rounds excluded from stats', async () => {
  // One revealed round + one unrevealed (committed) round for same agent
  const agent = 'foreflow-orchestrator';
  const revealedPred = savePrediction(db, {
    ...seedPred({ agentName: agent, roundId: 'rev1', marketId: 'mrev1', probability: 0.8 }),
    status: 'revealed' as const,
  });
  updatePredictionReveal(db, revealedPred.id!, '0xrv', NOW - 7200);
  updatePredictionResolution(db, revealedPred.id!, 1, NOW - 3600, Math.pow(0.8 - 1, 2));

  // Committed but not revealed — should be excluded
  savePrediction(db, {
    ...seedPred({ agentName: agent, roundId: 'unrevealed1', marketId: 'mun1', probability: 0.5 }),
    status: 'committed' as const,
  });

  const seenTexts: string[] = [];
  _setPostFnForTest(async (_name, text) => { seenTexts.push(text); return {} as TweetRecord; });

  await postDailyStatus(agent, { dryRun: false });

  assert.equal(seenTexts.length, 1);
  // Text should mention 1 round (only the revealed one), not 2
  assert.ok(seenTexts[0].includes('Rounds participated: 1'), `Got: ${seenTexts[0]}`);
  assert.ok(!seenTexts[0].includes('unrevealed'), 'Unrevealed round must not appear in text');
});

test('postDailyStatus retry: rate-limit triggers backoff then succeeds', async () => {
  let attempts = 0;
  const sleepDelays: number[] = [];
  _setSleepFnForTest(async (ms) => { sleepDelays.push(ms); });
  _setPostFnForTest(async () => {
    attempts++;
    if (attempts < 3) throw new Error('429 Rate limit exceeded');
    return {} as TweetRecord;
  });

  await postDailyStatus('foreflow-ensemble', { dryRun: false });

  assert.equal(attempts, 3, 'Should retry twice then succeed');
  assert.equal(sleepDelays.length, 2, 'Should have slept twice');
  assert.equal(sleepDelays[0], 30_000);
  assert.equal(sleepDelays[1], 60_000);

  // Restore
  _setSleepFnForTest(async () => {});
});

// Cleanup
test.after?.(() => {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
  delete process.env.FOREFLOW_STATE_DIR;
});
