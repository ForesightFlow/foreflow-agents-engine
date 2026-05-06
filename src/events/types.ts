export type AgentEvent =
  | {
      kind: 'prediction_started';
      timestamp: number;
      agentName: string;
      configuration: string;
      roundId: string;
      marketId: string;
      marketQuestion: string;
      marketCategory?: string;
      marketBaseline?: number;
      modelId: string;
    }
  | {
      kind: 'llm_call';
      timestamp: number;
      predictionRef: { roundId: string; marketId: string };
      callIndex: number;
      agentRole: string;
      systemPrompt: string;
      userPrompt: string;
      responseText: string;
      toolCalls?: unknown[];
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      durationMs?: number;
    }
  | {
      kind: 'prediction_complete';
      timestamp: number;
      predictionRef: { roundId: string; marketId: string };
      probability: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCostUsd: number;
    }
  | {
      kind: 'prediction_failed';
      timestamp: number;
      predictionRef: { roundId: string; marketId: string };
      reason: string;
    };

const KNOWN_KINDS = new Set<string>([
  'prediction_started',
  'llm_call',
  'prediction_complete',
  'prediction_failed',
]);

export function parseAgentEvent(line: string): AgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const kind = (obj as Record<string, unknown>).kind;
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind)) return null;
  return obj as AgentEvent;
}
