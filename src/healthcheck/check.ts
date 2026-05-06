import { createPublicClient, http, formatUnits } from 'viem';
import { polygon, polygonAmoy } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { isRegistered, getNonce, getAllScores } from 'foresight-arena';
import { AGENT_NAMES, RPC_URL, CHAIN_ID, DRY_RUN, getAgentKey } from '../lib/env.js';
import { loadRegistration, loadLastDiscover } from '../lib/state.js';
import type { AgentName } from '../lib/env.js';

const chain = CHAIN_ID === 137 ? polygon : polygonAmoy;
const client = createPublicClient({ chain, transport: http(RPC_URL) });

interface AgentHealth {
  name: AgentName;
  address: string | null;
  balancePOL: string | null;
  registered: boolean | null;
  lastDiscover: string | null;
  agentId: string | null;
  error: string | null;
}

async function checkAgent(name: AgentName): Promise<AgentHealth> {
  const key = getAgentKey(name);
  const result: AgentHealth = {
    name,
    address: null,
    balancePOL: null,
    registered: null,
    lastDiscover: null,
    agentId: null,
    error: null,
  };

  if (!key) {
    result.error = DRY_RUN
      ? '(no key — dry-run only)'
      : `FOREFLOW_${name.toUpperCase()}_AGENT_KEY not set`;
    const reg = loadRegistration(name);
    if (reg) result.agentId = reg.agentId;
    return result;
  }

  try {
    const account = privateKeyToAccount(key as `0x${string}`);
    result.address = account.address;

    const [balance, registered] = await Promise.all([
      client.getBalance({ address: account.address }),
      isRegistered(account.address),
    ]);

    result.balancePOL = parseFloat(formatUnits(balance, 18)).toFixed(4);
    result.registered = registered;

    const reg = loadRegistration(name);
    if (reg) result.agentId = reg.agentId;

    const lastDiscover = loadLastDiscover(name);
    result.lastDiscover = lastDiscover ? lastDiscover.toISOString() : null;
  } catch (err) {
    result.error = String(err);
  }

  return result;
}

async function checkRelayer(): Promise<boolean> {
  try {
    const relayerUrl = process.env.RELAYER_URL ?? 'https://api.foresightarena.xyz';
    const res = await fetch(`${relayerUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runHealthcheck(): Promise<boolean> {
  console.log(`foreflow-agents healthcheck  [${new Date().toISOString()}]`);
  console.log(`Network : CHAIN_ID=${CHAIN_ID} (${CHAIN_ID === 137 ? 'Polygon mainnet' : 'Amoy testnet'})`);
  console.log(`Dry-run : ${DRY_RUN}`);
  console.log('');

  const results = await Promise.all(AGENT_NAMES.map(checkAgent));

  let allOk = true;

  for (const h of results) {
    const label = `foreflow-${h.name}`.padEnd(24);

    if (h.error && !DRY_RUN) {
      console.log(`[FAIL] ${label}  ${h.error}`);
      allOk = false;
      continue;
    }

    if (!h.address) {
      console.log(`[WARN] ${label}  ${h.error ?? 'no key'}`);
      continue;
    }

    const regStatus = h.registered ? 'registered' : 'NOT REGISTERED — run register-all';
    const balance = h.balancePOL ?? '?';
    // Gasless mode: agents never need POL. Low balance is informational, not a warning.
    const balanceNote =
      parseFloat(balance) < 0.01 && balance !== '?'
        ? ' (gasless mode — POL not required)'
        : '';
    const lastRun = h.lastDiscover ?? 'never';

    console.log(`[OK]   ${label}  ${h.address}  ${balance} POL${balanceNote}  ${regStatus}  last-discover=${lastRun}`);

    if (!h.registered) allOk = false;
  }

  console.log('');
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
