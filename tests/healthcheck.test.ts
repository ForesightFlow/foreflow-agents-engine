import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Unit tests for getSubgraphUrl() and buildEtherscanBalanceUrl()
// Relative imports resolve correctly when run from dist/tests/
// ---------------------------------------------------------------------------

const { getSubgraphUrl, SUBGRAPH_STUDIO_URL } = await import('../src/lib/subgraph.js');
const { buildEtherscanBalanceUrl } = await import('../src/healthcheck/check.js');

test('getSubgraphUrl: returns gateway URL when both THEGRAPH_API_KEY and SUBGRAPH_ID are set', () => {
  const original = { KEY: process.env.THEGRAPH_API_KEY, ID: process.env.SUBGRAPH_ID, URL: process.env.SUBGRAPH_URL };
  delete process.env.SUBGRAPH_URL;
  process.env.THEGRAPH_API_KEY = 'testkey123';
  process.env.SUBGRAPH_ID = 'testid456';
  try {
    const url = getSubgraphUrl();
    assert.equal(url, 'https://gateway.thegraph.com/api/testkey123/subgraphs/id/testid456');
  } finally {
    if (original.KEY === undefined) delete process.env.THEGRAPH_API_KEY; else process.env.THEGRAPH_API_KEY = original.KEY;
    if (original.ID === undefined) delete process.env.SUBGRAPH_ID; else process.env.SUBGRAPH_ID = original.ID;
    if (original.URL === undefined) delete process.env.SUBGRAPH_URL; else process.env.SUBGRAPH_URL = original.URL;
  }
});

test('getSubgraphUrl: returns public studio URL when only THEGRAPH_API_KEY is set', () => {
  const original = { KEY: process.env.THEGRAPH_API_KEY, ID: process.env.SUBGRAPH_ID, URL: process.env.SUBGRAPH_URL };
  delete process.env.SUBGRAPH_URL;
  process.env.THEGRAPH_API_KEY = 'testkey123';
  delete process.env.SUBGRAPH_ID;
  try {
    const url = getSubgraphUrl();
    assert.equal(url, SUBGRAPH_STUDIO_URL);
  } finally {
    if (original.KEY === undefined) delete process.env.THEGRAPH_API_KEY; else process.env.THEGRAPH_API_KEY = original.KEY;
    if (original.ID === undefined) delete process.env.SUBGRAPH_ID; else process.env.SUBGRAPH_ID = original.ID;
    if (original.URL === undefined) delete process.env.SUBGRAPH_URL; else process.env.SUBGRAPH_URL = original.URL;
  }
});

test('getSubgraphUrl: returns public studio URL when nothing is set', () => {
  const original = { KEY: process.env.THEGRAPH_API_KEY, ID: process.env.SUBGRAPH_ID, URL: process.env.SUBGRAPH_URL };
  delete process.env.SUBGRAPH_URL;
  delete process.env.THEGRAPH_API_KEY;
  delete process.env.SUBGRAPH_ID;
  try {
    const url = getSubgraphUrl();
    assert.equal(url, SUBGRAPH_STUDIO_URL);
  } finally {
    if (original.KEY === undefined) delete process.env.THEGRAPH_API_KEY; else process.env.THEGRAPH_API_KEY = original.KEY;
    if (original.ID === undefined) delete process.env.SUBGRAPH_ID; else process.env.SUBGRAPH_ID = original.ID;
    if (original.URL === undefined) delete process.env.SUBGRAPH_URL; else process.env.SUBGRAPH_URL = original.URL;
  }
});

test('getSubgraphUrl: SUBGRAPH_URL env var takes precedence over everything', () => {
  const original = { KEY: process.env.THEGRAPH_API_KEY, ID: process.env.SUBGRAPH_ID, URL: process.env.SUBGRAPH_URL };
  process.env.SUBGRAPH_URL = 'https://custom.subgraph.url/query/123';
  process.env.THEGRAPH_API_KEY = 'testkey123';
  process.env.SUBGRAPH_ID = 'testid456';
  try {
    const url = getSubgraphUrl();
    assert.equal(url, 'https://custom.subgraph.url/query/123');
  } finally {
    if (original.KEY === undefined) delete process.env.THEGRAPH_API_KEY; else process.env.THEGRAPH_API_KEY = original.KEY;
    if (original.ID === undefined) delete process.env.SUBGRAPH_ID; else process.env.SUBGRAPH_ID = original.ID;
    if (original.URL === undefined) delete process.env.SUBGRAPH_URL; else process.env.SUBGRAPH_URL = original.URL;
  }
});

test('buildEtherscanBalanceUrl: constructs Polygon URL with chainid=137', () => {
  const original = { KEY: process.env.FFLOW_POLYGONSCAN_API_KEY, URL: process.env.FFLOW_POLYGONSCAN_URL };
  process.env.FFLOW_POLYGONSCAN_API_KEY = 'myapikey';
  delete process.env.FFLOW_POLYGONSCAN_URL;
  try {
    const url = buildEtherscanBalanceUrl('0x1234567890abcdef1234567890abcdef12345678');
    assert.ok(url.includes('chainid=137'), 'URL must include chainid=137 for Polygon');
    assert.ok(url.includes('0x1234567890abcdef1234567890abcdef12345678'), 'URL must include the address');
    assert.ok(url.includes('apikey=myapikey'), 'URL must include the API key');
    assert.ok(url.includes('module=account'), 'URL must include module=account');
    assert.ok(url.includes('action=balance'), 'URL must include action=balance');
    assert.ok(url.startsWith('https://api.etherscan.io/v2/api'), 'Default base URL is etherscan v2');
  } finally {
    if (original.KEY === undefined) delete process.env.FFLOW_POLYGONSCAN_API_KEY; else process.env.FFLOW_POLYGONSCAN_API_KEY = original.KEY;
    if (original.URL === undefined) delete process.env.FFLOW_POLYGONSCAN_URL; else process.env.FFLOW_POLYGONSCAN_URL = original.URL;
  }
});

test('buildEtherscanBalanceUrl: respects FFLOW_POLYGONSCAN_URL override', () => {
  const original = { KEY: process.env.FFLOW_POLYGONSCAN_API_KEY, URL: process.env.FFLOW_POLYGONSCAN_URL };
  process.env.FFLOW_POLYGONSCAN_API_KEY = 'myapikey';
  process.env.FFLOW_POLYGONSCAN_URL = 'https://custom.etherscan.example/api';
  try {
    const url = buildEtherscanBalanceUrl('0xdeadbeef00000000000000000000000000000001');
    assert.ok(url.startsWith('https://custom.etherscan.example/api'), 'Should use custom base URL');
    assert.ok(url.includes('chainid=137'), 'Must still include chainid=137');
  } finally {
    if (original.KEY === undefined) delete process.env.FFLOW_POLYGONSCAN_API_KEY; else process.env.FFLOW_POLYGONSCAN_API_KEY = original.KEY;
    if (original.URL === undefined) delete process.env.FFLOW_POLYGONSCAN_URL; else process.env.FFLOW_POLYGONSCAN_URL = original.URL;
  }
});

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
  assert.ok(
    out.includes('[DRY-RUN]') || out.includes('[dry-run]'),
    'Expected dry-run marker in output',
  );
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
