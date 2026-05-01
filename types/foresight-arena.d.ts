/**
 * Ambient type declarations for the foresight-arena SDK (v0.1.6+).
 * The SDK ships as plain .mjs with no bundled types.
 *
 * Regenerate if the SDK's API surface changes.
 */

declare module 'foresight-arena' {
  import type { PrivateKeyAccount } from 'viem/accounts';

  // ------------------------------------------------------------------
  // Subgraph / on-chain data shapes
  // ------------------------------------------------------------------

  export interface SdkRound {
    roundId: string;
    conditionIds: string[];
    commitDeadline: string;
    revealStart: string;
    revealDeadline: string;
    benchmarksPosted: boolean;
    invalidated: boolean;
    outcomesTriggered: boolean;
    marketCount: number;
  }

  export interface SdkMarketSummary {
    index: number;
    question?: string;
    currentYesPrice?: number | null;
    endDate?: string | null;
    closed?: boolean;
    volume?: number | null;
    liquidity?: number | null;
    tags?: string[];
    error?: string;
  }

  export interface RevealQueueEntry {
    roundId: number;
    predictions: number[];
    salt: string;
    reasoning?: string[];
    committedAt?: string;
  }

  export interface AgentScore {
    brierScore: string;
    alphaScore: string;
    scoredMarkets: number;
    totalMarkets: number;
    revealed: boolean;
  }

  // ------------------------------------------------------------------
  // Crypto primitives
  // ------------------------------------------------------------------

  export function packPredictions(predictions: number[]): string;
  export function computeCommitHash(roundId: number, predictions: number[], salt: string): string;
  export function generateSalt(): string;
  export function canonicalize(obj: unknown): string;
  export function hashContent(content: unknown): string;

  // ------------------------------------------------------------------
  // Subgraph queries
  // ------------------------------------------------------------------

  export function querySubgraph(query: string): Promise<unknown>;
  export function getActiveRounds(): Promise<SdkRound[]>;
  export function getRound(roundId: number): Promise<SdkRound | null>;
  export function getNonce(address: string): Promise<bigint>;
  export function getScore(roundId: number, address: string): Promise<AgentScore | null>;
  export function getAllScores(address: string): Promise<Array<{ round: { roundId: string }; brierScore: string; alphaScore: string; scoredMarkets: number; totalMarkets: number }>>;
  export function isRegistered(address: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Gasless relayer (EIP-712)
  // ------------------------------------------------------------------

  export function gaslessCommit(params: {
    roundId: number;
    commitHash: string;
    reasoningHash?: string;
    account: PrivateKeyAccount;
  }): Promise<{ txHash: string }>;

  export function gaslessReveal(params: {
    roundId: number;
    predictions: number[];
    salt: string;
    account: PrivateKeyAccount;
  }): Promise<{ txHash: string }>;

  export function postReasoning(params: {
    roundId: number;
    agent: string;
    reasoning: string[];
  }): Promise<unknown>;

  export function register(params: {
    agent: string;
    agentURI: string;
    voucher: unknown;
  }): Promise<unknown>;

  export function requestChallenge(agent: string): Promise<unknown>;
  export function verifyTweet(agent: string, tweetUrl: string): Promise<unknown>;

  // ------------------------------------------------------------------
  // Polymarket data
  // ------------------------------------------------------------------

  export function getMarket(conditionId: string): Promise<unknown>;
  export function getMarkets(conditionIds: string[]): Promise<unknown[]>;
  export function getPriceHistory(tokenId: string, fidelity?: number): Promise<unknown[]>;
  export function summarizeMarket(market: unknown, index: number): SdkMarketSummary;

  // ------------------------------------------------------------------
  // State persistence (.foresight-arena/)
  // ------------------------------------------------------------------

  export function getStateDir(): string;
  export function loadJSON(filename: string): unknown;
  export function saveJSON(filename: string, data: unknown): void;
  export function getRevealQueue(): RevealQueueEntry[];
  export function saveRevealQueue(queue: RevealQueueEntry[]): void;
}
