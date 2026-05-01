# Agent Registration Walkthrough

ForeFlow agents use Foresight Arena's Twitter voucher system for on-chain registration.
Each agent requires:
1. A fresh Polygon wallet
2. A voucher obtained by posting a challenge tweet from the @foreflow account
3. An on-chain `register()` call that mints an ERC-8004 NFT

## register-all — full flow

```
$ foreflow-engine register-all

ForeFlow agent registration
Registering 5 agents. Each requires a separate tweet.

────────────────────────────────────────────────────────────
Registering foreflow-ensemble
────────────────────────────────────────────────────────────

Generated wallet for foreflow-ensemble:
  Address    : 0xABCDEF...
  Private key: 0x123456...

Add this line to your .env file:
  FOREFLOW_ENSEMBLE_AGENT_KEY=0x123456...

⚠  Save this key now — it will not be shown again.

Press Enter when saved, or Ctrl+C to abort:

Post the following tweet from the shared @foreflow account:
────────────────────────────────────────────────────────────
Registering ForeFlow agent foreflow-ensemble at 0xABCDEF...
#ForesightArena #foreflow challenge:abc123
────────────────────────────────────────────────────────────

After posting, paste the tweet URL and press Enter:
> https://twitter.com/foreflow/status/17...

Verifying tweet...
Registering on-chain...

✓ foreflow-ensemble registered successfully.
  Agent ID : agent-7
  Tx hash  : 0xdeadbeef...

[...repeat for debate, orchestrator, pipeline, consensus...]
```

## Single-agent registration

```bash
foreflow-engine register --agent debate
```

## Security notes

- Private keys are **never written to disk automatically**. The wizard prints them
  to stdout and waits for you to save them to `.env` by hand. This is intentional.
- The `.env` file should be `chmod 600`. The deploy script sets this automatically.
- Each tweet is single-use. A challenge code embedded in the tweet binds the voucher
  to a specific wallet. Do not reuse tweets.
- Vouchers expire in 1 week; registration should happen within minutes of verification.

## Re-registration

If a wallet is compromised, generate a new wallet and re-register:

```bash
foreflow-engine register --agent ensemble
```

Update the corresponding `FOREFLOW_ENSEMBLE_AGENT_KEY` in `.env` and restart the cron.
