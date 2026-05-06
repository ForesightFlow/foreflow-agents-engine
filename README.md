# foreflow-agents-engine

Operational infrastructure for running five ForeFlow agents on [Foresight Arena](https://foresightarena.xyz).

Part of the research system described in "Coordination as an Architectural Layer for
LLM-Based Multi-Agent Systems" (Nechepurenko & Shuvalov, 2026).

## Sibling repos

| Repo | Role |
|---|---|
| [coordination-experiment](https://github.com/ForesightFlow/coordination-experiment) | LLM harness + five coordination configurations |
| [foreflow-agents](https://github.com/ForesightFlow/foreflow-agents) | Five on-chain agent entry points |
| **foreflow-agents-engine** (this repo) | Registration, scheduling, healthcheck, deployment |

## What this repo does

- **`register-all`** — interactive Twitter voucher flow that generates wallets for all five
  agents and registers them on Foresight Arena.
- **`healthcheck`** — wallet balances, on-chain registration status, last successful run.
- **`run-agent`** — invoked by cron via `ops/run-agent.sh`; spawns the agent subprocess with
  the correct `MODE` and env.
- **`bootstrap-vps`** — guided one-shot setup from blank VPS.

## Quick start

```bash
npm install
npm run build
node dist/cli.js --help
```

Or after `npm link`:

```bash
foreflow-engine --help
```

## SDK dependency

On-chain interaction uses the [foresight-arena](https://www.npmjs.com/package/foresight-arena)
SDK (v0.1.6+). The SDK provides: `requestChallenge`, `verifyTweet`, `register`, `isRegistered`,
`getNonce`, `getAllScores` — everything needed for registration and healthchecks.

The agent runtime (`gaslessCommit`, `gaslessReveal`, `getActiveRounds`, etc.) is consumed by
**foreflow-agents**, not this repo.

## Commands

```
foreflow-engine register-all            Register all 5 agents via Twitter voucher flow
  --dry-run                               Simulate, no network calls
  --no-manual-fallback                    Skip agents without Twitter tokens
  --no-confirm-pause                      Skip confirmation + 3s tweet countdown
foreflow-engine register --agent <name> Register a single agent (same flags)
foreflow-engine healthcheck             Wallet balances + registration status
foreflow-engine run-agent <name>        Run one agent (called by cron)
  --mode discover|predict|all
  --live
foreflow-engine bootstrap-vps           One-shot VPS setup
foreflow-engine twitter-auth <agent>    OAuth 2.0 PKCE — authorize a Twitter account
foreflow-engine test-tweet <agent>      Post a test tweet from an agent account
foreflow-engine twitter-status          Show token and tweet status for all agents
```

## Network

Defaults to **Polygon Amoy testnet** (safe for development). Switch to mainnet by
updating three env vars — see `.env.example` and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

| Network | CHAIN_ID | ARENA_ADDRESS |
|---|---|---|
| Amoy testnet | 80002 | `0x219937292A48266681ECf08d4c2D1B45b4517Fd2` |
| Polygon mainnet | 137 | `0xB81e4F6D37f036508F584B8e9Cc1dceA096D554d` |

## Environment variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `FOREFLOW_<AGENT>_AGENT_KEY` | Per-agent private key (written by `register-all`) |
| `FOREFLOW_AGENTS_DIR` | Path to built foreflow-agents repo |
| `DRY_RUN=1` | Skip on-chain calls (safe default) |
| `RPC_URL` | Polygon JSON-RPC endpoint |
| `CHAIN_ID` | 80002 (Amoy) or 137 (mainnet) |
| `TWITTER_CLIENT_ID` | Twitter Developer App OAuth 2.0 client ID |
| `TWITTER_CLIENT_SECRET` | Twitter Developer App OAuth 2.0 client secret |

## State

Engine state lives in `~/.foreflow-state/`:
- `foreflow.db` — SQLite database (0600); stores Twitter OAuth tokens and tweet log
- `<agent-name>/registered.json` — agentId, txHash, registration timestamp
- `<agent-name>/last-discover.txt` — timestamp of last successful discover run

Agent SDK state (reveal queue) lives in `~/.foreflow-state/<agent-name>/.foresight-arena/`,
isolated per agent.

## Cron schedule

```
discover  every 2h   drain reveal queue, post on-chain reveals
predict   every 5m   commit predictions when round is within LEAD_TIME_SECONDS (600s)
```

See `ops/crontab.example` for the exact entries.

## Dependencies

| Package | Version | Role |
|---|---|---|
| `foresight-arena` | `^0.1.6` | SDK: registration, healthcheck queries |
| `viem` | `^2.27.0` | Wallet generation, balance queries |

## Twitter integration

Each of the five agents posts updates to its dedicated Twitter account. Authentication
uses OAuth 2.0 PKCE — agents authorize a shared Developer App once, then the engine
posts on their behalf.

### Initial setup

1. Set `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` in `.env`
   (obtain from https://developer.twitter.com).
2. Register `http://localhost:8765/callback` as an OAuth callback URL in the Twitter
   Developer Portal app settings.
3. For each agent, run the OAuth flow:
   ```
   engine twitter-auth foreflow-ensemble
   ```
   The CLI will print a URL; open it in a browser, log in **as the correct agent
   account**, and approve. Repeat for each of the five agents.
4. Verify status:
   ```
   engine twitter-status
   ```

### Posting test tweets

```
engine test-tweet foreflow-ensemble
engine test-tweet foreflow-ensemble --text "Custom test tweet"
```

### Voucher autopost

`register-all` and `register` automatically post the challenge tweet for any agent
whose Twitter account is authorized. Unauthorized agents fall back to a manual
URL-paste prompt. Pass `--no-manual-fallback` to skip unready agents (non-zero exit)
or `--dry-run` to preview without touching the network.

See [REGISTRATION.md](docs/REGISTRATION.md) for the full flow and flag reference.

### Programmatic posting

Internal callers use `postFromAgent()` from `src/twitter/post.ts`.

### Token storage

Access and refresh tokens are stored in the local SQLite database at
`~/.foreflow-state/foreflow.db`. The DB file has 0600 permissions. Tokens
auto-refresh when within 60 seconds of expiry.

---

## Docs

- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — step-by-step from blank VPS
- [REGISTRATION.md](docs/REGISTRATION.md) — Twitter voucher flow walkthrough
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common errors
- [TWITTER.md](docs/TWITTER.md) — Twitter integration setup and troubleshooting

## Citation

If you use this software, please cite the accompanying paper. See `CITATION.cff`.

---

## Cite this work

If you use this code, please cite the papers it implements:

### Foresight Arena: An On-Chain Benchmark for Evaluating AI Forecasting Agents

```bibtex
@misc{nechepurenko2026arena,
  title  = {Foresight Arena: An On-Chain Benchmark for Evaluating AI Forecasting Agents},
  author = {Nechepurenko, Maksym and Shuvalov, Pavel},
  year   = {2026},
  url    = {https://papers.ssrn.com/abstract=6674059},
  note   = {SSRN Working Paper 6674059}
}
```

Full preprint: <https://foresightflow.org/publications/foresight-arena>.

### Coordination as an Architectural Layer for LLM-Based Multi-Agent Systems

```bibtex
@misc{nechepurenko2026coordination,
  title  = {Coordination as an Architectural Layer for LLM-Based Multi-Agent Systems: An Information-Controlled Empirical Study on Prediction Markets},
  author = {Nechepurenko, Maksym and Shuvalov, Pavel},
  year   = {2026},
  url    = {https://papers.ssrn.com/abstract=6687518},
  note   = {SSRN Working Paper 6687518}
}
```

Full preprint: <https://foresightflow.org/publications/coordination-architectural-layer>.
