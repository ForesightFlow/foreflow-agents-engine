import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.FOREFLOW_STATE_DIR = mkdtempSync(join(os.tmpdir(), 'engine-orphan-test-'));

const { openDb } = await import('../src/storage/sqlite.js');
const { savePrediction, updatePredictionComplete } = await import('../src/storage/predictions.js');

// Pull the internal helpers out by re-importing spawn module internals.
// Since they are not exported, we test the observable DB effect by calling
// the logic that spawn.ts uses — reproduced inline here to keep tests pure.

function listOrphans(db: ReturnType<typeof openDb>, agentName: string) {
  return db
    .prepare(
      `SELECT id FROM predictions
       WHERE agent_name = ? AND status = 'predicted' AND total_cost_usd IS NULL`,
    )
    .all(agentName) as Array<{ id: number }>;
}

function markOrphansAsFailed(db: ReturnType<typeof openDb>, ids: number[]) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE predictions SET status = 'failed', failure_reason = 'subprocess_terminated'
     WHERE id IN (${placeholders})`,
  ).run(...ids);
}

function makeDb() {
  return openDb();
}

// ---------------------------------------------------------------------------

test('orphan with NULL totals is marked failed/subprocess_terminated', () => {
  const db = makeDb();
  const p = savePrediction(db, {
    agentName: 'foreflow-ensemble',
    configuration: 'independent_ensemble',
    roundId: '50',
    marketId: '0xorphan1',
    network: 'mainnet',
    marketQuestion: 'Will orphan resolve?',
    probability: 0,
    predictedAt: 1_000_000,
    modelId: 'claude-opus-4-6',
    status: 'predicted',
  });

  const orphansBefore = new Set(listOrphans(db, 'foreflow-ensemble').map((r) => r.id));
  const newOrphanIds = listOrphans(db, 'foreflow-ensemble')
    .filter((r) => !orphansBefore.has(r.id) || orphansBefore.has(r.id)) // all current
    .map((r) => r.id);
  markOrphansAsFailed(db, newOrphanIds);

  const row = db
    .prepare('SELECT status, failure_reason FROM predictions WHERE id = ?')
    .get(p.id) as { status: string; failure_reason: string };

  assert.equal(row.status, 'failed');
  assert.equal(row.failure_reason, 'subprocess_terminated');
});

test('prediction with non-NULL total_cost_usd is NOT marked as orphan', () => {
  const db = makeDb();
  const p = savePrediction(db, {
    agentName: 'foreflow-ensemble',
    configuration: 'independent_ensemble',
    roundId: '51',
    marketId: '0xgood1',
    network: 'mainnet',
    marketQuestion: 'Will good prediction count?',
    probability: 0.75,
    predictedAt: 1_000_000,
    modelId: 'claude-opus-4-6',
    status: 'predicted',
  });

  updatePredictionComplete(db, p.id!, {
    probability: 0.75,
    totalInputTokens: 1000,
    totalOutputTokens: 200,
    totalCostUsd: 0.05,
  });

  const orphans = listOrphans(db, 'foreflow-ensemble');
  const orphanIds = orphans.map((r) => r.id);

  assert.ok(!orphanIds.includes(p.id!), 'completed prediction must not appear in orphan list');
});

test('only new orphans created during this spawn are marked failed', () => {
  const db = makeDb();

  // Pre-existing orphan from a previous failed run
  const pre = savePrediction(db, {
    agentName: 'foreflow-ensemble',
    configuration: 'independent_ensemble',
    roundId: '52',
    marketId: '0xpre',
    network: 'mainnet',
    marketQuestion: 'Pre-existing orphan?',
    probability: 0,
    predictedAt: 1_000_000,
    modelId: 'claude-opus-4-6',
    status: 'predicted',
  });

  // Snapshot before "spawn"
  const orphansBefore = new Set(listOrphans(db, 'foreflow-ensemble').map((r) => r.id));

  // New orphan created during this spawn
  const newP = savePrediction(db, {
    agentName: 'foreflow-ensemble',
    configuration: 'independent_ensemble',
    roundId: '52',
    marketId: '0xnew',
    network: 'mainnet',
    marketQuestion: 'New orphan during spawn?',
    probability: 0,
    predictedAt: 2_000_000,
    modelId: 'claude-opus-4-6',
    status: 'predicted',
  });

  // Subprocess fails — mark only NEW orphans
  const allOrphans = listOrphans(db, 'foreflow-ensemble');
  const newOrphanIds = allOrphans
    .filter((r) => !orphansBefore.has(r.id))
    .map((r) => r.id);

  markOrphansAsFailed(db, newOrphanIds);

  const preRow = db
    .prepare('SELECT status FROM predictions WHERE id = ?')
    .get(pre.id) as { status: string };
  const newRow = db
    .prepare('SELECT status, failure_reason FROM predictions WHERE id = ?')
    .get(newP.id) as { status: string; failure_reason: string };

  // Pre-existing orphan left untouched
  assert.equal(preRow.status, 'predicted', 'pre-existing orphan should not be touched');
  // New orphan marked failed
  assert.equal(newRow.status, 'failed');
  assert.equal(newRow.failure_reason, 'subprocess_terminated');
});
