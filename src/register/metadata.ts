import type { AgentName } from '../lib/env.js';

// ---------------------------------------------------------------------------
// Per-agent metadata
// ---------------------------------------------------------------------------

const CONFIG_NAMES: Record<AgentName, string> = {
  ensemble: 'independent_ensemble',
  debate: 'peer_critique_debate',
  orchestrator: 'orchestrator_specialist',
  pipeline: 'sequential_pipeline',
  consensus: 'consensus_alignment',
};

const DESCRIPTIONS: Record<AgentName, string> = {
  ensemble:
    'Independent Ensemble — 3 independent forecasters with median aggregation. ' +
    'Configuration: independent_ensemble (arxiv.org/abs/2605.03310).',
  debate:
    'Peer Critique Debate — agents iteratively critique each other\'s probability estimates. ' +
    'Configuration: peer_critique_debate (arxiv.org/abs/2605.03310).',
  orchestrator:
    'Orchestrator-Specialist — an orchestrator delegates to domain specialists. ' +
    'Configuration: orchestrator_specialist (arxiv.org/abs/2605.03310).',
  pipeline:
    'Sequential Pipeline — forecasters refine predictions in a linear chain. ' +
    'Configuration: sequential_pipeline (arxiv.org/abs/2605.03310).',
  consensus:
    'Consensus Alignment — agents iterate until probability estimates converge. ' +
    'Configuration: consensus_alignment (arxiv.org/abs/2605.03310).',
};

// ---------------------------------------------------------------------------
// ERC-8004 metadata builder
// ---------------------------------------------------------------------------

export interface AgentMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: Array<{ trait_type: string; value: string }>;
}

/**
 * Build an ERC-8004-compliant agentURI for the given agent and wallet address.
 * Returns a data:application/json;base64,... URL so the metadata is fully
 * self-contained and survives without a hosted server.
 *
 * The URI is passed to Arena's register() call and stored on-chain inside the
 * agent NFT. To update metadata for already-registered agents, call setAgentURI
 * on the Arena contract.
 */
export function buildAgentURI(name: AgentName, address: string): string {
  const fullName = `foreflow-${name}`;
  const metadata: AgentMetadata = {
    name: fullName,
    description: DESCRIPTIONS[name],
    image: `https://foresightarena.xyz/agents/${fullName}.png`,
    external_url: `https://foresightarena.xyz/agent/${address}`,
    attributes: [
      { trait_type: 'configuration', value: CONFIG_NAMES[name] },
      { trait_type: 'paper', value: 'arxiv.org/abs/2605.03310' },
    ],
  };
  const json = JSON.stringify(metadata);
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return `data:application/json;base64,${b64}`;
}

/** Decode a data URI produced by buildAgentURI (for testing / debugging). */
export function decodeAgentURI(uri: string): AgentMetadata {
  const prefix = 'data:application/json;base64,';
  if (!uri.startsWith(prefix)) {
    throw new Error(`Not a base64 data URI: ${uri.slice(0, 40)}`);
  }
  return JSON.parse(Buffer.from(uri.slice(prefix.length), 'base64').toString('utf8')) as AgentMetadata;
}
