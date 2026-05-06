import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { TweetRecord } from '../src/storage/twitter.js';

const TMP = join(os.tmpdir(), `foreflow-res-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });
process.env.FOREFLOW_STATE_DIR = TMP;

const { openDb } = await import('../src/storage/sqlite.js');
const {
  savePrediction,
  updatePredictionReveal,
  updatePredictionResolution,
  getRuntimeState,
} = await import('../src/storage/predictions.js');
const {
  checkAndPostResolutionStatus,
  composeResolutionText,
  _setPostFnForTest,
  _setSleepFnForTest,
} = await import('../src/runner/resolution-status.js');

const db = openDb();
const NOW = 1_800_200_000;

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
    roundId: `res-r${n}`,
    marketId: `res-m${n}`,
    network: 'amoy' as const,
    marketQuestion: `Resolution Q${n}?`,
    marketBaseline: 0.5,
    probability: 0.65,
    predictedAt: NOW - 100_000 + n,
    modelId: 'claude-opus-4-6',
    status: 'revealed' as const,
    ...overrides,
  };
}

function resolveAt(id: number, outcome: 0 | 1, resolvedAt: number, prob = 0.65, baseline = 0.5) {
  updatePredictionReveal(db, id, '0xtx', resolvedAt - 1000);
  const brier = Math.pow(prob - outcome, 2);
  updatePredictionResolution(db, id, outcome, resolvedAt, brier);
}

// ---------------------------------------------------------------------------
// composeResolutionText — unit tests
// ---------------------------------------------------------------------------

test('composeResolutionText: correct format under 240 chars', () => {
  const preds = [
    { roundId: '506', marketId: 'm1', probability: 0.8, outcome: 1, brierScore: 0.04, marketBaseline: 0.6, status: 'scored' as const, agentName: 'a', configuration: 'c', network: 'amoy' as const, marketQuestion: 'Q?', predictedAt: 1, modelId: 'm', resolvedAt: NOW },
    { roundId: '506', marketId: 'm2', probability: 0.3, outcome: 0, brierScore: 0.09, marketBaseline: 0.4, status: 'scored' as const, agentName: 'a', configuration: 'c', network: 'amoy' as const, marketQuestion: 'Q?', predictedAt: 1, modelId: 'm', resolvedAt: NOW },
    { roundId: '506', marketId: 'm3', probability: 0.7, outcome: 0, brierScore: 0.49, marketBaseline: 0.5, status: 'scored' as const, agentName: 'a', configuration: 'c', network: 'amoy' as const, marketQuestion: 'Q?', predictedAt: 1, modelId: 'm', resolvedAt: NOW },
    { roundId: '506', marketId: 'm4', probability: 0.6, outcome: 1, brierScore: 0.16, marketBaseline: 0.55, status: 'scored' as const, agentName: 'a', configuration: 'c', network: 'amoy' as const, marketQuestion: 'Q?', predictedAt: 1, modelId: 'm', resolvedAt: NOW },
  ];

  const text = composeResolutionText('506', preds);
  assert.ok(text.length <= 240, `Too long: ${text.length}`);
  assert.ok(text.includes('Round 506 resolved.'));
  assert.ok(text.includes('4 markets'));
  assert.ok(text.includes('foresightarena.xyz/round/506'));
});

test('composeResolutionText: counts correct directions accurately', () => {
  const preds = [
    { roundId: '1', marketId: 'm1', probability: 0.8, outcome: 1, brierScore: 0.04, status: 'scored' as const, agentName: 'a', configuration: 'c', network: 'amoy' as const, marketQuestion: 'Q?', predictedAt: 1, modelId: 'm', resolvedAt: NOW },  // correct
    { roundId: '1', marketId: 'm2', probability: 0.3, outcome: 0, brierScore: 0.09, status: 'scored' as const, agentName: 'a', configuration: 'c', network: 'amoy' as const, marketQuestion: 'Q?', predictedAt: 1, modelId: 'm', resolvedAt: NOW },  // correct
    { roundId: '1', marketId: 'm3', probability: 0.7, outcome: 0, brierScore: 0.49, status: 'scored' as const, agentName: 'a', configuration: 'c', network: 'amoy' as const, marketQuestion: 'Q?', predictedAt: 1, modelId: 'm', resolvedAt: NOW },  // wrong
  ];
  const text = composeResolutionText('1', preds);
  assert.ok(text.includes('2 correct directions'), `Got: ${text}`);
});

// ---------------------------------------------------------------------------
// checkAndPostResolutionStatus — integration tests
// ---------------------------------------------------------------------------

test('new resolution → post called, last_post_timestamp updated', async () => {
  const p1 = savePrediction(db, seedPred({ agentName: 'foreflow-ensemble', roundId: 'new-res-1', marketId: 'nm1' }));
  resolveAt(p1.id!, 1, NOW - 500);

  const posted: Array<{ name: string; text: string; roundId?: string }> = [];
  _setPostFnForTest(async (name, text, _kind, opts) => {
    posted.push({ name, text, roundId: opts?.relatedRoundId });
    return {} as TweetRecord;
  });

  await checkAndPostResolutionStatus('foreflow-ensemble');

  assert.equal(posted.length, 1, 'Should post once for one resolved round');
  assert.equal(posted[0].roundId, 'new-res-1');
  assert.ok(posted[0].text.includes('Round new-res-1 resolved.'));

  // Verify state updated
  const state = getRuntimeState(db, 'last_resolution_post_at:foreflow-ensemble');
  assert.ok(state !== null, 'State should be set');
  assert.ok(parseInt(state!) > 0);
});

test('no new resolutions since last post → no tweet posted', async () => {
  // checkAndPostResolutionStatus was already called above and set the state
  // All existing resolved predictions are now "old"
  let posted = false;
  _setPostFnForTest(async () => { posted = true; return {} as TweetRecord; });

  await checkAndPostResolutionStatus('foreflow-ensemble');
  assert.equal(posted, false, 'Should not post if no new resolutions');
});

test('dry-run: prints text, does not call post, does not update state', async () => {
  const agent = 'foreflow-pipeline';
  const p = savePrediction(db, seedPred({ agentName: agent, roundId: 'dry-res-1', marketId: 'drm1' }));
  resolveAt(p.id!, 0, NOW - 100);

  let posted = false;
  _setPostFnForTest(async () => { posted = true; return {} as TweetRecord; });

  await checkAndPostResolutionStatus(agent, { dryRun: true });

  assert.equal(posted, false, 'Should not call post in dry-run');
  // State should NOT be updated in dry-run
  const state = getRuntimeState(db, `last_resolution_post_at:${agent}`);
  assert.equal(state, null, 'State should not be set in dry-run');
});

test('resolution from another agent is ignored', async () => {
  // Seed resolved prediction for foreflow-debate
  const p = savePrediction(db, seedPred({ agentName: 'foreflow-debate', roundId: 'other-agent-r', marketId: 'oam1' }));
  resolveAt(p.id!, 1, NOW - 200);

  let posted = false;
  _setPostFnForTest(async () => { posted = true; return {} as TweetRecord; });

  // Check resolution status for foreflow-consensus — should not see debate's resolution
  await checkAndPostResolutionStatus('foreflow-consensus');
  assert.equal(posted, false, "Should not post about another agent's resolution");
});

test('multiple resolved rounds → one post per round', async () => {
  const agent = 'foreflow-debate-multi';  // fresh agent name
  const p1 = savePrediction(db, seedPred({ agentName: agent, roundId: 'multi-r1', marketId: 'mm1' }));
  const p2 = savePrediction(db, seedPred({ agentName: agent, roundId: 'multi-r2', marketId: 'mm2' }));
  resolveAt(p1.id!, 1, NOW - 300);
  resolveAt(p2.id!, 0, NOW - 200);

  const posted: string[] = [];
  _setPostFnForTest(async (_name, _text, _kind, opts) => {
    posted.push(opts?.relatedRoundId ?? '');
    return {} as TweetRecord;
  });

  await checkAndPostResolutionStatus(agent);

  assert.equal(posted.length, 2, 'Should post once per resolved round');
  assert.ok(posted.includes('multi-r1'));
  assert.ok(posted.includes('multi-r2'));
});

// Cleanup
test.after?.(() => {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
  delete process.env.FOREFLOW_STATE_DIR;
});
