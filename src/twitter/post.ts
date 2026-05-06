import { TwitterApi } from 'twitter-api-v2';
import { openDb } from '../storage/sqlite.js';
import { logTweet } from '../storage/twitter.js';
import type { TweetRecord, TweetKind } from '../storage/twitter.js';
import { getTwitterClient } from './client.js';
import { FOREFLOW_AGENT_NAMES } from './agents.js';

export type { TweetKind };

export interface PostOptions {
  relatedRoundId?: string;
  dryRun?: boolean;
}

// Injectable for tests — replace with a function that returns a mock TwitterApi
export let _getClientForPost: (agentName: string) => Promise<TwitterApi> = getTwitterClient;
export function _setClientGetterForTest(
  f: (agentName: string) => Promise<TwitterApi>,
): void {
  _getClientForPost = f;
}

export async function postFromAgent(
  agentName: string,
  text: string,
  kind: TweetKind,
  options?: PostOptions,
): Promise<TweetRecord> {
  if (!(FOREFLOW_AGENT_NAMES as ReadonlyArray<string>).includes(agentName)) {
    throw new Error(
      `Unknown agent "${agentName}". Valid names: ${FOREFLOW_AGENT_NAMES.join(', ')}`,
    );
  }

  if (text.length > 280) {
    throw new RangeError(
      `Tweet text is ${text.length} characters (max 280).`,
    );
  }

  if (options?.dryRun) {
    const stub = `DRY-RUN-${Date.now()}`;
    console.log(`[DRY-RUN] Would post from ${agentName}: ${text}`);
    return {
      agentName,
      tweetId: stub,
      tweetText: text,
      tweetKind: kind,
      postedAt: Math.floor(Date.now() / 1000),
      relatedRoundId: options.relatedRoundId,
    };
  }

  const client = await _getClientForPost(agentName);
  const posted = await client.v2.tweet({ text });
  const tweetId = posted.data.id;

  const db = openDb();
  return logTweet(db, {
    agentName,
    tweetId,
    tweetText: text,
    tweetKind: kind,
    postedAt: Math.floor(Date.now() / 1000),
    relatedRoundId: options?.relatedRoundId,
  });
}
