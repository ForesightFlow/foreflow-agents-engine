/**
 * ERC-8004 registration v1 metadata builder — minimal on-chain footprint.
 *
 * Only required fields: type, name, active, registrations[{agentId, agentAddress}].
 * Drops image, external_url, description, $schema to minimise calldata gas cost.
 */

// TODO: cleanup — CONFIG_DESCRIPTIONS, CONFIG_FROM_AGENT, ERC_8004_REGISTRY removed in this refactor.

const AGENT_TYPE = 'AgentRegistration';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface AgentMetadata {
  type: string;
  name: string;
  active: boolean;
  registrations: Array<{ agentId: number; agentAddress: string }>;
}

export interface AgentURIInput {
  name: string;
  agentId: number;
  walletAddress: string;
  chainId?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the on-chain agentURI for a ForeFlow agent.
 *
 * Returns a `data:application/json;base64,...` URI so the metadata is
 * self-contained. Wallet address is lowercased per CAIP-10 convention.
 */
export function buildAgentURI(input: AgentURIInput): string {
  const chainId = input.chainId ?? 137;
  const metadata: AgentMetadata = {
    type: AGENT_TYPE,
    name: input.name,
    active: true,
    registrations: [
      {
        agentId: input.agentId,
        agentAddress: `eip155:${chainId}:${input.walletAddress.toLowerCase()}`,
      },
    ],
  };
  const json = JSON.stringify(metadata);
  return 'data:application/json;base64,' + Buffer.from(json, 'utf-8').toString('base64');
}

/**
 * Decode an agentURI back to its metadata.
 * Returns null if the URI is not a valid AgentRegistration data URI.
 */
export function decodeAgentURI(uri: string): AgentMetadata | null {
  if (!uri.startsWith('data:application/json;base64,')) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(uri.slice('data:application/json;base64,'.length), 'base64').toString('utf8'),
    ) as AgentMetadata;
    if (parsed.type !== AGENT_TYPE) return null;
    return parsed;
  } catch {
    return null;
  }
}
