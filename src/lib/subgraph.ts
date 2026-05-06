export const SUBGRAPH_STUDIO_URL =
  'https://api.studio.thegraph.com/query/1745354/foresight-arena/version/latest';

const GATEWAY_BASE = 'https://gateway.thegraph.com/api';

/**
 * Returns the subgraph URL to use for all queries.
 * Priority:
 *   1. SUBGRAPH_URL set explicitly in env → use as-is
 *   2. THEGRAPH_API_KEY + SUBGRAPH_ID both set → authenticated gateway URL
 *   3. THEGRAPH_API_KEY set but SUBGRAPH_ID missing → warn, use public studio URL
 *   4. Nothing set → public studio URL (rate-limited)
 */
export function getSubgraphUrl(): string {
  if (process.env.SUBGRAPH_URL) return process.env.SUBGRAPH_URL;

  const apiKey = process.env.THEGRAPH_API_KEY;
  const subgraphId = process.env.SUBGRAPH_ID;

  if (apiKey && subgraphId) {
    return `${GATEWAY_BASE}/${apiKey}/subgraphs/id/${subgraphId}`;
  }

  if (apiKey && !subgraphId) {
    process.stderr.write(
      '[engine] THEGRAPH_API_KEY is set but SUBGRAPH_ID is missing — ' +
        'using public studio URL (rate-limited). ' +
        'Set SUBGRAPH_ID=4ybnvA1cDQjRRm1YzhBhaeVAn7XrQFGP9GL44RvwPvx8 to enable the gateway.\n',
    );
  }

  return SUBGRAPH_STUDIO_URL;
}
