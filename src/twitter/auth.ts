import { createServer } from 'node:http';
import { TwitterApi } from 'twitter-api-v2';
import { openDb } from '../storage/sqlite.js';
import { saveTwitterTokens } from '../storage/twitter.js';
import { FOREFLOW_AGENT_NAMES, TWITTER_HANDLES } from './agents.js';
import type { FullAgentName } from './agents.js';
import readline from 'node:readline';

const CALLBACK_PORT = 8765;
const CALLBACK_URL = process.env.TWITTER_OAUTH_CALLBACK_URL ?? `http://localhost:${CALLBACK_PORT}/callback`;
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

const REQUIRED_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] as const;

function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export async function runOAuthFlow(agentName: string): Promise<void> {
  if (!(FOREFLOW_AGENT_NAMES as ReadonlyArray<string>).includes(agentName)) {
    throw new Error(
      `Unknown agent "${agentName}". Valid names: ${FOREFLOW_AGENT_NAMES.join(', ')}`,
    );
  }

  const fullName = agentName as FullAgentName;
  const handle = TWITTER_HANDLES[fullName];

  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET must be set in .env');
  }

  const authClient = new TwitterApi({ clientId, clientSecret });
  const { url, codeVerifier, state } = authClient.generateOAuth2AuthLink(CALLBACK_URL, {
    scope: [...REQUIRED_SCOPES],
  });

  console.log(`\nTo authorize ${fullName} (@${handle}), open this URL in your browser,`);
  console.log(`log in as @${handle} (NOT your personal account), and approve the app:\n`);
  console.log(url);
  console.log(`\nListening for callback on ${CALLBACK_URL}...\n`);

  let callbackCode: string | null = null;
  let callbackState: string | null = null;

  await new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      callbackCode = reqUrl.searchParams.get('code');
      callbackState = reqUrl.searchParams.get('state');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h2>Authorization complete — you can close this tab.</h2></body></html>',
      );
      server.close();
      resolve();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${CALLBACK_PORT} is in use. Free it and re-run.`));
      } else {
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, '127.0.0.1');

    const timer = setTimeout(() => {
      server.close();
      reject(
        new Error(
          'No callback received within 5 minutes. Re-run `foreflow-engine twitter-auth ' +
            fullName +
            '` to try again.',
        ),
      );
    }, OAUTH_TIMEOUT_MS);

    // Clear timer when server closes normally
    server.on('close', () => clearTimeout(timer));
  });

  if (!callbackCode || callbackState !== state) {
    throw new Error('OAuth callback did not return a valid code or state mismatch.');
  }

  const {
    client: loggedClient,
    accessToken,
    refreshToken,
    expiresIn,
  } = await authClient.loginWithOAuth2({
    code: callbackCode,
    codeVerifier,
    redirectUri: CALLBACK_URL,
  });

  // Verify that the authed account matches the expected handle
  const me = await loggedClient.v2.me();
  const actualHandle = me.data.username?.toLowerCase();
  const expectedHandle = handle.toLowerCase();

  if (actualHandle !== expectedHandle) {
    console.warn(
      `\n⚠  WARNING: Authorized as @${actualHandle}, but expected @${expectedHandle}.`,
    );
    console.warn('   You may have logged in as the wrong account.\n');
    const proceed = await promptYesNo('Continue anyway? [y/N] ');
    if (!proceed) {
      console.log('Aborting. Re-run and log in as the correct account.');
      return;
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const db = openDb();
  saveTwitterTokens(db, fullName, {
    accessToken,
    refreshToken: refreshToken ?? '',
    expiresAt: nowSec + expiresIn,
    scopes: [...REQUIRED_SCOPES],
    authorizedAt: nowSec,
  });

  const expiresDate = new Date((nowSec + expiresIn) * 1000).toISOString().split('T')[0];
  console.log(`\n✓ Authorized ${fullName} (@${actualHandle ?? handle})`);
  console.log(`  Scopes     : ${REQUIRED_SCOPES.join(', ')}`);
  console.log(`  Expires at : ${expiresDate}`);
  console.log('  Tokens saved to ~/.foreflow-state/foreflow.db\n');
}
