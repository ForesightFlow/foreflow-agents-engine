import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { getAgentsDir } from '../lib/env.js';
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
  const child = spawn('node', [entryPoint, ...args], {
    cwd,
    env: { ...process.env, MODE: mode },
    stdio: 'inherit',
  });

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`foreflow-${name} (mode=${mode}) exited with code ${code}`));
    });
    child.on('error', reject);
  });
}
