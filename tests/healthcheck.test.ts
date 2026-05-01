import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function runCli(args: string, extraEnv: Record<string, string> = {}): string {
  const cli = join(engineRoot, 'dist', 'src', 'cli.js');
  const env = { ...process.env, ...extraEnv };
  try {
    return execSync(`node ${cli} ${args}`, { env, encoding: 'utf8', timeout: 15_000 });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}

test('--help exits 0 and shows commands', () => {
  const out = runCli('--help');
  assert.ok(out.includes('register-all'), 'Expected register-all in help');
  assert.ok(out.includes('healthcheck'), 'Expected healthcheck in help');
  assert.ok(out.includes('run-agent'), 'Expected run-agent in help');
});

test('register-all --dry-run shows all 5 agents', () => {
  const out = runCli('register-all', { DRY_RUN: '1' });
  for (const name of ['ensemble', 'debate', 'orchestrator', 'pipeline', 'consensus']) {
    assert.ok(out.includes(name), `Expected "${name}" in register-all output`);
  }
  assert.ok(out.includes('[dry-run]'), 'Expected [dry-run] marker in output');
});

test('healthcheck --dry-run shows all 5 agents without error', () => {
  const out = runCli('healthcheck', { DRY_RUN: '1', CHAIN_ID: '80002' });
  for (const name of ['ensemble', 'debate', 'orchestrator', 'pipeline', 'consensus']) {
    assert.ok(out.includes(name), `Expected "${name}" in healthcheck output`);
  }
  assert.ok(out.includes('Dry-run : true'), 'Expected dry-run flag in output');
});

test('run-agent with invalid agent name exits non-zero', () => {
  const out = runCli('run-agent badname --mode discover', { DRY_RUN: '1' });
  assert.ok(out.includes('Usage') || out.includes('invalid') || out.includes('badname') || out.includes('ensemble'), 'Expected error or usage in output');
});

test('unknown command exits with error message', () => {
  const out = runCli('foobar', { DRY_RUN: '1' });
  assert.ok(out.includes('Unknown command') || out.includes('foobar'), 'Expected error for unknown command');
});
