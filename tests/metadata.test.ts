import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildAgentURI, decodeAgentURI } = await import('../src/register/metadata.js');

const MOCK_ADDRESS = '0xA1b38e04C3f334c2B0D5003C51e857DB86D224d3';

test('buildAgentURI: returns a data:application/json;base64 URI', () => {
  const uri = buildAgentURI('ensemble', MOCK_ADDRESS);
  assert.ok(uri.startsWith('data:application/json;base64,'), `Got: ${uri.slice(0, 50)}`);
});

test('buildAgentURI: decoded name matches foreflow-<agent>', () => {
  for (const name of ['ensemble', 'debate', 'orchestrator', 'pipeline', 'consensus'] as const) {
    const uri = buildAgentURI(name, MOCK_ADDRESS);
    const meta = decodeAgentURI(uri);
    assert.equal(meta.name, `foreflow-${name}`, `name mismatch for ${name}`);
  }
});

test('buildAgentURI: external_url contains the wallet address', () => {
  const uri = buildAgentURI('ensemble', MOCK_ADDRESS);
  const meta = decodeAgentURI(uri);
  assert.ok(
    meta.external_url.includes(MOCK_ADDRESS),
    `external_url should include address, got: ${meta.external_url}`,
  );
});

test('buildAgentURI: image URL contains the agent name', () => {
  const uri = buildAgentURI('debate', MOCK_ADDRESS);
  const meta = decodeAgentURI(uri);
  assert.ok(
    meta.image.includes('foreflow-debate'),
    `image should include foreflow-debate, got: ${meta.image}`,
  );
  assert.ok(
    meta.image.startsWith('https://foresightarena.xyz'),
    `image should be on foresightarena.xyz CDN, got: ${meta.image}`,
  );
});

test('buildAgentURI: description includes configuration name and paper reference', () => {
  const configNames: Record<string, string> = {
    ensemble: 'independent_ensemble',
    debate: 'peer_critique_debate',
    orchestrator: 'orchestrator_specialist',
    pipeline: 'sequential_pipeline',
    consensus: 'consensus_alignment',
  };
  for (const [name, configName] of Object.entries(configNames)) {
    const uri = buildAgentURI(name as Parameters<typeof buildAgentURI>[0], MOCK_ADDRESS);
    const meta = decodeAgentURI(uri);
    assert.ok(
      meta.description.includes(configName),
      `description for ${name} should include config name "${configName}"`,
    );
    assert.ok(
      meta.description.includes('2605.03310'),
      `description for ${name} should include arxiv paper reference`,
    );
  }
});

test('buildAgentURI: attributes include configuration and paper traits', () => {
  const uri = buildAgentURI('consensus', MOCK_ADDRESS);
  const meta = decodeAgentURI(uri);
  const configAttr = meta.attributes.find((a) => a.trait_type === 'configuration');
  const paperAttr = meta.attributes.find((a) => a.trait_type === 'paper');
  assert.ok(configAttr, 'attributes must include configuration trait');
  assert.equal(configAttr?.value, 'consensus_alignment');
  assert.ok(paperAttr, 'attributes must include paper trait');
  assert.ok(paperAttr?.value.includes('2605.03310'));
});

test('buildAgentURI: each agent produces a distinct URI', () => {
  const uris = (['ensemble', 'debate', 'orchestrator', 'pipeline', 'consensus'] as const)
    .map((n) => buildAgentURI(n, MOCK_ADDRESS));
  const unique = new Set(uris);
  assert.equal(unique.size, 5, 'All 5 agents must produce distinct URIs');
});

test('decodeAgentURI: round-trips correctly', () => {
  const uri = buildAgentURI('pipeline', MOCK_ADDRESS);
  const meta = decodeAgentURI(uri);
  assert.equal(meta.name, 'foreflow-pipeline');
  assert.ok(meta.description.length > 0);
  assert.ok(meta.image.length > 0);
  assert.ok(meta.external_url.length > 0);
  assert.ok(Array.isArray(meta.attributes) && meta.attributes.length > 0);
});

test('decodeAgentURI: throws on non-data URI', () => {
  assert.throws(
    () => decodeAgentURI('https://example.com/not-a-data-uri'),
    /Not a base64 data URI/,
  );
});
