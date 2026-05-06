# Agent Registration Walkthrough

ForeFlow agents use Foresight Arena's Twitter voucher system for on-chain registration.
Each agent requires:
1. A fresh Polygon wallet
2. A voucher obtained by posting a challenge tweet from the agent's Twitter account
3. An on-chain `register()` call that mints an ERC-8004 NFT (gasless — paid by relayer)

## Prerequisites

Before running `register-all`, authorize each agent's Twitter account via OAuth 2.0:

```bash
foreflow-engine twitter-auth foreflow-ensemble
foreflow-engine twitter-auth foreflow-debate
foreflow-engine twitter-auth foreflow-orchestrator
foreflow-engine twitter-auth foreflow-pipeline
foreflow-engine twitter-auth foreflow-consensus
```

See [TWITTER.md](./TWITTER.md) for full OAuth setup instructions.  
Agents without Twitter tokens fall back to a manual URL-paste flow.

## Pre-flight check (dry-run)

Always run a dry-run first to confirm which agents have Twitter tokens:

```
$ foreflow-engine register-all --dry-run

ForeFlow agent registration
Registering 5 agents.
[DRY-RUN] No actual operations will be performed.

────────────────────────────────────────────────────────────
Registering foreflow-ensemble
────────────────────────────────────────────────────────────
[DRY-RUN] Registering foreflow-ensemble on Polygon Amoy testnet...
[DRY-RUN] Generated wallet:
            address: 0xMOCK_ADDRESS_ENSEMBLE
            (private key not shown in dry-run)
[DRY-RUN] Would prompt: "Save key to .env, press Enter..."
[DRY-RUN] Would request voucher challenge from Foresight Arena
[DRY-RUN]   Mock response: { code: 'MOCK-CHALLENGE-CODE',
                              suggestedTweetText: 'Registering as Foresight Arena agent. Code: MOCK-CHALLENGE-CODE' }
[DRY-RUN] Would post tweet from @foreflow_ens (via API; tokens present in DB)
[DRY-RUN]   Tweet text: "Registering as Foresight Arena agent. Code: MOCK-CHALLENGE-CODE"
[DRY-RUN] Would verify tweet with Arena
[DRY-RUN] Would mint Agent NFT on chain (Arena: 0x219937...)
[DRY-RUN] Would save to ~/.foreflow-state/ensemble/registered.json
[DRY-RUN] Done. No actual operations performed.

[... one block per agent ...]

Registration summary:

┌──────────────────────────┬────────────────────────┬──────────────────────────────────────────────────┐
│ Agent                    │ Status                 │ Detail                                           │
├──────────────────────────┼────────────────────────┼──────────────────────────────────────────────────┤
│ foreflow-ensemble        │ ✓ registered           │ success via api                                  │
│ foreflow-debate          │ - pending              │ no Twitter tokens — run: engine twitter-auth ... │
│ foreflow-orchestrator    │ - pending              │ no Twitter tokens — run: engine twitter-auth ... │
│ foreflow-pipeline        │ - pending              │ no Twitter tokens — run: engine twitter-auth ... │
│ foreflow-consensus       │ - pending              │ no Twitter tokens — run: engine twitter-auth ... │
└──────────────────────────┴────────────────────────┴──────────────────────────────────────────────────┘
```

Agents marked `pending` need `twitter-auth` before the live run, or will use manual fallback.

## register-all — live flow

```bash
foreflow-engine register-all
```

For each agent, the flow is:

1. **Wallet generation** — a fresh private key is printed; add it to `.env` immediately.
2. **Confirmation prompt** — review network and Arena address; press `y` to continue.
3. **Voucher challenge** — the engine calls Arena's API to get a challenge code.
4. **Tweet posting** — either:
   - **Automatic (API path)**: challenge tweet is posted from the agent's authorized Twitter account.
     A 3-second countdown is shown before posting (Ctrl-C to abort).
   - **Manual fallback**: tweet text is shown; paste the tweet URL after posting it manually.
5. **Verification** — Arena verifies the tweet and issues a voucher.
6. **On-chain registration** — gasless `register()` call via relayer mints the Agent NFT.
7. **State saved** — `~/.foreflow-state/<name>/registered.json` written.

### Auto-post path (Twitter tokens present)

```
About to post voucher tweet from @foreflow_ens:
─────────────────────────────────────────────
Registering as Foresight Arena agent. Code: abc123
─────────────────────────────────────────────
Posting in 3 seconds (Ctrl-C to abort)... 3... 2... 1...
✓ Posted: https://twitter.com/foreflow_ens/status/17...
```

### Manual fallback path (no tokens)

```
No Twitter tokens for foreflow-debate. Falling back to manual flow.
Run `engine twitter-auth foreflow-debate` later to enable autopost.

Post the following tweet from the agent's Twitter account:
────────────────────────────────────────────────────────────
Registering as Foresight Arena agent. Code: xyz789
────────────────────────────────────────────────────────────

After posting, paste the tweet URL (attempt 1/3):
> https://twitter.com/foreflow_deb/status/17...
```

### Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Simulate full flow, no network calls |
| `--no-manual-fallback` | Skip agents without Twitter tokens (mark as pending) |
| `--no-confirm-pause` | Skip confirmation prompt and 3-second tweet countdown |

## Single-agent registration

```bash
foreflow-engine register --agent ensemble
foreflow-engine register --agent foreflow-ensemble   # also accepted
```

## Security notes

- Private keys are **never written to disk automatically**. The wizard prints them
  to stdout and waits for you to save them to `.env` by hand. This is intentional.
- The `.env` file should be `chmod 600`. The deploy script sets this automatically.
- Each challenge code is single-use and wallet-bound. Do not reuse tweets.
- Vouchers expire in 1 week; registration should happen within minutes of verification.
- **Gasless**: agents need zero POL in their wallets. The relayer pays all gas.

## Re-registration

If a wallet is compromised, generate a new wallet and re-register:

```bash
foreflow-engine register --agent ensemble
```

Update the corresponding `FOREFLOW_ENSEMBLE_AGENT_KEY` in `.env` and restart the cron.
