import type Database from 'better-sqlite3';
import type { AgentEvent } from './types.js';
import {
  savePrediction,
  saveTrace,
  updatePredictionComplete,
  updatePredictionFailed,
} from '../storage/predictions.js';

export class EventHandler {
  private readonly db: Database.Database;
  private readonly agentName: string;
  private readonly network: 'amoy' | 'mainnet';
  // Cache: "roundId:marketId" → prediction row id
  private readonly predIdCache = new Map<string, number>();

  constructor(db: Database.Database, agentName: string, network: 'amoy' | 'mainnet') {
    this.db = db;
    this.agentName = agentName;
    this.network = network;
  }

  private cacheKey(roundId: string, marketId: string): string {
    return `${roundId}:${marketId}`;
  }

  private lookupPredId(roundId: string, marketId: string): number | undefined {
    const key = this.cacheKey(roundId, marketId);
    const cached = this.predIdCache.get(key);
    if (cached !== undefined) return cached;

    const row = this.db
      .prepare('SELECT id FROM predictions WHERE agent_name = ? AND round_id = ? AND market_id = ?')
      .get(this.agentName, roundId, marketId) as { id: number } | undefined;

    if (row) {
      this.predIdCache.set(key, row.id);
      return row.id;
    }
    return undefined;
  }

  dispatch(event: AgentEvent): void {
    switch (event.kind) {
      case 'prediction_started': {
        const saved = savePrediction(this.db, {
          agentName: this.agentName,
          configuration: event.configuration,
          roundId: event.roundId,
          marketId: event.marketId,
          network: this.network,
          marketQuestion: event.marketQuestion,
          marketCategory: event.marketCategory,
          marketBaseline: event.marketBaseline,
          probability: 0,
          predictedAt: event.timestamp,
          modelId: event.modelId,
          status: 'predicted',
        });
        if (saved.id !== undefined) {
          this.predIdCache.set(this.cacheKey(event.roundId, event.marketId), saved.id);
        }
        break;
      }

      case 'llm_call': {
        const predId = this.lookupPredId(
          event.predictionRef.roundId,
          event.predictionRef.marketId,
        );
        if (predId === undefined) {
          process.stderr.write(
            `[engine] llm_call: no prediction for ${event.predictionRef.roundId}:${event.predictionRef.marketId}\n`,
          );
          break;
        }
        saveTrace(this.db, {
          predictionId: predId,
          callIndex: event.callIndex,
          agentRole: event.agentRole,
          systemPrompt: event.systemPrompt,
          userPrompt: event.userPrompt,
          responseText: event.responseText,
          toolCallsJson: event.toolCalls ? JSON.stringify(event.toolCalls) : undefined,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          costUsd: event.costUsd,
          durationMs: event.durationMs,
          createdAt: event.timestamp,
        });
        break;
      }

      case 'prediction_complete': {
        const predId = this.lookupPredId(
          event.predictionRef.roundId,
          event.predictionRef.marketId,
        );
        if (predId === undefined) {
          process.stderr.write(
            `[engine] prediction_complete: no prediction for ${event.predictionRef.roundId}:${event.predictionRef.marketId}\n`,
          );
          break;
        }
        updatePredictionComplete(this.db, predId, {
          probability: event.probability,
          totalInputTokens: event.totalInputTokens,
          totalOutputTokens: event.totalOutputTokens,
          totalCostUsd: event.totalCostUsd,
        });
        break;
      }

      case 'prediction_failed': {
        const predId = this.lookupPredId(
          event.predictionRef.roundId,
          event.predictionRef.marketId,
        );
        if (predId === undefined) {
          process.stderr.write(
            `[engine] prediction_failed: no prediction for ${event.predictionRef.roundId}:${event.predictionRef.marketId}\n`,
          );
          break;
        }
        updatePredictionFailed(this.db, predId, event.reason);
        break;
      }
    }
  }
}
