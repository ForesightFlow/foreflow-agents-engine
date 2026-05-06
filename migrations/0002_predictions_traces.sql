-- Migration 0002: predictions, traces, and engine runtime state.

-- Each prediction is one row.  Created on predict; updated as on-chain operations proceed.
CREATE TABLE IF NOT EXISTS predictions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Linkage
  agent_name      TEXT NOT NULL,
  configuration   TEXT NOT NULL,
  round_id        TEXT NOT NULL,
  market_id       TEXT NOT NULL,
  network         TEXT NOT NULL,           -- 'amoy' | 'mainnet'

  -- Market metadata at observation time
  market_question      TEXT NOT NULL,
  market_category      TEXT,
  market_baseline      REAL,               -- mid-price at observation
  market_volume        REAL,
  market_resolution_at INTEGER,            -- Unix epoch when expected to resolve
  reveal_deadline      INTEGER,            -- round-level reveal deadline from Arena

  -- Prediction
  probability     REAL NOT NULL,
  predicted_at    INTEGER NOT NULL,
  model_id        TEXT NOT NULL,

  -- On-chain commit
  commit_tx       TEXT,
  commit_at       INTEGER,
  commit_salt     TEXT,

  -- On-chain reveal
  reveal_tx       TEXT,
  reveal_at       INTEGER,

  -- Resolution
  outcome         INTEGER,                 -- 0 | 1, NULL until resolved
  resolved_at     INTEGER,
  brier_score     REAL,                    -- (probability - outcome)^2

  -- Cost
  total_input_tokens  INTEGER,
  total_output_tokens INTEGER,
  total_cost_usd      REAL,

  -- Status
  status          TEXT NOT NULL DEFAULT 'predicted',
  failure_reason  TEXT,

  UNIQUE(agent_name, round_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_predictions_agent    ON predictions(agent_name);
CREATE INDEX IF NOT EXISTS idx_predictions_round    ON predictions(round_id);
CREATE INDEX IF NOT EXISTS idx_predictions_status   ON predictions(status);
CREATE INDEX IF NOT EXISTS idx_predictions_resolved ON predictions(resolved_at);

-- Each LLM call within a coordination flow is one row.
CREATE TABLE IF NOT EXISTS traces (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id   INTEGER NOT NULL REFERENCES predictions(id),
  call_index      INTEGER NOT NULL,
  agent_role      TEXT NOT NULL,
  system_prompt   TEXT NOT NULL,
  user_prompt     TEXT NOT NULL,
  response_text   TEXT NOT NULL,
  tool_calls_json TEXT,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cost_usd        REAL NOT NULL,
  duration_ms     INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE(prediction_id, call_index)
);

CREATE INDEX IF NOT EXISTS idx_traces_prediction ON traces(prediction_id);

-- Key-value store for engine runtime state (e.g. last status post timestamps).
CREATE TABLE IF NOT EXISTS runtime_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
