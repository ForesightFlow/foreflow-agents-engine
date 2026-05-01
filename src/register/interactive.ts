import readline from 'node:readline';
import { requestChallenge, verifyTweet, register } from 'foresight-arena';
import { generateWallet } from './wallet.js';
import { saveRegistration } from '../lib/state.js';
import { DRY_RUN } from '../lib/env.js';
import type { AgentName } from '../lib/env.js';

interface ChallengeResult {
  tweetText: string;
  challenge: string;
}

interface RegisterResult {
  agentId: string;
  txHash?: string;
}

const CHALLENGE_TTL_MS = 14 * 60 * 1000;
const AGENT_URI_BASE = 'https://github.com/ForesightFlow/foreflow-agents/tree/master/agents';

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function fetchChallenge(address: string): Promise<ChallengeResult> {
  const raw = (await requestChallenge(address)) as Record<string, string>;
  return {
    tweetText: raw.tweetText ?? raw.tweet_text ?? raw.message ?? '(no tweet text returned)',
    challenge: raw.challenge ?? raw.challengeCode ?? '',
  };
}

export async function registerAgent(name: AgentName): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await doRegister(name, rl);
  } finally {
    rl.close();
  }
}

async function doRegister(name: AgentName, rl: readline.Interface): Promise<void> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Registering foreflow-${name}`);
  console.log('─'.repeat(60));

  if (DRY_RUN) {
    console.log('[dry-run] Would generate wallet and run Twitter voucher flow.');
    console.log(`[dry-run] Would set FOREFLOW_${name.toUpperCase()}_AGENT_KEY=0x<private-key> in .env`);
    return;
  }

  const { address, privateKey } = generateWallet();

  console.log(`\nGenerated wallet for foreflow-${name}:`);
  console.log(`  Address    : ${address}`);
  console.log(`  Private key: ${privateKey}`);
  console.log(`\nAdd this line to your .env file:`);
  console.log(`  FOREFLOW_${name.toUpperCase()}_AGENT_KEY=${privateKey}`);
  console.log('\n⚠  Save this key now — it will not be shown again.');
  await prompt(rl, '\nPress Enter when saved, or Ctrl+C to abort: ');

  let challengeResult = await fetchChallenge(address);
  let challengeFetchedAt = Date.now();

  while (true) {
    console.log('\nPost the following tweet from the shared @foreflow account:');
    console.log('─'.repeat(60));
    console.log(challengeResult.tweetText);
    console.log('─'.repeat(60));

    const tweetUrl = await prompt(rl, '\nAfter posting, paste the tweet URL and press Enter:\n> ');

    if (Date.now() - challengeFetchedAt > CHALLENGE_TTL_MS) {
      console.log('\nChallenge expired (15-min window). Re-fetching a new challenge...');
      challengeResult = await fetchChallenge(address);
      challengeFetchedAt = Date.now();
      console.log('New tweet text generated. Please post a new tweet:');
      continue;
    }

    console.log('\nVerifying tweet...');
    const voucher = await verifyTweet(address, tweetUrl.trim());

    console.log('Registering on-chain...');
    const agentURI = `${AGENT_URI_BASE}/foreflow-${name}`;
    const result = (await register({ agent: address, agentURI, voucher })) as RegisterResult;

    const agentId = result.agentId ?? result.txHash ?? '(unknown)';
    const txHash = result.txHash;

    saveRegistration(name, {
      agentId,
      txHash,
      registeredAt: new Date().toISOString(),
      address,
    });

    console.log(`\n✓ foreflow-${name} registered successfully.`);
    console.log(`  Agent ID : ${agentId}`);
    if (txHash) console.log(`  Tx hash  : ${txHash}`);
    break;
  }
}
