# Twitter integration

This document covers the end-to-end setup of Twitter accounts for the five ForeFlow
agents, how OAuth tokens are managed, and how to troubleshoot common problems.

## Overview

Each agent has its own Twitter account:

| Agent                  | Handle           |
|------------------------|------------------|
| foreflow-ensemble      | @foreflow_ens    |
| foreflow-debate        | @foreflow_deb    |
| foreflow-orchestrator  | @foreflow_orc    |
| foreflow-pipeline      | @foreflow_pip    |
| foreflow-consensus     | @foreflow_con    |

A single **Twitter Developer App** is registered at
[developer.twitter.com](https://developer.twitter.com). The engine holds the App
credentials (`TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`). Each agent account
authorizes the App once via OAuth 2.0 PKCE. After that, the engine can post on each
account's behalf without storing any account passwords.

---

## Step-by-step: Twitter Developer Portal setup

### 1. Create the Developer App

1. Go to [https://developer.twitter.com/en/portal/projects-and-apps](https://developer.twitter.com/en/portal/projects-and-apps).
2. Click **"+ Create App"** (or use an existing project's app).
3. Name the app (e.g., `foreflow-engine`).

### 2. Enable OAuth 2.0

1. From the app dashboard, click **"Settings"** → **"User authentication settings"** → **"Set up"**.
2. Set **App permissions** to **"Read and write"**.
3. Set **Type of App** to **"Web App, Automated App or Bot"**.
4. Under **"App info"** → **"Callback URI / Redirect URL"**, add exactly:
   ```
   http://localhost:8765/callback
   ```
5. Fill in a **Website URL** (any valid URL, e.g. `https://github.com/ForesightFlow`).
6. Click **"Save"**.

### 3. Copy credentials to `.env`

1. From the app dashboard, click **"Keys and tokens"**.
2. Under **"OAuth 2.0 Client ID and Client Secret"**, click **"Regenerate"** (or copy existing).
3. Add to your `.env` file:
   ```
   TWITTER_CLIENT_ID=<your-client-id>
   TWITTER_CLIENT_SECRET=<your-client-secret>
   ```

---

## Authorizing each agent account

Run the PKCE flow once per agent account. You must be logged into the **correct agent
account** in the browser — not your personal account.

```bash
engine twitter-auth foreflow-ensemble
```

The CLI will:
1. Print an authorization URL.
2. Start a local HTTP server on port 8765.
3. Wait (up to 5 minutes) for you to approve in the browser.
4. Exchange the authorization code for tokens.
5. Verify the authorized handle matches `@foreflow_ens`.
6. Save tokens to `~/.foreflow-state/foreflow.db`.

Repeat for each agent:

```bash
engine twitter-auth foreflow-debate
engine twitter-auth foreflow-orchestrator
engine twitter-auth foreflow-pipeline
engine twitter-auth foreflow-consensus
```

Check status at any time:

```bash
engine twitter-status
```

---

## Authorizing as the wrong account

If you accidentally authorized as your personal account instead of the agent account:

1. Log into the agent account on [twitter.com](https://twitter.com).
2. Go to **Settings** → **Security and account access** → **Apps and sessions** → **Connected apps**.
3. Find the Developer App and click **"Revoke access"**.
4. Re-run `engine twitter-auth <agent-name>`, this time logging in as the correct account.

---

## Inspecting token state

Use the `sqlite3` CLI to inspect the database directly:

```bash
sqlite3 ~/.foreflow-state/foreflow.db

# List all authorized agents
SELECT agent_name, datetime(expires_at, 'unixepoch') AS expires FROM twitter_tokens;

# List recent tweets
SELECT agent_name, tweet_kind, tweet_id, datetime(posted_at, 'unixepoch') AS posted
FROM tweets
ORDER BY posted_at DESC
LIMIT 20;

# Check migration history
SELECT name, datetime(applied_at, 'unixepoch') FROM _migrations;
```

---

## Token auto-refresh

Tokens expire after approximately 2 hours. The engine auto-refreshes them when they
are within **60 seconds of expiry**. The refresh uses the stored `refresh_token`
(requires the `offline.access` scope, which is requested during authorization).

If a refresh fails (e.g., the refresh token itself expired after 6 months), re-run
`engine twitter-auth <agent-name>` for that agent.

---

## Troubleshooting

### `Port 8765 is in use. Free it and re-run.`

Another process is already using port 8765. Find and stop it:

```bash
lsof -i :8765        # macOS / Linux
kill <PID>
```

The Twitter Developer Portal is configured for `http://localhost:8765/callback`
specifically — do not change the port.

### `No callback received within 5 minutes.`

The browser did not complete the OAuth flow in time. Re-run the command. Make sure to
click **"Authorize app"** before the 5-minute window expires.

### `TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET must be set in .env`

Copy `.env.example` to `.env` and fill in the Twitter credentials from the Developer
Portal.

### Warning: "Authorized as @wronghandle, but expected @foreflow_xxx"

You logged in as the wrong account. See "Authorizing as the wrong account" above.

### `MissingAuthError: No Twitter tokens for "foreflow-xxx"`

The agent has not been authorized yet. Run:

```bash
engine twitter-auth foreflow-xxx
```

### Rate limits

Twitter's v2 API allows 17 tweet writes per 15 minutes per user (Free tier). The
engine does not post in bulk, so rate limits should not be a concern under normal
operation. If you hit rate limits during testing, wait 15 minutes before retrying.

### Scope mismatch

If an existing token lacks a required scope (e.g., `offline.access` is missing),
re-authorize the agent to re-request all required scopes:

```bash
engine twitter-auth foreflow-ensemble
```

This upserts the tokens, replacing the old ones.
