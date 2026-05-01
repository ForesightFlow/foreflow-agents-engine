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
foreflow-engine register-all            Register all 5 agents (interactive)
foreflow-engine register --agent <name> Register a single agent
foreflow-engine healthcheck             Wallet balances + registration status
foreflow-engine run-agent <name>        Run one agent (called by cron)
  --mode discover|predict|all
  --live
foreflow-engine bootstrap-vps          One-shot VPS setup
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

## State

Engine state lives in `~/.foreflow-state/<agent-name>/`:
- `registered.json` — agentId, txHash, registration timestamp
- `last-discover.txt` — timestamp of last successful discover run

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

## Docs

- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — step-by-step from blank VPS
- [REGISTRATION.md](docs/REGISTRATION.md) — Twitter voucher flow walkthrough
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common errors

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
