import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const TMP = join(os.tmpdir(), `foreflow-storage-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });
process.env.FOREFLOW_STATE_DIR = TMP;

const { openDb, runMigrations } = await import('../src/storage/sqlite.js');
const { saveTwitterTokens, getTwitterTokens, logTweet, listTweets } =
  await import('../src/storage/twitter.js');

test('saveTwitterTokens / getTwitterTokens round-trip', () => {
  const db = openDb();
  const tokens = {
    accessToken: 'at-abc',
    refreshToken: 'rt-xyz',
    expiresAt: 9999999999,
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    authorizedAt: 1700000000,
  };
  saveTwitterTokens(db, 'foreflow-ensemble', tokens);
  const loaded = getTwitterTokens(db, 'foreflow-ensemble');
  assert.ok(loaded !== null, 'Tokens should be loadable after save');
  assert.equal(loaded.accessToken, tokens.accessToken);
  assert.equal(loaded.refreshToken, tokens.refreshToken);
  assert.equal(loaded.expiresAt, tokens.expiresAt);
  assert.deepEqual(loaded.scopes, tokens.scopes);
  assert.equal(loaded.authorizedAt, tokens.authorizedAt);
});

test('getTwitterTokens returns null for unknown agent', () => {
  const db = openDb();
  const result = getTwitterTokens(db, 'foreflow-unknown');
  assert.equal(result, null);
});

test('saveTwitterTokens upserts correctly', () => {
  const db = openDb();
  const initial = {
    accessToken: 'at-v1',
    refreshToken: 'rt-v1',
    expiresAt: 1000,
    scopes: ['tweet.read'],
    authorizedAt: 1000,
  };
  saveTwitterTokens(db, 'foreflow-debate', initial);
  const updated = {
    accessToken: 'at-v2',
    refreshToken: 'rt-v2',
    expiresAt: 2000,
    scopes: ['tweet.read', 'tweet.write'],
    authorizedAt: 1000,
  };
  saveTwitterTokens(db, 'foreflow-debate', updated);
  const loaded = getTwitterTokens(db, 'foreflow-debate');
  assert.equal(loaded?.accessToken, 'at-v2');
  assert.equal(loaded?.expiresAt, 2000);
});

test('logTweet / listTweets round-trip', () => {
  const db = openDb();
  const record = {
    agentName: 'foreflow-ensemble',
    tweetId: 'tweet-111',
    tweetText: 'Hello world',
    tweetKind: 'manual' as const,
    postedAt: Math.floor(Date.now() / 1000),
  };
  const saved = logTweet(db, record);
  assert.ok(typeof saved.id === 'number', 'id should be a number');

  const all = listTweets(db);
  assert.ok(all.some((t) => t.tweetId === 'tweet-111'));
});

test('listTweets filters by agentName', () => {
  const db = openDb();
  logTweet(db, {
    agentName: 'foreflow-pipeline',
    tweetId: 'tweet-pip-1',
    tweetText: 'Pipeline tweet',
    tweetKind: 'daily_status',
    postedAt: Math.floor(Date.now() / 1000),
  });
  logTweet(db, {
    agentName: 'foreflow-consensus',
    tweetId: 'tweet-con-1',
    tweetText: 'Consensus tweet',
    tweetKind: 'daily_status',
    postedAt: Math.floor(Date.now() / 1000),
  });
  const pipelineTweets = listTweets(db, { agentName: 'foreflow-pipeline' });
  assert.ok(pipelineTweets.every((t) => t.agentName === 'foreflow-pipeline'));
  assert.ok(pipelineTweets.some((t) => t.tweetId === 'tweet-pip-1'));
  assert.ok(!pipelineTweets.some((t) => t.tweetId === 'tweet-con-1'));
});

test('listTweets filters by kind', () => {
  const db = openDb();
  logTweet(db, {
    agentName: 'foreflow-orchestrator',
    tweetId: 'tweet-voucher-1',
    tweetText: 'Voucher tweet',
    tweetKind: 'voucher',
    postedAt: Math.floor(Date.now() / 1000),
  });
  const vouchers = listTweets(db, { kind: 'voucher' });
  assert.ok(vouchers.every((t) => t.tweetKind === 'voucher'));
});

test('migrations are idempotent — running twice does not error', () => {
  const db = openDb();
  // Should not throw
  assert.doesNotThrow(() => runMigrations(db));
  assert.doesNotThrow(() => runMigrations(db));
});

// Cleanup
test.after?.(() => {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
  delete process.env.FOREFLOW_STATE_DIR;
});
