import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const TMP = join(os.tmpdir(), `foreflow-event-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });
process.env.FOREFLOW_STATE_DIR = TMP;

const { parseAgentEvent } = await import('../src/events/types.js');
const { EventHandler } = await import('../src/events/handler.js');
const { openDb } = await import('../src/storage/sqlite.js');
const {
  listPredictionsForAgent,
  listTracesForPrediction,
} = await import('../src/storage/predictions.js');

const db = openDb();
const NOW = Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// parseAgentEvent — pure function tests
// ---------------------------------------------------------------------------

test('parseAgentEvent: valid prediction_started', () => {
  const line = JSON.stringify({
    kind: 'prediction_started',
    timestamp: NOW,
    agentName: 'foreflow-ensemble',
    configuration: 'independent_ensemble',
    roundId: '42',
    marketId: '0xabc',
    marketQuestion: 'Will X happen?',
    modelId: 'claude-opus-4-6',
  });
  const event = parseAgentEvent(line);
  assert.ok(event !== null);
  assert.equal(event!.kind, 'prediction_started');
});

test('parseAgentEvent: valid llm_call', () => {
  const line = JSON.stringify({
    kind: 'llm_call',
    timestamp: NOW,
    predictionRef: { roundId: '42', marketId: '0xabc' },
    callIndex: 0,
    agentRole: 'researcher',
    systemPrompt: 'sys',
    userPrompt: 'usr',
    responseText: 'resp',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
  });
  const event = parseAgentEvent(line);
  assert.ok(event !== null);
  assert.equal(event!.kind, 'llm_call');
});

test('parseAgentEvent: invalid JSON returns null', () => {
  assert.equal(parseAgentEvent('not json'), null);
  assert.equal(parseAgentEvent('{bad json'), null);
  assert.equal(parseAgentEvent(''), null);
});

test('parseAgentEvent: unknown kind returns null', () => {
  assert.equal(parseAgentEvent(JSON.stringify({ kind: 'mystery_event', foo: 1 })), null);
});

test('parseAgentEvent: non-object JSON returns null', () => {
  assert.equal(parseAgentEvent(JSON.stringify([1, 2, 3])), null);
  assert.equal(parseAgentEvent(JSON.stringify(42)), null);
});

test('parseAgentEvent: plain log line (no leading {) returns null', () => {
  assert.equal(parseAgentEvent('INFO: agent started'), null);
  assert.equal(parseAgentEvent('2026-05-06T18:00:00Z [DEBUG] something'), null);
});

// ---------------------------------------------------------------------------
// EventHandler — DB integration tests
// ---------------------------------------------------------------------------

const AGENT = 'foreflow-pipe-test';

test('EventHandler: prediction_started creates DB row', () => {
  const handler = new EventHandler(db, AGENT, 'amoy');
  handler.dispatch({
    kind: 'prediction_started',
    timestamp: NOW,
    agentName: AGENT,
    configuration: 'test_config',
    roundId: 'r100',
    marketId: 'm100',
    marketQuestion: 'Test market?',
    marketBaseline: 0.5,
    modelId: 'claude-opus-4-6',
  });

  const preds = listPredictionsForAgent(db, AGENT);
  assert.equal(preds.length, 1);
  assert.equal(preds[0].roundId, 'r100');
  assert.equal(preds[0].configuration, 'test_config');
  assert.equal(preds[0].status, 'predicted');
});

test('EventHandler: llm_call creates trace linked to prediction', () => {
  const handler = new EventHandler(db, AGENT, 'amoy');

  // prediction must already exist from previous test
  handler.dispatch({
    kind: 'llm_call',
    timestamp: NOW + 1,
    predictionRef: { roundId: 'r100', marketId: 'm100' },
    callIndex: 0,
    agentRole: 'researcher',
    systemPrompt: 'sys',
    userPrompt: 'usr',
    responseText: 'resp text',
    toolCalls: [{ name: 'search' }],
    inputTokens: 200,
    outputTokens: 100,
    costUsd: 0.012,
    durationMs: 1500,
  });

  const preds = listPredictionsForAgent(db, AGENT);
  const pred = preds.find((p) => p.roundId === 'r100')!;
  const traces = listTracesForPrediction(db, pred.id!);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].agentRole, 'researcher');
  assert.equal(traces[0].inputTokens, 200);
  assert.equal(traces[0].toolCallsJson, JSON.stringify([{ name: 'search' }]));
});

test('EventHandler: prediction_complete updates probability and tokens', () => {
  const handler = new EventHandler(db, AGENT, 'amoy');
  handler.dispatch({
    kind: 'prediction_complete',
    timestamp: NOW + 6,
    predictionRef: { roundId: 'r100', marketId: 'm100' },
    probability: 0.73,
    totalInputTokens: 200,
    totalOutputTokens: 100,
    totalCostUsd: 0.012,
  });

  const preds = listPredictionsForAgent(db, AGENT);
  const pred = preds.find((p) => p.roundId === 'r100')!;
  assert.equal(pred.probability, 0.73);
  assert.equal(pred.totalInputTokens, 200);
  assert.equal(pred.totalCostUsd, 0.012);
});

test('EventHandler: prediction_failed sets status and reason', () => {
  const handler = new EventHandler(db, AGENT, 'amoy');

  // First create a new prediction to fail
  handler.dispatch({
    kind: 'prediction_started',
    timestamp: NOW,
    agentName: AGENT,
    configuration: 'test_config',
    roundId: 'r101',
    marketId: 'm101',
    marketQuestion: 'Will it fail?',
    modelId: 'claude-opus-4-6',
  });

  handler.dispatch({
    kind: 'prediction_failed',
    timestamp: NOW + 2,
    predictionRef: { roundId: 'r101', marketId: 'm101' },
    reason: 'API timeout after 30s',
  });

  const preds = listPredictionsForAgent(db, AGENT);
  const pred = preds.find((p) => p.roundId === 'r101')!;
  assert.equal(pred.status, 'failed');
  assert.equal(pred.failureReason, 'API timeout after 30s');
});

test('EventHandler: llm_call for unknown prediction emits stderr, does not throw', () => {
  const handler = new EventHandler(db, AGENT, 'amoy');
  // Should not throw
  assert.doesNotThrow(() => {
    handler.dispatch({
      kind: 'llm_call',
      timestamp: NOW,
      predictionRef: { roundId: 'r-nonexistent', marketId: 'm-nonexistent' },
      callIndex: 0,
      agentRole: 'researcher',
      systemPrompt: 's', userPrompt: 'u', responseText: 'r',
      inputTokens: 10, outputTokens: 5, costUsd: 0.001,
    });
  });
});

test('mixed event and log lines via parseAgentEvent', () => {
  const lines = [
    '{"kind":"prediction_started","timestamp":1,"agentName":"x","configuration":"c","roundId":"r","marketId":"m","marketQuestion":"Q?","modelId":"m1"}',
    'INFO: regular log line',
    '{"kind":"unknown_event","data":1}',
    '',
    '{"kind":"prediction_complete","timestamp":2,"predictionRef":{"roundId":"r","marketId":"m"},"probability":0.5,"totalInputTokens":1,"totalOutputTokens":1,"totalCostUsd":0.0}',
  ];

  const events = lines.map(parseAgentEvent).filter(Boolean);
  assert.equal(events.length, 2, 'Only valid known events should parse');
  assert.equal(events[0]!.kind, 'prediction_started');
  assert.equal(events[1]!.kind, 'prediction_complete');
});

// Cleanup
test.after?.(() => {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
  delete process.env.FOREFLOW_STATE_DIR;
});
