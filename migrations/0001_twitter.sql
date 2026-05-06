-- Migration 0001: Twitter integration tables.
-- Additional tables (predictions, traces) are added in subsequent
-- migrations as part of task #3 (data collection).

CREATE TABLE IF NOT EXISTS twitter_tokens (
  agent_name      TEXT PRIMARY KEY,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  expires_at      INTEGER NOT NULL,
  scopes          TEXT NOT NULL,
  authorized_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tweets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name      TEXT NOT NULL,
  tweet_id        TEXT NOT NULL UNIQUE,
  tweet_text      TEXT NOT NULL,
  tweet_kind      TEXT NOT NULL,
  posted_at       INTEGER NOT NULL,
  related_round_id        TEXT,
  related_prediction_id   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tweets_agent ON tweets(agent_name);
CREATE INDEX IF NOT EXISTS idx_tweets_kind  ON tweets(tweet_kind);
