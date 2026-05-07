/**
 * Update agentURI metadata on-chain for all ForeFlow agents.
 *
 * Usage:
 *   npx tsx scripts/update-agent-uris.ts           # dry-run (default)
 *   npx tsx scripts/update-agent-uris.ts --live    # send real transactions
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

// ---------------------------------------------------------------------------
// Bootstrap .env (same parser as the engine)
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const raw = m[2].replace(/\s+#.*$/, '').trim();
    process.env[m[1]] ??= raw.replace(/^"(.*)"$/, '$1');
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LIVE = process.argv.includes('--live');
const RPC_URL = process.env.RPC_URL ?? 'https://polygon-rpc.com';
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
const CHAIN_ID = 137;

// Minimal ABI — only the two functions this script needs.
const IdentityRegistryAbi = [
  {
    name: 'setAgentURI',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
] as const;

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

interface AgentDef {
  name: 'foreflow-ensemble' | 'foreflow-debate' | 'foreflow-orchestrator' | 'foreflow-pipeline' | 'foreflow-consensus';
  agentId: bigint;
  wallet: `0x${string}`;
  keyVar: string;
}

const AGENTS: AgentDef[] = [
  { name: 'foreflow-ensemble',     agentId: 506n, wallet: '0xA1b38e04C3f334c2B0D5003C51e857DB86D224d3', keyVar: 'FOREFLOW_ENSEMBLE_AGENT_KEY' },
  { name: 'foreflow-debate',       agentId: 507n, wallet: '0x09D33284a66eef5e78059F24842d2172Cce67A60', keyVar: 'FOREFLOW_DEBATE_AGENT_KEY' },
  { name: 'foreflow-orchestrator', agentId: 508n, wallet: '0x5b41f7B72E740b5Ff58F772E804F23DF79514813', keyVar: 'FOREFLOW_ORCHESTRATOR_AGENT_KEY' },
  { name: 'foreflow-pipeline',     agentId: 509n, wallet: '0xbFAB05c0CdAdC528e61176DFC674e0070c351674', keyVar: 'FOREFLOW_PIPELINE_AGENT_KEY' },
  { name: 'foreflow-consensus',    agentId: 510n, wallet: '0x97d9dD0f9FE739BAdC16Fc0e38073C8B42BC719C', keyVar: 'FOREFLOW_CONSENSUS_AGENT_KEY' },
];

// ---------------------------------------------------------------------------
// Import buildAgentURI from the engine source
// ---------------------------------------------------------------------------

const { buildAgentURI } = await import('../src/register/metadata.js');

// ---------------------------------------------------------------------------
// RPC clients
// ---------------------------------------------------------------------------

const publicClient = createPublicClient({
  chain: polygon,
  transport: http(RPC_URL),
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`ForeFlow agentURI updater`);
console.log(`Mode  : ${LIVE ? 'LIVE' : 'DRY-RUN'}`);
console.log(`RPC   : ${RPC_URL}`);
console.log(`Registry: ${IDENTITY_REGISTRY}`);
console.log('');

type AgentStatus = 'up_to_date' | 'updated' | 'skipped_balance' | 'skipped_no_key' | 'failed';
const results: Array<{ agent: AgentDef; status: AgentStatus; detail?: string }> = [];

for (const agent of AGENTS) {
  const label = `[${agent.name.padEnd(22)} ${agent.agentId}]`;

  // Private key
  const privateKey = process.env[agent.keyVar];
  if (!privateKey) {
    console.log(`${label} SKIP — ${agent.keyVar} not set`);
    results.push({ agent, status: 'skipped_no_key', detail: `${agent.keyVar} not set` });
    continue;
  }

  // Compute URI
  const uri = buildAgentURI({ name: agent.name, agentId: Number(agent.agentId), walletAddress: agent.wallet });
  const decoded = JSON.parse(Buffer.from(uri.replace('data:application/json;base64,', ''), 'base64').toString());

  // Read current on-chain URI
  let onChainUri: string;
  try {
    onChainUri = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IdentityRegistryAbi,
      functionName: 'tokenURI',
      args: [agent.agentId],
    }) as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${label} FAIL — could not read on-chain URI: ${msg}`);
    results.push({ agent, status: 'failed', detail: msg });
    continue;
  }

  if (onChainUri === uri) {
    console.log(`${label} ALREADY UP TO DATE — on-chain URI matches computed`);
    results.push({ agent, status: 'up_to_date' });
    continue;
  }

  // Check balance
  const balance = await publicClient.getBalance({ address: agent.wallet });

  // Estimate gas
  let gasEstimate: bigint;
  try {
    gasEstimate = await publicClient.estimateContractGas({
      address: IDENTITY_REGISTRY,
      abi: IdentityRegistryAbi,
      functionName: 'setAgentURI',
      args: [agent.agentId, uri],
      account: agent.wallet,
    });
  } catch {
    // estimateGas can fail for unfunded wallets; use a generous fallback
    gasEstimate = 150_000n;
  }

  const gasPrice = await publicClient.getGasPrice();
  const estCostWei = gasEstimate * gasPrice;
  const margin = estCostWei * 110n / 100n;

  console.log(`${label} NEEDS UPDATE`);
  console.log(`  balance       : ${formatEther(balance)} POL`);
  console.log(`  gas estimate  : ${gasEstimate.toLocaleString()} units × ${formatEther(gasPrice * 1_000_000_000n)} GWEI/unit`);
  console.log(`  est cost+10%  : ${formatEther(margin)} POL`);
  console.log(`  computed URI  : data:application/json;base64,... (${uri.length} chars)`);
  console.log(`    name        : ${decoded.name}`);
  console.log(`    type        : ${decoded.type}`);
  console.log(`    active      : ${decoded.active}`);
  console.log(`    registrations[0].agentId     : ${decoded.registrations?.[0]?.agentId}`);
  console.log(`    registrations[0].agentAddress: ${decoded.registrations?.[0]?.agentAddress}`);

  if (balance < margin) {
    console.log(`  → SKIP — insufficient POL: balance=${formatEther(balance)}, need ~${formatEther(margin)}`);
    results.push({
      agent,
      status: 'skipped_balance',
      detail: `balance=${formatEther(balance)} need ~${formatEther(margin)}`,
    });
    continue;
  }

  if (!LIVE) {
    console.log(`  → DRY-RUN: would send setAgentURI(${agent.agentId}, uri)`);
    results.push({ agent, status: 'updated', detail: 'dry-run' });
    continue;
  }

  // Send transaction
  console.log(`  → UPDATING...`);
  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: http(RPC_URL),
    });

    const hash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY,
      abi: IdentityRegistryAbi,
      functionName: 'setAgentURI',
      args: [agent.agentId, uri],
      account,
      chain: polygon,
    });

    console.log(`  tx submitted  : ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error(`tx reverted: ${hash}`);
    }

    console.log(`  block         : ${receipt.blockNumber}`);
    console.log(`  gas used      : ${receipt.gasUsed.toLocaleString()}`);

    // Verify on-chain
    const onChainNow = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IdentityRegistryAbi,
      functionName: 'tokenURI',
      args: [agent.agentId],
    }) as string;

    if (onChainNow !== uri) {
      console.log(`  WARNING: tx succeeded but on-chain URI doesn't match computed URI`);
      console.log(`    on-chain : ${onChainNow.slice(0, 80)}...`);
      console.log(`    computed : ${uri.slice(0, 80)}...`);
    } else {
      console.log(`  VERIFIED — on-chain URI matches computed`);
    }

    results.push({ agent, status: 'updated', detail: `tx=${hash}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAILED: ${msg}`);
    results.push({ agent, status: 'failed', detail: msg });
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\nSummary:');

const updated   = results.filter((r) => r.status === 'updated');
const upToDate  = results.filter((r) => r.status === 'up_to_date');
const skipped   = results.filter((r) => r.status === 'skipped_balance' || r.status === 'skipped_no_key');
const failed    = results.filter((r) => r.status === 'failed');

const names = (rs: typeof results) => rs.map((r) => r.agent.name.replace('foreflow-', '')).join(', ');
const detail = (rs: typeof results) => rs.map((r) => r.detail ?? '').filter(Boolean).join('; ');

console.log(`  ${LIVE ? 'Updated' : 'Would update'} : ${updated.length}${updated.length ? ' (' + names(updated) + ')' : ''}`);
console.log(`  Up to date    : ${upToDate.length}${upToDate.length ? ' (' + names(upToDate) + ')' : ''}`);
console.log(`  Skipped       : ${skipped.length}${skipped.length ? ' (' + names(skipped) + ' — ' + detail(skipped) + ')' : ''}`);
console.log(`  Failed        : ${failed.length}${failed.length ? ' (' + names(failed) + ')' : ''}`);
