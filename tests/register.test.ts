import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { TwitterApi } from 'twitter-api-v2';

const TMP = join(os.tmpdir(), `foreflow-register-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });
process.env.FOREFLOW_STATE_DIR = TMP;
process.env.TWITTER_CLIENT_ID = 'test-id';
process.env.TWITTER_CLIENT_SECRET = 'test-secret';

const { openDb } = await import('../src/storage/sqlite.js');
const { saveTwitterTokens, listTweets } = await import('../src/storage/twitter.js');
const {
  postVoucherTweet,
  NoTokensError,
  _setPromptFnForTest,
  _setSleepFnForTest,
} = await import('../src/register/voucher_tweet.js');
const { _setClientGetterForTest } = await import('../src/twitter/post.js');

// Suppress the 3-second sleep in all tests
_setSleepFnForTest(async () => {});

// Mock Twitter API client that records calls
function makeMockClient(tweetId = 'mock-tweet-99') {
  const calls: string[] = [];
  const client = {
    v2: {
      tweet: async (opts: { text: string }) => {
        calls.push(opts.text);
        return { data: { id: tweetId, text: opts.text } };
      },
    },
  } as unknown as TwitterApi;
  return { client, calls };
}

// Pre-saved tokens for tests that need an authorized agent
function saveFakeTokens(agentName: string) {
  const db = openDb();
  saveTwitterTokens(db, agentName, {
    accessToken: 'test-at',
    refreshToken: 'test-rt',
    expiresAt: Math.floor(Date.now() / 1000) + 7200,
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    authorizedAt: Math.floor(Date.now() / 1000),
  });
}

// ---------------------------------------------------------------------------
// postVoucherTweet — API path
// ---------------------------------------------------------------------------

test('postVoucherTweet with tokens → API path, returns postedVia:api', async () => {
  saveFakeTokens('foreflow-ensemble');
  const { client, calls } = makeMockClient('tweet-voucher-api-1');
  _setClientGetterForTest(async () => client);

  const result = await postVoucherTweet(
    'foreflow-ensemble',
    'Challenge code: ABC123',
    { noConfirmPause: true },
  );

  assert.equal(result.postedVia, 'api');
  assert.equal(result.tweetId, 'tweet-voucher-api-1');
  assert.ok(result.tweetUrl.includes('tweet-voucher-api-1'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'Challenge code: ABC123');

  // Verify logged to DB
  const db = openDb();
  const tweets = listTweets(db, { agentName: 'foreflow-ensemble', kind: 'voucher' });
  assert.ok(tweets.some((t) => t.tweetId === 'tweet-voucher-api-1'));
});

// ---------------------------------------------------------------------------
// postVoucherTweet — no tokens, no manual fallback
// ---------------------------------------------------------------------------

test('postVoucherTweet without tokens + noManualFallback → throws NoTokensError', async () => {
  // foreflow-debate has no tokens in this fresh DB
  await assert.rejects(
    () => postVoucherTweet('foreflow-debate', 'Challenge: XYZ', { noManualFallback: true }),
    (err: Error) => {
      assert.ok(err instanceof NoTokensError, `Expected NoTokensError, got ${err.constructor.name}`);
      assert.ok(err.message.includes('foreflow-debate'));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// postVoucherTweet — no tokens, manual fallback
// ---------------------------------------------------------------------------

test('postVoucherTweet without tokens → manual fallback, returns postedVia:manual', async () => {
  let apiCalled = false;
  _setClientGetterForTest(async () => { apiCalled = true; return {} as TwitterApi; });

  _setPromptFnForTest(async () =>
    'https://twitter.com/foreflow_deb/status/1234567890123456789',
  );

  const result = await postVoucherTweet('foreflow-debate', 'Challenge code: MNP789');
  assert.equal(result.postedVia, 'manual');
  assert.equal(result.tweetId, '1234567890123456789');
  assert.ok(result.tweetUrl.includes('1234567890123456789'));
  assert.equal(apiCalled, false, 'API should not be called in manual path');
});

// ---------------------------------------------------------------------------
// postVoucherTweet — dry-run paths
// ---------------------------------------------------------------------------

test('postVoucherTweet dryRun with tokens → stub, no API call', async () => {
  saveFakeTokens('foreflow-ensemble');
  let apiCalled = false;
  _setClientGetterForTest(async () => { apiCalled = true; return {} as TwitterApi; });

  const result = await postVoucherTweet(
    'foreflow-ensemble',
    'Challenge code: DRY123',
    { dryRun: true },
  );

  assert.ok(result.tweetId.startsWith('DRY-RUN-'));
  assert.equal(result.postedVia, 'api');
  assert.equal(apiCalled, false);
});

test('postVoucherTweet dryRun without tokens + noManualFallback → throws NoTokensError', async () => {
  await assert.rejects(
    () =>
      postVoucherTweet('foreflow-orchestrator', 'Challenge', {
        dryRun: true,
        noManualFallback: true,
      }),
    (err: Error) => {
      assert.ok(err instanceof NoTokensError);
      return true;
    },
  );
});

test('postVoucherTweet dryRun without tokens, manual allowed → stub', async () => {
  const result = await postVoucherTweet('foreflow-orchestrator', 'Challenge text', {
    dryRun: true,
    noManualFallback: false,
  });
  assert.ok(result.tweetId.startsWith('DRY-RUN-'));
  assert.equal(result.postedVia, 'manual');
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test('postVoucherTweet with empty suggestedText throws', async () => {
  await assert.rejects(
    () => postVoucherTweet('foreflow-ensemble', ''),
    /empty or malformed/,
  );
});

test('postVoucherTweet with text > 280 chars throws RangeError', async () => {
  await assert.rejects(
    () => postVoucherTweet('foreflow-ensemble', 'x'.repeat(281)),
    (err: Error) => {
      assert.ok(err instanceof RangeError);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Manual URL validation retries
// ---------------------------------------------------------------------------

test('invalid URL re-prompts up to 3 times then throws', async () => {
  let attempt = 0;
  _setPromptFnForTest(async () => {
    attempt++;
    return 'not-a-valid-url'; // always invalid
  });

  await assert.rejects(
    () => postVoucherTweet('foreflow-pipeline', 'Challenge text'),
    /3 attempts/,
  );
  assert.equal(attempt, 3, 'Should prompt exactly 3 times');
});

test('second URL attempt valid → returns on second try', async () => {
  let attempt = 0;
  _setPromptFnForTest(async () => {
    attempt++;
    if (attempt === 1) return 'not-valid';
    return 'https://x.com/foreflow_pip/status/9876543210987654321';
  });

  const result = await postVoucherTweet('foreflow-pipeline', 'Challenge text');
  assert.equal(attempt, 2);
  assert.equal(result.tweetId, '9876543210987654321');
  assert.equal(result.postedVia, 'manual');
});

// ---------------------------------------------------------------------------
// registerAgent dry-run
// ---------------------------------------------------------------------------

test('registerAgent dryRun with tokens → status registered', async () => {
  saveFakeTokens('foreflow-ensemble');
  _setClientGetterForTest(async () => ({} as TwitterApi));

  const { registerAgent } = await import('../src/register/interactive.js');
  const result = await registerAgent('ensemble', {
    dryRun: true,
    noManualFallback: false,
    noConfirmPause: true,
  });

  assert.equal(result.status, 'registered');
  assert.equal(result.agentName, 'foreflow-ensemble');
});

test('registerAgent dryRun without tokens + noManualFallback → status pending', async () => {
  const { registerAgent } = await import('../src/register/interactive.js');
  const result = await registerAgent('debate', {
    dryRun: true,
    noManualFallback: true,
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.agentName, 'foreflow-debate');
});

// ---------------------------------------------------------------------------
// registerAll dry-run summary
// ---------------------------------------------------------------------------

test('registerAll dryRun → 1 registered + 4 pending in summary', async () => {
  // foreflow-ensemble has tokens (saved above); others do not
  const { registerAll } = await import('../src/register/interactive.js');

  // Capture stdout to verify summary is printed
  const lines: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  const origLog = console.log.bind(console);
  console.log = (...a: unknown[]) => {
    lines.push(String(a[0] ?? ''));
    origLog(...a);
  };

  try {
    await registerAll({ dryRun: true, noManualFallback: true });
  } finally {
    console.log = origLog;
  }

  const summary = lines.join('\n');
  assert.ok(summary.includes('✓ registered'), 'Should show at least one registered');
  assert.ok(summary.includes('- pending'), 'Should show pending agents');
  assert.ok(summary.includes('foreflow-ensemble'));
  assert.ok(summary.includes('foreflow-debate'));
});

// Cleanup
test.after?.(() => {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
  delete process.env.FOREFLOW_STATE_DIR;
  delete process.env.TWITTER_CLIENT_ID;
  delete process.env.TWITTER_CLIENT_SECRET;
});
