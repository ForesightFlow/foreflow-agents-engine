#!/usr/bin/env node
import { AGENT_NAMES, DRY_RUN, CHAIN_ID } from './lib/env.js';
import type { AgentName } from './lib/env.js';
import { FOREFLOW_AGENT_NAMES, TWITTER_HANDLES } from './twitter/agents.js';
import type { FullAgentName } from './twitter/agents.js';

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

function isFullAgentName(s: string): s is FullAgentName {
  return (FOREFLOW_AGENT_NAMES as ReadonlyArray<string>).includes(s);
}

function parseOptionInline(flag: string): string | undefined {
  // Supports both "--text value" and "--text=value" forms
  for (const arg of args) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return undefined;
}

function printHelp(): void {
  console.log(`
foreflow-engine — operational CLI for ForeFlow agents

USAGE
  foreflow-engine <command> [options]

COMMANDS
  register-all              Register all 5 agents via Twitter voucher flow
    --dry-run                 Simulate full flow, no network calls
    --no-manual-fallback      Skip agents without Twitter tokens (no manual prompt)
    --no-confirm-pause        Skip confirmation prompt and 3s tweet pause
  register --agent <name>   Register a single agent (same flags as register-all)
  healthcheck               Check wallet balances, registration, and relayer
  run-agent <name>          Invoke a single agent (used by cron wrapper)
    --mode discover|predict|all
    --live                  Enable on-chain transactions (default: dry-run)
  bootstrap-vps             One-shot VPS setup (clones repos, installs cron)

  twitter-auth <agent>      OAuth 2.0 PKCE flow — authorize a Twitter account
  test-tweet <agent>        Post a test tweet from an agent account
    --text "..."              Custom tweet text (default: timestamped test message)
  twitter-status            Show authorization and tweet counts for all agents

  post-daily-status <agent> Post cumulative daily status tweet (18:00 UTC cron target)
    --dry-run                 Compose text and print — do not post
  post-resolution-status <agent>
                            Check for new round resolutions and post if any
    --dry-run                 Print tweets that would be posted — do not post
  receive-events            Read JSONL agent events from stdin and write to DB
    --agent <name>            Agent name (default: foreflow-ensemble)
  dump-data <output-dir>    Export predictions/traces/tweets to JSONL files

  help                      Show this help

AGENT NAMES
  For register: ensemble | debate | orchestrator | pipeline | consensus
    (also accepted: foreflow-ensemble, foreflow-debate, etc.)
  For Twitter commands: foreflow-ensemble | foreflow-debate | foreflow-orchestrator
    | foreflow-pipeline | foreflow-consensus

EXAMPLES
  foreflow-engine register-all --dry-run
  foreflow-engine register-all --no-manual-fallback
  foreflow-engine register --agent foreflow-ensemble --dry-run
  foreflow-engine healthcheck
  foreflow-engine run-agent ensemble --mode discover --live
  foreflow-engine twitter-auth foreflow-ensemble
  foreflow-engine test-tweet foreflow-ensemble
  foreflow-engine twitter-status
  foreflow-engine post-daily-status foreflow-ensemble --dry-run
  foreflow-engine post-resolution-status foreflow-ensemble --dry-run
  foreflow-engine dump-data ~/foreflow-dataset/
  node tools/emit-mock-events.mjs | foreflow-engine receive-events

ENV
  DRY_RUN=1                 Skip on-chain calls (equivalent to --dry-run flag)
  FOREFLOW_AGENTS_DIR       Path to foreflow-agents repo (default: ../foreflow-agents)
  TWITTER_CLIENT_ID         Twitter Developer App OAuth 2.0 client ID
  TWITTER_CLIENT_SECRET     Twitter Developer App OAuth 2.0 client secret

See docs/DEPLOYMENT.md, docs/TWITTER.md, and docs/REGISTRATION.md for setup instructions.
`.trim());
}

function parseRegisterOpts() {
  return {
    dryRun: DRY_RUN || parseFlag('--dry-run'),
    noManualFallback: parseFlag('--no-manual-fallback'),
    noConfirmPause: parseFlag('--no-confirm-pause'),
  };
}

// Accept both 'ensemble' and 'foreflow-ensemble'
function parseAgentArg(): AgentName | undefined {
  const arg = parseOption('--agent') ?? args[0];
  if (!arg) return undefined;
  const short = arg.startsWith('foreflow-') ? arg.slice('foreflow-'.length) : arg;
  return isAgentName(short) ? (short as AgentName) : undefined;
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
  case 'twitter-auth':
    await cmdTwitterAuth();
    break;
  case 'test-tweet':
    await cmdTestTweet();
    break;
  case 'twitter-status':
    await cmdTwitterStatus();
    break;
  case 'post-daily-status':
    await cmdPostDailyStatus();
    break;
  case 'post-resolution-status':
    await cmdPostResolutionStatus();
    break;
  case 'receive-events':
    await cmdReceiveEvents();
    break;
  case 'dump-data':
    await cmdDumpData();
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
  const { registerAll } = await import('./register/interactive.js');
  await registerAll(parseRegisterOpts());
  console.log('\nRun `foreflow-engine healthcheck` to verify registration.');
}

// ---------------------------------------------------------------------------
// register --agent <name>
// ---------------------------------------------------------------------------

async function cmdRegister(): Promise<void> {
  const name = parseAgentArg();
  if (!name) {
    console.error(
      `Usage: foreflow-engine register --agent <${AGENT_NAMES.join('|')}> [--dry-run] [--no-manual-fallback] [--no-confirm-pause]`,
    );
    process.exit(1);
  }
  const { registerAgent } = await import('./register/interactive.js');
  const result = await registerAgent(name, parseRegisterOpts());
  if (result.status !== 'registered' && result.status !== 'aborted') {
    process.exitCode = 1;
  }
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

// ---------------------------------------------------------------------------
// twitter-auth <agent-name>
// ---------------------------------------------------------------------------

async function cmdTwitterAuth(): Promise<void> {
  const agentArg = args[0];
  if (!agentArg || !isFullAgentName(agentArg)) {
    console.error(
      `Usage: foreflow-engine twitter-auth <${FOREFLOW_AGENT_NAMES.join('|')}>`,
    );
    process.exit(1);
  }
  const { runOAuthFlow } = await import('./twitter/auth.js');
  await runOAuthFlow(agentArg);
}

// ---------------------------------------------------------------------------
// test-tweet <agent-name> [--text "..."]
// ---------------------------------------------------------------------------

async function cmdTestTweet(): Promise<void> {
  const agentArg = args[0];
  if (!agentArg || !isFullAgentName(agentArg)) {
    console.error(
      `Usage: foreflow-engine test-tweet <${FOREFLOW_AGENT_NAMES.join('|')}> [--text "..."]`,
    );
    process.exit(1);
  }

  const textArg =
    parseOptionInline('--text') ??
    `Test tweet from ${agentArg} at ${new Date().toISOString()}.`;

  const { postFromAgent } = await import('./twitter/post.js');
  const record = await postFromAgent(agentArg, textArg, 'manual');

  const handle = TWITTER_HANDLES[agentArg];
  console.log(`\nPosted tweet from ${agentArg} (@${handle}):`);
  console.log(`  https://twitter.com/${handle}/status/${record.tweetId}\n`);
}

// ---------------------------------------------------------------------------
// twitter-status
// ---------------------------------------------------------------------------

async function cmdTwitterStatus(): Promise<void> {
  const { openDb } = await import('./storage/sqlite.js');
  const { getTwitterTokens, listTweets } = await import('./storage/twitter.js');
  const db = openDb();

  type Row = {
    agent: string;
    authorized: string;
    expires: string;
    lastTweet: string;
    total: number;
  };

  const rows: Row[] = FOREFLOW_AGENT_NAMES.map((name) => {
    const tokens = getTwitterTokens(db, name);
    const tweets = listTweets(db, { agentName: name });
    const lastTweet =
      tweets.length > 0
        ? new Date(tweets[0].postedAt * 1000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 16)
        : '—';
    const expires = tokens
      ? new Date(tokens.expiresAt * 1000).toISOString().split('T')[0]
      : '—';
    return {
      agent: name,
      authorized: tokens ? 'Y' : 'N',
      expires,
      lastTweet,
      total: tweets.length,
    };
  });

  const COL_WIDTHS = [24, 12, 13, 17, 12] as const;
  const HEADERS = ['Agent', 'Authorized?', 'Token expires', 'Last tweet', 'Total tweets'];

  function pad(s: string, w: number): string {
    return s.padEnd(w);
  }

  const top =
    '┌' + COL_WIDTHS.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
  const mid =
    '├' + COL_WIDTHS.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
  const bot =
    '└' + COL_WIDTHS.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';
  const headerLine =
    '│ ' +
    HEADERS.map((h, i) => pad(h, COL_WIDTHS[i])).join(' │ ') +
    ' │';

  console.log(top);
  console.log(headerLine);
  console.log(mid);

  for (const r of rows) {
    const line =
      '│ ' +
      [
        pad(r.agent, COL_WIDTHS[0]),
        pad(r.authorized, COL_WIDTHS[1]),
        pad(r.expires, COL_WIDTHS[2]),
        pad(r.lastTweet, COL_WIDTHS[3]),
        pad(String(r.total), COL_WIDTHS[4]),
      ].join(' │ ') +
      ' │';
    console.log(line);
  }

  console.log(bot);
}

// ---------------------------------------------------------------------------
// post-daily-status <agent>
// ---------------------------------------------------------------------------

async function cmdPostDailyStatus(): Promise<void> {
  const agentArg = args[0];
  if (!agentArg) {
    console.error(`Usage: foreflow-engine post-daily-status <${FOREFLOW_AGENT_NAMES.join('|')}> [--dry-run]`);
    process.exit(1);
  }
  // Accept both short and full names
  const fullName = agentArg.startsWith('foreflow-') ? agentArg : `foreflow-${agentArg}`;
  if (!isFullAgentName(fullName)) {
    console.error(`Unknown agent "${agentArg}". Use: ${FOREFLOW_AGENT_NAMES.join(' | ')}`);
    process.exit(1);
  }
  const dryRun = DRY_RUN || parseFlag('--dry-run');
  const { postDailyStatus } = await import('./runner/daily-status.js');
  await postDailyStatus(fullName, { dryRun });
}

// ---------------------------------------------------------------------------
// post-resolution-status <agent>
// ---------------------------------------------------------------------------

async function cmdPostResolutionStatus(): Promise<void> {
  const agentArg = args[0];
  if (!agentArg) {
    console.error(`Usage: foreflow-engine post-resolution-status <${FOREFLOW_AGENT_NAMES.join('|')}> [--dry-run]`);
    process.exit(1);
  }
  const fullName = agentArg.startsWith('foreflow-') ? agentArg : `foreflow-${agentArg}`;
  if (!isFullAgentName(fullName)) {
    console.error(`Unknown agent "${agentArg}". Use: ${FOREFLOW_AGENT_NAMES.join(' | ')}`);
    process.exit(1);
  }
  const dryRun = DRY_RUN || parseFlag('--dry-run');
  const { checkAndPostResolutionStatus } = await import('./runner/resolution-status.js');
  await checkAndPostResolutionStatus(fullName, { dryRun });
}

// ---------------------------------------------------------------------------
// receive-events [--agent <name>]
// ---------------------------------------------------------------------------

async function cmdReceiveEvents(): Promise<void> {
  const agentArg = parseOption('--agent') ?? 'foreflow-ensemble';
  const fullName = agentArg.startsWith('foreflow-') ? agentArg : `foreflow-${agentArg}`;
  if (!isFullAgentName(fullName)) {
    console.error(`Unknown agent "${agentArg}". Use --agent <foreflow-ensemble|...>`);
    process.exit(1);
  }

  const { openDb } = await import('./storage/sqlite.js');
  const { EventHandler } = await import('./events/handler.js');
  const { parseAgentEvent } = await import('./events/types.js');
  const readline = await import('node:readline');

  const network = (CHAIN_ID === 137 ? 'mainnet' : 'amoy') as 'amoy' | 'mainnet';
  const db = openDb();
  const handler = new EventHandler(db, fullName, network);

  const rl = readline.default.createInterface({ input: process.stdin, crlfDelay: Infinity });

  let eventCount = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const event = parseAgentEvent(line);
    if (event) {
      handler.dispatch(event);
      eventCount++;
      console.log(`[engine] dispatched ${event.kind}`);
    } else {
      // Pass through non-event lines as regular log output
      console.log(line);
    }
  }

  console.log(`\n[engine] receive-events done: ${eventCount} event${eventCount !== 1 ? 's' : ''} dispatched.`);
}

// ---------------------------------------------------------------------------
// dump-data <output-dir>
// ---------------------------------------------------------------------------

async function cmdDumpData(): Promise<void> {
  const outputDir = args[0];
  if (!outputDir) {
    console.error('Usage: foreflow-engine dump-data <output-dir>');
    process.exit(1);
  }
  const { dumpToJsonl } = await import('./storage/dump.js');
  await dumpToJsonl(outputDir);
}
