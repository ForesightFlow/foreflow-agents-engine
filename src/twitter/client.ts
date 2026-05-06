import { TwitterApi } from 'twitter-api-v2';
import type Database from 'better-sqlite3';
import { openDb } from '../storage/sqlite.js';
import { getTwitterTokens, saveTwitterTokens } from '../storage/twitter.js';

export class MissingAuthError extends Error {
  constructor(agentName: string) {
    super(
      `No Twitter tokens for "${agentName}". ` +
        `Run: foreflow-engine twitter-auth ${agentName}`,
    );
    this.name = 'MissingAuthError';
  }
}

// Token is considered stale if it expires within this window
const REFRESH_BUFFER_SECONDS = 60;

function makeAuthClient(): TwitterApi {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET must be set in .env',
    );
  }
  return new TwitterApi({ clientId, clientSecret });
}

// Injectable for tests — replace with a mock that returns a fake TwitterApi instance
export let _authClientFactory: () => TwitterApi = makeAuthClient;
export function _setAuthClientFactory(f: () => TwitterApi): void {
  _authClientFactory = f;
}

export async function getTwitterClient(
  agentName: string,
  db?: Database.Database,
): Promise<TwitterApi> {
  const database = db ?? openDb();
  const tokens = getTwitterTokens(database, agentName);
  if (!tokens) throw new MissingAuthError(agentName);

  const nowSec = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt > nowSec + REFRESH_BUFFER_SECONDS) {
    return new TwitterApi(tokens.accessToken);
  }

  // Token is expired or about to expire — refresh it
  const authClient = _authClientFactory();
  const refreshed = await authClient.refreshOAuth2Token(tokens.refreshToken);

  const newTokens = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    expiresAt: nowSec + refreshed.expiresIn,
    scopes: tokens.scopes,
    authorizedAt: tokens.authorizedAt,
  };
  saveTwitterTokens(database, agentName, newTokens);

  return new TwitterApi(refreshed.accessToken);
}
