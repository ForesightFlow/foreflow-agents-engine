import readline from 'node:readline';
import { postFromAgent } from '../twitter/post.js';
import { getTwitterTokens } from '../storage/twitter.js';
import { openDb } from '../storage/sqlite.js';
import { TWITTER_HANDLES } from '../twitter/agents.js';
import type { FullAgentName } from '../twitter/agents.js';

export interface VoucherTweetResult {
  tweetUrl: string;
  tweetId: string;
  postedVia: 'api' | 'manual';
}

export interface VoucherTweetOptions {
  dryRun?: boolean;
  noManualFallback?: boolean;
  noConfirmPause?: boolean;
}

export class NoTokensError extends Error {
  constructor(agentName: string) {
    super(`No Twitter tokens for "${agentName}". Run: engine twitter-auth ${agentName}`);
    this.name = 'NoTokensError';
  }
}

const TWEET_URL_RE = /^https?:\/\/(www\.)?(twitter|x)\.com\/\w+\/status\/(\d+)/i;
const MAX_URL_ATTEMPTS = 3;

function extractTweetId(url: string): string | null {
  const m = url.match(TWEET_URL_RE);
  return m?.[3] ?? null;
}

// Injectable for tests
export let _promptFn: (q: string) => Promise<string> = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (ans) => { rl.close(); resolve(ans); });
  });

export function _setPromptFnForTest(fn: (q: string) => Promise<string>): void {
  _promptFn = fn;
}

export let _sleepFn: (ms: number) => Promise<void> = (ms) =>
  new Promise((r) => setTimeout(r, ms));

export function _setSleepFnForTest(fn: (ms: number) => Promise<void>): void {
  _sleepFn = fn;
}

export async function postVoucherTweet(
  agentName: FullAgentName,
  suggestedText: string,
  opts?: VoucherTweetOptions,
): Promise<VoucherTweetResult> {
  const { dryRun = false, noManualFallback = false, noConfirmPause = false } = opts ?? {};
  const handle = TWITTER_HANDLES[agentName];

  if (!suggestedText || suggestedText.trim().length === 0) {
    throw new Error(
      `Voucher challenge text is empty or malformed. Check Arena API response.`,
    );
  }
  if (suggestedText.length > 280) {
    throw new RangeError(
      `Voucher challenge text is ${suggestedText.length} chars (max 280). Check Arena API response.`,
    );
  }

  const db = openDb();
  const tokens = getTwitterTokens(db, agentName);

  // ── Dry-run path ──────────────────────────────────────────────────────────
  if (dryRun) {
    if (tokens) {
      console.log(`[DRY-RUN] Would post tweet from @${handle} (via API; tokens present in DB)`);
    } else if (noManualFallback) {
      console.log(`[DRY-RUN] No tokens for ${agentName}; manual fallback disabled → would skip`);
      throw new NoTokensError(agentName);
    } else {
      console.log(`[DRY-RUN] Would post tweet from @${handle} (via manual prompt; no tokens in DB)`);
    }
    console.log(`[DRY-RUN]   Tweet text: "${suggestedText}"`);
    const stubId = `DRY-RUN-${Date.now()}`;
    return {
      tweetUrl: `https://twitter.com/${handle}/status/${stubId}`,
      tweetId: stubId,
      postedVia: tokens ? 'api' : 'manual',
    };
  }

  // ── API path (tokens present) ─────────────────────────────────────────────
  if (tokens) {
    if (!noConfirmPause) {
      console.log(`\nAbout to post voucher tweet from @${handle}:`);
      console.log('─'.repeat(45));
      console.log(suggestedText);
      console.log('─'.repeat(45));
      process.stdout.write('Posting in 3 seconds (Ctrl-C to abort)...');
      for (let i = 3; i > 0; i--) {
        await _sleepFn(1000);
        process.stdout.write(` ${i}...`);
      }
      process.stdout.write('\n');
    }

    const record = await postFromAgent(agentName, suggestedText, 'voucher');
    const tweetUrl = `https://twitter.com/${handle}/status/${record.tweetId}`;
    console.log(`✓ Posted: ${tweetUrl}`);
    return { tweetUrl, tweetId: record.tweetId, postedVia: 'api' };
  }

  // ── Manual fallback (no tokens) ───────────────────────────────────────────
  if (noManualFallback) {
    console.log(
      `\nNo Twitter tokens for ${agentName}. ` +
        `--no-manual-fallback is set — skipping.`,
    );
    console.log(`Run \`engine twitter-auth ${agentName}\` to enable autopost.`);
    throw new NoTokensError(agentName);
  }

  console.log(`\nNo Twitter tokens for ${agentName}. Falling back to manual flow.`);
  console.log(`Run \`engine twitter-auth ${agentName}\` later to enable autopost.\n`);
  console.log("Post the following tweet from the agent's Twitter account:");
  console.log('─'.repeat(60));
  console.log(suggestedText);
  console.log('─'.repeat(60));

  for (let attempt = 1; attempt <= MAX_URL_ATTEMPTS; attempt++) {
    const raw = await _promptFn(
      `\nAfter posting, paste the tweet URL (attempt ${attempt}/${MAX_URL_ATTEMPTS}):\n> `,
    );
    const url = raw.trim();
    const tweetId = extractTweetId(url);
    if (tweetId) return { tweetUrl: url, tweetId, postedVia: 'manual' };
    console.error(
      `  ✗ Invalid URL. Expected: https://twitter.com/<handle>/status/<id> or https://x.com/...`,
    );
  }

  throw new Error(
    `Failed to get a valid tweet URL for ${agentName} after ${MAX_URL_ATTEMPTS} attempts.`,
  );
}
