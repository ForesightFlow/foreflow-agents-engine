import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

// Point state at a temp dir so tests don't touch ~/.foreflow-state
const TMP = join(os.tmpdir(), `foreflow-engine-state-test-${process.pid}`);
process.env.FOREFLOW_STATE_DIR = TMP;

const { agentStateDir, saveRegistration, loadRegistration, saveLastDiscover, loadLastDiscover } =
  await import('../src/lib/state.js');

test('agentStateDir creates directory', () => {
  const dir = agentStateDir('ensemble');
  assert.ok(existsSync(dir));
  assert.ok(dir.includes('ensemble'));
});

test('saveRegistration / loadRegistration round-trip', () => {
  const record = {
    agentId: 'agent-42',
    txHash: '0xabc',
    registeredAt: '2026-04-28T00:00:00.000Z',
    address: '0x1234',
  };
  saveRegistration('ensemble', record);
  const loaded = loadRegistration('ensemble');
  assert.deepEqual(loaded, record);
});

test('loadRegistration returns null for unknown agent', () => {
  assert.equal(loadRegistration('debate'), null);
});

test('saveLastDiscover / loadLastDiscover round-trip', () => {
  saveLastDiscover('ensemble');
  const d = loadLastDiscover('ensemble');
  assert.ok(d instanceof Date);
  assert.ok(!isNaN(d.getTime()));
});

test('loadLastDiscover returns null for fresh agent', () => {
  assert.equal(loadLastDiscover('pipeline'), null);
});

// Cleanup
test.after?.(() => {
  delete process.env.FOREFLOW_STATE_DIR;
  try { rmSync(TMP, { recursive: true }); } catch {}
});
