import type Database from 'better-sqlite3';

export interface PredictionRecord {
  id?: number;
  agentName: string;
  configuration: string;
  roundId: string;
  marketId: string;
  network: 'amoy' | 'mainnet';
  marketQuestion: string;
  marketCategory?: string;
  marketBaseline?: number;
  marketVolume?: number;
  marketResolutionAt?: number;
  revealDeadline?: number;
  probability: number;
  predictedAt: number;
  modelId: string;
  commitTx?: string;
  commitAt?: number;
  commitSalt?: string;
  revealTx?: string;
  revealAt?: number;
  outcome?: number;
  resolvedAt?: number;
  brierScore?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCostUsd?: number;
  status: 'predicted' | 'committed' | 'revealed' | 'scored' | 'failed';
  failureReason?: string;
}

export interface TraceRecord {
  id?: number;
  predictionId: number;
  callIndex: number;
  agentRole: string;
  systemPrompt: string;
  userPrompt: string;
  responseText: string;
  toolCallsJson?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs?: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Row ↔ record conversion
// ---------------------------------------------------------------------------

interface PredRow {
  id: number;
  agent_name: string;
  configuration: string;
  round_id: string;
  market_id: string;
  network: string;
  market_question: string;
  market_category: string | null;
  market_baseline: number | null;
  market_volume: number | null;
  market_resolution_at: number | null;
  reveal_deadline: number | null;
  probability: number;
  predicted_at: number;
  model_id: string;
  commit_tx: string | null;
  commit_at: number | null;
  commit_salt: string | null;
  reveal_tx: string | null;
  reveal_at: number | null;
  outcome: number | null;
  resolved_at: number | null;
  brier_score: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cost_usd: number | null;
  status: string;
  failure_reason: string | null;
}

interface TraceRow {
  id: number;
  prediction_id: number;
  call_index: number;
  agent_role: string;
  system_prompt: string;
  user_prompt: string;
  response_text: string;
  tool_calls_json: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number | null;
  created_at: number;
}

function rowToPrediction(r: PredRow): PredictionRecord {
  return {
    id: r.id,
    agentName: r.agent_name,
    configuration: r.configuration,
    roundId: r.round_id,
    marketId: r.market_id,
    network: r.network as 'amoy' | 'mainnet',
    marketQuestion: r.market_question,
    marketCategory: r.market_category ?? undefined,
    marketBaseline: r.market_baseline ?? undefined,
    marketVolume: r.market_volume ?? undefined,
    marketResolutionAt: r.market_resolution_at ?? undefined,
    revealDeadline: r.reveal_deadline ?? undefined,
    probability: r.probability,
    predictedAt: r.predicted_at,
    modelId: r.model_id,
    commitTx: r.commit_tx ?? undefined,
    commitAt: r.commit_at ?? undefined,
    commitSalt: r.commit_salt ?? undefined,
    revealTx: r.reveal_tx ?? undefined,
    revealAt: r.reveal_at ?? undefined,
    outcome: r.outcome ?? undefined,
    resolvedAt: r.resolved_at ?? undefined,
    brierScore: r.brier_score ?? undefined,
    totalInputTokens: r.total_input_tokens ?? undefined,
    totalOutputTokens: r.total_output_tokens ?? undefined,
    totalCostUsd: r.total_cost_usd ?? undefined,
    status: r.status as PredictionRecord['status'],
    failureReason: r.failure_reason ?? undefined,
  };
}

function rowToTrace(r: TraceRow): TraceRecord {
  return {
    id: r.id,
    predictionId: r.prediction_id,
    callIndex: r.call_index,
    agentRole: r.agent_role,
    systemPrompt: r.system_prompt,
    userPrompt: r.user_prompt,
    responseText: r.response_text,
    toolCallsJson: r.tool_calls_json ?? undefined,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    durationMs: r.duration_ms ?? undefined,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export function savePrediction(
  db: Database.Database,
  p: PredictionRecord,
): PredictionRecord {
  const stmt = db.prepare(`
    INSERT INTO predictions (
      agent_name, configuration, round_id, market_id, network,
      market_question, market_category, market_baseline, market_volume,
      market_resolution_at, reveal_deadline,
      probability, predicted_at, model_id,
      commit_tx, commit_at, commit_salt,
      reveal_tx, reveal_at,
      outcome, resolved_at, brier_score,
      total_input_tokens, total_output_tokens, total_cost_usd,
      status, failure_reason
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
    ON CONFLICT(agent_name, round_id, market_id) DO UPDATE SET
      configuration        = excluded.configuration,
      probability          = excluded.probability,
      predicted_at         = excluded.predicted_at,
      model_id             = excluded.model_id,
      status               = excluded.status,
      failure_reason       = excluded.failure_reason,
      total_input_tokens   = COALESCE(excluded.total_input_tokens, total_input_tokens),
      total_output_tokens  = COALESCE(excluded.total_output_tokens, total_output_tokens),
      total_cost_usd       = COALESCE(excluded.total_cost_usd, total_cost_usd)
  `);

  const result = stmt.run(
    p.agentName, p.configuration, p.roundId, p.marketId, p.network,
    p.marketQuestion, p.marketCategory ?? null, p.marketBaseline ?? null, p.marketVolume ?? null,
    p.marketResolutionAt ?? null, p.revealDeadline ?? null,
    p.probability, p.predictedAt, p.modelId,
    p.commitTx ?? null, p.commitAt ?? null, p.commitSalt ?? null,
    p.revealTx ?? null, p.revealAt ?? null,
    p.outcome ?? null, p.resolvedAt ?? null, p.brierScore ?? null,
    p.totalInputTokens ?? null, p.totalOutputTokens ?? null, p.totalCostUsd ?? null,
    p.status, p.failureReason ?? null,
  );

  const id = Number(result.lastInsertRowid) || p.id;
  return { ...p, id };
}

export function updatePredictionCommit(
  db: Database.Database,
  id: number,
  commitTx: string,
  commitAt: number,
  salt: string,
): void {
  db.prepare(`
    UPDATE predictions
    SET commit_tx = ?, commit_at = ?, commit_salt = ?, status = 'committed'
    WHERE id = ?
  `).run(commitTx, commitAt, salt, id);
}

export function updatePredictionReveal(
  db: Database.Database,
  id: number,
  revealTx: string,
  revealAt: number,
): void {
  db.prepare(`
    UPDATE predictions
    SET reveal_tx = ?, reveal_at = ?, status = 'revealed'
    WHERE id = ?
  `).run(revealTx, revealAt, id);
}

export function updatePredictionResolution(
  db: Database.Database,
  id: number,
  outcome: number,
  resolvedAt: number,
  brierScore: number,
): void {
  db.prepare(`
    UPDATE predictions
    SET outcome = ?, resolved_at = ?, brier_score = ?, status = 'scored'
    WHERE id = ?
  `).run(outcome, resolvedAt, brierScore, id);
}

export function updatePredictionComplete(
  db: Database.Database,
  id: number,
  fields: { probability: number; totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number },
): void {
  db.prepare(`
    UPDATE predictions
    SET probability = ?, total_input_tokens = ?, total_output_tokens = ?, total_cost_usd = ?
    WHERE id = ?
  `).run(fields.probability, fields.totalInputTokens, fields.totalOutputTokens, fields.totalCostUsd, id);
}

export function updatePredictionFailed(
  db: Database.Database,
  id: number,
  reason: string,
): void {
  db.prepare(`
    UPDATE predictions SET status = 'failed', failure_reason = ? WHERE id = ?
  `).run(reason, id);
}

export function listPredictionsForAgent(
  db: Database.Database,
  agentName: string,
  opts?: { status?: string; sinceUnix?: number },
): PredictionRecord[] {
  const conditions = ['agent_name = ?'];
  const params: (string | number)[] = [agentName];

  if (opts?.status) {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  if (opts?.sinceUnix !== undefined) {
    conditions.push('predicted_at >= ?');
    params.push(opts.sinceUnix);
  }

  const rows = db
    .prepare(`SELECT * FROM predictions WHERE ${conditions.join(' AND ')} ORDER BY predicted_at DESC`)
    .all(...params) as PredRow[];

  return rows.map(rowToPrediction);
}

export function getRevealedRoundsForAgent(
  db: Database.Database,
  agentName: string,
  nowUnix?: number,
): { roundId: string; predictions: PredictionRecord[] }[] {
  const now = nowUnix ?? Math.floor(Date.now() / 1000);

  // A round qualifies if:
  // 1. ALL predictions in that round have reveal_at IS NOT NULL (status in 'revealed'|'scored')
  // 2. The round's reveal_deadline, if present, is in the past
  const roundIds = (
    db
      .prepare(`
        SELECT round_id
        FROM predictions
        WHERE agent_name = ?
          AND (reveal_deadline IS NULL OR reveal_deadline < ?)
        GROUP BY round_id
        HAVING COUNT(*) = COUNT(reveal_at)
        ORDER BY MIN(predicted_at) DESC
      `)
      .all(agentName, now) as Array<{ round_id: string }>
  ).map((r) => r.round_id);

  return roundIds.map((roundId) => {
    const predictions = (
      db
        .prepare('SELECT * FROM predictions WHERE agent_name = ? AND round_id = ?')
        .all(agentName, roundId) as PredRow[]
    ).map(rowToPrediction);
    return { roundId, predictions };
  });
}

export function getResolvedAndRevealedRoundsForAgent(
  db: Database.Database,
  agentName: string,
  sinceTimestamp: number,
  nowUnix?: number,
): { roundId: string; predictions: PredictionRecord[] }[] {
  const now = nowUnix ?? Math.floor(Date.now() / 1000);

  // A round qualifies if ALL three conditions hold:
  // 1. ALL predictions in the round have reveal_at IS NOT NULL (fully revealed on-chain)
  // 2. The round's reveal_deadline, if present, is in the past
  // 3. At least one prediction has outcome IS NOT NULL AND resolved_at > sinceTimestamp
  //
  // TODO(claude-code): reveal_deadline is never populated by the current event pipeline.
  // The prediction_started AgentEvent type has no revealDeadline field, so EventHandler
  // never sets it. Every row has reveal_deadline = NULL, meaning condition 2 always passes
  // (NULL ⇒ no restriction). To enable the deadline guard, add revealDeadline to the
  // prediction_started event type and emit it from agent subprocesses.
  const roundIds = (
    db
      .prepare(`
        SELECT round_id
        FROM predictions
        WHERE agent_name = ?
          AND (reveal_deadline IS NULL OR reveal_deadline < ?)
        GROUP BY round_id
        HAVING COUNT(*) = COUNT(reveal_at)
          AND SUM(CASE WHEN outcome IS NOT NULL AND resolved_at > ? THEN 1 ELSE 0 END) > 0
        ORDER BY MIN(resolved_at) ASC
      `)
      .all(agentName, now, sinceTimestamp) as Array<{ round_id: string }>
  ).map((r) => r.round_id);

  return roundIds.map((roundId) => {
    const predictions = (
      db
        .prepare('SELECT * FROM predictions WHERE agent_name = ? AND round_id = ?')
        .all(agentName, roundId) as PredRow[]
    ).map(rowToPrediction);
    return { roundId, predictions };
  });
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

export function saveTrace(db: Database.Database, t: TraceRecord): TraceRecord {
  const stmt = db.prepare(`
    INSERT INTO traces (
      prediction_id, call_index, agent_role,
      system_prompt, user_prompt, response_text,
      tool_calls_json, input_tokens, output_tokens,
      cost_usd, duration_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(prediction_id, call_index) DO UPDATE SET
      response_text   = excluded.response_text,
      tool_calls_json = excluded.tool_calls_json,
      input_tokens    = excluded.input_tokens,
      output_tokens   = excluded.output_tokens,
      cost_usd        = excluded.cost_usd,
      duration_ms     = excluded.duration_ms
  `);

  const result = stmt.run(
    t.predictionId, t.callIndex, t.agentRole,
    t.systemPrompt, t.userPrompt, t.responseText,
    t.toolCallsJson ?? null, t.inputTokens, t.outputTokens,
    t.costUsd, t.durationMs ?? null, t.createdAt,
  );

  return { ...t, id: Number(result.lastInsertRowid) || t.id };
}

export function listTracesForPrediction(
  db: Database.Database,
  predictionId: number,
): TraceRecord[] {
  const rows = db
    .prepare('SELECT * FROM traces WHERE prediction_id = ? ORDER BY call_index ASC')
    .all(predictionId) as TraceRow[];
  return rows.map(rowToTrace);
}

// ---------------------------------------------------------------------------
// Runtime state (key-value)
// ---------------------------------------------------------------------------

export function getRuntimeState(db: Database.Database, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM runtime_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setRuntimeState(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO runtime_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
