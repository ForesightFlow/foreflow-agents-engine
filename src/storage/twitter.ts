import type Database from 'better-sqlite3';

export interface TwitterTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix epoch seconds
  scopes: string[];
  authorizedAt: number;
}

export type TweetKind = 'voucher' | 'daily_status' | 'resolution_status' | 'manual';

export interface TweetRecord {
  id?: number;
  agentName: string;
  tweetId: string;
  tweetText: string;
  tweetKind: TweetKind;
  postedAt: number;
  relatedRoundId?: string;
  relatedPredictionId?: number;
}

interface TokenRow {
  agent_name: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: string;
  authorized_at: number;
}

interface TweetRow {
  id: number;
  agent_name: string;
  tweet_id: string;
  tweet_text: string;
  tweet_kind: string;
  posted_at: number;
  related_round_id: string | null;
  related_prediction_id: number | null;
}

export function saveTwitterTokens(
  db: Database.Database,
  agentName: string,
  tokens: TwitterTokens,
): void {
  db.prepare(`
    INSERT INTO twitter_tokens (agent_name, access_token, refresh_token, expires_at, scopes, authorized_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_name) DO UPDATE SET
      access_token  = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at    = excluded.expires_at,
      scopes        = excluded.scopes,
      authorized_at = excluded.authorized_at
  `).run(
    agentName,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.expiresAt,
    JSON.stringify(tokens.scopes),
    tokens.authorizedAt,
  );
}

export function getTwitterTokens(
  db: Database.Database,
  agentName: string,
): TwitterTokens | null {
  const row = db
    .prepare('SELECT * FROM twitter_tokens WHERE agent_name = ?')
    .get(agentName) as TokenRow | undefined;
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    scopes: JSON.parse(row.scopes) as string[],
    authorizedAt: row.authorized_at,
  };
}

export function logTweet(db: Database.Database, record: TweetRecord): TweetRecord {
  const stmt = db.prepare(`
    INSERT INTO tweets (agent_name, tweet_id, tweet_text, tweet_kind, posted_at, related_round_id, related_prediction_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    record.agentName,
    record.tweetId,
    record.tweetText,
    record.tweetKind,
    record.postedAt,
    record.relatedRoundId ?? null,
    record.relatedPredictionId ?? null,
  );
  return { ...record, id: Number(result.lastInsertRowid) };
}

export function listTweets(
  db: Database.Database,
  opts?: { agentName?: string; kind?: TweetKind },
): TweetRecord[] {
  let query = 'SELECT * FROM tweets';
  const params: string[] = [];
  const conditions: string[] = [];

  if (opts?.agentName) {
    conditions.push('agent_name = ?');
    params.push(opts.agentName);
  }
  if (opts?.kind) {
    conditions.push('tweet_kind = ?');
    params.push(opts.kind);
  }
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY posted_at DESC';

  const rows = db.prepare(query).all(...params) as TweetRow[];
  return rows.map((r) => ({
    id: r.id,
    agentName: r.agent_name,
    tweetId: r.tweet_id,
    tweetText: r.tweet_text,
    tweetKind: r.tweet_kind as TweetKind,
    postedAt: r.posted_at,
    relatedRoundId: r.related_round_id ?? undefined,
    relatedPredictionId: r.related_prediction_id ?? undefined,
  }));
}
