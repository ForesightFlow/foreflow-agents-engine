import { createPublicClient, http, formatUnits } from 'viem';
import { polygon, polygonAmoy } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { isRegistered } from 'foresight-arena';
import { AGENT_NAMES, RPC_URL, CHAIN_ID, DRY_RUN, getAgentKey } from '../lib/env.js';
import { loadRegistration, loadLastDiscover } from '../lib/state.js';
import { openDb } from '../storage/sqlite.js';
import { getTwitterTokens, listTweets } from '../storage/twitter.js';
import { TWITTER_HANDLES } from '../twitter/agents.js';
import type { AgentName } from '../lib/env.js';
import type { FullAgentName } from '../twitter/agents.js';

const chain = CHAIN_ID === 137 ? polygon : polygonAmoy;
const client = createPublicClient({ chain, transport: http(RPC_URL) });

// ---------------------------------------------------------------------------
// Etherscan v2 balance fallback
// ---------------------------------------------------------------------------

export function buildEtherscanBalanceUrl(address: string): string {
  const base = process.env.FFLOW_POLYGONSCAN_URL ?? 'https://api.etherscan.io/v2/api';
  const apiKey = process.env.FFLOW_POLYGONSCAN_API_KEY ?? '';
  return `${base}?chainid=137&module=account&action=balance&address=${address}&apikey=${apiKey}`;
}

async function getBalanceViaEtherscan(address: string): Promise<string | null> {
  try {
    const url = buildEtherscanBalanceUrl(address);
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { status: string; result: string };
    if (json.status !== '1') return null;
    return parseFloat(formatUnits(BigInt(json.result), 18)).toFixed(4);
  } catch {
    return null;
  }
}

async function getBalance(
  address: string,
): Promise<{ balance: string; source: 'rpc' | 'etherscan' | 'unavailable' }> {
  try {
    const wei = await client.getBalance({ address: address as `0x${string}` });
    return { balance: parseFloat(formatUnits(wei, 18)).toFixed(4), source: 'rpc' };
  } catch { /* fall through */ }

  const b = await getBalanceViaEtherscan(address);
  if (b !== null) return { balance: b, source: 'etherscan' };

  return { balance: '?', source: 'unavailable' };
}

// ---------------------------------------------------------------------------
// Per-agent health
// ---------------------------------------------------------------------------

interface AgentHealth {
  name: AgentName;
  fullName: FullAgentName;
  address: string | null;
  agentId: string | null;
  balance: string | null;
  balanceSource: 'rpc' | 'etherscan' | 'unavailable';
  nftHeld: boolean | null;
  twitterHandle: string;
  twitterAuthorized: boolean;
  lastTweetAt: number | null;
  lastTweetKind: string | null;
  lastDiscover: string | null;
  error: string | null;
}

async function checkAgent(name: AgentName): Promise<AgentHealth> {
  const fullName = `foreflow-${name}` as FullAgentName;
  const key = getAgentKey(name);
  const db = openDb();

  const tokens = getTwitterTokens(db, fullName);
  const tweets = listTweets(db, { agentName: fullName });
  const lastTweet = tweets[0] ?? null;

  const base: AgentHealth = {
    name,
    fullName,
    address: null,
    agentId: null,
    balance: null,
    balanceSource: 'unavailable',
    nftHeld: null,
    twitterHandle: TWITTER_HANDLES[fullName],
    twitterAuthorized: tokens !== null,
    lastTweetAt: lastTweet?.postedAt ?? null,
    lastTweetKind: lastTweet?.tweetKind ?? null,
    lastDiscover: null,
    error: null,
  };

  if (!key) {
    base.error = DRY_RUN
      ? '(no key — dry-run only)'
      : `FOREFLOW_${name.toUpperCase()}_AGENT_KEY not set`;
    const reg = loadRegistration(name);
    if (reg) {
      base.agentId = reg.agentId;
      base.nftHeld = true;
    }
    return base;
  }

  try {
    const account = privateKeyToAccount(key as `0x${string}`);
    base.address = account.address;

    const reg = loadRegistration(name);
    if (reg) {
      base.agentId = reg.agentId;
    }

    const [{ balance, source }, registered] = await Promise.all([
      getBalance(account.address),
      isRegistered(account.address),
    ]);

    base.balance = balance;
    base.balanceSource = source;
    base.nftHeld = registered;

    const lastDiscover = loadLastDiscover(name);
    base.lastDiscover = lastDiscover ? lastDiscover.toISOString().slice(0, 16).replace('T', ' ') : null;
  } catch (err) {
    base.error = String(err);
  }

  return base;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const INDENT = ' '.repeat(31);

function fmtAgent(h: AgentHealth): string {
  const lines: string[] = [];

  const statusTag = (() => {
    if (h.error && !DRY_RUN) return '[FAIL]';
    if (h.nftHeld === false) return '[WARN]';
    return '[OK]  ';
  })();

  const label = `foreflow-${h.name}`.padEnd(24);
  const agentIdStr = h.agentId ? `Agent ID ${h.agentId}` : 'not registered';
  lines.push(`${statusTag} ${label} ${agentIdStr}`);

  if (h.address) {
    lines.push(`${INDENT}Wallet  ${h.address}`);
  }

  if (h.nftHeld !== null) {
    const nftStr = h.nftHeld ? 'yes' : 'NO — run register-all';
    lines.push(`${INDENT}NFT held: ${nftStr}`);
  }

  if (h.balance !== null) {
    const srcNote = h.balanceSource === 'etherscan' ? ' (via Etherscan)' : h.balanceSource === 'unavailable' ? ' (RPC unavailable)' : '';
    lines.push(`${INDENT}Balance: ${h.balance} POL (gasless mode)${srcNote}`);
  }

  const twitterStr = h.twitterAuthorized
    ? `@${h.twitterHandle} authorized`
    : `@${h.twitterHandle} NOT authorized — run twitter-auth foreflow-${h.name}`;
  lines.push(`${INDENT}Twitter: ${twitterStr}`);

  if (h.lastTweetAt !== null) {
    const ts = new Date(h.lastTweetAt * 1000).toISOString().slice(0, 16).replace('T', ' ');
    lines.push(`${INDENT}Last tweet: ${ts} UTC (${h.lastTweetKind ?? 'unknown'})`);
  }

  if (h.lastDiscover) {
    lines.push(`${INDENT}Last discover: ${h.lastDiscover} UTC`);
  }

  if (h.error) {
    lines.push(`${INDENT}Error: ${h.error}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Relayer check
// ---------------------------------------------------------------------------

async function checkRelayer(): Promise<boolean> {
  try {
    const relayerUrl = process.env.RELAYER_URL ?? 'https://api.foresightarena.xyz';
    const res = await fetch(`${relayerUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runHealthcheck(): Promise<boolean> {
  console.log(`foreflow-agents healthcheck  [${new Date().toISOString()}]`);
  console.log(`Network : CHAIN_ID=${CHAIN_ID} (${CHAIN_ID === 137 ? 'Polygon mainnet' : 'Amoy testnet'})`);
  console.log(`Dry-run : ${DRY_RUN}`);
  console.log(`RPC     : ${RPC_URL}`);
  const subgraphUrl = process.env.SUBGRAPH_URL ?? '(default studio)';
  console.log(`Subgraph: ${subgraphUrl}`);
  console.log('');

  const results = await Promise.all(AGENT_NAMES.map(checkAgent));

  let allOk = true;

  for (const h of results) {
    console.log(fmtAgent(h));
    console.log('');

    if (h.error && !DRY_RUN) allOk = false;
    if (h.nftHeld === false) allOk = false;
  }

  const relayerOk = await checkRelayer();
  if (relayerOk) {
    console.log('[OK]   Relayer reachable');
  } else {
    console.log('[WARN] Relayer unreachable — check RELAYER_URL and network');
  }

  console.log('');
  console.log(`Status: ${allOk ? 'READY' : 'NOT READY'}`);
  return allOk;
}
