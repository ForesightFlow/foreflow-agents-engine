import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const engineRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');
const envPath = join(engineRoot, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DRY_RUN: boolean =
  process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');

export const RELAYER_URL: string =
  process.env.RELAYER_URL ?? 'https://api.foresightarena.xyz';

export const RPC_URL: string =
  process.env.RPC_URL ?? 'https://rpc-amoy.polygon.technology';

export const CHAIN_ID: number = parseInt(process.env.CHAIN_ID ?? '80002', 10);

export function getAgentsDir(): string {
  if (process.env.FOREFLOW_AGENTS_DIR) return process.env.FOREFLOW_AGENTS_DIR;
  const sibling = join(engineRoot, '..', 'foreflow-agents');
  if (existsSync(sibling)) return sibling;
  return '/opt/foreflow/foreflow-agents';
}

export type AgentName = 'ensemble' | 'debate' | 'orchestrator' | 'pipeline' | 'consensus';
export const AGENT_NAMES: ReadonlyArray<AgentName> = [
  'ensemble',
  'debate',
  'orchestrator',
  'pipeline',
  'consensus',
];

export function agentSlug(name: AgentName): string {
  return name.toUpperCase();
}

export function agentKeyVar(name: AgentName): string {
  return `FOREFLOW_${agentSlug(name)}_AGENT_KEY`;
}

export function getAgentKey(name: AgentName): string | undefined {
  return process.env[agentKeyVar(name)];
}

export function requireAgentKey(name: AgentName): string {
  const key = getAgentKey(name);
  if (!key) {
    throw new ConfigError(
      `${agentKeyVar(name)} is not set. ` +
        `Run \`foreflow-engine register-all\` to register agents, then add the key to .env.`,
    );
  }
  return key;
}
