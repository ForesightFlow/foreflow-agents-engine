import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildAgentURI, decodeAgentURI } = await import('../src/register/metadata.js');

const MOCK_ADDRESS = '0xA1b38e04C3f334c2B0D5003C51e857DB86D224d3';
const MOCK_ADDRESS_LOWER = MOCK_ADDRESS.toLowerCase();

const AGENTS = [
  { name: 'foreflow-ensemble',     agentId: 506 },
  { name: 'foreflow-debate',       agentId: 507 },
  { name: 'foreflow-orchestrator', agentId: 508 },
  { name: 'foreflow-pipeline',     agentId: 509 },
  { name: 'foreflow-consensus',    agentId: 510 },
] as const;

// ---------------------------------------------------------------------------
// URI format
// ---------------------------------------------------------------------------

test('buildAgentURI: returns a data:application/json;base64 URI', () => {
  const uri = buildAgentURI({ name: 'foreflow-ensemble', agentId: 506, walletAddress: MOCK_ADDRESS });
  assert.ok(uri.startsWith('data:application/json;base64,'), `Got: ${uri.slice(0, 50)}`);
});

// ---------------------------------------------------------------------------
// ERC-8004 required fields
// ---------------------------------------------------------------------------

test('buildAgentURI: type field is AgentRegistration', () => {
  for (const { name, agentId } of AGENTS) {
    const meta = decodeAgentURI(buildAgentURI({ name, agentId, walletAddress: MOCK_ADDRESS }));
    assert.equal(meta?.type, 'AgentRegistration', `type mismatch for ${name}`);
  }
});

test('buildAgentURI: active is true', () => {
  const meta = decodeAgentURI(buildAgentURI({ name: 'foreflow-ensemble', agentId: 506, walletAddress: MOCK_ADDRESS }));
  assert.equal(meta?.active, true);
});

test('buildAgentURI: registrations[0].agentAddress uses eip155:137 and lowercase wallet', () => {
  const meta = decodeAgentURI(buildAgentURI({ name: 'foreflow-consensus', agentId: 510, walletAddress: MOCK_ADDRESS }));
  assert.ok(Array.isArray(meta?.registrations) && meta.registrations.length === 1);
  assert.equal(
    meta?.registrations[0].agentAddress,
    `eip155:137:${MOCK_ADDRESS_LOWER}`,
  );
});

test('buildAgentURI: registrations[0].agentId matches input', () => {
  for (const { name, agentId } of AGENTS) {
    const meta = decodeAgentURI(buildAgentURI({ name, agentId, walletAddress: MOCK_ADDRESS }));
    assert.equal(meta?.registrations[0].agentId, agentId, `agentId mismatch for ${name}`);
  }
});

test('buildAgentURI: chainId param changes agentAddress eip155 prefix', () => {
  const meta = decodeAgentURI(buildAgentURI({ name: 'foreflow-ensemble', agentId: 506, walletAddress: MOCK_ADDRESS, chainId: 80002 }));
  assert.ok(meta?.registrations[0].agentAddress.startsWith('eip155:80002:'));
});

// ---------------------------------------------------------------------------
// name / address fields
// ---------------------------------------------------------------------------

test('buildAgentURI: name matches full agent name', () => {
  for (const { name, agentId } of AGENTS) {
    const meta = decodeAgentURI(buildAgentURI({ name, agentId, walletAddress: MOCK_ADDRESS }));
    assert.equal(meta?.name, name, `name mismatch for ${name}`);
  }
});

test('buildAgentURI: wallet address is lowercased in agentAddress', () => {
  const meta = decodeAgentURI(buildAgentURI({ name: 'foreflow-ensemble', agentId: 506, walletAddress: MOCK_ADDRESS }));
  assert.ok(meta?.registrations[0].agentAddress.includes(MOCK_ADDRESS_LOWER));
});

// ---------------------------------------------------------------------------
// Minimal schema — no extra fields
// ---------------------------------------------------------------------------

test('buildAgentURI: only minimal fields present (no image, external_url, description, $schema)', () => {
  const meta = decodeAgentURI(buildAgentURI({ name: 'foreflow-ensemble', agentId: 506, walletAddress: MOCK_ADDRESS })) as unknown as Record<string, unknown>;
  const allowed = new Set(['type', 'name', 'active', 'registrations']);
  for (const key of Object.keys(meta)) {
    assert.ok(allowed.has(key), `Unexpected field "${key}" in metadata`);
  }
});

test('buildAgentURI: URI length is under 350 bytes', () => {
  for (const { name, agentId } of AGENTS) {
    const uri = buildAgentURI({ name, agentId, walletAddress: MOCK_ADDRESS });
    assert.ok(uri.length < 350, `URI for ${name} is ${uri.length} bytes — exceeds 350`);
  }
});

// ---------------------------------------------------------------------------
// Distinct URIs / round-trip
// ---------------------------------------------------------------------------

test('buildAgentURI: each agent produces a distinct URI', () => {
  const uris = AGENTS.map(({ name, agentId }) => buildAgentURI({ name, agentId, walletAddress: MOCK_ADDRESS }));
  assert.equal(new Set(uris).size, 5, 'All 5 agents must produce distinct URIs');
});

test('decodeAgentURI: round-trips name, agentId, active', () => {
  const uri = buildAgentURI({ name: 'foreflow-orchestrator', agentId: 508, walletAddress: MOCK_ADDRESS });
  const meta = decodeAgentURI(uri);
  assert.equal(meta?.name, 'foreflow-orchestrator');
  assert.equal(meta?.registrations[0].agentId, 508);
  assert.equal(meta?.active, true);
  assert.ok(Array.isArray(meta?.registrations) && meta.registrations.length > 0);
});

test('decodeAgentURI: returns null for non-data URI', () => {
  assert.equal(decodeAgentURI('https://example.com/not-a-data-uri'), null);
});

test('decodeAgentURI: returns null for non-AgentRegistration data URI', () => {
  const wrongType = 'data:application/json;base64,' +
    Buffer.from(JSON.stringify({ type: 'erc721', name: 'test' })).toString('base64');
  assert.equal(decodeAgentURI(wrongType), null);
});
