#!/usr/bin/env node
import { AGENT_NAMES, DRY_RUN } from './lib/env.js';
import type { AgentName } from './lib/env.js';

const [, , command, ...args] = process.argv;

function parseFlag(flag: string): boolean {
  return args.includes(flag);
}

function parseOption(opt: string): string | undefined {
  const idx = args.indexOf(opt);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function isAgentName(s: string): s is AgentName {
  return (AGENT_NAMES as ReadonlyArray<string>).includes(s);
}

function printHelp(): void {
  console.log(`
foreflow-engine — operational CLI for ForeFlow agents

USAGE
  foreflow-engine <command> [options]

COMMANDS
  register-all              Register all 5 agents via Twitter voucher flow
  register --agent <name>   Register a single agent
  healthcheck               Check wallet balances, registration, and relayer
  run-agent <name>          Invoke a single agent (used by cron wrapper)
    --mode discover|predict|all
    --live                  Enable on-chain transactions (default: dry-run)
  bootstrap-vps             One-shot VPS setup (clones repos, installs cron)
  help                      Show this help

AGENT NAMES
  ensemble | debate | orchestrator | pipeline | consensus

EXAMPLES
  foreflow-engine register-all
  foreflow-engine healthcheck
  foreflow-engine run-agent ensemble --mode discover --live
  foreflow-engine run-agent debate --mode predict

ENV
  DRY_RUN=1          Skip on-chain calls (default for register-all simulation)
  FOREFLOW_AGENTS_DIR  Path to foreflow-agents repo (default: ../foreflow-agents)

See docs/DEPLOYMENT.md for full setup instructions.
`.trim());
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

switch (command) {
  case 'register-all':
    await cmdRegisterAll();
    break;
  case 'register':
    await cmdRegister();
    break;
  case 'healthcheck':
    await cmdHealthcheck();
    break;
  case 'run-agent':
    await cmdRunAgent();
    break;
  case 'bootstrap-vps':
    await cmdBootstrapVps();
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}

// ---------------------------------------------------------------------------
// register-all
// ---------------------------------------------------------------------------

async function cmdRegisterAll(): Promise<void> {
  const { registerAgent } = await import('./register/interactive.js');
  console.log('ForeFlow agent registration');
  console.log(`Registering ${AGENT_NAMES.length} agents. Each requires a separate tweet.`);
  if (DRY_RUN) console.log('DRY_RUN=1 — simulating flow without on-chain transactions.\n');

  for (const name of AGENT_NAMES) {
    await registerAgent(name);
  }

  console.log('\nAll agents processed. Add the generated keys to your .env file.');
  console.log('Run `foreflow-engine healthcheck` to verify registration.');
}

// ---------------------------------------------------------------------------
// register --agent <name>
// ---------------------------------------------------------------------------

async function cmdRegister(): Promise<void> {
  const agentArg = parseOption('--agent');
  if (!agentArg || !isAgentName(agentArg)) {
    console.error(`Usage: foreflow-engine register --agent <${AGENT_NAMES.join('|')}>`);
    process.exit(1);
  }
  const { registerAgent } = await import('./register/interactive.js');
  await registerAgent(agentArg);
  console.log('\nRun `foreflow-engine healthcheck` to verify registration.');
}

// ---------------------------------------------------------------------------
// healthcheck
// ---------------------------------------------------------------------------

async function cmdHealthcheck(): Promise<void> {
  const { runHealthcheck } = await import('./healthcheck/check.js');
  const ok = await runHealthcheck();
  if (!ok) process.exit(1);
}

// ---------------------------------------------------------------------------
// run-agent <name> --mode <mode> [--live]
// ---------------------------------------------------------------------------

async function cmdRunAgent(): Promise<void> {
  const agentArg = args[0];
  if (!agentArg || !isAgentName(agentArg)) {
    console.error(`Usage: foreflow-engine run-agent <${AGENT_NAMES.join('|')}> --mode discover|predict|all`);
    process.exit(1);
  }

  const modeArg = parseOption('--mode') ?? process.env.MODE ?? 'all';
  if (!['discover', 'predict', 'all'].includes(modeArg)) {
    console.error(`Invalid --mode "${modeArg}". Must be: discover | predict | all`);
    process.exit(1);
  }

  const live = parseFlag('--live') || process.env.DRY_RUN === '0' || process.env.DRY_RUN === 'false';

  if (modeArg === 'discover' || modeArg === 'all') {
    const { runDiscover } = await import('./runner/discover.js');
    await runDiscover(agentArg, live);
  }
  if (modeArg === 'predict' || modeArg === 'all') {
    const { runPredict } = await import('./runner/predict.js');
    await runPredict(agentArg, live);
  }
}

// ---------------------------------------------------------------------------
// bootstrap-vps
// ---------------------------------------------------------------------------

async function cmdBootstrapVps(): Promise<void> {
  const { bootstrapVps } = await import('./bootstrap/vps.js');
  await bootstrapVps();
}
