# Deployment Guide

Step-by-step from a blank VPS to all five ForeFlow agents running on Foresight Arena.

## Prerequisites

- Ubuntu 22.04+ / Debian 12+ VPS (2+ vCPU, 4 GB RAM)
- Node.js 18+ (`node --version`)
- git
- An SSH key with write access to the ForesightFlow GitHub org
- A Twitter account for the @foreflow shared handle (for voucher registration)
- Five Polygon wallets funded with at least 0.1 POL each for gas

## 1. Clone and install

```bash
sudo mkdir -p /opt/foreflow && sudo chown $USER /opt/foreflow
cd /opt/foreflow

git clone git@github.com:ForesightFlow/coordination-experiment.git
git clone git@github.com:ForesightFlow/foreflow-agents.git
git clone git@github.com:ForesightFlow/foreflow-agents-engine.git

npm install --prefix coordination-experiment
npm install --prefix foreflow-agents && npm run build --prefix foreflow-agents
npm install --prefix foreflow-agents-engine && npm run build --prefix foreflow-agents-engine

# Make the CLI globally available (or use npx inside the engine dir):
npm link --prefix foreflow-agents-engine
```

Or use the one-shot script:

```bash
bash /opt/foreflow/foreflow-agents-engine/ops/deploy.sh
```

## 2. Configure environment

```bash
cp /opt/foreflow/foreflow-agents-engine/.env.example /opt/foreflow/.env
chmod 600 /opt/foreflow/.env
nano /opt/foreflow/.env
```

Required fields:
- `ANTHROPIC_API_KEY` — Claude API key for LLM calls
- `TAVILY_API_KEY` — web search key
- `FOREFLOW_*_AGENT_KEY` — filled in after step 3

Network: the `.env.example` defaults to **Polygon Amoy testnet** (`CHAIN_ID=80002`).
To switch to mainnet, update `RPC_URL`, `ARENA_ADDRESS`, `ROUND_MANAGER`, and `CHAIN_ID=137`.
See `.env.example` for the exact values.

## 3. Register agents

Run the interactive registration wizard. You will need access to the @foreflow Twitter
account. Each agent requires its own tweet (five tweets total).

```bash
foreflow-engine register-all
```

For each agent the wizard will:
1. Generate a fresh wallet and print the private key.
2. Ask you to save the key to `/opt/foreflow/.env` and press Enter.
3. Show tweet text to post from @foreflow.
4. Wait for you to paste the tweet URL.
5. Verify the tweet and register the wallet on-chain.

Each challenge expires in 15 minutes. The wizard re-fetches if you take too long.

See [REGISTRATION.md](REGISTRATION.md) for a detailed walkthrough.

## 4. Healthcheck

```bash
foreflow-engine healthcheck
```

All five agents should show `registered` status and a non-zero POL balance.

## 5. Log directory

```bash
sudo mkdir -p /var/log/foreflow
sudo chown $USER /var/log/foreflow
```

## 6. Install crontab

```bash
crontab -e
# Paste the contents of /opt/foreflow/foreflow-agents-engine/ops/crontab.example
```

Or append automatically:
```bash
crontab -l > /tmp/ct.txt
cat /opt/foreflow/foreflow-agents-engine/ops/crontab.example >> /tmp/ct.txt
crontab /tmp/ct.txt
```

Cron schedule:
- **discover** every 2 hours — drains the reveal queue, posts on-chain reveals
- **predict** every 5 minutes — checks for rounds within `LEAD_TIME_SECONDS` (600s), commits predictions

## 7. Verify

After one full cycle (≈10 min), check:

```bash
tail -f /var/log/foreflow/ensemble-predict.log
foreflow-engine healthcheck
```

## Mainnet cutover checklist

See the open issue in this repo titled "Mainnet cutover checklist".
