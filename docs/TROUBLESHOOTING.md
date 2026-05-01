# Troubleshooting

## Agent exits immediately with "key not set"

```
ConfigError: FOREFLOW_ENSEMBLE_AGENT_KEY is not set.
```

**Fix:** Run `foreflow-engine register-all` and add the generated keys to `.env`.
See [REGISTRATION.md](REGISTRATION.md).

## Agent exits with "Agent entry point not found"

```
Error: Agent entry point not found: /opt/foreflow/foreflow-agents/dist/agents/...
```

**Fix:** The foreflow-agents repo needs to be built:
```bash
npm run build --prefix /opt/foreflow/foreflow-agents
```
Or check `FOREFLOW_AGENTS_DIR` in `.env` points to the correct directory.

## healthcheck shows "NOT REGISTERED"

The agent wallet has not been registered on Foresight Arena.
Run `foreflow-engine register --agent <name>` for the affected agent.

## healthcheck shows "low balance"

The wallet has < 0.01 POL. Fund it at https://faucet.polygon.technology/ (Amoy)
or transfer POL from another wallet (mainnet).

## Relayer unreachable

```
[WARN] Relayer unreachable — check RELAYER_URL and network
```

1. Check your VPS has outbound internet access.
2. Verify `RELAYER_URL` in `.env` (default: `https://api.foresightarena.xyz`).
3. Check the Foresight Arena status page.

## Relayer 5xx / gaslessCommit fails

Cron will retry on the next 5-minute interval. The reveal queue persists locally,
so reveals are not lost. If the error persists, check `RELAYER_URL` and chain config.

## Challenge expired during registration

```
Challenge expired (15-min window). Re-fetching a new challenge...
```

A new tweet text will be shown. Post the new tweet and paste the new URL.
The old tweet will not work.

## Wrong MODE value

```
ConfigError: MODE="foo" is not valid. Accepted: discover | predict | all
```

Check the first argument to `run-agent.sh` and the crontab entries.

## Cron not running

```bash
crontab -l         # verify entries exist
grep CRON /var/log/syslog | tail -20  # check cron daemon logs
```

Ensure `foreflow-agents-engine/ops/run-agent.sh` is executable:
```bash
chmod +x /opt/foreflow/foreflow-agents-engine/ops/run-agent.sh
```

## Switching from testnet to mainnet

In `/opt/foreflow/.env`:
```
RPC_URL=https://polygon-rpc.com
ARENA_ADDRESS=0xB81e4F6D37f036508F584B8e9Cc1dceA096D554d
ROUND_MANAGER=0x2FA165234ba5fE0bA309853c3fa2Df9949F867Cf
CHAIN_ID=137
```

Then run `foreflow-engine healthcheck` to verify balances on mainnet.
Agents need to be re-registered on mainnet (separate NFTs from testnet).
