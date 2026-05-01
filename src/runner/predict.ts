import { spawnAgent } from './spawn.js';
import type { AgentName } from '../lib/env.js';

export async function runPredict(name: AgentName, live: boolean): Promise<void> {
  await spawnAgent(name, 'predict', live);
}
