import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { AgentName } from './env.js';

const STATE_ROOT = join(os.homedir(), '.foreflow-state');

export function agentStateDir(name: AgentName): string {
  const dir = join(STATE_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface RegistrationRecord {
  agentId: string;
  txHash?: string;
  registeredAt: string;
  address: string;
}

export function loadRegistration(name: AgentName): RegistrationRecord | null {
  const path = join(agentStateDir(name), 'registered.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RegistrationRecord;
  } catch {
    return null;
  }
}

export function saveRegistration(name: AgentName, record: RegistrationRecord): void {
  const path = join(agentStateDir(name), 'registered.json');
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', 'utf8');
}

export function loadLastDiscover(name: AgentName): Date | null {
  const path = join(agentStateDir(name), 'last-discover.txt');
  if (!existsSync(path)) return null;
  const ts = readFileSync(path, 'utf8').trim();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

export function saveLastDiscover(name: AgentName): void {
  const path = join(agentStateDir(name), 'last-discover.txt');
  writeFileSync(path, new Date().toISOString() + '\n', 'utf8');
}
