import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const TMP = join(os.tmpdir(), `foreflow-pred-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });
process.env.FOREFLOW_STATE_DIR = TMP;

const { openDb } = await import('../src/storage/sqlite.js');
const {
  savePrediction,
  updatePredictionCommit,
  updatePredictionReveal,
  updatePredictionResolution,
  saveTrace,
  listPredictionsForAgent,
  listTracesForPrediction,
  getRevealedRoundsForAgent,
  getRuntimeState,
  setRuntimeState,
} = await import('../src/storage/predictions.js');

const db = openDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seedSeq = 1;
function makePred(overrides: object = {}) {
  const n = seedSeq++;
  return {
    agentName: 'foreflow-ensemble',
    configuration: 'independent_ensemble',
    roundId: `round-${n}`,
    marketId: `market-${n}`,
    network: 'amoy' as const,
    marketQuestion: `Question ${n}?`,
    probability: 0.6,
    predictedAt: 1_700_000_000 + n,
    modelId: 'claude-opus-4-6',
    status: 'predicted' as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// savePrediction round-trip
// ---------------------------------------------------------------------------

test('savePrediction stores and retrieves all fields', () => {
  const p = makePred({
    marketCategory: 'crypto',
    marketBaseline: 0.55,
    marketVolume: 12000,
    marketResolutionAt: 1_800_000_000,
    revealDeadline: 1_750_000_000,
    probability: 0.72,
    modelId: 'claude-sonnet-4-6',
  });

  const saved = savePrediction(db, p);
  assert.ok(saved.id !== undefined, 'Should have an id');

  const listed = listPredictionsForAgent(db, 'foreflow-ensemble');
  const found = listed.find((r) => r.id === saved.id);
  assert.ok(found, 'Should appear in list');
  assert.equal(found.probability, 0.72);
  assert.equal(found.marketCategory, 'crypto');
  assert.equal(found.marketBaseline, 0.55);
  assert.equal(found.revealDeadline, 1_750_000_000);
  assert.equal(found.status, 'predicted');
});

test('savePrediction upsert updates mutable fields on conflict', () => {
  const p = makePred({ roundId: 'round-upsert', marketId: 'market-upsert', probability: 0.5 });
  savePrediction(db, p);

  // Re-save with updated probability
  savePrediction(db, { ...p, probability: 0.75 });

  const all = listPredictionsForAgent(db, 'foreflow-ensemble');
  const found = all.filter((r) => r.roundId === 'round-upsert');
  assert.equal(found.length, 1, 'Should not create a duplicate');
  assert.equal(found[0].probability, 0.75);
});

// ---------------------------------------------------------------------------
// updatePredictionCommit
// ---------------------------------------------------------------------------

test('updatePredictionCommit sets commit fields and status=committed', () => {
  const saved = savePrediction(db, makePred());
  updatePredictionCommit(db, saved.id!, '0xtxhash', 1_700_001_000, '0xsalt');

  const all = listPredictionsForAgent(db, 'foreflow-ensemble');
  const found = all.find((r) => r.id === saved.id)!;
  assert.equal(found.commitTx, '0xtxhash');
  assert.equal(found.commitAt, 1_700_001_000);
  assert.equal(found.commitSalt, '0xsalt');
  assert.equal(found.status, 'committed');
});

// ---------------------------------------------------------------------------
// updatePredictionReveal
// ---------------------------------------------------------------------------

test('updatePredictionReveal sets reveal fields and status=revealed', () => {
  const saved = savePrediction(db, makePred());
  updatePredictionReveal(db, saved.id!, '0xrevealthash', 1_700_002_000);

  const all = listPredictionsForAgent(db, 'foreflow-ensemble');
  const found = all.find((r) => r.id === saved.id)!;
  assert.equal(found.revealTx, '0xrevealthash');
  assert.equal(found.revealAt, 1_700_002_000);
  assert.equal(found.status, 'revealed');
});

// ---------------------------------------------------------------------------
// updatePredictionResolution / Brier score
// ---------------------------------------------------------------------------

test('updatePredictionResolution computes Brier correctly', () => {
  const saved = savePrediction(db, makePred({ probability: 0.8 }));
  // Brier = (0.8 - 1)^2 = 0.04
  updatePredictionResolution(db, saved.id!, 1, 1_700_003_000, Math.pow(0.8 - 1, 2));

  const all = listPredictionsForAgent(db, 'foreflow-ensemble');
  const found = all.find((r) => r.id === saved.id)!;
  assert.equal(found.outcome, 1);
  assert.equal(found.resolvedAt, 1_700_003_000);
  assert.ok(Math.abs((found.brierScore ?? 0) - 0.04) < 1e-9);
  assert.equal(found.status, 'scored');
});

// ---------------------------------------------------------------------------
// saveTrace / listTracesForPrediction round-trip
// ---------------------------------------------------------------------------

test('saveTrace and listTracesForPrediction round-trip', () => {
  const pred = savePrediction(db, makePred());
  saveTrace(db, {
    predictionId: pred.id!,
    callIndex: 0,
    agentRole: 'researcher',
    systemPrompt: 'System',
    userPrompt: 'User',
    responseText: 'Response',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.005,
    durationMs: 1200,
    createdAt: 1_700_004_000,
  });
  saveTrace(db, {
    predictionId: pred.id!,
    callIndex: 1,
    agentRole: 'integrator',
    systemPrompt: 'Sys2',
    userPrompt: 'User2',
    responseText: 'Resp2',
    inputTokens: 80,
    outputTokens: 40,
    costUsd: 0.004,
    createdAt: 1_700_004_010,
  });

  const traces = listTracesForPrediction(db, pred.id!);
  assert.equal(traces.length, 2);
  assert.equal(traces[0].callIndex, 0);
  assert.equal(traces[0].agentRole, 'researcher');
  assert.equal(traces[0].durationMs, 1200);
  assert.equal(traces[1].callIndex, 1);
  assert.equal(traces[1].toolCallsJson, undefined);
});

// ---------------------------------------------------------------------------
// getRevealedRoundsForAgent — CRITICAL reveal-awareness test
// ---------------------------------------------------------------------------

test('getRevealedRoundsForAgent filters out unrevealed rounds', () => {
  const agent = 'foreflow-debate';
  const NOW = 1_800_100_000;

  // Round A: fully revealed, no deadline set → should appear
  const rA1 = savePrediction(db, {
    ...makePred(),
    agentName: agent,
    roundId: 'rA',
    marketId: 'm1',
    status: 'revealed',
  });
  updatePredictionReveal(db, rA1.id!, '0xa1', NOW - 10_000);

  // Round B: one prediction committed, not revealed → must NOT appear
  savePrediction(db, {
    ...makePred(),
    agentName: agent,
    roundId: 'rB',
    marketId: 'm1',
    status: 'committed',
  });

  // Round C: fully revealed but reveal_deadline in the future → must NOT appear
  const rC1 = savePrediction(db, {
    ...makePred(),
    agentName: agent,
    roundId: 'rC',
    marketId: 'm1',
    revealDeadline: NOW + 3600,
    status: 'revealed',
  });
  updatePredictionReveal(db, rC1.id!, '0xc1', NOW - 5_000);

  // Round D: two predictions, both revealed → should appear
  const rD1 = savePrediction(db, {
    ...makePred(),
    agentName: agent,
    roundId: 'rD',
    marketId: 'm1',
    status: 'revealed',
  });
  const rD2 = savePrediction(db, {
    ...makePred(),
    agentName: agent,
    roundId: 'rD',
    marketId: 'm2',
    status: 'revealed',
  });
  updatePredictionReveal(db, rD1.id!, '0xd1', NOW - 20_000);
  updatePredictionReveal(db, rD2.id!, '0xd2', NOW - 19_000);

  // Round E: two predictions, only one revealed → must NOT appear
  const rE1 = savePrediction(db, {
    ...makePred(),
    agentName: agent,
    roundId: 'rE',
    marketId: 'm1',
    status: 'revealed',
  });
  savePrediction(db, {
    ...makePred(),
    agentName: agent,
    roundId: 'rE',
    marketId: 'm2',
    status: 'predicted',
  });
  updatePredictionReveal(db, rE1.id!, '0xe1', NOW - 1_000);

  const revealed = getRevealedRoundsForAgent(db, agent, NOW);
  const roundIds = revealed.map((r) => r.roundId);

  assert.ok(roundIds.includes('rA'), 'Round A (revealed, no deadline) should appear');
  assert.ok(roundIds.includes('rD'), 'Round D (both revealed) should appear');

  assert.ok(!roundIds.includes('rB'), 'Round B (committed, not revealed) must NOT appear');
  assert.ok(!roundIds.includes('rC'), 'Round C (future deadline) must NOT appear');
  assert.ok(!roundIds.includes('rE'), 'Round E (partially revealed) must NOT appear');

  // Verify predictions are included in result
  const dResult = revealed.find((r) => r.roundId === 'rD')!;
  assert.equal(dResult.predictions.length, 2);
});

test('getRevealedRoundsForAgent returns empty for fresh agent', () => {
  const result = getRevealedRoundsForAgent(db, 'foreflow-unknown-agent', 1_800_000_000);
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

test('getRuntimeState returns null for missing key', () => {
  assert.equal(getRuntimeState(db, 'no-such-key'), null);
});

test('setRuntimeState / getRuntimeState round-trip and upsert', () => {
  setRuntimeState(db, 'test-key', 'value1');
  assert.equal(getRuntimeState(db, 'test-key'), 'value1');
  setRuntimeState(db, 'test-key', 'value2');
  assert.equal(getRuntimeState(db, 'test-key'), 'value2');
});

// Cleanup
test.after?.(() => {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
  delete process.env.FOREFLOW_STATE_DIR;
});
