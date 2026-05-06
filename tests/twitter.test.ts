import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { TwitterApi } from 'twitter-api-v2';

const TMP = join(os.tmpdir(), `foreflow-twitter-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });
process.env.FOREFLOW_STATE_DIR = TMP;
// Provide dummy Twitter credentials so client construction doesn't throw
process.env.TWITTER_CLIENT_ID = 'test-client-id';
process.env.TWITTER_CLIENT_SECRET = 'test-client-secret';

const { openDb } = await import('../src/storage/sqlite.js');
const { saveTwitterTokens, getTwitterTokens, listTweets } =
  await import('../src/storage/twitter.js');
const { postFromAgent, _setClientGetterForTest } =
  await import('../src/twitter/post.js');
const { getTwitterClient, _setAuthClientFactory, MissingAuthError } =
  await import('../src/twitter/client.js');

// Helper: create a mock TwitterApi that records calls
function makeMockClient(tweetId = 'mock-tweet-id'): {
  client: TwitterApi;
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const client = {
    v2: {
      tweet: async (...args: unknown[]) => {
        calls.push({ method: 'tweet', args });
        return { data: { id: tweetId, text: (args[0] as { text: string }).text } };
      },
      me: async () => ({ data: { id: '123', name: 'Test', username: 'foreflow_ens' } }),
    },
  } as unknown as TwitterApi;
  return { client, calls };
}

// ---------------------------------------------------------------------------
// postFromAgent tests
// ---------------------------------------------------------------------------

test('postFromAgent with dryRun:true returns stub, no DB write, no API call', async () => {
  let apiCalled = false;
  _setClientGetterForTest(async () => {
    apiCalled = true;
    return {} as TwitterApi;
  });

  const db = openDb();
  const beforeCount = listTweets(db, { agentName: 'foreflow-ensemble' }).length;

  const result = await postFromAgent('foreflow-ensemble', 'Dry run test', 'manual', {
    dryRun: true,
  });

  assert.ok(result.tweetId.startsWith('DRY-RUN-'), 'tweetId should be a dry-run stub');
  assert.equal(result.tweetText, 'Dry run test');
  assert.equal(result.tweetKind, 'manual');
  assert.equal(apiCalled, false, 'Twitter API should not be called on dry run');

  const afterCount = listTweets(db, { agentName: 'foreflow-ensemble' }).length;
  assert.equal(afterCount, beforeCount, 'No DB write should occur on dry run');
});

test('postFromAgent with no tokens throws MissingAuthError', async () => {
  _setClientGetterForTest(async (name: string) => {
    // Simulate no tokens by calling through to real getTwitterClient with fresh DB
    const freshDb = openDb();
    return getTwitterClient(name, freshDb);
  });

  await assert.rejects(
    () => postFromAgent('foreflow-debate', 'Hello', 'manual'),
    (err: Error) => {
      assert.ok(err instanceof MissingAuthError, `Expected MissingAuthError, got ${err.constructor.name}`);
      assert.ok(err.message.includes('foreflow-debate'));
      return true;
    },
  );
});

test('postFromAgent with text > 280 chars throws RangeError', async () => {
  _setClientGetterForTest(async () => ({} as TwitterApi));

  const longText = 'x'.repeat(281);
  await assert.rejects(
    () => postFromAgent('foreflow-ensemble', longText, 'manual'),
    (err: Error) => {
      assert.ok(err instanceof RangeError);
      assert.ok(err.message.includes('281'));
      return true;
    },
  );
});

test('postFromAgent with valid mocked tokens succeeds and writes to DB', async () => {
  const { client: mockClient, calls } = makeMockClient('tweet-abc-456');
  _setClientGetterForTest(async () => mockClient);

  const db = openDb();
  // Pre-save some fake tokens so the token fetch path does not interfere
  saveTwitterTokens(db, 'foreflow-ensemble', {
    accessToken: 'test-at',
    refreshToken: 'test-rt',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    authorizedAt: Math.floor(Date.now() / 1000),
  });

  const text = 'Test from foreflow-ensemble';
  const record = await postFromAgent('foreflow-ensemble', text, 'manual');

  assert.equal(calls.length, 1, 'Twitter API should be called once');
  assert.equal(record.tweetId, 'tweet-abc-456');
  assert.equal(record.tweetText, text);
  assert.equal(record.tweetKind, 'manual');
  assert.ok(typeof record.id === 'number', 'Record should have a DB id');

  // Verify it's persisted
  const tweets = listTweets(db, { agentName: 'foreflow-ensemble' });
  assert.ok(tweets.some((t) => t.tweetId === 'tweet-abc-456'));
});

test('postFromAgent unknown agent name throws', async () => {
  await assert.rejects(
    () => postFromAgent('unknown-agent', 'hello', 'manual'),
    /Unknown agent/,
  );
});

// ---------------------------------------------------------------------------
// Token refresh tests
// ---------------------------------------------------------------------------

test('token refresh updates DB when token is expired', async () => {
  const db = openDb();
  const expiredTokens = {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: Math.floor(Date.now() / 1000) - 100, // expired 100s ago
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    authorizedAt: Math.floor(Date.now() / 1000) - 7200,
  };
  saveTwitterTokens(db, 'foreflow-pipeline', expiredTokens);

  _setAuthClientFactory(() => ({
    refreshOAuth2Token: async (_refreshToken: string) => ({
      client: {} as TwitterApi,
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 7200,
      scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    }),
  }) as unknown as TwitterApi);

  // getTwitterClient uses _authClientFactory for refresh
  await getTwitterClient('foreflow-pipeline', db);

  const refreshed = getTwitterTokens(db, 'foreflow-pipeline');
  assert.ok(refreshed !== null);
  assert.equal(refreshed.accessToken, 'new-access-token');
  assert.equal(refreshed.refreshToken, 'new-refresh-token');
  assert.ok(refreshed.expiresAt > Math.floor(Date.now() / 1000));
});

test('token refresh updates DB when token expires within 60 seconds', async () => {
  const db = openDb();
  const soonExpiring = {
    accessToken: 'soon-access',
    refreshToken: 'soon-refresh',
    expiresAt: Math.floor(Date.now() / 1000) + 30, // expires in 30s (inside 60s buffer)
    scopes: ['tweet.read'],
    authorizedAt: Math.floor(Date.now() / 1000) - 3600,
  };
  saveTwitterTokens(db, 'foreflow-consensus', soonExpiring);

  _setAuthClientFactory(() => ({
    refreshOAuth2Token: async (_refreshToken: string) => ({
      client: {} as TwitterApi,
      accessToken: 'refreshed-access',
      refreshToken: 'refreshed-refresh',
      expiresIn: 7200,
      scope: ['tweet.read'],
    }),
  }) as unknown as TwitterApi);

  await getTwitterClient('foreflow-consensus', db);

  const updated = getTwitterTokens(db, 'foreflow-consensus');
  assert.equal(updated?.accessToken, 'refreshed-access');
});

// ---------------------------------------------------------------------------
// listTweets filter tests
// ---------------------------------------------------------------------------

test('listTweets filters by agentName and kind combined', async () => {
  const db = openDb();
  const now = Math.floor(Date.now() / 1000);
  const { logTweet } = await import('../src/storage/twitter.js');

  logTweet(db, {
    agentName: 'foreflow-orchestrator',
    tweetId: `orc-voucher-${now}`,
    tweetText: 'Voucher',
    tweetKind: 'voucher',
    postedAt: now,
  });
  logTweet(db, {
    agentName: 'foreflow-orchestrator',
    tweetId: `orc-status-${now}`,
    tweetText: 'Status',
    tweetKind: 'daily_status',
    postedAt: now,
  });
  logTweet(db, {
    agentName: 'foreflow-pipeline',
    tweetId: `pip-voucher-${now}`,
    tweetText: 'Pipeline voucher',
    tweetKind: 'voucher',
    postedAt: now,
  });

  const result = listTweets(db, { agentName: 'foreflow-orchestrator', kind: 'voucher' });
  assert.equal(result.length, 1);
  assert.equal(result[0].tweetKind, 'voucher');
  assert.equal(result[0].agentName, 'foreflow-orchestrator');
});

// Cleanup
test.after?.(() => {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
  delete process.env.FOREFLOW_STATE_DIR;
  delete process.env.TWITTER_CLIENT_ID;
  delete process.env.TWITTER_CLIENT_SECRET;
});
