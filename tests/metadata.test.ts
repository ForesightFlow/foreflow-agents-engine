import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildAgentURI, decodeAgentURI } = await import('../src/register/metadata.js');

const MOCK_ADDRESS = '0xA1b38e04C3f334c2B0D5003C51e857DB86D224d3';
const MOCK_ADDRESS_LOWER = MOCK_ADDRESS.toLowerCase();
const AGENTS = ['foreflow-ensemble', 'foreflow-debate', 'foreflow-orchestrator', 'foreflow-pipeline', 'foreflow-consensus'] as const;

// ---------------------------------------------------------------------------
// URI format
// ---------------------------------------------------------------------------

test('buildAgentURI: returns a data:application/json;base64 URI', () => {
  const uri = buildAgentURI('foreflow-ensemble', MOCK_ADDRESS);
  assert.ok(uri.startsWith('data:application/json;base64,'), `Got: ${uri.slice(0, 50)}`);
});

test('buildAgentURI: throws on unknown agent name', () => {
  assert.throws(() => buildAgentURI('foreflow-unknown', MOCK_ADDRESS), /Unknown agent name/);
});

// ---------------------------------------------------------------------------
// ERC-8004 required fields
// ---------------------------------------------------------------------------

test('buildAgentURI: type field is ERC-8004 registration v1 URL', () => {
  for (const name of AGENTS) {
    const meta = decodeAgentURI(buildAgentURI(name, MOCK_ADDRESS));
    assert.equal(
      meta?.type,
      'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      `type mismatch for ${name}`,
    );
  }
});

test('buildAgentURI: active is true', () => {
  const meta = decodeAgentURI(buildAgentURI('foreflow-ensemble', MOCK_ADDRESS));
  assert.equal(meta?.active, true);
});

test('buildAgentURI: registrations[0].agentRegistry matches eip155:137 mainnet', () => {
  const meta = decodeAgentURI(buildAgentURI('foreflow-consensus', MOCK_ADDRESS));
  assert.ok(Array.isArray(meta?.registrations) && meta.registrations.length === 1);
  assert.equal(
    meta?.registrations[0].agentRegistry,
    'eip155:137:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  );
});

test('buildAgentURI: chainId param changes registrations eip155 prefix', () => {
  const meta = decodeAgentURI(buildAgentURI('foreflow-ensemble', MOCK_ADDRESS, 80002));
  assert.ok(meta?.registrations[0].agentRegistry.startsWith('eip155:80002:'));
});

// ---------------------------------------------------------------------------
// name / address fields
// ---------------------------------------------------------------------------

test('buildAgentURI: name matches full agent name', () => {
  for (const name of AGENTS) {
    const meta = decodeAgentURI(buildAgentURI(name, MOCK_ADDRESS));
    assert.equal(meta?.name, name, `name mismatch for ${name}`);
  }
});

test('buildAgentURI: external_url address is lowercase', () => {
  const meta = decodeAgentURI(buildAgentURI('foreflow-ensemble', MOCK_ADDRESS));
  assert.ok(meta?.external_url.includes(MOCK_ADDRESS_LOWER), `external_url must use lowercase address`);
});

test('buildAgentURI: image URL is shared static avatar', () => {
  const meta = decodeAgentURI(buildAgentURI('foreflow-debate', MOCK_ADDRESS));
  assert.equal(
    meta?.image,
    'https://raw.githubusercontent.com/ForesightFlow/foreflow-agents/master/avatar.png',
  );
});

test('buildAgentURI: external_url points to agent leaderboard page', () => {
  const meta = decodeAgentURI(buildAgentURI('foreflow-pipeline', MOCK_ADDRESS));
  assert.equal(
    meta?.external_url,
    `https://foresightarena.xyz/agent/${MOCK_ADDRESS_LOWER}`,
  );
});

// ---------------------------------------------------------------------------
// No non-spec fields
// ---------------------------------------------------------------------------

test('buildAgentURI: no attributes field (not in ERC-8004 spec)', () => {
  const meta = decodeAgentURI(buildAgentURI('foreflow-ensemble', MOCK_ADDRESS)) as unknown as Record<string, unknown>;
  assert.ok(!('attributes' in meta), 'attributes field must not be present');
});

test('buildAgentURI: only spec fields present', () => {
  const meta = decodeAgentURI(buildAgentURI('foreflow-ensemble', MOCK_ADDRESS)) as unknown as Record<string, unknown>;
  const allowed = new Set(['type', 'name', 'description', 'image', 'external_url', 'active', 'registrations']);
  for (const key of Object.keys(meta)) {
    assert.ok(allowed.has(key), `Unexpected field "${key}" in metadata`);
  }
});

// ---------------------------------------------------------------------------
// Description content
// ---------------------------------------------------------------------------

test('buildAgentURI: description cites arxiv paper for all agents', () => {
  for (const agentName of AGENTS) {
    const meta = decodeAgentURI(buildAgentURI(agentName, MOCK_ADDRESS));
    assert.ok(
      meta?.description.includes('2605.03310'),
      `description for ${agentName} must cite the paper`,
    );
  }
});

test('buildAgentURI: each agent description is distinct', () => {
  const descs = AGENTS.map((n) => decodeAgentURI(buildAgentURI(n, MOCK_ADDRESS))?.description);
  assert.equal(new Set(descs).size, 5, 'All 5 agents must have distinct descriptions');
});

// ---------------------------------------------------------------------------
// Distinct URIs / round-trip
// ---------------------------------------------------------------------------

test('buildAgentURI: each agent produces a distinct URI', () => {
  const uris = AGENTS.map((n) => buildAgentURI(n, MOCK_ADDRESS));
  assert.equal(new Set(uris).size, 5, 'All 5 agents must produce distinct URIs');
});

test('decodeAgentURI: round-trips name and description', () => {
  const uri = buildAgentURI('foreflow-orchestrator', MOCK_ADDRESS);
  const meta = decodeAgentURI(uri);
  assert.equal(meta?.name, 'foreflow-orchestrator');
  assert.ok((meta?.description.length ?? 0) > 0);
  assert.ok((meta?.image.length ?? 0) > 0);
  assert.ok((meta?.external_url.length ?? 0) > 0);
  assert.equal(meta?.active, true);
  assert.ok(Array.isArray(meta?.registrations) && meta.registrations.length > 0);
});

test('decodeAgentURI: returns null for non-data URI', () => {
  assert.equal(decodeAgentURI('https://example.com/not-a-data-uri'), null);
});

test('decodeAgentURI: returns null for non-ERC-8004 data URI', () => {
  const wrongType = 'data:application/json;base64,' +
    Buffer.from(JSON.stringify({ type: 'erc721', name: 'test' })).toString('base64');
  assert.equal(decodeAgentURI(wrongType), null);
});
