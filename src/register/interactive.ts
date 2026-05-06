import readline from 'node:readline';
import { requestChallenge, verifyTweet, register } from 'foresight-arena';
import { generateWallet } from './wallet.js';
import { postVoucherTweet, NoTokensError } from './voucher_tweet.js';
import { saveRegistration } from '../lib/state.js';
import { DRY_RUN, AGENT_NAMES, CHAIN_ID } from '../lib/env.js';
import { openDb } from '../storage/sqlite.js';
import { getTwitterTokens } from '../storage/twitter.js';
import { TWITTER_HANDLES } from '../twitter/agents.js';
import type { AgentName } from '../lib/env.js';
import type { FullAgentName } from '../twitter/agents.js';

// Shared readline interface — one per process, avoids buffered-stdin loss
// between sequential prompts when stdin is piped.
let _sharedRl: readline.Interface | null = null;
function getSharedRl(): readline.Interface {
  if (!_sharedRl) {
    _sharedRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    _sharedRl.once('close', () => { _sharedRl = null; });
  }
  return _sharedRl;
}

// Injectable prompt function — replaced in tests
export let _promptFn: (q: string) => Promise<string> = (q) =>
  new Promise((resolve) => {
    getSharedRl().question(q, resolve);
  });

export function _setPromptFnForTest(fn: (q: string) => Promise<string>): void {
  _promptFn = fn;
}

export function _closeSharedRl(): void {
  _sharedRl?.close();
  _sharedRl = null;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RegisterOptions {
  dryRun?: boolean;
  noManualFallback?: boolean;
  noConfirmPause?: boolean;
}

export type RegistrationStatus = 'registered' | 'failed' | 'skipped' | 'pending' | 'aborted';

export interface AgentRegistrationResult {
  agentName: string;
  status: RegistrationStatus;
  stage?: string;
  error?: string;
  agentId?: string;
  postedVia?: 'api' | 'manual';
}

// ---------------------------------------------------------------------------
// Internal types / constants
// ---------------------------------------------------------------------------

interface ChallengeResult {
  tweetText: string;
  challenge: string;
}

interface RegisterResult {
  agentId: string;
  txHash?: string;
}

const AGENT_URI_BASE =
  'https://github.com/ForesightFlow/foreflow-agents/tree/master/agents';

function shortToFull(name: AgentName): FullAgentName {
  return `foreflow-${name}` as FullAgentName;
}

function networkName(): string {
  return CHAIN_ID === 137 ? 'Polygon mainnet' : 'Polygon Amoy testnet';
}

function arenaAddress(): string {
  return process.env.ARENA_ADDRESS ?? '0x219937292A48266681ECf08d4c2D1B45b4517Fd2';
}

async function fetchChallenge(address: string): Promise<ChallengeResult> {
  const raw = (await requestChallenge(address)) as Record<string, string>;
  return {
    tweetText:
      raw.tweetText ?? raw.tweet_text ?? raw.suggestedTweetText ?? raw.message ?? '(no tweet text returned)',
    challenge: raw.challenge ?? raw.challengeCode ?? '',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function registerAgent(
  name: AgentName,
  opts: RegisterOptions = {},
): Promise<AgentRegistrationResult> {
  const dryRun = opts.dryRun ?? DRY_RUN;
  return doRegister(name, { ...opts, dryRun });
}

export async function registerAll(opts: RegisterOptions = {}): Promise<void> {
  const dryRun = opts.dryRun ?? DRY_RUN;

  console.log('ForeFlow agent registration');
  console.log(`Registering ${AGENT_NAMES.length} agents.`);
  if (dryRun) console.log('[DRY-RUN] No actual operations will be performed.\n');

  // In register-all, dry-run implies no manual fallback so summary is meaningful
  const effectiveOpts: RegisterOptions = {
    ...opts,
    dryRun,
    noManualFallback: opts.noManualFallback ?? dryRun,
  };

  const results: AgentRegistrationResult[] = [];
  for (const name of AGENT_NAMES) {
    try {
      results.push(await registerAgent(name, effectiveOpts));
    } catch (err) {
      results.push({
        agentName: shortToFull(name),
        status: 'failed',
        error: String(err),
      });
    }
  }

  printSummaryTable(results);

  const ok = results.filter((r) => r.status === 'registered').length;
  const label = dryRun ? 'would succeed' : 'registered';
  console.log(`\n  ${ok} of ${results.length} ${label}.`);
  if (ok < results.length) {
    console.log(
      `  Re-run \`engine register-all\` after addressing skipped/failed agents.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Core registration flow
// ---------------------------------------------------------------------------

async function doRegister(
  name: AgentName,
  opts: RegisterOptions & { dryRun: boolean },
): Promise<AgentRegistrationResult> {
  const { dryRun, noManualFallback = false, noConfirmPause = false } = opts;
  const fullName = shortToFull(name);
  const net = networkName();
  const arena = arenaAddress();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Registering ${fullName}`);
  console.log('─'.repeat(60));

  // ── Verbose dry-run ───────────────────────────────────────────────────────
  if (dryRun) {
    const mockAddr = `0xMOCK_ADDRESS_${name.toUpperCase()}`;
    const mockCode = 'MOCK-CHALLENGE-CODE';
    const mockText = `Registering as Foresight Arena agent. Code: ${mockCode}`;
    const handle = TWITTER_HANDLES[fullName];

    console.log(`[DRY-RUN] Registering ${fullName} on ${net}...`);
    console.log('[DRY-RUN] Generated wallet:');
    console.log(`            address: ${mockAddr}`);
    console.log(`            (private key not shown in dry-run)`);
    console.log('[DRY-RUN] Would prompt: "Save key to .env, press Enter..."');
    console.log('[DRY-RUN] Would request voucher challenge from Foresight Arena');
    console.log(`[DRY-RUN]   Mock response: { code: '${mockCode}',`);
    console.log(`                              suggestedTweetText: '${mockText}' }`);

    const db = openDb();
    const tokens = getTwitterTokens(db, fullName);

    let tweetResult: AgentRegistrationResult;
    try {
      await postVoucherTweet(fullName, mockText, {
        dryRun: true,
        noManualFallback,
        noConfirmPause,
      });
      console.log('[DRY-RUN] Would verify tweet with Arena');
      console.log(`[DRY-RUN]   Mock response: { voucher: 'MOCK_VOUCHER' }`);
      console.log(
        `[DRY-RUN] Would mint Agent NFT on chain (Arena: ${arena})`,
      );
      console.log(`[DRY-RUN]   Estimated gas: ~0.005 POL (paid by relayer)`);
      console.log(
        `[DRY-RUN] Would save to ~/.foreflow-state/${name}/registered.json`,
      );
      console.log('[DRY-RUN] Done. No actual operations performed.');
      tweetResult = {
        agentName: fullName,
        status: 'registered',
        postedVia: tokens ? 'api' : 'manual',
      };
    } catch (err) {
      if (err instanceof NoTokensError) {
        tweetResult = {
          agentName: fullName,
          status: 'pending',
          error: `no Twitter tokens — run: engine twitter-auth ${fullName}`,
        };
      } else {
        tweetResult = { agentName: fullName, status: 'failed', error: String(err) };
      }
    }
    return tweetResult;
  }

  // ── Live flow ─────────────────────────────────────────────────────────────
  try {
    return await doRegisterLive(name, fullName, { noManualFallback, noConfirmPause, net, arena });
  } finally {
    _closeSharedRl();
  }
}

async function doRegisterLive(
  name: AgentName,
  fullName: FullAgentName,
  opts: { noManualFallback: boolean; noConfirmPause: boolean; net: string; arena: string },
): Promise<AgentRegistrationResult> {
  const { noManualFallback, noConfirmPause, net, arena } = opts;

  const { address, privateKey } = generateWallet();

  console.log(`\nGenerated wallet for ${fullName}:`);
  console.log(`  Address    : ${address}`);
  console.log(`  Private key: ${privateKey}`);
  console.log(`\nAdd this line to your .env file:`);
  console.log(`  FOREFLOW_${name.toUpperCase()}_AGENT_KEY=${privateKey}`);
  console.log('\n⚠  Save this key now — it will not be shown again.');
  await _promptFn('\nPress Enter when saved, or Ctrl+C to abort: ');

  // Safety Net 2: confirmation prompt
  if (!noConfirmPause) {
    console.log(`\nWallet generated for ${fullName}:`);
    console.log(`  Address : ${address}\n`);
    console.log(`Network : ${net}`);
    console.log(`Arena   : ${arena}\n`);
    const answer = await _promptFn('Continue with registration? (y/N): ');
    if (!answer.trim().toLowerCase().startsWith('y')) {
      console.log('Aborted.');
      return { agentName: fullName, status: 'aborted' };
    }
  }

  // Fetch voucher challenge
  console.log('\nRequesting voucher challenge from Foresight Arena...');
  const challenge = await fetchChallenge(address);

  if (!challenge.tweetText || challenge.tweetText === '(no tweet text returned)') {
    const msg = 'Arena returned empty challenge text. Cannot post voucher tweet.';
    console.error(`✗ ${msg}`);
    return { agentName: fullName, status: 'failed', stage: 'challenge', error: msg };
  }

  // Safety Net 3: post voucher tweet (with built-in 3s pause in API path)
  let voucherResult;
  try {
    voucherResult = await postVoucherTweet(fullName, challenge.tweetText, {
      noManualFallback,
      noConfirmPause,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status: RegistrationStatus = err instanceof NoTokensError ? 'pending' : 'failed';
    console.error(`✗ ${msg}`);
    return { agentName: fullName, status, stage: 'voucher_tweet', error: msg };
  }

  // Verify tweet
  console.log('\nVerifying tweet...');
  const voucher = await verifyTweet(address, voucherResult.tweetUrl.trim());

  // Register via relayer
  console.log('Registering on chain (gasless via relayer)...');
  const agentURI = `${AGENT_URI_BASE}/foreflow-${name}`;
  const reg = (await register({ agent: address, agentURI, voucher })) as RegisterResult;

  const agentId = reg.agentId ?? reg.txHash ?? '(unknown)';
  const txHash = reg.txHash;

  saveRegistration(name, {
    agentId,
    txHash,
    registeredAt: new Date().toISOString(),
    address,
  });

  console.log(`\n✓ ${fullName} registered successfully.`);
  console.log(`  Agent ID : ${agentId}`);
  if (txHash) console.log(`  Tx hash  : ${txHash}`);

  return {
    agentName: fullName,
    status: 'registered',
    agentId,
    postedVia: voucherResult.postedVia,
  };
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

function printSummaryTable(results: AgentRegistrationResult[]): void {
  const W = [24, 22, 48] as const;
  const border = (l: string, m: string, r: string) =>
    l + W.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const row = (cols: [string, string, string]) =>
    '│ ' + cols.map((c, i) => c.padEnd(W[i])).join(' │ ') + ' │';

  const statusLabel: Record<RegistrationStatus, string> = {
    registered: '✓ registered',
    failed: '✗ failed',
    skipped: '✗ skipped',
    pending: '- pending',
    aborted: '- aborted',
  };

  console.log('\nRegistration summary:\n');
  console.log(border('┌', '┬', '┐'));
  console.log(row(['Agent', 'Status', 'Detail']));
  console.log(border('├', '┼', '┤'));

  for (const r of results) {
    const status = statusLabel[r.status] ?? r.status;
    let detail = '';
    if (r.status === 'registered') {
      const via = r.postedVia ? ` via ${r.postedVia}` : '';
      detail = r.agentId ? `agentId ${r.agentId.slice(0, 20)}...${via}` : `success${via}`;
    } else if (r.status === 'pending') {
      detail = r.error ?? `run: engine twitter-auth ${r.agentName}`;
    } else if (r.error) {
      detail = r.error.slice(0, W[2]);
    }
    console.log(row([r.agentName, status, detail]));
  }

  console.log(border('└', '┴', '┘'));
}
