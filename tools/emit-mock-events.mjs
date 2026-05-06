#!/usr/bin/env node
/**
 * Emits a sequence of mock JSONL agent events to stdout for testing
 * the engine's receive-events pipeline.
 *
 * Usage:
 *   node tools/emit-mock-events.mjs | node dist/src/cli.js receive-events --agent foreflow-ensemble
 */

const agentName = 'foreflow-ensemble';
const roundId = '999';
const marketId = '0xtest123abc';
const now = Math.floor(Date.now() / 1000);

function emit(event) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

// ── prediction_started ──────────────────────────────────────────────────────
emit({
  kind: 'prediction_started',
  timestamp: now,
  agentName,
  configuration: 'independent_ensemble',
  roundId,
  marketId,
  marketQuestion: 'Will BTC close above $50,000 on 2026-06-01?',
  marketCategory: 'crypto',
  marketBaseline: 0.62,
  modelId: 'claude-opus-4-6',
});

// Regular log line (should pass through, not treated as event)
process.stdout.write('INFO: starting LLM coordination flow\n');

// ── llm_call ────────────────────────────────────────────────────────────────
emit({
  kind: 'llm_call',
  timestamp: now + 1,
  predictionRef: { roundId, marketId },
  callIndex: 0,
  agentRole: 'researcher',
  systemPrompt: 'You are a quantitative forecaster specializing in crypto markets.',
  userPrompt: 'Analyze recent BTC price trends and on-chain data.',
  responseText: 'Based on recent data, BTC shows strong support at $48k...',
  inputTokens: 1200,
  outputTokens: 800,
  costUsd: 0.022,
  durationMs: 3200,
});

emit({
  kind: 'llm_call',
  timestamp: now + 5,
  predictionRef: { roundId, marketId },
  callIndex: 1,
  agentRole: 'integrator',
  systemPrompt: 'Synthesize the research outputs into a calibrated probability.',
  userPrompt: 'Given the analysis, what is P(BTC > 50k on 2026-06-01)?',
  responseText: 'Integrating signals: probability estimate = 0.68',
  toolCalls: [{ name: 'web_search', input: { query: 'BTC price forecast June 2026' } }],
  inputTokens: 950,
  outputTokens: 320,
  costUsd: 0.011,
  durationMs: 1800,
});

// ── prediction_complete ──────────────────────────────────────────────────────
emit({
  kind: 'prediction_complete',
  timestamp: now + 6,
  predictionRef: { roundId, marketId },
  probability: 0.68,
  totalInputTokens: 2150,
  totalOutputTokens: 1120,
  totalCostUsd: 0.033,
});

process.stderr.write('Mock event emission complete.\n');
