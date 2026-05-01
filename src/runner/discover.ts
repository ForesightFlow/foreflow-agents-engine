import { spawnAgent } from './spawn.js';
import { saveLastDiscover } from '../lib/state.js';
import type { AgentName } from '../lib/env.js';

export async function runDiscover(name: AgentName, live: boolean): Promise<void> {
  await spawnAgent(name, 'discover', live);
  if (live) saveLastDiscover(name);
}
