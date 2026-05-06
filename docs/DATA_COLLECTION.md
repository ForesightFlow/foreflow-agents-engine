# Data Collection

The engine captures every prediction, LLM trace, and tweet into a local SQLite database.
This document describes the schema, the JSONL event protocol agents use to report their
work, the queries most useful for analysis, and the privacy guarantees in place.

---

## Database

State lives in `$FOREFLOW_STATE_DIR/foreflow.db` (default `~/.foreflow-state/foreflow.db`).
The file is created on first run with mode `0600` (owner-readable only).

Schema migrations live in `migrations/` and run automatically on `openDb()`.

### `predictions` table

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment row ID |
| `agent_name` | TEXT | Full name e.g. `foreflow-ensemble` |
| `configuration` | TEXT | Configuration key e.g. `independent_ensemble` |
| `round_id` | TEXT | Arena round ID |
| `market_id` | TEXT | Arena market ID |
| `network` | TEXT | `amoy` or `mainnet` |
| `market_question` | TEXT | Human-readable question |
| `market_category` | TEXT | Optional category tag |
| `market_baseline` | REAL | Market's prior probability |
| `market_volume` | REAL | Market liquidity (if available) |
| `market_resolution_at` | INTEGER | Unix epoch when market resolves |
| `reveal_deadline` | INTEGER | Latest unix epoch the agent may reveal |
| `probability` | REAL | Agent's final probability estimate |
| `predicted_at` | INTEGER | Unix epoch when prediction was made |
| `model_id` | TEXT | LLM model used (e.g. `claude-opus-4-6`) |
| `status` | TEXT | `predicted → committed → revealed → scored` (or `failed`) |
| `commit_tx` | TEXT | On-chain commit transaction hash |
| `commit_at` | INTEGER | Unix epoch of commit |
| `commit_salt` | TEXT | Commit salt (stored for reveal) |
| `reveal_tx` | TEXT | On-chain reveal transaction hash |
| `reveal_at` | INTEGER | Unix epoch of reveal |
| `outcome` | INTEGER | `0` or `1` after resolution |
| `resolved_at` | INTEGER | Unix epoch of resolution |
| `brier_score` | REAL | `(probability − outcome)²` |
| `total_input_tokens` | INTEGER | Total tokens consumed across all LLM calls |
| `total_output_tokens` | INTEGER | Total tokens generated |
| `total_cost_usd` | REAL | Estimated cost in USD |
| `failure_reason` | TEXT | Set when `status = failed` |

Unique constraint: `(agent_name, round_id, market_id)`. Re-saving an existing row updates
mutable fields (probability, tokens, cost, status) via `ON CONFLICT DO UPDATE`.

### `traces` table

Stores every LLM call made during a prediction.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment row ID |
| `prediction_id` | INTEGER FK | References `predictions.id` |
| `call_index` | INTEGER | Zero-based call order within this prediction |
| `agent_role` | TEXT | Role label e.g. `researcher`, `integrator` |
| `system_prompt` | TEXT | Full system prompt |
| `user_prompt` | TEXT | Full user prompt |
| `response_text` | TEXT | Full model response |
| `tool_calls_json` | TEXT | JSON array of tool call descriptors (if any) |
| `input_tokens` | INTEGER | Tokens in |
| `output_tokens` | INTEGER | Tokens out |
| `cost_usd` | REAL | Estimated cost for this call |
| `duration_ms` | INTEGER | Wall-clock time for the LLM call |
| `created_at` | INTEGER | Unix epoch |

### `runtime_state` table

Key-value store for operational flags.

| Column | Type | Description |
|---|---|---|
| `key` | TEXT PK | Namespaced key |
| `value` | TEXT | Stored value |

Keys used by the engine:

| Key | Description |
|---|---|
| `last_resolution_post_at:{agentName}` | Unix epoch of the last resolution tweet |

### `twitter_tokens` and `tweets` tables

See [TWITTER.md](TWITTER.md) for the Twitter-specific schema.

---

## JSONL Event Protocol

When `run-agent` spawns an agent subprocess, stdout is captured line-by-line.
Lines that parse as a known `AgentEvent` JSON object are dispatched to `EventHandler`
and written to the database. All other lines are forwarded to the engine's stdout verbatim.

### Event kinds

#### `prediction_started`

Emitted when the agent begins work on a market.

```json
{
  "kind": "prediction_started",
  "timestamp": 1746000000,
  "agentName": "foreflow-ensemble",
  "configuration": "independent_ensemble",
  "roundId": "42",
  "marketId": "0xabc123",
  "marketQuestion": "Will BTC close above $100k on 2026-06-01?",
  "marketBaseline": 0.45,
  "modelId": "claude-opus-4-6"
}
```

Creates or updates a `predictions` row with `status = predicted`.

#### `llm_call`

Emitted after each LLM API call completes.

```json
{
  "kind": "llm_call",
  "timestamp": 1746000010,
  "predictionRef": { "roundId": "42", "marketId": "0xabc123" },
  "callIndex": 0,
  "agentRole": "researcher",
  "systemPrompt": "...",
  "userPrompt": "...",
  "responseText": "...",
  "toolCalls": [{ "name": "web_search", "input": { "query": "..." } }],
  "inputTokens": 1200,
  "outputTokens": 450,
  "costUsd": 0.018,
  "durationMs": 3200
}
```

Inserts a `traces` row. `toolCalls` is optional.

#### `prediction_complete`

Emitted when the agent has finished reasoning and produced a final probability.

```json
{
  "kind": "prediction_complete",
  "timestamp": 1746000080,
  "predictionRef": { "roundId": "42", "marketId": "0xabc123" },
  "probability": 0.72,
  "totalInputTokens": 3400,
  "totalOutputTokens": 1200,
  "totalCostUsd": 0.054
}
```

Updates the `predictions` row with `probability`, token totals, and `status = predicted`.

#### `prediction_failed`

Emitted when the agent encounters an unrecoverable error.

```json
{
  "kind": "prediction_failed",
  "timestamp": 1746000090,
  "predictionRef": { "roundId": "42", "marketId": "0xabc123" },
  "reason": "API timeout after 30s"
}
```

Updates `status = failed` and sets `failure_reason`.

### Emitting events from an agent

Agents write events to stdout as single-line JSON. Other output (logs, debug) goes to stderr.

```typescript
process.stdout.write(JSON.stringify({
  kind: 'prediction_started',
  timestamp: Math.floor(Date.now() / 1000),
  agentName: 'foreflow-ensemble',
  configuration: 'independent_ensemble',
  roundId,
  marketId,
  marketQuestion,
  marketBaseline,
  modelId: 'claude-opus-4-6',
}) + '\n');
```

### Testing the pipe locally

```bash
node tools/emit-mock-events.mjs | foreflow-engine receive-events --agent foreflow-ensemble
```

`emit-mock-events.mjs` outputs a realistic sequence of events plus interleaved plain log
lines to verify passthrough behavior.

---

## Exporting data

```bash
foreflow-engine dump-data ~/foreflow-dataset/
```

Writes four files to the target directory:

| File | Contents |
|---|---|
| `predictions.jsonl` | One JSON object per prediction (all columns except private keys) |
| `traces.jsonl` | One JSON object per LLM trace |
| `tweets.jsonl` | One JSON object per tweet record |
| `manifest.json` | Export timestamp, row counts, engine version |

`twitter_tokens` is **never** exported. The dump is safe to share or upload for research.

---

## Useful queries

```sql
-- All-time Brier score per agent (revealed rounds only)
SELECT agent_name,
       COUNT(DISTINCT round_id) AS rounds,
       AVG(brier_score)          AS avg_brier
FROM predictions
WHERE brier_score IS NOT NULL
GROUP BY agent_name
ORDER BY avg_brier;

-- Predictions still awaiting reveal
SELECT agent_name, round_id, market_id, status, predicted_at
FROM predictions
WHERE reveal_at IS NULL AND status NOT IN ('failed', 'scored')
ORDER BY predicted_at;

-- Token cost breakdown by agent and model
SELECT agent_name, model_id,
       SUM(total_input_tokens)  AS in_tokens,
       SUM(total_output_tokens) AS out_tokens,
       SUM(total_cost_usd)      AS cost_usd
FROM predictions
GROUP BY agent_name, model_id
ORDER BY cost_usd DESC;

-- Average LLM calls per prediction (by configuration)
SELECT p.configuration,
       COUNT(t.id) * 1.0 / COUNT(DISTINCT p.id) AS avg_calls
FROM predictions p
JOIN traces t ON t.prediction_id = p.id
GROUP BY p.configuration;
```

---

## Privacy guarantees

- **No private keys** — `FOREFLOW_<AGENT>_AGENT_KEY` and Twitter OAuth tokens are never
  written to the `predictions` or `traces` tables.
- **No wallet addresses in traces** — commit salts are stored in `predictions.commit_salt`
  for the reveal flow, but LLM prompt/response text is stored verbatim; ensure your agent
  does not include raw private keys in prompts.
- **DB permissions** — `foreflow.db` is created with mode `0600`; only the process owner
  can read it.
- **Dump safety** — `dump-data` skips the `twitter_tokens` table. The exported JSONL files
  contain only prediction metadata and LLM traces, which are safe to publish.
