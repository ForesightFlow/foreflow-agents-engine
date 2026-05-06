import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
import { getAgentsDir, CHAIN_ID } from '../lib/env.js';
import { openDb } from '../storage/sqlite.js';
import { EventHandler } from '../events/handler.js';
import { parseAgentEvent } from '../events/types.js';
import type { AgentName } from '../lib/env.js';

export type AgentMode = 'discover' | 'predict' | 'all';

export async function spawnAgent(name: AgentName, mode: AgentMode, live: boolean): Promise<void> {
  const agentsDir = getAgentsDir();
  const entryPoint = join(agentsDir, 'dist', 'agents', `foreflow-${name}`, 'agent.js');

  if (!existsSync(entryPoint)) {
    throw new Error(
      `Agent entry point not found: ${entryPoint}\n` +
        `Ensure foreflow-agents is built (npm run build inside ${agentsDir}).`,
    );
  }

  // Each agent gets its own working directory so the SDK's .foresight-arena/
  // state is isolated per agent.
  const cwd = join(os.homedir(), '.foreflow-state', name);
  mkdirSync(cwd, { recursive: true });

  const args = live ? ['--live'] : [];
  // Pipe stdout so we can parse JSONL events; inherit stderr so logs flow through.
  const child = spawn('node', [entryPoint, ...args], {
    cwd,
    env: { ...process.env, MODE: mode },
    stdio: ['inherit', 'pipe', 'inherit'],
  });

  const network = CHAIN_ID === 137 ? 'mainnet' : 'amoy';
  const db = openDb();
  const handler = new EventHandler(db, `foreflow-${name}`, network);

  const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const event = parseAgentEvent(line);
    if (event) {
      try {
        handler.dispatch(event);
      } catch (err) {
        process.stderr.write(`[engine] event dispatch error: ${err}\n`);
      }
    } else if (line.trim()) {
      // Pass non-event lines through as regular agent output
      process.stdout.write(line + '\n');
    }
  });

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => {
      rl.close();
      if (code === 0 || code === null) resolve();
      else reject(new Error(`foreflow-${name} (mode=${mode}) exited with code ${code}`));
    });
    child.on('error', (err) => { rl.close(); reject(err); });
  });
}
