/**
 * ERC-8004 registration v1 metadata builder.
 *
 * Schema per SKILL.md and reference implementation:
 * https://github.com/foresight-arena/contracts/blob/main/SKILL.md
 * https://github.com/foresight-arena/contracts/blob/main/agents/random-benchmark/agent.mjs
 */

const ERC_8004_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';
const ERC_8004_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

// ---------------------------------------------------------------------------
// Per-configuration descriptions
// ---------------------------------------------------------------------------

const CONFIG_DESCRIPTIONS: Record<string, string> = {
  independent_ensemble:
    'AI forecasting agent using independent-ensemble coordination ' +
    '(3 parallel reasoners, mean probability). One of five reference ' +
    'configurations from arxiv.org/abs/2605.03310. Production deployment ' +
    'on Foresight Arena.',
  peer_critique_debate:
    'AI forecasting agent using peer-critique debate coordination ' +
    '(3 reasoners with structured cross-critique, integrated probability). ' +
    'One of five reference configurations from arxiv.org/abs/2605.03310. ' +
    'Production deployment on Foresight Arena.',
  orchestrator_specialist:
    'AI forecasting agent using orchestrator-specialist coordination ' +
    '(orchestrator dispatches to 3 specialists, integrates results). ' +
    'One of five reference configurations from arxiv.org/abs/2605.03310. ' +
    'Production deployment on Foresight Arena.',
  sequential_pipeline:
    'AI forecasting agent using sequential-pipeline coordination ' +
    '(research, then analysis, then estimation, 3 stages). One of five ' +
    'reference configurations from arxiv.org/abs/2605.03310. Production ' +
    'deployment on Foresight Arena.',
  consensus_alignment:
    'AI forecasting agent using consensus-alignment coordination ' +
    '(3 reasoners iteratively converge, ε=0.05 tolerance). One of five ' +
    'reference configurations from arxiv.org/abs/2605.03310. Production ' +
    'deployment on Foresight Arena.',
};

const CONFIG_FROM_AGENT: Record<string, string> = {
  'foreflow-ensemble': 'independent_ensemble',
  'foreflow-debate': 'peer_critique_debate',
  'foreflow-orchestrator': 'orchestrator_specialist',
  'foreflow-pipeline': 'sequential_pipeline',
  'foreflow-consensus': 'consensus_alignment',
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface AgentMetadata {
  type: string;
  name: string;
  description: string;
  image: string;
  external_url: string;
  active: boolean;
  registrations: Array<{ agentRegistry: string }>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the on-chain agentURI for a ForeFlow agent.
 *
 * Returns a `data:application/json;base64,...` URL so the metadata is
 * self-contained and survives without a hosted server.
 *
 * @param agentName   Full agent name, e.g. 'foreflow-ensemble'
 * @param walletAddress  Agent wallet (checksummed or lowercase — stored lowercase in URI)
 * @param chainId     Polygon mainnet (137) by default
 */
export function buildAgentURI(
  agentName: string,
  walletAddress: string,
  chainId = 137,
): string {
  const configuration = CONFIG_FROM_AGENT[agentName];
  if (!configuration) throw new Error(`Unknown agent name: ${agentName}`);

  const addr = walletAddress.toLowerCase();
  const metadata: AgentMetadata = {
    type: ERC_8004_TYPE,
    name: agentName,
    description: CONFIG_DESCRIPTIONS[configuration],
    image: 'https://raw.githubusercontent.com/ForesightFlow/foreflow-agents/master/avatar.png',
    external_url: `https://foresightarena.xyz/agent/${addr}`,
    active: true,
    registrations: [{ agentRegistry: `eip155:${chainId}:${ERC_8004_REGISTRY}` }],
  };
  return 'data:application/json;base64,' + Buffer.from(JSON.stringify(metadata)).toString('base64');
}

/**
 * Decode an agentURI back to its metadata.
 * Returns null if the URI is not ERC-8004 registration v1 metadata.
 */
export function decodeAgentURI(uri: string): AgentMetadata | null {
  if (!uri.startsWith('data:application/json;base64,')) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(uri.slice('data:application/json;base64,'.length), 'base64').toString('utf8'),
    ) as AgentMetadata;
    if (parsed.type !== ERC_8004_TYPE) return null;
    return parsed;
  } catch {
    return null;
  }
}
